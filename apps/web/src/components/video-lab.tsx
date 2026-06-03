'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Film, Mic, Wand2, Bot, Layers, Loader2,
  CheckCircle2, AlertCircle, Play, Trash2, ExternalLink,
  CalendarPlus, Send, X, Share2, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CreateSocialPostModal } from '@/components/create-social-post-modal';

type Provider = {
  key: 'SLIDESHOW' | 'VEO' | 'RUNWAY' | 'HEYGEN' | 'SORA';
  label: string;
  description: string;
  estTime: string;
  costBand: string;
  quality: number;
  requiredEnvKeys: string[];
  ready: boolean;
  note?: string;
  bestFor?: string[];
};

type Video = {
  id: string;
  title: string;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'PUBLISHED';
  provider: string;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  errorMsg?: string | null;
  costUsd?: number | null;
  createdAt: string;
  description?: string | null;
  scriptText?: string | null;
};

type SocialChannel = {
  id: string;
  type: string;          // YOUTUBE, TIKTOK, LINKEDIN_PERSONAL, vb.
  externalName?: string | null;
  isActive?: boolean;
};

type ScheduleMode = 'now' | 'later' | 'draft';

const VIDEO_FRIENDLY_CHANNEL_TYPES = new Set([
  'YOUTUBE',
  'TIKTOK',
  'INSTAGRAM_BUSINESS',
  'FACEBOOK_PAGE',
  'LINKEDIN_PERSONAL',
  'LINKEDIN_COMPANY',
]);

const PROVIDER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  SLIDESHOW: Layers,
  VEO: Sparkles,
  RUNWAY: Film,
  HEYGEN: Bot,
  SORA: Wand2,
};

const QUALITY_DOTS = (n: number) =>
  Array.from({ length: 5 }, (_, i) => (
    <span
      key={i}
      className={cn('h-1.5 w-1.5 rounded-full', i < n ? 'bg-brand' : 'bg-muted-foreground/20')}
    />
  ));

