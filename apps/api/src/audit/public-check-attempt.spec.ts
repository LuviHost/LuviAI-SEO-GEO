import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  ATTEMPT_EMAIL_DAILY_CAP, ATTEMPT_GLOBAL_DAILY_CAP, ATTEMPT_INAPP_DAILY_CAP, ATTEMPT_IP_DAILY_CAP,
  ATTEMPT_LABEL_TR, ATTEMPT_OUTCOMES,
  attemptDetail, attemptHost, attemptNotification, emailPolicy, isCappedOutcome, notifyKey,
  outcomeOfError, outcomeOfResult, summaryOfResult,
} from './public-check-attempt.js';
import { PublicCheckAttemptService } from './public-check-attempt.service.js';
import { PublicCitationController, TURNSTILE_FAILED_MESSAGE } from './public-citation.controller.js';
import { PUBLIC_BUDGET_MESSAGE } from './public-citation.service.js';
import { normalizePublicDomainInput } from '../sites/site-url-policy.js';

/**
 * Ucretsiz testin HER denemesi kaydedilir ve yoneticiye haber verilir (14.11.2026, sahip:
 * "uye olmadan tarayan herkesi kaydetmek istiyorum, kacirmak istemiyorum").
 * Eskiden yalniz TAZE olcum yaziliyordu: kayitli sonucu goren, sinira takilan ve tamamlanamayan
 * deneme iz birakmiyordu; taze olcumden de kimse haber almiyordu.
 *
 * Bagimsiz incelemenin (ayni gun) buldugu ve burada sabitlenenler: ham girdi saklanmaz; taze olcum
 * hicbir tavana girmez (ucuz denemeler tavani doldurup gercek olcumu yutamaz); onceki deneme taze
 * olcumun bildirimini yutmaz; kayit tarafinin hicbir hatasi (esZamanli, reddedilen soz, hic
 * bitmeyen is) ziyaretcinin cevabini etkilemez.
 */

const bekle = () => new Promise((r) => setTimeout(r, 0));

