'use client';
import { useSiteContext } from '../site-context';
import { AdsLabPanel } from '@/components/ads-lab-panel';
import { TrendingUp } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

export default function AdsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader icon={TrendingUp} title="Reklam" description="Google Ads ve Meta kampanyaların. Otopilot açıksa performans 6 saatte bir kontrol edilir ve bütçe reklam getirisine (ROAS) göre ayarlanır." />
      <AdsLabPanel site={site} />
    </div>
  );
}
