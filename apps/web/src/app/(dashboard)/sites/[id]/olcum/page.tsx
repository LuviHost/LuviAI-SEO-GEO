import { redirect } from 'next/navigation';

/**
 * Olcum Altyapisi panelden kaldirildi (13.11.2026, sahip karari: "cok da onemli degil").
 * Urunun ana isi degildi, bir kez bakilan bir ekrandi ve fiyat/vitrin sayfalarinda vaat
 * edilmiyordu. Eski baglantilar ve yer imleri kirilmasin diye genel bakisa yonlendirir.
 * Sunucu tarafi (apps/api/src/olcum) yerinde; ekran ve panel yardimcilari git gecmisinde.
 */
export default async function OlcumRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sites/${id}`);
}