describe('kurallar', () => {
  it('alan adi: normalize host; alan adina cevrilemeyen girdi YAZILMAZ (ham metin saklanmaz)', () => {
    expect(attemptHost('https://WWW.Ornek.com/sayfa?x=1', normalizePublicDomainInput)).toBe('ornek.com');
    // Ziyaretci kutuya e-posta ya da serbest metin yazabilir: kayda ve bildirime girmez
    expect(attemptHost('ali@firma.com', normalizePublicDomainInput)).toBeNull();
    expect(attemptHost('  bu bir alan adı değil  ', normalizePublicDomainInput)).toBeNull();
    expect(attemptHost(undefined, normalizePublicDomainInput)).toBeNull();
    expect(attemptHost('x', () => ({ host: '' }))).toBeNull();
  });

  it('sonuc: taze olcum / kayitli sonuc; hata: haftalik sinir / gunluk tavan / tamamlanamadi', () => {
    expect(outcomeOfResult({ fromCache: false })).toBe('measured');
    expect(outcomeOfResult({ fromCache: true })).toBe('cached');
    expect(outcomeOfError({ status: 429, message: 'Haftalık ücretsiz test hakkınız doldu: …' }, PUBLIC_BUDGET_MESSAGE)).toBe('rate_limited');
    expect(outcomeOfError({ status: 429, message: PUBLIC_BUDGET_MESSAGE }, PUBLIC_BUDGET_MESSAGE)).toBe('budget');
    expect(outcomeOfError({ status: 400, message: 'Alan adı çözülemedi' }, PUBLIC_BUDGET_MESSAGE)).toBe('failed');
    expect(outcomeOfError(new Error('Prisma patladi'), PUBLIC_BUDGET_MESSAGE)).toBe('failed');
    for (const o of ATTEMPT_OUTCOMES) expect(ATTEMPT_LABEL_TR[o]).toBeTruthy();
  });

  it('ayrinti: yalniz ziyaretciye gosterilen (status\'lu) mesaj; ic hata metni kayda girmez', () => {
    expect(attemptDetail({ status: 400, message: 'Alan adı   çözülemedi' })).toBe('Alan adı çözülemedi');
    expect(attemptDetail(new Error('ECONNREFUSED 10.0.0.5:3306'))).toBeNull();
    expect(attemptDetail({ status: 429, message: 'x'.repeat(400) })).toHaveLength(190);
  });

  it('tavan ve e-posta kurali: taze olcum tavansiz ve her zaman e-posta; tamamlanamayan e-postasiz', () => {
    expect(ATTEMPT_OUTCOMES.filter(isCappedOutcome)).toEqual(['cached', 'rate_limited', 'budget', 'failed']);
    expect(ATTEMPT_OUTCOMES.map(emailPolicy)).toEqual(['always', 'capped', 'capped', 'capped', 'never']);
    // Bildirim araligi alan adi + sonuc: hata, ardindan gelen olcumu yutmaz
    expect(notifyKey('ornek.com', 'failed')).not.toBe(notifyKey('ornek.com', 'measured'));
  });

  it('ozet: yalniz acik ve markasiz sorular sayilir (admin listesiyle ayni payda)', () => {
    expect(summaryOfResult({
      brand: 'Murat Aktaş', niche: 'sağlık', customNiche: 'tıbbi turizm',
      queries: [
        { citedCount: 1, totalProviders: 4 },
        { citedCount: 0, totalProviders: 4 },
        { citedCount: 0, totalProviders: 4 },
        { locked: true, citedCount: 0, totalProviders: 0 },
        { brandInQuery: true, citedCount: 4, totalProviders: 4 },
      ],
    })).toEqual({ brand: 'Murat Aktaş', niche: 'tıbbi turizm', cited: 1, total: 12 });
    expect(summaryOfResult(null)).toEqual({});
  });

  it('bildirim: baslikta alan adi ve ne oldugu; govdede kisi bilgisi yok', () => {
    const olculdu = attemptNotification({ domain: 'murataktas.co.uk', outcome: 'measured', summary: { brand: 'Murat Aktaş', niche: 'tıbbi turizm', cited: 1, total: 12 } });
    expect(olculdu.title).toBe('Ücretsiz test: murataktas.co.uk (ölçüldü)');
    expect(olculdu.body).toBe('Murat Aktaş · tıbbi turizm\nSonuç: 1/12 cevapta kaynak gösterildi.\nAna sayfadaki ücretsiz testle yapılan yeni bir ölçüm.');

    const kayitli = attemptNotification({ domain: 'ornek.com', outcome: 'cached', summary: { brand: 'Örnek', cited: 0, total: 12 } });
    expect(kayitli.title).toBe('Ücretsiz test: ornek.com (kayıtlı sonucu gördü)');
    expect(kayitli.body).toContain('ziyaretçi kayıtlı sonucu gördü, yeni ölçüm yapılmadı');

    // Sinir IP basinadir: "ziyaretci baska site test etmisti" denmez
    const sinir = attemptNotification({ domain: 'ornek.com', outcome: 'rate_limited' }).body;
    expect(sinir).toContain('Aynı IP adresinden bu hafta başka bir alan adı test edilmişti');
    expect(sinir).not.toContain('Ziyaretçi');
    expect(attemptNotification({ domain: 'ornek.com', outcome: 'budget' }).body).toContain('Günlük ücretsiz test tavanı');
    expect(attemptNotification({ domain: 'yok.example', outcome: 'failed', detail: 'Alan adı çözülemedi' }).body).toBe('Test tamamlanamadı: Alan adı çözülemedi');
    expect(attemptNotification({ domain: 'yok.example', outcome: 'failed' }).body).toBe('Test tamamlanamadı.');
  });

  it('baslik 190 karakteri gecmez (bildirim sutunu 191): uzun alan adi kirpilir, sonuc eki kalir', () => {
    const uzun = `${'a'.repeat(180)}.com`;
    const t = attemptNotification({ domain: uzun, outcome: 'rate_limited' }).title;
    expect(t.length).toBeLessThanOrEqual(190);
    expect(t.endsWith('… (haftalık sınıra takıldı)')).toBe(true);
    expect(attemptNotification({ domain: 'kisa.com', outcome: 'rate_limited' }).title).toBe('Ücretsiz test: kisa.com (haftalık sınıra takıldı)');
  });
});

