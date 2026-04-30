'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsTab } from '@/components/analytics-tab';
import { SettingsTab } from '@/components/settings-tab';
import { SiteFlowStepper } from '@/components/site-flow-stepper';
import { SiteOverviewDashboard } from '@/components/site-overview-dashboard';
import { SiteReportPanel } from '@/components/site-report-panel';

export default function SitePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const onboardingMode = searchParams.get('onboarding') === 'running';
  const tabParam = searchParams.get('tab'); // 'analytics' | 'settings' | null
  // Onboarding sirasinda varsayilan = flow (tarama akisini gorebilsin)
  const onboardingFlowDefault = !tabParam && searchParams.get('onboarding') === 'running';
  const tab = tabParam ?? (onboardingFlowDefault ? 'flow' : null);

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [publishTargets, setPublishTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const id = params.id as string;

  // Tab degistiginde data'yi tazele (ozellikle settings -> ozet gecişinde site state guncellensin)

  // tab degistiginde data refresh (settings'ten ozet'e donunce site state guncel olsun)
  useEffect(() => {
    if (tab === null || tab === '' || tab === undefined) {
      // Sadece ozet'e donerken refresh — settings'te zaten kullanici degistirir, ana sayfaya gelince guncellesin
      // refresh declaration'i asagida; burada sadece flag set edebiliriz, ama refresh closure
      // uzerine bagimli oldugu icin tab change'de refresh cagrılması icin asagidaki useEffect dogru sirayla calismaz.
      // Cozum: refresh'i yukari tasiyamayacagimiz icin, alttaki useEffect'i [tab] dependency ile yapacagiz.
    }
  }, [tab]);

  const refresh = async () => {
    try {
      const [s, a, q, ar, pt] = await Promise.all([
        api.getSite(id),
        api.getLatestAudit(id).catch(() => null),
        api.getTopicQueue(id).catch(() => null),
        api.listArticles(id).catch(() => []),
        api.listPublishTargets(id).catch(() => []),
      ]);
      setSite(s);
      setAudit(a);
      setQueue(q);
      setArticles(ar);
      setPublishTargets(pt ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [id]);

  // Tab degistiginde de refresh — settings'ten Ozet'e donunce site state guncel olsun
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Onboarding chain calisirken (status: ONBOARDING -> AUDIT_PENDING -> AUDIT_COMPLETE -> ACTIVE)
  // veya URL flag varken ya da bir makale GENERATING/EDITING durumundayken arka planda 5sn'de bir refresh.
  // Boylece X OAuth callback'inden donulduginde ve wizard'dan atla denildiginde de gercek durum gorulur.
  const isOnboardingActive = site
    ? !['ACTIVE', 'PAUSED', 'ERROR'].includes(site.status)
    : false;
  const hasInflightArticle = articles.some(
    (a) => a?.status === 'GENERATING' || a?.status === 'EDITING',
  );
  const needsPolling = onboardingMode || isOnboardingActive || hasInflightArticle;

  useEffect(() => {
    if (!needsPolling) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [needsPolling, id]);

  if (loading || !site) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Dashboard
        </Link>
        <h1 className="text-3xl font-bold mt-2">{site.name}</h1>
        <a
          href={site.url}
          target="_blank"
          rel="noopener"
          className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1 mt-1"
        >
          {site.url} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Sekme cubugu */}
      <div className="flex items-center gap-1 border-b">
        {[
          { id: '', label: 'Özet' },
          { id: 'flow', label: 'Detaylı Akış' },
          { id: 'report', label: 'Rapor' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'settings', label: 'Ayarlar' },
        ].map((t) => {
          const active = (t.id === '' && !tab) || tab === t.id;
          return (
            <button
              key={t.id || 'overview'}
              onClick={() => router.push(`/sites/${id}${t.id ? `?tab=${t.id}` : ''}` as any)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                active ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!tab && (
        <SiteOverviewDashboard
          site={site}
          audit={audit}
          articles={articles}
          publishTargets={publishTargets}
          onRefresh={refresh}
        />
      )}
      {tab === 'flow' && (
        <SiteFlowStepper
          site={site}
          audit={audit}
          queue={queue}
          articles={articles}
          onRefresh={refresh}
          onboardingMode={onboardingMode || isOnboardingActive}
        />
      )}
      {tab === 'report' && <SiteReportPanel siteId={id} site={site} />}
      {tab === 'analytics' && <AnalyticsTab siteId={id} />}
      {tab === 'settings' && <SettingsTab siteId={id} onRefresh={refresh} />}
    </div>
  );
}
