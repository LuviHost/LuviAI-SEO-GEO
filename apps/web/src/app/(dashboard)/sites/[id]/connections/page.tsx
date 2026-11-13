'use client';
import { useSiteContext } from '../site-context';
import { SettingsTab } from '@/components/settings-tab';
import { McpSetupCard } from '@/components/mcp-setup-card';
import { Plug } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

export default function ConnectionsPage() {
  const { site, refresh } = useSiteContext();
  return (
    <div className="space-y-5">
      {/* AI bot takibi kodu 13.11.2026'da Bot Takibi sayfasina tasindi (tek yerde dursun) */}
      <SectionHeader titleInTab icon={Plug} title="Bağlantılar" description="Search Console, Analytics, reklam hesapları ve kendi AI anahtarların." />
      <McpSetupCard />
      <SettingsTab siteId={site.id} onRefresh={refresh} />
    </div>
  );
}
