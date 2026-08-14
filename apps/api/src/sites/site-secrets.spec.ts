import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

/**
 * Site cevabindan sir sizmasin — ve omit tablosu SEMAYLA uyumlu kalsin.
 *
 * NEDEN VAR: SITE_SECRET_FIELDS once `as const` ile yazilmisti ve icinde
 * semada olmayan bir alan vardi (metaAccessToken; dogrusu metaAdsAccessToken).
 * TypeScript yakalamadi cunku fazla-ozellik kontrolu yalnizca satir ici nesne
 * literaline uygulanir, degiskene degil. Sonuc: tsc temiz, ama Prisma calisma
 * aninda dogrulama hatasi atti -> GET /api/sites 500 dondu -> panelde site
 * listesi BOS gorundu. Sayac baska bir uctan geldigi icin "11 site" yaziyordu,
 * yani hata sessiz kaldi ve ancak ekrana bakinca fark edildi.
 *
 * Bu test iki seyi birden kilitler: alan adlari semada GERCEKTEN var mi, ve
 * bilinen her sir alani listede mi.
 */

const KAYNAK = new URL('./sites.service.ts', import.meta.url);

function omitAlanlari(): string[] {
  const src = readFileSync(KAYNAK, 'utf8');
  const blok = src.slice(
    src.indexOf('const SITE_SECRET_FIELDS'),
    src.indexOf('};', src.indexOf('const SITE_SECRET_FIELDS')),
  );
  return [...blok.matchAll(/^\s*(\w+):\s*true,/gm)].map((m) => m[1]);
}

describe('SITE_SECRET_FIELDS', () => {
  const alanlar = omitAlanlari();
  const siteAlanlari = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Site')!.fields;
  const semaAlanlari = new Set(siteAlanlari.map((f) => f.name));

  it('bos degil', () => {
    expect(alanlar.length).toBeGreaterThan(0);
  });

  it('her alan Site modelinde GERCEKTEN var', () => {
    for (const a of alanlar) {
      expect(semaAlanlari.has(a), `'${a}' Site modelinde yok — Prisma calisma aninda patlar`).toBe(true);
    }
  });

  it('bilinen tum sir alanlari listede — yeni sir eklenip unutulmasin', () => {
    // Adinda token/secret gecen SKALER STRING alanlar sir kabul edilir.
    // Iliskiler haric: 'tokenUsage' bir TokenUsageRecord[] iliskisi, sir degil.
    const supheliler = siteAlanlari
      .filter((f) => f.kind === 'scalar' && f.type === 'String' && /token|secret/i.test(f.name))
      .map((f) => f.name);
    for (const f of supheliler) {
      expect(alanlar, `'${f}' bir sir gibi duruyor ama omit listesinde yok`).toContain(f);
    }
  });

  it('tip acikca yazili — as const kullanilmamis', () => {
    const src = readFileSync(KAYNAK, 'utf8');
    // `as const` ile yazilirsa yanlis alan adi derlemede yakalanmaz; bu bug
    // tam olarak oyle kacmisti.
    expect(src).toContain('const SITE_SECRET_FIELDS: Prisma.SiteOmit');
    expect(
      /const SITE_SECRET_FIELDS[^=]*=\s*\{[\s\S]*?\}\s*as const/.test(src),
      'SITE_SECRET_FIELDS `as const` ile yazilmis — yanlis alan adi derlemede yakalanmaz',
    ).toBe(false);
  });
});
