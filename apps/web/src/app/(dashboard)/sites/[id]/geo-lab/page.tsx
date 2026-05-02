'use client';
import { useSiteContext } from '../site-context';
import { GeoLabPanel } from '@/components/geo-lab-panel';
import { GeoScoreCard } from '@/components/geo-score-card';
import { Award } from 'lucide-react';

export default function GeoLabPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center">
          <Award className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">GEO Lab</h2>
          <p className="text-sm text-muted-foreground">6 pillar (crawler, schema, citation, otorite, tazelik, multi-modal). AI search optimizasyonu.</p>
        </div>
      </div>
      <GeoScoreCard siteId={site.id} />
      <GeoLabPanel siteId={site.id} />
    </div>
  );
}
