'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, type EpostaHedef, type EpostaHedefDurum, type EpostaOverview } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBanner } from '@/components/ui/status-banner';
import { MetricCard } from '@/components/ui/metric';
import { cn } from '@/lib/utils';
import {
  Mail, RefreshCw, Send, Upload, Download, CheckCircle2, MousePointerClick, Eye, Ban, ShieldCheck, Webhook, Linkedin, Play,
} from 'lucide-react';

/**
 * Kurumsal e-posta kampanyasi — izleme ve fren. Gonderim mantigi apps/api/src/eposta-kampanya/; worker 30 dk'da bir
 * tur atar (hafta ici 10-17, tur basina 40, gunluk 200 / aylik 6.000).
 *
 * Akis: 07-kurumsal-adres ciktisi (CSV) ice aktarilir → YENI → "IYS dosyasi olustur" → dosya IYS paneline yuklenir →
 * "IYS'ye yukledim" → SIRADA → gonderilir. NEDEN IYS adimi panelde: Yonetmelik md. 6/6; sistem yuklenmemis adrese gondermez.
 */

const DURUM: Record<EpostaHedefDurum, { label: string; cls: string }> = {
  YENI: { label: 'Yeni', cls: 'bg-muted text-muted-foreground' },
  IYS_DOSYADA: { label: 'İYS bekliyor', cls: 'bg-warning/15 text-warning' },
  SIRADA: { label: 'Sırada', cls: 'bg-info/15 text-info' },
  GONDERILDI: { label: 'Gönderildi', cls: 'bg-success/15 text-success' },
  HATA: { label: 'Hata', cls: 'bg-danger/15 text-danger' },
  BOUNCE: { label: 'Geri döndü', cls: 'bg-danger/15 text-danger' },
  RET: { label: 'Ret', cls: 'bg-muted text-muted-foreground' },
  SPAM: { label: 'Spam şikâyeti', cls: 'bg-danger/15 text-danger' },
  HARIC: { label: 'Hariç', cls: 'bg-muted text-muted-foreground' },
};

const SEKTOR: Record<string, string> = {
  ajans: 'Ajans',
  finans: 'Finans',
  'eticaret-perakende-teknoloji': 'E-ticaret / perakende',
  'turizm-havayolu-telekom-otomotiv': 'Turizm / telekom / otomotiv',
  diger: 'Genel',
};

const LINKEDIN: Record<string, string> = {
  QUEUED: 'Kuyrukta', REQUESTED: 'İstek gitti', ACCEPTED: 'Kabul etti', MESSAGED: 'Mesaj gitti',
  REPLIED: 'Cevap verdi', SKIPPED: 'Atlandı', FAILED: 'Hata',
};

const tarih = (s: string | null) =>
  s ? new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '—';

