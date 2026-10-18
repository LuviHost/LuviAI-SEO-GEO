'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Sparkles, Rocket, Bot, Search, PartyPopper, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { geoImpact, formatTrDate } from '@/components/geo-impact';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const LABELS: Record<string, string> = {
  anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT',
  perplexity: 'Perplexity', xai: 'Grok', grok: 'Grok', deepseek: 'DeepSeek', meta: 'Meta AI',
};

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** timeSeries'in ilk/son ~%25'lik penceresinin ortalamasi (gurultu azaltma) */
function windowAvg(series: any[], key: string, which: 'first' | 'last'): number | null {
  if (!series?.length) return null;
  const n = Math.max(1, Math.floor(series.length / 4));
  const slice = which === 'first' ? series.slice(0, n) : series.slice(-n);
  const vals = slice.map((s) => s[key]).filter((v) => typeof v === 'number');
  return vals.length ? avg(vals) : null;
}

function pct(from: number, to: number): number | null {
  if (from > 0) return Math.round(((to - from) / from) * 100);
  return to > 0 ? null : 0;
}

/**
 * "RanksUp Etkisi" — site Genel Bakış'ta bütünsel before-after değer kartı.
 * GEO (AI görünürlük) + SEO (Google trafiği/sıralaması) değişimini birlikte gösterir.
 * GEO kıyası yalnız güncel ölçüm yöntemiyle yapılan ölçümler arasında (geo-impact.ts).
 */
