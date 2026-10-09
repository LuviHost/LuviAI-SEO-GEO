import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppliedFixService } from './applied-fix.service.js';
import { decryptCredentials } from '@luviai/shared';
import { getAdapter, patchImgAlt } from '@luviai/adapters';
import type { PageSnippet } from './snippet-generator.service.js';
import { readBodyCapped } from '../common/fetch-capped.js';

/**
 * D4 — Statik HTML siteleri için preview-onaylı auto-write.
 *
 * Akış:
 *  1. preview(siteId, pageUrl, snippets)
 *      → sayfayı canlıdan çek
 *      → cheerio ile <head>'e snippet'leri enjekte et
 *      → diff (eskiHead, yeniHead) döndür
 *  2. write(siteId, pageUrl, snippets)
 *      → aynı patch'i tekrarla
 *      → adapter.publish(slug, bodyHtml, remotePath) ile overwrite et
 *
 * Sadece FTP / SFTP / CPANEL_API target'ları desteklenir
 * (file overwrite eden adapter'lar). WordPress/Webflow için bu
 * service çağrılmaz — onlar OnPageMeta API'sini kullanır.
 */
@Injectable()
export class StaticHtmlFixerService {
  private readonly log = new Logger(StaticHtmlFixerService.name);
  private readonly fileTargets = ['FTP', 'SFTP', 'CPANEL_API'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly appliedFix: AppliedFixService,
  ) {}

  async preview(siteId: string, pageUrl: string, snippets: PageSnippet[]) {
    const page = await this.fetch(pageUrl);
    if (!page) throw new Error(`Sayfa indirilemedi: ${pageUrl}`);
    const html = page.html;
    const { patched, applied, skipped } = this.patch(html, snippets);
    return {
      pageUrl,
      originalLength: html.length,
      patchedLength: patched.length,
      applied,
      skipped,
      // Kesik sayfa YAZILAMAZ (write reddeder) — onizlemede de soyle
      truncated: page.truncated,
      diff: this.headDiff(html, patched),
      preview: patched.slice(0, 4000),
    };
  }

