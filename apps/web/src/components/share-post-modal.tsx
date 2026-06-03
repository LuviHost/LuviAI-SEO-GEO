'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Send, Calendar, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { api } from '@/lib/api';

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

export function SharePostModal({
  siteId,
  articleId,
  articleTitle,
  onClose,
  onSuccess,
}: {
  siteId: string;
  articleId: string;
  articleTitle: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('later');
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    // Default: yarın 14:00
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listSocialChannels(siteId)
      .then((rows: any) => {
        if (cancelled) return;
        const active = (rows ?? []).filter((c: Channel) => c.isActive);
        setChannels(active);
        // Default: hepsini seçili getir
        setSelectedIds(new Set(active.map((c: Channel) => c.id)));
      })
      .catch((err: any) => {
        toast.error(`Kanallar yüklenemedi: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [siteId]);

  const toggleChannel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(channels.map((c) => c.id)));
  const selectNone = () => setSelectedIds(new Set());

  const submit = async (status: 'DRAFT' | 'QUEUED') => {
    if (selectedIds.size === 0) {
      toast.error('En az 1 kanal seç');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        channelIds: Array.from(selectedIds),
        scheduledFor: scheduleMode === 'now' ? null : new Date(scheduledFor).toISOString(),
        status,
      };
      const result = await api.shareArticleToSocial(siteId, articleId, body);
      if (result.error) {
        toast.error(result.error);
      } else if (result.created === 0) {
        toast.info(`Yeni post oluşmadı (${result.skipped} kanal için zaten draft vardı)`);
      } else {
        if (status === 'QUEUED' && result.postIds?.length) {
          // "Hemen kuyrukla" — cron beklemesin, anlık publish tetikle
          toast.success(`📤 ${result.created} kanal için yayın tetiklendi…`, { duration: 4000 });
          const publishResults = await Promise.allSettled(
            result.postIds.map((postId: string) => api.publishSocialPostNow(postId)),
          );
          const ok = publishResults.filter((r) => r.status === 'fulfilled').length;
          const fail = publishResults.length - ok;
          if (fail === 0) {
            toast.success(`✅ ${ok} kanala yayın gönderildi (worker arka planda işliyor)`, { duration: 6000 });
          } else {
            toast.warning(`⚠ ${ok} başarılı, ${fail} hata — detaylar Sosyal Yayın listesinde`, { duration: 8000 });
          }
        } else {
          toast.success(`✅ ${result.created} kanala taslak oluşturuldu (Sosyal Yayın'dan onayla)`, { duration: 6000 });
        }
        onSuccess?.();
        onClose();
      }
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">Sosyal medyada paylaş</h2>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1" title={articleTitle}>
              {articleTitle}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {/* Kanal seçimi */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Hangi kanallara paylaşalım?
              </label>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={selectAll} className="text-brand hover:underline">Hepsi</button>
                <span className="text-muted-foreground">·</span>
                <button onClick={selectNone} className="text-muted-foreground hover:underline">Hiçbiri</button>
              </div>
            </div>
            {loading ? (
              <div className="h-24 bg-muted/40 rounded-lg animate-pulse" />
            ) : channels.length === 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                Aktif sosyal kanal yok. Önce <strong>Bağlantılar</strong> sayfasından LinkedIn, X gibi hesapları bağla.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {channels.map((c) => {
                  const selected = selectedIds.has(c.id);
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
                        <div className="text-sm font-medium truncate">
                          {c.externalName ?? c.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{prettyChannelType(c.type)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Caption bilgilendirme */}
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
            💡 Her kanal için makale başlığı + özet + URL'inden{' '}
            <strong>platforma uygun</strong> caption otomatik üretilir (X kısa & emoji'li,
            LinkedIn uzun & profesyonel). Oluşturduktan sonra{' '}
            <strong>Sosyal Post Takvimi</strong>'nde tek tek düzenleyebilir, medya ekleyebilirsin.
          </div>

          {/* Zamanlama */}
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
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Tarih seç
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
                <Send className="h-4 w-4 inline mr-1.5" />
                Hemen kuyrukla
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
                ? 'Seçilen zamanda otomatik yayınlanır. Önce taslak olarak oluşur — istersen önce onaylarsın.'
                : 'Onaylanır onaylanmaz yayın kuyruğuna girer (~30 sn içinde paylaşılır).'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} kanal seçili` : 'Hiç kanal seçilmedi'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              İptal
            </Button>
            <Button
              onClick={() => submit(scheduleMode === 'now' ? 'QUEUED' : 'DRAFT')}
              disabled={submitting || selectedIds.size === 0}
              className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Oluşturuluyor…</>
              ) : scheduleMode === 'now' ? (
                <><Send className="h-4 w-4 mr-1.5" /> Hemen kuyrukla</>
              ) : (
                <><Calendar className="h-4 w-4 mr-1.5" /> Takvime ekle</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
