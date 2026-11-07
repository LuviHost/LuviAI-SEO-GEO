import type { AuditIssue, CheckResult } from './audit-checks.service.js';
import type { KnownAiBot } from './known-ai-bots.js';
import { parseRobotsAiStance } from './robots-ai-stance.js';

/**
 * Kontrol #2 — robots.txt, yontem v3 (saf).
 *
 * v1 yalnizca bot ADININ metinde gecip gecmedigine bakiyordu: "User-agent:
 * GPTBot / Disallow: /" bile "izin var" puani aliyordu; isim gecmeyen ama
 * `*` ile serbest olan botlar "eksik" sayiliyordu; egitim botlari (GPTBot,
 * Google-Extended) canli AI cevabi gorunurlugu gibi puanlaniyordu.
 *
 * v2: RFC 9309 ETKIN erisim (robots-ai-stance.ts) ve bot KATEGORISI; puan uc
 * AI arama botunun (OAI-SearchBot, Claude-SearchBot, PerplexityBot) erisimi.
 *
 * v3 (08.11.2026 kanit denetimi): puanlanan kisim gorunurlugu GERCEKTEN kesen
 * alti botun ETKIN olarak tamamen engelli olup olmadigi:
 *  - Googlebot ve Bingbot: klasik arama dizinleri; Google'in AI ozellikleri
 *    de Googlebot'un dizinine dayanir. Biri tamamen engelliyse site o arama
 *    motorundan duser → KRITIK sorun, robots.txt puani en fazla 30.
 *  - OAI-SearchBot, PerplexityBot, Claude-SearchBot: AI arama indeksleri
 *    (OpenAI: "OAI-SearchBot is used to surface websites in search results in
 *    ChatGPT's search features"; Anthropic: Claude-SearchBot'u engellemek arama
 *    gorunurlugunu azaltir).
 *  - Claude-User: Anthropic'e gore engellemek, kullanicinin sorusuna cevap
 *    verirken sayfanin getirilmesini engeller ve gorunurlugu azaltir
 *    (https://support.claude.com/en/articles/8896518-anthropic-crawlers).
 * Egitim botu engeli BILGI olarak kalir (canli cevaplari etkilemez). Botlari
 * adiyla anmak bir standart degildir: isimle anilmayan bot `*` grubuna uyar,
 * bu yuzden puan "kac bot anildi"ya degil ETKIN erisime bakar.
 * DeepSeek ve xAI (Grok) resmi bot belgesi yayimlamadigi icin listede yok.
 */
export const ROBOTS_METHOD_VERSION = 3;

/** Klasik arama motoru botlari — tam engel KRITIK */
export const CLASSIC_SEARCH_BOTS = ['Googlebot', 'Bingbot'] as const;

/** Canli AI cevaplarinda kaynak gosteren / sayfa getiren botlar */
export const AI_SEARCH_BOTS = ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'] as const;

/**
 * Gorunurlugu kesen alti kritik bot (puana girer). Agent Readiness'in
 * 'ai-crawler-rules' kontrolu ve GEO skor kartinin Crawler sutunu ayni listeyi
 * kullanir.
 */
export const CRITICAL_SEARCH_BOTS: readonly KnownAiBot[] = [
  { name: 'Googlebot',        category: 'search', documented: true, description: 'Google Arama (AI Genel Bakış dahil)' },
  { name: 'Bingbot',          category: 'search', documented: true, description: 'Bing Arama' },
  { name: 'OAI-SearchBot',    category: 'search', documented: true, description: 'ChatGPT arama indeksi' },
  { name: 'PerplexityBot',    category: 'search', documented: true, description: 'Perplexity arama indeksi' },
  { name: 'Claude-SearchBot', category: 'search', documented: true, description: 'Claude arama indeksi' },
  { name: 'Claude-User',      category: 'user-triggered', documented: true, description: 'Claude sohbetinde canlı sayfa getirme' },
];

/** Googlebot ya da Bingbot tamamen engelliyse robots.txt puan tavani */
export const CLASSIC_BLOCK_SCORE_CAP = 30;

export interface CriticalBotAccess {
  name: string;
  /** RFC 9309 etkin durum: isimle anilmayan bot `*` grubuna uyar */
  effective: 'allow' | 'block';
  /** Acik deklarasyon (bot kendi grubunda anildi mi) */
  declared: 'allow' | 'block' | 'unspecified';
  classic: boolean;
}

/** Alti kritik botun robots.txt'teki ETKIN erisimi (saf; robots.txt metni verilir) */
export function criticalBotAccess(robotsTxt: string): CriticalBotAccess[] {
  return parseRobotsAiStance(robotsTxt, CRITICAL_SEARCH_BOTS).bots.map((b) => ({
    name: b.name,
    effective: b.effective,
    declared: b.stance,
    classic: (CLASSIC_SEARCH_BOTS as readonly string[]).includes(b.name),
  }));
}

/**
 * Engel aciklamasi: ne engelli, neden otomatik duzeltilmez, sahibi gorunmek
 * isterse robots.txt'te NEYI degistirmeli.
 *
 * Talimat engelin kaynagina gore ayrilir (RFC 9309 2.2.1: bot kendi adini
 * tasiyan grubu uygular; boyle grup yoksa "*" grubunu —
 * https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1):
 *  - kendi grubunda "Disallow: /" → o satir kaldirilmali
 *  - "*" grubuyla engelli → bota ozel "Allow: /" grubu eklemek, diger botlarin
 *    kuralini degistirmeden erisim acar
 */
