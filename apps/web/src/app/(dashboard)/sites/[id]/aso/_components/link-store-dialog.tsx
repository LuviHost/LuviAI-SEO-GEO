'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { SearchInput, SearchResults, useStoreSearch } from './app-search';
import type { AppDetail, SearchResult } from './types';

/** Eksik mağaza sürümünü (iOS ya da Android) mevcut takibe bağlar */
export function LinkStoreDialog({
  siteId,
  app,
  open,
  onOpenChange,
  onLinked,
}: {
  siteId: string;
  app: AppDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLinked: () => void;
}) {
  const missingStore: 'IOS' | 'ANDROID' = !app.appStoreId ? 'IOS' : 'ANDROID';
  // Uygulama adıyla başla — kullanıcı yeniden yazmasın
  const [query, setQuery] = useState(app.name);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [linking, setLinking] = useState(false);
  const { results, searching } = useStoreSearch(siteId, open ? query : '', missingStore, app.country);

  useEffect(() => {
    if (open) { setQuery(app.name); setPicked(null); }
  }, [open, app.name]);

  const storeName = missingStore === 'IOS' ? 'App Store' : 'Google Play';

  const submit = async () => {
    if (!picked) return;
    setLinking(true);
    try {
      const body = missingStore === 'IOS' ? { appStoreId: picked.id } : { playStoreId: picked.id };
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/link-store`, { method: 'POST', body: JSON.stringify(body) });
      toast.success(`${missingStore === 'IOS' ? 'iOS' : 'Android'} sürümü eklendi`);
      onLinked();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{missingStore === 'IOS' ? 'iOS' : 'Android'} sürümünü bağla</DialogTitle>
          <DialogDescription>"{app.name}" için {storeName} sürümünü bul ve mevcut takibe ekle.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <label htmlFor="aso-link-search" className="mb-1 block text-label">Uygulama adı ya da mağaza bağlantısı</label>
            <SearchInput
              id="aso-link-search"
              value={query}
              onChange={setQuery}
              placeholder={missingStore === 'IOS' ? 'apps.apple.com/…/id…' : 'play.google.com/store/apps/details?id=…'}
            />
          </div>
          <SearchResults
            results={results}
            searching={searching}
            query={query}
            isPicked={(r) => picked?.id === r.id}
            onPick={(r) => setPicked(picked?.id === r.id ? null : r)}
            emptyText={`Sonuç yok — uygulamanın ${storeName} sürümü olmayabilir.`}
          />
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button size="sm" onClick={submit} disabled={linking || !picked}>
            <Link2 className="h-4 w-4" aria-hidden />
            {linking ? 'Bağlanıyor…' : 'Bağla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