describe('PublicCheckAttemptService — kayit + bildirim', () => {
  function kur(o: { admin?: { id: string } | null; createHata?: boolean; bildirimHata?: boolean } = {}) {
    const satirlar: any[] = [];
    const prisma = {
      publicCheckAttempt: {
        create: vi.fn(async ({ data }: any) => {
          if (o.createHata) throw new Error('tablo yok');
          const row = { id: `a${satirlar.length + 1}`, ...data };
          satirlar.push(row);
          return { id: row.id };
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(satirlar.find((s) => s.id === where.id), data)),
      },
      user: { findFirst: vi.fn(async () => (o.admin === undefined ? { id: 'admin1' } : o.admin)) },
    };
    const notifications = {
      create: vi.fn(async (_: any) => { if (o.bildirimHata) throw new Error('posta gitmedi'); return { id: 'n1' }; }),
    };
    const svc = new PublicCheckAttemptService(prisma as never, notifications as never);
    const kanallar = () => notifications.create.mock.calls.map((c: any[]) => `${c[0].title} → ${c[0].channels.join('+')}`);
    return { svc, prisma, notifications, satirlar, kanallar };
  }

  it('taze olcum yazilir; yoneticiye panel + e-posta bildirimi gider ve kayit damgalanir', async () => {
    const t = kur();
    await t.svc.record({ domain: 'murataktas.co.uk', outcome: 'measured', ipHash: 'h1', checkId: 'c1', summary: { brand: 'Murat Aktaş', cited: 1, total: 12 } });
    expect(t.satirlar[0]).toMatchObject({ domain: 'murataktas.co.uk', outcome: 'measured', checkId: 'c1', ip: 'h1', detail: null });
    expect(t.notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin1', type: 'SYSTEM', title: 'Ücretsiz test: murataktas.co.uk (ölçüldü)',
      link: '/admin/leads', refKind: 'public_check_attempt', refId: 'a1', channels: ['inapp', 'email'],
    }));
    expect(t.satirlar[0].notifiedAt).toBeInstanceOf(Date);
  });

  it('ayni alan adi + ayni sonuc icin yarim saatte tek bildirim; deneme yine yazilir', async () => {
    const t = kur();
    await t.svc.record({ domain: 'ornek.com', outcome: 'cached', ipHash: 'h1' });
    await t.svc.record({ domain: 'ornek.com', outcome: 'cached', ipHash: 'h2' });
    await t.svc.record({ domain: 'baska.com', outcome: 'cached', ipHash: 'h2' });
    expect(t.satirlar).toHaveLength(3);
    expect(t.notifications.create).toHaveBeenCalledTimes(2);
    expect(t.satirlar[1].notifiedAt).toBeUndefined();
  });

  it('onceki "tamamlanamadi", ardindan gelen taze olcumun bildirimini YUTMAZ', async () => {
    const t = kur();
    await t.svc.record({ domain: 'firma.com', outcome: 'failed', ipHash: 'h1', detail: 'Alan adı çözülemedi' });
    await t.svc.record({ domain: 'firma.com', outcome: 'measured', ipHash: 'h1', checkId: 'c9' });
    expect(t.kanallar()).toEqual([
      'Ücretsiz test: firma.com (tamamlanamadı) → inapp',
      'Ücretsiz test: firma.com (ölçüldü) → inapp+email',
    ]);
  });

  it('tamamlanamayan deneme e-posta gondermez (cozulmeyen alan adi ucuza uretilir); panelde gorunur', async () => {
    const t = kur();
    await t.svc.record({ domain: 'rastgele-xyz.com', outcome: 'failed', ipHash: 'h1' });
    expect(t.kanallar()).toEqual(['Ücretsiz test: rastgele-xyz.com (tamamlanamadı) → inapp']);
    expect(t.satirlar[0].notifiedAt).toBeInstanceOf(Date);
  });

  it(`ucuz denemeler: ayni IP'den 24 saatte en fazla ${ATTEMPT_IP_DAILY_CAP} kayit`, async () => {
    const t = kur();
    for (let i = 0; i < ATTEMPT_IP_DAILY_CAP + 5; i++) await t.svc.record({ domain: `site${i}.com`, outcome: 'rate_limited', ipHash: 'ayni' });
    expect(t.satirlar).toHaveLength(ATTEMPT_IP_DAILY_CAP);
    await t.svc.record({ domain: 'baska.com', outcome: 'cached', ipHash: 'baska-ip' });
    expect(t.satirlar).toHaveLength(ATTEMPT_IP_DAILY_CAP + 1);
  });

  it(`ucuz denemeler: gunde en fazla ${ATTEMPT_EMAIL_DAILY_CAP} e-posta; fazlasi yalniz panele duser (musteri e-postalarinin kotasi korunur)`, async () => {
    const t = kur();
    // Her biri baska IP ve baska alan adi: IP siniri ve bildirim araligi devreye girmez
    for (let i = 0; i < ATTEMPT_EMAIL_DAILY_CAP + 3; i++) await t.svc.record({ domain: `firma${i}.com`, outcome: 'rate_limited', ipHash: `ip${i}` });
    const k = t.notifications.create.mock.calls.map((c: any[]) => c[0].channels.join('+'));
    expect(k.filter((x: string) => x === 'inapp+email')).toHaveLength(ATTEMPT_EMAIL_DAILY_CAP);
    expect(k.filter((x: string) => x === 'inapp')).toHaveLength(3);
    expect(t.satirlar).toHaveLength(ATTEMPT_EMAIL_DAILY_CAP + 3);
  });

  it(`ucuz denemeler: gunde en fazla ${ATTEMPT_INAPP_DAILY_CAP} panel bildirimi ve ${ATTEMPT_GLOBAL_DAILY_CAP} kayit`, async () => {
    const t = kur();
    for (let i = 0; i < ATTEMPT_GLOBAL_DAILY_CAP + 4; i++) await t.svc.record({ domain: `d${i}.com`, outcome: 'failed', ipHash: `ip${i}` });
    expect(t.satirlar).toHaveLength(ATTEMPT_GLOBAL_DAILY_CAP);
    expect(t.notifications.create).toHaveBeenCalledTimes(ATTEMPT_INAPP_DAILY_CAP);
  });

  it('BUTUN tavanlar doluyken taze olcum yine yazilir ve e-postayla bildirilir (ucuz denemeler gercek olcumu yutamaz)', async () => {
    const t = kur();
    // Token'siz mobil yolu taklit eden trafik: e-posta, panel ve kayit tavanlari doluyor
    for (let i = 0; i < ATTEMPT_EMAIL_DAILY_CAP + 2; i++) await t.svc.record({ domain: `e${i}.com`, outcome: 'rate_limited', ipHash: `ip${i}` });
    for (let i = 0; i < ATTEMPT_GLOBAL_DAILY_CAP; i++) await t.svc.record({ domain: `d${i}.com`, outcome: 'failed', ipHash: `ipx${i}` });
    const once = t.satirlar.length;
    expect(once).toBe(ATTEMPT_GLOBAL_DAILY_CAP);
    t.notifications.create.mockClear();

    // Ayni (tavani dolmus) IP'den gercek bir olcum
    await t.svc.record({ domain: 'gercek-firma.com', outcome: 'measured', ipHash: 'ip0', checkId: 'c1' });
    expect(t.satirlar).toHaveLength(once + 1);
    expect(t.kanallar()).toEqual(['Ücretsiz test: gercek-firma.com (ölçüldü) → inapp+email']);
    // Ucuz deneme ise artik yazilmiyor
    await t.svc.record({ domain: 'bir-daha.com', outcome: 'cached', ipHash: 'yeni-ip' });
    expect(t.satirlar).toHaveLength(once + 1);
  });

  it('hicbir hata disari cikmaz: tablo yazilamazsa, admin yoksa, bildirim gonderilemezse', async () => {
    await expect(kur({ createHata: true }).svc.record({ domain: 'ornek.com', outcome: 'measured', ipHash: 'h' })).resolves.toBeUndefined();
    const adminsiz = kur({ admin: null });
    await expect(adminsiz.svc.record({ domain: 'ornek.com', outcome: 'measured', ipHash: 'h' })).resolves.toBeUndefined();
    expect(adminsiz.satirlar).toHaveLength(1);
    expect(adminsiz.notifications.create).not.toHaveBeenCalled();
    const postasiz = kur({ bildirimHata: true });
    await expect(postasiz.svc.record({ domain: 'ornek.com', outcome: 'measured', ipHash: 'h' })).resolves.toBeUndefined();
    expect(postasiz.satirlar[0].notifiedAt).toBeUndefined();
  });
});

