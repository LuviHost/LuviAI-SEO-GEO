import { redirect } from 'next/navigation';

/**
 * Eski "ASO Health" sayfası — skoru artık genel bakıştaki TEK birleşik ASO
 * skoruna dahil (bkz. _components/score.ts); rakip kıyaslaması da orada.
 * Eski bağlantılar kırılmasın diye yönlendirir.
 */
export default async function AsoHealthRedirect({ params }: { params: Promise<{ id: string; appId: string }> }) {
  const { id, appId } = await params;
  redirect(`/sites/${id}/aso/${appId}`);
}
