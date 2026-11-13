'use client';
import { useSiteContext } from '../site-context';
import { CompetitorsStepBody } from '@/components/site-flow-stepper';
import { RakipGorunurluguCard } from '@/components/rakip-gorunurlugu-card';
import { Network } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * Rakipler — (1) AI cevaplarinda marka ve rakiplerin gorunurlugu (Prompt Lab'in kayitli
 * cevaplarindan), (2) rakip listesi. Eski aciklama "SERP + içerik analizi" diyordu; kodda
 * boyle bir analiz yok (panel rehberi denetimi, 07.11.2026).
 */
export default function CompetitorsPage() {
  const { site, refresh, onboardingMode } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Network}
        title="Rakipler"
        description="Rakiplerin AI cevaplarında ne kadar görünüyor ve rakip listen. Liste kurulumda otomatik önerilir; buradan düzenleyebilirsin."
      />
      {!onboardingMode && <RakipGorunurluguCard siteId={site.id} onListChanged={refresh} />}
      <Card>
        <CardContent className="space-y-3 p-5">
          <SectionHeader as="h3" title="Rakip listesi" description="AI ölçümünde adı aranan rakipler. Adresini de yazarsan sitesinin kaynak gösterildiği cevaplar sayılır." />
          <CompetitorsStepBody
            siteId={site.id}
            initial={(site?.brain?.competitors ?? []) as any}
            onChanged={refresh}
            onboardingMode={onboardingMode}
          />
        </CardContent>
      </Card>
    </div>
  );
}
