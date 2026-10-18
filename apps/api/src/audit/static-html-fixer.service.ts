import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppliedFixService } from './applied-fix.service.js';
import { decryptCredentials } from '@luviai/shared';
import { getAdapter, patchImgAlt } from '@luviai/adapters';
import { publishTargetBlockReason } from '../publish-targets/publish-target-url.js';
import { safeFetchText, SafeFetchError } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { assertWithinSiteHost, type PageSnippet } from './snippet-generator.service.js';
import { fetchCustomerPage, pageFailureText, rewriteCharsetProblem } from './customer-page-fetch.js';
import {
  STATIC_FILE_TARGET_TYPES, planStaticWrite, staticFileProblem,
  type StaticFileLocation, type StaticFileProbe, type StaticWritePlan,
} from './stuck-page-static-write.js';

/** Sayfa okuma tavani — asilirsa sayfa YAZILMAZ (kesik icerik dosyanin yerine gecerdi) */
const STATIC_PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Dosya otomatik yazilamazsa snippet akisinda kullaniciya yonerge (kartlar ayni ekranda) */
const SNIPPET_MANUAL_HINT = "Snippet'leri aşağıdaki kartlardan kopyalayıp sayfanın <head> bölümüne elle ekle.";
/** Gorsel alt metni akisinda yonerge */
const IMAGE_ALT_MANUAL_HINT = 'Alt metnini sayfanın HTML kodunda elle güncelle.';

type FetchedPage = { html: string; truncated: boolean; charset: string | null; url: string };
type SiteWithTargets = { url: string; platform?: string | null; publishTargets: any[] };

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
 *      → sayfayi SUNAN statik .html dosyasi dogrulanirsa onun yerine yazar;
 *        dogrulanamazsa yazmaz, elle uygulama nedeni doner (manual: true)
 *
 * DOSYA YOLU (stuck-page-static-write.ts ile ayni kurallar): eski esleme
 * remotePath'i (yayin hedefinin blog klasoru) web koku sayiyordu —
 * /blog/x.html, public_html/blog/blog/x.html'e yaziliyordu; .php / .htm
 * sayfalar adaptor her zaman "<ad>.html" yazdigi icin yanlis dosyaya
 * gidiyordu; anasayfa korumasi (!ext) hic tetiklenmiyor, "/" index.html'e
 * yaziliyordu. Uc durumda da canli sayfa degismezken kayit APPLIED oluyordu.
 * Artik yalniz: CMS izi olmayan sitede, FTP / SFTP / cPanel hedef klasorune
 * eslenen ve okununca sayfayla BIREBIR ayni statik bir .html dosyasi yazilir.
 *
 * WordPress/Webflow için bu service çağrılmaz — onlar OnPageMeta API'sini kullanır.
 */
@Injectable()
export class StaticHtmlFixerService {
  private readonly log = new Logger(StaticHtmlFixerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appliedFix: AppliedFixService,
  ) {}

