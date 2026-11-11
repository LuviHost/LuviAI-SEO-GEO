import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_PLANS, PURCHASABLE_PLAN_IDS, publicPlans } from './plans.js';

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
 *
 * PAKET YAPISI (11.11.2026, plans.ts): uc ucretli plan — Baslangic, Profesyonel,
 * Kurumsal. Musterinin FIYAT gordugu planlar herkese acik (publicPlans), ucretli
 * ve teklifle satilmayan planlardir: Baslangic $99 ve Profesyonel $349. Kurumsal
 * teklifle satilir (liste fiyati hicbir musteri metninde ve yapisal veride
 * yazilmaz), Ajans satistan kalkti. Fiyat araligi ve Offer listesi bu kuraldan
 * turer; eskiden butun ucretli planlar uzerinden hesaplaniyordu ($149 – $1.499).
 */

const SEO_FILE = join(
  process.cwd(), '..', 'web', 'src', 'app', '(marketing)', 'pricing', 'layout.tsx',
);

/** Musterinin fiyat gordugu planlar: herkese acik, ucretli, teklifle degil */
const FIYATLI = publicPlans().filter((p) => p.monthly_usd > 0 && !p.contactSales);
/** Fiyati gosterilmeyen planlar: teklifle satilan (Kurumsal) ve satistan kalkan (Ajans) */
const FIYATSIZ = BASE_PLANS.filter((p) => p.monthly_usd > 0 && (p.contactSales || p.legacy));

/** Yorumlar neyin neden kaldirildigini anlatir (eski fiyatlar dahil); yalniz kod taranir */
function kod(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

describe('SEO fiyat senkronu', () => {
  const mevcut = existsSync(SEO_FILE);

  it('pricing layout dosyasi bulunabiliyor', () => {
    expect(mevcut, `bulunamadi: ${SEO_FILE}`).toBe(true);
  });

  it('fiyat gosterilen planlar = satin alinabilir planlar (Baslangic, Profesyonel)', () => {
    expect(FIYATLI.map((p) => p.id)).toEqual(PURCHASABLE_PLAN_IDS);
    expect(FIYATLI.map((p) => p.id)).toEqual(['starter', 'pro']);
    expect(FIYATSIZ.map((p) => p.id).sort()).toEqual(['agency', 'enterprise']);
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

  it.runIf(mevcut)('schema.org Offer listesi: fiyat gosterilen her plan adi ve fiyatiyla, baska plan yok', () => {
    const icerik = kod(readFileSync(SEO_FILE, 'utf8'));
    const offerlar = [...icerik.matchAll(/\{ name: '([^']+)',\s*price: '(\d+)',/g)].map((m) => ({ ad: m[1], fiyat: Number(m[2]) }));
    expect(offerlar).toEqual(FIYATLI.map((p) => ({ ad: p.name_tr, fiyat: p.monthly_usd })));
    expect(icerik).toContain('offerCount: PLANS.length,');
  });

  it.runIf(mevcut)('schema.org fiyat araligi musterinin fiyat gordugu en dusuk/en yuksek plani gosteriyor', () => {
    const icerik = readFileSync(SEO_FILE, 'utf8');
    const enDusuk = Math.min(...FIYATLI.map((p) => p.monthly_usd));
    const enYuksek = Math.max(...FIYATLI.map((p) => p.monthly_usd));
    expect(icerik).toContain(`lowPrice: '${enDusuk}'`);
    expect(icerik).toContain(`highPrice: '${enYuksek}'`);
  });

  it.runIf(mevcut)('baslik ve aciklama fiyat gosterilen her plani adi ve fiyatiyla yaziyor', () => {
    const icerik = kod(readFileSync(SEO_FILE, 'utf8'));
    const baslik = icerik.match(/\n {2}title: '([^']*)',/)?.[1] ?? '';
    const aciklama = icerik.match(/\n {2}description: '([^']*)',/)?.[1] ?? '';
    for (const p of FIYATLI) {
      expect(baslik, `baslik: ${p.id}`).toContain(`${p.name_tr} $${p.monthly_usd}`);
      expect(aciklama, `aciklama: ${p.id}`).toContain(`${p.name_tr} $${p.monthly_usd}`);
    }
  });

  it.runIf(mevcut)('teklifle satilan ve satistan kalkan planin fiyati hicbir bicimde yazilmiyor', () => {
    const icerik = kod(readFileSync(SEO_FILE, 'utf8'));
    for (const p of FIYATSIZ) {
      for (const n of [p.monthly_usd, p.annual_usd]) {
        const yazimlar = [...new Set([String(n), n.toLocaleString('tr-TR'), n.toLocaleString('en-US')])];
        for (const y of yazimlar) {
          expect(icerik.includes(`'${y}'`), `${p.name_tr} fiyati '${y}' yapisal veride`).toBe(false);
          expect(icerik.includes(`$${y}`), `${p.name_tr} fiyati $${y} metinde`).toBe(false);
        }
      }
    }
    // Teklifle satilan plan (Kurumsal) fiyatsiz anilir: "teklifle"
    for (const p of FIYATSIZ.filter((x) => x.contactSales)) expect(icerik).toContain(`${p.name_tr} teklifle`);
    // Satistan kalkan plan (Ajans) SEO metinlerinde plan olarak anilmaz
    for (const p of FIYATSIZ.filter((x) => x.legacy)) {
      expect(icerik.includes(`'${p.name_tr}'`), `satistan kalkan ${p.name_tr} Offer listesinde`).toBe(false);
      expect(new RegExp(`${p.name_tr} (?:\\$|planı|teklifle)`).test(icerik), `satistan kalkan ${p.name_tr} baslik/aciklamada`).toBe(false);
    }
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
    const icerik = kod(readFileSync(SEO_FILE, 'utf8'));
    const gecerliAdlar = new Set(BASE_PLANS.map((p) => p.name_tr));
    // Giris planinin adi iki kez degisti: 'Başlangıç' -> 'Büyüme' (SEO basliginda aylarca eski adla
    // kaldi) ve 11.11.2026'da yeniden 'Başlangıç'. Bugun var olmayan ad 'Büyüme'.
    expect(gecerliAdlar.has('Büyüme')).toBe(false);
    expect(gecerliAdlar.has('Başlangıç')).toBe(true);
    expect(
      icerik.includes('Büyüme'),
      "SEO metadata'sinda artik var olmayan 'Büyüme' plan adi geciyor",
    ).toBe(false);
    // SEO metinlerinde gecen her plan adi bugunku herkese acik planlardan biri
    for (const m of icerik.matchAll(/\{ name: '([^']+)',\s*price:/g)) {
      expect(publicPlans().some((p) => p.name_tr === m[1]), `Offer adi plans.ts'te yok: ${m[1]}`).toBe(true);
    }
  });
});
