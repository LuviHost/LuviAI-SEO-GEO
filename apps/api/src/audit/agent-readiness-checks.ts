import * as cheerio from 'cheerio';
import { KNOWN_AI_BOTS, STANCE_SCORED_BOTS } from './known-ai-bots.js';
import { parseRobotsAiStance, type RobotsAiStance } from './robots-ai-stance.js';
import { assessJsFreeDiscovery } from './js-free-discovery.js';
import { describeProbe, isUnmeasured, type Probe } from './axo-fetch.js';
import { assessRobotsBody } from './robots-merge.js';
import {
  validateTextDoc, validateLlmsTxt, validateLlmsFullTxt, validateOpenApiDoc, validateApiCatalog,
  parseAiCatalog, isRanksUpLegacyAuthMd, looksLikeHtml, parseJsonSafe, DOC_FAILURE_TEXT,
  MCP_SERVER_CARD_TYPE, type CardCheck, type A2aCardCheck, validateA2aAgentCard,
} from './axo-validators.js';
import { collectTypedNodes, findOrganizationNode, normalizeSchemaType, schemaTypesOf } from './schema-org-types.js';
import { assessOperability } from './operability.js';
import { authMdTemplate } from './generators.service.js';

/**
 * Agent Readiness (AXO) kontrolleri — SAF (I/O yok). Servis istekleri yapar,
 * sonuclari ScanContext olarak buraya verir; seviyeler ve skor burada uretilir.
 *
 * SKOR METODOLOJISI v3 (2026-10):
 *  - Engel ≠ eksik: WAF/challenge/401/429/503 ya da ulasilamazlik → kontrol
 *    'blocked' olur ve puan paydasindan DUSER. Ana sayfa ya da robots.txt
 *    engelliyse tarama durumu 'blocked'/'unreachable' — dusuk skor gosterilmez.
 *  - Soft-404: SPA/catch-all 200 + HTML artik "dosya var" sayilmaz; her dosya
 *    kendi bicimine gore dogrulanir (axo-validators.ts).
 *  - Arayuze bagli kontroller (auth.md, API katalogu, A2A, MCP) YALNIZ site o
 *    arayuzu sunuyorsa puanlanir; sunmuyorsa 'info' (0 puan). Yerel isletme
 *    ajan arayuzu olmadigi icin cezalandirilmaz:
 *      · API katalogu: openapi.json ya da api-catalog yayinda (gecerli ya da bozuk)
 *      · MCP: ai-catalog.json'da MCP girdisi var
 *      · A2A: (RanksUp'in eski uretimi olmayan) bir ajan karti var
 *      · auth.md: bunlardan herhangi biri var
 *  - llms-full canli siteden olculur (DB kopyasi yalniz ipucu), etkisi llms.txt
 *    ile ayni (low): ayni zayif kanit tabani.
 *  - agentic-checkout 'info': dis sinyalden tespit edilemiyor; her ticaret
 *    sitesini cezalandiriyordu.
 *  - Ticaret: urun feed'i YALNIZ gercekten okunup dogrulandiginda puanlanir
 *    (Shopify /products.json, WooCommerce Store API, sitede duyurulan Google
 *    Merchant feed'i); yoksa 'info' — Merchant Center'a dogrudan yuklenen
 *    feed disaridan gorunmez. Product schema site haritasindan orneklenen
 *    urun sayfalarinda olculur; orneklenemezse 'info' (yalniz ana sayfaya
 *    bakip "eksik" demek, urun sayfasinda schema'si olan magazayi
 *    cezalandiriyordu). Ticaret nisi tam kelimeyle eslesir.
 *  - ai-catalog'daki MCP / A2A kartinin adresi engelliyse kontrol 'blocked'
 *    (eksik degil) ve o girdi auth.md'yi puanlatan arayuz kaniti sayilmaz.
 *  - Isletilebilirlik sinyalleri (tel/WhatsApp, form anlamlari, gomulu
 *    rezervasyon, WebMCP) 'info' — esikler gercek dagilim gorulmeden puanlanmaz.
 * v2 (2026-08): user-triggered fetcher'lar stance skorundan cikti, llms.txt low.
 */
export const SCORE_VERSION = 3;

/** ai-crawler-rules esigi — v2 tabani 21 bot, esik 4 */
export const AI_RULES_MIN_NAMED = 4;

export interface ReadinessAuditStep {
  step: 'FETCH' | 'PARSE' | 'CONCLUDE';
  detail: string;
  ok: boolean;
}

export type CheckImpact = 'high' | 'medium' | 'low' | 'info';
export type CheckState = 'pass' | 'fail' | 'blocked' | 'info';

export interface CheckBlockInfo {
  /** BlockKind ('waf', 'challenge'...) ya da SafeFetchError kodu ('timeout'...) */
  kind: string;
  reason: string;
  hint: string;
  status: number;
  vendor: string | null;
}

export interface ReadinessCheck {
  id: string;
  name: string;
  ok: boolean;
  /** 'info' = puansiz gozlem kontrolu — skora ve nextUpToFix'e girmez */
  impact: CheckImpact;
  statusText: string;
  howTo: string;
  /** "Copy Agent Prompt" — kullanicinin kendi AI ajanina yapistiracagi talimat */
  agentPrompt?: string;
  audit: ReadinessAuditStep[];
  /** Onizlemeli otomatik duzeltme anahtari — engellenen kontrolde YOK */
  fixKey?: string;
  /** v3: sonucun turu (buildLevel doldurur) — 'blocked' puan paydasindan duser */
  state?: CheckState;
  /** v3: erisim engeli / ulasilamazlik — gerekce + site sahibine ipucu */
  blocked?: CheckBlockInfo;
  /** v3: kontrol neden puana girmiyor (ör. API arayuzu yok) */
  scoreNote?: string;
  /** v3: elle kullanim sablonu — her bilinmeyen deger acik yer tutucu */
  manualTemplate?: { filename: string; content: string; note: string };
}

export interface ReadinessLevel {
  id: string;
  title: string;
  score: number; // 0-100
  earned: number;
  max: number;
  applicable: boolean;
  checks: ReadinessCheck[];
  /** v3: puanlanan (info/blocked olmayan) kontrol sayisi */
  scoredChecks?: number;
  passedChecks?: number;
  blockedChecks?: number;
}

export type ReadinessStatus = 'ready' | 'mostly_ready' | 'needs_work' | 'not_ready' | 'blocked' | 'unreachable';

export interface AccessSummary {
  state: 'blocked' | 'unreachable';
  scope: 'homepage' | 'robots' | 'homepage+robots';
  reason: string;
  hint: string;
  vendor: string | null;
  status: number;
}

export interface ScanContext {
  siteUrl: string;
  origin: string;
  brandName: string;
  niche: string | null;
  /** RanksUp DB'sinde llms-full.txt uretilmis mi (yalniz ipucu) */
  llmsFullInDb: { at: Date | null } | null;
  trackedApp: { name: string; appStoreId?: string | null; playStoreId?: string | null } | null;
  probes: {
    home: Probe; homeMd: Probe; robots: Probe; llms: Probe; llmsFull: Probe; catchAll: Probe;
    authMd: Probe; authMdWk: Probe; openapi: Probe; apiCatalog: Probe; aiCatalog: Probe;
    agentCard: Probe; agentLegacy: Probe; mcpLegacy: Probe; mcpLegacyCard: Probe;
    aasa: Probe | null;
  };
  sitemap: {
    found: { url: string; kind: 'urlset' | 'sitemapindex' | 'gzip'; source: 'robots' | 'standard'; body: string } | null;
    tried: Array<{ url: string; probe: Probe; source: 'robots' | 'standard' }>;
  };
  /** ai-catalog.json'daki MCP girdilerinin kartlari (servis cekip dogrular) */
  mcpCards: Array<{ identifier: string; url: string | null; probe: Probe | null; check: CardCheck }>;
  /** ai-catalog.json'daki A2A girdilerinin kartlari */
  a2aCards: Array<{ identifier: string; url: string | null; probe: Probe | null; check: A2aCardCheck }>;
  /** v3 ticaret olcumu (servis ceker, burada degerlendirilir); yoksa hicbir sey yoklanmamis sayilir */
  commerce?: CommerceSignals;
}

export type ProductFeedKind = 'shopify' | 'woocommerce' | 'merchant';

export interface CommerceSignals {
  /** Urun alt site haritasi okunduysa yoklamasi (denetim adimi icin) */
  productSitemap: { url: string; probe: Probe } | null;
  /** Site haritasindan orneklenen urun sayfalari (en fazla 3) */
  productPages: Array<{ url: string; probe: Probe }>;
  /** Gercekten yoklanan urun feed'leri — gecerliligine burada bakilir */
  feeds: Array<{ kind: ProductFeedKind; url: string; probe: Probe }>;
}

export const IMPACT_POINTS: Record<CheckImpact, number> = { high: 3, medium: 2, low: 1, info: 0 };

const BLOCK_KINDS = new Set(['waf', 'challenge', 'auth', 'rate_limited', 'forbidden', 'unavailable']);

const INTERFACE_NOTE = 'Sitede bu arayüz tespit edilmedi; bu kontrol yalnız site ilgili API/ajan arayüzünü sunuyorsa puanlanır.';

function blockedOf(p: Probe | null | undefined): CheckBlockInfo | undefined {
  if (!p || !isUnmeasured(p) || !p.block) return undefined;
  return { kind: p.block.kind, reason: p.block.reason, hint: p.block.hint, status: p.block.status, vendor: p.block.vendor };
}

/** Site var olmayan yola da 200 + govde donuyorsa o govde (catch-all) */
function catchAllBody(ctx: ScanContext): string | null {
  const c = ctx.probes.catchAll;
  return c.state === 'ok' && c.text.trim() ? c.text : null;
}

const fetchStep = (path: string, p: Probe): ReadinessAuditStep => ({ step: 'FETCH', detail: `GET ${path} → ${describeProbe(p)}`, ok: p.state === 'ok' });

function pathOf(url: string, origin: string): string {
  return url.startsWith(origin) ? url.slice(origin.length) || '/' : url;
}

// ────────────────────────────────────────────────────────────
//  L1 — QUICK WINS
// ────────────────────────────────────────────────────────────

interface RobotsView { valid: boolean; text: string; stance: RobotsAiStance | null; invalidText: string | null }

export function robotsView(ctx: ScanContext): RobotsView {
  const r = ctx.probes.robots;
  if (r.state !== 'ok') return { valid: false, text: '', stance: null, invalidText: null };
  const body = assessRobotsBody(r.text);
  const ca = catchAllBody(ctx);
  if (ca && ca.trim() === r.text.trim()) return { valid: false, text: r.text, stance: null, invalidText: 'robots.txt yerine sitenin her yola verdiği aynı yanıt dönüyor (catch-all) — gerçek bir robots.txt yok' };
  if (body === 'html') return { valid: false, text: r.text, stance: null, invalidText: 'robots.txt yerine HTML sayfa dönüyor (soft-404 / catch-all) — gerçek bir robots.txt yok' };
  if (body === 'empty') return { valid: false, text: r.text, stance: null, invalidText: 'robots.txt boş — hiçbir yönerge yok' };
  if (body === 'invalid') return { valid: false, text: r.text, stance: null, invalidText: 'robots.txt geçerli bir yönerge (User-agent / Allow / Disallow / Sitemap) içermiyor' };
  return { valid: true, text: r.text, stance: parseRobotsAiStance(r.text, KNOWN_AI_BOTS), invalidText: null };
}

