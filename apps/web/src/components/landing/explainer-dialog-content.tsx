'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

/**
 * Aciklama videosu diyalogu — Radix Dialog ilk yuklemede olmasin diye ayri parca;
 * explainer-dialog.tsx ilk "videoyu izle" tiklamasinda next/dynamic ile yukler.
 */
export default function ExplainerDialogContent({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              poster="/landing-media/explainer.jpg"
            >
              <source src="/landing-media/explainer.mp4" type="video/mp4" />
              <source src="/landing-media/explainer.webm" type="video/webm" />
              {t('land.how.video_fallback')}
            </video>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
