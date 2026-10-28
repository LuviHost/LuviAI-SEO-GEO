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
 * KREDI BITTI (28.10.2026): Gemini 402 "Your prepayment credits are depleted"
 * status RESOURCE_EXHAUSTED tasidigi icin gecici sayilip 3 kez deneniyor ve
 * musteriye "istek sinirina takildi" (rate_limited) diye gosteriliyordu —
 * gercekte hesap bakiyesi bitmisti, yukleme yapilana kadar hicbir deneme
 * gecmez. Artik kalici ('billing'): saglayici kullanilamaz sayilir, logda
 * ERROR olarak gorunur.
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

/** Saglayici hesabinda bakiye/kredi bitti — yukleme yapilana kadar kalici */
const BILLING = [
  /\bHTTP 402\b|"code"\s*:\s*402\b|^402\b/,
  /prepayment credits are depleted|credit balance is too low|insufficient[_ ]balance|insufficient_quota|payment required/i,
];

export function isBillingProviderError(err: unknown): boolean {
  const msg = errorMessage(err);
  const s = Number((err as any)?.status);
  return s === 402 || BILLING.some((re) => re.test(msg));
}

const FATAL = [
  ...BILLING,
  /model[^\n]{0,80}(does not exist|not found|decommissioned|deprecated)/i,
  /model_not_found|model_decommissioned/i,
  /supported API model names/i,
  /HTTP 40[13]\b/,
  /invalid[_ ]api[_ ]key|incorrect api key|API key not valid/i,
];

