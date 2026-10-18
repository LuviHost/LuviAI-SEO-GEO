import { describe, it, expect, vi } from 'vitest';
import { SafeFetchError } from '../common/safe-fetch.js';
import {
  assertSiteUrlAllowed, HostPolicyError, normalizePublicDomainInput, parseSiteUrlInput,
  PUBLIC_DOMAIN_MESSAGES, SITE_URL_MESSAGES,
} from './site-url-policy.js';
import { SitesService } from './sites.service.js';

/**
 * Site adresi / alan adi denetimi (SSRF, kayit ani).
 *
 * NEDEN VAR: @IsUrl() IP adresini gecerli host sayiyordu; kart istemeyen
 * deneme hesabiyla ic agdaki bir adres "site" diye kaydedilip tarayici oraya
 * yonlendirilebiliyordu. Ucretsiz kontrol de IP, port ve kimlik bilgili adresi
 * kabul ediyordu.
 */

const problemOf = (fn: () => unknown): string => {
  try { fn(); return 'ok'; } catch (e) { return e instanceof HostPolicyError ? e.problem : `baska: ${(e as Error).message}`; }
};

describe('parseSiteUrlInput — sekil (ag yok)', () => {
  it('normal alan adi gecer, sema yoksa https eklenir, sondaki nokta atilir', () => {
    expect(parseSiteUrlInput('ornek.com').toString()).toBe('https://ornek.com/');
    expect(parseSiteUrlInput('http://www.ornek.com.tr/blog').toString()).toBe('http://www.ornek.com.tr/blog');
    expect(parseSiteUrlInput('https://ornek.com./').hostname).toBe('ornek.com');
  });

  it('IP adresi — ozel olsun genel olsun — site olamaz', () => {
    expect(problemOf(() => parseSiteUrlInput('http://8.8.8.8/'))).toBe('ip_literal');
    expect(problemOf(() => parseSiteUrlInput('http://[2606:4700:4700::1111]/'))).toBe('ip_literal');
    for (const raw of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/']) {
      expect(problemOf(() => parseSiteUrlInput(raw)), raw).toBe('blocked_address');
    }
  });

  it('WHATWG\'in IPv4\'e cevirdigi yazimlar da yakalanir (ondalik, onaltilik, kisa)', () => {
    for (const raw of ['http://2130706433/', 'http://0x7f.1/', 'http://127.1/']) {
      expect(problemOf(() => parseSiteUrlInput(raw)), raw).toBe('blocked_address');
    }
  });

  it('standart disi port, kimlik bilgisi, tek etiketli ad, http(s) disi sema reddedilir', () => {
    expect(problemOf(() => parseSiteUrlInput('https://ornek.com:8443/'))).toBe('port');
    expect(problemOf(() => parseSiteUrlInput('http://ornek.com:6379/'))).toBe('port');
    expect(problemOf(() => parseSiteUrlInput('https://kullanici:sifre@ornek.com/'))).toBe('credentials');
    expect(problemOf(() => parseSiteUrlInput('http://ornek.com@127.0.0.1/'))).toBe('credentials');
    expect(problemOf(() => parseSiteUrlInput('http://localhost/'))).toBe('single_label');
    expect(problemOf(() => parseSiteUrlInput('http://localhost./'))).toBe('single_label');
    expect(problemOf(() => parseSiteUrlInput('http://intranet/'))).toBe('single_label');
    expect(problemOf(() => parseSiteUrlInput('ftp://ornek.com/'))).toBe('protocol');
    expect(problemOf(() => parseSiteUrlInput('file:///etc/passwd'))).toBe('protocol');
  });

  it('varsayilan port yazilirsa sorun degil (WHATWG bos birakir)', () => {
    expect(parseSiteUrlInput('https://ornek.com:443/').toString()).toBe('https://ornek.com/');
  });

  it('bos ve bozuk girdi', () => {
    expect(problemOf(() => parseSiteUrlInput(''))).toBe('empty');
    expect(problemOf(() => parseSiteUrlInput(undefined))).toBe('empty');
    expect(problemOf(() => parseSiteUrlInput('http://'))).toBe('invalid');
  });

  it('hata mesaji kullaniciya gosterilecek Turkce metin, 400', () => {
    try {
      parseSiteUrlInput('http://192.168.1.1/');
      expect.unreachable();
    } catch (e) {
      const err = e as HostPolicyError;
      expect(err.getStatus()).toBe(400);
      expect(err.message).toBe(SITE_URL_MESSAGES.blocked_address);
    }
  });
});

