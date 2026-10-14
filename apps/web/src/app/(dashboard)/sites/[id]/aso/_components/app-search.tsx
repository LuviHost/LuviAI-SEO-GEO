'use client';

import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { AppIcon, Rating } from './app-bits';
import { STORE_LABEL, type SearchResult } from './types';

/** Mağaza araması — 350 ms gecikmeli; URL yapıştırılırsa sunucu doğrudan çözer */
export function useStoreSearch(siteId: string, query: string, store: 'BOTH' | 'IOS' | 'ANDROID', country: string) {
  const [debounced, setDebounced] = useState(query);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced.trim() || debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const params = new URLSearchParams({ term: debounced, store, country });
    api.request<{ results: SearchResult[] }>(`/sites/${siteId}/aso/search?${params}`)
      .then((r) => { if (!cancelled) setResults(r.results || []); })
      .catch((err) => { if (!cancelled) toast.error(err.message); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debounced, store, country, siteId]);

  return { results, searching };
}

export function SearchInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" autoFocus />
    </div>
  );
}

/** Sonuç listesi — kendi kaydırıcısı YOK; diyalog gövdesi kayar (iç içe kaydırma tuzağı olmasın) */
export function SearchResults({
  results,
  searching,
  query,
  isPicked,
  onPick,
  emptyText = 'Sonuç bulunamadı.',
}: {
  results: SearchResult[];
  searching: boolean;
  query: string;
  isPicked: (r: SearchResult) => boolean;
  onPick: (r: SearchResult) => void;
  emptyText?: string;
}) {
  if (searching) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {query.trim().length >= 2 ? emptyText : 'Uygulama adını yaz — en az 2 harf.'}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {results.map((r) => {
        const picked = isPicked(r);
        return (
          <li key={`${r.store}-${r.id}`}>
            <button
              type="button"
              onClick={() => onPick(r)}
              aria-pressed={picked}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                picked ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/30 hover:bg-muted/40',
              )}
            >
              <AppIcon src={r.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <Badge variant="outline" className="shrink-0 px-2 text-label">{STORE_LABEL[r.store]}</Badge>
                </div>
                <div className="truncate text-label text-muted-foreground">{r.developer ?? '—'}</div>
                <div className="mt-0.5 flex items-center gap-2 text-label">
                  {r.rating != null && <Rating value={r.rating} />}
                  {r.category && <span className="text-muted-foreground">· {r.category}</span>}
                </div>
              </div>
              {picked && (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white" aria-hidden>
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
