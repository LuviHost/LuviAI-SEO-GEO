'use client';
import { useSiteContext } from '../site-context';
import { AutopilotControl } from '@/components/site-overview-dashboard';
import { Zap } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

export default function AutopilotPage() {
  const { site, refresh } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader icon={Zap} title="Otomatik Akış" description="Yarı otomatik (manuel onay) veya tam otomatik (otopilot) modunu seç. Akışı durdur/aç." />
      <AutopilotControl site={site} onRefresh={refresh} />
    </div>
  );
}
