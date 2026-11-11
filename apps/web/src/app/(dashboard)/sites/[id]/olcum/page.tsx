'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, Loader2, Minus, RefreshCw, ScanSearch, ShieldAlert } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusBanner } from '@/components/ui/status-banner';
import { AsyncState } from '@/components/ui/async-state';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/site-routes';
import {
  PLATFORM_KISA,
  TUR_ADI,
  degerMetni,
  donusumOlaylari,
  karsilastirma,
  rakiptekiKanallar,
  type OlcumBulgusu,
  type OlcumHedef,
  type OlcumSonucu,
} from '@/lib/olcum';

/**
 * Olcum altyapisi — sitenin ve rakiplerinin herkese acik dosyalarindan (sayfa, JS paketleri, gtm.js)
 * analitik, reklam pikselleri ve donusum olaylari. Yalniz okuma; disaridan gorunmeyen sey "yok" denmez.
 * API: /sites/:siteId/olcum (apps/api/src/olcum).
 */

const YOKLAMA_MS = 4_000;

const BULGU_TONU: Record<OlcumBulgusu['duzey'], 'danger' | 'warning' | 'info'> = { kritik: 'danger', uyari: 'warning', bilgi: 'info' };
const BULGU_BASLIK: Record<OlcumBulgusu['duzey'], string> = { kritik: 'Kritik', uyari: 'Dikkat', bilgi: 'Öneri' };

function Hucre({ deger }: { deger: boolean | null }) {
  if (deger === null) return <ShieldAlert className="mx-auto h-4 w-4 text-warning" aria-label="Ölçülemedi" />;
  return deger
    ? <Check className="mx-auto h-4 w-4 text-success" aria-label="Var" />
    : <Minus className="mx-auto h-4 w-4 text-muted-foreground/60" aria-label="Görünmüyor" />;
}

