import { Skeleton } from '@/components/ui/skeleton';

/**
 * /sites/[id] yükleme sınırı — sayfanın gerçek iskeleti.
 *
 * Eskiden tam ekran orbital animasyon ("Site Agent · Booting") vardı; ardından
 * layout kendi iskeletini de gösterdiği için kullanıcı art arda üç farklı
 * yükleme ekranı görüyordu. İskelet, gelecek içeriğin yerini tutar ve sayfa
 * açılınca hiçbir şey zıplamaz.
 */
export default function SitesIdLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
