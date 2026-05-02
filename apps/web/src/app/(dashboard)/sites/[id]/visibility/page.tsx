'use client';
import { useSiteContext } from '../site-context';
import { CitationPanel } from '@/components/site-flow-stepper';
import { CitationHistoryChart } from '@/components/citation-history-chart';
import { CrawlerHitsPanel } from '@/components/crawler-hits-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

export default function VisibilityPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">AI Görünürlük</h2>
          <p className="text-sm text-muted-foreground">Claude · Gemini · ChatGPT · Perplexity'de site URL alıntılanma takibi.</p>
        </div>
      </div>
      <CitationHistoryChart siteId={site.id} />
      <Card>
        <CardContent className="p-5">
          <CitationPanel siteId={site.id} />
        </CardContent>
      </Card>
      <CrawlerHitsPanel siteId={site.id} />
    </div>
  );
}
