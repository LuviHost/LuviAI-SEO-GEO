'use client';

import { formatNum, formatPct, formatPos } from '@/lib/format';
import { siteHref } from '@/lib/site-routes';
import { useEffect, useState, useMemo } from 'react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { TrendingUp, TrendingDown, Minus, BarChart3, Trophy, Target, ArrowUp, ArrowDown, Search, ExternalLink, RefreshCw, Info, Download, Sparkles } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { FilterChip } from '@/components/ui/filter-chip';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/empty-state';
import Link from 'next/link';

interface KeywordRanking {
  query: string;
  page: string;
  position: number;
  previousPosition: number | null;
  delta: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  sparkline: { date: string; position: number }[];
  tier: 'top3' | 'top10' | 'near' | 'low';
}

interface RankingsResponse {
  keywords: KeywordRanking[];
  summary: {
    total: number;
    winning: number;
    top10: number;
    opportunities: number;
    improving: number;
    declining: number;
    avgPosition: number;
    totalClicks: number;
    totalImpressions: number;
  } | null;
  hasData: boolean;
  period?: { days: number; startDate: string; endDate: string };
}

const TIER_BADGES: Record<KeywordRanking['tier'], { label: string; variant: 'success' | 'info' | 'warning' | 'secondary' }> = {
  top3: { label: 'İlk 3', variant: 'success' },
  top10: { label: 'İlk 10', variant: 'info' },
  near: { label: 'Yaklaşan', variant: 'warning' },
  low: { label: '20+', variant: 'secondary' },
};

