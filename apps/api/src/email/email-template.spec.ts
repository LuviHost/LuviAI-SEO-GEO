import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EmailService, gscGunAraligi, type EmailTemplate } from './email.service.js';
import {
  duzen, dugme, olcuSatiri, kacisla, kahramanOlcu, karsilastirmaCubugu, sutunGrafik, MARKA,
} from './email-layout.js';

/**
 * E-posta sablonlari.
 *
 * NEDEN VAR: sablonlarin uc somut sorunu vardi ve ucu de sessizdi —
 * derleme gecerdi, test yoktu, kimse maili acip bakmadi:
 *
 *  1. MARKA YANLISTI. Govde #6c5ce7 (mor) kullaniyordu; RanksUp turuncu.
 *     Altbilgide "© 2026 LuviHost" yaziyordu. Mailler baska bir urunun
 *     maili gibi duruyordu.
 *  2. monthly_report tip listesinde vardi ama switch'te CASE'I YOKTU —
 *     gonderilen her aylik rapor sessizce "RanksUp bildirimi" basligiyla
 *     bos govdeye dusuyordu.
 *  3. Onizleme metni (preheader) yoktu; gelen kutusunda konu satirinin
 *     yaninda HTML kirintisi gorunuyordu.
 */

const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
const render = (t: EmailTemplate, d: Record<string, any> = {}) =>
  (svc as any).renderTemplate(t, d) as { subject: string; html: string };

