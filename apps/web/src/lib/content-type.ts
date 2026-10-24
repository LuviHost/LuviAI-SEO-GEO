/**
 * Konu onerisinin icerik tipi rozeti. Tip API'de konu siralayicisinin ciktisina
 * yazilir (topic_queues tier listeleri, content_type alani — api
 * articles/content-plan.ts annotateRankedTopics). Rehber varsayilandir; rozet
 * yalniz rehber DISI tipte gosterilir.
 *
 * Etiketler @luviai/shared CONTENT_TYPE_LABELS ile ayni (content-type.spec.mts
 * esitligi denetler); paylasilan paket istemci paketine alinmadi (sunucu
 * bagimliliklari tasiyor).
 */
export const CONTENT_TYPE_BADGES: Record<string, string> = {
  howto: 'Nasıl yapılır',
  comparison: 'Karşılaştırma',
  best_for: 'En iyi seçenekler',
  alternatives: 'Alternatifler',
  pricing: 'Fiyatlar',
  listicle: 'Liste',
};

/** Rozet metni; rehber / bilinmeyen / bos degerde null */
export function contentTypeBadge(raw: unknown): string | null {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CONTENT_TYPE_BADGES, raw) ? CONTENT_TYPE_BADGES[raw] : null;
}
