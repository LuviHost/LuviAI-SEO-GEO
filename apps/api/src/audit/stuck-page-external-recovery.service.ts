import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { decryptCredentials } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { publishTargetBlockReason } from '../publish-targets/publish-target-url.js';
import { safeParseJson } from '../common/safe-json.js';
import { safeFetchText, SafeFetchError } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { fetchCustomerPage, pageFailureText, rewriteCharsetProblem, type CustomerPage, type CustomerPageOk } from './customer-page-fetch.js';
import { planStaticWrite, staticFileProblem, type StaticFileLocation, type StaticFileProbe } from './stuck-page-static-write.js';
import { STUCK_AI_DISABLED, STUCK_AI_UNAVAILABLE, STUCK_PAGE_NOT_FOUND, STUCK_PROCESSED_SINCE_REQUEST, stuckStatusSkipText } from './stuck-page-messages.js';
import {
  claimStuckPage, readStuckClaimLease, recoverableStuckStatuses, releaseAbandonedStuckClaim, stuckProcessedSince, stuckRequestedAt,
  type StuckClaimDeps,
} from './stuck-page-autopilot.js';
import { targetLabel } from '../articles/republish-policy.js';

interface ProposedEdit {
  type: 'sentence_replace' | 'paragraph_add' | 'alttext_update';
  before?: string;
  after: string;
  reason: string;
  entityAdded?: string;
}

interface LlmRecoveryProposal {
  diagnosis: string;
  edits: ProposedEdit[];
  entitiesAdded: string[];
  paragraphAdded: string | null;
  entityScoreEstimate: number;
}

/** Hedef secimi sonucu: yazilacak statik dosya ya da elle uygulama nedeni */
type WritePlan =
  | { kind: 'write'; target: any; location: StaticFileLocation }
  | { kind: 'manual'; reason: string };

/**
 * ENH#2 — External Page Recovery.
 *
 * RanksUp Article kaydi olmayan, dis sayfa (kullanicinin sitesinde elle
 * yazilmis blog post vb.) icin recovery.
 *
 * Akis:
 *  1. URL'den HTML fetch
 *  2. Cheerio ile main content extract (article/main/.entry-content tag'leri)
 *  3. LLM ile cumle-seviye edit onerisi (in-place HTML preserving)
 *  4. Duzenlenmis TAM SAYFA yalniz statik bir .html dosyasinin yerine yazilir
 *     (FTP / SFTP / cPanel; dosya yolu ve "sayfayi bu dosya sunuyor" dogrulanir —
 *     bkz. stuck-page-static-write.ts). WordPress / KobiPratik / ozel PHP gibi
 *     CMS hedeflerinde YAZILMAZ: tam sayfa HTML'i yazinin icerigi yerine gecer,
 *     menu/alt bilgi/betikler govdeye sizar ve blok yapisi bozulurdu. Orada
 *     oneri kaydedilir, kullanici elle uygular (sayfa "Tespit edildi"de kalir).
 *  5. StuckPageRecovery audit trail (bodyHtmlBefore/After dolu, bodyMd null)
 *
 * Tetikleyen: kullanici (audit.controller recover uclari). Otopilot yalniz
 * RanksUp makalelerini kurtarir (stuck-page-recovery.service.ts).
 */
