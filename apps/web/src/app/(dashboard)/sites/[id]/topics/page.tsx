'use client';
import { useState } from 'react';
import { useSiteContext } from '../site-context';
import { ContentFlowTable } from '@/components/content-flow-table';
import { EmptyState, RelatedLinks } from '@/components/empty-state';
import { Sparkles, Calendar, FileText, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function TopicsPage() {
  const { site, queue, articles, refresh, onboardingMode } = useSiteContext();
  const [running, setRunning] = useState(false);

  const runEngine = async () => {
    setRunning(true);
    try {
      await api.runTopicEngineNow(site.id);
      toast.success('Yeni konular hazırlandı');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const tier1 = queue?.tier1Topics ?? [];
  const usedTopics = new Set(
    (articles ?? []).map((a: any) => String(a?.topic ?? a?.title ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const freshTier1 = tier1.filter((t: any) => {
    const k = String(t?.topic ?? '').trim().toLowerCase();
    return k && !usedTopics.has(k);
  });

  const isEmpty = !queue || freshTier1.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Önerilen Konular</h2>
          <p className="text-sm text-muted-foreground">AI topic engine'in ürettiği fırsatlar. Sürükle-bırak ile takvime al veya direkt üret.</p>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={Sparkles}
          accent="amber"
          title={running ? 'Topic engine çalışıyor…' : 'Henüz öneri yok'}
          description={
            running
              ? 'Plan + GSC + GEO + rakip analizi → 6 tier-1 konu üretilecek (~60sn).'
              : 'Topic engine sitenin nişine ve rakiplerine göre 6 öneri çıkarır. Her birini tek tıkla üretebilir veya takvime sürükleyebilirsin.'
          }
          primary={{
            label: running ? 'Çalışıyor…' : 'Topic Engine Çalıştır',
            onClick: runEngine,
          }}
        />
      ) : (
        <ContentFlowTable
          queue={queue}
          articles={articles}
          siteId={site.id}
          onRefresh={refresh}
          onboardingMode={onboardingMode}
        />
      )}

      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/articles`, label: 'Üretilen Makaleler', description: 'Pipeline akışındaki ve yayında olan içerikler', icon: FileText },
          { href: `/sites/${site.id}/calendar`, label: 'Takvim', description: 'Planlanan yayın saatlerini gör', icon: Calendar },
          { href: `/sites/${site.id}/publish-targets`, label: 'Yayın Hedefleri', description: 'Makaleler nereye gidecek (WP, FTP, vb.)', icon: Send },
        ]}
      />
    </div>
  );
}
