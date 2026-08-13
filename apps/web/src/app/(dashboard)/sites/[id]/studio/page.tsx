'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { VideoLab } from '@/components/video-lab';
import { PublishStudio } from '@/components/publish-studio';
import { CreateSocialPostModal } from '@/components/create-social-post-modal';
import {
  Sparkles, Image as ImageIcon, Video, Type, Loader2, Download,
  Copy, Check, Wand2, Film, Calendar as CalendarIcon, ChevronRight,
  Star, Trash2, RefreshCw, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import Link from 'next/link';

type Tab = 'image' | 'video' | 'text' | 'publish';
type AspectRatio = '1:1' | '16:9' | '9:16';

const ASPECT_DIMS: Record<AspectRatio, { w: number; h: number; label: string }> = {
  '1:1': { w: 1024, h: 1024, label: 'Kare (Instagram post)' },
  '16:9': { w: 1536, h: 1024, label: 'Yatay (Blog hero / YouTube thumb)' },
  '9:16': { w: 1024, h: 1536, label: 'Dikey (Story / Reels / TikTok)' },
};

export default function StudioPage() {
  const { site } = useSiteContext();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = (search.get('tab') as Tab) || 'image';
  const [tab, setTab] = useState<Tab>(
    initialTab === 'video' || initialTab === 'text' || initialTab === 'publish' ? initialTab : 'image',
  );

  const switchTab = (next: Tab) => {
    setTab(next);
    const params = new URLSearchParams(search.toString());
    if (next === 'image') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20 text-fuchsia-600 dark:text-fuchsia-400 grid place-items-center">
          <Wand2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Studio</h2>
          <p className="text-sm text-muted-foreground">
            AI ile görsel, video ve metin üret — sosyal medyana ve makalelerine ekle.
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {[
          { key: 'image' as Tab, label: 'Görsel', icon: ImageIcon },
          { key: 'video' as Tab, label: 'Video', icon: Video },
          { key: 'text' as Tab, label: 'Metin', icon: Type },
          { key: 'publish' as Tab, label: 'Sosyal Yayın', icon: Send },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 whitespace-nowrap ${
              tab === key
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'image' && <ImageStudio siteId={site.id} />}
      {tab === 'video' && <VideoLab siteId={site.id} />}
      {tab === 'text' && <TextStudio siteId={site.id} />}
      {tab === 'publish' && <PublishStudio siteId={site.id} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Image Studio
// ─────────────────────────────────────────────────────

function ImageStudio({ siteId }: { siteId: string }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [provider, setProvider] = useState<string>('gemini-flash');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [shareAsset, setShareAsset] = useState<{ url: string; type: 'image' | 'video' } | null>(null);

  const loadAssets = async () => {
    try {
      const rows = await api.listStudioAssets(siteId, { type: 'IMAGE', favorite: filterFavorite });
      setAssets(rows);
    } catch (err: any) {
      // sessiz
    }
  };

  useEffect(() => {
    api.listStudioImageProviders()
      .then((rows) => {
        setProviders(rows);
        const firstReady = rows.find((r: any) => r.ready);
        if (firstReady) setProvider(firstReady.key);
      })
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => { loadAssets(); }, [siteId, filterFavorite]);

  const handleGenerate = async () => {
    if (prompt.trim().length < 5) {
      toast.error('Prompt en az 5 karakter olmalı');
      return;
    }
    setGenerating(true);
    try {
      const { w, h } = ASPECT_DIMS[aspect];
      const r = await api.generateStudioImage(siteId, { prompt: prompt.trim(), provider, width: w, height: h });
      if (r.ok && r.url) {
        toast.success(`Görsel hazır (~$${(r.costUsd ?? 0).toFixed(3)})`);
        await loadAssets();
      } else {
        toast.error(r.error || 'Görsel üretilemedi');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const toggleFavorite = async (id: string, current: boolean) => {
    try {
      await api.updateStudioAsset(id, { favorite: !current });
      setAssets(prev => prev.map(a => a.id === id ? { ...a, favorite: !current } : a));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu görsel silinsin mi? Geri alınamaz.')) return;
    try {
      await api.deleteStudioAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      toast.success('Silindi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const selectedProv = providers.find(p => p.key === provider);

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      {/* Sol panel: prompt + ayarlar */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-semibold mb-1.5 block">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Örn: Modern bir bilgisayar masası, mor neon ışıkla, photo-realistic 4K"
            className="w-full min-h-28 px-3 py-2 rounded border bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            İngilizce yazarsan AI'lar daha iyi sonuç verir (tek Ideogram Türkçe metni iyi yapar).
          </p>
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block">AI Modeli</label>
          <div className="space-y-1.5">
            {providers.map((p) => (
              <button
                key={p.key}
                onClick={() => p.ready && setProvider(p.key)}
                disabled={!p.ready}
                className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${
                  provider === p.key && p.ready
                    ? 'border-brand bg-brand/5'
                    : p.ready
                      ? 'border-border hover:bg-muted'
                      : 'border-dashed border-border/60 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">${p.costPerImage.toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{p.description}</p>
                {!p.ready && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                    ⚠ {p.requiredEnvKeys.join(' + ')} .env'de gerekli
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block">Format</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.entries(ASPECT_DIMS) as Array<[AspectRatio, typeof ASPECT_DIMS[AspectRatio]]>).map(([key, dim]) => (
              <button
                key={key}
                onClick={() => setAspect(key)}
                className={`p-2 rounded border text-xs ${
                  aspect === key ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted'
                }`}
                title={dim.label}
              >
                <div className="font-mono font-bold">{key}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{dim.label}</div>
              </button>
            ))}
          </div>
        </div>

        <Button onClick={handleGenerate} disabled={generating || !selectedProv?.ready} className="w-full">
          {generating ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Üretiliyor</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-1.5" /> Görsel Üret {selectedProv && `(~$${selectedProv.costPerImage.toFixed(2)})`}</>
          )}
        </Button>
      </div>

      {/* Sağ panel: kalıcı kütüphane */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Kütüphane <span className="text-xs font-normal text-muted-foreground">({assets.length})</span></h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => setFilterFavorite(!filterFavorite)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                filterFavorite ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300' : 'bg-muted hover:bg-muted/70'
              }`}
            >
              <Star className={`h-3 w-3 ${filterFavorite ? 'fill-current' : ''}`} /> Favoriler
            </button>
            <button onClick={loadAssets} className="h-7 w-7 grid place-items-center rounded hover:bg-muted" title="Yenile">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
        {assets.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">{filterFavorite ? 'Favori görsel yok' : 'Henüz görsel yok'}</p>
            <p className="text-xs text-muted-foreground">Soldaki formu doldurup üret. Üretilenler buraya kalıcı kaydedilir.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {assets.map((a) => {
              const meta = a.metadata ?? {};
              const realAspect = meta.width && meta.height
                ? `${meta.width} / ${meta.height}`
                : '1 / 1';
              return (
              <div key={a.id} className="rounded-xl border bg-card overflow-hidden group relative">
                <div
                  className="relative bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]"
                  style={{ aspectRatio: realAspect }}
                >
                  <img src={a.url} alt="" className="w-full h-full object-contain" />
                  <button
                    onClick={() => toggleFavorite(a.id, a.favorite)}
                    className={`absolute top-1.5 right-1.5 h-7 w-7 grid place-items-center rounded-full backdrop-blur transition-colors ${
                      a.favorite ? 'bg-amber-500/90 text-white' : 'bg-black/40 text-white hover:bg-amber-500/80'
                    }`}
                    title={a.favorite ? 'Favoriden çıkar' : 'Favorile'}
                  >
                    <Star className={`h-3.5 w-3.5 ${a.favorite ? 'fill-current' : ''}`} />
                  </button>
                </div>
                <div className="p-2.5 space-y-2">
                  <p className="text-[11px] line-clamp-2 text-muted-foreground">{a.prompt}</p>
                  <button
                    type="button"
                    onClick={() => setShareAsset({ url: a.url, type: 'image' })}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-brand text-white text-[11px] font-semibold hover:bg-brand/90 transition-colors"
                  >
                    <Sparkles className="h-3 w-3" /> Sosyal Medyada Paylaş
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">{a.provider}</span>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.origin + a.url);
                          toast.success('URL kopyalandı');
                        }}
                        className="h-6 w-6 grid place-items-center rounded hover:bg-muted"
                        title="URL kopyala"
                      ><Copy className="h-3 w-3" /></button>
                      <a href={a.url} download className="h-6 w-6 grid place-items-center rounded hover:bg-muted" title="İndir">
                        <Download className="h-3 w-3" />
                      </a>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="h-6 w-6 grid place-items-center rounded hover:bg-rose-100 hover:text-rose-600"
                        title="Sil"
                      ><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {shareAsset && (
        <CreateSocialPostModal
          siteId={siteId}
          initialAsset={shareAsset}
          onClose={() => setShareAsset(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
//  Text Studio
// ─────────────────────────────────────────────────────

function TextStudio({ siteId }: { siteId: string }) {
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState<'short' | 'medium' | 'long'>('medium');
  const [tone, setTone] = useState('akıcı ve profesyonel');
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [filterFavorite, setFilterFavorite] = useState(false);

  const loadAssets = async () => {
    try {
      const rows = await api.listStudioAssets(siteId, { type: 'TEXT', favorite: filterFavorite });
      setAssets(rows);
    } catch { /* sessiz */ }
  };

  useEffect(() => { loadAssets(); }, [siteId, filterFavorite]);

  const handleGenerate = async () => {
    if (prompt.trim().length < 5) {
      toast.error('Prompt en az 5 karakter olmalı');
      return;
    }
    setGenerating(true);
    try {
      const r = await api.generateStudioText(siteId, { prompt: prompt.trim(), format, tone, language: 'tr' });
      if (r.ok && r.text) {
        toast.success(`Metin hazır (~$${(r.costUsd ?? 0).toFixed(4)})`);
        await loadAssets();
      } else {
        toast.error(r.error || 'Metin üretilemedi');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const toggleFavorite = async (id: string, current: boolean) => {
    try {
      await api.updateStudioAsset(id, { favorite: !current });
      setAssets(prev => prev.map(a => a.id === id ? { ...a, favorite: !current } : a));
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu metin silinsin mi?')) return;
    try {
      await api.deleteStudioAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      toast.success('Silindi');
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      {/* Sol panel: form */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-semibold flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Hızlı erişim: Sosyal Kampanya</p>
          <p className="text-muted-foreground leading-snug">
            Birden fazla kanala (X / Insta / LinkedIn) tek seferde AI ile post üretmek için
          </p>
          <Link href={`/sites/${siteId}/calendar`} className="inline-flex items-center gap-1 text-brand text-[11px] font-semibold hover:underline">
            Takvim'e git <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block">Serbest Yazma</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Örn: KOBİ'ler için 2026 vergi takvimi giriş paragrafı"
            className="w-full min-h-32 px-3 py-2 rounded border bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block">Uzunluk</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { key: 'short' as const, label: 'Kısa', desc: '50-100 kelime' },
              { key: 'medium' as const, label: 'Orta', desc: '150-250' },
              { key: 'long' as const, label: 'Uzun', desc: '300-500' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setFormat(opt.key)}
                className={`p-2 rounded border text-xs ${
                  format === opt.key ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold mb-1.5 block">Ton</label>
          <select
            value={tone}
            onChange={e => setTone(e.target.value)}
            className="w-full px-3 py-2 rounded border bg-background text-sm"
          >
            <option value="akıcı ve profesyonel">Akıcı + profesyonel (varsayılan)</option>
            <option value="dostane, samimi">Dostane, samimi</option>
            <option value="kısa, etkili, çağrı yapan">Etkili + çağrı (CTA tonu)</option>
            <option value="ciddi, teknik">Ciddi, teknik</option>
            <option value="eğlenceli, mizahi">Eğlenceli, mizahi</option>
            <option value="resmi, kurumsal">Resmi, kurumsal</option>
          </select>
        </div>

        <Button onClick={handleGenerate} disabled={generating} className="w-full">
          {generating ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Yazıyor</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-1.5" /> Metin Üret</>
          )}
        </Button>
      </div>

      {/* Sağ panel: kalıcı kütüphane */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Kütüphane <span className="text-xs font-normal text-muted-foreground">({assets.length})</span></h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => setFilterFavorite(!filterFavorite)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                filterFavorite ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300' : 'bg-muted hover:bg-muted/70'
              }`}
            >
              <Star className={`h-3 w-3 ${filterFavorite ? 'fill-current' : ''}`} /> Favoriler
            </button>
            <button onClick={loadAssets} className="h-7 w-7 grid place-items-center rounded hover:bg-muted" title="Yenile">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
        {assets.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
            <Type className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">{filterFavorite ? 'Favori metin yok' : 'Henüz metin yok'}</p>
            <p className="text-xs text-muted-foreground">Konu yaz, ton seç, üret. Üretilenler kalıcı saklanır.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assets.map((a) => (
              <TextResult key={a.id} item={a} onToggleFavorite={toggleFavorite} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TextResult({
  item, onToggleFavorite, onDelete,
}: {
  item: { id: string; text: string | null; prompt: string; metadata?: any; favorite: boolean; createdAt: string };
  onToggleFavorite: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const tokens = item.metadata?.tokens;
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground line-clamp-1">{item.prompt}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => onToggleFavorite(item.id, item.favorite)}
            className={`h-7 w-7 grid place-items-center rounded ${
              item.favorite ? 'text-amber-600' : 'text-muted-foreground hover:text-amber-600 hover:bg-muted'
            }`}
            title={item.favorite ? 'Favoriden çıkar' : 'Favorile'}
          >
            <Star className={`h-3.5 w-3.5 ${item.favorite ? 'fill-current' : ''}`} />
          </button>
          <button
            onClick={() => {
              if (item.text) navigator.clipboard.writeText(item.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-muted"
          >
            {copied ? <><Check className="h-3 w-3 text-emerald-600" /> Kopyalandı</> : <><Copy className="h-3 w-3" /> Kopyala</>}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="h-7 w-7 grid place-items-center rounded text-muted-foreground hover:bg-rose-100 hover:text-rose-600"
            title="Sil"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{item.text}</p>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {tokens && <span>~{tokens} token</span>}
        <span>· {new Date(item.createdAt).toLocaleString('tr-TR')}</span>
      </div>
    </div>
  );
}
