import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, OctagonAlert } from 'lucide-react';
import { BrandWordmark } from '@/components/brand-logo';
import { EngineLogo } from '@/components/engine-logo';
import { SiteFavicon } from '@/components/site-favicon';
import { CHART, PROVIDER_COLORS, PROVIDER_FALLBACK, PROVIDER_LABELS } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';
import {
  AI_SONUC_ETIKETI, DURUM_ETIKETI, EFOR_ETIKETI, ETKI_ETIKETI, ONEM_ETIKETI,
  kalanOrnek, kpiMetni, raporBolumleri, skorTonu, skorTuruMetni, trSayi, trTarih,
  type AiSonuc, type KontrolDurumu, type MusteriRaporu, type Olculemedi, type Onem, type RaporBolumu,
} from '@/lib/musteri-raporu';

/**
 * Musteri raporu BELGESI — panel, herkese acik paylasim sayfasi ve PDF
 * (window.print) ayni bileseni cizer.
 *
 * NEDEN durumsuz: ayni bilesen react-dom/server ile statik HTML'e de
 * basilabilsin (gorsel kontrol ve PDF onizlemesi). Etkilesim (paylasim,
 * yazdir) disaridaki istemci bilesenlerinde; tek istemci parcasi panelin
 * SiteFavicon'u (favicon yuklenemezse bas harfler).
 *
 * Kagit: `.rapor-kagit` acik tema token'larini yeniden tanimlar (globals.css) —
 * koyu temali panelde de belge beyaz kagit gibi gorunur ve oyle basilir.
 * Kapak ve ozet kagitta kendi sayfalarinda; sonraki bolumler kaldigi
 * sayfada devam eder (raporBolumleri.yeniSayfa, globals.css baski kurallari).
 * Grafikler yalniz veri varsa cizilir; renkler chart-colors token'larindan.
 * Rozetler ui/badge DEGIL yerel `Rozet`: badge'in secondary/outline
 * varyantlari `dark:` sinifi tasiyor ve koyu temada `.rapor-kagit` icinde
 * acik kagida koyu rozet basiyordu.
 */
export function RaporBelgesi({
  rapor,
  paylasimSonu,
  className,
  kimlikOneki = 'rapor',
}: {
  rapor: MusteriRaporu;
  /** Baslik kimlik oneki — ekran ve baski kopyasi ayni sayfada; kimlikler cakismasin */
  kimlikOneki?: string;
  /** Herkese acik baglantidan aciliyorsa baglantinin son gecerlilik tarihi */
  paylasimSonu?: string | null;
  className?: string;
}) {
  const bolumler = raporBolumleri(rapor);
  const no = (id: RaporBolumu['id']) => bolumler.filter((b) => b.id !== 'kapak').findIndex((b) => b.id === id) + 1;
  return (
    <article lang="tr" className={cn('rapor-kagit text-foreground', className)} aria-label={`${rapor.site.ad} site raporu`}>
      {bolumler.map((b) => (
        <section
          key={b.id}
          aria-labelledby={b.id === 'kapak' ? undefined : `${kimlikOneki}-${b.id}`}
          className={cn('rapor-bolum', b.yeniSayfa && 'rapor-yeni-sayfa', !b.yeniSayfa && b.id !== 'kapak' && 'rapor-devam', b.id === 'kapak' && 'rapor-kapak')}
        >
          {b.id === 'kapak' ? (
            <Kapak rapor={rapor} paylasimSonu={paylasimSonu ?? null} />
          ) : (
            <>
              <BolumBasligi id={`${kimlikOneki}-${b.id}`} no={no(b.id)} baslik={b.baslik} veriTarihi={b.veriTarihi} />
              {b.id === 'ozet' && <Ozet rapor={rapor} />}
              {b.id === 'seo' && <SeoBolumu rapor={rapor} />}
              {b.id === 'geo' && <GeoBolumu rapor={rapor} />}
              {b.id === 'ai' && <AiBolumu rapor={rapor} />}
              {b.id === 'aksiyon' && <AksiyonBolumu rapor={rapor} />}
              {b.id === 'yontem' && <YontemBolumu rapor={rapor} paylasimSonu={paylasimSonu ?? null} />}
            </>
          )}
        </section>
      ))}
    </article>
  );
}

// ─── Ortak parcalar ─────────────────────────────────────────────────

const ROZET_TONU = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  brand: 'bg-brand/10 text-brand',
  notr: 'bg-muted text-muted-foreground',
  cerceve: 'border border-border text-muted-foreground',
} as const;
type RozetTonu = keyof typeof ROZET_TONU;

