'use client';

import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { AsaTab } from '@/components/asa-tab';
import { StatusBanner } from '@/components/ui/status-banner';
import { UpgradeButton } from '@/components/upgrade-gate';
import { useEntitlements } from '@/lib/entitlements';
import { requirementOffer } from '@/lib/plan-limit';
import { useSiteContext } from '../../site-context';
import { AsoSectionNav } from '../_components/section-nav';

/**
 * Apple Search Ads — site düzeyi (eskiden bir uygulamanın modal sekmesi).
 * Anahtar kelime tablosundaki "Apple Search Ads kampanyasına ekle"
 * ?keyword= ile gelir; kampanya formu o kelimeyle açılır.
 */
export default function AsoAdsPage() {
  const { site } = useSiteContext();
  // Plan kapisi (api @RequiresPlan('asaEnabled')). Eskiden sayfa her planda sessizce
  // aciliyor, "Bağla"ya basinca sunucunun 403'u kirmizi hata olarak cikiyordu. Kesin
  // kapaliysa (false) ustte yukseltme yolunu soyleyen bir serit cikar.
  // Sekmenin KENDISI gizlenmez: plani biten eski musterinin bagli hesabi durur ve sunucu
  // hesap listesini ve baglantiyi kesmeyi bilerek acik birakir (kayitli anahtar
  // kaldirilabilmeli). Baglama denemesi 403 PLAN_LIMIT alir, plan penceresi acilir.
  const { can, requirementFor } = useEntitlements();
  const planLocked = can('asaEnabled') === false;
  const requirement = requirementFor('asaEnabled');
  const lockReason = requirement?.planName
    ? `${requirement.label}, ${requirement.planName} planına dahildir.`
    : 'Apple Search Ads mevcut planında bulunmuyor.';
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Megaphone}
        title="Apple Search Ads"
        description="App Store arama reklamları: kampanya, anahtar kelime teklifleri ve 30 günlük performans."
      />
      <AsoSectionNav siteId={site.id} />
      {planLocked && (
        <StatusBanner tone="info" title={lockReason} action={<UpgradeButton offer={requirementOffer(requirement)} reason={lockReason} />}>
          Yeni hesap bağlama, kampanya ve teklif yönetimi bu planla açılır. Bağlı bir hesabın varsa aşağıdan görebilir ve bağlantısını kesebilirsin.
        </StatusBanner>
      )}
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
