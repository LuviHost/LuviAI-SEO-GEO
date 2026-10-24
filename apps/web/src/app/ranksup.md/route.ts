import { fetchPlans } from '@/components/landing/landing-data';
import { buildRanksupMd } from '@/lib/ranksup-md';

/**
 * ranksup.ai/ranksup.md — sabit adreste Markdown urun ozeti (icerik ve gerekce:
 * src/lib/ranksup-md.ts). Plan verisi landing ve /pricing ile ayni yoldan (ISR).
 */
export const revalidate = 600;

export async function GET(): Promise<Response> {
  const plans = await fetchPlans('tr');
  return new Response(buildRanksupMd(plans), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
