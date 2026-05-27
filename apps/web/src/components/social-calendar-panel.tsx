'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2, FileText, Image as ImageIcon,
  Loader2, Send, Sparkles, Type, Video, AlertCircle, RefreshCw,
  Plus, X, Upload, Zap, ZapOff, Trash2, Film, ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

// Video gerektiren kanallar — composer'da AI üretimi desteklenmiyor (Video Factory'i kullan)
const VIDEO_REQUIRED_CHANNELS = new Set(['TIKTOK', 'YOUTUBE']);

type MediaType = 'text' | 'image' | 'video';
type MediaGenStatus = 'pending' | 'generating' | 'ready' | 'error';

interface SocialPost {
  id: string;
  channelId: string;
  articleId: string | null;
  text: string;
  mediaUrls: Array<{ url: string; type: 'image' | 'video'; altText?: string }> | null;
  metadata: any;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
  channel: { type: string; name: string; externalName?: string; externalAvatar?: string };
  article?: { title: string; slug: string } | null;
}

interface SocialChannel {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  externalName?: string;
  externalAvatar?: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  INSTAGRAM_BUSINESS: 'Instagram',
  FACEBOOK_PAGE: 'Facebook',
  X_TWITTER: 'X (Twitter)',
  LINKEDIN_PERSONAL: 'LinkedIn',
  LINKEDIN_COMPANY: 'LinkedIn Company',
  THREADS: 'Threads',
  BLUESKY: 'Bluesky',
  PINTEREST: 'Pinterest',
  GMB: 'Google Business',
  MASTODON: 'Mastodon',
};

const MEDIA_ICON: Record<MediaType, any> = { text: Type, image: ImageIcon, video: Video };

function groupKeyFor(post: SocialPost): string {
  if (post.articleId) return `article:${post.articleId}`;
  const cid = post.metadata?.campaignId;
  if (cid) return `campaign:${cid}`;
  return `single:${post.id}`;
}

function groupTitleFor(post: SocialPost): string {
  if (post.article?.title) return post.article.title;
  if (post.metadata?.campaignTitle) return post.metadata.campaignTitle;
  return post.text.slice(0, 60).replace(/\n+/g, ' ');
}

function groupSourceLabel(post: SocialPost): string {
  if (post.articleId) return 'Makale';
  if (post.metadata?.sourceType === 'composer') return 'AI Kampanya';
  return 'Manuel';
}

// ─────────────────────────────────────────────────────
//  Composer Modal
// ─────────────────────────────────────────────────────

