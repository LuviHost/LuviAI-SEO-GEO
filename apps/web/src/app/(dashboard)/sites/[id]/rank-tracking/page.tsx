'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { TrendingUp, TrendingDown, Minus, BarChart3, Trophy, Target, ArrowUp, ArrowDown, Search, ExternalLink, RefreshCw, Info } from 'lucide-react';
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

const TIER_BADGES: Record<KeywordRanking['tier'], { label: string; className: string }> = {
  top3: { label: 'Top 3', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  top10: { label: 'Top 10', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  near: { label: 'Yaklaşan', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  low: { label: '20+', className: 'bg-muted text-muted-foreground' },
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
    <svg width={w} height={h} className="inline-block">
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
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  }
  if (delta > 0) {
    // Position düştü = iyileşti (yeşil yukarı ok)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium">
        <ArrowUp className="h-3 w-3" /> {delta.toFixed(1)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-rose-600 font-medium">
      <ArrowDown className="h-3 w-3" /> {Math.abs(delta).toFixed(1)}
    </span>
  );
}

function PositionBadge({ position, tier }: { position: number; tier: KeywordRanking['tier'] }) {
  const colorMap = {
    top3: 'bg-emerald-500 text-white',
    top10: 'bg-blue-500 text-white',
    near: 'bg-amber-500 text-white',
    low: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[32px] h-7 px-2 rounded-md text-sm font-bold tabular-nums ${colorMap[tier]}`}>
      {position > 0 ? position.toFixed(1) : '—'}
    </span>
  );
}

export default function RankTrackingPage() {
  const { site } = useSiteContext();
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | KeywordRanking['tier']>('all');
  const [sortBy, setSortBy] = useState<'impressions' | 'position' | 'delta' | 'clicks'>('impressions');

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
  }, [site.id, days]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.request(`/sites/${site.id}/analytics/snapshot-now`, { method: 'POST' });
      toast.success('Snapshot tetiklendi, verilerin güncelleniyor.');
      setTimeout(load, 2000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data?.keywords) return [];
    let kws = [...data.keywords];
    if (filter) {
      const f = filter.toLowerCase();
      kws = kws.filter(k => k.query.toLowerCase().includes(f) || k.page.toLowerCase().includes(f));
    }
    if (tierFilter !== 'all') {
      kws = kws.filter(k => k.tier === tierFilter);
    }
    kws.sort((a, b) => {
      if (sortBy === 'impressions') return b.impressions - a.impressions;
      if (sortBy === 'clicks') return b.clicks - a.clicks;
      if (sortBy === 'position') return a.position - b.position;
      if (sortBy === 'delta') return (b.delta ?? -999) - (a.delta ?? -999);
      return 0;
    });
    return kws;
  }, [data, filter, tierFilter, sortBy]);

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

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              Keyword Sıralama Takibi
              <Badge variant="outline" className="text-xs">GSC tabanlı</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Google Search Console'dan günlük çekilen verilerle her keyword'ünün sırası, trendi ve fırsatları.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data?.hasData}>
            CSV indir
          </Button>
        </div>
      </div>

      {/* PERIOD SELECTOR */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Dönem:</span>
        {([7, 30, 90] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-3 py-1 rounded-md border transition-colors ${
              days === d ? 'border-brand bg-brand/10 text-brand font-medium' : 'border-border hover:border-foreground/30'
            }`}
          >
            Son {d} gün
          </button>
        ))}
      </div>

      {/* GSC NOT BAĞLI MESAJI */}
      {!loading && !data?.hasData && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center">
            <Info className="h-8 w-8 mx-auto mb-3 text-amber-600" />
            <h3 className="font-semibold mb-2">Henüz GSC verisi yok</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Keyword takibi için Google Search Console bağlanmış ve en az birkaç gün veri toplanmış olmalı.
              Henüz GSC bağlamadıysan veya yeni bağladıysan birkaç gün sonra tekrar gel.
            </p>
            <Button asChild size="sm">
              <Link href={`/sites/${site.id}/connections`}>GSC bağlantısını kontrol et</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SUMMARY KPIS */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data?.summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label="Toplam Keyword" value={data.summary.total.toLocaleString('tr-TR')} icon={<BarChart3 className="h-4 w-4" />} />
          <KpiCard label="Top 3" value={data.summary.winning.toLocaleString('tr-TR')} icon={<Trophy className="h-4 w-4" />} accent="text-emerald-600" />
          <KpiCard label="Top 10" value={data.summary.top10.toLocaleString('tr-TR')} icon={<Trophy className="h-4 w-4" />} accent="text-blue-600" />
          <KpiCard label="Yaklaşan (11-20)" value={data.summary.opportunities.toLocaleString('tr-TR')} icon={<Target className="h-4 w-4" />} accent="text-amber-600" />
          <KpiCard label="Yükselen" value={data.summary.improving.toLocaleString('tr-TR')} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-600" />
          <KpiCard label="Düşen" value={data.summary.declining.toLocaleString('tr-TR')} icon={<TrendingDown className="h-4 w-4" />} accent="text-rose-600" />
        </div>
      ) : null}

      {/* AVG POSITION CARD */}
      {data?.summary && (
        <Card className="bg-gradient-to-r from-brand/5 via-transparent to-transparent">
          <CardContent className="p-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Ortalama Pozisyon</div>
              <div className="text-3xl font-bold">{data.summary.avgPosition.toFixed(1)}</div>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Toplam tıklama</div>
                <div className="font-bold">{data.summary.totalClicks.toLocaleString('tr-TR')}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Toplam gösterim</div>
                <div className="font-bold">{data.summary.totalImpressions.toLocaleString('tr-TR')}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Ortalama CTR</div>
                <div className="font-bold">
                  {data.summary.totalImpressions > 0
                    ? ((data.summary.totalClicks / data.summary.totalImpressions) * 100).toFixed(2)
                    : '0.00'}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KEYWORD TABLE */}
      {data?.hasData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Keyword ara..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="pl-8 h-9 w-56 text-sm"
                  />
                </div>
                <select
                  value={tierFilter}
                  onChange={e => setTierFilter(e.target.value as any)}
                  className="h-9 px-2 rounded-md border border-input text-sm bg-background"
                >
                  <option value="all">Tümü</option>
                  <option value="top3">Top 3</option>
                  <option value="top10">Top 10</option>
                  <option value="near">Yaklaşan (11-20)</option>
                  <option value="low">20+</option>
                </select>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="h-9 px-2 rounded-md border border-input text-sm bg-background"
                >
                  <option value="impressions">Gösterim ↓</option>
                  <option value="clicks">Tıklama ↓</option>
                  <option value="position">Pozisyon ↑</option>
                  <option value="delta">İyileşme ↓</option>
                </select>
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} / {data.keywords.length} keyword
              </span>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Keyword</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Pozisyon</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Δ</th>
                  <th className="text-center px-3 py-2.5 font-semibold hidden md:table-cell">Trend</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Tıklama</th>
                  <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell">Gösterim</th>
                  <th className="text-right px-3 py-2.5 font-semibold hidden lg:table-cell">CTR</th>
                  <th className="text-left px-3 py-2.5 font-semibold hidden lg:table-cell">Sayfa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.slice(0, 200).map((kw) => (
                  <tr key={kw.query + kw.page} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 max-w-[280px]">
                      <div className="font-medium truncate" title={kw.query}>{kw.query}</div>
                      <Badge variant="outline" className={`mt-1 text-[10px] ${TIER_BADGES[kw.tier].className}`}>
                        {TIER_BADGES[kw.tier].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <PositionBadge position={kw.position} tier={kw.tier} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <PositionDelta delta={kw.delta} />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden md:table-cell">
                      <Sparkline data={kw.sparkline} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{kw.clicks.toLocaleString('tr-TR')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{kw.impressions.toLocaleString('tr-TR')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums hidden lg:table-cell">{kw.ctr.toFixed(2)}%</td>
                    <td className="px-3 py-2.5 hidden lg:table-cell max-w-[200px]">
                      {kw.page ? (
                        <a
                          href={kw.page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-brand truncate inline-flex items-center gap-1 max-w-full"
                          title={kw.page}
                        >
                          <span className="truncate">{(() => { try { return new URL(kw.page).pathname; } catch { return kw.page; } })()}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Filtreyle eşleşen keyword bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-3 text-xs text-muted-foreground border-t bg-muted/20">
                İlk 200 sonuç gösteriliyor. CSV indirip tamamına bakabilirsin.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* INFO PANEL */}
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground flex items-start gap-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong className="text-foreground">Veri kaynağı:</strong> Google Search Console.
            GSC, kendi sitenin sıralama verisini gösterir — rakip sıralamaları için bu sayfa kullanılamaz.
            Pozisyonlar GSC'nin verdiği <em>ortalama pozisyon</em>'dur (kullanıcı, lokasyon, cihaz farklılıkları yumuşatılır).
            Yeni eklenen keyword'lerin görünmesi için 2-3 gün veri birikmesi gerek.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={accent ?? 'text-muted-foreground'}>{icon}</span>
        </div>
        <div className={`text-2xl font-bold tabular-nums ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
