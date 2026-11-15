/**
 * RanksUp e-posta duzeni.
 *
 * GORUNUM (15.11.2026, sahip: "bu sekilde guzel tasarim olsun" — iki ornek e-posta gosterdi):
 * siyah zemin, ustte o e-postanin verisini tasiyan KOYU bir kart (varsa), ortalanmis kalin baslik,
 * kisa ortali metin, TEK buyuk turuncu dugme, kucuk ortali altbilgi. Site 11.11.2026'dan beri
 * ayni dilde (koyu, duz, dev baslik); e-postalar acik renkli, yuvarlak kartli eski gorunumde
 * kalmisti. Eski duzenin tarihcesi: once mor (#6c5ce7) ve "LuviHost" altbilgili, sonra sicak
 * tonlu acik kart. Bu dosya TEK duzendir; her sablon yalniz icerik uretir.
 *
 * KOMPOZISYON: (1) logo, (2) varsa `ekranKarti` — o e-postanin verisi (skor, tiklama,
 * olculer), (3) baslik, (4) bir iki cumle, (5) dugme, (6) varsa ayrinti, (7) altbilgi.
 * Turuncu yalniz birincil eylemde, logodaki "Up"ta ve grafik serisinde; baglantilar beyaz ve
 * alti cizili.
 *
 * TASARIM KURALLARI (e-postada web'den farklidir, bilerek "eski usul"):
 *   - Yerlesim TABLO ile. Flexbox/grid Outlook'ta calismaz.
 *   - Stil SATIR ICI. <style> blogu Gmail'de kismen, Outlook.com'da hic calismaz; yalnizca
 *     mobil icin ek <style> kullaniyoruz.
 *   - Genislik hem attribute hem style ile verilir.
 *   - Dugme tabloyla kurulur: <a>'ya padding vermek Outlook'ta tiklanabilir alani metne indirger.
 *   - SVG ve DIS GORSEL YOK. Gmail SVG'yi siler, istemciler dis gorseli engelleyebilir; "ekran
 *     karti" bu yuzden resim degil, tabloyla cizilen gercek veridir.
 *   - Belge YALNIZ koyu: `color-scheme: dark` — istemci acik temadayken renkleri cevirmesin.
 */

/**
 * Renkler. Koyu zemin degerleri web'in koyu tema belirtecleriyle ayni
 * (apps/web/src/app/globals.css .dark): zemin 0 0% 3.5%, kart 0 0% 6.5%, cizgi 0 0% 17%,
 * soluk 30 4% 64%, basari 152 55% 52%.
 */
export const MARKA = {
  /** Yalniz birincil eylem, logodaki "Up" ve grafik serisi */
  primary: '#FF5800',
  primaryMetin: '#0A0A0A',

  // ── Koyu zemin ──
  zemin: '#090909',
  kart: '#111111',
  cizgi: '#2B2B2B',
  /** Basliklar */
  ink: '#FFFFFF',
  govde: '#E5E5E5',
  soluk: '#A7A39F',
  silik: '#7A7672',
  /** Notr secili satir (turuncu degil) */
  secili: '#1C1C1C',
  dugmeCizgi: '#4A4A4A',
  yesil: '#41C88A',
  yesilCizgi: '#2F7D5B',
  yesilZemin: '#12261D',
  alintiZemin: '#0F1C16',
  alintiCizgi: '#1F4A37',

  // ── Ekran karti: e-postanin verisini tasiyan kart. KOYU (15.11.2026): ilk surumde beyazdi;
  //    sahip "şu beyazlık tasarıma çok uymuyor" dedi — kart artik temanin koyu yuzeyi, ince
  //    cizgiyle ayrilir. Renkler koyu zemin degerleriyle ayni aileden. ──
  ekran: '#111111',
  ekranInk: '#FFFFFF',
  ekranMetin: '#E5E5E5',
  ekranSoluk: '#A7A39F',
  ekranCizgi: '#2B2B2B',
  /** Cubuk grafiklerin bos kismi */
  ray: '#1C1C1C',
  /** Karsilastirma cubugunda "once" degeri (notr) */
  onceCubuk: '#4A4A4A',
  iyi: '#41C88A',
  kotu: '#FF6B57',
  iyiZemin: '#12261D',
  iyiCizgi: '#2F7D5B',
} as const;

