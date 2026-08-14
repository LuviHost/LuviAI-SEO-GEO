import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { siteWhereForFeature } from '../billing/plan-site-filter.js';
import { readBodyCapped } from '../common/fetch-capped.js';

/**
 * Agent Readiness (AXO — Agent Experience Optimization) taramasi.
 *
 * GEO Score Card "AI arama motorlarinda GORUNUYOR musun" olcer;
 * bu servis "AI AJANLARI siteni OKUYABILIYOR/KULLANABILIYOR mu" olcer.
 * 2026 farki: ChatGPT/Claude/Perplexity artik kullanici adina gezinen
 * ajanlar calistiriyor — robots stance, agent card, auth.md, API katalogu,
 * markdown negotiation ve content signals bu ajanlarin ilk baktigi yerler.
 *
 * 4 seviye (Maya AXO paritesi + RanksUp farki: her kontrolun auto-fix'i var):
 *   L1 quick-wins   — robots.txt, sitemap, AI crawler kurallari, content signals, llms.txt
 *   L2 groundwork   — auth.md, API katalogu, llms-full.txt, Organization schema
 *   L3 advanced     — A2A agent card, MCP deklarasyonu, markdown negotiation (+ app kontrolleri)
 *   L4 commerce     — urun feed'i, Product schema, agentic checkout sinyali
 */

export interface ReadinessAuditStep {
  step: 'FETCH' | 'PARSE' | 'CONCLUDE';
  detail: string;
  ok: boolean;
}

export interface ReadinessCheck {
  id: string;
  name: string;
  ok: boolean;
  impact: 'high' | 'medium' | 'low';
  statusText: string;
  howTo: string;
  /** "Copy Agent Prompt" — kullanicinin kendi AI ajanina yapistiracagi talimat */
  agentPrompt?: string;
  audit: ReadinessAuditStep[];
  /** AutoFixService uzerinden tek tikla duzeltilebilir mi (fix anahtari) */
  fixKey?: string;
}

export interface ReadinessLevel {
  id: string;
  title: string;
  score: number; // 0-100
  earned: number;
  max: number;
  applicable: boolean;
  checks: ReadinessCheck[];
}

export interface AgentReadinessResult {
  overallScore: number;
  status: 'ready' | 'mostly_ready' | 'needs_work' | 'not_ready';
  levels: ReadinessLevel[];
  robotsAiStance: {
    allow: number;
    block: number;
    unspecified: number;
    bots: Array<{
      name: string;
      /** ACIK deklarasyon: bot isimle anilmis mi (allow/block), yoksa unspecified */
      stance: 'allow' | 'block' | 'unspecified';
      /** RFC 9309 etkin durum: isimle anilmayan bot `*` grubunun kuralina tabi */
      effective: 'allow' | 'block';
    }>;
  } | null;
  agentsAllowed: number | null;
  agentsTotal: number | null;
  nextUpToFix: Array<{ checkId: string; name: string; fixKey?: string }>;
  ranAt: string;
  durationMs: number;
}

/** Ajan stance'i olculen bilinen AI botlari (Maya "23/27" karsiligi) */
const KNOWN_AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'GoogleOther', 'Gemini-Deep-Research',
  'Applebot-Extended', 'Amazonbot', 'Bytespider', 'CCBot',
  'cohere-ai', 'cohere-training-data-crawler',
  'Meta-ExternalAgent', 'Meta-ExternalFetcher',
  'Diffbot', 'DuckAssistBot', 'YouBot',
  'MistralAI-User', 'AI2Bot', 'Timpibot', 'Omgilibot',
];

const IMPACT_POINTS: Record<ReadinessCheck['impact'], number> = { high: 3, medium: 2, low: 1 };

