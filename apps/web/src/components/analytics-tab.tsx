'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Lightbulb, BarChart3, MousePointerClick, Eye, Activity, Target as TargetIcon, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export function AnalyticsTab({ siteId }: { siteId: string }) {
  const [overview, setOverview] = useState<any>(null);
  const [topArticles, setTopArticles] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [gaSummary, setGaSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    try {
      const [o, t, tr, s, ga] = await Promise.all([
        api.getAnalyticsOverview(siteId, 30).catch(() => null),
        api.getTopArticles(siteId, 10).catch(() => []),
        api.getTrendingQueries(siteId).catch(() => []),
        api.getImprovementSuggestions(siteId).catch(() => []),
        api.getGaSummary(siteId, 30).catch(() => null),
      ]);
      setOverview(o);
      setTopArticles(t);
      setTrending(tr);
      setSuggestions(s);
      setGaSummary(ga);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [siteId]);

  const triggerSnapshot = async () => {
    setRefreshing(true);
    try {
      await api.triggerSnapshotNow(siteId);
      toast.success('Snapshot tamamlandı');
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!overview || overview.timeSeries?.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <BarChart3 className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">Henüz analytics verisi yok.</p>
          <p className="text-xs text-muted-foreground mb-6">
            Önce <strong>Ayarlar</strong> sekmesinden Google Search Console bağla.<br />
            Bağlandıktan ~24 saat sonra ilk veri görünür; hemen test etmek için aşağıdaki butona bas.
          </p>
          <Button onClick={triggerSnapshot} disabled={refreshing}>
            {refreshing ? 'Çekiliyor…' : 'Şimdi Çek (test)'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totals = overview.totals;

  return (
    <div className="space-y-6">
      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard icon={<MousePointerClick />} label="Tıklama" value={totals.clicks.toLocaleString('tr-TR')} />
        <MetricCard icon={<Eye />} label="Gösterim" value={totals.impressions.toLocaleString('tr-TR')} />
        <MetricCard label="CTR" value={`${(totals.avgCtr * 100).toFixed(2)}%`} />
        <MetricCard label="Sıralama" value={totals.avgPosition.toFixed(1)} />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <h3 className="font-semibold">Son 30 Gün — Tıklama & Gösterim</h3>
          <Button size="sm" variant="outline" onClick={triggerSnapshot} disabled={refreshing}>
            {refreshing ? '…' : 'Yenile'}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                  }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="clicks" stroke="#6c5ce7" strokeWidth={2} name="Tıklama" />
                <Line yAxisId="right" type="monotone" dataKey="impressions" stroke="#a29bfe" strokeWidth={2} name="Gösterim" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* GA4 davranış metrikleri (opsiyonel) */}
      {gaSummary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard icon={<Activity />} label="Oturum (30g)" value={gaSummary.totalSessions.toLocaleString('tr-TR')} />
            <MetricCard icon={<TargetIcon />} label="Conversion (30g)" value={gaSummary.totalConversions.toLocaleString('tr-TR')} />
            <MetricCard
              icon={<Clock />}
              label="Ort. etkileşim"
              value={`${Math.round(gaSummary.avgEngagementSec)} sn`}
            />
            <MetricCard
              label="Bounce rate"
              value={`${(gaSummary.avgBounceRate * 100).toFixed(1)}%`}
            />
          </div>

          {gaSummary.topPages?.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold">📈 GA4 — En çok ziyaret edilen sayfalar</h3>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {gaSummary.topPages.slice(0, 10).map((p: any, i: number) => (
                    <div key={i} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.pagePath}</div>
                        <div className="text-xs text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
                          <span>{p.sessions} oturum</span>
                          <span>{p.conversions} dönüşüm</span>
                          <span>{Math.round(p.avgEngagementSec)} sn etkileşim</span>
                          <span className={p.bounceRate >= 0.7 ? 'text-red-500 font-medium' : ''}>
                            {(p.bounceRate * 100).toFixed(0)}% bounce
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Top articles */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold">🏆 En İyi Performans Gösteren Makaleler</h3>
        </CardHeader>
        <CardContent className="p-0">
          {topArticles.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Henüz performans verisi olan makale yok.
            </div>
          ) : (
            <div className="divide-y">
              {topArticles.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{a.title}</h4>
                    <div className="text-xs text-muted-foreground flex gap-4 mt-1">
                      <span>{a.clicks} tıklama</span>
                      <span>{a.impressions} gösterim</span>
                      <span>CTR {(a.ctr * 100).toFixed(1)}%</span>
                      <span>Pos {a.position.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trending */}
      {trending.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" /> Yükselen Sorgular (son 7g)
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {trending.map((t, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                  <span className="font-medium">{t.query}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{t.recentImp} imp</span>
                    <Badge variant="success">+{t.growthPct}%</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-500" /> İyileştirme Önerileri
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {suggestions.slice(0, 10).map((s, i) => (
                <div key={i} className="px-5 py-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={s.type === 'near-miss' ? 'warning' : 'secondary'}>
                      {s.type === 'near-miss' ? 'YAKIN MISS' : 'DÜŞÜK CTR'}
                    </Badge>
                    <span className="font-medium truncate">{s.query}</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-1">{s.recommendation}</p>
                  <div className="text-xs text-muted-foreground mt-1 ml-1">
                    {s.impressions} imp · pos {s.position?.toFixed(1) ?? '-'} · CTR {((s.ctr ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
