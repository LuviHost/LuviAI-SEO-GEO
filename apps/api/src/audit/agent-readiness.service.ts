import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { siteWhereForFeature } from '../billing/plan-site-filter.js';
import { KNOWN_AI_BOTS } from './known-ai-bots.js';
import { parseRobotsAiStance as parseStance, type RobotsAiStance } from './robots-ai-stance.js';
import { probeUrl, createLimiter, describeProbe, type Probe, type ProbeOptions } from './axo-fetch.js';
import { assessRobotsBody, robotsSitemapUrls } from './robots-merge.js';
import {
  parseAiCatalog, sitemapKind, looksLikeHtml, parseJsonSafe, validateMcpServerCard, validateA2aAgentCard,
  MCP_SERVER_CARD_TYPE, A2A_AGENT_CARD_TYPE, type AiCatalogEntry, type CardCheck,
} from './axo-validators.js';
import {
  SCORE_VERSION, buildReadinessLevels, summarizeLevels, accessFromLevels, planCommerceProbes,
  productUrlsFromSubSitemap, spreadSample,
  type ScanContext, type ReadinessLevel, type ReadinessStatus, type AccessSummary, type CommerceSignals, type ProductFeedKind,
} from './agent-readiness-checks.js';

export type { ReadinessAuditStep, ReadinessCheck, ReadinessLevel, ReadinessStatus, AccessSummary } from './agent-readiness-checks.js';

/**
 * Agent Readiness (AXO — Agent Experience Optimization) taramasi.
 *
 * GEO Score Card "AI arama motorlarinda GORUNUYOR musun" olcer;
 * bu servis "AI AJANLARI siteni OKUYABILIYOR/KULLANABILIYOR mu" olcer.
 *
 * 4 seviye:
 *   L1 quick-wins   — ana sayfa erisimi, robots.txt, sitemap, AI crawler kurallari, content signals, llms.txt
 *   L2 groundwork   — auth.md, API katalogu, llms-full.txt, Organization schema, JS'siz kesif, isletilebilirlik (bilgi)
 *   L3 advanced     — A2A ajan karti (v1.0), MCP Server Card (SEP-2127), markdown negotiation, WebMCP (bilgi), app kontrolleri
 *   L4 commerce     — urun feed'i, Product schema, agentic checkout (bilgi)
 *
 * Kontrol mantigi ve skor metodolojisi SAF modulde: agent-readiness-checks.ts
 * (SCORE_VERSION ve v3 gerekceleri orada). Bu servis yalniz istekleri yapar,
 * kaydeder ve bildirir. Tum istekler safeFetchText ile (SSRF korumali, durust
 * RanksUpBot kimligi); engel/ulasilamazlik "eksik" sayilmaz.
 */

export interface AgentReadinessResult {
  overallScore: number;
  status: ReadinessStatus;
  /** Skor metodolojisi surumu — bkz. SCORE_VERSION */
  scoreVersion: number;
  levels: ReadinessLevel[];
  robotsAiStance: RobotsAiStance | null;
  agentsAllowed: number | null;
  agentsTotal: number | null;
  nextUpToFix: Array<{ checkId: string; name: string; fixKey?: string }>;
  ranAt: string;
  durationMs: number;
  /** v3: ana sayfa / robots.txt engelli ya da ulasilamaz ise nedeni ve ipucu */
  access: AccessSummary | null;
  /** v3: puanlanan / olculemeyen kontrol sayilari */
  scoring: { earned: number; max: number; scoredChecks: number; blockedChecks: number };
}

/** Engelli/ulasilamaz taramanin skoru yaniltici olur — trend ve dusus bildirimi disinda tutulur */
const UNMEASURED_STATUSES = new Set<string>(['blocked', 'unreachable']);

/**
 * REST yaniti (POST /agent-readiness/run): engelli/ulasilamaz taramada
 * overallScore null + measured:false — getLatest ve MCP (readinessForAgent)
 * ile ayni kural. Eskiden ham skor (yalniz olculebilen birkac kontrolun
 * orani) donuyor, "son tarama" ekraninin gostermedigi skoru API veriyordu.
 * Kayit ve bildirimler ham sonucu kullanmaya devam eder.
 */
