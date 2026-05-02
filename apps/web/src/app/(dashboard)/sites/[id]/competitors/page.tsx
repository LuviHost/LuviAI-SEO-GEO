'use client';
import { useSiteContext } from '../site-context';
import { CompetitorsStepBody } from '@/components/site-flow-stepper';
import { Network } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function CompetitorsPage() {
  const { site, refresh, onboardingMode } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 grid place-items-center">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Rakipler</h2>
          <p className="text-sm text-muted-foreground">AI ile tespit edilen rakipler. SERP + içerik analizi.</p>
        </div>
      </div>
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
