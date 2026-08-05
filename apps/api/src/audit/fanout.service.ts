import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
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
 *
 * KIRACI IZOLASYONU: SiteAccessGuard yalnizca :siteId'yi dogrular. Bu
 * servisteki her metot siteId alir ve sorgusunu onunla kisitlar.
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

const MAX_BRANCHES_PER_PROMPT = 20;
const MIN_BRANCH_LEN = 5;
const MAX_BRANCH_LEN = 300;

@Injectable()
export class FanoutService {
  private readonly log = new Logger(FanoutService.name);

  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /** promptId'yi SADECE verilen site icinde arar (cross-tenant erisimi kapatir) */
  private async requirePrompt(siteId: string, promptId: string) {
    const prompt = await this.prisma.geoPrompt.findFirst({
      where: { id: promptId, siteId },
      include: { site: { include: { brain: true } } },
    });
    if (!prompt) throw new NotFoundException('Prompt bulunamadi');
    return prompt;
  }

  private async requireFanout(siteId: string, fanoutId: string) {
    const f = await this.prisma.geoFanoutQuery.findFirst({ where: { id: fanoutId, siteId } });
    if (!f) throw new NotFoundException('Fan-out dali bulunamadi');
    return f;
  }

  /**
   * Bir ana prompt icin fan-out dallarini uret.
   *
   * ESKI DALLAR SILINMEZ, PASIFE ALINIR. Silmek GeoPromptRun.fanoutId uzerindeki
   * onDelete:Cascade nedeniyle o dala ait TUM GECMIS OLCUMLERI de siliyordu —
   * kullanici "dallari yenile"ye basinca haftalarca biriken trend verisi geri
   * donusu olmadan yok oluyordu. Artik gecmis korunur; ayni metinli dal yeniden
   * uretilirse eski kayit tekrar aktive edilir ve gecmisi kesintisiz devam eder.
   */
  async generateForPrompt(siteId: string, promptId: string, opts: { max?: number } = {}): Promise<{
    promptId: string;
    generated: number;
    reactivated: number;
    branches: FanoutBranch[];
  }> {
    const rawMax = typeof opts.max === 'number' ? opts.max : parseInt(String(opts.max ?? ''), 10);
    const max = Number.isFinite(rawMax) ? Math.min(Math.max(Math.trunc(rawMax), 1), 16) : 8;

    const prompt = await this.requirePrompt(siteId, promptId);
    const site = prompt.site;
    const brand = (site.name || '').trim();
    const competitors = this.competitorNames(site.brain);

    const existing = await this.prisma.geoFanoutQuery.findMany({
      where: { promptId },
      select: { id: true, text: true, generatedBy: true, isActive: true, rank: true },
    });
    const existingByNorm = new Map(existing.map((e) => [this.normKey(e.text), e]));

    const branches = await this.buildBranches({
      question: prompt.text,
      brand,
      niche: site.niche ?? undefined,
      locale: prompt.locale,
      competitors,
      max,
      // Manuel dallarla cakisan oneriler elensin — eskiden dedupe yalnizca yeni
      // parti icinde calisiyordu ve korunan manuel dalin ikizi tekrar yaziliyordu
      excludeKeys: new Set(existing.filter((e) => e.generatedBy === 'manual').map((e) => this.normKey(e.text))),
    });

    // Onceki AI dallarini pasife al (silme!)
    await this.prisma.geoFanoutQuery.updateMany({
      where: { promptId, generatedBy: 'ai' },
      data: { isActive: false },
    });

    // Manuel dallarin rank'ini koru; AI dallari onlarin ustune yazilmasin
    const maxManualRank = existing
      .filter((e) => e.generatedBy === 'manual')
      .reduce((m, e) => Math.max(m, e.rank), -1);

    let generated = 0;
    let reactivated = 0;
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const key = this.normKey(b.text);
      const prev = existingByNorm.get(key);
      const rank = maxManualRank + 1 + i;

      if (prev && prev.generatedBy === 'ai') {
        // Ayni dal yeniden uretildi — kaydi ve gecmisini koruyup tekrar aktive et
        await this.prisma.geoFanoutQuery.update({
          where: { id: prev.id },
          data: { isActive: true, kind: b.kind, likelihood: b.likelihood, rank },
        });
        reactivated++;
      } else if (!prev) {
        await this.prisma.geoFanoutQuery.create({
          data: { promptId, siteId, text: b.text, kind: b.kind, likelihood: b.likelihood, rank, generatedBy: 'ai' },
        });
        generated++;
      }
      // prev.generatedBy === 'manual' ise dokunma (zaten excludeKeys ile elenmisti)
    }

