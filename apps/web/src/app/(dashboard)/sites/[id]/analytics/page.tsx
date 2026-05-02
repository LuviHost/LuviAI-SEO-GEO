'use client';
import { useSiteContext } from '../site-context';
import { AnalyticsTab } from '@/components/analytics-tab';
import { BarChart3 } from 'lucide-react';

export default function AnalyticsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Analytics</h2>
          <p className="text-sm text-muted-foreground">GSC + GA4 + AI Citation entegre dashboard.</p>
        </div>
      </div>
      <AnalyticsTab siteId={site.id} site={site} />
    </div>
  );
}
