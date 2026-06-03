import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { decrypt } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { safeParseJson } from '../common/safe-json.js';

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
 *  4. Yeni HTML'i sitenin default publish target'i araciligiyla
 *     overwrite et — slug ayni kalir, HTML'in icindeki ana icerik degisir
 *  5. StuckPageRecovery audit trail (bodyHtmlBefore/After dolu, bodyMd null)
 *
 * Sinirlama: Sadece sitenin **bir publish target'i** varsa calisir
 * (WordPress, FTP, SFTP, cPanel — adapter overwrite destekleyenler).
 * Webflow gibi headless CMS'ler icin URL-based update yok.
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
  ) {}

  async recover(
    stuckPageId: string,
    opts: { triggeredBy: string },
  ): Promise<{
    success: boolean;
    recoveryId?: string;
    editsCount?: number;
    reason?: string;
  }> {
    const stuckPage = await this.prisma.stuckPage.findUnique({
      where: { id: stuckPageId },
    });
    if (!stuckPage) throw new NotFoundException('Stuck page bulunamadi');
    if (stuckPage.articleId) {
      throw new BadRequestException('Bu sayfa Article kaydina sahip — normal recovery kullan');
    }
    if (!this.anthropic) {
      throw new BadRequestException('ANTHROPIC_API_KEY eksik');
    }

    await this.prisma.stuckPage.update({
      where: { id: stuckPageId },
      data: { status: 'RECOVERING' as any },
    });

    try {
      // 1) HTML fetch
      const html = await this.fetchHtml(stuckPage.url);
      if (!html) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return { success: false, reason: 'URL fetch failed' };
      }

      // 2) Main content extract
      const { mainHtml, mainText } = this.extractMainContent(html);
      if (!mainText || mainText.length < 200) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return { success: false, reason: 'Main content cikartilamadi veya cok kisa' };
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
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return { success: false, reason: 'LLM bos sonuc' };
      }

      // 5) Edit'leri HTML'e uygula
      const { newHtml, appliedEdits } = this.applyEditsToHtml(html, mainHtml, proposal.edits, proposal.paragraphAdded);
      if (appliedEdits.length === 0) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return { success: false, reason: 'Edit\'lerin hicbiri HTML\'de bulunamadi' };
      }

      // 6) Publish target uzerinden overwrite
      const target = await this.findOverwriteTarget(stuckPage.siteId, stuckPage.url);
      if (!target) {
        // Audit trail yine de yaz, kullanici manuel uygulasin
        const recovery = await this.prisma.stuckPageRecovery.create({
          data: {
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
            llmModel: 'claude-sonnet-4-6',
            appliedBy: opts.triggeredBy,
            geoScoreBefore,
            positionBefore: stuckPage.position,
            ctrBefore: stuckPage.ctr,
          } as any,
        });
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return {
          success: false,
          recoveryId: recovery.id,
          reason: 'Uygun publish target yok (WordPress/FTP/SFTP/cPanel gerek). Audit trail kayitli, manuel uygulayabilirsin.',
        };
      }

      const overwriteOk = await this.overwriteViaAdapter(target, stuckPage.url, newHtml).catch((err) => {
        this.log.warn(`Overwrite hata: ${err.message}`);
        return false;
      });

      if (!overwriteOk) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return { success: false, reason: 'Adapter ile overwrite basarisiz' };
      }

      // 7) Audit trail + status
      const recovery = await this.prisma.stuckPageRecovery.create({
        data: {
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
          llmModel: 'claude-sonnet-4-6',
          appliedBy: opts.triggeredBy,
          geoScoreBefore,
          positionBefore: stuckPage.position,
          ctrBefore: stuckPage.ctr,
        } as any,
      });

      await this.prisma.stuckPage.update({
        where: { id: stuckPageId },
        data: {
          status: 'RECOVERED' as any,
          entityScoreBefore: geoScoreBefore ?? undefined,
        },
      });

      this.log.log(
        `[${stuckPageId}] External recovery basarili: ${appliedEdits.length} edit, target=${target.type}`,
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
          title: `External sayfa duzeltildi: ${stuckPage.title ?? stuckPage.url}`,
          message: `${appliedEdits.length} cumle iyilestirildi, ${proposal.entitiesAdded.length} entity eklendi. Target: ${target.type}`,
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
      await this.prisma.stuckPage.update({
        where: { id: stuckPageId },
        data: { status: 'FAILED' as any },
      });
      this.log.error(`[${stuckPageId}] External recovery hata: ${err.message}`);
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  HTML fetch + main content extraction
  // ─────────────────────────────────────────────────────────────
  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RanksUp-StuckPageRecovery/1.0 (+https://ranksup.ai)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (err: any) {
      this.log.warn(`Fetch hata ${url}: ${err.message}`);
      return null;
    }
  }

  private extractMainContent(html: string): { mainHtml: string; mainText: string } {
    const $ = cheerio.load(html);
    // Sirayla aday selector'lar
    const candidates = ['article', 'main', '.entry-content', '.post-content', '.content', '#content'];
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length > 0 && (el.text().trim().length > 200)) {
        return { mainHtml: el.html() ?? '', mainText: el.text() };
      }
    }
    // Fallback: body
    const body = $('body');
    return { mainHtml: body.html() ?? '', mainText: body.text() };
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
        model: 'claude-sonnet-4-6',
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
    mainHtml: string,
    edits: ProposedEdit[],
    paragraphAdded: string | null,
  ): { newHtml: string; appliedEdits: ProposedEdit[] } {
    let current = fullHtml;
    const applied: ProposedEdit[] = [];

    for (const edit of edits) {
      if (edit.type !== 'sentence_replace' || !edit.before) continue;
      // HTML'de cumle text node icinde — direkt string replace ile bulmaya calis
      // (HTML entity escape'leri farkli olabilir, ilk pasta bunu basit tutuyoruz)
      if (current.includes(edit.before)) {
        current = current.replace(edit.before, edit.after);
        applied.push(edit);
      }
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
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─────────────────────────────────────────────────────────────
  //  Publish target arama + overwrite
  // ─────────────────────────────────────────────────────────────
  private async findOverwriteTarget(siteId: string, _url: string): Promise<any | null> {
    // Sirayla overwrite-yetenekli adapter tipleri
    const overwriteCapable = ['wordpress-rest', 'wordpress-xmlrpc', 'ftp', 'sftp', 'cpanel-api'];
    const targets = await this.prisma.publishTarget.findMany({
      where: {
        siteId,
        isActive: true,
        type: { in: overwriteCapable },
      } as any,
      orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }],
    });
    return targets[0] ?? null;
  }

  private async overwriteViaAdapter(target: any, url: string, newHtml: string): Promise<boolean> {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) return false;

    // Credentials decrypt
    const decrypted = Object.fromEntries(
      Object.entries(target.credentials as Record<string, any>).map(([k, v]) => [
        k,
        typeof v === 'string' && v.includes(':') ? decrypt(v) : v,
      ]),
    );
    const adapter = new Adapter(decrypted, target.config ?? {});

    // Slug url'den cikar
    let slug = '';
    try { slug = new URL(url).pathname.replace(/^\/|\/$/g, '').split('/').pop() ?? ''; } catch {}
    if (!slug) return false;

    try {
      // Yeni publish ile overwrite (slug eslesirse adapter update yapar)
      const result = await adapter.publish({
        slug,
        title: '',  // baslik degismez — adapter'in update path'i title bos olunca title'a dokunmamali
        bodyHtml: newHtml,
        bodyMd: '',
        metaTitle: undefined,
        metaDescription: undefined,
      });
      return !!result?.ok;
    } catch (err: any) {
      this.log.warn(`Adapter publish hata: ${err.message}`);
      return false;
    }
  }
}