export function VideoLab({ siteId }: { siteId: string }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<Provider['key'] | null>(null);
  const [providersExpanded, setProvidersExpanded] = useState(true);
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [aspect, setAspect] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [duration, setDuration] = useState(30);

  // ── Takvime ekle / yayınla state ─────────────────────────
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [shareVideoUrl, setShareVideoUrl] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('later');
  const [scheduleChannelId, setScheduleChannelId] = useState<string>('');
  const [scheduleText, setScheduleText] = useState<string>('');
  const [scheduleAt, setScheduleAt] = useState<string>(''); // datetime-local "YYYY-MM-DDTHH:mm"
  const [scheduling, setScheduling] = useState(false);

  const refresh = async () => {
    try {
      const [pList, vList, cList] = await Promise.all([
        api.listVideoProviders().catch(() => []),
        api.listVideos(siteId).catch(() => []),
        api.listSocialChannels(siteId).catch(() => []),
      ]);
      setProviders(pList);
      setVideos(vList);
      setChannels(cList as SocialChannel[]);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Generating videolar var ise her 8sn'de bir refresh et
    const id = setInterval(() => {
      setVideos((curr) => {
        const hasActive = curr.some((v) => v.status === 'PENDING' || v.status === 'GENERATING');
        if (hasActive) refresh();
        return curr;
      });
    }, 8000);
    return () => clearInterval(id);
  }, [siteId]);

  const submit = async () => {
    if (!picked) { toast.error('Önce bir provider seç'); return; }
    if (!title.trim()) { toast.error('Başlık gerekli'); return; }
    if (scriptText.trim().length < 30) { toast.error('Senaryo en az 30 karakter olmalı'); return; }
    setCreating(true);
    try {
      await api.createVideo(siteId, {
        title: title.trim(),
        scriptText: scriptText.trim(),
        provider: picked,
        durationSec: duration,
        aspectRatio: aspect,
        language: 'tr',
      });
      toast.success('Video üretimi kuyruğa alındı — birkaç dakika içinde hazır');
      setTitle('');
      setScriptText('');
      setPicked(null);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const removeVideo = async (id: string) => {
    if (!confirm('Bu videoyu sil?')) return;
    try {
      await api.deleteVideo(id);
      toast.success('Video silindi');
      refresh();
    } catch (err: any) { toast.error(err.message); }
  };

  // ── Takvime ekle akışı ──────────────────────────────────
  /** Modal'i ac + varsayilan degerleri o video'ya gore set et */
  const openScheduler = (v: Video) => {
    const eligible = channels.filter(
      (c) => c.isActive !== false && VIDEO_FRIENDLY_CHANNEL_TYPES.has(c.type),
    );
    if (eligible.length === 0) {
      toast.error('Once Sosyal Kanallar adimindan bir kanal bagla (YouTube, TikTok, LinkedIn vb).');
      return;
    }
    setSchedulingId(v.id);
    setScheduleMode('later');
    setScheduleChannelId(eligible[0].id);
    setScheduleText(buildDefaultPostText(v));
    // Default 1 saat sonra
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    setScheduleAt(
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    );
  };

  const closeScheduler = () => {
    setSchedulingId(null);
    setScheduleText('');
    setScheduleAt('');
  };

  const submitSchedule = async (video: Video) => {
    if (!scheduleChannelId) { toast.error('Kanal sec'); return; }
    if (!scheduleText.trim()) { toast.error('Metin bos olamaz'); return; }
    if (!video.videoUrl) { toast.error('Video URL yok — tekrar uretmen gerekebilir'); return; }
    let scheduledFor: string | null = null;
    let status: 'DRAFT' | 'QUEUED' = 'QUEUED';
    if (scheduleMode === 'later') {
      if (!scheduleAt) { toast.error('Tarih+saat sec'); return; }
      const d = new Date(scheduleAt);
      if (isNaN(d.getTime())) { toast.error('Gecersiz tarih'); return; }
      if (d.getTime() < Date.now() - 60_000) { toast.error('Gecmis bir tarih secemezsin'); return; }
      scheduledFor = d.toISOString();
    } else if (scheduleMode === 'draft') {
      status = 'DRAFT';
    }
    setScheduling(true);
    try {
      const created = await api.createSocialPost({
        channelId: scheduleChannelId,
        text: scheduleText.trim(),
        mediaUrls: [{ url: video.videoUrl, type: 'video' }],
        scheduledFor,
        status,
      });
      if (scheduleMode === 'now') {
        // QUEUED + scheduledFor=null + publish-now ile hemen yayinla
        await api.publishSocialPostNow(created.id);
        toast.success('Video yayınlandı');
      } else if (scheduleMode === 'later') {
        const when = new Date(scheduledFor!).toLocaleString('tr-TR');
        toast.success(`Takvime eklendi: ${when}`);
      } else {
        toast.success('Taslak olarak kaydedildi');
      }
      closeScheduler();
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setScheduling(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-sm text-muted-foreground font-mono">Video factory yükleniyor…</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Film className="h-3.5 w-3.5 text-brand" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand font-semibold">
            Video Factory · 5 sağlayıcı
          </span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Video Üret</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Senaryonu yapıştır — istediğin sağlayıcı seç — üretim arka planda. TikTok / YouTube Shorts / Reels formatında 9:16.
        </p>
      </div>

      {/* İki kolonlu layout: sol panel üretim formu, sağ panel kütüphane */}
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        {/* Sol panel: provider seçimi + form */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1.5 block">AI Sağlayıcı</label>
            <div className="space-y-1.5">
              {(providersExpanded ? providers : providers.filter((p) => p.key === picked)).map((p) => {
                const Icon = PROVIDER_ICON[p.key] ?? Sparkles;
                const isPicked = picked === p.key;
                const isCollapsedPickedRow = isPicked && !providersExpanded;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      if (!p.ready) return;
                      // Seçili karta tıkla: liste açık/kapalı toggle
                      if (isPicked) {
                        setProvidersExpanded((v) => !v);
                        return;
                      }
                      // Farklı bir provider seçildi: değiştir + daralt
                      setPicked(p.key);
                      setProvidersExpanded(false);
                    }}
                    disabled={!p.ready}
                    title={isCollapsedPickedRow ? 'Tıkla: başka sağlayıcı seç' : isPicked ? 'Tıkla: daralt' : ''}
                    className={cn(
                      'w-full text-left p-2.5 rounded-lg border text-xs transition-colors',
                      isPicked && p.ready
                        ? 'border-brand bg-brand/5'
                        : p.ready
                          ? 'border-border hover:bg-muted'
                          : 'border-dashed border-border/60 opacity-50 cursor-not-allowed',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', isPicked ? 'text-brand' : 'text-foreground/70')} />
                        <span className="font-semibold truncate">{p.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono text-muted-foreground">{p.costBand}</span>
                        {isCollapsedPickedRow && (
                          <span className="text-[10px] text-brand">▾</span>
                        )}
                        {isPicked && providersExpanded && (
                          <span className="text-[10px] text-brand">▴</span>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{p.description}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[9px] font-mono text-muted-foreground">{p.estTime}</span>
                      <span className="opacity-30 text-[9px]">·</span>
                      <div className="flex items-center gap-0.5">{QUALITY_DOTS(p.quality)}</div>
                      {!p.ready && (
                        <span className="ml-auto text-[9px] text-amber-600 dark:text-amber-400">KEY GEREK</span>
                      )}
                    </div>
                    {!p.ready && p.note && (
                      <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400 leading-snug line-clamp-2">
                        ⚠ {p.note}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {picked ? (
            <div className="space-y-3 pt-2 border-t">
              <div>
                <label className="block text-xs font-medium mb-1.5">Başlık</label>
                <Input
                  placeholder="Örn: Shared hosting nedir? 60 saniyede"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5">Senaryo / Anlatım metni</label>
                <textarea
                  rows={5}
                  placeholder="TTS bunu seslendirecek. Slideshow için her cümle bir sahne olur."
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
                />
                <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                  {scriptText.trim().length} karakter · ~{Math.ceil(scriptText.trim().split(/\s+/).filter(Boolean).length / 2.5)}sn TTS
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1.5">Aspect</label>
                  <div className="flex gap-1">
                    {(['9:16', '1:1', '16:9'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAspect(a)}
                        className={cn(
                          'flex-1 px-2 py-1.5 rounded-md border text-[11px] font-mono transition-colors',
                          aspect === a ? 'bg-brand text-white border-brand' : 'bg-card hover:border-brand/40',
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">Süre (sn)</label>
                  <Input
                    type="number"
                    min={5}
                    max={120}
                    value={duration}
                    onChange={(e) => setDuration(Math.max(5, Math.min(120, parseInt(e.target.value) || 30)))}
                  />
                </div>
              </div>

              <Button onClick={submit} disabled={creating} className="w-full">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                {creating ? 'Kuyrukta…' : 'Video Üret'}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Önce yukarıdan bir AI sağlayıcı seç
            </div>
          )}
        </div>

        {/* Sağ panel: kütüphane (Son Videolar) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Kütüphane <span className="text-xs font-normal text-muted-foreground">({videos.length})</span></h3>
            <div className="flex gap-1.5">
              <button onClick={refresh} className="h-7 w-7 grid place-items-center rounded hover:bg-muted" title="Yenile">
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>
        {videos.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
            <Film className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">Henüz video yok</p>
            <p className="text-xs text-muted-foreground">Soldaki formu doldurup üret. Üretilenler kalıcı kaydedilir.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <div key={v.id} className="rounded-lg border bg-card overflow-hidden">
                <div className="p-3 flex items-center gap-3">
                  <div className="shrink-0 h-12 w-12 rounded bg-muted grid place-items-center">
                    {v.thumbnailUrl ? (
                      <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover rounded" />
                    ) : (
                      <Film className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{v.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground font-mono uppercase">
                      <span>{v.provider}</span>
                      <span className="opacity-30">·</span>
                      <StatusBadge status={v.status} />
                      {v.durationSec && (
                        <>
                          <span className="opacity-30">·</span>
                          <span>{v.durationSec}sn</span>
                        </>
                      )}
                    </div>
                    {v.status === 'FAILED' && v.errorMsg && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 line-clamp-2">{v.errorMsg}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {v.status === 'READY' && v.videoUrl && (
                      <>
                        <button
                          onClick={() => v.videoUrl && setShareVideoUrl(v.videoUrl)}
                          className="h-8 px-2 inline-flex items-center gap-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors bg-gradient-to-br from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700"
                          title="Çoklu kanal paylaşımı"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Paylaş</span>
                        </button>
                        <button
                          onClick={() => (schedulingId === v.id ? closeScheduler() : openScheduler(v))}
                          className={cn(
                            'h-8 px-2 inline-flex items-center gap-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors',
                            schedulingId === v.id
                              ? 'bg-brand text-white'
                              : 'bg-brand/10 text-brand hover:bg-brand/20',
                          )}
                          title="Tek kanala takvime ekle (legacy)"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Tek Kanal</span>
                        </button>
                      </>
                    )}
                    {v.videoUrl && (
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="h-8 w-8 grid place-items-center rounded hover:bg-muted text-foreground/70"
                        title="Aç"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      onClick={() => removeVideo(v.id)}
                      className="h-8 w-8 grid place-items-center rounded hover:bg-red-500/10 text-red-500"
                      title="Sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {schedulingId === v.id && (
                  <SchedulePanel
                    video={v}
                    channels={channels.filter(
                      (c) => c.isActive !== false && VIDEO_FRIENDLY_CHANNEL_TYPES.has(c.type),
                    )}
                    mode={scheduleMode}
                    setMode={setScheduleMode}
                    channelId={scheduleChannelId}
                    setChannelId={setScheduleChannelId}
                    text={scheduleText}
                    setText={setScheduleText}
                    scheduleAt={scheduleAt}
                    setScheduleAt={setScheduleAt}
                    submitting={scheduling}
                    onSubmit={() => submitSchedule(v)}
                    onClose={closeScheduler}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {shareVideoUrl && (
        <CreateSocialPostModal
          siteId={siteId}
          initialAsset={{ url: shareVideoUrl, type: 'video' }}
          onClose={() => setShareVideoUrl(null)}
        />
      )}
    </div>
  );
}

/**
 * Video icin varsayilan post metni: baslik + senaryo'nun ilk 200 char ozeti.
 * Pexels atfi yayin aninda runPublish tarafindan otomatik append edilir.
 */
function buildDefaultPostText(v: Video): string {
  const title = v.title?.trim() ?? '';
  const script = v.scriptText?.trim() ?? '';
  if (!script) return title;
  const summary = script.length > 200 ? script.slice(0, 197).trim() + '…' : script;
  return title ? `${title}\n\n${summary}` : summary;
}

const CHANNEL_LABEL: Record<string, string> = {
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  INSTAGRAM_BUSINESS: 'Instagram',
  FACEBOOK_PAGE: 'Facebook',
  LINKEDIN_PERSONAL: 'LinkedIn',
  LINKEDIN_COMPANY: 'LinkedIn (Sirket)',
};

function SchedulePanel({
  video,
  channels,
  mode,
  setMode,
  channelId,
  setChannelId,
  text,
  setText,
  scheduleAt,
  setScheduleAt,
  submitting,
  onSubmit,
  onClose,
}: {
  video: Video;
  channels: SocialChannel[];
  mode: ScheduleMode;
  setMode: (m: ScheduleMode) => void;
  channelId: string;
  setChannelId: (id: string) => void;
  text: string;
  setText: (s: string) => void;
  scheduleAt: string;
  setScheduleAt: (s: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  // datetime-local input için min = şu an
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const minDt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <div className="border-t bg-muted/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-brand" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-brand font-semibold">
            Takvime Ekle
          </span>
        </div>
        <button
          onClick={onClose}
          className="h-7 w-7 grid place-items-center rounded hover:bg-muted text-foreground/70"
          title="Kapat"
          disabled={submitting}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1">
        {([
          { key: 'now', label: 'Şimdi yayınla', icon: Send },
          { key: 'later', label: 'Belirli zamanda', icon: CalendarPlus },
          { key: 'draft', label: 'Taslak kaydet', icon: Film },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            disabled={submitting}
            className={cn(
              'h-9 inline-flex items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors',
              mode === key
                ? 'bg-brand text-white shadow-sm'
                : 'text-foreground/70 hover:bg-muted',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Kanal seç */}
      <div>
        <label className="text-xs font-medium text-foreground/80">Kanal</label>
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          disabled={submitting}
          className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {CHANNEL_LABEL[c.type] ?? c.type}
              {c.externalName ? ` — ${c.externalName}` : ''}
            </option>
          ))}
        </select>

      </div>

      {/* Yayın tarihi (sadece later modda) */}
      {mode === 'later' && (
        <div>
          <label className="text-xs font-medium text-foreground/80">Yayın tarihi ve saati</label>
          <Input
            type="datetime-local"
            value={scheduleAt}
            min={minDt}
            onChange={(e) => setScheduleAt(e.target.value)}
            disabled={submitting}
            className="mt-1"
          />
          <p className="mt-1 text-[10px] text-muted-foreground font-mono">
            Cron her dakika kontrol eder; seçilen saat geldiğinde otomatik yayınlanır.
          </p>
        </div>
      )}

      {/* Yayın metni */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-foreground/80">Yayın metni</label>
          <span className="text-[10px] text-muted-foreground font-mono">{text.length} karakter</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={submitting}
          rows={4}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand/40"
          placeholder="Yayın altına gidecek metin"
        />
        <p className="mt-1 text-[10px] text-muted-foreground font-mono">
          Pexels atfı yayın anında otomatik eklenir; sen sadece esas metnini yaz.
        </p>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" onClick={onClose} disabled={submitting} size="sm">
          İptal
        </Button>
        <Button onClick={onSubmit} disabled={submitting || !channelId} size="sm">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          {mode === 'now' && 'Şimdi yayınla'}
          {mode === 'later' && 'Takvime ekle'}
          {mode === 'draft' && 'Taslak kaydet'}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Video['status'] }) {
  if (status === 'READY') {
    return <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> HAZIR</span>;
  }
  if (status === 'PUBLISHED') {
    return <span className="text-blue-600 dark:text-blue-400 inline-flex items-center gap-1"><Play className="h-3 w-3" /> YAYINDA</span>;
  }
  if (status === 'FAILED') {
    return <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> HATA</span>;
  }
  if (status === 'GENERATING') {
    return <span className="text-brand inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> ÜRETİLİYOR</span>;
  }
  return <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="h-3 w-3" /> KUYRUKTA</span>;
}