export const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
/** Kucuk etiketler: sitedeki mono "ray" (.v-rail). Cumle duzeni, BUYUK HARF YOK. */
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** LLM/kullanici metnini HTML'e gomerken kacisla. */
export function kacisla(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Birincil eylem — e-postanin TEK buyuk dugmesi (turuncu, ortali, ok isaretli).
 *
 * Tablo ile kuruluyor cunku Outlook'ta <a> etiketine verilen padding
 * tiklanabilir alani olusturmaz — kullanici dugmenin ortasina basar ve
 * hicbir sey olmaz. mso kosullu yorumu Outlook'ta yuksekligi sabitler.
 */
export function dugme(metin: string, href: string): string {
  return `
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:30px auto 10px;">
  <tr>
    <td align="center" bgcolor="${MARKA.primary}" style="background:${MARKA.primary};border-radius:8px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="15%" stroke="f" fillcolor="${MARKA.primary}"><w:anchorlock/><center style="color:${MARKA.primaryMetin};font-family:${FONT};font-size:16px;font-weight:bold;"><![endif]-->
      <a href="${href}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:${MARKA.primaryMetin};text-decoration:none;border-radius:8px;">${metin}&nbsp;&rarr;</a>
      <!--[if mso]></center></v:roundrect><![endif]-->
    </td>
  </tr>
</table>`;
}

/** Ikincil, cerceveli dugme — ana eylemin yanina / altina. */
export function ikincilDugme(metin: string, href: string): string {
  return `<a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;color:${MARKA.ink};text-decoration:none;border:1px solid ${MARKA.dugmeCizgi};border-radius:8px;">${metin}</a>`;
}

/**
 * Ekran karti — o e-postanin gercek verisini (olculer, grafik, skor) tasiyan kart; resim
 * degil, tabloyla cizilir. KOYU ve ince cizgili (MARKA.ekran* notu): beyaz kart temadan
 * kopuk duruyordu. Icerik ekranInk / ekranSoluk renkleriyle yazilir; kart sola hizalidir.
 */
export function ekranKarti(icerik: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MARKA.ekran}" style="margin:0 0 34px;background:${MARKA.ekran};border:1px solid ${MARKA.ekranCizgi};border-radius:14px;">
  <tr><td class="ekr" style="padding:26px 28px;font-family:${FONT};text-align:left;color:${MARKA.ekranInk};">${icerik}</td></tr>
</table>`;
}

/** Ekran kartinin icinde ince ayrac */
export const ekranBolucu = () =>
  `<div style="border-top:1px solid ${MARKA.ekranCizgi};margin:20px 0;font-size:0;line-height:0;">&nbsp;</div>`;

/**
 * Sayi kutulari — "12.480 tiklama / +%34" gibi olculeri gosterir. Ekran kartinin icinde durur;
 * tek basina cagrilirsa kendi kartini cizer (`kart: false` → cagiran baska icerikle ayni
 * karta koyar).
 *
 * `deger` null ise "—" basilir ve altina neden yazilir. Bu bilincli: bu
 * urunde tekrarlayan hata sinifi olculemeyen bir seyi 0 gostermek oldu ve
 * 0, e-postada da grafikte oldugu gibi "dustu" diye okunur.
 */
export function olcuSatiri(
  olculer: Array<{ etiket: string; deger: string | number | null; alt?: string }>,
  secenek: { kart?: boolean } = {},
): string {
  // HIZA (15.11.2026, sahip: "gösterimi, hizası, büyüklüğü düzenlenmeli"): sutunlar ESIT
  // genislikte (table-layout:fixed). Eskiden genislik icerige gore dagiliyordu: "1.840" ile "6"
  // arasi genis, "81/90" ile "7." arasi dar, uc olculu kartta sag taraf bos kaliyordu.
  //  - Tek basina kart: degerler ORTALI, sutunlar arasinda ince dikey ayrac (e-postanin geri
  //    kalani da ortali).
  //  - Baska icerikle ayni kartta (`kart: false`; ustunde sola hizali buyuk sayi / grafik):
  //    SOLA hizali, ayracsiz — kartin sol kenariyla ayni hizada kalir.
  const ortali = secenek.kart !== false;
  const genislik = (100 / Math.max(1, olculer.length)).toFixed(2);
  const hucreler = olculer
    .map(
      (o, i) => `
      <td align="${ortali ? 'center' : 'left'}" valign="top" width="${genislik}%" style="width:${genislik}%;padding:${ortali ? '6px 6px' : '6px 10px 6px 0'};font-family:${FONT};text-align:${ortali ? 'center' : 'left'};${
        ortali && i > 0 ? `border-left:1px solid ${MARKA.ekranCizgi};` : ''
      }">
        <div style="font-size:28px;font-weight:700;letter-spacing:-.7px;color:${MARKA.ekranInk};line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;">${
          o.deger === null || o.deger === undefined ? '—' : kacisla(String(o.deger))
        }</div>
        <div style="font-size:13px;line-height:1.35;color:${MARKA.ekranSoluk};margin-top:7px;">${kacisla(o.etiket)}</div>
        ${o.alt ? `<div style="font-size:12px;line-height:1.35;color:${MARKA.ekranSoluk};margin-top:2px;">${kacisla(o.alt)}</div>` : ''}
      </td>`,
    )
    .join('');
  const tablo = `