function levelQuickWins(ctx: ScanContext, rv: RobotsView): ReadinessLevel {
  const { home, robots, llms } = ctx.probes;
  const checks: ReadinessCheck[] = [];
  const robotsBlocked = blockedOf(robots);

  // 0. Ana sayfa erisimi — bilgi; ana sayfa engelliyse taramanin geri kalaninin
  // neden olculemedigini acikca gosterir
  checks.push({
    id: 'homepage-access',
    name: 'Ana sayfa erişimi (RanksUpBot)',
    ok: home.state === 'ok',
    impact: 'info',
    statusText: home.state === 'ok'
      ? `Ana sayfa okunabildi (HTTP ${home.status})`
      : home.block?.reason ?? `Ana sayfa okunamadı (HTTP ${home.status})`,
    howTo: 'Ana sayfa herkese açık olmalı. Güvenlik duvarı ya da bot koruması RanksUpBot\'u engelliyorsa aynı kurallar AI tarayıcılarını da engelliyor olabilir; bu durumda ana sayfaya bağlı kontroller ölçülemez ve puana girmez.',
    audit: [fetchStep(ctx.siteUrl, home)],
    blocked: blockedOf(home),
  });

  // 1. robots.txt
  const robotsStatus = robotsBlocked
    ? robotsBlocked.reason
    : robots.state === 'missing'
      ? `robots.txt bulunamadı (HTTP ${robots.status})`
      : robots.state === 'http_error'
        ? robots.status >= 500
          ? `robots.txt sunucu hatası veriyor (HTTP ${robots.status}) — Google bu durumda siteyi taramayı geçici olarak durdurur`
          : `robots.txt okunamadı (HTTP ${robots.status})`
        : rv.valid ? `robots.txt mevcut (HTTP ${robots.status})` : rv.invalidText ?? 'robots.txt geçersiz';
  checks.push({
    id: 'robots-txt',
    name: 'Bot davranışı tercihleri (robots.txt)',
    ok: rv.valid,
    impact: 'high',
    statusText: robotsStatus,
    howTo: 'Site köküne robots.txt ekle. "Önizle ve uygula" mevcut dosyanı aynen korur, yalnız eksik AI bot gruplarını, Content-Signal ve Sitemap satırlarını sona ekler; hiçbir Disallow kuralını silmez. Dosya yoksa yenisini oluşturur.',
    fixKey: robotsBlocked ? undefined : 'robots_txt',
    audit: [
      fetchStep('/robots.txt', robots),
      ...(robots.state === 'ok' ? [{ step: 'PARSE' as const, detail: rv.valid ? 'Yönerge satırları bulundu' : rv.invalidText ?? 'Geçersiz', ok: rv.valid }] : []),
      { step: 'CONCLUDE', detail: robotsBlocked ? 'Ölçülemedi — puana girmez' : rv.valid ? 'Bot tercihi deklare edilmiş' : 'Ajanlar için okunabilir kural yok', ok: rv.valid },
    ],
    blocked: robotsBlocked,
  });

  // 2. Sitemap — kesif sirasi: robots.txt Sitemap satirlari → /sitemap.xml → /sitemap_index.xml
  const sm = ctx.sitemap;
  const smBlocked = !sm.found ? sm.tried.map((t) => blockedOf(t.probe)).find(Boolean) : undefined;
  const declared = sm.tried.filter((t) => t.source === 'robots');
  checks.push({
    id: 'sitemap',
    name: 'Ajanlara site haritası (sitemap.xml)',
    ok: !!sm.found,
    impact: 'high',
    statusText: sm.found
      ? `Site haritası bulundu: ${pathOf(sm.found.url, ctx.origin)} (${sm.found.source === 'robots' ? 'robots.txt\'de bildirilmiş' : 'standart konum'}${sm.found.kind === 'sitemapindex' ? ', site haritası dizini' : ''}${sm.found.kind === 'gzip' ? ', sıkıştırılmış — içerik doğrulanmadı' : ''})`
      : smBlocked
        ? smBlocked.reason
        : declared.length > 0
          ? 'robots.txt\'de bildirilen site haritası okunamadı ya da geçerli XML değil; standart konumlarda da bulunamadı'
          : 'Site haritası bulunamadı (robots.txt\'de Sitemap satırı yok; /sitemap.xml ve /sitemap_index.xml geçerli bir site haritası döndürmedi)',
    howTo: 'Site haritası yayınla ve robots.txt\'e "Sitemap:" satırıyla bildir. CMS\'in site haritası özelliği varsa onu kullan; yoksa RanksUp yalnız site haritası HİÇ yokken taradığı sayfalardan yenisini oluşturur — var olan bir site haritasının üzerine asla yazmaz.',
    fixKey: smBlocked ? undefined : 'sitemap_xml',
    audit: sm.tried.map((t) => ({
      step: 'FETCH' as const,
      detail: `GET ${pathOf(t.url, ctx.origin)}${t.source === 'robots' ? ' (robots.txt)' : ''} → ${describeProbe(t.probe)}${sm.found?.url === t.url ? ` · ${sm.found.kind}` : ''}`,
      ok: sm.found?.url === t.url,
    })),
    blocked: smBlocked,
  });

  // 3. AI bot yonetimi — skor tabani training + search (21); user-triggered
  // fetcher'lar robots.txt'e guvenilir uymaz (bkz. known-ai-bots.ts)
  const stance = rv.stance;
  const namedCount = stance ? stance.scored.named : 0;
  const scoredTotal = stance ? stance.scored.total : STANCE_SCORED_BOTS.length;
  const aiRulesOk = !!stance && namedCount >= AI_RULES_MIN_NAMED;
  const missingScored = stance
    ? stance.bots.filter((b) => b.category !== 'user-triggered' && b.stance === 'unspecified').map((b) => b.name).slice(0, 4)
    : [];
  const userTriggeredNamed = stance ? stance.bots.filter((b) => b.category === 'user-triggered' && b.stance !== 'unspecified').length : 0;
  checks.push({
    id: 'ai-crawler-rules',
    name: 'AI botlarını yönet (AI Crawler Rules)',
    ok: aiRulesOk,
    impact: 'high',
    statusText: robotsBlocked
      ? robotsBlocked.reason
      : stance
        ? aiRulesOk
          ? `robots.txt ${namedCount}/${scoredTotal} eğitim + AI arama botunu isimle anıyor (${stance.scored.allow} izin / ${stance.scored.block} engel)`
          : `robots.txt yalnız ${namedCount}/${scoredTotal} eğitim + AI arama botunu isimle anıyor${userTriggeredNamed ? ` — ${userTriggeredNamed} kullanıcı-tetikli fetcher skora girmez` : ''}; en az ${AI_RULES_MIN_NAMED} gerekli, ör. ${missingScored.join(', ')}`
        : 'Geçerli bir robots.txt okunamadığı için AI bot duruşu çıkarılamadı',
    howTo: `GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot gibi eğitim ve AI-arama crawler'ları için robots.txt'de açık User-agent blokları tanımla — izin ver ya da engelle, ama bilinçli olsun (en az ${AI_RULES_MIN_NAMED} bot). "Önizle ve uygula" eksik botları, mevcut erişimlerini değiştirmeden ("User-agent: *" kurallarını kopyalayarak) ekler; mevcut engelleri kaldırmaz. ChatGPT-User, Perplexity-User, Claude-User gibi kullanıcı-tetikli fetcher'lar robots.txt'e güvenilir uymadığı için skora girmez.`,
    agentPrompt: `Fetch ${ctx.origin}/robots.txt and list which of these AI crawlers have an explicit User-agent block: ${STANCE_SCORED_BOTS.slice(0, 10).map((b) => b.name).join(', ')}. For each, state allow or block.`,
    fixKey: robotsBlocked ? undefined : 'robots_txt',
    audit: [
      fetchStep('/robots.txt', robots),
      { step: 'PARSE', detail: stance ? `Skorlanan AI user-agent'ları: ${stance.bots.filter((b) => b.category !== 'user-triggered' && b.stance !== 'unspecified').map((b) => b.name).slice(0, 8).join(', ') || 'hiçbiri'}` : '—', ok: aiRulesOk },
      { step: 'CONCLUDE', detail: robotsBlocked ? 'Ölçülemedi — puana girmez' : aiRulesOk ? 'AI crawler kuralları deklare edilmiş' : 'AI crawler\'lar için yeterli açık kural yok', ok: aiRulesOk },
    ],
    blocked: robotsBlocked,
  });

  // 4. Content Signals — User-agent grubunun icinde (Cloudflare managed robots.txt)
  const contentSignals = rv.valid && /^\s*content-signal\s*:/im.test(rv.text.replace(/#.*$/gm, ''));
  // Content-Signal yalniz bir BEYANDIR. Eski metin robots.txt'deki ai-train
  // degerini Cloudflare'in Googlebot/Bingbot engeline bagliyor ve "gorunurluk
  // icin ai-train=yes birak" diye yonlendiriyordu; yanlis. Cloudflare'in kendi
  // belgesi: robots.txt'e uyum gonulludur, dosya tercih bildirir ama
  // tarayiciyi teknik olarak engellemez; zorlamak icin AI Crawl Control
  // kullanilir (https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/).
  // 15 Eylul 2026'dan beri Googlebot/Bingbot/Applebot'u (arama dahil) durduran
  // sey paneldeki Training politikasinin "Block" (ve reklamli sayfalarda
  // "Block on pages with ads") secenegidir; aramada kalip egitimi reddetmek
  // icin "Disallow AI Training" vardir
  // (https://blog.cloudflare.com/accountable-mixed-use-ai-crawlers/).
  checks.push({
    id: 'content-signals',
    name: 'İçerik kullanım sinyalleri (Content Signals)',
    ok: contentSignals,
    impact: 'medium',
    statusText: robotsBlocked ? robotsBlocked.reason : contentSignals ? 'Content-Signal satırı mevcut' : 'Content-Signal deklare edilmemiş',
    howTo: 'robots.txt\'e `Content-Signal: search=yes, ai-input=yes, ai-train=yes|no` satırı ekleyerek içeriğinin arama, AI cevabı ve eğitimde nasıl kullanılabileceğini bilinçli olarak deklare et (Cloudflare Content Signals Policy). Önizlemede ai-train değerini sen seçersin. Bu satır bir beyandır: botların robots.txt\'e uyması gönüllüdür ve satır hiçbir botu teknik olarak engellemez. Cloudflare kullanıyorsan Googlebot, Bingbot ve Applebot\'u etkileyen bu satır değil, paneldeki AI bot politikalarıdır (Security Settings > Configure AI bot policies): 15 Eylül 2026\'dan beri Training için "Block" bu botları arama dahil durdurur, "Block on pages with ads" reklamlı sayfalarda durdurur; aramada kalıp yalnız AI eğitimini reddetmek için "Disallow AI Training" seçeneği var.',
    fixKey: robotsBlocked ? undefined : 'robots_txt',
    audit: [{ step: 'PARSE', detail: contentSignals ? 'Content-Signal: satırı bulundu' : 'robots.txt içinde Content-Signal yok', ok: contentSignals }],
    blocked: robotsBlocked,
  });

  // 5. llms.txt — DUSUK ETKI (v2): hicbir buyuk saglayici taahhut etmiyor,
  // %97'si hic okunmuyor, Google kullanmiyor. Opsiyonel hijyen.
  const llmsBlocked = blockedOf(llms);
  const llmsCheck = llms.state === 'ok' ? validateLlmsTxt(llms.text, catchAllBody(ctx)) : null;
  const llmsOk = !!llmsCheck?.ok;
  checks.push({
    id: 'llms-txt',
    name: 'AI-optimize özet (llms.txt) — opsiyonel',
    ok: llmsOk,
    impact: 'low',
    statusText: llmsBlocked
      ? llmsBlocked.reason
      : llmsOk
        ? 'llms.txt mevcut (markdown başlık + link)'
        : llmsCheck && !llmsCheck.ok
          ? `llms.txt adresi yanıt veriyor ama ${llmsCheck.detail ?? DOC_FAILURE_TEXT[llmsCheck.reason]}`
          : llms.state === 'http_error' ? `llms.txt okunamadı (HTTP ${llms.status})` : 'llms.txt yok (opsiyonel)',
    howTo: 'Düşük maliyetli, kanıtı zayıf, opsiyonel bir hijyen adımı: hiçbir büyük AI sağlayıcısı llms.txt\'yi kullanacağını taahhüt etmiyor, Google Search kullanmıyor ve Ahrefs\'in 137 bin sitelik ölçümünde dosyaların %97\'si hiç okunmadı. Zararı yok, olası faydası küçük. RanksUp yalnız llms.txt yokken oluşturur; var olan dosyanın üzerine yazmaz.',
    fixKey: llmsBlocked ? undefined : 'llms_txt',
    audit: [
      fetchStep('/llms.txt', llms),
      { step: 'PARSE', detail: llmsOk ? 'Markdown başlığı ve en az bir link var' : 'Markdown başlık + link yapısı doğrulanamadı', ok: llmsOk },
    ],
    blocked: llmsBlocked,
  });

  return buildLevel('quick-wins', 'Hızlı Kazanımlar', checks, true);
}

// ────────────────────────────────────────────────────────────
//  L2 — TECHNICAL GROUNDWORK
// ────────────────────────────────────────────────────────────

interface InterfaceEvidence {
  /** Gecerli openapi.json ya da RFC 9727 api-catalog */
  apiValid: boolean;
  /** API kataloğu kontrolu puanlanir mi (gecerli ya da bozuk bir API belgesi yayinda) */
  apiArtifact: boolean;
  /** ai-catalog.json'da MCP girdisi */
  mcpEntries: number;
  /** RanksUp uretimi olmayan bir A2A ajan karti */
  a2aPresent: boolean;
  /** auth.md puanlanir mi */
  any: boolean;
  /**
   * Arayuz yalniz ai-catalog'da bildiriliyor ve kartlarinin HEPSI olculemedi
   * (engel / ulasilamazlik) — auth.md puanlanmaz ama "arayuz yok" da denmez
   */
  unverifiedInterface: boolean;
}

const INTERFACE_UNVERIFIED_NOTE = 'AI Catalog bir ajan arayüzü (MCP / A2A) bildiriyor ama kartı erişim engeli ya da ulaşılamazlık yüzünden okunamadı; arayüz doğrulanana kadar bu kontrol puana girmez.';

/** Katalog kartinin yoklamasi engel / ulasilamazlik — olculemedi (gomulu kartin yoklamasi yok) */
const cardUnmeasured = (c: { probe: Probe | null }) => !!c.probe && isUnmeasured(c.probe);

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Ajan karti gibi gorunen JSON nesnesi — HTML, catch-all govdesi ya da kartla
 * ilgisiz JSON ({}, [], hata nesnesi) "kart var" sayilmaz.
 */
function parseCard(p: Probe, ctx: ScanContext): Record<string, unknown> | undefined {
  if (p.state !== 'ok' || looksLikeHtml(p.text)) return undefined;
  const ca = catchAllBody(ctx);
  if (ca && ca.trim() === p.text.trim()) return undefined;
  const j = parseJsonSafe(p.text);
  if (!isPlainObject(j)) return undefined;
  return ['name', 'supportedInterfaces', 'skills', 'url', 'protocolVersion'].some((k) => k in j) ? j : undefined;
}

export function interfaceEvidence(ctx: ScanContext): InterfaceEvidence {
  const { openapi, apiCatalog, aiCatalog, agentCard, agentLegacy } = ctx.probes;
  const ca = catchAllBody(ctx)?.trim() ?? null;
  const notCatchAll = (p: Probe) => !ca || p.text.trim() !== ca;
  const oa = openapi.state === 'ok' ? validateOpenApiDoc(openapi.text) : null;
  const cat = apiCatalog.state === 'ok' ? validateApiCatalog(apiCatalog.text, apiCatalog.contentType) : null;
  const apiValid = !!oa?.ok || !!cat?.ok;
  const broken = (!!oa && !oa.ok && oa.reason === 'invalid' && notCatchAll(openapi)) || (!!cat && !cat.ok && cat.reason === 'invalid' && notCatchAll(apiCatalog));
  const aic = aiCatalog.state === 'ok' ? parseAiCatalog(aiCatalog.text) : null;
  const mcpEntries = aic?.ok ? aic.entries.filter((e) => e.type === MCP_SERVER_CARD_TYPE).length : 0;
  const cards = [parseCard(agentCard, ctx), parseCard(agentLegacy, ctx)].filter((c): c is Record<string, unknown> => !!c);
  const directA2a = cards.some((c) => !validateA2aAgentCard(c).ranksupGenerated);
  const a2aPresent = directA2a || ctx.a2aCards.length > 0;
  const apiArtifact = apiValid || broken;
  // Kartlarinin hepsi engelli/ulasilamaz katalog girdisi auth.md'yi puanlatan
  // kanit sayilmaz: arayuzun gercekten sunuldugunu dogrulayamadik (v3: engel
  // eksik degildir — ama olculmemis bir seyi puanlamak da degildir)
  const mcpMeasured = mcpEntries > 0 && !(ctx.mcpCards.length > 0 && ctx.mcpCards.every(cardUnmeasured));
  const catalogA2aMeasured = ctx.a2aCards.length > 0 && !ctx.a2aCards.every(cardUnmeasured);
  const any = apiArtifact || mcpMeasured || directA2a || catalogA2aMeasured;
  return {
    apiValid, apiArtifact, mcpEntries, a2aPresent, any,
    unverifiedInterface: !any && (mcpEntries > 0 || ctx.a2aCards.length > 0),
  };
}

const PRODUCT_TYPES = new Set(['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel', 'SomeProducts']);

/** Sayfanin yapisal verisi: JSON-LD dugumleri + microdata Product ogeleri */
export interface PageStructure {
  nodes: any[];
  microdataProducts: Array<{ type: string; offers: boolean }>;
}

const EMPTY_STRUCTURE: PageStructure = { nodes: [], microdataProducts: [] };

/**
 * JSON-LD cheerio ile cikarilir (site-crawler.service.ts ile ayni). Eski regex
 * tirnakli type niteligi istiyordu; HTML5'te gecerli olan ve kucultuculerin
 * (Hugo --minify vb.) urettigi tirnaksiz `type=application/ld+json` sifir
 * dugum veriyor, SEO denetimi Organization'i bulurken AXO "yok" diyordu.
 * cheerio saftir (I/O yok). type karsilastirmasi buyuk/kucuk harf ve
 * parametre (;charset) duyarsiz.
 *
 * Microdata yalniz urun icin okunur: Product schema'yi microdata ile veren
 * magaza (Google ikisini de destekler) "schema yok" diye cezalandirilmasin.
 */
export function pageStructure(html: string): PageStructure {
  if (!html) return EMPTY_STRUCTURE;
  const $ = cheerio.load(html);
  const nodes: any[] = [];
  $('script[type]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/ld+json') return;
    const parsed = parseJsonSafe(($(el).html() ?? '').trim());
    if (parsed !== undefined) nodes.push(...collectTypedNodes(parsed));
  });
  const microdataProducts: PageStructure['microdataProducts'] = [];
  $('[itemscope][itemtype]').each((_, el) => {
    const type = ($(el).attr('itemtype') ?? '').split(/\s+/).map(normalizeSchemaType).find((t): t is string => !!t && PRODUCT_TYPES.has(t));
    if (!type) return;
    microdataProducts.push({ type, offers: $(el).find('[itemprop~="offers"]').length > 0 });
  });
  return { nodes, microdataProducts };
}

