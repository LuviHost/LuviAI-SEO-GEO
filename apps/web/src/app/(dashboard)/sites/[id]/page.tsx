'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter, useParams } from 'next/navigation';
import { useSiteContext } from './site-context';
import { SiteOverviewDashboard } from '@/components/site-overview-dashboard';

/**
 * Site Overview — Genel Bakış (yeni IA root sayfası).
 *
 * Eski URL formatı: /sites/[id]?tab=X
 *   - tab=content   → /sites/[id]/articles (varsayılan)
 *   - tab=data      → /sites/[id]/audit
 *   - tab=videos    → /sites/[id]/videos
 *   - tab=report    → /sites/[id]/report
 *   - tab=analytics → /sites/[id]/analytics
 *   - tab=settings  → /sites/[id]/settings
 *   - tab=flow      → /sites/[id] (overview)
 *   - (none)        → kal (overview göster)
 */

const TAB_REDIRECT_MAP: Record<string, string> = {
  content: '/articles',
  data: '/audit',
  videos: '/videos',
  report: '/report',
  analytics: '/analytics',
  settings: '/connections',
  flow: '',
};

export default function SiteOverviewPage() {
  const params = useParams();
  const id = params?.id as string;
  const search = useSearchParams();
  const router = useRouter();

  // Eski tab=X URL'lerini yeni route'lara redirect
  useEffect(() => {
    const tab = search.get('tab');
    if (tab && tab in TAB_REDIRECT_MAP) {
      const subpath = TAB_REDIRECT_MAP[tab];
      const onboarding = search.get('onboarding');
      const qs = onboarding ? `?onboarding=${onboarding}` : '';
      router.replace(`/sites/${id}${subpath}${qs}` as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { site, audit, articles, publishTargets, refresh } = useSiteContext();

  return (
    <SiteOverviewDashboard
      site={site}
      audit={audit}
      articles={articles}
      publishTargets={publishTargets}
      onRefresh={refresh}
    />
  );
}
