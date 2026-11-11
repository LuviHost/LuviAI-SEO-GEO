'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowDown, ArrowUp, Minus, Search, Sparkles, Smartphone, Megaphone, Wrench } from 'lucide-react';
import { geoAccessOf, geoSampleNote, type GeoAccessBlock, type GeoSample, type ReportAuditGeo } from '@/lib/api';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import { crawlAccessTitle, currentCrawlAccess } from '@/lib/crawl-access';

/**
 * Rapor govdesindeki GEO engel / orneklem: canli raporun `audit`'i, dondurulmus raporun
 * `seo.audit`'i (reports.service.ts geoBlocked / geoSample — raporun kendi son taramasindan).
 * Alanlar HIC yoksa (eski API ya da alanlar eklenmeden once dondurulmus rapor) undefined:
 * canli panel son taramaya duser, dondurulmus rapor not gostermez. Sekil checks.geo ile
 * ayni oldugu icin dogrulama geoAccessOf'tan gecer (site-report-panel.tsx de kullanir).
 */
export function reportGeoAccess(
  audit: ReportAuditGeo | null | undefined,
): { blocked: GeoAccessBlock | null; sample: GeoSample | null } | undefined {
  if (!audit || (audit.geoBlocked === undefined && audit.geoSample === undefined)) return undefined;
  return geoAccessOf({ checks: { geo: { blocked: audit.geoBlocked, sample: audit.geoSample } } });
}

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
      className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        iyi ? 'text-success' : 'text-danger'
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
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground/70 mb-1">Ölçüm yok</p>
      <p className="text-xs leading-relaxed">{neden}</p>
    </div>
  );
}

// Bolum basligi: notr ikon karosu (ui/section-header ile ayni dil). Eskiden her bolum kendi
// sus rengini tasiyordu (mavi / mor / yesil / turuncu).
function Baslik({ ikon: Ikon, children }: { ikon: any; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
        <Ikon className="h-4 w-4" aria-hidden />
      </div>
      <h4 className="text-panel-3">{children}</h4>
    </div>
  );
}