function indir(ad: string, icerik: string) {
  const url = URL.createObjectURL(new Blob([icerik], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = ad;
  a.click();
  URL.revokeObjectURL(url);
}

const yuzde = (pay: number, payda: number) => (payda > 0 ? `%${Math.round((pay / payda) * 100)}` : '—');

export default function EpostaKampanyaPage() {
  const [o, setO] = useState<EpostaOverview | null>(null);
  const [durum, setDurum] = useState<string>('');
  const [sektor, setSektor] = useState<string>('');
  const [q, setQ] = useState('');
  /** Aranan metin 300 ms durunca sorguya gider (her tusa istek atilmasin) */
  const [qGecikmeli, setQGecikmeli] = useState('');
  /** Gec gelen eski yanit yenisini ezmesin */
  const istekNo = useRef(0);
  const [sayfa, setSayfa] = useState(1);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQGecikmeli(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const yukle = useCallback(async () => {
    const no = ++istekNo.current;
    try {
      const r = await api.getEpostaOverview({ durum, sektor, q: qGecikmeli, sayfa });
      if (no === istekNo.current) setO(r);
    } catch (e: any) {
      if (no === istekNo.current) toast.error(e?.message ?? 'Kampanya durumu alınamadı');
    }
  }, [durum, sektor, qGecikmeli, sayfa]);

  useEffect(() => { void yukle(); }, [yukle]);

  const is = async (ad: string, f: () => Promise<void>) => {
    setMesgul(ad);
    try { await f(); await yukle(); } catch (e: any) { toast.error(e?.message ?? 'İşlem başarısız'); } finally { setMesgul(null); }
  };

  if (!o) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const yeni = o.sayilar.YENI ?? 0;
  const sirada = o.sayilar.SIRADA ?? 0;
  const { gonderilen, acilan, tiklanan, son7 } = o.metrik;
  const kapanan = (o.sayilar.BOUNCE ?? 0) + (o.sayilar.RET ?? 0) + (o.sayilar.SPAM ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-posta Kampanyası"
        description="Firmaların kendi sitesindeki kurumsal adreslere (info@, pazarlama@) Mailjet ile günlük gönderim. Kişi adresi yok."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void yukle()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Yenile</Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!mesgul || !o.acik}
              onClick={() => is('tick', async () => { const r = await api.epostaTick(); toast.info(r.neden); })}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />Şimdi bir tur gönder
            </Button>
            <Button
              size="sm"
              variant={o.acik ? 'outline' : 'default'}
              disabled={!!mesgul}
              onClick={() => is('acik', async () => { const r = await api.setEpostaAcik(!o.acik); toast.success(r.acik ? 'Otomatik gönderim açıldı' : 'Otomatik gönderim kapatıldı'); })}
            >
              {o.acik ? 'Otomatik gönderimi kapat' : 'Otomatik gönderimi aç'}
            </Button>
          </div>
        }
      />

      {o.sorunlar.length > 0 && (
        <StatusBanner tone="danger" title="Gönderim yapılamaz — eksik ayar">
          <ul className="list-disc pl-4">{o.sorunlar.map((s) => <li key={s}>{s}</li>)}</ul>
        </StatusBanner>
      )}
      {o.duraklatma && (
        <StatusBanner
          tone="warning"
          title="Gönderim kendini durdurdu"
          action={<Button size="sm" disabled={!!mesgul} onClick={() => is('devam', async () => { await api.epostaDevam(); toast.success('Devam ediliyor'); })}><Play className="mr-1.5 h-3.5 w-3.5" />Devam</Button>}
        >
          {o.duraklatma}
        </StatusBanner>
      )}
      {!o.acik && !o.duraklatma && (
        <StatusBanner tone="info" title="Otomatik gönderim kapalı">
          Açınca hafta içi 10:00–17:00 arasında 30 dakikada bir en fazla 40 e-posta gider (günde {o.kota.gunluk}, ayda {o.kota.aylik}). Yalnız İYS&apos;ye yüklendiğini onayladığınız adresler gönderilir.
        </StatusBanner>
      )}
      {o.acik && !o.pencerede && !o.duraklatma && (
        <StatusBanner tone="info" title="Gönderim saatleri dışında">Sıradaki tur hafta içi 10:00&apos;da başlar.</StatusBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Bugün gönderilen" value={o.kota.bugun} suffix={` / ${o.kota.gunluk}`} icon={Send} hint={`Bu ay ${o.kota.ay} / ${o.kota.aylik}`} />
        <MetricCard label="Toplam gönderilen" value={gonderilen} icon={Mail} hint={`${sirada} adres sırada`} />
        <MetricCard label="Açılma" value={yuzde(acilan, gonderilen)} icon={Eye} accent="emerald" hint={`${acilan} firma açtı · ${tiklanan} tıkladı (${yuzde(tiklanan, gonderilen)})`} />
        <MetricCard
          label="Geri dönen / ret / spam"
          value={kapanan}
          icon={Ban}
          accent="amber"
          hint={`Son 7 gün: ${son7.bounce} geri dönme / ${son7.gonderilen} gönderim (${yuzde(son7.bounce, son7.gonderilen)}) · fren %3`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-brand" />İYS adımı</div>
            <p className="text-sm text-muted-foreground">
              Yeni adresler gönderilmeden önce İYS&apos;ye yüklenmeli. Dosyayı indirip İYS hizmet sağlayıcı panelinde toplu yükleyin, sonra &ldquo;Yükledim&rdquo;e basın.
            </p>
            <Button
              size="sm"
              disabled={!!mesgul || yeni === 0}
              onClick={() => is('iys', async () => {
                const r = await api.epostaIysDosyasi();
                indir(`ranksup-iys-${r.parti}.csv`, r.csv);
                toast.success(`${r.adet} adreslik İYS dosyası indirildi`);
              })}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />İYS dosyası oluştur ({yeni} yeni adres)
            </Button>
            {o.iysPartileri.length > 0 && (
              <div className="divide-y rounded-lg border">
                {o.iysPartileri.map((p) => (
                  <div key={p.parti} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div><span className="font-medium">{p.adet} adres</span> <span className="text-muted-foreground">· {p.parti}</span></div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={!!mesgul} onClick={() => is('iys-tekrar', async () => { const r = await api.epostaIysDosyasi(p.parti); indir(`ranksup-iys-${r.parti}.csv`, r.csv); })}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />Tekrar indir
                      </Button>
                      <Button size="sm" disabled={!!mesgul} onClick={() => is('iys-yuklendi', async () => { const r = await api.epostaIysYuklendi(p.parti); toast.success(`${r.sirada} adres gönderim sırasına girdi`); })}>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />İYS&apos;ye yükledim
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-medium"><Upload className="h-4 w-4 text-brand" />Adres ekle ve bağlantılar</div>
            <p className="text-sm text-muted-foreground">
              Kurumsal adres dosyası (kurumsal-import.csv). Var olan adres tekrar eklenmez, durumu geri alınmaz; kişi adlı satırlar reddedilir.
            </p>
            <input
              ref={dosyaRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void is('ice', async () => {
                  const r = await api.epostaIceAktar(await f.text());
                  toast.success(`${r.eklendi} yeni · ${r.guncellendi} güncellendi · ${r.atlandi} atlandı`);
                  if (r.hatalar.length) toast.warning(r.hatalar.slice(0, 3).join(' · '));
                });
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!mesgul} onClick={() => dosyaRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />CSV yükle</Button>
              <Button variant="outline" size="sm" disabled={!!mesgul} onClick={() => is('li', async () => { const r = await api.epostaLinkedinFirmalar(); indir('linkedin-firmalar.csv', r.csv); toast.success(`${r.adet} firma`); })}>
                <Linkedin className="mr-1.5 h-3.5 w-3.5" />LinkedIn firmalarını indir
              </Button>
              <Button variant="outline" size="sm" disabled={!!mesgul} onClick={() => is('wh', async () => {
                let r = await api.epostaWebhookKur();
                if (r.cakisan.length) {
                  const liste = r.cakisan.map((c) => `${c.tur}: ${c.url}`).join('\n');
                  if (!window.confirm(`Mailjet hesabında bu olaylar için başka bir adres kayıtlı:\n${liste}\n\nÜzerine yazılsın mı? (O sistem bu olayları artık almaz.)`)) return;
                  r = await api.epostaWebhookKur(true);
                }
                if (r.hatalar.length) toast.error(r.hatalar.join(' · '));
                else toast.success(`Mailjet olay akışı kuruldu: ${r.kurulan.join(', ')}`);
              })}>
                <Webhook className="mr-1.5 h-3.5 w-3.5" />Mailjet olay akışını kur
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Olay akışı açılma, tıklama, geri dönme ve ret bilgisini anında buraya getirir; bir kez kurmak yeterli.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['', 'SIRADA', 'GONDERILDI', 'YENI', 'IYS_DOSYADA', 'HATA', 'BOUNCE', 'RET', 'SPAM', 'HARIC'] as const).map((d) => (
              <button
                key={d || 'tum'}
                type="button"
                onClick={() => { setDurum(d); setSayfa(1); }}
                className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors', durum === d ? 'border-brand-500 bg-brand-500 text-white' : 'hover:bg-muted')}
              >
                {d ? `${DURUM[d].label} (${o.sayilar[d] ?? 0})` : 'Tümü'}
              </button>
            ))}
            <select
              value={sektor}
              onChange={(e) => { setSektor(e.target.value); setSayfa(1); }}
              className="rounded-md border bg-background px-2 py-1 text-xs"
              aria-label="Sektör"
            >
              <option value="">Tüm sektörler</option>
              {Object.entries(SEKTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setSayfa(1); }}
              placeholder="Firma ya da adres ara"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Firma</th>
                  <th className="py-2 pr-3 font-medium">Adres</th>
                  <th className="py-2 pr-3 font-medium">Durum</th>
                  <th className="py-2 pr-3 font-medium">Gönderildi</th>
                  <th className="py-2 pr-3 font-medium">Açtı / tıkladı</th>
                  <th className="py-2 pr-3 font-medium">LinkedIn</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {o.liste.map((h) => <Satir key={h.id} h={h} mesgul={!!mesgul} is={is} />)}
                {o.liste.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Bu filtrede adres yok.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {o.toplamListe > 50 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{o.toplamListe} adres · sayfa {o.sayfa}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={sayfa <= 1} onClick={() => setSayfa((s) => s - 1)}>Önceki</Button>
                <Button variant="outline" size="sm" disabled={sayfa * 50 >= o.toplamListe} onClick={() => setSayfa((s) => s + 1)}>Sonraki</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Satir({ h, mesgul, is }: { h: EpostaHedef; mesgul: boolean; is: (ad: string, f: () => Promise<void>) => Promise<void> }) {
  const d = DURUM[h.durum];
  const kapali = h.durum === 'HARIC' || h.durum === 'RET' || h.durum === 'BOUNCE' || h.durum === 'SPAM';
  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pr-3">
        <div className="font-medium">{h.marka || h.firma}</div>
        <div className="text-xs text-muted-foreground">{SEKTOR[h.sektor] ?? h.sektor}{h.web ? ` · ${h.web}` : ''}</div>
        {h.not && <div className="mt-1 text-xs text-muted-foreground">Not: {h.not}</div>}
      </td>
      <td className="py-2 pr-3 font-mono text-xs">{h.email}</td>
      <td className="py-2 pr-3">
        <Badge className={cn('font-normal', d.cls)} title={h.hata ?? undefined}>{d.label}</Badge>
        {h.hata && <div className="mt-1 max-w-xs truncate text-xs text-danger" title={h.hata}>{h.hata}</div>}
      </td>
      <td className="py-2 pr-3 text-xs">{tarih(h.gonderildiAt)}</td>
      <td className="py-2 pr-3 text-xs">
        <span className={cn('inline-flex items-center gap-1', h.acildiAt ? 'text-success' : 'text-muted-foreground')}><Eye className="h-3.5 w-3.5" />{h.acildiAt ? tarih(h.acildiAt) : '—'}</span>
        {h.tiklandiAt && <span className="ml-2 inline-flex items-center gap-1 text-success"><MousePointerClick className="h-3.5 w-3.5" />{tarih(h.tiklandiAt)}</span>}
      </td>
      <td className="py-2 pr-3 text-xs">{h.linkedin ? `${LINKEDIN[h.linkedin.durum] ?? h.linkedin.durum} · ${h.linkedin.kisi} kişi` : '—'}</td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={mesgul}
            onClick={() => {
              const not = window.prompt('Not (cevap geldi, görüşme ayarlandı…)', h.not ?? '');
              if (not !== null) void is('not', async () => { await api.epostaHedefGuncelle(h.id, { not }); });
            }}
          >
            Not
          </Button>
          {!kapali && (
            <Button
              variant="ghost"
              size="sm"
              disabled={mesgul}
              title="Ret istedi: bir daha gönderilmez (İYS'de de ret işaretleyin)"
              onClick={() => { if (window.confirm(`${h.email} ret olarak işaretlensin mi? Bir daha gönderilmez.`)) void is('ret', async () => { await api.epostaHedefGuncelle(h.id, { durum: 'RET' }); }); }}
            >
              Ret
            </Button>
          )}
          {!kapali && h.durum !== 'GONDERILDI' && (
            <Button variant="ghost" size="sm" disabled={mesgul} onClick={() => void is('haric', async () => { await api.epostaHedefGuncelle(h.id, { durum: 'HARIC' }); })}>
              Hariç tut
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
