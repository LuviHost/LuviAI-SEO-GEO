import { redirect } from 'next/navigation';

/**
 * Google Isletme Profili panelden kaldirildi (13.11.2026, sahip karari: "bunu istemiyoruz").
 * Eski baglantilar ve yer imleri kirilmasin diye genel bakisa yonlendirir. Herkese acik ucretsiz
 * karne sayfasi da ayni gun kaldirildi (next.config.ts ana sayfaya yonlendirir). Sunucu tarafi
 * (apps/api/src/gbp) yerinde; yerel AI sorulari Prompt Lab'den (prompt-lab-local.tsx) eklenir.
 */
export default async function GoogleIsletmeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sites/${id}`);
}
