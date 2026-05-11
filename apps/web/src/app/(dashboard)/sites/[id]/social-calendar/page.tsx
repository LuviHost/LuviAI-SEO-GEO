'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import {
  Calendar, CheckCircle2, Clock, FileText, Image as ImageIcon,
  Loader2, Send, Sparkles, Type, Video, AlertCircle, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

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
  channel: { type: string; name: string; externalName?: string; externalAvatar?: string };
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

const MEDIA_ICON: Record<MediaType, any> = {
  text: Type,
  image: ImageIcon,
  video: Video,
};

export default function SocialCalendarPage() {
  const { site } = useSiteContext();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [policy, setPolicy] = useState<Record<string, { default: MediaType; options: MediaType[]; editable: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [busyById, setBusyById] = useState<Record<string, 'generating' | 'approving' | null>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, pol] = await Promise.all([
        api.listSocialPosts(site.id, { status: 'DRAFT' }),
        api.socialMediaPolicy().catch(() => ({})),
      ]);
      setPosts(Array.isArray(list) ? list : []);
      setPolicy(pol as any);
    } catch (err: any) {
      toast.error(err.message || 'Postlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [site.id]);

  const handleGenerateMedia = async (post: SocialPost, mediaType?: MediaType) => {
    setBusyById(prev => ({ ...prev, [post.id]: 'generating' }));
    try {
      const r = await api.generateSocialPostMedia(post.id, mediaType);
      if (r.ok) {
        toast.success(`${CHANNEL_LABELS[post.channel.type]}: ${r.mediaType} medya hazır`);
      } else {
        toast.error(`Medya üretilemedi: ${r.error}`);
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Medya üretim hatası');
    } finally {
      setBusyById(prev => ({ ...prev, [post.id]: null }));
    }
  };

  const handleApprove = async (post: SocialPost, scheduledFor?: string) => {
    setBusyById(prev => ({ ...prev, [post.id]: 'approving' }));
    try {
      await api.approveSocialPost(post.id, scheduledFor);
      toast.success(scheduledFor ? 'Post zamanlandı' : 'Post yayınlanmaya gönderildi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Onay hatası');
    } finally {
      setBusyById(prev => ({ ...prev, [post.id]: null }));
    }
  };

  const handleChangeMediaType = (post: SocialPost, newType: MediaType) => {
    // mediaType değişince anında re-generate tetikle (kullanıcı seçti = istiyor)
    handleGenerateMedia(post, newType);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Sosyal post draft'ları yükleniyor…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Sosyal Takvim</h2>
            <p className="text-sm text-muted-foreground">
              Makale yayınlanınca her kanal için draft otomatik üretilir. Medyayı oluştur, onayla, takvime al.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1" /> Yenile
        </Button>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-bold mb-1">Onay bekleyen draft yok</h3>
          <p className="text-sm text-muted-foreground">
            Bir makale yayınladığında her aktif sosyal kanal için burada bir draft post oluşur.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {posts.map(post => {
            const channelType = post.channel.type;
            const channelLabel = CHANNEL_LABELS[channelType] ?? channelType;
            const channelPolicy = policy[channelType] ?? { default: 'text' as MediaType, options: ['text' as MediaType], editable: true };
            const meta = post.metadata ?? {};
            const mediaType: MediaType = (meta.mediaType ?? channelPolicy.default) as MediaType;
            const genStatus: MediaGenStatus = (meta.mediaGenStatus ?? 'pending') as MediaGenStatus;
            const genError: string | undefined = meta.mediaGenError;
            const busy = busyById[post.id];
            const isGenerating = busy === 'generating' || genStatus === 'generating';
            const isReady = genStatus === 'ready';
            const isError = genStatus === 'error';
            const mediaUrls = post.mediaUrls ?? [];
            const MediaIcon = MEDIA_ICON[mediaType];

            return (
              <div key={post.id} className="rounded-xl border bg-card p-4 space-y-3">
                {/* Header: channel + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {post.channel.externalAvatar
                      ? <img src={post.channel.externalAvatar} alt="" className="h-8 w-8 rounded-full" />
                      : <div className="h-8 w-8 rounded-full bg-muted grid place-items-center text-xs font-bold">{channelLabel[0]}</div>
                    }
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{channelLabel}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{post.channel.externalName ?? post.channel.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-muted">
                      <MediaIcon className="h-3 w-3" /> {mediaType}
                    </span>
                  </div>
                </div>

                {/* Text preview */}
                <div className="rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap max-h-24 overflow-y-auto">
                  {post.text}
                </div>

                {/* Media preview */}
                <div className="rounded border overflow-hidden bg-muted/40">
                  {isGenerating ? (
                    <div className="aspect-video grid place-items-center text-xs text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Medya üretiliyor… {mediaType === 'video' ? '(~30 sn)' : '(~10 sn)'}
                    </div>
                  ) : isError ? (
                    <div className="aspect-video grid place-items-center text-xs text-rose-600 gap-1 p-2 text-center">
                      <AlertCircle className="h-5 w-5" />
                      <div className="line-clamp-2">{genError ?? 'Üretim hatası'}</div>
                    </div>
                  ) : mediaUrls.length > 0 ? (
                    mediaUrls[0].type === 'image' ? (
                      <img src={mediaUrls[0].url} alt="" className="w-full aspect-video object-cover" />
                    ) : (
                      <video src={mediaUrls[0].url} controls className="w-full aspect-video object-cover" />
                    )
                  ) : (
                    <div className="aspect-video grid place-items-center text-xs text-muted-foreground gap-1">
                      <MediaIcon className="h-6 w-6 opacity-40" />
                      {mediaType === 'text' ? 'Sadece metin yayını' : 'Medya henüz üretilmedi'}
                    </div>
                  )}
                </div>

                {/* MediaType selector (editable kanallar için) */}
                {channelPolicy.editable && channelPolicy.options.length > 1 && (
                  <div className="flex gap-1">
                    {channelPolicy.options.map(opt => {
                      const Icon = MEDIA_ICON[opt];
                      return (
                        <button
                          key={opt}
                          onClick={() => handleChangeMediaType(post, opt)}
                          disabled={!!busy}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                            mediaType === opt
                              ? 'bg-brand text-white'
                              : 'bg-background hover:bg-muted border border-border'
                          } disabled:opacity-50`}
                        >
                          <Icon className="h-3 w-3" /> {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {mediaType !== 'text' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleGenerateMedia(post)}
                      disabled={!!busy}
                    >
                      {isGenerating ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Üretiliyor</>
                      ) : isReady ? (
                        <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Yenile</>
                      ) : (
                        <><Sparkles className="h-3.5 w-3.5 mr-1" /> Medya Üret</>
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleApprove(post)}
                    disabled={!!busy || (mediaType !== 'text' && !isReady)}
                    title={mediaType !== 'text' && !isReady ? 'Önce medyayı üret' : 'Onayla ve yayınla'}
                  >
                    {busy === 'approving' ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Onaylanıyor</>
                    ) : (
                      <><Send className="h-3.5 w-3.5 mr-1" /> Onayla & Yayınla</>
                    )}
                  </Button>
                </div>

                {isReady && (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Medya hazır
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
