'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Mic, Video, Send, Languages, Play, Download, ExternalLink, Copy, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/info-tooltip';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];

/**
 * Multi-Modal Panel — makale detay sayfasinda saga/alta yerlestirilen
 * 4 sekmeli aksiyon paneli: Audio (TTS), Video (MP4), Yayin, Ceviri.
 */
export function MultiModalPanel({
  siteId,
  articleId,
  article,
  onChanged,
}: {
  siteId: string;
  articleId: string;
  article: any;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<'audio' | 'video' | 'publish' | 'translate'>('audio');

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            🎬 Multi-Modal Üretim
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Makaleni sesli, video ve farklı dillere dönüştür. Sonra YouTube/TikTok/Instagram'a yayınla.
          </p>
        </div>

        <div className="inline-flex border rounded-md overflow-hidden flex-wrap">
          {([
            ['audio', 'Audio (TTS)', <Mic key="a" className="h-3 w-3" />],
            ['video', 'Video', <Video key="v" className="h-3 w-3" />],
            ['publish', 'Yayın', <Send key="p" className="h-3 w-3" />],
            ['translate', 'Çeviri', <Languages key="t" className="h-3 w-3" />],
          ] as const).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id as any)}
              className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${
                tab === id ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {tab === 'audio' && <AudioTab siteId={siteId} articleId={articleId} article={article} onChanged={onChanged} />}
        {tab === 'video' && <VideoTab siteId={siteId} articleId={articleId} article={article} onChanged={onChanged} />}
        {tab === 'publish' && <PublishTab siteId={siteId} articleId={articleId} article={article} />}
        {tab === 'translate' && <TranslateTab siteId={siteId} articleId={articleId} onChanged={onChanged} />}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// Audio (TTS)
// ──────────────────────────────────────────────────────────────────
function AudioTab({ siteId, articleId, article, onChanged }: any) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const audioUrl = article?.frontmatter?.audio_url ?? null;
  const existingUrl = result?.publicUrl ?? audioUrl;

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.generateArticleAudio(siteId, articleId);
      if (r.ok) {
        setResult(r);
        toast.success(`Audio hazır · ${(r.bytes / 1024).toFixed(0)} KB · ~${r.durationSec}s`);
        onChanged?.();
      } else {
        toast.error(r.error ?? 'Üretilemedi');
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Makaleni{' '}
        <InfoTooltip term="TTS">
          <span className="underline decoration-dotted cursor-help">TTS</span>
        </InfoTooltip>
        {' '}ile sesli okumaya çevirir. Spotify/Apple Podcasts uyumlu MP3.
      </p>

      {existingUrl ? (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold inline-flex items-center gap-2">
            <Play className="h-3 w-3 text-brand" /> Mevcut Audio
          </p>
          <audio controls preload="metadata" className="w-full">
            <source src={existingUrl} type="audio/mpeg" />
          </audio>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={existingUrl} download className="text-xs text-brand hover:underline inline-flex items-center gap-1">
              <Download className="h-3 w-3" /> İndir
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(`<audio controls src="${existingUrl}"></audio>`); toast.success('Embed kodu kopyalandı'); }}
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
            >
              <Copy className="h-3 w-3" /> Embed kodu
            </button>
            <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
              {loading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Yenileniyor</> : 'Yeniden Üret'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground mb-3">Henüz audio yok.</p>
          <Button size="sm" onClick={generate} disabled={loading}>
            {loading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Üretiliyor (~30s)</> : <><Mic className="h-3 w-3 mr-1" /> Audio Üret</>}
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2">OpenAI TTS (alloy) veya Gemini TTS otomatik seçilir</p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Video
// ──────────────────────────────────────────────────────────────────
function VideoTab({ siteId, articleId, article, onChanged }: any) {
  const [format, setFormat] = useState<'vertical' | 'horizontal'>('vertical');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.generateArticleVideo(siteId, articleId, format);
      if (r.ok) {
        setResult(r);
        toast.success(`Video hazır · ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
        onChanged?.();
      } else {
        toast.error(r.error ?? 'Üretilemedi');
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Makaleyi <strong>Shorts/Reels formatında MP4</strong>'e dönüştürür.
        <InfoTooltip text="TTS audio + hero görsel + animated text birleştirilir. Önce 'Audio Üret' sekmesinden audio oluşturulmalı." />
        {' '}Önce audio gerekli.
      </p>

      <div>
        <p className="text-xs font-medium mb-2">Format:</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setFormat('vertical')}
            className={`rounded-md border p-3 text-left transition ${format === 'vertical' ? 'border-brand bg-brand/5' : 'hover:border-brand/40'}`}
          >
            <p className="text-xs font-semibold">📱 Vertical</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">1080×1920 · TikTok / Reels / Shorts</p>
          </button>
          <button
            onClick={() => setFormat('horizontal')}
            className={`rounded-md border p-3 text-left transition ${format === 'horizontal' ? 'border-brand bg-brand/5' : 'hover:border-brand/40'}`}
          >
            <p className="text-xs font-semibold">💻 Horizontal</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">1920×1080 · YouTube / Web</p>
          </button>
        </div>
      </div>

      {result?.publicUrl ? (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold inline-flex items-center gap-2">
            <Play className="h-3 w-3 text-brand" /> Video Hazır ({result.format})
          </p>
          <video controls preload="metadata" className="w-full rounded">
            <source src={result.publicUrl} type="video/mp4" />
          </video>
          <p className="text-[10px] text-muted-foreground">
            {(result.bytes / 1024 / 1024).toFixed(1)} MB · ~{result.durationSec}s · {result.publicUrl}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={result.publicUrl} download className="text-xs text-brand hover:underline inline-flex items-center gap-1">
              <Download className="h-3 w-3" /> İndir
            </a>
            <Button size="sm" onClick={generate} variant="outline" disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yeniden Üret'}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={generate} disabled={loading} className="w-full">
          {loading ? (
            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Video üretiliyor (~2-3 dk)…</>
          ) : (
            <><Video className="h-3 w-3 mr-1" /> Video Oluştur</>
          )}
        </Button>
      )}

      {loading && (
        <div className="rounded-md border bg-muted/30 p-2 text-[10px] space-y-1">
          <p className="font-semibold">⏳ Aşamalar:</p>
          <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
            <li>TTS audio üretiliyor</li>
            <li>Hero görsel hazırlanıyor</li>
            <li>ffmpeg birleştiriyor</li>
            <li>MP4 kaydediliyor</li>
          </ol>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Publish (YouTube + TikTok + Instagram)
// ──────────────────────────────────────────────────────────────────
function PublishTab({ siteId, articleId, article }: any) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, any>>({});

  const videoPath = article?.frontmatter?.video_path ?? '';
  const publicVideoUrl = article?.frontmatter?.video_url ?? '';

  const upload = async (platform: 'youtube' | 'tiktok' | 'instagram') => {
    setLoading(platform);
    try {
      let r;
      if (platform === 'youtube') {
        r = await api.uploadVideoToYouTube(siteId, articleId, videoPath);
      } else if (platform === 'tiktok') {
        r = await api.request(`/sites/${siteId}/articles/${articleId}/video/tiktok`, {
          method: 'POST', body: JSON.stringify({ videoPath }),
        });
      } else {
        r = await api.request(`/sites/${siteId}/articles/${articleId}/video/instagram`, {
          method: 'POST', body: JSON.stringify({ publicVideoUrl, caption: article.title }),
        });
      }
      setResult({ ...result, [platform]: r });
      if (r.ok) toast.success(`${platform} yayınlandı`);
      else toast.error(r.error ?? 'Hata');
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(null); }
  };

  const platforms = [
    { id: 'youtube', label: 'YouTube', icon: '🔴', formatHint: 'vertical/horizontal' },
    { id: 'tiktok', label: 'TikTok', icon: '🎵', formatHint: 'sadece vertical' },
    { id: 'instagram', label: 'Instagram Reels', icon: '📷', formatHint: 'sadece vertical' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Önce <strong>Video</strong> sekmesinden MP4 üret. Sonra istediğin platformlara tek tıkla yayınla.
      </p>

      {!videoPath && (
        <div className="rounded-md border-2 border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
          ⚠ Henüz video üretilmedi. "Video" sekmesine git, vertical formatta MP4 üret, sonra buraya gel.
        </div>
      )}

      {platforms.map((p) => (
        <Card key={p.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold">{p.icon} {p.label}</p>
                <p className="text-[10px] text-muted-foreground">{p.formatHint}</p>
              </div>
              <Button
                size="sm"
                onClick={() => upload(p.id as any)}
                disabled={!videoPath || loading === p.id}
                variant={result[p.id]?.ok ? 'outline' : 'default'}
              >
                {loading === p.id ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Yükleniyor</>
                ) : result[p.id]?.ok ? (
                  '✓ Yüklendi'
                ) : (
                  <><Send className="h-3 w-3 mr-1" /> Yükle</>
                )}
              </Button>
            </div>
            {result[p.id]?.ok && (result[p.id].url || result[p.id].permalink || result[p.id].shareUrl) && (
              <a
                href={result[p.id].url ?? result[p.id].permalink ?? result[p.id].shareUrl}
                target="_blank"
                rel="noopener"
                className="mt-2 text-[11px] text-brand hover:underline inline-flex items-center gap-1"
              >
                Yayında gör <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {result[p.id]?.error && (
              <p className="mt-2 text-[11px] text-red-500">{result[p.id].error}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Translate
// ──────────────────────────────────────────────────────────────────
function TranslateTab({ siteId, articleId, onChanged }: any) {
  const [selected, setSelected] = useState<string[]>(['en']);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const toggle = (code: string) => {
    setSelected(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };

  const translate = async () => {
    if (selected.length === 0) { toast.error('En az bir dil seç'); return; }
    setLoading(true);
    setResults([]);
    try {
      const all: any[] = [];
      for (const lang of selected) {
        const r = await api.request(`/sites/${siteId}/articles/${articleId}/translate`, {
          method: 'POST', body: JSON.stringify({ toLanguage: lang }),
        });
        all.push({ lang, ...r });
        if (r.ok) toast.success(`${lang.toUpperCase()} çevirisi hazır`);
      }
      setResults(all);
      onChanged?.();
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Makaleni 6 dile otomatik çevirir.
        <InfoTooltip text="Anthropic Sonnet 4.6 ile native-quality çeviri. Markdown yapısı + frontmatter korunur, SEO meta'ları yeniden yazılır." />
        {' '}Her çeviri yeni Article kaydı olur.
      </p>

      <div>
        <p className="text-xs font-medium mb-2">Diller (çoklu seç):</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => toggle(l.code)}
              className={`px-3 py-1.5 rounded-full border text-xs transition ${
                selected.includes(l.code)
                  ? 'bg-brand text-white border-brand'
                  : 'bg-card text-muted-foreground hover:border-brand/40'
              }`}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={translate} disabled={loading || selected.length === 0} className="w-full">
        {loading ? (
          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Çeviriliyor ({selected.length} dil)…</>
        ) : (
          <><Languages className="h-3 w-3 mr-1" /> {selected.length} Dile Çevir</>
        )}
      </Button>

      {results.length > 0 && (
        <div className="space-y-2 mt-3">
          {results.map((r, i) => {
            const lang = LANGUAGES.find((l) => l.code === r.lang);
            return (
              <div
                key={i}
                className={`rounded-md border p-2.5 ${r.ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">
                    {lang?.flag} {lang?.label} {r.ok ? '✓' : '✗'}
                  </p>
                  {r.ok && r.bytes && (
                    <Badge variant="outline" className="text-[10px]">{(r.bytes / 1024).toFixed(1)} KB</Badge>
                  )}
                </div>
                {r.error && <p className="text-[11px] text-red-500 mt-1">{r.error}</p>}
                {r.translatedArticleId && (
                  <a
                    href={`/sites/${siteId}/articles/${r.translatedArticleId}`}
                    className="mt-1 text-[11px] text-brand hover:underline inline-flex items-center gap-1"
                  >
                    Aç → <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
