'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowDown, ArrowUp, Copy, KeyRound, ListPlus, Loader2, Megaphone, Minus, MoreHorizontal, Plus, RefreshCw,
  Sparkle, Sparkles, Trash2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import { formatNum } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBanner } from '@/components/ui/status-banner';
import { SectionHeader } from '@/components/ui/section-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { InfoTooltip } from '@/components/info-tooltip';
import { cn } from '@/lib/utils';
import { useAsoApp } from '../../_components/app-context';
import { STORE_LABEL, type AiKeywordSuggestion, type Store, type TrackedKeyword } from '../../_components/types';

const COLUMN_HELP: Array<{ label: string; text: string }> = [
  { label: 'Talep', text: "Bu terimde sıralanan uygulamaların büyüklüğü (Play'de indirme, App Store'da değerlendirme sayısı). Yüksek = terim rağbet görüyor; iki mağazada aynı şeyi ölçer. Yıldız işareti ayrı bir sinyal: mağazanın otomatik tamamlaması bu terimi öneriyor. — = ölçülemedi." },
  { label: 'Zorluk', text: 'Bu kelimede üst sıralara çıkmak ne kadar zor (0-100): başlık eşleşmeleri, rakip sayısı, indirme hacmi, puan ortalaması ve son güncellemeden geçen süre. Yüksek = rakipler güçlü.' },
  { label: 'Trafik', text: 'Sıralamaya girersen bu kelimeden gelebilecek trafik (0-100): otomatik tamamlama, sıralanan uygulamalar, indirme ortalaması ve kelime uzunluğu birleştirilir.' },
  { label: 'Sıra', text: "Uygulamanın satırdaki mağazada gerçek sırası. App Store ~100 sonuca kadar arar, Google Play ~30'da tavan yapar — Android'de 'bulunamadı' aslında 'ilk ~30'da yok' demek." },
  { label: 'Değişim', text: 'Bir önceki ölçüme göre sıra değişimi. Yukarı ok = yükseldin, aşağı ok = düştün.' },
];

