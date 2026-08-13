import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { SchemaClassifierService } from './schema-classifier.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SiteUrlInventoryService } from '../sites/site-url-inventory.service.js';
import { LinkValidatorService } from './link-validator.service.js';
import { QaGateService } from './qa-gate.service.js';
import {
  AGENT_01_KEYWORD,
  AGENT_02_OUTLINE,
  AGENT_03_WRITER,
  AGENT_04_EDITOR,
  AGENT_05_VISUALS,
  checkGeoGate,
  extractFAQs,
  parseFrontmatter,
  turkishSlug,
} from '@luviai/shared';
import type { AgentContext, ExtractedFaq, GeoGateResult } from '@luviai/shared';
import { safeParseJson } from '../common/safe-json.js';
// Tek kaynak: canonical (publisher.service.ts) ile JSON-LD (burası) aynı URL'i üretsin.
import { resolveArticleUrl as buildArticleUrl } from './article-url.util.js';

export interface PipelineResult {
  articleId: string;
  slug: string;
  title: string;
  bodyMd: string;
  editorScore: number | null;
  editorVerdict: 'PASS' | 'REVIZE' | 'FAIL';
  totalCostUsd: number;
  durationMs: number;
  agentOutputs: Record<string, any>;
}

/**
 * 6-ajan zinciri orkestratörü.
 * LuviHost'taki generate-article.js'in NestJS service versiyonu.
 *
 * Akış:
 *   01-keyword → 02-outline → 03-writer → 04-editor (PASS kapısı, max 1 revize)
 *   → 05-visuals (skip varsa atlanır)
 *   → DB'ye Article kaydı
 */
