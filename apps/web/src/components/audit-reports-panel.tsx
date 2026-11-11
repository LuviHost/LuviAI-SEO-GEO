'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  History, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
} from 'lucide-react';
import { api, type AuditComparison, type AuditHistoryRow } from '@/lib/api';
import {
  FIRST_AUDIT_LABEL, NOT_COMPARABLE_LABEL, PREVIOUS_NOT_LISTED_LABEL, auditTriggerBadge, historyDeltaView, type HistoryDeltaView,
} from '@/lib/audit-history';
import { AuditComparisonBody } from '@/components/audit-delta-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** trigger / scoreComparableWithPrevious / scoreMethodNote dahil (lib/api.ts AuditHistoryRow) */
type TaramaKaydi = AuditHistoryRow;

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
      // 10 dakika, olcume dayali: uretimde tam bir tarama (100 sayfa crawl +
      // 14 kontrol + PageSpeed + GEO + AI probe) 208 saniye surdu. 6 dakikalik
      // eski sinir yavas bir sitede kolayca dolar ve kullaniciya "beklenenden
      // uzun suruyor" derdik — halbuki tarama gayet normal ilerliyor olurdu.
      const ZAMAN_ASIMI = 10 * 60 * 1000;

      while (canli.current) {
        // Yoklama araligi kademeli aciliyor: ilk yarim dakika 3sn (kisa
        // taramalarda sonuc hemen gorunsun), sonra 6sn, iki dakikadan sonra
        // 10sn. Sabit 3sn ile 6 dakikalik bir bekleyis 120 istek demek ve
        // hiz siniri dakikada 60 — bu tek basina butcenin ucte biri, ayni
        // sekmedeki diger istekler 429'a itebilir.
        const gecen = Date.now() - basladi;
        const aralik = gecen < 30_000 ? 3000 : gecen < 120_000 ? 6000 : 10_000;
        await new Promise((r) => setTimeout(r, aralik));
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
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
            <History className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-panel-3">Tarama Raporları</h3>
            <p className="text-sm text-muted-foreground">
              Site skoru geçmişi ve iki taramanın karşılaştırması.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={yeniTarama} disabled={running} size="sm" variant="outline" className="shrink-0">
              <RefreshCw className={cn('h-4 w-4', running && 'animate-spin')} />
              {running ? 'Taranıyor…' : 'Yeni tarama başlat'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {running ? (durum || 'Sayfada kalabilirsin, bitince haber vereceğiz.') : 'Tarama 1-3 dakika sürebilir'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* b) Gecmis taramalar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-panel-3">Geçmiş taramalar</h4>
            {history.length > 0 && (
              <span className="v-rail">{history.length} kayıt</span>
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
              <div className="divide-y rounded-md border">
                {history.map((h, i) => {
                  // Liste yeni -> eski geldigi icin bir onceki tarama bir SONRAKI satir.
                  // Yontem / kapsam degistiyse fark hukum degil (lib/audit-history.ts)
                  const fark = historyDeltaView(history, i, GECMIS_LIMIT);
                  const kaynak = auditTriggerBadge(h.trigger);
                  return (
                    <div key={h.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span className="v-rail w-[150px] shrink-0">
                        {tarihSaat(h.ranAt)}
                      </span>
                      <span className="text-sm font-medium tabular-nums">
                        {h.overallScore}
                        <span className="text-xs font-normal text-muted-foreground">/100</span>
                      </span>
                      <DeltaRozeti view={fark} />
                      {/* Otomatik / dogrulama taramasi gizlenmez, rozetle ayrilir (audit.service getHistory) */}
                      {kaynak && (
                        <Badge variant="outline" className="px-1.5 py-0 text-label font-medium" title={kaynak.title}>
                          {kaynak.label}
                        </Badge>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        <Badge variant="secondary">
                          GEO {h.geoScore ?? '—'}
                        </Badge>
                        <Badge variant={h.issueCount > 0 ? 'warning' : 'success'}>
                          {h.issueCount} sorun
                        </Badge>
                      </span>
                      {/* Neden gorunur metin: dokunmatik ekranda title (hover) okunmaz */}
                      {fark.kind === 'not_comparable' && (
                        <p className="basis-full text-xs text-muted-foreground">{fark.note}</p>
                      )}
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
          <h4 className="text-panel-3">Karşılaştırma</h4>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Tarama geçmişi yükleniyor…</p>
          ) : historyHata ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Tarama geçmişi alınamadı. Sayfayı yenilemeyi dene.
            </p>
          ) : yetersizVeri ? (
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
                <History className="h-[18px] w-[18px]" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium">Karşılaştırma için en az iki tarama gerekli</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
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
                <p className="flex items-center gap-2 text-xs text-warning">
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
      <span className="text-label text-muted-foreground">{etiket}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:border-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {history.map((h) => {
          const kaynak = auditTriggerBadge(h.trigger);
          return (
            <option key={h.id} value={h.id}>
              {tarihSaat(h.ranAt)} · {h.overallScore}/100{kaynak ? ` · ${kaynak.label.toLocaleLowerCase('tr-TR')}` : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}

/**
 * Bir onceki taramaya gore skor farki. Yesil/kirmizi hukum yalniz API iki taramanin
 * ayni yontem ve kapsamla olculdugunu soylediginde; degilse sayi notr + "yontem/kapsam
 * degisti", API bilgi vermediyse (eski API) sayi notr (lib/audit-history.ts).
 */
function DeltaRozeti({ view }: { view: HistoryDeltaView }) {
  if (view.kind === 'first') {
    return <span className="text-xs text-muted-foreground">{FIRST_AUDIT_LABEL}</span>;
  }
  // En eski satirin oncesinde liste disinda tarama olabilir: "ilk tarama" iddiasi yok,
  // farkin neden gosterilmedigini notr metin soyler (lib/audit-history.ts)
  if (view.kind === 'none') {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Bu, listedeki en eski tarama; daha önceki taramalar burada gösterilmiyor, bu yüzden fark hesaplanmadı."
      >
        {PREVIOUS_NOT_LISTED_LABEL}
      </span>
    );
  }
  const sayi = `${view.delta > 0 ? '+' : ''}${view.delta}`;
  if (view.kind === 'not_comparable') {
    return (
      // Neden satirin altinda gorunur metin olarak yazilir (dokunmatikte title okunmaz)
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{sayi}</span>
        <Badge variant="secondary" className="px-1.5 py-0 text-label font-medium">{NOT_COMPARABLE_LABEL}</Badge>
      </span>
    );
  }
  if (view.kind === 'unknown' || view.delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
        {view.delta === 0 && <Minus className="h-3 w-3" aria-hidden />}
        {sayi}
      </span>
    );
  }
  const artis = view.delta > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', artis ? 'text-success' : 'text-danger')}>
      {artis ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {sayi}
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