    return { promptId, generated, reactivated, branches };
  }

  /** Prompt'un dal listesi (manuel + AI, rank sirasinda) */
  async listForPrompt(siteId: string, promptId: string) {
    await this.requirePrompt(siteId, promptId);
    return this.prisma.geoFanoutQuery.findMany({
      where: { promptId },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Kullanici elle dal ekler — AI yeniden uretimi bunu silmez/pasife almaz */
  async addManual(siteId: string, promptId: string, rawText: unknown, kind?: FanoutKind) {
    await this.requirePrompt(siteId, promptId);

    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (text.length < MIN_BRANCH_LEN) {
      throw new BadRequestException(`Dal metni en az ${MIN_BRANCH_LEN} karakter olmali`);
    }
    if (text.length > MAX_BRANCH_LEN) {
      throw new BadRequestException(`Dal metni ${MAX_BRANCH_LEN} karakteri asamaz`);
    }

    // Adet siniri — yoksa 500 dal eklenip runPrompt her calistirmada
    // 500 x provider LLM cagrisi yapar
    const count = await this.prisma.geoFanoutQuery.count({ where: { promptId } });
    if (count >= MAX_BRANCHES_PER_PROMPT) {
      throw new BadRequestException(`Soru basina en fazla ${MAX_BRANCHES_PER_PROMPT} dal eklenebilir`);
    }

    const dup = await this.prisma.geoFanoutQuery.findMany({ where: { promptId }, select: { text: true } });
    if (dup.some((d) => this.normKey(d.text) === this.normKey(text))) {
      throw new BadRequestException('Bu dal zaten ekli');
    }

    const last = await this.prisma.geoFanoutQuery.findFirst({
      where: { promptId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    return this.prisma.geoFanoutQuery.create({
      data: {
        promptId,
        siteId,
        text,
        kind: kind && KIND_SET.includes(kind) ? kind : 'reviews',
        likelihood: 50,
        rank: (last?.rank ?? -1) + 1,
        generatedBy: 'manual',
      },
    });
  }

  async remove(siteId: string, fanoutId: string) {
    await this.requireFanout(siteId, fanoutId);
    await this.prisma.geoFanoutQuery.delete({ where: { id: fanoutId } });
    return { ok: true };
  }

  async setActive(siteId: string, fanoutId: string, isActive: boolean) {
    await this.requireFanout(siteId, fanoutId);
    return this.prisma.geoFanoutQuery.update({
      where: { id: fanoutId },
      data: { isActive: !!isActive },
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
    excludeKeys?: Set<string>;
  }): Promise<FanoutBranch[]> {
    const ai = await this.buildWithAi(ctx).catch((err) => {
      this.log.warn(`Fan-out AI uretimi basarisiz, sablona dusuluyor: ${err.message}`);
      return [] as FanoutBranch[];
    });
    // AI cokerse veya anahtar yoksa sablon uretimi devreye girer — panel bos kalmasin
    const raw = ai.length ? ai : this.buildFromTemplate(ctx);
    const excl = ctx.excludeKeys ?? new Set<string>();
    return this.dedupe(raw.filter((b) => !excl.has(this.normKey(b.text)))).slice(0, ctx.max);
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

    const isEn = ctx.locale === 'en';
    const dil = isEn ? 'İngilizce' : 'Türkçe';
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
      'likelihood = modelin bu dali gercekten acma olasiligi tahminin (0-100 arasi sayi).',
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

  /**
   * Modelin dondurdugu metinden dal listesini cikar.
   * Once tam JSON dizisi denenir; model duz metin veya kesik JSON dondurdugunde
   * satir satir nesne ayiklamaya duser. Eskiden yalnizca ilk '[' ile son ']'
   * arasi kesiliyordu; markdown fence veya kesik cikti geldiginde parse
   * tamamen basarisiz olup panel sessizce bosaliyordu.
   */
  private parseBranches(raw: string): FanoutBranch[] {
    if (!raw || typeof raw !== 'string') return [];

    // Markdown fence temizle
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (Array.isArray(parsed)) {
          const out = this.coerceBranches(parsed);
          if (out.length) return out;
        }
      } catch { /* asagidaki satir-bazli ayiklamaya dus */ }
    }

    // Kesik/bozuk JSON — tek tek {...} bloklarini yakala
    const objects: any[] = [];
    for (const m of cleaned.matchAll(/\{[^{}]*\}/g)) {
      try { objects.push(JSON.parse(m[0])); } catch { /* atla */ }
    }
    return this.coerceBranches(objects);
  }

  private coerceBranches(items: any[]): FanoutBranch[] {
    const out: FanoutBranch[] = [];
    for (const item of items) {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (text.length < MIN_BRANCH_LEN || text.length > MAX_BRANCH_LEN) continue;
      const kind: FanoutKind = KIND_SET.includes(item?.kind) ? item.kind : 'reviews';
      // Number(null) === 0 oldugu icin eskiden likelihood'u olmayan dallar 0 alip
      // siralamanin dibine dusuyor ve slice(max) ile kesiliyordu. Null/undefined
      // artik acikca 50'ye (notr) duser.
      const rawL = item?.likelihood;
      const parsedL = rawL === null || rawL === undefined || rawL === '' ? NaN : Number(rawL);
      const likelihood = Number.isFinite(parsedL) ? Math.min(100, Math.max(0, Math.round(parsedL))) : 50;
      out.push({ text, kind, likelihood });
    }
    return out;
  }

  /**
   * AI yoksa/coktugunde sablon uretimi.
   * Bilinen fan-out kaliplari — zayif ama bos ekrandan iyi.
   */
  private buildFromTemplate(ctx: {
    question: string;
    brand: string;
    niche?: string;
    locale?: string;
    competitors: string[];
  }): FanoutBranch[] {
    // Marka ve nis bosken TUM soru cumlesini konu yerine koymak
    // "en iyi ticari kredi hangisi yorumlari ve kullanici deneyimleri" gibi
    // bozuk cumleler uretiyordu. Soru cumlesini kisaltip temizliyoruz.
    const konu = (ctx.brand || ctx.niche || this.topicFromQuestion(ctx.question)).trim();
    const rakip = ctx.competitors[0];
    const en = ctx.locale === 'en';

    const out: FanoutBranch[] = en
      ? [
          { text: `${konu} reviews and user experiences`, kind: 'reviews', likelihood: 80 },
          { text: `Is ${konu} trustworthy?`, kind: 'trust', likelihood: 75 },
          { text: `${konu} pricing and fees`, kind: 'pricing', likelihood: 70 },
          { text: `${konu} alternatives`, kind: 'alternatives', likelihood: 65 },
          { text: `How to use ${konu} step by step`, kind: 'howto', likelihood: 60 },
          { text: `${konu} features and requirements`, kind: 'spec', likelihood: 55 },
          { text: `${konu} options available locally`, kind: 'local', likelihood: 50 },
        ]
      : [
          { text: `${konu} yorumları ve kullanıcı deneyimleri`, kind: 'reviews', likelihood: 80 },
          { text: `${konu} güvenilir mi?`, kind: 'trust', likelihood: 75 },
          { text: `${konu} fiyatları ve ücretleri`, kind: 'pricing', likelihood: 70 },
          { text: `${konu} alternatifleri neler?`, kind: 'alternatives', likelihood: 65 },
          { text: `${konu} nasıl kullanılır, adım adım`, kind: 'howto', likelihood: 60 },
          { text: `${konu} şartları ve özellikleri`, kind: 'spec', likelihood: 55 },
          { text: `Türkiye'de ${konu} seçenekleri`, kind: 'local', likelihood: 50 },
        ];

    if (rakip) {
      out.splice(2, 0, {
        text: en ? `${konu} vs ${rakip} comparison` : `${konu} vs ${rakip} karşılaştırma`,
        kind: 'comparison',
        likelihood: 72,
      });
    }
    return out;
  }

  /** Soru cumlesinden kisa bir konu ifadesi cikar (sablon dallar icin) */
  private topicFromQuestion(q: string): string {
    const cleaned = q
      .replace(/[?!.]+/g, ' ')
      .replace(/\b(nedir|nasil|nasıl|hangisi|hangi|mi|mu|mü|mı|en iyi|nelerdir|neler|kimler|kac|kaç)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleaned.split(' ').filter(Boolean).slice(0, 4);
    return words.join(' ') || q.slice(0, 40).trim();
  }

  /**
   * Tekille + sirala.
   * SIRA ONEMLI: once likelihood'a gore sirala, SONRA tekille. Ters sirada
   * yapilinca ayni konunun yuksek olasilikli hali atilip dusuk olani kaliyordu.
   */
  private dedupe(branches: FanoutBranch[]): FanoutBranch[] {
    const sorted = [...branches].sort((a, b) => b.likelihood - a.likelihood);
    const seen = new Set<string>();
    const out: FanoutBranch[] = [];
    for (const b of sorted) {
      const key = this.normKey(b.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    return out;
  }

  /** TR locale kullanma — "I" harfi TR'de "ı"ya duserek yanlis ayrim yaratir */
  private normKey(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
