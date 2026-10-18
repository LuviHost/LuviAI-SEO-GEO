import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import { unblockHint, type BlockKind, type BlockSignal } from "../common/block-detect.js";
import { fetchCustomerPage, type CustomerPage } from "./customer-page-fetch.js";

export interface GeoSignal {
  id: string;
  label: string;
  weight: number;
  score: number;
  detail?: string;
}

/** Erisimimiz engellendi — olculen sey site degil, bizim erisimimiz */
export interface GeoAccessBlock {
  kind: BlockKind;
  vendor: string | null;
  status: number;
  /** Kullaniciya gosterilecek Turkce neden (block-detect.ts) */
  reason: string;
  /** Site sahibinin ne yapmasi gerektigi (RanksUpBot'a izin) */
  hint: string;
  url: string;
}

/**
 * GEO olcum yontemi surumu — checks.geo.details.methodVersion olarak yazilir.
 *
 * v2 (Ekim 2026): HTML donen /llms.txt artik 0 puan (eskiden 200 karakterden
 * uzun govde ve kucultulmus JS'teki `a[0](b)` markdown linki sayilip 30-60
 * aliyordu); anasayfa ikinci kez orneklenmiyor; orneklem yonlendirme
 * SONRASI kokenden (apex → www) seciliyor; engele takilan llms.txt ve sayfalar
 * skora girmiyor. Ayni site degismeden farkli skor alabilir — karsilastirma
 * (audit.service compareAuditRows, site-report teknikGeoDelta) surumler
 * farkliysa farki siteye yazmaz. Alan tasimayan eski kayitlar v1 sayilir.
 * Yontem degisirse bu sayi artirilir.
 */
export const GEO_METHOD_VERSION = 2;

export interface GeoAuditResult {
  score: number | null;
  methods: GeoSignal[];
  queries: any[];
  rawOutput?: string;
  /** Olcum yontemi (GEO_METHOD_VERSION) — HER donus yolunda dolu */
  details?: { methodVersion: number };
  /**
   * Doluysa skor VERILMEDI: orneklenen sayfalar guvenlik duvari / bot
   * dogrulamasina takildi. Dogrulama ekranini puanlamak siteyi oldugundan
   * kotu gosterirdi (bkz. common/block-detect.ts — ofsayt.com vakasi).
   */
  blocked?: GeoAccessBlock | null;
  /** Skorun dayandigi orneklem: olculen sayfa sayisi ve engel yuzunden disarida kalanlar */
  sample?: { measured: number; blocked: number };
}

function toAccessBlock(signal: BlockSignal, url: string): GeoAccessBlock {
  return {
    kind: signal.kind,
    vendor: signal.vendor,
    status: signal.status,
    reason: signal.reason,
    hint: unblockHint(signal),
    url,
  };
}

/**
 * Dahili GEO/AEO heuristic scorer.
 * Auriti CLI public paket olmadigi icin in-process analiz.
 *
 * 8 sinyal x weighted score = 0-100 GEO score.
 * Sinyaller: llms.txt, JSON-LD schema, FAQ/QA, definition density,
 * heading hierarchy, OG/canonical, freshness, citation format.
 *
 * Site genelinde anasayfa + ilk 5 ic sayfa ornekleyerek ortalama skor.
 */
@Injectable()
export class GeoRunnerService {
  private readonly log = new Logger(GeoRunnerService.name);

  isAvailable(): boolean {
    return true;
  }

  async runAudit(url: string): Promise<GeoAuditResult> {
    // Surum damgasi tek noktada: engel, okunamayan anasayfa ve hata yollari
    // dahil her sonuc hangi yontemle uretildigini tasir — biri unutulursa o
    // kayit v1 sanilip "yontem degisti" yanlis yere duserdi.
    const result = await this.measure(url);
    return { ...result, details: { methodVersion: GEO_METHOD_VERSION } };
  }

