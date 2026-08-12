import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';

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

export interface QaIssue {
  type: string;      // fabricated_attribution | unsourced_claim | placeholder_image | template_leak | mock_content | empty_section
  detail: string;    // kullaniciya gosterilen aciklama
  excerpt?: string;  // makaledeki ilgili kesit
}

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
    const blockers: QaIssue[] = [];
    const warnings: QaIssue[] = [];

    // ── 1) Deterministik kontroller ──────────────────────────
    this.checkDeterministic(article, body, blockers, warnings);

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
        checkedBy: 'qa-gate-v1',
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

  private checkDeterministic(article: any, body: string, blockers: QaIssue[], warnings: QaIssue[]) {
    // Placeholder gorsel — hero veya govde ici
    if (article.heroImageUrl && /placeholder/i.test(article.heroImageUrl)) {
      blockers.push({
        type: 'placeholder_image',
        detail: 'Hero görseli hâlâ placeholder — yayında kırık/boş görsel görünür.',
        excerpt: article.heroImageUrl,
      });
    }
    const imgPlaceholders = body.match(/!\[[^\]]*\]\((?:[^)]*placeholder[^)]*|\s*)\)/gi) ?? [];
    if (imgPlaceholders.length > 0) {
      blockers.push({
        type: 'placeholder_image',
        detail: `${imgPlaceholders.length} görsel placeholder'ı doldurulmamış.`,
        excerpt: imgPlaceholders[0]?.slice(0, 200),
      });
    }

    // Sablon kalintisi
    const templateLeaks = body.match(/\{\{[^}]{1,60}\}\}|\[(?:GÖRSEL|GORSEL|IMAGE|TODO|PLACEHOLDER)[^\]]{0,60}\]/g) ?? [];
    if (templateLeaks.length > 0) {
      blockers.push({
        type: 'template_leak',
        detail: `Doldurulmamış şablon alanı: ${templateLeaks.slice(0, 3).join(', ')}`,
      });
    }

    // Mock icerik izi (AI_GLOBAL_DISABLED uretimleri yayina cikmasin)
    if (/MOCK ARTICLE|AI_GLOBAL_DISABLED/.test(body)) {
      blockers.push({
        type: 'mock_content',
        detail: 'Makale mock pipeline çıktısı — gerçek üretim değil, yayınlanamaz.',
      });
    }

    // Bos bolum: baslik + hemen ardindan baska baslik
    const emptySections = body.match(/^#{2,3}\s+[^\n]+\n+(?=#{2,3}\s)/gm) ?? [];
    if (emptySections.length > 0) {
      warnings.push({
        type: 'empty_section',
        detail: `${emptySections.length} başlık altında içerik yok.`,
        excerpt: emptySections[0]?.trim().slice(0, 120),
      });
    }

    // Cok kisa govde
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount > 0 && wordCount < 300) {
      warnings.push({
        type: 'thin_content',
        detail: `Makale yalnızca ${wordCount} kelime — ince içerik AI aramalarında alıntılanmaz.`,
      });
    }
  }

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
