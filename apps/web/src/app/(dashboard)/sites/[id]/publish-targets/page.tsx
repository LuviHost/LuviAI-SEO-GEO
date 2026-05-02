'use client';
import { useSiteContext } from '../site-context';
import { PublishTargetsManager } from '@/components/settings-tab';
import { Send } from 'lucide-react';

export default function PublishTargetsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Yayın Hedefleri</h2>
          <p className="text-sm text-muted-foreground">WordPress, FTP, SFTP, GitHub Pages... 14 farklı hedef. Üretilen makaleler buraya yayınlanır.</p>
        </div>
      </div>
      <PublishTargetsManager siteId={site.id} defaultSiteUrl={site?.url} />
    </div>
  );
}
