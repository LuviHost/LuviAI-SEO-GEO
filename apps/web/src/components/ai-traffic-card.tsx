'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Activity, Bot, ExternalLink, Info, MousePointerClick, Percent, Target as TargetIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNum, formatPct } from '@/lib/format';
import { siteHref } from '@/lib/site-routes';
import { CHART } from '@/lib/chart-colors';
import {
  GA_REASON_TEXT, MEASUREMENT_NOTE, THRESHOLD_NOTE, barPct, hasSeries, isHttpUrl, pageLabel, shareText, shortDay,
  type AiTrafficGa, type AiTrafficResponse, type AiTrafficTracker,
} from '@/lib/ai-traffic';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FilterChip } from '@/components/ui/filter-chip';
import { SectionHeader } from '@/components/ui/section-header';
import { AsyncState } from '@/components/ui/async-state';
import { MetricCard } from '@/components/ui/metric';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ChartContainer, ChartTooltip, CHART_AXIS, CHART_GRID } from '@/components/ui/chart-container';
import { EngineLogo } from '@/components/engine-logo';

/**
 * AI'dan gelen trafik — GA4 (sessionSource = AI asistanı alan adı) ve RanksUp
 * izleme kodu AYRI bölümlerde (sunucu: GET /analytics/ai-traffic). İki kaynak
 * farklı sayar; toplanmaz.
 */

/** ai_referrer_hits anahtarı → EngineLogo saglayici kimligi (logosu olmayanlar bos) */
const LOGO_KEY: Record<string, string> = { chatgpt: 'chatgpt', claude: 'claude', gemini: 'gemini', perplexity: 'perplexity' };

function AssistantBars({ items, unit, caption }: { items: Array<{ key: string; label: string; value: number }>; unit: string; caption: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2" aria-label={caption}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            {LOGO_KEY[i.key] && <EngineLogo provider={LOGO_KEY[i.key]} size={14} />}
            <span className="truncate">{i.label}</span>
          </span>
          <span className="h-2 rounded-full bg-muted" aria-hidden>
            <span className="block h-2 rounded-full bg-brand" style={{ width: `${barPct(i.value, max)}%` }} />
          </span>
          <span className="tabular-nums text-muted-foreground">
            {formatNum(i.value)} <span className="sr-only">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ daily, name, color }: { daily: Array<{ date: string; total: number }>; name: string; color: string }) {
  return (
    <ChartContainer height={180}>
      <LineChart data={daily.map((d) => ({ ...d, label: shortDay(d.date) }))}>
        <CartesianGrid {...CHART_GRID} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...CHART_AXIS} minTickGap={24} />
        <YAxis {...CHART_AXIS} width={36} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} />
        <Line type="monotone" dataKey="total" name={name} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  );
}

type PageRow = AiTrafficGa['landingPages'][number];

