export default function SiteDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Site: {params.id}</h1>
      <p className="text-slate-600">Audit + Topic Queue + Articles burada gösterilecek.</p>
    </div>
  );
}