/** Tip birlesiminde tanimli TUM sablonlar — kaynaktan okunur, elle yazilmaz. */
function tumSablonlar(): string[] {
  const src = readFileSync(new URL('./email.service.ts', import.meta.url), 'utf8');
  const blok = src.slice(src.indexOf('export type EmailTemplate'), src.indexOf(';', src.indexOf('export type EmailTemplate')));
  return [...blok.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe('sablon kapsami', () => {
  const sablonlar = tumSablonlar();

  it('tip listesi bos degil', () => {
    expect(sablonlar.length).toBeGreaterThan(10);
  });

  it('HER sablonun kendi case\'i var — hicbiri varsayilana dusmuyor', () => {
    // monthly_report tam olarak boyle kacmisti: tipte vardi, case'i yoktu.
    const varsayilan = render('bilinmeyen' as EmailTemplate).subject;
    for (const t of sablonlar) {
      const { subject } = render(t as EmailTemplate, { name: 'Test', title: 'Baslik', planName: 'Pro' });
      expect(subject, `${t} varsayilan govdeye dusuyor`).not.toBe(varsayilan);
    }
  });

  it('her sablon dolu bir konu ve govde uretiyor', () => {
    for (const t of sablonlar) {
      const { subject, html } = render(t as EmailTemplate, { name: 'Test', title: 'Baslik' });
      expect(subject.length, `${t} konusu bos`).toBeGreaterThan(5);
      expect(html.length, `${t} govdesi cok kisa`).toBeGreaterThan(1000);
    }
  });

  it('hicbir sablon Gmail kirpma sinirina (102KB) yaklasmiyor', () => {
    for (const t of sablonlar) {
      const { html } = render(t as EmailTemplate, { name: 'Test', title: 'Baslik' });
      const kb = Buffer.byteLength(html, 'utf8') / 1024;
      expect(kb, `${t} ${kb.toFixed(1)}KB — Gmail 102KB uzerini kirpar`).toBeLessThan(60);
    }
  });
});

describe('marka tutarliligi', () => {
  const sablonlar = tumSablonlar();

  it('eski mor marka rengi HICBIR sablonda kalmamis', () => {
    for (const t of sablonlar) {
      const { html } = render(t as EmailTemplate, { name: 'Test', title: 'Baslik' });
      expect(html.toLowerCase(), `${t} hala mor #6c5ce7 kullaniyor`).not.toContain('#6c5ce7');
    }
  });

  it('altbilgide LuviHost degil RanksUp yaziyor', () => {
    const { html } = render('welcome_day0', { name: 'Test' });
    expect(html).not.toContain('LuviHost');
    expect(html).toContain('RanksUp');
    expect(html).toContain('ranksup.ai');
  });

  it('marka rengi uygulamanin turuncusuyla ayni', () => {
    // Sitenin birincil eylem turuncusu: apps/web globals.css --brand-vivid (21 100% 50%, #FF5800).
    // 15.11.2026'ya kadar e-posta eski logo paletini (#E04E24 + degrade) kullaniyordu.
    expect(MARKA.primary).toBe('#FF5800');
    // Koyu zemin sitenin koyu tema belirtecleriyle ayni (globals.css .dark)
    expect(MARKA.zemin).toBe('#090909');
    expect(MARKA.kart).toBe('#111111');
    expect(Object.keys(MARKA)).not.toContain('gradBas');
  });
});

describe('e-posta istemcisi uyumlulugu', () => {
  const { html } = render('article_ready', {
    name: 'Test', title: 'Baslik', wordCount: 100, publicUrl: 'https://ornek.test/a',
  });

  it('yerlesim TABLO ile — flexbox/grid Outlook\'ta calismaz', () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('dugme tablo + mso kosullu yorumu iceriyor', () => {
    // <a>'ya padding vermek Outlook'ta tiklanabilir alan olusturmaz.
    expect(html).toContain('v:roundrect');
    expect(html).toContain('w:anchorlock');
  });

  it('onizleme metni var ve gizli', () => {
    expect(html).toMatch(/display:none;font-size:1px/);
    expect(html).toContain('Editörden geçti');
  });

  // 15.11.2026: belge YALNIZ koyu (site dili). Istemciye "bunu cevirme" denir; acik tema
  // paleti ve ona gecis sorgusu yok. Zemin hem attribute hem style ile boyanir.
  it('belge yalniz koyu: color-scheme dark, zemin iki yoldan boyali', () => {
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    expect(html).toContain(':root { color-scheme: dark; }');
    expect(html).not.toContain('prefers-color-scheme');
    expect(html).toContain(`bgcolor="${MARKA.zemin}"`);
    expect(html).toContain(`background:${MARKA.zemin}`);
  });

  it('kompozisyon: logo ve altbilgi ortali; tek birincil dugme turuncu ve ok isaretli', () => {
    expect(html).toMatch(/<td align="center"[^>]*>\s*<a [^>]*>\s*<span[^>]*>Ranks<\/span><span[^>]*>Up<\/span>/);
    expect(html.split(`bgcolor="${MARKA.primary}"`).length - 1).toBe(1);
    expect(html).toContain('&nbsp;&rarr;</a>');
  });

  it('SVG yok — Gmail SVG\'yi siler', () => {
    expect(html).not.toContain('<svg');
  });

  it('dis kaynak yok — istemciler engeller', () => {
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script/);
  });
});

describe('adla baslayan basliklar — adi olmayan hesap "merhaba, …" gormez', () => {
  const metin = (html: string) => (html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] ?? '').trim();

  it('ad varsa "Ad, …"; ad yoksa ad ve virgul duser, ilk harf buyur (Turkce i → İ)', () => {
    expect(metin(render('trial_expired', { name: 'Ayşe' }).html)).toBe('Ayşe, deneme süren doldu');
    for (const name of [undefined, null, '', '   ']) {
      expect(metin(render('trial_expired', { name }).html), String(name)).toBe('Deneme süren doldu');
      expect(metin(render('trial_expiry_d13', { name }).html)).toBe('Deneme süren yarın bitiyor');
      expect(metin(render('welcome_day7', { name }).html)).toBe('İlk hafta doldu');
      expect(metin(render('payment_failed', { name }).html)).toBe('Ödemeni alamadık');
      expect(metin(render('welcome_day0', { name }).html)).toBe('Hoş geldin');
      expect(render('welcome_day0', { name }).subject).toBe("RanksUp'a hoş geldin");
      expect(metin(render('welcome_day1', { name }).html)).toBe('Selam');
    }
  });

  it('hicbir sablonun basligi "merhaba," ya da bos virgulle baslamaz', () => {
    for (const t of tumSablonlar()) {
      const baslik = metin(render(t as EmailTemplate, {}).html);
      expect(baslik, t).not.toMatch(/^merhaba\b/i);
      expect(baslik, t).not.toMatch(/^[,\s]/);
    }
  });
});

describe('kacislama', () => {
  it('kullanici/LLM metni HTML\'e sizmiyor', () => {
    const kotu = '<img src=x onerror=alert(1)>';
    const { html } = render('weekly_plan', { name: kotu, siteName: kotu, items: [kotu] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('makale basligi HTML\'de bir kez kacislanir; konu satiri duz metindir, kacislanmaz', () => {
    const { subject, html } = render('article_ready', { title: '<b>x</b>', publicUrl: 'https://a.test' });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    // Konu bir e-posta ust bilgisidir (HTML degil): kacislanirsa gelen kutusunda "&lt;b&gt;" gorunur
    expect(subject).toBe('Makalen hazır: <b>x</b>');
  });

  it('kesme isaretli / &\'li baslik ve ad CIFT kacislanmaz (canlida "SEO&#39;da 5 Hata" gorunuyordu)', () => {
    const baslik = "SEO'da 5 Hata & Çözümü";
    const makale = render('article_ready', { title: baslik, publicUrl: 'https://a.test' });
    expect(makale.subject).toBe(`Makalen hazır: ${baslik}`);
    expect(makale.html).toContain('SEO&#39;da 5 Hata &amp; Çözümü');
    const ilk = render('first_article_published', { title: baslik });
    const plan = render('weekly_plan', { siteName: "Koç & Koç", items: [] });
    expect(plan.subject).toBe('Bu haftanın planı: Koç & Koç');
    const hosgeldin = render('welcome_day0', { name: "O'Neil" });
    expect(hosgeldin.subject).toBe("RanksUp'a hoş geldin, O'Neil");
    for (const h of [makale.html, ilk.html, plan.html, hosgeldin.html]) {
      expect(h).not.toContain('&amp;#39;');
      expect(h).not.toContain('&amp;amp;');
    }
  });

  it('kacisla tek tirnagi da kapsiyor — attribute icine gomulebilir', () => {
    expect(kacisla(`a'b`)).toBe('a&#39;b');
  });
});

describe('olcu satiri — olculemedi != sifir', () => {
  it('null deger "—" basiyor, 0 basmiyor', () => {
    const h = olcuSatiri([{ etiket: 'Tiklama', deger: null }]);
    expect(h).toContain('—');
    expect(h).not.toMatch(/>0</);
  });

  it('gercek 0 degeri gizlenmiyor', () => {
    const h = olcuSatiri([{ etiket: 'Makale', deger: 0 }]);
    expect(h).toContain('>0<');
  });

  // Sahip (15.11.2026): "gösterimi, hizası, büyüklüğü düzenlenmeli" — sutunlar icerige gore
  // rastgele genisliyor, uc olculu kartta sag taraf bos kaliyordu.
  it('sutunlar esit genislikte; tek basina kartta ortali ve ayracli, bilesik kartta sola hizali', () => {
    const uc = olcuSatiri([{ etiket: 'Kelime', deger: '1.840' }, { etiket: 'FAQ', deger: 6 }, { etiket: 'Editör', deger: '81/90' }]);
    expect(uc).toContain('table-layout:fixed');
    expect(uc.split('width="33.33%"').length - 1).toBe(3);
    expect(uc.split('text-align:center').length - 1).toBe(3);
    // Ayrac yalniz sutunlar ARASINDA: ilk sutunda yok
    expect(uc.split('border-left:1px solid').length - 1).toBe(2);
    const dort = olcuSatiri([{ etiket: 'a', deger: 1 }, { etiket: 'b', deger: 2 }, { etiket: 'c', deger: 3 }, { etiket: 'd', deger: 4 }]);
    expect(dort.split('width="25.00%"').length - 1).toBe(4);
    // Deger satiri bolunmez ("81/90" iki satira inmez)
    expect(uc).toContain('white-space:nowrap');

    const icte = olcuSatiri([{ etiket: 'Gösterim', deger: '38.420' }, { etiket: 'Ort. sıra', deger: 14.2 }], { kart: false });
    expect(icte.split('width="50.00%"').length - 1).toBe(2);
    expect(icte).toContain('text-align:left');
    expect(icte).not.toContain('border-left:1px solid');
    expect(icte).not.toContain('text-align:center');
  });
});

describe('duzen kabugu', () => {
  it('cikis baglantisi verilince altbilgiye ekleniyor', () => {
    const h = duzen('Baslik', '<p>x</p>', { cikisUrl: 'https://ornek.test/cikis' });
    expect(h).toContain('https://ornek.test/cikis');
    expect(h).toContain('Bildirimleri durdur');
  });

  it('cikis baglantisi yoksa bos baglanti basmiyor', () => {
    const h = duzen('Baslik', '<p>x</p>');
    expect(h).not.toContain('Bildirimleri durdur');
  });

  it('konu basligi kacisliyor', () => {
    const h = duzen('<script>x</script>', '<p>y</p>');
    expect(h).not.toContain('<script>x</script>');
  });
});

/**
 * Grafik bilesenleri.
 *
 * E-postada SVG (Gmail siler) ve dis gorsel (istemciler engeller)
 * kullanilamaz; grafikler TABLO HUCRESIYLE ciziliyor. Bu testler cizimin
 * dogru olcekledigini ve "veri yok" durumunda duz bir taban cizgisi
 * uretmedigini sabitler — duz taban "sifir" gibi okunur.
 */
describe('grafik bilesenleri', () => {
  it('sutun grafik veri azken HIC cizilmiyor', () => {
    // 2 noktali bir "grafik" bilgi vermez, sadece sahte bir sekil uretir.
    expect(sutunGrafik([5, 9], 'x')).toBe('');
    expect(sutunGrafik([], 'x')).toBe('');
  });

  it('sutun grafik en yuksek degere gore olcekleniyor', () => {
    const h = sutunGrafik([10, 20, 40], 'Tiklama');
    // Tavan 40 -> 64px; 10 -> 16px, 20 -> 32px, 40 -> 64px
    expect(h).toContain('height:64px');
    expect(h).toContain('height:32px');
    expect(h).toContain('height:16px');
  });

  it('karsilastirma cubugu olculemeyeni cizmiyor, "olcum yok" yaziyor', () => {
    const h = karsilastirmaCubugu([{ etiket: 'GEO', once: null, sonra: 40 }]);
    expect(h).toContain('ölçüm yok');
    expect(h, 'olculemeyen satir icin cubuk cizilmis').not.toContain('width:100%;height:9px');
  });

  it('karsilastirma cubugunda iyilesme yesil, kotulesme kirmizi', () => {
    const artan = karsilastirmaCubugu([{ etiket: 'Skor', once: 60, sonra: 90 }]);
    expect(artan).toContain(MARKA.iyi);
    const azalan = karsilastirmaCubugu([{ etiket: 'Skor', once: 90, sonra: 60 }]);
    expect(azalan).toContain(MARKA.kotu);
  });

  it('sira metriginde YON TERS — sira kuculunce iyilesme sayiliyor', () => {
    const h = karsilastirmaCubugu([{ etiket: 'Ortalama sıra', once: 30, sonra: 12, tersYon: true }]);
    expect(h, 'sira dustu ama kotulesme gibi renklendirilmis').toContain(MARKA.iyi);
  });

  it('kahraman olcu null degeri tire basiyor, 0 basmiyor', () => {
    const h = kahramanOlcu({ deger: null, etiket: 'tiklama' });
    expect(h).toContain('&mdash;');
    expect(h).not.toMatch(/>0</);
  });

  it('kahraman olcu degisim yonunu renk ve okla veriyor', () => {
    const artis = kahramanOlcu({ deger: 100, etiket: 'x', degisim: { yon: 'artis', metin: '+10' } });
    expect(artis).toContain('&#9650;');
    expect(artis).toContain(MARKA.iyi);
  });
});

describe('haftalik rapor — grafikli', () => {
  it('onceki hafta olculmediyse fark GOSTERILMIYOR', () => {
    const { html } = render('weekly_report', { totalClicks: 5000, totalImpressions: 10000 });
    expect(html).toContain('Geçen hafta ölçüm yok');
    expect(html, 'sifirdan buyume gibi fark basilmis').not.toContain('geçen haftaya göre');
  });

  it('onceki hafta varsa fark hesaplaniyor', () => {
    const { html } = render('weekly_report', { totalClicks: 5000, prevClicks: 4000 });
    expect(html).toContain('geçen haftaya göre +1.000');
  });

  it('gunluk seri varsa sutun grafik ciziliyor', () => {
    const { html } = render('weekly_report', { totalClicks: 100, clicksSeries: [1, 5, 3, 8, 4, 6, 2] });
    expect(html).toContain('Günlük tıklama');
  });

  it('GSC gecikmesi: hangi gunlerin sayildigi yaziliyor', () => {
    const { html } = render('weekly_report', { totalClicks: 100, dataFrom: '2026-10-24', dataTo: '2026-10-30' });
    expect(html).toContain('Search Console verisi: 24–30 Ekim');
    expect(gscGunAraligi('2026-09-28', '2026-10-04')).toBe('28 Eylül – 4 Ekim');
  });
});
