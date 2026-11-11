'use client';

import { EngineLogo } from '@/components/engine-logo';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { MeasurementLimitNote } from '@/components/measurement-limit-note';
import { isWeeklyMeasurementLimitError, refreshMeasurementAllowance, useMeasurementAllowance } from '@/lib/measurement-allowance';
import { useEntitlements } from '@/lib/entitlements';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { cn } from '@/lib/utils';
import { Radar, RefreshCw, Loader2, Trophy, AlertTriangle } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * Product Radar — AI asistanlar kategorinde HANGİ ürünleri öneriyor?
 * Marka listede mi, kaçıncı sırada, kimler önümüzde.
 */

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

export default function ProductRadarPage() {
  const { site } = useSiteContext();
  const { can, requirementFor } = useEntitlements();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const { blocked: measurementBlocked } = useMeasurementAllowance();

  const allowed = can('productRadar');

  const load = async () => {
    try {
      setData(await api.getProductRadar(site.id));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Haklar KESIN gelene kadar istek atilmaz: kapali planda bos 200/403
  // gurultusu uretmemek icin. Cache sayesinde bu bekleme ilk yuklemede
  // bir /me turu, sonrasinda sifir.
  useEffect(() => {
    if (allowed !== true) return;
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [site.id, allowed]);

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('productRadar')}
        description="AI asistanların kategorinde hangi ürünleri önerdiğini haftalık tarar — listede misin, kimler önünde, göster."
      />
    );
  }

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runProductRadar(site.id);
      toast.success(`Tarama bitti — ${res.snapshots} ölçüm kaydedildi`);
      refreshMeasurementAllowance();
      await load();
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const brand = data?.brand;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionHeader icon={Radar} title="Ürün Radarı" description={<>AI asistanlar "{site.niche ?? 'kategorinde'}" hangi ürünleri öneriyor — sen listede misin, kimler önünde?</>} />
        <Button onClick={run} disabled={running || measurementBlocked}>
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {running ? 'Taranıyor… (~1 dk)' : 'Şimdi Tara'}
        </Button>
      </div>
      <MeasurementLimitNote />

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : !data?.date ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-md border text-foreground/70" aria-hidden>
              <Radar className="h-5 w-5" />
            </span>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              Henüz tarama yok. "Şimdi Tara" ile AI sağlayıcılarına kategori sorgularını sor — haftalık otomatik tekrar eder.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Marka durumu */}
          <Card className={cn(brand ? 'border-success/25 bg-success/5' : 'border-warning/30 bg-warning/5')}>
            <CardContent className="p-4 flex items-center gap-3">
              {brand ? (
                <>
                  <Trophy className="h-5 w-5 text-success shrink-0" />
                  <div>
                    <div className="text-sm font-medium">
                      {site.name} öneri listelerinde — {brand.appearances} kez, ort. sıra {brand.avgRank ?? '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sağlayıcılar: {brand.providers.map((p: string) => PROVIDER_LABEL[p] ?? p).join(', ')} · Son tarama: {data.date}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{site.name} öneri listelerinde YOK</div>
                    <div className="text-xs text-muted-foreground">
                      AI asistanlar kategorinde aşağıdaki ürünleri öneriyor — İçerik Fırsatları ve GEO Lab ile kapatılacak açık bu. Son tarama: {data.date}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Liderlik tablosu */}
          <Card>
            <CardContent className="p-4">
              <div className="text-panel-3 mb-3">Kategori Öneri Sıralaması</div>
              <div className="divide-y rounded-md border">
                {(data.leaderboard ?? []).map((row: any, i: number) => (
                  <div
                    key={row.name}
                    className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5', row.isBrand && 'bg-muted/60')}
                  >
                    <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                    <span className={cn('min-w-[9rem] flex-1 truncate text-sm', row.isBrand && 'font-medium')}>
                      {row.name} {row.isBrand && <Badge className="ml-1.5 px-1.5 text-label">Sen</Badge>}
                    </span>
                    <span className="text-label font-normal text-muted-foreground sm:shrink-0">
                      {row.appearances} öneri · {row.providers.map((p: string) => PROVIDER_LABEL[p] ?? p).join(', ')}
                    </span>
                    {row.avgRank && (
                      <Badge variant="outline" className="shrink-0 text-label font-normal">ort. {row.avgRank}. sıra</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sorgu detayları */}
          <div className="grid md:grid-cols-2 gap-3">
            {(data.snapshots ?? []).map((s: any, i: number) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="gap-1.5 text-label"><EngineLogo provider={s.provider} size={12} />{PROVIDER_LABEL[s.provider] ?? s.provider}</Badge>
                    {s.brandListed
                      ? <Badge variant="success" className="text-label">Listede{s.brandRank ? ` · ${s.brandRank}.` : ''}</Badge>
                      : <Badge variant="secondary" className="text-label">Listede yok</Badge>}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">"{s.query}"</div>
                  <ol className="text-xs space-y-0.5 text-muted-foreground">
                    {(Array.isArray(s.products) ? s.products : []).slice(0, 8).map((p: any, j: number) => (
                      <li key={j} className={cn('flex gap-2', p.isBrand && 'font-medium text-foreground')}>
                        <span className="text-muted-foreground w-4">{p.rank ?? j + 1}.</span> {p.name}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
