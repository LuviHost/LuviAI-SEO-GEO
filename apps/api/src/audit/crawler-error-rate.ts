/**
 * Bot hata-orani tetikleri — saf.
 *
 * NEDEN: IRS.gov vakasi (Ağu 2026): site insanlara acikken Googlebot/AI
 * botlari sayfayi alamadi; bir ayda #1 oldugu her kelime gitti. AiCrawlerHit
 * gunluk bot basina 4xx/5xx sayiyor ama hicbir yerde OKUNMUYORDU. Bu modul
 * "bir bot hata aliyor ama baska botlar 2xx aliyor" durumunu yakalar —
 * yani sorun sitenin komple down olmasi degil, bot-ozel bir engel/UA katmani.
 *
 * FRENLER (ai-mention-alarm ile ayni ruh):
 *   - minHits altindaki bot atlanir (3 istekten 2'si 500 alarm degil)
 *   - errorRateThreshold: (4xx+5xx)/hits
 *   - saglikli bot yoksa (hicbiri 2xx almiyor) alarm URETME: site komple
 *     down demektir, bu farkli bir olay ve elimizde insan trafigi sinyali yok.
 */

export interface BotDailyRow {
  bot: string;
  date: string; // YYYY-MM-DD
  hits: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
}

export interface CrawlerErrorTrigger {
  bot: string;
  hits: number;
  errors: number;
  errorRate: number;
  kind: 'server_error' | 'client_error';
  /** Ayni pencerede 2xx alan diger botlar — "site ayakta" kaniti */
  healthyBots: string[];
}

export const CRAWLER_ERROR_MIN_HITS = 20;
export const CRAWLER_ERROR_RATE_THRESHOLD = 0.4;

export function findCrawlerErrorTriggers(
  rows: BotDailyRow[],
  opts: { minHits?: number; errorRateThreshold?: number } = {},
): CrawlerErrorTrigger[] {
  const minHits = opts.minHits ?? CRAWLER_ERROR_MIN_HITS;
  const threshold = opts.errorRateThreshold ?? CRAWLER_ERROR_RATE_THRESHOLD;

  // Pencere: bot bazinda topla (birden fazla gun gelebilir)
  const byBot = new Map<string, { hits: number; s2: number; s4: number; s5: number }>();
  for (const r of rows) {
    const cur = byBot.get(r.bot) ?? { hits: 0, s2: 0, s4: 0, s5: 0 };
    cur.hits += r.hits; cur.s2 += r.status2xx; cur.s4 += r.status4xx; cur.s5 += r.status5xx;
    byBot.set(r.bot, cur);
  }

  const healthy = [...byBot.entries()].filter(([, v]) => v.s2 > 0).map(([bot]) => bot).sort();
  const out: CrawlerErrorTrigger[] = [];
  for (const [bot, v] of byBot) {
    if (v.hits < minHits) continue;
    const errors = v.s4 + v.s5;
    const rate = errors / v.hits;
    if (rate < threshold) continue;
    const others = healthy.filter((b) => b !== bot);
    if (others.length === 0) continue; // site komple down — farkli olay
    out.push({
      bot,
      hits: v.hits,
      errors,
      errorRate: Math.round(rate * 1000) / 1000,
      kind: v.s5 >= v.s4 ? 'server_error' : 'client_error',
      healthyBots: others,
    });
  }
  return out.sort((a, b) => b.errorRate - a.errorRate || b.hits - a.hits);
}
