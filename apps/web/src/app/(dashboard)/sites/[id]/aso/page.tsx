'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Smartphone, Plus, Trash2, RefreshCw, Star, MessageSquare, TrendingUp,
  Apple, Bot, Search, Globe, Trophy, ArrowUp, ArrowDown, Minus, X, Sparkles, Check, Info,
  Image as ImageIcon,
} from 'lucide-react';

/** Hover tooltip — küçük (i) ikonu + çıkan açıklama balonu. */
function HelpTip({ text, side = 'bottom' }: { text: string; side?: 'top' | 'bottom' }) {
  return (
    <span className="relative group inline-flex items-center align-middle">
      <Info className="h-3 w-3 text-muted-foreground/70 hover:text-foreground cursor-help ml-1" />
      <span
        role="tooltip"
        className={`invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150
                    absolute left-1/2 -translate-x-1/2 ${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
                    px-3 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200
                    text-[11px] rounded-md shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700
                    w-64 z-[100] whitespace-normal leading-snug font-normal text-left pointer-events-none`}
        style={{ backgroundColor: undefined }}
      >
        {/* Pointer arrow */}
        <span
          className={`absolute left-1/2 -translate-x-1/2 ${side === 'top' ? 'top-full' : 'bottom-full'}
                      h-2 w-2 rotate-45 bg-white dark:bg-slate-900
                      ring-1 ring-slate-200 dark:ring-slate-700`}
          style={{ marginTop: side === 'top' ? -4 : undefined, marginBottom: side === 'bottom' ? -4 : undefined }}
        />
        <span className="relative">{text}</span>
      </span>
    </span>
  );
}

interface TrackedApp {
  id: string;
  name: string;
  appStoreId: string | null;
  playStoreId: string | null;
  country: string;
  iconUrl: string | null;
  developer: string | null;
  category: string | null;
  iosRating: number | null;
  iosReviewCount: number | null;
  androidRating: number | null;
  androidReviewCount: number | null;
  lastFetchedAt: string | null;
  createdAt: string;
  _count?: { keywords: number; reviews: number };
}

interface TrackedKeyword {
  id: string;
  keyword: string;
  store: 'IOS' | 'ANDROID';
  popularity: number | null;
  difficulty: number | null;
  traffic: number | null;
  currentRank: number | null;
  previousRank: number | null;
  bestRank: number | null;
  source: string;
  lastCheckedAt: string | null;
}

interface AppDetail extends TrackedApp {
  keywords: TrackedKeyword[];
}

