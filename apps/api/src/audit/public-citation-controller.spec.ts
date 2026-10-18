import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  PUBLIC_CHECK_FAILED_MESSAGE, PUBLIC_CHECK_IN_FLIGHT_MESSAGE, PUBLIC_CHECK_IP_LIMIT_STRICT, PublicCitationController,
  TURNSTILE_FAILED_MESSAGE, subscriptionLinkErrorCode,
} from './public-citation.controller.js';
import {
  SUBSCRIBE_IP_LIMIT,
  SUBSCRIBE_IP_LIMIT_MESSAGE,
  SUBSCRIBE_WELCOME_PER_EMAIL,
  SUBSCRIBE_WELCOME_PER_EMAIL_STRICT,
} from './public-subscribe-limits.js';

/**
 * E-postadaki onay / abonelikten cikma linki: hata durumunda web adresine
 * SABIT kod gider, sunucu hata metni gitmez (eskiden err.message URL'deydi).
 * Web bugun bu parametreleri okumuyor (apps/web'de arama: 0 sonuc) — kod
 * degisikligi istemci tarafinda bir seyi bozmaz.
 * Vitest dekorator metadata'si uretmedigi icin denetleyici elle kurulur.
 */

const ORJ_WEB_URL = process.env.WEB_URL;
afterEach(() => {
  if (ORJ_WEB_URL === undefined) delete process.env.WEB_URL;
  else process.env.WEB_URL = ORJ_WEB_URL;
});

function kur(subscribers: Record<string, any>) {
  process.env.WEB_URL = 'https://ranksup.test';
  const ctrl = new PublicCitationController({} as never, subscribers as never, {} as never, {} as never);
  const res = { redirect: vi.fn((url: string) => url) };
  return { ctrl, res };
}

describe('subscriptionLinkErrorCode', () => {
  it('servis istisnalari sabit koda iner', () => {
    expect(subscriptionLinkErrorCode(new NotFoundException('Gecersiz veya kullanilmis confirm linki'))).toBe('invalid_token');
    expect(subscriptionLinkErrorCode(new BadRequestException('Bu abonelik artik aktif degil'))).toBe('inactive');
    expect(subscriptionLinkErrorCode(new Error('Invalid `prisma.publicCitationSubscriber.findUnique()` invocation: db down'))).toBe('unknown');
    expect(subscriptionLinkErrorCode(null)).toBe('unknown');
  });
});

describe('GET citation-check/confirm', () => {
  it('basari: alan adiyla doner (degismedi)', async () => {
    const { ctrl, res } = kur({ confirm: vi.fn(async () => ({ ok: true, domain: 'ornek.com' })) });
    await ctrl.confirm('tok', res as never);
    expect(res.redirect).toHaveBeenCalledWith('https://ranksup.test/?citation_confirmed=ornek.com');
  });

  it.each([
    [new NotFoundException('Gecersiz veya kullanilmis confirm linki'), 'invalid_token'],
    [new BadRequestException('Bu abonelik artik aktif degil'), 'inactive'],
    [new Error('PrismaClientInitializationError: Can\'t reach database server at 10.0.0.5:3306'), 'unknown'],
  ])('hata: yalniz sabit kod (%s)', async (err, code) => {
    const { ctrl, res } = kur({ confirm: vi.fn(async () => { throw err; }) });
    await ctrl.confirm('tok', res as never);
    const url = res.redirect.mock.calls[0][0] as string;
    expect(url).toBe(`https://ranksup.test/?citation_confirm_error=${code}`);
    expect(url).not.toContain(encodeURIComponent((err as Error).message).slice(0, 12));
  });
});

describe('GET citation-check/unsubscribe', () => {
  it('basari: alan adiyla doner (degismedi)', async () => {
    const { ctrl, res } = kur({ unsubscribe: vi.fn(async () => ({ ok: true, domain: 'ornek.com' })) });
    await ctrl.unsubscribe('tok', res as never);
    expect(res.redirect).toHaveBeenCalledWith('https://ranksup.test/?citation_unsubscribed=ornek.com');
  });

  it('gecersiz link ve beklenmedik hata sabit koda iner', async () => {
    const a = kur({ unsubscribe: vi.fn(async () => { throw new NotFoundException('Gecersiz unsubscribe linki'); }) });
    await a.ctrl.unsubscribe('tok', a.res as never);
    expect(a.res.redirect).toHaveBeenCalledWith('https://ranksup.test/?citation_unsubscribe_error=invalid_token');

    const b = kur({ unsubscribe: vi.fn(async () => { throw new Error('ECONNREFUSED 10.0.0.5:3306'); }) });
    await b.ctrl.unsubscribe('tok', b.res as never);
    expect(b.res.redirect).toHaveBeenCalledWith('https://ranksup.test/?citation_unsubscribe_error=unknown');
  });
});

