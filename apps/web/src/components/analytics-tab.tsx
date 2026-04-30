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

export function AnalyticsTab({ siteId, site }: { siteId: string; site?: any }) {
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
    return <AnalyticsEmptyState site={site} siteId={siteId} refreshing={refreshing} onTriggerSnapshot={triggerSnapshot} />;
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


/**
 * Analytics empty state — siteye ait GSC durumunu okur ve uygun aksiyonu gösterir.
 *   - GSC hiç bağlı değil    → "Google Search Console Bağla" butonu (OAuth başlatır)
 *   - GSC bağlı, veri yok    → "Şimdi Çek (test)" — manual snapshot tetikler
 *   - GSC bağlı, property seçilmedi → "Property seç" mesajı + Ayarlar linkine yönlendirir
 */
function AnalyticsEmptyState({
  site, siteId, refreshing, onTriggerSnapshot,
}: {
  site?: any;
  siteId: string;
  refreshing: boolean;
  onTriggerSnapshot: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [connectingGa, setConnectingGa] = useState(false);

  const isGscConnected = !!site?.gscConnectedAt;
  const hasGscProperty = !!site?.gscPropertyUrl;
  const isGaConnected = !!site?.gaConnectedAt;

  const connectGsc = async () => {
    setConnecting(true);
    try {
      const { url } = await api.getGscAuthUrl(siteId);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message);
      setConnecting(false);
    }
  };

  const connectGa = async () => {
    setConnectingGa(true);
    try {
      const { url } = await api.getGaAuthUrl(siteId);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message);
      setConnectingGa(false);
    }
  };

  // Hiç bağlı değil → birincil aksiyon: GSC bağla
  if (!isGscConnected) {
    return (
      <Card>
        <CardContent className="p-10 sm:p-12 text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-gradient-to-br from-brand/15 to-violet-500/15 grid place-items-center border border-brand/20">
            <BarChart3 className="h-6 w-6 text-brand" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Analytics henüz aktif değil</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Performans verisini görmek için önce Google Search Console'u bağla.
            Bağlandıktan ~24 saat sonra ilk veri görünür.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center max-w-lg mx-auto">
            <Button onClick={connectGsc} disabled={connecting} size="lg" className="font-mono text-xs uppercase tracking-widest">
              <span aria-hidden className="mr-2">🔍</span>
              {connecting ? 'Yönlendiriliyor…' : 'Google Search Console Bağla'}
            </Button>
            {!isGaConnected && (
              <Button onClick={connectGa} disabled={connectingGa} size="lg" variant="outline" className="font-mono text-xs uppercase tracking-widest">
                <span aria-hidden className="mr-2">📊</span>
                {connectingGa ? 'Yönlendiriliyor…' : 'Google Analytics 4 Bağla'}
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-wider mt-5">
            OAuth · sadece okuma izni · istediğin zaman bağlantıyı kesebilirsin
          </p>
        </CardContent>
      </Card>
    );
  }

  // Bağlı ama property seçilmemiş
  if (isGscConnected && !hasGscProperty) {
    return (
      <Card>
        <CardContent className="p-10 sm:p-12 text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-amber-500/10 grid place-items-center border border-amber-500/20">
            <BarChart3 className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold mb-1">GSC bağlandı — şimdi property seç</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Google Search Console hesabın bağlı, ama hangi property'nin verisinin çekileceğini henüz seçmedin.
            Veri tab'ına gidip property'yi seç, sonra geri gel.
          </p>
          <Button asChild size="lg" className="font-mono text-xs uppercase tracking-widest">
            <a href={`/sites/${siteId}?tab=data#gsc`}>Property Seç →</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Bağlı + property var, ama henüz veri çekilmedi (snapshot bekleniyor)
  return (
    <Card>
      <CardContent className="p-10 sm:p-12 text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-emerald-500/10 grid place-items-center border border-emerald-500/20">
          <BarChart3 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold mb-1">GSC bağlı — ilk veri yolda</h3>
        <p className="text-sm text-muted-foreground mb-1 max-w-md mx-auto">
          Google Search Console aktif. İlk snapshot otomatik olarak ~24 saat içinde alınır.
        </p>
        <p className="text-xs text-muted-foreground mb-6 max-w-md mx-auto">
          Beklemek istemezsen aşağıdaki butona basıp anlık snapshot tetikleyebilirsin.
        </p>
        <Button onClick={onTriggerSnapshot} disabled={refreshing} size="lg" className="font-mono text-xs uppercase tracking-widest">
          {refreshing ? 'Çekiliyor…' : 'Şimdi Çek (test)'}
        </Button>
      </CardContent>
    </Card>
  );
}
