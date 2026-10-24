/**
 * Istege bagli ISR yenilemesi: sirsiz / yanlis sirli istek reddedilir, yollar sabit.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REVALIDATE_PATHS, plansUsable, revalidateAuthorized } from './revalidate';

const SIR = 'a'.repeat(32);

describe('revalidateAuthorized', () => {
  it('yalniz birebir ayni sir kabul edilir', () => {
    expect(revalidateAuthorized(SIR, SIR)).toBe(true);
    expect(revalidateAuthorized(`${SIR}x`, SIR)).toBe(false);
    expect(revalidateAuthorized('a'.repeat(31), SIR)).toBe(false);
    expect(revalidateAuthorized(null, SIR)).toBe(false);
    expect(revalidateAuthorized('', SIR)).toBe(false);
  });

  it('sir tanimsiz ya da kisaysa (16 karakterden az) hicbir istek kabul edilmez', () => {
    expect(revalidateAuthorized('x', undefined)).toBe(false);
    expect(revalidateAuthorized('kisa', 'kisa')).toBe(false);
  });
});

describe('plansUsable', () => {
  it('yalniz dolu plan listesi yenilemeye izin verir', () => {
    expect(plansUsable({ plans: [{ id: 'starter' }] })).toBe(true);
    expect(plansUsable({ plans: [] })).toBe(false);
    expect(plansUsable({})).toBe(false);
    expect(plansUsable(null)).toBe(false);
    expect(plansUsable('x')).toBe(false);
  });
});

describe('/api/revalidate', () => {
  const route = readFileSync(fileURLToPath(new URL('../app/api/revalidate/route.ts', import.meta.url)), 'utf8');

  it('fiyat gosteren ISR sayfalarinin hepsi listede', () => {
    expect([...REVALIDATE_PATHS].sort()).toEqual(['/', '/compare', '/pricing', '/ranksup.md']);
  });

  it('yalniz POST; sir tanimsizsa 404; yollar sabit listeden', () => {
    expect(route).toContain('export async function POST(');
    expect(route).not.toMatch(/export async function GET/);
    expect(route).toContain("if (!secret) return new Response('Not found', { status: 404 });");
    expect(route).toContain('for (const p of REVALIDATE_PATHS) revalidatePath(p);');
    // API plan vermiyorsa yenileme yapilmaz (revalidatePath sonrasi istek bekletilerek uretilir)
    expect(route.indexOf('plansUsable(')).toBeLessThan(route.indexOf('revalidatePath(p)'));
    expect(route).toContain('{ status: 503 }');
  });

  it('yayin sirasi ve kullanim deploy-web.sh basliginda yazili', () => {
    const sh = readFileSync(fileURLToPath(new URL('../../../../scripts/deploy-web.sh', import.meta.url)), 'utf8');
    expect(sh).toContain('ONCE API');
    expect(sh).toContain('/api/revalidate');
  });
});
