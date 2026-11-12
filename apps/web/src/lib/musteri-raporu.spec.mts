/**
 * Musteri raporu — web yardimcilari: bolum (sayfa) sirasi, bicim, paylasim.
 * NEDEN VAR: rapor musteriye PDF olarak gider; olculmeyen deger "0" diye
 * basilmamali, bolumler kagitta ayri sayfadan baslamali, paylasim tokeni
 * API ile ayni kuralla dogrulanmali.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RAPOR_TOKEN_DESENI, asistanSayilari, gecerliRaporTokeni, hucreSayisi, kalanGun, kalanOrnek, kpiMetni, paylasimAdresi, raporBolumleri,
  skorTonu, trSayi, trTarih, type MusteriRaporu,
} from './musteri-raporu';

const rapor = {
  generatedAt: '2026-10-22T10:00:00.000Z',
  kaynaklar: {
    tarama: '2026-10-21T09:12:00.000Z',
    aiOlcum: null,
    aiOranlari: { baslangic: '2026-10-15T10:00:00.000Z', bitis: '2026-10-22T10:00:00.000Z' },
    botZiyaret: { baslangic: '2026-09-22T10:00:00.000Z', bitis: '2026-10-22T10:00:00.000Z' },
    ajanHazirligi: null,
  },
} as unknown as MusteriRaporu;

describe('raporBolumleri — ekran ve kagit ayni sira', () => {
  it('kapak, ozet, SEO, GEO, AI, aksiyon, yontem; kapak ve ozet kendi sayfasinda, sonrakiler kaldigi sayfada devam', () => {
    const b = raporBolumleri(rapor);
    expect(b.map((x) => x.id)).toEqual(['kapak', 'ozet', 'seo', 'geo', 'ai', 'aksiyon', 'yontem']);
    // ozet yeni sayfa → kapak tek basina; SEO yeni sayfa → ozet tek basina.
    // Digerleri her biri yeni sayfadan baslarsa kisa bolum sonlari bos sayfa birakir.
    expect(b.filter((x) => x.yeniSayfa).map((x) => x.id)).toEqual(['ozet', 'seo']);
    expect(b.map((x) => x.baslik)).toContain('Yönetici özeti');
  });

  it('olculmeyen bolum de listelenir; veri tarihi kaynaktan (AI olculmediyse null)', () => {
    const b = Object.fromEntries(raporBolumleri(rapor).map((x) => [x.id, x]));
    expect(b.ai.veriTarihi).toBeNull();
    expect(b.seo.veriTarihi).toBe('2026-10-21T09:12:00.000Z');
  });
});

describe('baski kurallari (globals.css)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  it('baskida yalniz rapor kopyasi; bolum basina yeni sayfa; A4 adli sayfa', () => {
    expect(css).toContain('body:has(> .rapor-baski) > *:not(.rapor-baski)');
    expect(css).toMatch(/\.rapor-baski \.rapor-yeni-sayfa\s*\{\s*break-before: page;/);
    expect(css).toMatch(/@page rapor\s*\{\s*size: A4;/);
  });
  it('sayfa sonu kurallari: kart/satir bolunmez, bolum basligi ilk blogundan ayrilmaz, tek satir sayfada kalmaz', () => {
    const baski = css.slice(css.indexOf('MUSTERI RAPORU'));
    expect(baski).toMatch(/\.rapor-baski \.rapor-blok,\s*\.rapor-baski li,\s*\.rapor-baski tr\s*\{\s*break-inside: avoid;/);
    expect(baski).toMatch(/\.rapor-baski \.rapor-bolum-baslik\s*\{[^}]*break-after: avoid;/);
    expect(baski).toMatch(/\.rapor-baski h2,\s*\.rapor-baski h3\s*\{\s*break-after: avoid;/);
    expect(baski).toMatch(/\.rapor-baski p\s*\{\s*orphans: 3;\s*widows: 3;/);
    // Devam eden bolum sayfa kirmaz (yalniz bosluk)
    const devam = baski.match(/\.rapor-baski \.rapor-devam\s*\{([^}]*)\}/);
    expect(devam?.[1]).toBeDefined();
    expect(devam![1]).not.toContain('break-before');
  });
  it('tarayicinin ust bilgisi (tarih-saat + sayfa basligi) basilmaz: ust kenar kutusu tanimli; kenarlar beyaz', () => {
    const sayfa = css.slice(css.indexOf('@page rapor'));
    // Chrome, yazarin kenar kutusu tanimladigi kenarda kendi ust/alt bilgisini basmaz
    expect(sayfa).toMatch(/@top-left\s*\{\s*content: '';\s*\}/);
    expect(sayfa).toMatch(/@bottom-left\s*\{\s*content: 'RanksUp · Site Raporu';/);
    expect(sayfa).toMatch(/@page rapor\s*\{[^@]*background: #fff;/);
  });
  it('belge acik tema token larini tasir (koyu temada da beyaz kagit)', () => {
    expect(css).toMatch(/:root,\s*\.rapor-kagit\s*\{\s*--background: 0 0% 100%;/);
  });
});

describe('bicim', () => {
  it('trTarih Istanbul saatine gore; bos/gecersiz "—"', () => {
    expect(trTarih('2026-10-21T22:30:00Z')).toBe('22 Ekim 2026');
    expect(trTarih(null)).toBe('—');
    expect(trTarih('bozuk')).toBe('—');
  });
  it('trSayi binlik nokta, ondalik virgul', () => {
    expect(trSayi(1040)).toBe('1.040');
    expect(trSayi(33.333)).toBe('33,3');
    expect(trSayi(0)).toBe('0');
  });
  it('kpiMetni: olculmeyen "—" (0 degil), yuzde onde', () => {
    expect(kpiMetni({ deger: null, sonek: '%' })).toEqual({ deger: '—', sonek: null });
    expect(kpiMetni({ deger: 0, sonek: null })).toEqual({ deger: '0', sonek: null });
    expect(kpiMetni({ deger: 33.3, sonek: '%' })).toEqual({ deger: '%33,3', sonek: null });
    expect(kpiMetni({ deger: 76, sonek: '/100' })).toEqual({ deger: '76', sonek: '/100' });
  });
  it('skorTonu panel esikleri', () => {
    expect([skorTonu(null), skorTonu(80), skorTonu(50), skorTonu(49)]).toEqual(['muted', 'success', 'warning', 'danger']);
  });
  it('kalanOrnek yalniz sayfa biriminde ve sayi biliniyorsa', () => {
    expect(kalanOrnek({ sayi: 24, ornekler: ['a', 'b'], birim: 'sayfa' })).toBe(22);
    expect(kalanOrnek({ sayi: 772, ornekler: ['a'], birim: 'görsel' })).toBe(0);
    expect(kalanOrnek({ sayi: null, ornekler: [], birim: 'sayfa' })).toBe(0);
  });
});

describe('AI olcumu: soru ve yanit sayilari ayri', () => {
  const deepseek = { alintiSayisi: 7, anilmaSayisi: 1, olculenSoru: 15, soruSayisi: 5, alintiSoru: 3, anilmaSoru: 1 };

  it('asistan satiri "15 soru" demez: 5 SORU, tekrarli olcumde ayrica 15 YANIT', () => {
    const m = asistanSayilari(deepseek, 3);
    expect(m.ana).toBe('3/5 soruda kaynak, 1/5 soruda yalnız marka adı');
    expect(m.ek).toBe('7/15 yanıtta kaynak, 1/15 yanıtta yalnız marka adı');
    expect(`${m.ana} ${m.ek}`).not.toContain('15 soru');
  });

  it('hic gorunmeyen asistan tek kisa cumle; sifirlar tekrarlanmaz', () => {
    expect(asistanSayilari({ alintiSayisi: 0, anilmaSayisi: 0, olculenSoru: 15, soruSayisi: 5, alintiSoru: 0, anilmaSoru: 0 }, 3))
      .toEqual({ ana: '5 sorunun hiçbirinde görünmedi', ek: null });
  });

  it('tek turluk olcumde yanit satiri yok (soru = yanit); yalniz gorulen tur yazilir', () => {
    expect(asistanSayilari({ alintiSayisi: 1, anilmaSayisi: 0, olculenSoru: 3, soruSayisi: 3, alintiSoru: 1, anilmaSoru: 0 }, 1))
      .toEqual({ ana: '1/3 soruda kaynak', ek: null });
    expect(asistanSayilari({ alintiSayisi: 0, anilmaSayisi: 3, olculenSoru: 3, soruSayisi: 3, alintiSoru: 0, anilmaSoru: 3 }, 1))
      .toEqual({ ana: '3/3 soruda yalnız marka adı', ek: null });
  });

  it('eski paylasim kaydi (soru bazli alan yok): sayi "yanıt" diye adlandirilir', () => {
    expect(asistanSayilari({ alintiSayisi: 7, anilmaSayisi: 0, olculenSoru: 15 }, 1)).toEqual({ ana: '7 kaynak · 0 anılma · 15 yanıt', ek: null });
  });

  it('soru tablosu hucresi: tekrarli olcumde "2/3"; tek turda, eski kayitta ve gorunmeyen hucrede sayi yok', () => {
    expect(hucreSayisi('alinti', { yanit: 3, alinti: 2, anilma: 0 }, 3)).toBe('2/3');
    expect(hucreSayisi('anilma', { yanit: 2, alinti: 0, anilma: 1 }, 3)).toBe('1/2');
    expect(hucreSayisi('yok', { yanit: 3, alinti: 0, anilma: 0 }, 3)).toBeNull();
    expect(hucreSayisi('olculemedi', { yanit: 0, alinti: 0, anilma: 0 }, 3)).toBeNull();
    expect(hucreSayisi('alinti', { yanit: 1, alinti: 1, anilma: 0 }, 1)).toBeNull();
    expect(hucreSayisi('alinti', undefined, 3)).toBeNull();
  });
});

describe('rapor belgesi: musteriye yanlis okunan etiketler', () => {
  const belge = readFileSync(new URL('../components/musteri-raporu/rapor-belgesi.tsx', import.meta.url), 'utf8');

  it('rakip listesi "Takip edilen rakipler" diye sunulmaz (kurulumda otomatik onerilir, onaylanmamistir)', () => {
    expect(belge).not.toContain('Takip edilen rakipler');
    expect(belge).toContain('Karşılaştırma için tanımlı rakipler');
    expect(belge).toContain('kesinleşmiş bir liste olarak okunmamalıdır');
  });

  it('takvim sayisi kimin takvimi oldugunu soyler', () => {
    expect(belge).toContain('RanksUp içerik takvimi');
    expect(belge).not.toContain('etiket="Takvimde"');
  });

  it('kapak ikonu hemen yuklenir: gizli baski kopyasinda tembel gorsel hic istenmez, kutu bos basilir', () => {
    expect(belge).toMatch(/<SiteFavicon[^>]*\beager\b/);
    const ikon = readFileSync(new URL('../components/site-favicon.tsx', import.meta.url), 'utf8');
    expect(ikon).toContain("loading={eager ? 'eager' : 'lazy'}");
  });

  it('bilgi amacli kontroller ayri listelenir', () => {
    expect(belge).toContain('Bilgi amaçlı kontroller');
    expect(belge).toContain('seo.bilgiKontrolleri ?? []');
  });
});

describe('paylasim', () => {
  it('token deseni API ile ayni', () => {
    const api = readFileSync(new URL('../../../api/src/client-report/client-report-share.ts', import.meta.url), 'utf8');
    expect(api).toContain(`RAPOR_TOKEN_DESENI = ${RAPOR_TOKEN_DESENI.toString()};`);
    expect(gecerliRaporTokeni('A'.repeat(32))).toBe(true);
    expect(gecerliRaporTokeni('../etc/passwd-xxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
    expect(gecerliRaporTokeni('kisa')).toBe(false);
  });
  it('adres panelin kokeninden; kalan gun yukari yuvarlanir, dolduysa 0', () => {
    expect(paylasimAdresi('https://ranksup.ai/', { token: 'T'.repeat(32) })).toBe(`https://ranksup.ai/rapor/${'T'.repeat(32)}`);
    const simdi = Date.parse('2026-10-22T10:00:00Z');
    expect(kalanGun('2026-10-23T09:00:00Z', simdi)).toBe(1);
    expect(kalanGun('2026-11-21T10:00:00Z', simdi)).toBe(30);
    expect(kalanGun('2026-10-21T10:00:00Z', simdi)).toBe(0);
  });
});
