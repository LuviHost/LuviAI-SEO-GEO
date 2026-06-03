'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  X, Type, Image as ImageIcon, Video, Calendar, Send,
  Loader2, CheckCircle2, Sparkles, Library,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { api } from '@/lib/api';

type MediaType = 'text' | 'image' | 'video';

interface Asset {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT';
  url?: string;
  thumbnailUrl?: string;
  prompt?: string;
  content?: string;
  createdAt: string;
}

// Medya tipine göre uyumlu kanal tipleri (TikTok/YouTube video şart; X/LinkedIn her şeyi alır)
const COMPATIBLE: Record<MediaType, string[]> = {
  text:  ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'THREADS', 'BLUESKY', 'MASTODON'],
  image: ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'INSTAGRAM_BUSINESS', 'FACEBOOK_PAGE', 'PINTEREST', 'THREADS', 'BLUESKY'],
  video: ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'INSTAGRAM_BUSINESS', 'FACEBOOK_PAGE', 'TIKTOK', 'YOUTUBE', 'THREADS'],
};

const CHANNEL_TO_VENDOR: Record<string, VendorName> = {
  LINKEDIN_PERSONAL: 'linkedin',
  LINKEDIN_COMPANY:  'linkedin',
  X_TWITTER:         'twitter',
  FACEBOOK_PAGE:     'facebook',
  INSTAGRAM_BUSINESS:'instagram',
  TIKTOK:            'tiktok',
  YOUTUBE:           'youtube',
  THREADS:           'threads',
  BLUESKY:           'bluesky',
  PINTEREST:         'pinterest',
};

function prettyChannelType(t: string): string {
  switch (t) {
    case 'LINKEDIN_PERSONAL': return 'LinkedIn';
    case 'LINKEDIN_COMPANY': return 'LinkedIn Şirket';
    case 'X_TWITTER': return 'X';
    case 'FACEBOOK_PAGE': return 'Facebook';
    case 'INSTAGRAM_BUSINESS': return 'Instagram';
    case 'TIKTOK': return 'TikTok';
    case 'YOUTUBE': return 'YouTube';
    case 'THREADS': return 'Threads';
    case 'BLUESKY': return 'Bluesky';
    case 'PINTEREST': return 'Pinterest';
    default: return t;
  }
}

type Channel = {
  id: string;
  type: string;
  name: string;
  externalName: string | null;
  externalAvatar: string | null;
  isActive: boolean;
};

