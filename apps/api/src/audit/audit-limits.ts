/**
 * Model cagiran GEO Lab araclarinin SERVIS duzeyi tavanlari.
 *
 * NEDEN AYRI DOSYA: tavanlar yalniz audit.controller'da (clampInt) ve DTO'da
 * uygulaniyordu; servisi dogrudan cagiran yollar (MCP, worker, baska bir
 * servis — or. community-agent.service) sinirsiz deger gecebilirdi
 * (limit=1000 → yuzlerce model cagrisi). Servisler ve DTO ayni sabiti buradan
 * okur; audit.dto.ts yeniden disa aktarir (controller importu degismez).
 * DTO modulu class-validator yukler; servisler bu hafif dosyayi kullanir.
 */

/** Topluluk taramasi: firsat basina bir model cagrisi (yanit taslagi) */
export const COMMUNITY_MAX_LIMIT = 20;
/** GEO heatmap: sorgu basina 4 saglayici cagrisi; panel/SDK 10 gonderir */
export const GEO_HEATMAP_MAX_QUERIES = 20;

/**
 * Sayiyi [1, max] araligina sikistirir (tam sayiya keser). Sayi degilse
 * (undefined, NaN, dize) varsayilan doner — controller'daki clampInt ile ayni.
 */
export function clampLimit(value: unknown, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