export function isFatalProviderError(err: unknown): boolean {
  const msg = errorMessage(err);
  return isBillingProviderError(err) || FATAL.some((re) => re.test(msg));
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

// ────────────────────────────────────────────────────────────
//  Musteriye donen hata metni — kararli kod
// ────────────────────────────────────────────────────────────
//
// NEDEN: probe catch bloklari 'HATA: ${err.message}' yaziyordu. postJson'in
// mesaji saglayici govdesinin ilk 300 karakterini tasir: org/hesap kimligi,
// kota ayrintisi, istek kimligi, maskeli anahtar parcasi, istemin yankisi.
// Bu metin probe.excerpt olarak API'den (anonim landing kontrolu dahil)
// donuyor ve snapshot'a yaziliyordu. Artik disariya yalnizca 'HATA: <kod>'
// cikar; ham metin maskelenip sunucu loguna gider. Siniflandirma yukaridaki
// gecici/kalici kurallarini DEGISTIRMEZ — yalnizca gosterilecek kodu secer.

export type ProbeErrorCode =
  | 'billing'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'network'
  | 'auth_failed'
  | 'model_unavailable'
  | 'bad_request'
  | 'unknown';

export const PROBE_ERROR_CODES: readonly ProbeErrorCode[] = [
  'billing', 'rate_limited', 'upstream_unavailable', 'timeout', 'network',
  'auth_failed', 'model_unavailable', 'bad_request', 'unknown',
];

/** Hata nesnesindeki ya da mesajdaki HTTP durum kodu (SDK .status, "HTTP 429", Gemini '"code": 503') */
function statusOf(err: unknown, msg: string): number | null {
  const s = Number((err as any)?.status ?? (err as any)?.statusCode);
  if (Number.isInteger(s) && s >= 100 && s <= 599) return s;
  const m = msg.match(/\bHTTP (\d{3})\b/) ?? msg.match(/"code"\s*:\s*(\d{3})\b/) ?? msg.match(/^(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

export function probeErrorCode(err: unknown): ProbeErrorCode {
  const msg = errorMessage(err);
  const status = statusOf(err, msg);
  const name = String((err as any)?.name ?? '');

  if (/model[^\n]{0,80}(does not exist|not found|decommissioned|deprecated)|model_not_found|model_decommissioned|supported API model names/i.test(msg)
    // Anthropic SDK: '404 {"type":"error","error":{"type":"not_found_error","message":"model: x"}}'
    || (status === 404 && /not_found_error|\bmodel\b/i.test(msg))) {
    return 'model_unavailable';
  }
  if (status === 401 || status === 403
    || /invalid[_ ]api[_ ]key|incorrect api key|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|authentication_error|permission_error/i.test(msg)) {
    return 'auth_failed';
  }
  // RESOURCE_EXHAUSTED'dan ONCE: Gemini kredi bitince de RESOURCE_EXHAUSTED doner (402)
  if (isBillingProviderError(err)) return 'billing';
  if (status === 429 || /rate.?limit|RESOURCE_EXHAUSTED|too many requests|exceeded your current quota/i.test(msg)) {
    return 'rate_limited';
  }
  if (status === 408 || status === 504 || name === 'TimeoutError' || name === 'AbortError'
    || /timed? ?out|ETIMEDOUT|DEADLINE_EXCEEDED|aborted due to timeout/i.test(msg)) {
    return 'timeout';
  }
  if ((status !== null && status >= 500)
    || /overloaded|high demand|too busy|temporarily|try again later|\bUNAVAILABLE\b|\bINTERNAL\b/i.test(msg)) {
    return 'upstream_unavailable';
  }
  if (/fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|connection error|network/i.test(msg)) {
    return 'network';
  }
  if (status !== null && status >= 400) return 'bad_request';
  return 'unknown';
}

/** probe.excerpt / sonuc.reason icin guvenli satir. 'HATA:' oneki korunur (hasRealProbes, persistRuns, alarm buna bakar). */
export function probeErrorExcerpt(err: unknown): string {
  return `HATA: ${probeErrorCode(err)}`;
}

/**
 * Saglayicinin dondugu durum degeri ('MAX_TOKENS', 'incomplete', 'end_turn')
 * gibi kisa bir enum ise aynen, degilse 'bilinmiyor'. "bos cevap (...)"
 * satirlarina saglayici metni sizmasin diye.
 */
export function safeReasonToken(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return /^[A-Za-z0-9_.:-]{1,40}$/.test(s) ? s : 'bilinmiyor';
}

// Anahtar bicimleri: OpenAI/Anthropic/DeepSeek 'sk-', xAI 'xai-', Perplexity
// 'pplx-', Groq 'gsk_', Google 'AIza'. Saglayici 401 mesajlari anahtarin
// maskeli parcasini tekrar edebiliyor ("Incorrect API key provided: sk-proj-****").
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|xai|pplx)-[A-Za-z0-9_*.-]{4,}/g, '[anahtar]'],
  [/\bgsk_[A-Za-z0-9_*]{4,}/g, '[anahtar]'],
  [/\bAIza[0-9A-Za-z_*-]{8,}/g, '[anahtar]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=*-]+/gi, 'Bearer [anahtar]'],
  [/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"']+/gi, '$1[anahtar]'],
];

export function redactSecrets(text: string): string {
  let out = String(text ?? '');
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Sunucu logu icin: maskelenmis, tek satir, kirpilmis hata metni */
export function safeErrorText(err: unknown, max = 300): string {
  return redactSecrets(errorMessage(err)).replace(/\s+/g, ' ').trim().slice(0, max);
}

const SAFE_HATA_TEXT = /^HATA: (?:bos cevap \([A-Za-z_]+=[A-Za-z0-9_.:-]{1,40}\)|saglayici reddi \(refusal\)|arama hatasi \(error_code=[A-Za-z0-9_.:-]{1,40}\))$/;

/**
 * Kayitli (eski) bir excerpt'i guvenli bicime cevirir. Eski snapshot'larda
 * 'HATA: HTTP 429: {...govde...}' gibi ham metinler duruyor; okuyan taraf
 * bunlari musteriye gostermeden once buradan gecirmeli. HATA olmayan metin
 * ve zaten guvenli bicimdeki satir aynen doner.
 */
export function sanitizeProbeExcerpt(excerpt: string | null | undefined): string | null | undefined {
  if (typeof excerpt !== 'string' || !excerpt.startsWith('HATA:')) return excerpt;
  const rest = excerpt.slice(5).trim();
  if ((PROBE_ERROR_CODES as readonly string[]).includes(rest) || SAFE_HATA_TEXT.test(excerpt)) return excerpt;
  return probeErrorExcerpt(new Error(rest));
}
