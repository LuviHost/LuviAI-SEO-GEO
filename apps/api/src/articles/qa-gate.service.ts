import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';
import { deterministicQaIssues, type QaIssue } from './qa-deterministic.js';

export type { QaIssue } from './qa-deterministic.js';

/**
 * QA Gate — yayin oncesi son kontrol.
 *
 * AI icerik urunlerine en buyuk itiraz "halusinasyon yayinlar" korkusudur.
 * Editor ajani kaliteyi puanlar ama yayini DURDURMAZ; bu servis durdurur.
 *
 * Iki katman:
 *   1. Deterministik: placeholder gorsel, doldurulmamis sablon ({{...}}, [GORSEL]),
 *      TODO kalintisi, bos bolum, mock icerik izi.
 *   2. LLM: uydurma atif ("X'e gore..." kaynaksiz), kaynaksiz sayisal iddia,
 *      uydurma calisma/rapor referansi.
 *
 * Sonuc Article.qaStatus'a yazilir:
 *   PASS    → yayina engel yok
 *   WARN    → uyarilar var, yayin serbest
 *   BLOCKED → publisher yayini reddeder (kullanici override edebilir)
 */

export interface QaReport {
  blockers: QaIssue[];
  warnings: QaIssue[];
  stats: { wordCount: number; checkedBy: string; llmUsed: boolean };
  checkedAt: string;
}

@Injectable()
export class QaGateService {
  private readonly log = new Logger(QaGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
  ) {}

  /**
   * Makaleyi kontrol et, sonucu Article'a yaz ve raporu don.
   * siteId verilirse tenant izolasyonu uygulanir.
   */
  async check(articleId: string, siteId?: string): Promise<QaReport & { status: 'PASS' | 'WARN' | 'BLOCKED' }> {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, ...(siteId ? { siteId } : {}) },
    });
    if (!article) throw new NotFoundException('Makale bulunamadi');

    const body = article.bodyMd ?? '';

    // ── 1) Deterministik kontroller (qa-deterministic.ts) ────
    const { blockers, warnings } = deterministicQaIssues(article, body);

    // ── 2) LLM kontrolu (govde varsa) ────────────────────────
    let llmUsed = false;
    if (body.length > 400) {
      try {
        const llmIssues = await this.checkWithLlm(article.siteId, body);
        blockers.push(...llmIssues.filter((i) => i.severity === 'blocker').map(this.toIssue));
        warnings.push(...llmIssues.filter((i) => i.severity !== 'blocker').map(this.toIssue));
        llmUsed = true;
      } catch (err: any) {
        // LLM kontrolu calismadiysa yayini KILITLEME — deterministik sonucla devam.
        // Ama durumu raporla ki kullanici "tam kontrol yapilamadi" bilsin.
        this.log.warn(`[${articleId}] QA LLM kontrolu basarisiz: ${err.message}`);
        warnings.push({
          type: 'qa_incomplete',
          detail: 'AI tabanli iddia kontrolu calistirilamadi — yalnizca teknik kontroller uygulandi.',
        });
      }
    }

    const status: 'PASS' | 'WARN' | 'BLOCKED' =
      blockers.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARN' : 'PASS';

    const report: QaReport = {
      blockers,
      warnings,
      stats: {
        wordCount: article.wordCount ?? body.split(/\s+/).filter(Boolean).length,
        // v1.1: hero yer tutucusu engel degil + image_alt_empty uyarisi
        checkedBy: 'qa-gate-v1.1',
        llmUsed,
      },
      checkedAt: new Date().toISOString(),
    };

    await this.prisma.article.update({
      where: { id: article.id },
      data: {
        qaStatus: status as any,
        qaReport: report as any,
        qaCheckedAt: new Date(),
      },
    });

    return { ...report, status };
  }

  /** Pipeline sonunda cagirilir — hata pipeline'i dusurmesin */
  async checkSafe(articleId: string): Promise<void> {
    try {
      await this.check(articleId);
    } catch (err: any) {
      this.log.warn(`[${articleId}] QA gate calistirilamadi: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────

  private async checkWithLlm(siteId: string, body: string): Promise<Array<{
    severity: 'blocker' | 'warning';
    type: string;
    detail: string;
    excerpt?: string;
  }>> {
    const systemPrompt = [
      'Sen bir yayin oncesi dogruluk denetcisisin. Sana verilen Turkce/Ingilizce makalede SADECE su uc sinifi ara:',
      '1. fabricated_attribution — belirli bir kisi/kurum/rapora atif var ama kaynak linki/adi dogrulanabilir degil ("Webtures\'a gore...", "Gartner raporunda..." gibi, link yok).',
      '2. unsourced_claim — spesifik sayisal iddia (yuzde, adet, fiyat araligi, "arastirmalara gore X%") kaynak gosterilmeden verilmis.',
      '3. fabricated_entity — var olmayan/uydurma gorunumlu calisma, arac, kurum adi.',
      '',
      'Genel bilgiler, yazarin kendi yorumu ve "genellikle/cogu zaman" gibi nitelenmis ifadeler SORUN DEGIL. Asiri hassas olma: yalnizca yayinda utandiracak net vakalari isaretle.',
      '',
      'YANIT FORMATI — yalnizca JSON dizi, baska hicbir sey yazma:',
      '[{"severity":"blocker|warning","type":"fabricated_attribution|unsourced_claim|fabricated_entity","detail":"tek cumle Turkce aciklama","excerpt":"makaleden ilgili kesit (max 150 karakter)"}]',
      'Sorun yoksa [] dondur. En fazla 8 madde. Kaynakli net atiflar (linkli) blocker DEGILDIR; belirsiz ama zararsiz olanlar warning.',
    ].join('\n');

    const res = await this.llm.chat({
      context: 'qa-gate',
      siteId,
      model: 'claude-sonnet-5',
      effort: 'low',
      maxTokens: 1500,
      systemPrompt,
      messages: [{ role: 'user', content: body.slice(0, 60_000) }],
    });

    const parsed = parseJsonFromLlm<any>(res.output);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && typeof i.detail === 'string')
      .slice(0, 8)
      .map((i) => ({
        severity: i.severity === 'blocker' ? 'blocker' as const : 'warning' as const,
        type: String(i.type ?? 'unsourced_claim'),
        detail: String(i.detail).slice(0, 300),
        excerpt: typeof i.excerpt === 'string' ? i.excerpt.slice(0, 200) : undefined,
      }));
  }

  private toIssue = (i: { type: string; detail: string; excerpt?: string }): QaIssue => ({
    type: i.type,
    detail: i.detail,
    excerpt: i.excerpt,
  });
}
