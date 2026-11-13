'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { CitationHistoryChart } from '@/components/citation-history-chart';
import { CitedSourcesCard } from '@/components/cited-sources-card';
import { Sparkles, Compass, Loader2, FileText, Search, Star, Target } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { EngineStrip } from '@/components/engine-logo';
import { useEntitlements } from '@/lib/entitlements';
import { formatNum } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isWeeklyMeasurementLimitError, refreshMeasurementAllowance, useMeasurementAllowance } from '@/lib/measurement-allowance';

export default function VisibilityPage() {
  const { site } = useSiteContext();
  // Bu SITENIN olcumlerinde sorulan asistanlar — baslikta sayi ve logo seridi. Kaynak sitenin
  // kendisi (GET /sites/:id measurementEngines: site SAHIBININ plani). Yonetici ya da ajans hesabi
  // baskasinin sitesini actiginda kendi planinin asistanlari gosterilmez. Eski API alani
  // gondermezse /me'deki haklara dusulur (kendi sitesine bakan hesap icin ayni liste).
  const { entitlements } = useEntitlements();
  const siteEngines = (site as { measurementEngines?: unknown }).measurementEngines;
  const engines = Array.isArray(siteEngines) && siteEngines.length > 0
    ? (siteEngines as string[])
    : siteEngines === undefined && entitlements?.engines?.length ? entitlements.engines : null;
  // Haftalik AI olcum hakki — not grafikteki "Yeniden Test"in altinda gorunur
  const { blocked: measurementBlocked } = useMeasurementAllowance();
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmap, setRoadmap] = useState<{
    summary: string;
    actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }>;
  } | null>(null);
  const [perPageLoading, setPerPageLoading] = useState(false);
  const [perPage, setPerPage] = useState<{
    pages: Array<{ url: string; cites: number; queries: Array<{ query: string; provider: string; cites: number }> }>;
    topPages: Array<{ url: string; cites: number }>;
    groundingQueries: Array<{ query: string; cites: number; pages: string[] }>;
    totalCites: number;
  } | null>(null);

  const runPerPage = async () => {
    setPerPageLoading(true);
    try {
      const r = await api.runCitationPerPage(site.id);
      refreshMeasurementAllowance();
      setPerPage(r.breakdown);
      if (r.breakdown.totalCites === 0) {
        toast.message('Henüz alıntı alan sayfa yok — daha fazla içerik üret ve testi tekrarla');
      } else {
        toast.success(`${r.breakdown.totalCites} alıntı analiz edildi`);
      }
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err.message || 'Sayfa bazında analiz başarısız');
    } finally {
      setPerPageLoading(false);
    }
  };

  const runRoadmap = async () => {
    setRoadmapLoading(true);
    try {
      const r = await api.runCitationRoadmap(site.id);
      refreshMeasurementAllowance();
      if (r.roadmap) {
        setRoadmap(r.roadmap);
        toast.success('AI önerileri hazır');
      } else {
        toast.message('Yeterli veri yok — önce alıntı testini çalıştır');
      }
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err.message || 'Yol haritası üretilemedi');
    } finally {
      setRoadmapLoading(false);
    }
  };

  const EFFORT: Record<'low' | 'medium' | 'high', { text: string; variant: 'success' | 'warning' | 'danger' }> = {
    low: { text: 'Kolay', variant: 'success' },
    medium: { text: 'Orta', variant: 'warning' },
    high: { text: 'Zor', variant: 'danger' },
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Sparkles}
        title="AI Görünürlük"
        description={
          <>
            {/* 11.11.2026 paket yapisi: asistan sayisi ve logolar HESABIN planindan gelir
                (lib/entitlements `engines` ← api billing/entitlements.ts: Baslangic ve deneme 4,
                Profesyonel ve ustu 6 + olculuyorsa Muse). Sabit "6" ya da sabit alti logo yazilmaz.
                Liste gelene kadar (ya da /me alinamazsa) sayi ve serit cizilmez: yanlis sayi
                gostermektense bos birakilir; yukseklik ayrilir ki sayfa ziplamasin. */}
            <span className="block">
              {engines ? `${engines.length} AI asistanında` : 'AI asistanlarında'} marka takibi, duygu, ses payı ve rakip analizi.
            </span>
            <div className="mt-2.5 min-h-7">
              {engines && <EngineStrip engines={engines} />}
            </div>
          </>
        }
      />

      <CitationHistoryChart siteId={site.id} siteName={site.name} siteUrl={site.url} />

      {/* AI cevaplarinin kaynak gosterdigi siteler + "nerede yer almalisin" */}
      <CitedSourcesCard siteId={site.id} />

      {/* GEO yol haritası — AI önerileri */}
      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <SectionHeader
            as="h3"
            icon={Compass}
            title="GEO yol haritası"
            description="AI mevcut sonuçlarını okur, ne yapman gerektiğini önerir."
            actions={
              <Button size="sm" variant="outline" onClick={runRoadmap} disabled={roadmapLoading || measurementBlocked}>
                {roadmapLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden /> Analiz ediliyor</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden /> {roadmap ? 'Yeniden üret' : 'AI önerisi al'}</>
                )}
              </Button>
            }
          />
        </div>

        {!roadmap && !roadmapLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-md border text-foreground/70" aria-hidden>
              <Compass className="h-5 w-5" />
            </span>
            <p className="mx-auto max-w-xl">&quot;AI önerisi al&quot;a bas — alıntı testi çalışır ve uygulanabilir 5 öneri üretilir.</p>
          </div>
        )}

        {roadmap && (
          <div className="p-5 space-y-4">
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-sm font-medium">{roadmap.summary}</p>
            </div>
            <div className="space-y-2">
              <p className="v-rail">Eylem listesi</p>
              {/* Satirlar tiklanabilir degil — yaniltici ChevronRight kaldirildi */}
              <ol className="space-y-2">
                {roadmap.actions.map((a, i) => (
                  <li key={i} className="rounded-md border bg-background p-3 flex items-start gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-muted font-mono text-vitrin-rail text-muted-foreground" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-medium">{a.title}</p>
                        <Badge variant={EFFORT[a.effort]?.variant ?? 'secondary'} className="text-label">
                          {EFFORT[a.effort]?.text ?? a.effort}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{a.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Card>

      {/* Sayfa bazında alıntılar + kaynak sorgular */}
      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <SectionHeader
            as="h3"
            icon={FileText}
            title="Sayfa bazında alıntılar ve kaynak sorgular"
            description="Hangi sayfan hangi sorgu için AI cevabında alıntılandı?"
            actions={
              <Button size="sm" variant="outline" onClick={runPerPage} disabled={perPageLoading || measurementBlocked}>
                {perPageLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden /> Analiz ediliyor</>
                ) : (
                  <><Search className="h-3.5 w-3.5 mr-1.5" aria-hidden /> {perPage ? 'Yeniden çalıştır' : 'Analiz et'}</>
                )}
              </Button>
            }
          />
        </div>

        {!perPage && !perPageLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-md border text-foreground/70" aria-hidden>
              <FileText className="h-5 w-5" />
            </span>
            <p className="mx-auto max-w-xl">&quot;Analiz et&quot; → AI cevaplarında sitenden hangi sayfaların alıntılandığını ve alıntıyı hangi sorgunun tetiklediğini gösterir.</p>
          </div>
        )}

        {perPage && perPage.totalCites === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-md border text-foreground/70" aria-hidden>
              <FileText className="h-5 w-5" />
            </span>
            <p className="mx-auto max-w-xl">Henüz alıntı alan sayfa yok. AI cevabında URL&apos;inin geçmesi için sorulara doğrudan cevap veren, rakam ve karşılaştırma içeren sayfalar ve arama botlarının (Googlebot, Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot) robots.txt&apos;te engelli olmaması yardımcı olur.</p>
          </div>
        )}

        {perPage && perPage.totalCites > 0 && (
          <div className="p-5 grid md:grid-cols-2 gap-5">
            {/* En çok alıntılanan sayfalar */}
            <div className="min-w-0">
              <p className="v-rail mb-2.5 flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5" aria-hidden /> En çok alıntılanan sayfalar
              </p>
              <ol className="space-y-1.5">
                {perPage.topPages.map((p, i) => (
                  <li key={p.url} className="rounded-md border bg-background p-2.5 flex items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-muted font-mono text-vitrin-rail text-muted-foreground" aria-hidden>
                      {i + 1}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-xs" title={p.url}>{p.url}</code>
                    <Badge variant="success" className="text-label shrink-0">{formatNum(p.cites)} alıntı</Badge>
                  </li>
                ))}
              </ol>
            </div>

            {/* Alıntıyı tetikleyen sorgular */}
            <div className="min-w-0">
              <p className="v-rail mb-2.5 flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" aria-hidden /> Alıntıyı tetikleyen sorgular
              </p>
              <div className="space-y-1.5">
                {perPage.groundingQueries.slice(0, 10).map((q, i) => (
                  <div key={i} className="rounded-md border bg-background p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{q.query}</span>
                      <Badge variant="secondary" className="text-label shrink-0">{formatNum(q.cites)} alıntı</Badge>
                    </div>
                    {q.pages.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {q.pages.slice(0, 3).map((p) => (
                          <code key={p} className="text-label font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[200px]" title={p}>{p}</code>
                        ))}
                        {q.pages.length > 3 && (
                          <span className="text-label text-muted-foreground">+{q.pages.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Özet — site ölçümü her soruyu birden fazla kez sorar (api audit/citation-repeat.ts); alıntılar tüm tekrarlardan sayılır */}
            <div className="min-w-0 md:col-span-2 mt-2 rounded-md border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
              <strong className="font-medium tabular-nums text-foreground">{formatNum(perPage.totalCites)}</strong> toplam alıntı (tekrarlar dahil) ·{' '}
              <strong className="font-medium tabular-nums text-foreground">{formatNum(perPage.pages.length)}</strong> sayfa alıntılandı ·{' '}
              <strong className="font-medium tabular-nums text-foreground">{formatNum(perPage.groundingQueries.length)}</strong> farklı sorgu tetikledi
            </div>
          </div>
        )}
      </Card>
      {/* AI Crawler Trafigi paneli 13.11.2026'da Bot Takibi sayfasina tasindi (tek yerde dursun) */}
    </div>
  );
}
