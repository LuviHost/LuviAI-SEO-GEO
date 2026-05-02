'use client';
import { useSiteContext } from '../site-context';
import { SettingsTab } from '@/components/settings-tab';
import { TrackerInstall } from '@/components/tracker-install';
import { Plug } from 'lucide-react';

export default function ConnectionsPage() {
  const { site, refresh } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 grid place-items-center">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Bağlantılar</h2>
          <p className="text-sm text-muted-foreground">Google Search Console, Analytics, AI crawler tracker, sosyal kanallar, BYOK API anahtarları.</p>
        </div>
      </div>
      <TrackerInstall siteId={site.id} siteUrl={site.url} />
      <SettingsTab siteId={site.id} onRefresh={refresh} />
    </div>
  );
}
