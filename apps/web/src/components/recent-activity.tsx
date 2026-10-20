'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { Activity, FileText, Send, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { fadeUp, staggerContainer } from '@/lib/motion-presets';
import { siteHref } from '@/lib/site-routes';
import { cn } from '@/lib/utils';
import { isPlanLocked } from '@/lib/plan-lock';

/**
 * Son aktivite — yazi uretimi/yayini, tarama ve otomatik duzeltmelerden son 6 olay.
 * Veri site baglamindan gelir (ek istek yok).
 */

type ActivityEvent = {
  type: 'article_published' | 'article_generated' | 'audit_run' | 'social_post' | 'auto_fix';
  title: string;
  meta: string;
  timestamp: number;
  href?: string;
};

const ACTIVITY_ICON: Record<ActivityEvent['type'], React.ComponentType<{ className?: string }>> = {
  article_published: Send,
  article_generated: FileText,
  audit_run: ShieldCheck,
  social_post: Sparkles,
  auto_fix: Wand2,
};

const ACTIVITY_TONE: Record<ActivityEvent['type'], string> = {
  article_published: 'bg-success/10 text-success',
  article_generated: 'bg-brand/10 text-brand',
  audit_run: 'bg-info/10 text-info',
  social_post: 'bg-brand/10 text-brand',
  auto_fix: 'bg-warning/10 text-warning',
};

export function RecentActivity({ articles, audit, siteId }: { articles: any[]; audit: any; siteId: string }) {
  const events: ActivityEvent[] = [];

  articles
    .filter((a) => a.status === 'PUBLISHED' && a.publishedAt)
    .slice(0, 3)
    .forEach((a) => {
      events.push({
        type: 'article_published',
        title: a.title || a.topic,
        meta: 'yayınlandı',
        timestamp: new Date(a.publishedAt).getTime(),
        href: `${siteHref(siteId, 'articles')}/${a.id}`,
      });
    });

  articles
    .filter((a) => a.status !== 'PUBLISHED' && a.createdAt)
    .slice(0, 3)
    .forEach((a) => {
      events.push({
        type: 'article_generated',
        title: a.title || a.topic,
        // Kilitli takvim yazisi (deneme hakki doldu) "takvime alindi" diye yazilacakmis gibi gorunmesin
        meta: a.status === 'GENERATING' ? 'üretiliyor' : isPlanLocked(a) ? 'kilitli · plan yükseltilince yazılır' : a.status === 'SCHEDULED' ? 'takvime alındı' : 'oluşturuldu',
        timestamp: new Date(a.createdAt).getTime(),
        href: `${siteHref(siteId, 'articles')}/${a.id}`,
      });
    });

  if (audit?.ranAt) {
    events.push({
      type: 'audit_run',
      title: 'Site taraması tamamlandı',
      meta: `Skor: ${audit.overallScore ?? '—'}`,
      timestamp: new Date(audit.ranAt).getTime(),
      href: siteHref(siteId, 'audit'),
    });
  }

  if (Array.isArray(audit?.fixesApplied) && audit.fixesApplied.length > 0) {
    events.push({
      type: 'auto_fix',
      title: `${audit.fixesApplied.length} otomatik düzeltme uygulandı`,
      meta: audit.fixesApplied.join(', '),
      timestamp: new Date(audit.ranAt ?? Date.now()).getTime(),
      href: siteHref(siteId, 'audit'),
    });
  }

  const sorted = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <Activity className="h-4 w-4 shrink-0" aria-hidden />
        Henüz aktivite yok. İlk tarama ve yazılar burada listelenir.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-brand" aria-hidden /> Son aktivite
        </h3>
        <span className="text-label text-muted-foreground">son {sorted.length} olay</span>
      </div>
      <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="divide-y">
        {sorted.map((event, i) => {
          const Icon = ACTIVITY_ICON[event.type];
          return (
            <motion.li key={`${event.type}-${i}`} variants={fadeUp}>
              <Link
                href={(event.href ?? '#') as any}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md', ACTIVITY_TONE[event.type])}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{event.title}</span>
                  <span className="block truncate text-label text-muted-foreground">{event.meta}</span>
                </span>
                <span className="shrink-0 text-label text-muted-foreground">{timeAgo(event.timestamp)}</span>
              </Link>
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'şimdi';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} g önce`;
  return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}