interface ProductHit { type: string; offers: boolean; source: 'JSON-LD' | 'microdata' }

/** Sayfadaki en iyi Product kaniti: once offers'li olan (JSON-LD, sonra microdata) */
function productOf(s: PageStructure): ProductHit | null {
  const ld = s.nodes.filter((n) => schemaTypesOf(n).some((t) => PRODUCT_TYPES.has(t)));
  const typeOf = (n: any) => schemaTypesOf(n).find((t) => PRODUCT_TYPES.has(t)) ?? 'Product';
  const ldOffer = ld.find((n) => n.offers || n.hasVariant);
  if (ldOffer) return { type: typeOf(ldOffer), offers: true, source: 'JSON-LD' };
  const mdOffer = s.microdataProducts.find((m) => m.offers);
  if (mdOffer) return { type: mdOffer.type, offers: true, source: 'microdata' };
  if (ld[0]) return { type: typeOf(ld[0]), offers: false, source: 'JSON-LD' };
  const md = s.microdataProducts[0];
  return md ? { type: md.type, offers: false, source: 'microdata' } : null;
}

function levelGroundwork(ctx: ScanContext, ev: InterfaceEvidence, nodes: any[]): ReadinessLevel {
  const { home, authMd, authMdWk, openapi, apiCatalog, llmsFull } = ctx.probes;
  const homeBlocked = blockedOf(home);
  const ca = catchAllBody(ctx);
  const checks: ReadinessCheck[] = [];

  // 1. auth.md — WorkOS acik protokolu: API'si olan servislerde ajanin kendi
  // kimlik bilgisini nasil alacagi (kayit / onay / token / iptal). Kaynaklar:
  // https://github.com/workos/auth.md , https://zuplo.com/blog/auth-md-agent-signup
  const authProbes: Array<[string, Probe]> = [['/auth.md', authMd], ['/.well-known/auth.md', authMdWk]];
  const authHit = authProbes.find(([, p]) => p.state === 'ok' && validateTextDoc(p.text, ca, 20).ok);
  const authHtml = !authHit && authProbes.some(([, p]) => p.state === 'ok' && looksLikeHtml(p.text));
  const authLegacy = !!authHit && isRanksUpLegacyAuthMd(authHit[1].text);
  const authBlocked = !authHit ? authProbes.map(([, p]) => blockedOf(p)).find(Boolean) : undefined;
  const authOk = !!authHit && !authLegacy;
  checks.push({
    id: 'auth-md',
    name: 'Ajan kimlik doğrulama talimatı (auth.md)',
    ok: authOk,
    impact: ev.any ? 'medium' : 'info',
    statusText: authBlocked
      ? authBlocked.reason
      : authLegacy
        ? 'auth.md RanksUp\'ın eski otomatik düzeltmesinden kalma; doğrulanmamış varsayılanlar içeriyor (ör. /giris, "60 istek/dk") — içeriği gerçeğe göre düzeltin ya da kaldırın'
        : authOk
          ? `auth.md mevcut (${authHit![0]})`
          : authHtml
            ? 'auth.md yerine HTML sayfa dönüyor (soft-404) — gerçek dosya yok'
            : ev.any
              ? 'auth.md bulunamadı'
              : ev.unverifiedInterface
                ? 'auth.md bulunamadı — AI Catalog\'daki ajan arayüzü kartı okunamadığı için puana girmedi'
                : 'auth.md yok — sitede API/ajan arayüzü olmadığı için gerekli değil',
    howTo: 'auth.md, WorkOS\'un 2026\'da duyurduğu açık bir protokol: API\'si olan servisler, AI ajanlarının kendi kimlik bilgisini nasıl alacağını (keşif, kayıt, kullanıcı onayı, token, iptal) domain kökündeki bu markdown dosyasında adım adım anlatır; keşif OAuth yetkilendirme sunucusu meta verisindeki agent_auth bloğu üzerinden yapılır. API\'n yoksa bu dosyaya ihtiyacın yok. RanksUp bu dosyayı otomatik yayınlamaz: her değer senin sistemine özgüdür; aşağıdaki şablondaki yer tutucuları kendi bilgilerinle doldur.',
    agentPrompt: `Fetch ${ctx.origin}/auth.md — does it describe, step by step, how an AI agent registers, gets a credential, uses it and handles revocation for this service's API?`,
    audit: [
      fetchStep('/auth.md', authMd),
      fetchStep('/.well-known/auth.md', authMdWk),
      { step: 'CONCLUDE', detail: authLegacy ? 'RanksUp eski şablonu — geçerli sayılmadı' : authOk ? 'auth.md bulundu' : ev.any ? 'auth.md yok' : ev.unverifiedInterface ? 'Arayüz kartı okunamadı — puana girmez' : 'Arayüz yok — puana girmez', ok: authOk },
    ],
    blocked: authBlocked,
    ...(ev.any ? {} : { scoreNote: ev.unverifiedInterface ? INTERFACE_UNVERIFIED_NOTE : INTERFACE_NOTE }),
    ...(!authOk && (ev.any || ev.unverifiedInterface || authLegacy)
      ? { manualTemplate: { filename: 'auth.md', content: authMdTemplate(ctx.brandName), note: 'Şablondaki her <YER_TUTUCU> değerini kendi API bilgilerinle değiştirmeden yayınlama; bilmediğin adımı silmek, uydurmaktan iyidir.' } }
      : {}),
  });

  // 2. API katalogu — RFC 9727 /.well-known/api-catalog ya da /openapi.json
  const oa = openapi.state === 'ok' ? validateOpenApiDoc(openapi.text) : null;
  const cat = apiCatalog.state === 'ok' ? validateApiCatalog(apiCatalog.text, apiCatalog.contentType) : null;
  const apiBlocked = !ev.apiValid && !ev.apiArtifact ? [openapi, apiCatalog].map(blockedOf).find(Boolean) : undefined;
  const brokenText = cat && !cat.ok && cat.reason === 'invalid'
    ? `.well-known/api-catalog yanıt veriyor ama geçersiz: ${cat.detail}`
    : oa && !oa.ok && oa.reason === 'invalid' ? `openapi.json yanıt veriyor ama geçersiz: ${oa.detail}` : null;
  checks.push({
    id: 'api-catalog',
    name: 'Web servis dizini (API Catalog)',
    ok: ev.apiValid,
    impact: ev.apiArtifact ? 'medium' : 'info',
    statusText: apiBlocked
      ? apiBlocked.reason
      : cat?.ok
        ? `.well-known/api-catalog geçerli (${cat.links} API bağlantısı)${cat.mediaTypeOk ? '' : ' — Content-Type application/linkset+json olmalı'}`
        : oa?.ok
          ? `openapi.json mevcut (${oa.version})`
          : brokenText ?? 'API kataloğu yok — sitede API tespit edilmediği için gerekli değil',
    howTo: 'API\'n varsa /openapi.json ya da RFC 9727 uyumlu /.well-known/api-catalog (application/linkset+json, "linkset" dizisi) yayınla — ajanlar servislerini keşfedebilsin. API\'n yoksa bu kontrol puana girmez.',
    audit: [
      fetchStep('/openapi.json', openapi),
      fetchStep('/.well-known/api-catalog', apiCatalog),
      { step: 'PARSE', detail: cat?.ok ? `linkset: ${cat.links} bağlantı` : oa?.ok ? oa.version! : brokenText ?? 'Geçerli API belgesi yok', ok: ev.apiValid },
    ],
    blocked: apiBlocked,
    ...(ev.apiArtifact ? {} : { scoreNote: INTERFACE_NOTE }),
  });

  // 3. llms-full.txt — CANLI siteden; DB kopyasi yalniz ipucu
  const lfBlocked = blockedOf(llmsFull);
  const lf = llmsFull.state === 'ok' ? validateLlmsFullTxt(llmsFull.text, ca) : null;
  const lfOk = !!lf?.ok;
  const inDb = !!ctx.llmsFullInDb;
  checks.push({
    id: 'llms-full',
    name: 'Konsolide içerik (llms-full.txt) — opsiyonel',
    ok: lfOk,
    impact: 'low',
    statusText: lfBlocked
      ? lfBlocked.reason
      : lfOk
        ? `llms-full.txt sitede yayında (${Math.max(1, Math.round(llmsFull.text.length / 1024))} KB${llmsFull.truncated ? '+' : ''})`
        : inDb
          ? `llms-full.txt RanksUp'ta üretildi ama sitede yayında değil${lf && !lf.ok ? ` (${lf.detail ?? DOC_FAILURE_TEXT[lf.reason]})` : ''}`
          : 'llms-full.txt sitede yok (opsiyonel)',
    howTo: 'llms-full.txt tüm içeriği tek markdown dosyasında sunar; llms.txt ile aynı zayıf kanıt tabanına sahip opsiyonel bir adımdır (büyük AI sağlayıcıları kullanacağını taahhüt etmiyor). RanksUp dosyayı GEO Lab\'da üretir; sitede yayında değilse içeriği site köküne /llms-full.txt olarak yükle (llms gönderimini destekleyen yayın hedeflerinde otomatik gönderilir).',
    audit: [
      fetchStep('/llms-full.txt', llmsFull),
      { step: 'CONCLUDE', detail: lfOk ? 'Sitede yayında' : inDb ? `RanksUp'ta üretildi${ctx.llmsFullInDb?.at ? ` (${ctx.llmsFullInDb.at.toISOString().slice(0, 10)})` : ''}, sitede yok` : 'Yok', ok: lfOk },
    ],
    blocked: lfBlocked,
  });

  // 4. Organization (ya da alt turu) + sameAs
  const org = home.state === 'ok' ? findOrganizationNode(nodes) : null;
  const orgOk = !!org && org.sameAsCount >= 2;
  checks.push({
    id: 'org-schema',
    name: 'Kimlik grafiği (Organization + sameAs)',
    ok: orgOk,
    impact: 'medium',
    statusText: homeBlocked
      ? homeBlocked.reason
      : home.state !== 'ok'
        ? `Ana sayfa okunamadı (HTTP ${home.status})`
        : org
          ? `${org.type} schema var, ${org.sameAsCount} sameAs profili`
          : 'Ana sayfada Organization (ya da alt türü, ör. LocalBusiness) schema yok',
    howTo: 'Ana sayfaya Organization ya da işletmene uyan en spesifik alt türü (ör. HairSalon, Dentist, Restaurant) JSON-LD olarak ekle ve sameAs ile sosyal/dizin profillerini bağla — ajanlar ve arama motorları markanı bu bağlantılarla eşleştirebilir. Google en spesifik LocalBusiness alt türünün kullanılmasını ister.',
    audit: [
      { step: 'PARSE', detail: `Ana sayfada ${nodes.length} JSON-LD düğümü; Organization ailesi: ${org ? org.type : 'yok'}`, ok: !!org },
      { step: 'CONCLUDE', detail: orgOk ? 'Kimlik grafiği yeterli' : 'sameAs profilleri eksik (en az 2 önerilir)', ok: orgOk },
    ],
    blocked: homeBlocked,
  });

  // 5. JS'siz kesif — BILGI (puansiz, v2)
  const jsFree = assessJsFreeDiscovery(home.state === 'ok' ? home.text : '', ctx.sitemap.found && ctx.sitemap.found.kind !== 'gzip' ? ctx.sitemap.found.body : '', ctx.siteUrl);
  checks.push({
    id: 'js-free-discovery',
    name: 'JS\'siz keşfedilebilirlik (ham HTML link grafiği)',
    ok: !jsFree.applicable || jsFree.ok,
    impact: 'info',
    statusText: homeBlocked ? homeBlocked.reason : jsFree.applicable ? jsFree.reason : `Ölçülemedi — ${jsFree.reason}`,
    howTo: 'Ana gezinme ve içerik linklerini sunucu tarafında (SSR/SSG) ham HTML\'e yaz; yalnız JavaScript ile oluşan menü/liste linkleri GPTBot, ClaudeBot, PerplexityBot için görünmez. Sitemap tek başına yetmez: ajanlar sayfa-arası bağlamı link grafiğinden alır.',
    agentPrompt: `Fetch ${ctx.siteUrl} WITHOUT executing JavaScript and count the internal <a href> links in the raw HTML. Compare with the site's sitemap — which sitemap URLs are unreachable from the raw homepage HTML?`,
    audit: [
      { step: 'PARSE', detail: `Ham HTML'de ${jsFree.internalLinks} iç link${jsFree.truncated ? ' (HTML 500 KB\'ta kırpıldı, alt kısım sayılmadı)' : ''}`, ok: jsFree.internalLinks > 0 },
      { step: 'PARSE', detail: jsFree.applicable ? `Sitemap ${jsFree.sitemapUrls} URL · örneklem ${jsFree.sampled} · ham HTML'de bulunan ${jsFree.overlap}` : jsFree.reason, ok: jsFree.applicable },
      { step: 'CONCLUDE', detail: jsFree.applicable ? (jsFree.ok ? 'JS\'siz keşif yeterli' : 'JS-bağımlı keşif şüphesi — puansız gözlem') : 'Ölçülemedi (bilgi)', ok: !jsFree.applicable || jsFree.ok },
    ],
    blocked: homeBlocked,
  });

  // 6-8. Isletilebilirlik — BILGI (puansiz). Siralama etkisi iddia edilmez.
  if (home.state === 'ok' || homeBlocked) {
    const op = assessOperability(home.state === 'ok' ? home.text : '', ctx.siteUrl);
    const contactOk = op.contact.tel > 0 || op.contact.whatsapp > 0;
    checks.push({
      id: 'contact-actions',
      name: 'Tıklanabilir iletişim (tel: / WhatsApp)',
      ok: contactOk,
      impact: 'info',
      statusText: homeBlocked
        ? homeBlocked.reason
        : contactOk
          ? `Ana sayfada ${op.contact.tel} tel: linki, ${op.contact.whatsapp} WhatsApp linki`
          : 'Ana sayfada tıklanabilir telefon (tel:) ya da WhatsApp linki yok',
      howTo: 'Telefonu <a href="tel:+90…"> ve WhatsApp\'ı https://wa.me/90… linki olarak ver. Kullanıcı adına hareket eden ajanlar ve tarayıcılar aramayı ya da mesajı düz metin numara yerine bu linklerle başlatabilir. Bu bir sıralama sinyali değildir.',
      audit: [{ step: 'PARSE', detail: `tel: ${op.contact.tel} · WhatsApp (wa.me / api.whatsapp.com): ${op.contact.whatsapp}`, ok: contactOk }],
      blocked: homeBlocked,
    });

    if (op.forms.fields > 0) {
      const formOk = op.forms.labeled === op.forms.fields && op.forms.typeMismatches.length === 0;
      checks.push({
        id: 'form-semantics',
        name: 'Form anlamları (etiket, alan türü, autocomplete)',
        ok: formOk,
        impact: 'info',
        statusText: `${op.forms.count} form, ${op.forms.fields} alan: ${op.forms.labeled} etiketli, ${op.forms.autocomplete} autocomplete ipuçlu${op.forms.typeMismatches[0] ? ` — ${op.forms.typeMismatches[0]}` : ''}`,
        howTo: 'Her alanın görünür bir <label>\'ı (ya da aria-label) olsun; telefon için type="tel", e-posta için type="email", tarih/saat için type="date"/"time" kullan ve autocomplete ipuçlarını (name, tel, email) ekle. Ajanlar ve tarayıcılar formu doğru doldurmak için bunlara bakar; Chrome\'un WebMCP API\'si de alan açıklaması yoksa <label>\'ı kullanır.',
        audit: [
          { step: 'PARSE', detail: `Etiketsiz alanlar: ${op.forms.unlabeled.join(', ') || 'yok'}`, ok: op.forms.labeled === op.forms.fields },
          { step: 'PARSE', detail: `Tür uyumsuzlukları: ${op.forms.typeMismatches.join('; ') || 'yok'}`, ok: op.forms.typeMismatches.length === 0 },
        ],
      });
    }

    if (op.booking.iframeHosts.length > 0) {
      const hosts = op.booking.iframeHosts.join(', ');
      checks.push({
        id: 'booking-embed',
        name: 'Rezervasyon erişimi',
        ok: op.booking.directLink,
        impact: 'info',
        statusText: op.booking.directLink
          ? `Rezervasyon aracı (${hosts}) gömülü; sayfada doğrudan rezervasyon linki de var`
          : `Rezervasyon yalnız ${hosts} iframe'i içinde — bazı ajanlar başka alan adından gömülü aracı işletemeyebilir`,
        howTo: 'Gömülü rezervasyon aracının yanında, rezervasyon sayfasına giden düz bir <a> linki de ver (ör. "Randevu al"). Ajan ya da kullanıcı iframe\'i işletemezse doğrudan bağlantıdan devam edebilir.',
        audit: [{ step: 'PARSE', detail: `Rezervasyon iframe'i: ${hosts} · doğrudan link: ${op.booking.directLink ? 'var' : 'yok'}`, ok: op.booking.directLink }],
      });
    }
  }

  return buildLevel('groundwork', 'Teknik Zemin', checks, true);
}

