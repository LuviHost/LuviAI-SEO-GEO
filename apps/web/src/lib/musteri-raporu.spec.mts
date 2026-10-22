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
  RAPOR_TOKEN_DESENI, gecerliRaporTokeni, kalanGun, kalanOrnek, kpiMetni, paylasimAdresi, raporBolumleri, skorTonu,
  trSayi, trTarih, type MusteriRaporu,
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
  it('kapak, ozet, SEO, GEO, AI, aksiyon, yontem; kapak disindaki her bolum yeni sayfa', () => {
    const b = raporBolumleri(rapor);
    expect(b.map((x) => x.id)).toEqual(['kapak', 'ozet', 'seo', 'geo', 'ai', 'aksiyon', 'yontem']);
    expect(b.filter((x) => x.yeniSayfa).map((x) => x.id)).toEqual(['ozet', 'seo', 'geo', 'ai', 'aksiyon', 'yontem']);
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
