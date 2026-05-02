'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { SiteContext } from './site-context';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const id = params?.id as string;

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [publishTargets, setPublishTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ?onboarding=running flag'i URL'de ise onboarding mode aktif
  const onboardingMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('onboarding') === 'running';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Polling: site onboarding'de veya inflight article varsa
  const statusOnboarding = site
    ? !['ACTIVE', 'PAUSED', 'ERROR'].includes(site.status)
    : false;
  const recentlyCreated = site?.createdAt
    ? Date.now() - new Date(site.createdAt).getTime() < 10 * 60_000
    : false;
  const auditMissing = !audit;
  const brainCompetitorsMissing = !site?.brain || !(site.brain?.competitors?.length);
  const chainStillRunning = recentlyCreated && (auditMissing || brainCompetitorsMissing);
  const isOnboardingActive = statusOnboarding || chainStillRunning;
  const hasInflightArticle = articles.some(
    (a) => a?.status === 'GENERATING' || a?.status === 'EDITING',
  );
  const needsPolling = onboardingMode || isOnboardingActive || hasInflightArticle;

  useEffect(() => {
    if (!needsPolling) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <SiteContext.Provider
      value={{
        site,
        audit,
        queue,
        articles,
        publishTargets,
        loading,
        refresh,
        onboardingMode: onboardingMode || isOnboardingActive,
      }}
    >
      <div className="space-y-6">
        {/* Top bar — site title + URL (tab nav kaldırıldı, sidebar yönetiyor) */}
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1"
          >
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

        {children}
      </div>
    </SiteContext.Provider>
  );
}
