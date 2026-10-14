'use client';

import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { siteHref } from '@/lib/site-routes';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { useAsoApp } from './app-context';
import type { AscApp } from './types';

/**
 * Uygulama görünümünde YALNIZ bu uygulamaya eşleşen App Store Connect
 * kaydını gösterir (TrackedApp.appStoreId == AscApp.appleAppId). Eşleşme
 * yoksa ne yapılacağını söyleyen bir "bağla" çağrısı çıkar.
 */
export function AscGate({ purpose, children }: { purpose: string; children: (ascApp: AscApp) => React.ReactNode }) {
  const { siteId, app, asc } = useAsoApp();
  const connectHref = `${siteHref(siteId, 'aso')}/connect`;

  if (!app.appStoreId) {
    return (
      <StatusBanner tone="info" title="App Store sürümü bağlı değil">
        {purpose} için uygulamanın iOS sürümünü bu takibe bağla (sayfa başındaki "iOS sürümünü bağla").
      </StatusBanner>
    );
  }
  if (asc.loading) return <Skeleton className="h-20" />;
  if (asc.match) return <>{children(asc.match)}</>;

  return (
    <StatusBanner
      tone="info"
      title={asc.connected ? 'Bu uygulama bağlı App Store Connect hesabında bulunamadı' : 'App Store Connect bağlı değil'}
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={connectHref}><KeyRound className="h-4 w-4" aria-hidden /> {asc.connected ? 'Hesabı eşitle' : 'Bağla'}</Link>
        </Button>
      }
    >
      {asc.connected
        ? `Apple kimliği ${app.appStoreId} olan uygulama hesapta yok. Uygulama başka bir geliştirici hesabındaysa o hesabı bağla ya da "Eşitle" ile listeyi yenile.`
        : `${purpose} için Apple geliştirici hesabını bir kez bağla; bu uygulama otomatik eşleşir.`}
    </StatusBanner>
  );
}