export function CreateSocialPostModal({
  siteId,
  initialAsset,
  onClose,
  onSuccess,
}: {
  siteId: string;
  initialAsset?: { url: string; type: 'image' | 'video'; altText?: string };
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [mediaType, setMediaType] = useState<MediaType>(() => {
    if (initialAsset?.type === 'image') return 'image';
    if (initialAsset?.type === 'video') return 'video';
    return 'text';
  });
  const [selectedAsset, setSelectedAsset] = useState<{ url: string; type: 'image' | 'video'; altText?: string } | null>(
    initialAsset ?? null,
  );
  const [text, setText] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('later');
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [submitting, setSubmitting] = useState(false);

  // Aktif kanalları çek
  useEffect(() => {
    let cancelled = false;
    api.listSocialChannels(siteId)
      .then((rows: any) => {
        if (cancelled) return;
        setChannels((rows ?? []).filter((c: Channel) => c.isActive));
      })
      .catch((err: any) => toast.error(`Kanallar yüklenemedi: ${err.message}`))
      .finally(() => { if (!cancelled) setLoadingChannels(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  // Medya tipi değişince ilgili asset'leri çek
  // Image: studio_assets · Video: studio_assets + videos (Video Factory) birleştirilir
  useEffect(() => {
    if (mediaType === 'text') {
      setAssets([]);
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);

    if (mediaType === 'image') {
      (api as any).listStudioAssets?.(siteId, { type: 'IMAGE' })
        .then((rows: any) => { if (!cancelled) setAssets(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (!cancelled) setAssets([]); })
        .finally(() => { if (!cancelled) setLoadingAssets(false); });
    } else {
      Promise.allSettled([
        (api as any).listStudioAssets?.(siteId, { type: 'VIDEO' }),
        (api as any).listVideos?.(siteId),
      ]).then(([assetsRes, vidsRes]: any[]) => {
        if (cancelled) return;
        const studioVids: Asset[] = assetsRes?.status === 'fulfilled' && Array.isArray(assetsRes.value) ? assetsRes.value : [];
        const factoryVids: Asset[] = (vidsRes?.status === 'fulfilled' && Array.isArray(vidsRes.value) ? vidsRes.value : [])
          .filter((v: any) => v?.status === 'READY' && v?.videoUrl)
          .map((v: any) => ({
            id: v.id,
            type: 'VIDEO' as const,
            url: v.videoUrl,
            thumbnailUrl: v.thumbnailUrl,
            prompt: v.title ?? '',
            createdAt: v.createdAt,
          }));
        const seen = new Set<string>();
        const merged = [...factoryVids, ...studioVids].filter((a) => {
          if (!a.url || seen.has(a.url)) return false;
          seen.add(a.url);
          return true;
        });
        setAssets(merged);
      }).finally(() => { if (!cancelled) setLoadingAssets(false); });
    }
    return () => { cancelled = true; };
  }, [siteId, mediaType]);

  // Uyumlu kanalları hesapla — medya tipi değişince seçili olanları temizle
  const compatibleChannels = useMemo(() => {
    const compatTypes = new Set(COMPATIBLE[mediaType]);
    return channels.filter((c) => compatTypes.has(c.type));
  }, [channels, mediaType]);

  useEffect(() => {
    // Medya tipi değişince uyumlu olmayan kanalları seçim listesinden çıkar
    setSelectedChannelIds((prev) => {
      const next = new Set<string>();
      const compatIds = new Set(compatibleChannels.map((c) => c.id));
      for (const id of prev) if (compatIds.has(id)) next.add(id);
      return next;
    });
  }, [mediaType, compatibleChannels]);

  const toggleChannel = (id: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllCompatible = () => setSelectedChannelIds(new Set(compatibleChannels.map((c) => c.id)));
  const clearChannels = () => setSelectedChannelIds(new Set());

  const submit = async () => {
    if (selectedChannelIds.size === 0) {
      toast.error('En az 1 kanal seç');
      return;
    }
    if (!text.trim()) {
      toast.error('Metin yaz');
      return;
    }
    if (mediaType !== 'text' && !selectedAsset) {
      toast.error(mediaType === 'image' ? 'Görsel seç (veya Studio Görsel sekmesinden üret)' : 'Video seç (veya Studio Video sekmesinden üret)');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.createMultiSocialPost(siteId, {
        channelIds: Array.from(selectedChannelIds),
        text: text.trim(),
        mediaUrls: selectedAsset ? [selectedAsset] : [],
        mediaType,
        scheduledFor: scheduleMode === 'now' ? null : new Date(scheduledFor).toISOString(),
        status: scheduleMode === 'now' ? 'QUEUED' : 'DRAFT',
      });

      if (scheduleMode === 'now' && result.postIds?.length) {
        toast.success(`📤 ${result.created} kanal için yayın tetiklendi…`, { duration: 4000 });
        const publishResults = await Promise.allSettled(
          result.postIds.map((postId: string) => api.publishSocialPostNow(postId)),
        );
        const ok = publishResults.filter((r) => r.status === 'fulfilled').length;
        const fail = publishResults.length - ok;
        if (fail === 0) {
          toast.success(`✅ ${ok} kanala yayın gönderildi`, { duration: 6000 });
        } else {
          toast.warning(`⚠ ${ok} başarılı, ${fail} hata — Sosyal Yayın listesine bak`, { duration: 8000 });
        }
      } else {
        toast.success(`✅ ${result.created} kanala taslak oluşturuldu`, { duration: 6000 });
      }
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">Yeni sosyal post</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              İçerik tipi seç → asset/metin yaz → uygun kanallar seç → tarih ver
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {/* 1. İçerik tipi */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              İçerik tipi
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'text' as MediaType, label: 'Sadece metin', icon: Type, desc: 'X · LinkedIn · Threads' },
                { key: 'image' as MediaType, label: 'Görsel', icon: ImageIcon, desc: '+ Instagram · Facebook · Pinterest' },
                { key: 'video' as MediaType, label: 'Video', icon: Video, desc: '+ TikTok · YouTube · Reels' },
              ].map(({ key, label, icon: Icon, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setMediaType(key); if (key === 'text') setSelectedAsset(null); }}
                  className={`px-3 py-3 rounded-lg border text-left transition-all ${
                    mediaType === key
                      ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
                      : 'border-border hover:border-brand/40 bg-card'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Asset seçici (text değilse) */}
          {mediaType !== 'text' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {mediaType === 'image' ? 'Görsel seç' : 'Video seç'}
                </label>
                <a
                  href={`/sites/${siteId}/studio?tab=${mediaType}`}
                  target="_blank"
                  className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Yeni üret
                </a>
              </div>
              {loadingAssets ? (
                <div className="h-32 bg-muted/40 rounded-lg animate-pulse" />
              ) : assets.length === 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-4 text-sm">
                  <p className="font-medium mb-1">Studio kütüphanesinde {mediaType === 'image' ? 'görsel' : 'video'} yok</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Önce Studio'nun <strong>{mediaType === 'image' ? 'Görsel' : 'Video'}</strong> sekmesinden üret, sonra geri dön.
                  </p>
                  <a
                    href={`/sites/${siteId}/studio?tab=${mediaType}`}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    <Library className="h-3 w-3" /> Studio'ya git
                  </a>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
                  {assets.slice(0, 24).map((a) => {
                    const previewUrl = a.thumbnailUrl ?? a.url ?? '';
                    const isSelected = selectedAsset?.url === a.url;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => a.url && setSelectedAsset({ url: a.url, type: mediaType === 'image' ? 'image' : 'video' })}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected ? 'border-brand ring-2 ring-brand/30' : 'border-transparent hover:border-brand/40'
                        }`}
                      >
                        {previewUrl ? (
                          <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted grid place-items-center text-muted-foreground text-xs">
                            {mediaType === 'video' ? '▶' : '🖼'}
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-brand/20 grid place-items-center">
                            <CheckCircle2 className="h-6 w-6 text-brand drop-shadow" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 3. Caption */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Caption / Metin
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                mediaType === 'text'
                  ? 'LinkedIn için profesyonel cümle yazılır, X için 280 char altı sıkıştırılır...'
                  : mediaType === 'image'
                    ? 'Görselin hikayesini anlat — her platforma aynı metin gider'
                    : 'Video açıklaması — her platforma aynı caption gider'
              }
              rows={4}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-y min-h-[80px]"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Aynı metin her seçili kanala kaydedilir. Yayın öncesi <strong>Sosyal Yayın</strong> listesinden
              kanal-spesifik düzenleme yapabilirsin.
            </p>
          </div>

          {/* 4. Kanallar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Kanallar ({mediaType === 'text' ? 'metin destekli' : mediaType === 'image' ? 'görsel destekli' : 'video destekli'})
              </label>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={selectAllCompatible} className="text-brand hover:underline">Hepsi</button>
                <span className="text-muted-foreground">·</span>
                <button onClick={clearChannels} className="text-muted-foreground hover:underline">Hiçbiri</button>
              </div>
            </div>
            {loadingChannels ? (
              <div className="h-20 bg-muted/40 rounded-lg animate-pulse" />
            ) : compatibleChannels.length === 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-3 text-sm">
                <p className="font-medium">Bu medya tipini destekleyen aktif kanal yok</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Önce <strong>Bağlantılar</strong> sayfasından{' '}
                  {mediaType === 'video' ? 'TikTok / YouTube / Instagram' : mediaType === 'image' ? 'Instagram / LinkedIn / X' : 'LinkedIn / X / Threads'}{' '}
                  hesabı bağla.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {compatibleChannels.map((c) => {
                  const selected = selectedChannelIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChannel(c.id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                        selected
                          ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
                          : 'border-border hover:border-brand/40 bg-card'
                      }`}
                    >
                      <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                        selected ? 'border-brand bg-brand text-white' : 'border-border'
                      }`}>
                        {selected && <CheckCircle2 className="h-4 w-4" />}
                      </div>
                      {CHANNEL_TO_VENDOR[c.type] && (
                        <VendorLogo name={CHANNEL_TO_VENDOR[c.type]} size={20} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.externalName ?? c.name}</div>
                        <div className="text-[10px] text-muted-foreground">{prettyChannelType(c.type)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {channels.length > compatibleChannels.length && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                💡 {channels.length - compatibleChannels.length} kanal bu medya tipinde gizlendi (örn. video şart). İçerik tipini değiştirerek görebilirsin.
              </p>
            )}
          </div>

          {/* 5. Zaman */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Zaman
            </label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setScheduleMode('later')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  scheduleMode === 'later'
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-border hover:border-brand/40'
                }`}
              >
                <Calendar className="h-4 w-4 inline mr-1.5" /> Tarih seç
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('now')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  scheduleMode === 'now'
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-border hover:border-brand/40'
                }`}
              >
                <Send className="h-4 w-4 inline mr-1.5" /> Hemen kuyrukla
              </button>
            </div>
            {scheduleMode === 'later' && (
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
              />
            )}
          </div>
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {selectedChannelIds.size > 0 ? `${selectedChannelIds.size} kanal seçili` : 'Hiç kanal seçilmedi'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>İptal</Button>
            <Button
              onClick={submit}
              disabled={submitting || selectedChannelIds.size === 0 || !text.trim() || (mediaType !== 'text' && !selectedAsset)}
              className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Oluşturuluyor…</>
              ) : scheduleMode === 'now' ? (
                <><Send className="h-4 w-4 mr-1.5" /> Hemen kuyrukla</>
              ) : (
                <><Calendar className="h-4 w-4 mr-1.5" /> Planla</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
