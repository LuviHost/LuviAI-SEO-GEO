import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, mdToHtml, parseFrontmatter } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { ImageGeneratorService } from './image-generator.service.js';
import { SocialAutoDraftService } from '../social/social-auto-draft.service.js';
import { AiIndexingPingerService } from '../audit/ai-indexing-pinger.service.js';
import { LlmsFullBuilderService } from '../audit/llms-full-builder.service.js';
import { LinkValidatorService } from './link-validator.service.js';
import { SiteUrlInventoryService } from '../sites/site-url-inventory.service.js';
import { resolveArticleUrl } from './article-url.util.js';

/**
 * Markdown body'yi CMS gövdesine girecek HTML PARÇASI haline getirir.
 *
 * WordPress / Ghost / Shopify gibi hedefler içeriği kendi temasının içine
 * gömer. Onlara tam sayfa (<!DOCTYPE html> + <head> + <style>) göndermek
 * post gövdesine <style> bloğu, ikinci bir site navigasyonu ve ikinci bir
 * footer sızdırır; ayrıca <style> içindeki `body{...}` kuralı temanın kendi
 * tipografisini ezer. Bu yüzden CMS hedefleri sadece bu parçayı alır.
 *
 * Schema JSON-LD burada da yer alır: WordPress <script type="application/ld+json">
 * bloğunu post gövdesinde korur, böylece GEO/AEO sinyali kaybolmaz.
 */
