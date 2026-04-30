'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ExternalLink, Plus, Trash2, AlertTriangle,
  Globe2, FileText, Zap, Crown, Sparkles, ChevronRight, Activity,
} from 'lucide-react';

const STATUS_CLASS: Record<string, string> = {
  ONBOARDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  AUDIT_PENDING: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  AUDIT_COMPLETE: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  PAUSED: 'bg-muted text-muted-foreground border-border',
  ERROR: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
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
  const planLabel = isTrial ? `${freeArticleRemaining}/1 kaldı` : (me?.plan ?? '-');

  // Hangi karta tıklandığında "leaving" animasyonu çalışıyor
  const [leavingId, setLeavingId] = useState<string | null>(null);

  return (
    <div className="relative space-y-10">
      {/* Subtle background gradient orb */}
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-brand/15 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -left-32 h-72 w-72 rounded-full bg-violet-500/10 blur-[120px]" />

      {/* Header */}
      <div className="relative flex justify-between items-end flex-wrap gap-4 animate-[fadeInUp_500ms_ease-out_both]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand font-semibold">
              Mission Control
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t('dashboard.title')}
          </h1>
          {session?.user?.name && (
            <p className="text-sm text-muted-foreground mt-1.5">
              Hoş geldin, <strong className="text-foreground">{session.user.name}</strong>
            </p>
          )}
        </div>
        <Button asChild size="lg" className="group relative overflow-hidden bg-gradient-to-r from-brand to-brand/85 shadow-[0_0_0_1px_rgb(124_58_237/0.3),0_8px_24px_-6px_rgb(124_58_237/0.5)] hover:shadow-[0_0_0_1px_rgb(124_58_237/0.5),0_12px_36px_-6px_rgb(124_58_237/0.7)] transition-shadow duration-300">
          <Link href="/onboarding" className="font-mono text-xs uppercase tracking-widest">
            <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
            {t('dashboard.new_site')}
            <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 group-hover:translate-x-[400%] transition-transform duration-700" />
          </Link>
        </Button>
      </div>

      {/* KPI grid */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : me ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative">
          <StatCard
            icon={Globe2}
            label="Sitelerim"
            value={me.sitesCount ?? 0}
            accent="brand"
            delay={80}
          />
          <StatCard
            icon={FileText}
            label="Yayınlanan makale"
            value={me.articlesPublished ?? 0}
            accent="emerald"
            delay={160}
          />
          <StatCard
            icon={Zap}
            label="Bu ay üretilen"
            value={me.articlesUsedThisMonth ?? 0}
            accent="amber"
            delay={240}
          />
          <StatCard
            icon={Crown}
            label={isTrial ? 'Ücretsiz hak' : (me.plan ?? 'Plan')}
            value={planLabel}
            accent="violet"
            stringValue
            delay={320}
          />
        </div>
      ) : null}

      {/* Sites */}
      <section className="relative animate-[fadeInUp_500ms_ease-out_400ms_both]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand" />
            <h2 className="text-lg font-semibold">{t('dashboard.sites')}</h2>
            {!loading && sites.length > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                · {sites.length} {sites.length === 1 ? 'site' : 'site'}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : sites.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {sites.map((s, idx) => (
              <SiteCard
                key={s.id}
                site={s}
                index={idx}
                onDelete={() => setDeleteTarget(s)}
                isLeaving={leavingId === s.id}
                isAnyLeaving={!!leavingId}
                onNavigate={() => setLeavingId(s.id)}
              />
            ))}
          </div>
        )}
      </section>

      {deleteTarget && (
        <DeleteSiteDialog
          site={deleteTarget}
          deleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

      {/* Local keyframes (Tailwind-extended olmadan da çalışır) */}
      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

const ACCENT_CLASSES: Record<string, { ring: string; iconBg: string; iconText: string; bar: string; hoverBorder: string }> = {
  brand:    { ring: 'ring-brand/0',         iconBg: 'bg-brand/15',         iconText: 'text-brand',                    bar: 'from-brand to-brand/40',                       hoverBorder: 'hover:border-brand/40' },
  emerald:  { ring: 'ring-emerald-500/0',   iconBg: 'bg-emerald-500/15',   iconText: 'text-emerald-600 dark:text-emerald-400',  bar: 'from-emerald-500 to-emerald-500/40',  hoverBorder: 'hover:border-emerald-500/40' },
  amber:    { ring: 'ring-amber-500/0',     iconBg: 'bg-amber-500/15',     iconText: 'text-amber-600 dark:text-amber-400',      bar: 'from-amber-500 to-amber-500/40',      hoverBorder: 'hover:border-amber-500/40' },
  violet:   { ring: 'ring-violet-500/0',    iconBg: 'bg-violet-500/15',    iconText: 'text-violet-600 dark:text-violet-400',    bar: 'from-violet-500 to-violet-500/40',    hoverBorder: 'hover:border-violet-500/40' },
};

function StatCard({
  icon: Icon, label, value, accent = 'brand', stringValue = false, delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent?: keyof typeof ACCENT_CLASSES;
  stringValue?: boolean;
  delay?: number;
}) {
  const cls = ACCENT_CLASSES[accent];
  const numericValue = typeof value === 'number' ? value : null;
  const displayed = numericValue !== null ? <CountUp to={numericValue} /> : value;

  return (
    <div
      className={`group relative rounded-xl border bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 ${cls.hoverBorder} hover:shadow-[0_8px_28px_-12px_rgb(0_0_0/0.18)] dark:hover:shadow-[0_8px_28px_-12px_rgb(0_0_0/0.5)] overflow-hidden`}
      style={{ animation: `fadeInUp 500ms ease-out ${delay}ms both` }}
    >
      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${cls.bar} opacity-60 group-hover:opacity-100 transition-opacity`} />
      {/* Subtle accent glow on hover */}
      <div className={`absolute -inset-px rounded-xl bg-gradient-to-br ${cls.bar} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300 pointer-events-none`} />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={`h-9 w-9 rounded-lg ${cls.iconBg} grid place-items-center transition-transform duration-300 group-hover:scale-110`}>
          <Icon className={`h-4 w-4 ${cls.iconText}`} />
        </div>
      </div>
      <div className={`${stringValue ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl'} font-bold tracking-tight ${cls.iconText} font-mono tabular-nums leading-none`}>
        {displayed}
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground mt-2 font-medium">{label}</div>
    </div>
  );
}

function CountUp({ to, durationMs = 700 }: { to: number; durationMs?: number }) {
  const [val, setVal] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) { setVal(to); return; }
    startedRef.current = true;
    if (to === 0) { setVal(0); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);
  return <>{val}</>;
}

function SiteCard({
  site, index, onDelete, isLeaving, isAnyLeaving, onNavigate,
}: {
  site: any;
  index: number;
  onDelete: () => void;
  isLeaving: boolean;
  isAnyLeaving: boolean;
  onNavigate: () => void;
}) {
  const statusCls = STATUS_CLASS[site.status] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <Link
      href={`/sites/${site.id}`}
      onClick={onNavigate}
      className={[
        'block group relative rounded-xl border bg-card overflow-hidden cursor-pointer',
        'transition-all duration-300 will-change-transform',
        isLeaving
          ? 'scale-[1.02] border-brand/60 shadow-[0_0_0_1px_rgb(124_58_237/0.5),0_24px_60px_-12px_rgb(124_58_237/0.6)] z-10'
          : isAnyLeaving
            ? 'opacity-40 scale-[0.98]'
            : 'hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_8px_28px_-12px_rgb(124_58_237/0.25)]',
      ].join(' ')}
      style={{ animation: `fadeInUp 450ms ease-out ${index * 60 + 120}ms both` }}
      aria-label={`${site.name} sitesini aç`}
    >
      {/* Hover glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-brand/0 via-brand/[0.04] to-brand/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      {/* Leaving glow — sayfa gecisi sirasinda parlama */}
      {isLeaving && (
        <div className="absolute inset-0 bg-gradient-to-r from-brand/20 via-violet-500/15 to-brand/20 pointer-events-none animate-pulse" />
      )}

      <div className="relative p-5 flex items-center gap-4 flex-wrap">
        {/* Site avatar/initial */}
        <div className={[
          'shrink-0 h-11 w-11 rounded-lg bg-gradient-to-br from-brand/20 to-violet-500/20 grid place-items-center font-semibold text-brand text-sm border border-brand/20',
          'transition-transform duration-300',
          isLeaving ? 'scale-110 rotate-3' : 'group-hover:scale-105',
        ].join(' ')}>
          {site.name?.slice(0, 2).toUpperCase() ?? '??'}
        </div>

        {/* Title + url */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold truncate text-foreground">{site.name}</h3>
            <span className={`inline-flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-mono uppercase tracking-wider border ${statusCls}`}>
              {site.status === 'ACTIVE' && <span className="h-1 w-1 rounded-full bg-current animate-pulse" />}
              {site.status}
            </span>
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noopener"
            onClick={(e) => { e.stopPropagation(); }}
            className="text-xs text-muted-foreground hover:text-brand inline-flex items-center gap-1 truncate max-w-full relative z-10"
          >
            <span className="truncate">{site.url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {site.niche && (
            <span className="text-[10px] text-muted-foreground/70 ml-2 font-mono uppercase tracking-wider">· {site.niche}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={[
            'inline-flex items-center gap-1 h-8 px-3 rounded-md border bg-background/50 font-mono text-[10px] uppercase tracking-widest text-foreground/80',
            'transition-all duration-300',
            isLeaving ? 'border-brand bg-brand text-white' : 'group-hover:border-brand/40 group-hover:bg-brand/5',
          ].join(' ')}>
            Aç
            <ChevronRight className={[
              'h-3 w-3 transition-transform duration-300',
              isLeaving ? 'translate-x-1' : 'group-hover:translate-x-0.5',
            ].join(' ')} />
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors relative z-10"
            title="Siteyi sil"
            aria-label="Siteyi sil"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  const { t } = useT();
  return (
    <div className="relative rounded-2xl border-2 border-dashed border-brand/20 bg-card overflow-hidden animate-[scaleIn_500ms_ease-out_both]">
      <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.04] via-transparent to-violet-500/[0.04] pointer-events-none" />
      <div className="relative p-12 text-center">
        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-gradient-to-br from-brand/20 to-violet-500/20 grid place-items-center border border-brand/20">
          <Sparkles className="h-7 w-7 text-brand animate-pulse" />
        </div>
        <h3 className="text-lg font-semibold mb-1">İlk sitenizi ekleyin</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
          {t('dashboard.empty')}
        </p>
        <Button asChild size="lg" className="group relative overflow-hidden">
          <Link href="/onboarding" className="font-mono text-xs uppercase tracking-widest">
            <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-300" />
            {t('dashboard.add_first')}
            <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 group-hover:translate-x-[400%] transition-transform duration-700" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function DeleteSiteDialog({
  site, deleting, onCancel, onConfirm,
}: {
  site: any;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const expected = site.name;
  const canDelete = typed.trim() === expected && !deleting;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4 animate-[fadeInUp_200ms_ease-out_both]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-red-500/30 rounded-xl p-6 max-w-md w-full shadow-2xl animate-[scaleIn_200ms_ease-out_both]">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-red-500/10 grid place-items-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Siteyi sil</h3>
            <p className="text-sm text-muted-foreground mt-1">
              <strong>{site.name}</strong> ile birlikte aşağıdakilerin tamamı silinir, geri alınamaz:
            </p>
          </div>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 mb-4 ml-13" style={{ paddingLeft: '52px' }}>
          <li>• Brain (rakipler, persona, SEO stratejisi)</li>
          <li>• Tüm denetim (audit) kayıtları</li>
          <li>• Topic queue + üretilmiş & yayınlanmış makaleler</li>
          <li>• Sosyal kanal bağlantıları (X, LinkedIn vb.) + post takvimi</li>
          <li>• Yayın hedefleri (FTP, WordPress, GitHub vb.)</li>
          <li>• Analitik snapshot'lar + iş kuyruğu kayıtları</li>
        </ul>
        <div className="space-y-2 mb-5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Onaylamak için site adını yaz: <span className="text-red-500 font-mono">{expected}</span>
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            disabled={deleting}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-red-500"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            İptal
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={!canDelete}
          >
            {deleting ? 'Siliniyor…' : 'Kalıcı olarak sil'}
          </Button>
        </div>
      </div>
    </div>
  );
}
