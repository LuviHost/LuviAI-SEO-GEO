/**
 * Istege bagli ISR yenilemesi — fiyat/plan verisi gosteren onbellekli sayfalar.
 *
 * NEDEN: /, /pricing, /compare ve /ranksup.md plan verisini /billing/plans'ten ISR ile
 * (600 sn) alir. Yalniz API yayina alindiginda (fiyat ya da plan maddesi degisti) web
 * sayfalari en fazla 10 dk eski fiyati gosterir. API yayinindan sonra
 * POST /api/revalidate (x-revalidate-secret basligi) once API'nin plan verdigini dogrular,
 * sonra bu yollari yeniler (bkz. plansUsable).
 * Kullanim ve yayin sirasi: scripts/deploy-web.sh basligi.
 *
 * Next importu yok — revalidate.spec.mts dogrudan calistirir.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Yenilenen yollar SABIT — istekten yol alinmaz */
export const REVALIDATE_PATHS = ['/', '/pricing', '/compare', '/ranksup.md'] as const;

/**
 * /billing/plans yaniti sayfa uretmeye yeter mi (dolu plan listesi)? Yenileme bu kontrol
 * GECMEDEN yapilmaz: revalidatePath onbellek kaydini dusurur ve sonraki istek sayfayi
 * BEKLETEREK uretir — API o an cevap vermezse isr-guard'in firlattigi hata 500 olarak
 * ziyaretciye gider (yerelde dogrulandi). Zaman tabanli ISR'de ise son iyi sayfa korunur.
 */
export function plansUsable(json: unknown): boolean {
  const plans = (json as { plans?: unknown } | null)?.plans;
  return Array.isArray(plans) && plans.length > 0;
}

/** Baslik sirla ayni mi? Sabit zamanli karsilastirma (uzunluk sizdirmamak icin ozet uzerinden). */
export function revalidateAuthorized(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
