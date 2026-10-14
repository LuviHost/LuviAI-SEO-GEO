'use client';
import { useSiteContext } from '../site-context';
import { CompetitorsStepBody } from '@/components/site-flow-stepper';
import { Network } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

export default function CompetitorsPage() {
  const { site, refresh, onboardingMode } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader icon={Network} title="Rakipler" description="AI ile tespit edilen rakipler. SERP + içerik analizi." />
      <Card>
        <CardContent className="p-5">
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
