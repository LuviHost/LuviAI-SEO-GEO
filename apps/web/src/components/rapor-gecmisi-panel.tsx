'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RaporKaydi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CalendarRange, Download, FileText, Loader2, Play, Printer, Trash2 } from 'lucide-react';
import { DondurulmusRapor } from './dondurulmus-rapor';

/**
 * Rapor calistirma + gecmis.
 *
 * NEDEN KALICI: rapor bugune kadar her acilista sifirdan hesaplaniyordu ve
 * altindaki kaynaklarin bir kismi degisiyor (reklam metrikleri cron ile
 * uzerine yaziliyor, crawler kayitlari temizleniyor, aylik kotalar
 * sifirlaniyor). Ayni "Temmuz raporu" Eylul'de baska rakam gosteriyordu.
 * Artik rapor URETILDIGI ANDA donduruluyor ve bir daha hesaplanmiyor.
 */

const HAZIR_DONEMLER = [
  { key: 'week', etiket: 'Son 7 gün' },
  { key: 'month', etiket: 'Son 30 gün' },
  { key: 'year', etiket: 'Son 1 yıl' },
] as const;

function gunAdi(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function donemEtiketi(r: RaporKaydi) {
  if (r.period === 'custom') return `${gunAdi(r.periodStart)} – ${gunAdi(r.periodEnd)}`;
  return HAZIR_DONEMLER.find((d) => d.key === r.period)?.etiket ?? r.period;
}

/** Skor hucresi — null ise "—", cunku 0 yazmak sahte bir olcum uretir. */
function Skor({ deger, sonek = '' }: { deger: number | null; sonek?: string }) {
  if (deger === null || deger === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-semibold">
      {deger}
      {sonek}
    </span>
  );
}

export function RaporGecmisiPanel({ siteId }: { siteId: string }) {
  const [gecmis, setGecmis] = useState<RaporKaydi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);
  const [secili, setSecili] = useState<(RaporKaydi & { data: any }) | null>(null);
  const [seciliYukleniyor, setSeciliYukleniyor] = useState(false);

  const [ozelAcik, setOzelAcik] = useState(false);
  const [baslangic, setBaslangic] = useState('');
  const [bitis, setBitis] = useState('');

  const canli = useRef(true);
  useEffect(() => {
    canli.current = true;
    return () => {
      canli.current = false;
    };
  }, []);

  const gecmisiYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const liste = await api.getReportHistory(siteId);
      if (!canli.current) return;
      setGecmis(Array.isArray(liste) ? liste : []);
    } catch (err: any) {
      if (canli.current) setHata(err?.message || 'Rapor geçmişi alınamadı');
    } finally {
      if (canli.current) setYukleniyor(false);
    }
  }, [siteId]);

  useEffect(() => {
    void gecmisiYukle();
  }, [gecmisiYukle]);

  const raporuAc = async (id: string) => {
    setSeciliYukleniyor(true);
    try {
      const r = await api.getReportById(siteId, id);
      if (canli.current) setSecili(r);
    } catch (err: any) {
      toast.error(err?.message || 'Rapor açılamadı');
    } finally {
      if (canli.current) setSeciliYukleniyor(false);
    }
  };

  const calistir = async (donem: { range?: string; from?: string; to?: string }) => {
    setCalisiyor(true);
    try {
      const r = await api.runReport(siteId, donem);
      toast.success('Rapor oluşturuldu');
      await gecmisiYukle();
      await raporuAc(r.id);
      setOzelAcik(false);
    } catch (err: any) {
      toast.error(err?.message || 'Rapor oluşturulamadı');
    } finally {
      if (canli.current) setCalisiyor(false);
    }
  };

  const sil = async (id: string) => {
    try {
      await api.deleteReport(siteId, id);
      if (secili?.id === id) setSecili(null);
      await gecmisiYukle();
      toast.success('Rapor silindi');
    } catch (err: any) {
      toast.error(err?.message || 'Rapor silinemedi');
    }
  };

  const ozelGecerli = !!baslangic && !!bitis && new Date(bitis) >= new Date(baslangic);

  return (
    <div className="space-y-4">
      {/* ── Calistirma ───────────────────────────────────────── */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold mr-1">Rapor çalıştır</p>
            {HAZIR_DONEMLER.map((d) => (
              <Button
                key={d.key}
                size="sm"
                variant="outline"
                disabled={calisiyor}
                onClick={() => calistir({ range: d.key })}
              >
                {d.etiket}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={calisiyor} onClick={() => setOzelAcik((v) => !v)}>
              <CalendarRange className="h-3.5 w-3.5 mr-1" />
              Tarih aralığı
            </Button>
            {calisiyor && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Hesaplanıyor…
              </span>
            )}
          </div>

          {ozelAcik && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <label className="text-xs">
                <span className="block text-muted-foreground mb-1">Başlangıç</span>
                <input
                  type="date"
                  value={baslangic}
                  onChange={(e) => setBaslangic(e.target.value)}
                  className="border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </label>
              <label className="text-xs">
                <span className="block text-muted-foreground mb-1">Bitiş</span>
                <input
                  type="date"
                  value={bitis}
                  onChange={(e) => setBitis(e.target.value)}
                  className="border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </label>
              <Button
                size="sm"
                disabled={!ozelGecerli || calisiyor}
                onClick={() => calistir({ from: baslangic, to: bitis })}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                Çalıştır
              </Button>
              {baslangic && bitis && !ozelGecerli && (
                <span className="text-xs text-red-600">Bitiş tarihi başlangıçtan önce olamaz</span>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Rapor oluşturulduğu andaki sayılarla <strong>dondurulur</strong> — sonradan açtığında aynı rakamları görürsün.
          </p>
        </CardContent>
      </Card>

      {/* ── Gecmis ───────────────────────────────────────────── */}
      <Card className="print:hidden">
        <CardContent className="p-4">
          <p className="text-sm font-semibold mb-3">Rapor geçmişi</p>

          {yukleniyor && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
          {hata && <p className="text-sm text-red-600">{hata}</p>}

          {!yukleniyor && !hata && gecmis.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Henüz rapor çalıştırılmamış. Yukarıdan bir dönem seçip başlayabilirsin.
            </p>
          )}

          {gecmis.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Oluşturulma</th>
                    <th className="py-2 pr-3 font-medium">Dönem</th>
                    <th className="py-2 pr-3 font-medium text-right">SEO</th>
                    <th className="py-2 pr-3 font-medium text-right">GEO</th>
                    <th className="py-2 pr-3 font-medium text-right">AI</th>
                    <th className="py-2 pr-3 font-medium text-right">Tıklama</th>
                    <th className="py-2 pr-3 font-medium text-right">Makale</th>
                    <th className="py-2 pr-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {gecmis.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b last:border-0 hover:bg-muted/40 ${secili?.id === r.id ? 'bg-muted/60' : ''}`}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(r.generatedAt).toLocaleString('tr-TR', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                        {/* Otomatik uretilen raporlar kullanicinin calistirdiklarindan ayirt edilir */}
                        {r.trigger !== 'manual' && (
                          <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                            {r.trigger}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{donemEtiketi(r)}</td>
                      <td className="py-2 pr-3 text-right"><Skor deger={r.seoScore} /></td>
                      <td className="py-2 pr-3 text-right"><Skor deger={r.geoScore} /></td>
                      <td className="py-2 pr-3 text-right"><Skor deger={r.aiVisibility} /></td>
                      <td className="py-2 pr-3 text-right">{r.clicks.toLocaleString('tr-TR')}</td>
                      <td className="py-2 pr-3 text-right">{r.articlesPublished}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => raporuAc(r.id)} title="Aç">
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                          <a
                            href={api.getReportByIdCsvUrl(siteId, r.id)}
                            title="CSV indir"
                            className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <Button size="sm" variant="ghost" onClick={() => sil(r.id)} title="Sil">
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Secili raporun dondurulmus govdesi ───────────────── */}
      {seciliYukleniyor && <p className="text-sm text-muted-foreground">Rapor açılıyor…</p>}

      {secili && (
        <div className="space-y-3">
          <div className="flex items-center justify-between print:hidden">
            <p className="text-sm font-semibold">
              {donemEtiketi(secili)} raporu
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {new Date(secili.generatedAt).toLocaleString('tr-TR')} tarihinde oluşturuldu
              </span>
            </p>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5 mr-1" />
              Yazdır / PDF olarak kaydet
            </Button>
          </div>
          <DondurulmusRapor rapor={secili} />
        </div>
      )}
    </div>
  );
}
