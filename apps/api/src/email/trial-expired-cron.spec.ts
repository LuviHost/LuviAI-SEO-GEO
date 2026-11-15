import { describe, it, expect, vi, afterEach } from 'vitest';
import { EMAIL_NOT_SENT_STATUSES, EmailService, HAVALE_YOLU, denemeBitti, type EmailTemplate } from './email.service.js';
import { EmailCron, TRIAL_EXPIRED_WINDOW_DAYS, trialJustExpired } from './email.cron.js';

/**
 * "Deneme süren doldu" e-postasi GONDERILIR (15.11.2026, sahip: "gönderilmeyen mailler vardı,
 * bunları da bağlamamız gerekli").
 *
 * NEDEN VAR: `trial_expired` sablonu yazilmisti ama onu gonderen kod yoktu; denemesi biten hesap
 * d11 ve d13 uyarilarini aliyor, sure dolunca hicbir sey almiyordu. Baglanirken kurallar:
 *  - bir kez (pencere birkac gun acik; kayit ikinci gonderimi engeller),
 *  - yoneticiye ve eski musteriye (PAID faturasi olan) gitmez,
 *  - denemesi coktan bitmis hesaba gec e-posta gitmez,
 *  - metin simdiki zamanli: "bittiğinde … olur" degil.
 */

const DAY = 86_400_000;

describe('trialJustExpired — pencere', () => {
  const now = Date.parse('2026-11-15T06:00:00Z');

  it('sure dolmadan false; doldugu andan itibaren pencere boyunca true; sonra false', () => {
    expect(trialJustExpired(now + 1, now)).toBe(false);
    expect(trialJustExpired(now, now)).toBe(true);
    expect(trialJustExpired(now - 1 * DAY, now)).toBe(true);
    expect(trialJustExpired(now - TRIAL_EXPIRED_WINDOW_DAYS * DAY + 1, now)).toBe(true);
    expect(trialJustExpired(now - TRIAL_EXPIRED_WINDOW_DAYS * DAY, now)).toBe(false);
    expect(trialJustExpired(now - 30 * DAY, now)).toBe(false);
  });

  it('pencere en az iki gun: gorev bir gun calismasa da e-posta kaybolmaz', () => {
    expect(TRIAL_EXPIRED_WINDOW_DAYS).toBeGreaterThanOrEqual(2);
  });
});