  private async measure(url: string): Promise<GeoAuditResult> {
    try {
      const requested = new URL(url).origin;
      const home = await this.fetchPage(requested);
      if (home.kind === "blocked") {
        // Anasayfa bot korumasina takildi: dogrulama ekrani sayfa sayilip
        // puanlanmaz. Ic sayfalar ayni duvara carpar — denemek siteyi bosuna
        // yorar, o yuzden skor yerine nedeni donuyoruz.
        this.log.warn(`${requested} GEO: erisim engellendi — ${home.signal.reason}`);
        return {
          score: null,
          methods: [],
          queries: [],
          blocked: toAccessBlock(home.signal, requested),
          sample: { measured: 0, blocked: 1 },
        };
      }
      if (home.kind !== "ok") {
        return { score: null, methods: [], queries: [] };
      }
      // Yonlendirme sonrasi gercek koken (http→https, apex→www). Ic linkler ve
      // sitemap adresleri bu kokene gore suzulur; kayitli adres "example.com"
      // site "www.example.com" iken eskiden hepsi elenip yalniz anasayfa
      // olculuyordu.
      const origin = new URL(home.url).origin;
      const isHome = (u: string) => u === origin || u === `${origin}/`;
      const homepage = home.text;
      const llms = await this.fetchPage(`${origin}/llms.txt`);

      // Sample sayfa seti — GERÇEK içerik sayfalarını örnekle. Eskiden sadece
      // anasayfa + ilk 5 menü linki örnekleniyordu → blog postları (FAQ/schema
      // bunlarda) hiç görülmüyordu, GEO skoru yanlış düşük çıkıyordu. Artık önce
      // sitemap'teki post URL'lerini, sonra anasayfa linklerini kullanıyoruz;
      // taksonomi/nav/yasal sayfaları eliyoruz.
      const $home = cheerio.load(homepage);
      const samplePages: { url: string; html: string }[] = [{ url: origin, html: homepage }];
      const homeLinks: string[] = [];
      $home("a[href]").each((_, el) => {
        const href = $home(el).attr("href");
        if (!href) return;
        try {
          const abs = new URL(href, origin).href.split("#")[0];
          // Anasayfanin kendisi ("/") ikinci kez orneklenip ortalamayi kaydirmasin
          if (abs.startsWith(origin) && !isHome(abs) && !homeLinks.includes(abs)) homeLinks.push(abs);
        } catch { /* gecersiz href — atla */ }
      });
      const sitemapUrls = await this.collectContentUrls(origin);
      const navRe = /\/(category|categories|tag|tags|author|page|wp-[a-z]|feed|cdn-cgi|amp)\/|\/(hakkimizda|iletisim|contact|about|gizlilik|privacy|kvkk|cerez|cookie)\/?$/i;
      const isContent = (u: string) => u.startsWith(origin) && !isHome(u) && !navRe.test(u);
      const datedFirst = (a: string, b: string) =>
        (/\/\d{4}\/\d{2}\//.test(b) ? 1 : 0) - (/\/\d{4}\/\d{2}\//.test(a) ? 1 : 0);
      const candidates = [...new Set([...sitemapUrls, ...homeLinks])].filter(isContent).sort(datedFirst);
      const chosen = (candidates.length ? candidates : homeLinks).slice(0, 8);
      let blockedPages = 0;
      for (const c of chosen) {
        const page = await this.fetchPage(c);
        if (page.kind === "ok") {
          samplePages.push({ url: c, html: page.text });
        } else if (page.kind === "blocked") {
          // Engelli sayfa skora GIRMEZ (ne icerik ne bozuk sayfa); sayilir.
          blockedPages++;
          // Hiz siniri: devam etmek ayni 429'u buyutur — orneklemi burada kes
          if (page.signal.kind === "rate_limited") break;
        }
      }

      // llms.txt engele takildiysa "yok" DEGIL, "olculemedi": sinyal skordan
      // cikarilir, 0 puanla siteyi cezalandirmaz.
      const llmsSignal = llms.kind === "blocked"
        ? null
        : this.checkLlmsTxt(llms.kind === "ok" ? llms.text : null);
      if (!llmsSignal) this.log.warn(`${origin}/llms.txt GEO: erisim engellendi — sinyal skora katilmadi`);

      const signals: GeoSignal[] = [
        ...(llmsSignal ? [llmsSignal] : []),
        ...this.checkPagesAggregate(samplePages),
      ];

      const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
      const weightedScore = signals.reduce((s, x) => s + (x.score * x.weight), 0);
      const score = Math.round(weightedScore / totalWeight);

      return {
        score,
        methods: signals,
        queries: [],
        blocked: null,
        sample: { measured: samplePages.length, blocked: blockedPages },
      };
    } catch (err: any) {
      this.log.warn(`GEO heuristic hata: ${err.message}`);
      return { score: null, methods: [], queries: [] };
    }
  }

  private checkLlmsTxt(content: string | null): GeoSignal {
    // Bircok site olmayan yola 200 + HTML (ozel 404 / anasayfa) doner. llms.txt
    // markdown'dir ve "<" ile baslamaz; eskiden bu HTML "200 karakterden uzun
    // ozet" sayilip olmayan dosyaya 30 puan veriyordu.
    if (!content || /^\s*</.test(content)) {
      return { id: "llms_txt", label: "llms.txt mevcudiyeti", weight: 15, score: 0, detail: "Bulunamadi" };
    }
    const hasH1 = /^#\s+\S/m.test(content);
    const hasSummary = /^>\s+\S/m.test(content) || content.length > 200;
    const hasLinks = (content.match(/\[.+?\]\(.+?\)/g) ?? []).length >= 3;
    const score = (hasH1 ? 40 : 0) + (hasSummary ? 30 : 0) + (hasLinks ? 30 : 0);
    return { id: "llms_txt", label: "llms.txt format", weight: 15, score, detail: `${score}/100` };
  }

  private checkPagesAggregate(samples: { url: string; html: string }[]): GeoSignal[] {
    if (samples.length === 0) return [];
    const scores = samples.map(s => this.scorePage(s.html));
    const avg = (key: keyof ReturnType<typeof this.scorePage>) =>
      Math.round(scores.reduce((sum, s) => sum + (s[key] as number), 0) / scores.length);

    return [
      { id: "structured_data", label: "JSON-LD schema kapsami", weight: 18, score: avg("schemaScore") },
      { id: "faq_qa",          label: "FAQ / Soru-cevap formati", weight: 12, score: avg("faqScore") },
      { id: "definition",      label: "Tanim yogunlugu (X nedir?)", weight: 12, score: avg("defScore") },
      { id: "heading",         label: "Heading hiyerarsisi (H1>H2>H3)", weight: 10, score: avg("headingScore") },
      { id: "og_canonical",    label: "Canonical + OG/Twitter meta", weight: 13, score: avg("metaScore") },
      { id: "freshness",       label: "Tarih sinyali (datePublished/Modified)", weight: 10, score: avg("freshScore") },
      { id: "citation_format", label: "Liste/tablo/citation formati", weight: 10, score: avg("citationScore") },
    ];
  }

  private scorePage(html: string) {
    const $ = cheerio.load(html);

    // 1) JSON-LD schema variety
    const ldBlocks = $("script[type=\"application/ld+json\"]")
      .toArray()
      .map(el => $(el).html() ?? "");
    const types = new Set<string>();
    for (const block of ldBlocks) {
      const m = block.match(/"@type"\s*:\s*"([^"]+)"/g) ?? [];
      for (const t of m) {
        const v = t.match(/"@type"\s*:\s*"([^"]+)"/);
        if (v) types.add(v[1]);
      }
    }
    const desired = ["Article", "FAQPage", "BreadcrumbList", "Organization", "Product", "HowTo"];
    const hits = desired.filter(d => types.has(d)).length;
    const schemaScore = Math.min(100, Math.round((hits / 3) * 100));

