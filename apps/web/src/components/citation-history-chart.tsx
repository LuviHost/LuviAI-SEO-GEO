'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown, Minus, Sparkles, RefreshCw, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#a78bfa',  // mor — Claude
  gemini: '#60a5fa',     // mavi — Gemini
  openai: '#34d399',     // yesil — ChatGPT
  perplexity: '#fb923c', // turuncu — Perplexity
  grok: '#f87171',
  deepseek: '#94a3b8',
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  grok: 'Grok',
  deepseek: 'DeepSeek',
};

/**
 * AI Citation gunluk gorunurluk trendi — provider bazli SVG line chart.
 * 7/30/90/365 gun secimi. Her sayfa yuklenisinde fresh fetch.
 */
export function CitationHistoryChart({ siteId }: { siteId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async (d: number) => {
    setLoading(true);
    try {
      const res = await api.getCitationHistory(siteId, d);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days, siteId]);

  const triggerSnapshot = async () => {
    setRunning(true);
    try {
      await api.triggerCitationSnapshot(siteId);
      toast.success('AI görünürlük testi çalıştı, snapshot kaydedildi');
      await load(days);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground p-6 text-center">AI görünürlük tarihçesi yükleniyor…</div>;
  }

  const byProvider = data.byProvider ?? {};
  const trends = data.trends ?? [];
  const providers = Object.keys(byProvider).filter((p) => byProvider[p].length > 0);

  // Tum tarihleri topla, x-axis icin
  const allDates = new Set<string>();
  for (const p of providers) {
    for (const point of byProvider[p]) allDates.add(point.date);
  }
  const sortedDates = [...allDates].sort();

  // Skor map: provider -> date -> score
  const scoreMap: Record<string, Record<string, number | null>> = {};
  for (const p of providers) {
    scoreMap[p] = {};
    for (const point of byProvider[p]) {
      scoreMap[p][point.date] = point.score;
    }
  }

  const chartW = 720;
  const chartH = 200;
  const pad = { top: 16, right: 12, bottom: 24, left: 32 };
  const innerW = chartW - pad.left - pad.right;
  const innerH = chartH - pad.top - pad.bottom;

  const xStep = sortedDates.length > 1 ? innerW / (sortedDates.length - 1) : innerW;
  const y = (score: number) => innerH - (score / 100) * innerH;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" /> AI Görünürlük Trendi
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Claude · Gemini · ChatGPT · Perplexity'de site URL'inin alıntılanma skoru — günlük snapshot
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border rounded-md overflow-hidden">
              {[7, 30, 90, 365].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 text-xs font-medium ${
                    days === d ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d}g
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={triggerSnapshot} disabled={running}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${running ? 'animate-spin' : ''}`} /> Yeniden Test
            </Button>
          </div>
        </div>

        {sortedDates.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Henüz AI görünürlük snapshot'ı yok. "Yeniden Test" tıklayarak ilk veri noktasını oluştur.
          </div>
        ) : (
          <>
            {/* Trend rozetler */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {trends.map((t: any) => {
                const color = PROVIDER_COLORS[t.provider] ?? '#94a3b8';
                const label = PROVIDER_LABELS[t.provider] ?? t.provider;
                return (
                  <div key={t.provider} className="rounded-md border p-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.first ?? '—'} → <strong>{t.last ?? '—'}</strong>
                        {t.delta !== null && (
                          <span className={`ml-1 ${t.delta > 0 ? 'text-green-500' : t.delta < 0 ? 'text-red-500' : ''}`}>
                            {t.delta > 0 ? '+' : ''}{t.delta}
                          </span>
                        )}
                      </p>
                    </div>
                    {t.delta !== null && (
                      t.delta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-green-500" /> :
                      t.delta < 0 ? <TrendingDown className="h-3.5 w-3.5 text-red-500" /> :
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Line chart */}
            <div className="overflow-x-auto">
              <svg width={chartW} height={chartH} className="text-muted-foreground">
                {/* Grid */}
                {[0, 25, 50, 75, 100].map((g) => (
                  <g key={g}>
                    <line
                      x1={pad.left} y1={pad.top + y(g)}
                      x2={pad.left + innerW} y2={pad.top + y(g)}
                      stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2 4"
                    />
                    <text x={pad.left - 6} y={pad.top + y(g) + 3} textAnchor="end" fontSize={10} fill="currentColor">
                      {g}
                    </text>
                  </g>
                ))}

                {/* Lines per provider */}
                {providers.map((p) => {
                  const color = PROVIDER_COLORS[p] ?? '#94a3b8';
                  const points = sortedDates
                    .map((d, i) => {
                      const s = scoreMap[p][d];
                      if (s === null || s === undefined) return null;
                      return `${pad.left + i * xStep},${pad.top + y(s)}`;
                    })
                    .filter(Boolean) as string[];
                  if (points.length === 0) return null;
                  return (
                    <g key={p}>
                      <polyline
                        points={points.join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {points.map((pt, idx) => {
                        const [x, py] = pt.split(',').map(Number);
                        return <circle key={idx} cx={x} cy={py} r={3} fill={color} />;
                      })}
                    </g>
                  );
                })}

                {/* X axis dates (her 5 noktada bir label) */}
                {sortedDates.map((d, i) => {
                  if (i % Math.max(1, Math.floor(sortedDates.length / 6)) !== 0) return null;
                  return (
                    <text
                      key={d}
                      x={pad.left + i * xStep}
                      y={chartH - 6}
                      textAnchor="middle"
                      fontSize={9}
                      fill="currentColor"
                    >
                      {d.slice(5)}
                    </text>
                  );
                })}
              </svg>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
