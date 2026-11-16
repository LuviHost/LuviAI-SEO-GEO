/**
 * AI olcum hatasi satirlari ('HATA: ...') → kullaniciya gosterilecek Turkce metin.
 *
 * API artik saglayici govdesini gostermiyor; probe.excerpt / sonuc.reason
 * 'HATA: <kod>' tasir (apps/api/src/audit/probe-retry.ts probeErrorCode).
 * Eski kayitlarda ham metin durabilir ('HATA: HTTP 429: {...}') — onlar da
 * gosterilmez, genel mesaja duser. HATA olmayan metin aynen doner.
 */

const CODE_TEXT: Record<string, string> = {
  billing: 'Bu asistan şu an ölçülemiyor (sağlayıcı hesabında geçici sorun) — sonuç skora katılmadı.',
  rate_limited: 'Sağlayıcının istek sınırına takıldı — bu soru ölçülemedi.',
  upstream_unavailable: 'Sağlayıcı geçici olarak yanıt vermedi — bu soru ölçülemedi.',
  timeout: 'Sağlayıcı zamanında yanıt vermedi — bu soru ölçülemedi.',
  network: 'Sağlayıcıya bağlanılamadı — bu soru ölçülemedi.',
  auth_failed: 'API anahtarı geçersiz ya da yetkisiz — sağlayıcı kullanılamadı.',
  model_unavailable: 'Sağlayıcının modeli şu an kullanılamıyor.',
  bad_request: 'Sağlayıcı isteği kabul etmedi — bu soru ölçülemedi.',
  unknown: 'Sağlayıcı hatası — bu soru ölçülemedi.',
};

/**
 * Olcum DISI satir: 'HATA:' (olculemedi) ya da 'YOK:' (Google AI Bakisi / AI Modu bu aramada
 * cevap gostermedi — api google-ai-surfaces.ts, 16.11.2026). Ikisi de skora, sayaca ve "anildi /
 * anilmadi" hesabina girmez; ayrimi isProbeAbsentText yapar.
 */
export function isProbeErrorText(s: unknown): s is string {
  return typeof s === 'string' && (s.startsWith('HATA:') || s.startsWith('YOK:'));
}

/**
 * Google yuzeyi bu soruda cevap GOSTERMEDI. "Anılmadın" DEGIL, "ölçülemedi" de degil: o aramada
 * Google yapay zeka cevabi gostermedi (sahip, 16.11.2026: "bu soruda AI Bakışı yok" diye yaz).
 */
export function isProbeAbsentText(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith('YOK:');
}

/** HATA / YOK satiri ise Turkce karsiligi, degilse null */
export function probeErrorText(s: unknown): string | null {
  if (!isProbeErrorText(s)) return null;
  if ((s as string).startsWith('YOK:')) return (s as string).slice(4).trim() || 'Google bu aramada yapay zekâ cevabı göstermedi.';
  const rest = s.slice(5).trim();
  if (Object.prototype.hasOwnProperty.call(CODE_TEXT, rest)) return CODE_TEXT[rest];
  if (rest.startsWith('bos cevap')) return 'Sağlayıcı boş cevap döndürdü — bu soru ölçülemedi.';
  if (rest.startsWith('arama hatasi')) return 'Asistanın web araması hata verdi — bu soru ölçülemedi, skora katılmadı.';
  if (rest.startsWith('saglayici reddi')) return 'Sağlayıcı soruyu yanıtlamayı reddetti — bu soru ölçülemedi.';
  return CODE_TEXT.unknown;
}

/** HATA satirini Turkceye cevirir; diger metni (or. butce uyarisi) oldugu gibi birakir */
export function displayProbeText(s: string | null | undefined): string | undefined {
  if (s == null) return undefined;
  return probeErrorText(s) ?? s;
}
