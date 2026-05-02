'use client';
import { useSiteContext } from '../site-context';
import { ContentCalendarPanel } from '@/components/site-flow-stepper';
import { EmptyState, RelatedLinks } from '@/components/empty-state';
import { Calendar, Sparkles, FileText } from 'lucide-react';

export default function CalendarPage() {
  const { site, articles, refresh } = useSiteContext();
  const scheduled = (articles ?? []).filter((a: any) => {
    if (a?.status !== 'SCHEDULED') return false;
    if (!a?.scheduledAt) return false;
    const d = new Date(a.scheduledAt);
    return !isNaN(d.getTime());
  });
  const otherCount = (articles ?? []).filter((a: any) => a?.status && a.status !== 'SCHEDULED').length;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center">
          <Calendar className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Takvim</h2>
          <p className="text-sm text-muted-foreground">Planlanmış makaleler. Sürükleyip günü değiştir, saatini ayarla.</p>
        </div>
      </div>
      {scheduled.length === 0 ? (
        <EmptyState
          icon={Calendar}
          accent="sky"
          title="Takvim boş"
          description="Önerilen Konular sayfasından bir konuyu sürükleyip buraya bırak veya bir makaleyi takvime al. Yayın saati gelir, otomatik üretim başlar, WordPress'e gider."
          primary={{ label: 'Önerilen Konulara git', href: `/sites/${site.id}/topics` }}
          secondary={{ label: 'Makaleler', href: `/sites/${site.id}/articles` }}
        />
      ) : (
        <ContentCalendarPanel
          siteId={site.id}
          scheduled={scheduled}
          otherArticlesCount={otherCount}
          onChanged={refresh}
        />
      )}
      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/topics`, label: 'Önerilen Konular', description: 'Yeni öneri al, takvime sürükle', icon: Sparkles },
          { href: `/sites/${site.id}/articles`, label: 'Makaleler', description: 'Tüm pipeline durumlarını gör', icon: FileText },
        ]}
      />
    </div>
  );
}
