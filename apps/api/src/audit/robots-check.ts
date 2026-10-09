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
      description: `AI arama botu engelli: ${searchBlocked.join(', ')} — bu asistanların canlı cevaplarında kaynak olarak gösterilemezsin.`,
      fixable: true,
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