<table role="presentation" class="olcu" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
  <tr>${hucreler}</tr>
</table>`;
  return secenek.kart === false ? tablo : ekranKarti(tablo);
}

/**
 * Kahraman olcu — ekran kartinin tek buyuk sayisi.
 *
 * Bir ekranda TEK bir sey bagirir. Rapor mailinde bu, donemin en onemli rakami. 44px,
 * tabular rakam (hizalama icin), altinda kisa etiket ve degisim. Ekran kartinin ICINDE
 * kullanilir (ekran* renkleri).
 */
export function kahramanOlcu(o: {
  deger: string | number | null;
  etiket: string;
  degisim?: { yon: 'artis' | 'dusus' | 'yok'; metin: string } | null;
  alt?: string;
}): string {
  const renk =
    o.degisim?.yon === 'artis' ? MARKA.iyi : o.degisim?.yon === 'dusus' ? MARKA.kotu : MARKA.ekranSoluk;
  const ok = o.degisim?.yon === 'artis' ? '&#9650;' : o.degisim?.yon === 'dusus' ? '&#9660;' : '';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
  <tr>
    <td style="font-family:${FONT};">
      <div style="font-size:44px;line-height:1.05;font-weight:700;letter-spacing:-1.6px;color:${MARKA.ekranInk};font-variant-numeric:tabular-nums;">${
        o.deger === null || o.deger === undefined ? '&mdash;' : kacisla(String(o.deger))
      }</div>
      <div style="font-size:13px;color:${MARKA.ekranSoluk};margin-top:8px;">${kacisla(o.etiket)}</div>
      ${
        o.degisim
          ? `<div style="font-size:13px;font-weight:600;color:${renk};margin-top:6px;">${ok} ${kacisla(o.degisim.metin)}</div>`
          : ''
      }
      ${o.alt ? `<div style="font-size:12px;color:${MARKA.ekranSoluk};margin-top:6px;">${kacisla(o.alt)}</div>` : ''}
    </td>
  </tr>
</table>`;
}

/**
 * Once/sonra karsilastirma cubugu (ekran kartinin icinde).
 *
 * TABLO HUCRESIYLE CIZILIYOR: e-postada SVG (Gmail siler) ve dis gorsel
 * (istemciler varsayilan olarak engeller) kullanilamaz. Genisligi yuzde olan
 * renkli bir hucre ise HER istemcide calisir — 1990'lardan beri.
 *
 * `tersYon` sira metrikleri icin: sira KUCULDUKCE iyilesir.
 */
