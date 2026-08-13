import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Live Crawler ingest kimlik dogrulamasi — SAF mantik.
 *
 * NEDEN VAR: POST /api/tracker/events edge kaynaklarindan (Cloudflare Worker,
 * WordPress eklentisi, nginx ajani) beslenir; bu kaynaklar kullanici oturumu
 * tasiyamaz, bu yuzden uc @Public() kalmak zorunda. Onceki halde tek kontrol
 * "siteId DB'de var mi" idi — siteId ise dashboard URL'sinde, snippet'te ve
 * worker kodunda acikca duruyor. Yani siteId'yi goren herkes sahte bot
 * trafigi enjekte edip musteriye "ChatGPT siteni okudu" yalanini gosterebilir,
 * hatta gunluk tavani doldurup gercek event'leri bastirabilirdi. Artik istek
 * site bazli bir sirla HMAC-SHA256 imzalanmak zorunda.
 *
 * IMZALANAN METIN: `${timestamp}.${rawBody}`
 * Zaman damgasi imzanin ICINE giriyor; aksi halde saldirgan yakaladigi gecerli
 * bir govde+imza ciftini yeni bir zaman damgasiyla sonsuza dek tekrar
 * oynatabilirdi (replay). Boylece pencere disi her tekrar imzayi da bozar.
 *
 * Edge'de uygulanabilirligi kasitli olarak dusuk tutuldu: her platformda hazir
 * olan tek bir HMAC cagrisi + iki header yeterli (Web Crypto / hash_hmac /
 * openssl dgst).
 */

/** Sir oneki — loglarda/destek taleplerinde ne oldugu bir bakista anlasilsin */
export const INGEST_SECRET_PREFIX = 'luvi_ing_';

/** Imza header'i (deger bicimi: `sha256=<hex>`) */
export const INGEST_SIGNATURE_HEADER = 'x-ranksup-signature';
/** Zaman damgasi header'i (milisaniye epoch) */
export const INGEST_TIMESTAMP_HEADER = 'x-ranksup-timestamp';

/** Replay penceresi — 5 dk. Edge ile sunucu arasindaki saat kaymasina da bu tolerans. */
export const INGEST_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export type IngestAuthFailure =
  | 'no-secret'
  | 'missing-signature'
  | 'missing-timestamp'
  | 'bad-timestamp'
  | 'stale-timestamp'
  | 'bad-signature-format'
  | 'signature-mismatch';

export interface IngestAuthResult {
  ok: boolean;
  reason?: IngestAuthFailure;
}

export interface VerifyIngestInput {
  /** Site'nin ingestSecret'i — yoksa null/undefined gelir ve istek reddedilir */
  secret?: string | null;
  /** X-RanksUp-Signature header'i (ham deger) */
  signature?: string | null;
  /** X-RanksUp-Timestamp header'i (ham deger) */
  timestamp?: string | null;
  /** Istek govdesinin HAM hali — yeniden serilestirme imzayi bozar */
  rawBody: string;
  /** Test edilebilirlik icin disaridan verilebilir */
  now?: number;
  toleranceMs?: number;
}

/** Yeni bir ingest sirri uret (192 bit entropi). */
export function generateIngestSecret(): string {
  return INGEST_SECRET_PREFIX + randomBytes(24).toString('hex');
}

/** Imzalanacak kanonik metin — edge sablonlari da birebir bunu uretir. */
export function ingestSigningPayload(timestamp: string | number, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/** `sha256=<hex>` bicimindeki imzayi uret. */
export function computeIngestSignature(secret: string, timestamp: string | number, rawBody: string): string {
  const hex = createHmac('sha256', secret)
    .update(ingestSigningPayload(timestamp, rawBody), 'utf8')
    .digest('hex');
  return `sha256=${hex}`;
}

/**
 * Iki hex imzayi sabit zamanda karsilastir.
 *
 * timingSafeEqual FARKLI UZUNLUKTAKI buffer'larda TypeError firlatir; bu
 * durumda dogrudan false donuyoruz. Uzunluk farki zaten gizli bilgi degil
 * (SHA-256 hex her zaman 64 karakter), yani erken cikis bir sizinti yaratmaz —
 * ama try/catch'siz cagri 500'e ve gurultulu Sentry kaydina yol acardi.
 */
export function safeCompareHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Ingest istegini dogrula. Basarisizsa NEDEN'i doner (loglanip 401'e cevrilir). */
export function verifyIngestSignature(input: VerifyIngestInput): IngestAuthResult {
  const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
  if (!secret) return { ok: false, reason: 'no-secret' };

  const rawSig = typeof input.signature === 'string' ? input.signature.trim() : '';
  if (!rawSig) return { ok: false, reason: 'missing-signature' };

  const rawTs = typeof input.timestamp === 'string' ? input.timestamp.trim() : '';
  if (!rawTs) return { ok: false, reason: 'missing-timestamp' };

  const ts = Number(rawTs);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad-timestamp' };

  const now = input.now ?? Date.now();
  const tolerance = input.toleranceMs ?? INGEST_TIMESTAMP_TOLERANCE_MS;
  // Ileri tarihli damgalar da elenir: saati oynatip pencereyi genisletmek
  // replay korumasini etkisiz kilardi.
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'stale-timestamp' };

  // `sha256=` oneki zorunlu — algoritma pazarligini (downgrade) bastan kapatir.
  if (!/^sha256=[0-9a-fA-F]+$/.test(rawSig)) return { ok: false, reason: 'bad-signature-format' };

  const expected = computeIngestSignature(secret, rawTs, input.rawBody);
  // Hex buyuk/kucuk harf farki mesru bir istemci farkililigi; imza degeri degil.
  if (!safeCompareHex(expected.toLowerCase(), rawSig.toLowerCase())) {
    return { ok: false, reason: 'signature-mismatch' };
  }

  return { ok: true };
}

/** Log/hata mesaji icin okunabilir aciklama (kullaniciya donen metin degil). */
export function describeIngestFailure(reason: IngestAuthFailure): string {
  switch (reason) {
    case 'no-secret': return 'site icin ingest sirri tanimli degil (snippet henuz uretilmemis)';
    case 'missing-signature': return 'X-RanksUp-Signature header eksik';
    case 'missing-timestamp': return 'X-RanksUp-Timestamp header eksik';
    case 'bad-timestamp': return 'X-RanksUp-Timestamp sayisal degil';
    case 'stale-timestamp': return 'zaman damgasi 5 dakikalik pencerenin disinda';
    case 'bad-signature-format': return 'imza bicimi hatali (sha256=<hex> bekleniyor)';
    case 'signature-mismatch': return 'imza eslesmedi';
  }
}
