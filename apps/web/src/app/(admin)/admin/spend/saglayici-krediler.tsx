'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Activity, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { api, type SaglayiciKrediDurumu, type SaglayiciKrediTablosu } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Saglayici kredileri (27.11.2026, sahip: "kredi durumlarını admin panelde görelim; Yükle deyince
 * ilgili linke yönlendirsin, ordan yükleyeyim"). Gemini kredisi 25.11'de bitmis, iki gun fark
 * edilmemisti. "Yükle" saglayicinin fatura sayfasini YENI SEKMEDE acar; odeme orada yapilir.
 * Bakiye yalniz DeepSeek ve DataForSEO'da sorgulanabiliyor; digerleri son cagri sonucumuzdan.
 */

const ETIKET: Record<SaglayiciKrediDurumu, { metin: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  CALISIYOR: { metin: 'Çalışıyor', variant: 'success' },
  AZALDI: { metin: 'Azaldı', variant: 'warning' },
  KREDI_BITTI: { metin: 'Kredi bitti', variant: 'danger' },
  HATA: { metin: 'Bağlantı hatası', variant: 'warning' },
  ANAHTAR_YOK: { metin: 'Anahtar yok', variant: 'secondary' },
  BILINMIYOR: { metin: 'Henüz kontrol yok', variant: 'secondary' },
};

