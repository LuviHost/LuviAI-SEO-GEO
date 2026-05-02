'use client';
import { useSiteContext } from '../site-context';
import { ContentFlowTable } from '@/components/content-flow-table';
import { FileText } from 'lucide-react';

export default function ArticlesPage() {
  const { site, queue, articles, refresh, onboardingMode } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Makaleler</h2>
          <p className="text-sm text-muted-foreground">Üretilen, takvimde, hazır ve yayında olan tüm içerikler.</p>
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
