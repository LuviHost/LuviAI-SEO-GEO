import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetchText } from '../common/safe-fetch.js';
import { detectBlock } from '../common/block-detect.js';
import { isAllowedForRanksUpBot, parseRanksUpBotGroup, ROBOTS_PARSE_LIMIT, type RanksUpRobotsPolicy } from './ranksup-robots.js';

export interface SitePageRef {
  url: string;    // mutlak URL
  path: string;   // normalize edilmis path (/vr-isg-egitimi-simulasyon)
  title: string;
}

interface CacheEntry {
  pages: SitePageRef[];
  at: number;
}

/**
 * Bir sitenin GERCEK sayfa envanteri.
 *
 * Iki kaynagi birlestirir:
 *   1. Brain.sitePages — brain uretiminde crawl edilen sayfalar (baslikli)
 *   2. sitemap.xml — taze yayinlanan sayfalari da yakalar (baslik yok, slug'dan turetilir)
 *
 * Neden var: yazar ajani daha once hic dogrulanmamis URL'ler uretiyordu
 * ("/oyunlastirilmis-isg-egitimi-yontemleri" gibi) ve bunlar makaleye 404 ic
 * link olarak giriyordu. Artik hem prompt'a gercek liste veriliyor hem de
 * uretim sonrasi link dogrulamasi bu envantere gore yapiliyor.
 */
@Injectable()
export class SiteUrlInventoryService {
  private readonly log = new Logger(SiteUrlInventoryService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 15 * 60 * 1000; // 15 dk

  constructor(private readonly prisma: PrismaService) {}

  /** Path normalize: mutlak/goreli fark etmez, lowercase + trailing slash yok. */
  normalizePath(href: string, baseUrl: string): string | null {
    try {
      const u = href.startsWith('http') ? new URL(href) : new URL(href, baseUrl);
      let p = u.pathname.toLowerCase();
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      return p;
    } catch {
      return null;
    }
  }

  /** Bir URL bu siteye mi ait? (harici linkler dogrulama disi birakilir) */
  isInternal(href: string, baseUrl: string): boolean {
    try {
      if (!href.startsWith('http')) return true; // goreli → dahili
      return new URL(href).host.replace(/^www\./, '') === new URL(baseUrl).host.replace(/^www\./, '');
    } catch {
      return false;
    }
  }

  async getInventory(siteId: string, opts: { force?: boolean } = {}): Promise<SitePageRef[]> {
    const cached = this.cache.get(siteId);
    if (!opts.force && cached && Date.now() - cached.at < this.TTL_MS) return cached.pages;

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    if (!site) return [];

    const baseUrl = site.url;
    const byPath = new Map<string, SitePageRef>();

    // 1) Brain'deki crawl envanteri — baslikli, en degerli kaynak
    const brainPages: any[] = Array.isArray((site.brain as any)?.sitePages)
      ? ((site.brain as any).sitePages as any[])
      : [];
    for (const p of brainPages) {
      const path = this.normalizePath(String(p?.url ?? ''), baseUrl);
      if (!path) continue;
      byPath.set(path, {
        url: new URL(path, baseUrl).toString(),
        path,
        title: String(p?.title || p?.h1 || '').trim(),
      });
    }

    // 2) sitemap.xml — brain crawl'indan sonra yayinlanan sayfalari yakalar
    try {
      for (const url of await this.fetchSitemapUrls(baseUrl)) {
        const path = this.normalizePath(url, baseUrl);
        if (!path || byPath.has(path)) continue;
        byPath.set(path, { url, path, title: this.titleFromPath(path) });
      }
    } catch (err: any) {
      this.log.warn(`[${siteId}] sitemap okunamadi: ${err.message}`);
    }

    const pages = [...byPath.values()];
    this.cache.set(siteId, { pages, at: Date.now() });
    this.log.log(`[${siteId}] URL envanteri: ${pages.length} sayfa`);
    return pages;
  }

  /** Yeni makale yayinlandiginda envanter bayatlar — cache'i dusur. */
  invalidate(siteId: string): void {
    this.cache.delete(siteId);
  }

  /**
   * Kirik bir ic linke, envanterden en yakin gercek sayfayi onerir.
   * Esik altinda kalirsa null → link kaldirilir (yanlis hedefe yonlendirmektense
   * duz metne cevirmek daha guvenli; kullanici okurunu alakasiz sayfaya atmaz).
   *
   * Skorlama iki sey yapar:
   *  1. Turkce ek toleransi — "oyunlastirilmis" ~ "oyunlastirma" ortak govdeyle
   *     eslesir, aksi halde eklemeli dilde neredeyse hicbir kelime tutmaz.
   *  2. IDF agirligi — "isg" / "etkinlikleri" gibi envanterin cogunda gecen
   *     jenerik kelimeler kararı belirlemez; ayirt edici kelime belirler.
   *     (Bu olmadan "oyunlastirilmis isg egitimi" sirf "isg"+"egitimi" ortak
   *     diye alakasiz bir VR sayfasina baglaniyordu.)
   */
  suggestReplacement(brokenPath: string, anchor: string, pages: SitePageRef[]): SitePageRef | null {
    if (pages.length === 0) return null;

    const want = [...new Set([...this.tokenize(brokenPath), ...this.tokenize(anchor)])];
    if (want.length === 0) return null;

    const docs = pages.map((p) => [...new Set([...this.tokenize(p.path), ...this.tokenize(p.title)])]);
    const total = docs.length;

    // IDF — kac sayfada geciyor
    const idfOf = (token: string): number => {
      let df = 0;
      for (const doc of docs) {
        if (doc.some((h) => this.tokenSimilarity(token, h) > 0)) df++;
      }
      return Math.log((total + 1) / (df + 1)) + 0.3; // +0.3: her token biraz katki versin
    };

    const weighted = want.map((t) => ({ token: t, weight: idfOf(t) }));
    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) return null;

    let best: SitePageRef | null = null;
    let bestScore = 0;
    for (let i = 0; i < pages.length; i++) {
      const have = docs[i];
      if (have.length === 0) continue;
      let sum = 0;
      for (const { token, weight } of weighted) {
        let bestMatch = 0;
        for (const h of have) bestMatch = Math.max(bestMatch, this.tokenSimilarity(token, h));
        sum += bestMatch * weight;
      }
      const score = sum / totalWeight;
      if (score > bestScore) {
        bestScore = score;
        best = pages[i];
      }
    }

    // 0.55 esigi bilincli olarak muhafazakar: emin olmadigimizda link kurmak
    // yerine kaldiriyoruz.
    return bestScore >= 0.55 ? best : null;
  }

