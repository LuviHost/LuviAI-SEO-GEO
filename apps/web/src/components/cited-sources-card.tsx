'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, ExternalLink, Info, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNum, formatPct } from '@/lib/format';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import {
  ALL_BRANDED_TEXT, HEURISTIC_NOTE, PLACEMENT_NOTE, brandedNote, SOURCE_TYPE_BADGE, SOURCE_TYPE_LABELS, citedSourcesState, coverageNote, filterDomains,
  citedSourcesCsv, formatDay, shortUrl, typeChips, type CitedDomainRow, type CitedSourcesResponse, type SourceType,
} from '@/lib/cited-sources';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterChip } from '@/components/ui/filter-chip';
import { SectionHeader } from '@/components/ui/section-header';
import { AsyncState } from '@/components/ui/async-state';
import { DataTable, type Column } from '@/components/ui/data-table';
import { MetricCard } from '@/components/ui/metric';
import { EngineLogo } from '@/components/engine-logo';

/**
 * Alıntılanan dış kaynaklar — AI cevaplarının kaynak olarak gösterdiği alan
 * adları (sunucu: GET /audit/cited-sources). Tür etiketi sezgisel; eski
 * ölçümlerin "metinde geçen alan adları" ayrı ve açıkça etiketli gösterilir,
 * ana tabloya karışmaz.
 */

const providerName = (p: string) => PROVIDER_LABELS[p] ?? p;

