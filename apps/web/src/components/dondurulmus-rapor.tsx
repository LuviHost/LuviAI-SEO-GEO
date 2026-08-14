'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowDown, ArrowUp, Minus, Search, Sparkles, Smartphone, Megaphone, Wrench } from 'lucide-react';

/**
 * Dondurulmus raporun gorunumu — DORT ALAN: SEO / GEO / ASO / ASA.
 *
 * IKI GORUNUM, TEK VERI: "Özet" musteriye gosterilecek sadelikte, "Detay"
 * ic kullanim icin ham sayilari acar. Ayni dondurulmus govdeden beslenirler;
 * ikisi ayri hesaplanmaz — bu kod tabaninda tekrarlayan hata sinifi tam
 * olarak "iki yapi bagimsiz kayiyor" oldu.
 *
 * OLCULEMEYEN BOLUM SIFIR GOSTERMEZ. Sunucu her bolumu `{ olculemedi, neden }`
 * ile isaretliyor; burada gerekcesiyle birlikte "veri yok" yaziyoruz. Sifir
 * gostermek "hic yukleme olmadi" gibi okunur ve yalandir.
 */

type Bolum<T> = ({ olculemedi: false } & T) | { olculemedi: true; neden: string };

function sayi(n: number | null | undefined, bos = '—') {
  if (n === null || n === undefined || Number.isNaN(n)) return bos;
  return n.toLocaleString('tr-TR');
}

/**
 * Delta rozeti. `tersYon` sirala metrikleri icindir: ASO'da sira KUCULDUKCE
 * iyilesir, yani -12 iyi haberdir. Rengi metrige gore ayarlamazsak rapor
 * iyilesmeyi kirmizi gosterir.
 */
