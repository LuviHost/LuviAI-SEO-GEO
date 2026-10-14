'use client';

import { useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { trackCta } from '@/lib/landing-track';
import { useT, type Key } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * "Nasil calisir" aciklama videosu (apps/video → Explainer, 70 sn, Turkce altyazili,
 * sessiz). Sayfada TEK diyalog bulunur; hero, "Nasil calisir" bolumu, son CTA ve test
 * sonucu ekrani openExplainer() ile acar. Video preload="none": diyalog acilmadan tek
 * bayt inmez.
 */

const OPEN_EVENT = 'ranksup:open-explainer';

export function openExplainer(source: string) {
  trackCta('explainer_open', { source });
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function ExplainerDialog() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="xl" className="max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('land.how.video_title')}</DialogTitle>
          <DialogDescription>{t('land.how.video_desc')}</DialogDescription>
        </DialogHeader>
        <div className="bg-background">
          {open && (
            <video
              className="block aspect-video w-full"
              controls
              autoPlay
              muted
              playsInline
              preload="none"
              poster="/videos/explainer.jpg"
            >
              <source src="/videos/explainer.mp4" type="video/mp4" />
              <source src="/videos/explainer.webm" type="video/webm" />
              {t('land.how.video_fallback')}
            </video>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Diyalogu acan dugme — server bilesenlerden de kullanilir (yalniz serilestirilebilir prop) */
export function WatchVideoButton({
  label,
  source,
  variant = 'outline',
  size = 'lg',
  className,
}: {
  label: Key;
  source: string;
  variant?: 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const { t } = useT();
  return (
    <Button type="button" variant={variant} size={size} className={cn('gap-2', className)} onClick={() => openExplainer(source)}>
      <PlayCircle className="h-5 w-5" aria-hidden /> {t(label)}
    </Button>
  );
}
