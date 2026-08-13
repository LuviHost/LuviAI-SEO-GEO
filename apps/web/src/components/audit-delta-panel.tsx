'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, CheckCircle2, AlertCircle, Clock, History,
} from 'lucide-react';
import { api, type AuditComparison, type AuditIssueRecord } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Iki tarama arasindaki degisimi gosterir.
 *
 * NEDEN: Her audit ayri satir olarak kaydediliyor ve sitelerde gercek seriler
 * birikiyor (64 -> 86 gibi), ama arayuzde yalnizca SON tarama vardi; kullanici
 * yaptigi duzeltmenin ise yarayip yaramadigini goremiyordu.
 */
export function AuditDeltaPanel({ siteId }: { siteId: string }) {
  const [cmp, setCmp] = useState<AuditComparison | null>(null);
  const [history, setHistory] = useState<
    Array<{ id: string; ranAt: string; overallScore: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let iptal = false;
    (async () => {
      setLoading(true);
      try {
        const [c, h] = await Promise.all([
          api.compareAudits(siteId),
          api.getAuditHistory(siteId, 12),
        ]);
        if (iptal) return;
        setCmp(c);
        setHistory(h ?? []);
      } catch {
        // Delta paneli yardimci bir yuzey — hata durumunda sayfayi bozmak
        // yerine sessizce gizlenir, asil audit sonucu zaten ustte duruyor.
        if (!iptal) setCmp(null);
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [siteId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Karşılaştırma hazırlanıyor…
        </CardContent>
      </Card>
    );
  }

  if (!cmp) return null;

  if (cmp.yeterliVeriYok) {
    return (
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
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
        </CardContent>
      </Card>
    );
  }

  const { from, to, scoreDelta, geoScoreDelta, ozet, issues } = cmp;
  const yon = scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'flat';
  const degisenCheckler = cmp.checks.filter((c) => c.durum === 'iyilesti' || c.durum === 'kotulesti');

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Ust satir: skor delta rozeti + tarih araligi */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-lg font-bold ${
                yon === 'up'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : yon === 'down'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {yon === 'up' ? <TrendingUp className="h-5 w-5" />
                : yon === 'down' ? <TrendingDown className="h-5 w-5" />
                  : <Minus className="h-5 w-5" />}
              {scoreDelta > 0 ? '+' : ''}{scoreDelta} puan
            </div>
            <div>
              <p className="text-sm font-semibold">
                {from?.overallScore} <span className="text-muted-foreground font-normal">→</span> {to?.overallScore}
                <span className="text-xs text-muted-foreground font-normal">/100</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
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
                    <span
                      className={`ml-2 font-semibold ${
                        c.delta > 0 ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {c.delta > 0 ? '+' : ''}{c.delta}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/** Katlanabilir sorun listesi — <details> ile, ekstra bagimlilik yok */
function IssueGroup({
  baslik, sayi, issues, tonu, icon,
}: {
  baslik: string;
  sayi: number;
  issues: AuditIssueRecord[];
  tonu: 'success' | 'destructive' | 'warning';
  icon: React.ReactNode;
}) {
  const renk =
    tonu === 'success' ? 'text-green-600 dark:text-green-400'
      : tonu === 'destructive' ? 'text-red-600 dark:text-red-400'
        : 'text-yellow-600 dark:text-yellow-400';

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
                  {i.severity === 'critical' ? 'kritik' : i.severity === 'warning' ? 'uyarı' : 'bilgi'}
                </Badge>
              )}
              <div className="min-w-0">
                <p className="text-xs leading-relaxed">{i.description ?? i.type}</p>
                {i.page && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{i.page}</p>
                )}
              </div>
            </div>
          </li>
        ))}
        {issues.length > 50 && (
          <li className="px-3 py-2 text-[11px] text-muted-foreground">
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
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
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

function tarih(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}
