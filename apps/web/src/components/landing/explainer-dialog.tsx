'use client';

import { useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { trackCta } from '@/lib/landing-track';
import { useT, type Key } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const ExplainerDialogContent = dynamic(() => import('./explainer-dialog-content'), { ssr: false });

/**
 * "Nasil calisir" aciklama videosu (apps/video → Explainer, 70 sn, Turkce altyazili,
 * sessiz). Sayfada TEK diyalog bulunur; hero, "Nasil calisir" bolumu, son CTA ve test
 * sonucu ekrani openExplainer() ile acar. Diyalog (Radix) ve video ilk acilista yuklenir;
 * oncesinde tek bayt inmez.
 */

const OPEN_EVENT = 'ranksup:open-explainer';

export function openExplainer(source: string) {
  trackCta('explainer_open', { source });
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function ExplainerDialog() {
  const [open, setOpen] = useState(false);
  // Bir kez acildiktan sonra icerik bagli kalir ki kapanis animasyonu calissin
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onOpen = () => { setLoaded(true); setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return loaded ? <ExplainerDialogContent open={open} onOpenChange={setOpen} /> : null;
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
