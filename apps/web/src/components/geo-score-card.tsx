'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Award, Check, X, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/info-tooltip';

// Durum tonlari token'dan
const STATUS_COLOR: Record<string, string> = {
  great: 'text-success bg-success/10 border-success/30',
  good: 'text-info bg-info/10 border-info/30',
  warning: 'text-warning bg-warning/10 border-warning/30',
  critical: 'text-danger bg-danger/10 border-danger/30',
};

const GRADE_COLOR: Record<string, string> = {
  'A+': 'text-success',
  'A': 'text-success',
  'B': 'text-info',
  'C': 'text-warning',
  'D': 'text-brand',
  'F': 'text-danger',
};

/**
 * GEO Score Card — sitenin tum GEO bilesenlerinin saglik skoru.
 * 6 pillar uzerinden agirlikli ortalama + harf notu.
 */
export function GeoScoreCard({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getGeoScoreCard(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);

  if (loading || !data) {
    return (
      <Card aria-busy="true" aria-label="GEO skoru hazırlanıyor">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold inline-flex items-center gap-2">
              <Award className="h-4 w-4 text-brand" aria-hidden />
              <InfoTooltip term="GEO Score">GEO skoru</InfoTooltip>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sitenin{' '}
              <InfoTooltip term="GEO">
                <span className="underline decoration-dotted cursor-help">AI search engine</span>
              </InfoTooltip>
              'lerde görünürlük seviyesi · 6 sütun · ağırlıklı ortalama
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden /> Yenile
          </Button>
        </div>

        {/* Ozet: not + skor + 6 sutun puani; kontrol ayrintilari katli */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-baseline gap-3">
            <span className={`text-metric-lg ${GRADE_COLOR[data.grade] ?? 'text-muted-foreground'}`} aria-label={`Harf notu ${data.grade}`}>
              {data.grade}
            </span>
            <span className="text-metric-lg tabular-nums">
              {data.overallScore}<span className="text-sm font-normal text-muted-foreground">/100</span>
            </span>
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {data.pillars.map((p: any) => (
              <span key={p.id} className={`inline-flex items-center gap-1.5 rounded-chip border px-2 py-1 text-xs ${STATUS_COLOR[p.status] ?? ''}`}>
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="font-semibold tabular-nums">{p.score}</span>
              </span>
            ))}
          </div>
        </div>

        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Sütun ayrıntıları
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t p-3 md:grid-cols-2 lg:grid-cols-3">
            {data.pillars.map((p: any) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label">{p.name}</span>
                  <span className={`text-metric tabular-nums ${(STATUS_COLOR[p.status] ?? '').split(' ')[0]}`}>{p.score}</span>
                </div>
                <ul className="space-y-1 text-label font-normal">
                  {p.checks.map((c: any) => (
                    <li key={c.id} className="flex items-start gap-1.5">
                      {c.ok ? <Check className="h-3 w-3 text-success mt-0.5 shrink-0" aria-label="tamam" /> :
                              <X className="h-3 w-3 text-danger mt-0.5 shrink-0" aria-label="eksik" />}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground"> — {c.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>

        {/* Recommendations */}
        {data.recommendations && data.recommendations.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="text-sm font-semibold flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Öncelikli tavsiyeler
            </p>
            <ul className="space-y-1 text-xs">
              {data.recommendations.map((r: string, i: number) => (
                <li key={i} className="leading-relaxed">→ {r}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
