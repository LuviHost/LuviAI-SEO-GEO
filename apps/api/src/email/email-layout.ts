/**
 * RanksUp e-posta duzeni.
 *
 * NEDEN AYRI DOSYA: sablon govdesi eskiden email.service.ts icinde tek bir
 * template literal'di ve uc sorunu vardi:
 *   1. MARKA YANLIS. Govde #6c5ce7 (mor) kullaniyordu; RanksUp markasi turuncu
 *      (#F36D32 -> #B63325). Yani mailler baska bir urunun maili gibi
 *      duruyordu. Altbilgide ayrica "© 2026 LuviHost" yaziyordu.
 *   2. E-POSTA ISTEMCILERI ICIN GUVENSIZ. div + padding yapisi Outlook'ta
 *      (Word render motoru) bozuluyor, dugmeler tiklanabilir alanini
 *      kaybediyor, karanlik modda beyaz kart uzerine beyaz metin cikabiliyor.
 *   3. Onizleme metni (preheader) yoktu — gelen kutusunda konu satirinin
 *      yaninda HTML'in ilk kelimeleri gorunuyordu.
 *
 * TASARIM KURALLARI (e-postada web'den farklidir, bilerek "eski usul"):
 *   - Yerlesim TABLO ile. Flexbox/grid Outlook'ta calismaz.
 *   - Stil SATIR ICI. <style> blogu Gmail'de kismen, Outlook.com'da hic
 *     calismaz; yalnizca karanlik mod ve mobil icin ek <style> kullaniyoruz.
 *   - Genislik hem attribute hem style ile verilir.
 *   - Dugme tabloyla kurulur: <a>'ya padding vermek Outlook'ta tiklanabilir
 *     alani metne indirger.
 *   - SVG YOK. Gmail SVG'yi siler; logo metin olarak kurulur.
 */

