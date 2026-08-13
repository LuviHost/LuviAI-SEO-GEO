import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_PLANS, PURCHASABLE_PLAN_IDS } from './plans.js';

/**
 * SEO metadata'sindaki fiyatlar plans.ts ile senkron mu?
 *
 * NEDEN VAR: /pricing sayfasinin metadata'si ve schema.org Offer blogu
 * crawler icin STATIK olmak zorunda, yani fiyatlar oraya elle yaziliyor.
 * Elle yazilan her sey kaydi: sayfa Google'a AggregateOffer olarak
 * ₺1.499 - ₺34.999 yayinlarken gercek fiyatlar $149 - $1.499'du (TL
 * karsiligi ~₺7.100 - ~₺71.600). Yani arama sonucunda gorunen fiyat
 * gercegin bes'te biriydi.
 *
 * Ayni sapma /compare, /terms ve /help/billing sayfalarinda da bulundu.
 * Bu test, plans.ts'teki fiyat degistiginde SEO metadata'sini guncellemeyi
 * unutmayi imkansiz kilar.
 */

const SEO_FILE = join(
  process.cwd(), '..', 'web', 'src', 'app', '(marketing)', 'pricing', 'layout.tsx',
);

describe('SEO fiyat senkronu', () => {
  const mevcut = existsSync(SEO_FILE);

  it('pricing layout dosyasi bulunabiliyor', () => {
    expect(mevcut, `bulunamadi: ${SEO_FILE}`).toBe(true);
  });

  it.runIf(mevcut)('satin alinabilir her planin USD fiyati metadata da geciyor', () => {
    const icerik = readFileSync(SEO_FILE, 'utf8');
    for (const id of PURCHASABLE_PLAN_IDS) {
      const plan = BASE_PLANS.find((p) => p.id === id)!;
      expect(
        icerik.includes(`'${plan.monthly_usd}'`),
        `${plan.name_tr} fiyati (${plan.monthly_usd}) SEO metadata'sinda yok — plans.ts degisti ama layout.tsx guncellenmedi`,
      ).toBe(true);
    }
  });

  it.runIf(mevcut)('schema.org fiyat araligi gercek en dusuk/en yuksek plani gosteriyor', () => {
    const icerik = readFileSync(SEO_FILE, 'utf8');
    const ucretliler = BASE_PLANS.filter((p) => p.monthly_usd > 0);
    const enDusuk = Math.min(...ucretliler.map((p) => p.monthly_usd));
    const enYuksek = Math.max(...ucretliler.map((p) => p.monthly_usd));
    expect(icerik).toContain(`lowPrice: '${enDusuk}'`);
    expect(icerik).toContain(`highPrice: '${enYuksek}'`);
  });

  it.runIf(mevcut)('para birimi USD — TL gunun kuruyla hesaplandigi icin schema ya yazilamaz', () => {
    const icerik = readFileSync(SEO_FILE, 'utf8');
    expect(icerik).toContain("priceCurrency: 'USD'");
    expect(
      icerik.includes("priceCurrency: 'TRY'"),
      'schema.org fiyati TRY olamaz: TL karsiligi her gun degisir, statik metadata bayatlar',
    ).toBe(false);
  });

  it.runIf(mevcut)('artik kullanilmayan plan adlari SEO metinlerinde gecmiyor', () => {
    const icerik = readFileSync(SEO_FILE, 'utf8');
    const gecerliAdlar = new Set(BASE_PLANS.map((p) => p.name_tr));
    // 'Baslangic' plans.ts'te 'Buyume' olarak degistirilmisti ama SEO
    // basliginda aylarca eski adla kaldi.
    expect(gecerliAdlar.has('Başlangıç')).toBe(false);
    expect(
      icerik.includes('Başlangıç'),
      "SEO metadata'sinda artik var olmayan 'Başlangıç' plan adi geciyor",
    ).toBe(false);
  });
});