  /** Turkce karakterleri ASCII'ye indirger — "eğitimi" ile "egitimi" ayni token olur. */
  private fold(s: string): string {
    const map: Record<string, string> = {
      ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
    };
    return s.toLowerCase().replace(/İ/g, 'i').replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c);
  }

  private tokenize(s: string): string[] {
    const STOP = new Set([
      'ile', 'icin', 'nasil', 'nedir', 'neden', 'olan', 'veya', 'daha', 'cok',
      'bir', 'category', 'blog', 'www', 'com', 'http', 'https', 'html', 'index',
    ]);
    return this.fold(s)
      .replace(/[^a-z0-9\s/-]/g, ' ')
      .split(/[\s/\-_]+/)
      .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOP.has(t));
  }

  /**
   * Turkce eklemeli dil toleransi: 5+ karakter ortak govde varsa akraba say.
   * "oyunlastirilmis" / "oyunlastirma" → ortak "oyunlastir" → eslesir.
   */
  private tokenSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    let i = 0;
    const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    return i >= 5 ? 0.85 : 0;
  }

  // ── sitemap ────────────────────────────────────────────────

  private async fetchSitemapUrls(baseUrl: string): Promise<string[]> {
    const site = new URL(baseUrl);
    const origin = site.origin;

    // RanksUpBot grubu varsa ona uyulur ("*" grubu bilerek uygulanmaz —
    // gerekce ranksup-robots.ts'te). robots.txt'in kendisi her zaman serbest.
    const robotsTxt = await this.fetchText(`${origin}/robots.txt`, ROBOTS_PARSE_LIMIT, false);
    const policy: RanksUpRobotsPolicy | null = robotsTxt ? parseRanksUpBotGroup(robotsTxt) : null;
    const allowed = (u: string) => isAllowedForRanksUpBot(policy, u);

    // Yalnizca bu sitenin (www'li/www'suz) sayfalari: baska alan adinin
    // yollari bu sitenin envanterine girerse ic link dogrulamasi yanilir.
    const siteKey = (h: string) => h.toLowerCase().replace(/^www\./, '');
    const own = (list: string[]) => list.filter((u) => {
      try {
        const p = new URL(u);
        return (p.protocol === 'http:' || p.protocol === 'https:') && siteKey(p.hostname) === siteKey(site.hostname);
      } catch {
        return false;
      }
    });
    const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/&amp;/g, '&'));

    const candidates = [
      `${origin}/sitemap.xml`,
      `${origin}/wp-sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    ];

    for (const candidate of candidates) {
      if (!allowed(candidate)) continue;
      const xml = await this.fetchText(candidate);
      if (!xml) continue;
      if (xml.includes('<sitemapindex')) {
        const all: string[] = [];
        for (const child of locs(xml).slice(0, 8)) {
          if (own([child]).length && !allowed(child)) continue;
          const childXml = await this.fetchText(child);
          if (childXml) all.push(...locs(childXml));
        }
        const pages = own(all);
        if (pages.length) return pages;
      }
      if (xml.includes('<urlset')) {
        return own(locs(xml));
      }
    }
    return [];
  }

  /**
   * SSRF korumali okuma (common/safe-fetch.ts) — RanksUpBot kimligiyle.
   * Tavan: burasi sitemap de okuyabiliyor; sitemap'ler duz metin ve buyuk
   * olabildigi icin 8 MB, asilinca kesilir. Engel sayfasi icerik sayilmaz.
   */
  private async fetchText(url: string, maxBytes = 8 * 1024 * 1024, skipBinary = true): Promise<string | null> {
    try {
      // robots.txt bazen application/octet-stream ile sunulur — metin olarak okunur
      const res = await safeFetchText(url, { maxBytes, timeoutMs: 12_000, skipBinary });
      const block = detectBlock(res);
      if (block) {
        this.log.warn(`Envanter okunamadi (${url}): ${block.reason}`);
        return null;
      }
      if (!res.ok || res.binary) return null;
      return res.text;
    } catch {
      return null;
    }
  }

  private titleFromPath(path: string): string {
    const last = path.split('/').filter(Boolean).pop() ?? '';
    return last.replace(/-/g, ' ').trim();
  }
}