describe('POST citation-check/unlock — beklenmedik hata', () => {
  function kurUnlock(check: () => Promise<unknown>) {
    const citation = { check: vi.fn(check) };
    const quota = { enforceCitationQuota: vi.fn(async () => {}), incrementCitationUsage: vi.fn(async () => {}) };
    const measurement = { run: vi.fn(async (_user: unknown, fn: () => Promise<unknown>) => fn()) };
    const ctrl = new PublicCitationController(citation as never, {} as never, quota as never, measurement as never);
    const warn = vi.spyOn((ctrl as any).log, 'warn').mockImplementation(() => undefined);
    const req = { user: { id: 'u1', subscriptionStatus: 'ACTIVE' }, headers: {}, socket: { remoteAddress: '1.2.3.4' } };
    return { ctrl, req, quota, warn };
  }

  it('ic hata metni istemciye gitmez: sabit Turkce 500, gercek hata loglanir', async () => {
    const icHata = 'Invalid `prisma.publicCitationCheck.create()` invocation: Can\'t reach database server at 10.0.0.5:3306';
    const t = kurUnlock(async () => { throw new Error(icHata); });
    const err = await t.ctrl.unlock(t.req as never, { domain: 'ornek.com' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect((err as HttpException).message).toBe(PUBLIC_CHECK_FAILED_MESSAGE);
    expect(JSON.stringify((err as HttpException).getResponse())).not.toContain('10.0.0.5');
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining(icHata));
    // Olcum yapilmadi — kota dusulmez
    expect(t.quota.incrementCitationUsage).not.toHaveBeenCalled();
  });

  it('status\'lu hata (alan adi 400, haftalik hak 429) oldugu gibi iletilir', async () => {
    const limit = new HttpException({ statusCode: 429, code: 'WEEKLY_MEASUREMENT_LIMIT', message: 'Haftalık ölçüm hakkın doldu.' }, 429);
    const t = kurUnlock(async () => { throw limit; });
    await expect(t.ctrl.unlock(t.req as never, { domain: 'ornek.com' })).rejects.toBe(limit);
    const alan = new BadRequestException('Geçersiz alan adı');
    const t2 = kurUnlock(async () => { throw alan; });
    await expect(t2.ctrl.unlock(t2.req as never, { domain: 'x' })).rejects.toBe(alan);
  });

  it('basari: sonuc doner, taze olcumde kota dusulur', async () => {
    const t = kurUnlock(async () => ({ fromCache: false, queries: [] }));
    await expect(t.ctrl.unlock(t.req as never, { domain: 'ornek.com' })).resolves.toMatchObject({ fromCache: false });
    expect(t.quota.incrementCitationUsage).toHaveBeenCalledWith('u1');
  });
});

// ─── Abonelik ucu: Turnstile, IP siniri, mobil istisna (K2) ─────────────────

describe('POST citation-check/subscribe — kotuye kullanim katmanlari', () => {
  const TARAYICI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const MOBIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RanksUp-iOS/1.0';
  const ORJ_SECRET = process.env.TURNSTILE_SECRET;

  afterEach(() => {
    if (ORJ_SECRET === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = ORJ_SECRET;
    vi.restoreAllMocks();
  });

  function kurAbone(o: { secret?: string; turnstileBasarili?: boolean } = {}) {
    if (o.secret) process.env.TURNSTILE_SECRET = o.secret;
    else delete process.env.TURNSTILE_SECRET;
    const fetchSahte = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ success: o.turnstileBasarili ?? true }), { status: 200 }));
    const subscribers = { subscribe: vi.fn(async () => ({ ok: true as const, status: 'PENDING_OPTIN', alreadyActive: false })) };
    const ctrl = new PublicCitationController({} as never, subscribers as never, {} as never, {} as never);
    const istek = (ua: string, headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' }) =>
      ({ headers: { 'user-agent': ua, ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as never;
    const govde = (extra: Record<string, unknown> = {}) =>
      ({ email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'Ornek', locale: 'tr', consent: true, ...extra }) as never;
    return { ctrl, subscribers, fetchSahte, istek, govde };
  }

  it('Turnstile tanimliyken token siz tarayici istegi 403, servis cagrilmaz', async () => {
    const t = kurAbone({ secret: 'gizli' });
    const err = await t.ctrl.subscribe(t.istek(TARAYICI), t.govde()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as HttpException).message).toBe(TURNSTILE_FAILED_MESSAGE);
    expect(t.subscribers.subscribe).not.toHaveBeenCalled();
  });

  it('gecerli token: Cloudflare siteverify cagrilir (istemci IP ile), normal sinir', async () => {
    const t = kurAbone({ secret: 'gizli', turnstileBasarili: true });
    await t.ctrl.subscribe(t.istek(TARAYICI), t.govde({ turnstileToken: 'tok-1', niche: 'sahte' }));
    expect(t.fetchSahte).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchSahte.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('response')).toBe('tok-1');
    expect(form.get('remoteip')).toBe('203.0.113.7');
    // Nis istemciden servise gecmez; adres basina normal sinir
    expect(t.subscribers.subscribe).toHaveBeenCalledWith(
      { email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'Ornek', locale: 'tr' },
      { welcomePerEmail: SUBSCRIBE_WELCOME_PER_EMAIL },
    );
  });

  it('gecersiz token 403 (mobil istemci token gonderdiyse o da dogrulanir)', async () => {
    const t = kurAbone({ secret: 'gizli', turnstileBasarili: false });
    await expect(t.ctrl.subscribe(t.istek(TARAYICI), t.govde({ turnstileToken: 'sahte' }))).rejects.toMatchObject({ status: 403 });
    await expect(t.ctrl.subscribe(t.istek(MOBIL), t.govde({ turnstileToken: 'sahte' }))).rejects.toMatchObject({ status: 403 });
    expect(t.subscribers.subscribe).not.toHaveBeenCalled();
  });

  it('mobil uygulama token siz: kabul, ama siki sinir (IP basina 2 deneme, adres basina 1 e-posta)', async () => {
    const t = kurAbone({ secret: 'gizli' });
    await t.ctrl.subscribe(t.istek(MOBIL), t.govde());
    await t.ctrl.subscribe(t.istek(MOBIL), t.govde({ email: 'iki@ornek.com' }));
    expect(t.fetchSahte).not.toHaveBeenCalled();
    expect(t.subscribers.subscribe).toHaveBeenLastCalledWith(expect.anything(), { welcomePerEmail: SUBSCRIBE_WELCOME_PER_EMAIL_STRICT });
    const err = await t.ctrl.subscribe(t.istek(MOBIL), t.govde({ email: 'uc@ornek.com' })).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(SUBSCRIBE_IP_LIMIT_MESSAGE);
    expect(t.subscribers.subscribe).toHaveBeenCalledTimes(2);
  });

  it('IP basina 24 saatte 5 deneme; 6.si Turnstile dogrulamasina bile gitmeden 429', async () => {
    const t = kurAbone({ secret: 'gizli' });
    for (let i = 0; i < SUBSCRIBE_IP_LIMIT; i++) {
      await t.ctrl.subscribe(t.istek(TARAYICI), t.govde({ turnstileToken: `tok-${i}` }));
    }
    const err = await t.ctrl.subscribe(t.istek(TARAYICI), t.govde({ turnstileToken: 'tok-x' })).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(t.fetchSahte).toHaveBeenCalledTimes(SUBSCRIBE_IP_LIMIT);
    // Baska IP etkilenmez
    await t.ctrl.subscribe(t.istek(TARAYICI, { 'cf-connecting-ip': '198.51.100.9' }), t.govde({ turnstileToken: 'tok-y' }));
    expect(t.subscribers.subscribe).toHaveBeenCalledTimes(SUBSCRIBE_IP_LIMIT + 1);
  });

  it('X-Forwarded-For\'un soluna her istekte baska IP yazmak siniri atlatmaz (nginx\'in ekledigi adres sayilir)', async () => {
    const t = kurAbone();
    for (let i = 0; i < SUBSCRIBE_IP_LIMIT; i++) {
      await t.ctrl.subscribe(t.istek(TARAYICI, { 'x-forwarded-for': `10.${i}.0.1, 1.1.1.${i}, 198.51.100.20` }), t.govde());
    }
    await expect(
      t.ctrl.subscribe(t.istek(TARAYICI, { 'x-forwarded-for': '8.8.8.8, 198.51.100.20' }), t.govde()),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('Turnstile yapilandirilmamissa token aranmaz, normal sinir', async () => {
    const t = kurAbone();
    await t.ctrl.subscribe(t.istek(TARAYICI), t.govde());
    expect(t.fetchSahte).not.toHaveBeenCalled();
    expect(t.subscribers.subscribe).toHaveBeenCalledWith(expect.anything(), { welcomePerEmail: SUBSCRIBE_WELCOME_PER_EMAIL });
  });

  it('bariz bot UA 403; onaysiz istek 400 ve deneme sayilmaz', async () => {
    const t = kurAbone();
    await expect(t.ctrl.subscribe(t.istek('curl/8.4.0'), t.govde())).rejects.toMatchObject({ status: 403 });
    for (let i = 0; i < 10; i++) {
      await expect(t.ctrl.subscribe(t.istek(TARAYICI), t.govde({ consent: false }))).rejects.toMatchObject({ status: 400 });
    }
    await t.ctrl.subscribe(t.istek(TARAYICI), t.govde());
    expect(t.subscribers.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('POST citation-check — servise giden IP istemcinin yazdigi adres degil', () => {
  afterEach(() => vi.restoreAllMocks());

  function kurKontrol() {
    const citation = { check: vi.fn(async () => ({ fromCache: false, queries: [] })) };
    const ctrl = new PublicCitationController(citation as never, {} as never, {} as never, {} as never);
    const istek = (headers: Record<string, string>) =>
      ({ headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as never;
    return { ctrl, citation, istek };
  }

  it('CF-Connecting-IP varsa o; yoksa XFF\'te nginx\'in ekledigi (sagdan ilk dis) adres', async () => {
    const ORJ = process.env.TURNSTILE_SECRET;
    delete process.env.TURNSTILE_SECRET;
    try {
      const t = kurKontrol();
      await t.ctrl.check(t.istek({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6' }), { domain: 'ornek.com' });
      expect(t.citation.check).toHaveBeenLastCalledWith('ornek.com', '203.0.113.7', 'manual', {});
      await t.ctrl.check(t.istek({ 'x-forwarded-for': '6.6.6.6, 198.51.100.20, 127.0.0.1' }), { domain: 'ornek.com' });
      expect(t.citation.check).toHaveBeenLastCalledWith('ornek.com', '198.51.100.20', 'manual', {});
    } finally {
      if (ORJ === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = ORJ;
    }
  });
});

// ─── Ucretsiz kontrol: mobil uygulama yolu (Turnstile token'siz, siki kademe) ──

describe('POST citation-check — mobil uygulama (Turnstile token gonderemiyor)', () => {
  const TARAYICI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  // mobile/src/api.ts ile ayni User-Agent
  const MOBIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RanksUp-iOS/1.0';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15) RanksUp-Android/1.2';
  const ORJ_SECRET = process.env.TURNSTILE_SECRET;

  afterEach(() => {
    if (ORJ_SECRET === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = ORJ_SECRET;
    vi.restoreAllMocks();
  });

  function kurKontrol(o: { secret?: string; turnstileBasarili?: boolean } = {}) {
    if (o.secret) process.env.TURNSTILE_SECRET = o.secret;
    else delete process.env.TURNSTILE_SECRET;
    const fetchSahte = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ success: o.turnstileBasarili ?? true }), { status: 200 }));
    const citation = {
      check: vi.fn(async () => ({ fromCache: false, queries: [] })),
      checkRateLimit: vi.fn(async () => ({ ok: true, remaining: 1 })),
    };
    const ctrl = new PublicCitationController(citation as never, {} as never, {} as never, {} as never);
    const istek = (ua: string) => ({ headers: { 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } }) as never;
    return { ctrl, citation, fetchSahte, istek };
  }

  it('Turnstile tanimliyken token siz tarayici istegi 403 (degismedi), servis cagrilmaz', async () => {
    const t = kurKontrol({ secret: 'gizli' });
    const err = await t.ctrl.check(t.istek(TARAYICI), { domain: 'ornek.com' }).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as HttpException).message).toBe(TURNSTILE_FAILED_MESSAGE);
    expect(t.citation.check).not.toHaveBeenCalled();
  });

  it('token siz iOS/Android uygulamasi kabul edilir ama siki IP kademesiyle (2 alan adi / 24 saat)', async () => {
    const t = kurKontrol({ secret: 'gizli' });
    await t.ctrl.check(t.istek(MOBIL), { domain: 'ornek.com' });
    expect(t.citation.check).toHaveBeenLastCalledWith('ornek.com', '203.0.113.7', 'manual', { ipDailyLimit: PUBLIC_CHECK_IP_LIMIT_STRICT });
    await t.ctrl.check(t.istek(ANDROID), { domain: 'ornek.com', turnstileToken: '   ' });
    expect(t.citation.check).toHaveBeenLastCalledWith('ornek.com', '203.0.113.7', 'manual', { ipDailyLimit: PUBLIC_CHECK_IP_LIMIT_STRICT });
    // Turnstile'a hic gidilmedi
    expect(t.fetchSahte).not.toHaveBeenCalled();
    expect(PUBLIC_CHECK_IP_LIMIT_STRICT).toBe(2);
  });

  it('token gonderen mobil istemci dogrulanir: gecersiz token 403, gecerli token normal kademe', async () => {
    const kotu = kurKontrol({ secret: 'gizli', turnstileBasarili: false });
    await expect(kotu.ctrl.check(kotu.istek(MOBIL), { domain: 'ornek.com', turnstileToken: 'sahte' })).rejects.toMatchObject({ status: 403 });
    expect(kotu.citation.check).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const iyi = kurKontrol({ secret: 'gizli', turnstileBasarili: true });
    await iyi.ctrl.check(iyi.istek(MOBIL), { domain: 'ornek.com', turnstileToken: 'tok-1' });
    expect(iyi.fetchSahte).toHaveBeenCalledTimes(1);
    expect(iyi.citation.check).toHaveBeenLastCalledWith('ornek.com', '203.0.113.7', 'manual', {});
  });

  it('Turnstile yapilandirilmamissa mobil de tarayici da normal kademe', async () => {
    const t = kurKontrol();
    await t.ctrl.check(t.istek(MOBIL), { domain: 'ornek.com' });
    expect(t.citation.check).toHaveBeenLastCalledWith('ornek.com', '203.0.113.7', 'manual', {});
    expect(t.fetchSahte).not.toHaveBeenCalled();
  });

  it('ayni IP\'den token siz kontrol bir anda tek: paralel istek siniri yaris ile asamaz', async () => {
    const t = kurKontrol({ secret: 'gizli' });
    let bitir!: (v: unknown) => void;
    t.citation.check.mockImplementationOnce(() => new Promise((res) => { bitir = res; }) as never);
    const ilk = t.ctrl.check(t.istek(MOBIL), { domain: 'a.com' });
    const err = await t.ctrl.check(t.istek(MOBIL), { domain: 'b.com' }).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(PUBLIC_CHECK_IN_FLIGHT_MESSAGE);
    expect(t.citation.check).toHaveBeenCalledTimes(1);
    // Token'li (dogrulanan) istek kilide takilmaz
    await t.ctrl.check(t.istek(TARAYICI), { domain: 'c.com', turnstileToken: 'tok' });
    bitir({ fromCache: false, queries: [] });
    await ilk;
    // Ilk kontrol bitince kilit kalkar (hata durumunda da: finally)
    await t.ctrl.check(t.istek(MOBIL), { domain: 'b.com' });
    t.citation.check.mockRejectedValueOnce(new Error('db yok'));
    await expect(t.ctrl.check(t.istek(MOBIL), { domain: 'd.com' })).rejects.toMatchObject({ status: 500 });
    await t.ctrl.check(t.istek(MOBIL), { domain: 'e.com' });
    expect(t.citation.check).toHaveBeenCalledTimes(5);
  });

  it('kalan hak ucu check() ile ayni kademeyi raporlar', async () => {
    const t = kurKontrol({ secret: 'gizli' });
    await t.ctrl.rateLimit(t.istek(MOBIL));
    expect(t.citation.checkRateLimit).toHaveBeenLastCalledWith('203.0.113.7', PUBLIC_CHECK_IP_LIMIT_STRICT);
    await t.ctrl.rateLimit(t.istek(TARAYICI));
    expect(t.citation.checkRateLimit).toHaveBeenLastCalledWith('203.0.113.7', undefined);
  });
});