// ────────────────────────────────────────────────────────────
//  L3 — ADVANCED INTEGRATION
// ────────────────────────────────────────────────────────────

function levelAdvanced(ctx: ScanContext, ev: InterfaceEvidence, nodes: any[]): ReadinessLevel {
  const { home, homeMd, agentCard, agentLegacy, aiCatalog, mcpLegacy, mcpLegacyCard, aasa } = ctx.probes;
  const homeBlocked = blockedOf(home);
  const checks: ReadinessCheck[] = [];

  // 1. A2A Agent Card — v1.0: /.well-known/agent-card.json, supportedInterfaces + version zorunlu
  const wkJson = parseCard(agentCard, ctx);
  const legacyJson = parseCard(agentLegacy, ctx);
  const wk = wkJson ? validateA2aAgentCard(wkJson) : null;
  const legacy = legacyJson ? validateA2aAgentCard(legacyJson) : null;
  const catalogCard = ctx.a2aCards.find((c) => c.check.ok) ?? ctx.a2aCards[0] ?? null;
  const primary = wk ?? catalogCard?.check ?? null;
  const ranksupLegacy = (!!legacy && legacy.ranksupGenerated) || (!!wk && wk.ranksupGenerated);
  const a2aOk = !!primary && primary.ok && !primary.ranksupGenerated;
  // Katalogdaki kartlarin HEPSI engelli/ulasilamazsa "gecersiz kart" degil
  // olculemedi (v3: engel eksik degildir)
  const a2aCardsBlocked = !wk && !legacy && ctx.a2aCards.length > 0 && ctx.a2aCards.every(cardUnmeasured);
  const a2aBlocked = !wk && !legacy
    ? ctx.a2aCards.length === 0
      ? [agentCard, agentLegacy].map(blockedOf).find(Boolean)
      : a2aCardsBlocked ? blockedOf(ctx.a2aCards[0].probe) : undefined
    : undefined;
  const a2aStatus = a2aBlocked
    ? a2aCardsBlocked ? `AI Catalog'daki ajan kartı okunamadı — ${a2aBlocked.reason}` : a2aBlocked.reason
    : a2aOk
      ? `Geçerli A2A v1.0 ajan kartı yayında${primary!.name ? ` (${primary!.name})` : ''}`
      : ranksupLegacy
        ? `Ajan kartı RanksUp'ın eski otomatik düzeltmesiyle yayınlanmış; sitede A2A uç noktası olmadığı için yanıltıcı — sunucudan kaldırmanızı öneririz (${legacy?.ranksupGenerated ? '/.well-known/agent.json' : '/.well-known/agent-card.json'})`
        : primary
          ? primary.legacy
            ? 'Ajan kartı eski A2A biçiminde (v0.x) — v1.0 için supportedInterfaces ve version alanları gerekli'
            : `Ajan kartı geçersiz: ${primary.errors.slice(0, 3).join(', ')}`
          : legacy
            ? 'Ajan kartı eski konumda (/.well-known/agent.json) — A2A v0.3\'ten beri /.well-known/agent-card.json kullanılıyor'
            : 'Ajan kartı yok — sitede bir A2A ajanı yoksa gerekli değil';
  checks.push({
    id: 'a2a-agent-card',
    name: 'A2A ajan kartı (.well-known/agent-card.json)',
    ok: a2aOk,
    impact: ev.a2aPresent ? 'medium' : 'info',
    statusText: a2aStatus,
    howTo: 'Yalnız gerçekten bir A2A ajan uç noktan varsa /.well-known/agent-card.json yayınla (A2A v1.0 zorunlu alanları: name, description, version, supportedInterfaces[url, protocolBinding, protocolVersion], capabilities, defaultInputModes, defaultOutputModes, skills). Uç noktası olmayan bir site için kart yayınlamak ajanları yanıltır; RanksUp bu dosyayı otomatik üretmez.',
    agentPrompt: `Fetch ${ctx.origin}/.well-known/agent-card.json and validate it against the A2A v1.0 AgentCard required fields (name, description, version, supportedInterfaces[url, protocolBinding, protocolVersion], capabilities, defaultInputModes, defaultOutputModes, skills).`,
    audit: [
      fetchStep('/.well-known/agent-card.json', agentCard),
      fetchStep('/.well-known/agent.json (eski)', agentLegacy),
      ...ctx.a2aCards.slice(0, 2).map((c) => ({ step: 'FETCH' as const, detail: `ai-catalog A2A girdisi ${c.identifier}${c.probe ? ` → ${describeProbe(c.probe)}` : ' (gömülü)'}`, ok: c.check.ok })),
      { step: 'PARSE', detail: a2aOk ? 'v1.0 zorunlu alanları tam' : primary ? primary.errors.slice(0, 4).join(', ') || 'Geçersiz' : 'Kart yok', ok: a2aOk },
    ],
    blocked: a2aBlocked,
    ...(ev.a2aPresent ? {} : { scoreNote: INTERFACE_NOTE }),
  });

  // 2. MCP — SEP-2127 MCP Server Cards: /.well-known/ai-catalog.json → kart.
  // /.well-known/mcp.json standart disi; tekil kartlar icin .well-known yollari "onerilmez".
  const aic = aiCatalog.state === 'ok' ? parseAiCatalog(aiCatalog.text) : null;
  const mcpOk = ctx.mcpCards.some((c) => c.check.ok);
  const validCard = ctx.mcpCards.find((c) => c.check.ok);
  const ca = catchAllBody(ctx)?.trim() ?? null;
  const legacyHits = ([['/.well-known/mcp.json', mcpLegacy], ['/.well-known/mcp/server-card.json', mcpLegacyCard]] as Array<[string, Probe]>)
    .filter(([, p]) => p.state === 'ok' && !looksLikeHtml(p.text) && (!ca || p.text.trim() !== ca) && isPlainObject(parseJsonSafe(p.text)))
    .map(([path]) => path);
  // Katalog girdisi var ama kartlarin HEPSI engelli/ulasilamaz → olculemedi;
  // eskiden "kart JSON nesnesi degil" diye gecersiz sayiliyordu
  const mcpCardsBlocked = !mcpOk && ctx.mcpCards.length > 0 && ctx.mcpCards.every(cardUnmeasured);
  const mcpBlocked = ev.mcpEntries === 0 ? blockedOf(aiCatalog) : mcpCardsBlocked ? blockedOf(ctx.mcpCards[0].probe) : undefined;
  const firstErrors = ctx.mcpCards.find((c) => !c.check.ok)?.check.errors.slice(0, 3).join(', ');
  checks.push({
    id: 'mcp-declaration',
    name: 'MCP sunucu kartı (SEP-2127)',
    ok: mcpOk,
    impact: ev.mcpEntries > 0 ? 'low' : 'info',
    statusText: mcpBlocked
      ? mcpCardsBlocked ? `AI Catalog'daki MCP Server Card okunamadı — ${mcpBlocked.reason}` : mcpBlocked.reason
      : mcpOk
        ? `AI Catalog'da ${ev.mcpEntries} MCP sunucusu; geçerli Server Card: ${validCard!.check.name ?? validCard!.identifier}`
        : ev.mcpEntries > 0
          ? `AI Catalog'da MCP girdisi var ama geçerli Server Card yok${firstErrors ? `: ${firstErrors}` : ''}`
          : aic && !aic.ok && aic.reason === 'invalid' && (!ca || aiCatalog.text.trim() !== ca)
            ? `ai-catalog.json yanıt veriyor ama geçersiz: ${aic.detail}`
            : legacyHits.length > 0
              ? `Yalnız eski/standart dışı konum bulundu (${legacyHits.join(', ')}) — SEP-2127'ye göre /.well-known/ai-catalog.json + <mcp-uç-noktası>/server-card kullanılmalı`
              : 'MCP sunucusu bildirilmemiş — MCP sunucun yoksa gerekli değil',
    howTo: 'MCP sunucun varsa SEP-2127 (MCP Server Cards) ile duyur: alan adında /.well-known/ai-catalog.json yayınla (specVersion + entries; girdide type "application/mcp-server-card+json" ve kartın url\'i), kartı <streamable-http-uç-noktası>/server-card adresinde sun ($schema, name, version, description zorunlu). /.well-known/mcp.json standart dışıdır; tekil kartlar için .well-known yolları önerilmez.',
    agentPrompt: `Fetch ${ctx.origin}/.well-known/ai-catalog.json, find entries with type "application/mcp-server-card+json", fetch each card and check the required fields ($schema, name, version, description) per MCP SEP-2127.`,
    audit: [
      fetchStep('/.well-known/ai-catalog.json', aiCatalog),
      ...ctx.mcpCards.slice(0, 3).map((c) => ({ step: 'FETCH' as const, detail: `Server Card ${c.identifier}${c.probe ? ` → ${describeProbe(c.probe)}` : ' (gömülü)'}${c.check.ok ? '' : ` · ${c.check.errors.slice(0, 2).join(', ')}`}`, ok: c.check.ok })),
      ...(legacyHits.length > 0 ? [{ step: 'PARSE' as const, detail: `Eski konum (puana girmez): ${legacyHits.join(', ')}`, ok: false }] : []),
    ],
    blocked: mcpBlocked,
    ...(ev.mcpEntries > 0 ? {} : { scoreNote: INTERFACE_NOTE }),
  });

  // 3. Markdown negotiation — Accept: text/markdown
  const mdBlocked = blockedOf(homeMd);
  const mdNegotiation = homeMd.state === 'ok' && (
    /^text\/markdown/.test(homeMd.contentType) ||
    (/^text\/plain/.test(homeMd.contentType) && !looksLikeHtml(homeMd.text) && /^#{1,3}\s/m.test(homeMd.text))
  );
  checks.push({
    id: 'markdown-negotiation',
    name: 'AI-optimize format sunumu (Markdown Negotiation)',
    ok: mdNegotiation,
    impact: 'low',
    statusText: mdBlocked
      ? mdBlocked.reason
      : mdNegotiation ? `Accept: text/markdown → ${homeMd.contentType || 'markdown içerik'}` : 'Sunucu markdown varyantı sunmuyor',
    howTo: '`Accept: text/markdown` başlığıyla gelen isteklere sayfanın markdown halini döndür — token maliyetini düşürür, ajan parse hatalarını azaltır. (Cloudflare "Markdown for Agents" veya edge middleware ile.)',
    agentPrompt: `Request ${ctx.siteUrl} with header "Accept: text/markdown" and report whether the response is markdown instead of HTML.`,
    audit: [
      { step: 'FETCH', detail: `GET / (Accept: text/markdown) → ${describeProbe(homeMd)}, Content-Type: ${homeMd.contentType || '?'}`, ok: homeMd.state === 'ok' },
      { step: 'CONCLUDE', detail: mdNegotiation ? 'Markdown varyantı sunuluyor' : 'HTML döndü — markdown negotiation yok', ok: mdNegotiation },
    ],
    blocked: mdBlocked,
  });

  // 4. Bildirimsel WebMCP — BILGI (Chrome 149 origin trial; nitelikler degisebilir)
  if (home.state === 'ok') {
    const op = assessOperability(home.text, ctx.siteUrl);
    if (op.forms.count > 0) {
      checks.push({
        id: 'webmcp-forms',
        name: 'Bildirimsel WebMCP formları (deneysel)',
        ok: op.webmcp.forms > 0,
        impact: 'info',
        statusText: op.webmcp.forms > 0
          ? `${op.webmcp.forms} form WebMCP aracı olarak tanımlı (${op.webmcp.described} açıklamalı, ${op.webmcp.params} alan açıklaması)`
          : 'Formlarda WebMCP nitelikleri (toolname / tooldescription) yok — deneysel, bilgi amaçlı',
        howTo: 'Chrome\'un deneysel WebMCP bildirimsel API\'si (Chrome 149 ile origin trial) <form>\'a toolname ve tooldescription, alanlara toolparamdescription ekleyerek formu tarayıcıdaki ajanlara bir "araç" olarak tanıtır. Deneysel bir özellik; nitelik adları değişebilir.',
        audit: [{ step: 'PARSE', detail: `toolname'li form: ${op.webmcp.forms} / ${op.forms.count}`, ok: op.webmcp.forms > 0 }],
      });
    }
  }

  // 5-7. Mobil app kontrolleri (site bir app izliyorsa — GEO ⨉ ASO kesisimi)
  const app = ctx.trackedApp;
  if (app) {
    const softwareApp = nodes.find((n) => schemaTypesOf(n).some((t) => t === 'SoftwareApplication' || t === 'MobileApplication' || t === 'WebApplication'));
    checks.push({
      id: 'app-schema',
      name: 'Uygulama schema\'sı (SoftwareApplication)',
      ok: !!softwareApp,
      impact: 'medium',
      statusText: homeBlocked ? homeBlocked.reason : softwareApp ? 'SoftwareApplication/MobileApplication JSON-LD mevcut' : 'Uygulama schema\'sı yok',
      howTo: `Ana sayfaya (veya /app sayfasına) MobileApplication JSON-LD ekle: name "${app.name}", operatingSystem, applicationCategory, aggregateRating ve store URL'leri. AI asistanların "${app.name}" uygulamasını önermesi için web'de okunabilir kimlik şart.`,
      audit: [{ step: 'PARSE', detail: `Ana sayfa JSON-LD: SoftwareApplication ${softwareApp ? 'bulundu' : 'bulunamadı'}`, ok: !!softwareApp }],
      blocked: homeBlocked,
    });

    const html = home.state === 'ok' ? home.text : '';
    const hasAppStoreLink = app.appStoreId ? html.includes('apps.apple.com') : true;
    const hasPlayLink = app.playStoreId ? html.includes('play.google.com') : true;
    const storeLinksOk = home.state === 'ok' && hasAppStoreLink && hasPlayLink;
    checks.push({
      id: 'app-store-links',
      name: 'Store linkleri web\'de görünür',
      ok: storeLinksOk,
      impact: 'low',
      statusText: homeBlocked ? homeBlocked.reason : storeLinksOk ? 'App Store / Play Store linkleri ana sayfada' : 'Store linkleri ana sayfada bulunamadı',
      howTo: 'Ana sayfadan App Store ve Play Store\'a giden düz <a> linkleri ver — ajanlar app-web ilişkisini bu linklerden kurar.',
      audit: [{ step: 'PARSE', detail: `apps.apple.com: ${html.includes('apps.apple.com') ? 'var' : 'yok'}; play.google.com: ${html.includes('play.google.com') ? 'var' : 'yok'}`, ok: storeLinksOk }],
      blocked: homeBlocked,
    });

    if (app.appStoreId && aasa) {
      const aasaJson = aasa.state === 'ok' ? parseJsonSafe(aasa.text) : undefined;
      const aasaValid = isPlainObject(aasaJson) && !!(aasaJson.applinks || aasaJson.webcredentials);
      const aasaBlocked = blockedOf(aasa);
      checks.push({
        id: 'aasa',
        name: 'Universal Links (apple-app-site-association)',
        ok: aasaValid,
        impact: 'low',
        statusText: aasaBlocked ? aasaBlocked.reason : aasaValid ? 'AASA dosyası geçerli' : 'AASA yok veya geçersiz',
        howTo: '/.well-known/apple-app-site-association yayınla — derin linkler ajan akışlarında (ör. "uygulamada aç") doğru çalışır ve Apple app-site ilişkisini doğrular.',
        audit: [
          fetchStep('/.well-known/apple-app-site-association', aasa),
          { step: 'PARSE', detail: aasaValid ? 'applinks tanımlı' : 'Geçerli AASA JSON değil', ok: aasaValid },
        ],
        blocked: aasaBlocked,
      });
    }
  }

  return buildLevel('advanced', 'İleri Entegrasyon', checks, true);
}

// ────────────────────────────────────────────────────────────
//  L4 — COMMERCE
// ────────────────────────────────────────────────────────────

/**
 * Ticaret nisi — TAM KELIME (harf/rakam siniri, Turkce harfler dahil). Eski
 * /ecommerce|e-ticaret|shop|store|market/ alt dize aramasi ayarlardaki ozel
 * nis metinlerinde "dijital marketing", "photoshop egitimi" gibi degerleri de
 * ticaret sayiyordu.
 */
const ECOMMERCE_NICHE = /(?<![\p{L}\p{N}])(?:e-?ticaret|e-?commerce|online mağaza|online magaza|webshop)(?![\p{L}\p{N}])/iu;

/** Ana sayfadaki altyapi izleri — yalniz hangi feed'in yoklanacagini secer; tek basina puan vermez */
const SHOPIFY_MARK = /cdn\.shopify|myshopify/i;
const WOO_MARK = /\/wp-content\/plugins\/woocommerce\/|woocommerce-no-js|\bwc-block-/i;

/** Urun alt site haritasi (Shopify sitemap_products_1, Yoast product-sitemap, WP wp-sitemap-posts-product-1, urunler...) */
const PRODUCT_SITEMAP = /product|urun|ürün/i;
/** Kategori / etiket / marka listeleri urun sayfasi degildir */
const LISTING_SITEMAP = /product[_-]?(?:cat|tag)|categor|kategori|etiket|brand|marka|collection|koleksiyon/i;
/** urlset icinde urun sayfasi yolu: /urun/x, /urunler/x, /product/x, /products/x, /p/x */
const PRODUCT_PATH = /\/(?:urun|urunler|ürün|ürünler|product|products|p)\/[^/]+/i;
/** Site haritasinda listelenen Merchant / urun feed'i */
const MERCHANT_FEED = /merchant|google[-_]?shopping|product[-_]?feed|urun[-_]?feed|ürün[-_]?feed/i;
/** <link rel="alternate"> feed'inin urun feed'i olabilecegi izi — blog RSS'i elenir */
const PRODUCT_FEED_HINT = /product|urun|ürün|merchant|shopping|katalog|catalog/i;
/** Ana sayfada Product isareti — yalniz "istek atmaya deger mi" ipucu; puanlama cheerio ile */
const HOME_PRODUCT_HINT = /"@type"\s*:\s*(?:\[[^\]]*)?"(?:https?:\/\/schema\.org\/)?Product(?:Group)?"|itemtype\s*=\s*["']?https?:\/\/schema\.org\/Product/i;

const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');

function sameSite(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && hostKey(u.hostname) === hostKey(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Cozulmus yol + sorgu ("/ürün/x?a=1") — desen eslemesi icin */
function pathOfUrl(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname;
    try { p = decodeURIComponent(p); } catch { /* bozuk kodlama: ham yol */ }
    return `${p}${u.search}`;
  } catch {
    return '';
  }
}

/** Site haritasindaki <loc> degerleri (CDATA ve XML varliklari tek geciste cozulur) */
export function sitemapLocs(xml: string, max = 50_000): string[] {
  const out: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < max) {
    out.push(m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITY[e]));
  }
  return out;
}

/** En fazla n ornek: bas, orta, son — urun haritalari cogu zaman tarihe gore sirali, tek uca bakmayalim */
export function spreadSample(urls: string[], n = 3): string[] {
  const xs = [...new Set(urls)];
  if (xs.length <= n) return xs;
  const idx = [...new Set([0, Math.floor((xs.length - 1) / 2), xs.length - 1])];
  return idx.slice(0, n).map((i) => xs[i]);
}

/** Urun alt haritasindaki ayni-site adresler (alt haritanin tamami urun; yol suzgeci yok) */
export function productUrlsFromSubSitemap(xml: string, origin: string): string[] {
  return sitemapLocs(xml).filter((u) => sameSite(u, origin));
}

export interface CommercePlan {
  /** Ticaret icin en az bir ipucu var mi — yoksa hic ek istek atilmaz */
  hinted: boolean;
  shopify: boolean;
  woo: boolean;
  /** Merchant feed'i olabilecek ayni-site adresler (ana sayfa <link rel="alternate"> / site haritasi), en fazla 2 */
  feedCandidates: string[];
  /** sitemapindex'teki urun alt haritasi — once o okunur */
  productSitemap: string | null;
  /** urlset'ten urun yolu tasiyan adaylar */
  productUrls: string[];
}

/**
 * Hangi ticaret istekleri atilacak (saf). Servis yalniz bu plani uygular;
 * hicbir ipucu yoksa (yerel isletme, blog) tek bir ek istek bile atilmaz.
 */
export function planCommerceProbes(input: {
  origin: string; siteUrl: string; niche: string | null; homeHtml: string; sitemap: ScanContext['sitemap'];
}): CommercePlan {
  const html = input.homeHtml;
  const shopify = SHOPIFY_MARK.test(html);
  const woo = WOO_MARK.test(html);
  let productSitemap: string | null = null;
  let productUrls: string[] = [];
  const feeds: string[] = [];
  const found = input.sitemap.found;
  if (found && found.kind !== 'gzip' && found.body) {
    const locs = sitemapLocs(found.body).filter((u) => sameSite(u, input.origin));
    if (found.kind === 'sitemapindex') {
      productSitemap = locs.find((u) => { const p = pathOfUrl(u); return PRODUCT_SITEMAP.test(p) && !LISTING_SITEMAP.test(p); }) ?? null;
    } else {
      productUrls = locs.filter((u) => PRODUCT_PATH.test(pathOfUrl(u)));
    }
    feeds.push(...locs.filter((u) => MERCHANT_FEED.test(pathOfUrl(u))));
  }
  if (html) {
    const $ = cheerio.load(html);
    $('link[rel][href]').each((_, el) => {
      const rel = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/);
      const type = ($(el).attr('type') ?? '').split(';')[0].trim().toLowerCase();
      if (!rel.includes('alternate') || !/^(?:application\/(?:rss|atom)\+xml|application\/xml|text\/xml)$/.test(type)) return;
      let abs: string;
      try { abs = new URL(($(el).attr('href') ?? '').trim(), input.siteUrl).toString(); } catch { return; }
      if (sameSite(abs, input.origin) && PRODUCT_FEED_HINT.test(`${pathOfUrl(abs)} ${$(el).attr('title') ?? ''}`)) feeds.push(abs);
    });
  }
  const feedCandidates = [...new Set(feeds)].slice(0, 2);
  const hinted = ECOMMERCE_NICHE.test(String(input.niche ?? '')) || shopify || woo || HOME_PRODUCT_HINT.test(html)
    || !!productSitemap || productUrls.length > 0 || feedCandidates.length > 0;
  return { hinted, shopify, woo, feedCandidates, productSitemap, productUrls };
}