/** Yalniz token renkleri — koyu tema sinifi tasimaz (kagit her zaman acik) */
function Rozet({ ton, children, className }: { ton: RozetTonu; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-px text-label font-semibold', ROZET_TONU[ton], className)}>
      {children}
    </span>
  );
}

function BolumBasligi({ id, no, baslik, veriTarihi }: { id: string; no: number; baslik: string; veriTarihi: string | null }) {
  return (
    <div className="rapor-bolum-baslik mb-5 flex items-end justify-between gap-4 border-b border-border pb-3">
      <h2 id={id} className="font-brand text-h6 font-semibold tracking-tight">
        <span className="mr-2 tabular-nums text-brand">{String(no).padStart(2, '0')}</span>
        {baslik}
      </h2>
      {veriTarihi && <p className="shrink-0 text-label text-muted-foreground">Veri: {trTarih(veriTarihi)}</p>}
    </div>
  );
}

function AltBaslik({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold first:mt-0">{children}</h3>;
}

/** Olculmeyen alan: neden ile — sifir gibi gorunmez */
function OlculmediKutusu({ olcum, baslik }: { olcum: Olculemedi; baslik?: string }) {
  return (
    <div className="rapor-blok flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-sm">
      <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-medium">{baslik ? `${baslik}: ` : ''}Henüz ölçülmedi.</span>{' '}
        <span className="text-muted-foreground">{olcum.neden.replace(/^Henüz ölçülmedi\.?\s*/, '')}</span>
      </p>
    </div>
  );
}

const TON_SINIFI = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
} as const;

const TON_RENGI = {
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  danger: 'hsl(var(--danger))',
  muted: 'hsl(var(--muted-foreground))',
} as const;

/** 0-100 yatay cubuk — yazdirmada arka plan rengi korunur (print-color-adjust) */
function Cubuk({ deger, renk, etiket }: { deger: number; renk: string; etiket: string }) {
  const w = Math.max(0, Math.min(100, deger));
  return (
    <div className="rapor-cubuk h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={etiket}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: renk }} />
    </div>
  );
}

function Kutu({ etiket, deger, sonek, ipucu, ton = 'muted', kucuk = false }: {
  etiket: string; deger: string; sonek?: string | null; ipucu?: string; ton?: keyof typeof TON_SINIFI;
  /** Tarih gibi uzun deger: tek satira sigsin */
  kucuk?: boolean;
}) {
  return (
    <div className="rapor-blok rounded-lg border border-border p-3.5">
      <p className="text-label text-muted-foreground">{etiket}</p>
      <p className={cn('mt-1.5 font-brand tabular-nums', kucuk ? 'text-metric' : 'text-metric-lg')}>
        <span className={deger === '—' ? 'text-muted-foreground' : TON_SINIFI[ton] === 'text-muted-foreground' ? '' : TON_SINIFI[ton]}>{deger}</span>
        {sonek && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{sonek}</span>}
      </p>
      {ipucu && <p className="mt-1 text-label text-muted-foreground">{ipucu}</p>}
    </div>
  );
}

const DURUM_ROZETI: Record<KontrolDurumu, RozetTonu> = {
  gecti: 'success',
  kritik: 'danger',
  uyari: 'warning',
  dogrulanamadi: 'notr',
};

const ONEM_ROZETI: Record<Onem, RozetTonu> = { kritik: 'danger', uyari: 'warning', bilgi: 'info' };