@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunnerService,
    private readonly email: EmailService,
    private readonly schemaClassifier: SchemaClassifierService,
    private readonly settings: SettingsService,
    private readonly urlInventory: SiteUrlInventoryService,
    private readonly linkValidator: LinkValidatorService,
    private readonly qaGate: QaGateService,
  ) {}

  /**
   * Mock pipeline — AI_GLOBAL_DISABLED=1 iken gerçek API yerine simulasyon çalışır.
   * Article DB'de doldurulup status READY_TO_PUBLISH yapılır. UI akışını test etmek için.
   */
  private async runMockPipeline(opts: {
    siteId: string;
    topic: string;
    articleId?: string;
  }): Promise<PipelineResult> {
    this.log.warn(`[${opts.siteId}] MOCK pipeline (AI_GLOBAL_DISABLED=1) — topic: "${opts.topic}"`);

    // Realistik UX için kısa bir bekleme (kullanıcı "üretiliyor" UI'ında pipeline akışını görür)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (opts.articleId) {
      await this.prisma.article.update({ where: { id: opts.articleId }, data: { status: 'GENERATING' as any } });
    }
    await sleep(8000);
    if (opts.articleId) {
      await this.prisma.article.update({ where: { id: opts.articleId }, data: { status: 'EDITING' as any } });
    }
    await sleep(6000);

    const slug = opts.topic
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    const bodyMd = [
      `# ${opts.topic}`,
      '',
      `> **MOCK ARTICLE — AI_GLOBAL_DISABLED=1 iken üretilen dummy içerik.** Gerçek pipeline çalıştırmak için admin panelden flag'i kapat.`,
      '',
      '## Giriş',
      '',
      `Bu makale "${opts.topic}" konusunda dummy bir test içeriğidir. Gerçek üretim için Anthropic, OpenAI ve Gemini API kredilerinizin aktif olması gerekir. Şu an admin panelde \`AI_GLOBAL_DISABLED=1\` ayarı aktif olduğu için gerçek AI çağrıları yapılmadı.`,
      '',
      'Aşağıdaki içerik tamamen şablon — UI akışını ve yayın hedefine yükleme mantığını test etmek için kullanılır.',
      '',
      '## Hızlı Cevap',
      '',
      `${opts.topic} hakkında kısa özet: bu konu hakkında detaylı bilgi gerçek pipeline çalıştırıldığında 1800-2500 kelimelik kapsamlı bir rehberle sağlanır. Şu an gördüğünüz mock veri sadece test amaçlıdır.`,
      '',
      '## Ne, Neden, Nasıl?',
      '',
      `### Ne?\n\nMock pipeline, gerçek AI çağrılarını atlatıp şablon içerik üreten bir test moduydur. Bu modda Anthropic Claude, OpenAI veya Google Gemini API'lerine hiç istek gitmez.\n\n### Neden?\n\nGeliştirme/test aşamasında UI akışını, schema markup'ı, sosyal medya entegrasyonunu ve yayın hedefini gerçek para harcamadan test edebilmek için.\n\n### Nasıl?\n\nAdmin panelden \`AI_GLOBAL_DISABLED\` toggle'ını **AÇIK** yaparsın → tüm paid AI servisleri otomatik mock moda düşer.`,
      '',
      '## Sıkça Sorulan Sorular',
      '',
      `### Mock makale yayınlanır mı?\n\nEvet, gerçek pipeline'la aynı yolları izler — yayın hedefine yüklenir, sosyal medya draft'ı oluşturulur, schema markup eklenir.\n\n### Gerçek içerik nasıl üretirim?\n\nAdmin panel → \`AI_GLOBAL_DISABLED\` toggle'ını **KAPALI** yap. Sonraki "Şimdi üret" çağrısı gerçek pipeline'ı tetikler.\n\n### Mock makaleler kalıcı mı?\n\nDB'de durur, kullanıcı isterse silebilir. Gerçek üretime geçtiğinde topluca silmek için admin panel batch tools eklenebilir.`,
      '',
      '## Sonuç',
      '',
      `Bu mock makale şu konuyu işliyor: **${opts.topic}**. Gerçek üretim için yukarıdaki talimatları takip et. Test amaçlı oluşturuldu, yayın için uygun değil.`,
    ].join('\n');

    const wordCount = bodyMd.split(/\s+/).filter(Boolean).length;
    const faqs = [
      { q: 'Mock makale yayınlanır mı?', a: 'Evet, pipeline yollarını izler.' },
      { q: 'Gerçek içerik nasıl üretirim?', a: 'AI_GLOBAL_DISABLED toggle\'ını KAPALI yap.' },
      { q: 'Mock makaleler kalıcı mı?', a: 'DB\'de durur, manuel silinebilir.' },
    ];
    const heroPrompt = `Mock hero image for "${opts.topic}"`;

    const baseData: any = {
      slug,
      title: opts.topic,
      metaTitle: `${opts.topic} — Mock Test`,
      metaDescription: `${opts.topic} hakkında dummy test makalesi. AI_GLOBAL_DISABLED aktif.`,
      bodyMd,
      bodyHtml: `<article><h1>${opts.topic}</h1>${bodyMd.split('\n').filter(Boolean).map((p) => p.startsWith('#') ? '' : `<p>${p}</p>`).join('')}</article>`,
      wordCount,
      faqs,
      schemaMarkup: [
        { '@context': 'https://schema.org', '@type': 'Article', headline: opts.topic, datePublished: new Date().toISOString() },
      ],
      agentOutputs: { mock: true, generatedAt: new Date().toISOString(), heroPrompt },
      status: 'READY_TO_PUBLISH' as any,
    };

    let articleId: string;
    if (opts.articleId) {
      const updated = await this.prisma.article.update({ where: { id: opts.articleId }, data: baseData });
      articleId = updated.id;
    } else {
      const created = await this.prisma.article.create({
        data: { ...baseData, siteId: opts.siteId, topic: opts.topic, language: 'tr' },
      });
      articleId = created.id;
    }

    return {
      articleId,
      slug,
      title: opts.topic,
      bodyMd,
      bodyHtml: baseData.bodyHtml,
      faqs,
      heroPrompt,
      schemaMarkup: baseData.schemaMarkup,
      durationMs: Date.now() - 14000, // sleeps included
      totalCostUsd: 0,
      editorVerdict: 'PASS', // mock olsa da autoPublish path'i tetiklensin
      mock: true,
    } as any;
  }

  async runPipeline(opts: {
    siteId: string;
    topic: string;
    skipImages?: boolean;
    maxRevize?: number;
    articleId?: string;
  }): Promise<PipelineResult> {
    // AI_GLOBAL_DISABLED=1 → mock pipeline (dummy article üret, gerçek API çağrısı yapma)
    if (await this.settings.getBoolean('AI_GLOBAL_DISABLED')) {
      return this.runMockPipeline({ siteId: opts.siteId, topic: opts.topic, articleId: opts.articleId });
    }

    const t0 = Date.now();

    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: opts.siteId },
      include: { brain: true },
    });

    if (!site.brain) {
      throw new Error(`Site ${opts.siteId}: brain henüz oluşturulmamış. Önce BRAIN_GENERATE çalıştırın.`);
    }

    // Gerçek sayfa envanteri — iç link beyaz listesi. Ajanlar bunun dışında
    // URL üretemez; envanter boşsa iç link tamamen yasaklanır.
    const sitePages = await this.urlInventory.getInventory(opts.siteId).catch((err) => {
      this.log.warn(`[${opts.siteId}] URL envanteri alınamadı: ${err.message}`);
      return [] as Awaited<ReturnType<SiteUrlInventoryService['getInventory']>>;
    });
    this.log.log(`[${opts.siteId}] İç link beyaz listesi: ${sitePages.length} sayfa`);

    const brainContext: AgentContext = {
      brain: {
        brandVoice: site.brain.brandVoice as any,
        personas: site.brain.personas as any,
        competitors: site.brain.competitors as any,
        seoStrategy: site.brain.seoStrategy as any,
        glossary: site.brain.glossary as any,
      },
      siteUrl: site.url,
      siteName: site.name,
      // 'web' LuviHost kalıntısı bir varsayılandı: niş boş kalınca finans sitesine
      // "web" nişi enjekte ediyordu. Nötr bir değer, yanlış nişten iyidir.
      niche: (site.niche ?? '').trim() || 'genel',
      language: (site.language as any) ?? 'tr',
      whmcsCart: undefined,
      today: new Date().toISOString().slice(0, 10),
      sitePages: sitePages.map((p) => ({ url: p.url, title: p.title })),
    };

    const dateNote = `\n\n[ZORUNLU: Bugünün tarihi ${brainContext.today}. Frontmatter'da date_published bu olacak. Geçmiş yıl YASAK. Kod-fence sarmalama yok.]`;

    const agentOutputs: Record<string, any> = {};
    let totalCost = 0;

    // 01 — Anahtar Kelime
    this.log.log(`[${opts.siteId}] [1/6] Anahtar kelime: "${opts.topic}"`);
    const keyword = await this.runner.run({
      agentName: '01-keyword',
      agentSystemSuffix: AGENT_01_KEYWORD.systemSuffix,
      brainContext,
      input: `Konu: ${opts.topic}`,
    });
    agentOutputs.keyword = { output: keyword.output, usage: keyword.usage };
    totalCost += keyword.costUsd;

    // 02 — Taslak
    this.log.log(`[${opts.siteId}] [2/6] Taslak`);
    const outline = await this.runner.run({
      agentName: '02-outline',
      agentSystemSuffix: AGENT_02_OUTLINE.systemSuffix,
      brainContext,
      input: keyword.output,
    });
    agentOutputs.outline = { output: outline.output, usage: outline.usage };
    totalCost += outline.costUsd;

    // 03 — Yazar
    this.log.log(`[${opts.siteId}] [3/6] Yazar`);
    const writer = await this.runner.run({
      agentName: '03-writer',
      agentSystemSuffix: AGENT_03_WRITER.systemSuffix,
      brainContext,
      input: outline.output + dateNote,
    });
    agentOutputs.writer = { output: writer.output, usage: writer.usage };
    totalCost += writer.costUsd;

    // 04 — Editör + deterministik GEO kapısı
    //
    // Prompt'lardaki GEO kuralları doğruydu ama hiç ölçülmüyordu; editör
    // tamamen biçimsel bir LLM yargısıydı. Artık her turda metin regex ile
    // ölçülüyor (tablo, "Kısa cevap", soru H2 oranı, görünür son güncelleme,
    // kaynaksız sayı) ve kapı geçilmeden PASS kabul edilmiyor.
    let currentDraft = writer.output;
    // Başlangıç değeri FAIL değil REVIZE: hiç değerlendirme yapılmamış bir
    // taslağa "baştan yaz" hükmü vermek için elimizde kanıt yok.
    let editorVerdict: 'PASS' | 'REVIZE' | 'FAIL' = 'REVIZE';
    let editorScore: number | null = null;
    // 1 → 2: deterministik kapı bulgularının kapatılabilmesi için ek bir tur.
    const maxRevize = opts.maxRevize ?? 2;
    const MAX_PARSE_RETRIES = 1;
    let parseRetries = 0;

    let geoGate: GeoGateResult = checkGeoGate(this.cleanCodeFences(currentDraft));
    this.log.log(
      `[${opts.siteId}] GEO kapısı (yazar çıktısı): ${geoGate.pass ? 'GEÇTİ' : 'KALDI'} — ` +
        `soru H2 %${Math.round(geoGate.stats.questionRatio * 100)}, tablo ${geoGate.stats.tables}, ` +
        `kısa cevap ${geoGate.stats.shortAnswerCovered}/${geoGate.stats.contentH2}, ` +
        `kaynaksız sayı ${geoGate.stats.unsourcedNumericClaims}`,
    );

    for (let attempt = 0; attempt <= maxRevize; attempt++) {
      this.log.log(`[${opts.siteId}] [4/6] Editör${attempt > 0 ? ` (revize ${attempt})` : ''}`);
      const editor = await this.runner.run({
        agentName: '04-editor',
        agentSystemSuffix: AGENT_04_EDITOR.systemSuffix,
        brainContext,
        // Kapı bulguları editöre madde madde gider — "kaliteyi artır" gibi
        // muğlak bir istek değil, kapatılacak somut liste.
        input: currentDraft + dateNote + (geoGate.pass ? '' : geoGate.feedback),
      });
      agentOutputs[`editor_attempt_${attempt}`] = { output: editor.output, usage: editor.usage };
      totalCost += editor.costUsd;

      const verdict = this.extractEditorVerdict(editor.output);

      // Ayrıştırılamayan çıktı bir kalite hükmü DEĞİL. Eskiden sessizce 'FAIL'
      // dönüyordu; artık ayrı bir durum ve editör bir kez daha denenir.
      if (verdict.verdict === 'PARSE_ERROR') {
        agentOutputs[`editor_attempt_${attempt}`].parseError = verdict.parseError;
        this.log.warn(`[${opts.siteId}]   → PARSE_ERROR: ${verdict.parseError}`);
        if (parseRetries < MAX_PARSE_RETRIES) {
          // Kanıtı kaybetme: bozuk çıktıyı ayrı anahtara taşı, turu tekrarla.
          agentOutputs[`editor_attempt_${attempt}_parse_error_${parseRetries}`] =
            agentOutputs[`editor_attempt_${attempt}`];
          delete agentOutputs[`editor_attempt_${attempt}`];
          parseRetries++;
          attempt--; // revizyon bütçesini yeme, aynı turu tekrarla
          continue;
        }
        editorVerdict = 'REVIZE';
        editorScore = null;
        break;
      }

      editorScore = verdict.score;
      if (verdict.article && verdict.article.length > 1000 && !this.hasPlaceholder(verdict.article)) {
        currentDraft = verdict.article;
      }

      // Kapı, editörün düzeltilmiş metni üzerinde yeniden ölçülür.
      geoGate = checkGeoGate(this.cleanCodeFences(currentDraft));

      let effective = verdict.verdict;
      if (effective === 'PASS' && !geoGate.pass) {
        effective = 'REVIZE';
        this.log.warn(
          `[${opts.siteId}]   → GEO kapısı PASS'i bloke etti: ${geoGate.issues.map((i) => i.code).join(', ')}`,
        );
      }
      editorVerdict = effective;

      this.log.log(
        `[${opts.siteId}]   → ${verdict.verdict}${effective !== verdict.verdict ? ` ⇒ ${effective}` : ''} ` +
          `(${verdict.score ?? '?'}/${verdict.maxScore}` +
          `${verdict.blockingIssues.length > 0 ? `, ${verdict.blockingIssues.length} engelleyici bulgu` : ''})`,
      );

      if (effective === 'PASS' || effective === 'FAIL') break;
      if (attempt >= maxRevize) break;
    }

    agentOutputs.geoGate = {
      pass: geoGate.pass,
      stats: geoGate.stats,
      issues: geoGate.issues.map((i) => ({ code: i.code, samples: i.samples ?? [] })),
    };

    // 05 — Görselleştirici
    if (!opts.skipImages && editorVerdict === 'PASS') {
      this.log.log(`[${opts.siteId}] [5/6] Görselleştirici`);
      const visuals = await this.runner.run({
        agentName: '05-visuals',
        agentSystemSuffix: AGENT_05_VISUALS.systemSuffix,
        brainContext,
        input: currentDraft,
        maxTokens: 4096,
      });
      agentOutputs.visuals = { output: visuals.output, usage: visuals.usage };
      totalCost += visuals.costUsd;
    } else {
      this.log.log(`[${opts.siteId}] [5/6] Görseller atlandı`);
    }

    // Frontmatter parse + DB
    let cleaned = this.cleanCodeFences(currentDraft);

    // ── Link doğrulama (deterministik güvenlik ağı) ───────────
    // Prompt kuralı tek başına yeterli değil: model yine de URL uydurabiliyor.
    // Burada her link gerçek envantere karşı kontrol edilir; eşleşmeyen linkler
    // ya en yakın gerçek sayfaya remap edilir ya da düz metne çevrilir.
    try {
      const validated = await this.linkValidator.validateArticleMarkdown(opts.siteId, cleaned, {
        checkExternal: true,
      });
      cleaned = validated.bodyMd;
      agentOutputs.linkValidation = validated.report;
      if (validated.report.remapped || validated.report.unlinked) {
        this.log.warn(
          `[${opts.siteId}] Kırık link temizlendi: ${validated.report.remapped} remap, ${validated.report.unlinked} kaldırıldı`,
        );
      }
    } catch (err: any) {
      this.log.warn(`[${opts.siteId}] Link doğrulama atlandı: ${err.message}`);
    }

    const { data: fm, content: body } = parseFrontmatter(cleaned);

    // frontmatter.internal_links de aynı envantere göre süzülür — makale
    // gövdesi temizlenip metadata kirli kalmasın.
    const cleanInternalLinks = await this.filterInternalLinks(opts.siteId, fm.internal_links as any);

    // LLM'in yazdığı slug da normalizasyondan GEÇER. Önceden fm.slug olduğu gibi
    // kabul ediliyordu; model "kârlılık" yazınca aksanlı harfler düşüp
    // "...-krlilik-2026" gibi anahtar kelimesi kaybolmuş URL'ler sitemap'e giriyordu.
    // turkishSlug'daki TR_MAP zaten â→a eşlemesini içeriyor; sorun eşlemenin
    // atlanmasıydı.
    const slug = this.normalizeSlug((fm.slug as string) || (fm.title as string) || opts.topic);
    const wordCount = body.split(/\s+/).length;

    // ── SSS teli ────────────────────────────────────────────────
    // extractFAQs bugüne kadar hiçbir yerden çağrılmıyordu; model frontmatter'a
    // faqs yazmadığında FAQPage şeması hiç üretilmiyordu. Artık frontmatter
    // birincil kaynak, görünür SSS bölümü fallback. İkisi de görünür metne
    // dayandığı için şema-içerik uyumsuzluğu üretmez.
    const faqs = this.resolveFaqs(fm.faqs, body);

    // ── Schema Classifier — 15+ schema tipini otomatik karara bagla ──
    let schemaMarkup: any = null;
    if (editorVerdict === 'PASS') {
      try {
        const classification = await this.schemaClassifier.classify(cleaned, {
          hasFaqs: faqs.length > 0,
          persona: fm.persona as string,
          pillar: fm.pillar as string,
        });
        const siteRaw = await this.prisma.site.findUniqueOrThrow({
          where: { id: opts.siteId },
        });
        const siteAny: any = siteRaw;
        const siteName: string = String(siteAny.name ?? 'Site');
        const siteUrl: string = String(siteAny.url ?? '');
        const baseUrl = siteUrl.replace(/\/+$/, '');
        // Sabit `/blog/<slug>.html` yanlıştı: bu yol hiçbir hedefte yok.
        // (kobipratik'te rehberler /pratik-kobi-rehberi/<slug>, uzantısız.)
        // Artık gerçek publish hedefinin path kuralından türetiliyor.
        const { url: articleUrl, sectionPath } = await this.resolveArticleUrl(
          opts.siteId,
          baseUrl,
          slug,
        );
        const sameAs = Array.isArray(siteAny.socialProfiles)
          ? (siteAny.socialProfiles as string[])
          : [];

        const jsonLd = this.schemaClassifier.buildJsonLd({
          types: classification.primary,
          article: {
            title: (fm.title as string) ?? opts.topic,
            url: articleUrl,
            slug,
            metaDescription: (fm.meta_description as string) ?? null,
            datePublished: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            heroImage: ((fm as any).hero_image as string) ?? null,
            faqs,
            // author BİLEREK verilmiyor: fm.persona okuyucu profilidir (hedef
            // kitle), makalenin yazarı değil. Person olarak basmak schema.org
            // açısından yanlış beyandır; Organization fallback'i doğru olan.
            author: null,
            // Kırıntı yolu gerçek URL hiyerarşisinden gelir ve ara sayfa
            // yalnızca site envanterinde GERÇEKTEN varsa eklenir.
            breadcrumbs: this.buildBreadcrumbs({
              baseUrl,
              siteName,
              sectionPath,
              sitePages,
              title: (fm.title as string) ?? opts.topic,
              articleUrl,
            }),
          },
          site: {
            name: siteName,
            url: baseUrl,
            sameAs,
          },
        });

        schemaMarkup = { types: classification.primary, reasoning: classification.reasoning, jsonLd };
        agentOutputs.schema = { types: classification.primary, count: jsonLd.length, reasoning: classification.reasoning };
        this.log.log(`[${opts.siteId}] Schema: ${classification.primary.length} tip (${classification.primary.join(', ')})`);
      } catch (err: any) {
        this.log.warn(`[${opts.siteId}] Schema classifier fail: ${err.message}`);
      }
    }

    const articleData = {
      siteId: opts.siteId,
      topic: opts.topic,
      slug,
      title: (fm.title as string) ?? opts.topic,
      metaTitle: (fm.meta_title as string) ?? null,
      metaDescription: (fm.meta_description as string) ?? null,
      // 'Hosting' LuviHost kalıntısı sabitti — finans sitesinde üretilen her
      // makale bu kategoriye düşüyordu. Yanlış kategori yerine sitenin kendi
      // nişi; o da yoksa null (yanlış etiket, etiketsizlikten kötüdür).
      category: (fm.category as string) ?? ((site.niche ?? '').trim() || null),
      language: brainContext.language === 'both' ? 'tr' : brainContext.language,
      persona: (fm.persona as string) ?? null,
      pillar: (fm.pillar as string) ?? null,
      bodyMd: cleaned,
      frontmatter: fm as any,
      agentOutputs: agentOutputs as any,
      schemaMarkup: schemaMarkup as any,
      faqs: faqs.length > 0 ? (faqs as any) : null,
      wordCount,
      readingTime: Math.max(1, Math.round(wordCount / 200)),
      editorScore,
      editorVerdict: editorVerdict as any,
      totalCost: totalCost,
      status: editorVerdict === 'PASS' ? 'READY_TO_PUBLISH' : 'REVIZE_NEEDED',
      internalLinks: cleanInternalLinks,
    } as const;

    // Eger queueGeneration() placeholder Article olusturmussa onu guncelle,
    // yoksa yeni kayit olustur (geriye uyumluluk).
    const article = opts.articleId
      ? await this.prisma.article.update({
          where: { id: opts.articleId },
          data: articleData,
        })
      : await this.prisma.article.create({
          data: articleData,
        });

    const durationMs = Date.now() - t0;
    this.log.log(`[${opts.siteId}] ✅ Pipeline tamamlandı: ${slug} (${editorVerdict}, $${totalCost.toFixed(4)}, ${(durationMs / 1000).toFixed(0)}s, ${wordCount} kelime)`);

    // QA Gate — yayin oncesi son kontrol (uydurma atif / kaynaksiz iddia /
    // placeholder). Fire-and-forget: pipeline suresini uzatmaz; publisher
    // qaStatus'u yoksa yayin aninda kendisi kosar.
    this.qaGate.checkSafe(article.id);

    // Site sahibine "makale hazir" maili (PASS olduysa).
    // Mail gonderimi pipeline'i blok etmez — fail olsa da makale kaydi tamam.
    if (editorVerdict === 'PASS') {
      this.notifyArticleReady(opts.siteId, article.id).catch((err) => {
        this.log.warn(`[${opts.siteId}] Mail gonderilemedi: ${err.message}`);
      });
    }

    return {
      articleId: article.id,
      slug,
      title: article.title,
      bodyMd: cleaned,
      editorScore,
      editorVerdict,
      totalCostUsd: totalCost,
      durationMs,
      agentOutputs,
    };
  }

  /**
   * Makale PASS aldiginda site sahibine mail gonder.
   * Kullanicinin daha onceki PUBLISHED makalesi yoksa "first_article_published",
   * varsa daha basit bir bilgilendirme.
   */
  private async notifyArticleReady(siteId: string, articleId: string): Promise<void> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { user: { select: { email: true, name: true, id: true } } },
    });
    if (!site?.user?.email) return;

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) return;

    const publicUrl = `${process.env.WEB_BASE_URL ?? 'https://ranksup.ai'}/sites/${siteId}/articles/${articleId}`;

    // Daha onceki ready/published makale var mi?
    const earlierCount = await this.prisma.article.count({
      where: {
        siteId,
        id: { not: articleId },
        status: { in: ['READY_TO_PUBLISH', 'PUBLISHED'] as any },
      },
    });

    const template = earlierCount === 0 ? 'first_article_published' : 'article_ready';
    await this.email.send({
      userId: site.user.id,
      to: site.user.email,
      template,
      data: {
        name: site.user.name ?? 'kullanici',
        title: article.title,
        publicUrl,
        wordCount: article.wordCount,
        faqs: ((article.frontmatter as any)?.faqs as any[])?.length ?? 0,
        editorScore: article.editorScore,
        articlesPublished: earlierCount + 1,
      },
    });
    this.log.log(`[${siteId}] Mail gonderildi: ${site.user.email} (${template})`);
  }

  /** Editör skor tavanı — 04-editor prompt'undaki 9 kategori × 10 puan. */
  private static readonly EDITOR_MAX_SCORE = 90;

  /**
   * Editör çıktısını yapılandırılmış olarak okur.
   *
   * Eskiden serbest markdown regex'lenip, tutmazsa sessizce 'FAIL' dönülüyordu;
   * üstelik yedek yakalayıcı genel `\b(\d+)/60\b` olduğu için metindeki rastgele
   * bir sayı PASS üretebiliyordu. Artık sözleşme tek bir JSON bloğu:
   * ayrıştırılamayan çıktı bir kalite hükmü değil, 'PARSE_ERROR' — çağıran
   * tarafta yeniden denenir.
   */
  private extractEditorVerdict(output: string): {
    verdict: 'PASS' | 'REVIZE' | 'FAIL' | 'PARSE_ERROR';
    score: number | null;
    maxScore: number;
    blockingIssues: string[];
    article: string | null;
    parseError?: string;
  } {
    const maxScore = PipelineService.EDITOR_MAX_SCORE;
    const empty = { score: null, maxScore, blockingIssues: [] as string[], article: null };

    const raw = this.extractJsonBlock(output);
    if (!raw) {
      return { verdict: 'PARSE_ERROR', ...empty, parseError: 'json bloğu bulunamadı' };
    }

    let parsed: any;
    try {
      parsed = safeParseJson(raw);
    } catch (err: any) {
      return { verdict: 'PARSE_ERROR', ...empty, parseError: `json parse: ${err.message}` };
    }

    const rawVerdict = String(parsed?.verdict ?? '').toUpperCase();
    if (!['PASS', 'REVIZE', 'FAIL'].includes(rawVerdict)) {
      return { verdict: 'PARSE_ERROR', ...empty, parseError: `geçersiz verdict: "${parsed?.verdict}"` };
    }
    let verdict = rawVerdict as 'PASS' | 'REVIZE' | 'FAIL';

    // Skor: önce beyan edilen total, tutarsızsa kategori toplamı.
    const scores = parsed?.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
    const summed = Object.values(scores)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    const declared = typeof parsed?.total === 'number' ? parsed.total : null;
    let score: number | null =
      declared !== null && declared >= 0 && declared <= maxScore ? declared : summed > 0 ? summed : null;
    if (score !== null) score = Math.max(0, Math.min(maxScore, Math.round(score)));

    const blockingIssues = Array.isArray(parsed?.blocking_issues)
      ? parsed.blocking_issues.map((b: any) => String(b)).filter(Boolean)
      : [];

    // Skor yüksekse REVIZE'yi PASS'e çeviren eski davranış korunuyor, ancak
    // artık yalnızca engelleyici bulgu YOKKEN. Kaynaksız sayı gibi bir ihlal
    // "puanı yüksek" diye affedilemez (YMYL).
    if (verdict === 'REVIZE' && score !== null && score / maxScore >= 0.8 && blockingIssues.length === 0) {
      verdict = 'PASS';
    }
    if (verdict === 'PASS' && blockingIssues.length > 0) {
      verdict = 'REVIZE';
    }

    let articleMatch = output.match(/##\s*Düzeltilmiş tam makale\s*\n+```(?:markdown)?\s*\n([\s\S]+?)```\s*$/i);
    if (!articleMatch) articleMatch = output.match(/##\s*Düzeltilmiş tam makale\s*\n([\s\S]+?)$/i);

    return {
      verdict,
      score,
      maxScore,
      blockingIssues,
      article: articleMatch ? articleMatch[1].trim() : null,
    };
  }

  /**
   * Editör raporundaki karar JSON'unu bulur.
   * Önce ```json fence'leri, olmazsa "verdict" içeren ilk süslü blok.
   */
  private extractJsonBlock(output: string): string | null {
    const fences = [...output.matchAll(/```json\s*\n([\s\S]*?)```/gi)];
    for (const f of fences) {
      if (/"verdict"/i.test(f[1])) return f[1].trim();
    }
    if (fences.length > 0) return fences[0][1].trim();

    const braceMatch = output.match(/\{[^{}]*"verdict"[\s\S]*?\n\}/);
    return braceMatch ? braceMatch[0] : null;
  }

  /**
   * Slug'ı Türkçe-güvenli kebab-case'e indirger ve 60 karakterle sınırlar.
   * Kesme sonrası yarım kalan kelime parçası ve kuyruk tiresi temizlenir.
   */
  private normalizeSlug(input: string): string {
    const full = turkishSlug(String(input ?? ''));
    if (full.length <= 60) return full;
    const cut = full.slice(0, 60);
    const lastDash = cut.lastIndexOf('-');
    return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
  }

  /**
   * SSS listesini çözer: frontmatter birincil, görünür SSS bölümü fallback.
   * Her iki yol da { q, a } döndürür (Article.faqs ve FAQPage şeması bu şekli bekler).
   * Cevabı boş olan soru elenir — görünür karşılığı olmayan Question basmayız.
   */
  private resolveFaqs(fmFaqs: unknown, body: string): ExtractedFaq[] {
    const fromFm = Array.isArray(fmFaqs)
      ? (fmFaqs as any[])
          .map((f) => ({
            q: String(f?.q ?? f?.question ?? '').trim(),
            a: String(f?.a ?? f?.answer ?? '').trim(),
          }))
          .filter((f) => f.q && f.a)
      : [];
    if (fromFm.length > 0) return fromFm;
    return extractFAQs(body);
  }

  /**
   * Makalenin yayınlanacağı GERÇEK public URL'i, sitenin publish hedefinin
   * path kuralından türetir.
   *
   * Sabit `/blog/<slug>.html` varsayımı yanlıştı: `.html` yalnızca FTP/SFTP/cPanel
   * hedeflerinde geçerli, `/blog` ise pek çok sitede hiç yok. Yanlış URL hem
   * Article.url hem BreadcrumbList'e sızıp şemayı 404'e bağlıyordu.
   *
   * baseUrl olarak site.url kullanılır (hedefin credentials'ı şifreli ve
   * yayın domaini ile aynı olmayabilir); path ise hedefin config'inden gelir.
   *
   * Hesaplama article-url.util.ts'e taşındı: publisher.service.ts canonical'ı
   * ayrı bir kopyayla üretiyordu ve burası düzeltilince ikisi çelişti
   * (şema /pratik-kobi-rehberi/x, canonical /blog/x). Tek kaynak zorunlu.
   */
  private async resolveArticleUrl(
    siteId: string,
    baseUrl: string,
    slug: string,
  ): Promise<{ url: string; sectionPath: string | null }> {
    let target: { type?: string | null; config?: unknown } | null = null;
    try {
      const targets = await this.prisma.publishTarget.findMany({
        where: { siteId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        take: 1,
      });
      target = targets[0] ?? null;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Publish hedefi okunamadı, URL varsayılana düştü: ${err.message}`);
    }

    return buildArticleUrl(baseUrl, slug, target);
  }

  /**
   * BreadcrumbList öğelerini üretir.
   * Ara kırıntı (bölüm sayfası) yalnızca site envanterinde GERÇEKTEN varsa
   * eklenir — var olmayan bir bölüm sayfası ilan etmek 404 kırıntı demektir.
   */
  private buildBreadcrumbs(args: {
    baseUrl: string;
    siteName: string;
    sectionPath: string | null;
    sitePages: Array<{ url: string; path: string; title: string }>;
    title: string;
    articleUrl: string;
  }): Array<{ name: string; url: string }> {
    const crumbs = [{ name: 'Anasayfa', url: args.baseUrl }];
    if (args.sectionPath) {
      const hit = args.sitePages.find((p) => p.path === args.sectionPath);
      if (hit) {
        crumbs.push({ name: hit.title || this.humanizePath(args.sectionPath), url: hit.url });
      }
    }
    crumbs.push({ name: args.title, url: args.articleUrl });
    return crumbs;
  }

  private humanizePath(path: string): string {
    return path
      .replace(/^\/+|\/+$/g, '')
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))
      .join(' ');
  }

  /**
   * frontmatter.internal_links listesini gerçek sayfa envanterine göre süzer.
   * Sitede karşılığı olmayan girdiler atılır — bu liste UI'da ve iç link
   * raporlarında kullanıldığı için kirli kalmamalı.
   */
  private async filterInternalLinks(siteId: string, raw: any): Promise<any> {
    if (!Array.isArray(raw) || raw.length === 0) return raw ?? null;
    try {
      const site = await this.prisma.site.findUnique({ where: { id: siteId } });
      if (!site) return raw;
      const pages = await this.urlInventory.getInventory(siteId);
      if (pages.length === 0) return raw; // envanter yoksa hüküm verme

      const known = new Set(pages.map((p) => p.path));
      const kept = raw.filter((item: any) => {
        const url = String(item?.url ?? '');
        if (!url) return false;
        if (!this.urlInventory.isInternal(url, site.url)) return true; // harici — dokunma
        const path = this.urlInventory.normalizePath(url, site.url);
        return !!path && (path === '/' || known.has(path));
      });

      if (kept.length !== raw.length) {
        this.log.warn(`[${siteId}] internal_links: ${raw.length - kept.length} geçersiz girdi elendi`);
      }
      return kept.length > 0 ? kept : null;
    } catch {
      return raw;
    }
  }

  private hasPlaceholder(text: string): boolean {
    return /\[YAZAR\s+(EKLEYECEK|TAMAMLAYACAK)/i.test(text);
  }

  private cleanCodeFences(raw: string): string {
    let txt = raw.trim();
    if (txt.startsWith('```markdown') || txt.startsWith('```')) {
      const lines = txt.split('\n');
      lines.shift();
      if (lines[lines.length - 1].trim() === '```') lines.pop();
      txt = lines.join('\n');
    }
    const lines = txt.split('\n');
    if (lines.length > 0 && !/^---\s*$/.test(lines[0])) {
      const limit = Math.min(lines.length, 25);
      for (let i = 1; i < limit; i++) {
        if (/^---\s*$/.test(lines[i])) {
          txt = lines.slice(i).join('\n');
          break;
        }
      }
    }
    return txt;
  }
}