function renderArticleFragment(opts: {
  bodyMd: string;
  heroImageUrl?: string | null;
  schemaJsonLd?: any[] | null;
  audioUrl?: string | null;
  trackerSiteId?: string | null;
}): string {
  const parsed = parseFrontmatter(opts.bodyMd ?? '');
  const md = (parsed.content || opts.bodyMd || '').trim();

  // Bastaki "# H1" satirini at: CMS zaten post basligini <h1> olarak basiyor.
  // Ikisi birden kalirsa sayfada iki H1 olur (SEO hatasi). Sadece EN BASTAKI
  // H1 dusurulur; govde icinde H1 kullanilmadigi icin gerisi korunur.
  const withoutH1 = md.replace(/^#\s+[^\n]*\n+/, '');

  const inner = mdToHtml(withoutH1);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const schemaTags = Array.isArray(opts.schemaJsonLd) && opts.schemaJsonLd.length > 0
    ? opts.schemaJsonLd.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')
    : '';

  const audioBlock = opts.audioUrl ? `
<audio controls preload="metadata" style="width:100%;margin:1rem 0">
  <source src="${esc(opts.audioUrl)}" type="audio/mpeg">
</audio>` : '';

  // AI crawler tracker — tam sayfa render'indaki davranisla ayni kalsin
  const trackerScript = opts.trackerSiteId
    ? `<script async src="${process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai'}/api/tracker.js?site=${esc(opts.trackerSiteId)}"></script>`
    : '';

  // Hero <img>: WordPress adapter featured image yüklerse bunu kendisi siler.
  const hero = opts.heroImageUrl ? `<img src="${esc(opts.heroImageUrl)}" alt="" class="hero">` : '';

  return [hero, audioBlock, inner, schemaTags, trackerScript].filter(Boolean).join('\n');
}

/**
 * Markdown body'yi tam bir HTML sayfasi haline getir.
 * - frontmatter strip (mdToHtml'e gelmesin)
 * - <html lang="tr"> + UTF-8 + viewport
 * - SEO meta (title, description, canonical, og)
 * - Inline minimal CSS — okunabilir, mobile-first
 *
 * SADECE dosya-tabanli hedefler icin (FTP/SFTP/cPanel/ZIP/GitHub Pages) —
 * bunlar diske gercek bir .html dosyasi yazar. CMS hedefleri
 * renderArticleFragment() kullanir.
 */
function renderArticleHtml(opts: {
  bodyMd: string;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  heroImageUrl?: string | null;
  siteName?: string | null;
  /** Makalenin bölüm yolu (ör. "/pratik-kobi-rehberi"). Yoksa nav linki basılmaz. */
  sectionPath?: string | null;
  schemaJsonLd?: any[] | null;
  audioUrl?: string | null;
  trackerSiteId?: string | null;
}): string {
  const parsed = parseFrontmatter(opts.bodyMd ?? '');
  const inner = mdToHtml((parsed.content || opts.bodyMd || '').trim());
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = esc(opts.metaTitle || opts.title || '');
  const desc = esc(opts.metaDescription || '');
  const canonical = esc(opts.canonical || '');
  const hero = opts.heroImageUrl ? `<img src="${esc(opts.heroImageUrl)}" alt="" class="hero">` : '';
  const brand = esc(opts.siteName || 'Blog');
  const year = new Date().getFullYear();

  // Sabit `/blog` nav linki kaldırıldı: pek çok sitede (kobipratik dahil) /blog
  // yolu YOK, yani yayınlanan HER sayfa 404'e giden bir iç link taşıyordu.
  // Bölüm yolu gerçekten biliniyorsa link basılır, bilinmiyorsa hiç basılmaz.
  const section = (opts.sectionPath || '').trim();
  const sectionLink = section
    ? `<a href="${esc(section)}">${esc(section.replace(/^\//, '').replace(/-/g, ' '))}</a>`
    : '';

  // GEO: Schema.org JSON-LD <script> tag'leri
  const schemaTags = Array.isArray(opts.schemaJsonLd) && opts.schemaJsonLd.length > 0
    ? opts.schemaJsonLd.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')
    : '';

  // GEO: Audio player + AudioObject schema
  const audioBlock = opts.audioUrl ? `
<audio controls preload="metadata" style="width:100%;margin:1rem 0">
  <source src="${esc(opts.audioUrl)}" type="audio/mpeg">
  Tarayıcınız HTML5 audio desteklemiyor.
</audio>` : '';

  // AI Crawler tracker
  const trackerScript = opts.trackerSiteId
    ? `<script async src="${process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai'}/api/tracker.js?site=${esc(opts.trackerSiteId)}"></script>`
    : '';
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${desc ? `<meta name="description" content="${desc}">` : ''}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:title" content="${title}">
${desc ? `<meta property="og:description" content="${desc}">` : ''}
<meta property="og:type" content="article">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}
${opts.heroImageUrl ? `<meta property="og:image" content="${esc(opts.heroImageUrl)}">` : ''}
${schemaTags}
${trackerScript}
<style>
:root{--ink:#0f172a;--muted:#475569;--brand:#6366f1;--brand-d:#4f46e5;--line:#e2e8f0;--bg:#fff;--soft:#f8fafc}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.7}
.wrap{max-width:740px;margin:0 auto;padding:0 1.25rem}
header.brand{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0;border-bottom:1px solid var(--line)}
header.brand a.logo{font-weight:700;color:var(--ink);text-decoration:none;font-size:1.1rem;letter-spacing:-.01em}
header.brand a{color:var(--muted);text-decoration:none}
main{padding:2rem 0 3rem}
main h1{font-size:2.1rem;line-height:1.2;margin:.5rem 0 1.5rem;letter-spacing:-.02em}
main h2{font-size:1.45rem;margin:2.5rem 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid var(--line);letter-spacing:-.01em}
main h3{font-size:1.15rem;margin:1.75rem 0 .5rem}
main p{margin:.75rem 0}
main a{color:var(--brand);text-decoration:none}
main a:hover{text-decoration:underline}
main blockquote{border-left:4px solid var(--brand);background:var(--soft);padding:.75rem 1.1rem;margin:1.25rem 0;border-radius:0 10px 10px 0;color:var(--muted)}
main blockquote p:first-child{margin-top:0}
main blockquote p:last-child{margin-bottom:0}
main ul,main ol{padding-left:1.5rem}
main li{margin:.35rem 0}
main table{width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:.95rem}
main th,main td{padding:.65rem .8rem;border:1px solid var(--line);text-align:left;vertical-align:top}
main th{background:var(--soft);font-weight:600}
main code{background:var(--soft);padding:.15rem .4rem;border-radius:4px;font-size:.92em;font-family:ui-monospace,Menlo,monospace}
main pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:10px;overflow-x:auto;font-size:.92em}
main pre code{background:none;padding:0;color:inherit}
main img{max-width:100%;height:auto;border-radius:12px;margin:1.5rem 0;display:block}
main img.hero{margin-top:0}
main hr{border:none;border-top:1px solid var(--line);margin:2rem 0}
.cta,a.cta{display:inline-block;background:var(--brand);color:#fff!important;padding:.85rem 1.5rem;border-radius:10px;font-weight:600;text-decoration:none;margin:1.25rem 0;transition:background .15s}
.cta:hover{background:var(--brand-d);text-decoration:none!important}
footer.site{margin-top:3rem;padding:1.5rem 0;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;text-align:center}
@media(max-width:560px){main h1{font-size:1.7rem}main h2{font-size:1.25rem}}
</style>
</head>
<body>
<div class="wrap">
<header class="brand"><a class="logo" href="/">${brand}</a>${sectionLink}</header>
<main>
${hero}
${audioBlock}
${inner}
</main>
<footer class="site">© ${brand} — ${year}</footer>
</div>
</body>
</html>`;
}

/** Markdown body'deki "Sıkça Sorulan Sorular" bölümünden FAQPage JSON-LD üretir (yoksa null). */
function buildFaqPageLd(bodyMd: string): any | null {
  const md = bodyMd ?? '';
  const i = md.search(/##\s*S[ıi]k[çc]a\s+Sorulan\s+Sorular/i);
  if (i < 0) return null;
  const after = md.slice(i);
  const nextH2 = after.slice(3).search(/\n##\s/);
  const sec = nextH2 >= 0 ? after.slice(0, nextH2 + 3) : after;
  const parts = sec.split(/\n###\s+/).slice(1);
  const clean = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*`_]/g, '').replace(/\s+/g, ' ').trim();
  const mainEntity = parts.map((p) => {
    const nl = p.indexOf('\n');
    const q = clean(nl >= 0 ? p.slice(0, nl) : p);
    const a = clean(nl >= 0 ? p.slice(nl + 1) : '');
    return { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } };
  }).filter((q) => q.name && q.acceptedAnswer.text.length > 10);
  if (mainEntity.length < 2) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity };
}

