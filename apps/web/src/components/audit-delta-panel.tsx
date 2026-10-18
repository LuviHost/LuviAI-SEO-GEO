'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, CheckCircle2, AlertCircle, Clock, History, HelpCircle,
} from 'lucide-react';
import { SEVERITY_LABEL, label } from '@/lib/labels';
import { api, type AuditComparison, type AuditIssueRecord } from '@/lib/api';
import { aiProviderScopeNote, methodChangeNote, overallDeltaComparable } from '@/lib/compare-notes';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';

/**
 * Iki tarama arasindaki degisimi gosterir.
 *
 * NEDEN: Her audit ayri satir olarak kaydediliyor ve sitelerde gercek seriler
 * birikiyor (64 -> 86 gibi), ama arayuzde yalnizca SON tarama vardi; kullanici
 * yaptigi duzeltmenin ise yarayip yaramadigini goremiyordu.
 */
export function AuditDeltaPanel({ siteId, collapsible = false }: { siteId: string; collapsible?: boolean }) {
  const [cmp, setCmp] = useState<AuditComparison | null>(null);
  const [history, setHistory] = useState<
    Array<{ id: string; ranAt: string; overallScore: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let iptal = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [c, h] = await Promise.all([
          api.compareAudits(siteId),
          api.getAuditHistory(siteId, 12),
        ]);
        if (iptal) return;
        setCmp(c);
        setHistory(h ?? []);
      } catch (err) {
        // Eskiden sessizce gizleniyordu — kullanici neden bos oldugunu bilemiyordu.
        if (!iptal) {
          setCmp(null);
          setError(err ?? new Error('Karşılaştırma yüklenemedi.'));
        }
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [siteId, reloadKey]);

  const body = loading ? (
    <div className="space-y-2" aria-busy="true" aria-label="Karşılaştırma yükleniyor">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-16 w-full" />
    </div>
  ) : error ? (
    <ErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} />
  ) : cmp ? (
    <AuditComparisonBody cmp={cmp} history={history} />
  ) : null;

  if (!body) return null;

  if (collapsible) {
    const delta = !loading && cmp && !cmp.yeterliVeriYok ? cmp.scoreDelta : null;
    // Yontem / kapsam farkinda sayi gosterilir ama yesil-kirmizi hukum verilmez (compare-notes.ts)
    const hukum = !!cmp && overallDeltaComparable(cmp);
    return (
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 [&::-webkit-details-marker]:hidden">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Önceki taramaya göre değişim</span>
            {delta !== null && (
              <Badge variant={!hukum ? 'secondary' : delta > 0 ? 'success' : delta < 0 ? 'danger' : 'secondary'} className="ml-1">
                {delta > 0 ? '+' : ''}{delta} puan
              </Badge>
            )}
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t p-4">{body}</div>
        </details>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );
}

/**
 * Karsilastirmanin gorsel govdesi — Card sarmalayicisi DISINDA tutuldu.
 *
 * NEDEN: Ayni delta gorunumu hem audit sayfasinda hem rapor sayfasinda
 * kullaniliyor; iki farkli delta dili olusmasin diye tek kaynaktan besleniyor.
 * Sarmalayiciyi cagiran secer (audit'te tek kart, raporda bolum icinde).
 */