/** Marka paleti — apps/web/tailwind.config ve brand-logo.tsx ile ayni. */
export const MARKA = {
  primary: '#E04E24',
  gradBas: '#F36D32',
  gradSon: '#B63325',
  /** Basliklar — sicak, saf siyah degil. Saf siyah ekranda sert okunur. */
  ink: '#1D1512',
  govde: '#4A423E',
  soluk: '#8A817C',
  cizgi: '#EBE6E1',
  /** Cubuk grafiklerin bos kismi */
  ray: '#F0EBE6',
  zemin: '#FAF8F6',
  kart: '#FFFFFF',
  iyi: '#1F7A5A',
  kotu: '#B4442E',
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

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
 * Tikanabilir dugme.
 *
 * Tablo ile kuruluyor cunku Outlook'ta <a> etiketine verilen padding
 * tiklanabilir alani olusturmaz — kullanici dugmenin ortasina basar ve
 * hicbir sey olmaz. mso kosullu yorumu Outlook'ta yuksekligi sabitler.
 */
export function dugme(metin: string, href: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" bgcolor="${MARKA.primary}" style="border-radius:10px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="23%" stroke="f" fillcolor="${MARKA.primary}"><w:anchorlock/><center style="color:#ffffff;font-family:${FONT};font-size:15px;font-weight:bold;"><![endif]-->
      <a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${metin}</a>
      <!--[if mso]></center></v:roundrect><![endif]-->
    </td>
  </tr>
</table>`;
}

/** Ikincil, cerceveli dugme — ana eylemin yanina. */
export function ikincilDugme(metin: string, href: string): string {
  return `<a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;color:${MARKA.primary};text-decoration:none;border:1px solid ${MARKA.cizgi};border-radius:10px;">${metin}</a>`;
}

/**
 * Sayi kartlari — "12.480 tiklama / +%34" gibi olculeri gosterir.
 *
 * `deger` null ise "—" basilir ve altina neden yazilir. Bu bilincli: bu
 * urunde tekrarlayan hata sinifi olculemeyen bir seyi 0 gostermek oldu ve
 * 0, e-postada da grafikte oldugu gibi "dustu" diye okunur.
 */
export function olcuSatiri(
  olculer: Array<{ etiket: string; deger: string | number | null; alt?: string }>,
): string {
  const hucreler = olculer
    .map(
      (o) => `
      <td align="center" valign="top" style="padding:14px 8px;font-family:${FONT};">
        <div style="font-size:22px;font-weight:700;color:${MARKA.ink};line-height:1.2;">${
          o.deger === null || o.deger === undefined ? '—' : kacisla(String(o.deger))
        }</div>
        <div style="font-size:11px;color:${MARKA.soluk};text-transform:uppercase;letter-spacing:.4px;margin-top:4px;">${kacisla(o.etiket)}</div>
        ${o.alt ? `<div style="font-size:11px;color:${MARKA.soluk};margin-top:2px;">${kacisla(o.alt)}</div>` : ''}
      </td>`,
    )
    .join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;background:${MARKA.zemin};border:1px solid ${MARKA.cizgi};border-radius:12px;">
  <tr>${hucreler}</tr>
</table>`;
}

/**
 * Kahraman olcu — mailin tek buyuk sayisi.
 *
 * Apple'in urun sayfalarindaki mantik: bir ekranda TEK bir sey bagirir.
 * Rapor mailinde bu, donemin en onemli rakami. 44px, tabular rakam
 * (hizalama icin), altinda kisa etiket ve degisim.
 */
export function kahramanOlcu(o: {
  deger: string | number | null;
  etiket: string;
  degisim?: { yon: 'artis' | 'dusus' | 'yok'; metin: string } | null;
  alt?: string;
}): string {
  const renk =
    o.degisim?.yon === 'artis' ? MARKA.iyi : o.degisim?.yon === 'dusus' ? MARKA.kotu : MARKA.soluk;
  const ok = o.degisim?.yon === 'artis' ? '&#9650;' : o.degisim?.yon === 'dusus' ? '&#9660;' : '';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 28px;">
  <tr>
    <td style="font-family:${FONT};">
      <div class="baslik" style="font-size:44px;line-height:1.05;font-weight:700;letter-spacing:-1.4px;color:${MARKA.ink};font-variant-numeric:tabular-nums;">${
        o.deger === null || o.deger === undefined ? '&mdash;' : kacisla(String(o.deger))
      }</div>
      <div class="soluk" style="font-size:13px;color:${MARKA.soluk};margin-top:8px;letter-spacing:.2px;">${kacisla(o.etiket)}</div>
      ${
        o.degisim
          ? `<div style="font-size:13px;font-weight:600;color:${renk};margin-top:6px;">${ok} ${kacisla(o.degisim.metin)}</div>`
          : ''
      }
      ${o.alt ? `<div class="soluk" style="font-size:12px;color:${MARKA.soluk};margin-top:6px;">${kacisla(o.alt)}</div>` : ''}
    </td>
  </tr>
</table>`;
}

/**
 * Once/sonra karsilastirma cubugu.
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
        <div style="font-size:13px;color:${MARKA.soluk};">${kacisla(r.etiket)}</div>
        <div class="soluk" style="font-size:13px;color:${MARKA.soluk};margin-top:4px;">ölçüm yok</div>
      </td></tr>`;
      }
      const tavan = Math.max(r.once, r.sonra, 1);
      const oncePct = Math.max(2, Math.round((r.once / tavan) * 100));
      const sonraPct = Math.max(2, Math.round((r.sonra / tavan) * 100));
      const iyi = r.tersYon ? r.sonra < r.once : r.sonra > r.once;
      const sonraRenk = r.sonra === r.once ? MARKA.soluk : iyi ? MARKA.iyi : MARKA.kotu;
      const bicim = (n: number) => n.toLocaleString('tr-TR') + (r.birim ?? '');

      const cubuk = (pct: number, renk: string, deger: string, kalin: boolean) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:5px 0;">
          <tr>
            <td width="72%" style="width:72%;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${MARKA.ray};border-radius:5px;">
                <tr><td width="${pct}%" style="width:${pct}%;height:9px;line-height:9px;font-size:0;background:${renk};border-radius:5px;">&nbsp;</td><td>&nbsp;</td></tr>
              </table>
            </td>
            <td width="28%" align="right" style="width:28%;padding-left:10px;font-family:${FONT};font-size:13px;font-weight:${kalin ? 700 : 500};color:${kalin ? MARKA.ink : MARKA.soluk};font-variant-numeric:tabular-nums;white-space:nowrap;">${deger}</td>
          </tr>
        </table>`;

      return `
      <tr><td style="padding:12px 0;font-family:${FONT};">
        <div class="metin" style="font-size:13px;font-weight:600;color:${MARKA.govde};margin-bottom:2px;">${kacisla(r.etiket)}</div>
        ${cubuk(oncePct, MARKA.ray === undefined ? '#ccc' : '#CFC7C0', bicim(r.once), false)}
        ${cubuk(sonraPct, sonraRenk, bicim(r.sonra), true)}
      </td></tr>`;
    })
    .join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  ${govde}
</table>`;
}

/**
 * Mini sutun grafigi — donem boyunca gunluk seyir.
 *
 * Her sutun sabit genislikte bir hucre; yukseklik `height` ile veriliyor
 * cunku CSS yuzde yukseklik e-postada guvenilmez. Veri yoksa hic cizilmez —
 * duz bir taban cizgisi "sifir" gibi okunurdu.
 */
export function sutunGrafik(seri: number[], etiket: string): string {
  const gecerli = seri.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (gecerli.length < 3) return '';
  const tavan = Math.max(...gecerli, 1);
  const YUKSEK = 56;

  const sutunlar = gecerli
    .map((n) => {
      const h = Math.max(2, Math.round((n / tavan) * YUKSEK));
      const bosluk = YUKSEK - h;
      return `<td valign="bottom" style="padding:0 1px;">
        <div style="height:${bosluk}px;line-height:${bosluk}px;font-size:0;">&nbsp;</div>
        <div style="height:${h}px;line-height:${h}px;font-size:0;background:${MARKA.primary};border-radius:2px 2px 0 0;">&nbsp;</div>
      </td>`;
    })
    .join('');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
  <tr><td class="soluk" style="font-family:${FONT};font-size:11px;color:${MARKA.soluk};text-transform:uppercase;letter-spacing:.5px;padding-bottom:8px;">${kacisla(etiket)}</td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:${YUKSEK}px;">
      <tr>${sutunlar}</tr>
    </table>
    <div style="border-top:1px solid ${MARKA.cizgi};margin-top:2px;"></div>
  </td></tr>
</table>`;
}

/** Ince ayrac — kutu icinde kutu yerine nefes alani. */
export const bolucu = () =>
  `<div class="cizgi" style="border-top:1px solid ${MARKA.cizgi};margin:28px 0;"></div>`;

/** Dikkat cekmesi gereken kisa not — uyari ya da ipucu. */
export function bilgiKutusu(baslik: string, metin: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background:#fff8f4;border-left:3px solid ${MARKA.primary};border-radius:0 8px 8px 0;">
  <tr>
    <td style="padding:14px 16px;font-family:${FONT};">
      <div style="font-size:13px;font-weight:700;color:${MARKA.ink};margin-bottom:3px;">${kacisla(baslik)}</div>
      <div style="font-size:13px;color:${MARKA.govde};line-height:1.55;">${metin}</div>
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
}

/**
 * Tam HTML belgesi.
 *
 * Karanlik mod: `color-scheme` meta'si ile istemciye belgeyi kendiliginden
 * ters cevirmemesini soyluyoruz (Gmail bunu yapinca beyaz kart uzerinde
 * beyaz metin cikabiliyor), ardindan medya sorgusuyla kendi karanlik
 * paletimizi veriyoruz. Destegi olmayan istemci acik temada kalir — bozulmaz.
 */
export function duzen(baslik: string, govde: string, s: DuzenSecenekleri = {}): string {
  const baseUrl = s.baseUrl ?? process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
  const yil = new Date().getFullYear();

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="tr">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${kacisla(baslik)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  /* Mobil: kenar bosluklarini daralt, dugmeyi tam genislige yaklastir */
  @media only screen and (max-width:600px) {
    .kap { width:100% !important; }
    .ped { padding-left:24px !important; padding-right:24px !important; }
    .olcu td { display:block !important; width:100% !important; border-bottom:1px solid ${MARKA.cizgi}; }
    .olcu td:last-child { border-bottom:0 !important; }
  }
  /* Karanlik mod — destekleyen istemcilerde */
  @media (prefers-color-scheme: dark) {
    .govde  { background:#141416 !important; }
    .kart   { background:#1c1c1f !important; border-color:#2a2a2e !important; }
    .metin  { color:#e6e4e1 !important; }
    .baslik { color:#ffffff !important; }
    .soluk  { color:#9a9a9f !important; }
    .cizgi  { border-color:#2a2a2e !important; }
    .zeminKutu { background:#232326 !important; border-color:#2f2f33 !important; }
  }
</style>
</head>
<body class="govde" style="margin:0;padding:0;background:${MARKA.zemin};-webkit-font-smoothing:antialiased;">

<!-- Onizleme metni: gelen kutusunda gorunur, mailin icinde gorunmez -->
<div style="display:none;font-size:1px;color:${MARKA.zemin};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${kacisla(s.onizleme ?? baslik)}
  <!-- Istemcinin devaminda HTML kirintisi gostermemesi icin dolgu -->
  &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="govde" style="background:${MARKA.zemin};">
  <tr>
    <td align="center" style="padding:44px 12px 56px;">

      <table role="presentation" class="kap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <!-- Kart. Cerceve YOK: kutu icinde kutu yerine bosluk. Ustteki ince
             marka seridi tek dekoratif oge — geri kalan her sey tipografi. -->
        <tr>
          <td class="kart" style="background:${MARKA.kart};border-radius:18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="height:3px;line-height:3px;font-size:0;background:${MARKA.primary};background-image:linear-gradient(90deg,${MARKA.gradBas},${MARKA.gradSon});border-radius:18px 18px 0 0;">&nbsp;</td>
              </tr>
              <tr>
                <td class="ped" style="padding:40px 44px 8px;font-family:${FONT};">
                  <a href="${baseUrl}" target="_blank" style="text-decoration:none;">
                    <span class="baslik" style="font-size:15px;font-weight:700;letter-spacing:-.2px;color:${MARKA.ink};">Ranks</span><span style="font-size:15px;font-weight:700;letter-spacing:-.2px;color:${MARKA.primary};">Up</span>
                  </a>
                </td>
              </tr>
              <tr>
                <td class="ped metin" style="padding:20px 44px 44px;font-family:${FONT};font-size:16px;line-height:1.62;color:${MARKA.govde};">
                  ${govde}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Altbilgi -->
        <tr>
          <td class="ped soluk" style="padding:26px 8px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${MARKA.soluk};">
            <a href="${baseUrl}/dashboard" style="color:${MARKA.soluk};text-decoration:underline;">Panel</a>
            &nbsp;·&nbsp;
            <a href="${baseUrl}/billing" style="color:${MARKA.soluk};text-decoration:underline;">Abonelik</a>
            &nbsp;·&nbsp;
            <a href="${baseUrl}/help" style="color:${MARKA.soluk};text-decoration:underline;">Yardım</a>
            ${
              s.cikisUrl
                ? `&nbsp;·&nbsp;<a href="${s.cikisUrl}" style="color:${MARKA.soluk};text-decoration:underline;">Bildirimleri durdur</a>`
                : ''
            }
            <div style="margin-top:10px;">
              © ${yil} RanksUp · <a href="${baseUrl}" style="color:${MARKA.soluk};text-decoration:underline;">ranksup.ai</a>
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
  `<p class="metin" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.62;color:${MARKA.govde};">${metin}</p>`;

export const h = (metin: string) =>
  `<h1 class="baslik" style="margin:0 0 18px;font-family:${FONT};font-size:28px;font-weight:700;line-height:1.18;letter-spacing:-.7px;color:${MARKA.ink};">${kacisla(metin)}</h1>`;

/** Baslik ustu kucuk etiket — "HAFTALIK RAPOR" gibi. */
export const etiket = (metin: string) =>
  `<div class="soluk" style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${MARKA.soluk};">${kacisla(metin)}</div>`;

export const liste = (maddeler: string[]) =>
  `<ul class="metin" style="margin:0 0 18px;padding-left:20px;font-family:${FONT};font-size:16px;line-height:1.7;color:${MARKA.govde};">${maddeler
    .map((m) => `<li style="margin-bottom:6px;">${m}</li>`)
    .join('')}</ul>`;

export const baglanti = (metin: string, href: string) =>
  `<a href="${href}" target="_blank" style="color:${MARKA.primary};text-decoration:underline;font-weight:600;">${kacisla(metin)}</a>`;
