import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as dns from 'node:dns';
import * as net from 'node:net';
import { ipv6AllowedFromEnv, pinProcessToIpv4 } from './ipv4-pin.js';

/**
 * Surec geneli IPv4 sabitlemesi — uretimde calisan IPv6 yolu yok;
 * happy-eyeballs IPv6'ya gecince istekler ETIMEDOUT ile duser.
 */

describe('ipv6AllowedFromEnv', () => {
  it('varsayilan kapali (sabitleme acik); yalniz 1/true/on/yes acar', () => {
    expect(ipv6AllowedFromEnv({})).toBe(false);
    for (const v of ['0', 'false', 'no', '', ' ']) expect(ipv6AllowedFromEnv({ ALLOW_IPV6: v }), JSON.stringify(v)).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(ipv6AllowedFromEnv({ ALLOW_IPV6: v }), v).toBe(true);
  });
});

describe('pinProcessToIpv4', () => {
  it('DNS sirasi ipv4first + happy-eyeballs kapali', () => {
    const api = { setDefaultResultOrder: vi.fn(), setDefaultAutoSelectFamily: vi.fn() };
    expect(pinProcessToIpv4({}, api)).toBe(true);
    expect(api.setDefaultResultOrder).toHaveBeenCalledWith('ipv4first');
    expect(api.setDefaultAutoSelectFamily).toHaveBeenCalledWith(false);
  });

  it('ALLOW_IPV6=1 hicbir seyi degistirmez', () => {
    const api = { setDefaultResultOrder: vi.fn(), setDefaultAutoSelectFamily: vi.fn() };
    expect(pinProcessToIpv4({ ALLOW_IPV6: '1' }, api)).toBe(false);
    expect(api.setDefaultResultOrder).not.toHaveBeenCalled();
    expect(api.setDefaultAutoSelectFamily).not.toHaveBeenCalled();
  });

  it('gercek Node varsayilanlarini degistirir (bu test sureci icinde)', () => {
    expect(pinProcessToIpv4({})).toBe(true);
    expect(net.getDefaultAutoSelectFamily()).toBe(false);
    expect(dns.getDefaultResultOrder()).toBe('ipv4first');
  });
});

describe('acilis kablolamasi', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../../worker/src/index.ts', import.meta.url), 'utf8');

  it('API: sabitleme ipv4-pin\'den; undici family=4 ayni karara bagli', () => {
    expect(main).toMatch(/import \{ pinProcessToIpv4 \} from '\.\/ipv4-pin\.js';\s*const ipv4Pinned = pinProcessToIpv4\(\);/);
    expect(main).toContain('connect: (ipv4Pinned ? { family: 4 } : {}) as any');
    // Sabitleme NestFactory'den (soketlerden) once
    expect(main.indexOf('pinProcessToIpv4()')).toBeLessThan(main.indexOf('NestFactory.create('));
  });

  it('worker: olu require(\'undici\') yerine ayni fonksiyon, bootstrap\'tan once', () => {
    // ESM'de require tanimsizdi; dagitici hic kurulmuyordu
    expect(worker).not.toContain('setGlobalDispatcher(');
    expect(worker).toMatch(/from '\.\.\/\.\.\/api\/dist\/ipv4-pin\.js'/);
    expect(worker).toMatch(/if \(!pinProcessToIpv4\(\)\)/);
    expect(worker.indexOf('pinProcessToIpv4()')).toBeLessThan(worker.indexOf('async function bootstrap'));
  });
});
