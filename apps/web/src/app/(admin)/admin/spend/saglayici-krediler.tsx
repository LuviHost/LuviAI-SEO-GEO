'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Activity, ExternalLink, Pencil, RefreshCw, Wallet } from 'lucide-react';
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
  // Sabit sutunlar (27.11.2026, sahip: "gösterimi düzelt kötü duruyor"): satirlar arasinda hizali
  // Islem sutunu SABIT genislik: "auto" her satirda icerige gore degisiyor, Düzenle'siz satirlar kayiyordu
  const SUTUNLAR = 'md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,0.7fr)_minmax(0,1fr)_12.5rem]';

  return (
    <Card className={cn(sorunlu.some((s) => s.durum === 'KREDI_BITTI') && 'border-danger/40')}>
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <Wallet className="h-4 w-4 mt-1 text-brand" />
          <div className="flex-1 min-w-[220px]">
            <p className="font-semibold">Sağlayıcı kredileri</p>
            <p className="text-xs text-muted-foreground">
              Ölçümlerin kullandığı sistem anahtarları. Kredi biterse ya da azalırsa zile ve e-postana uyarı gelir.
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

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Bakiye nasıl hesaplanıyor?</summary>
          <ul className="mt-2 space-y-1 list-disc pl-5">
            <li><b className="text-foreground">Gerçek</b>: DeepSeek ve DataForSEO bakiyeyi kendisi bildiriyor.</li>
            <li><b className="text-foreground">Tahmini</b>: sağlayıcının panelindeki tutarı &quot;Düzenle&quot;den girersin; o andan sonraki ölçüm ve içerik üretimi harcamamız düşülür. Aynı anahtarı başka bir şey kullanırsa ya da otomatik yükleme olursa sapar — arada güncelle.</li>
            <li><b className="text-foreground">Otomatik yükleme</b> işaretliyse tahmin düşse de &quot;Azaldı&quot; uyarısı gelmez; kredi gerçekten biterse sağlayıcının hatasıyla &quot;Kredi bitti&quot; gelir.</li>
            <li>&quot;Bu ay ölçüm&quot;: bizim sunucunun ölçüm çağrılarının gerçek maliyeti. Sağlayıcı panelindeki tutardan çok düşükse anahtarı başka bir şey de kullanıyordur.</li>
          </ul>
        </details>

        {!veri && <Skeleton className="h-40" />}

        {veri && (
          <div className="rounded-md border">
            <div className={cn('hidden md:grid gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground', SUTUNLAR)}>
              <span>Sağlayıcı</span>
              <span>Bakiye</span>
              <span>Bu ay ölçüm</span>
              <span>Son başarılı çağrı</span>
              <span className="text-right">İşlem</span>
            </div>
            <div className="divide-y">
              {veri.satirlar.map((s) => {
                const e = ETIKET[s.durum];
                const sorun = s.durum === 'KREDI_BITTI' || s.durum === 'AZALDI';
                const duzenleniyor = giris?.id === s.id;
                return (
                  <div key={s.id} className={cn(sorun && 'bg-danger/5')}>
                    <div className={cn('grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 md:items-center', SUTUNLAR)}>
                      {/* Saglayici */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{s.ad}</span>
                          <Badge variant={e.variant}>{e.metin}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{s.kullanim}</div>
                      </div>

                      {/* Bakiye */}
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {s.bakiye ? 'Gerçek bakiye' : s.bakiyeTuru === 'fatura' ? 'Kartla ödeniyor' : s.tahmin ? 'Tahmini bakiye' : 'Bakiye girilmedi'}
                        </div>
                        <div className={cn('text-sm font-semibold tabular-nums', sorun && 'text-danger')}>
                          {s.bakiye
                            ? s.bakiye.hata ? <span className="text-xs font-normal text-warning">okunamadı ({s.bakiye.hata})</span>
                              : s.bakiye.tutar !== null ? para(s.bakiye.tutar, s.bakiye.paraBirimi) : '—'
                            : s.tahmin ? para(s.tahmin.tutar, s.tahmin.paraBirimi)
                              : s.bakiyeTuru === 'fatura' ? <span className="text-xs font-normal text-muted-foreground">sonradan fatura</span> : '—'}
                        </div>
                        {s.tahmin && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="tabular-nums">{zaman(s.tahmin.girisAt)} girişi · harcanan {para(s.tahmin.kullanilanUsd, 'USD')}</span>
                            {s.tahmin.otomatikYukleme && <Badge variant="secondary">oto. yükleme</Badge>}
                          </div>
                        )}
                      </div>

                      {/* Bu ay olcum */}
                      <div className="text-sm tabular-nums">
                        <span className="md:hidden text-xs text-muted-foreground">Bu ay ölçüm: </span>
                        {s.gercekBuAy ? para(s.gercekBuAy.usd, 'USD') : <span className="text-muted-foreground">—</span>}
                      </div>

                      {/* Son cagri */}
                      <div className="min-w-0 text-xs">
                        <span className="md:hidden text-muted-foreground">Son başarılı çağrı: </span>
                        <span className="tabular-nums">{zaman(s.sonBasari)}</span>
                        {s.sonKrediHatasi && s.durum === 'KREDI_BITTI' && (
                          <div className="text-danger tabular-nums">kredi hatası {zaman(s.sonKrediHatasi)}</div>
                        )}
                        {s.sonKontrolHatasi && (
                          <div className="text-warning truncate" title={s.sonKontrolHatasi}>hata: {s.sonKontrolHatasi}</div>
                        )}
                      </div>

                      {/* Islemler */}
                      <div className="flex items-center gap-2 md:justify-end">
                        {s.bakiyeTuru === 'manuel' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setGiris(duzenleniyor ? null : { id: s.id, tutar: '', paraBirimi: s.tahmin?.paraBirimi ?? (s.id === 'gemini' ? 'TRY' : 'USD'), otomatik: s.tahmin?.otomatikYukleme ?? false })}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> {s.tahmin ? 'Düzenle' : 'Bakiye gir'}
                          </Button>
                        )}
                        <Button asChild size="sm" variant={sorun ? 'default' : 'outline'}>
                          <a href={s.yukleUrl} target="_blank" rel="noopener noreferrer">
                            Yükle <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                          </a>
                        </Button>
                      </div>
                    </div>

                    {/* Bakiye duzenleme: satirin altinda tam genislik */}
                    {duzenleniyor && giris && (
                      <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                        <span className="text-muted-foreground">Sağlayıcı panelindeki tutar:</span>
                        <input
                          value={giris.tutar}
                          onChange={(ev) => setGiris({ ...giris, tutar: ev.target.value })}
                          inputMode="decimal"
                          placeholder={s.tahmin ? String(s.tahmin.tutar).replace('.', ',') : 'örn. 120,70'}
                          aria-label={`${s.ad} bakiyesi`}
                          autoFocus
                          className="h-8 w-28 rounded-md border bg-background px-2 text-sm tabular-nums"
                        />
                        <select
                          value={giris.paraBirimi}
                          onChange={(ev) => setGiris({ ...giris, paraBirimi: ev.target.value as 'USD' | 'TRY' })}
                          aria-label="Para birimi"
                          className="h-8 rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="USD">USD</option>
                          <option value="TRY">TL</option>
                        </select>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Sağlayıcı bakiye azalınca kendisi yüklüyorsa işaretle: tahmin düşse de uyarı gelmez">
                          <input type="checkbox" checked={giris.otomatik} onChange={(ev) => setGiris({ ...giris, otomatik: ev.target.checked })} />
                          Otomatik yükleme açık
                        </label>
                        <div className="ml-auto flex gap-2">
                          {s.tahmin && giris.otomatik !== !!s.tahmin.otomatikYukleme && !giris.tutar.trim() && (
                            <Button size="sm" variant="outline" onClick={() => otomatikDegistir(s.id, giris.otomatik).then(() => setGiris(null))}>
                              Yalnız ayarı kaydet
                            </Button>
                          )}
                          <Button size="sm" onClick={bakiyeKaydet} disabled={kaydediliyor || !giris.tutar.trim()}>Bakiyeyi kaydet</Button>
                          <Button size="sm" variant="ghost" onClick={() => setGiris(null)}>Vazgeç</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
