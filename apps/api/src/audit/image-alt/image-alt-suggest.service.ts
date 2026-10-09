import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LLMProviderService } from '../../llm/llm-provider.service.js';
import { QuotaService } from '../../billing/quota.service.js';
import { safeFetchBinary, SafeFetchError } from '../../common/safe-fetch.js';
import { altLanguage, buildAltPrompt, parseAltSuggestion } from './image-alt-prompt.js';

/** Gorseller sitenin degil RanksUp'in parasiyla yorumlaniyor → site basina gunluk tavan */
export const IMAGE_ALT_DAILY_CAP = Number(process.env.IMAGE_ALT_DAILY_CAP) > 0 ? Number(process.env.IMAGE_ALT_DAILY_CAP) : 200;
/** Bir iste en fazla — buyuk toplu istekler birden cok ise bolunur */
export const IMAGE_ALT_JOB_BATCH = 25;
const CONCURRENCY = 3;
const PER_HOST_GAP_MS = 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type SuggestOutcome = { id: string; result: 'suggested' | 'decorative' | 'failed' | 'skipped'; note?: string };

/**
 * Gorseli GORUP alt metni onerir (vision). Musteri sitesine HICBIR SEY yazmaz —
 * yalnizca SiteImage.suggestedAlt doldurulur; yazma kullanici onayindan sonra
 * ayri adimdir (image-alt-apply).
 *
 * Akis: SSRF korumali indirme → sharp (piksel siniri, SVG atlanir, uzun kenar
 * ≤1024, JPEG) → LLMProviderService (AI-kapali anahtari + maliyet kaydi) →
 * cikti dogrulamasi. Model: MODEL_IMAGE_ALT (varsayilan claude-opus-5-5,
 * projenin "kalite tercihi" Opus cizgisi).
 */
@Injectable()
export class ImageAltSuggestService {
  private readonly log = new Logger(ImageAltSuggestService.name);
  private readonly lastHit = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
    private readonly quota: QuotaService,
  ) {}

  private model(): string {
    return process.env.MODEL_IMAGE_ALT?.trim() || 'claude-opus-5-5';
  }

  /** Bugun (UTC) bu site icin kalan oneri hakki — deneme sayisi suggestedAt'ten */
  async remainingToday(siteId: string): Promise<number> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.siteImage.count({ where: { siteId, suggestedAt: { gte: dayStart } } });
    return Math.max(0, IMAGE_ALT_DAILY_CAP - used);
  }

  async suggestMany(siteId: string, imageIds: string[], userId?: string): Promise<{ outcomes: SuggestOutcome[]; capped: boolean }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { userId: true, language: true } });
    await this.quota.enforceAiCostBudget(site.userId);

    const rows = await this.prisma.siteImage.findMany({ where: { siteId, id: { in: imageIds.slice(0, IMAGE_ALT_JOB_BATCH) } } });
    let room = await this.remainingToday(siteId);
    const queue = [...rows];
    const outcomes: SuggestOutcome[] = [];
    let capped = false;

    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (room <= 0) { capped = true; outcomes.push({ id: row.id, result: 'skipped', note: 'Gunluk oneri tavani doldu' }); continue; }
        room--;
        outcomes.push(await this.suggestOne(row, site.language, userId ?? site.userId));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { outcomes, capped };
  }

  /** Ayni host'a saniyede en fazla bir istek (musteri sitesini yormayalim) */
  private async politeWait(url: string): Promise<void> {
    let host = '';
    try { host = new URL(url).host; } catch { return; }
    const wait = (this.lastHit.get(host) ?? 0) + PER_HOST_GAP_MS - Date.now();
    this.lastHit.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  private async note(id: string, note: string, attempted: boolean) {
    await this.prisma.siteImage.update({
      where: { id },
      data: { suggestionNote: note.slice(0, 255), ...(attempted ? { suggestedAt: new Date() } : {}) },
    }).catch(() => {});
  }

  async suggestOne(row: { id: string; siteId: string; src: string; firstPageUrl: string; linked: boolean; linkHref: string | null; currentAlt: string | null; context: any; pageLang: string | null }, siteLanguage: string | null, userId?: string): Promise<SuggestOutcome> {
    // 1) Indir — SSRF korumali
    let bytes: Buffer;
    let contentType: string;
    try {
      await this.politeWait(row.src);
      const r = await safeFetchBinary(row.src, { accept: /^image\//, maxBytes: MAX_IMAGE_BYTES });
      bytes = r.body;
      contentType = r.contentType;
    } catch (err: any) {
      const why = err instanceof SafeFetchError ? `${err.code}: ${err.message}` : String(err?.message ?? err);
      await this.note(row.id, `Gorsel indirilemedi (${why})`, false);
      return { id: row.id, result: 'failed', note: why };
    }
    if (contentType === 'image/svg+xml') {
      await this.note(row.id, 'SVG atlandi — vektor gorsellerde alti elle yaz', false);
      return { id: row.id, result: 'skipped', note: 'svg' };
    }

    // 2) Kucult + JPEG (sharp piksel siniri: dekompresyon bombasina karsi)
    let jpeg: Buffer;
    try {
      jpeg = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (err: any) {
      await this.note(row.id, `Gorsel okunamadi (${String(err?.message ?? err).slice(0, 120)})`, false);
      return { id: row.id, result: 'failed', note: 'decode' };
    }

    // 3) Model — buradan sonrasi ucretli; deneme gunluk tavana sayilir
    const { systemPrompt, userText } = buildAltPrompt({
      language: altLanguage(row.pageLang, siteLanguage),
      pageUrl: row.firstPageUrl,
      linked: row.linked,
      linkHref: row.linkHref,
      currentAlt: row.currentAlt,
      context: row.context,
    });
    const model = this.model();
    let output = '';
    let stopReason: string | undefined;
    try {
      const res = await this.llm.chat({
        context: 'image-alt',
        siteId: row.siteId,
        userId,
        conversationId: row.id,
        model,
        effort: 'low',
        maxTokens: 4000,
        systemPrompt,
        messages: [{ role: 'user', content: userText, images: [{ mediaType: 'image/jpeg', base64: jpeg.toString('base64') }] }],
      });
      output = res.output;
      stopReason = res.stopReason;
    } catch (err: any) {
      await this.note(row.id, `Model cagrisi basarisiz: ${String(err?.message ?? err).slice(0, 160)}`, true);
      return { id: row.id, result: 'failed', note: 'llm' };
    }

    if (stopReason === 'refusal') {
      await this.note(row.id, 'Model bu gorsel icin oneri uretmedi — alti elle yaz', true);
      return { id: row.id, result: 'failed', note: 'refusal' };
    }
    const parsed = parseAltSuggestion(output);
    if (!parsed.ok) {
      await this.note(row.id, `Oneri gecersiz: ${parsed.reason}`, true);
      return { id: row.id, result: 'failed', note: parsed.reason };
    }

    await this.prisma.siteImage.update({
      where: { id: row.id },
      data: {
        suggestedAlt: parsed.alt,
        suggestedBy: model,
        suggestedAt: new Date(),
        suggestionNote: `guven ${Math.round(parsed.confidence * 100)}%`,
        status: parsed.decorative ? 'DECORATIVE_SUGGESTED' : 'SUGGESTED',
      },
    });
    return { id: row.id, result: parsed.decorative ? 'decorative' : 'suggested' };
  }
}