function ComposerModal({
  open, onClose, siteId, channels, autopilot, onCreated, preset,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  channels: SocialChannel[];
  autopilot: boolean;
  onCreated: () => void;
  // Studio'dan gelen hazır görsel/video URL + ön doldurulmuş prompt
  preset?: { prompt?: string; mediaUrl?: string; mediaType?: 'image' | 'video' };
}) {
  const [prompt, setPrompt] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [mediaMode, setMediaMode] = useState<'auto' | 'upload' | 'none'>('auto');
  const [file, setFile] = useState<File | null>(null);
  // Studio'dan gelen URL — file yerine direkt sharedMediaUrls için
  const [presetMedia, setPresetMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      // Preset image ise video kanalları (TikTok/YouTube) seçilmemiş olarak başlat —
      // çünkü görsel video kanallarda yayınlanamaz, kullanıcı zorla deselect etmesin.
      const presetIsImageOnly = preset?.mediaUrl && (preset.mediaType ?? 'image') === 'image';
      const eligibleChannels = presetIsImageOnly
        ? channels.filter(c => c.isActive && !VIDEO_REQUIRED_CHANNELS.has(c.type))
        : channels.filter(c => c.isActive);
      setSelectedChannelIds(eligibleChannels.map(c => c.id));

      // preset varsa form'u önceden doldur
      if (preset?.prompt) setPrompt(preset.prompt);
      if (preset?.mediaUrl) {
        setPresetMedia({ url: preset.mediaUrl, type: preset.mediaType ?? 'image' });
        setMediaMode('upload');
      }
    } else {
      setPrompt(''); setFile(null); setPresetMedia(null); setMediaMode('auto');
      setScheduleMode('now'); setScheduledFor('');
    }
  }, [open, channels, preset?.prompt, preset?.mediaUrl, preset?.mediaType]);

  if (!open) return null;

  const activeChannels = channels.filter(c => c.isActive);
  const toggleChannel = (id: string) => {
    setSelectedChannelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSubmit = async () => {
    if (prompt.trim().length < 10) {
      toast.error('Konu en az 10 karakter olmalı');
      return;
    }
    if (selectedChannelIds.length === 0) {
      toast.error('En az 1 kanal seç');
      return;
    }
    setBusy(true);
    try {
      let sharedMediaUrls: Array<{ url: string; type: 'image' | 'video' }> | undefined;
      if (mediaMode === 'upload') {
        if (presetMedia) {
          // Studio'dan gelen hazır URL — yeniden upload etmeye gerek yok
          sharedMediaUrls = [{ url: presetMedia.url, type: presetMedia.type }];
        } else if (file) {
          const uploaded = await api.uploadSocialMedia(siteId, file);
          sharedMediaUrls = [{ url: uploaded.url, type: uploaded.type }];
        } else {
          toast.error('Bir dosya seç veya farklı mod kullan');
          setBusy(false); return;
        }
      }
      const r = await api.createSocialCampaign(siteId, {
        prompt: prompt.trim(),
        channelIds: selectedChannelIds,
        autoMedia: mediaMode === 'auto',
        sharedMediaUrls,
        scheduledFor: scheduleMode === 'later' && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      const queued = r.drafts.filter(d => d.status === 'QUEUED').length;
      const draftCount = r.drafts.length - queued;
      const skippedCount = (r as any).skipped?.length ?? 0;
      const parts: string[] = [];
      if (queued > 0) parts.push(`${queued} yayına gönderildi`);
      if (draftCount > 0) parts.push(`${draftCount} taslak`);
      if (skippedCount > 0) parts.push(`${skippedCount} atlandı (video yok)`);
      const msg = parts.join(' · ');
      if (queued > 0) toast.success(msg + ' (~5 dk içinde yayında)');
      else if (draftCount > 0) toast.info(msg + ' — medyayı üret/yükle, sonra Yayınla');
      else toast.warning(msg);
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Kampanya oluşturulamadı');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-card border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-brand/10 text-brand grid place-items-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Yeni Sosyal İçerik</h3>
              <p className="text-[11px] text-muted-foreground">AI ile birden fazla kanal için tek seferde üret</p>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Prompt */}
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Konu / Mesaj</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Örn: 2026 konut kredisi faiz oranları düşüyor — müşterilerimize avantajlı dönemi anlatıyoruz"
              className="w-full min-h-24 px-3 py-2 rounded border bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              AI her kanal için tonunu (kısa/uzun/hashtag) otomatik adapte eder.
            </p>
          </div>

          {/* Channels */}
          <div>
            <label className="text-sm font-semibold mb-1.5 block">
              Kanallar ({selectedChannelIds.length}/{activeChannels.length})
            </label>
            {activeChannels.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300 p-3 rounded flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold mb-0.5">Aktif sosyal kanal yok</p>
                  <p>Yayın yapabilmek için en az bir kanal bağlamalısın (X, Instagram, TikTok, LinkedIn, YouTube...).</p>
                </div>
                <Link
                  href={`/sites/${siteId}/publish-targets`}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                >
                  Kanal Bağla <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {activeChannels.map(c => {
                  const on = selectedChannelIds.includes(c.id);
                  // Video kanal + dosya yüklü değil = disabled (AI ile video üretemiyoruz)
                  const isVideoChannel = VIDEO_REQUIRED_CHANNELS.has(c.type);
                  const fileIsVideo = file && file.type.startsWith('video/');
                  const presetIsVideo = presetMedia?.type === 'video';
                  const hasVideoMedia = (mediaMode === 'upload' && fileIsVideo) || presetIsVideo;
                  const blocked = isVideoChannel && !hasVideoMedia;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        // Blocked + seçili değilse → seçtirme + uyarı
                        if (blocked && !on) {
                          toast.error(`${CHANNEL_LABELS[c.type]} video gerektiriyor. Video Factory'de mp4 üret, "Dosya Yükle" moduna geç ve videoyu yükle.`);
                          return;
                        }
                        // Blocked + seçili = kaldırılmasına izin ver (kullanıcı deselect ediyor)
                        toggleChannel(c.id);
                      }}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                        on
                          ? blocked
                            ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                            : 'bg-brand text-white border-brand'
                          : blocked
                            ? 'bg-muted/40 text-muted-foreground/60 border-dashed hover:bg-muted/60'
                            : 'bg-background hover:bg-muted border-border'
                      }`}
                      title={
                        blocked && on ? 'Tıkla → kaldır (medya yok, yayınlanamaz)'
                        : blocked ? 'Video gerekli — Video Factory\'i kullan'
                        : on ? 'Tıkla → kaldır'
                        : 'Tıkla → ekle'
                      }
                    >
                      {on ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
                      {CHANNEL_LABELS[c.type] ?? c.type}
                      {isVideoChannel && <Video className="h-3 w-3 opacity-60" />}
                      <span className="opacity-60 text-[10px]">· {c.externalName || c.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Mevcut seçimde blocklu kanal var ise net uyarı */}
            {(() => {
              const hasVideoMedia = (mediaMode === 'upload' && file && file.type.startsWith('video/')) || presetMedia?.type === 'video';
              const blockedSelected = activeChannels.filter(c =>
                selectedChannelIds.includes(c.id) &&
                VIDEO_REQUIRED_CHANNELS.has(c.type) &&
                !hasVideoMedia
              );
              if (blockedSelected.length === 0) return null;
              return (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2">
                  ⚠️ <strong>{blockedSelected.map(c => CHANNEL_LABELS[c.type]).join(' + ')}</strong> medya yok — bu kanal{blockedSelected.length > 1 ? 'lar' : ''} <em>atlanacak</em>. Yayınlamak için Video Factory'de mp4 üret + "Dosya Yükle" moduna geç.
                </div>
              );
            })()}
          </div>

          {/* Media mode */}
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Görsel / Video</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'auto' as const, icon: Sparkles, label: 'AI Üretsin', desc: 'Her kanal için otomatik' },
                { key: 'upload' as const, icon: Upload, label: 'Dosya Yükle', desc: 'Kendi resmin/videon' },
                { key: 'none' as const, icon: Type, label: 'Sadece Metin', desc: 'Görsel yok' },
              ].map(opt => {
                const Icon = opt.icon;
                const on = mediaMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setMediaMode(opt.key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      on ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <Icon className={`h-4 w-4 mb-1.5 ${on ? 'text-brand' : 'text-muted-foreground'}`} />
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            {mediaMode === 'upload' && (
              <div className="mt-3 space-y-2">
                {presetMedia ? (
                  <div className="rounded-lg border bg-card p-2 flex items-center gap-2">
                    {presetMedia.type === 'image' ? (
                      <img src={presetMedia.url} alt="" className="h-16 w-16 rounded object-cover shrink-0" />
                    ) : (
                      <video src={presetMedia.url} className="h-16 w-16 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">Studio'dan {presetMedia.type === 'image' ? 'görsel' : 'video'}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{presetMedia.url}</p>
                    </div>
                    <button
                      onClick={() => setPresetMedia(null)}
                      className="text-[10px] text-rose-600 hover:underline"
                    >
                      Kaldır
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={e => setFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-muted file:text-foreground file:text-xs file:font-medium hover:file:bg-muted/70"
                    />
                    {file && (
                      <p className="text-[11px] text-muted-foreground">
                        {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Video-gerektiren kanal seçildiyse uyarı */}
            {(() => {
              const videoChannels = activeChannels.filter(c =>
                selectedChannelIds.includes(c.id) && VIDEO_REQUIRED_CHANNELS.has(c.type)
              );
              if (videoChannels.length === 0) return null;
              const isUploadMode = mediaMode === 'upload';
              const fileIsVideo = file && file.type.startsWith('video/');
              const okWithUpload = isUploadMode && fileIsVideo;
              if (okWithUpload) return null;
              return (
                <div className="mt-3 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-3 text-xs flex items-start gap-2">
                  <Film className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div>
                      <strong>{videoChannels.map(c => CHANNEL_LABELS[c.type]).join(' + ')}</strong> video gerektiriyor.
                      Composer'da AI video üretimi yok — iki seçeneğin var:
                    </div>
                    <ul className="list-disc list-inside text-[11px] space-y-0.5 ml-1 text-muted-foreground">
                      <li><strong>Dosya Yükle</strong> moduna geç ve hazır .mp4 yükle</li>
                      <li><strong>Video Factory</strong>'de premium AI video üret, sonra buradan yükle</li>
                    </ul>
                    <Link
                      href={`/sites/${siteId}/videos`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:underline"
                    >
                      Video Factory'i aç <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Schedule */}
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Zamanlama</label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setScheduleMode('now')}
                className={`flex-1 px-3 py-2 rounded border text-xs font-medium ${
                  scheduleMode === 'now' ? 'border-brand bg-brand/5' : 'border-border'
                }`}
              >
                {autopilot ? 'Hemen yayınla' : 'Şimdi taslak yarat'}
              </button>
              <button
                onClick={() => setScheduleMode('later')}
                className={`flex-1 px-3 py-2 rounded border text-xs font-medium ${
                  scheduleMode === 'later' ? 'border-brand bg-brand/5' : 'border-border'
                }`}
              >
                Tarih belirle
              </button>
            </div>
            {scheduleMode === 'later' && (
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={e => setScheduledFor(e.target.value)}
                className="w-full px-3 py-2 rounded border bg-background text-sm"
              />
            )}
          </div>

          {/* Autopilot info */}
          <div className={`text-xs p-3 rounded-lg border ${
            autopilot
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300'
              : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-300'
          }`}>
            {autopilot ? (
              <><Zap className="h-3.5 w-3.5 inline mr-1" /> <strong>Tam otomatik mod açık:</strong> İçerik üretildikten sonra direkt yayına alınır.</>
            ) : (
              <><ZapOff className="h-3.5 w-3.5 inline mr-1" /> <strong>Yarı otomatik mod:</strong> Üretilenler taslak olarak bekler, sen onaylayınca yayına gider.</>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 p-4 border-t bg-muted/30 sticky bottom-0">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>İptal</Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={busy || activeChannels.length === 0 || selectedChannelIds.length === 0}
              title={
                activeChannels.length === 0 ? 'Önce Yayın Hedefleri menüsünden kanal bağla'
                : selectedChannelIds.length === 0 ? 'Hiç kanal seçilmedi'
                : undefined
              }
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Üretiliyor</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1.5" /> {autopilot ? 'Üret ve Yayınla' : 'Taslakları Oluştur'}</>
              )}
            </Button>
          </div>
          {activeChannels.length === 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 text-center">
              ⚠ Yayınlamak için önce sosyal kanal bağla (yukarıdaki turuncu uyarıda buton var)
            </p>
          )}
          {activeChannels.length > 0 && selectedChannelIds.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center">Yukarıdan en az 1 kanal seç</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Channel Mini Card (group içinde)
// ─────────────────────────────────────────────────────

function ChannelMiniCard({
  post, policy, busy, onGenerateMedia, onApprove, onDelete, onChangeMediaType,
}: {
  post: SocialPost;
  policy: any;
  busy: 'generating' | 'approving' | null;
  onGenerateMedia: (mediaType?: MediaType) => void;
  onApprove: () => void;
  onDelete: () => void;
  onChangeMediaType: (mt: MediaType) => void;
}) {
  const channelType = post.channel.type;
  const channelLabel = CHANNEL_LABELS[channelType] ?? channelType;
  const channelPolicy = policy[channelType] ?? { default: 'text' as MediaType, options: ['text' as MediaType], editable: true };
  const meta = post.metadata ?? {};
  const mediaType: MediaType = (meta.mediaType ?? channelPolicy.default) as MediaType;
  const genStatus: MediaGenStatus = (meta.mediaGenStatus ?? 'pending') as MediaGenStatus;
  const genError: string | undefined = meta.mediaGenError;
  const isGenerating = busy === 'generating' || genStatus === 'generating';
  const isReady = genStatus === 'ready' || (post.mediaUrls && post.mediaUrls.length > 0);
  const isError = genStatus === 'error';
  const mediaUrls = post.mediaUrls ?? [];
  const MediaIcon = MEDIA_ICON[mediaType];

  return (
    <div className="rounded-xl border bg-background flex flex-col min-w-[240px] max-w-[280px] flex-shrink-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-1.5 p-2.5 border-b">
        <div className="flex items-center gap-1.5 min-w-0">
          {post.channel.externalAvatar
            ? <img src={post.channel.externalAvatar} alt="" className="h-6 w-6 rounded-full" />
            : <div className="h-6 w-6 rounded-full bg-muted grid place-items-center text-[10px] font-bold">{channelLabel[0]}</div>
          }
          <div className="min-w-0">
            <div className="text-xs font-bold truncate">{channelLabel}</div>
            <div className="text-[10px] text-muted-foreground truncate">{post.channel.externalName ?? post.channel.name}</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted shrink-0">
          <MediaIcon className="h-2.5 w-2.5" /> {mediaType}
        </span>
      </div>

      {/* Media preview */}
      <div className="border-b bg-muted/30 aspect-square relative">
        {isGenerating ? (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin" />
            Üretiliyor…
          </div>
        ) : isError ? (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-rose-600 gap-1 p-2 text-center">
            <AlertCircle className="h-4 w-4" />
            <div className="line-clamp-2">{genError ?? 'Üretim hatası'}</div>
          </div>
        ) : mediaUrls.length > 0 ? (
          mediaUrls[0].type === 'image' ? (
            <img src={mediaUrls[0].url} alt="" className="w-full h-full object-cover" />
          ) : (
            <video src={mediaUrls[0].url} controls className="w-full h-full object-cover" />
          )
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground gap-1">
            <MediaIcon className="h-5 w-5 opacity-40" />
            {mediaType === 'text' ? 'Sadece metin' : 'Medya yok'}
          </div>
        )}
      </div>

      {/* Text preview */}
      <div className="p-2 text-[11px] whitespace-pre-wrap text-foreground/80 line-clamp-4 flex-1">
        {post.text}
      </div>

      {/* MediaType selector (editable) */}
      {channelPolicy.editable && channelPolicy.options.length > 1 && (
        <div className="flex gap-1 px-2 pb-2">
          {channelPolicy.options.map((opt: MediaType) => {
            const Icon = MEDIA_ICON[opt];
            return (
              <button
                key={opt}
                onClick={() => onChangeMediaType(opt)}
                disabled={!!busy}
                className={`flex-1 flex items-center justify-center gap-0.5 px-1 py-1 rounded text-[10px] font-medium transition-colors ${
                  mediaType === opt
                    ? 'bg-brand text-white'
                    : 'bg-muted hover:bg-muted/70'
                } disabled:opacity-50`}
              >
                <Icon className="h-2.5 w-2.5" /> {opt}
              </button>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1 p-2 border-t bg-muted/20">
        {mediaType !== 'text' && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-[11px] px-2"
            onClick={() => onGenerateMedia()}
            disabled={!!busy || (!post.articleId && mediaType === 'video')}
            title={!post.articleId && mediaType === 'video' ? 'Bu kampanya için video Video Factory\'den üretilmeli (makale bağlı değil)' : undefined}
          >
            {isGenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isReady ? (
              <><RefreshCw className="h-3 w-3 mr-1" /> Yenile</>
            ) : (
              <><Sparkles className="h-3 w-3 mr-1" /> Üret</>
            )}
          </Button>
        )}
        <Button
          size="sm"
          className="flex-1 h-7 text-[11px] px-2"
          onClick={onApprove}
          disabled={!!busy || (mediaType !== 'text' && !isReady)}
          title={mediaType !== 'text' && !isReady ? 'Önce medya' : 'Yayınla'}
        >
          {busy === 'approving' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <><Send className="h-3 w-3 mr-1" /> Yayınla</>
          )}
        </Button>
        <button
          onClick={onDelete}
          disabled={!!busy}
          className="h-7 w-7 grid place-items-center rounded text-muted-foreground hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50"
          title="Sil"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────

export function SocialCalendarPanel({
  site,
  initialPreset,
  onChanged,
  onComposerClose,
}: {
  site: any;
  // Studio kütüphanesinden "Sosyal Medyada Kullan" ile gelirsek composer
  // preset'leri hazır: prompt + image URL otomatik doldurulur.
  initialPreset?: { prompt?: string; mediaUrl?: string; mediaType?: 'image' | 'video' };
  // Yeni post yaratıldığında parent'ı haberdar et (takvim grid'i refetch etsin)
  onChanged?: () => void;
  // Composer modal kapandığında parent URL'den ?composer=... param'larını silsin
  onComposerClose?: () => void;
}) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [policy, setPolicy] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [busyById, setBusyById] = useState<Record<string, 'generating' | 'approving' | null>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  // initialPreset geldiyse composer'ı otomatik aç
  useEffect(() => {
    if (initialPreset && (initialPreset.prompt || initialPreset.mediaUrl)) {
      setComposerOpen(true);
    }
  }, [initialPreset?.prompt, initialPreset?.mediaUrl]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, pol, ch] = await Promise.all([
        api.listSocialPosts(site.id, { status: 'DRAFT' }),
        api.socialMediaPolicy().catch(() => ({})),
        api.listSocialChannels(site.id).catch(() => []),
      ]);
      setPosts(Array.isArray(list) ? list : []);
      setPolicy(pol as any);
      setChannels(Array.isArray(ch) ? ch : []);
    } catch (err: any) {
      toast.error(err.message || 'Yüklenemedi');
    } finally {
      setLoading(false);
    }
    // Parent'a haber ver — takvim grid'indeki QUEUED post'lar da refetch edilsin
    onChanged?.();
  };

  const closeComposer = () => {
    setComposerOpen(false);
    onComposerClose?.();
  };

  useEffect(() => { refresh(); }, [site.id]);

  // Grupları hesapla (article veya campaignId'ye göre)
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; source: string; posts: SocialPost[]; latestAt: number }>();
    for (const p of posts) {
      const key = groupKeyFor(p);
      const ts = new Date((p as any).createdAt ?? Date.now()).getTime();
      if (!map.has(key)) {
        map.set(key, { key, title: groupTitleFor(p), source: groupSourceLabel(p), posts: [], latestAt: ts });
      }
      const g = map.get(key)!;
      g.posts.push(p);
      if (ts > g.latestAt) g.latestAt = ts;
    }
    // En yeni grup üstte
    return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [posts]);

  const handleGenerateMedia = async (post: SocialPost, mediaType?: MediaType) => {
    setBusyById(prev => ({ ...prev, [post.id]: 'generating' }));
    try {
      const r = await api.generateSocialPostMedia(post.id, mediaType);
      if (r.ok) toast.success(`${CHANNEL_LABELS[post.channel.type]}: ${r.mediaType} hazır`);
      else toast.error(`Medya: ${r.error}`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Hata');
    } finally {
      setBusyById(prev => ({ ...prev, [post.id]: null }));
    }
  };

  const handleApprove = async (post: SocialPost) => {
    setBusyById(prev => ({ ...prev, [post.id]: 'approving' }));
    try {
      await api.approveSocialPost(post.id);
      toast.success('Yayına gönderildi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Onay hatası');
    } finally {
      setBusyById(prev => ({ ...prev, [post.id]: null }));
    }
  };

  const handleApproveAll = async (group: typeof groups[number]) => {
    const ready = group.posts.filter(p => {
      const mt = (p.metadata?.mediaType ?? 'text') as MediaType;
      const ok = mt === 'text' || (p.mediaUrls && p.mediaUrls.length > 0) || p.metadata?.mediaGenStatus === 'ready';
      return ok;
    });
    if (ready.length === 0) {
      toast.error('Hiçbir kanal yayına hazır değil (önce medya üret)');
      return;
    }
    toast.info(`${ready.length} kanal yayına gönderiliyor…`);
    await Promise.all(ready.map(p => api.approveSocialPost(p.id).catch(() => null)));
    await refresh();
    toast.success(`${ready.length} kanal yayında`);
  };

  const handleDelete = async (post: SocialPost) => {
    if (!confirm(`${CHANNEL_LABELS[post.channel.type]} taslağı silinsin mi?`)) return;
    try {
      await api.deleteSocialPost(post.id);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Silme hatası');
    }
  };

  const handleDeleteGroup = async (group: { title: string; posts: SocialPost[] }) => {
    if (!confirm(`"${group.title}" kampanyasındaki ${group.posts.length} taslağın tümü silinsin mi?`)) return;
    try {
      await Promise.all(group.posts.map(p => api.deleteSocialPost(p.id).catch(() => null)));
      toast.success(`${group.posts.length} taslak silindi`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Grup silme hatası');
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const r = await api.backfillSocialDrafts(site.id, 30);
      if (r.created > 0) toast.success(`${r.created} yeni draft (${r.articleCount} makale)`);
      else toast.info(`Eksik draft yok (${r.articleCount} makale)`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Backfill hatası');
    } finally {
      setBackfilling(false);
    }
  };

  const autopilot = !!(site as any).autopilot;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section başlığı */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Send className="h-4 w-4" /> Sosyal Medya İçerikleri
            {groups.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({groups.length} kampanya)</span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">AI ile birden fazla kanala tek tıkla içerik üret.</p>
        </div>
        <div className="flex gap-2 items-center">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${
            autopilot
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          }`}>
            {autopilot ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
            {autopilot ? 'Otopilot ON' : 'Manuel onay'}
          </span>
          <Link href={`/sites/${site.id}/videos`}>
            <Button size="sm" variant="outline" title="TikTok / YouTube için premium AI video üret">
              <Film className="h-4 w-4 mr-1" /> Video Factory
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={handleBackfill} disabled={backfilling} title="Son 30 günün makaleleri için eksik kanallara draft üret">
            {backfilling ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Eksik Draft
          </Button>
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-1" /> Yenile
          </Button>
          <Button size="sm" onClick={() => setComposerOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Yeni İçerik
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {groups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-bold mb-1">Taslak yok</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Bir makale yayınlayınca veya buradan "Yeni İçerik" üretince taslaklar burada görünür.
          </p>
          <Button size="sm" onClick={() => setComposerOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> İlk İçeriğini Üret
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            const total = group.posts.length;
            const ready = group.posts.filter(p => {
              const mt = (p.metadata?.mediaType ?? 'text') as MediaType;
              return mt === 'text' || (p.mediaUrls && p.mediaUrls.length > 0) || p.metadata?.mediaGenStatus === 'ready';
            }).length;
            return (
              <div key={group.key} className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 p-4 border-b bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300">
                        {group.source}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {ready}/{total} kanal hazır
                      </span>
                    </div>
                    <h3 className="font-bold truncate">{group.title}</h3>
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApproveAll(group)}
                      disabled={ready === 0}
                      title={ready === 0 ? 'Önce medyaları üret' : 'Tüm hazır kanallara yayınla'}
                    >
                      <Send className="h-4 w-4 mr-1" /> Yayınla ({ready})
                    </Button>
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="h-9 w-9 grid place-items-center rounded-md border text-muted-foreground hover:bg-rose-100 hover:text-rose-600 hover:border-rose-300"
                      title="Bu kampanyayı sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="p-3 overflow-x-auto">
                  <div className="flex gap-3">
                    {group.posts.map(post => (
                      <ChannelMiniCard
                        key={post.id}
                        post={post}
                        policy={policy}
                        busy={busyById[post.id] ?? null}
                        onGenerateMedia={(mt) => handleGenerateMedia(post, mt)}
                        onChangeMediaType={(mt) => handleGenerateMedia(post, mt)}
                        onApprove={() => handleApprove(post)}
                        onDelete={() => handleDelete(post)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ComposerModal
        open={composerOpen}
        onClose={closeComposer}
        siteId={site.id}
        channels={channels}
        autopilot={autopilot}
        onCreated={refresh}
        preset={initialPreset}
      />
    </div>
  );
}
