import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';

vi.mock('@luviai/shared', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));

import { encode } from 'next-auth/jwt';
import { OAuthService } from './oauth.service.js';
import { OAuthController } from './oauth.controller.js';
import { OAuthFlowError } from '../auth/oauth-state.js';
import { META_REQUIRED_PERMISSIONS } from './meta-permissions.js';
import { GoogleAdsSelectDto, MetaAdsSelectDto, OAuthFinishDto } from './oauth.dto.js';

const SECRET = 'test-secret-for-ads-oauth-spec-0123456789abcdef';
const WEB = 'https://panel.test';
const ENV_KEYS = ['NEXTAUTH_SECRET', 'AUTH_SECRET', 'WEB_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET'];
let envBackup: Record<string, string | undefined> = {};

beforeAll(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.NEXTAUTH_SECRET = SECRET;
  delete process.env.AUTH_SECRET;
  process.env.WEB_BASE_URL = WEB;
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  process.env.META_APP_ID = 'mid';
  process.env.META_APP_SECRET = 'msecret';
});
afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterEach(() => vi.restoreAllMocks());

function fakePrisma() {
  const sites = new Map<string, any>([['s1', { id: 's1', userId: 'u1' }], ['s2', { id: 's2', userId: 'u2' }]]);
  const users = new Map<string, any>([['u1', { id: 'u1', deletionRequestedAt: null }], ['u2', { id: 'u2', deletionRequestedAt: null }]]);
  const rows = new Map<string, any>();
  return {
    sites,
    users,
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        const u = users.get(where.id);
        return u ? { deletionRequestedAt: u.deletionRequestedAt } : null;
      }),
    },
    site: {
      async findFirst({ where }: any) {
        const s = sites.get(where.id);
        return s && s.userId === where.userId ? { id: s.id } : null;
      },
      update: vi.fn(async ({ where, data }: any) => ({ ...sites.get(where.id), ...data })),
    },
    kvStore: {
      async create({ data }: any) { rows.set(data.key, { ...data, expiresAt: data.expiresAt ?? null }); return data; },
      async findUnique({ where }: any) { const r = rows.get(where.key); return r ? { ...r } : null; },
      async deleteMany({ where }: any) {
        if (typeof where.key === 'string') return { count: rows.delete(where.key) ? 1 : 0 };
        return { count: 0 };
      },
    },
  } as any;
}

function fakeRes() {
  return { send: vi.fn(), setHeader: vi.fn() } as any;
}

async function cookieFor(userId: string) {
  const token = await encode({ token: { sub: userId }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 });
  return `authjs.session-token=${token}`;
}

const reqAs = (user: any, cookie?: string) => ({ user, headers: cookie ? { cookie } : {} }) as any;
const stateFrom = (url: string) => new URL(url).searchParams.get('state') ?? '';

function setup() {
  const prisma = fakePrisma();
  const oauth = new OAuthService();
  const ctl = new OAuthController(prisma, oauth);
  const exchange = vi.spyOn(oauth, 'exchangeGoogleCode').mockResolvedValue({ access_token: 'at', refresh_token: 'rt' });
  vi.spyOn(oauth, 'listGoogleAdsCustomersDetailed').mockResolvedValue({ customers: [{ id: '123', resourceName: 'customers/123' }] });
  return { prisma, oauth, ctl, exchange };
}