describe('EmailCron — deneme bitince "süren doldu" e-postasi', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  async function run(opts: {
    /** Deneme bitisi: simdiye gore gun (negatif = gecmis) */
    endsInDays: number;
    role?: string;
    testMode?: string;
    /** Bu hesap icin kayitli `trial_expired` e-postasi durumlari */
    logged?: string[];
    paid?: boolean;
  }) {
    process.env.PAYTR_TEST_MODE = opts.testMode ?? '0';
    const now = Date.now();
    const users = [{
      id: 'u1', email: 'a@ornek.com', name: 'Ayşe', role: opts.role ?? 'USER',
      createdAt: new Date(now - 20 * DAY),
      trialEndsAt: new Date(now + opts.endsInDays * DAY),
    }];
    const email = { send: vi.fn(async () => ({ ok: true })) };
    const emailLogFindFirst = vi.fn(async ({ where }: any) => {
      // Gercek sorgu gibi: gitmemis sayilan durumlar suzulur
      const sayilan = (opts.logged ?? []).filter((s) => !(where.status.notIn as string[]).includes(s));
      return sayilan.length ? { id: 'log1' } : null;
    });
    const invoiceFindFirst = vi.fn(async () => (opts.paid ? { id: 'inv1' } : null));
    const userFindMany = vi.fn(async () => users);
    const cron = new EmailCron({
      user: { findMany: userFindMany },
      kvStore: { create: vi.fn(async () => ({})) },
      emailLog: { findFirst: emailLogFindFirst },
      invoice: { findFirst: invoiceFindFirst },
    } as any, email as any);
    await cron.dailyEmails();
    return { sent: email.send.mock.calls.map((c: any[]) => c[0]), emailLogFindFirst, invoiceFindFirst, userFindMany };
  }

  it('aday kumesi: deneme planindaki, e-postasi dogrulanmis hesaplar (plan alan hesap disarida)', async () => {
    const { userFindMany } = await run({ endsInDays: -0.75 });
    expect((userFindMany.mock.calls[0] as any[])[0]).toEqual({ where: { plan: 'TRIAL', emailVerified: { not: null } } });
  });

  it('denemesi dun biten hesap e-postayi alir (satin alma acik: salt okunur)', async () => {
    const { sent, emailLogFindFirst } = await run({ endsInDays: -0.75 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: 'u1', to: 'a@ornek.com', template: 'trial_expired', data: { name: 'Ayşe', readOnlyAtEnd: true } });
    // Bir kez kurali kayda bakar: yalniz bu hesap, bu sablon, GITMIS sayilan kayitlar
    expect(emailLogFindFirst.mock.calls[0][0].where).toEqual({
      userId: 'u1', template: 'trial_expired', status: { notIn: [...EMAIL_NOT_SENT_STATUSES] },
    });
  });

  it('satin alma kapaliyken (test modu) de gider; metin kilit demez', async () => {
    const { sent } = await run({ endsInDays: -0.75, testMode: '1' });
    expect(sent.map((m: any) => m.template)).toEqual(['trial_expired']);
    expect(sent[0].data).toMatchObject({ readOnlyAtEnd: false });
  });

  it('BIR KEZ: daha once gittiyse pencere icindeki sonraki gunlerde yeniden gitmez', async () => {
    for (const durum of ['sent', 'delivered', 'opened']) {
      expect((await run({ endsInDays: -1.75, logged: [durum] })).sent, durum).toEqual([]);
    }
  });

  it('onceki deneme GITMEDIYSE (saglayici yok / hata) ertesi gun yeniden denenir', async () => {
    for (const durum of EMAIL_NOT_SENT_STATUSES) {
      expect((await run({ endsInDays: -1.75, logged: [durum] })).sent.map((m: any) => m.template), durum).toEqual(['trial_expired']);
    }
  });

  it('eski musteriye gitmez: plani denemeye dusmus ama odeme yapmis hesap deneme hesabi degildir', async () => {
    const { sent, invoiceFindFirst } = await run({ endsInDays: -0.75, paid: true });
    expect(sent).toEqual([]);
    expect(invoiceFindFirst).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'PAID' }, select: { id: true } });
  });

  it('yoneticiye gitmez (deneme kurallarina takilmaz); kayit bile sorulmaz', async () => {
    const { sent, emailLogFindFirst } = await run({ endsInDays: -0.75, role: 'ADMIN' });
    expect(sent).toEqual([]);
    expect(emailLogFindFirst).not.toHaveBeenCalled();
  });

  it('denemesi coktan bitmis hesaba gec e-posta gitmez; kayit bile sorulmaz', async () => {
    for (const gun of [-TRIAL_EXPIRED_WINDOW_DAYS - 0.25, -30]) {
      const { sent, emailLogFindFirst } = await run({ endsInDays: gun });
      expect(sent, String(gun)).toEqual([]);
      expect(emailLogFindFirst).not.toHaveBeenCalled();
    }
  });

  it('sure dolmadan gitmez; son gun "yarın bitiyor" gider, ikisi ayni gun CAKISMAZ', async () => {
    expect((await run({ endsInDays: 0.25 })).sent.map((m: any) => m.template)).toEqual(['trial_expiry_d13']);
    expect((await run({ endsInDays: 2.5 })).sent.map((m: any) => m.template)).toEqual(['trial_expiry_d11']);
    expect((await run({ endsInDays: 5 })).sent).toEqual([]);
  });
});

describe('trial_expired metni — deneme BITTI, simdiki zaman', () => {
  const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
  const render = (t: EmailTemplate, d: Record<string, unknown>) => (svc as any).renderTemplate(t, d) as { subject: string; html: string };

  it('gelecek zamanli "bittiğinde" cumlesi yok; veriler duruyor', () => {
    for (const v of [true, false, undefined]) {
      const { subject, html } = render('trial_expired', { name: 'Ayşe', readOnlyAtEnd: v });
      expect(subject).toBe('Deneme süren doldu');
      expect(html, String(v)).not.toContain('bittiğinde');
      expect(html, String(v)).toContain('Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor.');
    }
  });

  it('satin alma acik: hesap SU AN salt okunur ve plan secilebilir', () => {
    const { html } = render('trial_expired', { name: 'A', readOnlyAtEnd: true });
    expect(html).toContain('Hesabın şu an salt okunur');
    expect(html).toContain('bir plan seçebilirsin');
    expect(denemeBitti(true)[1]).toContain('görmeye ve indirmeye devam edersin');
  });

  it('kartla satin alma kapali: kilit iddiasi yok; plan YINE ALINABILIR — yazarak, havale / EFT ile (sahip, 16.11.2026)', () => {
    for (const v of [false, undefined]) {
      const { html } = render('trial_expired', { name: 'A', readOnlyAtEnd: v });
      expect(html).not.toContain('salt okunur');
      expect(html).toContain('kalan deneme haklarınla devam edebilirsin');
      expect(html).toContain('bir plan seçebilirsin');
      expect(html).toContain(HAVALE_YOLU);
      // Eski cumle musteriye plan alamayacagini dusunduruyordu
      expect(html).not.toContain('satın alma açılana kadar');
      expect(html).toContain('/pricing"');
    }
  });

  it('baslikta ad CIFT kacislanmaz (kesme isaretli ad "O&#39;Neil" gorunmesin)', () => {
    const { html } = render('trial_expired', { name: "O'Neil & Koç" });
    expect(html).toContain('O&#39;Neil &amp; Koç, deneme süren doldu');
    expect(html).not.toContain('&amp;#39;');
    expect(html).not.toContain('&amp;amp;');
  });
});
