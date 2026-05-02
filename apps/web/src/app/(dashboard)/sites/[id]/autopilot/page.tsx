'use client';
import { useSiteContext } from '../site-context';
import { AutopilotControl } from '@/components/site-overview-dashboard';
import { Zap } from 'lucide-react';

export default function AutopilotPage() {
  const { site, refresh } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Otomatik Akış</h2>
          <p className="text-sm text-muted-foreground">Yarı otomatik (manuel onay) veya tam otomatik (otopilot) modunu seç. Akışı durdur/aç.</p>
        </div>
      </div>
      <AutopilotControl site={site} onRefresh={refresh} />
    </div>
  );
}