function Kutu({ etiket, deger, alt }: { etiket: string; deger: React.ReactNode; alt?: React.ReactNode }) {
  return (
    <div>
      <p className="v-rail">{etiket}</p>
      <p className="mt-1 text-metric tabular-nums">{deger}</p>
      {alt && <div className="mt-1">{alt}</div>}
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

  // Teknik GEO skoru icin engel / orneklem notu. seo.audit rapor anindaki SON tarama;
  // teknikGeoSkoru ise donemdeki son SKORLU tarama. Son tarama engele takildiysa (skor yok)
  // nedeni yazilir; orneklem notu yalniz iki skor ayniysa (ayni tarama) eklenir — yoksa
  // not baska bir taramayi anlatirdi.
  const geoErisim = reportGeoAccess(seo.audit);
  const sonTaramaSkoru: number | null = seo.audit?.geoScore ?? null;
  const teknikEngel = sonTaramaSkoru === null ? geoErisim?.blocked ?? null : null;
  const teknikNot = !geo.olculemedi && geo.teknikGeoSkoru != null && geo.teknikGeoSkoru === sonTaramaSkoru
    ? geoSampleNote(geoErisim?.sample)
    : null;
  const silinenKampanya = !asa.olculemedi && typeof asa.silinenKampanya === 'number' ? asa.silinenKampanya : 0;
  // Rapor anında son tarama denemesi siteye erişemediyse skor dondurulmadı (null); eski değer yalnız
  // tarihiyle (reports.service.ts sonBasarili). Bu alanlardan önce dondurulmuş raporda yok.
  const erisim = currentCrawlAccess(seo.audit?.accessBlocked, null);
  const sonBasarili = erisim ? seo.audit?.sonBasarili ?? null : null;
  const olculemeyenSayisi: number = typeof seo.audit?.olculemeyenSayisi === 'number' ? seo.audit.olculemeyenSayisi : 0;

  return (
    <div className="space-y-4 print:space-y-3" id="rapor-govdesi">
      {/* Yazdirma basligi — ekranda gizli, kagitta ilk satir */}
      <div className="hidden print:block border-b pb-2 mb-2">
        <h1 className="text-xl font-[450] tracking-[-0.04em]">{meta.siteAdi ?? 'Site'} — GEO/SEO/ASO Raporu</h1>
        <p className="text-xs text-muted-foreground">
          {meta.siteUrl} · {tarihAralik} · RanksUp
        </p>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <p className="v-rail">{tarihAralik}</p>
        <button
          onClick={() => setDetay((v) => !v)}
          className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          {detay ? 'Özet görünüm' : 'Detaylı görünüm'}
        </button>
      </div>

      {/* ═══ SEO ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Search}>
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
                  <span className="text-xs text-muted-foreground">önceki dönemde ölçüm yok</span>
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
                  <span className="text-xs text-muted-foreground">önceki dönemde ölçüm yok</span>
                ) : (
                  <Delta deger={seo.search?.impressionsDelta ?? null} />
                )
              }
            />
            <Kutu
              etiket="Ortalama pozisyon"
              deger={seo.search?.avgPosition ? seo.search.avgPosition.toFixed(1) : '—'}
            />
            {erisim ? (
              <Kutu
                etiket="Site skoru"
                deger={<span className="text-sm font-medium text-warning">Ölçülemedi</span>}
                alt={
                  <span className="text-xs text-muted-foreground">
                    {sonBasarili?.ranAt
                      ? `Son başarılı tarama (${new Date(sonBasarili.ranAt).toLocaleDateString('tr-TR')}): ${sonBasarili.overallScore}/100`
                      : 'Puanlanmış tarama yok'}
                  </span>
                }
              />
            ) : (
              <Kutu etiket="Site skoru" deger={seo.audit?.overallScore ?? '—'} />
            )}
          </div>

          {erisim && (
            <p className="text-xs text-muted-foreground mt-2">
              {crawlAccessTitle(erisim)}: {erisim.reason} {erisim.hint}{' '}
              {erisim.state === 'blocked'
                ? 'Tarayıcı siteyi okuyamadığı için site skoru hesaplanmadı'
                : 'Tarayıcı siteye ulaşamadığı için site skoru hesaplanmadı'}
              {Number.isFinite(new Date(erisim.at).getTime()) ? ` (son deneme: ${new Date(erisim.at).toLocaleDateString('tr-TR')}).` : '.'}
            </p>
          )}

          {(seo.audit?.karsilastirma || detay) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-3 border-t">
              <Kutu
                etiket="Çözülen sorun"
                deger={
                  seo.audit?.karsilastirma ? (
                    <span className="text-success">{seo.audit.cozulenSayisi}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <Kutu
                etiket="Yeni çıkan"
                deger={
                  seo.audit?.karsilastirma ? (
                    <span className="text-warning">{seo.audit.yeniCikanSayisi}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <Kutu etiket="Açık sorun" deger={sayi(seo.audit?.issuesCount)} />
              {/* Son taramada yeniden ölçülemeyen eski sorunlar — "Çözülen"e girmez */}
              {seo.audit?.karsilastirma && olculemeyenSayisi > 0 && (
                <Kutu
                  etiket="Ölçülemedi"
                  deger={<span className="text-muted-foreground">{olculemeyenSayisi}</span>}
                  alt={<span className="text-xs text-muted-foreground">çözülmüş sayılmadı</span>}
                />
              )}
            </div>
          )}

          {!seo.audit?.karsilastirma && (
            <p className="text-xs text-muted-foreground mt-2">
              Sorun karşılaştırması için dönem içinde en az 2 tarama gerekli.
            </p>
          )}

          {detay && seo.search?.topQueries?.length > 0 && (
            <div className="mt-4 pt-3 border-t overflow-x-auto print:overflow-visible">
              <p className="mb-2 text-sm font-medium">En çok tıklanan sorgular (dönem geneli)</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left font-mono text-vitrin-rail text-muted-foreground">
                    <th className="py-1.5 font-normal">Sorgu</th>
                    <th className="py-1.5 font-normal text-right">Tıklama</th>
                    <th className="py-1.5 font-normal text-right">Gösterim</th>
                    <th className="py-1.5 font-normal text-right">Pozisyon</th>
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
          <Baslik ikon={Sparkles}>
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
                  alt={geo.karsilastirma === 'scope_changed' || geo.karsilastirma === 'method_changed'
                    ? <span className="text-xs text-muted-foreground">{geo.karsilastirma === 'scope_changed' ? 'ölçülen sorular değişti — kıyas yok' : 'ölçüm yöntemi güncellendi — kıyas yok'}</span>
                    : <Delta deger={geo.delta} />}
                />
                <Kutu etiket="Kaynak gösterildi" deger={sayi(geo.alintilanan)} />
                <Kutu etiket="Marka anıldı" deger={sayi(geo.anilan)} />
                <Kutu
                  etiket="Teknik GEO skoru"
                  deger={
                    geo.teknikGeoSkoru == null && teknikEngel
                      ? <span className="text-sm font-medium text-warning">Ölçülemedi</span>
                      : geo.teknikGeoSkoru ?? '—'
                  }
                  alt={
                    geo.teknikGeoSkoru == null && teknikEngel
                      ? undefined
                      : geo.teknikKarsilastirma === 'method_changed'
                        // GEO ölçüm yöntemi dönem içinde güncellendi (site-report.service.ts)
                        ? <span className="text-xs text-muted-foreground">ölçüm yöntemi güncellendi — kıyas yok</span>
                        : <Delta deger={geo.teknikGeoDelta} />
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Dönem boyunca {geo.olcumGunu} farklı günde ölçüldü.
              </p>
              {/* Teknik GEO skorunun dayanagi: engel nedeni (ve cozumu) ya da kismi orneklem notu */}
              {teknikEngel && (
                <p className="text-xs text-muted-foreground mt-1">
                  {geo.teknikGeoSkoru == null ? 'Teknik GEO skoru ölçülemedi: ' : 'Son taramada teknik GEO skoru ölçülemedi: '}
                  {teknikEngel.reason} {teknikEngel.hint}
                </p>
              )}
              {teknikNot && <p className="text-xs text-muted-foreground mt-1">Teknik GEO skoru: {teknikNot}</p>}

              {detay && geo.saglayicilar?.length > 0 && (
                <div className="mt-4 pt-3 border-t overflow-x-auto print:overflow-visible">
                  <p className="mb-2 text-sm font-medium">Sağlayıcı kırılımı</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left font-mono text-vitrin-rail text-muted-foreground">
                        <th className="py-1.5 font-normal">Sağlayıcı</th>
                        <th className="py-1.5 font-normal text-right">Dönem başı</th>
                        <th className="py-1.5 font-normal text-right">Dönem sonu</th>
                        <th className="py-1.5 font-normal text-right">Değişim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geo.saglayicilar.map((s: any) => (
                        <tr key={s.provider} className="border-t">
                          {/* Ham kimlik (openai, xai) yerine urun adi: ChatGPT, Grok */}
                          <td className="py-1 pr-2">{PROVIDER_LABELS[s.provider] ?? s.provider}</td>
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
                  {/* 24.10.2026 oncesi dondurulan raporlar hits toplami degil satir sayisi
                      (gun × bot / kaynak) tasir; damga yoksa notr etiket (site-report.service AI_SAYIM_YONTEMI). */}
                  {/* 02.11.2026'dan sonra dondurulan raporlar IP ile dogrulanmis bot ziyaretini ayri tasir
                      (site-report.service AI_BOT_DOGRULAMA_YONTEMI); oncekilerde sayi taklit UA'lari da icerir. */}
                  {geo.aiBotDogrulamaYontemi === 'ip_dogrulama_v1' ? (
                    <>
                      <Kutu etiket="Doğrulanmış AI bot ziyareti" deger={sayi(geo.aiBotDogrulanmis)} />
                      <Kutu etiket="AI'dan gelen ziyaret (referer veya utm etiketi)" deger={sayi(geo.aiReferrer)} />
                      <Kutu etiket="Taklit olabilecek bot isteği (IP doğrulanamadı)" deger={sayi(geo.aiBotDogrulanamayan)} />
                    </>
                  ) : geo.aiSayimYontemi === 'hits_toplami' ? (
                    <>
                      <Kutu etiket="AI bot isteği (IP doğrulaması öncesi)" deger={sayi(geo.aiBotZiyareti)} />
                      <Kutu etiket="AI'dan gelen ziyaret (referer veya utm etiketi)" deger={sayi(geo.aiReferrer)} />
                    </>
                  ) : (
                    <>
                      <Kutu etiket="AI bot kaydı (gün × bot)" deger={sayi(geo.aiBotZiyareti)} />
                      <Kutu etiket="AI yönlendirme kaydı (gün × kaynak)" deger={sayi(geo.aiReferrer)} />
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ ASO ═══════════════════════════════════════════════ */}
      <Card>
        <CardContent className="p-4">
          <Baslik ikon={Smartphone}>
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
                      deger={<span className="text-success">{u.yukselen}</span>}
                    />
                    <Kutu
                      etiket="Düşen kelime"
                      deger={<span className="text-danger">{u.dusen}</span>}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {u.kelimeSayisi} kelime izleniyor, {u.olcumGunu} günde ölçüldü.
                    {/* Ortalamanin KAC kelimeden geldigi yazilmazsa "ortalama sira 3"
                        ifadesi "uygulama 3. sirada" gibi okunur — halbuki izlenen
                        kelimelerin cogu olculen derinligin disinda olabilir. */}
                    {u.karsilastirilabilirKelime !== undefined && (
                      <>
                        {' '}Ortalama sıra, hem dönem başında hem sonunda ölçülebilen{' '}
                        <strong>{u.karsilastirilabilirKelime}</strong> kelimeden hesaplandı.
                      </>
                    )}
                    {u.ilkOrtalamaSira !== null && u.sonOrtalamaSira !== null && (
                      <> Dönem başı {u.ilkOrtalamaSira}. sıra → dönem sonu {u.sonOrtalamaSira}. sıra.</>
                    )}
                  </p>
                  {/*
                    ÖLÇÜLEN DERİNLİK YAZILMAK ZORUNDA. Kod her sorguda 100 sonuç
                    istiyor ama mağazalar farklı davranıyor: App Store istenen
                    kadar dönüyor, Play num ne olursa olsun ~25-30'da tavan
                    yapıyor (üretimde ölçüldü). "İlk 100 dışı" demek Android'de
                    yanlış olurdu — 26. sıra ile 500. sırayı ayırt edemiyoruz.
                  */}
                  {u.olculenDerinlik != null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Mağaza araması ilk <strong>{u.olculenDerinlik}</strong> sonucu gösteriyor; bu
                      derinliğin dışında kalan kelimeler ortalamaya katılmaz — sıra uydurulmaz.
                      {u.olculenDerinlik < 50 && ' Play Store arama derinliği sınırlı olduğu için Android ölçümü iOS\'a göre daha sığdır.'}
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
          <Baslik ikon={Megaphone}>
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
              {/* Apple'da silinen kampanyanin donem harcamasi toplamlara GIRER, kampanya sayisina
                  girmez (site-report.service.ts asaBolumu) — yazilmazsa harcama/sayi uyusmaz gorunur */}
              {silinenKampanya > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {silinenKampanya} silinmiş kampanyanın bu dönemdeki harcaması ve sonuçları toplamlara dahil; kampanya sayısına dahil değil.
                </p>
              )}
              {detay && (
                <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t">
                  <Kutu etiket="Gösterim" deger={sayi(asa.gosterim)} />
                  <Kutu etiket="Dokunma" deger={sayi(asa.dokunma)} />
                </div>
              )}
              {asa.oncekiDonem && (
                <p className="text-xs text-muted-foreground mt-2">
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
          <Baslik ikon={Wrench}>
            Bu dönemde yapılan iş
          </Baslik>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kutu
              etiket="Yayınlanan makale"
              deger={sayi(is.yayinlananMakale)}
              alt={
                is.toplamKelime ? (
                  <span className="text-xs text-muted-foreground">{sayi(is.toplamKelime)} kelime</span>
                ) : null
              }
            />
            {/* Sosyal paylasim ve Studio modulleri kaldirildi (SocialPost / StudioAsset artik
                yazilmiyor): yeni donemlerde hep 0 ve "is yapilmadi" diye okunuyordu. Yalniz
                moduller varken dondurulmus eski raporlarda deger varsa gosterilir. */}
            {Number(is.sosyalPost) > 0 && <Kutu etiket="Sosyal post" deger={sayi(is.sosyalPost)} />}
            {Number(is.studioVarligi) > 0 && <Kutu etiket="Studio görseli" deger={sayi(is.studioVarligi)} />}
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
                    <span className="text-xs text-muted-foreground">
                      {is.aiMaliyetiUsd === null || is.aiMaliyetiUsd === undefined
                        ? 'Bu döneme ait, bu siteye atfedilmiş token kaydı yok'
                        : `${is.maliyetKayitSayisi ?? 0} kayıttan hesaplandı`}
                    </span>
                  }
                />
              </div>
              {is.maliyetKirilimi?.length > 0 && (
                <div className="mt-3 overflow-x-auto print:overflow-visible">
                  <p className="mb-2 text-sm font-medium">Maliyet kırılımı</p>
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
            Uygulanan duzeltmeler artik SAYILABILIYOR — AppliedFix kaydi
            eklendi. Oncesinde snippet-applier / static-html-fixer / auto-fix
            siteye gercek degisiklik yaziyor ama iz birakmiyordu.
            null = kayit katmanindan ONCEKI donemler; "0" yazmak yanlis olurdu.
          */}
          {is.uygulananDuzeltme && (
            <div className="mt-4 pt-3 border-t">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Kutu
                  etiket="Uygulanan düzeltme"
                  deger={<span className="text-success">{sayi(is.uygulananDuzeltme.toplam)}</span>}
                />
                <Kutu etiket="Etkilenen sayfa" deger={sayi(is.uygulananDuzeltme.etkilenenSayfa)} />
                {is.uygulananDuzeltme.basarisiz > 0 && (
                  <Kutu
                    etiket="Başarısız deneme"
                    deger={<span className="text-warning">{sayi(is.uygulananDuzeltme.basarisiz)}</span>}
                  />
                )}
              </div>
              {detay && is.uygulananDuzeltme.turBazinda?.length > 0 && (
                <div className="mt-3 overflow-x-auto print:overflow-visible">
                  <table className="w-full text-xs">
                    <tbody>
                      {is.uygulananDuzeltme.turBazinda.map((t: any) => (
                        <tr key={t.tur} className="border-t">
                          <td className="py-1">{t.tur}</td>
                          <td className="py-1 text-right">{t.adet}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t">
            Yalnızca kalıcı kaydı olan işler sayılır.
            {!is.uygulananDuzeltme && ' Bu dönemde uygulanmış düzeltme kaydı yok.'}
          </p>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground print:mt-4">
        Bu rapor {meta.uretildi ? new Date(meta.uretildi).toLocaleString('tr-TR') : ''} tarihinde üretildi ve o andaki
        verilerle dondurulmuştur. RanksUp
      </p>
    </div>
  );
}