function blockedGuidance(lead: string, blocked: CriticalBotAccess[]): string {
  const named = blocked.filter((b) => b.declared === 'block').map((b) => b.name);
  const viaWildcard = blocked.filter((b) => b.declared !== 'block').map((b) => b.name);
  const parts = [
    lead,
    'Otomatik düzeltilmez: RanksUp robots.txt\'teki mevcut kuralları değiştirmez ve engel bilinçli bir tercih olabilir; karar senin.',
  ];
  if (named.length > 0) {
    parts.push(`Görünmek istersen robots.txt'te ${named.join(', ')} için kendi "User-agent" grubundaki "Disallow: /" satırını kaldır.`);
  }
  if (viaWildcard.length > 0) {
    parts.push(`${viaWildcard.join(', ')} adıyla anılmadığı için "User-agent: *" grubundaki "Disallow: /" kuralına uyuyor; ${viaWildcard.length > 1 ? 'bu botlar' : 'bu bot'} için "Allow: /" içeren ayrı bir "User-agent" grubu eklersen diğer botların kuralı değişmeden erişim açılır.`);
  }
  return parts.join(' ');
}

export function computeRobotsCheck(robotsTxt: string | null): CheckResult {
  const found = !!robotsTxt;
  const issues: AuditIssue[] = [];
  if (!found) {
    issues.push({
      severity: 'critical',
      type: 'robots_missing',
      description: 'robots.txt yok — crawler kontrolü yapamıyorsun',
      fixable: true,
      fixCommand: 'auto-fix: robots',
    });
    return { id: 'robots_txt', name: 'Robots.txt', found, valid: false, score: 0, issues, details: { methodVersion: ROBOTS_METHOD_VERSION } };
  }

  const txt = robotsTxt!;
  let score = 50;
  const hasSitemap = /Sitemap:\s*\S+/i.test(txt);
  if (hasSitemap) score += 20;
  else issues.push({ severity: 'warning', type: 'robots_no_sitemap', description: 'robots.txt içinde Sitemap referansı yok', fixable: true });

  const critical = criticalBotAccess(txt);
  const blocked = critical.filter((b) => b.effective === 'block');
  const classicBlocked = blocked.filter((b) => b.classic);
  const aiBlocked = blocked.filter((b) => !b.classic);
  const trainingBlocked = parseRobotsAiStance(txt).bots
    .filter((b) => b.category === 'training' && b.effective === 'block')
    .map((b) => b.name);

  score += Math.round(30 * ((critical.length - blocked.length) / critical.length));
  if (classicBlocked.length > 0) score = Math.min(score, CLASSIC_BLOCK_SCORE_CAP);

  if (classicBlocked.length > 0) {
    issues.push({
      severity: 'critical',
      type: 'robots_search_engine_blocked',
      description: blockedGuidance(
        `Arama motoru botu tamamen engelli: ${classicBlocked.map((b) => b.name).join(', ')} — site ${classicBlocked.length > 1 ? 'bu arama motorlarında' : 'bu arama motorunda'} ve bu dizine dayanan AI cevaplarında görünmez.`,
        classicBlocked,
      ),
      // OTOMATIK DUZELTILEMEZ: guvenli robots birlestirmesi (robots-merge.ts)
      // mevcut hicbir Disallow'u kaldirmaz/zayiflatmaz (fix-routes.ts MANUAL_ISSUE_TYPES)
      fixable: false,
    });
  }
  if (aiBlocked.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'robots_ai_search_blocked',
      description: blockedGuidance(
        `AI arama botu engelli: ${aiBlocked.map((b) => b.name).join(', ')} — bu asistanların canlı cevaplarında kaynak olarak gösterilemezsin.`,
        aiBlocked,
      ),
      // OTOMATIK DUZELTILEMEZ: guvenli robots birlestirmesi (robots-merge.ts)
      // mevcut hicbir Disallow'u kaldirmaz/zayiflatmaz; engel bilincli bir
      // tercih olabilir, karar site sahibinin. auto-fix onizlemesine gitseydi
      // engeli kaldiramayan bir onizleme acilirdi.
      fixable: false,
    });
  }
  if (trainingBlocked.length > 0) {
    issues.push({
      severity: 'info',
      type: 'robots_ai_training_blocked',
      description: `Eğitim botları engelli (${trainingBlocked.slice(0, 5).join(', ')}${trainingBlocked.length > 5 ? '…' : ''}). Bu canlı AI cevaplarını etkilemez; bilinçli bir tercihse sorun değil.`,
      fixable: false,
    });
  }

  return {
    id: 'robots_txt',
    name: 'Robots.txt',
    found,
    valid: score >= 70,
    score,
    issues,
    details: {
      methodVersion: ROBOTS_METHOD_VERSION,
      hasSitemap,
      // v3: alti kritik bot (v2'de yalniz uc AI arama botu)
      searchBots: critical.map((b) => ({ name: b.name, effective: b.effective, declared: b.declared })),
      trainingBlocked,
    },
  };
}