export function RanksUpImpactCard({ siteId, days = 90 }: { siteId: string; days?: number }) {
  const [geo, setGeo] = useState<any>(null);
  const [seo, setSeo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      api.getCitationHistory(siteId, days),
      api.getAnalyticsOverview(siteId, days),
    ]).then(([g, s]) => {
      if (!mounted) return;
      if (g.status === 'fulfilled') setGeo(g.value);
      if (s.status === 'fulfilled') setSeo(s.value);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [siteId, days]);

  if (loading) {
    return <Skeleton className="h-44 w-full" aria-label="RanksUp etkisi yükleniyor" />;
  }

  // ── GEO / AI ──────────────────────────────────────────────
  // Kiyas yalniz GUNCEL olcum yontemiyle yapilan olcumler arasinda (geo-impact.ts):
  // yontem degistiyse eski ile yeni yontem kiyaslanmaz, notr "kiyas yok" gosterilir.
  const g = geoImpact(geo);
  const hasGeo = g.state !== 'none';
  const geoFirstAvg = g.firstAvg ?? 0;
  const geoLastAvg = g.lastAvg ?? 0;
  const geoGrowth = g.growthPct;
  const geoDirection = geoLastAvg > geoFirstAvg ? 'up' : geoLastAvg < geoFirstAvg ? 'down' : 'flat';
  const newEngines = g.newEngines.map((p) => LABELS[p] ?? p);

  // ── SEO / Google ──────────────────────────────────────────
  const ts: any[] = seo?.timeSeries ?? [];
  const hasSeo = ts.length >= 2;
  const clicksStart = windowAvg(ts, 'clicks', 'first');
  const clicksNow = windowAvg(ts, 'clicks', 'last');
  const imprStart = windowAvg(ts, 'impressions', 'first');
  const imprNow = windowAvg(ts, 'impressions', 'last');
  const posStart = windowAvg(ts, 'position', 'first');
  const posNow = windowAvg(ts, 'position', 'last');
  const clicksGrowth = (clicksStart != null && clicksNow != null) ? pct(clicksStart, clicksNow) : null;

  if (!hasGeo && !hasSeo) {
    return null; // hiç veri yok — kartı gösterme (altındaki trend grafiği kendi boş durumunu basar)
  }

  const up = 'text-success';
  const down = 'text-danger';

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="grid place-items-center h-8 w-8 rounded-md border border-border bg-muted/50 text-foreground/70">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h3 className="font-semibold text-sm leading-none">RanksUp etkisi</h3>
          <p className="text-label text-muted-foreground mt-1">Markanın AI ve Google&apos;daki değişimi · son {days} gün</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── AI Görünürlük (GEO) ── */}
        <div className="rounded-md border bg-muted/20 p-4">
          <div className="flex items-center gap-1.5 text-label text-muted-foreground mb-2">
            <Bot className="h-3.5 w-3.5 text-brand" aria-hidden /> AI görünürlük (GEO)
          </div>
          {!hasGeo ? (
            <p className="text-sm text-muted-foreground">Henüz AI ölçümü yok.</p>
          ) : g.state === 'method-changed' ? (
            <div className="flex items-start gap-2 text-sm">
              <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
              <span>
                Ölçüm yöntemi güncellendi — kıyas yok{g.methodChangedAt ? ` (${formatTrDate(g.methodChangedAt)})` : ''}.
                Şu an <strong>{g.enginesNow}/{g.totalEngines}</strong> asistanda görünüyorsun{g.lastAvg !== null ? <> · skor <strong>{g.lastAvg}</strong></> : null}.
              </span>
            </div>
          ) : g.state === 'baseline' ? (
            <div className="flex items-center gap-2 text-sm">
              <Rocket className="h-4 w-4 text-brand" aria-hidden />
              <span>Başlangıç: <strong>{g.enginesNow}/{g.totalEngines}</strong> asistanda görünüyorsun{g.lastAvg !== null ? <> · skor <strong>{g.lastAvg}</strong></> : null}. Değişim, sonraki ölçümden sonra görünür.</span>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                {geoDirection === 'up' ? <TrendingUp className={cn('h-5 w-5 self-center', up)} aria-hidden />
                  : geoDirection === 'down' ? <TrendingDown className={cn('h-5 w-5 self-center', down)} aria-hidden />
                  : <Minus className="h-5 w-5 self-center text-muted-foreground" aria-hidden />}
                <span className={cn('text-metric-lg tabular-nums', geoDirection === 'up' ? up : geoDirection === 'down' ? down : 'text-muted-foreground')}>
                  {geoGrowth === null ? `+${geoLastAvg}` : `${geoGrowth > 0 ? '+' : ''}${geoGrowth}%`}
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 space-y-0.5">
                <div>Görünür olduğun asistan: <strong className="text-foreground">{g.enginesStart} → {g.enginesNow}</strong>/{g.totalEngines}</div>
                <div>Ort. AI skoru: <strong className="text-foreground">{geoFirstAvg} → {geoLastAvg}</strong> <span className="text-label">({g.spanDays} günlük aralık)</span></div>
              </div>
              {newEngines.length > 0 && (
                <p className="text-label text-success mt-1.5 inline-flex items-center gap-1"><PartyPopper className="h-3.5 w-3.5" aria-hidden /> {newEngines.join(', ')} cevaplarında artık görünüyorsun</p>
              )}
              {g.methodChanged && g.methodChangedAt && (
                <p className="text-label text-muted-foreground mt-1.5">Ölçüm yöntemi {formatTrDate(g.methodChangedAt)} tarihinde güncellendi; kıyas bu tarihten sonraki ölçümlerle.</p>
              )}
            </>
          )}
        </div>

        {/* ── Google (SEO) ── */}
        <div className="rounded-md border bg-muted/20 p-4">
          <div className="flex items-center gap-1.5 text-label text-muted-foreground mb-2">
            <Search className="h-3.5 w-3.5 text-info" aria-hidden /> Google (SEO)
          </div>
          {!hasSeo ? (
            <p className="text-sm text-muted-foreground">
              Google trafiği için <strong>Search Console</strong> bağla → SEO büyümen de burada görünsün.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                {(clicksGrowth ?? 0) >= 0 ? <TrendingUp className={cn('h-5 w-5 self-center', up)} aria-hidden /> : <TrendingDown className={cn('h-5 w-5 self-center', down)} aria-hidden />}
                <span className={cn('text-metric-lg tabular-nums', (clicksGrowth ?? 1) >= 0 ? up : down)}>
                  {clicksGrowth === null ? `+${Math.round(clicksNow ?? 0)}` : `${clicksGrowth >= 0 ? '+' : ''}${clicksGrowth}%`}
                </span>
                <span className="text-xs text-muted-foreground">tıklama</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 space-y-0.5">
                <div>Tıklama: <strong className="text-foreground">{Math.round(clicksStart ?? 0)} → {Math.round(clicksNow ?? 0)}</strong> /gün</div>
                <div>Gösterim: <strong className="text-foreground">{Math.round(imprStart ?? 0)} → {Math.round(imprNow ?? 0)}</strong> /gün</div>
                {posStart != null && posNow != null && (
                  <div>
                    Ort. sıra: <strong className="text-foreground">{posStart.toFixed(1)} → {posNow.toFixed(1)}</strong>{' '}
                    <span className={posNow <= posStart ? up : down}>
                      {posNow <= posStart ? '↑ daha iyi' : '↓ düştü'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
