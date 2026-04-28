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

export default function SitePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const onboardingMode = searchParams.get('onboarding') === 'running';
  const tab = searchParams.get('tab'); // 'analytics' | 'settings' | null (null = stepper)

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const id = params.id as string;

  const refresh = async () => {
    try {
      const [s, a, q, ar] = await Promise.all([
        api.getSite(id),
        api.getLatestAudit(id).catch(() => null),
        api.getTopicQueue(id).catch(() => null),
        api.listArticles(id).catch(() => []),
      ]);
      setSite(s);
      setAudit(a);
      setQueue(q);
      setArticles(ar);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    if (onboardingMode) {
      const interval = setInterval(refresh, 5000);
      return () => clearInterval(interval);
    }
  }, [id, onboardingMode]);

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

      {tab === 'analytics' || tab === 'settings' ? (
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/sites/${id}` as any)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Akışa dön
          </Button>
          {tab === 'analytics' ? <AnalyticsTab siteId={id} /> : <SettingsTab siteId={id} />}
        </div>
      ) : (
        <SiteFlowStepper
          site={site}
          audit={audit}
          queue={queue}
          articles={articles}
          onRefresh={refresh}
          onboardingMode={onboardingMode}
        />
      )}
    </div>
  );
}