function zaman(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function para(tutar: number, birim: string | null): string {
  return `${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${birim === 'TRY' ? 'TL' : birim ?? 'USD'}`;
}

export function SaglayiciKrediler() {
  const [veri, setVeri] = useState<SaglayiciKrediTablosu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kontrolde, setKontrolde] = useState(false);
  // Tahmini bakiye girisi: saglayicinin panelindeki tutar yazilir, sonraki harcama dusulur
  const [giris, setGiris] = useState<{ id: string; tutar: string; paraBirimi: 'USD' | 'TRY'; otomatik: boolean } | null>(null);

  const otomatikDegistir = async (id: string, deger: boolean) => {
    try {
      setVeri(await api.saglayiciOtomatikYukleme(id, deger));
      toast.success(deger ? 'Otomatik yükleme açık: tahminden "Azaldı" uyarısı gelmez' : 'Otomatik yükleme kapalı: tahmin 5 USD altına inerse uyarı gelir');
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err.message}`);
    }
  };
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const bakiyeKaydet = async () => {
    if (!giris) return;
    // "943,98" / "1.234,56" (Turkce) ya da "120.70" (panellerdeki gibi): virgul varsa ondalik ayraci odur
    const ham = giris.tutar.trim();
    const n = Number(ham.includes(',') ? ham.replace(/\./g, '').replace(',', '.') : ham);
    if (!giris.tutar.trim() || !Number.isFinite(n) || n < 0) { toast.error('Geçerli bir tutar yaz'); return; }
    setKaydediliyor(true);
    try {
      setVeri(await api.saglayiciBakiyeGir(giris.id, n, giris.paraBirimi, giris.otomatik));
      setGiris(null);
      toast.success('Bakiye kaydedildi; bundan sonraki harcama düşülecek');
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err.message}`);
    } finally {
      setKaydediliyor(false);
    }
  };

  // Her saglayiciya en kucuk istek: kayit beklemeden durumu hemen ogrenir (toplam < 0,01 USD)
  const kontrolEt = async () => {
    setKontrolde(true);
    try {
      const v = await api.saglayiciKrediKontrol();
      setVeri(v);
      const sorun = v.satirlar.filter((s) => s.durum === 'KREDI_BITTI' || s.durum === 'HATA').map((s) => s.ad);
      if (sorun.length) toast.warning(`Sorunlu: ${sorun.join(', ')}`);
      else toast.success('Bütün sağlayıcılar çalışıyor');
    } catch (err: any) {
      toast.error(`Kontrol yapılamadı: ${err.message}`);
    } finally {
      setKontrolde(false);
    }
  };

  const yukle = useCallback(async (tazele = false) => {
    setYukleniyor(true);
    try {
      setVeri(await api.getSaglayiciKredi(tazele));
    } catch (err: any) {
      toast.error(`Kredi durumu alınamadı: ${err.message}`);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => { void yukle(); }, [yukle]);

  const sorunlu = (veri?.satirlar ?? []).filter((s) => s.durum === 'KREDI_BITTI' || s.durum === 'AZALDI');

  return (
    <Card className={cn(sorunlu.some((s) => s.durum === 'KREDI_BITTI') && 'border-danger/40')}>
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <Wallet className="h-4 w-4 mt-0.5 text-brand" />
          <div className="flex-1 min-w-[200px]">
            <p className="font-semibold">Sağlayıcı kredileri</p>
            <p className="text-xs text-muted-foreground">
              Ölçümlerin kullandığı sistem anahtarları. Bakiye yalnız DeepSeek ve DataForSEO&apos;da sorgulanabiliyor;
              diğerlerinde sağlayıcının panelindeki tutarı &quot;Bakiye gir&quot;e yazarsan sonraki harcamamız düşülür
              (tahmini — aynı anahtarı başka bir şey kullanırsa ya da otomatik yükleme olursa sapar; arada güncelle).
              Durum ayrıca ölçüm çağrılarından (kredi bitince 402) ya da &quot;Şimdi kontrol et&quot; ile öğrenilir. Kredi bitince ya da bakiye azalınca zile ve e-postana uyarı düşer. &quot;Yükle&quot;
              sağlayıcının ödeme sayfasını yeni sekmede açar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={kontrolEt} disabled={kontrolde || yukleniyor} title="Her sağlayıcıya çok küçük bir istek atar (toplam 0,01 USD'nin altında)">
              <Activity className={cn('h-3.5 w-3.5 mr-1.5', kontrolde && 'animate-pulse')} /> {kontrolde ? 'Kontrol ediliyor…' : 'Şimdi kontrol et'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => yukle(true)} disabled={yukleniyor || kontrolde}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', yukleniyor && 'animate-spin')} /> Bakiyeleri yenile
            </Button>
          </div>
        </div>

        {!veri && <Skeleton className="h-40" />}

        {veri && (
          <div className="divide-y rounded-md border">
            {veri.satirlar.map((s) => {
              const e = ETIKET[s.durum];
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3">
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.ad}</span>
                      <Badge variant={e.variant}>{e.metin}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{s.kullanim}</div>
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[200px]">
                    {s.bakiye
                      ? s.bakiye.hata
                        ? <>Bakiye okunamadı ({s.bakiye.hata})</>
                        : s.bakiye.tutar !== null
                          ? <>Bakiye: <b className={cn('text-foreground', s.durum !== 'CALISIYOR' && 'text-danger')}>{para(s.bakiye.tutar, s.bakiye.paraBirimi)}</b></>
                          : <>Bakiye bilinmiyor</>
                      : s.bakiyeTuru === 'fatura'
                        ? <>Kartla ödeniyor (sonradan fatura) — biten bakiye yok</>
                        : s.tahmin
                          ? (
                            <span title={`Giriş: ${para(s.tahmin.girisTutar, s.tahmin.paraBirimi)} · ${zaman(s.tahmin.girisAt)} · o andan beri kayıtlı harcama ${para(s.tahmin.kullanilanUsd, 'USD')}. Aynı anahtarı başka bir şey kullanıyorsa ya da otomatik yükleme olduysa gerçek bakiye farklıdır.`}>
                              Tahmini bakiye: <b className={cn('text-foreground', s.durum === 'AZALDI' && 'text-danger')}>{para(s.tahmin.tutar, s.tahmin.paraBirimi)}</b>
                              <span className="block">giriş {zaman(s.tahmin.girisAt)} · harcama {para(s.tahmin.kullanilanUsd, 'USD')}</span>
                            </span>
                          )
                          : <>Bakiye girilmedi</>}
                    {s.bakiyeTuru === 'manuel' && (
                      giris?.id === s.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <input
                            value={giris.tutar}
                            onChange={(ev) => setGiris({ ...giris, tutar: ev.target.value })}
                            inputMode="decimal"
                            placeholder="Tutar"
                            aria-label={`${s.ad} bakiyesi`}
                            className="h-7 w-24 rounded-md border bg-background px-2 text-xs"
                          />
                          <select
                            value={giris.paraBirimi}
                            onChange={(ev) => setGiris({ ...giris, paraBirimi: ev.target.value as 'USD' | 'TRY' })}
                            aria-label="Para birimi"
                            className="h-7 rounded-md border bg-background px-1 text-xs"
                          >
                            <option value="USD">USD</option>
                            <option value="TRY">TL</option>
                          </select>
                          <label className="inline-flex items-center gap-1 cursor-pointer select-none" title="Sağlayıcı bakiye azalınca kendisi yüklüyorsa işaretle: tahmin düşse de uyarı gelmez">
                            <input type="checkbox" checked={giris.otomatik} onChange={(ev) => setGiris({ ...giris, otomatik: ev.target.checked })} />
                            otomatik yükleme açık
                          </label>
                          <Button size="sm" className="h-7" onClick={bakiyeKaydet} disabled={kaydediliyor}>Kaydet</Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setGiris(null)}>Vazgeç</Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mt-0.5 block text-brand-600 hover:underline"
                          onClick={() => setGiris({ id: s.id, tutar: '', paraBirimi: s.tahmin?.paraBirimi ?? (s.id === 'gemini' ? 'TRY' : 'USD'), otomatik: s.tahmin?.otomatikYukleme ?? false })}
                        >
                          {s.tahmin ? 'Bakiyeyi güncelle' : 'Bakiye gir'}
                        </button>
                      )
                    )}
                    {s.bakiyeTuru === 'manuel' && s.tahmin && giris?.id !== s.id && (
                      <label className="mt-0.5 flex items-center gap-1 cursor-pointer select-none" title="Sağlayıcı bakiye azalınca kendisi yüklüyorsa işaretle: tahmin düşse de uyarı gelmez">
                        <input type="checkbox" checked={!!s.tahmin.otomatikYukleme} onChange={(ev) => otomatikDegistir(s.id, ev.target.checked)} />
                        otomatik yükleme açık
                      </label>
                    )}
                    <div title="Bizim sunucunun ölçüm çağrılarının gerçek maliyeti (token × fiyat + arama ücreti). Sağlayıcı panelindeki aylık tutarla fark varsa anahtarı başka bir şey de kullanıyordur.">
                      Bu ay ölçüm harcamamız:{' '}
                      {s.gercekBuAy
                        ? <><b className="text-foreground">${s.gercekBuAy.usd.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>{s.gercekBuAy.baslangic > `${new Date().toISOString().slice(0, 7)}-01` ? ` (kayıt başlangıcı: ${s.gercekBuAy.baslangic.slice(8, 10)}.${s.gercekBuAy.baslangic.slice(5, 7)})` : ''}</>
                        : '—'}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[220px] max-w-[420px]">
                    Son başarılı çağrı: {zaman(s.sonBasari)}
                    {s.sonKrediHatasi && <> · son kredi hatası: <span className={cn(s.durum === 'KREDI_BITTI' && 'text-danger')}>{zaman(s.sonKrediHatasi)}</span></>}
                    {s.sonKontrolHatasi && (
                      <div className="text-warning line-clamp-2 break-all max-w-[420px]" title={s.sonKontrolHatasi}>
                        Kontrol hatası ({zaman(s.sonKontrolHatasiAt ?? null)}): {s.sonKontrolHatasi}
                      </div>
                    )}
                  </div>
                  <Button asChild size="sm" variant={s.durum === 'KREDI_BITTI' || s.durum === 'AZALDI' ? 'default' : 'outline'}>
                    <a href={s.yukleUrl} target="_blank" rel="noopener noreferrer">
                      Yükle <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                    </a>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
