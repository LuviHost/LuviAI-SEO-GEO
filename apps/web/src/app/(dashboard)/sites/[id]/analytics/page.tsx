'use client';
import { useSiteContext } from '../site-context';
import { AnalyticsTab } from '@/components/analytics-tab';
import { SectionHeader } from '@/components/ui/section-header';
import { BarChart3 } from 'lucide-react';

export default function AnalyticsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={BarChart3}
        title="Analitik"
        description="Search Console, GA4 ve Google AI görünümleri tek yerde."
      />
      <AnalyticsTab siteId={site.id} site={site} />
    </div>
  );
}
