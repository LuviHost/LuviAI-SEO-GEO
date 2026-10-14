'use client';
import { useSiteContext } from '../site-context';
import { SettingsTab } from '@/components/settings-tab';
import { TrackerInstall } from '@/components/tracker-install';
import { McpSetupCard } from '@/components/mcp-setup-card';
import { Plug } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

export default function ConnectionsPage() {
  const { site, refresh } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader icon={Plug} title="Bağlantılar" description="Search Console, Analytics, AI bot takibi, reklam hesapları ve kendi AI anahtarların." />
      <McpSetupCard />
      <TrackerInstall siteId={site.id} siteUrl={site.url} />
      <SettingsTab siteId={site.id} onRefresh={refresh} />
    </div>
  );
}