describe('assertSiteUrlAllowed — DNS (enjekte cozumleyici)', () => {
  it('ic aga cozulen alan adi reddedilir', async () => {
    const resolve = vi.fn(async () => { throw new SafeFetchError('blocked_address', 'x'); });
    await expect(assertSiteUrlAllowed('ic.ornek.com', resolve)).rejects.toMatchObject({ problem: 'blocked_address' });
    expect(resolve).toHaveBeenCalledWith('https://ic.ornek.com/');
  });

  it('cozulemeyen alan adi anlasilir hata verir', async () => {
    const resolve = async () => { throw new SafeFetchError('dns', 'x'); };
    await expect(assertSiteUrlAllowed('yok-boyle-bir-alan.com', resolve)).rejects.toMatchObject({ problem: 'dns', message: SITE_URL_MESSAGES.dns });
  });

  it('sekil hatasinda DNS hic sorulmaz', async () => {
    const resolve = vi.fn(async () => undefined);
    await expect(assertSiteUrlAllowed('http://10.1.2.3/', resolve)).rejects.toMatchObject({ problem: 'blocked_address' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('herkese acik alan adi gecer', async () => {
    const u = await assertSiteUrlAllowed('Ornek.COM/yol', async () => undefined);
    expect(u.toString()).toBe('https://ornek.com/yol');
  });
});

describe('normalizePublicDomainInput — ucretsiz kontrol', () => {
  it('yol/sorgu atilir, anasayfa cekilir; www onbellek anahtarindan dusurulur', () => {
    expect(normalizePublicDomainInput('https://www.Ornek.com/blog?x=1#y')).toEqual({ url: 'https://www.ornek.com/', host: 'ornek.com' });
    expect(normalizePublicDomainInput('kobipratik.com')).toEqual({ url: 'https://kobipratik.com/', host: 'kobipratik.com' });
  });

  it('IP, port, kimlik bilgisi, tek etiketli ad, http(s) disi sema reddedilir — Turkce mesajla', () => {
    const cases: Array<[string, string]> = [
      ['127.0.0.1', PUBLIC_DOMAIN_MESSAGES.blocked_address],
      ['169.254.169.254', PUBLIC_DOMAIN_MESSAGES.blocked_address],
      ['8.8.8.8', PUBLIC_DOMAIN_MESSAGES.ip_literal],
      ['ornek.com:8080', PUBLIC_DOMAIN_MESSAGES.port],
      ['user:pass@ornek.com', PUBLIC_DOMAIN_MESSAGES.credentials],
      ['localhost', PUBLIC_DOMAIN_MESSAGES.single_label],
      ['gopher://ornek.com', PUBLIC_DOMAIN_MESSAGES.protocol],
      ['', PUBLIC_DOMAIN_MESSAGES.empty],
      ['a'.repeat(301), PUBLIC_DOMAIN_MESSAGES.too_long],
    ];
    for (const [input, msg] of cases) {
      expect(() => normalizePublicDomainInput(input), input).toThrow(msg);
    }
  });
});

describe('SitesService.create — kayit aninda denetim', () => {
  function service(resolve: (u: string) => Promise<unknown> = async () => undefined) {
    const created: any[] = [];
    const prisma = {
      site: {
        findFirst: async () => null,
        create: async ({ data }: any) => { created.push(data); return { id: 's1', userId: data.userId, ...data }; },
      },
    };
    const queue = { enqueue: vi.fn(async () => ({ dbJobId: 'j', bullJobId: 1 })) };
    const quota = { enforceSiteQuota: vi.fn(async () => undefined) };
    const svc = new SitesService(prisma as never, queue as never, quota as never);
    svc.urlResolver = resolve;
    return { svc, created, queue };
  }

  it('IP adresli site kaydedilmez, kuyruga is atilmaz', async () => {
    const { svc, created, queue } = service();
    await expect(svc.create('u1', { url: 'http://169.254.169.254/', name: 'x' } as any)).rejects.toMatchObject({ problem: 'blocked_address' });
    await expect(svc.create('u1', { url: 'http://93.184.216.34/', name: 'x' } as any)).rejects.toMatchObject({ problem: 'ip_literal' });
    expect(created).toHaveLength(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('ic aga cozulen alan adi kaydedilmez', async () => {
    const { svc, created } = service(async () => { throw new SafeFetchError('blocked_address', 'x'); });
    await expect(svc.create('u1', { url: 'https://ic-sunucu.ornek.com', name: 'x' } as any)).rejects.toMatchObject({ problem: 'blocked_address' });
    expect(created).toHaveLength(0);
  });

  it('gecerli site normalize edilip kaydedilir', async () => {
    const { svc, created, queue } = service();
    await svc.create('u1', { url: 'Ornek.com/', name: 'Ornek' } as any);
    expect(created[0].url).toBe('https://ornek.com');
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('guncellemede url gecirilirse ayni denetimden gecer', async () => {
    const updated: any[] = [];
    const prisma = {
      site: {
        findUnique: async () => ({ id: 's1', userId: 'u1' }),
        update: async ({ data }: any) => { updated.push(data); return data; },
      },
    };
    const svc = new SitesService(prisma as never, null as never, null as never);
    svc.urlResolver = async () => undefined;
    await expect(svc.update('s1', { url: 'http://10.0.0.1' } as any, { id: 'u1', role: 'USER' })).rejects.toMatchObject({ problem: 'blocked_address' });
    expect(updated).toHaveLength(0);
    await svc.update('s1', { name: 'Yeni ad' } as any, { id: 'u1', role: 'USER' });
    expect(updated[0]).toEqual({ name: 'Yeni ad' });
  });
});
