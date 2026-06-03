'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2, Clock, FileText, Image as ImageIcon, Loader2, Send, Sparkles,
  Type, Video, RefreshCw, ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Library, Trash2, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

type MediaType = 'text' | 'image' | 'video';
type Step = 1 | 2 | 3 | 4;

interface Channel {
  id: string;
  type: string;
  name: string;
  externalName: string | null;
  externalAvatar: string | null;
  isActive: boolean;
}

interface StudioAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT';
  url?: string;
  text?: string;
  prompt: string;
  provider: string;
  favorite: boolean;
  createdAt: string;
}

interface SocialPost {
  id: string;
  channelId: string;
  text: string;
  mediaUrls: Array<{ url: string; type: 'image' | 'video' }> | null;
  status: string;
  scheduledFor: string | null;
  channel: { type: string; name: string; externalName?: string; externalAvatar?: string };
}

const COMPATIBLE: Record<MediaType, string[]> = {
  text:  ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'THREADS', 'BLUESKY', 'MASTODON'],
  image: ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'INSTAGRAM_BUSINESS', 'FACEBOOK_PAGE', 'PINTEREST', 'THREADS', 'BLUESKY'],
  video: ['X_TWITTER', 'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'INSTAGRAM_BUSINESS', 'FACEBOOK_PAGE', 'TIKTOK', 'YOUTUBE', 'THREADS'],
};

const CHANNEL_TO_VENDOR: Record<string, VendorName> = {
  LINKEDIN_PERSONAL: 'linkedin', LINKEDIN_COMPANY: 'linkedin',
  X_TWITTER: 'twitter', FACEBOOK_PAGE: 'facebook',
  INSTAGRAM_BUSINESS: 'instagram', TIKTOK: 'tiktok',
  YOUTUBE: 'youtube', THREADS: 'threads', BLUESKY: 'bluesky', PINTEREST: 'pinterest',
};

const CHANNEL_LABELS: Record<string, string> = {
  LINKEDIN_PERSONAL: 'LinkedIn', LINKEDIN_COMPANY: 'LinkedIn Şirket',
  X_TWITTER: 'X', FACEBOOK_PAGE: 'Facebook', INSTAGRAM_BUSINESS: 'Instagram',
  TIKTOK: 'TikTok', YOUTUBE: 'YouTube', THREADS: 'Threads', BLUESKY: 'Bluesky', PINTEREST: 'Pinterest',
};

const STEP_LABELS = [
  { n: 1, title: 'Medya' },
  { n: 2, title: 'Metin' },
  { n: 3, title: 'Platform' },
  { n: 4, title: 'Tarih' },
];

