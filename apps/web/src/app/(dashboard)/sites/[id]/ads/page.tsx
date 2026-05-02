'use client';
import { useSiteContext } from '../site-context';
import { AdsLabPanel } from '@/components/ads-lab-panel';
import { TrendingUp } from 'lucide-react';

export default function AdsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-500 grid place-items-center">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Reklam</h2>
          <p className="text-sm text-muted-foreground">Google Ads + Meta Ads autopilot. ROAS'a göre 6 saatte bir otomatik optimize.</p>
        </div>
      </div>
      <AdsLabPanel site={site} />
    </div>
  );
}