function Delta({ deger, tersYon = false, sonek = '' }: { deger: number | null; tersYon?: boolean; sonek?: string }) {
  if (deger === null || deger === undefined) return <span className="text-muted-foreground text-xs">ölçüm yok</span>;
  if (deger === 0) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
        <Minus className="h-3 w-3" /> değişmedi
      </span>
    );
  }
  const iyi = tersYon ? deger < 0 : deger > 0;
  const Ok = deger > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={`text-xs font-semibold inline-flex items-center gap-0.5 ${
        iyi ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      <Ok className="h-3 w-3" />
      {deger > 0 ? '+' : ''}
      {deger.toLocaleString('tr-TR')}
      {sonek}
    </span>
  );
}

function VeriYok({ neden }: { neden: string }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground/70 mb-1">Ölçüm yok</p>
      <p className="text-xs leading-relaxed">{neden}</p>
    </div>
  );
}

function Baslik({ ikon: Ikon, children, renk }: { ikon: any; children: React.ReactNode; renk: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`h-7 w-7 rounded-lg grid place-items-center ${renk}`}>
        <Ikon className="h-4 w-4" />
      </div>
      <h4 className="text-sm font-semibold">{children}</h4>
    </div>
  );
}

function Kutu({ etiket, deger, alt }: { etiket: string; deger: React.ReactNode; alt?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-muted-foreground">{etiket}</p>
      <p className="text-xl font-bold">{deger}</p>
      {alt && <div className="mt-0.5">{alt}</div>}
    </div>
  );
}

export function DondurulmusRapor({ rapor }: { rapor: { data: any; periodStart: string; periodEnd: string } }) {
  const [detay, setDetay] = useState(false);
  const d = rapor.data ?? {};
  const meta = d.meta ?? {};
  const seo = d.seo ?? {};
  const geo: Bolum<any> = d.geo ?? { olculemedi: true, neden: 'Bu rapor GEO bölümü olmadan üretilmiş.' };
  const aso: Bolum<any> = d.aso ?? { olculemedi: true, neden: 'Bu rapor ASO bölümü olmadan üretilmiş.' };
  const asa: Bolum<any> = d.asa ?? { olculemedi: true, neden: 'Bu rapor ASA bölümü olmadan üretilmiş.' };
  const is = d.is ?? {};

  const tarihAralik = `${new Date(rapor.periodStart).toLocaleDateString('tr-TR')} – ${new Date(
    rapor.periodEnd,
  ).toLocaleDateString('tr-TR')}`;

  return (
    <div className="space-y-4 print:space-y-3" id="rapor-govdesi">
      {/* Yazdirma basligi — ekranda gizli, kagitta ilk satir */}
      <div className="hidden print:block border-b pb-2 mb-2">
        <h1 className="text-xl font-bold">{meta.siteAdi ?? 'Site'} — GEO/SEO/ASO Raporu</h1>
        <p className="text-xs text-muted-foreground">
          {meta.siteUrl} · {tarihAralik} · RanksUp
        </p>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-xs text-muted-foreground">{tarihAralik}</p>
        <button
          onClick={() => setDetay((v) => !v)}
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          {detay ? 'Özet görünüm' : 'Detaylı görünüm'}
        </button>
      </div>

      {/* ═══ SEO ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Search} renk="bg-blue-500/10 text-blue-600 dark:text-blue-400">
            Arama görünürlüğü (SEO)
          </Baslik>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kutu
              etiket="Tıklama"
              deger={sayi(seo.search?.totalClicks)}
              alt={
                seo.search?.oncekiDonemVeriVar === false ? (
                  /* Onceki donemde hic olcum yoksa fark gosterilmez: "+14.766"
                     sifirdan buyume gibi okunurdu, halbuki site o donemde
                     henuz olculmuyordu. */
                  <span className="text-[11px] text-muted-foreground">önceki dönemde ölçüm yok</span>
                ) : (
                  <Delta deger={seo.search?.clicksDelta ?? null} />
                )
              }
            />
            <Kutu
              etiket="Gösterim"
              deger={sayi(seo.search?.totalImpressions)}
              alt={
                seo.search?.oncekiDonemVeriVar === false ? (
                  <span className="text-[11px] text-muted-foreground">önceki dönemde ölçüm yok</span>
                ) : (
                  <Delta deger={seo.search?.impressionsDelta ?? null} />
                )
              }
            />
            <Kutu
              etiket="Ortalama pozisyon"
              deger={seo.search?.avgPosition ? seo.search.avgPosition.toFixed(1) : '—'}
            />
            <Kutu etiket="Site skoru" deger={seo.audit?.overallScore ?? '—'} />
          </div>

          {(seo.audit?.karsilastirma || detay) && (
            <div className="grid grid-cols-3 gap-4 mt-4 pt-3 border-t">
              <Kutu
                etiket="Çözülen sorun"
                deger={
                  seo.audit?.karsilastirma ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{seo.audit.cozulenSayisi}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <Kutu
                etiket="Yeni çıkan"
                deger={
                  seo.audit?.karsilastirma ? (
                    <span className="text-amber-600 dark:text-amber-400">{seo.audit.yeniCikanSayisi}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <Kutu etiket="Açık sorun" deger={sayi(seo.audit?.issuesCount)} />
            </div>
          )}

          {!seo.audit?.karsilastirma && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Sorun karşılaştırması için dönem içinde en az 2 tarama gerekli.
            </p>
          )}

          {detay && seo.search?.topQueries?.length > 0 && (
            <div className="mt-4 pt-3 border-t overflow-x-auto print:overflow-visible">
              <p className="text-xs font-semibold mb-2">En çok tıklanan sorgular (dönem geneli)</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Sorgu</th>
                    <th className="py-1 font-medium text-right">Tıklama</th>
                    <th className="py-1 font-medium text-right">Gösterim</th>
                    <th className="py-1 font-medium text-right">Pozisyon</th>
                  </tr>
                </thead>
                <tbody>
                  {seo.search.topQueries.slice(0, 10).map((q: any) => (
                    <tr key={q.query} className="border-t">
                      <td className="py-1 pr-2">{q.query}</td>
                      <td className="py-1 text-right">{sayi(q.clicks)}</td>
                      <td className="py-1 text-right">{sayi(q.impressions)}</td>
                      <td className="py-1 text-right">{q.position?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ GEO ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Sparkles} renk="bg-violet-500/10 text-violet-600 dark:text-violet-400">
            AI görünürlüğü (GEO)
          </Baslik>
          {geo.olculemedi ? (
            <VeriYok neden={geo.neden} />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kutu
                  etiket="AI görünürlük skoru"
                  deger={geo.sonSkor ?? '—'}
                  alt={<Delta deger={geo.delta} />}
                />
                <Kutu etiket="Kaynak gösterildi" deger={sayi(geo.alintilanan)} />
                <Kutu etiket="Marka anıldı" deger={sayi(geo.anilan)} />
                <Kutu
                  etiket="Teknik GEO skoru"
                  deger={geo.teknikGeoSkoru ?? '—'}
                  alt={<Delta deger={geo.teknikGeoDelta} />}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Dönem boyunca {geo.olcumGunu} farklı günde ölçüldü.
              </p>

              {detay && geo.saglayicilar?.length > 0 && (
                <div className="mt-4 pt-3 border-t overflow-x-auto print:overflow-visible">
                  <p className="text-xs font-semibold mb-2">Sağlayıcı kırılımı</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-medium">Sağlayıcı</th>
                        <th className="py-1 font-medium text-right">Dönem başı</th>
                        <th className="py-1 font-medium text-right">Dönem sonu</th>
                        <th className="py-1 font-medium text-right">Değişim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geo.saglayicilar.map((s: any) => (
                        <tr key={s.provider} className="border-t">
                          <td className="py-1 pr-2 capitalize">{s.provider}</td>
                          <td className="py-1 text-right">{s.ilk ?? '—'}</td>
                          <td className="py-1 text-right">{s.son ?? '—'}</td>
                          <td className="py-1 text-right"><Delta deger={s.delta} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detay && (
                <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t">
                  <Kutu etiket="AI bot ziyareti" deger={sayi(geo.aiBotZiyareti)} />
                  <Kutu etiket="AI'dan gelen ziyaretçi" deger={sayi(geo.aiReferrer)} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ ASO ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Smartphone} renk="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            Uygulama mağazası (ASO)
          </Baslik>
          {aso.olculemedi ? (
            <VeriYok neden={aso.neden} />
          ) : (
            <div className="space-y-4">
              {aso.uygulamalar.map((u: any) => (
                <div key={u.id}>
                  <p className="text-sm font-medium mb-2">
                    {u.ad} <span className="text-xs font-normal text-muted-foreground">· {u.store}</span>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Kutu
                      etiket="Ortalama sıra"
                      deger={u.sonOrtalamaSira ?? '—'}
                      /* Sirada KUCUK daha iyi — delta rengi ters yonde */
                      alt={<Delta deger={u.delta} tersYon />}
                    />
                    <Kutu etiket="İlk 10'da" deger={`${u.ilkOnda}/${u.kelimeSayisi}`} />
                    <Kutu
                      etiket="Yükselen kelime"
                      deger={<span className="text-emerald-600 dark:text-emerald-400">{u.yukselen}</span>}
                    />
                    <Kutu
                      etiket="Düşen kelime"
                      deger={<span className="text-red-600 dark:text-red-400">{u.dusen}</span>}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {u.kelimeSayisi} kelime izleniyor, {u.olcumGunu} günde ölçüldü.
                    {/* Ortalamanin KAC kelimeden geldigi yazilmazsa "ortalama sira 3"
                        ifadesi "uygulama 3. sirada" gibi okunur — halbuki izlenen
                        kelimelerin cogu ilk 100 disinda olabilir. */}
                    {u.karsilastirilabilirKelime !== undefined && (
                      <>
                        {' '}Ortalama sıra, ilk 100 içinde hem dönem başında hem sonunda ölçülebilen{' '}
                        <strong>{u.karsilastirilabilirKelime}</strong> kelimeden hesaplandı.
                      </>
                    )}
                    {u.ilkOrtalamaSira !== null && u.sonOrtalamaSira !== null && (
                      <> Dönem başı {u.ilkOrtalamaSira}. sıra → dönem sonu {u.sonOrtalamaSira}. sıra.</>
                    )}
                  </p>
                  {detay && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      İlk 100 dışında kalan kelimeler ortalamaya katılmaz — sıra uydurulmaz.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ ASA ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Megaphone} renk="bg-orange-500/10 text-orange-600 dark:text-orange-400">
            Apple Search Ads (ASA)
          </Baslik>
          {asa.olculemedi ? (
            <VeriYok neden={asa.neden} />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kutu etiket="Yükleme" deger={sayi(asa.yukleme)} />
                <Kutu etiket="Harcama" deger={`$${asa.harcamaUsd?.toFixed(2) ?? '—'}`} />
                <Kutu etiket="CPI" deger={asa.cpi !== null ? `$${asa.cpi.toFixed(2)}` : '—'} />
                <Kutu etiket="Kampanya" deger={sayi(asa.kampanya)} />
              </div>
              {detay && (
                <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t">
                  <Kutu etiket="Gösterim" deger={sayi(asa.gosterim)} />
                  <Kutu etiket="Dokunma" deger={sayi(asa.dokunma)} />
                </div>
              )}
              {asa.oncekiDonem && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Önceki dönem: {sayi(asa.oncekiDonem.yukleme)} yükleme, $
                  {asa.oncekiDonem.harcamaUsd.toFixed(2)} harcama
                  {asa.oncekiDonem.cpi !== null && <>, ${asa.oncekiDonem.cpi.toFixed(2)} CPI</>}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ YAPILAN IS ════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Wrench} renk="bg-slate-500/10 text-slate-600 dark:text-slate-400">
            Bu dönemde yapılan iş
          </Baslik>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kutu
              etiket="Yayınlanan makale"
              deger={sayi(is.yayinlananMakale)}
              alt={
                is.toplamKelime ? (
                  <span className="text-[11px] text-muted-foreground">{sayi(is.toplamKelime)} kelime</span>
                ) : null
              }
            />
            <Kutu etiket="Sosyal post" deger={sayi(is.sosyalPost)} />
            <Kutu etiket="Studio görseli" deger={sayi(is.studioVarligi)} />
            <Kutu etiket="Çalıştırılan tarama" deger={sayi(is.kullaniciTaramasi)} />
          </div>

          {detay && (
            <>
              <div className="mt-4 pt-3 border-t">
                {/* Maliyet kaydi site bazinda %96 oraninda atifsiz; kayit yoksa
                    $0.00 yazmak "hic para harcanmadi" gibi okunur ve yanlistir. */}
                <Kutu
                  etiket="AI maliyeti"
                  deger={is.aiMaliyetiUsd === null || is.aiMaliyetiUsd === undefined ? '—' : `$${is.aiMaliyetiUsd.toFixed(2)}`}
                  alt={
                    <span className="text-[11px] text-muted-foreground">
                      {is.aiMaliyetiUsd === null || is.aiMaliyetiUsd === undefined
                        ? 'Bu döneme ait, bu siteye atfedilmiş token kaydı yok'
                        : `${is.maliyetKayitSayisi ?? 0} kayıttan hesaplandı`}
                    </span>
                  }
                />
              </div>
              {is.maliyetKirilimi?.length > 0 && (
                <div className="mt-3 overflow-x-auto print:overflow-visible">
                  <p className="text-xs font-semibold mb-2">Maliyet kırılımı</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {is.maliyetKirilimi.map((m: any) => (
                        <tr key={m.is} className="border-t">
                          <td className="py-1">{m.is}</td>
                          <td className="py-1 text-right">${m.usd.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/*
            Bilerek YAZILMAYANLAR: uygulanan meta/schema duzeltmeleri, auto-fix
            adedi, ASO metadata onerileri, App Store yorum cevaplari. Bu isler
            calisiyor ama hicbiri kalici DB kaydi acmiyor; sayilari uydurulmus
            olurdu. Kayit eklenirse bu bolume girerler.
          */}
          <p className="text-[11px] text-muted-foreground mt-3 pt-2 border-t">
            Yalnızca kalıcı kaydı olan işler sayılır.
          </p>
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center print:mt-4">
        Bu rapor {meta.uretildi ? new Date(meta.uretildi).toLocaleString('tr-TR') : ''} tarihinde üretildi ve o andaki
        verilerle dondurulmuştur. RanksUp
      </p>
    </div>
  );
}
