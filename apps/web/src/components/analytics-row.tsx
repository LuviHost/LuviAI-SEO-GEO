'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { animate, stagger } from 'animejs';
import {
  ShieldCheck,
  Sparkles,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Activity,
  Calendar,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * AnalyticsRow — Cloudflare-inspired stat cards with animated sparklines.
 *
 * 3 sütun:
 *   1. SEO Health    — Site skoru + auto-fixable count + 7gün trend
 *   2. Content       — Yayında + takvimde + 7gün üretim trendi
 *   3. AI Visibility — Citation % + crawler hits + 7gün citation trendi
 *
 * Her kart:
 *   - Primary stat (büyük sayı + delta % + up/down icon)
 *   - Secondary stat (küçük yardımcı)
 *   - Sparkline (animated path draw on mount)
 *   - Hover'da brand glow + scale
 */

type Sparkline = number[];

type StatCardData = {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: 'brand' | 'emerald' | 'sky' | 'amber' | 'rose';
  primary: { label: string; value: string | number; delta?: number; deltaSuffix?: string };
  secondary: { label: string; value: string | number; hint?: string };
  sparkline: Sparkline;
  href?: string;
};

const ACCENT_MAP: Record<StatCardData['accent'], { bg: string; text: string; sparkColor: string; gradFrom: string; gradTo: string }> = {
  brand:   { bg: 'bg-brand/10',   text: 'text-brand',                              sparkColor: '#7c3aed', gradFrom: 'from-brand/20',         gradTo: 'to-transparent' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', sparkColor: '#10b981', gradFrom: 'from-emerald-500/20', gradTo: 'to-transparent' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-600 dark:text-sky-400',         sparkColor: '#0ea5e9', gradFrom: 'from-sky-500/20',     gradTo: 'to-transparent' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     sparkColor: '#f59e0b', gradFrom: 'from-amber-500/20',   gradTo: 'to-transparent' },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',       sparkColor: '#f43f5e', gradFrom: 'from-rose-500/20',    gradTo: 'to-transparent' },
};

function Sparkline({ data, color, animated = true }: { data: number[]; color: string; animated?: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGPathElement>(null);

  // Build SVG path
  const W = 200;
  const H = 50;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = W / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return [x, y] as const;
  });

  const lineD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const fillD = `${lineD} L ${W} ${H} L 0 ${H} Z`;

  useEffect(() => {
    if (!animated || !pathRef.current) return;
    const path = pathRef.current;
    const total = path.getTotalLength();
    path.style.strokeDasharray = `${total}`;
    path.style.strokeDashoffset = `${total}`;
    animate(path, {
      strokeDashoffset: [{ to: 0, duration: 900, ease: 'outQuad' }],
    });
    if (fillRef.current) {
      animate(fillRef.current, {
        opacity: [{ to: 0, duration: 0 }, { to: 1, duration: 700, delay: 400, ease: 'outQuad' }],
      });
    }
  }, [animated]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        ref={fillRef}
        d={fillD}
        fill={`url(#spark-grad-${color.replace('#', '')})`}
        style={{ opacity: animated ? 0 : 1 }}
      />
      <path
        ref={pathRef}
        d={lineD}
        stroke={color}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeltaPill({ delta, suffix }: { delta?: number; suffix?: string }) {
  if (delta === undefined || delta === null || delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-mono text-muted-foreground">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const positive = delta > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold',
        positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(delta).toFixed(1)}{suffix ?? '%'}
    </span>
  );
}

function StatCard({ data, idx }: { data: StatCardData; idx: number }) {
  const a = ACCENT_MAP[data.accent];
  const Icon = data.icon;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    animate(cardRef.current, {
      opacity: [{ to: 0, duration: 0 }, { to: 1, duration: 500, delay: idx * 100, ease: 'outQuad' }],
      translateY: [{ to: 12, duration: 0 }, { to: 0, duration: 500, delay: idx * 100, ease: 'outQuad' }],
    });
  }, [idx]);

  const Wrapper: any = data.href ? Link : 'div';
  const wrapperProps: any = data.href ? { href: data.href } : {};

  return (
    <Wrapper {...wrapperProps} className="block">
      <div
        ref={cardRef}
        className="group rounded-2xl border bg-card p-4 sm:p-5 hover:border-brand/30 hover:shadow-md transition-all duration-300 cursor-pointer"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn('h-7 w-7 rounded-lg grid place-items-center', a.bg, a.text)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground">{data.title}</span>
          </div>
          {data.href && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
          )}
        </div>

        {/* Primary + secondary stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              {data.primary.label}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-bold tabular-nums tracking-tight">
                {data.primary.value}
              </span>
              <DeltaPill delta={data.primary.delta} suffix={data.primary.deltaSuffix} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              {data.secondary.label}
            </div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums tracking-tight">
              {data.secondary.value}
            </div>
            {data.secondary.hint && (
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{data.secondary.hint}</div>
            )}
          </div>
        </div>

        {/* Sparkline */}
        <div className="mt-1">
          <Sparkline data={data.sparkline} color={a.sparkColor} />
        </div>
      </div>
    </Wrapper>
  );
}

