'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Sparkles, Rocket, Bot, Search } from 'lucide-react';
import { api } from '@/lib/api';

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
 * GEO (AI görünürlük) + SEO (Google trafiği/sıralaması) büyümesini birlikte gösterir.
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
    return <div className="rounded-2xl border bg-muted/30 h-28 animate-pulse" />;
  }

  // ── GEO / AI ──────────────────────────────────────────────
  const trends: any[] = geo?.trends ?? [];
  const byProvider: Record<string, any[]> = geo?.byProvider ?? {};
  let geoFirstDate: string | null = null, geoLastDate: string | null = null;
  for (const series of Object.values(byProvider)) {
    if (!series?.length) continue;
    if (!geoFirstDate || series[0].date < geoFirstDate) geoFirstDate = series[0].date;
    const ld = series[series.length - 1].date;
    if (!geoLastDate || ld > geoLastDate) geoLastDate = ld;
  }
  const geoSpan = geoFirstDate && geoLastDate ? Math.round((+new Date(geoLastDate) - +new Date(geoFirstDate)) / 86400000) : 0;
  const enginesStart = trends.filter((t) => (t.first ?? 0) > 0).length;
  const enginesNow = trends.filter((t) => (t.last ?? 0) > 0).length;
  const totalEngines = trends.length;
  const geoFirstAvg = Math.round(avg(trends.map((t) => t.first).filter((v) => typeof v === 'number')));
  const geoLastAvg = Math.round(avg(trends.map((t) => t.last).filter((v) => typeof v === 'number')));
  const geoGrowth = pct(geoFirstAvg, geoLastAvg);
  const newEngines = trends.filter((t) => (t.last ?? 0) > 0 && (t.first ?? 0) <= 0).map((t) => LABELS[t.provider] ?? t.provider);
  const hasGeo = trends.length > 0;
  const geoEarly = geoSpan < 2 && geoFirstAvg === geoLastAvg && enginesStart === enginesNow;

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
    return null; // hiç veri yok — kartı gösterme
  }

  return (
    <div className="rounded-2xl border border-orange-500/25 bg-gradient-to-br from-orange-500/[0.07] via-card to-emerald-500/[0.04] p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="font-semibold text-sm leading-none">RanksUp Etkisi</p>
          <p className="text-xs text-muted-foreground mt-0.5">Markanın AI ve Google'da büyümesi · son {days} gün</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── AI Görünürlük (GEO) ── */}
        <div className="rounded-xl border bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-300 mb-2">
            <Bot className="h-3.5 w-3.5" /> AI GÖRÜNÜRLÜK (GEO)
          </div>
          {!hasGeo ? (
            <p className="text-sm text-muted-foreground">Henüz AI ölçümü yok.</p>
          ) : geoEarly ? (
            <div className="flex items-center gap-2 text-sm">
              <Rocket className="h-4 w-4 text-orange-500" />
              <span>Başlangıç: <strong>{enginesNow}/{totalEngines}</strong> motor · skor <strong>{geoLastAvg}</strong>. Büyüme yakında.</span>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                {(geoGrowth ?? 0) >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-500 self-center" /> : <TrendingDown className="h-5 w-5 text-red-500 self-center" />}
                <span className={`text-3xl font-extrabold ${(geoGrowth ?? 1) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
                  {geoGrowth === null ? `+${geoLastAvg}` : `${geoGrowth >= 0 ? '+' : ''}${geoGrowth}%`}
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 space-y-0.5">
                <div>Tanıyan motor: <strong className="text-foreground">{enginesStart} → {enginesNow}</strong>/{totalEngines}</div>
                <div>Ort. AI skoru: <strong className="text-foreground">{geoFirstAvg} → {geoLastAvg}</strong></div>
              </div>
              {newEngines.length > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5">🎉 {newEngines.join(', ')} artık tanıyor</p>
              )}
            </>
          )}
        </div>

        {/* ── Google (SEO) ── */}
        <div className="rounded-xl border bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-300 mb-2">
            <Search className="h-3.5 w-3.5" /> GOOGLE (SEO)
          </div>
          {!hasSeo ? (
            <p className="text-sm text-muted-foreground">
              Google trafiği için <strong>Search Console</strong> bağla → SEO büyümen de burada görünsün.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                {(clicksGrowth ?? 0) >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-500 self-center" /> : <TrendingDown className="h-5 w-5 text-red-500 self-center" />}
                <span className={`text-3xl font-extrabold ${(clicksGrowth ?? 1) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
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
                    <span className={posNow <= posStart ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}>
                      {posNow <= posStart ? '↑ daha iyi' : '↓ düştü'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