function Providers({ list }: { list: string[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Alıntılayan asistanlar">
      {list.map((p) => (
        <li key={p} className="grid h-6 w-6 place-items-center rounded-full border bg-card" title={providerName(p)}>
          <EngineLogo provider={p} size={14} />
          <span className="sr-only">{providerName(p)}</span>
        </li>
      ))}
    </ul>
  );
}

function TypeBadge({ type }: { type: SourceType }) {
  return <Badge variant={SOURCE_TYPE_BADGE[type]} className="shrink-0">{SOURCE_TYPE_LABELS[type]}</Badge>;
}

const COLUMNS: Column<CitedDomainRow>[] = [
  {
    key: 'domain',
    header: 'Alan adı',
    sortValue: (r) => r.domain,
    cell: (r) => (
      <div className="min-w-0 max-w-xs space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{r.domain}</span>
          <span className="sm:hidden"><TypeBadge type={r.type} /></span>
        </div>
        {r.exampleUrls.length > 0 && (
          <ul className="space-y-0.5">
            {r.exampleUrls.map((u) => (
              <li key={u.url} className="min-w-0">
                <a
                  href={u.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-center gap-1 text-label text-muted-foreground hover:text-foreground hover:underline"
                  title={u.title ?? u.url}
                >
                  <span className="truncate">{u.originOnly ? `${shortUrl(u.url)} (sayfa bilinmiyor)` : shortUrl(u.url)}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="sr-only">(yeni sekmede açılır)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  },
  { key: 'type', header: 'Tür', hideBelow: 'sm', sortValue: (r) => SOURCE_TYPE_LABELS[r.type], cell: (r) => <TypeBadge type={r.type} /> },
  { key: 'answers', header: 'Cevap', align: 'right', sortValue: (r) => r.answers, cell: (r) => formatNum(r.answers) },
  { key: 'providers', header: 'Asistanlar', hideBelow: 'md', sortValue: (r) => r.providers.length, cell: (r) => <Providers list={r.providers} /> },
  {
    key: 'queries',
    header: 'Sorular',
    hideBelow: 'lg',
    cell: (r) => (
      <ul className="max-w-xs space-y-0.5 text-label text-muted-foreground">
        {r.topQueries.slice(0, 3).map((q) => <li key={q} className="truncate" title={q}>{q}</li>)}
      </ul>
    ),
  },
  { key: 'lastSeen', header: 'Son görülme', hideBelow: 'lg', sortValue: (r) => r.lastSeen, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDay(r.lastSeen)}</span> },
];

function downloadCsv(data: CitedSourcesResponse, days: number) {
  const blob = new Blob([citedSourcesCsv(data)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alintilanan-kaynaklar-${days}g-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CitedSourcesCard({ siteId }: { siteId: string }) {
  const [days, setDays] = useState<30 | 90>(30);
  const [data, setData] = useState<CitedSourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState<SourceType | 'all'>('all');

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getCitedSources(siteId, days)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, days]);

  useEffect(() => load(), [load]);

  const chips = useMemo(() => typeChips(data?.totals.byType), [data]);
  const rows = useMemo(() => filterDomains(data?.domains ?? [], type), [data, type]);
  const state = citedSourcesState(data);
  const note = coverageNote(data?.coverage, { promptRunsTruncated: data?.promptRunsTruncated });

  // Secili tur yeni pencerede yoksa tumune don
  useEffect(() => {
    if (type !== 'all' && !chips.some((c) => c.type === type)) setType('all');
  }, [chips, type]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 border-b">
        <SectionHeader
          as="h3"
          icon={BookOpen}
          title="Alıntılanan dış kaynaklar"
          description="AI asistanları cevap verirken hangi siteleri kaynak gösteriyor? Senin siten, rakiplerin ve diğerleri."
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex gap-1.5" role="group" aria-label="Dönem">
                {([30, 90] as const).map((d) => (
                  <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>{d} gün</FilterChip>
                ))}
              </div>
              {state === 'ok' && data && data.domains.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => downloadCsv(data, days)} title="Tablodaki tüm alan adlarını CSV olarak indir">
                  <Download className="h-3 w-3" /> CSV indir
                </Button>
              )}
            </div>
          }
        />
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <AsyncState loading={loading} error={error} onRetry={load}>
          {state === 'no_measurement' ? (
            <p className="text-sm text-muted-foreground">
              Bu dönemde AI görünürlük ölçümü yok. Yukarıdaki grafikten testi çalıştırdığında kaynaklar burada listelenir.
            </p>
          ) : state === 'all_branded' ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{ALL_BRANDED_TEXT}</p>
              {brandedNote(data?.coverage) && <p className="text-label">{brandedNote(data?.coverage)}</p>}
            </div>
          ) : state === 'no_records' ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Bu dönemdeki ölçümler kaynak kaydı başlamadan önce yapıldı. Kaynak listeleri bir sonraki AI ölçümünden itibaren burada görünür.</p>
              {brandedNote(data?.coverage) && <p className="text-label">{brandedNote(data?.coverage)}</p>}
            </div>
          ) : state === 'no_citations' ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Kaynak kaydı olan cevapların hiçbiri bir site göstermedi.</p>
              {note && <p className="text-label">{note}</p>}
            </div>
          ) : data && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <MetricCard
                  icon={BookOpen}
                  label="Seni alıntılayan cevaplar"
                  value={data.totals.ownShare === null ? '—' : formatPct(data.totals.ownShare, 0)}
                  hint={`Markasız sorulara kaynak gösteren ${formatNum(data.coverage.answersWithSources)} cevabın ${formatNum(data.totals.answersCitingOwn)} tanesi`}
                />
                <MetricCard
                  label="Yalnız başka siteleri gösteren"
                  value={data.totals.answersCitingOthersOnly}
                  accent="muted"
                  hint="Kaynak var ama senin siten yok"
                />
                <MetricCard label="Alıntılanan alan adı" value={data.totals.domains} accent="muted" className="col-span-2 md:col-span-1" />
              </div>

              {note && (
                <p className="flex items-start gap-2 text-label text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> <span>{note}</span>
                </p>
              )}

              {/* Nerede yer almalisin — kendi site ve rakip disi, sik alintilanan siteler */}
              {data.placements.length > 0 && (
                <section aria-labelledby="nerede-yer-al" className="space-y-3">
                  <div>
                    <h4 id="nerede-yer-al" className="flex items-center gap-2 text-sm font-semibold">
                      <MapPin className="h-4 w-4 text-brand" aria-hidden /> Nerede yer almalısın
                    </h4>
                    <p className="mt-0.5 text-label text-muted-foreground">
                      {data.placementMinAnswers >= 2
                        ? 'En az iki farklı cevapta kaynak gösterilen siteler.'
                        : 'Henüz hiçbir site iki farklı cevapta kaynak gösterilmedi; tek cevapta görülenler listeleniyor.'}{' '}
                      {PLACEMENT_NOTE}
                    </p>
                  </div>
                  <ol className="space-y-2">
                    {data.placements.map((p, i) => (
                      <li key={p.domain} className="flex items-start gap-3 rounded-lg border bg-background p-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold" aria-hidden>{i + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{p.domain}</span>
                            <TypeBadge type={p.type} />
                            <span className="text-label text-muted-foreground">{formatNum(p.answers)} cevap</span>
                            <Providers list={p.providers} />
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">{p.action}</p>
                          {p.topQueries.length > 0 && (
                            <p className="truncate text-label text-muted-foreground/80" title={p.topQueries.join(' · ')}>
                              Soru: {p.topQueries.join(' · ')}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section aria-label="Alan adları" className="space-y-3">
                {chips.length > 1 && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Türe göre filtrele">
                    <FilterChip selected={type === 'all'} onClick={() => setType('all')}>Tümü · {formatNum(data.totals.domains)}</FilterChip>
                    {chips.map((c) => (
                      <FilterChip key={c.type} selected={type === c.type} onClick={() => setType(c.type)}>
                        {c.label} · {formatNum(c.count)}
                      </FilterChip>
                    ))}
                  </div>
                )}
                <div className="-mx-5 border-y">
                  <DataTable
                    columns={COLUMNS}
                    rows={rows}
                    rowKey={(r) => r.domain}
                    initialSort={{ key: 'answers', dir: 'desc' }}
                    caption="AI cevaplarında kaynak gösterilen alan adları"
                  />
                </div>
                <p className="text-label text-muted-foreground">
                  “Cevap” = bu siteden en az bir sayfayı kaynak gösteren AI cevabı sayısı (aynı cevapta birden çok sayfa tek sayılır).
                  {data.truncated && ` Tablo en çok alıntılanan ${formatNum(data.domains.length)} alan adını gösteriyor.`}
                  {' '}{HEURISTIC_NOTE}
                </p>
              </section>
            </>
          )}

          {/* Eski olcumler: cevap metninde gecen alan adlari — alinti degil, ayri */}
          {data?.legacyMentionedDomains && (
            <details className="rounded-lg border bg-muted/20 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Eski ölçümler: cevap metninde geçen alan adları</summary>
              <p className="mt-2 text-label text-muted-foreground">{data.legacyMentionedDomains.note}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.legacyMentionedDomains.domains.map((d) => (
                  <li key={d.domain}>
                    <Badge variant="outline">{d.domain} · {formatNum(d.answers)}</Badge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </AsyncState>
      </CardContent>
    </Card>
  );
}
