'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { AuditStepBody } from '@/components/site-flow-stepper';
import { RelatedLinks } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { ShieldCheck, Sparkles, FileText, Send, Award, RefreshCw } from 'lucide-react';

export default function AuditPage() {
  const { site, audit, refresh, onboardingMode } = useSiteContext();
  const [running, setRunning] = useState(false);

  const runAudit = async () => {
    setRunning(true);
    try {
      await api.runAuditNow(site.id);
      toast.success('Yeni tarama tamamlandı');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Site Skoru</h2>
          <p className="text-sm text-muted-foreground">14 SEO + GEO kontrol noktası. Otomatik düzeltilebilenler tek tıkla.</p>
        </div>
        <Button onClick={runAudit} disabled={running} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Taranıyor…' : 'Yeniden Tara'}
        </Button>
      </div>
      <Card>
        <CardContent className="p-5">
          <AuditStepBody audit={audit} siteId={site.id} onRefresh={refresh} onboardingMode={onboardingMode} />
        </CardContent>
      </Card>
      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/snippet`, label: 'Sayfa SEO İyileştir', description: 'On-page meta + FAQ otomatik düzeltme', icon: FileText },
          { href: `/sites/${site.id}/geo-lab`, label: 'GEO Lab', description: 'AI search optimization (6 pillar)', icon: Award },
          { href: `/sites/${site.id}/visibility`, label: 'AI Görünürlük', description: 'ChatGPT/Claude/Gemini citation tracking', icon: Sparkles },
          { href: `/sites/${site.id}/publish-targets`, label: 'Yayın Hedefleri', description: 'Auto-fix dosyaları buraya yüklenir', icon: Send },
        ]}
      />
    </div>
  );
}
