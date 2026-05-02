'use client';
import { useSiteContext } from '../site-context';
import { ContentCalendarPanel } from '@/components/site-flow-stepper';
import { Calendar } from 'lucide-react';

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
      <ContentCalendarPanel
        siteId={site.id}
        scheduled={scheduled}
        otherArticlesCount={otherCount}
        onChanged={refresh}
      />
    </div>
  );
}
