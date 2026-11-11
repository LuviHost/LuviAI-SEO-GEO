import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MarketingShell } from '@/components/vitrin/marketing-shell';

/**
 * Kabuk yola gore secilir (MarketingShell): koyu vitrin sayfalari (lib/vitrin.ts)
 * kendi ust menusu ve alt bilgisiyle, digerleri burada verilen baslik ve alt
 * bilgiyle cizilir.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingShell header={<SiteHeader />} footer={<SiteFooter />}>
      {children}
    </MarketingShell>
  );
}
