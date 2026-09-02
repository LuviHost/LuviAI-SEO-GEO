'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, MousePointer, UserPlus, TrendingUp, BarChart3, Users } from 'lucide-react';

type Summary = Awaited<ReturnType<typeof api.getLandingAnalytics>>;

export default function LandingAnalyticsPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (d: number) => {
    setLoading(true);
    try {
      const r = await api.getLandingAnalytics(d);
      setData(r);
    } catch (err: any) {
      toast.error(err.message || 'Yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-brand-600" />
            Landing Analytics
          </h2>
          <p className="text-sm text-muted-foreground">Anonim funnel takibi — KVKK uyumlu, IP yok.</p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'default' : 'outline'}
              onClick={() => setDays(d)}
            >
              {d === 1 ? 'Bugün' : `${d}g`}
            </Button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border bg-card p-8 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Metric icon={Users} label="Tekil Session" value={data.totals.sessions} color="blue" />
            <Metric icon={Eye} label="Sayfa Görüntüleme" value={data.totals.pageviews} color="purple" />
            <Metric icon={MousePointer} label="CTA Tıklama" value={data.totals.ctaClicks} color="amber" />
            <Metric icon={UserPlus} label="Signup" value={data.totals.signups} color="emerald" />
            <Metric icon={BarChart3} label="Toplam Event" value={data.totals.events} color="slate" />
          </div>

          {/* Funnel */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-brand-600" />
                Funnel
              </h3>
              <div className="space-y-3">
                <FunnelStage label="Session geldi" count={data.totals.sessions} pct={100} maxCount={data.totals.sessions} />
                <FunnelStage label="CTA tıkladı" count={data.totals.ctaClicks} pct={data.funnel.sessionToCtaPct} maxCount={data.totals.sessions} />
                <FunnelStage label="Signup tamamladı" count={data.totals.signups} pct={data.funnel.sessionToSignupPct} maxCount={data.totals.sessions} />
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-3">
            {/* Top CTAs */}
            <Card>
              <CardContent className="p-5">
                <h3 className="text-base font-bold mb-3">En çok tıklanan CTA'lar</h3>
                {data.topCtas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Henüz CTA tıklaması yok.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topCtas.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-3 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded flex-1">{c.id}</code>
                        <span className="font-bold tabular-nums">{c.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Sections (engagement) */}
            <Card>
              <CardContent className="p-5">
                <h3 className="text-base font-bold mb-3">En çok görülen section'lar</h3>
                {data.topSections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Henüz section görüntülenmesi yok.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topSections.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-3 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded flex-1">#{s.id}</code>
                        <span className="font-bold tabular-nums">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Timeline */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-base font-bold mb-3">Günlük trend</h3>
              {data.timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">Henüz veri yok.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 font-semibold">Tarih</th>
                        <th className="text-right py-2 font-semibold">Pageview</th>
                        <th className="text-right py-2 font-semibold">Signup</th>
                        <th className="text-right py-2 font-semibold">CR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.timeline.map((d) => {
                        const cr = d.pageviews > 0 ? Math.round((d.signups / d.pageviews) * 1000) / 10 : 0;
                        return (
                          <tr key={d.date} className="border-b border-border/40">
                            <td className="py-2 font-mono">{d.date}</td>
                            <td className="py-2 text-right tabular-nums">{d.pageviews}</td>
                            <td className="py-2 text-right tabular-nums font-bold text-emerald-600">{d.signups}</td>
                            <td className="py-2 text-right tabular-nums">%{cr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Event types raw */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-base font-bold mb-3">Event türleri (debug)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 bg-muted/20">
                    <code className="truncate">{type}</code>
                    <span className="font-bold tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-500/10',
    purple: 'text-purple-600 bg-purple-500/10',
    amber: 'text-amber-600 bg-amber-500/10',
    emerald: 'text-emerald-600 bg-emerald-500/10',
    slate: 'text-slate-600 bg-slate-500/10',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`h-7 w-7 rounded-lg grid place-items-center ${colors[color]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
        <div className="text-2xl font-extrabold tabular-nums">{value.toLocaleString('tr-TR')}</div>
      </CardContent>
    </Card>
  );
}

function FunnelStage({ label, count, pct, maxCount }: { label: string; count: number; pct: number; maxCount: number }) {
  const widthPct = maxCount > 0 ? Math.max(2, (count / maxCount) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-bold text-foreground tabular-nums">{count}</span> · %{pct}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