const FETCH_TIMEOUT_MS = 10_000;
const UA = 'RanksUpAgentReadiness/1.0 (+https://ranksup.ai)';

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
    const scan = await this.prisma.agentReadinessScan.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
    if (!scan) return null;
    return {
      id: scan.id,
      overallScore: scan.overallScore,
      status: scan.status,
      levels: scan.levels,
      robotsAiStance: scan.robotsAiStance,
      agentsAllowed: scan.agentsAllowed,
      agentsTotal: scan.agentsTotal,
      nextUpToFix: scan.nextUpToFix,
      ranAt: scan.ranAt,
      durationMs: scan.durationMs,
    };
  }

  /** Skor gecmisi — trend cizgisi icin */
  async history(siteId: string, days = 90) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 7), 365) * 86400_000);
    const scans = await this.prisma.agentReadinessScan.findMany({
      where: { siteId, ranAt: { gte: since } },
      orderBy: { ranAt: 'asc' },
      select: { ranAt: true, overallScore: true, agentsAllowed: true, agentsTotal: true },
    });
    return scans.map((s) => ({
      date: s.ranAt.toISOString().slice(0, 10),
      score: s.overallScore,
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
    const baseUrl = site.url.replace(/\/+$/, '');

    // ── Tek seferlik fetch'ler (kontroller paylasir)
    const [robots, homepageHtml, homepageMd, llmsTxt, sitemap] = await Promise.all([
      this.fetchText(`${baseUrl}/robots.txt`),
      this.fetchText(baseUrl, { Accept: 'text/html' }),
      this.fetchText(baseUrl, { Accept: 'text/markdown, text/plain;q=0.5' }),
      this.fetchText(`${baseUrl}/llms.txt`),
      this.fetchText(`${baseUrl}/sitemap.xml`),
    ]);

    const stance = robots.ok ? this.parseRobotsAiStance(robots.body) : null;
    const jsonLd = homepageHtml.ok ? this.extractJsonLd(homepageHtml.body) : [];

    // ── Seviyeler
    const l1 = await this.levelQuickWins(baseUrl, robots, sitemap, llmsTxt, stance);
    const l2 = await this.levelGroundwork(baseUrl, site, jsonLd);
    const l3 = await this.levelAdvanced(baseUrl, site, homepageHtml, homepageMd, jsonLd);
    const l4 = this.levelCommerce(site, jsonLd, homepageHtml);

    const levels = [l1, l2, l3, l4];
    const applicable = levels.filter((l) => l.applicable);
    const totalEarned = applicable.reduce((a, l) => a + l.earned, 0);
    const totalMax = applicable.reduce((a, l) => a + l.max, 0);
    const overall = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0;

    const status: AgentReadinessResult['status'] =
      overall >= 85 ? 'ready' : overall >= 65 ? 'mostly_ready' : overall >= 40 ? 'needs_work' : 'not_ready';

    // "Next up to fix" — basarisiz kontroller icinde etkisi en yuksek 3
    const failed = levels
      .filter((l) => l.applicable)
      .flatMap((l) => l.checks.filter((c) => !c.ok))
      .sort((a, b) => IMPACT_POINTS[b.impact] - IMPACT_POINTS[a.impact])
      .slice(0, 3);
    const nextUpToFix = failed.map((c) => ({ checkId: c.id, name: c.name, fixKey: c.fixKey }));

    const agentsTotal = KNOWN_AI_BOTS.length;
    // "Ziyaret edebilen ajan" sayisi ETKIN durustan hesaplanir (wildcard dahil)
    const agentsAllowed = stance ? stance.bots.filter((b) => b.effective === 'allow').length : null;

    const result: AgentReadinessResult = {
      overallScore: overall,
      status,
      levels,
      robotsAiStance: stance,
      agentsAllowed,
      agentsTotal: stance ? agentsTotal : null,
      nextUpToFix,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };

    // ── Persist + skor dususu bildirimi
    const prev = await this.prisma.agentReadinessScan.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
      select: { overallScore: true },
    });
    await this.prisma.agentReadinessScan.create({
      data: {
        siteId,
        overallScore: overall,
        status,
        levels: levels as any,
        robotsAiStance: stance as any,
        agentsAllowed,
        agentsTotal: stance ? agentsTotal : null,
        nextUpToFix: nextUpToFix as any,
        durationMs: result.durationMs,
      },
    });
    if (prev && prev.overallScore - overall >= 10) {
      await this.notifications.create({
        userId: site.userId,
        type: 'SYSTEM',
        title: `Agent Readiness skoru düştü: ${prev.overallScore} → ${overall}`,
        body: `${site.name} sitesinde AI ajan hazırlık skoru ${prev.overallScore - overall} puan geriledi. En kritik eksik: ${nextUpToFix[0]?.name ?? '—'}`,
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

  // ────────────────────────────────────────────────────────────
  //  L1 — QUICK WINS
  // ────────────────────────────────────────────────────────────
  private async levelQuickWins(
    baseUrl: string,
    robots: FetchResult,
    sitemap: FetchResult,
    llmsTxt: FetchResult,
    stance: AgentReadinessResult['robotsAiStance'],
  ): Promise<ReadinessLevel> {
    const checks: ReadinessCheck[] = [];

    // 1. robots.txt — bot davranis tercihi
    checks.push({
      id: 'robots-txt',
      name: 'Bot davranışı tercihleri (robots.txt)',
      ok: robots.ok,
      impact: 'high',
      statusText: robots.ok ? `robots.txt mevcut (${robots.status})` : 'robots.txt bulunamadı',
      howTo: 'Site köküne robots.txt ekle. RanksUp "Otomatik Düzelt" ile AI crawler kurallı bir robots.txt üretip yükler.',
      fixKey: 'robots_txt',
      audit: [
        { step: 'FETCH', detail: `GET /robots.txt → ${robots.status || 'erişilemedi'}`, ok: robots.ok },
        { step: 'CONCLUDE', detail: robots.ok ? 'Bot tercihi deklare edilmiş' : 'Ajanlar için hiçbir kural yok', ok: robots.ok },
      ],
    });

    // 2. Sitemap
    checks.push({
      id: 'sitemap',
      name: 'Ajanlara site haritası (sitemap.xml)',
      ok: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.body),
      impact: 'high',
      statusText: sitemap.ok ? 'sitemap.xml mevcut' : 'sitemap.xml bulunamadı',
      howTo: 'Site köküne sitemap.xml ekle ve robots.txt içinden referans ver. RanksUp otomatik üretebilir.',
      fixKey: 'sitemap_xml',
      audit: [
        { step: 'FETCH', detail: `GET /sitemap.xml → ${sitemap.status || 'erişilemedi'}`, ok: sitemap.ok },
        { step: 'PARSE', detail: sitemap.ok ? (/<urlset|<sitemapindex/i.test(sitemap.body) ? 'Geçerli XML urlset' : 'XML urlset değil') : '—', ok: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.body) },
      ],
    });

    // 3. AI bot yonetimi — bilinen AI crawler'lara acik stance
    const namedCount = stance ? stance.allow + stance.block : 0;
    const aiRulesOk = !!stance && namedCount >= 5;
    checks.push({
      id: 'ai-crawler-rules',
      name: 'AI botlarını yönet (AI Crawler Rules)',
      ok: aiRulesOk,
      impact: 'high',
      statusText: stance
        ? `robots.txt ${namedCount} AI crawler'ı isimle anıyor (${stance.allow} allow / ${stance.block} block)`
        : 'robots.txt okunamadığı için stance yok',
      howTo: 'GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot gibi AI crawler\'lar için robots.txt\'de açık User-agent blokları tanımla — izin ver ya da engelle, ama bilinçli olsun.',
      agentPrompt: `Fetch ${baseUrl}/robots.txt and list which of these AI crawlers have an explicit User-agent block: ${KNOWN_AI_BOTS.slice(0, 10).join(', ')}. For each, state allow or block.`,
      fixKey: 'robots_txt',
      audit: [
        { step: 'FETCH', detail: `GET /robots.txt → ${robots.status || 'erişilemedi'}`, ok: robots.ok },
        { step: 'PARSE', detail: stance ? `Bilinen AI user-agent taraması: ${stance.bots.filter((b) => b.stance !== 'unspecified').map((b) => b.name).slice(0, 8).join(', ') || 'hiçbiri'}` : '—', ok: aiRulesOk },
        { step: 'CONCLUDE', detail: aiRulesOk ? 'AI crawler kuralları deklare edilmiş' : 'AI crawler\'lar için açık kural yok', ok: aiRulesOk },
      ],
    });

    // 4. Content Signals — icerigin nasil kullanilabilecegi
    const contentSignals = robots.ok && /content-signal\s*:/i.test(robots.body);
    checks.push({
      id: 'content-signals',
      name: 'İçerik kullanım sinyalleri (Content Signals)',
      ok: contentSignals,
      impact: 'medium',
      statusText: contentSignals ? 'Content-Signal satırı mevcut' : 'Content-Signal deklare edilmemiş',
      howTo: 'robots.txt\'e `Content-Signal: search=yes, ai-input=yes, ai-train=no` benzeri bir satır ekleyerek içeriğinin arama, AI cevabı ve eğitimde nasıl kullanılabileceğini deklare et (Cloudflare Content Signals Policy).',
      fixKey: 'robots_txt',
      audit: [
        { step: 'PARSE', detail: contentSignals ? 'Content-Signal: satırı bulundu' : 'robots.txt içinde Content-Signal yok', ok: contentSignals },
      ],
    });

    // 5. llms.txt — AI-optimize metin ozeti
    const llmsOk = llmsTxt.ok && llmsTxt.body.trim().startsWith('#');
    checks.push({
      id: 'llms-txt',
      name: 'AI-optimize özet (llms.txt)',
      ok: llmsOk,
      impact: 'medium',
      statusText: llmsOk ? 'llms.txt mevcut ve markdown formatında' : 'llms.txt yok',
      howTo: 'Site köküne markdown formatında llms.txt ekle — AI asistanların markanı doğru özetlemesi için yapılandırılmış kaynak. RanksUp otomatik üretir.',
      fixKey: 'llms_txt',
      audit: [
        { step: 'FETCH', detail: `GET /llms.txt → ${llmsTxt.status || 'erişilemedi'}`, ok: llmsTxt.ok },
        { step: 'PARSE', detail: llmsOk ? 'Markdown başlığıyla başlıyor' : 'Markdown formatı doğrulanamadı', ok: llmsOk },
      ],
    });

    return this.buildLevel('quick-wins', 'Hızlı Kazanımlar', checks, true);
  }

  // ────────────────────────────────────────────────────────────
  //  L2 — TECHNICAL GROUNDWORK
  // ────────────────────────────────────────────────────────────
  private async levelGroundwork(
    baseUrl: string,
    site: any,
    jsonLd: any[],
  ): Promise<ReadinessLevel> {
    const checks: ReadinessCheck[] = [];

    // 1. auth.md — ajanlar icin giris talimati
    const [authMd, wellKnownAuthMd] = await Promise.all([
      this.fetchText(`${baseUrl}/auth.md`),
      this.fetchText(`${baseUrl}/.well-known/auth.md`),
    ]);
    const authOk = authMd.ok || wellKnownAuthMd.ok;
    checks.push({
      id: 'auth-md',
      name: 'AI botları için giriş talimatı (auth.md)',
      ok: authOk,
      impact: 'medium',
      statusText: authOk ? `auth.md mevcut (${authMd.ok ? '/auth.md' : '/.well-known/auth.md'})` : 'auth.md bulunamadı',
      howTo: 'Kullanıcı adına işlem yapan ajanların (ChatGPT Operator, Claude) sitene nasıl giriş yapacağını anlatan bir auth.md yayınla: login URL\'i, hangi alanlar, 2FA akışı, API token alternatifi.',
      agentPrompt: `Fetch ${baseUrl}/auth.md — does it describe how an AI agent should authenticate on this site (login URL, fields, MFA, API tokens)?`,
      fixKey: 'auth_md',
      audit: [
        { step: 'FETCH', detail: `GET /auth.md → ${authMd.status || 'yok'}; GET /.well-known/auth.md → ${wellKnownAuthMd.status || 'yok'}`, ok: authOk },
      ],
    });

    // 2. API katalogu — ajanlarin kesfedebilecegi servis dizini
    const [openapi, apiCatalog] = await Promise.all([
      this.fetchText(`${baseUrl}/openapi.json`),
      this.fetchText(`${baseUrl}/.well-known/api-catalog`),
    ]);
    const apiOk = (openapi.ok && openapi.body.includes('openapi')) || apiCatalog.ok;
    checks.push({
      id: 'api-catalog',
      name: 'Web servis dizini (API Catalog)',
      ok: apiOk,
      impact: 'medium',
      statusText: apiOk
        ? (openapi.ok ? 'openapi.json mevcut' : '.well-known/api-catalog mevcut')
        : 'API kataloğu bulunamadı',
      howTo: 'API\'n varsa /openapi.json veya RFC 9727 uyumlu /.well-known/api-catalog yayınla — ajanlar servislerini keşfedip kullanabilsin. API\'n yoksa bu kontrol düşük öncelikli.',
      audit: [
        { step: 'FETCH', detail: `GET /openapi.json → ${openapi.status || 'yok'}; GET /.well-known/api-catalog → ${apiCatalog.status || 'yok'}`, ok: apiOk },
      ],
    });

    // 3. llms-full.txt — tum icerik konsolide
    const llmsFullOk = !!site.llmsFullTxt;
    checks.push({
      id: 'llms-full',
      name: 'Konsolide içerik (llms-full.txt)',
      ok: llmsFullOk,
      impact: 'medium',
      statusText: llmsFullOk
        ? `Mevcut — son üretim: ${site.llmsFullTxtAt ? new Date(site.llmsFullTxtAt).toISOString().slice(0, 10) : '?'}`
        : 'llms-full.txt henüz üretilmedi',
      howTo: 'GEO Lab → llms-full.txt üret. Tüm site içeriğini tek markdown dosyasında ajanlara sunar; haftalık otomatik yenilenir.',
      audit: [
        { step: 'CONCLUDE', detail: llmsFullOk ? 'DB\'de cache\'li, haftalık rebuild aktif' : 'Üretilmemiş', ok: llmsFullOk },
      ],
    });

    // 4. Organization schema + sameAs — ajanin kimlik dogrulamasi
    const org = jsonLd.find((s) => {
      const t = Array.isArray(s?.['@type']) ? s['@type'] : [s?.['@type']];
      return t.includes('Organization') || t.includes('LocalBusiness');
    });
    const sameAsCount = Array.isArray(org?.sameAs) ? org.sameAs.length : 0;
    const orgOk = !!org && sameAsCount >= 2;
    checks.push({
      id: 'org-schema',
      name: 'Kimlik grafiği (Organization + sameAs)',
      ok: orgOk,
      impact: 'medium',
      statusText: org
        ? `Organization schema var, ${sameAsCount} sameAs profili`
        : 'Ana sayfada Organization schema yok',
      howTo: 'Ana sayfaya Organization JSON-LD ekle ve sameAs ile sosyal/dizin profillerini bağla — ajanlar markanın kimliğini bu graf üzerinden doğrular.',
      audit: [
        { step: 'PARSE', detail: `Ana sayfada ${jsonLd.length} JSON-LD bloğu; Organization: ${org ? 'var' : 'yok'}`, ok: !!org },
        { step: 'CONCLUDE', detail: orgOk ? 'Kimlik grafiği yeterli' : 'sameAs profilleri eksik (en az 2 önerilir)', ok: orgOk },
      ],
    });

    return this.buildLevel('groundwork', 'Teknik Zemin', checks, true);
  }

  // ────────────────────────────────────────────────────────────
  //  L3 — ADVANCED INTEGRATION
  // ────────────────────────────────────────────────────────────
  private async levelAdvanced(
    baseUrl: string,
    site: any,
    homepageHtml: FetchResult,
    homepageMd: FetchResult,
    jsonLd: any[],
  ): Promise<ReadinessLevel> {
    const checks: ReadinessCheck[] = [];

    // 1. A2A Agent Card
    const [agentJson, agentCardJson] = await Promise.all([
      this.fetchText(`${baseUrl}/.well-known/agent.json`),
      this.fetchText(`${baseUrl}/.well-known/agent-card.json`),
    ]);
    const cardRaw = agentJson.ok ? agentJson.body : agentCardJson.ok ? agentCardJson.body : null;
    let cardValid = false;
    if (cardRaw) {
      try { const c = JSON.parse(cardRaw); cardValid = !!(c.name && (c.url || c.skills || c.capabilities)); } catch { /* gecersiz json */ }
    }
    checks.push({
      id: 'a2a-agent-card',
      name: 'A2A Agent Card (.well-known/agent.json)',
      ok: cardValid,
      impact: 'medium',
      statusText: cardValid ? 'Geçerli agent card yayında' : cardRaw ? 'Dosya var ama şema eksik' : 'Agent card yok',
      howTo: 'A2A protokolü uyumlu bir agent card yayınla (.well-known/agent.json): ad, açıklama, url, skills. Ajanlar siteni bir "hizmet" olarak keşfedebilir. RanksUp taslak üretir.',
      agentPrompt: `Fetch ${baseUrl}/.well-known/agent.json and validate it as an A2A agent card (name, description, url, skills).`,
      fixKey: 'agent_json',
      audit: [
        { step: 'FETCH', detail: `GET /.well-known/agent.json → ${agentJson.status || 'yok'}; agent-card.json → ${agentCardJson.status || 'yok'}`, ok: !!cardRaw },
        { step: 'PARSE', detail: cardValid ? 'name + url/skills alanları geçerli' : 'Geçerli A2A şeması değil', ok: cardValid },
      ],
    });

    // 2. MCP deklarasyonu
    const mcpJson = await this.fetchText(`${baseUrl}/.well-known/mcp.json`);
    let mcpValid = false;
    if (mcpJson.ok) {
      try { const m = JSON.parse(mcpJson.body); mcpValid = !!(m.servers || m.endpoint || m.mcpServers); } catch { /* gecersiz */ }
    }
    checks.push({
      id: 'mcp-declaration',
      name: 'MCP sunucu deklarasyonu (.well-known/mcp.json)',
      ok: mcpValid,
      impact: 'low',
      statusText: mcpValid ? 'MCP endpoint deklare edilmiş' : 'MCP deklarasyonu yok',
      howTo: 'Bir MCP sunucun varsa /.well-known/mcp.json ile deklare et — Claude/ChatGPT kullanıcıları servislerini doğrudan bağlayabilir. Yoksa düşük öncelikli.',
      audit: [
        { step: 'FETCH', detail: `GET /.well-known/mcp.json → ${mcpJson.status || 'yok'}`, ok: mcpJson.ok },
        { step: 'PARSE', detail: mcpValid ? 'servers/endpoint alanı mevcut' : 'Geçerli MCP deklarasyonu değil', ok: mcpValid },
      ],
    });

    // 3. Markdown negotiation — Accept: text/markdown
    const mdNegotiation = homepageMd.ok && (
      /^text\/(markdown|plain)/i.test(homepageMd.contentType) ||
      (!/<html/i.test(homepageMd.body.slice(0, 500)) && /^#{1,3}\s/m.test(homepageMd.body))
    );
    checks.push({
      id: 'markdown-negotiation',
      name: 'AI-optimize format sunumu (Markdown Negotiation)',
      ok: mdNegotiation,
      impact: 'low',
      statusText: mdNegotiation
        ? `Accept: text/markdown → ${homepageMd.contentType || 'markdown içerik'}`
        : 'Sunucu markdown varyantı sunmuyor',
      howTo: '`Accept: text/markdown` başlığıyla gelen isteklere sayfanın markdown halini döndür — token maliyetini düşürür, ajan parse hatalarını azaltır. (Cloudflare "Markdown for Agents" veya edge middleware ile.)',
      agentPrompt: `Request ${baseUrl} with header "Accept: text/markdown" and report whether the response is markdown instead of HTML.`,
      audit: [
        { step: 'FETCH', detail: `GET / (Accept: text/markdown) → ${homepageMd.status || 'erişilemedi'}, Content-Type: ${homepageMd.contentType || '?'}`, ok: homepageMd.ok },
        { step: 'CONCLUDE', detail: mdNegotiation ? 'Markdown varyantı sunuluyor' : 'HTML döndü — markdown negotiation yok', ok: mdNegotiation },
      ],
    });

    // 4-5. Mobil app kontrolleri (site bir app izliyorsa — GEO ⨉ ASO kesisimi)
    if (site.trackedApps?.length > 0) {
      const app = site.trackedApps[0];

      const softwareApp = jsonLd.find((s) => {
        const t = Array.isArray(s?.['@type']) ? s['@type'] : [s?.['@type']];
        return t.includes('SoftwareApplication') || t.includes('MobileApplication');
      });
      checks.push({
        id: 'app-schema',
        name: 'Uygulama schema\'sı (SoftwareApplication)',
        ok: !!softwareApp,
        impact: 'medium',
        statusText: softwareApp ? 'SoftwareApplication/MobileApplication JSON-LD mevcut' : 'Uygulama schema\'sı yok',
        howTo: `Ana sayfaya (veya /app sayfasına) MobileApplication JSON-LD ekle: name "${app.name}", operatingSystem, applicationCategory, aggregateRating ve store URL'leri. AI asistanların "${app.name}" uygulamasını önermesi için web'de okunabilir kimlik şart.`,
        audit: [
          { step: 'PARSE', detail: `Ana sayfa JSON-LD: SoftwareApplication ${softwareApp ? 'bulundu' : 'bulunamadı'}`, ok: !!softwareApp },
        ],
      });

      const html = homepageHtml.ok ? homepageHtml.body : '';
      const hasAppStoreLink = app.appStoreId ? html.includes('apps.apple.com') : true;
      const hasPlayLink = app.playStoreId ? html.includes('play.google.com') : true;
      const storeLinksOk = homepageHtml.ok && hasAppStoreLink && hasPlayLink;
      checks.push({
        id: 'app-store-links',
        name: 'Store linkleri web\'de görünür',
        ok: storeLinksOk,
        impact: 'low',
        statusText: storeLinksOk ? 'App Store / Play Store linkleri ana sayfada' : 'Store linkleri ana sayfada bulunamadı',
        howTo: 'Ana sayfadan App Store ve Play Store\'a giden düz <a> linkleri ver — ajanlar app-web ilişkisini bu linklerden kurar.',
        audit: [
          { step: 'PARSE', detail: `apps.apple.com: ${html.includes('apps.apple.com') ? 'var' : 'yok'}; play.google.com: ${html.includes('play.google.com') ? 'var' : 'yok'}`, ok: storeLinksOk },
        ],
      });

      if (app.appStoreId) {
        const aasa = await this.fetchText(`${baseUrl}/.well-known/apple-app-site-association`);
        let aasaValid = false;
        if (aasa.ok) {
          try { const a = JSON.parse(aasa.body); aasaValid = !!(a.applinks || a.webcredentials); } catch { /* gecersiz */ }
        }
        checks.push({
          id: 'aasa',
          name: 'Universal Links (apple-app-site-association)',
          ok: aasaValid,
          impact: 'low',
          statusText: aasaValid ? 'AASA dosyası geçerli' : 'AASA yok veya geçersiz',
          howTo: '/.well-known/apple-app-site-association yayınla — derin linkler ajan akışlarında (ör. "uygulamada aç") doğru çalışır ve Apple app-site ilişkisini doğrular.',
          audit: [
            { step: 'FETCH', detail: `GET /.well-known/apple-app-site-association → ${aasa.status || 'yok'}`, ok: aasa.ok },
            { step: 'PARSE', detail: aasaValid ? 'applinks tanımlı' : 'Geçerli AASA JSON değil', ok: aasaValid },
          ],
        });
      }
    }

    return this.buildLevel('advanced', 'İleri Entegrasyon', checks, true);
  }

  // ────────────────────────────────────────────────────────────
  //  L4 — COMMERCE
  // ────────────────────────────────────────────────────────────
  private levelCommerce(site: any, jsonLd: any[], homepageHtml: FetchResult): ReadinessLevel {
    const checks: ReadinessCheck[] = [];
    const html = homepageHtml.ok ? homepageHtml.body : '';

    const productLd = jsonLd.find((s) => {
      const t = Array.isArray(s?.['@type']) ? s['@type'] : [s?.['@type']];
      return t.includes('Product');
    });
    const ecommerceNiche = /ecommerce|e-ticaret|shop|store|market/i.test(String(site.niche ?? ''));
    const shopifySignal = /cdn\.shopify|myshopify/i.test(html);
    const applicable = ecommerceNiche || !!productLd || shopifySignal;

    checks.push({
      id: 'product-schema',
      name: 'Product schema + offers',
      ok: !!productLd && !!(productLd.offers),
      impact: 'high',
      statusText: productLd ? (productLd.offers ? 'Product + offers mevcut' : 'Product var ama offers eksik') : 'Product schema yok',
      howTo: 'Ürün sayfalarına Product JSON-LD ekle: name, image, offers (price, priceCurrency, availability). Agentic alışverişin ön koşulu.',
      audit: [
        { step: 'PARSE', detail: `Ana sayfa JSON-LD: Product ${productLd ? 'bulundu' : 'bulunamadı'}`, ok: !!productLd },
      ],
    });

    checks.push({
      id: 'product-feed',
      name: 'Makine-okunur ürün feed\'i',
      ok: shopifySignal, // Shopify /products.json otomatik sunar; digerlerinde feed tespiti icin sinyal yok
      impact: 'medium',
      statusText: shopifySignal ? 'Shopify products.json mevcut' : 'Ürün feed\'i tespit edilemedi',
      howTo: 'Ajanların ürün kataloğunu tek istekle çekebileceği bir feed sun: /products.json, Google Merchant feed veya OpenAI Agentic Commerce ürün feed\'i.',
      audit: [
        { step: 'PARSE', detail: shopifySignal ? 'Shopify altyapı sinyali var' : 'Bilinen feed sinyali yok', ok: shopifySignal },
      ],
    });

    checks.push({
      id: 'agentic-checkout',
      name: 'Agentic checkout hazırlığı (ACP)',
      ok: false, // deklarasyon standardi yeni — tespit sinyali su an yok, howTo rehberligi asil deger
      impact: 'low',
      statusText: 'Agentic Commerce Protocol entegrasyonu tespit edilemedi',
      howTo: 'OpenAI Agentic Commerce Protocol (ACP) veya Shopify "Buy for me" akışına hazırlan: ürün feed\'i + delegated checkout endpoint\'i. ChatGPT içi satın alma bu kanaldan geliyor.',
      audit: [
        { step: 'CONCLUDE', detail: 'ACP endpoint deklarasyonu bulunamadı', ok: false },
      ],
    });

    return this.buildLevel('commerce', 'Ticaret (Agentic Commerce)', checks, applicable);
  }

  // ────────────────────────────────────────────────────────────
  //  YARDIMCILAR
  // ────────────────────────────────────────────────────────────

  private buildLevel(id: string, title: string, checks: ReadinessCheck[], applicable: boolean): ReadinessLevel {
    const max = checks.reduce((a, c) => a + IMPACT_POINTS[c.impact], 0);
    const earned = checks.reduce((a, c) => a + (c.ok ? IMPACT_POINTS[c.impact] : 0), 0);
    return {
      id,
      title,
      score: max > 0 ? Math.round((earned / max) * 100) : 0,
      earned,
      max,
      applicable,
      checks,
    };
  }

  /**
   * robots.txt icinden bilinen AI botlarinin stance'ini cikarir.
   * Grup mantigi: "User-agent: X" satirlarini takip eden Allow/Disallow kurallari
   * o gruba aittir. "Disallow: /" = block, aksi halde allow. Ismi gecmeyen bot
   * "unspecified" — `*` grubunun kuralina tabi olur ama biz acik deklarasyonu olceriz.
   */
  parseRobotsAiStance(robotsTxt: string): NonNullable<AgentReadinessResult['robotsAiStance']> {
    const groups = new Map<string, string[]>(); // lower(bot) -> rules
    let currentAgents: string[] = [];
    let rulesOpen = false;

    for (const rawLine of robotsTxt.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [keyRaw, ...rest] = line.split(':');
      const key = keyRaw.trim().toLowerCase();
      const value = rest.join(':').trim();

      if (key === 'user-agent') {
        if (rulesOpen) currentAgents = []; // yeni grup basliyor
        rulesOpen = false;
        currentAgents.push(value.toLowerCase());
        for (const a of currentAgents) if (!groups.has(a)) groups.set(a, []);
      } else if (key === 'allow' || key === 'disallow') {
        rulesOpen = true;
        for (const a of currentAgents) groups.get(a)?.push(`${key}:${value}`);
      }
    }

    const stanceOf = (rules: string[] | undefined): 'allow' | 'block' | null => {
      if (!rules || rules.length === 0) return null;
      // Tam kapatma: "disallow:/" (path'siz disallow allow anlamina gelir)
      const fullBlock = rules.some((r) => r === 'disallow:/');
      const hasAllow = rules.some((r) => r.startsWith('allow:'));
      if (fullBlock && !hasAllow) return 'block';
      return 'allow';
    };

    // `*` grubunun durusu — isimle anilmayan botlarin ETKIN durumunu belirler
    // (RFC 9309: ozel grup yoksa wildcard grup gecerlidir). "User-agent: *
    // Disallow: /" olan bir sitede isimsiz botlar giremez; onceden bunlar
    // "unspecified = izinli" sayilip 27/27 gosteriliyordu — tam tersiydi.
    const wildcard = stanceOf(groups.get('*'));

    const bots = KNOWN_AI_BOTS.map((name) => {
      const own = stanceOf(groups.get(name.toLowerCase()));
      const stance = own ?? ('unspecified' as const);
      // robots.txt hic kural icermiyorsa varsayilan: erisim serbest
      const effective = own ?? wildcard ?? ('allow' as const);
      return { name, stance, effective };
    });

    return {
      allow: bots.filter((b) => b.stance === 'allow').length,
      block: bots.filter((b) => b.stance === 'block').length,
      unspecified: bots.filter((b) => b.stance === 'unspecified').length,
      bots,
    };
  }

  private extractJsonLd(html: string): any[] {
    const out: any[] = [];
    const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed)) out.push(...parsed);
        else if (parsed?.['@graph']) out.push(...(Array.isArray(parsed['@graph']) ? parsed['@graph'] : []));
        else out.push(parsed);
      } catch { /* bozuk JSON-LD atla */ }
    }
    return out;
  }

  private async fetchText(url: string, headers: Record<string, string> = {}): Promise<FetchResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 500 KB'a kirpiliyordu ama INDIRDIKTEN sonra; tavan artik okuma aninda.
      const body = res.ok ? ((await readBodyCapped(res, 500_000))?.text ?? '') : '';
      return {
        ok: res.ok,
        status: res.status,
        body: body.slice(0, 500_000),
        contentType: res.headers.get('content-type') ?? '',
      };
    } catch {
      return { ok: false, status: 0, body: '', contentType: '' };
    }
  }
}

interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
  contentType: string;
}
