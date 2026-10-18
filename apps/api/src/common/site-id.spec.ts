import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isCanonicalSiteId, siteBucketKey, NON_CANONICAL_SITE_BUCKET, SITE_ID_MAX_LEN } from './site-id.js';

/**
 * Site kimliginin kanonik bicimi (common/site-id.ts).
 *
 * NEDEN VAR: sites tablosu utf8mb4_unicode_ci — 'CMSQ...', sonu bosluklu ya
 * da tam genislik yazim MySQL'de ayni satiri bulur; hiz siniri kovalari ise
 * ham dizeyle sayar. Her site icin kurala uyan TEK yazim olmali.
 */
const CANON = 'cmsq25bko005farswo54hf856'; // canli veritabanindaki gercek bicim (cuid, 25 karakter)
/** Ozel karakterler kaynakta gorunmez kalmasin diye kod noktasiyla uretilir */
const ch = (code: number) => String.fromCharCode(code);

describe('isCanonicalSiteId', () => {
  it('cuid, tohum kimligi ve test kimlikleri gecer', () => {
    expect(isCanonicalSiteId(CANON)).toBe(true);
    expect(isCanonicalSiteId('cjld2cjxh0000qzrmn831i7rn')).toBe(true);
    expect(isCanonicalSiteId('demo-luvihost')).toBe(true); // prisma/seed.ts
    expect(isCanonicalSiteId('s1')).toBe(true);
    expect(isCanonicalSiteId('a'.repeat(SITE_ID_MAX_LEN))).toBe(true);
  });

  it('harmanlamanin ayni satira esledigi her varyant reddedilir', () => {
    for (const v of [
      CANON.toUpperCase(),
      `C${CANON.slice(1)}`,
      CANON.replace('farswo', 'FarSwo'),
      `${CANON} `, // PAD SPACE: sondaki bosluk yok sayilir
      ` ${CANON}`,
      `${ch(0xff43)}${CANON.slice(1)}`, // tam genislik 'c' (U+FF43)
      CANON.replace('s', ch(0x015b)), // aksanli 's' (U+015B)
      `${CANON.slice(0, 5)}${ch(0x200b)}${CANON.slice(5)}`, // sifir genislikli bosluk (U+200B)
      `${CANON.slice(0, 5)}${ch(0x0001)}${CANON.slice(5)}`, // kontrol karakteri (U+0001)
      `${CANON}${ch(0x0a)}`, // sonda satir sonu
      CANON.replace('k', ch(0x212a)), // Kelvin isareti (U+212A)
    ]) {
      expect(isCanonicalSiteId(v), JSON.stringify(v)).toBe(false);
    }
  });

  it('bos, cok uzun, tireyle baslayan ya da dize olmayan deger reddedilir', () => {
    expect(isCanonicalSiteId('')).toBe(false);
    expect(isCanonicalSiteId('a'.repeat(SITE_ID_MAX_LEN + 1))).toBe(false);
    expect(isCanonicalSiteId('-abc')).toBe(false);
    expect(isCanonicalSiteId('../sites')).toBe(false);
    expect(isCanonicalSiteId(undefined)).toBe(false);
    expect(isCanonicalSiteId(42)).toBe(false);
    expect(isCanonicalSiteId(['s1'])).toBe(false);
  });
});

describe('siteBucketKey — varyantlar yeni kova acamaz', () => {
  it('kanonik kimlik aynen; parametre yoksa "-"', () => {
    expect(siteBucketKey(CANON)).toBe(CANON);
    expect(siteBucketKey(undefined)).toBe('-');
    expect(siteBucketKey('')).toBe('-');
  });

  it('kurala uymayan tum yazimlar TEK ortak kovaya duser', () => {
    const variants = [CANON.toUpperCase(), `C${CANON.slice(1)}`, `${CANON} `, `${'x'.repeat(65)}`];
    expect(new Set(variants.map(siteBucketKey))).toEqual(new Set([NON_CANONICAL_SITE_BUCKET]));
    // Ortak kova hicbir gercek kimlikle cakismaz
    expect(isCanonicalSiteId(NON_CANONICAL_SITE_BUCKET)).toBe(false);
  });
});

describe('sema sozlesmesi — kural kimlik ureticisine bagli', () => {
  const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

  it('Site.id kucuk harf ureten bir varsayilan kullanir (ulid() gibi buyuk harf ureten olursa kural degismeli)', () => {
    const model = schema.match(/^model Site \{([\s\S]*?)^\}/m)?.[1] ?? '';
    const idLine = model.split('\n').find((l) => /^\s+id\s/.test(l)) ?? '';
    expect(idLine, 'Site.id semada yok').not.toBe('');
    expect(idLine).toMatch(/@default\((cuid\(\)|cuid\(2\)|uuid\(\))\)/);
  });

  it('tohum betiginin sabit site kimligi kurala uyar', () => {
    const seed = readFileSync(new URL('../../prisma/seed.ts', import.meta.url), 'utf8');
    const ids = [...seed.matchAll(/site\.upsert\(\{\s*where:\s*\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(isCanonicalSiteId(id), id).toBe(true);
  });
});
