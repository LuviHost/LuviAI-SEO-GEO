'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { Image as ImageIcon, MoreHorizontal, Plus, Smartphone, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import { formatNum } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion-presets';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionHeader } from '@/components/ui/section-header';
import { AsyncState } from '@/components/ui/async-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/empty-state';
import { useSiteContext } from '../site-context';
import { AppIcon, Rating, StoreBadges } from './_components/app-bits';
import { AsoSectionNav } from './_components/section-nav';
import { ConnectAppDialog } from './_components/connect-app-dialog';
import type { TrackedApp } from './_components/types';

/**
 * /aso — izlenen uygulamalar. Kart "Aç" ile /aso/[appId] çalışma alanına
 * gider (eskiden aynı sayfada modal açılıyordu: derin bağlantı, Geri tuşu ve
 * yenileme çalışmıyordu).
 */
export default function AsoPage() {
  const { site } = useSiteContext();
  const router = useRouter();
  const confirm = useConfirm();
  const [apps, setApps] = useState<TrackedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showConnect, setShowConnect] = useState(false);
  const base = siteHref(site.id, 'aso');

  const loadApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApps(await api.request<TrackedApp[]>(`/sites/${site.id}/aso/apps`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  useEffect(() => { loadApps(); }, [loadApps]);

  const removeApp = async (app: TrackedApp) => {
    const ok = await confirm({
      title: `"${app.name}" takipten çıkarılsın mı?`,
      description: 'Bu uygulamanın tüm anahtar kelime ve yorum verileri silinir. Geri alınamaz.',
      confirmLabel: 'Takipten çıkar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.request(`/sites/${site.id}/aso/apps/${app.id}`, { method: 'DELETE' });
      setApps((prev) => prev.filter((a) => a.id !== app.id));
      toast.success('Uygulama takipten çıkarıldı');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Smartphone}
        title="Mobil uygulama (ASO)"
        description="App Store ve Google Play: anahtar kelime sıraları, mağaza metinleri, yorumlar ve görseller."
        actions={
          <Button size="sm" onClick={() => setShowConnect(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Uygulama ekle
          </Button>
        }
      />

      <AsoSectionNav siteId={site.id} />

      <AsyncState
        loading={loading}
        error={error}
        onRetry={loadApps}
        empty={apps.length === 0}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
          </div>
        }
        emptyView={
          <EmptyState
            icon={Smartphone}
            title="Henüz izlenen uygulama yok"
            description="App Store ya da Google Play'deki uygulamanı ekle; anahtar kelime sıraları, yorum duygu analizi ve mağaza metni önerileri otomatik başlar."
            primary={{ label: 'İlk uygulamanı ekle', onClick: () => setShowConnect(true) }}
          />
        }
      >
        <motion.ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {apps.map((app) => {
            const href = `${base}/${app.id}`;
            return (
              <motion.li key={app.id} variants={fadeUp}>
                <Card className="relative h-full transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-brand/40">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <AppIcon src={app.iconUrl} size="lg" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold">
                          {/* Tüm kart tıklanabilir: bağlantı kartı örter, düğmeler üstte kalır */}
                          <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
                            {app.name}
                          </Link>
                        </h3>
                        <p className="truncate text-label text-muted-foreground">{app.developer ?? ''}</p>
                        <StoreBadges app={app} className="mt-1.5" />
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-label">
                      {app.iosRating != null && (
                        <div>
                          <dt className="text-muted-foreground">iOS puanı</dt>
                          <dd className="text-metric"><Rating value={app.iosRating} /></dd>
                        </div>
                      )}
                      {app.androidRating != null && (
                        <div>
                          <dt className="text-muted-foreground">Android puanı</dt>
                          <dd className="text-metric"><Rating value={app.androidRating} /></dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-muted-foreground">Anahtar kelime</dt>
                        <dd className="text-metric tabular-nums">{formatNum(app._count?.keywords ?? 0)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Yorum</dt>
                        <dd className="text-metric tabular-nums">{formatNum(app._count?.reviews ?? 0)}</dd>
                      </div>
                    </dl>

                    <div className="relative z-10 mt-auto flex gap-1.5 border-t pt-3">
                      <Button asChild size="sm" className="h-8 flex-1">
                        <Link href={href}>Aç</Link>
                      </Button>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" aria-label={`${app.name} için diğer işlemler`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => router.push(`${href}/screenshots`)}>
                            <ImageIcon aria-hidden /> Screenshot Studio
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => router.push(`${href}/ai-visibility`)}>
                            <Sparkles aria-hidden /> AI görünürlük
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem danger onSelect={() => removeApp(app)}>
                            <Trash2 aria-hidden /> Takipten çıkar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              </motion.li>
            );
          })}
        </motion.ul>
      </AsyncState>

      <ConnectAppDialog
        siteId={site.id}
        open={showConnect}
        onOpenChange={setShowConnect}
        onAdded={(app) => {
          setShowConnect(false);
          setApps((prev) => [app, ...prev]);
          router.push(`${base}/${app.id}`);
        }}
      />
    </div>
  );
}
