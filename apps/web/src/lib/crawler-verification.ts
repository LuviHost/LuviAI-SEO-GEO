/**
 * AI tarayici paneli — IP dogrulamasi yardimcilari (saf; testi crawler-verification.spec.mts).
 *
 * NEDEN (02.11.2026): AI botu kullanici ajanini tasiyan isteklerin cogu gercek
 * bot degildi (ornek: Claude-User UA'li 13.740 istegin 270'i Anthropic IP'sinden).
 * Sunucu artik her isabeti saglayicinin resmi IP listesiyle siniflandiriyor
 * (apps/api/src/audit/bot-verification.ts):
 *  - verified   → manset sayi ("doğrulanmış ziyaret")
 *  - unverified → kendini bot olarak tanitan, IP'si saglayiciya ait olmayan istek (taklit olabilir)
 *  - unknown    → dogrulanamadi: kurulu kod IP gondermiyor, liste okunamadi ya da bu bot icin yontem yok
 */

export type BotVerdict = 'verified' | 'unverified' | 'unknown';

export interface VerificationCounts {
  verified: number;
  unverified: number;
  unknown: number;
}

export interface BotVerificationRow extends VerificationCounts {
  hasMethod?: boolean;
}

export interface IngestHealth {
  lastEventAt: string | null;
  lastEventSource: string | null;
  throttled7d: number;
  lastThrottledAt: string | null;
  events24h: number;
  noIp24h: number;
  needsCodeUpdate: boolean;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const tr = (v: number) => v.toLocaleString('tr-TR');

/** API yaniti eski surumdeyse (alan yok) her sey "dogrulanamadi" sayilir — asla "dogrulanmis" degil */
export function normalizeCounts(v: Partial<VerificationCounts> | null | undefined, total = 0): VerificationCounts {
  if (!v) return { verified: 0, unverified: 0, unknown: n(total) };
  return { verified: n(v.verified), unverified: n(v.unverified), unknown: n(v.unknown) };
}

/** "Kendini <Bot> olarak tanıtan, doğrulanamayan istek: N — taklit olabilir" */
export function unverifiedText(bot: string | null, count: number): string {
  const kim = bot ? `Kendini ${bot} olarak tanıtan` : 'Kendini AI botu olarak tanıtan';
  return `${kim}, doğrulanamayan istek: ${tr(n(count))} — taklit olabilir`;
}

/** Dogrulanamadi satiri — nedeni durust soyler */
export function unknownText(count: number, opts: { hasMethod?: boolean; needsCodeUpdate?: boolean } = {}): string {
  const c = tr(n(count));
  if (opts.hasMethod === false) return `Doğrulanamadı: ${c} istek (bu bot resmi IP listesi yayımlamıyor)`;
  if (opts.needsCodeUpdate) return `Doğrulanamadı: ${c} istek (kurulu kod IP göndermiyor — kodu güncelleyin)`;
  return `Doğrulanamadı: ${c} istek (IP bilgisi yok ya da resmi liste o an okunamadı)`;
}

export interface BotRow extends VerificationCounts {
  bot: string;
  label: string;
  category: string | null;
  claimed: number;
  hasMethod: boolean;
}

/**
 * Bot listesi: dogrulanmis ziyarete gore siralanir (manset gercek ziyaret).
 * byBotVerification yoksa (eski API) tum istekler 'unknown'.
 */
export function buildBotRows(
  byBot: Record<string, number> | null | undefined,
  byBotVerification: Record<string, BotVerificationRow> | null | undefined,
  registry: Record<string, { label?: string; category?: string }> | null | undefined,
): BotRow[] {
  const rows: BotRow[] = [];
  for (const [bot, claimedRaw] of Object.entries(byBot ?? {})) {
    const claimed = n(claimedRaw);
    const v = byBotVerification?.[bot];
    const c = v ? normalizeCounts(v) : { verified: 0, unverified: 0, unknown: claimed };
    rows.push({
      bot,
      label: registry?.[bot]?.label ?? bot,
      category: registry?.[bot]?.category ?? null,
      claimed,
      hasMethod: v?.hasMethod !== false,
      ...c,
    });
  }
  return rows.sort((a, b) => b.verified - a.verified || b.claimed - a.claimed || a.bot.localeCompare(b.bot));
}

/** Panel uyarisi: kod eski mi, 429 ile dusen istek var mi */
export function ingestNotices(h: Partial<IngestHealth> | null | undefined): { codeUpdate: string | null; throttled: string | null } {
  if (!h) return { codeUpdate: null, throttled: null };
  const codeUpdate = h.needsCodeUpdate
    ? `Worker kodunu güncelle: son 24 saatte gelen ${tr(n(h.events24h))} isteğin ${tr(n(h.noIp24h))} tanesi IP bilgisi taşımıyor, bu yüzden gerçek bot olup olmadıkları doğrulanamıyor. Aşağıdaki güncel kodu yeniden kurun.`
    : null;
  const throttled = n(h.throttled7d) > 0
    ? `Son 7 günde ${tr(n(h.throttled7d))} bot bildirimi yoğunluk sınırına takılıp kaydedilemedi (HTTP 429). Güncel Worker kodu bu durumda bekleyip yeniden dener.`
    : null;
  return { codeUpdate, throttled };
}

/** Tek isabet rozeti */
export function verdictBadge(v: string | null | undefined): { label: string; tone: 'ok' | 'warn' | 'muted'; title: string } {
  if (v === 'verified') return { label: 'doğrulandı', tone: 'ok', title: 'IP adresi sağlayıcının resmi listesinde' };
  if (v === 'unverified') return { label: 'taklit olabilir', tone: 'warn', title: 'Kendini bot olarak tanıtıyor ama IP adresi sağlayıcıya ait değil' };
  return { label: 'doğrulanamadı', tone: 'muted', title: 'IP bilgisi yok, resmi liste okunamadı ya da bu bot için doğrulama yöntemi yok' };
}

/** Son event kaynagi */
export function sourceLabel(source: string | null | undefined): string {
  if (source === 'wp') return 'WordPress eklentisi';
  if (source === 'log') return 'nginx ajanı';
  if (source === 'beacon') return 'takip betiği';
  return 'Cloudflare Worker';
}
