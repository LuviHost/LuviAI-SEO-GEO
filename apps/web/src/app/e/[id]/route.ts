import { apiBase } from '@/components/landing/landing-data';

/**
 * GET /e/:id — kurumsal e-postanin imzasindaki firmaya ozel baglanti (api eposta-kampanya tikUrl).
 * Tiklamayi API'ye bildirir (tarayicinin kullanici ajaniyla; tarayici/on izleme ayrimi API'de, tikGecerli),
 * sonra her durumda siteye yonlendirir: API yanit vermese de ziyaretci ana sayfaya ulasir.
 * NEDEN mutlak hedef: ters vekil arkasinda istek host'u 127.0.0.1:3000'e dusebiliyor (middleware.ts notu).
 */
export const dynamic = 'force-dynamic';

const HEDEF = `${(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ranksup.ai').replace(/\/+$/, '')}/?utm_source=eposta&utm_medium=email&utm_campaign=kurumsal`;

function yonlendir(): Response {
  return new Response(null, { status: 302, headers: { Location: HEDEF, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (/^[a-z0-9]{10,40}$/i.test(id)) {
    try {
      await fetch(`${apiBase()}/api/eposta/tik`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ua: req.headers.get('user-agent') ?? '' }),
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // kayit dusse de ziyaretci bekletilmez
    }
  }
  return yonlendir();
}

/** On izleme / guvenlik tarayicilarinin HEAD istegi: kaydetmeden yonlendir */
export async function HEAD(): Promise<Response> {
  return yonlendir();
}
