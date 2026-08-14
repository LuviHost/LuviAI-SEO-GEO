'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  History, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
} from 'lucide-react';
import { api, type AuditComparison } from '@/lib/api';
import { AuditComparisonBody } from '@/components/audit-delta-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type TaramaKaydi = {
  id: string;
  ranAt: string;
  overallScore: number;
  geoScore: number | null;
  issueCount: number;
  durationMs: number | null;
};

/** Kac tarama listelenir — trend cizgisi icin yeterli, liste bogulmaz */
const GECMIS_LIMIT = 20;

/**
 * Rapor sayfasindaki tarama raporlari bolumu: manuel tetikleme + gecmis liste +
 * serbest iki tarama karsilastirmasi.
 *
 * NEDEN: Audit sayfasindaki delta paneli yalnizca SON iki taramayi gosteriyor;
 * kullanici "gecen ay neredeydim, bugun neredeyim" sorusunu oradan cevaplayamiyor.
 * Karsilastirma govdesi audit-delta-panel'den geliyor ki iki ayri delta dili olmasin.
 */
export function AuditReportsPanel({ siteId }: { siteId: string }) {
  const [history, setHistory] = useState<TaramaKaydi[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyHata, setHistoryHata] = useState(false);

  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');

  const [cmp, setCmp] = useState<AuditComparison | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);

  const [running, setRunning] = useState(false);
  // Yoklama sirasinda kullaniciya nerede oldugumuzu soyler — uzun bekleyiste
  // hareketsiz bir spinner "takildi mi" hissi veriyor.
  const [durum, setDurum] = useState('');

  // Bilesen sokulduyse gec gelen yanit state'i yazmasin
  const canli = useRef(true);
  useEffect(() => {
    canli.current = true;
    return () => { canli.current = false; };
  }, []);

  const gecmisiYukle = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryHata(false);
    try {
      const h = (await api.getAuditHistory(siteId, GECMIS_LIMIT)) ?? [];
      if (!canli.current) return;
      setHistory(h);
      // Varsayilan kiyas SON IKI tarama — en sik sorulan soru bu.
      // AMA kullanicinin sectigi cift KORUNUR: elle tarama sonrasi liste
      // tazelenirken secimi sifirlamak, "Mayis vs Agustos" kiyasi yapan
      // kullanicinin ekranini habersiz degistirirdi. Yalnizca secim yoksa
      // ya da secilen tarama artik listede yoksa varsayilana donulur.
      const idler = new Set(h.map((x) => x.id));
      setToId((mevcut) => (mevcut && idler.has(mevcut) ? mevcut : h[0]?.id ?? ''));
      setFromId((mevcut) => (mevcut && idler.has(mevcut) ? mevcut : h[1]?.id ?? ''));
    } catch {
      if (!canli.current) return;
      setHistory([]);
      setHistoryHata(true);
    } finally {
      if (canli.current) setHistoryLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void gecmisiYukle(); }, [gecmisiYukle]);

  // Secim degistikce karsilastirmayi tazele
  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setCmp(null);
      return;
    }
    let iptal = false;
    (async () => {
      setCmpLoading(true);
      try {
        const c = await api.compareAudits(siteId, { fromId, toId });
        if (!iptal) setCmp(c);
      } catch {
        // Karsilastirma yardimci bir yuzey — bozulursa liste ve tetikleme
        // calismaya devam etsin, kullanici baska bir cift secebilsin.
        if (!iptal) setCmp(null);
      } finally {
        if (!iptal) setCmpLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [siteId, fromId, toId]);

  /**
   * Taramayi KUYRUGA atip durumunu yoklar.
   *
   * NEDEN TEK FETCH DEGIL: tarama crawl + PageSpeed + 7 saglayici probe demek,
   * olculdu 1-3 dakika. Tek bir POST'u bu kadar acik tutmak vekil sunucunun
   * timeout'una carpiyor (Cloudflare varsayilani ~100 sn) — is sunucuda
   * tamamlansa bile kullanici hata gorurdu. Simdi POST hemen donuyor, ilerleme
   * is kaydindan okunuyor.
   */
  const yeniTarama = async () => {
    setRunning(true);
    setDurum('Tarama kuyruğa alınıyor…');
    try {
      const job = await api.queueAudit(siteId);
      const basladi = Date.now();
      // Ust sinir: worker olu ya da is takildi ise sonsuza kadar yoklamayalim.
      const ZAMAN_ASIMI = 6 * 60 * 1000;

      while (canli.current) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!canli.current) return;

        let j: Awaited<ReturnType<typeof api.getJob>>;
        try {
          j = await api.getJob(job.id);
        } catch {
          // Gecici ag hatasi yoklamayi bitirmesin; zaman asimi zaten koruyor.
          continue;
        }

        if (j.status === 'COMPLETED') {
          toast.success('Yeni tarama tamamlandı');
          await gecmisiYukle();
          return;
        }
        if (j.status === 'FAILED' || j.status === 'CANCELED') {
          toast.error(j.error || 'Tarama başarısız');
          return;
        }
        setDurum(
          j.status === 'PROCESSING'
            ? 'Site taranıyor — sayfa taraması, PageSpeed ve AI ölçümü…'
            : 'Sırada bekliyor…',
        );
        if (Date.now() - basladi > ZAMAN_ASIMI) {
          toast.message('Tarama beklenenden uzun sürüyor', {
            description: 'Arka planda devam ediyor; birazdan sayfayı yenile.',
          });
          return;
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Tarama başlatılamadı');
    } finally {
      if (canli.current) {
        setRunning(false);
        setDurum('');
      }
    }
  };

  const yetersizVeri = !historyLoading && !historyHata && history.length < 2;
  // Ters sira secimi: "baslangic" bitisten YENI olamaz, yoksa delta isareti
  // tersine doner ve kullanici iyilesmeyi kotulesme sanir.
  const sira = (id: string) => history.findIndex((h) => h.id === id);
  const tersSira = !!fromId && !!toId && fromId !== toId && sira(fromId) < sira(toId);

  return (
    <div className="space-y-4">
      {/* a) Baslik + manuel tetikleme */}
      <Card>
        <CardContent className="p-4 flex items-start gap-3 flex-wrap">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
            <History className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-base font-bold">Tarama Raporları</h3>
            <p className="text-sm text-muted-foreground">
              Site skoru geçmişi ve iki taramanın karşılaştırması.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={yeniTarama} disabled={running} size="sm" className="shrink-0">
              <RefreshCw className={cn('h-4 w-4', running && 'animate-spin')} />
              {running ? 'Taranıyor…' : 'Yeni tarama başlat'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {running ? (durum || 'Sayfada kalabilirsin, bitince haber vereceğiz.') : 'Tarama 1-3 dakika sürebilir'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* b) Gecmis taramalar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Geçmiş taramalar</h4>
            {history.length > 0 && (
              <span className="text-xs text-muted-foreground">{history.length} kayıt</span>
            )}
          </div>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Tarama geçmişi yükleniyor…</p>
          ) : historyHata ? (
            <p className="text-sm text-muted-foreground">
              Tarama geçmişi alınamadı. Sayfayı yenileyip tekrar dene.
            </p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz tarama yok. “Yeni tarama başlat” ile ilk taramayı çalıştır.
            </p>
          ) : (
            <>
              <div className="rounded-lg border divide-y">
                {history.map((h, i) => {
                  // Liste yeni -> eski geldigi icin bir onceki tarama bir SONRAKI satir
                  const onceki = history[i + 1];
                  const delta = onceki ? h.overallScore - onceki.overallScore : null;
                  return (
                    <div key={h.id} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                      <span className="text-xs text-muted-foreground w-[130px] shrink-0">
                        {tarihSaat(h.ranAt)}
                      </span>
                      <span className="text-sm font-semibold">
                        {h.overallScore}
                        <span className="text-xs text-muted-foreground font-normal">/100</span>
                      </span>
                      <DeltaRozeti delta={delta} />
                      <span className="ml-auto flex items-center gap-2">
                        <Badge variant="secondary">
                          GEO {h.geoScore ?? '—'}
                        </Badge>
                        <Badge variant={h.issueCount > 0 ? 'warning' : 'success'}>
                          {h.issueCount} sorun
                        </Badge>
                      </span>
                    </div>
                  );
                })}
              </div>
              {yetersizVeri && (
                <p className="text-xs text-muted-foreground">
                  Karşılaştırma için en az iki tarama gerekli.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* c + d) Iki taramayi sec ve kiyasla */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h4 className="text-sm font-semibold">Karşılaştırma</h4>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Tarama geçmişi yükleniyor…</p>
          ) : historyHata ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Tarama geçmişi alınamadı. Sayfayı yenilemeyi dene.
            </p>
          ) : yetersizVeri ? (
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center shrink-0">
                <History className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Karşılaştırma için en az iki tarama gerekli</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {history.length === 1
                    ? 'Şu an tek tarama var. Düzeltmelerini yaptıktan sonra yeniden tara, farkı burada göstereceğiz.'
                    : 'İlk taramayı başlattığında geçmiş burada birikmeye başlar.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TaramaSecici
                  etiket="Başlangıç taraması"
                  value={fromId}
                  onChange={setFromId}
                  history={history}
                />
                <TaramaSecici
                  etiket="Bitiş taraması"
                  value={toId}
                  onChange={setToId}
                  history={history}
                />
              </div>

              {fromId && toId && fromId === toId ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Aynı tarama seçili — karşılaştırmak için iki farklı tarama seç.
                </p>
              ) : tersSira ? (
                <p className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Başlangıç taraması bitişten daha yeni — seçimi ters çevir, yoksa artış/azalış işareti ters okunur.
                </p>
              ) : cmpLoading ? (
                <p className="text-sm text-muted-foreground">Karşılaştırma hazırlanıyor…</p>
              ) : cmp ? (
                <AuditComparisonBody cmp={cmp} history={history} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Karşılaştırma alınamadı. Farklı bir tarama çifti seçmeyi dene.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Tek bir tarama secimi — native select, ekstra bagimlilik yok */
function TaramaSecici({
  etiket, value, onChange, history,
}: {
  etiket: string;
  value: string;
  onChange: (v: string) => void;
  history: TaramaKaydi[];
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{etiket}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 px-2 rounded-md border border-input text-sm bg-background"
      >
        {history.map((h) => (
          <option key={h.id} value={h.id}>
            {tarihSaat(h.ranAt)} · {h.overallScore}/100
          </option>
        ))}
      </select>
    </label>
  );
}

/** Bir onceki taramaya gore skor farki — yesil/kirmizi/notr */
function DeltaRozeti({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-[11px] text-muted-foreground">ilk tarama</span>;
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <Minus className="h-3 w-3" />0
      </span>
    );
  }
  const artis = delta > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-semibold',
        artis ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      {artis ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {artis ? '+' : ''}{delta}
    </span>
  );
}

/** Ayni gun icinde birden fazla tarama olabildigi icin saat de gosterilir */
function tarihSaat(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
