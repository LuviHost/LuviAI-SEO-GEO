import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, mdToHtml, parseFrontmatter } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { SocialAutoDraftService } from '../social/social-auto-draft.service.js';

/**
 * Markdown body'yi tam bir HTML sayfasi haline getir.
 * - frontmatter strip (mdToHtml'e gelmesin)
 * - <html lang="tr"> + UTF-8 + viewport
 * - SEO meta (title, description, canonical, og)
 * - Inline minimal CSS — okunabilir, mobile-first
 */
function renderArticleHtml(opts: {
  bodyMd: string;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  heroImageUrl?: string | null;
  siteName?: string | null;
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
<header class="brand"><a class="logo" href="/">${brand}</a><a href="/blog">Blog</a></header>
<main>
${hero}
${inner}
</main>
<footer class="site">© ${brand} — ${year}</footer>
</div>
</body>
</html>`;
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
    private readonly socialAutoDraft: SocialAutoDraftService,
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
    const canonical = (() => {
      const base = (article.site as any).url ? String((article.site as any).url).replace(/\/+$/, '') : '';
      return base ? `${base}/blog/${article.slug}` : null;
    })();
    const bodyHtml = renderArticleHtml({
      bodyMd: article.bodyMd ?? '',
      title: article.title,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      canonical,
      heroImageUrl: article.heroImageUrl,
      siteName: article.site.name,
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
          bodyHtml,
          bodyMd: article.bodyMd ?? '',
          metaTitle: article.metaTitle ?? undefined,
          metaDescription: article.metaDescription ?? undefined,
          category: article.category ?? undefined,
          heroImageUrl: article.heroImageUrl ?? undefined,
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
          bodyHtml,
          publishedTo: successful as any,
        },
      });

      // Sosyal kanallara DRAFT post hazirla — cron yayinlayacak.
      // Hata olsa bile makale yayini etkilenmesin.
      this.socialAutoDraft.createDraftsForArticle(articleId).catch((err) => {
        this.log.warn(`[${articleId}] social auto-draft basarisiz: ${err.message}`);
      });
    }

    return results;
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
