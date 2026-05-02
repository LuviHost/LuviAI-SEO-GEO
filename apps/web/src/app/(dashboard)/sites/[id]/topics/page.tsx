'use client';
import { useSiteContext } from '../site-context';
import { ContentFlowTable } from '@/components/content-flow-table';
import { Sparkles } from 'lucide-react';

export default function TopicsPage() {
  const { site, queue, articles, refresh, onboardingMode } = useSiteContext();
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
      <ContentFlowTable
        queue={queue}
        articles={articles}
        siteId={site.id}
        onRefresh={refresh}
        onboardingMode={onboardingMode}
      />
    </div>
  );
}