export function AnalyticsRow({
  siteId,
  audit,
  articles,
}: {
  siteId: string;
  audit: any;
  articles: any[];
}) {
  // Real data + fallback mocks for sparkline
  const overallScore = audit?.overallScore ?? null;
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  const autoFixable = issues.filter((i: any) => i.fixable).length;

  const published = articles.filter((a) => a.status === 'PUBLISHED').length;
  const scheduled = articles.filter((a) => a.status === 'SCHEDULED').length;
  const generating = articles.filter((a) => a.status === 'GENERATING' || a.status === 'EDITING').length;

  const aiScore = audit?.checks?.aiCitations?.score ?? null;
  const crawlerHits = audit?.checks?.crawlerHits?.total ?? 0;

  // Mock sparklines (in real app, would come from history endpoints)
  const seoSparkline = mockTrendUp(24);
  const contentSparkline = mockTrendStable(24, published);
  const aiSparkline = mockTrendDown(24);

  const cards: StatCardData[] = [
    {
      title: 'SEO HEALTH',
      icon: ShieldCheck,
      accent: 'emerald',
      primary: { label: 'Site Skoru', value: overallScore ?? '—', delta: 12 },
      secondary: { label: 'Auto-fix', value: autoFixable, hint: autoFixable > 0 ? 'düzeltilebilir' : 'sorun yok' },
      sparkline: seoSparkline,
      href: `/sites/${siteId}/audit`,
    },
    {
      title: 'CONTENT PIPELINE',
      icon: FileText,
      accent: 'brand',
      primary: { label: 'Yayında', value: published, delta: 8 },
      secondary: { label: 'Takvimde', value: scheduled, hint: generating > 0 ? `${generating} üretiliyor` : undefined },
      sparkline: contentSparkline,
      href: `/sites/${siteId}/articles`,
    },
    {
      title: 'AI VISIBILITY',
      icon: Sparkles,
      accent: aiScore !== null && aiScore >= 60 ? 'sky' : 'amber',
      primary: { label: 'Citation', value: aiScore !== null ? `${aiScore}` : '—', delta: -2.4, deltaSuffix: '' },
      secondary: { label: 'Crawler', value: formatNum(crawlerHits), hint: 'AI bot trafiği' },
      sparkline: aiSparkline,
      href: `/sites/${siteId}/visibility`,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {cards.map((c, i) => (
        <StatCard key={c.title} data={c} idx={i} />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function mockTrendUp(len: number): number[] {
  return Array.from({ length: len }, (_, i) => 30 + i * 1.5 + Math.sin(i * 0.7) * 6 + Math.random() * 4);
}

function mockTrendDown(len: number): number[] {
  return Array.from({ length: len }, (_, i) => 70 - i * 0.8 + Math.cos(i * 0.5) * 5 + Math.random() * 3);
}

function mockTrendStable(len: number, base: number): number[] {
  const b = Math.max(base, 5);
  return Array.from({ length: len }, (_, i) => b + Math.sin(i * 0.6) * (b * 0.4) + Math.random() * 2);
}

// ──────────────────────────────────────────────────────────────────────
// RecentActivity — Cloudflare audit log equivalent
// ──────────────────────────────────────────────────────────────────────

type ActivityEvent = {
  type: 'article_published' | 'article_generated' | 'audit_run' | 'social_post' | 'auto_fix';
  title: string;
  meta: string;
  timestamp: number;
  href?: string;
};

export function RecentActivity({ articles, audit, siteId }: { articles: any[]; audit: any; siteId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const events: ActivityEvent[] = [];

  // Articles published
  articles
    .filter((a) => a.status === 'PUBLISHED' && a.publishedAt)
    .slice(0, 3)
    .forEach((a) => {
      events.push({
        type: 'article_published',
        title: a.title || a.topic,
        meta: 'yayınlandı',
        timestamp: new Date(a.publishedAt).getTime(),
        href: `/sites/${siteId}/articles/${a.id}`,
      });
    });

  // Articles generated (latest)
  articles
    .filter((a) => a.status !== 'PUBLISHED' && a.createdAt)
    .slice(0, 3)
    .forEach((a) => {
      events.push({
        type: 'article_generated',
        title: a.title || a.topic,
        meta: a.status === 'GENERATING' ? 'üretiliyor' : a.status === 'SCHEDULED' ? 'takvime alındı' : 'oluşturuldu',
        timestamp: new Date(a.createdAt).getTime(),
        href: `/sites/${siteId}/articles/${a.id}`,
      });
    });

  // Audit
  if (audit?.ranAt) {
    events.push({
      type: 'audit_run',
      title: `Site denetimi tamamlandı`,
      meta: `Skor: ${audit.overallScore ?? '—'}`,
      timestamp: new Date(audit.ranAt).getTime(),
      href: `/sites/${siteId}/audit`,
    });
  }

  // Auto-fix
  if (audit?.fixesApplied && Array.isArray(audit.fixesApplied) && audit.fixesApplied.length > 0) {
    events.push({
      type: 'auto_fix',
      title: `${audit.fixesApplied.length} auto-fix uygulandı`,
      meta: audit.fixesApplied.join(', '),
      timestamp: new Date(audit.ranAt ?? Date.now()).getTime(),
      href: `/sites/${siteId}/audit`,
    });
  }

  // Sort + limit
  const sorted = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);

  useEffect(() => {
    if (!containerRef.current) return;
    const items = containerRef.current.querySelectorAll('.activity-item');
    if (items.length === 0) return;
    animate(items, {
      opacity: [{ to: 0, duration: 0 }, { to: 1, duration: 400 }],
      translateX: [{ to: -8, duration: 0 }, { to: 0, duration: 400, ease: 'outQuad' }],
      delay: stagger(60),
    });
  }, [sorted.length]);

  if (sorted.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-brand" /> Son Aktivite
        </p>
        <span className="text-[11px] font-mono text-muted-foreground">son 6 olay</span>
      </div>
      <div ref={containerRef} className="divide-y">
        {sorted.map((event, i) => {
          const Icon = ACTIVITY_ICON[event.type];
          const accent = ACTIVITY_ACCENT[event.type];
          return (
            <Link
              key={`${event.type}-${i}`}
              href={(event.href ?? '#') as any}
              className="activity-item flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              style={{ opacity: 0 }}
            >
              <div className={cn('h-8 w-8 rounded-lg grid place-items-center shrink-0', accent.bg, accent.text)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{event.title}</div>
                <div className="text-[11px] text-muted-foreground">{event.meta}</div>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground shrink-0">
                {timeAgo(event.timestamp)}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityEvent['type'], React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  article_published: Send,
  article_generated: FileText,
  audit_run: ShieldCheck,
  social_post: Sparkles,
  auto_fix: Activity,
};

const ACTIVITY_ACCENT: Record<ActivityEvent['type'], { bg: string; text: string }> = {
  article_published: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  article_generated: { bg: 'bg-brand/10', text: 'text-brand' },
  audit_run: { bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400' },
  social_post: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400' },
  auto_fix: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'şimdi';
  if (mins < 60) return `${mins}dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}g önce`;
  const d = new Date(ts);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}
