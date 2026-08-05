import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Fan-out Query Engine.
 *
 * NEDEN VAR: Kullanici "en iyi ticari kredi hangisi" diye sordugunda model bu
 * cumleyi dogrudan cevaplamaz — arka planda "X guvenilir mi", "X vs Y",
 * "X faiz orani 2026", "X sikayet" gibi alt sorgular acar ve cevabi o dallarin
 * sonuclarindan kurar. Citation cogu zaman ana soruda degil, bu dallarda
 * kazanilir veya kaybedilir. Sadece ana soruyu olcen bir arac, olcmesi gereken
 * yuzeyin kucuk bir dilimini olcer.
 *
 * Bu servis dal agacini uretir; olcumu PromptLabService yapar.
 *
 * SINIR: Dallar MODELIN GERCEK ic sorgulari degil — saglayicilar bunu
 * disari vermiyor. Burada uretilenler, bilinen fan-out kaliplarina gore
 * yapilan TAHMINDIR. Kullaniciya da boyle sunulmali; "ChatGPT tam olarak
 * sunu aradi" demek yanlis olur.
 */

export type FanoutKind =
  | 'reviews'       // "X yorumlari", "X deneyimler"
  | 'trust'         // "X guvenilir mi", "X dolandirici mi"
  | 'comparison'    // "X vs Y", "X mi Y mi"
  | 'pricing'       // "X fiyat", "X ucret 2026"
  | 'alternatives'  // "X alternatifleri", "X yerine ne"
  | 'howto'         // "X nasil yapilir", "X basvuru adimlari"
  | 'local'         // "Turkiye'de X", "X sehir"
  | 'spec';         // "X ozellikleri", "X sartlari"

export interface FanoutBranch {
  text: string;
  kind: FanoutKind;
  /** Modelin bu dali acma olasiligi tahmini 0..100 */
  likelihood: number;
}

const KIND_SET: FanoutKind[] = [
  'reviews', 'trust', 'comparison', 'pricing', 'alternatives', 'howto', 'local', 'spec',
];

@Injectable()
export class FanoutService {
  private readonly log = new Logger(FanoutService.name);

  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir ana prompt icin fan-out dallarini uret ve DB'ye yaz.
   * Var olan AI dallari silinir (yeniden uretim); kullanicinin elle ekledigi
   * dallar (generatedBy='manual') KORUNUR.
   */
  async generateForPrompt(promptId: string, opts: { max?: number } = {}): Promise<{
    promptId: string;
    generated: number;
    branches: FanoutBranch[];
  }> {
    const max = Math.min(Math.max(opts.max ?? 8, 1), 16);

    const prompt = await this.prisma.geoPrompt.findUnique({
      where: { id: promptId },
      include: { site: { include: { brain: true } } },
    });
    if (!prompt) return { promptId, generated: 0, branches: [] };

    const site = prompt.site;
    const brand = (site.name || '').trim();
    const competitors = this.competitorNames(site.brain);

    const branches = await this.buildBranches({
      question: prompt.text,
      brand,
      niche: site.niche ?? undefined,
      locale: prompt.locale,
      competitors,
      max,
    });

    // AI dallarini tazele, manuel olanlara dokunma
    await this.prisma.geoFanoutQuery.deleteMany({
      where: { promptId, generatedBy: 'ai' },
    });
    if (branches.length) {
      await this.prisma.geoFanoutQuery.createMany({
        data: branches.map((b, i) => ({
          promptId,
          siteId: prompt.siteId,
          text: b.text,
          kind: b.kind,
          likelihood: b.likelihood,
          rank: i,
          generatedBy: 'ai',
        })),
      });
    }

    return { promptId, generated: branches.length, branches };
  }

