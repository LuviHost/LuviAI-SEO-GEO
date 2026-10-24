/**
 * ISR'de BOS sayfanin onbellege girmesini engeller.
 *
 * NEDEN: landing-data.ts getJson API hatasini (kapali, >4 sn) yutup null doner. Next 15.5
 * ISR yeniden uretimi bu veriyle basarili sayar ve fiyatsiz /pricing, /compare, / ya da
 * /ranksup.md en az 600 sn onbellekte kalirdi — AI tarayicilari o sure fiyat gormezdi.
 * Yeniden uretimde hata FIRLATILIRSA Next son basarili sayfayi sunmaya devam eder ve
 * sonraki istekte yeniden dener.
 *
 * Istisnalar (bos veriye izin verilir, istemci yedek yolu doldurur):
 *  - `next build` (NEXT_PHASE=phase-production-build): build API'siz de gecmeli.
 *  - gelistirme (NODE_ENV!=production): yerelde API'siz calisilabilsin.
 *
 * Next importu yok — isr-guard.spec.mts dogrudan calistirir.
 */
type Env = Record<string, string | undefined>;

/** Bos veriyle sayfa uretmek serbest mi? Yalniz build ve gelistirmede. */
export function emptyRenderAllowed(env: Env = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build' || env.NODE_ENV !== 'production';
}

/**
 * Veri bossa (null / bos dizi) ve bos sayfa uretmek serbest degilse firlatir; aksi halde
 * veriyi aynen dondurur.
 */
export function requireForCache<T>(data: T, what: string, env: Env = process.env): T {
  const bos = data == null || (Array.isArray(data) && data.length === 0);
  if (bos && !emptyRenderAllowed(env)) {
    throw new Error(`${what} alinamadi — onbellekteki son basarili sayfa korunuyor (ISR)`);
  }
  return data;
}
