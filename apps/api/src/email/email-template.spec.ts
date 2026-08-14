import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EmailService, type EmailTemplate } from './email.service.js';
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
    // apps/web/tailwind.config brand + brand-logo.tsx paleti
    expect(MARKA.primary).toBe('#E04E24');
    expect(MARKA.gradBas).toBe('#F36D32');
    expect(MARKA.gradSon).toBe('#B63325');
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

  it('karanlik mod bildirimi ve paleti var', () => {
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('SVG yok — Gmail SVG\'yi siler', () => {
    expect(html).not.toContain('<svg');
  });

  it('dis kaynak yok — istemciler engeller', () => {
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script/);
  });
});

describe('kacislama', () => {
  it('kullanici/LLM metni HTML\'e sizmiyor', () => {
    const kotu = '<img src=x onerror=alert(1)>';
    const { html } = render('weekly_plan', { name: kotu, siteName: kotu, items: [kotu] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('makale basligi konu satirinda kacisliyor', () => {
    const { subject, html } = render('article_ready', { title: '<b>x</b>', publicUrl: 'https://a.test' });
    expect(html).not.toContain('<b>x</b>');
    expect(subject).toContain('&lt;b&gt;');
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
    // Tavan 40 -> 56px; 10 -> 14px, 20 -> 28px, 40 -> 56px
    expect(h).toContain('height:56px');
    expect(h).toContain('height:28px');
    expect(h).toContain('height:14px');
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
});