const FEED_LABEL: Record<ProductFeedKind, string> = {
  shopify: 'Shopify /products.json',
  woocommerce: 'WooCommerce Store API (/wp-json/wc/store/v1/products)',
  merchant: 'Google Merchant ürün feed\'i',
};

/**
 * Okunan govde gercek bir urun listesi mi. Platform izi tek basina kanit
 * degildir; yalniz dogrulanan liste puan alir.
 *  - Shopify: JSON nesnesinde dolu `products` dizisi
 *  - WooCommerce Store API: urun nesneleri dizisi — API kimliksizdir, urun
 *    verisi herkese aciktir (https://developer.woocommerce.com/docs/apis/store-api/)
 *  - Google Merchant RSS 2.0: g ad alani (xmlns:g="http://base.google.com/ns/1.0")
 *    + g:id / g:price tasiyan oge (https://support.google.com/merchants/answer/160589)
 */
export function validateProductFeed(kind: ProductFeedKind, p: Probe): { valid: boolean; detail: string } {
  if (p.state !== 'ok') return { valid: false, detail: describeProbe(p) };
  const text = p.text;
  if (!text.trim()) return { valid: false, detail: 'boş yanıt' };
  if (looksLikeHtml(text)) return { valid: false, detail: 'ürün listesi yerine HTML sayfa döndü' };
  if (kind === 'merchant') {
    const ns = /xmlns:g\s*=\s*["']http:\/\/base\.google\.com\/ns\/1\.0["']/i.test(text);
    const item = /<(?:item|entry)[\s>]/i.test(text);
    const field = /<g:(?:id|price)[\s>]/i.test(text);
    return ns && item && field
      ? { valid: true, detail: 'Google Merchant (g:) ürün öğeleri var' }
      : { valid: false, detail: 'Google Merchant ürün feed\'i değil (g: ad alanı ya da g:id / g:price öğesi yok)' };
  }
  const j = parseJsonSafe(text);
  if (kind === 'shopify') {
    if (isPlainObject(j) && Array.isArray(j.products)) {
      return j.products.length > 0 ? { valid: true, detail: 'products dizisi dolu' } : { valid: false, detail: 'ürün listesi boş döndü' };
    }
    // limit parametresi yok sayilip govde tavanda kesildiyse JSON eksik kalir; dizinin basi yeterli kanit
    if (p.truncated && /^\s*\{\s*"products"\s*:\s*\[\s*\{/.test(text)) return { valid: true, detail: 'products dizisi (yanıt kırpıldı)' };
    return { valid: false, detail: 'products dizisi içeren JSON değil' };
  }
  if (Array.isArray(j)) {
    if (j.length === 0) return { valid: false, detail: 'ürün listesi boş döndü' };
    return isPlainObject(j[0]) && 'id' in j[0]
      ? { valid: true, detail: 'ürün dizisi döndü' }
      : { valid: false, detail: 'ürün nesneleri içermeyen bir dizi döndü' };
  }
  if (p.truncated && /^\s*\[\s*\{\s*"id"\s*:/.test(text)) return { valid: true, detail: 'ürün dizisi (yanıt kırpıldı)' };
  return { valid: false, detail: 'ürün dizisi içeren JSON değil' };
}

const PRODUCT_SAMPLE_NOTE = 'Product schema ürün sayfalarında ölçülür; site haritasından okunabilir bir ürün sayfası örneklenemediği için bu kontrol puana girmedi (yalnız ana sayfa kontrol edildi).';
const PRODUCT_FEED_NOTE = 'Ürün feed\'i yalnız RanksUp gerçek bir ürün listesini okuyup doğrulayabildiğinde puanlanır (Shopify /products.json, WooCommerce Store API ya da sitede duyurulan Google Merchant feed\'i). Merchant Center\'a doğrudan yüklenen feed\'ler dışarıdan görünmediği için bulunamaması puan düşürmez.';

/** Urun sayfasi neden orneklenemedi — durum metni icin */
function noSampleReason(ctx: ScanContext, c: CommerceSignals): string {
  if (c.productPages.length > 0) return `Örneklenen ürün sayfaları açılamadı (${describeProbe(c.productPages[0].probe)})`;
  if (c.productSitemap && c.productSitemap.probe.state !== 'ok') return `Ürün site haritası (${pathOf(c.productSitemap.url, ctx.origin)}) okunamadı`;
  const found = ctx.sitemap.found;
  if (!found) return 'Site haritası bulunamadığı için ürün sayfası örneklenemedi';
  if (found.kind === 'gzip') return 'Site haritası sıkıştırılmış (.gz) olduğu için ürün sayfası örneklenemedi';
  return 'Site haritasında ürün sayfası (ürün alt haritası ya da /urun/, /product/, /p/ yolu) bulunamadı';
}

function levelCommerce(ctx: ScanContext, homeData: PageStructure): ReadinessLevel {
  const { home } = ctx.probes;
  const homeBlocked = blockedOf(home);
  const checks: ReadinessCheck[] = [];
  const html = home.state === 'ok' ? home.text : '';
  const commerce: CommerceSignals = ctx.commerce ?? { productSitemap: null, productPages: [], feeds: [] };

  const ecommerceNiche = ECOMMERCE_NICHE.test(String(ctx.niche ?? ''));
  const shopify = SHOPIFY_MARK.test(html);
  const woo = WOO_MARK.test(html);
  const describe = (h: ProductHit | null) => (h ? `${h.type} (${h.source})${h.offers ? ' + offers' : ', offers yok'}` : 'Product yok');

  // 1. Product schema + offers — site haritasindan orneklenen URUN SAYFALARINDA.
  // Eskiden yalniz ana sayfaya bakiliyordu; howTo "urun sayfalarina ekle"
  // derken urun sayfasinda schema'si olan magaza hep "eksik" goruyordu.
  const homeProduct = home.state === 'ok' ? productOf(homeData) : null;
  const pages = commerce.productPages.map((p) => ({
    ...p,
    product: p.probe.state === 'ok' ? productOf(pageStructure(p.probe.text)) : null,
  }));
  const readPages = pages.filter((p) => p.probe.state === 'ok');
  const offerPages = readPages.filter((p) => p.product?.offers);
  const pagesBlocked = readPages.length === 0 && pages.length > 0 && pages.every((p) => isUnmeasured(p.probe))
    ? blockedOf(pages[0].probe)
    : undefined;

  let schemaOk = false;
  let schemaImpact: CheckImpact = 'high';
  let schemaStatus: string;
  let schemaNote: string | undefined;
  let schemaBlocked = homeBlocked;
  if (homeBlocked) {
    schemaStatus = homeBlocked.reason;
  } else if (readPages.length > 0) {
    schemaOk = offerPages.length > 0;
    schemaStatus = schemaOk
      ? `Ürün sayfalarında Product + offers mevcut (${offerPages.length}/${readPages.length} örneklenen sayfa, ${offerPages[0].product!.source})`
      : readPages.some((p) => p.product)
        ? `Örneklenen ${readPages.length} ürün sayfasında Product var ama offers (fiyat, para birimi, stok) eksik`
        : `Örneklenen ${readPages.length} ürün sayfasında Product schema (JSON-LD ya da microdata) bulunamadı`;
  } else if (pagesBlocked) {
    schemaBlocked = pagesBlocked;
    schemaStatus = `Ürün sayfaları okunamadı — ${pagesBlocked.reason}`;
  } else if (homeProduct?.offers) {
    schemaOk = true;
    schemaStatus = `Ana sayfada ${homeProduct.type} + offers mevcut (${homeProduct.source}); ürün sayfası örneklenemedi`;
  } else {
    // Yalniz ana sayfa kontrol edilebildi: "eksik" demek dogrulanmamis bir iddia olur
    schemaImpact = 'info';
    schemaNote = PRODUCT_SAMPLE_NOTE;
    schemaStatus = `${noSampleReason(ctx, commerce)} — yalnız ana sayfa kontrol edildi (${describe(homeProduct)}), puana girmez`;
  }
  checks.push({
    id: 'product-schema',
    name: 'Product schema + offers',
    ok: schemaOk,
    impact: schemaImpact,
    statusText: schemaStatus,
    howTo: 'Ürün sayfalarına Product JSON-LD ekle: name, image, offers (price, priceCurrency, availability). Ajanların ürün ve fiyatı doğru okuması için ön koşul. RanksUp bunu site haritasından örneklediği en fazla 3 ürün sayfasında ölçer.',
    audit: [
      ...(commerce.productSitemap
        ? [{ step: 'FETCH' as const, detail: `Ürün site haritası ${pathOf(commerce.productSitemap.url, ctx.origin)} → ${describeProbe(commerce.productSitemap.probe)}`, ok: commerce.productSitemap.probe.state === 'ok' }]
        : []),
      ...pages.map((p) => ({ step: 'FETCH' as const, detail: `GET ${pathOf(p.url, ctx.origin)} → ${describeProbe(p.probe)}${p.probe.state === 'ok' ? ` · ${describe(p.product)}` : ''}`, ok: !!p.product?.offers })),
      { step: 'PARSE', detail: `Ana sayfa: ${describe(homeProduct)}`, ok: !!homeProduct?.offers },
      {
        step: 'CONCLUDE',
        detail: schemaBlocked ? 'Ölçülemedi — puana girmez' : schemaImpact === 'info' ? 'Ürün sayfası örneklenemedi — puana girmez' : schemaOk ? 'Product + offers var' : 'Ürün sayfalarında Product + offers yok',
        ok: schemaOk,
      },
    ],
    blocked: schemaBlocked,
    ...(schemaNote ? { scoreNote: schemaNote } : {}),
  });

  // 2. Urun feed'i — YALNIZ gercekten okunup dogrulanan liste puan alir.
  // Eskiden "ok: Shopify izi" idi: hicbir feed yoklanmadan "/products.json
  // sunuluyor" deniyor, WooCommerce / ikas / IdeaSoft / T-Soft / Ticimax
  // magazalari (Merchant feed'i olsa bile) puan kaybediyordu.
  const feeds = commerce.feeds.map((f) => ({ ...f, v: validateProductFeed(f.kind, f.probe) }));
  const validFeed = feeds.find((f) => f.v.valid);
  const feedsBlocked = !validFeed && feeds.length > 0 && feeds.every((f) => isUnmeasured(f.probe)) ? blockedOf(feeds[0].probe) : undefined;
  const probed = feeds.map((f) => FEED_LABEL[f.kind]).join(', ');
  checks.push({
    id: 'product-feed',
    name: 'Makine-okunur ürün feed\'i',
    ok: !!validFeed,
    impact: validFeed ? 'medium' : 'info',
    statusText: homeBlocked
      ? homeBlocked.reason
      : validFeed
        ? `${FEED_LABEL[validFeed.kind]} herkese açık ürün listesi döndürüyor${validFeed.kind === 'merchant' ? `: ${pathOf(validFeed.url, ctx.origin)}` : ''}`
        : feedsBlocked
          ? `${probed} okunamadı — ${feedsBlocked.reason}`
          : feeds.length > 0
            ? `${probed} yoklandı ama geçerli bir ürün listesi dönmedi (${feeds[0].v.detail}) — puana girmez`
            : 'Herkese açık bir ürün feed\'i bulunamadı — doğrulanamadığı için puana girmez',
    howTo: 'Ajanların ürün kataloğunu tek istekle okuyabileceği herkese açık bir feed sun. RanksUp şunları okuyup doğrular: Shopify mağazalarında /products.json, WooCommerce\'te Store API (/wp-json/wc/store/v1/products) ve ana sayfada <link rel="alternate"> ile ya da site haritasında duyurulan Google Merchant (RSS 2.0) ürün feed\'i.',
    audit: feeds.length > 0
      ? feeds.map((f) => ({ step: 'FETCH' as const, detail: `GET ${pathOf(f.url, ctx.origin)} → ${describeProbe(f.probe)} · ${f.v.detail}`, ok: f.v.valid }))
      : [{ step: 'PARSE', detail: 'Yoklanacak bilinen feed yok (Shopify / WooCommerce izi ya da sitede duyurulan Merchant feed\'i bulunamadı)', ok: false }],
    blocked: homeBlocked ?? feedsBlocked,
    ...(validFeed ? {} : { scoreNote: PRODUCT_FEED_NOTE }),
  });

  // Seviye yalniz ISLEM kaniti varsa puanlanir: ticaret nisi, Shopify /
  // WooCommerce izi, offers'li Product ya da dogrulanmis feed. Fiyatsiz urun
  // katalogu (B2B uretici) ajan ticaretiyle olculmez.
  const applicable = ecommerceNiche || shopify || woo || !!homeProduct?.offers || offerPages.length > 0 || !!validFeed;

  // BILGI (v3): ACP destegi dis bir isaretle yayinlanmiyor; v2'de her ticaret
  // sitesi bu yuzden puan kaybediyordu. ACP: OpenAI + Stripe'in birlikte
  // gelistirdigi acik standart, ChatGPT Instant Checkout bunu kullanir:
  // https://stripe.com/newsroom/news/stripe-openai-instant-checkout
  checks.push({
    id: 'agentic-checkout',
    name: 'Agentic checkout hazırlığı (ACP)',
    ok: false,
    impact: 'info',
    statusText: 'Ajan ödeme desteği siteden otomatik tespit edilemiyor — bilgi amaçlı, puana girmez',
    howTo: 'ChatGPT\'deki Instant Checkout, OpenAI ile Stripe\'ın birlikte geliştirdiği açık standart Agentic Commerce Protocol (ACP) ile çalışır. Bu desteğin sitede yayınlanan standart bir işareti olmadığı için RanksUp bunu doğrulayamaz; e-ticaret altyapı sağlayıcına ajan ödeme (ACP) desteğini sor.',
    audit: [{ step: 'CONCLUDE', detail: 'Dış sinyal yok — puansız bilgi', ok: false }],
  });

  return buildLevel('commerce', 'Ticaret (Agentic Commerce)', checks, applicable);
}

// ────────────────────────────────────────────────────────────
//  SKOR
// ────────────────────────────────────────────────────────────

export function checkState(c: ReadinessCheck): CheckState {
  if (c.blocked) return 'blocked';
  if (c.impact === 'info') return 'info';
  return c.ok ? 'pass' : 'fail';
}

/** Engellenen kontrol paydadan duser; info zaten 0 puan */
export function buildLevel(id: string, title: string, checks: ReadinessCheck[], applicable: boolean): ReadinessLevel {
  for (const c of checks) {
    c.state = checkState(c);
    if (c.state === 'blocked') delete c.fixKey;
  }
  const scored = checks.filter((c) => c.state === 'pass' || c.state === 'fail');
  const max = scored.reduce((a, c) => a + IMPACT_POINTS[c.impact], 0);
  const earned = scored.reduce((a, c) => a + (c.ok ? IMPACT_POINTS[c.impact] : 0), 0);
  return {
    id,
    title,
    score: max > 0 ? Math.round((earned / max) * 100) : 0,
    earned,
    max,
    applicable,
    checks,
    scoredChecks: scored.length,
    passedChecks: scored.filter((c) => c.ok).length,
    blockedChecks: checks.filter((c) => c.state === 'blocked').length,
  };
}

export function buildReadinessLevels(ctx: ScanContext): { levels: ReadinessLevel[]; stance: RobotsAiStance | null } {
  const rv = robotsView(ctx);
  const ev = interfaceEvidence(ctx);
  const home = ctx.probes.home.state === 'ok' ? pageStructure(ctx.probes.home.text) : EMPTY_STRUCTURE;
  return {
    levels: [levelQuickWins(ctx, rv), levelGroundwork(ctx, ev, home.nodes), levelAdvanced(ctx, ev, home.nodes), levelCommerce(ctx, home)],
    stance: rv.stance,
  };
}

/**
 * Tarama geneli erisim durumu — ana sayfa engelli/ulasilamaz ya da robots.txt
 * engelliyse. Kayitli seviyelerden de cikarilir (getLatest yeni kolon istemez).
 */
export function accessFromLevels(levels: ReadinessLevel[]): AccessSummary | null {
  const all = levels.flatMap((l) => l.checks ?? []);
  const home = all.find((c) => c.id === 'homepage-access')?.blocked;
  const robots = all.find((c) => c.id === 'robots-txt')?.blocked;
  const robotsWall = robots && BLOCK_KINDS.has(robots.kind) ? robots : undefined;
  if (home) {
    return {
      state: BLOCK_KINDS.has(home.kind) ? 'blocked' : 'unreachable',
      scope: robotsWall ? 'homepage+robots' : 'homepage',
      reason: home.reason, hint: home.hint, vendor: home.vendor, status: home.status,
    };
  }
  if (robotsWall) {
    return { state: 'blocked', scope: 'robots', reason: robotsWall.reason, hint: robotsWall.hint, vendor: robotsWall.vendor, status: robotsWall.status };
  }
  return null;
}

export interface ReadinessSummary {
  overallScore: number;
  status: ReadinessStatus;
  access: AccessSummary | null;
  nextUpToFix: Array<{ checkId: string; name: string; fixKey?: string }>;
  scoring: { earned: number; max: number; scoredChecks: number; blockedChecks: number };
}

export function summarizeLevels(levels: ReadinessLevel[]): ReadinessSummary {
  const applicable = levels.filter((l) => l.applicable);
  const earned = applicable.reduce((a, l) => a + l.earned, 0);
  const max = applicable.reduce((a, l) => a + l.max, 0);
  const overallScore = max > 0 ? Math.round((earned / max) * 100) : 0;
  const access = accessFromLevels(levels);
  const status: ReadinessStatus = access
    ? access.state
    : overallScore >= 85 ? 'ready' : overallScore >= 65 ? 'mostly_ready' : overallScore >= 40 ? 'needs_work' : 'not_ready';
  // "Siradaki duzeltmeler" — puanlanan ve basarisiz kontroller, etkisi en yuksek 3
  const nextUpToFix = applicable
    .flatMap((l) => l.checks.filter((c) => checkState(c) === 'fail'))
    .sort((a, b) => IMPACT_POINTS[b.impact] - IMPACT_POINTS[a.impact])
    .slice(0, 3)
    .map((c) => ({ checkId: c.id, name: c.name, fixKey: c.fixKey }));
  const scoredChecks = applicable.reduce((a, l) => a + l.checks.filter((c) => { const s = checkState(c); return s === 'pass' || s === 'fail'; }).length, 0);
  const blockedChecks = levels.reduce((a, l) => a + l.checks.filter((c) => checkState(c) === 'blocked').length, 0);
  return { overallScore, status, access, nextUpToFix, scoring: { earned, max, scoredChecks, blockedChecks } };
}