export default function AsoPage() {
  const { site } = useSiteContext();
  const router = useRouter();
  const [apps, setApps] = useState<TrackedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [selected, setSelected] = useState<AppDetail | null>(null);

  const loadApps = async () => {
    try {
      const data = await api.request<TrackedApp[]>(`/sites/${site.id}/aso/apps`);
      setApps(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, [site.id]);

  const openApp = async (id: string) => {
    try {
      const data = await api.request<AppDetail>(`/sites/${site.id}/aso/apps/${id}`);
      setSelected(data);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const removeApp = async (id: string) => {
    if (!confirm('Bu app\'i izlemekten çıkar — tüm keyword ve review verileri silinir.')) return;
    try {
      await api.request(`/sites/${site.id}/aso/apps/${id}`, { method: 'DELETE' });
      setApps(apps.filter(a => a.id !== id));
      if (selected?.id === id) setSelected(null);
      toast.success('Silindi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 grid place-items-center">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              ASO — Mobil App Optimization
              <Badge variant="outline" className="text-xs">Yeni</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              App Store + Play Store. Keyword sıralama, rakip takibi, AI metadata optimize, review sentiment.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowConnect(true)}>
          <Plus className="h-4 w-4 mr-2" />
          App Ekle
        </Button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : apps.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Smartphone className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <h3 className="font-semibold mb-2">Henüz takip edilen app yok</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
              App Store ID'si veya Play Store package adı ekleyerek başla.
              Hem keyword sıralama hem AI keyword araştırma + review sentiment otomatik aktif olur.
            </p>
            <Button onClick={() => setShowConnect(true)}>
              <Plus className="h-4 w-4 mr-2" />
              İlk app'i ekle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map(app => (
            <Card key={app.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => openApp(app.id)}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  {app.iconUrl ? (
                    <img src={app.iconUrl} alt="" className="h-14 w-14 rounded-xl shrink-0" />
                  ) : (
                    <div className="h-14 w-14 rounded-xl bg-muted grid place-items-center shrink-0">
                      <Smartphone className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{app.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">{app.developer ?? ''}</p>
                    <div className="flex gap-1 mt-1">
                      {app.appStoreId && <Badge variant="outline" className="text-[10px]"><Apple className="h-2.5 w-2.5 mr-1" />iOS</Badge>}
                      {app.playStoreId && <Badge variant="outline" className="text-[10px]">Android</Badge>}
                      <Badge variant="outline" className="text-[10px]"><Globe className="h-2.5 w-2.5 mr-1" />{app.country.toUpperCase()}</Badge>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-3 border-t border-border/40 pt-3">
                  {app.iosRating != null && (
                    <div>
                      <div className="text-muted-foreground">iOS rating</div>
                      <div className="font-bold flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {app.iosRating.toFixed(1)}</div>
                    </div>
                  )}
                  {app.androidRating != null && (
                    <div>
                      <div className="text-muted-foreground">Android rating</div>
                      <div className="font-bold flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {app.androidRating.toFixed(1)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-muted-foreground">Keywords</div>
                    <div className="font-bold">{app._count?.keywords ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Reviews</div>
                    <div className="font-bold">{app._count?.reviews ?? 0}</div>
                  </div>
                </div>
                <div className="flex gap-1.5 pt-3 mt-3 border-t border-border/40" onClick={e => e.stopPropagation()}>
                  <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => openApp(app.id)}>
                    Aç
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => router.push(`/sites/${site.id}/aso/${app.id}/screenshots`)} title="Screenshot Studio">
                    <ImageIcon className="h-3 w-3 mr-1" />Studio
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-2 text-rose-600 hover:bg-rose-500/10" onClick={() => removeApp(app.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* CONNECT MODAL */}
      {showConnect && (
        <ConnectAppModal siteId={site.id} onClose={() => setShowConnect(false)} onAdded={(app) => { setApps([app, ...apps]); setShowConnect(false); openApp(app.id); }} />
      )}

      {/* APP DETAIL MODAL */}
      {selected && (
        <AppDetailModal app={selected} siteId={site.id} onClose={() => setSelected(null)} onChanged={() => { loadApps(); openApp(selected.id); }} />
      )}
    </div>
  );
}

interface SearchResult {
  id: string;
  store: 'IOS' | 'ANDROID';
  name: string;
  developer?: string;
  icon?: string;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
}

function ConnectAppModal({ siteId, onClose, onAdded }: { siteId: string; onClose: () => void; onAdded: (app: TrackedApp) => void }) {
  const [tab, setTab] = useState<'search' | 'manual'>('search');
  const [country, setCountry] = useState('tr');
  const [storeFilter, setStoreFilter] = useState<'BOTH' | 'IOS' | 'ANDROID'>('BOTH');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedIos, setPickedIos] = useState<SearchResult | null>(null);
  const [pickedAndroid, setPickedAndroid] = useState<SearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Manual fallback
  const [manualIos, setManualIos] = useState('');
  const [manualAndroid, setManualAndroid] = useState('');

  // Debounce search input (350ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Trigger search
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const params = new URLSearchParams({
      term: debouncedQuery,
      store: storeFilter,
      country,
    });
    api.request<{ results: SearchResult[]; parsedUrl?: any }>(`/sites/${siteId}/aso/search?${params}`)
      .then(res => {
        if (cancelled) return;
        setResults(res.results || []);
      })
      .catch(err => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQuery, storeFilter, country, siteId]);

  const pick = (r: SearchResult) => {
    if (r.store === 'IOS') {
      setPickedIos(pickedIos?.id === r.id ? null : r);
    } else {
      setPickedAndroid(pickedAndroid?.id === r.id ? null : r);
    }
  };

  const isPicked = (r: SearchResult) =>
    (r.store === 'IOS' && pickedIos?.id === r.id) ||
    (r.store === 'ANDROID' && pickedAndroid?.id === r.id);

  const submit = async () => {
    let appStoreId: string | undefined;
    let playStoreId: string | undefined;

    if (tab === 'search') {
      appStoreId = pickedIos?.id;
      playStoreId = pickedAndroid?.id;
    } else {
      appStoreId = manualIos.trim() || undefined;
      playStoreId = manualAndroid.trim() || undefined;
    }

    if (!appStoreId && !playStoreId) {
      toast.error('En az 1 app seç veya manuel ID gir');
      return;
    }
    setSubmitting(true);
    try {
      const app = await api.request<TrackedApp>(`/sites/${siteId}/aso/apps`, {
        method: 'POST',
        body: JSON.stringify({ appStoreId, playStoreId, country }),
      });
      toast.success('App eklendi');
      onAdded(app);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isUrl = query.trim().startsWith('http');
  const totalPicked = (pickedIos ? 1 : 0) + (pickedAndroid ? 1 : 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border rounded-lg max-w-2xl w-full my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-bold">App Bağla</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* TABS */}
        <div className="border-b flex">
          <button
            onClick={() => setTab('search')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'search' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Search className="h-3.5 w-3.5 inline mr-1.5" />
            Ara / URL Yapıştır
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'manual' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Manuel ID
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* COUNTRY + STORE FILTER (her tab'de) */}
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="text-xs font-medium mb-1 block">Ülke</label>
              <select value={country} onChange={e => setCountry(e.target.value)} className="h-9 px-2 rounded-md border border-input text-sm bg-background">
                <option value="tr">🇹🇷 Türkiye</option>
                <option value="us">🇺🇸 USA</option>
                <option value="gb">🇬🇧 UK</option>
                <option value="de">🇩🇪 Germany</option>
                <option value="fr">🇫🇷 France</option>
                <option value="ar">🇦🇪 BAE/Arapça</option>
                <option value="ru">🇷🇺 Russia</option>
              </select>
            </div>
            {tab === 'search' && (
              <div>
                <label className="text-xs font-medium mb-1 block">Store</label>
                <div className="flex border rounded-md overflow-hidden h-9">
                  {(['BOTH', 'IOS', 'ANDROID'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStoreFilter(s)}
                      className={`px-3 text-xs ${storeFilter === s ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
                    >
                      {s === 'BOTH' ? 'Hepsi' : s === 'IOS' ? 'iOS' : 'Android'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {tab === 'search' && (
            <>
              <div>
                <label className="text-xs font-medium mb-1 block">App ara veya URL yapıştır</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="örn: spotify  /  https://apps.apple.com/.../id..."
                    className="pl-8"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {isUrl ? '🔗 URL algılandı — direkt çekiliyor' : 'En az 2 harf yaz, sonuçlar otomatik gelir'}
                </p>
              </div>

              {/* SEARCH RESULTS */}
              <div className="min-h-[200px] max-h-[420px] overflow-y-auto -mx-1 px-1">
                {searching && (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
                  </div>
                )}
                {!searching && results.length === 0 && query.length >= 2 && (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    Sonuç bulunamadı.
                  </div>
                )}
                {!searching && results.length === 0 && query.length < 2 && (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    Yukarı kutuya app adı yaz.
                  </div>
                )}
                {!searching && results.length > 0 && (
                  <div className="space-y-1.5">
                    {results.map(r => (
                      <button
                        key={`${r.store}-${r.id}`}
                        onClick={() => pick(r)}
                        className={`w-full text-left flex items-center gap-3 p-2.5 rounded-md border transition-colors ${
                          isPicked(r)
                            ? 'border-brand bg-brand/5'
                            : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                        }`}
                      >
                        {r.icon ? (
                          <img src={r.icon} alt="" className="h-12 w-12 rounded-lg shrink-0" />
                        ) : (
                          <div className="h-12 w-12 rounded-lg bg-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-medium text-sm truncate">{r.name}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {r.store === 'IOS' ? <><Apple className="h-2.5 w-2.5 mr-1" />iOS</> : 'Android'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{r.developer ?? '—'}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {r.rating != null && (
                              <span className="text-xs flex items-center gap-0.5"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)}</span>
                            )}
                            {r.category && (
                              <span className="text-xs text-muted-foreground">· {r.category}</span>
                            )}
                          </div>
                        </div>
                        {isPicked(r) && (
                          <div className="h-6 w-6 rounded-full bg-brand text-white grid place-items-center shrink-0">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* SEÇİLENLER ÖZETİ */}
              {totalPicked > 0 && (
                <div className="flex items-center gap-2 p-3 bg-brand/5 border border-brand/20 rounded-md">
                  <Check className="h-4 w-4 text-brand shrink-0" />
                  <div className="text-xs flex-1">
                    <strong>{totalPicked}</strong> app seçildi:
                    {pickedIos && <span className="ml-1 text-brand"> iOS · {pickedIos.name}</span>}
                    {pickedAndroid && <span className="ml-1 text-brand"> Android · {pickedAndroid.name}</span>}
                  </div>
                  <button
                    onClick={() => { setPickedIos(null); setPickedAndroid(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Temizle
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'manual' && (
            <>
              <div>
                <label className="text-xs font-medium mb-1 block flex items-center gap-1.5"><Apple className="h-3 w-3" /> App Store ID (iOS)</label>
                <Input value={manualIos} onChange={e => setManualIos(e.target.value)} placeholder="örn: 6444904356" />
                <p className="text-xs text-muted-foreground mt-1">App Store URL'inde id sonrası: apps.apple.com/.../id<strong>6444904356</strong></p>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Play Store Package (Android)</label>
                <Input value={manualAndroid} onChange={e => setManualAndroid(e.target.value)} placeholder="örn: com.example.app" />
                <p className="text-xs text-muted-foreground mt-1">Play Store URL'inde id=...: play.google.com/store/apps/details?id=<strong>com.example.app</strong></p>
              </div>
              <p className="text-xs text-muted-foreground">
                En az birini doldurman yeter.
              </p>
            </>
          )}
        </div>

        <div className="p-4 border-t flex justify-between items-center gap-2 bg-muted/20">
          <span className="text-xs text-muted-foreground">
            {tab === 'search'
              ? (totalPicked > 0 ? `${totalPicked} app seçili` : 'En az 1 app seç')
              : 'iOS veya Android ID gir'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>İptal</Button>
            <Button size="sm" onClick={submit} disabled={submitting || (tab === 'search' && totalPicked === 0)}>
              {submitting ? 'Ekleniyor...' : 'Bağla'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppDetailModal({ app, siteId, onClose, onChanged }: {
  app: AppDetail; siteId: string; onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'keywords' | 'ai' | 'reviews' | 'optimize'>('keywords');
  const [newKeyword, setNewKeyword] = useState('');
  const [keywordStore, setKeywordStore] = useState<'IOS' | 'ANDROID'>(app.appStoreId ? 'IOS' : 'ANDROID');
  const [adding, setAdding] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [aiResearching, setAiResearching] = useState(false);
  const [aiResults, setAiResults] = useState<Array<{ keyword: string; source: string; relevance: number }>>([]);
  const [reviewStats, setReviewStats] = useState<any>(null);
  const [fetchingReviews, setFetchingReviews] = useState(false);

  // Per-keyword loading state during rank check (id'ler set'te)
  const [checkingKeywords, setCheckingKeywords] = useState<Set<string>>(new Set());
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [bulkRankProgress, setBulkRankProgress] = useState<{ done: number; total: number } | null>(null);

  // ASO Audit + Optimize state
  const [auditData, setAuditData] = useState<any>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [optimizeStore, setOptimizeStore] = useState<'IOS' | 'ANDROID'>(app.appStoreId ? 'IOS' : 'ANDROID');
  const [selectedKwForOptimize, setSelectedKwForOptimize] = useState<Set<string>>(new Set());
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<any>(null);

  // Link store (ikinci store ekleme) state
  const [showLinkStore, setShowLinkStore] = useState(false);

  // Auto-load review stats on Reviews tab open (persist across modal reopens)
  useEffect(() => {
    if (tab !== 'reviews' || reviewStats) return;
    api.request(`/sites/${siteId}/aso/apps/${app.id}/reviews/stats`)
      .then(setReviewStats)
      .catch(() => { /* silent — first time has no data yet */ });
  }, [tab, app.id, siteId]);

  // Auto-load audit on Optimize tab open
  useEffect(() => {
    if (tab !== 'optimize' || auditData) return;
    setAuditLoading(true);
    api.request(`/sites/${siteId}/aso/apps/${app.id}/audit`)
      .then(setAuditData)
      .catch((err: any) => toast.error(err.message))
      .finally(() => setAuditLoading(false));
  }, [tab, app.id, siteId]);

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keyword: newKeyword.trim(), store: keywordStore }),
      });
      setNewKeyword('');
      onChanged();
      toast.success('Eklendi (skor hesaplanıyor)');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const addBulk = async () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setAdding(true);
    try {
      const r = await api.request<{ count: number }>(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keywords: lines, store: keywordStore }),
      });
      setBulkText('');
      onChanged();
      toast.success(`${r.count} keyword eklendi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const removeKw = async (id: string) => {
    try {
      await api.request(`/sites/${siteId}/aso/keywords/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const checkRank = async (id: string) => {
    setCheckingKeywords(prev => new Set(prev).add(id));
    try {
      await api.request(`/sites/${siteId}/aso/keywords/${id}/check-rank`, { method: 'POST' });
      onChanged();
      toast.success('Rank kontrol edildi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCheckingKeywords(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const checkAllRanks = async () => {
    if (!app.keywords || app.keywords.length === 0) {
      toast.error('Önce keyword ekle');
      return;
    }
    const total = app.keywords.length;
    setBulkRankProgress({ done: 0, total });
    // Tüm keyword'leri "checking" state'ine al
    setCheckingKeywords(new Set(app.keywords.map(k => k.id)));
    try {
      toast.info(`${total} keyword için rank check başladı (~${Math.ceil(total * 1.5)} sn)`);
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/check-all-ranks`, { method: 'POST' });
      onChanged();
      toast.success('Tüm rank check tamamlandı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCheckingKeywords(new Set());
      setBulkRankProgress(null);
    }
  };

  const refreshScores = async () => {
    if (!app.keywords || app.keywords.length === 0) return;
    setRefreshingScores(true);
    try {
      toast.info(`${app.keywords.length} keyword için skor yeniden hesaplanıyor (~${Math.ceil(app.keywords.length * 0.6)} sn)`);
      const r = await api.request<{ updated: number; total: number }>(`/sites/${siteId}/aso/apps/${app.id}/refresh-scores`, { method: 'POST' });
      onChanged();
      toast.success(`${r.updated}/${r.total} keyword skoru güncellendi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRefreshingScores(false);
    }
  };

  const aiResearch = async () => {
    setAiResearching(true);
    try {
      const r = await api.request<Array<{ keyword: string; source: string; relevance: number }>>(`/sites/${siteId}/aso/apps/${app.id}/ai-keyword-research`, {
        method: 'POST',
        body: JSON.stringify({ locale: app.country === 'tr' ? 'tr' : 'en' }),
      });
      setAiResults(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAiResearching(false);
    }
  };

  const addAiKeyword = async (kw: string) => {
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keyword: kw, store: keywordStore, source: 'AI_SUGGESTED' }),
      });
      onChanged();
      setAiResults(aiResults.filter(r => r.keyword !== kw));
      toast.success('Eklendi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const fetchReviews = async () => {
    setFetchingReviews(true);
    try {
      toast.info('Review fetch + sentiment analizi başladı (LLM kullanır)');
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/reviews/fetch`, {
        method: 'POST',
        body: JSON.stringify({ limit: 50, analyzeSentiment: true }),
      });
      const stats = await api.request(`/sites/${siteId}/aso/apps/${app.id}/reviews/stats`);
      setReviewStats(stats);
      toast.success('Tamamlandı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFetchingReviews(false);
    }
  };

  const runOptimize = async () => {
    const targetKeywords = (app.keywords ?? [])
      .filter(k => selectedKwForOptimize.has(k.id))
      .map(k => k.keyword);
    if (targetKeywords.length === 0) {
      toast.error('En az 1 keyword seç (Keywords tab\'ından)');
      return;
    }
    setOptimizing(true);
    try {
      toast.info(`AI ${targetKeywords.length} keyword için ${optimizeStore} metadata öneriyor (~30 sn)`);
      const result = await api.request<any>(`/sites/${siteId}/aso/apps/${app.id}/optimize-metadata`, {
        method: 'POST',
        body: JSON.stringify({
          targetKeywords,
          store: optimizeStore,
          locale: app.country === 'tr' ? 'tr' : 'en',
        }),
      });
      setOptimizeResult(result);
      toast.success('AI metadata önerisi hazır');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOptimizing(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} panoya kopyalandı`);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border rounded-lg max-w-4xl w-full my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        {/* HEADER */}
        <div className="p-5 border-b flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {app.iconUrl && <img src={app.iconUrl} alt="" className="h-12 w-12 rounded-xl" />}
            <div>
              <h3 className="font-bold flex items-center gap-2 flex-wrap">
                {app.name}
                {app.appStoreId && <Badge variant="outline" className="text-[10px]"><Apple className="h-2.5 w-2.5 mr-1" />iOS</Badge>}
                {app.playStoreId && <Badge variant="outline" className="text-[10px]">Android</Badge>}
                <Badge variant="outline" className="text-[10px]"><Globe className="h-2.5 w-2.5 mr-1" />{app.country.toUpperCase()}</Badge>
              </h3>
              <p className="text-xs text-muted-foreground">{app.developer} · {app.category}</p>
              {(!app.appStoreId || !app.playStoreId) && (
                <button
                  onClick={() => setShowLinkStore(true)}
                  className="text-xs text-brand hover:underline mt-1 inline-flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  {!app.appStoreId ? 'iOS App Store versiyonunu ekle' : 'Android Play Store versiyonunu ekle'}
                </button>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* TABS */}
        <div className="border-b flex overflow-x-auto">
          {(['keywords', 'optimize', 'ai', 'reviews'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'keywords' ? `Keywords (${app.keywords?.length ?? 0})` :
               t === 'optimize' ? '⚡ Optimize' :
               t === 'ai' ? 'AI Asistan' :
               'Reviews'}
            </button>
          ))}
        </div>

        {/* KEYWORDS TAB */}
        {tab === 'keywords' && (
          <div className="p-5 space-y-4">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium mb-1 block">Tek Keyword Ekle</label>
                <Input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="örn: hosting" onKeyDown={e => e.key === 'Enter' && addKeyword()} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Store</label>
                <select value={keywordStore} onChange={e => setKeywordStore(e.target.value as any)} className="h-9 px-2 rounded-md border border-input text-sm bg-background">
                  {app.appStoreId && <option value="IOS">iOS</option>}
                  {app.playStoreId && <option value="ANDROID">Android</option>}
                </select>
              </div>
              <Button size="sm" onClick={addKeyword} disabled={adding}>
                <Plus className="h-4 w-4 mr-1" />Ekle
              </Button>
              <Button size="sm" variant="outline" onClick={checkAllRanks} disabled={!!bulkRankProgress || (app.keywords?.length ?? 0) === 0}>
                <RefreshCw className={`h-4 w-4 mr-1 ${bulkRankProgress ? 'animate-spin' : ''}`} />
                {bulkRankProgress ? 'Çekiliyor...' : "Tüm Rank'leri Çek"}
              </Button>
              <Button size="sm" variant="outline" onClick={refreshScores} disabled={refreshingScores || (app.keywords?.length ?? 0) === 0} title="aso-v2 ile Pop/Diff/Traffic skorlarını yeniden hesaplar">
                <Sparkles className={`h-4 w-4 mr-1 ${refreshingScores ? 'animate-spin' : ''}`} />
                {refreshingScores ? 'Hesaplanıyor...' : 'Skorları Yenile'}
              </Button>
            </div>

            {/* Progress bar — bulk işlemlerde */}
            {(bulkRankProgress || refreshingScores) && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-3 flex items-center gap-3">
                <RefreshCw className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
                <div className="flex-1 text-xs">
                  <div className="font-medium">
                    {bulkRankProgress ? `Rank check çalışıyor — ${app.keywords?.length} keyword için ~${Math.ceil((app.keywords?.length ?? 0) * 1.5)} sn` : 'Skor hesaplanıyor — her keyword için ~600ms'}
                  </div>
                  <div className="text-muted-foreground">
                    Modal'ı kapatma — işlem arka planda devam eder ama UI güncelleme kaybolur.
                  </div>
                </div>
              </div>
            )}

            {/* AI öneri paneli — uygulamaya göre keyword önerir */}
            {aiResults.length === 0 ? (
              <div className="bg-gradient-to-r from-purple-500/5 via-purple-500/10 to-transparent border border-purple-500/20 rounded-lg p-4 flex items-center gap-3 flex-wrap">
                <div className="h-9 w-9 rounded-lg bg-purple-500/15 text-purple-600 grid place-items-center shrink-0">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-semibold flex items-center gap-1.5">
                    Hangi keyword'leri ekleyeceğini bilmiyor musun?
                    <HelpTip text="AI uygulamanın açıklamasını + rakip metadata'larını analiz eder, sana özel 30-50 keyword önerisi çıkarır. Her birinin yanındaki + ile direkt takibe ekleyebilirsin." side="bottom" />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    AI uygulamana göre keyword önersin — rakipleri analiz eder, en alakalı 30+ öneri çıkarır.
                  </div>
                </div>
                <Button size="sm" onClick={aiResearch} disabled={aiResearching}>
                  <Sparkles className={`h-4 w-4 mr-1.5 ${aiResearching ? 'animate-spin' : ''}`} />
                  {aiResearching ? 'AI çalışıyor (~30 sn)...' : 'AI önerisi al'}
                </Button>
              </div>
            ) : (
              <div className="border border-purple-500/20 rounded-lg overflow-hidden">
                <div className="bg-purple-500/5 px-4 py-2.5 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    AI önerisi {' · '}<span className="text-muted-foreground font-normal">{aiResults.length} keyword</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTab('ai')}>
                      Tümünü gör →
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setAiResults([])} title="Önerileri kapat">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-3 flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto">
                  {aiResults.slice(0, 12).map(r => (
                    <button
                      key={r.keyword}
                      onClick={() => addAiKeyword(r.keyword)}
                      className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors"
                      title={`Relevance: ${r.relevance}/10 — Kaynak: ${r.source === 'competitor' ? 'rakipten' : 'AI'}`}
                    >
                      <span className="font-medium">{r.keyword}</span>
                      <span className="text-muted-foreground/70">·</span>
                      <span className="text-purple-600/80 font-medium">{r.relevance}/10</span>
                      <Plus className="h-3 w-3 text-muted-foreground group-hover:text-purple-600" />
                    </button>
                  ))}
                  {aiResults.length > 12 && (
                    <button
                      onClick={() => setTab('ai')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-purple-600 hover:bg-purple-500/5"
                    >
                      +{aiResults.length - 12} daha...
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium mb-1 block">Toplu Ekle (her satır 1 keyword)</label>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={3}
                className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background"
                placeholder="hosting&#10;cloud hosting&#10;ucuz hosting"
              />
              <Button size="sm" variant="outline" className="mt-1" onClick={addBulk} disabled={adding || !bulkText.trim()}>
                Toplu Ekle
              </Button>
            </div>

            {/* Keyword listesi */}
            {app.keywords && app.keywords.length > 0 && (
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">
                        <span className="inline-flex items-center">
                          Keyword
                          <HelpTip text="Takip ettiğin arama terimi. Kullanıcılar App Store / Play Store'da bunu yazınca senin app'in çıkmasını istiyorsun." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Store
                          <HelpTip text="Hangi store'da takip ediliyor: iOS = Apple App Store, Android = Google Play. Bir keyword'ü iki store için ayrı ayrı ekleyebilirsin." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Pop.
                          <HelpTip text="Popularity (0-100): Bu keyword'ün autocomplete önerilerinde ne kadar görünür olduğu. Yüksek = çok aranıyor. aso-v2 traffic.suggest skorundan üretilir." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Diff.
                          <HelpTip text="Difficulty (0-100): Bu keyword'de ranklenmek ne kadar zor. 5 alt-faktörün ortalaması: title eşleşmeleri, rakip sayısı, install hacmi, rating ortalaması, son güncellemeden geçen gün. Yüksek = rakipler güçlü." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Traffic
                          <HelpTip text="Traffic (0-100): Bu keyword'den potansiyel ne kadar trafik gelir. autocomplete + ranked apps + install ortalaması + keyword uzunluğu kombine edilir. Yüksek = ranklenince çok install gelir." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Rank
                          <HelpTip text="Bu keyword için arama sonuçlarında app'inin gerçek sırası (1-100). 'Tüm Rank'leri Çek' butonuna basınca güncellenir. — = top 100 dışında." side="bottom" />
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-semibold">
                        <span className="inline-flex items-center justify-center">
                          Δ
                          <HelpTip text="Delta = sıra değişimi (önceki check'e göre). Yeşil ↑ = sıralaman yükseldi (iyi). Kırmızı ↓ = düştü (kötü). İlk check sonrası gelir." side="bottom" />
                        </span>
                      </th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {app.keywords.map(kw => {
                      const delta = kw.previousRank != null && kw.currentRank != null ? kw.previousRank - kw.currentRank : null;
                      const isChecking = checkingKeywords.has(kw.id);
                      return (
                        <tr key={kw.id} className={`hover:bg-muted/30 ${isChecking ? 'bg-blue-500/5' : ''}`}>
                          <td className="px-3 py-2 font-medium max-w-[200px] truncate">{kw.keyword}</td>
                          <td className="px-2 py-2 text-center">
                            <Badge variant="outline" className="text-[10px]">{kw.store === 'IOS' ? 'iOS' : 'Android'}</Badge>
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums">{kw.popularity != null && kw.popularity > 0 ? kw.popularity.toFixed(0) : '—'}</td>
                          <td className="px-2 py-2 text-center tabular-nums">{kw.difficulty != null && kw.difficulty > 0 ? kw.difficulty.toFixed(0) : '—'}</td>
                          <td className="px-2 py-2 text-center tabular-nums">{kw.traffic != null && kw.traffic > 0 ? kw.traffic.toFixed(0) : '—'}</td>
                          <td className="px-2 py-2 text-center font-bold">
                            {isChecking ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin inline text-blue-600" />
                            ) : kw.currentRank != null ? `#${kw.currentRank}` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {delta == null ? '—' : delta > 0 ? (
                              <span className="inline-flex items-center text-emerald-600 text-xs font-medium"><ArrowUp className="h-3 w-3" />{delta}</span>
                            ) : delta < 0 ? (
                              <span className="inline-flex items-center text-rose-600 text-xs font-medium"><ArrowDown className="h-3 w-3" />{Math.abs(delta)}</span>
                            ) : (
                              <Minus className="h-3 w-3 inline text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => checkRank(kw.id)} title="Rank check" disabled={isChecking}>
                                <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-500/10" onClick={() => removeKw(kw.id)} disabled={isChecking}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* AI ASSISTANT TAB */}
        {tab === 'ai' && (
          <div className="p-5 space-y-4">
            <Card className="bg-purple-500/5 border-purple-500/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Bot className="h-4 w-4 text-purple-600" />
                  AI Keyword Research
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Otomatik rakip keşif + rakip metadata analizi + AI öneri kombinasyonu.
                  app-agent pattern'i kullanır.
                </p>
                <Button size="sm" onClick={aiResearch} disabled={aiResearching}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {aiResearching ? 'AI çalışıyor (~30 sn)...' : 'AI Keyword Research Başlat'}
                </Button>
              </CardContent>
            </Card>

            {aiResults.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">{aiResults.length} keyword önerisi</h4>
                <div className="grid sm:grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-2">
                  {aiResults.map(r => (
                    <Card key={r.keyword}>
                      <CardContent className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{r.keyword}</div>
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px]">{r.source === 'competitor' ? 'Rakipten' : 'AI'}</Badge>
                            <Badge variant="outline" className="text-[10px]">Rel: {r.relevance}/10</Badge>
                          </div>
                        </div>
                        <Button size="sm" className="h-7" onClick={() => addAiKeyword(r.keyword)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* REVIEWS TAB */}
        {tab === 'reviews' && (
          <div className="p-5 space-y-4">
            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-600" />
                  Review Fetch + LLM Sentiment
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Son 50 review'ı her store'dan çeker, Claude Haiku ile sentiment + topic analizi yapar.
                </p>
                <Button size="sm" onClick={fetchReviews} disabled={fetchingReviews}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${fetchingReviews ? 'animate-spin' : ''}`} />
                  {fetchingReviews ? 'Çekiliyor + analiz...' : 'Review Çek + Analiz'}
                </Button>
              </CardContent>
            </Card>

            {reviewStats?.recentReviews?.length > 0 && (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                <h4 className="text-sm font-semibold">{reviewStats.recentReviews.length} son review</h4>
                {reviewStats.recentReviews.map((r: any) => (
                  <Card key={r.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{r.store === 'IOS' ? 'iOS' : 'Android'}</Badge>
                        <span className="text-xs flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`h-3 w-3 ${i < r.rating ? 'fill-amber-400 text-amber-400' : 'text-muted'}`} />
                          ))}
                        </span>
                        {r.sentiment && (
                          <Badge variant="outline" className={`text-[10px] ${
                            r.sentiment === 'POSITIVE' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' :
                            r.sentiment === 'NEGATIVE' ? 'bg-rose-500/10 text-rose-600 border-rose-500/30' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {r.sentiment}
                          </Badge>
                        )}
                        {Array.isArray(r.topics) && r.topics.map((t: string) => (
                          <Badge key={t} variant="outline" className="text-[10px] bg-muted/50">{t}</Badge>
                        ))}
                        <span className="text-xs text-muted-foreground ml-auto">{r.author ?? 'Anonim'}</span>
                      </div>
                      {r.title && <div className="font-medium text-xs mb-1">{r.title}</div>}
                      <p className="text-xs text-muted-foreground line-clamp-3">{r.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* OPTIMIZE TAB */}
        {tab === 'optimize' && (
          <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
            {auditLoading && (
              <div className="space-y-3">
                <Skeleton className="h-32" /><Skeleton className="h-48" /><Skeleton className="h-64" />
              </div>
            )}

            {!auditLoading && auditData && (
              <>
                {/* AUDIT SCORE BANNER */}
                <Card className="bg-gradient-to-r from-brand/5 via-transparent to-transparent border-brand/20">
                  <CardContent className="p-5 flex items-center gap-4 flex-wrap">
                    <div className="text-center min-w-[80px]">
                      <div className={`text-4xl font-bold ${
                        auditData.score >= 80 ? 'text-emerald-600' :
                        auditData.score >= 60 ? 'text-amber-600' :
                        'text-rose-600'
                      }`}>{auditData.grade}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{auditData.score}/100</div>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <h4 className="font-semibold mb-1">ASO Sağlık Skoru</h4>
                      <p className="text-xs text-muted-foreground">
                        Mevcut metadata'nın ASO best practices uyumu. Kötü gelirse aşağıdaki listede ne yapılması gerektiği yazıyor.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-2xl font-bold text-emerald-600">{auditData.summary.ok}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">İyi</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-amber-600">{auditData.summary.warning}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Uyarı</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-rose-600">{auditData.summary.error}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hata</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* CURRENT METADATA + AUDIT FINDINGS */}
                <Card>
                  <CardHeader>
                    <h4 className="font-semibold flex items-center gap-2">
                      📋 Mevcut Metadata + Bulgular
                      <HelpTip text="Apple App Store ve Google Play Store'da app sayfanın şu anki halini ve hatalarını gösterir. Yeşil ✓ = iyi, sarı ⚠ = iyileşebilir, kırmızı ✗ = kritik düzelt." side="bottom" />
                    </h4>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {auditData.findings.map((f: any, i: number) => (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-md border ${
                        f.severity === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5' :
                        f.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/5' :
                        f.severity === 'error' ? 'border-rose-500/20 bg-rose-500/5' :
                        'border-blue-500/20 bg-blue-500/5'
                      }`}>
                        <div className={`shrink-0 h-6 w-6 rounded grid place-items-center text-sm font-bold ${
                          f.severity === 'ok' ? 'bg-emerald-500 text-white' :
                          f.severity === 'warning' ? 'bg-amber-500 text-white' :
                          f.severity === 'error' ? 'bg-rose-500 text-white' :
                          'bg-blue-500 text-white'
                        }`}>
                          {f.severity === 'ok' ? '✓' : f.severity === 'warning' ? '!' : f.severity === 'error' ? '✗' : 'i'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">
                              {f.store === 'IOS' ? <><Apple className="h-2.5 w-2.5 mr-1" />iOS</> : f.store === 'ANDROID' ? 'Android' : 'Hepsi'}
                            </Badge>
                            <span className="font-medium text-sm">{f.label}</span>
                            {f.current != null && f.current !== '' && (
                              <span className="text-xs text-muted-foreground">· {f.current}</span>
                            )}
                          </div>
                          {f.message && <div className="text-xs text-foreground/80 mb-1">{f.message}</div>}
                          {f.recommendation && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">→ Öneri:</span> {f.recommendation}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* CURRENT METADATA PREVIEW */}
                {auditData.currentMetadata.ios && (
                  <Card>
                    <CardHeader>
                      <h4 className="font-semibold flex items-center gap-2">
                        <Apple className="h-4 w-4" /> iOS — Şu anki metadata
                      </h4>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <FieldDisplay label="Title" value={auditData.currentMetadata.ios.title} limit={30} />
                      <FieldDisplay label="Subtitle" value={auditData.currentMetadata.ios.subtitle} limit={30} />
                      <FieldDisplay label="Description" value={auditData.currentMetadata.ios.description} limit={4000} multiline />
                      <FieldDisplay label="Promo Text" value={auditData.currentMetadata.ios.releaseNotes} limit={170} />
                    </CardContent>
                  </Card>
                )}

                {auditData.currentMetadata.android && (
                  <Card>
                    <CardHeader>
                      <h4 className="font-semibold flex items-center gap-2">
                        🤖 Android — Şu anki metadata
                      </h4>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <FieldDisplay label="Title" value={auditData.currentMetadata.android.title} limit={50} />
                      <FieldDisplay label="Short Description" value={auditData.currentMetadata.android.summary} limit={80} />
                      <FieldDisplay label="Long Description" value={auditData.currentMetadata.android.description} limit={4000} multiline />
                    </CardContent>
                  </Card>
                )}

                {/* AI OPTIMIZE PANEL */}
                <Card className="border-purple-500/20 bg-gradient-to-b from-purple-500/5 to-transparent">
                  <CardHeader>
                    <h4 className="font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                      AI ile Yeni Metadata Yazdır
                      <HelpTip text="Hedef keyword'leri seç, AI sana yeni title + subtitle + description + keywords field önerir. Char limit'lerine uyar. Sonra App Store Connect / Play Console'a kopyala-yapıştır." side="bottom" />
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hedef keyword'leri seç + store seç → AI Claude Sonnet ile yeni metadata yazsın.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Keyword multi-select */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium">Hedef keyword'ler ({selectedKwForOptimize.size} seçili)</label>
                        <button onClick={() => setSelectedKwForOptimize(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
                          Temizle
                        </button>
                      </div>
                      {(app.keywords?.length ?? 0) === 0 ? (
                        <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded">
                          Önce Keywords tab'ından keyword ekle.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto p-1">
                          {app.keywords?.filter(k => k.store === optimizeStore).map(k => {
                            const isSelected = selectedKwForOptimize.has(k.id);
                            return (
                              <button
                                key={k.id}
                                onClick={() => {
                                  const next = new Set(selectedKwForOptimize);
                                  if (isSelected) next.delete(k.id); else next.add(k.id);
                                  setSelectedKwForOptimize(next);
                                }}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                  isSelected
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-background border-border hover:border-purple-500/40'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3 inline mr-1" />}
                                {k.keyword}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Store selector */}
                    <div>
                      <label className="text-xs font-medium mb-1 block">Store</label>
                      <div className="flex border rounded-md overflow-hidden h-9 w-fit">
                        {app.appStoreId && (
                          <button
                            onClick={() => setOptimizeStore('IOS')}
                            className={`px-4 text-xs ${optimizeStore === 'IOS' ? 'bg-purple-600 text-white' : 'bg-background hover:bg-muted'}`}
                          >
                            <Apple className="h-3 w-3 inline mr-1" />iOS
                          </button>
                        )}
                        {app.playStoreId && (
                          <button
                            onClick={() => setOptimizeStore('ANDROID')}
                            className={`px-4 text-xs ${optimizeStore === 'ANDROID' ? 'bg-purple-600 text-white' : 'bg-background hover:bg-muted'}`}
                          >
                            Android
                          </button>
                        )}
                      </div>
                    </div>

                    <Button onClick={runOptimize} disabled={optimizing || selectedKwForOptimize.size === 0}>
                      <Sparkles className={`h-4 w-4 mr-2 ${optimizing ? 'animate-spin' : ''}`} />
                      {optimizing ? 'AI çalışıyor (~30 sn)...' : 'AI ile metadata yazdır'}
                    </Button>

                    {/* RESULT */}
                    {optimizeResult && (
                      <div className="space-y-3 mt-4 pt-4 border-t">
                        <h5 className="text-sm font-bold text-purple-600 mb-2">✨ AI Önerisi (App Store Connect/Play Console'a yapıştır)</h5>
                        <FieldResult label="Title" value={optimizeResult.title} limit={optimizeStore === 'IOS' ? 30 : 50} onCopy={(v) => copyToClipboard(v, 'Title')} />
                        {optimizeResult.subtitle && (
                          <FieldResult label={optimizeStore === 'IOS' ? 'Subtitle' : 'Short Description'} value={optimizeResult.subtitle} limit={optimizeStore === 'IOS' ? 30 : 80} onCopy={(v) => copyToClipboard(v, 'Subtitle')} />
                        )}
                        {optimizeResult.keywordField && (
                          <FieldResult label="Keywords field (sadece iOS)" value={optimizeResult.keywordField} limit={100} onCopy={(v) => copyToClipboard(v, 'Keywords')} hint="Apple App Store Connect'te 'App Information → Localizable Information → Keywords' alanına. SPACE YOK, sadece virgül." />
                        )}
                        <FieldResult label="Description" value={optimizeResult.description} limit={4000} multiline onCopy={(v) => copyToClipboard(v, 'Description')} />
                        {Array.isArray(optimizeResult.suggestions) && optimizeResult.suggestions.length > 0 && (
                          <div className="bg-muted/30 rounded p-3 mt-3">
                            <div className="text-xs font-semibold mb-2">💡 AI ek önerileri:</div>
                            <ul className="text-xs space-y-1.5">
                              {optimizeResult.suggestions.map((s: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="text-purple-600">•</span><span>{s}</span></li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* STEP-BY-STEP GUIDE */}
                <Card className="border-blue-500/20 bg-blue-500/5">
                  <CardHeader>
                    <h4 className="font-semibold flex items-center gap-2">📘 Adım Adım — Nasıl uygulayacaksın?</h4>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2.5 text-sm">
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-blue-500 text-white grid place-items-center text-xs font-bold">1</span>
                        <span>Yukarıdaki <strong>"AI ile metadata yazdır"</strong> butonuna bas. AI 30 saniye içinde title/subtitle/description/keywords önerir.</span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-blue-500 text-white grid place-items-center text-xs font-bold">2</span>
                        <span>Her satırın yanındaki <strong>"Kopyala"</strong> butonuyla metni al.</span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-blue-500 text-white grid place-items-center text-xs font-bold">3</span>
                        <span>
                          {optimizeStore === 'IOS' ? (
                            <><a href="https://appstoreconnect.apple.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">App Store Connect</a> → <strong>{app.name}</strong> → <strong>App Information</strong> → <strong>Localizable Information (Turkish)</strong></>
                          ) : (
                            <><a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Google Play Console</a> → <strong>{app.name}</strong> → <strong>Main store listing</strong> → <strong>Türkçe</strong></>
                          )}
                        </span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-blue-500 text-white grid place-items-center text-xs font-bold">4</span>
                        <span>Her alanı <strong>yapıştır</strong> ve <strong>Save</strong>. {optimizeStore === 'IOS' ? 'Sonra "Submit for Review" — Apple 1-2 gün inceler.' : 'Play Console anında yayına alır (review yok).'}</span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-blue-500 text-white grid place-items-center text-xs font-bold">5</span>
                        <span><strong>Yayına çıktıktan 1-2 hafta sonra</strong> Keywords tab'ına dön, "Tüm Rank'leri Çek" tıkla. Δ kolonu yeşil ↑ ise başarı.</span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="shrink-0 h-5 w-5 rounded-full bg-amber-500 text-white grid place-items-center text-xs font-bold">!</span>
                        <span className="text-muted-foreground"><strong>Önemli:</strong> Apple/Google güvenlik nedeniyle 3rd-party tool'ların direkt store'a yazmasını yasaklıyor. Kopyala-yapıştır şu an tek yol.</span>
                      </li>
                    </ol>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </div>

      {/* LINK SECOND STORE MODAL */}
      {showLinkStore && (
        <LinkStoreModal
          siteId={siteId}
          app={app}
          onClose={() => setShowLinkStore(false)}
          onLinked={() => { setShowLinkStore(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function LinkStoreModal({ siteId, app, onClose, onLinked }: {
  siteId: string;
  app: AppDetail;
  onClose: () => void;
  onLinked: () => void;
}) {
  // Hangi store eksikse onu ekleyeceğiz
  const missingStore: 'IOS' | 'ANDROID' = !app.appStoreId ? 'IOS' : 'ANDROID';
  const [query, setQuery] = useState(app.name); // app adıyla başlat — kullanıcı zahmet etmesin
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const params = new URLSearchParams({
      term: debouncedQuery,
      store: missingStore,
      country: app.country,
    });
    api.request<{ results: SearchResult[] }>(`/sites/${siteId}/aso/search?${params}`)
      .then(r => { if (!cancelled) setResults(r.results || []); })
      .catch(err => { if (!cancelled) toast.error(err.message); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery, missingStore, app.country, siteId]);

  // İlk açılışta otomatik ara
  useEffect(() => {
    setDebouncedQuery(app.name);
  }, [app.name]);

  const submit = async () => {
    if (!picked) {
      toast.error('Bir uygulama seç veya manuel ID gir');
      return;
    }
    setLinking(true);
    try {
      const body: any = {};
      if (missingStore === 'IOS') body.appStoreId = picked.id;
      else body.playStoreId = picked.id;
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/link-store`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(`${missingStore === 'IOS' ? 'iOS' : 'Android'} versiyonu eklendi`);
      onLinked();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border rounded-lg max-w-xl w-full my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              {missingStore === 'IOS' ? <><Apple className="h-4 w-4" /> iOS versiyonunu ekle</> : <>🤖 Android versiyonunu ekle</>}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              "{app.name}" için {missingStore === 'IOS' ? 'App Store' : 'Play Store'} versiyonunu bul ve mevcut takibe bağla.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">App ara veya URL yapıştır</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={missingStore === 'IOS' ? 'apps.apple.com/.../id...' : 'play.google.com/store/apps/details?id=...'}
                className="pl-8"
                autoFocus
              />
            </div>
          </div>

          <div className="min-h-[200px] max-h-[360px] overflow-y-auto -mx-1 px-1">
            {searching && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            )}
            {!searching && results.length === 0 && query.length >= 2 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                Sonuç yok. App'in {missingStore === 'IOS' ? 'iOS' : 'Android'} versiyonu olmayabilir.
              </div>
            )}
            {!searching && results.length > 0 && (
              <div className="space-y-1.5">
                {results.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setPicked(picked?.id === r.id ? null : r)}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-md border transition-colors ${
                      picked?.id === r.id
                        ? 'border-brand bg-brand/5'
                        : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                    }`}
                  >
                    {r.icon ? (
                      <img src={r.icon} alt="" className="h-12 w-12 rounded-lg shrink-0" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.developer ?? '—'}</div>
                      {r.rating != null && (
                        <span className="text-xs flex items-center gap-0.5 mt-0.5"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)}</span>
                      )}
                    </div>
                    {picked?.id === r.id && (
                      <div className="h-6 w-6 rounded-full bg-brand text-white grid place-items-center shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2 bg-muted/20">
          <Button size="sm" variant="outline" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={submit} disabled={linking || !picked}>
            {linking ? 'Bağlanıyor...' : 'Bağla'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldDisplay({ label, value, limit, multiline }: { label: string; value: string | null | undefined; limit?: number; multiline?: boolean }) {
  const v = value ?? '';
  const len = v.length;
  const overLimit = limit ? len > limit : false;
  const empty = len === 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {limit && (
          <span className={`text-[10px] ${overLimit ? 'text-rose-600 font-bold' : empty ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {len}/{limit} char
          </span>
        )}
      </div>
      {empty ? (
        <div className="text-xs italic text-rose-500 p-2 border border-dashed border-rose-500/30 rounded">— boş —</div>
      ) : multiline ? (
        <div className="text-xs bg-muted/30 rounded p-2 max-h-[120px] overflow-y-auto whitespace-pre-wrap">{v.slice(0, 600)}{v.length > 600 ? '...' : ''}</div>
      ) : (
        <div className="text-xs bg-muted/30 rounded p-2">{v}</div>
      )}
    </div>
  );
}

function FieldResult({ label, value, limit, multiline, hint, onCopy }: { label: string; value: string; limit?: number; multiline?: boolean; hint?: string; onCopy: (v: string) => void }) {
  const len = value.length;
  const overLimit = limit ? len > limit : false;
  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          {label}
          {limit && (
            <span className={`text-[10px] font-normal ${overLimit ? 'text-rose-600' : 'text-emerald-600'}`}>
              {len}/{limit}{overLimit ? ' ⚠️ aşıyor' : ' ✓'}
            </span>
          )}
        </span>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onCopy(value)}>
          📋 Kopyala
        </Button>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          className="w-full text-xs px-3 py-2 rounded-md border bg-muted/20 font-mono min-h-[120px] max-h-[300px] resize-y"
        />
      ) : (
        <div className="text-xs bg-muted/20 rounded p-2.5 border font-mono break-all">{value}</div>
      )}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">💡 {hint}</p>}
    </div>
  );
}