@Injectable()
export class StuckPageExternalRecoveryService {
  private readonly log = new Logger(StuckPageExternalRecoveryService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: WebhookNotifierService,
    private readonly geo: GeoRunnerService,
    private readonly jobs: JobQueueService,
    // SettingsModule @Global: AI_GLOBAL_DISABLED (makale akisiyla ayni; istege bagli)
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /** opts.jobId / opts.requestedAt: makale akisindaki anlamla ayni (stuck-page-recovery.service recover) */
  async recover(
    stuckPageId: string,
    opts: { triggeredBy: string; jobId?: string; requestedAt?: string },
  ): Promise<{
    success: boolean;
    recoveryId?: string;
    editsCount?: number;
    reason?: string;
    /** true: oneri kaydedildi ama siteye YAZILMADI — kullanici elle uygular (reason nedenini soyler) */
    manual?: boolean;
    /** true: sayfanin durumu duzeltmeye uygun degil; hicbir sey degismedi, yapay zeka cagrilmadi */
    skipped?: boolean;
  }> {
    let stuckPage = await this.prisma.stuckPage.findUnique({
      where: { id: stuckPageId },
    });
    if (!stuckPage) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
    if (stuckPage.articleId) {
      throw new BadRequestException('Bu sayfa bir RanksUp makalesi; makale düzeltmesi kullanılmalı.');
    }
    if (!this.anthropic) {
      throw new BadRequestException(STUCK_AI_UNAVAILABLE);
    }
    const claimDeps: StuckClaimDeps = { prisma: this.prisma, jobs: this.jobs, log: this.log };

    // Sahipsiz sahiplenme (onceki is oldu): makale akisiyla ayni kural —
    // ayni is yeniden teslim edildiyse ya da kira dolduysa ve canli is yoksa
    // sayfa onceki durumuna birakilir, sonra normal akis
    if (String(stuckPage.status) === 'RECOVERING') {
      const released = await releaseAbandonedStuckClaim(claimDeps, stuckPage, { jobId: opts.jobId });
      if (released) {
        const fresh = await this.prisma.stuckPage.findUnique({ where: { id: stuckPageId } });
        if (!fresh) throw new NotFoundException(STUCK_PAGE_NOT_FOUND);
        stuckPage = fresh;
      }
    }

    // ATOMIK sahiplenme (makale akisiyla ayni kural, stuck-page-recovery.service):
    // yalniz "Tespit edildi" / "Basarisiz" sayfadan RECOVERING'e. Eskiden durum
    // kosulsuz yaziliyordu: gozardi edilmis ya da zaten duzeltilmis sayfa (eski
    // panel, tekrarlanan toplu istek) yeniden duzenlenip dosyasi yeniden yaziliyordu.
    const autopilot = opts.triggeredBy === 'autopilot';
    const allowed = recoverableStuckStatuses(opts.triggeredBy);
    if (!allowed.includes(stuckPage.status)) {
      return { success: false, skipped: true, reason: stuckStatusSkipText(stuckPage.status, autopilot) };
    }
    // Kuyruktaki is calismadan once sayfa islendiyse ikinci tur yok (ayni isin
    // onceki denemesi haric: BullMQ yeniden denemesi)
    const requestedAt = stuckRequestedAt(opts.requestedAt);
    if (requestedAt && await stuckProcessedSince(this.prisma, stuckPage, requestedAt)) {
      const lease = opts.jobId ? await readStuckClaimLease(claimDeps, stuckPageId) : null;
      if (!opts.jobId || lease?.jobId !== opts.jobId) return { success: false, skipped: true, reason: STUCK_PROCESSED_SINCE_REQUEST };
    }
    if (this.settings && await this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false)) {
      return { success: false, skipped: true, reason: STUCK_AI_DISABLED };
    }
    if (!(await claimStuckPage(claimDeps, { stuckPageId, from: stuckPage, jobId: opts.jobId }))) {
      const current = await this.prisma.stuckPage.findUnique({ where: { id: stuckPageId }, select: { status: true } });
      return { success: false, skipped: true, reason: stuckStatusSkipText(current?.status, autopilot) };
    }

    try {
      // 1) HTML fetch
      const page = await this.fetchHtml(stuckPage.url);
      // Bu HTML duzenlenip (statik sitede) sayfanin YERINE yazilabilir: engel/dogrulama ekrani,
      // 2 MB tavanda kesilmis govde (sayfanin geri kalanini silerdi) ve UTF-8
      // disi sayfa (adaptorler UTF-8 yazar, Turkce harfler bozulur) kaynak
      // olamaz — static-html-fixer ile ayni kurallar.
      const charsetProblem = page.kind === 'ok' ? rewriteCharsetProblem(page) : null;
      if (page.kind !== 'ok' || page.truncated || charsetProblem) {
        await this.markFailed(stuckPageId);
        return {
          success: false,
          reason: page.kind !== 'ok'
            ? `Sayfa indirilemedi — ${pageFailureText(page)}`
            : page.truncated
              ? 'Sayfa 2 MB okuma sınırını aşıyor — kesik içerikle üzerine yazmak sayfayı bozar; manuel uygula'
              : charsetProblem!,
        };
      }
      const html = page.text;

      // 2) Main content extract
      const { mainText, mainStart } = this.extractMainContent(html);
      if (!mainText || mainText.length < 200) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'Sayfanın ana içeriği bulunamadı ya da çok kısa (200 karakterden az).' };
      }