    // 2) FAQ
    const hasFAQSchema = types.has("FAQPage") || types.has("Question");
    const text = $("body").text();
    const qaCount = (text.match(/\?\s*\n/g) ?? []).length;
    const faqScore = (hasFAQSchema ? 70 : 0) + Math.min(30, qaCount * 5);

    // 3) Definition density — "X nedir", "X ne demek", "X tanimlanir"
    const defPatterns = [/\b\w+\s+nedir\??/gi, /\bne demek/gi, /\btanim/gi, /\baciklamak/gi, /<dfn>/gi];
    const defHits = defPatterns.reduce((s, r) => s + ((text.match(r) ?? []).length), 0);
    const defScore = Math.min(100, defHits * 8);

    // 4) Heading hierarchy
    const h1Count = $("h1").length;
    const h2Count = $("h2").length;
    const h3Count = $("h3").length;
    let headingScore = 0;
    if (h1Count === 1) headingScore += 50;
    if (h2Count >= 2) headingScore += 30;
    if (h3Count >= 1) headingScore += 20;

    // 5) Meta — canonical + OG + twitter
    const hasCanonical = $("link[rel=canonical]").length > 0;
    const ogCount = $("meta[property^=\"og:\"]").length;
    const twCount = $("meta[name^=\"twitter:\"]").length;
    let metaScore = 0;
    if (hasCanonical) metaScore += 40;
    if (ogCount >= 3) metaScore += 30;
    if (twCount >= 2) metaScore += 30;

