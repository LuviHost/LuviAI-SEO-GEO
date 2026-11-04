import { redirect } from 'next/navigation';

/**
 * Aksiyon Plani panelden kaldirildi (05.11.2026, sahip karari). Eski baglantilar ve yer imleri
 * kirilmasin diye genel bakisa yonlendirir. API ucu (/sites/:siteId/action-plan) MCP istemcileri
 * ve haftalik plan cron'u icin yerinde duruyor.
 */
export default async function ActionPlanRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sites/${id}`);
}
