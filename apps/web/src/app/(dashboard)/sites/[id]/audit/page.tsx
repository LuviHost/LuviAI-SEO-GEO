'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { AuditStepBody } from '@/components/site-flow-stepper';
import { AuditDeltaPanel } from '@/components/audit-delta-panel';
import { AuditIssueGroups } from '@/components/audit-issue-groups';
import { RelatedLinks } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import { ShieldCheck, Sparkles, FileText, Send, Award, RefreshCw } from 'lucide-react';

export default function AuditPage() {
  const { site, audit, refresh, onboardingMode } = useSiteContext();
  const [running, setRunning] = useState(false);
  // Yeni tarama bittiginde delta paneli de tazelenmeli; site context'i yalnizca
  // SON taramayi tasidigi icin panel kendi ucunu yeniden cagirmak zorunda.
  const [deltaKey, setDeltaKey] = useState(0);

  const runAudit = async () => {
    setRunning(true);
    try {
      await api.runAuditNow(site.id);
      toast.success('Yeni tarama tamamlandı');
      await refresh();
      setDeltaKey((k) => k + 1);
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={ShieldCheck}
        title="Site Skoru"
        description="14 SEO + GEO kontrol noktası. Otomatik düzeltilebilenler tek tıkla."
        actions={
          // Tek "yeniden tara" burada — AuditStepBody'nin alttaki ikinci düğmesi gizli (hideRefresh)
          <Button onClick={runAudit} disabled={running} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} aria-hidden />
            {running ? 'Taranıyor…' : 'Yeniden tara'}
          </Button>
        }
      />
      {/* Sıra: skor + "Otomatik düzelt" → şablona göre sorunlar → kontrol listesi → (katlı) değişim.
          Eskiden delta en üstteydi ve asıl skor/eylem sayfanın sonunda kalıyordu. */}
      <Card>
        <CardContent className="p-5">
          <AuditStepBody
            audit={audit}
            siteId={site.id}
            onRefresh={refresh}
            onboardingMode={onboardingMode}
            hideRefresh
            afterSummary={
              // Sablona gore sorunlar — yuzlerce sayfa hatasi cogu zaman tek bilesen duzeltmesi
              <AuditIssueGroups siteId={site.id} groups={audit?.issueGroups} onRefresh={refresh} />
            }
          />
        </CardContent>
      </Card>
      {/* Onceki taramaya gore ne degisti — varsayilan katli */}
      <AuditDeltaPanel key={deltaKey} siteId={site.id} collapsible />
      <RelatedLinks
        links={[
          { href: siteHref(site.id, 'snippet'), label: 'Sayfa SEO İyileştir', description: 'Meta + SSS otomatik düzeltme', icon: FileText },
          { href: siteHref(site.id, 'geoLab'), label: 'GEO Lab', description: 'AI arama optimizasyonu (6 sütun)', icon: Award },
          { href: siteHref(site.id, 'visibility'), label: 'AI Görünürlük', description: '7 AI asistanında marka ve atıf takibi', icon: Sparkles },
          { href: siteHref(site.id, 'publishTargets'), label: 'Yayın Hedefleri', description: 'Otomatik düzeltme dosyaları buraya yüklenir', icon: Send },
        ]}
      />
    </div>
  );
}
