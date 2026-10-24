import { revalidatePath } from 'next/cache';
import { apiBase } from '@/components/landing/landing-data';
import { REVALIDATE_PATHS, plansUsable, revalidateAuthorized } from '@/lib/revalidate';

/**
 * POST /api/revalidate — fiyat gosteren ISR sayfalarini hemen yeniler (gerekce: lib/revalidate.ts).
 * REVALIDATE_SECRET tanimli degilse uc YOK sayilir (404). Yollar sabit, istekten yol alinmaz.
 * API plan vermiyorsa yenileme YAPILMAZ (503): aksi halde sayfalar API gelene kadar 500 verirdi.
 * Dosya sistemi rotasi next.config'teki /api/:path* yeniden yazmasindan (afterFiles) once gelir.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });
  if (!revalidateAuthorized(req.headers.get('x-revalidate-secret'), secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  let usable = false;
  try {
    const res = await fetch(`${apiBase()}/api/billing/plans?locale=tr`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    usable = res.ok && plansUsable(await res.json());
  } catch {
    usable = false;
  }
  if (!usable) {
    return Response.json({ revalidated: [], error: 'API plan vermiyor; sayfalar yenilenmedi, son iyi hali sunuluyor' }, { status: 503 });
  }
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  return Response.json({ revalidated: REVALIDATE_PATHS });
}