export function karsilastirmaCubugu(
  satirlar: Array<{ etiket: string; once: number | null; sonra: number | null; birim?: string; tersYon?: boolean }>,
): string {
  const govde = satirlar
    .map((r) => {
      if (r.once === null || r.sonra === null) {
        return `
      <tr><td style="padding:10px 0;font-family:${FONT};">
        <div style="font-size:13px;font-weight:600;color:${MARKA.ekranMetin};">${kacisla(r.etiket)}</div>
        <div style="font-size:13px;color:${MARKA.ekranSoluk};margin-top:4px;">ölçüm yok</div>
      </td></tr>`;
      }
      const tavan = Math.max(r.once, r.sonra, 1);
      const oncePct = Math.max(2, Math.round((r.once / tavan) * 100));
      const sonraPct = Math.max(2, Math.round((r.sonra / tavan) * 100));
      const iyi = r.tersYon ? r.sonra < r.once : r.sonra > r.once;
      const sonraRenk = r.sonra === r.once ? MARKA.ekranSoluk : iyi ? MARKA.iyi : MARKA.kotu;
      const bicim = (n: number) => n.toLocaleString('tr-TR') + (r.birim ?? '');

      const cubuk = (pct: number, renk: string, deger: string, kalin: boolean) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:5px 0;">
          <tr>
            <td width="72%" style="width:72%;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${MARKA.ray};border-radius:5px;">
                <tr><td width="${pct}%" style="width:${pct}%;height:9px;line-height:9px;font-size:0;background:${renk};border-radius:5px;">&nbsp;</td><td>&nbsp;</td></tr>
              </table>
            </td>
            <td width="28%" align="right" style="width:28%;padding-left:10px;font-family:${FONT};font-size:13px;font-weight:${kalin ? 700 : 500};color:${kalin ? MARKA.ekranInk : MARKA.ekranSoluk};font-variant-numeric:tabular-nums;white-space:nowrap;">${deger}</td>
          </tr>
        </table>`;

      return `
      <tr><td style="padding:10px 0;font-family:${FONT};">
        <div style="font-size:13px;font-weight:600;color:${MARKA.ekranMetin};margin-bottom:2px;">${kacisla(r.etiket)}</div>
        ${cubuk(oncePct, MARKA.onceCubuk, bicim(r.once), false)}
        ${cubuk(sonraPct, sonraRenk, bicim(r.sonra), true)}
      </td></tr>`;
    })
    .join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">
  ${govde}
</table>`;
}

/**
 * Mini sutun grafigi — donem boyunca gunluk seyir (ekran kartinin icinde).
 *
 * Her sutun sabit genislikte bir hucre; yukseklik `height` ile veriliyor
 * cunku CSS yuzde yukseklik e-postada guvenilmez. Veri yoksa hic cizilmez —
 * duz bir taban cizgisi "sifir" gibi okunurdu.
 */
export function sutunGrafik(seri: number[], etiket: string): string {
  const gecerli = seri.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (gecerli.length < 3) return '';
  const tavan = Math.max(...gecerli, 1);
  const YUKSEK = 64;

  const sutunlar = gecerli
    .map((n) => {
      const h = Math.max(2, Math.round((n / tavan) * YUKSEK));
      const bosluk = YUKSEK - h;
      return `<td valign="bottom" style="padding:0 2px;">
        <div style="height:${bosluk}px;line-height:${bosluk}px;font-size:0;">&nbsp;</div>
        <div style="height:${h}px;line-height:${h}px;font-size:0;background:${MARKA.primary};border-radius:3px 3px 0 0;">&nbsp;</div>
      </td>`;
    })
    .join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0;">
  <tr><td style="font-family:${MONO};font-size:11px;color:${MARKA.ekranSoluk};padding-bottom:8px;">${kacisla(etiket)}</td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:${YUKSEK}px;">
      <tr>${sutunlar}</tr>
    </table>
    <div style="border-top:1px solid ${MARKA.ekranCizgi};margin-top:2px;font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>
</table>`;
}

/** Ince ayrac (koyu zeminde) — kutu icinde kutu yerine nefes alani. */
export const bolucu = () =>
  `<div style="border-top:1px solid ${MARKA.cizgi};margin:30px 0;font-size:0;line-height:0;">&nbsp;</div>`;

/** Dikkat cekmesi gereken kisa not — uyari ya da ipucu. Notr cerceveli kutu (turuncu degil). */
export function bilgiKutusu(baslik: string, metin: string): string {
  return `
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MARKA.kart}" style="margin:6px auto 22px;max-width:520px;background:${MARKA.kart};border:1px solid ${MARKA.cizgi};border-radius:10px;">
  <tr>
    <td style="padding:16px 20px;font-family:${FONT};text-align:left;">
      <div style="font-size:14px;font-weight:700;color:${MARKA.ink};margin-bottom:4px;">${kacisla(baslik)}</div>
      <div style="font-size:14px;color:${MARKA.soluk};line-height:1.6;">${metin}</div>
    </td>
  </tr>
</table>`;
}

export interface DuzenSecenekleri {
  /**
   * Gelen kutusunda konu satirinin yaninda gorunen onizleme metni.
   * Verilmezse istemci HTML'in ilk kelimelerini gosterir — genelde
   * "RanksUp" kelimesini tekrar eder ve yer israf eder.
   */
  onizleme?: string;
  baseUrl?: string;
  /** Abonelikten cikma baglantisi — pazarlama nitelikli maillerde zorunlu. */
  cikisUrl?: string;
  /** Altbilgide baglantilarin yerine yazilan not (yonetici bildirimleri: panel baglantilari gereksiz) */
  altNot?: string;
  /**
   * Altbilgideki Panel / Abonelik / Yardim baglantilarinin YERINE konan baglantilar. Hesabi
   * olmayan aliciya (ucretsiz test takibi abonesi) panel baglantisi gosterilmez; yalniz
   * "Aboneliği iptal et" gibi ona ait baglanti.
   */
  altBaglantilar?: Array<{ metin: string; href: string }>;
  /** Belgenin dili (ekran okuyucu); varsayilan 'tr' */
  dil?: 'tr' | 'en';
  /** Logonun altindaki hareketli ust gorselin isareti (ustGorsel); verilmezse gorsel yok */
  gorsel?: EpostaMotifi;
}

/**
 * Hareketli ust gorsel — "Nokta işaretler" (sahip secimi 16.11.2026: dort alternatiften 1).
 *
 * Siyah zeminde nokta izgarasi; her e-posta turunun kendi isareti turuncu noktalardan cizilir ve
 * uzerinden bir isik dalgasi gecer. Tur → isaret eslemesi cagiran tarafta (email.service
 * SABLON_MOTIFI ve dogrudan `duzen` cagiranlar).
 *
 * GORSEL KURALI: e-postalarda baska dis gorsel YOK (istemciler varsayilan olarak engeller, veri
 * kartlari bu yuzden tabloyla cizilir). Bu gorsel SUSTUR: `alt=""`, e-posta onsuz da eksiksiz
 * okunur. Yukseklik verilmez; gorseli engelleyen istemcilerin cogu yerinde bosluk birakmaz
 * (Windows Outlook genisligi kadar bos bir cerceve cizer). Hareketi gostermeyen istemci (eski
 * Outlook) ilk kareyi gosterir; ilk karede isaret gorunur.
 *
 * DOSYALAR: apps/web/public/email/v1/isaret-<motif>.gif (700x280, ~285 KB). Dosya degisirse
 * klasor adi (v2) degisir: istemciler ve onbellek eski adresi saklar.
 */
export const EPOSTA_MOTIFLERI = ['ok', 'cubuk', 'belge', 'kumsaati', 'kart', 'kilit', 'hedef', 'zil'] as const;
export type EpostaMotifi = (typeof EPOSTA_MOTIFLERI)[number];
export const UST_GORSEL_YOLU = '/email/v1';
/** Govdede gorunen genislik (px); dosya 700 px (1,25x) */
export const UST_GORSEL_GENISLIK = 560;

export function ustGorsel(motif: EpostaMotifi, baseUrl: string): string {
  // Bilinmeyen deger adrese girmez (cagiran veri gecirirse)
  if (!EPOSTA_MOTIFLERI.includes(motif)) return '';
  // Sondaki egik cizgi atilir: "https://ranksup.ai//email/…" bazi sunucularda bulunamaz
  return `<img src="${kacisla(baseUrl.replace(/\/+$/, ''))}${UST_GORSEL_YOLU}/isaret-${motif}.gif" width="${UST_GORSEL_GENISLIK}" alt="" style="display:block;width:100%;max-width:${UST_GORSEL_GENISLIK}px;height:auto;margin:0 auto;border:0;border-radius:14px;" />`;
}

/**
 * Ust gorselin tablo satiri (logo satiri ile govde satiri arasina girer). Alttaki bosluk HUCRE
 * dolgusuyla verilir: Windows Outlook (Word motoru) gorseldeki `margin` ve `display:block`u
 * guvenilir uygulamaz; gorsel basliga ya da veri kartina yapisirdi.
 */
function ustGorselSatiri(motif: EpostaMotifi, baseUrl: string): string {
  const gorsel = ustGorsel(motif, baseUrl);
  return gorsel
    ? `<tr>
          <td class="ped" align="center" style="padding:0 20px 30px;">${gorsel}</td>
        </tr>`
    : '';
}

/**
 * Tam HTML belgesi: logo, ortali govde, ortali altbilgi.
 *
 * Belge yalniz koyu (`color-scheme: dark`): istemciye belgeyi kendiliginden ters cevirmemesini
 * soyluyoruz. Zemin rengi hem attribute (bgcolor) hem style ile verilir.
 */
export function duzen(baslik: string, govde: string, s: DuzenSecenekleri = {}): string {
  // `||` (`??` degil): ortam degiskeni BOS tanimliysa (`WEB_BASE_URL=`) baglantilar ve ust gorsel
  // goreli adrese donerdi ("/email/v1/…"); e-posta istemcisinde goreli adres calismaz.
  const baseUrl = s.baseUrl || process.env.WEB_BASE_URL || 'https://ranksup.ai';
  const yil = new Date().getFullYear();
  const altBaglanti = (metin: string, href: string) =>
    `<a href="${href}" style="color:${MARKA.silik};text-decoration:underline;">${metin}</a>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${s.dil === 'en' ? 'en' : 'tr'}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${kacisla(baslik)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  :root { color-scheme: dark; }
  /* Mobil: kenar bosluklarini daralt, basligi kucult, olculeri alt alta diz */
  @media only screen and (max-width:600px) {
    .kap { width:100% !important; }
    .ped { padding-left:6px !important; padding-right:6px !important; }
    .h1 { font-size:26px !important; letter-spacing:-.6px !important; }
    .ekr { padding:22px 20px !important; }
    .olcu td { display:block !important; width:100% !important; padding:10px 0 !important; border-left:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${MARKA.zemin};-webkit-font-smoothing:antialiased;">

<!-- Onizleme metni: gelen kutusunda gorunur, mailin icinde gorunmez -->
<div style="display:none;font-size:1px;color:${MARKA.zemin};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${kacisla(s.onizleme ?? baslik)}
  <!-- Istemcinin devaminda HTML kirintisi gostermemesi icin dolgu -->
  &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MARKA.zemin}" style="background:${MARKA.zemin};">
  <tr>
    <td align="center" style="padding:40px 14px 56px;">

      <table role="presentation" class="kap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <!-- Logo: metin (SVG Gmail'de silinir) -->
        <tr>
          <td align="center" style="padding:0 0 34px;font-family:${FONT};">
            <a href="${baseUrl}" target="_blank" style="text-decoration:none;">
              <span style="font-size:20px;font-weight:700;letter-spacing:-.4px;color:${MARKA.ink};">Ranks</span><span style="font-size:20px;font-weight:700;letter-spacing:-.4px;color:${MARKA.primary};">Up</span>
            </a>
          </td>
        </tr>

        ${s.gorsel ? ustGorselSatiri(s.gorsel, baseUrl) : ''}

        <!-- Govde: ortali. Sola hizali bloklar (ekran karti, liste) kendi hizasini verir. -->
        <tr>
          <td class="ped" align="center" style="padding:0 20px;font-family:${FONT};font-size:17px;line-height:1.6;color:${MARKA.govde};text-align:center;">
            ${govde}
          </td>
        </tr>

        <!-- Altbilgi -->
        <tr>
          <td class="ped" align="center" style="padding:46px 20px 0;font-family:${FONT};font-size:12px;line-height:1.8;color:${MARKA.silik};text-align:center;">
            ${
              s.altNot
                ? kacisla(s.altNot)
                : s.altBaglantilar
                  ? s.altBaglantilar.map((b) => altBaglanti(kacisla(b.metin), kacisla(b.href))).join('&nbsp;·&nbsp;')
                  : `${altBaglanti('Panel', `${baseUrl}/dashboard`)}
            &nbsp;·&nbsp;
            ${altBaglanti('Abonelik', `${baseUrl}/billing`)}
            &nbsp;·&nbsp;
            ${altBaglanti('Yardım', `${baseUrl}/help`)}${
                    s.cikisUrl ? `&nbsp;·&nbsp;${altBaglanti('Bildirimleri durdur', s.cikisUrl)}` : ''
                  }`
            }
            <div style="margin-top:6px;">
              © ${yil} RanksUp · ${altBaglanti('ranksup.ai', baseUrl)}
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Basliklar ve paragraflar — sablonlarin ham HTML yazmasini engeller. */
export const p = (metin: string) =>
  `<p style="margin:0 auto 16px;max-width:520px;font-family:${FONT};font-size:17px;line-height:1.6;color:${MARKA.govde};text-align:center;">${metin}</p>`;

export const h = (metin: string) =>
  `<h1 class="h1" style="margin:0 auto 16px;max-width:540px;font-family:${FONT};font-size:30px;font-weight:700;line-height:1.15;letter-spacing:-.8px;color:${MARKA.ink};text-align:center;">${kacisla(metin)}</h1>`;

/** Baslik ustu kucuk mono etiket — "Haftalık rapor" gibi. Cumle duzeni (buyuk harf yok). */
export const etiket = (metin: string) =>
  `<div style="margin:0 0 12px;font-family:${MONO};font-size:12px;line-height:16px;color:${MARKA.soluk};text-align:center;">${kacisla(metin)}</div>`;

/** Bolum ustu mono etiket, SOLA hizali (ayrinti bolumleri) */
export const ray = (metin: string) =>
  `<div style="font-family:${MONO};font-size:12px;line-height:16px;color:${MARKA.soluk};text-align:left;">${kacisla(metin)}</div>`;

/** Madde listesi — ortali metnin icinde sola hizali, cerceveli kutu (ortalanmis madde imi okunmaz) */
export const liste = (maddeler: string[]) =>
  `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MARKA.kart}" style="margin:6px auto 22px;max-width:520px;background:${MARKA.kart};border:1px solid ${MARKA.cizgi};border-radius:10px;"><tr><td style="padding:18px 20px 8px 8px;text-align:left;"><ul style="margin:0;padding-left:26px;font-family:${FONT};font-size:15px;line-height:1.6;color:${MARKA.govde};">${maddeler
    .map((m) => `<li style="margin-bottom:10px;">${m}</li>`)
    .join('')}</ul></td></tr></table>`;

/** Metin ici baglanti: beyaz, alti cizili (turuncu yalniz birincil eylemde) */
export const baglanti = (metin: string, href: string) =>
  `<a href="${href}" target="_blank" style="color:${MARKA.ink};text-decoration:underline;font-weight:600;">${kacisla(metin)}</a>`;
