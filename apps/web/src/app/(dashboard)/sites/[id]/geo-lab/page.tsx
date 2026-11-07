'use client';
import { useSiteContext } from '../site-context';
import { GeoLabPanel } from '@/components/geo-lab-panel';
import { PromptLabPanel } from '@/components/prompt-lab-panel';
import { GeoScoreCard } from '@/components/geo-score-card';
import { SectionHeader } from '@/components/ui/section-header';
import { Award } from 'lucide-react';

export default function GeoLabPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Award}
        title="GEO Lab"
        description="AI aramada görünürlük: tarayıcı, şema, alıntı, otorite, tazelik ve çoklu ortam."
      />
      {/* Ozet ustte: GEO skoru → takip edilen sorular → arac kutusu */}
      <GeoScoreCard siteId={site.id} />
      <PromptLabPanel siteId={site.id} />
      <GeoLabPanel siteId={site.id} />
    </div>
  );
}
