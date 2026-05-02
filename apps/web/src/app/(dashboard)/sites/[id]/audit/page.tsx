'use client';
import { useSiteContext } from '../site-context';
import { AuditStepBody } from '@/components/site-flow-stepper';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, Sparkles } from 'lucide-react';

export default function AuditPage() {
  const { site, audit, refresh, onboardingMode } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Site Skoru</h2>
          <p className="text-sm text-muted-foreground">14 SEO + GEO kontrol noktası. Otomatik düzeltilebilenler tek tıkla.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-5">
          <AuditStepBody audit={audit} siteId={site.id} onRefresh={refresh} onboardingMode={onboardingMode} />
        </CardContent>
      </Card>
    </div>
  );
}
