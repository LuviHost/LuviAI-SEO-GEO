'use client';

import { formatDuration, formatNum, formatPct, formatPos } from '@/lib/format';
import { siteHref } from '@/lib/site-routes';
import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_AXIS, CHART_GRID } from '@/components/ui/chart-container';
import { CHART } from '@/lib/chart-colors';
import {
  TrendingUp, Lightbulb, BarChart3, MousePointerClick, Eye, Activity, Target as TargetIcon, Clock,
  FileText, Sparkles, Trophy, Percent, Hash, LogOut, RefreshCw, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/ui/metric';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/empty-state';
import { GoogleAiSurfaceCard } from '@/components/google-ai-surface-card';
import { SearchOpportunitiesCard } from '@/components/search-opportunities-card';

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
      // GSC property bağlı değilse hiç API call atma — backend toast hatası vermesin
      if (!site?.gscPropertyUrl) {
        setOverview(null);
        setTopArticles([]);
        setTrending([]);
        setSuggestions([]);
        setGaSummary(null);
        return;
      }
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

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId, site?.gscPropertyUrl]);

  // Auto-trigger snapshot: GSC bağlı + property seçili + veri yok → otomatik çek (kullanıcı buton tıklamasın).
  // autoTriggeredRef ile aynı session'da tekrar tetiklemeyi engelle (StrictMode + re-render guard).
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!site?.gscPropertyUrl) return;
    if (overview && overview.timeSeries?.length > 0) return;
    if (autoTriggeredRef.current) return;
    if (refreshing) return;
    autoTriggeredRef.current = true;
    (async () => {
      setRefreshing(true);
      try {
        await api.triggerSnapshotNow(siteId);
        await refresh();
      } catch (_err) {
        // Sessizce yut — empty state'te kullanıcıya 'veri ~24 saat sonra' mesajı gösterilir
      } finally {
        setRefreshing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, site?.gscPropertyUrl, overview]);

  const triggerSnapshot = async () => {
    setRefreshing(true);
    try {
      await api.triggerSnapshotNow(siteId);
      toast.success('Veriler güncellendi');
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

  if (!site?.gscPropertyUrl || !overview || overview.timeSeries?.length === 0) {
    return <AnalyticsEmptyState site={site} siteId={siteId} refreshing={refreshing} onTriggerSnapshot={triggerSnapshot} />;
  }

  const totals = overview.totals;

  // Eskiden ~9 kart tek uzun kaydirmaydi; simdi bes sekme. GSC ozeti ilk sekmede.
  return (
    <Tabs defaultValue="genel" className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList className="w-max">
          <TabsTrigger value="genel">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Genel
          </TabsTrigger>
          <TabsTrigger value="sayfalar">
            <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Sayfalar &amp; sorgular
          </TabsTrigger>
          <TabsTrigger value="ga4">
            <Activity className="h-3.5 w-3.5 mr-1.5" aria-hidden /> GA4
          </TabsTrigger>
          <TabsTrigger value="firsatlar">
            <Lightbulb className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Fırsatlar
          </TabsTrigger>
          <TabsTrigger value="google-ai">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Google AI
          </TabsTrigger>
        </TabsList>
      </div>

      {/* ── Genel: GSC KPI + grafik ── */}
      <TabsContent value="genel" className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard icon={MousePointerClick} label="Tıklama (30 gün)" value={totals.clicks} />
          <MetricCard icon={Eye} label="Gösterim (30 gün)" value={totals.impressions} accent="muted" />
          <MetricCard icon={Percent} label="Tıklama oranı" value={formatPct(totals.avgCtr, 2)} accent="muted" />
          <MetricCard icon={Hash} label="Ort. sıra" value={formatPos(totals.avgPosition)} accent="muted" />
        </div>

        {/* Markasız tıklama payı — organik "keşif kanalı" ölçüsü (AI tarafındaki brandInQuery ayrımının ikizi) */}
        {overview.brandSplit && (
          <Card>
            <CardContent className="p-4 flex items-start gap-4 flex-wrap">
              <div className="min-w-[120px]">
                <div className="text-label text-muted-foreground mb-1">Markasız tıklama payı</div>
                <div className="text-metric-lg tabular-nums">
                  {overview.brandSplit.unbrandedClickSharePct !== null ? `%${overview.brandSplit.unbrandedClickSharePct}` : '—'}
                </div>
              </div>
              <div className="flex-1 min-w-[240px] text-xs text-muted-foreground leading-relaxed">
                <div>
                  <strong>{formatNum(overview.brandSplit.unbranded.clicks)}</strong> markasız ·{' '}
                  <strong>{formatNum(overview.brandSplit.branded.clicks)}</strong> markalı tıklama
                  {' '}({formatNum(overview.brandSplit.unbranded.queries + overview.brandSplit.branded.queries)} sorgu örneklemi, {overview.brandSplit.daysWithQueries} gün)
                </div>
                <div className="mt-1">
                  Marka adını (<em>{overview.brandSplit.brand}</em>) içeren sorgular seni zaten bilenlerden gelir — bu hafıza, keşif değil.
                  Markasız pay ne kadar yüksekse Google o kadar gerçek bir keşif kanalı. Örneklem: gün başına en çok tıklanan 100 sorgu.
                </div>
                {overview.brandSplit.unbrandedClickSharePct !== null && overview.brandSplit.unbrandedClickSharePct < 20 && (
                  <div className="mt-1 text-warning">
                    Tıklamaların %80&apos;inden fazlası adını bilenlerden — henüz bir SEO keşif kanalın yok; markasız sorulara cevap veren içerik gerekiyor.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <h3 className="font-semibold">Son 30 gün — tıklama ve gösterim</h3>
            <Button size="sm" variant="outline" onClick={triggerSnapshot} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              {refreshing ? 'Yenileniyor…' : 'Yenile'}
            </Button>
          </CardHeader>
          <CardContent>
            <ChartContainer height={256}>
              <LineChart data={overview.timeSeries}>
                <CartesianGrid {...CHART_GRID} strokeDasharray="3 3" />
                <XAxis dataKey="date" {...CHART_AXIS} />
                <YAxis yAxisId="left" {...CHART_AXIS} width={44} />
                <YAxis yAxisId="right" orientation="right" {...CHART_AXIS} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="clicks" stroke={CHART[1]} strokeWidth={2} dot={false} name="Tıklama" />
                <Line yAxisId="right" type="monotone" dataKey="impressions" stroke={CHART[8]} strokeWidth={2} dot={false} name="Gösterim" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Sayfalar & sorgular ── */}
      <TabsContent value="sayfalar" className="space-y-4">
        <Card>
          <CardHeader>
            <h3 className="font-semibold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand" aria-hidden /> En iyi performans gösteren makaleler
            </h3>
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
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        <span>{formatNum(a.clicks)} tıklama</span>
                        <span>{formatNum(a.impressions)} gösterim</span>
                        <span>Tıklama oranı {formatPct(a.ctr)}</span>
                        <span>Ort. sıra {formatPos(a.position)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" aria-hidden /> Yükselen sorgular (son 7 gün)
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            {trending.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Son 7 günde belirgin yükselen sorgu yok.
              </div>
            ) : (
              <div className="divide-y">
                {trending.map((t, i) => (
                  <div key={i} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium min-w-0 truncate">{t.query}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatNum(t.recentImp)} gösterim</span>
                      <Badge variant="success">+{t.growthPct}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── GA4 davranış metrikleri (opsiyonel) ── */}
      <TabsContent value="ga4" className="space-y-4">
        {gaSummary ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard icon={Activity} label="Oturum (30 gün)" value={gaSummary.totalSessions} />
              <MetricCard icon={TargetIcon} label="Dönüşüm (30 gün)" value={gaSummary.totalConversions} accent="muted" />
              <MetricCard icon={Clock} label="Ort. etkileşim" value={formatDuration(gaSummary.avgEngagementSec)} accent="muted" />
              <MetricCard icon={LogOut} label="Hemen çıkma oranı" value={formatPct(gaSummary.avgBounceRate)} accent="muted" />
            </div>

            {gaSummary.topPages?.length > 0 && (
              <Card>
                <CardHeader>
                  <h3 className="font-semibold">En çok ziyaret edilen sayfalar</h3>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {gaSummary.topPages.slice(0, 10).map((p: any, i: number) => (
                      <div key={i} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.pagePath}</div>
                          <div className="text-xs text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
                            <span>{formatNum(p.sessions)} oturum</span>
                            <span>{formatNum(p.conversions)} dönüşüm</span>
                            <span>{formatDuration(p.avgEngagementSec)} etkileşim</span>
                            <span className={p.bounceRate >= 0.7 ? 'text-danger font-medium' : ''}>
                              {formatPct(p.bounceRate, 0)} hemen çıkma
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
        ) : (
          <EmptyState
            icon={Activity}
            title="GA4 bağlı değil"
            description="Oturum, dönüşüm ve hemen çıkma verisi için Google Analytics 4 mülkünü bağla."
            primary={{ label: 'Bağlantılara git', href: siteHref(siteId, 'connections') }}
          />
        )}
      </TabsContent>

      {/* ── Fırsatlar: GSC × GA4 + iyileştirme önerileri ── */}
      <TabsContent value="firsatlar" className="space-y-4">
        {/* GSC × GA4 arama firsatlari — GA bagliysa (ozet geldiyse) */}
        {gaSummary && <SearchOpportunitiesCard siteId={siteId} />}

        <Card>
          <CardHeader>
            <h3 className="font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-warning" aria-hidden /> İyileştirme önerileri
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            {suggestions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Şu an ilk sayfaya yakın ya da tıklama oranı düşük sorgu bulunmadı.
              </div>
            ) : (
              <div className="divide-y">
                {suggestions.slice(0, 10).map((s, i) => (
                  <div key={i} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2 mb-1 min-w-0">
                      <Badge variant={s.type === 'near-miss' ? 'warning' : 'secondary'} className="shrink-0">
                        {s.type === 'near-miss' ? 'İlk sayfaya yakın' : 'Düşük tıklama oranı'}
                      </Badge>
                      <span className="font-medium truncate">{s.query}</span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-1">{s.recommendation}</p>
                    <div className="text-xs text-muted-foreground mt-1 ml-1">
                      {formatNum(s.impressions)} gösterim · ort. sıra {formatPos(s.position)} · tıklama oranı {formatPct(s.ctr ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Google AI yüzeyi — AIO/AI Mode gösterimleri (CSV import), AI-Mode-şüpheli sorgular, Preferred Sources ── */}
      <TabsContent value="google-ai">
        <GoogleAiSurfaceCard siteId={siteId} site={site} />
      </TabsContent>
    </Tabs>
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

  const isGscConnected = !!site?.gscConnectedAt;
  const hasGscProperty = !!site?.gscPropertyUrl;

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

  // Hiç bağlı değil → birincil aksiyon: GSC bağla
  if (!isGscConnected) {
    return (
      <Card>
        <CardContent className="p-10 sm:p-12 text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-brand/10 grid place-items-center border border-brand/20">
            <BarChart3 className="h-6 w-6 text-brand" />
          </div>
          <h3 className="text-h6 font-semibold mb-1">Analitik henüz aktif değil</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Performans verisini görmek için önce Google Search Console'u bağla.
            Bağlandıktan ~24 saat sonra ilk veri görünür.
          </p>
          <p className="text-xs text-muted-foreground mb-6 max-w-md mx-auto">
            Search Console AI cevaplarında nerede görünmediğini ve tıklamayı nerede kaybettiğini söyleyemez; onu RanksUp doğrudan ölçer. GSC burada Google'daki gerçek tıklamayı — tahmini değil — markalı/markasız ayrımıyla gösterir.
          </p>
          <div className="flex justify-center">
            <Button onClick={connectGsc} disabled={connecting} size="lg">
              <Search className="h-4 w-4 mr-2" aria-hidden />
              {connecting ? 'Yönlendiriliyor…' : 'Google Search Console bağla'}
            </Button>

          </div>
          <p className="text-label text-muted-foreground mt-5">
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
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-warning/10 grid place-items-center border border-warning/20">
            <BarChart3 className="h-6 w-6 text-warning" />
          </div>
          <h3 className="text-h6 font-semibold mb-1">GSC bağlandı — şimdi mülk seç</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Google Search Console hesabın bağlı, ama hangi mülkün verisinin çekileceğini henüz seçmedin.
            Bağlantılar sayfasından mülkü seç, sonra geri gel.
          </p>
          <Button asChild size="lg">
            <a href={siteHref(siteId, 'connections')}>Mülk seç</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Bağlı + property var, ama henüz veri çekilmedi (snapshot otomatik tetiklenir)
  return (
    <Card>
      <CardContent className="p-10 sm:p-12 text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-success/10 grid place-items-center border border-success/20 relative">
          <BarChart3 className="h-6 w-6 text-success" />
          {refreshing && (
            <span className="absolute -inset-1 rounded-2xl border-2 border-success/40 animate-pulse" />
          )}
        </div>
        <h3 className="text-h6 font-semibold mb-1">
          {refreshing ? 'Veri çekiliyor…' : 'GSC bağlı — ilk veri yolda'}
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {refreshing
            ? 'Google Search Console\'dan veri otomatik çekiliyor. Bu birkaç saniye sürebilir.'
            : 'Mülkünde henüz indekslenmiş veri olmayabilir. Veri görünmeye başladığında otomatik gelir (~24 saat).'}
        </p>
        <div className="flex items-center justify-center gap-2 mt-5 text-label text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${refreshing ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'}`} />
          {refreshing ? 'Veri çekiliyor' : 'GSC bağlı'}
        </div>
      </CardContent>
    </Card>
  );
}