function HedefDetayi({ h }: { h: OlcumHedef }) {
  const olaylar = donusumOlaylari(h.rapor);
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-panel-3">{h.ad}</p>
          <Badge variant={h.rakip ? 'outline' : 'secondary'}>{h.rakip ? 'Rakip' : 'Siz'}</Badge>
          <a href={h.url} target="_blank" rel="noopener noreferrer nofollow" className="font-mono text-vitrin-rail text-muted-foreground transition-colors hover:text-foreground">
            {h.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        </div>
        {h.durum !== 'tamam' ? (
          <p className="text-sm text-warning">Ölçülemedi: {h.neden ?? 'site okunamadı'}. Bu site için “yok” sonucu çıkarılmadı.</p>
        ) : (
          <>
            <div>
              <p className="v-rail mb-2">Görünen dönüşüm olayları</p>
              {olaylar.length === 0 ? (
                <p className="text-sm text-muted-foreground">Dışarıdan görünen dönüşüm olayı yok. Analitik panelinin içinde tanımlı olabilir; bu dışarıdan görünmez.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {olaylar.map((o) => {
                    const deger = degerMetni(o.deger);
                    return (
                      <li key={`${o.platform}|${o.ad}|${o.tetikleyici ?? ''}`} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono">{o.ad}</span>
                        <span className="text-muted-foreground">→ {PLATFORM_KISA[o.platform] ?? o.platform}</span>
                        {o.tetikleyici && o.tetikleyici !== o.ad && <span className="text-muted-foreground">· tetikleyici: {o.tetikleyici}</span>}
                        {deger && <span className="text-muted-foreground">· {deger}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {(h.rapor?.gtm.length || h.rapor?.sunucuTarafli || h.taranan?.kesildi) ? (
              <p className="text-xs text-muted-foreground">
                {h.rapor?.gtm.map((g) => `${g.kimlik}: ${g.etiketSayisi} etiket${g.duraklatilan ? `, ${g.duraklatilan} duraklatılmış` : ''}`).join(' · ')}
                {h.rapor?.sunucuTarafli ? ' · Sunucu taraflı etiketleme var: bu kanaldan giden olaylar görünmez.' : ''}
                {h.taranan?.kesildi ? ' · Dosya sınırına ulaşıldı, liste eksik olabilir.' : ''}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function OlcumPage() {
  const { site } = useSiteContext();
  const [data, setData] = useState<OlcumSonucu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setData(await api.getOlcum(site.id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Tarama arka planda: suruyorsa durum yeniden okunur
  useEffect(() => {
    if (data?.durum !== 'calisiyor') return;
    timer.current = setTimeout(load, YOKLAMA_MS);
    return () => clearTimeout(timer.current);
  }, [data, load]);

  const tara = async () => {
    setStarting(true);
    try {
      const r = await api.runOlcum(site.id);
      if (r.sonuc) setData(r.sonuc);
      if (!r.baslatildi && r.sonuc?.durum === 'tamam') toast.info('Son tarama 10 dakikadan yeni; sonuç aşağıda.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Tarama başlatılamadı');
    } finally {
      setStarting(false);
    }
  };

  const calisiyor = data?.durum === 'calisiyor';
  const hedefler = data?.hedefler ?? [];
  const siz = hedefler.find((h) => !h.rakip);
  const rakipSayisi = hedefler.filter((h) => h.rakip).length;
  const tablo = karsilastirma(hedefler);
  const eksikKanallar = rakiptekiKanallar(hedefler);

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={ScanSearch}
        title="Ölçüm Altyapısı"
        description="Sitenizde ve rakiplerinizde hangi analitik ve reklam araçlarının kurulu olduğu ve hangi dönüşümlerin ölçüldüğü. Herkese açık dosyalardan okunur."
        actions={
          <Button size="sm" onClick={tara} disabled={starting || calisiyor}>
            {starting || calisiyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {calisiyor ? 'Taranıyor…' : data ? 'Yeniden tara' : 'Taramayı başlat'}
          </Button>
        }
      />

      <AsyncState
        loading={loading}
        error={error}
        onRetry={load}
        empty={!data}
        emptyView={
          <Card>
            <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Henüz taranmadı.</p>
              <p>
                Tarama sitenizin ana sayfasını, JavaScript dosyalarını ve Google Etiket Yöneticisi kapsayıcısını okur; aynısını rakip listenizdeki
                sitelere de uygular. Hiçbir form doldurulmaz, hiçbir olay tetiklenmez. Birkaç dakika sürebilir.
              </p>
            </CardContent>
          </Card>
        }
      >
        {calisiyor && (
          <StatusBanner tone="info" title="Tarama sürüyor">
            {hedefler.length} site tarandı. Sayfa kendiliğinden güncellenir.
          </StatusBanner>
        )}

        {siz?.bulgular?.map((b) => (
          <StatusBanner key={b.kod} tone={BULGU_TONU[b.duzey]} title={BULGU_BASLIK[b.duzey]}>
            {b.metin}
          </StatusBanner>
        ))}

        {eksikKanallar.length > 0 && (
          <StatusBanner tone="warning" title="Rakiplerinizin kullandığı, sizde görünmeyen reklam kanalları">
            {eksikKanallar.map((k) => `${k.ad} (${k.rakipler.join(', ')})`).join(' · ')}
          </StatusBanner>
        )}

        {data?.atlananRakipler?.length ? (
          <StatusBanner tone="info" title={`İlk 10 rakip tarandı, ${data.atlananRakipler.length} rakip taranmadı`}>
            Taranmayanlar: {data.atlananRakipler.join(', ')}. Sıra{' '}
            <Link href={siteHref(site.id, 'competitors')} className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">Rakipler</Link>{' '}
            sayfasındaki sıradır; ilgisiz olanları oradan kaldırabilirsiniz.
          </StatusBanner>
        ) : null}

        {!calisiyor && data && rakipSayisi === 0 && (
          <StatusBanner tone="info" title="Rakip karşılaştırması için rakip ekleyin">
            Rakip listeniz boş ya da adres içermiyor.{' '}
            <Link href={siteHref(site.id, 'competitors')} className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">Rakipler</Link>{' '}
            sayfasına adresleriyle ekleyip yeniden tarayın.
          </StatusBanner>
        )}

        {tablo.length > 0 && (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left font-mono text-vitrin-rail text-muted-foreground">
                    <th className="px-4 py-2.5 font-normal">Araç</th>
                    {hedefler.map((h) => (
                      <th key={h.url} className="px-3 py-2.5 text-center font-normal">
                        {h.rakip ? h.ad : 'Siz'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tablo.map((s, i) => (
                    <tr key={s.kod}>
                      <td className="px-4 py-2.5">
                        {(i === 0 || tablo[i - 1].tur !== s.tur) && <span className="v-rail mb-0.5 block">{TUR_ADI[s.tur]}</span>}
                        {s.ad}
                      </td>
                      {s.hucreler.map((v, j) => (
                        <td key={hedefler[j].url} className="px-3 py-2.5 text-center"><Hucre deger={v} /></td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-2.5 font-medium">Görünen dönüşüm olayı</td>
                    {hedefler.map((h) => (
                      <td key={h.url} className="px-3 py-2.5 text-center tabular-nums">{h.durum === 'tamam' ? donusumOlaylari(h.rapor).length : '—'}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {hedefler.map((h) => <HedefDetayi key={h.url} h={h} />)}

        {data && (
          <p className="text-xs text-muted-foreground">
            Sınırlar: Google Analytics panelinin içindeki ayarlar (anahtar etkinlikler, kanal grupları), sunucu taraflı etiketleme ve giriş
            gerektiren sayfalar dışarıdan görünmez; bu yüzden sonuçlar “yok” değil “görünmüyor” diye yazılır. Dosyada yazan değer rakamları
            yer tutucu olabilir, gerçek birim ekonomisi değildir.
            {data.bitis ? ` Son tarama: ${new Date(data.bitis).toLocaleString('tr-TR')}.` : ''}
          </p>
        )}
      </AsyncState>
    </div>
  );
}
