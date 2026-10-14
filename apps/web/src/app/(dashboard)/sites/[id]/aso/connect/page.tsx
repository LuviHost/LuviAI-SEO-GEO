'use client';

import { KeyRound } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { AscTab } from '@/components/asc-tab';
import { useSiteContext } from '../../site-context';
import { AsoSectionNav } from '../_components/section-nav';

/** App Store Connect — site düzeyi hesap bağlantısı (eskiden bir uygulamanın modal sekmesi) */
export default function AsoConnectPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={KeyRound}
        title="App Store Connect"
        description="Apple geliştirici hesabın: metadata ve ekran görüntüsü uygulama, yorum yanıtlama, sürüm uyarıları. Uygulamaların App Store kimliğiyle otomatik eşleşir."
      />
      <AsoSectionNav siteId={site.id} />
      <AscTab siteId={site.id} />
    </div>
  );
}