export function readinessForResponse(r: AgentReadinessResult): Omit<AgentReadinessResult, 'overallScore'> & { overallScore: number | null; measured: boolean } {
  const unmeasured = UNMEASURED_STATUSES.has(r.status);
  return { ...r, overallScore: unmeasured ? null : r.overallScore, measured: !unmeasured };
}

const FETCH_TIMEOUT_MS = 10_000;
/** js-free-discovery 500 KB kirpma esigini bilir */
const HOME_MAX_BYTES = 500_000;
/** Ayni anda en fazla 4 istek — tarama kendi basina 429'a takilmasin */
const CONCURRENCY = 4;

const JSON_ACCEPT = 'application/json, */*;q=0.5';
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
const XML_ACCEPT = 'application/xml, text/xml, */*;q=0.5';
/**
 * Metin kok dosyalari Content-Type'tan bagimsiz okunur: octet-stream ile
 * sunulan robots.txt / llms.txt "bos" diye raporlanmasin (tarayicilar da
 * icerik turune bakmadan okur; otomatik duzeltme de ayni govdeyi gorur).
 */
const TEXT_ROOT = { skipBinary: false } as const;

/** Katalog kartinin adresi okunamadi (engel, 404, sunucu hatasi) — "kart JSON degil" denmez */
const unreadableCard = (probe: Probe): CardCheck => ({ ok: false, errors: [`kart okunamadı (${describeProbe(probe)})`] });

