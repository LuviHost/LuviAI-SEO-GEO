'use client';
import { useSiteContext } from '../site-context';
import { VideoLab } from '@/components/video-lab';
import { Film } from 'lucide-react';

export default function VideosPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 grid place-items-center">
          <Film className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Video Factory</h2>
          <p className="text-sm text-muted-foreground">TikTok / YouTube / Reels için kısa video üretimi.</p>
        </div>
      </div>
      <VideoLab siteId={site.id} />
    </div>
  );
}