export interface PublishResult {
  targetId: string;
  targetType: string;
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  error?: string;
}

/**
 * Article publish — bir veya daha fazla publish target'a aynı makaleyi yayınla.
 * Adapter framework üzerinden çalışır (WordPress, FTP, SFTP, Markdown ZIP, ...)
 *
 * Worker'dan PUBLISH_ARTICLE job'unda çağrılır.
 */
@Injectable()
export class PublisherService {
  private readonly log = new Logger(PublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGen: ImageGeneratorService,
    private readonly socialAutoDraft: SocialAutoDraftService,
    private readonly indexingPinger: AiIndexingPingerService,
    private readonly llmsFullBuilder: LlmsFullBuilderService,
    private readonly linkValidator: LinkValidatorService,
    private readonly urlInventory: SiteUrlInventoryService,
  ) {}

  async publishArticle(articleId: string, targetIds: string[]): Promise<PublishResult[]> {
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: {
        site: {
          include: {
            publishTargets: {
              where: targetIds.length > 0 ? { id: { in: targetIds } } : { isDefault: true, isActive: true },
            },
          },
        },
      },
    });

    if (article.site.publishTargets.length === 0) {
      this.log.warn(`[${articleId}] Hiç publish target yok`);
      return [];
    }

    // Markdown → tam HTML sayfa (frontmatter strip + UTF-8 + meta + sade tema)
    //
    // canonical, JSON-LD'deki Article.url ile AYNI kaynaktan gelmek ZORUNDA.
    // Eski hâli sabit `${base}/blog/${slug}` üretiyordu; pipeline şemayı gerçek
    // yola (ör. /pratik-kobi-rehberi/<slug>) taşıyınca sayfa kendi kendisiyle
    // çelişti: şema bir URL, canonical başka bir URL (üstelik var olmayan /blog)
    // gösteriyordu. Google için tutarsız canonical, tutarlı-yanlış canonical'dan
    // daha kötüdür (self-referencing canonical bozulur, sayfa indekslenmeyebilir).
    //
    // Hedef olarak sitenin VARSAYILAN aktif hedefi okunur; publishTargets bu
    // çağrıda targetIds ile daraltılmış olabilir ve canonical hangi hedefe
    // basıldığından bağımsız olarak tek/otoriter URL'i göstermelidir.
    const siteUrl = (article.site as any).url ? String((article.site as any).url) : '';
    let canonical: string | null = null;
    let sectionPath: string | null = null;
    if (siteUrl) {
      let defaultTarget: { type?: string | null; config?: unknown } | null = null;
      try {
        const targets = await this.prisma.publishTarget.findMany({
          where: { siteId: article.siteId, isActive: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          take: 1,
        });
        defaultTarget = targets[0] ?? null;
      } catch (err: any) {
        this.log.warn(`[${articleId}] Publish hedefi okunamadı, canonical varsayılana düştü: ${err.message}`);
      }
      const resolved = resolveArticleUrl(siteUrl, article.slug, defaultTarget);
      canonical = resolved.url;
      sectionPath = resolved.sectionPath;
    }
    // GEO v7: schema JSON-LD + audio + tracker injection
    const schemaJsonLd: any[] = (() => {
      const sm: any = (article as any).schemaMarkup;
      return Array.isArray(sm?.jsonLd) ? sm.jsonLd : [];
    })();
    const audioUrl: string | null = (() => {
      const fm: any = (article as any).frontmatter ?? {};
      return fm?.audio_url ?? null;
    })();

    // GEO: body'de görünür SSS varsa eşleşen FAQPage schema ekle (zaten yoksa).
    // Google FAQ rich-result politikası: schema görünür içerikle eşleşmeli — bu yüzden
    // makaledeki gerçek SSS sorularından üretiyoruz, uydurmuyoruz.
    if (!schemaJsonLd.some((s) => s?.['@type'] === 'FAQPage')) {
      const faqLd = buildFaqPageLd(article.bodyMd ?? '');
      if (faqLd) schemaJsonLd.push(faqLd);
    }

    // ── Hero görsel: yoksa veya placeholder ise gerçek görsel üret ──
    // 05-visuals agent makaleye "placeholder-hero.webp" yazıyor; burada gerçeğini
    // üretip hem og:image hem WordPress featured image (media upload) için kullanıyoruz.
    let heroImageUrl: string | null = article.heroImageUrl ?? null;
    let heroImageBase64: string | undefined;
    let heroImageFilename: string | undefined;
    let heroImageMime: string | undefined;
    if (!heroImageUrl || /placeholder/i.test(heroImageUrl)) {
      try {
        const outPath = path.join(process.cwd(), 'public', 'blog', article.slug, 'hero.webp');
        const prompt = `Professional, modern editorial blog header illustration for an article titled "${article.title}". Clean, high-quality, conceptual, relevant to the subject. No text, no words, no letters, no logos.`;
        const gen = await this.imageGen.generate(
          { prompt, outputPath: outPath, width: 1536, height: 1024, type: 'hero' },
          { provider: process.env.IMAGE_PROVIDER },
        );
        if (gen.ok) {
          const base = (process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai').replace(/\/+$/, '');
          heroImageUrl = `${base}/blog/${article.slug}/hero.webp`;
          // WordPress media için en uyumlu format JPG byte'larını oku (yoksa webp)
          try {
            const buf = await fs.readFile(outPath.replace(/\.webp$/, '.jpg'));
            heroImageBase64 = buf.toString('base64');
            heroImageFilename = `${article.slug}-hero.jpg`;
            heroImageMime = 'image/jpeg';
          } catch {
            const buf = await fs.readFile(outPath);
            heroImageBase64 = buf.toString('base64');
            heroImageFilename = `${article.slug}-hero.webp`;
            heroImageMime = 'image/webp';
          }
          await this.prisma.article.update({ where: { id: article.id }, data: { heroImageUrl } }).catch(() => {});
          this.log.log(`[${articleId}] hero görsel üretildi → ${heroImageUrl}`);
        } else {
          this.log.warn(`[${articleId}] hero görsel üretilemedi: ${gen.error}`);
          heroImageUrl = null; // placeholder'ı body'ye koyma
        }
      } catch (err: any) {
        this.log.warn(`[${articleId}] hero görsel hata: ${err.message}`);
        heroImageUrl = null;
      }
    }

    // Body markdown'daki placeholder hero referansını temizle (kırık img olmasın)
    let cleanBodyMd = (article.bodyMd ?? '').replace(/!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)/gi, '');

    // ── Yayın öncesi son link kontrolü ────────────────────────
    // Pipeline'daki doğrulamadan sonra makale günlerce beklemiş, elle
    // düzenlenmiş veya hedef sayfa silinmiş olabilir. Kırık link canlıya
    // çıkmasın diye yayından hemen önce bir kez daha süzülür.
    try {
      const validated = await this.linkValidator.validateArticleMarkdown(article.siteId, cleanBodyMd, {
        checkExternal: false, // yayını yavaşlatmamak için sadece iç linkler
      });
      cleanBodyMd = validated.bodyMd;
      if (validated.report.remapped || validated.report.unlinked) {
        this.log.warn(
          `[${articleId}] yayın öncesi link temizliği: ${validated.report.remapped} remap, ${validated.report.unlinked} kaldırıldı`,
        );
      }
    } catch (err: any) {
      this.log.warn(`[${articleId}] yayın öncesi link doğrulama atlandı: ${err.message}`);
    }

    // Dosya-tabanli hedefler (FTP/SFTP/cPanel/ZIP) icin tam HTML sayfasi
    const fullPageHtml = renderArticleHtml({
      bodyMd: cleanBodyMd,
      title: article.title,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      canonical,
      heroImageUrl,
      siteName: article.site.name,
      sectionPath,
      schemaJsonLd,
      audioUrl,
      trackerSiteId: article.siteId,
    });

    // CMS hedefleri (WordPress/Ghost/Shopify/...) icin sadece govde parcasi
    const fragmentHtml = renderArticleFragment({
      bodyMd: cleanBodyMd,
      heroImageUrl,
      schemaJsonLd,
      audioUrl,
      trackerSiteId: article.siteId,
    });

    const results: PublishResult[] = [];

    for (const target of article.site.publishTargets) {
      const Adapter = getAdapter(target.type) as any;
      if (!Adapter) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: `Adapter yok: ${target.type}`,
        });
        continue;
      }

      const credentials = this.decryptCredentials(target.credentials as Record<string, any>);
      const adapter = new Adapter(credentials, target.config ?? {});

      try {
        const result = await adapter.publish({
          slug: article.slug,
          title: article.title,
          bodyHtml: adapter.needsFullPage ? fullPageHtml : fragmentHtml,
          bodyMd: article.bodyMd ?? '',
          metaTitle: article.metaTitle ?? undefined,
          metaDescription: article.metaDescription ?? undefined,
          category: article.category ?? undefined,
          heroImageUrl: heroImageUrl ?? undefined,
          heroImageBase64,
          heroImageFilename,
          heroImageMime,
        });

        // Last used timestamp güncelle
        await this.prisma.publishTarget.update({
          where: { id: target.id },
          data: { lastUsedAt: new Date() },
        });

        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: result.ok,
          externalUrl: result.externalUrl,
          externalId: result.externalId,
          error: result.error,
        });

        this.log.log(`[${articleId}] ${target.type} → ${result.ok ? '✓' : '✗'} ${result.externalUrl ?? result.error ?? ''}`);
      } catch (err: any) {
        results.push({
          targetId: target.id,
          targetType: target.type,
          ok: false,
          error: err.message,
        });
        this.log.error(`[${articleId}] ${target.type} hata: ${err.message}`);
      }
    }

    // Article status + publishedTo güncelle
    const successful = results.filter(r => r.ok);
    if (successful.length > 0) {
      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          // Panel onizlemesi bunu dogrudan DOM'a basiyor → tam sayfa degil parca sakla
          bodyHtml: fragmentHtml,
          publishedTo: successful as any,
        },
      });

      // Sosyal kanallara otomatik DRAFT post artık üretilmiyor — kullanıcı article
      // listesindeki "Sosyalde paylaş" butonundan modal ile kanal seçip elle ekler.
      // (Geri açmak istersen: socialAutoDraft.createDraftsForArticle(articleId) çağır.)

      // Yeni sayfa eklendi → iç link envanteri bayatladı. Cache düşürülmezse
      // sonraki makaleler bu makaleye link veremez (envanterde görünmez).
      this.urlInventory.invalidate(article.siteId);

      // GEO: yayinlanan URL'i tum AI/search engine kanallarina ping at (best-effort)
      const firstPublicUrl = successful.find((r) => r.externalUrl)?.externalUrl;
      if (firstPublicUrl) {
        this.indexingPinger.pingUrl(article.siteId, firstPublicUrl).catch((err) => {
          this.log.warn(`[${articleId}] index ping basarisiz: ${err.message}`);
        });
      }

      // GEO: yeni makale llms-full.txt'ye HEMEN girsin diye site'in llms dosyasini
      // yeniden uret (haftalik cron'u bekleme). Best-effort — publish'i bloklamaz.
      // AI-sitemap zaten anlik (on-demand) uretildigi icin ayrica rebuild gerekmez.
      try {
        const r = await this.llmsFullBuilder.build(article.siteId);
        this.log.log(`[${articleId}] llms-full.txt güncellendi: ${r.articles} makale, ${(r.bytes / 1024).toFixed(1)} KB`);

        // GEO: kendi llms.txt'sini üretmeyen hedeflere (kobipratik gibi) llms.txt +
        // llms-full.txt push et. Best-effort — desteklemeyen adapter no-op döner.
        await this.pushLlmsToTargets(article.siteId, article.site.publishTargets).catch((err) => {
          this.log.warn(`[${articleId}] llms push başarısız: ${err.message}`);
        });
      } catch (err: any) {
        this.log.warn(`[${articleId}] llms-full.txt rebuild başarısız: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Site'in llms.txt (kısa index) + llms-full.txt içeriğini, llms push destekleyen
   * publish hedeflerine gönderir (kobipratik vb). Desteklemeyen adapter `skipped`
   * döner → atlanır. Tamamen best-effort: publish sonucunu etkilemez.
   */
  private async pushLlmsToTargets(
    siteId: string,
    targets: Array<{ type: string; credentials: any; config: any }>,
  ): Promise<void> {
    if (!targets || targets.length === 0) return;

    const full =
      ((await this.prisma.site.findUnique({
        where: { id: siteId },
        select: { llmsFullTxt: true } as any,
      })) as any)?.llmsFullTxt ?? '';
    const shortIndex = await this.llmsFullBuilder.buildShortIndex(siteId);

    for (const target of targets) {
      const Adapter = getAdapter(target.type) as any;
      if (!Adapter) continue;
      const adapter = new Adapter(this.decryptCredentials(target.credentials as Record<string, any>), target.config ?? {});
      if (typeof adapter.pushLlms !== 'function') continue;

      try {
        const r = await adapter.pushLlms({ llmsTxt: shortIndex, llmsFullTxt: full });
        if (r?.ok) {
          this.log.log(`[${siteId}] llms push → ${target.type}: ✓ ${r.externalUrl ?? ''}`);
        } else if (r && !r.skipped) {
          this.log.warn(`[${siteId}] llms push → ${target.type}: ${r.error ?? 'bilinmeyen hata'}`);
        }
      } catch (err: any) {
        this.log.warn(`[${siteId}] llms push → ${target.type} hata: ${err.message}`);
      }
    }
  }

  private decryptCredentials(creds: Record<string, any>): Record<string, any> {
    if (!creds || typeof creds !== 'object') return {};

    // Yeni format: { enc: "iv:tag:ciphertext" } — tum credentials tek JSON
    // string'inde sifrelenmis. Decrypt + JSON.parse yapip alanlari ust seviyeye yay.
    if (typeof creds.enc === 'string' && creds.enc.includes(':')) {
      try {
        const decrypted = decrypt(creds.enc);
        const parsed = JSON.parse(decrypted);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // duser fallback yola
      }
    }

    // Eski format: her alan ayri ayri encrypted (geriye uyumluluk)
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      if (typeof v === 'string' && v.includes(':')) {
        try { out[k] = decrypt(v); } catch { out[k] = v; }
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