@Injectable()
export class AgentReadinessService {
  private readonly log = new Logger(AgentReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ────────────────────────────────────────────────────────────

  async getLatest(siteId: string) {
    const [scan, prev] = await this.prisma.agentReadinessScan.findMany({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
      take: 2,
    });
    if (!scan) return null;
    const levels = (Array.isArray(scan.levels) ? scan.levels : []) as unknown as ReadinessLevel[];
    const summary = summarizeLevels(levels);
    // Engelli/ulasilamaz taramada kayitli overallScore yalniz OLCULEBILEN birkac
    // kontrolu yansitir; MCP (readinessForAgent) ve KPI (latestReadinessKpi)
    // onu skor diye sunmaz — REST de sunmaz: null + measured:false, neden
    // `access`ta. Olculen kontrollerin dokumu `scoring`de kalir.
    const unmeasured = UNMEASURED_STATUSES.has(scan.status);
    return {
      id: scan.id,
      overallScore: unmeasured ? null : scan.overallScore,
      /** false: son tarama siteye erisemedi, skor olculemedi (eklenen alan) */
      measured: !unmeasured,
      status: scan.status,
      scoreVersion: scan.scoreVersion,
      levels: scan.levels,
      robotsAiStance: scan.robotsAiStance,
      agentsAllowed: scan.agentsAllowed,
      agentsTotal: scan.agentsTotal,
      nextUpToFix: scan.nextUpToFix,
      ranAt: scan.ranAt,
      durationMs: scan.durationMs,
      // v3 alanlari kayitli seviyelerden turetilir (yeni kolon yok); v2 taramada null/0 kalir
      access: accessFromLevels(levels),
      scoring: summary.scoring,
      // Metodoloji degisti mi — UI onceki taramayla puan farkini metodolojiye baglar
      prevScoreVersion: prev?.scoreVersion ?? null,
    };
  }

  /**
   * Skor gecmisi — trend cizgisi icin. Her nokta scoreVersion tasir (metodoloji
   * degisimi isaretlenebilsin); engelli/ulasilamaz taramalarin skoru null —
   * olculemeyen bir taramayi trendde "dusus" gibi cizmek yaniltici olur.
   */
  async history(siteId: string, days = 90) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 7), 365) * 86400_000);
    const scans = await this.prisma.agentReadinessScan.findMany({
      where: { siteId, ranAt: { gte: since } },
      orderBy: { ranAt: 'asc' },
      select: { ranAt: true, overallScore: true, status: true, agentsAllowed: true, agentsTotal: true, scoreVersion: true },
    });
    return scans.map((s) => ({
      date: s.ranAt.toISOString().slice(0, 10),
      score: UNMEASURED_STATUSES.has(s.status) ? null : s.overallScore,
      status: s.status,
      scoreVersion: s.scoreVersion,
      agentsAllowed: s.agentsAllowed,
      agentsTotal: s.agentsTotal,
    }));
  }

  async scan(siteId: string): Promise<AgentReadinessResult> {
    const t0 = Date.now();
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true, trackedApps: { where: { isActive: true } } },
    });

    const ctx = await this.collect(site);
    const { levels, stance } = buildReadinessLevels(ctx);
    const summary = summarizeLevels(levels);

    const agentsTotal = KNOWN_AI_BOTS.length;
    // "Ziyaret edebilen ajan" sayisi ETKIN durustan hesaplanir (wildcard dahil)
    const agentsAllowed = stance ? stance.bots.filter((b) => b.effective === 'allow').length : null;

    const result: AgentReadinessResult = {
      overallScore: summary.overallScore,
      status: summary.status,
      scoreVersion: SCORE_VERSION,
      levels,
      robotsAiStance: stance,
      agentsAllowed,
      agentsTotal: stance ? agentsTotal : null,
      nextUpToFix: summary.nextUpToFix,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      access: summary.access,
      scoring: summary.scoring,
    };

    // ── Persist + bildirim
    const prevAny = await this.prisma.agentReadinessScan.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
      select: { status: true },
    });
    // Dusus karsilastirmasi yalniz AYNI metodoloji surumundeki OLCULEBILMIS
    // taramayla: v2→v3 gecisi ya da engelli bir tarama sahte "skor dustu"
    // bildirimi uretmesin.
    const prevComparable = await this.prisma.agentReadinessScan.findFirst({
      where: { siteId, scoreVersion: SCORE_VERSION, status: { notIn: [...UNMEASURED_STATUSES] } },
      orderBy: { ranAt: 'desc' },
      select: { overallScore: true },
    });
    await this.prisma.agentReadinessScan.create({
      data: {
        siteId,
        overallScore: result.overallScore,
        status: result.status,
        scoreVersion: SCORE_VERSION,
        levels: levels as any,
        robotsAiStance: stance as any,
        agentsAllowed,
        agentsTotal: stance ? agentsTotal : null,
        nextUpToFix: result.nextUpToFix as any,
        durationMs: result.durationMs,
      },
    });

    if (result.access) {
      // Engel yeni basladiysa bir kez haber ver (her hafta tekrarlamaz)
      if (!prevAny || !UNMEASURED_STATUSES.has(prevAny.status)) {
        await this.notifications.create({
          userId: site.userId,
          type: 'SYSTEM',
          title: result.access.state === 'blocked' ? 'Agent Readiness: siteye erişim engellendi' : 'Agent Readiness: siteye ulaşılamadı',
          body: `${site.name} — ${result.access.reason} ${result.access.hint}`,
          link: `/sites/${siteId}/agent-readiness`,
        }).catch(() => { /* bildirim kritik degil */ });
      }
    } else if (prevComparable && prevComparable.overallScore - result.overallScore >= 10) {
      await this.notifications.create({
        userId: site.userId,
        type: 'SYSTEM',
        title: `Agent Readiness skoru düştü: ${prevComparable.overallScore} → ${result.overallScore}`,
        body: `${site.name} sitesinde AI ajan hazırlık skoru ${prevComparable.overallScore - result.overallScore} puan geriledi. En kritik eksik: ${result.nextUpToFix[0]?.name ?? '—'}`,
        link: `/sites/${siteId}/agent-readiness`,
      }).catch(() => { /* bildirim kritik degil */ });
    }

    return result;
  }

  /** Haftalik otomatik tarama — Pazartesi 04:15 UTC, aktif siteler */
  @Cron('15 4 * * 1')
  async weeklyScanAll() {
    // API + worker ayni cron'u tetikler — atomik kilit tek proses calistirir
    if (!(await acquireCronLock(this.prisma, 'agent-readiness', 'weekly'))) return;
    const sites = await this.prisma.site.findMany({
      where: {
        status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any },
        // Profesyonel ozelligi — otomatik tarama da plana bagli.
        ...siteWhereForFeature('agentReadiness'),
      },
      select: { id: true },
      take: 200,
    });
    this.log.log(`Haftalik Agent Readiness taramasi: ${sites.length} site`);
    for (const s of sites) {
      try {
        await this.scan(s.id);
      } catch (err: any) {
        this.log.warn(`Agent readiness scan fail (${s.id}): ${err.message}`);
      }
    }
  }

  /** Saf parser robots-ai-stance.ts'e tasindi (test edilebilir); imza geriye uyumlu. */
  parseRobotsAiStance(robotsTxt: string): RobotsAiStance {
    return parseStance(robotsTxt, KNOWN_AI_BOTS);
  }

  // ────────────────────────────────────────────────────────────
  //  ISTEKLER
  // ────────────────────────────────────────────────────────────

  private async collect(site: any): Promise<ScanContext> {
    const siteUrl = String(site.url).replace(/\/+$/, '') || String(site.url);
    // robots.txt / .well-known / llms.txt her zaman ORIGIN kokunde (RFC 9309,
    // RFC 8615); site adresi alt yol iceriyorsa (/tr) eskiden yanlis yere bakiliyordu
    let origin = siteUrl;
    try { origin = new URL(site.url).origin; } catch { /* gecersiz adres: probe 'unreachable' doner */ }

    const limit = createLimiter(CONCURRENCY);
    const get = (url: string, opts: ProbeOptions = {}) => limit(() => probeUrl(url, { timeoutMs: FETCH_TIMEOUT_MS, ...opts }));
    const app = site.trackedApps?.[0] ?? null;
    // Var olmayan rastgele yol: site her yola 200 + ayni govdeyi donuyorsa (catch-all) soft-404 sinyali
    const randomPath = `/ranksup-404-${randomBytes(6).toString('hex')}.txt`;

    const [home, homeMd, robots, llms, llmsFull, catchAll, authMd, authMdWk, openapi, apiCatalog, aiCatalog, agentCard, agentLegacy, mcpLegacy, mcpLegacyCard, aasa] = await Promise.all([
      get(siteUrl, { accept: HTML_ACCEPT, maxBytes: HOME_MAX_BYTES }),
      get(siteUrl, { accept: 'text/markdown, text/plain;q=0.5', maxBytes: HOME_MAX_BYTES }),
      get(`${origin}/robots.txt`, { accept: 'text/plain, */*;q=0.5', ...TEXT_ROOT }),
      get(`${origin}/llms.txt`, { accept: 'text/plain, text/markdown, */*;q=0.5', ...TEXT_ROOT }),
      get(`${origin}/llms-full.txt`, { accept: 'text/plain, text/markdown, */*;q=0.5', ...TEXT_ROOT }),
      // catch-all karsilastirmasi metin kok dosyalariyla ayni kosulda okunmali
      get(`${origin}${randomPath}`, { accept: 'text/plain, */*;q=0.5', maxBytes: 64 * 1024, ...TEXT_ROOT }),
      get(`${origin}/auth.md`, { accept: 'text/markdown, text/plain, */*;q=0.5', ...TEXT_ROOT }),
      get(`${origin}/.well-known/auth.md`, { accept: 'text/markdown, text/plain, */*;q=0.5', ...TEXT_ROOT }),
      get(`${origin}/openapi.json`, { accept: JSON_ACCEPT }),
      get(`${origin}/.well-known/api-catalog`, { accept: 'application/linkset+json, application/json;q=0.9, */*;q=0.5' }),
      get(`${origin}/.well-known/ai-catalog.json`, { accept: 'application/ai-catalog+json, application/json;q=0.9, */*;q=0.5' }),
      get(`${origin}/.well-known/agent-card.json`, { accept: JSON_ACCEPT }),
      get(`${origin}/.well-known/agent.json`, { accept: JSON_ACCEPT }),
      get(`${origin}/.well-known/mcp.json`, { accept: JSON_ACCEPT }),
      get(`${origin}/.well-known/mcp/server-card.json`, { accept: JSON_ACCEPT }),
      app?.appStoreId ? get(`${origin}/.well-known/apple-app-site-association`, { accept: JSON_ACCEPT }) : Promise.resolve(null),
    ]);

    // Sitemap kesfi: once robots.txt Sitemap satirlari, sonra standart konumlar
    const sitemap = await this.discoverSitemap(origin, robots, get);

    // SEP-2127: ai-catalog.json'daki MCP / A2A girdilerinin kartlari
    const catalog = aiCatalog.state === 'ok' && !looksLikeHtml(aiCatalog.text) ? parseAiCatalog(aiCatalog.text) : null;
    const entries = catalog?.ok ? catalog.entries : [];
    const mcpEntries = entries.filter((e) => e.type === MCP_SERVER_CARD_TYPE).slice(0, 3);
    const a2aEntries = entries.filter((e) => e.type === A2A_AGENT_CARD_TYPE).slice(0, 2);
    // Kart adresi okunamadiysa (engel, 404, 5xx) kart dogrulanmaz: undefined'i
    // dogrulamak "kart JSON nesnesi degil" diyordu. Engel / ulasilamazlik
    // kontrolde 'blocked' olur (agent-readiness-checks.ts), puan paydasindan duser.
    const [mcpCards, a2aCards, commerce] = await Promise.all([
      Promise.all(mcpEntries.map(async (e) => {
        const { probe, card } = await this.loadCatalogCard(e, 'application/mcp-server-card+json, application/json;q=0.9', get);
        return { identifier: e.identifier, url: e.url ?? null, probe, check: probe && probe.state !== 'ok' ? unreadableCard(probe) : validateMcpServerCard(card) };
      })),
      Promise.all(a2aEntries.map(async (e) => {
        const { probe, card } = await this.loadCatalogCard(e, 'application/a2a-agent-card+json, application/json;q=0.9', get);
        return {
          identifier: e.identifier, url: e.url ?? null, probe,
          check: probe && probe.state !== 'ok' ? { ...unreadableCard(probe), legacy: false, ranksupGenerated: false } : validateA2aAgentCard(card),
        };
      })),
      this.collectCommerce({ origin, siteUrl, niche: site.niche ?? null, home, sitemap }, get),
    ]);

    return {
      siteUrl,
      origin,
      brandName: site.name,
      niche: site.niche ?? null,
      llmsFullInDb: site.llmsFullTxt ? { at: site.llmsFullTxtAt ?? null } : null,
      trackedApp: app ? { name: app.name, appStoreId: app.appStoreId ?? null, playStoreId: app.playStoreId ?? null } : null,
      probes: { home, homeMd, robots, llms, llmsFull, catchAll, authMd, authMdWk, openapi, apiCatalog, aiCatalog, agentCard, agentLegacy, mcpLegacy, mcpLegacyCard, aasa },
      sitemap,
      mcpCards,
      a2aCards,
      commerce,
    };
  }

  /**
   * Ticaret olcumu: urun feed'leri GERCEKTEN yoklanir, Product schema
   * site haritasindan orneklenen en fazla 3 urun sayfasinda okunur. Plan saf
   * modulde (planCommerceProbes); ticaret ipucu yoksa hic istek atilmaz.
   * Tum istekler ayni sinirlayicidan (4 eszamanli) gecer.
   */
  private async collectCommerce(
    input: { origin: string; siteUrl: string; niche: string | null; home: Probe; sitemap: ScanContext['sitemap'] },
    get: (url: string, opts?: ProbeOptions) => Promise<Probe>,
  ): Promise<CommerceSignals> {
    const { origin } = input;
    const plan = planCommerceProbes({
      origin, siteUrl: input.siteUrl, niche: input.niche, sitemap: input.sitemap,
      homeHtml: input.home.state === 'ok' ? input.home.text : '',
    });
    if (!plan.hinted) return { productSitemap: null, productPages: [], feeds: [] };

    let productUrls = plan.productUrls;
    let productSitemap: CommerceSignals['productSitemap'] = null;
    if (plan.productSitemap) {
      const probe = await get(plan.productSitemap, { accept: XML_ACCEPT, maxBytes: 2 * 1024 * 1024 });
      productSitemap = { url: plan.productSitemap, probe };
      if (probe.state === 'ok' && sitemapKind(probe.text) === 'urlset') productUrls = productUrlsFromSubSitemap(probe.text, origin);
    }

    // Feed adresleri: Shopify ve WooCommerce yalniz izi varsa (ilk sayfa, 1 urun yeter);
    // WooCommerce Store API per_page destekler (https://developer.woocommerce.com/docs/apis/store-api/)
    const feedTargets: Array<{ kind: ProductFeedKind; url: string; accept: string }> = [
      ...(plan.shopify ? [{ kind: 'shopify' as const, url: `${origin}/products.json?limit=1`, accept: JSON_ACCEPT }] : []),
      ...(plan.woo ? [{ kind: 'woocommerce' as const, url: `${origin}/wp-json/wc/store/v1/products?per_page=1`, accept: JSON_ACCEPT }] : []),
      ...plan.feedCandidates.map((url) => ({ kind: 'merchant' as const, url, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' })),
    ];
    const [productPages, feeds] = await Promise.all([
      Promise.all(spreadSample(productUrls, 3).map(async (url) => ({ url, probe: await get(url, { accept: HTML_ACCEPT, maxBytes: HOME_MAX_BYTES }) }))),
      Promise.all(feedTargets.map(async (t) => ({ kind: t.kind, url: t.url, probe: await get(t.url, { accept: t.accept, ...TEXT_ROOT }) }))),
    ]);
    return { productSitemap, productPages, feeds };
  }

  private async discoverSitemap(origin: string, robots: Probe, get: (url: string, opts?: ProbeOptions) => Promise<Probe>): Promise<ScanContext['sitemap']> {
    const tried: ScanContext['sitemap']['tried'] = [];
    const candidates: Array<{ url: string; source: 'robots' | 'standard' }> = [];
    if (robots.state === 'ok' && ['ok', 'encoding'].includes(assessRobotsBody(robots.text))) {
      for (const u of robotsSitemapUrls(robots.text).slice(0, 3)) candidates.push({ url: u, source: 'robots' });
    }
    for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
      const u = `${origin}${path}`;
      if (!candidates.some((c) => c.url === u)) candidates.push({ url: u, source: 'standard' });
    }
    for (const c of candidates) {
      const probe = await get(c.url, { accept: 'application/xml, text/xml, */*;q=0.5', maxBytes: 2 * 1024 * 1024 });
      tried.push({ ...c, probe });
      if (probe.state !== 'ok') continue;
      const kind = sitemapKind(probe.text);
      if (kind) return { found: { url: c.url, kind, source: c.source, body: probe.text }, tried };
      // .xml.gz: metin olmadigi icin indirilmedi — varligi dogrulandi, icerigi degil
      if (probe.binary && /gzip/.test(probe.contentType)) return { found: { url: c.url, kind: 'gzip', source: c.source, body: '' }, tried };
    }
    return { found: null, tried };
  }

  private async loadCatalogCard(e: AiCatalogEntry, accept: string, get: (url: string, opts?: ProbeOptions) => Promise<Probe>): Promise<{ probe: Probe | null; card: unknown }> {
    if (e.data !== undefined) return { probe: null, card: e.data };
    const probe = await get(e.url!, { accept, maxBytes: 256 * 1024 });
    if (probe.state !== 'ok' || looksLikeHtml(probe.text)) return { probe, card: undefined };
    return { probe, card: parseJsonSafe(probe.text) };
  }
}