function pageColumns(labels: Record<string, string>, multiHost: boolean): Column<PageRow>[] {
  return [
    {
      key: 'page',
      header: 'Açılış sayfası',
      sortValue: (r) => pageLabel(r, multiHost),
      cell: (r) => <span className="block max-w-xs truncate font-medium" title={pageLabel(r, true)}>{pageLabel(r, multiHost)}</span>,
    },
    { key: 'sessions', header: 'Oturum', align: 'right', sortValue: (r) => r.sessions, cell: (r) => formatNum(r.sessions) },
    { key: 'engaged', header: 'Etkileşimli', align: 'right', hideBelow: 'sm', sortValue: (r) => r.engagedSessions, cell: (r) => formatNum(r.engagedSessions) },
    { key: 'keyEvents', header: 'Önemli etkinlik', align: 'right', hideBelow: 'md', sortValue: (r) => r.keyEvents, cell: (r) => formatNum(r.keyEvents) },
    {
      key: 'assistants',
      header: 'Asistanlar',
      hideBelow: 'lg',
      cell: (r) => (
        <span className="text-label text-muted-foreground">
          {Object.entries(r.byAssistant).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${labels[k] ?? k} ${formatNum(n)}`).join(' · ')}
        </span>
      ),
    },
  ];
}

function GaSection({ ga, labels }: { ga: AiTrafficGa; labels: Record<string, string> }) {
  if (ga.totals.sessions === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Bu dönemde GA4&apos;te AI asistanlarından gelen oturum görünmüyor. Asistanlar siteni kaynak gösterip ziyaretçi tıkladığında burada sayılır.
      </p>
    );
  }
  const showRevenue = ga.revenueAvailable && (ga.totals.revenue ?? 0) > 0;
  return (
    <div className="space-y-4">
      {ga.thresholded && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-label text-muted-foreground" role="note">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> <span>{THRESHOLD_NOTE}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard icon={MousePointerClick} label="AI oturumları" value={ga.totals.sessions} />
        <MetricCard icon={Percent} label="Tüm oturumlardaki payı" value={shareText(ga.aiShare)} accent="muted" hint={`${formatNum(ga.siteSessions)} oturumun içinde`} />
        <MetricCard icon={Activity} label="Etkileşim oranı" value={formatPct(ga.totals.engagementRate, 0)} accent="muted" />
        <MetricCard
          icon={TargetIcon}
          label={showRevenue ? 'Önemli etkinlik · gelir' : 'Önemli etkinlik'}
          value={showRevenue ? `${formatNum(ga.totals.keyEvents)} · ${formatNum(ga.totals.revenue)}` : ga.totals.keyEvents}
          accent="muted"
          hint={showRevenue ? 'Gelir, GA4 mülkünün para biriminde' : undefined}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-label font-medium text-muted-foreground">Asistana göre oturum</h4>
          <AssistantBars caption="Asistana göre GA4 oturumları" unit="oturum" items={ga.byAssistant.map((a) => ({ key: a.key, label: a.label, value: a.sessions }))} />
        </div>
        {hasSeries(ga.daily) && (
          <div className="space-y-2">
            <h4 className="text-label font-medium text-muted-foreground">Günlük AI oturumu</h4>
            <DailyChart daily={ga.daily} name="AI oturumu" color={CHART[1]} />
          </div>
        )}
      </div>
      {ga.landingPages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-label font-medium text-muted-foreground">AI ziyaretçisinin açtığı sayfalar (ilk 20)</h4>
          <div className="rounded-lg border">
            <DataTable
              columns={pageColumns(labels, ga.multiHost)}
              rows={ga.landingPages}
              rowKey={(r) => `${r.host}${r.page}`}
              initialSort={{ key: 'sessions', dir: 'desc' }}
              caption="AI asistanlarından gelen oturumların açılış sayfaları"
            />
          </div>
          {ga.pagesTruncated && <p className="text-label text-muted-foreground">Çok sayıda sayfa var; liste GA4 satır sınırı içindeki en çok ziyaret alanlardan.</p>}
        </div>
      )}
    </div>
  );
}

function TrackerSection({ tracker, siteId }: { tracker: AiTrafficTracker; siteId: string }) {
  if (tracker.totalHits === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Bu dönemde izleme kodu AI kaynaklı ziyaret kaydetmedi. Kod kurulu değilse{' '}
        <Link href={siteHref(siteId, 'connections') as any} className="font-medium text-foreground underline underline-offset-2">Bağlantılar</Link>
        {' '}sayfasından kurabilirsin.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-brand text-metric tabular-nums">{formatNum(tracker.totalHits)}</span>{' '}
            <span className="text-muted-foreground">AI kaynaklı ziyaret</span>
          </p>
          <AssistantBars caption="Asistana göre izleme kodu ziyaretleri" unit="ziyaret" items={tracker.byAssistant.map((a) => ({ key: a.key, label: a.label, value: a.hits }))} />
        </div>
        {hasSeries(tracker.daily) && (
          <div className="space-y-2">
            <h4 className="text-label font-medium text-muted-foreground">Günlük ziyaret</h4>
            <DailyChart daily={tracker.daily} name="Ziyaret" color={CHART[3]} />
          </div>
        )}
      </div>
      {tracker.topPages.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-label font-medium text-muted-foreground">En çok ziyaret alan adresler (yaklaşık)</h4>
          <ul className="divide-y rounded-lg border">
            {tracker.topPages.map((p) => (
              <li key={p.url} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                {/* Sunucu yalniz sitenin kendi adreslerini dondurur; yine de yalniz http(s) baglanti olur */}
                {isHttpUrl(p.url) ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 hover:underline">
                    <span className="truncate">{p.url.replace(/^https?:\/\//, '')}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="sr-only">(yeni sekmede açılır)</span>
                  </a>
                ) : (
                  <span className="truncate">{p.url}</span>
                )}
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatNum(p.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AiTrafficCard({ siteId }: { siteId: string }) {
  const [days, setDays] = useState<28 | 90>(28);
  const [data, setData] = useState<AiTrafficResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getAiTraffic(siteId, days)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, days]);

  useEffect(() => load(), [load]);

  const labels = Object.fromEntries((data?.measurement.assistants ?? []).map((a) => [a.key, a.label]));
  const reason = !data?.ga && data?.reason ? GA_REASON_TEXT[data.reason] : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <SectionHeader
          as="h3"
          icon={Bot}
          title="AI'dan gelen trafik"
          description={
            data
              ? `ChatGPT, Perplexity, Claude, Gemini ve Copilot'tan siteye gelen ziyaretler · ${data.dateRange.startDate} – ${data.dateRange.endDate}`
              : 'ChatGPT, Perplexity, Claude, Gemini ve Copilot’tan siteye gelen ziyaretler'
          }
          actions={
            <div className="flex gap-1.5" role="group" aria-label="Dönem">
              {([28, 90] as const).map((d) => (
                <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>{d} gün</FilterChip>
              ))}
            </div>
          }
        />
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <AsyncState loading={loading} error={error} onRetry={load}>
          {data && (
            <>
              <section aria-labelledby="ai-trafik-ga4" className="space-y-3">
                <h4 id="ai-trafik-ga4" className="text-sm font-semibold">Google Analytics 4</h4>
                {data.ga ? (
                  <GaSection ga={data.ga} labels={labels} />
                ) : reason && (
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
                    <div className="min-w-0 max-w-xl">
                      <p className="text-sm font-medium">{reason.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason.body}</p>
                    </div>
                    {reason.cta && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={siteHref(siteId, 'connections') as any}>{data.reason === 'not_connected' ? 'GA4’ü bağla' : 'Bağlantılara git'}</Link>
                      </Button>
                    )}
                  </div>
                )}
              </section>

              <section aria-labelledby="ai-trafik-izleme" className="space-y-3 border-t pt-5">
                <h4 id="ai-trafik-izleme" className="text-sm font-semibold">RanksUp izleme kodu</h4>
                <TrackerSection tracker={data.tracker} siteId={siteId} />
              </section>

              <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-label text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <div className="space-y-1">
                  <p className="font-medium text-foreground/80">Nasıl ölçülür?</p>
                  {MEASUREMENT_NOTE.map((t) => <p key={t}>{t}</p>)}
                </div>
              </div>
            </>
          )}
        </AsyncState>
      </CardContent>
    </Card>
  );
}
