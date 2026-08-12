'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Radar, RefreshCw, Loader2, Trophy, AlertTriangle } from 'lucide-react';

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
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      setData(await api.getProductRadar(site.id));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runProductRadar(site.id);
      toast.success(`Tarama bitti — ${res.snapshots} ölçüm kaydedildi`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const brand = data?.brand;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center">
            <Radar className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Product Radar</h2>
            <p className="text-sm text-muted-foreground">
              AI asistanlar "{site.niche ?? 'kategorinde'}" hangi ürünleri öneriyor — sen listede misin, kimler önünde?
            </p>
          </div>
        </div>
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {running ? 'Taranıyor… (~1 dk)' : 'Şimdi Tara'}
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : !data?.date ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Radar className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Henüz tarama yok. "Şimdi Tara" ile 4 AI sağlayıcıya kategori sorgularını sor — haftalık otomatik tekrar eder.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Marka durumu */}
          <Card className={cn(brand ? 'border-emerald-500/40' : 'border-amber-500/40')}>
            <CardContent className="p-4 flex items-center gap-3">
              {brand ? (
                <>
                  <Trophy className="h-6 w-6 text-emerald-500 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">
                      {site.name} öneri listelerinde — {brand.appearances} kez, ort. sıra {brand.avgRank ?? '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sağlayıcılar: {brand.providers.map((p: string) => PROVIDER_LABEL[p] ?? p).join(', ')} · Son tarama: {data.date}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">{site.name} öneri listelerinde YOK</div>
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
              <div className="text-sm font-semibold mb-3">Kategori Öneri Sıralaması</div>
              <div className="space-y-1">
                {(data.leaderboard ?? []).map((row: any, i: number) => (
                  <div
                    key={row.name}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2',
                      row.isBrand ? 'bg-brand/10 border border-brand/30' : i % 2 === 0 ? 'bg-muted/30' : '',
                    )}
                  >
                    <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                    <span className={cn('text-sm flex-1 min-w-0 truncate', row.isBrand && 'font-bold')}>
                      {row.name} {row.isBrand && <Badge className="ml-1.5 text-[9px]">SEN</Badge>}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {row.appearances} öneri · {row.providers.map((p: string) => PROVIDER_LABEL[p] ?? p).join(', ')}
                    </span>
                    {row.avgRank && (
                      <Badge variant="outline" className="text-[10px] shrink-0">ort. {row.avgRank}. sıra</Badge>
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
                    <Badge variant="outline" className="text-[10px]">{PROVIDER_LABEL[s.provider] ?? s.provider}</Badge>
                    {s.brandListed
                      ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 border-emerald-500/30" variant="outline">Listede{s.brandRank ? ` · ${s.brandRank}.` : ''}</Badge>
                      : <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30">Listede yok</Badge>}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">"{s.query}"</div>
                  <ol className="text-xs space-y-0.5">
                    {(Array.isArray(s.products) ? s.products : []).slice(0, 8).map((p: any, j: number) => (
                      <li key={j} className={cn('flex gap-2', p.isBrand && 'font-bold text-brand')}>
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
