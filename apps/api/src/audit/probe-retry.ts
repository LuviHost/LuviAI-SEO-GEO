/**
 * AI olcum probe'lari icin yeniden deneme kurallari (saf).
 *
 * NEDEN: Mayis–Eylul 2026 kayitlarinda olcumlerin bir kismi gecici
 * hatalarla "HATA:" satiri olarak kaldi — Gemini "high demand" 503'leri
 * (Haziran'da probe'larin %37'si), iki gunluk "fetch failed" kesintisi,
 * DeepSeek "too busy". Bunlar ilk denemede pes edilince olcum kaybi oluyordu.
 * Ayni donemde Groq Llama modelinin kaldirilmasi gibi KALICI hatalar da
 * her gun her soru icin ayri ayri denenip HATA satiri uretiyordu.
 *
 *   gecici  → kisa bekleyip yeniden dene (varsayilan 3 deneme)
 *   kalici  → saglayici yapilandirma hatasi; batch'i durdur, saglayici
 *             "kullanilamaz" sayilsin (olcum yok ≠ skor 0)
 */

const TRANSIENT = [
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i,
  /timed? ?out/i,
  /connection error/i,
  /HTTP (408|409|425|429|500|502|503|504|520|522|524|529)\b/,
  /"code"\s*:\s*(429|500|502|503|504)\b/,
  /overloaded|high demand|too busy|temporarily|try again later|rate limit/i,
  /\b(UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL)\b/,
];

const FATAL = [
  /model[^\n]{0,80}(does not exist|not found|decommissioned|deprecated)/i,
  /model_not_found|model_decommissioned/i,
  /supported API model names/i,
  /HTTP 40[13]\b/,
  /invalid[_ ]api[_ ]key|incorrect api key|API key not valid/i,
];

export function isFatalProviderError(err: unknown): boolean {
  const msg = errorMessage(err);
  return FATAL.some((re) => re.test(msg));
}

export function isTransientProviderError(err: unknown): boolean {
  const msg = errorMessage(err);
  if (isFatalProviderError(err)) return false;
  return TRANSIENT.some((re) => re.test(msg));
}

/** Kalici saglayici hatasi — batch'i durdurmak icin firlatilir. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export interface RetryOptions {
  attempts?: number;
  /** n. denemeden once beklenecek sure (ms); n 1'den baslar */
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultDelay = (attempt: number) => 2000 * 3 ** (attempt - 1) + Math.floor(Math.random() * 500);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fn'i gecici hatalarda yeniden dener. Kalici hata ProviderConfigError olarak,
 * diger hatalar oldugu gibi firlatilir (cagiran HATA: satirina cevirir).
 */
export async function withProbeRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delay = opts.delayMs ?? defaultDelay;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isFatalProviderError(err)) throw new ProviderConfigError(errorMessage(err));
      if (attempt >= attempts || !isTransientProviderError(err)) throw err;
      await sleep(delay(attempt));
    }
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message ?? '';
  return typeof err === 'string' ? err : JSON.stringify(err ?? '');
}
