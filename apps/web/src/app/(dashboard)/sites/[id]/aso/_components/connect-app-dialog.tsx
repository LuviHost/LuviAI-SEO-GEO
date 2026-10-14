'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Apple, Check, Link2, Search, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterChip } from '@/components/ui/filter-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { SearchInput, SearchResults, useStoreSearch } from './app-search';
import type { SearchResult, TrackedApp } from './types';

const COUNTRIES = [
  { value: 'tr', label: 'Türkiye' },
  { value: 'us', label: 'ABD' },
  { value: 'gb', label: 'Birleşik Krallık' },
  { value: 'de', label: 'Almanya' },
  { value: 'fr', label: 'Fransa' },
  { value: 'ar', label: 'BAE / Arapça' },
  { value: 'ru', label: 'Rusya' },
];

const STORE_FILTERS = [
  { value: 'BOTH', label: 'Hepsi' },
  { value: 'IOS', label: 'iOS' },
  { value: 'ANDROID', label: 'Android' },
] as const;

export function ConnectAppDialog({
  siteId,
  open,
  onOpenChange,
  onAdded,
}: {
  siteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: (app: TrackedApp) => void;
}) {
  const [tab, setTab] = useState<'search' | 'manual'>('search');
  const [country, setCountry] = useState('tr');
  const [storeFilter, setStoreFilter] = useState<'BOTH' | 'IOS' | 'ANDROID'>('BOTH');
  const [query, setQuery] = useState('');
  const [pickedIos, setPickedIos] = useState<SearchResult | null>(null);
  const [pickedAndroid, setPickedAndroid] = useState<SearchResult | null>(null);
  const [manualIos, setManualIos] = useState('');
  const [manualAndroid, setManualAndroid] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { results, searching } = useStoreSearch(siteId, open && tab === 'search' ? query : '', storeFilter, country);

  const pick = (r: SearchResult) => {
    if (r.store === 'IOS') setPickedIos(pickedIos?.id === r.id ? null : r);
    else setPickedAndroid(pickedAndroid?.id === r.id ? null : r);
  };
  const isPicked = (r: SearchResult) =>
    (r.store === 'IOS' && pickedIos?.id === r.id) || (r.store === 'ANDROID' && pickedAndroid?.id === r.id);

  const totalPicked = (pickedIos ? 1 : 0) + (pickedAndroid ? 1 : 0);
  const isUrl = query.trim().startsWith('http');

  const submit = async () => {
    const appStoreId = tab === 'search' ? pickedIos?.id : manualIos.trim() || undefined;
    const playStoreId = tab === 'search' ? pickedAndroid?.id : manualAndroid.trim() || undefined;
    if (!appStoreId && !playStoreId) {
      toast.error('En az bir uygulama seç ya da kimlik gir');
      return;
    }
    setSubmitting(true);
    try {
      const app = await api.request<TrackedApp>(`/sites/${siteId}/aso/apps`, {
        method: 'POST',
        body: JSON.stringify({ appStoreId, playStoreId, country }),
      });
      toast.success('Uygulama eklendi');
      onAdded(app);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Uygulama ekle</DialogTitle>
          <DialogDescription>App Store ve/veya Google Play sürümünü seç; ikisini birden seçersen tek kayıtta birleşir.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'search' | 'manual')}>
          <DialogBody className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <TabsList>
                <TabsTrigger value="search"><Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />Ara / bağlantı yapıştır</TabsTrigger>
                <TabsTrigger value="manual">Kimlikle ekle</TabsTrigger>
              </TabsList>
              <div>
                <label htmlFor="aso-country" className="mb-1 block text-label">Ülke</label>
                <select
                  id="aso-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <TabsContent value="search" className="mt-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mağaza">
                {STORE_FILTERS.map((s) => (
                  <FilterChip key={s.value} selected={storeFilter === s.value} onClick={() => setStoreFilter(s.value)}>
                    {s.label}
                  </FilterChip>
                ))}
              </div>
              <div>
                <label htmlFor="aso-search" className="mb-1 block text-label">Uygulama adı ya da mağaza bağlantısı</label>
                <SearchInput id="aso-search" value={query} onChange={setQuery} placeholder="ör. spotify ya da https://apps.apple.com/…/id…" />
                <p className="mt-1 text-label text-muted-foreground">
                  {isUrl ? 'Bağlantı algılandı — doğrudan çekiliyor.' : 'Sonuçlar yazdıkça gelir.'}
                </p>
              </div>
              <SearchResults results={results} searching={searching} query={query} isPicked={isPicked} onPick={pick} />
              {totalPicked > 0 && (
                <div className="flex items-center gap-2 rounded-md border border-brand/20 bg-brand/5 p-3 text-sm">
                  <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0 flex-1">
                    {pickedIos && <span className="mr-3 inline-flex items-center gap-1"><Apple className="h-3.5 w-3.5" aria-hidden />{pickedIos.name}</span>}
                    {pickedAndroid && <span className="inline-flex items-center gap-1"><Smartphone className="h-3.5 w-3.5" aria-hidden />{pickedAndroid.name}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPickedIos(null); setPickedAndroid(null); }}
                    className="text-label text-muted-foreground hover:text-foreground"
                  >
                    Temizle
                  </button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="manual" className="mt-0 space-y-4">
              <div>
                <label htmlFor="aso-manual-ios" className="mb-1 flex items-center gap-1.5 text-label"><Apple className="h-3.5 w-3.5" aria-hidden /> App Store kimliği (iOS)</label>
                <Input id="aso-manual-ios" value={manualIos} onChange={(e) => setManualIos(e.target.value)} placeholder="ör. 6444904356" />
                <p className="mt-1 text-label text-muted-foreground">Bağlantıdaki "id" sonrası: apps.apple.com/…/id<strong>6444904356</strong></p>
              </div>
              <div>
                <label htmlFor="aso-manual-android" className="mb-1 flex items-center gap-1.5 text-label"><Smartphone className="h-3.5 w-3.5" aria-hidden /> Google Play paket adı (Android)</label>
                <Input id="aso-manual-android" value={manualAndroid} onChange={(e) => setManualAndroid(e.target.value)} placeholder="ör. com.example.app" />
                <p className="mt-1 text-label text-muted-foreground">Bağlantıdaki "id=" sonrası: play.google.com/store/apps/details?id=<strong>com.example.app</strong></p>
              </div>
              <p className="text-label text-muted-foreground">Birini doldurman yeter.</p>
            </TabsContent>
          </DialogBody>
        </Tabs>

        <DialogFooter className="justify-between">
          <span className="text-label text-muted-foreground">
            {tab === 'search' ? (totalPicked > 0 ? `${totalPicked} uygulama seçili` : 'En az bir uygulama seç') : 'iOS ya da Android kimliği gir'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
            <Button size="sm" onClick={submit} disabled={submitting || (tab === 'search' && totalPicked === 0)}>
              <Link2 className="h-4 w-4" aria-hidden />
              {submitting ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
