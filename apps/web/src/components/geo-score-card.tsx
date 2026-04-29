'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Award, Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const STATUS_COLOR: Record<string, string> = {
  great: 'text-green-500 bg-green-500/10 border-green-500/30',
  good: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
  warning: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
  critical: 'text-red-500 bg-red-500/10 border-red-500/30',
};

const GRADE_COLOR: Record<string, string> = {
  'A+': 'text-green-500',
  'A': 'text-green-400',
  'B': 'text-blue-500',
  'C': 'text-yellow-500',
  'D': 'text-orange-500',
  'F': 'text-red-500',
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
    return <div className="text-sm text-muted-foreground p-6 text-center">GEO Score Card hazırlanıyor…</div>;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Award className="h-4 w-4 text-brand" /> GEO Score Card
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sitenin AI search engine'lerde görünürlük seviyesi · 6 pillar · ağırlıklı ortalama
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Yenile
          </Button>
        </div>

        {/* Overall Score */}
        <div className="flex items-center justify-center gap-6 py-4 border rounded-lg bg-muted/20">
          <div className="text-center">
            <div className={`text-6xl font-bold ${GRADE_COLOR[data.grade] ?? 'text-muted-foreground'}`}>
              {data.grade}
            </div>
            <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">Harf Notu</div>
          </div>
          <div className="h-16 w-px bg-border" />
          <div className="text-center">
            <div className="text-5xl font-bold">{data.overallScore}<span className="text-2xl text-muted-foreground">/100</span></div>
            <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">Toplam GEO Skoru</div>
          </div>
        </div>

        {/* Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.pillars.map((p: any) => (
            <div key={p.id} className={`rounded-lg border p-3 ${STATUS_COLOR[p.status] ?? ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide">{p.name}</span>
                <span className="text-2xl font-bold">{p.score}</span>
              </div>
              <ul className="space-y-1 text-[11px]">
                {p.checks.map((c: any) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    {c.ok ? <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" /> :
                            <X className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />}
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

        {/* Recommendations */}
        {data.recommendations && data.recommendations.length > 0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <p className="text-sm font-semibold flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" /> Öncelikli Tavsiyeler
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