describe('POST citation-check — deneme kaydi', () => {
  const TARAYICI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const MOBIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RanksUp-iOS/1.0';
  const ORJ_SECRET = process.env.TURNSTILE_SECRET;
  afterEach(() => {
    if (ORJ_SECRET === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = ORJ_SECRET;
    vi.restoreAllMocks();
  });

  function kur(check: () => Promise<unknown>, o: { secret?: string; turnstileBasarili?: boolean; attempts?: unknown } = {}) {
    if (o.secret) process.env.TURNSTILE_SECRET = o.secret;
    else delete process.env.TURNSTILE_SECRET;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: o.turnstileBasarili ?? true }), { status: 200 }));
    const citation = {
      check: vi.fn(check),
      ipHash: (ip: string) => `hash(${ip})`,
      hostOf: (d: unknown) => normalizePublicDomainInput(d),
    };
    const attempts = o.attempts === undefined ? { record: vi.fn(async () => undefined) } : o.attempts;
    const ctrl = new PublicCitationController(citation as never, {} as never, {} as never, {} as never, attempts as never);
    const istek = (ua = TARAYICI) => ({ headers: { 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } }) as never;
    return { ctrl, citation, attempts: attempts as { record: ReturnType<typeof vi.fn> }, istek };
  }

  const sonuc = (over: Record<string, unknown> = {}) => ({
    domain: 'murataktas.co.uk', brand: 'Murat Aktaş', niche: 'sağlık', customNiche: null, fromCache: false, checkId: 'c1',
    queries: [{ citedCount: 1, totalProviders: 4 }, { citedCount: 0, totalProviders: 4 }, { locked: true }],
    ...over,
  });

  it('taze olcum: "measured", olcum kaydinin kimligi ve ozetle; ham IP degil ozet gider', async () => {
    const t = kur(async () => sonuc());
    await t.ctrl.check(t.istek(), { domain: 'https://www.murataktas.co.uk/' });
    await bekle();
    expect(t.attempts.record).toHaveBeenCalledTimes(1);
    expect(t.attempts.record).toHaveBeenCalledWith({
      domain: 'murataktas.co.uk', outcome: 'measured', ipHash: 'hash(203.0.113.7)', checkId: 'c1', detail: null,
      summary: { brand: 'Murat Aktaş', niche: 'sağlık', cited: 1, total: 8 },
    });
  });

  it('kayitli sonuc (onbellek): "cached" — eskiden hic iz birakmiyordu', async () => {
    const t = kur(async () => sonuc({ fromCache: true, checkId: 'eski-kayit' }));
    await t.ctrl.check(t.istek(), { domain: 'murataktas.co.uk' });
    await bekle();
    expect(t.attempts.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'cached', checkId: null }));
  });

  it('haftalik sinir ve gunluk tavan: deneme yazilir, hata ziyaretciye oldugu gibi gider', async () => {
    const sinir = kur(async () => { throw new HttpException('Haftalık ücretsiz test hakkınız doldu: …', HttpStatus.TOO_MANY_REQUESTS); });
    await expect(sinir.ctrl.check(sinir.istek(), { domain: 'ikinci-site.com' })).rejects.toMatchObject({ status: 429 });
    await bekle();
    expect(sinir.attempts.record).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'ikinci-site.com', outcome: 'rate_limited', checkId: null, detail: 'Haftalık ücretsiz test hakkınız doldu: …',
    }));

    const tavan = kur(async () => { throw new HttpException(PUBLIC_BUDGET_MESSAGE, HttpStatus.TOO_MANY_REQUESTS); });
    await expect(tavan.ctrl.check(tavan.istek(), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 429 });
    await bekle();
    expect(tavan.attempts.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'budget' }));
  });

  it('tamamlanamayan: cozulmeyen alan adi mesajiyla; ic hata mesajsiz (metin kayda girmez)', async () => {
    const alan = kur(async () => { throw new HttpException('Alan adı çözülemedi', HttpStatus.BAD_REQUEST); });
    await expect(alan.ctrl.check(alan.istek(), { domain: 'yok-boyle-bir-site.example' })).rejects.toMatchObject({ status: 400 });
    await bekle();
    expect(alan.attempts.record).toHaveBeenCalledWith(expect.objectContaining({ domain: 'yok-boyle-bir-site.example', outcome: 'failed', detail: 'Alan adı çözülemedi' }));

    const ic = kur(async () => { throw new Error('ECONNREFUSED 10.0.0.5:3306'); });
    await expect(ic.ctrl.check(ic.istek(), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 500 });
    await bekle();
    expect(ic.attempts.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', detail: null }));
  });

  it('alan adina cevrilemeyen girdi (e-posta, serbest metin) YAZILMAZ: ham metin kayda ve e-postaya girmez', async () => {
    for (const girdi of ['ali@firma.com', 'merhaba dünya', 'ranksup.ai@evil.example/giris']) {
      const t = kur(async () => { throw new HttpException('Geçerli bir alan adı girin', HttpStatus.BAD_REQUEST); });
      await expect(t.ctrl.check(t.istek(), { domain: girdi })).rejects.toMatchObject({ status: 400 });
      await bekle();
      expect(t.attempts.record, girdi).not.toHaveBeenCalled();
    }
  });

  it('insan dogrulamasini gecemeyen ve bot istegi YAZILMAZ (kayit dogrulamadan sonra baslar)', async () => {
    const dogrulanmadi = kur(async () => sonuc(), { secret: 'gizli', turnstileBasarili: false });
    const err = await dogrulanmadi.ctrl.check(dogrulanmadi.istek(), { domain: 'ornek.com', turnstileToken: 'sahte' }).catch((e: unknown) => e);
    expect((err as HttpException).message).toBe(TURNSTILE_FAILED_MESSAGE);
    await bekle();
    expect(dogrulanmadi.attempts.record).not.toHaveBeenCalled();

    const tokensiz = kur(async () => sonuc(), { secret: 'gizli' });
    await expect(tokensiz.ctrl.check(tokensiz.istek(), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 403 });
    await bekle();
    expect(tokensiz.attempts.record).not.toHaveBeenCalled();

    const bot = kur(async () => sonuc());
    await expect(bot.ctrl.check(bot.istek('python-requests/2.32'), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 403 });
    await bekle();
    expect(bot.attempts.record).not.toHaveBeenCalled();
  });

  it('token\'siz mobil yol (User-Agent taklit edilebilir): gecerli alan adi yazilir, gecersiz girdi yazilmaz', async () => {
    const gecerli = kur(async () => { throw new HttpException('Haftalık ücretsiz test hakkınız doldu: …', HttpStatus.TOO_MANY_REQUESTS); }, { secret: 'gizli' });
    await expect(gecerli.ctrl.check(gecerli.istek(MOBIL), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 429 });
    await bekle();
    expect(gecerli.attempts.record).toHaveBeenCalledWith(expect.objectContaining({ domain: 'ornek.com', outcome: 'rate_limited' }));

    const cop = kur(async () => { throw new HttpException('Geçerli bir alan adı girin', HttpStatus.BAD_REQUEST); }, { secret: 'gizli' });
    await expect(cop.ctrl.check(cop.istek(MOBIL), { domain: 'rastgele metin 12345' })).rejects.toMatchObject({ status: 400 });
    await bekle();
    expect(cop.attempts.record).not.toHaveBeenCalled();
  });

  it('kayit BEKLENMEZ: hic bitmeyen kayit isi ziyaretcinin cevabini geciktirmez', async () => {
    const t = kur(async () => sonuc(), { attempts: { record: vi.fn(() => new Promise(() => undefined)) } });
    await expect(t.ctrl.check(t.istek(), { domain: 'murataktas.co.uk' })).resolves.toMatchObject({ domain: 'murataktas.co.uk' });
  });

  it('kayit tarafi bozuksa test yine sonuc doner: eksik servis, esZamanli firlatan, reddedilen soz (yakalanmamis ret olusmaz)', async () => {
    const yakalanmamis: unknown[] = [];
    const dinle = (e: unknown) => { yakalanmamis.push(e); };
    process.on('unhandledRejection', dinle);
    try {
      const eksik = kur(async () => sonuc(), { attempts: null });
      await expect(eksik.ctrl.check(eksik.istek(), { domain: 'murataktas.co.uk' })).resolves.toMatchObject({ domain: 'murataktas.co.uk' });

      const firlatan = kur(async () => sonuc(), { attempts: { record: vi.fn(() => { throw new Error('beklenmedik'); }) } });
      await expect(firlatan.ctrl.check(firlatan.istek(), { domain: 'murataktas.co.uk' })).resolves.toMatchObject({ domain: 'murataktas.co.uk' });

      const reddeden = kur(async () => sonuc(), { attempts: { record: vi.fn(async () => { throw new Error('tablo yok'); }) } });
      await expect(reddeden.ctrl.check(reddeden.istek(), { domain: 'murataktas.co.uk' })).resolves.toMatchObject({ domain: 'murataktas.co.uk' });
      // Hata yolunda da (ziyaretciye 429 giderken) kayit hatasi ayri bir ret uretmez
      const ikisi = kur(async () => { throw new HttpException('Haftalık ücretsiz test hakkınız doldu: …', HttpStatus.TOO_MANY_REQUESTS); }, { attempts: { record: vi.fn(async () => { throw new Error('tablo yok'); }) } });
      await expect(ikisi.ctrl.check(ikisi.istek(), { domain: 'ornek.com' })).rejects.toMatchObject({ status: 429 });

      await bekle();
      await bekle();
      expect(yakalanmamis).toEqual([]);
    } finally {
      process.off('unhandledRejection', dinle);
    }
  });
});