    // 6) Freshness
    const dateModified = $("meta[property=\"article:modified_time\"], time[datetime]").attr("datetime")
      ?? $("meta[property=\"article:published_time\"]").attr("content");
    let freshScore = 0;
    if (dateModified) {
      try {
        const ageMonths = (Date.now() - new Date(dateModified).getTime()) / (1000 * 60 * 60 * 24 * 30);
        if (ageMonths < 12) freshScore = 100;
        else if (ageMonths < 24) freshScore = 60;
        else freshScore = 30;
      } catch { freshScore = 50; }
    }

    // 7) Citation/list/table format
    const listCount = $("ul, ol").length;
    const tableCount = $("table").length;
    const blockquoteCount = $("blockquote").length;
    let citationScore = 0;
    if (listCount >= 2) citationScore += 40;
    if (tableCount >= 1) citationScore += 30;
    if (blockquoteCount >= 1) citationScore += 30;

    return { schemaScore, faqScore, defScore, headingScore, metaScore, freshScore, citationScore };
  }

  /** Sitemap'ten içerik (öncelikle post) URL'lerini toplar — GEO örneklemesi için. */
  private async collectContentUrls(origin: string): Promise<string[]> {
    const out: string[] = [];
    let xml: string | null = null;
    for (const c of [`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`]) {
      const x = await this.fetchText(c);
      if (x && /<(sitemapindex|urlset)/i.test(x)) { xml = x; break; }
    }
    if (!xml) return out;
    const locs = (s: string) => [...s.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(xml)) {
      const subs = locs(xml);
      const postSubs = subs.filter((s) => /post/i.test(s));
      const chosen = (postSubs.length ? postSubs : subs).slice(0, 2);
      for (const sub of chosen) {
        const sx = await this.fetchText(sub);
        if (sx) out.push(...locs(sx));
      }
    } else {
      out.push(...locs(xml));
    }
    return out;
  }

  /**
   * Sayfa govdesi — 2 MB tavanli.
   *
   * NEDEN TAVAN VAR: burasi ucuncu taraf sitelerden HTML cekiyor ve ustelik
   * en fazla 9 sayfanin govdesini AYNI ANDA samplePages icinde tutuyor.
   * Tavansiz surumde uretimde olculdu — GEO asamasi worker RSS'ini tek basina
   * 260 MB'tan 748 MB'a cikariyordu (ofsayt.com sayfalari ~2.7 MB HTML).
   * Ayni hata site-crawler'da da vardi; tavanli okuma artik
   * common/safe-fetch.ts'te (safeFetchText) tek yerde duruyor.
   */
  private static readonly MAX_PAGE_BYTES = 2 * 1024 * 1024;

  /**
   * Sayfa — SSRF korumali (adres musteri sitesinden ve sitemap'ten gelir),
   * PDF/zip/video govdesi indirilmez, engel sayfasi "blocked" doner.
   */
  private async fetchPage(url: string): Promise<CustomerPage> {
    const page = await fetchCustomerPage(url, {
      timeoutMs: 12_000,
      maxBytes: GeoRunnerService.MAX_PAGE_BYTES,
      // Onbellekteki bayat kopya degil, sitenin su anki hali olculsun
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
    });
    if (page.kind === "ok" && page.truncated) {
      this.log.warn(`${url} 2.0MB tavanda kirpildi — GEO sinyalleri <head> ve ilk govdeden okundu`);
    }
    return page;
  }

  /** Yalnizca okunabilen govde (sitemap gibi yardimci kaynaklar icin) */
  private async fetchText(url: string): Promise<string | null> {
    const page = await this.fetchPage(url);
    return page.kind === "ok" ? page.text : null;
  }
}