function DurumIkonu({ durum }: { durum: KontrolDurumu }) {
  if (durum === 'gecti') return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (durum === 'kritik') return <OctagonAlert className="h-4 w-4 text-danger" aria-hidden />;
  if (durum === 'uyari') return <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />;
  return <Info className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

// ─── Kapak ──────────────────────────────────────────────────────────

function Kapak({ rapor, paylasimSonu }: { rapor: MusteriRaporu; paylasimSonu: string | null }) {
  return (
    <div className="flex min-h-[34rem] flex-col justify-between gap-10 py-6 print:min-h-[247mm] print:py-0">
      <div className="flex items-center justify-between gap-4">
        <BrandWordmark size={20} />
        <p className="text-label text-muted-foreground">RanksUp ile hazırlandı</p>
      </div>

      <div>
        <div className="flex items-center gap-4">
          {/* Panelle ayni favicon bileseni: yuklenemezse bas harfler (onError) — kirik gorsel basilmaz */}
          <SiteFavicon url={rapor.site.url} name={rapor.site.ad} size="lg" className="h-16 w-16" />
          <div className="min-w-0">
            <p className="font-brand text-h4 font-semibold leading-tight tracking-tight">{rapor.site.ad}</p>
            <p className="mt-1 break-all text-sm text-muted-foreground">{rapor.site.url}</p>
          </div>
        </div>
        <h1 className="mt-10 font-brand text-h3 font-semibold tracking-tight">Site Raporu</h1>
        <p className="mt-2 text-body text-muted-foreground">SEO · GEO · AI görünürlük</p>
        <p className="mt-6 text-sm">
          Rapor tarihi: <span className="font-semibold">{trTarih(rapor.generatedAt)}</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-label text-muted-foreground">Site taraması</dt>
          <dd>{rapor.kaynaklar.tarama ? trTarih(rapor.kaynaklar.tarama) : 'Henüz yapılmadı'}</dd>
        </div>
        <div>
          <dt className="text-label text-muted-foreground">AI görünürlük ölçümü</dt>
          <dd>{rapor.kaynaklar.aiOlcum ? trTarih(rapor.kaynaklar.aiOlcum) : 'Henüz ölçülmedi'}</dd>
        </div>
        {paylasimSonu && (
          <div>
            <dt className="text-label text-muted-foreground">Bağlantı geçerliliği</dt>
            <dd>{trTarih(paylasimSonu)} tarihine kadar</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ─── Yonetici ozeti ─────────────────────────────────────────────────

const KPI_TONU = (anahtar: string, deger: number | null): keyof typeof TON_SINIFI =>
  anahtar === 'siteSkoru' || anahtar === 'aiGorunurluk' ? skorTonu(deger) : 'muted';

function Ozet({ rapor }: { rapor: MusteriRaporu }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
        {rapor.ozet.kpiler.map((k) => {
          const m = kpiMetni(k);
          return <Kutu key={k.anahtar} etiket={k.etiket} deger={m.deger} sonek={m.sonek} ipucu={k.ipucu} ton={KPI_TONU(k.anahtar, k.deger)} />;
        })}
      </div>
      <div className="rapor-blok rounded-md bg-muted/50 p-4">
        <p className="mb-2 text-label font-semibold uppercase tracking-wide text-muted-foreground">Özet</p>
        <div className="space-y-2 text-sm leading-relaxed">
          {rapor.ozet.metin.map((c) => <p key={c}>{c}</p>)}
        </div>
      </div>
    </div>
  );
}

// ─── SEO ────────────────────────────────────────────────────────────

const DURUM_RENGI: Record<KontrolDurumu, string> = {
  gecti: 'hsl(var(--success))',
  kritik: 'hsl(var(--danger))',
  uyari: 'hsl(var(--warning))',
  dogrulanamadi: 'hsl(var(--muted-foreground) / 0.4)',
};

function SeoBolumu({ rapor }: { rapor: MusteriRaporu }) {
  const seo = rapor.seo;
  if (seo.olculemedi) return <OlculmediKutusu olcum={seo} baslik="Site taraması" />;
  const sorunlu = seo.kontroller.filter((k) => k.durum !== 'gecti');
  const gecen = seo.kontroller.filter((k) => k.durum === 'gecti');
  const ton = skorTonu(seo.siteSkoru);
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,14rem)_1fr] print:grid-cols-[14rem_1fr]">
        <Kutu
          etiket="Site skoru"
          deger={seo.siteSkoru === null ? '—' : String(seo.siteSkoru)}
          sonek={seo.siteSkoru === null ? null : '/100'}
          ipucu={`${seo.bulgu.toplam} bulgu · ${seo.bulgu.kritik} kritik`}
          ton={ton}
        />
        <div className="rapor-blok rounded-lg border border-border p-3.5">
          <p className="text-label text-muted-foreground">{seo.sayac.toplam} kontrol noktası</p>
          {/* Grafik: kontrollerin durum dagilimi — her kare bir kontrol */}
          <div className="mt-2.5 flex gap-1" role="img" aria-label={`${seo.sayac.gecti} geçti, ${seo.sayac.kritik} kritik, ${seo.sayac.uyari} uyarı`}>
            {seo.kontroller.map((k) => (
              <span key={k.id} className="rapor-cubuk h-3 flex-1 rounded-sm" style={{ background: DURUM_RENGI[k.durum] }} title={k.ad} />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-label">
            <span><span className="font-semibold text-success">{seo.sayac.gecti}</span> geçti</span>
            <span><span className="font-semibold text-danger">{seo.sayac.kritik}</span> kritik</span>
            <span><span className="font-semibold text-warning">{seo.sayac.uyari}</span> uyarı</span>
            {seo.sayac.dogrulanamadi > 0 && <span><span className="font-semibold">{seo.sayac.dogrulanamadi}</span> doğrulanamadı</span>}
          </div>
        </div>
      </div>

      {seo.guncelDegil && (
        <p className="rapor-blok mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span><span className="font-medium">Skor güncel değil. </span>{seo.guncelDegil}</span>
        </p>
      )}

      <AltBaslik>Sorunlu kontroller</AltBaslik>
      {sorunlu.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tüm kontroller geçti.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {sorunlu.map((k) => (
            <li key={k.id} className="rapor-blok p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <DurumIkonu durum={k.durum} />
                  <span className="text-sm font-semibold">{k.ad}</span>
                  <Rozet ton={DURUM_ROZETI[k.durum]}>{DURUM_ETIKETI[k.durum]}</Rozet>
                  {k.otomatik && <Rozet ton="brand">RanksUp düzeltebilir</Rozet>}
                </div>
                <span className={cn('shrink-0 text-sm font-semibold tabular-nums', TON_SINIFI[skorTonu(k.skor)])}>
                  {k.skor === null ? '—' : `${k.skor}/100`}
                </span>
              </div>
              {k.bulgu && <p className="mt-1.5 text-sm leading-relaxed">{k.bulgu}</p>}
              <dl className="mt-2 grid gap-1.5 text-sm leading-relaxed sm:grid-cols-2 print:grid-cols-2">
                <div>
                  <dt className="text-label font-semibold text-muted-foreground">Neden önemli</dt>
                  <dd>{k.neden}</dd>
                </div>
                <div>
                  <dt className="text-label font-semibold text-muted-foreground">Önerilen düzeltme</dt>
                  <dd>{k.oneri}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {gecen.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-success">Geçen kontroller: </span>
          {gecen.map((k) => k.ad).join(', ')}.
        </p>
      )}

      <AltBaslik>Sayfa düzeyindeki sorunlar</AltBaslik>
      {seo.sayfaSorunlari.length === 0 ? (
        <p className="text-sm text-muted-foreground">Taramada sayfa düzeyinde sorun bulunmadı.</p>
      ) : (
        <div className="space-y-3">
          {seo.sayfaSorunlari.map((s) => {
            const kalan = kalanOrnek(s);
            return (
              <div key={s.tur} className="rapor-blok rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{s.baslik}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Rozet ton={ONEM_ROZETI[s.onem]}>{ONEM_ETIKETI[s.onem]}</Rozet>
                    <span className="text-sm font-semibold tabular-nums">{s.sayi === null ? '—' : `${trSayi(s.sayi)} ${s.birim}`}</span>
                  </div>
                </div>
                {s.ornekler.length > 0 && (
                  <ul className="mt-2 space-y-0.5 font-mono text-label text-muted-foreground">
                    {s.ornekler.map((u) => <li key={u} className="break-all">{u}</li>)}
                    {kalan > 0 && <li className="font-sans italic">ve {trSayi(kalan)} sayfa daha</li>}
                  </ul>
                )}
                {s.ornekNotu && <p className="mt-1.5 text-label text-muted-foreground">{s.ornekNotu}</p>}
              </div>
            );
          })}
        </div>
      )}

      <AltBaslik>Görsel alt metni</AltBaslik>
      {seo.gorseller.olculemedi ? (
        <OlculmediKutusu olcum={seo.gorseller} />
      ) : (
        <div className="rapor-blok">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
            <Kutu etiket="İçerik görseli" deger={trSayi(seo.gorseller.icerikGorseli)} ipucu={`${seo.gorseller.sayfaSayisi} sayfada`} />
            <Kutu etiket="Alt metni yok" deger={trSayi(seo.gorseller.altMetniYok)} ton={seo.gorseller.altMetniYok > 0 ? 'warning' : 'success'} />
            <Kutu etiket="Alt metni var" deger={trSayi(seo.gorseller.altMetniVar)} />
            <Kutu
              etiket="Düzeltilen"
              deger={seo.gorseller.duzeltilen === null ? '—' : trSayi(seo.gorseller.duzeltilen)}
              ipucu={seo.gorseller.duzeltilen === null ? 'Henüz ölçülmedi' : 'RanksUp ile sitede'}
            />
          </div>
          {seo.gorseller.icerikGorseli > 0 && (
            <div className="mt-3">
              <Cubuk
                deger={Math.round((seo.gorseller.altMetniYok / seo.gorseller.icerikGorseli) * 100)}
                renk={TON_RENGI.warning}
                etiket="Alt metni olmayan görsellerin oranı"
              />
              <p className="mt-1 text-label text-muted-foreground">
                Alt metni olmayan içerik görseli oranı: %{trSayi(Math.round((seo.gorseller.altMetniYok / seo.gorseller.icerikGorseli) * 100))}.
                {seo.gorseller.susGorseli > 0 ? ` ${trSayi(seo.gorseller.susGorseli)} süs görseli (alt="") doğru işaretlenmiş.` : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GEO ────────────────────────────────────────────────────────────

function DosyaSatiri({ ad, durum, not }: { ad: string; durum: 'var' | 'yok' | 'dogrulanamadi'; not?: string }) {
  const rozet: RozetTonu = durum === 'var' ? 'success' : durum === 'yok' ? 'warning' : 'notr';
  const metin = durum === 'var' ? 'Var' : durum === 'yok' ? 'Yok' : 'Doğrulanamadı';
  return (
    <li className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{ad}</p>
        {not && <p className="mt-0.5 text-label text-muted-foreground">{not}</p>}
      </div>
      <Rozet ton={rozet}>{metin}</Rozet>
    </li>
  );
}

/** Bot ziyaretleri bir HAZIRLIK sinyali (AI tarayicilar siteyi okuyor mu) — taramadan bagimsiz, GEO sayfasinda */
function BotZiyaretleri({ rapor }: { rapor: MusteriRaporu }) {
  return (
    <>
      <AltBaslik>AI bot ziyaretleri ve içerik</AltBaslik>
      {rapor.botlar.olculemedi ? (
        <OlculmediKutusu olcum={rapor.botlar} />
      ) : (
        <div className="rapor-blok">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
            <Kutu etiket="Son 7 gün" deger={trSayi(rapor.botlar.son7)} ipucu="AI bot isteği" />
            <Kutu etiket="Son 30 gün" deger={trSayi(rapor.botlar.son30)} ipucu="AI bot isteği" />
            <Kutu etiket="Yayında" deger={trSayi(rapor.icerik.yayinda)} ipucu="RanksUp içeriği" />
            <Kutu etiket="Takvimde" deger={trSayi(rapor.icerik.takvimde)} ipucu="Planlanan içerik" />
          </div>
          {rapor.botlar.botlar.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              En çok gelen botlar (30 gün): {rapor.botlar.botlar.map((b) => `${b.ad} (${trSayi(b.ziyaret)})`).join(', ')}.
            </p>
          )}
        </div>
      )}
      {rapor.botlar.olculemedi && (
        <p className="mt-2 text-sm text-muted-foreground">
          İçerik: {trSayi(rapor.icerik.yayinda)} yayında, {trSayi(rapor.icerik.takvimde)} takvimde.
        </p>
      )}
    </>
  );
}

function GeoBolumu({ rapor }: { rapor: MusteriRaporu }) {
  const geo = rapor.geo;
  if (geo.olculemedi) {
    return (
      <div>
        <OlculmediKutusu olcum={geo} baslik="GEO taraması" />
        <BotZiyaretleri rapor={rapor} />
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:grid-cols-3">
        <Kutu
          etiket="AI arama (GEO) skoru"
          deger={geo.geoSkoru === null ? '—' : String(geo.geoSkoru)}
          sonek={geo.geoSkoru === null ? null : '/100'}
          ipucu={geo.geoSkoruNotu ?? 'Örneklenen sayfalardan'}
          ton={skorTonu(geo.geoSkoru)}
        />
        <Kutu
          etiket="Yapısal veri kapsamı"
          deger={geo.schema.olculemedi ? '—' : `%${geo.schema.oran}`}
          ipucu={geo.schema.olculemedi ? 'Henüz ölçülmedi' : `${geo.schema.sayfa}/${geo.schema.toplam} sayfada JSON-LD`}
        />
        <Kutu
          etiket="Ajan hazırlığı"
          deger={geo.ajanHazirligi.olculemedi || geo.ajanHazirligi.skor === null ? '—' : String(geo.ajanHazirligi.skor)}
          sonek={!geo.ajanHazirligi.olculemedi && geo.ajanHazirligi.skor !== null ? '/100' : null}
          ipucu={geo.ajanHazirligi.olculemedi ? 'Henüz ölçülmedi' : geo.ajanHazirligi.tarih ? trTarih(geo.ajanHazirligi.tarih) : undefined}
        />
      </div>

      <AltBaslik>AI tarayıcıları için dosyalar</AltBaslik>
      <ul className="rapor-blok divide-y divide-border rounded-md border border-border">
        <DosyaSatiri ad="llms.txt" durum={geo.llmsTxt} not="İsteğe bağlı; büyük AI sağlayıcıları kullanacağını taahhüt etmiyor, faydası küçük." />
        <DosyaSatiri ad="Site haritası (sitemap.xml)" durum={geo.sitemap} />
        {geo.robots.olculemedi ? (
          <li className="p-3 text-sm"><span className="font-medium">robots.txt: </span><span className="text-muted-foreground">{geo.robots.neden}</span></li>
        ) : (
          <DosyaSatiri
            ad="robots.txt"
            durum={geo.robots.dosya ? 'var' : 'yok'}
            not={geo.robots.dosya ? (geo.robots.sitemapSatiri ? 'Site haritası satırı var.' : 'Site haritası satırı yok.') : 'Dosya yok: botlar varsayılan olarak serbest.'}
          />
        )}
      </ul>

      {!geo.robots.olculemedi && geo.robots.aramaBotlari.length > 0 && (
        <>
          <AltBaslik>AI arama botlarının erişimi</AltBaslik>
          <div className="rapor-blok flex flex-wrap gap-2">
            {geo.robots.aramaBotlari.map((b) => (
              <Rozet key={b.ad} ton={b.erisim === 'acik' ? 'success' : 'danger'}>
                {b.ad}: {b.erisim === 'acik' ? 'açık' : 'engelli'}
              </Rozet>
            ))}
          </div>
          {geo.robots.egitimBotuEngelli.length > 0 && (
            <p className="mt-2 text-label text-muted-foreground">
              Eğitim botları engelli ({geo.robots.egitimBotuEngelli.join(', ')}). Bu, canlı AI cevaplarını etkilemez.
            </p>
          )}
        </>
      )}

      {geo.sinyaller.length > 0 && (
        <>
          <AltBaslik>AI arama sinyalleri (0–100)</AltBaslik>
          <div className="rapor-blok space-y-2.5">
            {geo.sinyaller.map((s) => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_8rem_2.5rem] items-center gap-3">
                <span className="text-sm">{s.ad}</span>
                <Cubuk deger={s.skor} renk={TON_RENGI[skorTonu(s.skor)]} etiket={`${s.ad}: ${s.skor}`} />
                <span className="text-right text-sm tabular-nums">{s.skor}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <BotZiyaretleri rapor={rapor} />
    </div>
  );
}

// ─── AI gorunurluk ──────────────────────────────────────────────────

const SONUC_ROZETI: Record<AiSonuc, RozetTonu> = {
  alinti: 'success',
  anilma: 'info',
  yok: 'notr',
  olculemedi: 'cerceve',
};

/** Matris hucresi: renkli isaret + kisa metin (renk koru okuyucu icin metin de var) */
const SONUC_ISARETI: Record<AiSonuc, { isaret: string; sinif: string }> = {
  alinti: { isaret: '●', sinif: 'text-success' },
  anilma: { isaret: '◐', sinif: 'text-info' },
  yok: { isaret: '○', sinif: 'text-muted-foreground' },
  olculemedi: { isaret: '–', sinif: 'text-muted-foreground' },
};

function asistanAdi(saglayici: string, ad: string): string {
  return PROVIDER_LABELS[saglayici] ?? ad;
}

function AiBolumu({ rapor }: { rapor: MusteriRaporu }) {
  const ai = rapor.ai;
  const o = ai.olcum;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
        <Kutu
          etiket="AI görünürlük skoru"
          deger={o.olculemedi || o.skor === null ? '—' : String(o.skor)}
          sonek={!o.olculemedi && o.skor !== null ? '/100' : null}
          ipucu={o.olculemedi ? 'Henüz ölçülmedi' : skorTuruMetni(o.skorTuru)}
          ton={o.olculemedi ? 'muted' : skorTonu(o.skor)}
        />
        <Kutu kucuk etiket="Son ölçüm" deger={o.olculemedi ? '—' : trTarih(o.tarih)} ipucu={o.olculemedi ? 'Henüz ölçülmedi' : `${o.asistanlar.length} AI asistanı`} />
        <Kutu
          etiket="Anılma oranı (markasız)"
          deger={ai.anilmaOrani.olculemedi ? '—' : `%${trSayi(ai.anilmaOrani.deger)}`}
          ipucu={ai.anilmaOrani.olculemedi ? 'Henüz ölçülmedi' : `${ai.anilmaOrani.markasizOlcum} ölçüm · son 7 gün`}
        />
        <Kutu
          etiket="Ses payı"
          deger={ai.sesPayi.olculemedi ? '—' : `%${trSayi(ai.sesPayi.deger)}`}
          ipucu={ai.sesPayi.olculemedi ? 'Henüz ölçülmedi' : 'Rakiplere göre · son 7 gün'}
        />
      </div>

      {o.olculemedi ? (
        <div className="mt-4"><OlculmediKutusu olcum={o} baslik="AI görünürlük ölçümü" /></div>
      ) : (
        <>
          <AltBaslik>Asistan bazında sonuç</AltBaslik>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-label text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Asistan</th>
                <th className="py-2 pr-3 font-medium">Sonuç</th>
                <th className="w-40 py-2 pr-3 font-medium">Skor</th>
                <th className="py-2 text-right font-medium">Markasız sorularda</th>
              </tr>
            </thead>
            <tbody>
              {o.asistanlar.map((a) => (
                <tr key={a.saglayici} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <EngineLogo provider={a.saglayici} size={16} />
                      {asistanAdi(a.saglayici, a.ad)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Rozet ton={SONUC_ROZETI[a.sonuc]}>{AI_SONUC_ETIKETI[a.sonuc]}</Rozet>
                  </td>
                  <td className="py-2 pr-3">
                    {a.skor === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Cubuk deger={a.skor} renk={PROVIDER_COLORS[a.saglayici] ?? PROVIDER_FALLBACK} etiket={`${a.ad}: ${a.skor}`} />
                        <span className="w-7 shrink-0 text-right tabular-nums">{a.skor}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {a.sonuc === 'olculemedi' ? (a.neden ?? '—') : `${a.alintiSayisi} kaynak · ${a.anilmaSayisi} anılma · ${a.olculenSoru} soru`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {o.sorgular.length > 0 && (
            <>
              <AltBaslik>Sorulan sorular</AltBaslik>
              {/* Tablo ve lejanti tek blok: lejant kagitta tablodan ayri sayfaya dusmez */}
              <div className="rapor-blok">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-label text-muted-foreground">
                      <th className="py-2 pr-3 text-left font-medium">Soru</th>
                      {o.asistanlar.map((a) => (
                        <th key={a.saglayici} className="px-1 py-2 text-center font-medium" title={a.ad}>
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <EngineLogo provider={a.saglayici} size={14} />
                            <span className="text-label">{asistanAdi(a.saglayici, a.ad)}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {o.sorgular.map((q) => (
                      <tr key={q.soru} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 leading-snug">
                          {q.soru}
                          {q.markali && <span className="ml-1 text-label text-muted-foreground">(markalı soru, skora girmez)</span>}
                        </td>
                        {q.sonuclar.map((s, i) => (
                          <td key={o.asistanlar[i]?.saglayici ?? i} className={cn('px-1 py-2 text-center text-base', SONUC_ISARETI[s].sinif)} aria-label={AI_SONUC_ETIKETI[s]}>
                            {SONUC_ISARETI[s].isaret}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground">
                  {(['alinti', 'anilma', 'yok', 'olculemedi'] as AiSonuc[]).map((s) => (
                    <span key={s}><span className={SONUC_ISARETI[s].sinif}>{SONUC_ISARETI[s].isaret}</span> {AI_SONUC_ETIKETI[s]}</span>
                  ))}
                </p>
              </div>
            </>
          )}
        </>
      )}

      <AltBaslik>Rakipler</AltBaslik>
      {ai.rakipler.sesPayiListesi.olculemedi ? (
        <div className="rapor-blok space-y-2">
          <OlculmediKutusu olcum={ai.rakipler.sesPayiListesi} baslik="Rakiplerle birlikte anılma" />
          {ai.rakipler.tanimli.length > 0 && (
            <p className="text-sm text-muted-foreground">Takip edilen rakipler: {ai.rakipler.tanimli.join(', ')}.</p>
          )}
        </div>
      ) : (
        <div className="rapor-blok space-y-2">
          {ai.rakipler.sesPayiListesi.liste.slice(0, 8).map((e, i) => (
            <div key={e.ad} className="grid grid-cols-[minmax(0,1fr)_10rem_3rem] items-center gap-3 text-sm">
              <span className={cn('truncate', e.marka && 'font-semibold')}>{e.ad}{e.marka ? ' (siz)' : ''}</span>
              <Cubuk deger={e.yuzde} renk={e.marka ? CHART[1] : CHART[((i % 6) + 2) as 2 | 3 | 4 | 5 | 6 | 7]} etiket={`${e.ad}: %${e.yuzde}`} />
              <span className="text-right tabular-nums">%{e.yuzde}</span>
            </div>
          ))}
          <p className="text-label text-muted-foreground">Son 7 günde marka adı geçmeyen sorulardaki anılma payı.</p>
        </div>
      )}

    </div>
  );
}

// ─── Aksiyonlar ─────────────────────────────────────────────────────

const ETKI_ROZETI: Record<'yuksek' | 'orta' | 'dusuk', RozetTonu> = { yuksek: 'danger', orta: 'warning', dusuk: 'notr' };

function AksiyonBolumu({ rapor }: { rapor: MusteriRaporu }) {
  if (rapor.aksiyonlar.length === 0) {
    return <p className="text-sm text-muted-foreground">Şu an önerilen bir aksiyon yok: taramada kritik ya da uyarı düzeyinde bulgu bulunmadı ve aksiyon planında açık iş yok.</p>;
  }
  return (
    <ol className="space-y-3">
      {rapor.aksiyonlar.map((a, i) => (
        <li key={`${a.baslik}-${i}`} className="rapor-blok flex gap-3 rounded-md border border-border p-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-semibold tabular-nums text-brand">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="mr-1 text-sm font-semibold">{a.baslik}</p>
              <Rozet ton={ETKI_ROZETI[a.etki]}>{ETKI_ETIKETI[a.etki]}</Rozet>
              {a.efor && <Rozet ton="cerceve">{EFOR_ETIKETI[a.efor]}</Rozet>}
              {a.durum === 'in_progress' && <Rozet ton="info">Devam ediyor</Rozet>}
            </div>
            {a.aciklama && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a.aciklama}</p>}
            <p className="mt-1 text-label text-muted-foreground">{a.kaynak === 'plan' ? 'Aksiyon planından' : 'Tarama bulgusundan'}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Yontem ─────────────────────────────────────────────────────────

function YontemBolumu({ rapor, paylasimSonu }: { rapor: MusteriRaporu; paylasimSonu: string | null }) {
  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        {rapor.yontem.map((y) => <li key={y}>{y}</li>)}
      </ul>
      {/* Tarihler ve imza tek blok: kagitta imza satiri tek basina sayfaya dusmez */}
      <div className="rapor-blok space-y-4">
        <dl className="grid grid-cols-1 gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2 print:grid-cols-2">
          <div><dt className="text-label text-muted-foreground">Rapor oluşturma</dt><dd>{trTarih(rapor.generatedAt)}</dd></div>
          <div><dt className="text-label text-muted-foreground">Site taraması</dt><dd>{rapor.kaynaklar.tarama ? trTarih(rapor.kaynaklar.tarama) : 'Henüz yapılmadı'}</dd></div>
          <div><dt className="text-label text-muted-foreground">AI görünürlük ölçümü</dt><dd>{rapor.kaynaklar.aiOlcum ? trTarih(rapor.kaynaklar.aiOlcum) : 'Henüz ölçülmedi'}</dd></div>
          <div>
            <dt className="text-label text-muted-foreground">Anılma oranı ve ses payı penceresi</dt>
            <dd>{trTarih(rapor.kaynaklar.aiOranlari.baslangic)} – {trTarih(rapor.kaynaklar.aiOranlari.bitis)}</dd>
          </div>
          <div>
            <dt className="text-label text-muted-foreground">AI bot ziyaret penceresi</dt>
            <dd>{trTarih(rapor.kaynaklar.botZiyaret.baslangic)} – {trTarih(rapor.kaynaklar.botZiyaret.bitis)}</dd>
          </div>
          {paylasimSonu && <div><dt className="text-label text-muted-foreground">Bağlantı geçerliliği</dt><dd>{trTarih(paylasimSonu)}</dd></div>}
        </dl>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <BrandWordmark size={16} />
          <p className="text-label text-muted-foreground">Bu rapor RanksUp ile hazırlandı.</p>
        </div>
      </div>
    </div>
  );
}
