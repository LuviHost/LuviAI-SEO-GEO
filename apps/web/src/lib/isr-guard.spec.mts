/**
 * ISR korumasi: uretimde bos plan verisi firlatir (son basarili sayfa korunur); build ve
 * gelistirmede bos veriye izin verilir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyRenderAllowed, requireForCache } from './isr-guard';

const URETIM = { NODE_ENV: 'production' };
const BUILD = { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' };
const GELISTIRME = { NODE_ENV: 'development' };

describe('requireForCache', () => {
  it('uretim sunucusunda bos veri (null, bos dizi) firlatir — bos sayfa onbellege girmez', () => {
    expect(() => requireForCache(null, '/billing/plans', URETIM)).toThrow(/ISR/);
    expect(() => requireForCache([], '/billing/plans', URETIM)).toThrow(/billing\/plans/);
    expect(() => requireForCache(undefined, 'x', URETIM)).toThrow();
  });

  it('build ve gelistirmede bos veri aynen doner (build API\'siz gecer)', () => {
    expect(requireForCache([], 'x', BUILD)).toEqual([]);
    expect(requireForCache(null, 'x', BUILD)).toBeNull();
    expect(requireForCache([], 'x', GELISTIRME)).toEqual([]);
    expect(emptyRenderAllowed(BUILD)).toBe(true);
    expect(emptyRenderAllowed(URETIM)).toBe(false);
  });

  it('dolu veri her ortamda aynen doner', () => {
    const plans = [{ id: 'starter' }];
    expect(requireForCache(plans, 'x', URETIM)).toBe(plans);
    const res = { plans };
    expect(requireForCache(res, 'x', URETIM)).toBe(res);
  });

  it('plan cekimi (landing, /pricing, /compare, /ranksup.md ortak yolu) korumayi kullaniyor', () => {
    const src = readFileSync(fileURLToPath(new URL('../components/landing/landing-data.ts', import.meta.url)), 'utf8');
    const fetchPlans = src.slice(src.indexOf('export async function fetchPlans('), src.indexOf('export async function fetchPlansResponse'));
    const fetchResp = src.slice(src.indexOf('export async function fetchPlansResponse'), src.indexOf('export async function fetchTestimonials'));
    expect(fetchPlans).toContain('requireForCache(');
    expect(fetchResp).toContain('requireForCache(');
  });
});