  /** Prompt'un dal listesi (manuel + AI, rank sirasinda) */
  async listForPrompt(promptId: string) {
    return this.prisma.geoFanoutQuery.findMany({
      where: { promptId },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Kullanici elle dal ekler — AI yeniden uretimi bunu silmez */
  async addManual(promptId: string, siteId: string, text: string, kind: FanoutKind = 'reviews') {
    const last = await this.prisma.geoFanoutQuery.findFirst({
      where: { promptId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    return this.prisma.geoFanoutQuery.create({
      data: {
        promptId,
        siteId,
        text: text.trim(),
        kind: KIND_SET.includes(kind) ? kind : 'reviews',
        likelihood: 50,
        rank: (last?.rank ?? -1) + 1,
        generatedBy: 'manual',
      },
    });
  }

  async remove(fanoutId: string) {
    await this.prisma.geoFanoutQuery.delete({ where: { id: fanoutId } }).catch(() => null);
    return { ok: true };
  }

  async setActive(fanoutId: string, isActive: boolean) {
    return this.prisma.geoFanoutQuery.update({
      where: { id: fanoutId },
      data: { isActive },
    });
  }

  // ────────────────────────────────────────────────────────────
  //  DAL URETIMI
  // ────────────────────────────────────────────────────────────
  private async buildBranches(ctx: {
    question: string;
    brand: string;
    niche?: string;
    locale: string;
    competitors: string[];
    max: number;
  }): Promise<FanoutBranch[]> {
    const ai = await this.buildWithAi(ctx).catch((err) => {
      this.log.warn(`Fan-out AI uretimi basarisiz, sablona dusuluyor: ${err.message}`);
      return [] as FanoutBranch[];
    });
    // AI cokerse veya anahtar yoksa sablon uretimi devreye girer — panel bos kalmasin
    const branches = ai.length ? ai : this.buildFromTemplate(ctx);
    return this.dedupe(branches).slice(0, ctx.max);
  }

  private async buildWithAi(ctx: {
    question: string;
    brand: string;
    niche?: string;
    locale: string;
    competitors: string[];
    max: number;
  }): Promise<FanoutBranch[]> {
    if (!this.anthropic) return [];

    const dil = ctx.locale === 'en' ? 'İngilizce' : 'Türkçe';
    const system = [
      'Sen bir arama davranisi analistisin.',
      'Bir kullanici sorusu verildiginde, buyuk dil modellerinin (ChatGPT, Gemini, Perplexity)',
      'bu soruyu cevaplarken arka planda ACMASI MUHTEMEL alt sorgulari (fan-out) tahmin edersin.',
      '',
      'Kurallar:',
      '- Alt sorgular gercek arama cumlesi gibi olmali, baslik gibi degil.',
      '- Her sorgu tek bir niyete odaklanmali.',
      '- Marka adini yalnizca dogal durdugu yerde kullan; her sorguya zorla sokma.',
      '- Ayni seyin farkli kelimelerle tekrari YASAK.',
      `- Sorgular ${dil} olmali.`,
      '',
      'Ciktiyi SADECE JSON dizisi olarak ver, baska hicbir sey yazma:',
      '[{"text":"...","kind":"reviews|trust|comparison|pricing|alternatives|howto|local|spec","likelihood":0-100}]',
      '',
      'likelihood = modelin bu dali gercekten acma olasiligi tahminin.',
    ].join('\n');

    const user = [
      `Ana soru: ${ctx.question}`,
      ctx.brand ? `Marka: ${ctx.brand}` : '',
      ctx.niche ? `Sektor: ${ctx.niche}` : '',
      ctx.competitors.length ? `Rakipler: ${ctx.competitors.slice(0, 6).join(', ')}` : '',
      '',
      `En fazla ${ctx.max} alt sorgu uret.`,
    ].filter(Boolean).join('\n');

    const resp = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return this.parseBranches(text);
  }

  /** Modelin dondurdugu metinden JSON dizisini cikar ve dogrula */
  private parseBranches(raw: string): FanoutBranch[] {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let parsed: any;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const out: FanoutBranch[] = [];
    for (const item of parsed) {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (text.length < 5 || text.length > 300) continue;
      const kind: FanoutKind = KIND_SET.includes(item?.kind) ? item.kind : 'reviews';
      const rawLikelihood = Number(item?.likelihood);
      const likelihood = Number.isFinite(rawLikelihood)
        ? Math.min(100, Math.max(0, Math.round(rawLikelihood)))
        : 50;
      out.push({ text, kind, likelihood });
    }
    return out;
  }

  /**
   * AI yoksa/coktuğunde sablon uretimi.
   * Bilinen fan-out kaliplari — zayif ama bos ekrandan iyi.
   */
  private buildFromTemplate(ctx: {
    question: string;
    brand: string;
    niche?: string;
    competitors: string[];
  }): FanoutBranch[] {
    const konu = (ctx.brand || ctx.niche || ctx.question).trim();
    const rakip = ctx.competitors[0];

    const out: FanoutBranch[] = [
      { text: `${konu} yorumları ve kullanıcı deneyimleri`, kind: 'reviews', likelihood: 80 },
      { text: `${konu} güvenilir mi?`, kind: 'trust', likelihood: 75 },
      { text: `${konu} fiyatları ve ücretleri`, kind: 'pricing', likelihood: 70 },
      { text: `${konu} alternatifleri neler?`, kind: 'alternatives', likelihood: 65 },
      { text: `${konu} nasıl kullanılır, adım adım`, kind: 'howto', likelihood: 60 },
      { text: `${konu} şartları ve özellikleri`, kind: 'spec', likelihood: 55 },
      { text: `Türkiye'de ${konu} seçenekleri`, kind: 'local', likelihood: 50 },
    ];
    if (rakip) {
      out.splice(2, 0, { text: `${konu} vs ${rakip} karşılaştırma`, kind: 'comparison', likelihood: 72 });
    }
    return out;
  }

  private dedupe(branches: FanoutBranch[]): FanoutBranch[] {
    const seen = new Set<string>();
    const out: FanoutBranch[] = [];
    for (const b of branches) {
      const key = b.text.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    return out.sort((a, b) => b.likelihood - a.likelihood);
  }

  private competitorNames(brain: any): string[] {
    const raw: any = brain?.competitors;
    if (!Array.isArray(raw)) return [];
    const names: string[] = [];
    for (const c of raw) {
      const name = typeof c === 'string' ? c : (c && typeof c === 'object' ? c.name : null);
      if (typeof name === 'string' && name.trim().length >= 2) names.push(name.trim());
    }
    return Array.from(new Set(names));
  }
}
