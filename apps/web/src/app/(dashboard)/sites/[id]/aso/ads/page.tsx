'use client';

import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { AsaTab } from '@/components/asa-tab';
import { useSiteContext } from '../../site-context';
import { AsoSectionNav } from '../_components/section-nav';

/**
 * Apple Search Ads — site düzeyi (eskiden bir uygulamanın modal sekmesi).
 * Anahtar kelime tablosundaki "Apple Search Ads kampanyasına ekle"
 * ?keyword= ile gelir; kampanya formu o kelimeyle açılır.
 */
export default function AsoAdsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Megaphone}
        title="Apple Search Ads"
        description="App Store arama reklamları: kampanya, anahtar kelime teklifleri ve 30 günlük performans."
      />
      <AsoSectionNav siteId={site.id} />
      <Suspense fallback={<Skeleton className="h-48" />}>
        <AdsBody siteId={site.id} />
      </Suspense>
    </div>
  );
}

function AdsBody({ siteId }: { siteId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const keyword = params?.get('keyword') ?? null;
  // Ön doldurma bir kez kullanılır; URL'den düşür ki yenileme formu tekrar açmasın
  const consumed = useCallback(() => router.replace(pathname ?? ''), [router, pathname]);
  return <AsaTab siteId={siteId} prefillKeyword={keyword} onPrefillConsumed={consumed} />;
}
