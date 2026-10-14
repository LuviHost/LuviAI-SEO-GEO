'use client';

import { SITE_STATUS_LABEL, label } from '@/lib/labels';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { ChevronRight, Crown, ExternalLink, FileText, Globe2, Plus, Trash2, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fadeUp, staggerContainer } from '@/lib/motion-presets';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/ui/metric';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const STATUS_TONE: Record<string, BadgeProps['variant']> = {
  ONBOARDING: 'warning',
  AUDIT_PENDING: 'info',
  AUDIT_COMPLETE: 'info',
  ACTIVE: 'success',
  PAUSED: 'secondary',
  ERROR: 'danger',
};

export default function DashboardPage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const [sites, setSites] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = () => {
    return Promise.all([
      api.listSites().catch(() => []),
      api.getMyDashboard().catch(() => null),
    ]).then(([s, m]) => {
      setSites(s);
      setMe(m);
    });
  };

  useEffect(() => {
    if (status === 'loading') return;
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSite(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" ve tüm bağlı kayıtları silindi`);
      setDeleteTarget(null);
      await reload();
    } catch (err: any) {
      toast.error(err.message ?? 'Silme başarısız');
    } finally {
      setDeleting(false);
    }
  };

  const isTrial = me?.subscriptionStatus === 'TRIAL';
  const articlesUsed = me?.articlesUsedThisMonth ?? 0;
  const freeArticleRemaining = isTrial ? Math.max(0, 1 - articlesUsed) : null;
  const planLabel = isTrial ? `${freeArticleRemaining}/1 kaldı` : (me?.plan ?? '—');

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('dashboard.title')}
        description={session?.user?.name ? <>Hoş geldin, <strong className="text-foreground">{session.user.name}</strong></> : undefined}
        actions={sites.length > 0 ? (
          <Button asChild>
            <Link href="/onboarding?new=1">
              <Plus className="h-4 w-4" aria-hidden />
              {t('dashboard.new_site')}
            </Link>
          </Button>
        ) : undefined}
      />

      {/* Hesap ozeti */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[124px]" />)}
        </div>
      ) : me ? (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <motion.div variants={fadeUp}>
            <MetricCard className="h-full" icon={Globe2} label="Sitelerim" value={me.sitesCount ?? 0} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <MetricCard className="h-full" icon={FileText} label="Yayınlanan yazı" value={me.articlesPublished ?? 0} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <MetricCard className="h-full" icon={Zap} label="Bu ay üretilen" value={me.articlesUsedThisMonth ?? 0} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <MetricCard className="h-full" icon={Crown} label={isTrial ? 'Ücretsiz hak' : 'Plan'} value={planLabel} />
          </motion.div>
        </motion.div>
      ) : null}

      {/* Siteler */}
      <section className="space-y-4">
        <SectionHeader
          title={
            <span className="inline-flex items-center gap-2">
              {t('dashboard.sites')}
              {!loading && sites.length > 0 && <Badge variant="secondary">{sites.length}</Badge>}
            </span>
          }
        />

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px]" />)}
          </div>
        ) : sites.length === 0 ? (
          <EmptyState
            icon={Globe2}
            title={t('dashboard.add_first')}
            description={t('dashboard.empty')}
            primary={{ label: 'Site ekle', href: '/onboarding?new=1' }}
          />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
            {sites.map((s) => (
              <motion.li key={s.id} variants={fadeUp}>
                <SiteCard site={s} onDelete={() => setDeleteTarget(s)} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>

      <DeleteSiteDialog
        site={deleteTarget}
        deleting={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/**
 * Site karti — tum kart tek baglanti (genisletilmis link deseni); dis baglanti
 * ve silme dugmesi ustte (z-10) kendi eylemleriyle. Eskiden role="button" div
 * icinde baglanti + dugme vardi (ic ice etkilesimli oge).
 */
function SiteCard({ site, onDelete }: { site: any; onDelete: () => void }) {
  const host = String(site.url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <Card className="group relative flex flex-wrap items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-apple-md focus-within:ring-2 focus-within:ring-brand/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-brand/20 bg-brand/10 text-sm font-semibold text-brand"
        aria-hidden
      >
        {site.name?.slice(0, 2).toLocaleUpperCase('tr-TR') ?? '??'}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <h3 className="truncate font-semibold">
            <Link
              href={`/sites/${site.id}`}
              className="after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none"
            >
              {site.name}
            </Link>
          </h3>
          <Badge variant={STATUS_TONE[site.status] ?? 'secondary'}>{label(SITE_STATUS_LABEL, site.status)}</Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-label text-muted-foreground">
          <a
            href={site.url}
            target="_blank"
            rel="noopener"
            className="relative z-10 inline-flex max-w-full items-center gap-1 truncate hover:text-brand"
          >
            <span className="truncate">{host}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            <span className="sr-only">(yeni sekmede açılır)</span>
          </a>
          {site.niche && <span className="truncate">· {site.niche}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center gap-1 text-label text-muted-foreground transition-colors group-hover:text-brand sm:inline-flex" aria-hidden>
          Aç <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="relative z-10 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          aria-label={`${site.name} sitesini sil`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </Card>
  );
}

function DeleteSiteDialog({
  site, deleting, onCancel, onConfirm,
}: {
  site: any | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const expected = site?.name ?? '';
  const canDelete = !!site && typed.trim() === expected && !deleting;

  // Her acilista onay kutusu bos baslasin
  useEffect(() => { setTyped(''); }, [site?.id]);

  return (
    <Dialog open={!!site} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Siteyi sil</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{expected}</strong> ile birlikte aşağıdakilerin tamamı silinir. Bu işlem geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Marka beyni (rakipler, persona, SEO stratejisi)</li>
            <li>Tüm tarama kayıtları</li>
            <li>Konu kuyruğu, üretilmiş ve yayınlanmış yazılar</li>
            <li>Sosyal kanal bağlantıları ve paylaşım takvimi</li>
            <li>Yayın hedefleri (WordPress, FTP, GitHub vb.)</li>
            <li>Analitik kayıtları ve iş kuyruğu</li>
          </ul>
          <div className="space-y-1.5">
            <label htmlFor="delete-confirm" className="text-label text-muted-foreground">
              Onaylamak için site adını yaz: <span className="font-mono text-danger">{expected}</span>
            </label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canDelete) onConfirm(); }}
              placeholder={expected}
              disabled={deleting}
              autoComplete="off"
              className={cn('font-mono', typed && typed.trim() !== expected && 'border-danger/50')}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            Vazgeç
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={!canDelete}>
            {deleting ? 'Siliniyor…' : 'Kalıcı olarak sil'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
