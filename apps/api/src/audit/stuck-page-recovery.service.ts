import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
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
 * Stuck Page Recovery — On-page.ai Recipe 1 esleyicisi.
 *
 * Akis:
 *   1. Article'dan mevcut bodyMd al (snapshot icin sakla)
 *   2. GSC'den bu URL icin top sorgu(lari) cek
 *   3. Claude Sonnet 4.6 ile gap analizi + cumle-seviye edit onerisi
 *   4. Edit'leri uygula (find/replace + paragraph append)
 *   5. Publisher.publishArticle ile yeniden yayinla
 *   6. StuckPageRecovery audit trail kaydi
 *   7. Status -> RECOVERED, webhook bildir (varsa)
 *
 * Revert: bodyMdBefore snapshot'tan geri yukle + yeniden yayinla.
 */
@Injectable()
export class StuckPageRecoveryService {
  private readonly log = new Logger(StuckPageRecoveryService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: WebhookNotifierService,
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
    needsRepublish?: boolean;
    articleId?: string;
  }> {
    const stuckPage = await this.prisma.stuckPage.findUnique({
      where: { id: stuckPageId },
    });
    if (!stuckPage) throw new NotFoundException('Stuck page bulunamadi');

    if (!stuckPage.articleId) {
      throw new BadRequestException(
        'Bu sayfa RanksUp disinda yazildi (Article kaydi yok) — external page recovery henuz desteklenmiyor.',
      );
    }
    if (!this.anthropic) {
      throw new BadRequestException('ANTHROPIC_API_KEY eksik — recovery yapilamaz');
    }

    await this.prisma.stuckPage.update({
      where: { id: stuckPageId },
      data: { status: 'RECOVERING' as any },
    });

    try {
      const article = await this.prisma.article.findUniqueOrThrow({
        where: { id: stuckPage.articleId },
      });
      const bodyMdBefore = article.bodyMd ?? '';
      const bodyHtmlBefore = article.bodyHtml ?? '';

      if (!bodyMdBefore.trim()) {
        throw new BadRequestException('Article body bos — recovery yapilamaz');
      }

      // Detect aninda kaydedilen top sorgular (varsa)
      const topQueries: string[] = Array.isArray(stuckPage.topQueries)
        ? (stuckPage.topQueries as string[])
        : [];

      // LLM gap analizi + edit onerisi
      const proposal = await this.proposeEdits({
        article,
        bodyMd: bodyMdBefore,
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
        return { success: false, reason: 'LLM analizi bos sonuc verdi' };
      }

      // Edit'leri uygula
      const { bodyMdAfter, appliedEdits, skippedEdits } = this.applyEdits(
        bodyMdBefore,
        proposal.edits,
        proposal.paragraphAdded,
      );

      if (appliedEdits.length === 0) {
        await this.prisma.stuckPage.update({
          where: { id: stuckPageId },
          data: { status: 'FAILED' as any },
        });
        return {
          success: false,
          reason: 'Onerilen edit\'lerin hicbiri uygulanamadi (LLM hallucination)',
        };
      }

      // Article guncelle (bodyHtml worker'da publish sirasinda yenilenir)
      await this.prisma.article.update({
        where: { id: stuckPage.articleId },
        data: { bodyMd: bodyMdAfter },
      });

      // Recovery kaydi (publish henuz yapilmadi — worker tetikleyecek)
      const recovery = await this.prisma.stuckPageRecovery.create({
        data: {
          stuckPageId,
          bodyMdBefore,
          bodyMdAfter,
          bodyHtmlBefore,
          bodyHtmlAfter: null,
          edits: appliedEdits as any,
          entitiesAdded: proposal.entitiesAdded as any,
          paragraphAdded: proposal.paragraphAdded ?? null,
          entityScoreAfter: proposal.entityScoreEstimate,
          scorePassedComp: proposal.entityScoreEstimate >= 70,
          llmModel: 'claude-sonnet-4-6',
          appliedBy: opts.triggeredBy,
        },
      });

      await this.prisma.stuckPage.update({
        where: { id: stuckPageId },
        data: { status: 'RECOVERED' as any },
      });

      this.log.log(
        `[${stuckPageId}] Recovery basarili: ${appliedEdits.length} edit uygulandi (${skippedEdits.length} skipped), ${proposal.entitiesAdded.length} entity, paragraph=${proposal.paragraphAdded ? 'EVET' : 'HAYIR'} — re-publish queued`,
      );

      // Webhook notify
      const site = await this.prisma.site.findUnique({
        where: { id: stuckPage.siteId },
        select: { name: true, userId: true },
      });
      await this.webhook.notify({
        siteId: stuckPage.siteId,
        siteName: site?.name ?? '',
        event: 'stuck_page_recovered',
        title: `Stuck sayfa duzeltildi: ${stuckPage.title ?? stuckPage.url}`,
        message: `${appliedEdits.length} cumle iyilestirildi, ${proposal.entitiesAdded.length} entity eklendi. Eski pozisyon: #${Math.round(stuckPage.position)}. Etki 24-48 saat.`,
        url: stuckPage.url,
        meta: { recoveryId: recovery.id, entitiesAdded: proposal.entitiesAdded },
      }).catch(() => null);

      // Re-publish job kuyrukla
      if (site?.userId) {
        await this.jobs.enqueue({
          type: 'PUBLISH_ARTICLE',
          userId: site.userId,
          siteId: stuckPage.siteId,
          payload: { articleId: stuckPage.articleId, targetIds: [] },
        }).catch((e: any) => this.log.warn(`Re-publish enqueue hatasi: ${e.message}`));
      }

      return {
        success: true,
        recoveryId: recovery.id,
        editsCount: appliedEdits.length,
        needsRepublish: true,
        articleId: stuckPage.articleId,
      };
    } catch (err: any) {
      await this.prisma.stuckPage.update({
        where: { id: stuckPageId },
        data: { status: 'FAILED' as any },
      });
      this.log.error(`[${stuckPageId}] Recovery hata: ${err.message}`);
      throw err;
    }
  }

  /** Recovery'yi geri al — bodyMd snapshot'tan eski hali. Worker re-publish'i ayri job ile yapar. */
  async revert(
    recoveryId: string,
    userId: string,
  ): Promise<{ needsRepublish: boolean; articleId: string }> {
    const recovery = await this.prisma.stuckPageRecovery.findUnique({
      where: { id: recoveryId },
      include: { stuckPage: true },
    });
    if (!recovery) throw new NotFoundException('Recovery bulunamadi');
    if (recovery.revertedAt) throw new BadRequestException('Bu recovery zaten geri alindi');
    if (!recovery.stuckPage.articleId) {
      throw new BadRequestException('Article kaydi yok — revert yapilamaz');
    }

    await this.prisma.article.update({
      where: { id: recovery.stuckPage.articleId },
      data: {
        bodyMd: recovery.bodyMdBefore ?? '',
        bodyHtml: recovery.bodyHtmlBefore ?? null,
      },
    });

    await this.prisma.$transaction([
      this.prisma.stuckPageRecovery.update({
        where: { id: recoveryId },
        data: { revertedAt: new Date(), revertedBy: userId },
      }),
      this.prisma.stuckPage.update({
        where: { id: recovery.stuckPageId },
        data: { status: 'REVERTED' as any },
      }),
    ]);

    // Re-publish job kuyrukla (eski hali ile)
    const site = await this.prisma.site.findUnique({
      where: { id: recovery.stuckPage.siteId },
      select: { userId: true },
    });
    if (site?.userId) {
      await this.jobs.enqueue({
        type: 'PUBLISH_ARTICLE',
        userId: site.userId,
        siteId: recovery.stuckPage.siteId,
        payload: { articleId: recovery.stuckPage.articleId, targetIds: [] },
      }).catch((e: any) => this.log.warn(`Revert re-publish enqueue hatasi: ${e.message}`));
    }

    this.log.log(`[${recoveryId}] Revert uygulandi (user=${userId}) — re-publish queued`);
    return { needsRepublish: true, articleId: recovery.stuckPage.articleId };
  }

  // ─────────────────────────────────────────────────────────────
  //  LLM gap analizi + edit onerisi
  // ─────────────────────────────────────────────────────────────
  private async proposeEdits(input: {
    article: any;
    bodyMd: string;
    targetKeywords: string[];
    currentPosition: number;
    impressions: number;
    ctr: number;
  }): Promise<LlmRecoveryProposal | null> {
    if (!this.anthropic) return null;

    // Body cok uzunsa ilk ~12K karakter (token tasarrufu)
    const bodyTrimmed = input.bodyMd.length > 12000
      ? input.bodyMd.slice(0, 12000) + '\n\n[...truncated...]'
      : input.bodyMd;

    const targetsBlock = input.targetKeywords.length > 0
      ? input.targetKeywords.map((k) => `- ${k}`).join('\n')
      : '(GSC verisi yok — makale konusundan cikar)';

    const systemPrompt = `Sen Turkce SEO uzmanisin. Yayinda olan bir makale Google'da #${Math.round(input.currentPosition)}. siradadir — ilk sayfada ama top 3 degil. Gorevin:

1. Makaleyi okumak, eksik entity (KDV beyani, e-fatura, mali musavir gibi konuyla ilgili anahtar kavramlar) ve "thin section" tespit etmek
2. CUMLE-SEVIYESINDE oneri vermek — paragrafin tamamini yeniden yazma, sadece eksik kelimeleri DOGAL bicimde mevcut cumlelere ekle
3. Maksimum 1 yeni kisa paragraf onerebilirsin (sadece icerik gercekten thin ise)
4. Baslik, slug, H1, H2'lere DOKUNMA
5. Insani yaziyi koru — robotik ekleme yapma
6. JSON dondur, baska metin ekleme

Onerilerini Turkce yaz. Marka sesini koru.`;

    const userPrompt = `# Makale bilgileri
Baslik: ${input.article.title}
Mevcut pozisyon: #${Math.round(input.currentPosition)} (Google ilk sayfa, top 3 disi)
Son 30 gun: ${input.impressions} gosterim, CTR %${(input.ctr * 100).toFixed(2)}

# Hedef anahtar kelimeler (GSC top sorgular)
${targetsBlock}

# Makale govdesi (Markdown)
${bodyTrimmed}

# Cikti formati (STRICT JSON, baska metin yok)
{
  "diagnosis": "Bu sayfa neden stuck oldugunun 1-2 cumle ozet (entity gap mi, thin content mi, vs)",
  "edits": [
    {
      "type": "sentence_replace",
      "before": "ORJINAL CUMLE (makaleden BIREBIR kopyala)",
      "after": "EKSIK ENTITY DOGAL EKLENMIS YENI CUMLE",
      "reason": "Neden bu degisiklik (eklenen entity ile birlikte)",
      "entityAdded": "eklenen anahtar kavram"
    }
  ],
  "entitiesAdded": ["eklenen", "entity'ler", "listesi"],
  "paragraphAdded": null veya "Eger thin section varsa eklenen tek paragraf (max 80 kelime)",
  "entityScoreEstimate": 0-100 (degisikliklerden sonra tahmini entity skoru)
}

ONEMLI:
- "before" alani makaleden BIREBIR kopya olmali (kelime kelime). Aksi halde uygulanamaz.
- En fazla 6 edit oner. Asiri optimization zarar verir.
- "Highly Related Words" / "important entities" yoksa edits[] bos olabilir, bunu net soyle.`;

    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        this.log.warn('LLM JSON cikti bulamadi');
        return null;
      }
      const parsed = safeParseJson(match[0]);
      if (!parsed || !Array.isArray(parsed.edits)) {
        this.log.warn('LLM cikti gecersiz format');
        return null;
      }
      return parsed as LlmRecoveryProposal;
    } catch (err: any) {
      this.log.error(`LLM hata: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Edit uygulama — find/replace + optional paragraph append
  // ─────────────────────────────────────────────────────────────
  private applyEdits(
    bodyMd: string,
    edits: ProposedEdit[],
    paragraphAdded: string | null,
  ): { bodyMdAfter: string; appliedEdits: ProposedEdit[]; skippedEdits: ProposedEdit[] } {
    let current = bodyMd;
    const applied: ProposedEdit[] = [];
    const skipped: ProposedEdit[] = [];

    for (const edit of edits) {
      if (edit.type !== 'sentence_replace' || !edit.before) {
        skipped.push(edit);
        continue;
      }
      if (!current.includes(edit.before)) {
        // LLM birebir kopya alamamis — atla
        skipped.push(edit);
        continue;
      }
      current = current.replace(edit.before, edit.after);
      applied.push(edit);
    }

    if (paragraphAdded && paragraphAdded.trim()) {
      // Sonuna ekle (sade — daha akilli yerlestirme Faz 2'de)
      current = current.trimEnd() + '\n\n' + paragraphAdded.trim() + '\n';
    }

    return { bodyMdAfter: current, appliedEdits: applied, skippedEdits: skipped };
  }

}