  async preview(siteId: string, rawPageUrl: string, snippets: PageSnippet[]) {
    // Kapsam: adres istek govdesinden gelir — yalniz sitenin kendi sayfasi,
    // istekten ONCE (bkz. snippet-generator assertWithinSiteHost)
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { url: true } });
    const pageUrl = assertWithinSiteHost(rawPageUrl, site.url, 'Statik HTML önizlemesi');
    const page = await this.fetch(pageUrl);
    // Kullaniciya nedeni gosterilsin (duz Error 500 + "Internal server error" oluyordu)
    if ('error' in page) throw new BadRequestException(page.error);
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
      // UTF-8 disi bildirilen sayfa da yazilamaz (bkz. charsetBlocksWrite)
      charset: page.charset,
      diff: this.headDiff(html, patched),
      preview: patched.slice(0, 4000),
    };
  }

  async write(siteId: string, rawPageUrl: string, snippets: PageSnippet[]) {
    const site = await this.siteWithTargets(siteId);
    // Kapsam: adres hem okunur hem dosya yoluna cevrilip MUSTERININ sunucusuna
    // yazilir — baska sitenin sayfasi musterinin dosyasinin yerine gecmesin.
    const pageUrl = assertWithinSiteHost(rawPageUrl, site.url, 'Statik HTML yazımı');
    // Dosya yazan hedef hic yoksa (WordPress vb.) sayfa okunmadan neden doner
    const noFileTarget = this.noFileTargetReason(site, pageUrl, SNIPPET_MANUAL_HINT);
    if (noFileTarget) return { ok: false, manual: true, error: noFileTarget };

    const page = await this.fetch(pageUrl);
    if ('error' in page) return { ok: false, error: page.error };
    // Sayfa 2 MB okuma sinirinda KESILDIYSE yamalanmis hali dosyanin
    // TAMAMININ yerine yazilirdi → musteri sayfasinin geri kalani silinirdi.
    if (page.truncated) {
      return { ok: false, error: `Sayfa 2 MB okuma sinirini asiyor (${pageUrl}) — kesik icerikle uzerine yazmak sayfayi bozar; manuel uygula` };
    }
    const charsetError = this.charsetBlocksWrite(page, pageUrl);
    if (charsetError) return { ok: false, error: charsetError };
    const html = page.html;

    const { patched, applied, skipped } = this.patch(html, snippets);
    if (applied.length === 0) return { ok: false, error: 'Uygulanacak snippet yok', applied, skipped };

    // Sayfayi bu dosya mi sunuyor (CMS / Cloudflare izi, dosya okumasi birebir)?
    // Dogrulanamazsa YAZILMAZ ve kayit tutulmaz: siteye hicbir sey uygulanmadi.
    const plan = await this.verifiedPlan(site, page, SNIPPET_MANUAL_HINT);
    if (plan.kind === 'manual') return { ok: false, manual: true, error: plan.reason, applied, skipped };

    const up = await this.uploadPage(plan.target, plan.location, patched);
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
        adapter: plan.target.type,
        detail: { remoteDir, filename },
      })),
    );

    return {
      ok: !!res.ok,
      adapter: plan.target.type,
      remoteDir,
      filename,
      applied,
      skipped,
      error: res.error,
      externalUrl: res.externalUrl,
      // Yazilan dosyanin dogrulanan genel adresi
      fileUrl: plan.location.fileUrl,
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
    /** Sayfanin statik dosyasi dogrulanamadi — yazilmadi, alt metni elle uygulanir */
    manual?: boolean;
  }> {
    const perImage: Record<string, { changed: boolean; oldAlt: string | null; reason?: string }> = {};
    const site = await this.siteWithTargets(siteId);
    // Adres taranan sayfadan gelir; dosya eslemesi sitenin kendi alan adi disini reddeder
    const noFileTarget = this.noFileTargetReason(site, pageUrl, IMAGE_ALT_MANUAL_HINT);
    if (noFileTarget) return { ok: false, manual: true, error: noFileTarget, perImage };
    const page = await this.fetch(pageUrl);
    if ('error' in page) return { ok: false, error: page.error, perImage };
    if (page.truncated) return { ok: false, error: `Sayfa 2 MB okuma sinirini asiyor (${pageUrl}) — yazilmadi`, perImage };
    const charsetError = this.charsetBlocksWrite(page, pageUrl);
    if (charsetError) return { ok: false, error: charsetError, perImage };

    let html = page.html;
    for (const it of items) {
      const r = patchImgAlt(html, { srcRaw: it.srcRaw, src: it.src, wpAttachmentId: it.wpAttachmentId }, it.alt, { expectCurrentAlt: it.expectCurrentAlt });
      perImage[it.id] = { changed: r.changed, oldAlt: r.oldAlt, reason: r.reason };
      if (r.changed) html = r.html;
    }
    const fileTargetType = this.fileTargets(site)[0]?.type;
    if (!Object.values(perImage).some((p) => p.changed)) return { ok: true, perImage, adapter: fileTargetType };

    // Yamali sayfa yalniz sayfayi SUNAN dogrulanmis statik dosyanin yerine yazilir
    const plan = await this.verifiedPlan(site, page, IMAGE_ALT_MANUAL_HINT);
    if (plan.kind === 'manual') {
      // Hicbir sey yazilmadi: gorseller "degisti" kalirsa cagiran uygulandi sayardi
      for (const k of Object.keys(perImage)) if (perImage[k].changed) perImage[k] = { ...perImage[k], changed: false, reason: 'manual' };
      return { ok: false, manual: true, error: plan.reason, perImage, adapter: fileTargetType };
    }

    const up = await this.uploadPage(plan.target, plan.location, html);
    if (!('res' in up)) {
      // Dosya HIC gonderilmedi (hedef adresi reddedildi / adaptor yok): yamali
      // gorseller "degisti" kalirsa cagiran (image-alt-apply) onlari uygulandi sayardi
      for (const k of Object.keys(perImage)) if (perImage[k].changed) perImage[k] = { ...perImage[k], changed: false, reason: 'write_failed' };
      return { ok: false, error: up.error, perImage, adapter: plan.target.type };
    }
    this.log.log(`[${siteId}] image-alt → ${pageUrl} → ${up.remoteDir}/${up.filename} : ${up.res.ok ? 'OK' : up.res.error}`);
    if (!up.res.ok) {
      for (const k of Object.keys(perImage)) if (perImage[k].changed) perImage[k] = { ...perImage[k], changed: false, reason: 'write_failed' };
    }
    return { ok: !!up.res.ok, error: up.res.ok ? undefined : String(up.res.error ?? 'yazilamadi'), perImage, adapter: plan.target.type, remoteDir: up.remoteDir, filename: up.filename };
  }

  /** Sitenin adresi, platform tahmini ve AKTIF hedefleri (varsayilan once) */
  private async siteWithTargets(siteId: string): Promise<SiteWithTargets> {
    return this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { publishTargets: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    }) as Promise<SiteWithTargets>;
  }

  /** Sitenin dosya yazan (FTP / SFTP / cPanel) aktif hedefleri, varsayilan once */
  private fileTargets(site: SiteWithTargets): any[] {
    return site.publishTargets.filter((t) => (STATIC_FILE_TARGET_TYPES as readonly string[]).includes(t.type));
  }

  /**
   * Dosya yazan hedef hic yoksa elle uygulama nedeni (sayfa okunmadan once;
   * eski "varsayilan hedef FTP/SFTP/cPanel degil" erken donusunun karsiligi).
   * Adres eslemesi ve CMS izi sayfa okunduktan sonra verifiedPlan'de denetlenir.
   */
  private noFileTargetReason(site: SiteWithTargets, pageUrl: string, manualHint: string): string | null {
    if (this.fileTargets(site).length > 0) return null;
    const plan = this.plan(site, pageUrl, '', manualHint);
    return plan.kind === 'manual' ? plan.reason : null;
  }

  /** Hedef secimi + adres → dosya eslemesi (ag istegi yok) */
  private plan(site: SiteWithTargets, pageUrl: string, html: string, manualHint: string): StaticWritePlan<any> {
    return planStaticWrite({
      targets: site.publishTargets,
      siteUrl: site.url,
      platform: site.platform ?? null,
      pageUrl,
      html,
      manualHint,
    });
  }

  /**
   * Okunan sayfa icin tam karar: yonlendirme sonrasi son adres eslenir, sayfa
   * HTML'indeki CMS / Cloudflare izine bakilir, eslenen dosyanin adresi okunup
   * sayfayla BIREBIR ayni statik dosya oldugu dogrulanir (staticFileProblem).
   */
  private async verifiedPlan(site: SiteWithTargets, page: FetchedPage, manualHint: string): Promise<StaticWritePlan<any>> {
    const plan = this.plan(site, page.url, page.html, manualHint);
    if (plan.kind !== 'write') return plan;
    const problem = staticFileProblem(await this.probeStaticFile(plan.location.fileUrl), plan.location.fileUrl, page.html, manualHint);
    return problem ? { kind: 'manual', reason: problem } : plan;
  }

  /** Dosya adresini SSRF korumali okur (sayfayla ayni kurallar); engel ekrani dosya sayilmaz */
  private async probeStaticFile(fileUrl: string): Promise<StaticFileProbe> {
    try {
      const res = await safeFetchText(fileUrl, { timeoutMs: 15_000, maxBytes: STATIC_PAGE_MAX_BYTES });
      const block = detectBlock(res);
      return block ? { error: `dosya adresi okunamadı: ${block.reason}` } : res;
    } catch (err) {
      const code = err instanceof SafeFetchError ? err.code : 'network';
      return { error: `dosya adresi okunamadı (${code})` };
    }
  }

  /**
   * Dogrulanmis statik dosyanin yerine sayfayi yazar. Adaptorler
   * `${remotePath}/${slug}.html` yazar (ftp.ts, sftp.ts, cpanel-api.ts):
   * klasor, eslenen dosyanin klasoruyle degistirilir.
   */
  private async uploadPage(target: any, location: StaticFileLocation, html: string): Promise<{ error: string } | { res: any; remoteDir: string; filename: string }> {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) return { error: `Adapter bulunamadı: ${target.type}` };

    // Tek kaynak: yeni { enc } + eski alan-bazli format (shared/crypto.ts)
    const credentials = decryptCredentials(target.credentials as Record<string, any>);
    const cfg = (target.config as Record<string, any> | null) ?? {};
    // Adaptor FTP / SFTP / cPanel adresine dogrudan baglanir; kayittan sonra
    // DNS ic aga cevrilmis olabilir — istekten HEMEN once denetim
    const blockReason = await publishTargetBlockReason(String(target.type), credentials, cfg);
    if (blockReason) return { error: blockReason };

    const adapter = new Adapter(credentials, { ...cfg, remotePath: location.remoteDir });
    const res = await adapter.publish({
      slug: location.slug, // dosya adı (uzantısız; adaptör .html ekler)
      title: location.fileUrl,
      bodyHtml: html,
      bodyMd: html,
    });
    return { res, remoteDir: location.remoteDir, filename: `${location.slug}.html` };
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
  /**
   * Canli sayfa — adres istek govdesinden gelir: SSRF korumali okuma. Engel /
   * bot dogrulama sayfasi "sayfa" DEGILDIR: yamalanip musterinin dosyasinin
   * yerine yazilmasin diye hata doner.
   */
  private async fetch(url: string): Promise<FetchedPage | { error: string }> {
    const page = await fetchCustomerPage(url, { timeoutMs: 15_000, maxBytes: STATIC_PAGE_MAX_BYTES });
    if (page.kind !== 'ok') return { error: `Sayfa indirilemedi: ${url} — ${pageFailureText(page)}` };
    // url: yonlendirmelerden sonraki son adres — dosya eslemesi bunun uzerinden yapilir
    return { html: page.text, truncated: page.truncated, charset: page.charset, url: page.url };
  }

  /** UTF-8 disi / gecersiz UTF-8 sayfa geri yazilmaz (bkz. rewriteCharsetProblem) */
  private charsetBlocksWrite(page: { charset: string | null; html: string }, pageUrl: string): string | null {
    const problem = rewriteCharsetProblem({ charset: page.charset, text: page.html });
    return problem ? `${problem} (${pageUrl})` : null;
  }
}
