'use client';

import { KeyRound } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { AscTab } from '@/components/asc-tab';
import { StatusBanner } from '@/components/ui/status-banner';
import { UpgradeButton } from '@/components/upgrade-gate';
import { useEntitlements } from '@/lib/entitlements';
import { requirementOffer } from '@/lib/plan-limit';
import { useSiteContext } from '../../site-context';
import { AsoSectionNav } from '../_components/section-nav';

/** App Store Connect — site düzeyi hesap bağlantısı (eskiden bir uygulamanın modal sekmesi) */
export default function AsoConnectPage() {
  const { site } = useSiteContext();
  // Plan kapisi (api @RequiresPlan('ascEnabled')) — ads/page.tsx ile ayni kural: serit
  // yolu soyler, sekme gizlenmez (bagli hesap gorulebilmeli ve baglantisi kesilebilmeli)
  const { can, requirementFor } = useEntitlements();
  const planLocked = can('ascEnabled') === false;
  const requirement = requirementFor('ascEnabled');
  const lockReason = requirement?.planName
    ? `${requirement.label}, ${requirement.planName} planına dahildir.`
    : 'App Store Connect mevcut planında bulunmuyor.';
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={KeyRound}
        title="App Store Connect"
        description="Apple geliştirici hesabın: metadata ve ekran görüntüsü uygulama, yorum yanıtlama, sürüm uyarıları. Uygulamaların App Store kimliğiyle otomatik eşleşir."
      />
      <AsoSectionNav siteId={site.id} />
      {planLocked && (
        <StatusBanner tone="info" title={lockReason} action={<UpgradeButton offer={requirementOffer(requirement)} reason={lockReason} />}>
          Yeni hesap bağlama, metadata ve ekran görüntüsü uygulama, yorum yanıtlama bu planla açılır. Bağlı bir hesabın varsa aşağıdan görebilir ve bağlantısını kesebilirsin.
        </StatusBanner>
      )}
      <AscTab siteId={site.id} />
    </div>
  );
}
