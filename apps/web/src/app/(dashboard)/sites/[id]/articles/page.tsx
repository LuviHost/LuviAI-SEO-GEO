'use client';
import { useState } from 'react';
import { useSiteContext } from '../site-context';
import { ContentFlowTable } from '@/components/content-flow-table';
import { EmptyState, RelatedLinks } from '@/components/empty-state';
import { FileText, Sparkles, Calendar, Send, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ArticlesPage() {
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

  // Empty: hem queue boş hem hiç article yok
  const tier1 = queue?.tier1Topics ?? [];
  const usedTopics = new Set(
    (articles ?? []).map((a: any) => String(a?.topic ?? a?.title ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const freshTier1 = tier1.filter((t: any) => {
    const k = String(t?.topic ?? '').trim().toLowerCase();
    return k && !usedTopics.has(k);
  });
  const isFullyEmpty = (!queue || freshTier1.length === 0) && (articles ?? []).length === 0;

  // Sayım istatistikleri
  const counts = {
    suggested: freshTier1.length,
    pipeline: (articles ?? []).filter((a: any) => ['GENERATING', 'EDITING', 'READY_TO_PUBLISH'].includes(a.status)).length,
    scheduled: (articles ?? []).filter((a: any) => a.status === 'SCHEDULED').length,
    published: (articles ?? []).filter((a: any) => a.status === 'PUBLISHED').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">İçerikler</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              AI önerilerini, üretim akışındaki ve yayında olan makaleleri tek listede gör.
              Önerileri sürükleyip takvime al veya direkt üret.
            </p>
          </div>
        </div>
        {!isFullyEmpty && (
          <Button size="sm" variant="outline" onClick={runEngine} disabled={running}>
            <RefreshCw className={cn('h-4 w-4 mr-1', running && 'animate-spin')} />
            {running ? 'Yenileniyor…' : 'Yeni öneriler'}
          </Button>
        )}
      </div>

      {/* Mini özet bar — durum sayıları */}
      {!isFullyEmpty && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <CountChip label="Önerilen" value={counts.suggested} accent="amber" />
          <CountChip label="Pipeline'da" value={counts.pipeline} accent="brand" />
          <CountChip label="Takvimde" value={counts.scheduled} accent="sky" />
          <CountChip label="Yayında" value={counts.published} accent="emerald" />
        </div>
      )}

      {isFullyEmpty ? (
        <EmptyState
          icon={Sparkles}
          accent="amber"
          title={running ? 'Topic engine çalışıyor…' : 'Henüz içerik yok'}
          description={
            running
              ? 'Plan + GSC + GEO + rakip analizi → 6 tier-1 konu üretilecek (~60sn).'
              : 'Topic engine sitenin nişine ve rakiplerine göre 6 öneri çıkarır. Her birini takvime alabilir veya direkt üretebilirsin.'
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
          { href: `/sites/${site.id}/calendar`, label: 'Takvim', description: 'Planlanan yayın saatlerini gör + yeniden düzenle', icon: Calendar },
          { href: `/sites/${site.id}/publish-targets`, label: 'Yayın Hedefleri', description: 'Makaleler nereye gidecek (WP, FTP, vb.)', icon: Send },
          { href: `/sites/${site.id}/audit`, label: 'Site Skoru', description: 'SEO + GEO 14 kontrol noktası', icon: Sparkles },
        ]}
      />
    </div>
  );
}

function CountChip({
  label, value, accent,
}: {
  label: string;
  value: number;
  accent: 'amber' | 'brand' | 'sky' | 'emerald';
}) {
  const colors: Record<string, string> = {
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    brand: 'border-brand/30 bg-brand/5 text-brand',
    sky: 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-400',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors[accent]}`}>
      <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-widest font-semibold mt-1">{label}</div>
    </div>
  );
}
