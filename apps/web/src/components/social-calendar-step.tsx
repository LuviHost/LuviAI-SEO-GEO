'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, Clock, Plus, Trash2, RefreshCw, Send, AlertCircle, Sparkles, Check, X as XIcon, Eye, EyeOff } from 'lucide-react';
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

  const updateSlotTime = async (slot: any, hour: number, minute: number) => {
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      toast.error('Saat 00-23, dakika 00-59 araliginda olmali');
      return;
    }
    if (hour === slot.hour && minute === slot.minute) return;
    setBusy(true);
    try {
      await api.updateSocialSlot(slot.id, { hour, minute });
      toast.success(`Saat guncellendi: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addSlot = async (dayOfWeek: number) => {
    if (!data || data.channels.length === 0) {
      toast.error('Once kanal bagla');
      return;
    }
    const channelId = data.channels[0].id;
    const input = prompt('Saat (HH:MM, ornek 14:30):', '10:00');
    if (!input) return;
    const m = input.trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) {
      toast.error('Format HH:MM olmali');
      return;
    }
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      toast.error('Saat 00-23, dakika 00-59');
      return;
    }
    setBusy(true);
    try {
      await api.createSocialSlot(channelId, { dayOfWeek, hour, minute, isActive: true });
      toast.success(`${DAY_LABELS_SHORT[dayOfWeek]} ${input} eklendi`);
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
            <WeekGrid
              slots={data.slots}
              onToggle={toggleSlot}
              onRemove={removeSlot}
              onEditTime={updateSlotTime}
              onAddSlot={addSlot}
              busy={busy}
            />
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
  slots, onToggle, onRemove, onEditTime, onAddSlot, busy,
}: {
  slots: any[];
  onToggle: (slot: any) => void;
  onRemove: (slotId: string) => void;
  onEditTime: (slot: any, hour: number, minute: number) => void;
  onAddSlot: (dayOfWeek: number) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
        const daySlots = slots.filter((s) => s.dayOfWeek === dow);
        return (
          <div
            key={dow}
            className="rounded-lg border bg-card p-3 min-h-[100px] flex flex-col"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center justify-between">
              <span>
                <span className="hidden sm:inline">{DAY_LABELS_SHORT[dow]}</span>
                <span className="sm:hidden">{DAY_LABELS[dow]}</span>
              </span>
              <button
                type="button"
                onClick={() => onAddSlot(dow)}
                disabled={busy}
                className="opacity-50 hover:opacity-100 text-brand transition-opacity"
                title="Saat ekle"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1.5 flex-1">
              {daySlots.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onAddSlot(dow)}
                  disabled={busy}
                  className="w-full text-xs text-muted-foreground/60 italic hover:text-brand hover:bg-muted/30 rounded py-2 transition-colors"
                >
                  + Saat ekle
                </button>
              ) : (
                daySlots.map((s) => (
                  <SlotChip
                    key={s.id}
                    slot={s}
                    onToggle={() => onToggle(s)}
                    onRemove={() => onRemove(s.id)}
                    onEditTime={(h, m) => onEditTime(s, h, m)}
                    busy={busy}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SlotChip({
  slot, onToggle, onRemove, onEditTime, busy,
}: {
  slot: any;
  onToggle: () => void;
  onRemove: () => void;
  onEditTime: (hour: number, minute: number) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(`${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(`${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const m = draft.trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) {
      toast.error('Format HH:MM olmali');
      setEditing(false);
      return;
    }
    onEditTime(parseInt(m[1], 10), parseInt(m[2], 10));
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  return (
    <div
      className={`group rounded-md px-2 py-1.5 text-xs flex items-center justify-between gap-1 transition-colors ${
        slot.isActive
          ? 'bg-brand/10 text-foreground border border-brand/30'
          : 'bg-muted/40 text-muted-foreground border border-transparent'
      }`}
    >
      {editing ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            placeholder="HH:MM"
            disabled={busy}
            className="bg-transparent border-b border-brand/40 outline-none font-mono text-xs w-14 px-1"
          />
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={commit} disabled={busy} className="text-green-600 hover:text-green-700" title="Kaydet">
              <Check className="h-3 w-3" />
            </button>
            <button type="button" onClick={cancel} disabled={busy} className="text-muted-foreground hover:text-foreground" title="Iptal">
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onDoubleClick={startEdit}
            onClick={startEdit}
            disabled={busy}
            className="font-mono text-xs tracking-tight hover:text-brand"
            title="Saati duzenle"
          >
            {String(slot.hour).padStart(2, '0')}:{String(slot.minute).padStart(2, '0')}
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              className={slot.isActive ? 'text-brand' : 'text-muted-foreground'}
              title={slot.isActive ? 'Pasiflestir' : 'Aktiflestir'}
            >
              {slot.isActive ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="text-red-500"
              title="Sil"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
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
  const [showPreview, setShowPreview] = useState(false);

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

  const channelType = post.channel?.type;
  const channelLabel = (() => {
    if (channelType === 'X_TWITTER') return 'X';
    if (channelType === 'LINKEDIN_PERSONAL') return 'LinkedIn';
    if (channelType === 'LINKEDIN_COMPANY') return 'LinkedIn Sirket';
    return channelType ?? 'Kanal';
  })();

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowPreview((v) => !v)}
            title="Onizleme"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {post.externalUrl ? (
            <a
              href={post.externalUrl}
              target="_blank"
              rel="noopener"
              className="text-xs text-brand hover:underline px-2"
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
      </div>

      {showPreview && (
        <div className="mt-3">
          <SocialPostPreview post={post} channelType={channelType} />
        </div>
      )}
    </li>
  );
}

// ─── Sosyal medya post onizleme (X/LinkedIn gorunumu) ────────────────

function SocialPostPreview({ post, channelType }: { post: any; channelType?: string }) {
  const username = post.channel?.externalName ?? '@kullanici';
  const displayName = post.channel?.config?.displayName ?? post.channel?.name ?? 'LuviHost';
  const avatar = post.channel?.externalAvatar;
  const charCount = post.text?.length ?? 0;
  const limit = channelType === 'X_TWITTER' ? 280 : 3000;
  const overLimit = charCount > limit;

  // Metni hashtag/link/mention vurgulu render et
  const renderText = (text: string) => {
    const parts = text.split(/(\s+)/);
    return parts.map((p, i) => {
      if (/^#\w+/.test(p)) return <span key={i} className="text-[#1d9bf0]">{p}</span>;
      if (/^@\w+/.test(p)) return <span key={i} className="text-[#1d9bf0]">{p}</span>;
      if (/^https?:\/\//.test(p)) return <span key={i} className="text-[#1d9bf0]">{p}</span>;
      return <span key={i}>{p}</span>;
    });
  };

  if (channelType === 'X_TWITTER') {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-4 max-w-[560px]">
        <div className="flex gap-3">
          <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0 grid place-items-center">
            {avatar ? (
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-zinc-500">{displayName.charAt(0)}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 text-sm">
              <span className="font-bold text-zinc-900 dark:text-zinc-100">{displayName}</span>
              <span className="text-zinc-500">{username}</span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-500 text-xs">simdi</span>
            </div>
            <div className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100 break-words">
              {renderText(post.text ?? '')}
            </div>
            {Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0 && (
              <div className="mt-3 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <img src={post.mediaUrls[0]} alt="" className="w-full max-h-80 object-cover" />
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>X Onizleme</span>
              <span className={overLimit ? 'text-red-500 font-semibold' : ''}>
                {charCount}/{limit}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LinkedIn / diger
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 max-w-[560px]">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-12 w-12 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0 grid place-items-center">
          {avatar ? (
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-zinc-500">{displayName.charAt(0)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{displayName}</div>
          <div className="text-xs text-zinc-500">simdi · LinkedIn</div>
        </div>
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100 break-words">
        {renderText(post.text ?? '')}
      </div>
      {Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0 && (
        <div className="mt-3 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-800">
          <img src={post.mediaUrls[0]} alt="" className="w-full max-h-80 object-cover" />
        </div>
      )}
      <div className="mt-3 text-xs text-zinc-500 flex items-center justify-between">
        <span>LinkedIn Onizleme</span>
        <span className={overLimit ? 'text-red-500 font-semibold' : ''}>
          {charCount}/{limit}
        </span>
      </div>
    </div>
  );
}