function Sparkline({ data }: { data: { date: string; position: number }[] }) {
  if (data.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // Position'lar küçükse (top 1) yukarı, büyükse (50+) aşağı
  // Görsel: küçük position = yüksek çizgi (iyi), büyük position = düşük çizgi (kötü)
  const positions = data.map(d => d.position).filter(p => p > 0);
  if (positions.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...positions, 100);
  const min = Math.min(...positions, 1);
  const range = Math.max(max - min, 1);
  const w = 80, h = 24;
  const points = data
    .filter(d => d.position > 0)
    .map((d, i, arr) => {
      const x = (i / Math.max(arr.length - 1, 1)) * w;
      // Pozisyonu invert et: küçük pos → yüksek y (top of chart)
      const y = ((d.position - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="inline-block" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-brand"
      />
    </svg>
  );
}

function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (Math.abs(delta) < 0.5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden /> 0
      </span>
    );
  }
  if (delta > 0) {
    // Position düştü = iyileşti (yeşil yukarı ok)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-success font-medium">
        <ArrowUp className="h-3 w-3" aria-label="yükseldi" /> {formatPos(delta)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-danger font-medium">
      <ArrowDown className="h-3 w-3" aria-label="düştü" /> {formatPos(Math.abs(delta))}
    </span>
  );
}

function PositionBadge({ position, tier }: { position: number; tier: KeywordRanking['tier'] }) {
  const colorMap = {
    top3: 'bg-success/15 text-success',
    top10: 'bg-info/15 text-info',
    near: 'bg-warning/15 text-warning',
    low: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[32px] h-7 px-2 rounded-md text-sm font-bold tabular-nums ${colorMap[tier]}`}>
      {position > 0 ? formatPos(position) : '—'}
    </span>
  );
}

const TIER_FILTERS: Array<{ key: 'all' | KeywordRanking['tier']; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'top3', label: 'İlk 3' },
  { key: 'top10', label: 'İlk 10' },
  { key: 'near', label: 'Yaklaşan (11-20)' },
  { key: 'low', label: '20+' },
];

function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return url; }
}

export default function RankTrackingPage() {
  const { site } = useSiteContext();
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | KeywordRanking['tier']>('all');

  const load = async () => {
    try {
      const res = await api.request<RankingsResponse>(`/sites/${site.id}/analytics/rankings?days=${days}`);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, days]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.request(`/sites/${site.id}/analytics/snapshot-now`, { method: 'POST' });
      toast.success('Yenileme başladı, verilerin güncelleniyor.');
      setTimeout(load, 2000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  // Siralama artik tablo basliklarinda (DataTable, aria-sort) — burada yalniz filtre
  const filtered = useMemo(() => {
    if (!data?.keywords) return [];
    let kws = data.keywords;
    if (filter) {
      const f = filter.toLocaleLowerCase('tr');
      kws = kws.filter(k => k.query.toLocaleLowerCase('tr').includes(f) || k.page.toLocaleLowerCase('tr').includes(f));
    }
    if (tierFilter !== 'all') {
      kws = kws.filter(k => k.tier === tierFilter);
    }
    return kws;
  }, [data, filter, tierFilter]);

  const exportCsv = () => {
    if (!data?.keywords) return;
    const header = ['Keyword', 'Page', 'Position', 'PreviousPos', 'Delta', 'Clicks', 'Impressions', 'CTR%'];
    const rows = data.keywords.map(k =>
      [k.query, k.page, k.position, k.previousPosition ?? '', k.delta ?? '', k.clicks, k.impressions, k.ctr].join('\t')
    );
    const csv = [header.join('\t'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${site.id.slice(0, 8)}-rankings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<KeywordRanking>[] = [
    {
      key: 'query',
      header: 'Anahtar kelime',
      sortValue: (k) => k.query,
      className: 'max-w-[280px]',
      cell: (kw) => (
        <>
          <div className="font-medium truncate" title={kw.query}>{kw.query}</div>
          <Badge variant={TIER_BADGES[kw.tier].variant} className="mt-1 text-label">
            {TIER_BADGES[kw.tier].label}
          </Badge>
        </>
      ),
    },
    {
      key: 'position',
      header: 'Sıra',
      sortValue: (k) => (k.position > 0 ? k.position : null),
      cell: (kw) => <PositionBadge position={kw.position} tier={kw.tier} />,
    },
    {
      key: 'delta',
      header: 'Değişim',
      sortValue: (k) => k.delta,
      cell: (kw) => <PositionDelta delta={kw.delta} />,
    },
    {
      key: 'trend',
      header: 'Trend',
      hideBelow: 'md',
      cell: (kw) => <Sparkline data={kw.sparkline} />,
    },
    {
      key: 'clicks',
      header: 'Tıklama',
      align: 'right',
      sortValue: (k) => k.clicks,
      cell: (kw) => formatNum(kw.clicks),
    },
    {
      key: 'impressions',
      header: 'Gösterim',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (k) => k.impressions,
      cell: (kw) => formatNum(kw.impressions),
    },
    {
      key: 'ctr',
      header: 'Tıklama oranı',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (k) => k.ctr,
      cell: (kw) => formatPct(kw.ctr / 100, 2),
    },
    {
      key: 'page',
      header: 'Sayfa',
      hideBelow: 'lg',
      className: 'max-w-[200px]',
      cell: (kw) =>
        kw.page ? (
          <a
            href={kw.page}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-brand truncate inline-flex items-center gap-1 max-w-full"
            title={kw.page}
          >
            <span className="truncate">{pathOf(kw.page)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        ),
    },
    {
      key: 'action',
      header: <span className="sr-only">Eylem</span>,
      align: 'right',
      // 11-20: ilk sayfaya bir adim — sayfa varsa sayfa SEO'sunu iyilestir, yoksa icerik firsatina git
      cell: (kw) =>
        kw.tier === 'near' ? (
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
            <Link
              href={kw.page ? siteHref(site.id, 'snippet') : siteHref(site.id, 'opportunities')}
              title={kw.page ? `${pathOf(kw.page)} sayfasının başlık, meta ve SSS'sini güçlendir` : 'Bu sorgu için içerik fırsatı oluştur'}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" aria-hidden /> {kw.page ? 'Sayfayı güçlendir' : 'İçerik üret'}
            </Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={BarChart3}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Anahtar kelime sıralaması
            <Badge variant="outline" className="text-label">GSC</Badge>
          </span>
        }
        description="Search Console'dan her gün çekilen verilerle her sorgunun sırası, trendi ve fırsatları."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              Yenile
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data?.hasData}>
              <Download className="h-4 w-4 mr-1.5" aria-hidden />
              CSV indir
            </Button>
          </>
        }
      />

      {/* Dönem — FilterChip (28px / aria-pressed) */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dönem">
        <span className="text-label text-muted-foreground">Dönem:</span>
        {([7, 30, 90] as const).map((d) => (
          <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>
            Son {d} gün
          </FilterChip>
        ))}
      </div>

      {/* Henuz veri yok — uyari degil, notr bos durum */}
      {!loading && !data?.hasData && (
        <EmptyState
          icon={BarChart3}
          title="Henüz sıralama verisi yok"
          description="Sıralama takibi için Google Search Console bağlı olmalı ve birkaç gün veri birikmeli. Yeni bağladıysan birkaç gün sonra tekrar bak."
          primary={{ label: 'GSC bağlantısını kontrol et', href: siteHref(site.id, 'connections') }}
        />
      )}

      {/* SUMMARY KPIS */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data?.summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label="Toplam sorgu" value={formatNum(data.summary.total)} icon={<BarChart3 className="h-4 w-4" />} />
          <KpiCard label="İlk 3" value={formatNum(data.summary.winning)} icon={<Trophy className="h-4 w-4" />} accent="text-success" />
          <KpiCard label="İlk 10" value={formatNum(data.summary.top10)} icon={<Trophy className="h-4 w-4" />} accent="text-info" />
          <KpiCard label="Yaklaşan (11-20)" value={formatNum(data.summary.opportunities)} icon={<Target className="h-4 w-4" />} accent="text-warning" />
          <KpiCard label="Yükselen" value={formatNum(data.summary.improving)} icon={<TrendingUp className="h-4 w-4" />} accent="text-success" />
          <KpiCard label="Düşen" value={formatNum(data.summary.declining)} icon={<TrendingDown className="h-4 w-4" />} accent="text-danger" />
        </div>
      ) : null}

      {/* AVG POSITION CARD */}
      {data?.summary && (
        <Card>
          <CardContent className="p-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-label text-muted-foreground mb-1">Ortalama sıra</div>
              <div className="text-metric-lg tabular-nums">{formatPos(data.summary.avgPosition)}</div>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <div className="text-label text-muted-foreground">Toplam tıklama</div>
                <div className="font-semibold tabular-nums">{formatNum(data.summary.totalClicks)}</div>
              </div>
              <div>
                <div className="text-label text-muted-foreground">Toplam gösterim</div>
                <div className="font-semibold tabular-nums">{formatNum(data.summary.totalImpressions)}</div>
              </div>
              <div>
                <div className="text-label text-muted-foreground">Ortalama tıklama oranı</div>
                <div className="font-semibold tabular-nums">
                  {formatPct(data.summary.totalImpressions > 0 ? data.summary.totalClicks / data.summary.totalImpressions : 0, 2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KEYWORD TABLE — basliktan siralanir (aria-sort) */}
      {data?.hasData && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <Input
                  placeholder="Sorgu veya sayfa ara…"
                  aria-label="Sorgu veya sayfa ara"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="pl-8 h-9 w-56 text-sm"
                />
              </div>
              <span className="text-label text-muted-foreground tabular-nums">
                {formatNum(filtered.length)} / {formatNum(data.keywords.length)} sorgu
              </span>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Sıra aralığı">
              {TIER_FILTERS.map((t) => (
                <FilterChip key={t.key} selected={tierFilter === t.key} onClick={() => setTierFilter(t.key)}>
                  {t.label}
                </FilterChip>
              ))}
            </div>
          </CardHeader>
          {filtered.length === 0 ? (
            <div className="border-t px-4 py-12 text-center text-sm text-muted-foreground">
              Filtreyle eşleşen sorgu bulunamadı.
            </div>
          ) : (
            <DataTable
              className="border-t"
              caption="Anahtar kelime sıralamaları"
              columns={columns}
              rows={filtered}
              rowKey={(k) => k.query + k.page}
              initialSort={{ key: 'impressions', dir: 'desc' }}
              maxRows={200}
            />
          )}
          {filtered.length > 200 && (
            <div className="px-4 py-3 text-xs text-muted-foreground border-t bg-muted/20">
              İlk 200 sonuç gösteriliyor. CSV indirip tamamına bakabilirsin.
            </div>
          )}
        </Card>
      )}

      {/* INFO PANEL */}
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground flex items-start gap-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <div>
            <strong className="text-foreground">Veri kaynağı:</strong> Google Search Console.
            GSC yalnız kendi sitenin sıralama verisini gösterir — rakip sıralamaları burada görünmez.
            Sıralar GSC&apos;nin verdiği <em>ortalama sıra</em>dır (kullanıcı, konum ve cihaz farkları yumuşatılır).
            Yeni sorguların görünmesi için 2-3 gün veri birikmesi gerekir.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  // Tipografi sozlesmesi: text-metric-lg deger + text-label etiket (dense kart, 16px pad)
  return (
    <Card density="dense">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-label text-muted-foreground">{label}</span>
          <span className={accent ?? 'text-muted-foreground'} aria-hidden>{icon}</span>
        </div>
        <div className={`text-metric-lg tabular-nums ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
