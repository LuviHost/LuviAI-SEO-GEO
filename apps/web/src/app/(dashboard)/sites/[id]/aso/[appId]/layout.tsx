'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, Image as ImageIcon, KeyRound, LayoutDashboard, MessageSquare, MoreHorizontal, Plus, FileText,
  Sparkles, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AsoAppProvider } from '../_components/app-context';
import { AppIcon, LinkTabs, Rating, StoreBadges } from '../_components/app-bits';
import { LinkStoreDialog } from '../_components/link-store-dialog';
import type { AppDetail } from '../_components/types';

/**
 * Uygulama çalışma alanı — eskiden /aso üzerindeki modal (max-w-4xl, 6 sekme,
 * `useState` ile sekme). Artık her sekme bir rota; başlık + sekme çubuğu
 * burada, veri AsoAppProvider ile tüm alt rotalara paylaşılır.
 *
 * Screenshot Studio tam ekran düzenleyici — kendi üst çubuğu var, başlık
 * burada çizilmez.
 */
export default function AsoAppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const siteId = params?.id as string;
  const appId = params?.appId as string;
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const confirm = useConfirm();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const asoBase = siteHref(siteId, 'aso');
  const base = `${asoBase}/${appId}`;

  const hasApp = useRef(false);
  const loadApp = useCallback(async () => {
    try {
      setError(null);
      setApp(await api.request<AppDetail>(`/sites/${siteId}/aso/apps/${appId}`));
      hasApp.current = true;
    } catch (err: any) {
      setError(err);
      // İlk yüklemede hata ekranı çıkar; sonraki yenilemelerde veri ekranda kalır, sessizce yutulmaz
      if (hasApp.current) toast.error(`Uygulama yenilenemedi: ${err?.message ?? 'bilinmeyen hata'}`);
    }
  }, [siteId, appId]);

  useEffect(() => { loadApp(); }, [loadApp]);

  const isStudio = pathname.startsWith(`${base}/screenshots`);

  if (error && !app) {
    return (
      <div className="space-y-4">
        <Link href={asoBase} className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-brand">
          <ArrowLeft className="h-3 w-3" aria-hidden /> Tüm uygulamalar
        </Link>
        <ErrorState error={error} onRetry={loadApp} />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Yükleniyor">
        <div className="flex items-center gap-3">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const removeApp = async () => {
    const ok = await confirm({
      title: `"${app.name}" takipten çıkarılsın mı?`,
      description: 'Tüm anahtar kelime ve yorum verileri silinir. Geri alınamaz.',
      confirmLabel: 'Takipten çıkar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}`, { method: 'DELETE' });
      toast.success('Uygulama takipten çıkarıldı');
      router.push(asoBase);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const missing = !app.appStoreId ? 'iOS' : !app.playStoreId ? 'Android' : null;

  return (
    <AsoAppProvider siteId={siteId} app={app} reloadApp={loadApp}>
      {isStudio ? (
        children
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <Link href={asoBase} className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-brand">
              <ArrowLeft className="h-3 w-3" aria-hidden /> Tüm uygulamalar
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <AppIcon src={app.iconUrl} size="lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-h6 font-semibold tracking-tight">{app.name}</h2>
                  <p className="truncate text-label text-muted-foreground">
                    {[app.developer, app.category].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StoreBadges app={app} />
                    {app.iosRating != null && (
                      <span className="text-label text-muted-foreground">iOS <Rating value={app.iosRating} className="text-foreground" /></span>
                    )}
                    {app.androidRating != null && (
                      <span className="text-label text-muted-foreground">Android <Rating value={app.androidRating} className="text-foreground" /></span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {missing && (
                  <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> {missing} sürümünü bağla
                  </Button>
                )}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="w-9 px-0" aria-label="Uygulama işlemleri">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => router.push(`${base}/screenshots`)}>
                      <ImageIcon aria-hidden /> Screenshot Studio
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={removeApp}>
                      <Trash2 aria-hidden /> Takipten çıkar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <LinkTabs
            label="Uygulama sekmeleri"
            items={[
              { href: base, label: 'Genel bakış', icon: LayoutDashboard, exact: true },
              { href: `${base}/keywords`, label: 'Anahtar kelimeler', icon: KeyRound, count: app.keywords?.length ?? 0 },
              { href: `${base}/metadata`, label: 'Metadata', icon: FileText },
              { href: `${base}/reviews`, label: 'Yorumlar', icon: MessageSquare },
              { href: `${base}/creatives`, label: 'Görseller', icon: ImageIcon },
              { href: `${base}/ai-visibility`, label: 'AI görünürlük', icon: Sparkles },
            ]}
          />

          {children}

          <LinkStoreDialog
            siteId={siteId}
            app={app}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            onLinked={() => { setLinkOpen(false); loadApp(); }}
          />
        </div>
      )}
    </AsoAppProvider>
  );
}