export default function AsoKeywordsPage() {
  const { siteId, app, reloadApp, aiSuggestions, setAiSuggestions } = useAsoApp();
  const confirm = useConfirm();
  const keywords = app.keywords ?? [];
  const bothStores = !!app.appStoreId && !!app.playStoreId;

  const [newKeyword, setNewKeyword] = useState('');
  const [keywordStore, setKeywordStore] = useState<Store>(app.appStoreId ? 'IOS' : 'ANDROID');
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [aiResearching, setAiResearching] = useState(false);
  const [showAllAi, setShowAllAi] = useState(false);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [bulkRank, setBulkRank] = useState(false);
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [mirroring, setMirroring] = useState(false);

  const iosCount = keywords.filter((k) => k.store === 'IOS').length;
  const androidCount = keywords.filter((k) => k.store === 'ANDROID').length;
  // Kelimeler mağaza başına AYRI satır — eksik taraf varsa tek işlemle aynala
  const canMirrorToAndroid = !!app.playStoreId && iosCount > 0 && androidCount < iosCount;
  const canMirrorToIos = !!app.appStoreId && androidCount > 0 && iosCount < androidCount;

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keyword: newKeyword.trim(), store: keywordStore }),
      });
      setNewKeyword('');
      await reloadApp();
      toast.success('Eklendi — skor hesaplanıyor');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const addBulk = async () => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setAdding(true);
    try {
      const r = await api.request<{ count: number }>(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keywords: lines, store: keywordStore }),
      });
      setBulkText('');
      setBulkOpen(false);
      await reloadApp();
      toast.success(`${r.count} anahtar kelime eklendi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const removeKw = async (kw: TrackedKeyword) => {
    const ok = await confirm({
      title: `"${kw.keyword}" takipten çıkarılsın mı?`,
      description: `${STORE_LABEL[kw.store]} sıralama geçmişi de silinir.`,
      confirmLabel: 'Çıkar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.request(`/sites/${siteId}/aso/keywords/${kw.id}`, { method: 'DELETE' });
      await reloadApp();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const checkRank = async (id: string) => {
    setChecking((prev) => new Set(prev).add(id));
    try {
      await api.request(`/sites/${siteId}/aso/keywords/${id}/check-rank`, { method: 'POST' });
      await reloadApp();
      toast.success('Sıra güncellendi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChecking((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const checkAllRanks = async () => {
    if (keywords.length === 0) return;
    setBulkRank(true);
    setChecking(new Set(keywords.map((k) => k.id)));
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/check-all-ranks`, { method: 'POST' });
      await reloadApp();
      toast.success('Tüm sıralar güncellendi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChecking(new Set());
      setBulkRank(false);
    }
  };

  const refreshScores = async () => {
    if (keywords.length === 0) return;
    setRefreshingScores(true);
    try {
      const r = await api.request<{ updated: number; total: number }>(`/sites/${siteId}/aso/apps/${app.id}/refresh-scores`, { method: 'POST' });
      await reloadApp();
      toast.success(`${r.updated}/${r.total} anahtar kelimenin skoru güncellendi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRefreshingScores(false);
    }
  };

  const mirrorToStore = async (to: Store) => {
    const from: Store = to === 'ANDROID' ? 'IOS' : 'ANDROID';
    setMirroring(true);
    try {
      const r = await api.request<{ eklenen: number; zatenVardi: number }>(
        `/sites/${siteId}/aso/apps/${app.id}/keywords/mirror`,
        { method: 'POST', body: JSON.stringify({ from, to }) },
      );
      await reloadApp();
      if (r.eklenen === 0) {
        toast.message('Kopyalanacak yeni kelime yok', { description: `${r.zatenVardi} kelime zaten ${STORE_LABEL[to]} tarafında var.` });
      } else {
        toast.success(`${r.eklenen} kelime ${STORE_LABEL[to]} tarafına kopyalandı`, {
          description: 'Sıralamaları görmek için "Tüm sıraları güncelle"yi çalıştır.',
        });
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setMirroring(false);
    }
  };

  const aiResearch = async () => {
    setAiResearching(true);
    try {
      const r = await api.request<AiKeywordSuggestion[]>(`/sites/${siteId}/aso/apps/${app.id}/ai-keyword-research`, {
        method: 'POST',
        body: JSON.stringify({ locale: app.country === 'tr' ? 'tr' : 'en' }),
      });
      setAiSuggestions(r);
      if (r.length === 0) toast.message('AI yeni öneri bulamadı');
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
      setAiSuggestions(aiSuggestions.filter((r) => r.keyword !== kw));
      await reloadApp();
      toast.success(`"${kw}" eklendi`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const addAllAi = async () => {
    if (aiSuggestions.length === 0) return;
    const ok = await confirm({
      title: `${aiSuggestions.length} öneri takibe eklensin mi?`,
      description: `Hepsi ${STORE_LABEL[keywordStore]} mağazasına eklenir.`,
      confirmLabel: 'Tümünü ekle',
    });
    if (!ok) return;
    setBulkAdding(true);
    try {
      const result = await api.request<{ created?: number; skipped?: number }>(`/sites/${siteId}/aso/apps/${app.id}/keywords`, {
        method: 'POST',
        body: JSON.stringify({ keywords: aiSuggestions.map((r) => r.keyword), store: keywordStore, source: 'AI_SUGGESTED' }),
      });
      const created = result?.created ?? aiSuggestions.length;
      const skipped = result?.skipped ?? 0;
      setAiSuggestions([]);
      await reloadApp();
      toast.success(skipped === 0 ? `${created} anahtar kelime eklendi` : `${created} eklendi · ${skipped} zaten vardı`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBulkAdding(false);
    }
  };

  const asaHref = (kw: string) => `${siteHref(siteId, 'aso')}/ads?keyword=${encodeURIComponent(kw)}`;

  const columns: Column<TrackedKeyword>[] = [
    {
      key: 'keyword',
      header: 'Anahtar kelime',
      sortValue: (k) => k.keyword,
      cell: (k) => <span className="block max-w-[220px] truncate font-medium" title={k.keyword}>{k.keyword}</span>,
    },
    {
      key: 'store',
      header: 'Mağaza',
      sortValue: (k) => k.store,
      cell: (k) => <Badge variant="outline" className="px-2 text-label">{STORE_LABEL[k.store]}</Badge>,
    },
    {
      key: 'popularity',
      header: 'Talep',
      align: 'right',
      sortValue: (k) => k.popularity || null,
      cell: (k) => k.popularity ? (
        <span className="inline-flex items-center gap-1">
          {k.suggested && (
            <span title="Mağazanın otomatik tamamlaması bu terimi öneriyor — gerçek talebin en güçlü göstergesi">
              <Sparkle className="h-3 w-3 fill-success text-success" aria-label="Otomatik tamamlamada" />
            </span>
          )}
          {formatNum(k.popularity)}
        </span>
      ) : <span className="text-muted-foreground" title="Ölçülemedi — bu terimde sıralanan uygulama bulunamadı">—</span>,
    },
    {
      // 0 da "ölçülemedi": aso-v2 skor tabanı 10 — gerçek ölçüm 0 üretemez
      key: 'difficulty',
      header: 'Zorluk',
      align: 'right',
      hideBelow: 'md',
      sortValue: (k) => k.difficulty || null,
      cell: (k) => k.difficulty ? formatNum(k.difficulty) : <span className="text-muted-foreground" title="Ölçülemedi — mağaza yanıt vermedi">—</span>,
    },
    {
      key: 'traffic',
      header: 'Trafik',
      align: 'right',
      hideBelow: 'md',
      sortValue: (k) => k.traffic || null,
      cell: (k) => k.traffic ? formatNum(k.traffic) : <span className="text-muted-foreground" title="Ölçülemedi — mağaza yanıt vermedi">—</span>,
    },
    {
      key: 'rank',
      header: 'Sıra',
      align: 'right',
      // Küçük sıra = iyi; azalan sıralamada en iyiler üstte olsun diye ters çevir
      sortValue: (k) => (k.currentRank != null ? -k.currentRank : null),
      cell: (k) => checking.has(k.id) ? (
        <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Ölçülüyor" />
      ) : k.currentRank != null ? (
        <span className="font-semibold">#{k.currentRank}</span>
      ) : (
        <span
          className="text-muted-foreground"
          title={k.lastCheckedAt ? `Arandı, ilk ${k.store === 'IOS' ? '~100' : '~30'} sonuçta yok` : 'Henüz ölçülmedi'}
        >
          —
        </span>
      ),
    },
    {
      key: 'delta',
      header: 'Değişim',
      align: 'right',
      sortValue: (k) => (k.previousRank != null && k.currentRank != null ? k.previousRank - k.currentRank : null),
      cell: (k) => {
        const d = k.previousRank != null && k.currentRank != null ? k.previousRank - k.currentRank : null;
        if (d == null) return <span className="text-muted-foreground">—</span>;
        if (d > 0) return <span className="inline-flex items-center gap-0.5 font-medium text-success"><ArrowUp className="h-3 w-3" aria-hidden />{d}</span>;
        if (d < 0) return <span className="inline-flex items-center gap-0.5 font-medium text-danger"><ArrowDown className="h-3 w-3" aria-hidden />{Math.abs(d)}</span>;
        return <Minus className="ml-auto h-3 w-3 text-muted-foreground" aria-label="Değişmedi" />;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">İşlemler</span>,
      align: 'right',
      cell: (k) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => checkRank(k.id)}
            disabled={checking.has(k.id)}
            aria-label={`"${k.keyword}" sırasını güncelle`}
            title="Sırayı güncelle"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', checking.has(k.id) && 'animate-spin')} />
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`"${k.keyword}" için diğer işlemler`}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {k.store === 'IOS' && (
                <DropdownMenuItem asChild>
                  <Link href={asaHref(k.keyword)}><Megaphone aria-hidden /> Apple Search Ads kampanyasına ekle</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem danger disabled={checking.has(k.id)} onSelect={() => removeKw(k)}>
                <Trash2 aria-hidden /> Takipten çıkar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const visibleAi = showAllAi ? aiSuggestions : aiSuggestions.slice(0, 18);

  return (
    <div className="space-y-5">
      <SectionHeader
        as="h3"
        icon={KeyRound}
        title="Anahtar kelimeler"
        description="App Store ve Google Play sıralamaları mağaza başına ayrı tutulur."
      />

      {/* Araç çubuğu: tek birincil eylem + taşma menüsü */}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); addKeyword(); }}
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor="kw-new" className="mb-1 block text-label">Anahtar kelime ekle</label>
          <Input id="kw-new" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="ör. bütçe takibi" />
        </div>
        {bothStores && (
          <div>
            <label htmlFor="kw-store" className="mb-1 block text-label">Mağaza</label>
            <select
              id="kw-store"
              value={keywordStore}
              onChange={(e) => setKeywordStore(e.target.value as Store)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="IOS">iOS</option>
              <option value="ANDROID">Android</option>
            </select>
          </div>
        )}
        <Button type="submit" size="sm" disabled={adding || !newKeyword.trim()}>
          <Plus className="h-4 w-4" aria-hidden /> Ekle
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <MoreHorizontal className="h-4 w-4" aria-hidden /> Diğer
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[15rem]">
            <DropdownMenuItem onSelect={() => setBulkOpen(true)}>
              <ListPlus aria-hidden /> Toplu ekle…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={aiResearch} disabled={aiResearching}>
              <Sparkles aria-hidden /> AI önerisi al
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={checkAllRanks} disabled={bulkRank || keywords.length === 0}>
              <RefreshCw aria-hidden /> Tüm sıraları güncelle
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={refreshScores} disabled={refreshingScores || keywords.length === 0}>
              <Sparkles aria-hidden /> Talep / zorluk skorlarını yenile
            </DropdownMenuItem>
            {(canMirrorToAndroid || canMirrorToIos) && <DropdownMenuSeparator />}
            {canMirrorToAndroid && (
              <DropdownMenuItem onSelect={() => mirrorToStore('ANDROID')} disabled={mirroring}>
                <Copy aria-hidden /> iOS kelimelerini Android&apos;e kopyala
              </DropdownMenuItem>
            )}
            {canMirrorToIos && (
              <DropdownMenuItem onSelect={() => mirrorToStore('IOS')} disabled={mirroring}>
                <Copy aria-hidden /> Android kelimelerini iOS&apos;a kopyala
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </form>

      {(bulkRank || refreshingScores || mirroring || aiResearching) && (
        <StatusBanner
          tone="info"
          title={
            bulkRank ? `Sıralar ölçülüyor — ${keywords.length} kelime, yaklaşık ${Math.ceil(keywords.length * 1.5)} sn`
              : refreshingScores ? `Skorlar yeniden hesaplanıyor — yaklaşık ${Math.ceil(keywords.length * 0.6)} sn`
              : mirroring ? 'Kelimeler kopyalanıyor…'
              : 'AI uygulamanı ve rakiplerini inceliyor — yaklaşık 30 sn'
          }
        >
          İşlem sunucuda sürer; sayfadan ayrılırsan sonucu görmek için geri dönüp yenile.
        </StatusBanner>
      )}

      {/* AI önerileri — ayrı sekme yerine yerinde */}
      {aiSuggestions.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                AI önerileri
                <span className="font-normal text-muted-foreground">· {aiSuggestions.length} kelime · {STORE_LABEL[keywordStore]} mağazasına eklenir</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={addAllAi} disabled={bulkAdding}>
                  {bulkAdding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                  Tümünü ekle
                </Button>
                <Button size="sm" variant="ghost" className="w-9 px-0" onClick={() => setAiSuggestions([])} aria-label="Önerileri kapat">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {visibleAi.map((r) => (
                <li key={r.keyword}>
                  <button
                    type="button"
                    onClick={() => addAiKeyword(r.keyword)}
                    className="group inline-flex h-8 items-center gap-1.5 rounded-chip border px-2.5 text-filter transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title={`Uygunluk ${r.relevance}/10 · ${r.source === 'competitor' ? 'rakipten' : 'AI önerisi'}`}
                  >
                    <span className="font-medium">{r.keyword}</span>
                    <span className="text-label text-muted-foreground">uygunluk {r.relevance}/10</span>
                    {r.source === 'competitor' && <Badge variant="secondary" className="px-1.5 text-label">rakipten</Badge>}
                    <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-brand" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {aiSuggestions.length > 18 && (
              <button type="button" onClick={() => setShowAllAi(!showAllAi)} className="text-label text-brand hover:underline">
                {showAllAi ? 'Daha az göster' : `Tümünü göster (${aiSuggestions.length})`}
              </button>
            )}
          </CardContent>
        </Card>
      ) : keywords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <p className="min-w-[200px] flex-1 text-sm">
            Yeni kelime fikri mi lazım? AI uygulamanı ve rakiplerinin metinlerini inceleyip 30+ öneri çıkarır.
          </p>
          <Button size="sm" variant="outline" onClick={aiResearch} disabled={aiResearching}>
            {aiResearching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {aiResearching ? 'AI çalışıyor…' : 'AI önerisi al'}
          </Button>
        </div>
      ) : null}

      {keywords.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Henüz anahtar kelime yok"
          description="Yukarıdan bir kelime ekle ya da AI'ın uygulamana ve rakiplerine bakarak öneri çıkarmasını iste."
          primary={{ label: aiResearching ? 'AI çalışıyor…' : 'AI önerisi al', onClick: aiResearching ? undefined : aiResearch }}
        />
      ) : (
        <Card>
          <CardContent className="space-y-2 p-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-label text-muted-foreground">
              <span>Sütunlar:</span>
              {COLUMN_HELP.map((c) => (
                <InfoTooltip key={c.label} text={c.text} side="bottom">
                  <span>{c.label}</span>
                </InfoTooltip>
              ))}
            </div>
            <DataTable
              caption="Takip edilen anahtar kelimeler"
              columns={columns}
              rows={keywords}
              rowKey={(k) => k.id}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Toplu anahtar kelime ekle</DialogTitle>
            <DialogDescription>Her satıra bir kelime. {STORE_LABEL[keywordStore]} mağazasına eklenir.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label htmlFor="kw-bulk" className="sr-only">Anahtar kelimeler</label>
            <Textarea
              id="kw-bulk"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={8}
              placeholder={'bütçe takibi\nharcama takibi\naile bütçesi'}
            />
            <p className="mt-1 text-label text-muted-foreground">
              {bulkText.split('\n').filter((l) => l.trim()).length} kelime
            </p>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(false)}>Vazgeç</Button>
            <Button size="sm" onClick={addBulk} disabled={adding || !bulkText.trim()}>
              <ListPlus className="h-4 w-4" aria-hidden /> {adding ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
