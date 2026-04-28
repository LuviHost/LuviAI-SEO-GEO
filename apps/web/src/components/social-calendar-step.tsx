'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, Clock, Plus, Trash2, RefreshCw, Send, AlertCircle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

const DAY_LABELS = ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'];
const DAY_LABELS_SHORT = ['Paz', 'Pzt', 'Sal', 'Car', 'Per', 'Cum', 'Cts'];

type CalendarPayload = {
  plan: string;
  postsPerWeek: number;
  timezone: string;
  channels: Array<any>;
  slots: Array<any>;
  defaultSlots: Array<{ dayOfWeek: number; hour: number; minute: number; label: string }>;
  stats: { draftCount: number; queuedCount: number; publishedCount: number; total: number };
  posts: Array<any>;
};

export function SocialCalendarStep({ siteId }: { siteId: string }) {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await api.getSocialCalendar(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [siteId]);

  const seed = async (replace = false) => {
    setBusy(true);
    try {
      const res = await api.seedSocialSlots(siteId, { replace });
      toast.success(
        res.created > 0
          ? `${res.created} slot olusturuldu (toplam ${res.total})`
          : `Zaten ${res.total} slot var`,
      );
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (slotId: string) => {
    if (!confirm('Bu slotu silmek istediginden emin misin?')) return;
    setBusy(true);
    try {
      await api.deleteSocialSlot(slotId);
      toast.success('Slot silindi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSlot = async (slot: any) => {
    setBusy(true);
    try {
      await api.updateSocialSlot(slot.id, { isActive: !slot.isActive });
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const publishNow = async (postId: string) => {
    setBusy(true);
    try {
      await api.publishSocialPostNow(postId);
      toast.success('Yayinlandi ✓');
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;

  const hasChannels = data.channels.length > 0;
  const hasSlots = data.slots.length > 0;

  return (
    <div className="space-y-5">
      {/* Plan ozet */}
      <div className="rounded-lg border bg-gradient-to-br from-brand/5 to-transparent p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-brand/10 grid place-items-center">
              <Calendar className="h-5 w-5 text-brand" />
            </div>
            <div>
              <div className="text-sm font-semibold">{data.plan} plani</div>
              <div className="text-xs text-muted-foreground">
                Haftada {data.postsPerWeek} otomatik post · Saat dilimi: {data.timezone}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline">Taslak: {data.stats.draftCount}</Badge>
            <Badge variant="outline">Kuyruk: {data.stats.queuedCount}</Badge>
            <Badge variant={'success' as any}>Yayinda: {data.stats.publishedCount}</Badge>
          </div>
        </div>
      </div>

      {!hasChannels && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-amber-700 dark:text-amber-400">Once kanal bagla</div>
            <div className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
              Otomatik takvim icin "Sosyal Kanallar" adimindan en az bir kanal (X / LinkedIn) baglamalisin.
            </div>
          </div>
        </div>
      )}

      {/* Slot'lar */}
      {hasChannels && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Haftalik takvim</div>
              <div className="text-xs text-muted-foreground">
                Bu saatlerde aktif kuyruktan en eski draft otomatik yayinlanir.
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!hasSlots ? (
                <Button size="sm" onClick={() => seed(false)} disabled={busy}>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Plana gore kur ({data.postsPerWeek} slot)
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => seed(false)} disabled={busy}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Eksikleri tamamla
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => seed(true)} disabled={busy}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Sifirla
                  </Button>
                </>
              )}
            </div>
          </div>

          {hasSlots ? (
            <WeekGrid slots={data.slots} onToggle={toggleSlot} onRemove={removeSlot} busy={busy} />
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Henuz slot yok. "Plana gore kur" butonu plan default'unu kullanir.
                <div className="text-xs mt-2">
                  Default: {data.defaultSlots.map((s) => s.label).join(' · ')}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Yaklasan & taslak postlar */}
      <UpcomingPostsList posts={data.posts} onPublishNow={publishNow} busy={busy} />
    </div>
  );
}

// ─── Hafta gridi (7 gun x 24 saat ozet) ──────────────────────────────

function WeekGrid({
  slots, onToggle, onRemove, busy,
}: {
  slots: any[];
  onToggle: (slot: any) => void;
  onRemove: (slotId: string) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
        const daySlots = slots.filter((s) => s.dayOfWeek === dow);
        return (
          <div
            key={dow}
            className="rounded-lg border bg-card p-3 min-h-[80px]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              <span className="hidden sm:inline">{DAY_LABELS_SHORT[dow]}</span>
              <span className="sm:hidden">{DAY_LABELS[dow]}</span>
            </div>
            <div className="space-y-1.5">
              {daySlots.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 italic">—</div>
              ) : (
                daySlots.map((s) => (
                  <div
                    key={s.id}
                    className={`group rounded-md px-2 py-1.5 text-xs flex items-center justify-between gap-1 transition-colors ${
                      s.isActive
                        ? 'bg-brand/10 text-foreground border border-brand/30'
                        : 'bg-muted/40 text-muted-foreground border border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(s)}
                      disabled={busy}
                      className="font-mono text-xs tracking-tight"
                      title={s.isActive ? 'Pasiflestir' : 'Aktiflestir'}
                    >
                      {String(s.hour).padStart(2, '0')}:{String(s.minute).padStart(2, '0')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(s.id)}
                      disabled={busy}
                      className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"
                      title="Sil"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Yaklasan postlar listesi ────────────────────────────────────────

function UpcomingPostsList({
  posts, onPublishNow, busy,
}: {
  posts: any[];
  onPublishNow: (id: string) => void;
  busy: boolean;
}) {
  const upcoming = posts.filter((p) => ['DRAFT', 'QUEUED', 'PUBLISHING'].includes(p.status));
  const recent = posts.filter((p) => p.status === 'PUBLISHED').slice(0, 5);

  if (upcoming.length === 0 && recent.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          <Send className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Henuz post yok. Bir makale yayinlandiginda otomatik draft olusur.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {upcoming.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Yaklasanlar ({upcoming.length})
          </div>
          <ul className="divide-y border rounded-lg">
            {upcoming.map((p) => (
              <PostRow key={p.id} post={p} onPublishNow={onPublishNow} busy={busy} />
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Son yayinlananlar
          </div>
          <ul className="divide-y border rounded-lg">
            {recent.map((p) => (
              <PostRow key={p.id} post={p} onPublishNow={onPublishNow} busy={busy} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PostRow({
  post, onPublishNow, busy,
}: {
  post: any;
  onPublishNow: (id: string) => void;
  busy: boolean;
}) {
  const statusBadge = (() => {
    switch (post.status) {
      case 'DRAFT': return <Badge variant="outline" className="text-[10px]">Taslak</Badge>;
      case 'QUEUED': return <Badge variant="outline" className="text-[10px]">Kuyrukta</Badge>;
      case 'PUBLISHING': return <Badge variant="outline" className="text-[10px]">Yayinlaniyor</Badge>;
      case 'PUBLISHED': return <Badge variant={'success' as any} className="text-[10px]">Yayinda</Badge>;
      case 'FAILED': return <Badge variant={'destructive' as any} className="text-[10px]">Basarisiz</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{post.status}</Badge>;
    }
  })();

  const when = post.publishedAt
    ? `Yayinlandi: ${new Date(post.publishedAt).toLocaleString('tr-TR')}`
    : post.scheduledFor
      ? `Planlandi: ${new Date(post.scheduledFor).toLocaleString('tr-TR')}`
      : `Olusturuldu: ${new Date(post.createdAt).toLocaleDateString('tr-TR')}`;

  const channelLabel = (() => {
    const t = post.channel?.type;
    if (t === 'X_TWITTER') return 'X';
    if (t === 'LINKEDIN_PERSONAL') return 'LinkedIn';
    if (t === 'LINKEDIN_COMPANY') return 'LinkedIn Sirket';
    return t ?? 'Kanal';
  })();

  return (
    <li className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {statusBadge}
          <Badge variant="outline" className="text-[10px]">{channelLabel}</Badge>
          {post.article && (
            <span className="text-[11px] text-muted-foreground truncate max-w-[240px]">
              {post.article.title}
            </span>
          )}
        </div>
        <div className="text-xs text-foreground/80 line-clamp-2 whitespace-pre-wrap">{post.text}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{when}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {post.externalUrl ? (
          <a
            href={post.externalUrl}
            target="_blank"
            rel="noopener"
            className="text-xs text-brand hover:underline"
          >
            Ac
          </a>
        ) : ['DRAFT', 'QUEUED'].includes(post.status) ? (
          <Button size="sm" variant="outline" onClick={() => onPublishNow(post.id)} disabled={busy}>
            <Send className="h-3 w-3 mr-1" />
            Simdi
          </Button>
        ) : null}
      </div>
    </li>
  );
}
