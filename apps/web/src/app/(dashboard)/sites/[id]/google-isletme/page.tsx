import { redirect } from 'next/navigation';

/**
 * Google Isletme Profili panelden kaldirildi (13.11.2026, sahip karari: "bunu istemiyoruz").
 * Eski baglantilar ve yer imleri kirilmasin diye genel bakisa yonlendirir. Sunucu tarafi
 * (apps/api/src/gbp) ve herkese acik ucretsiz karne (/google-isletme-karnesi) yerinde duruyor;
 * yerel AI sorulari Prompt Lab'den (prompt-lab-local.tsx) eklenmeye devam eder.
 */
export default async function GoogleIsletmeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sites/${id}`);
}
