'use client';

import { useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, TrendingUp, BarChart3, FileText, Sparkles } from 'lucide-react';
import { api, geoAccessOf, geoSampleNote } from '@/lib/api';
// Eski API raporu engel/orneklem tasimaz; o durumda son taramanin checks.geo'su (site context) kullanilir
import { SiteContext } from '@/app/(dashboard)/sites/[id]/site-context';
import { reportGeoAccess } from '@/components/dondurulmus-rapor';
import { CrawlAccessNotice } from '@/components/crawl-access-notice';
import { currentCrawlAccess } from '@/lib/crawl-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric';
import { FilterChip } from '@/components/ui/filter-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { CHART } from '@/lib/chart-colors';
import { formatNum, formatPct, formatPos } from '@/lib/format';
import { formatGscRange } from '@/lib/gsc-coverage';
import { CitationHistoryChart } from '@/components/citation-history-chart';

type Range = 'week' | 'month' | 'year';

/**
 * Haftalik / aylik / yillik kapsamli rapor + indirme.
 */
export function SiteReportPanel({ siteId, site }: { siteId: string; site: any }) {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // useContext (useSiteContext degil): site duzeni disinda cizilirse engel bilgisi yok sayilir
  const latestAudit = useContext(SiteContext)?.audit ?? null;

  const load = async (r: Range) => {
    setLoading(true);
    try {
      const res = await api.getReport(siteId, r);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(range); }, [range, siteId]);

  const downloadCsv = () => {
    const url = api.getReportCsvUrl(siteId, range);
    window.open(url, '_blank');
  };

  const printPdf = () => {
    window.print();
  };

  if (loading || !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Rapor hazırlanıyor">
        <Skeleton className="h-8 w-1/2" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const rangeLabel = range === 'week' ? '7 gün' : range === 'month' ? '30 gün' : '365 gün';
  // Yeni API engel/orneklemi raporun kendi taramasindan (reports.service.ts lastAudit) verir.
  // Eski API'de site context'teki son tarama kullanilir — yalniz ayni skoru tasiyorsa (ayni tarama).
  const sameAudit = !!latestAudit && (latestAudit.geoScore ?? null) === (data.audit.geoScore ?? null);
  const geo = reportGeoAccess(data.audit) ?? (sameAudit ? geoAccessOf(latestAudit) : { blocked: null, sample: null });
  const geoBlocked = data.audit.geoScore == null ? geo.blocked : null;
  const geoNote = data.audit.geoScore != null ? geoSampleNote(geo.sample) : null;
  // Son tarama denemesi siteye erişemediyse API skorları null döner (reports.service.ts —
  // panel ve MCP ile aynı kural); eski değer yalnız tarihiyle sonBasarili'da. Eski API'de yok.
  const erisim = currentCrawlAccess(data.audit.accessBlocked, null);
  const sonBasarili: { ranAt: string; overallScore: number; geoScore: number | null } | null = erisim ? data.audit.sonBasarili ?? null : null;
  const sonBasariliTarih = sonBasarili?.ranAt ? new Date(sonBasarili.ranAt).toLocaleDateString('tr-TR') : null;
  const olculemeyenSayisi: number = typeof data.audit.olculemeyenSayisi === 'number' ? data.audit.olculemeyenSayisi : 0;
  // Onceki donemde GSC olcumu yoksa API farki null doner (reports.service.ts oncekiDonemVeriVar).
  // Rozet gosterilmez: bos "−" rozeti "degismedi" diye okunurdu, halbuki kiyaslanacak olcum yok.
  const gscHint = data.search.oncekiDonemVeriVar === false ? 'önceki dönemde ölçüm yok' : 'önceki döneme göre';

  return (
    <div className="space-y-5">
      {/* Range selector + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-panel-3">Performans raporu</h3>
          <p className="v-rail mt-0.5">
            {site?.name} · son {rangeLabel} · {new Date(data.rangeStart).toLocaleDateString('tr-TR')} — {new Date(data.rangeEnd).toLocaleDateString('tr-TR')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dönem">
            {(['week', 'month', 'year'] as Range[]).map((r) => (
              <FilterChip key={r} selected={range === r} onClick={() => setRange(r)}>
                {r === 'week' ? 'Haftalık' : r === 'month' ? 'Aylık' : 'Yıllık'}
              </FilterChip>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={printPdf}>
            <FileText className="h-3.5 w-3.5 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* Buyuk metrik kartlari — ui/metric (NumberTicker + DeltaBadge).
          "Sosyal gonderi" karti kaldirildi: sosyal modul yok, SocialPost artik yazilmiyor —
          kart her donem 0 gosterip "paylasim yapilmadi" gibi okunuyordu. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="Yayınlanan makale"
          value={data.articles.published}
          delta={data.articles.publishedDelta}
          hint="önceki döneme göre"
          icon={FileText}
        />
        <MetricCard
          label="GSC tıklama"
          value={data.search.totalClicks}
          delta={data.search.clicksDelta ?? undefined}
          hint={gscHint}
          icon={TrendingUp}
          accent="muted"
        />
        <MetricCard
          label="GSC gösterim"
          value={data.search.totalImpressions}
          delta={data.search.impressionsDelta ?? undefined}
          hint={gscHint}
          icon={BarChart3}
          accent="muted"
        />
      </div>
      {/* GSC toplami donemin yalniz bir kismindan geliyorsa soylenir (reports.service.ts coverage) */}
      {data.search.coverage && !data.search.coverage.complete && (
        <p className="text-xs text-muted-foreground -mt-2">
          {data.search.coverage.from && data.search.coverage.to
            ? `GSC verisi: ${formatGscRange(data.search.coverage.from, data.search.coverage.to)} — dönemin ${data.search.coverage.requestedDays} gününün ${data.search.coverage.coveredDays} günü kayıtlı. Google verisi yaklaşık 2 gün gecikmeli gelir.`
            : 'Bu dönem için kayıtlı GSC verisi yok.'}
        </p>
      )}

      {/* Skorlar */}
      {erisim && <CrawlAccessNotice access={erisim} staleScoreAt={sonBasarili?.ranAt ?? data.audit.ranAt ?? null} />}
      <Card>
        <CardContent className="p-4">
          <p className="mb-4 text-panel-3">Skor özeti</p>
          {/* ui/metric ile ayni dil: mono etiket ustte, ince rakam altta, sola yasli; turuncu rakam yok */}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
            <div>
              <p className="v-rail mb-2">SEO Skoru</p>
              {erisim ? (
                // Son deneme siteye erişemedi: eski skor güncel diye gösterilmez (tarihiyle aşağıda)
                <div className="py-1 text-sm font-medium leading-snug text-warning" title={erisim.reason}>Ölçülemedi</div>
              ) : (
                <div className="text-metric-lg tabular-nums">{data.audit.overallScore ?? '—'}<span className="text-sm font-normal tracking-normal text-muted-foreground">/100</span></div>
              )}
              {sonBasarili && sonBasariliTarih && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">Son başarılı tarama ({sonBasariliTarih}): {sonBasarili.overallScore}/100</p>
              )}
            </div>
            <div>
              <p className="v-rail mb-2">GEO Skoru</p>
              {erisim ? (
                <div className="py-1 text-sm font-medium leading-snug text-warning" title={erisim.reason}>Ölçülemedi</div>
              ) : geoBlocked ? (
                // Orneklenen sayfalar erisim engeline takildi (geo-runner.service.ts): skor YOK —
                // "—" yerine "Olculemedi"; neden ve site sahibinin yapacagi asagida
                <div className="py-1 text-sm font-medium leading-snug text-warning" title={geoBlocked.reason}>Ölçülemedi</div>
              ) : (
                <div className="text-metric-lg tabular-nums">{data.audit.geoScore ?? '—'}<span className="text-sm font-normal tracking-normal text-muted-foreground">/100</span></div>
              )}
              {sonBasarili && sonBasariliTarih && typeof sonBasarili.geoScore === 'number' && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">Son başarılı tarama ({sonBasariliTarih}): {sonBasarili.geoScore}/100</p>
              )}
              {!erisim && geoBlocked && (
                <>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{geoBlocked.reason}</p>
                  {geoBlocked.hint && <p className="mt-1 text-xs leading-snug text-muted-foreground">{geoBlocked.hint}</p>}
                </>
              )}
              {/* Orneklemin bir kismi engelliyse skor daha az sayfadan hesaplandi — yaninda yazilir */}
              {geoNote && <p className="mt-1 text-xs leading-snug text-muted-foreground">{geoNote}</p>}
            </div>
            <div>
              <p className="v-rail mb-2">AI Görünürlük</p>
              {/*
                Olculemeyen skor 0 DEGIL "—" gosterilir ve nedeni yazilir.
                Sunucu artik hicbir saglayici cevap veremediginde null donuyor;
                0 yazmak "AI gorunurlugun sifira dustu" yalanini uretiyordu.
              */}
              <div className="text-metric-lg tabular-nums">
                {data.ai.citationScore ?? '—'}
                <span className="text-sm font-normal tracking-normal text-muted-foreground">/100</span>
              </div>
              {data.ai.citationScore === null && data.ai.citationOlcumYok && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{data.ai.citationOlcumYok}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Citation tarihsel trend (yeni!) */}
      <CitationHistoryChart siteId={siteId} />

      {/* AI Provider breakdown */}
      {Array.isArray(data.ai.providers) && data.ai.providers.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 inline-flex items-center gap-2 text-panel-3">
              <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden /> AI sağlayıcı dağılımı
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {data.ai.providers.map((p: any) => (
                <div key={p.provider} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{p.label}</span>
                    <span className={`text-metric tabular-nums ${
                      !p.available || p.score === null ? 'text-muted-foreground' :
                      p.score >= 60 ? 'text-success' : p.score >= 30 ? 'text-warning' : 'text-danger'
                    }`}>
                      {p.available && p.score !== null ? p.score : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zaman serisi (basit bar chart) */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-panel-3">Aktivite trendi</p>
          <SimpleBarChart series={data.timeSeries} />
        </CardContent>
      </Card>

      {/* Top queries */}
      {data.search.topQueries?.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-panel-3">En çok tıklanan sorgular</p>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b font-mono text-vitrin-rail text-muted-foreground">
                  <th className="py-2.5 pr-3 text-left font-normal">Sorgu</th>
                  <th className="px-3 py-2.5 text-right font-normal">Tıklama</th>
                  <th className="px-3 py-2.5 text-right font-normal">Gösterim</th>
                  <th className="px-3 py-2.5 text-right font-normal">Tıklama oranı</th>
                  <th className="py-2.5 pl-3 text-right font-normal">Sıra</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.search.topQueries.slice(0, 10).map((q: any, i: number) => (
                  <tr key={i}>
                    <td className="max-w-[300px] truncate py-2.5 pr-3">{q.query}</td>
                    <td className="px-3 text-right tabular-nums">{formatNum(q.clicks)}</td>
                    <td className="px-3 text-right tabular-nums">{formatNum(q.impressions)}</td>
                    <td className="px-3 text-right tabular-nums">{formatPct(q.ctr)}</td>
                    <td className="pl-3 text-right tabular-nums">{formatPos(q.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Maliyet */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-5 p-4 md:grid-cols-4">
          <div>
            <p className="v-rail mb-1">Üretim Maliyeti</p>
            <p className="text-metric tabular-nums">${data.articles.totalCost.toFixed(2)}</p>
          </div>
          <div>
            <p className="v-rail mb-1">Ortalama Editör Skoru</p>
            <p className="text-metric tabular-nums">{data.articles.avgEditorScore?.toFixed(1) ?? '—'}/60</p>
          </div>
          {/*
            ONCEDEN tek bir "Duzeltilen Sorun" sayisi vardi ve sunucuda
            max(0, ilkIssueSayisi - sonIssueSayisi) ile hesaplaniyordu — yani
            donemde 5 sorun cozulup 5 yeni sorun ciktiginda 0 gosteriyordu.
            Artik compareAuditRows'un type|page eslestirmesi kullaniliyor ve
            uc sayi AYRI gosteriliyor; "cozuldu" ile "yenisi cikti" ayni
            hucrede birbirini yiyemez.
          */}
          <div>
            <p className="v-rail mb-1">Çözülen Sorun</p>
            <p className="text-metric tabular-nums text-success">
              {data.audit.karsilastirma ? data.audit.cozulenSayisi : '—'}
            </p>
            {!data.audit.karsilastirma && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">Karşılaştırma için en az 2 tarama gerekli</p>
            )}
          </div>
          <div>
            <p className="v-rail mb-1">Yeni Çıkan Sorun</p>
            <p className="text-metric tabular-nums text-warning">
              {data.audit.karsilastirma ? data.audit.yeniCikanSayisi : '—'}
            </p>
          </div>
          {/* Son taramada yeniden ölçülemeyen eski sorunlar — "Çözülen"e girmez (audit.service.ts) */}
          {data.audit.karsilastirma && olculemeyenSayisi > 0 && (
            <div>
              <p className="v-rail mb-1">Ölçülemeyen Sorun</p>
              <p className="text-metric tabular-nums text-muted-foreground">{olculemeyenSayisi}</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">Son taramada yeniden ölçülemedi; çözülmüş sayılmadı</p>
            </div>
          )}
          <div>
            <p className="v-rail mb-1">Bekleyen Sorun</p>
            <p className="text-metric tabular-nums">{data.audit.issuesCount}</p>
          </div>
          <div>
            <p className="v-rail mb-1">Kullanıcı Taraması</p>
            <p className="text-metric tabular-nums">{data.audit.kullaniciTaramaSayisi ?? '—'}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Elle başlatılan (cron/test hariç)</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Sade CSS bar grafigi — renkler YALNIZ lib/chart-colors (CHART), etiketler text-label.
 * Eskiden bg-info/bg-success ve text-label kullaniyordu. Sosyal gonderi serisi kaldirildi:
 * SocialPost artik yazilmiyor, seri her gun sifir cubuk ciziyordu.
 */
const SERIES = [
  { key: 'articles', label: 'Makale', color: CHART[1] },
  { key: 'clicks', label: 'GSC tıklama (ayrı ölçek)', color: CHART[2] },
] as const;

function SimpleBarChart({ series }: { series: any }) {
  const dates: string[] = series.dates ?? [];
  const articles: number[] = series.publishedArticles ?? [];
  const clicks: number[] = series.clicks ?? [];

  const maxArticles = Math.max(1, ...articles);
  const maxClicks = Math.max(1, ...clicks);
  // 12px etiketler sikisirsa ust uste biner — en fazla ~12 tarih etiketi
  const labelEvery = Math.max(1, Math.ceil(dates.length / 12));

  return (
    <div className="space-y-3">
      <div className="v-rail flex flex-wrap items-center gap-3">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} aria-hidden /> {s.label}
          </span>
        ))}
      </div>

      <div className="flex items-end gap-0.5 h-36 overflow-x-auto pb-2" role="img" aria-label="Dönem boyunca makale ve tıklama dağılımı">
        {dates.map((d, i) => {
          const articlesH = (articles[i] / maxArticles) * 80;
          const clicksH = (clicks[i] / maxClicks) * 80;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 min-w-[20px]" title={`${d}: ${articles[i]} makale, ${clicks[i]} tıklama`}>
              <div className="flex items-end gap-0.5 h-24">
                <div className="w-1.5 rounded-t" style={{ height: `${articlesH}%`, background: SERIES[0].color }} />
                <div className="w-1.5 rounded-t" style={{ height: `${clicksH}%`, background: SERIES[1].color }} />
              </div>
              <span className={`v-rail mt-1 whitespace-nowrap ${i % labelEvery === 0 ? '' : 'invisible'}`}>
                {d.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
