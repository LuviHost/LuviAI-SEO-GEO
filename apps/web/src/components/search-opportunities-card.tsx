'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterChip } from '@/components/ui/filter-chip';

/**
 * Arama firsatlari — Google'da 4–20. sirada gorunen sayfalar × GA4 organik
 * acilis verisi (open-seo portu). Skor gosterilmez: agirliklar tek kaynakli,
 * yalniz varsayilan sirayi belirler; bilesenler ayri gosterilir.
 */

type SortKey = 'order' | 'impressions' | 'position' | 'value';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'order', label: 'Önerilen sıra' },
  { key: 'impressions', label: 'Gösterim' },
  { key: 'position', label: 'Sıra' },
  { key: 'value', label: 'Değer' },
];

const pct = (n: number) => `%${Math.round(n * 100)}`;

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname) + u.search;
  } catch {
    return url;
  }
}

function ComponentBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="flex justify-between text-label text-muted-foreground">
        <span>{label}</span>
        <span>{pct(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(4, Math.round(value * 100))}%` }} />
      </div>
    </div>
  );
}

export function SearchOpportunitiesCard({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('order');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getSearchOpportunities(siteId, 50)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ status: 'unavailable' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId]);

  const valueIsKeyEvents = data?.valueMetric !== 'engagementRate';

  const rows = useMemo(() => {
    const list: any[] = data?.status === 'ok' ? [...data.rows] : [];
    if (sort === 'impressions') list.sort((a, b) => b.impressions - a.impressions);
    if (sort === 'position') list.sort((a, b) => a.position - b.position);
    if (sort === 'value') {
      const v = (r: any) => (r.ga ? (valueIsKeyEvents ? r.ga.sessionKeyEventRate : r.ga.engagementRate) : -1);
      list.sort((a, b) => v(b) - v(a) || b.impressions - a.impressions);
    }
    return list;
  }, [data, sort, valueIsKeyEvents]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Search className="h-4 w-4" /> Arama fırsatları — GSC × GA4</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Google&apos;da 4–20. sırada görünen sayfalar. Organik ziyaretçiye değer üretenler ve ilk 3&apos;e yakın olanlar üstte.
            {data?.status === 'ok' && <> Son 28 gün ({data.dateRange.startDate} – {data.dateRange.endDate}).</>}
          </p>
        </div>
        {data?.status === 'ok' && data.rows.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <FilterChip key={s.key} selected={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</FilterChip>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : data?.status === 'not_connected' ? (
          <div className="p-6 text-sm text-muted-foreground">
            Bu liste için hem Search Console hem GA4 bağlı olmalı
            {!data.gscConnected && !data.gaConnected ? '.' : !data.gscConnected ? ' — Search Console bağlı değil.' : ' — GA4 bağlı değil.'}
          </div>
        ) : data?.status !== 'ok' ? (
          <div className="p-6 text-sm text-muted-foreground">
            {data?.source === 'gsc' ? 'Search Console' : data?.source === 'ga' ? 'GA4' : 'Google'} şu an yanıt vermedi — biraz sonra tekrar dene.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Son 28 günde 4–20. sırada gösterim alan sayfa yok.</div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.page} className="px-5 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={r.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sm truncate hover:underline inline-flex items-center gap-1 min-w-0"
                  >
                    <span className="truncate">{pathOf(r.page)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                  {!r.ga && <Badge variant="outline" className="shrink-0">GA4 eşleşmedi</Badge>}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>{r.impressions.toLocaleString('tr-TR')} gösterim</span>
                  <span>{r.clicks.toLocaleString('tr-TR')} tıklama</span>
                  <span>CTR {(r.ctr * 100).toFixed(1)}%</span>
                  <span>ort. sıra {r.position.toLocaleString('tr-TR')}</span>
                  {r.ga && (
                    <>
                      <span>{r.ga.sessions.toLocaleString('tr-TR')} organik oturum</span>
                      <span>etkileşim {pct(r.ga.engagementRate)}</span>
                      <span>{r.ga.keyEvents.toLocaleString('tr-TR')} anahtar olay</span>
                    </>
                  )}
                </div>
                {r.components && (
                  <div className="grid grid-cols-3 gap-4 max-w-md">
                    <ComponentBar label="Talep" value={r.components.demand} hint="Gösterim — adayların yüzde kaçından fazla" />
                    <ComponentBar
                      label="Değer"
                      value={r.components.value}
                      hint={valueIsKeyEvents ? 'Anahtar olaylı oturum oranı — adayların yüzde kaçından yüksek' : 'Etkileşim oranı — adayların yüzde kaçından yüksek'}
                    />
                    <ComponentBar label="Sıraya yakınlık" value={r.components.reachability} hint="Ortalama sıra — adayların yüzde kaçından iyi" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {data?.status === 'ok' && rows.length > 0 && (
          <div className="border-t px-5 py-3 text-label text-muted-foreground space-y-1">
            <p>
              Önerilen sıra; talep, değer ve sıraya yakınlığın open-seo ağırlıklarıyla (0,5 / 0,3 / 0,2) birleşimidir.
              Ağırlıklar tek kaynaklı olduğu için skor olarak gösterilmez; çubuklar adaylar arası yüzdelik sıradır.
              {!valueIsKeyEvents && ' Değer = etkileşim oranı (GA4\'te anahtar olay görünmüyor).'}
            </p>
            <p>
              {data.coverage.joined}/{data.totalCandidates} aday GA4 organik açılış verisiyle eşleşti.
              {data.coverage.gscOnly > 0 && ' Eşleşmeyenlerde GA4 etiketi eksik olabilir ya da sayfa organik oturum başlatmamış olabilir.'}
              {(data.truncated?.gsc || data.truncated?.ga) && ' Büyük site: kaynak satır sınırına ulaşıldı, liste kısmi.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
