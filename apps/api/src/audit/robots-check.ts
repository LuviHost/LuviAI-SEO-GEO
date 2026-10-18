import type { AuditIssue, CheckResult } from './audit-checks.service.js';
import { parseRobotsAiStance } from './robots-ai-stance.js';

/**
 * Kontrol #2 — robots.txt, yontem v2 (saf).
 *
 * v1 yalnizca bot ADININ metinde gecip gecmedigine bakiyordu: "User-agent:
 * GPTBot / Disallow: /" bile "izin var" puani aliyordu; isim gecmeyen ama
 * `*` ile serbest olan botlar "eksik" sayiliyordu; egitim botlari (GPTBot,
 * Google-Extended) canli AI cevabi gorunurlugu gibi puanlaniyordu.
 *
 * v2: RFC 9309 ETKIN erisim (robots-ai-stance.ts) ve bot KATEGORISI:
 *  - Puan: AI ARAMA botlarinin (canli cevapta kaynak gosterme) erisimi.
 *    OpenAI: "OAI-SearchBot is used to surface websites in search results in
 *    ChatGPT's search features", GPTBot egitim icin, ayarlar bagimsiz.
 *    Anthropic: Claude-SearchBot'u engellemek arama gorunurlugunu azaltir;
 *    ClaudeBot egitim verisi icindir. (iki birincil kaynak)
 *  - Egitim botu engeli: BILGI — canli cevaplari etkilemez, bilincli tercih
 *    olabilir.
 */
export const ROBOTS_METHOD_VERSION = 2;

/** Canli AI cevaplarinda kaynak gosteren arama indeksleri (puana girer) */
export const KEY_AI_SEARCH_BOTS = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'] as const;

/**
 * robots_ai_search_blocked aciklamasi: ne engelli, neden otomatik duzeltilmez,
 * sahibi gorunmek isterse robots.txt'te NEYI degistirmeli.
 *
 * Talimat engelin kaynagina gore ayrilir (RFC 9309 2.2.1: bot kendi adini
 * tasiyan grubu uygular; boyle grup yoksa "*" grubunu —
 * https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1):
 *  - kendi grubunda "Disallow: /" → o satir kaldirilmali
 *  - "*" grubuyla engelli → bota ozel "Allow: /" grubu eklemek, diger botlarin
 *    kuralini degistirmeden erisim acar
 */
function aiSearchBlockedGuidance(blocked: Array<{ name: string; stance: 'allow' | 'block' | 'unspecified' }>): string {
  const named = blocked.filter((b) => b.stance === 'block').map((b) => b.name);
  const viaWildcard = blocked.filter((b) => b.stance !== 'block').map((b) => b.name);
  const parts = [
    `AI arama botu engelli: ${blocked.map((b) => b.name).join(', ')} — bu asistanların canlı cevaplarında kaynak olarak gösterilemezsin.`,
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

  const stance = parseRobotsAiStance(txt);
  const search = stance.bots.filter((b) => (KEY_AI_SEARCH_BOTS as readonly string[]).includes(b.name));
  const searchBlocked = search.filter((b) => b.effective === 'block').map((b) => b.name);
  const trainingBlocked = stance.bots.filter((b) => b.category === 'training' && b.effective === 'block').map((b) => b.name);

  score += Math.round(30 * ((search.length - searchBlocked.length) / Math.max(1, search.length)));
  if (searchBlocked.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'robots_ai_search_blocked',
      description: aiSearchBlockedGuidance(search.filter((b) => b.effective === 'block')),
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
      searchBots: search.map((b) => ({ name: b.name, effective: b.effective, declared: b.stance })),
      trainingBlocked,
    },
  };
}