  async write(siteId: string, pageUrl: string, snippets: PageSnippet[]) {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { publishTargets: { where: { isDefault: true, isActive: true }, take: 1 } },
    });
    const target = site.publishTargets[0];
    if (!target) {
      return { ok: false, error: 'Default publish target yok — Settings > Publish Targets ekle' };
    }
    if (!this.fileTargets.includes(target.type)) {
      return { ok: false, error: `${target.type} statik HTML overwrite desteklemiyor — sadece FTP/SFTP/CPANEL_API` };
    }

    const page = await this.fetch(pageUrl);
    if (!page) return { ok: false, error: `Sayfa indirilemedi: ${pageUrl}` };
    // Sayfa 2 MB okuma sinirinda KESILDIYSE yamalanmis hali dosyanin
    // TAMAMININ yerine yazilirdi → musteri sayfasinin geri kalani silinirdi.
    if (page.truncated) {
      return { ok: false, error: `Sayfa 2 MB okuma sinirini asiyor (${pageUrl}) — kesik icerikle uzerine yazmak sayfayi bozar; manuel uygula` };
    }
    const html = page.html;

    const { patched, applied, skipped } = this.patch(html, snippets);
    if (applied.length === 0) return { ok: false, error: 'Uygulanacak snippet yok', applied, skipped };

    const up = await this.uploadPage(target, pageUrl, patched);
    if (!('res' in up)) return { ok: false, error: up.error };
    const { res, remoteDir, filename } = up;

    this.log.log(`[${siteId}] static-html-fix → ${pageUrl} → ${remoteDir}/${filename} : ${res.ok ? 'OK' : res.error}`);

    // KALICI KAYIT — bkz. applied-fix.service.ts. Yazma basarisizsa FAILED,
    // cunku "dosya gonderildi" ile "dosya yazildi" ayni sey degil.
    await this.appliedFix.topluKaydet(
      applied.map((alan: string) => ({
        siteId,
        kind: 'static_html' as const,
        fixType: alan,
        target: pageUrl,
        status: res.ok ? ('APPLIED' as const) : ('FAILED' as const),
        error: res.ok ? null : String(res.error ?? 'bilinmeyen hata'),
        adapter: target.type,
        detail: { remoteDir, filename },
      })),
    );

    return {
      ok: !!res.ok,
      adapter: target.type,
      remoteDir,
      filename,
      applied,
      skipped,
      error: res.error,
      externalUrl: res.externalUrl,
    };
  }

  /**
   * Gorsel alt metinlerini bir sayfanin statik HTML'ine yazar (cerrahi yama —
   * yalnizca eslesen <img alt> degisir). Ayni sayfadaki birden cok gorsel tek
   * yazimda uygulanir. Kesik (2 MB) sayfaya YAZMAZ.
   */
  async writeImageAlts(
    siteId: string,
    pageUrl: string,
    items: Array<{ id: string; srcRaw: string; src: string; wpAttachmentId?: number | null; alt: string | null; expectCurrentAlt?: string }>,
  ): Promise<{
    ok: boolean;
    error?: string;
    adapter?: string;
    perImage: Record<string, { changed: boolean; oldAlt: string | null; reason?: string }>;
    remoteDir?: string;
    filename?: string;
  }> {
    const perImage: Record<string, { changed: boolean; oldAlt: string | null; reason?: string }> = {};
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { publishTargets: { where: { isDefault: true, isActive: true }, take: 1 } },
    });
    const target = site.publishTargets[0];
    if (!target || !this.fileTargets.includes(target.type)) {
      return { ok: false, error: 'Varsayilan yayin hedefi FTP/SFTP/cPanel degil', perImage };
    }
    const page = await this.fetch(pageUrl);
    if (!page) return { ok: false, error: `Sayfa indirilemedi: ${pageUrl}`, perImage };
    if (page.truncated) return { ok: false, error: `Sayfa 2 MB okuma sinirini asiyor (${pageUrl}) — yazilmadi`, perImage };

    let html = page.html;
    for (const it of items) {
      const r = patchImgAlt(html, { srcRaw: it.srcRaw, src: it.src, wpAttachmentId: it.wpAttachmentId }, it.alt, { expectCurrentAlt: it.expectCurrentAlt });
      perImage[it.id] = { changed: r.changed, oldAlt: r.oldAlt, reason: r.reason };
      if (r.changed) html = r.html;
    }
    if (!Object.values(perImage).some((p) => p.changed)) return { ok: true, perImage, adapter: target.type };

    const up = await this.uploadPage(target, pageUrl, html);
    if (!('res' in up)) return { ok: false, error: up.error, perImage, adapter: target.type };
    this.log.log(`[${siteId}] image-alt → ${pageUrl} → ${up.remoteDir}/${up.filename} : ${up.res.ok ? 'OK' : up.res.error}`);
    if (!up.res.ok) {
      for (const k of Object.keys(perImage)) if (perImage[k].changed) perImage[k] = { ...perImage[k], changed: false, reason: 'write_failed' };
    }
    return { ok: !!up.res.ok, error: up.res.ok ? undefined : String(up.res.error ?? 'yazilamadi'), perImage, adapter: target.type, remoteDir: up.remoteDir, filename: up.filename };
  }

  /** Sayfanin dosyasini hedefe yazar (URL → dosya yolu; kok "/" yazmaz) */
  private async uploadPage(target: any, pageUrl: string, html: string): Promise<{ error: string } | { res: any; remoteDir: string; filename: string }> {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) return { error: `Adapter bulunamadı: ${target.type}` };

    // Tek kaynak: yeni { enc } + eski alan-bazli format (shared/crypto.ts)
    const credentials = decryptCredentials(target.credentials as Record<string, any>);

    const { dir, slug, ext } = this.urlToPath(pageUrl);
    if (!ext) {
      return { error: `URL pathname'inde dosya uzantısı yok (${pageUrl}) — root path \"/\" için anasayfa overwrite riski yüksek, manuel uygula` };
    }
    const filename = `${slug}.${ext}`;

    // remotePath'i config'ten al, path prefix kadarını URL'in dir'i ile birleştir
    const cfg = (target.config as Record<string, any> | null) ?? {};
    const baseRemote = String(cfg.remotePath ?? 'public_html').replace(/^\/+|\/+$/g, '');
    const remoteDir = dir ? `${baseRemote}/${dir}` : baseRemote;

    const adapter = new Adapter(credentials, { ...cfg, remotePath: remoteDir });
    const res = await adapter.publish({
      slug,                 // dosya adı (uzantısız)
      title: pageUrl,
      bodyHtml: html,
      bodyMd: html,
    });
    return { res, remoteDir, filename };
  }

  // ──────────────────────────────────────────────────────────────────
  private patch(html: string, snippets: PageSnippet[]): { patched: string; applied: string[]; skipped: { type: string; reason: string }[] } {
    const $ = cheerio.load(html);
    const applied: string[] = [];
    const skipped: { type: string; reason: string }[] = [];

    for (const s of snippets) {
      try {
        switch (s.type) {
          case 'meta_title': {
            const t = this.stripTagText(s.generatedSnippet, 'title');
            if (!t) { skipped.push({ type: s.type, reason: 'title metni parse edilemedi' }); break; }
            const cur = $('title').first();
            if (cur.length) cur.text(t);
            else $('head').append(`<title>${this.esc(t)}</title>`);
            applied.push('title');
            break;
          }
          case 'meta_description':
            this.upsertMeta($, 'name', 'description', this.metaContent(s.generatedSnippet));
            applied.push('description');
            break;
          case 'canonical': {
            const href = this.linkHref(s.generatedSnippet);
            $('link[rel="canonical"]').remove();
            $('head').append(`<link rel="canonical" href="${this.esc(href)}" />`);
            applied.push('canonical');
            break;
          }
          case 'open_graph':
          case 'twitter_card':
          case 'jsonld_article':
          case 'jsonld_organization':
          case 'jsonld_breadcrumb': {
            // Tüm bloğu olduğu gibi head'e ekle (önce eski OG'leri temizle)
            if (s.type === 'open_graph') $('meta[property^="og:"]').remove();
            if (s.type === 'twitter_card') $('meta[name^="twitter:"]').remove();
            if (s.type.startsWith('jsonld_')) {
              // Aynı @type'taki var olan JSON-LD'i temizle
              const desiredType = s.type === 'jsonld_article' ? 'Article'
                : s.type === 'jsonld_organization' ? 'Organization'
                : 'BreadcrumbList';
              $('script[type="application/ld+json"]').each((_, el) => {
                const txt = $(el).html() ?? '';
                if (txt.includes(`"@type":"${desiredType}"`) || txt.includes(`"@type": "${desiredType}"`)) {
                  $(el).remove();
                }
              });
            }
            $('head').append(`\n${s.generatedSnippet}\n`);
            applied.push(s.type);
            break;
          }
          case 'h1':
            // Body H1 değişimi tehlikeli — skip, snippet panelinden uygulanmalı
            skipped.push({ type: s.type, reason: 'H1 body değişimi statik HTML auto-fix kapsamı dışında — manuel uygula' });
            break;
          default:
            skipped.push({ type: s.type, reason: 'Tanınmayan snippet tipi' });
        }
      } catch (err: any) {
        skipped.push({ type: s.type, reason: err.message });
      }
    }

    return { patched: $.html(), applied, skipped };
  }

  private upsertMeta($: cheerio.CheerioAPI, attr: 'name' | 'property', value: string, content: string) {
    if (!content) return;
    $(`meta[${attr}="${value}"]`).remove();
    $('head').append(`<meta ${attr}="${this.esc(value)}" content="${this.esc(content)}" />`);
  }

  private headDiff(before: string, after: string): { before: string; after: string } {
    const head = (s: string) => {
      const m = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(s);
      return m ? m[1].trim() : '';
    };
    return { before: head(before), after: head(after) };
  }

  private urlToPath(pageUrl: string): { dir: string; slug: string; ext: string } {
    let path = '/';
    try { path = new URL(pageUrl).pathname; } catch {}
    if (path === '' || path === '/') return { dir: '', slug: 'index', ext: 'html' };
    const segments = path.replace(/^\/|\/$/g, '').split('/');
    const last = segments.pop() ?? '';
    const m = last.match(/^(.+?)\.(html?|php)$/i);
    if (m) {
      return { dir: segments.join('/'), slug: m[1], ext: m[2].toLowerCase() };
    }
    // Uzantısız URL — directory-style (Hugo, Astro). slug=index, dir = segmentler+last
    return { dir: [...segments, last].filter(Boolean).join('/'), slug: 'index', ext: 'html' };
  }

  private stripTagText(html: string, tag: string): string {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
    return m ? this.decode(m[1].trim()) : '';
  }
  private metaContent(html: string): string {
    const m = /<meta[^>]*content=["']([^"']+)["']/i.exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private linkHref(html: string): string {
    const m = /<link[^>]*href=["']([^"']+)["']/i.exec(html);
    return m ? this.decode(m[1]) : '';
  }
  private decode(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  private esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  private async fetch(url: string): Promise<{ html: string; truncated: boolean } | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RanksUp-StaticFixer/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const body = await readBodyCapped(res, 2 * 1024 * 1024);
      return body ? { html: body.text, truncated: body.truncated } : null;
    } catch { return null; }
  }
}
