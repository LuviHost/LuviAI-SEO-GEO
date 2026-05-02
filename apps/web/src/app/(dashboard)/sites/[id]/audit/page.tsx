'use client';
import { useSiteContext } from '../site-context';
import { AuditStepBody } from '@/components/site-flow-stepper';
import { RelatedLinks } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, Sparkles, FileText, Send, Award } from 'lucide-react';

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
      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/snippet`, label: 'Snippet Üretici', description: 'On-page meta + FAQ otomatik düzeltme', icon: FileText },
          { href: `/sites/${site.id}/geo-lab`, label: 'GEO Lab', description: 'AI search optimization (6 pillar)', icon: Award },
          { href: `/sites/${site.id}/visibility`, label: 'AI Görünürlük', description: 'ChatGPT/Claude/Gemini citation tracking', icon: Sparkles },
          { href: `/sites/${site.id}/publish-targets`, label: 'Yayın Hedefleri', description: 'Auto-fix dosyaları buraya yüklenir', icon: Send },
        ]}
      />
    </div>
  );
}