export function PublishStudio({ siteId }: { siteId: string }) {
  return (
    <div className="space-y-6">
      <PostWizard siteId={siteId} />
      <UpcomingPosts siteId={siteId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  WIZARD
// ─────────────────────────────────────────────────────

function PostWizard({ siteId }: { siteId: string }) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 — medya
  const [mediaType, setMediaType] = useState<MediaType>('image');
  const [selectedAsset, setSelectedAsset] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [mediaAssets, setMediaAssets] = useState<StudioAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // Step 2 — metin
  const [text, setText] = useState('');
  const [textAssets, setTextAssets] = useState<StudioAsset[]>([]);
  const [loadingTextAssets, setLoadingTextAssets] = useState(false);

  // Step 3 — platform
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());

  // Step 4 — tarih
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('later');
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });

  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // reset wizard sonrası

  // Kanalları çek (bir kere)
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
  }, [siteId, refreshKey]);

  // Step 1: medya tipine göre asset'leri çek
  // Image: sadece studio_assets (Studio Görsel sekmesinden üretilenler)
  // Video: studio_assets (varsa) + videos tablosu (Video Factory'den üretilenler) — birleştirilir
  useEffect(() => {
    if (mediaType === 'text') { setMediaAssets([]); return; }
    let cancelled = false;
    setLoadingAssets(true);

    if (mediaType === 'image') {
      api.listStudioAssets(siteId, { type: 'IMAGE' })
        .then((rows: any) => { if (!cancelled) setMediaAssets(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (!cancelled) setMediaAssets([]); })
        .finally(() => { if (!cancelled) setLoadingAssets(false); });
    } else {
      // VIDEO: paralel iki kaynak
      Promise.allSettled([
        api.listStudioAssets(siteId, { type: 'VIDEO' }),
        api.listVideos(siteId),
      ]).then(([assetsRes, vidsRes]) => {
        if (cancelled) return;
        const studioVids: StudioAsset[] = assetsRes.status === 'fulfilled' && Array.isArray(assetsRes.value)
          ? (assetsRes.value as StudioAsset[])
          : [];
        const factoryVids: StudioAsset[] = (vidsRes.status === 'fulfilled' && Array.isArray(vidsRes.value) ? vidsRes.value : [])
          .filter((v: any) => v?.status === 'READY' && v?.videoUrl)
          .map((v: any) => ({
            id: v.id,
            type: 'VIDEO' as const,
            url: v.videoUrl,
            text: undefined,
            prompt: v.title ?? v.scriptText?.slice(0, 80) ?? '',
            provider: v.provider ?? 'video-factory',
            favorite: false,
            createdAt: v.createdAt,
          }));
        // Dedup: aynı URL varsa tekrar etme (studio_assets ile factory aynı asset'i tutabilir)
        const seen = new Set<string>();
        const merged = [...factoryVids, ...studioVids].filter((a) => {
          if (!a.url || seen.has(a.url)) return false;
          seen.add(a.url);
          return true;
        });
        setMediaAssets(merged);
      }).finally(() => { if (!cancelled) setLoadingAssets(false); });
    }
    return () => { cancelled = true; };
  }, [siteId, mediaType, refreshKey]);

  // Text asset'leri: Adım 1'de medya seçerken de "Metin Önerileri" göstereceğiz,
  // Adım 2'de de aynı liste düzenleme için lazım. Tek seferde yükle.
  useEffect(() => {
    let cancelled = false;
    setLoadingTextAssets(true);
    api.listStudioAssets(siteId, { type: 'TEXT' })
      .then((rows: any) => { if (!cancelled) setTextAssets(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setTextAssets([]); })
      .finally(() => { if (!cancelled) setLoadingTextAssets(false); });
    return () => { cancelled = true; };
  }, [siteId, refreshKey]);

  const compatibleChannels = useMemo(() => {
    const compatTypes = new Set(COMPATIBLE[mediaType]);
    return channels.filter((c) => compatTypes.has(c.type));
  }, [channels, mediaType]);

  // Medya tipi değişince uyumsuz kanal seçimlerini temizle
  useEffect(() => {
    setSelectedChannelIds((prev) => {
      const compatIds = new Set(compatibleChannels.map((c) => c.id));
      const next = new Set<string>();
      for (const id of prev) if (compatIds.has(id)) next.add(id);
      return next;
    });
  }, [mediaType, compatibleChannels]);

  // Step validasyonu
  const canGoStep2 = mediaType === 'text' || !!selectedAsset;
  const canGoStep3 = canGoStep2 && text.trim().length > 0;
  const canGoStep4 = canGoStep3 && selectedChannelIds.size > 0;

  const resetWizard = () => {
    setStep(1);
    setMediaType('image');
    setSelectedAsset(null);
    setText('');
    setSelectedChannelIds(new Set());
    setScheduleMode('later');
    setRefreshKey((k) => k + 1);
  };

  const submit = async () => {
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

      if (scheduleMode === 'now' && result.postIds.length > 0) {
        // "Hemen yayınla" — cron'u beklemeden her post için anlık publish job'u tetikle
        toast.success(`📤 ${result.created} kanal için yayın tetiklendi…`, { duration: 4000 });
        const publishResults = await Promise.allSettled(
          result.postIds.map((postId) => api.publishSocialPostNow(postId)),
        );
        const ok = publishResults.filter((r) => r.status === 'fulfilled').length;
        const fail = publishResults.length - ok;
        if (fail === 0) {
          toast.success(`✅ ${ok} kanala yayın gönderildi (worker arka planda işliyor)`, { duration: 6000 });
        } else {
          toast.warning(`⚠ ${ok} başarılı, ${fail} hata — detaylar Yaklaşan Yayınlar listesinde`, { duration: 8000 });
        }
      } else {
        toast.success(`✅ ${result.created} kanala taslak oluşturuldu`, { duration: 6000 });
      }
      resetWizard();
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <h3 className="text-lg font-bold">Yeni Sosyal Post Oluştur</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Studio kütüphanesinden asset seç → metin seç veya yaz → platform seç → tarih ver → oluştur
        </p>
      </div>

      {/* Stepper */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          {STEP_LABELS.map(({ n, title }, idx) => {
            const isActive = step === n;
            const isDone = step > n;
            return (
              <div key={n} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    // Sadece geri gidişe izin ver veya tamamlanmış adımlar arası
                    if (n < step) setStep(n as Step);
                  }}
                  disabled={n > step}
                  className={`flex items-center gap-2 transition-colors ${n > step ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className={`h-8 w-8 rounded-full grid place-items-center text-sm font-bold shrink-0 transition-colors ${
                    isDone
                      ? 'bg-emerald-500 text-white'
                      : isActive
                        ? 'bg-brand text-white'
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : n}
                  </span>
                  <span className={`text-sm font-medium hidden sm:inline ${isActive ? 'text-brand' : isDone ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {title}
                  </span>
                </button>
                {idx < STEP_LABELS.length - 1 && (
                  <div className={`flex-1 h-0.5 ${isDone ? 'bg-emerald-500' : 'bg-muted'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-6 min-h-[300px]">
        {step === 1 && (
          <Step1Media
            siteId={siteId}
            mediaType={mediaType}
            setMediaType={setMediaType}
            selectedAsset={selectedAsset}
            setSelectedAsset={setSelectedAsset}
            assets={mediaAssets}
            loading={loadingAssets}
            textAssets={textAssets}
            loadingTextAssets={loadingTextAssets}
            text={text}
            setText={setText}
          />
        )}
        {step === 2 && (
          <Step2Text
            siteId={siteId}
            text={text}
            setText={setText}
            textAssets={textAssets}
            loading={loadingTextAssets}
            selectedAsset={selectedAsset}
            mediaType={mediaType}
          />
        )}
        {step === 3 && (
          <Step3Platform
            mediaType={mediaType}
            channels={channels}
            compatibleChannels={compatibleChannels}
            selectedChannelIds={selectedChannelIds}
            setSelectedChannelIds={setSelectedChannelIds}
            loading={loadingChannels}
          />
        )}
        {step === 4 && (
          <Step4Schedule
            mediaType={mediaType}
            selectedAsset={selectedAsset}
            text={text}
            channelCount={selectedChannelIds.size}
            scheduleMode={scheduleMode}
            setScheduleMode={setScheduleMode}
            scheduledFor={scheduledFor}
            setScheduledFor={setScheduledFor}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => step > 1 && setStep((step - 1) as Step)}
          disabled={step === 1 || submitting}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Geri
        </Button>
        {step < 4 ? (
          <Button
            onClick={() => setStep((step + 1) as Step)}
            disabled={
              (step === 1 && !canGoStep2) ||
              (step === 2 && !canGoStep3) ||
              (step === 3 && !canGoStep4)
            }
            className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
          >
            İleri <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Oluşturuluyor…</>
            ) : scheduleMode === 'now' ? (
              <><Send className="h-4 w-4 mr-1.5" /> Hemen Yayınla</>
            ) : (
              <><CalendarIcon className="h-4 w-4 mr-1.5" /> Takvime Ekle</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  STEP 1 — Medya
// ─────────────────────────────────────────────────────

function Step1Media({
  siteId, mediaType, setMediaType, selectedAsset, setSelectedAsset, assets, loading,
  textAssets, loadingTextAssets, text, setText,
}: {
  siteId: string;
  mediaType: MediaType;
  setMediaType: (t: MediaType) => void;
  selectedAsset: { url: string; type: 'image' | 'video' } | null;
  setSelectedAsset: (a: { url: string; type: 'image' | 'video' } | null) => void;
  assets: StudioAsset[];
  loading: boolean;
  textAssets: StudioAsset[];
  loadingTextAssets: boolean;
  text: string;
  setText: (s: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          İçerik tipi
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: 'text' as MediaType, label: 'Yalın metin', icon: Type, desc: 'Görselsiz · X · LinkedIn · Threads' },
            { key: 'image' as MediaType, label: 'Görsel + metin', icon: ImageIcon, desc: '+ Instagram · Facebook · Pinterest' },
            { key: 'video' as MediaType, label: 'Video + metin', icon: Video, desc: '+ TikTok · YouTube · Reels' },
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

      {mediaType === 'text' ? (
        <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/30 p-3 text-xs text-emerald-700 dark:text-emerald-400">
          ✓ Yalın metin yayını seçildi. Görsel/video olmadan sadece metinle paylaşılacak.
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {mediaType === 'image' ? 'Studio kütüphanesi — Görseller' : 'Studio kütüphanesi — Videolar'}
            </label>
            <Link
              href={`/sites/${siteId}/studio?tab=${mediaType}`}
              target="_blank"
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3" /> Yeni üret
            </Link>
          </div>
          {loading ? (
            <div className="h-48 bg-muted/40 rounded-lg animate-pulse" />
          ) : assets.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-6 text-center">
              <Library className="h-8 w-8 text-amber-600/60 mx-auto mb-2" />
              <p className="text-sm font-medium mb-1">
                Studio kütüphanesinde {mediaType === 'image' ? 'görsel' : 'video'} yok
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Önce Studio'nun <strong>{mediaType === 'image' ? 'Görsel' : 'Video'}</strong> sekmesinden üret.
              </p>
              <Link
                href={`/sites/${siteId}/studio?tab=${mediaType}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-brand text-white text-xs hover:bg-brand/90"
              >
                <Sparkles className="h-3 w-3" /> Studio'ya git, {mediaType === 'image' ? 'görsel' : 'video'} üret
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1">
              {assets.slice(0, 36).map((a) => {
                const isSelected = a.url === selectedAsset?.url;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => a.url && setSelectedAsset({ url: a.url, type: mediaType === 'image' ? 'image' : 'video' })}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      isSelected ? 'border-brand ring-2 ring-brand/30' : 'border-transparent hover:border-brand/40'
                    }`}
                    title={a.prompt}
                  >
                    {mediaType === 'video' ? (
                      <video src={a.url} className="w-full h-full object-cover" muted preload="metadata" />
                    ) : (
                      <img src={a.url} alt="" className="w-full h-full object-cover" />
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-brand/20 grid place-items-center">
                        <CheckCircle2 className="h-7 w-7 text-brand drop-shadow" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {selectedAsset && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Seçildi — Adım 2'ye geçebilirsin
            </p>
          )}
        </div>
      )}

      {/* Metin önerileri — her tür içerik için, kullanıcı şimdiden hazır bir metin seçebilir.
          Adım 2'de yine düzenleme imkanı olacak. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Studio kütüphanesi — Metin önerileri (opsiyonel)
          </label>
          <Link
            href={`/sites/${siteId}/studio?tab=text`}
            target="_blank"
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3" /> Yeni metin üret
          </Link>
        </div>
        {loadingTextAssets ? (
          <div className="h-24 bg-muted/40 rounded-lg animate-pulse" />
        ) : textAssets.length === 0 ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-center text-xs text-muted-foreground">
            Kütüphanede hazır metin yok. Adım 2'de doğrudan yazabilirsin.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {textAssets.slice(0, 10).map((a) => {
              const preview = (a.text ?? '').slice(0, 140);
              const isSelected = text === a.text;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => a.text && setText(a.text)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand/5 ring-1 ring-brand/30'
                      : 'border-border hover:border-brand bg-card'
                  }`}
                  title={isSelected ? 'Seçili — Adım 2\'de düzenleyebilirsin' : 'Tıkla, metni seç'}
                >
                  <p className="text-xs leading-relaxed line-clamp-2">
                    {preview}{a.text && a.text.length > 140 ? '…' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {a.prompt} · {a.provider}
                    {isSelected && <span className="ml-2 text-brand font-medium">✓ Seçildi</span>}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  STEP 2 — Metin
// ─────────────────────────────────────────────────────

function Step2Text({
  siteId, text, setText, textAssets, loading, selectedAsset, mediaType,
}: {
  siteId: string;
  text: string;
  setText: (s: string) => void;
  textAssets: StudioAsset[];
  loading: boolean;
  selectedAsset: { url: string; type: 'image' | 'video' } | null;
  mediaType: MediaType;
}) {
  return (
    <div className="space-y-5">
      {selectedAsset && (
        <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
          <div className="h-12 w-12 rounded overflow-hidden shrink-0 border bg-muted">
            {mediaType === 'video' ? (
              <video src={selectedAsset.url} className="w-full h-full object-cover" muted />
            ) : (
              <img src={selectedAsset.url} alt="" className="w-full h-full object-cover" />
            )}
          </div>
          <div className="text-xs">
            <p className="font-medium">Seçili {mediaType === 'video' ? 'video' : 'görsel'} ile birlikte yayınlanacak</p>
            <p className="text-muted-foreground mt-0.5">Aşağıya metni yaz veya kütüphaneden bir öneri seç.</p>
          </div>
        </div>
      )}
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Caption / Metin
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Aynı metin tüm seçili kanallara gider. Aşağıdan Studio Metin kütüphanesinden hazır metin seçebilirsin."
          rows={5}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-y min-h-[100px]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {text.length} karakter — X için 280 üstü kesilir, LinkedIn için 3000 limit.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Studio kütüphanesi — Metinler
          </label>
          <Link
            href={`/sites/${siteId}/studio?tab=text`}
            target="_blank"
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            <Sparkles className="h-3 w-3" /> Yeni metin üret
          </Link>
        </div>
        {loading ? (
          <div className="h-24 bg-muted/40 rounded-lg animate-pulse" />
        ) : textAssets.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            Kütüphanede hazır metin yok. Yukarıya doğrudan yaz veya Studio Metin'den üret.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {textAssets.slice(0, 20).map((a) => {
              const preview = (a.text ?? '').slice(0, 180);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => a.text && setText(a.text)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border hover:border-brand bg-card transition-colors group"
                  title="Tıkla, metin alanına doldur"
                >
                  <p className="text-xs leading-relaxed line-clamp-2 group-hover:text-foreground">{preview}{a.text && a.text.length > 180 ? '…' : ''}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 truncate">
                    {a.prompt} · {a.provider}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  STEP 3 — Platform
// ─────────────────────────────────────────────────────

function Step3Platform({
  mediaType, channels, compatibleChannels, selectedChannelIds, setSelectedChannelIds, loading,
}: {
  mediaType: MediaType;
  channels: Channel[];
  compatibleChannels: Channel[];
  selectedChannelIds: Set<string>;
  setSelectedChannelIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  loading: boolean;
}) {
  const toggle = (id: string) => {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedChannelIds(new Set(compatibleChannels.map((c) => c.id)));
  const clearAll = () => setSelectedChannelIds(new Set());

  const hiddenCount = channels.length - compatibleChannels.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {mediaType === 'text' ? 'Metin destekli kanallar' : mediaType === 'image' ? 'Görsel destekli kanallar' : 'Video destekli kanallar'}
        </label>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={selectAll} className="text-brand hover:underline">Hepsi</button>
          <span className="text-muted-foreground">·</span>
          <button onClick={clearAll} className="text-muted-foreground hover:underline">Hiçbiri</button>
        </div>
      </div>

      {loading ? (
        <div className="h-24 bg-muted/40 rounded-lg animate-pulse" />
      ) : compatibleChannels.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-4 text-sm">
          <p className="font-medium">Bu medya tipini destekleyen aktif kanal yok</p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Bağlantılar</strong> sayfasından{' '}
            {mediaType === 'video' ? 'TikTok / YouTube / Instagram' : mediaType === 'image' ? 'Instagram / Facebook / Pinterest' : 'LinkedIn / X / Threads'}{' '}
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
                onClick={() => toggle(c.id)}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg border text-left transition-all ${
                  selected ? 'border-brand bg-brand/5 ring-2 ring-brand/20' : 'border-border hover:border-brand/40 bg-card'
                }`}
              >
                <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                  selected ? 'border-brand bg-brand text-white' : 'border-border'
                }`}>
                  {selected && <CheckCircle2 className="h-4 w-4" />}
                </div>
                {CHANNEL_TO_VENDOR[c.type] && <VendorLogo name={CHANNEL_TO_VENDOR[c.type]} size={22} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.externalName ?? c.name}</div>
                  <div className="text-[10px] text-muted-foreground">{CHANNEL_LABELS[c.type] ?? c.type}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          💡 {hiddenCount} kanal bu medya tipinde gizlendi (uyumsuz). Geri dönüp medya tipini değiştirebilirsin.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  STEP 4 — Tarih + Önizleme
// ─────────────────────────────────────────────────────

function Step4Schedule({
  mediaType, selectedAsset, text, channelCount, scheduleMode, setScheduleMode, scheduledFor, setScheduledFor,
}: {
  mediaType: MediaType;
  selectedAsset: { url: string; type: 'image' | 'video' } | null;
  text: string;
  channelCount: number;
  scheduleMode: 'now' | 'later';
  setScheduleMode: (m: 'now' | 'later') => void;
  scheduledFor: string;
  setScheduledFor: (s: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Özet */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Özet</p>
        <div className="flex items-start gap-3">
          {selectedAsset && (
            <div className="h-16 w-16 rounded overflow-hidden shrink-0 border bg-muted">
              {mediaType === 'video' ? (
                <video src={selectedAsset.url} className="w-full h-full object-cover" muted />
              ) : (
                <img src={selectedAsset.url} alt="" className="w-full h-full object-cover" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm line-clamp-3">{text}</p>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {mediaType === 'text' ? '📝 Sadece metin' : mediaType === 'image' ? '🖼 Görsel + metin' : '🎬 Video + metin'}
              {' · '}
              <strong>{channelCount} kanal</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Zaman */}
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Yayın zamanı
        </label>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setScheduleMode('later')}
            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              scheduleMode === 'later' ? 'border-brand bg-brand/5 text-brand' : 'border-border hover:border-brand/40'
            }`}
          >
            <CalendarIcon className="h-4 w-4 inline mr-1.5" /> Tarih seç
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode('now')}
            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              scheduleMode === 'now' ? 'border-brand bg-brand/5 text-brand' : 'border-border hover:border-brand/40'
            }`}
          >
            <Send className="h-4 w-4 inline mr-1.5" /> Hemen yayınla
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
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {scheduleMode === 'later'
            ? 'Taslak olarak oluşur, seçilen zamanda otomatik yayınlanır.'
            : 'Anında yayın kuyruğuna girer (~30 sn içinde paylaşılır).'}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Yaklaşan Yayınlar (alt panel)
// ─────────────────────────────────────────────────────

function UpcomingPosts({ siteId }: { siteId: string }) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listSocialPosts(siteId, {});
      const filtered = (Array.isArray(list) ? list : []).filter(
        (p: any) => p.status === 'DRAFT' || p.status === 'QUEUED' || p.status === 'NEEDS_APPROVAL',
      );
      setPosts(filtered);
    } catch (err: any) {
      toast.error(err.message || 'Postlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [siteId]);

  const handleApprove = async (post: SocialPost) => {
    setBusyId(post.id);
    try {
      await api.approveSocialPost(post.id);
      toast.success('Post yayınlanmaya gönderildi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Onay hatası');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (post: SocialPost) => {
    if (!confirm('Bu post silinsin mi?')) return;
    setBusyId(post.id);
    try {
      await api.deleteSocialPost(post.id);
      toast.success('Silindi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Silme hatası');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border bg-card">
      <div className="px-6 py-4 border-b flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Yaklaşan Yayınlar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Taslak ve kuyruktaki sosyal post'lar — onayla veya sil
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1" /> Yenile
        </Button>
      </div>
      <div className="p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Yaklaşan post yok. Yukarıdan yeni post oluştur.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {posts.map((post) => {
              const Vendor = CHANNEL_TO_VENDOR[post.channel.type];
              const isDraft = post.status === 'DRAFT';
              const isQueued = post.status === 'QUEUED';
              const busy = busyId === post.id;
              return (
                <li key={post.id} className="py-3 flex items-start gap-3">
                  <div className="h-8 w-8 rounded bg-muted grid place-items-center shrink-0">
                    {Vendor ? <VendorLogo name={Vendor} size={16} /> : <Send className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium">{CHANNEL_LABELS[post.channel.type] ?? post.channel.type}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground truncate">{post.channel.externalName ?? post.channel.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        isDraft
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : isQueued
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {post.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{post.text}</p>
                    {post.scheduledFor && (
                      <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(post.scheduledFor).toLocaleString('tr-TR')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isDraft && (
                      <Button
                        size="sm"
                        onClick={() => handleApprove(post)}
                        disabled={busy}
                        className="h-7"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Onayla'}
                      </Button>
                    )}
                    <button
                      onClick={() => handleDelete(post)}
                      disabled={busy}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-rose-500/10 text-rose-500 disabled:opacity-50"
                      title="Sil"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
