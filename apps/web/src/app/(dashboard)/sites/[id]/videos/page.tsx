import { redirect } from 'next/navigation';

export default async function VideosLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sites/${id}/studio?tab=video`);
}
