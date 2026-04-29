'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, TrendingUp, TrendingDown, Minus, BarChart3, Bot, FileText, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CitationHistoryChart } from '@/components/citation-history-chart';

type Range = 'week' | 'month' | 'year';

/**
 * Haftalik / aylik / yillik kapsamli rapor + indirme.
 */
export function SiteReportPanel({ siteId, site }: { siteId: string; site: any }) {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async (r: Range) => {
    setLoading(true);
    try {
      const res = await api.getReport(siteId, r);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(range); }, [range, siteId]);

  const downloadCsv = () => {
    const url = api.getReportCsvUrl(siteId, range);
    window.open(url, '_blank');
  };

  const printPdf = () => {
    window.print();
  };

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Rapor hazırlanıyor…</div>;
  }

  const rangeLabel = range === 'week' ? '7 gün' : range === 'month' ? '30 gün' : '365 gün';

  return (
    <div className="space-y-5">
      {/* Range selector + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Performans Raporu</h2>
          <p className="text-xs text-muted-foreground">
            {site?.name} · son {rangeLabel} · {new Date(data.rangeStart).toLocaleDateString('tr-TR')} — {new Date(data.rangeEnd).toLocaleDateString('tr-TR')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex border rounded-md overflow-hidden">
            {(['week', 'month', 'year'] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {r === 'week' ? 'Haftalık' : r === 'month' ? 'Aylık' : 'Yıllık'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={printPdf}>
            <FileText className="h-3.5 w-3.5 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* Buyuk metrik kartlari */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <BigMetric
          label="Yayınlanan Makale"
          value={data.articles.published}
          delta={data.articles.publishedDelta}
          icon={<FileText className="h-4 w-4" />}
        />
        <BigMetric
          label="GSC Tıklama"
          value={data.search.totalClicks.toLocaleString('tr-TR')}
          delta={data.search.clicksDelta}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <BigMetric
          label="GSC Gösterim"
          value={data.search.totalImpressions.toLocaleString('tr-TR')}
          delta={data.search.impressionsDelta}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <BigMetric
          label="Sosyal Post"
          value={data.social.posts}
          delta={data.social.postsDelta}
          icon={<Send className="h-4 w-4" />}
        />
      </div>

      {/* Skorlar */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-semibold mb-3">Skor Özeti</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-brand">{data.audit.overallScore ?? '—'}<span className="text-sm text-muted-foreground font-normal">/100</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">SEO Skoru</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{data.audit.geoScore ?? '—'}<span className="text-sm text-muted-foreground font-normal">/100</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">GEO Skoru</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{data.ai.citationScore ?? '—'}<span className="text-sm text-muted-foreground font-normal">/100</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">AI Görünürlük</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Citation tarihsel trend (yeni!) */}
      <CitationHistoryChart siteId={siteId} />

      {/* AI Provider breakdown */}
      {Array.isArray(data.ai.providers) && data.ai.providers.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-3 inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" /> AI Sağlayıcı Dağılımı
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {data.ai.providers.map((p: any) => (
                <div key={p.provider} className="rounded-md border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{p.label}</span>
                    <span className={`text-base font-bold ${
                      !p.available || p.score === null ? 'text-muted-foreground' :
                      p.score >= 60 ? 'text-green-500' : p.score >= 30 ? 'text-yellow-500' : 'text-red-500'
                    }`}>
                      {p.available && p.score !== null ? p.score : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zaman serisi (basit bar chart) */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-semibold mb-3">Aktivite Trendi</p>
          <SimpleBarChart series={data.timeSeries} />
        </CardContent>
      </Card>

      {/* Top queries */}
      {data.search.topQueries?.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-3">En Çok Tıklanan Sorgular</p>
            <table className="w-full text-sm">
              <thead className="text-[11px] text-muted-foreground uppercase border-b">
                <tr>
                  <th className="text-left py-2 font-medium">Sorgu</th>
                  <th className="text-right py-2 font-medium">Tıklama</th>
                  <th className="text-right py-2 font-medium">Gösterim</th>
                  <th className="text-right py-2 font-medium">CTR</th>
                  <th className="text-right py-2 font-medium">Sıra</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.search.topQueries.slice(0, 10).map((q: any, i: number) => (
                  <tr key={i}>
                    <td className="py-2 truncate max-w-[300px]">{q.query}</td>
                    <td className="text-right font-mono text-xs">{q.clicks}</td>
                    <td className="text-right font-mono text-xs">{q.impressions}</td>
                    <td className="text-right font-mono text-xs">{(q.ctr * 100).toFixed(1)}%</td>
                    <td className="text-right font-mono text-xs">{q.position?.toFixed(1) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Sosyal kanal dagilimi */}
      {Object.keys(data.social.byChannel).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-3">Sosyal Kanal Dağılımı</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(data.social.byChannel).map(([ch, count]) => (
                <div key={ch} className="rounded-md border p-2.5 text-center">
                  <div className="text-2xl font-bold">{count as number}</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{ch}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Maliyet */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Üretim Maliyeti</p>
            <p className="text-xl font-bold">${data.articles.totalCost.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Ortalama Editör Skoru</p>
            <p className="text-xl font-bold">{data.articles.avgEditorScore?.toFixed(1) ?? '—'}/60</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Düzeltilen Sorun</p>
            <p className="text-xl font-bold">{data.audit.fixedThisRange}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground">Bekleyen Sorun</p>
            <p className="text-xl font-bold">{data.audit.issuesCount}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BigMetric({
  label, value, delta, icon,
}: {
  label: string;
  value: string | number;
  delta: number;
  icon: React.ReactNode;
}) {
  const positive = delta > 0;
  const negative = delta < 0;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide font-medium">
        {icon} {label}
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
      <div className={`text-xs mt-1 inline-flex items-center gap-1 font-medium ${
        positive ? 'text-green-500' : negative ? 'text-red-500' : 'text-muted-foreground'
      }`}>
        {positive ? <TrendingUp className="h-3 w-3" /> : negative ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        {delta > 0 ? '+' : ''}{delta.toLocaleString('tr-TR')}
        <span className="text-muted-foreground">önceki dönem</span>
      </div>
    </div>
  );
}

/**
 * Saf SVG bar chart — bagimsiz, bagimliligi yok.
 */
function SimpleBarChart({ series }: { series: any }) {
  const dates: string[] = series.dates ?? [];
  const articles: number[] = series.publishedArticles ?? [];
  const social: number[] = series.socialPosts ?? [];
  const clicks: number[] = series.clicks ?? [];

  const maxArticles = Math.max(1, ...articles);
  const maxClicks = Math.max(1, ...clicks);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 bg-brand rounded-sm" /> Makale
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 bg-blue-500 rounded-sm" /> Sosyal post
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 bg-green-500 rounded-sm" /> GSC tıklama (sağ)
        </span>
      </div>

      <div className="flex items-end gap-0.5 h-32 overflow-x-auto pb-2">
        {dates.map((d, i) => {
          const articlesH = (articles[i] / maxArticles) * 80;
          const socialH = (social[i] / maxArticles) * 80;
          const clicksH = (clicks[i] / maxClicks) * 80;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 min-w-[20px]" title={`${d}: ${articles[i]} makale, ${social[i]} post, ${clicks[i]} tıklama`}>
              <div className="flex items-end gap-0.5 h-24">
                <div className="w-1.5 bg-brand rounded-t" style={{ height: `${articlesH}%` }} />
                <div className="w-1.5 bg-blue-500 rounded-t" style={{ height: `${socialH}%` }} />
                <div className="w-1.5 bg-green-500 rounded-t" style={{ height: `${clicksH}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground rotate-[-45deg] origin-top-left mt-1">
                {d.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
