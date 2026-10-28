/**
 * Sentry'ye giden olaydan kisisel/oturum verisini cikarir — saf.
 *
 * NEDEN (28.10.2026): sendDefaultPii kapaliyken bile @sentry/core requestDataIntegration
 * istegin cerezlerini, govdesini ve basliklarini olaya ekliyordu. Cerezde oturum anahtari,
 * govdede form verisi (e-posta, sifre sifirlama, OAuth kodu) olabilir. Gizlilik metni
 * "cerez ve govde gonderilmez" der — bu fonksiyon o sozu tutar.
 * Ayni kod apps/api/src/common/sentry-scrub.ts'te (paket siniri; degistirirsen ikisini birden).
 */
const GIZLI_BASLIK = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-internal-key|x-revalidate-secret|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip)$/i;

export function sentryOlayTemizle<T>(event: T): T {
  const e = event as any;
  const req = e?.request;
  if (req && typeof req === 'object') {
    delete req.cookies;
    delete req.data;
    if (req.headers && typeof req.headers === 'object') {
      for (const k of Object.keys(req.headers)) if (GIZLI_BASLIK.test(k)) delete req.headers[k];
    }
    // Sorgu dizesinde token/kod tasiyan OAuth donusleri olabilir
    if (typeof req.query_string === 'string' && req.query_string) req.query_string = '[kaldirildi]';
    if (typeof req.url === 'string') req.url = req.url.split('?')[0];
  }
  if (e?.user) e.user = e.user.id ? { id: e.user.id } : undefined;
  return event;
}