      // 3) GEO before
      const geoBefore = await this.geo.runAudit(stuckPage.url).catch(() => null);
      const geoScoreBefore = geoBefore?.score ?? null;

      // 4) LLM edit onerisi
      const topQueries: string[] = Array.isArray(stuckPage.topQueries)
        ? (stuckPage.topQueries as string[])
        : [];
      const proposal = await this.proposeEdits({
        title: stuckPage.title ?? '',
        bodyText: mainText,
        targetKeywords: topQueries,
        currentPosition: stuckPage.position,
        impressions: stuckPage.impressions,
        ctr: stuckPage.ctr,
      });

      if (!proposal || proposal.edits.length === 0) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'AI bu sayfa için değişiklik önerisi üretemedi.' };
      }

      // 5) Edit'leri HTML'e uygula
      const { newHtml, appliedEdits } = this.applyEditsToHtml(html, mainStart, proposal.edits, proposal.paragraphAdded);
      if (appliedEdits.length === 0) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: 'Önerilen cümlelerin hiçbiri sayfada birebir bulunamadı; değişiklik yapılmadı.' };
      }

      const recoveryData = {
        stuckPageId,
        bodyHtmlBefore: html,
        bodyHtmlAfter: newHtml,
        bodyMdBefore: null,
        bodyMdAfter: null,
        edits: appliedEdits as any,
        entitiesAdded: proposal.entitiesAdded as any,
        paragraphAdded: proposal.paragraphAdded ?? null,
        entityScoreAfter: proposal.entityScoreEstimate,
        scorePassedComp: proposal.entityScoreEstimate >= 70,
        llmModel: 'claude-sonnet-5',
        appliedBy: opts.triggeredBy,
        geoScoreBefore,
        positionBefore: stuckPage.position,
        ctrBefore: stuckPage.ctr,
      };

      // 6) Nereye yazilabilir? Yalniz dogrulanmis statik .html dosyasi; gerisi elle uygulanir
      const plan = await this.planWrite(stuckPage.siteId, page);
      if (plan.kind === 'manual') {
        // Oneri denetim kaydinda (oncesi/sonrasi HTML + cumle degisiklikleri) durur.
        // Siteye hicbir sey yazilmadigi icin sayfa "Tespit edildi"de kalir: basarisiz
        // degil, duzeltilmis de degil (panel kaydi "Oneri" olarak gosterir). Webhook
        // ve 30 gunluk etki olcumu YOK — olculecek bir degisiklik yapilmadi.
        const recovery = await this.prisma.stuckPageRecovery.create({ data: recoveryData as any });
        await this.prisma.stuckPage.updateMany({ where: { id: stuckPageId, status: 'RECOVERING' }, data: { status: 'DETECTED' } });
        this.log.log(`[${stuckPageId}] External recovery: ${appliedEdits.length} oneri kaydedildi, siteye yazilmadi — ${plan.reason}`);
        return { success: false, manual: true, recoveryId: recovery.id, editsCount: appliedEdits.length, reason: plan.reason };
      }

      const target = plan.target;
      // Yapay zeka cagrisi surerken musteri sayfayi "Gozardi" ettiyse dosya yazilmaz
      const still = await this.prisma.stuckPage.findUnique({ where: { id: stuckPageId }, select: { status: true } });
      if (String(still?.status) !== 'RECOVERING') {
        this.log.log(`[${stuckPageId}] External recovery yazilmadi: sayfa durumu ${still?.status ?? 'yok'}`);
        return { success: false, skipped: true, reason: stuckStatusSkipText(still?.status, autopilot) };
      }
      const overwrite = await this.overwriteStaticFile(target, plan.location, newHtml).catch((err) => {
        this.log.warn(`Overwrite hata: ${err.message}`);
        return { ok: false, error: undefined as string | undefined };
      });

      if (!overwrite.ok) {
        await this.markFailed(stuckPageId);
        return { success: false, reason: overwrite.error ?? 'Sayfa dosyası yayın hedefine yazılamadı.' };
      }

      // 7) Audit trail + status
      const recovery = await this.prisma.stuckPageRecovery.create({ data: recoveryData as any });

      // Kosullu: dosya yazildi; arada verilen bir karar (gozardi) ezilmez
      await this.prisma.stuckPage.updateMany({
        where: { id: stuckPageId, status: 'RECOVERING' },
        data: {
          status: 'RECOVERED',
          entityScoreBefore: geoScoreBefore ?? undefined,
        },
      });

      this.log.log(
        `[${stuckPageId}] External recovery basarili: ${appliedEdits.length} edit, target=${target.type} → ${plan.location.remoteDir}/${plan.location.slug}.html`,
      );

      // Webhook + performance check schedule
      const site = await this.prisma.site.findUnique({
        where: { id: stuckPage.siteId },
        select: { name: true, userId: true },
      });
      if (site) {
        await this.webhook.notify({
          siteId: stuckPage.siteId,
          siteName: site.name,
          event: 'stuck_page_recovered',
          title: `Takılı sayfa düzeltildi: ${stuckPage.title ?? stuckPage.url}`,
          message: `${appliedEdits.length} cümle iyileştirildi, ${proposal.entitiesAdded.length} kavram eklendi ve sayfanın dosyası ${targetLabel(target.type)} üzerinden güncellendi. Etkisi 30 gün sonra otomatik ölçülür.`,
          url: stuckPage.url,
          meta: { recoveryId: recovery.id, external: true },
        }).catch(() => null);

        // ENH#4 — 30 gun sonra performance check
        if (site.userId) {
          await this.jobs.enqueue({
            type: 'STUCK_PAGE_PERFORMANCE_CHECK',
            userId: site.userId,
            siteId: stuckPage.siteId,
            payload: { recoveryId: recovery.id },
            delay: 30 * 24 * 60 * 60 * 1000,
            jobId: `stuck-perf-${recovery.id}`,
          }).catch(() => null);
        }
      }

      return { success: true, recoveryId: recovery.id, editsCount: appliedEdits.length };
    } catch (err: any) {
      await this.markFailed(stuckPageId).catch(() => undefined);
      this.log.error(`[${stuckPageId}] External recovery hata: ${err.message}`);
      throw err;
    }
  }

  /**
   * Sayfa RECOVERING → FAILED. Kosullu: bu arada verilen bir karar (gozardi)
   * ezilmez. updatedAt acikca yazilir: basarisiz denemeden sonraki bekleme
   * suresi bu andan sayilir (makale akisiyla ayni; gerekce
   * stuck-page-recovery.service markFailed).
   */
  private async markFailed(stuckPageId: string): Promise<void> {
    await this.prisma.stuckPage.updateMany({
      where: { id: stuckPageId, status: 'RECOVERING' },
      data: { status: 'FAILED', updatedAt: new Date() },
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  HTML fetch + main content extraction
  // ─────────────────────────────────────────────────────────────
  /** Sayfa — adres GSC/taramadan gelir: SSRF korumali, 2 MB tavanli */
  private async fetchHtml(url: string): Promise<CustomerPage> {
    const page = await fetchCustomerPage(url, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
    if (page.kind !== 'ok') this.log.warn(`Fetch hata ${url}: ${pageFailureText(page)}`);
    return page;
  }

  /**
   * Ana icerik metni (LLM'e giden) ve ham HTML'de baslangic konumu. Duzenlemeler
   * yalniz bu konumdan sonra aranir: ayni cumle <head>'deki meta aciklamada ya
   * da menude de gecebilir; ilk eslesme orada olsaydi govde degismeden
   * "uygulandi" sayilirdi.
   */
  private extractMainContent(html: string): { mainText: string; mainStart: number } {
    const $ = cheerio.load(html);
    // Sirayla aday selector'lar ve ham HTML'deki acilis etiketleri
    const candidates: Array<[string, RegExp]> = [
      ['article', /<article\b/i],
      ['main', /<main\b/i],
      ['.entry-content', /<[a-z][^>]*\bclass\s*=\s*["'][^"']*\bentry-content\b/i],
      ['.post-content', /<[a-z][^>]*\bclass\s*=\s*["'][^"']*\bpost-content\b/i],
      ['.content', /<[a-z][^>]*\bclass\s*=\s*["'](?:[^"']*\s)?content(?:\s[^"']*)?["']/i],
      ['#content', /<[a-z][^>]*\bid\s*=\s*["']content["']/i],
    ];
    const bodyStart = Math.max(0, html.search(/<body\b/i));
    for (const [sel, open] of candidates) {
      const el = $(sel).first();
      if (el.length > 0 && (el.text().trim().length > 200)) {
        const at = html.search(open);
        return { mainText: el.text(), mainStart: at >= 0 ? at : bodyStart };
      }
    }
    // Fallback: body
    return { mainText: $('body').text(), mainStart: bodyStart };
  }

  // ─────────────────────────────────────────────────────────────
  //  LLM edit proposal
  // ─────────────────────────────────────────────────────────────
  private async proposeEdits(input: {
    title: string;
    bodyText: string;
    targetKeywords: string[];
    currentPosition: number;
    impressions: number;
    ctr: number;
  }): Promise<LlmRecoveryProposal | null> {
    if (!this.anthropic) return null;

    const trimmed = input.bodyText.length > 12000
      ? input.bodyText.slice(0, 12000) + '\n\n[...truncated...]'
      : input.bodyText;

    const targetsBlock = input.targetKeywords.length > 0
      ? input.targetKeywords.map((k) => `- ${k}`).join('\n')
      : '(GSC verisi yok — makale konusundan cikar)';

    const systemPrompt = `Sen Turkce SEO uzmanisin. Yayinda olan bir sayfa Google'da #${Math.round(input.currentPosition)}. siradadir. Sayfanin asil metnine bakacaksin (HTML disinda salt text). Gorevin:
1. Eksik entity ve thin section tespit etmek
2. CUMLE-SEVIYESINDE oneri vermek (genis paragraf yeniden yazma yok)
3. Maksimum 1 kisa yeni paragraf eklenebilir
4. Baslik, slug'a dokunma
5. JSON dondur`;

    const userPrompt = `# Sayfa
Baslik: ${input.title || '(yok)'}
Pozisyon: #${Math.round(input.currentPosition)}
Gosterim/CTR: ${input.impressions} / %${(input.ctr * 100).toFixed(2)}

# Hedef sorgular
${targetsBlock}

# Sayfa metni
${trimmed}

# Cikti formati (STRICT JSON)
{
  "diagnosis": "1-2 cumle teshis",
  "edits": [
    {"type":"sentence_replace","before":"BIREBIR ORJINAL CUMLE","after":"YENI CUMLE","reason":"...","entityAdded":"..."}
  ],
  "entitiesAdded": ["..."],
  "paragraphAdded": null veya "kisa paragraf",
  "entityScoreEstimate": 0-100
}

ONEMLI: "before" sayfada BIREBIR varolmali. Max 6 edit.`;

    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = safeParseJson(match[0]);
      if (!parsed || !Array.isArray(parsed.edits)) return null;
      return parsed as LlmRecoveryProposal;
    } catch (err: any) {
      this.log.error(`External LLM hata: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  HTML'e edit uygulama (full HTML korunarak)
  // ─────────────────────────────────────────────────────────────
  private applyEditsToHtml(
    fullHtml: string,
    mainStart: number,
    edits: ProposedEdit[],
    paragraphAdded: string | null,
  ): { newHtml: string; appliedEdits: ProposedEdit[] } {
    let current = fullHtml;
    const applied: ProposedEdit[] = [];

    for (const edit of edits) {
      if (edit.type !== 'sentence_replace' || !edit.before || typeof edit.after !== 'string') continue;
      // HTML'de cumle text node icinde — ana icerikten itibaren birebir aranir
      // (HTML entity escape'leri farkli olabilir; bulunamayan oneri uygulanmis sayilmaz)
      const idx = current.indexOf(edit.before, mainStart);
      if (idx < 0) continue;
      // Dilimleyerek: String.replace yeni metindeki "$&", "$'" kaliplarini acip
      // metni bozardi. Yeni metin metin olarak kacislanir — model ciktisindaki
      // < > & " sayfaya etiket ya da oznitelik olarak sizmasin.
      current = current.slice(0, idx) + this.escapeHtml(edit.after) + current.slice(idx + edit.before.length);
      applied.push(edit);
    }

    if (paragraphAdded && paragraphAdded.trim()) {
      // En son </article> veya </main> oncesine ekle
      const newPara = `<p>${this.escapeHtml(paragraphAdded.trim())}</p>`;
      const targets = ['</article>', '</main>', '</body>'];
      let inserted = false;
      for (const tag of targets) {
        const idx = current.lastIndexOf(tag);
        if (idx >= 0) {
          current = current.slice(0, idx) + '\n' + newPara + '\n' + current.slice(idx);
          inserted = true;
          break;
        }
      }
      if (!inserted) current += '\n' + newPara;
    }

    return { newHtml: current, appliedEdits: applied };
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─────────────────────────────────────────────────────────────
  //  Publish target secimi + statik dosya dogrulamasi + yazim
  // ─────────────────────────────────────────────────────────────
  /**
   * Sayfa otomatik nereye yazilabilir? Kural ve gerekce: stuck-page-static-write.ts.
   * Statik dosya adayi cikarsa o dosyanin adresi okunur ve sayfayi BIREBIR
   * sundugu (ve oneri hazirlanirken sayfanin degismedigi) dogrulanir.
   */
  private async planWrite(siteId: string, page: CustomerPageOk): Promise<WritePlan> {
    const [site, targets] = await Promise.all([
      this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true, platform: true } }),
      this.prisma.publishTarget.findMany({
        where: { siteId, isActive: true },
        orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }],
      }),
    ]);
    const plan = planStaticWrite({
      targets: targets as any[],
      siteUrl: site?.url ?? null,
      platform: site?.platform ?? null,
      pageUrl: page.url,
      html: page.text,
    });
    if (plan.kind !== 'write') return plan;
    const problem = staticFileProblem(await this.probeStaticFile(plan.location.fileUrl), plan.location.fileUrl, page.text);
    return problem ? { kind: 'manual', reason: problem } : plan;
  }

  /** Dosya adresini SSRF korumali okur (sayfayla ayni kurallar); engel ekrani dosya sayilmaz */
  private async probeStaticFile(fileUrl: string): Promise<StaticFileProbe> {
    try {
      const res = await safeFetchText(fileUrl, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
      const block = detectBlock(res);
      return block ? { error: `dosya adresi okunamadı: ${block.reason}` } : res;
    } catch (err) {
      const code = err instanceof SafeFetchError ? err.code : 'network';
      return { error: `dosya adresi okunamadı (${code})` };
    }
  }

  /**
   * Dogrulanmis statik dosyanin yerine duzenlenmis TAM sayfayi yazar.
   * error: kullaniciya gosterilecek Turkce neden.
   */
  private async overwriteStaticFile(target: any, location: StaticFileLocation, newHtml: string): Promise<{ ok: boolean; error?: string }> {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) return { ok: false, error: `Yayın hedefi (${target.type}) için yazıcı bulunamadı.` };

    /*
     * CREDENTIALS COZME — tek kaynak `@luviai/shared` decryptCredentials:
     * publish-targets.service tum credential'i tek JSON olarak `{ enc }`
     * seklinde sifreliyor; alan-bazli eski cozme `baseUrl`/`host` alanlarini
     * adaptore hic ulastirmiyordu. Ayni mantik publisher.service.ts ve
     * auto-fix.service.ts ile ortak.
     */
    const credentials = decryptCredentials(target.credentials as Record<string, any>);
    // Adaptor kullanicinin girdigi adrese FTP / SSH / HTTPS ile baglanir;
    // kayittan sonra DNS ic aga cevrilmis olabilir — istekten HEMEN once denetim
    const error = await publishTargetBlockReason(target.type, credentials, target.config);
    if (error) {
      this.log.warn(`Overwrite atlandi (${target.type}): ${error}`);
      return { ok: false, error };
    }
    // Adaptorler `${remotePath}/${slug}.html` yazar (ftp.ts, sftp.ts, cpanel-api.ts):
    // klasor, sayfanin dogrulanan dosyasinin klasoruyle degistirilir
    const adapter = new Adapter(credentials, { ...((target.config as Record<string, unknown> | null) ?? {}), remotePath: location.remoteDir });
    try {
      const result = await adapter.publish({
        slug: location.slug,
        title: '', // dosya hedefleri basligi kullanmaz; tam sayfa zaten <title> tasir
        bodyHtml: newHtml,
        bodyMd: '',
        metaTitle: undefined,
        metaDescription: undefined,
      });
      if (result?.ok) return { ok: true };
      const detail = typeof result?.error === 'string' && result.error ? ` (${result.error.slice(0, 200)})` : '';
      return { ok: false, error: `Sayfa dosyası yayın hedefine yazılamadı${detail}.` };
    } catch (err: any) {
      this.log.warn(`Adapter publish hata: ${err.message}`);
      return { ok: false, error: 'Sayfa dosyası yayın hedefine yazılamadı.' };
    }
  }
}
