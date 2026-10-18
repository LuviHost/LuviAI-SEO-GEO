/**
 * Tarayicinin siteye erisim durumu — GET /sites/:id cevabindaki `crawlAccess`
 * (ve /audit/latest'teki `accessBlocked`).
 *
 * Son tarama denemesinde anasayfa okunamadiysa (guvenlik duvari, bot
 * dogrulamasi, robots.txt, DNS, sunucu hatasi) API puan URETMEZ: engel
 * sayfasini site sanip skor vermek yaniltici olur (ofsayt.com 44 vakasi).
 * Neden ve cozum bu kayitla gelir; panel skor yerine bunu gosterir.
 */
export interface CrawlAccess {
  state: 'blocked' | 'unreachable';
  kind: string;
  url: string;
  status: number | null;
  vendor: string | null;
  /** Kisa Turkce aciklama */
  reason: string;
  /** Site sahibinin yapmasi gereken */
  hint: string;
  /** ISO zaman */
  at: string;
  source: 'audit' | 'brain';
}

function isCrawlAccess(v: unknown): v is CrawlAccess {
  const a = v as CrawlAccess | null | undefined;
  return !!a && typeof a.reason === 'string' && typeof a.at === 'string' && (a.state === 'blocked' || a.state === 'unreachable');
}

/**
 * Kayit su an gecerli mi? Son skordan YENIYSE (ya da hic skor yoksa) evet:
 * o zaman eldeki skor guncel degildir. Skor kayittan sonra uretildiyse erisim
 * duzelmis demektir (API basarili taramada kaydi zaten siler).
 */
export function currentCrawlAccess(
  crawlAccess: unknown,
  audit: { ranAt?: string | Date | null } | null | undefined,
): CrawlAccess | null {
  if (!isCrawlAccess(crawlAccess)) return null;
  if (!audit?.ranAt) return crawlAccess;
  const at = new Date(crawlAccess.at).getTime();
  const ranAt = new Date(audit.ranAt).getTime();
  if (!Number.isFinite(at)) return null;
  return !Number.isFinite(ranAt) || at > ranAt ? crawlAccess : null;
}

export function crawlAccessTitle(a: CrawlAccess): string {
  return a.state === 'blocked' ? 'Erişim engellendi' : 'Siteye ulaşılamadı';
}