export function AuditComparisonBody({
  cmp,
  history = [],
}: {
  cmp: AuditComparison;
  history?: Array<{ id: string; ranAt: string; overallScore: number }>;
}) {
  if (cmp.yeterliVeriYok) {
    return (
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center shrink-0">
          <History className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Karşılaştırma için en az iki tarama gerekli</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cmp.to
              ? `Şu an tek tarama var (${tarih(cmp.to.ranAt)} · ${cmp.to.overallScore}/100). Düzeltmelerini yaptıktan sonra yeniden tara, farkı burada göstereceğiz.`
              : 'Henüz tarama yok. İlk taramayı başlatarak başla.'}
          </p>
        </div>
      </div>
    );
  }

  const { from, to, scoreDelta, geoScoreDelta, ozet, issues } = cmp;
  // Genel skora giren bir kontrolun yontemi degistiyse ya da kontrol yalniz bir taramada
  // olculduyse fark gosterilir ama "iyilesti/kotulesti" hukmu verilmez (compare-notes.ts)
  const yon = !overallDeltaComparable(cmp) ? 'neutral' : scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'flat';
  // Yontemi degisen kontrol de listelenir ama hukumsuz (API: durum metodoloji_degisti, delta 0)
  const degisenCheckler = cmp.checks.filter(
    (c) => c.durum === 'iyilesti' || c.durum === 'kotulesti' || c.durum === 'metodoloji_degisti',
  );
  const aiKapsam = cmp.aiSaglayiciKapsami;
  // Eski API / dondurulmus rapor bu alanlari tasimaz — yoksa 0 / bos
  const olculemeyen = issues.olculemedi ?? [];
  const olculemeyenSayisi = ozet.olculemeyenSayisi ?? olculemeyen.length;
  const kismi = cmp.kismi;

  return (
    <div className="space-y-4">
      {/* Ust satir: skor delta rozeti + tarih araligi */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-lg font-bold ${
              yon === 'up'
                ? 'bg-success/10 text-success'
                : yon === 'down'
                  ? 'bg-danger/10 text-danger'
                  : 'bg-muted text-muted-foreground'
            }`}
            title={yon === 'neutral' ? 'Ölçüm yöntemi ya da kapsamı iki taramada farklı; fark iyileşme veya kötüleşme sayılmaz.' : undefined}
          >
            {yon === 'up' ? <TrendingUp className="h-5 w-5" />
              : yon === 'down' ? <TrendingDown className="h-5 w-5" />
                : yon === 'flat' ? <Minus className="h-5 w-5" /> : null}
            {scoreDelta > 0 ? '+' : ''}{scoreDelta} puan
          </div>
          <div>
            <p className="text-sm font-semibold">
              {from?.overallScore} <span className="text-muted-foreground font-normal">→</span> {to?.overallScore}
              <span className="text-xs text-muted-foreground font-normal">/100</span>
            </p>
            <p className="text-label text-muted-foreground">
              {tarih(from?.ranAt)} — {tarih(to?.ranAt)}
            </p>
          </div>
        </div>

        {geoScoreDelta !== 0 && (
          <Badge variant={geoScoreDelta > 0 ? 'success' : 'destructive'}>
            GEO {geoScoreDelta > 0 ? '+' : ''}{geoScoreDelta}
          </Badge>
        )}
      </div>

      {/* Yalniz GEO / AI gorunurluk yontemi degistiyse genel skor etkilenmez; not bunu ayirir */}
      {cmp.metodolojiDegisen && cmp.metodolojiDegisen.length > 0 && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
          {methodChangeNote(cmp.metodolojiDegisen, kontrolAdi)}
        </p>
      )}

      {/* AI gorunurlukte iki taramada olculen asistanlar farkli (429 / kota): fark yalniz ortak asistanlarla */}
      {aiKapsam && (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
          {aiProviderScopeNote(aiKapsam, (p) => PROVIDER_LABELS[p] ?? p)}
        </p>
      )}

      {/* Kısmi karşılaştırma: son tarama bazı şeyleri ölçemedi (erişim engeli, atlanan AI ölçümü,
          erken duran tarama). Ölçülemeyen sorunun yokluğu "çözüldü" demek değildir (audit.service.ts). */}
      {kismi && (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2 space-y-1">
          <p className="font-medium text-foreground">Kısmi karşılaştırma</p>
          {kismi.olculemeyenKontroller.length > 0 && (
            <p>
              Son taramada ölçülemeyen kontroller: <span className="font-medium">{kontrolAdlari(kismi.olculemeyenKontroller)}</span>.
              Bu kontrollerin önceki sorunları çözülmüş sayılmadı; &quot;Ölçülemedi&quot; grubunda.
            </p>
          )}
          {kismi.sayfaKapsami && (
            <p>
              {kismi.sayfaKapsami.erkenDurdu
                ? 'Son tarama bot koruması nedeniyle erken durdu'
                : `Son taramada ${kismi.sayfaKapsami.engellenenSayfa} sayfa erişim engeli nedeniyle taranamadı`}
              ; sayfa bazlı kontrollerin kaybolan sorunları çözülmüş sayılmadı.
            </p>
          )}
          {kismi.skorKapsamiFarkli.length > 0 && (
            <p>
              Genel skor yalnız ölçülebilen kontrollerden hesaplanır; {kontrolAdlari(kismi.skorKapsamiFarkli)} iki taramadan yalnız birinde
              ölçülebildiği için puan farkının bir kısmı bundan kaynaklanabilir.
            </p>
          )}
          {kismi.olculemeyenKontroller.length === 0 && !kismi.sayfaKapsami && kismi.skorKapsamiFarkli.length === 0 && (
            <p>Önceki taramadaki bazı sorunlar son taramada yeniden ölçülemedi; çözülmüş sayılmadı.</p>
          )}
        </div>
      )}

      {/* Trend — son N taramanin genel skoru */}
      {history.length > 1 && <ScoreTrend history={history} />}

      {/* Uc liste */}
      <div className="space-y-2">
        <IssueGroup
          baslik="Çözülen"
          sayi={ozet.cozulenSayisi}
          issues={issues.cozulen}
          tonu="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <IssueGroup
          baslik="Yeni çıkan"
          sayi={ozet.yeniSayisi}
          issues={issues.yeniCikan}
          tonu="destructive"
          icon={<AlertCircle className="h-4 w-4" />}
        />
        <IssueGroup
          baslik="Devam eden"
          sayi={ozet.devamEdenSayisi}
          issues={issues.devamEden}
          tonu="warning"
          icon={<Clock className="h-4 w-4" />}
        />
        {/* Yalnız varsa: "Ölçülemedi 0" satırı ne olduğu bilinmeyen bir grup gibi okunurdu */}
        {olculemeyenSayisi > 0 && (
          <IssueGroup
            baslik="Ölçülemedi"
            sayi={olculemeyenSayisi}
            issues={olculemeyen}
            tonu="secondary"
            icon={<HelpCircle className="h-4 w-4" />}
          />
        )}
      </div>

      {/* Degisen kontroller */}
      {degisenCheckler.length > 0 && (
        <details className="group rounded-lg border">
          <summary className="flex items-center justify-between gap-2 p-3 cursor-pointer list-none">
            <span className="text-sm font-medium">
              Değişen kontroller
              <span className="ml-2 text-xs text-muted-foreground">{degisenCheckler.length}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t divide-y">
            {degisenCheckler.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs font-mono truncate">{c.id}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {c.oncekiScore} → {c.sonrakiScore}
                  {/* aiCitations satiri kapsam farkinda ortak asistanlarin ortalamasi (audit.service.ts) */}
                  {c.id === 'aiCitations' && aiKapsam && <span className="ml-1">(ortak asistanlar)</span>}
                  {c.durum === 'metodoloji_degisti' ? (
                    <span className="ml-2">yöntem değişti, kıyaslanmadı</span>
                  ) : (
                    <span
                      className={`ml-2 font-semibold ${
                        c.delta > 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {c.delta > 0 ? '+' : ''}{c.delta}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Katlanabilir sorun listesi — <details> ile, ekstra bagimlilik yok */
function IssueGroup({
  baslik, sayi, issues, tonu, icon,
}: {
  baslik: string;
  sayi: number;
  issues: AuditIssueRecord[];
  tonu: 'success' | 'destructive' | 'warning' | 'secondary';
  icon: React.ReactNode;
}) {
  const renk =
    tonu === 'success' ? 'text-success'
      : tonu === 'destructive' ? 'text-danger'
        : tonu === 'secondary' ? 'text-muted-foreground'
          : 'text-warning';

  if (sayi === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 opacity-60">
        <span className={renk}>{icon}</span>
        <span className="text-sm">{baslik}</span>
        <span className="ml-auto text-xs text-muted-foreground">0</span>
      </div>
    );
  }

  return (
    <details className="group rounded-lg border">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none">
        <span className={renk}>{icon}</span>
        <span className="text-sm font-medium">{baslik}</span>
        <Badge variant={tonu} className="ml-1">{sayi}</Badge>
        <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="border-t divide-y max-h-72 overflow-y-auto">
        {issues.slice(0, 50).map((i, idx) => (
          <li key={`${i.type ?? 'x'}-${i.page ?? idx}`} className="px-3 py-2">
            <div className="flex items-start gap-2">
              {i.severity && (
                <Badge
                  variant={
                    i.severity === 'critical' ? 'destructive'
                      : i.severity === 'warning' ? 'warning' : 'secondary'
                  }
                  className="shrink-0 mt-0.5"
                >
                  {label(SEVERITY_LABEL, i.severity)}
                </Badge>
              )}
              <div className="min-w-0">
                <p className="text-xs leading-relaxed">{i.description ?? i.type}</p>
                {i.page && (
                  <p className="text-label text-muted-foreground truncate mt-0.5">{i.page}</p>
                )}
              </div>
            </div>
          </li>
        ))}
        {issues.length > 50 && (
          <li className="px-3 py-2 text-label text-muted-foreground">
            +{issues.length - 50} kayıt daha
          </li>
        )}
      </ul>
    </details>
  );
}

/**
 * Sade CSS bar trendi — site-report-panel'deki SimpleBarChart ile ayni yaklasim
 * (yeni kutuphane yok). Gecmis yeni->eski geldigi icin cizimde ters cevrilir.
 */
function ScoreTrend({ history }: { history: Array<{ id: string; ranAt: string; overallScore: number }> }) {
  const seri = [...history].reverse();
  const max = Math.max(100, ...seri.map((h) => h.overallScore));

  return (
    <div>
      <p className="text-label text-muted-foreground font-medium mb-2">
        Son {seri.length} tarama
      </p>
      <div className="flex items-end gap-1 h-16">
        {seri.map((h, i) => {
          const yukseklik = Math.max(4, (h.overallScore / max) * 100);
          const sonuncu = i === seri.length - 1;
          return (
            <div
              key={h.id}
              className="flex-1 min-w-[6px] rounded-t transition-colors bg-slate-200 dark:bg-slate-700 relative group"
              style={{ height: `${yukseklik}%` }}
              title={`${tarih(h.ranAt)} · ${h.overallScore}/100`}
            >
              <div
                className={`absolute inset-0 rounded-t ${sonuncu ? 'bg-brand' : 'bg-brand/40'}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Karşılaştırma notlarındaki kontrol kimlikleri (checks anahtarları) → okunur ad.
 * Bilinmeyen kimlik olduğu gibi gösterilir.
 */
const KONTROL_ADI: Record<string, string> = {
  sitemap_xml: 'sitemap.xml',
  robots_txt: 'robots.txt',
  llms_txt: 'llms.txt',
  schema_markup: 'Schema',
  meta_title: 'Meta başlık',
  meta_description: 'Meta açıklama',
  open_graph: 'Open Graph',
  twitter_card: 'Twitter Card',
  canonical: 'Canonical',
  https: 'HTTPS',
  h1_uniqueness: 'H1',
  image_alt: 'Görsel alt metni',
  internal_linking: 'İç linkleme',
  hreflang: 'Hreflang',
  pagespeed: 'PageSpeed',
  geo: 'AI arama (GEO)',
  aiCitations: 'AI görünürlük ölçümü',
};

function kontrolAdi(id: string): string {
  return KONTROL_ADI[id] ?? id;
}

function kontrolAdlari(ids: string[]): string {
  return ids.map(kontrolAdi).join(', ');
}

function tarih(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}