describe('buildCallbackHtml — yansitilan XSS', () => {
  it('hata metni HTML-kacisli, script icindeki JSON kirilamaz', () => {
    const html = new OAuthService().buildCallbackHtml('google-ads', null, '</script><script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    // script bloku: '<' \u003c olarak gider, tek bir </script> kapanisi kalir
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('pending mesaji anahtari yalniz WEB kokenine gonderir', () => {
    const html = new OAuthService().buildCallbackHtml('meta-ads', null, undefined, { pendingKey: 'K'.repeat(43) });
    expect(html).toContain('"type":"oauth-pending"');
    expect(html).toContain(`"key":"${'K'.repeat(43)}"`);
    expect(html).toContain(`"${WEB}"`);
  });

  it('HMAC state ve sabit yedek sir kaldirildi', () => {
    const svc = new OAuthService() as any;
    expect(svc.signState).toBeUndefined();
    expect(svc.verifyState).toBeUndefined();
    expect(svc.stateSecret).toBeUndefined();
  });
});

describe('Google Ads start/callback/finish', () => {
  it('start: siteId zorunlu ve sahiplik kontrolu', async () => {
    const { ctl } = setup();
    await expect(ctl.startGoogleAds(undefined as any, reqAs({ id: 'u1' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.startGoogleAds('s2', reqAs({ id: 'u1' }))).rejects.toBeInstanceOf(ForbiddenException);
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    expect(stateFrom(url)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sahte state: token degisimi yok, sabit Turkce mesaj, girdi yanki yok', async () => {
    const { ctl, exchange } = setup();
    const res = fakeRes();
    await ctl.callbackGoogleAds('code', 'forged<state>', undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(exchange).not.toHaveBeenCalled();
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Bağlantı isteği geçersiz');
    expect(html).not.toContain('forged');
  });

  it('?error= parametresi sayfaya basilmaz', async () => {
    const { ctl } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds(undefined as any, stateFrom(url), '<script>alert(1)</script>', reqAs(undefined, await cookieFor('u1')), res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Sağlayıcı bağlantıyı tamamlamadı');
  });

  it('ayni oturumla tamamlanir; site kayittan gelir', async () => {
    const { ctl, prisma, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds('code-1', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(exchange).toHaveBeenCalledWith('code-1');
    expect(prisma.site.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
    expect(res.send.mock.calls[0][0]).toContain('"type":"oauth-success"');
  });

  it('kurbanin oturumuyla donen saldirgan akisi reddedilir', async () => {
    const { ctl, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s2', reqAs({ id: 'u2' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds('victim-code', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(exchange).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toContain('oturum eşleşmiyor');
  });

  it('oturum yoksa park → yalniz akisi baslatan /finish ile tamamlar', async () => {
    const { ctl, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds('code-2', stateFrom(url), undefined, reqAs(undefined), res);
    expect(exchange).not.toHaveBeenCalled();
    const html = res.send.mock.calls[0][0] as string;
    const key = /"key":"([A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? '';
    expect(key).not.toBe('');
    const err: any = await ctl.finishGoogleAds({ key }, reqAs({ id: 'u2' })).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(exchange).not.toHaveBeenCalled();

    // ikinci park: sahibi tamamlar
    const { url: url2 } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res2 = fakeRes();
    await ctl.callbackGoogleAds('code-3', stateFrom(url2), undefined, reqAs(undefined), res2);
    const key2 = /"key":"([A-Za-z0-9_-]{43})"/.exec(res2.send.mock.calls[0][0])?.[1] ?? '';
    await expect(ctl.finishGoogleAds({ key: key2 }, reqAs({ id: 'u1' }))).resolves.toMatchObject({ autoSelected: true });
    expect(exchange).toHaveBeenCalledWith('code-3');
  });
});

describe('akis sirasinda hesap silme talebi', () => {
  // Silme talebi siteyi PAUSED yapip reklam token'larini siler; gec donen
  // callback ya da park edilmis akisin tamamlanmasi onlari geri yazmamali.
  it('Google Ads callback: token degisimi yok, siteye yazim yok, sabit mesaj', async () => {
    const { ctl, prisma, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    prisma.users.get('u1').deletionRequestedAt = new Date('2026-10-17T09:00:00Z');
    const res = fakeRes();
    await ctl.callbackGoogleAds('code-x', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(exchange).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Bu siteye erişim yetkiniz yok.');
    expect(html).not.toContain('"type":"oauth-success"');
  });

  it('park edilmis akis talep sonrasi /finish ile tamamlanamaz', async () => {
    const { ctl, prisma, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds('code-y', stateFrom(url), undefined, reqAs(undefined), res);
    const key = /"key":"([A-Za-z0-9_-]{43})"/.exec(res.send.mock.calls[0][0])?.[1] ?? '';
    expect(key).not.toBe('');
    prisma.users.get('u1').deletionRequestedAt = new Date('2026-10-17T09:00:00Z');
    await expect(ctl.finishGoogleAds({ key }, reqAs({ id: 'u1' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(exchange).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
  });

  it('Meta callback: token degisimi yok, siteye yazim yok', async () => {
    const { ctl, prisma, oauth } = setup();
    const metaExchange = vi.spyOn(oauth, 'exchangeMetaCode').mockResolvedValue({ access_token: 'mt' });
    const { url } = await ctl.startMetaAds('s1', reqAs({ id: 'u1' }));
    prisma.users.get('u1').deletionRequestedAt = new Date('2026-10-17T09:00:00Z');
    const res = fakeRes();
    await ctl.callbackMetaAds('code-m', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(metaExchange).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toContain('Bu siteye erişim yetkiniz yok.');
  });

  it('talep yoksa akis normal tamamlanir (kontrol yalniz silme talebinde devreye girer)', async () => {
    const { ctl, prisma, exchange } = setup();
    const { url } = await ctl.startGoogleAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackGoogleAds('code-z', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { deletionRequestedAt: true } });
    expect(exchange).toHaveBeenCalledWith('code-z');
    expect(res.send.mock.calls[0][0]).toContain('"type":"oauth-success"');
  });
});

describe('exchangeGoogleCode — saglayici govdesi disari cikmaz', () => {
  function mockFetch(status: number, body: any) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  }

  it('4xx govdesi hata mesajina girmez', async () => {
    mockFetch(400, { error: 'invalid_grant', error_description: 'org-SECRET-123 bad' });
    const err: any = await new OAuthService().exchangeGoogleCode('c').catch((e) => e);
    expect(err).toBeInstanceOf(OAuthFlowError);
    expect(err.code).toBe('token_exchange_failed');
    expect(String(err.message)).not.toContain('org-SECRET');
  });

  it('adwords kapsami verilmediyse scope_not_granted, refresh token yoksa no_refresh_token', async () => {
    mockFetch(200, { access_token: 'a', refresh_token: 'r', scope: 'openid' });
    await expect(new OAuthService().exchangeGoogleCode('c')).rejects.toMatchObject({ code: 'scope_not_granted' });
    vi.restoreAllMocks();
    mockFetch(200, { access_token: 'a', scope: 'https://www.googleapis.com/auth/adwords' });
    await expect(new OAuthService().exchangeGoogleCode('c')).rejects.toMatchObject({ code: 'no_refresh_token' });
  });
});

describe('Meta callback', () => {
  it('error_description sayfaya basilmaz', async () => {
    const { ctl } = setup();
    const { url } = await ctl.startMetaAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackMetaAds(undefined as any, stateFrom(url), 'access_denied', reqAs(undefined, await cookieFor('u1')), res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('İzin ekranında erişime izin verilmedi');
  });
});

// K26: Meta izin ekraninda reklam izinleri kaldirilip "Devam" denirse token yine
// gelir; eskiden site "bagli" yaziliyordu ama Ads API cagrilari izin hatasiyla dusuyordu.
describe('Meta izin dogrulamasi (GET /me/permissions)', () => {
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const perms = (overrides: Record<string, string> = {}) => ({
    data: Object.entries({
      public_profile: 'granted',
      email: 'granted',
      ads_read: 'granted',
      ads_management: 'granted',
      business_management: 'granted',
      pages_show_list: 'granted',
      pages_read_engagement: 'granted',
      instagram_basic: 'granted',
      ...overrides,
    }).map(([permission, status]) => ({ permission, status })),
  });
  /** Sirali Graph cevaplari: kisa token → izin listesi → uzun token */
  function graph(...responses: Response[]) {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const r of responses) spy.mockResolvedValueOnce(r);
    return spy;
  }
  const calledUrls = (spy: ReturnType<typeof graph>) => spy.mock.calls.map((c) => new URL(String(c[0])));

  it('zorunlu izinler verildiyse uzun omurlu token doner; izinler ilk token ile sorulur', async () => {
    const spy = graph(json(200, { access_token: 'short-1' }), json(200, perms()), json(200, { access_token: 'long-1' }));
    await expect(new OAuthService().exchangeMetaCode('c')).resolves.toEqual({ access_token: 'long-1' });
    const urls = calledUrls(spy);
    expect(urls).toHaveLength(3);
    expect(urls[1].pathname).toMatch(/\/me\/permissions$/);
    expect(urls[1].searchParams.get('access_token')).toBe('short-1');
  });

  it('ads_management reddedildiyse scope_not_granted ve uzun omurlu token istenmez', async () => {
    const spy = graph(json(200, { access_token: 'short-2' }), json(200, perms({ ads_management: 'declined' })));
    const err: any = await new OAuthService().exchangeMetaCode('c').catch((e) => e);
    expect(err).toBeInstanceOf(OAuthFlowError);
    expect(err.code).toBe('scope_not_granted');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ads_read reddedildi', { ads_read: 'declined' }],
    ['pages_show_list reddedildi', { pages_show_list: 'declined' }],
    ['ads_read suresi dolmus (expired)', { ads_read: 'expired' }],
  ])('%s → scope_not_granted', async (_label, overrides) => {
    graph(json(200, { access_token: 'short-3' }), json(200, perms(overrides)));
    await expect(new OAuthService().exchangeMetaCode('c')).rejects.toMatchObject({ code: 'scope_not_granted' });
  });

  it('zorunlu izin listede hic yoksa da scope_not_granted', async () => {
    const onlyBasics = { data: [{ permission: 'public_profile', status: 'granted' }, { permission: 'email', status: 'granted' }] };
    graph(json(200, { access_token: 'short-4' }), json(200, onlyBasics));
    await expect(new OAuthService().exchangeMetaCode('c')).rejects.toMatchObject({ code: 'scope_not_granted' });
  });

  it('istege bagli izinler (business_management, instagram_basic) reddedilse de baglanir', async () => {
    graph(
      json(200, { access_token: 'short-5' }),
      json(200, perms({ business_management: 'declined', instagram_basic: 'declined', pages_read_engagement: 'declined' })),
      json(200, { access_token: 'long-5' }),
    );
    await expect(new OAuthService().exchangeMetaCode('c')).resolves.toEqual({ access_token: 'long-5' });
  });

  it('izin listesi okunamazsa (HTTP hata / bicim disi / ag hatasi) provider_error; baglanti yazilmaz', async () => {
    graph(json(200, { access_token: 'short-6' }), json(400, { error: { type: 'OAuthException', code: 190, message: 'SECRET-DETAIL' } }));
    const err: any = await new OAuthService().exchangeMetaCode('c').catch((e) => e);
    expect(err.code).toBe('provider_error');
    expect(String(err.message)).not.toContain('SECRET-DETAIL');
    vi.restoreAllMocks();

    graph(json(200, { access_token: 'short-7' }), json(200, { permissions: 'ads_read' }));
    await expect(new OAuthService().exchangeMetaCode('c')).rejects.toMatchObject({ code: 'provider_error' });
    vi.restoreAllMocks();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { access_token: 'short-8' }))
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new OAuthService().exchangeMetaCode('c')).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('izin ekrani reddedilen izni yeniden sorar (auth_type=rerequest) ve zorunlu izinleri ister', () => {
    const url = new URL(new OAuthService().buildMetaAuthUrl('S'.repeat(43)));
    expect(url.searchParams.get('auth_type')).toBe('rerequest');
    const scope = (url.searchParams.get('scope') ?? '').split(',');
    for (const p of META_REQUIRED_PERMISSIONS) expect(scope).toContain(p);
  });

  it('callback: izin eksikse siteye token yazilmaz, sabit Turkce izin mesaji gosterilir', async () => {
    const { ctl, prisma, oauth } = setup();
    vi.spyOn(oauth, 'exchangeMetaCode').mockRejectedValue(new OAuthFlowError('scope_not_granted', undefined, 'ads_management'));
    const listAccounts = vi.spyOn(oauth, 'listMetaAdAccounts');
    const { url } = await ctl.startMetaAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackMetaAds('code-perm', stateFrom(url), undefined, reqAs(undefined, await cookieFor('u1')), res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Meta izin ekranında istenen izinler verilmedi');
    expect(html).not.toContain('"type":"oauth-success"');
    expect(html).not.toContain('ads_management');
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('park edilmis akis /finish: izin eksikse 400 { code: scope_not_granted } ve yazim yok', async () => {
    const { ctl, prisma, oauth } = setup();
    vi.spyOn(oauth, 'exchangeMetaCode').mockRejectedValue(new OAuthFlowError('scope_not_granted'));
    const { url } = await ctl.startMetaAds('s1', reqAs({ id: 'u1' }));
    const res = fakeRes();
    await ctl.callbackMetaAds('code-park', stateFrom(url), undefined, reqAs(undefined), res);
    const key = /"key":"([A-Za-z0-9_-]{43})"/.exec(res.send.mock.calls[0][0])?.[1] ?? '';
    expect(key).not.toBe('');
    const err: any = await ctl.finishMetaAds({ key }, reqAs({ id: 'u1' })).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'scope_not_granted', message: expect.stringContaining('Meta izin ekranında') });
    expect(prisma.site.update).not.toHaveBeenCalled();
  });
});

// Toplu atama taramasi: satir ici tipli govdeler global ValidationPipe'tan
// denetimsiz geciyordu (tasarim tipi Object). main.ts ile ayni ayarlar.
describe('OAuth secim/finish govdeleri — sinif DTO', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

  it('bilinmeyen alan, yanlis tip ve yola sizan kimlik 400', async () => {
    await expect(pipe.transform({ customerId: '1234567890', siteId: 's2' }, asBody(GoogleAdsSelectDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ customerId: { set: '1' } }, asBody(GoogleAdsSelectDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ customerId: '123/../../customers/999' }, asBody(GoogleAdsSelectDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ adAccountId: 'act_1', user: { update: { role: 'ADMIN' } } }, asBody(MetaAdsSelectDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ pageId: '12/feed?x=1' }, asBody(MetaAdsSelectDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ key: 'k', siteId: 's2' }, asBody(OAuthFinishDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panelin gonderdigi govdeler gecer (bos dize secimi temizler)', async () => {
    await expect(pipe.transform({ customerId: '1234567890' }, asBody(GoogleAdsSelectDto))).resolves.toMatchObject({ customerId: '1234567890' });
    await expect(pipe.transform({ customerId: '123-456-7890' }, asBody(GoogleAdsSelectDto))).resolves.toBeDefined();
    await expect(pipe.transform({ adAccountId: 'act_123', pageId: '456', instagramActorId: '17841400000000000' }, asBody(MetaAdsSelectDto))).resolves.toBeDefined();
    await expect(pipe.transform({ adAccountId: '', pageId: '' }, asBody(MetaAdsSelectDto))).resolves.toBeDefined();
    await expect(pipe.transform({ key: 'K'.repeat(43) }, asBody(OAuthFinishDto))).resolves.toBeDefined();
  });

  it('pipe atlansa da Meta secimi yalniz dize alanlari yazar; cevapta site satiri yok', async () => {
    const { ctl, prisma } = setup();
    const out = await ctl.selectMetaAds('s1', { adAccountId: 'act_9', pageId: { set: 'x' }, extra: 1 } as any, reqAs({ id: 'u1' }));
    expect(out).toEqual({ ok: true });
    const args = prisma.site.update.mock.calls[0][0];
    expect(args.data).toEqual({ metaAdsAccountId: 'act_9', metaPageId: null });
    expect(args.select).toEqual({ id: true });
  });

  it('Google Ads secimi: baska sitenin sahibi yazamaz, dize olmayan kimlik reddedilir', async () => {
    const { ctl, prisma } = setup();
    await expect(ctl.selectGoogleAds('s2', { customerId: '123' }, reqAs({ id: 'u1' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.selectGoogleAds('s1', { customerId: { not: '' } } as any, reqAs({ id: 'u1' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site.update).not.toHaveBeenCalled();
    await ctl.selectGoogleAds('s1', { customerId: ' 1234567890 ' }, reqAs({ id: 'u1' }));
    expect(prisma.site.update.mock.calls[0][0].data).toEqual({ googleAdsCustomerId: '1234567890' });
  });
});

describe('Meta secenekleri (izin denetimi oncesi kurulmus baglanti)', () => {
  function optionsSetup() {
    const prisma = fakePrisma();
    prisma.site.findUniqueOrThrow = vi.fn(async () => ({ id: 's1', userId: 'u1', metaAdsAccessToken: 'enc:tok', metaAdsAccountId: null, metaPageId: null, metaInstagramActorId: null }));
    const oauth = new OAuthService();
    const ctl = new OAuthController(prisma, oauth);
    const accounts = vi.spyOn(oauth, 'listMetaAdAccounts').mockResolvedValue([{ id: 'act_1', name: 'A', currency: 'TRY' }]);
    vi.spyOn(oauth, 'listMetaPages').mockResolvedValue([]);
    return { ctl, oauth, accounts };
  }

  it('reklam izni reddedilmis token: bos liste yerine Turkce izin hatasi (400 scope_not_granted)', async () => {
    const { ctl, oauth, accounts } = optionsSetup();
    vi.spyOn(oauth, 'missingMetaPermissionsFor').mockResolvedValue(['ads_management']);
    const err: any = await ctl.optionsMetaAds('s1', reqAs({ id: 'u1' })).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'scope_not_granted', message: expect.stringContaining('Meta izin ekranında') });
    expect(accounts).not.toHaveBeenCalled();
  });

  it('izin listesi okunamazsa (gecici hata) liste eskisi gibi doner; izinler tamsa da doner', async () => {
    const { ctl, oauth } = optionsSetup();
    const inspect = vi.spyOn(oauth, 'missingMetaPermissionsFor').mockResolvedValue(null);
    await expect(ctl.optionsMetaAds('s1', reqAs({ id: 'u1' }))).resolves.toMatchObject({ adAccounts: [{ id: 'act_1' }] });
    inspect.mockResolvedValue([]);
    await expect(ctl.optionsMetaAds('s1', reqAs({ id: 'u1' }))).resolves.toMatchObject({ adAccounts: [{ id: 'act_1' }] });
    expect(inspect).toHaveBeenCalledWith('tok');
  });
});

describe('Google Ads hesap listesi hatasi bos listeden ayrilir', () => {
  it('liste alinamazsa options cevabi customersError tasir (panel "hesap yok" demesin)', async () => {
    const { OAuthController } = await import('./oauth.controller.js');
    const ctl: any = Object.create(OAuthController.prototype);
    ctl.prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', googleAdsRefreshToken: 'enc', googleAdsCustomerId: null })) } };
    ctl.assertSiteOwnership = vi.fn(async () => undefined);
    ctl.refreshGoogleAccessToken = vi.fn(async () => 'access');
    ctl.oauth = { listGoogleAdsCustomersDetailed: vi.fn(async () => ({ customers: [], error: 'Google Ads API erişimi onaylı değil.' })) };
    const r = await ctl.optionsGoogleAds('s1', { user: { id: 'u1' } });
    expect(r).toMatchObject({ customers: [], customersError: 'Google Ads API erişimi onaylı değil.' });
  });
});
