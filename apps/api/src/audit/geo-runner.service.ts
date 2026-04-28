import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";

export interface GeoSignal {
  id: string;
  label: string;
  weight: number;
  score: number;
  detail?: string;
}

export interface GeoAuditResult {
  score: number | null;
  methods: GeoSignal[];
  queries: any[];
  rawOutput?: string;
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
    try {
      const origin = new URL(url).origin;
      const homepage = await this.fetch(origin);
      if (!homepage) {
        return { score: null, methods: [], queries: [] };
      }
      const llmsTxt = await this.fetch(`${origin}/llms.txt`);

      // Sample sayfa setini anasayfadan dahili linklerle topla
      const $home = cheerio.load(homepage);
      const samplePages: { url: string; html: string }[] = [{ url: origin, html: homepage }];
      const candidates: string[] = [];
      $home("a[href]").each((_, el) => {
        const href = $home(el).attr("href");
        if (!href) return;
        try {
          const abs = new URL(href, origin).href;
          if (abs.startsWith(origin) && abs !== origin && !candidates.includes(abs)) {
            candidates.push(abs);
          }
        } catch {}
      });
      for (const c of candidates.slice(0, 5)) {
        const html = await this.fetch(c);
        if (html) samplePages.push({ url: c, html });
      }

      const signals: GeoSignal[] = [
        this.checkLlmsTxt(llmsTxt),
        ...this.checkPagesAggregate(samplePages),
      ];

      const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
      const weightedScore = signals.reduce((s, x) => s + (x.score * x.weight), 0);
      const score = Math.round(weightedScore / totalWeight);

      return {
        score,
        methods: signals,
        queries: [],
      };
    } catch (err: any) {
      this.log.warn(`GEO heuristic hata: ${err.message}`);
      return { score: null, methods: [], queries: [] };
    }
  }

  private checkLlmsTxt(content: string | null): GeoSignal {
    if (!content) {
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

  private async fetch(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LuviAI-GEO/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  }
}
