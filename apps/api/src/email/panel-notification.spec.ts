import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Olay e-postalari panel ziline de duser (sahip, 16.11.2026: "burdaki bildirimleri kullanalım").
 *
 * NEDEN VAR: zil ve bildirim tablosu vardi ama musteriye makale, rapor, deneme ve odeme olaylari
 * YALNIZ e-postayla gidiyordu. Bu spec uc seyi sabitler:
 *  1. Hangi sablon zile duser, hangisi dusmez (karsilama dizisi ve kendi bildirimini yazan
 *     haftalik plan dusmez).
 *  2. Bildirimin basligi / metni e-postanin konusu / onizlemesidir; baglanti PANEL ICIDIR.
 *  3. Bildirim yazilamazsa e-posta yine gider; silme talebi olan hesaba ikisi de gitmez.
 */

const resendSend = vi.fn<(...a: any[]) => Promise<any>>(async () => ({ data: { id: 're_1' }, error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));

const { EmailService } = await import('./email.service.js');
const { PANEL_BILLING_REF_KIND, PANEL_DEDUPE_WINDOW_MS, PANEL_REF_KIND, mirrorsToPanel, panelNotificationFor, panelPath } = await import('./panel-notification.js');
type EmailTemplate = import('./email.service.js').EmailTemplate;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://ranksup.ai';

/** Tip birlesimindeki TUM sablonlar — kaynaktan okunur */
function tumSablonlar(): EmailTemplate[] {
  const src = readFileSync(path.join(HERE, 'email.service.ts'), 'utf8');
  const bas = src.indexOf('export type EmailTemplate');
  return [...src.slice(bas, src.indexOf(';', bas)).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as EmailTemplate);
}

function makePrisma(over: Partial<{ deletion: Date | null; notificationFails: boolean }> = {}) {
  /** Yazilan bildirimler — tekrar kontrolu (findFirst) bunlara bakar, gercek sorgu gibi */
  const satirlar: any[] = [];
  return {
    satirlar,
    user: { findUnique: vi.fn(async () => ({ deletionRequestedAt: over.deletion ?? null })) },
    emailLog: { create: vi.fn(async (_a: any) => ({})) },
    notification: {
      findFirst: vi.fn(async ({ where }: any) =>
        satirlar.find((s) => s.userId === where.userId && s.refKind === where.refKind && s.refId === where.refId && s.link === where.link && s.title === where.title) ?? null),
      create: vi.fn(async ({ data }: any) => { if (over.notificationFails) throw new Error('veritabani'); satirlar.push(data); return { id: `n${satirlar.length}` }; }),
    },
  };
}

describe('hangi sablon zile duser', () => {
  it('karsilama dizisi ve haftalik plan dusmez; digerleri duser', () => {
    const dusmeyen = tumSablonlar().filter((t) => !mirrorsToPanel(t));
    expect(dusmeyen.sort()).toEqual(['weekly_plan', 'welcome_day0', 'welcome_day1', 'welcome_day3', 'welcome_day7']);
    for (const t of ['trial_expiry_d11', 'trial_expired', 'article_ready', 'first_article_published', 'weekly_report', 'monthly_report', 'payment_failed', 'plan_upgraded', 'subscription_expired'] as const) {
      expect(mirrorsToPanel(t), t).toBe(true);
    }
  });

  it('haftalik planin kendi bildirimi var (cift bildirim olmasin diye buradan dusmuyor)', () => {
    const cron = readFileSync(path.join(HERE, '../chat/weekly-plan.cron.ts'), 'utf8');
    expect(cron).toMatch(/this\.notifications\.create\(\{[\s\S]{0,200}Bu haftanın planı hazır/);
  });
});

describe('panelPath — zil disariya baglanti vermez', () => {
  it('kendi sitemizin adresi yola cevrilir; panel yolu aynen kalir', () => {
    expect(panelPath('https://ranksup.ai/sites/s1/articles/a1', BASE)).toBe('/sites/s1/articles/a1');
    expect(panelPath('https://ranksup.ai/sites/s1/articles/a1', 'https://ranksup.ai/')).toBe('/sites/s1/articles/a1');
    expect(panelPath('/billing', BASE)).toBe('/billing');
  });

  it('baska site, protokole goreli adres ve bozuk deger null', () => {
    expect(panelPath('https://kotu.example/sites/s1', BASE)).toBeNull();
    expect(panelPath('https://ranksup.ai.kotu.example/x', BASE)).toBeNull();
    expect(panelPath('//kotu.example/x', BASE)).toBeNull();
    expect(panelPath('javascript:alert(1)', BASE)).toBeNull();
    expect(panelPath(undefined, BASE)).toBeNull();
    expect(panelPath('', BASE)).toBeNull();
    // Ters egik cizgi tarayicida "/" sayilir
    expect(panelPath('/\\kotu.example/x', BASE)).toBeNull();
    expect(panelPath('https://ranksup.ai/\\kotu.example', BASE)).toBeNull();
  });

  it('site adresi "/" ile bitiyorsa olusan cift egik cizgi protokole goreli adrese DONMEZ (inceleme bulgusu)', () => {
    // pipeline `${WEB_BASE_URL}/sites/…` kurar; WEB_BASE_URL "https://ranksup.ai/" ise adres "…ai//sites/…" olur
    expect(panelPath('https://ranksup.ai//sites/s1/articles/a1', 'https://ranksup.ai/')).toBe('/sites/s1/articles/a1');
    expect(panelPath('https://ranksup.ai//sites/s1/articles/a1', BASE)).toBe('/sites/s1/articles/a1');
    expect(panelPath('https://ranksup.ai///x', BASE)).toBe('/x');
  });
});

describe('panelNotificationFor', () => {
  const r = { subject: 'Konu', onizleme: 'Onizleme cumlesi.' };

  it('baslik = konu, metin = onizleme; zile dusmeyen sablonda null', () => {
    expect(panelNotificationFor('payment_failed', {}, r, BASE)).toEqual({ title: 'Konu', body: 'Onizleme cumlesi.', link: '/billing', refKind: PANEL_BILLING_REF_KIND });
    expect(panelNotificationFor('welcome_day0', {}, r, BASE)).toBeNull();
    expect(panelNotificationFor('weekly_plan', {}, r, BASE)).toBeNull();
  });

  it('baglantilar panel ici: deneme ve odeme → abonelik; makale → yazinin kendisi; rapor → saklanan rapor', () => {
    for (const t of ['trial_expiry_d11', 'trial_expiry_d13', 'trial_expired', 'plan_upgraded', 'plan_canceled', 'payment_failed', 'renewal_failed', 'renewal_required', 'subscription_expired', 'grandfathering_expiring', 'grandfathering_expired'] as const) {
      expect(panelNotificationFor(t, {}, r, BASE)?.link, t).toBe('/billing');
    }
    const makale = { publicUrl: 'https://ranksup.ai/sites/s1/articles/a1' };
    expect(panelNotificationFor('article_ready', makale, r, BASE)?.link).toBe('/sites/s1/articles/a1');
    expect(panelNotificationFor('first_article_published', makale, r, BASE)?.link).toBe('/sites/s1/articles/a1');
    // Adres yoksa ya da disariyi gosteriyorsa panel ana sayfasi
    expect(panelNotificationFor('article_ready', { publicUrl: 'https://kotu.example/x' }, r, BASE)?.link).toBe('/dashboard');
    expect(panelNotificationFor('article_ready', {}, r, BASE)?.link).toBe('/dashboard');

    expect(panelNotificationFor('monthly_report', { siteId: 's1', reportId: 'cmrapor1' }, r, BASE)?.link).toBe('/sites/s1/report?rapor=cmrapor1');
    expect(panelNotificationFor('monthly_report', { siteId: 's1' }, r, BASE)?.link).toBe('/sites/s1/report');
    expect(panelNotificationFor('monthly_report', { siteId: '../x', reportId: 'r' }, r, BASE)?.link).toBe('/dashboard');
    expect(panelNotificationFor('weekly_report', {}, r, BASE)?.link).toBe('/dashboard');
  });

  it('deneme / odeme / abonelik olaylari AYRI isaretlenir (mobil uygulamada gosterilmez); makale ve rapor genel', () => {
    for (const t of tumSablonlar().filter(mirrorsToPanel)) {
      const b = panelNotificationFor(t, { siteId: 's1', publicUrl: 'https://ranksup.ai/sites/s1/articles/a1' }, r, BASE)!;
      const odeme = /^(trial_|plan_|payment_|renewal_|subscription_|grandfathering_)/.test(t);
      expect(b.refKind, t).toBe(odeme ? PANEL_BILLING_REF_KIND : PANEL_REF_KIND);
    }
    expect([PANEL_REF_KIND, PANEL_BILLING_REF_KIND]).toEqual(['email', 'email_billing']);
  });

  it('uzun baslik ve baglanti sutuna sigacak kadar kesilir; bos onizleme null', () => {
    const b = panelNotificationFor('payment_failed', {}, { subject: 'Ç'.repeat(400), onizleme: '   ' }, BASE)!;
    expect(b.title).toHaveLength(191);
    expect(b.body).toBeNull();
    expect(panelNotificationFor('payment_failed', {}, { subject: '  ', onizleme: 'x' }, BASE)).toBeNull();
  });

  it('her zile dusen sablonun baglantisi "/" ile baslar (hicbiri disariya gitmez)', () => {
    for (const t of tumSablonlar().filter(mirrorsToPanel)) {
      const b = panelNotificationFor(t, { siteId: 's1', reportId: 'r1', publicUrl: 'https://ranksup.ai/sites/s1/articles/a1' }, r, BASE)!;
      expect(b.link, t).toMatch(/^\/(?!\/)/);
    }
  });
});

describe('EmailService.send — e-postayla birlikte panel bildirimi', () => {
  let oncekiAnahtar: string | undefined;
  beforeEach(() => { oncekiAnahtar = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 're_test'; resendSend.mockClear(); });
  afterEach(() => { if (oncekiAnahtar === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oncekiAnahtar; });

  it('makale hazir: konu ve onizleme zile duser, baglanti yazinin panel sayfasi', async () => {
    const prisma = makePrisma();
    const sonuc = await new EmailService(prisma as never).send({
      userId: 'u1', to: 'a@b.co', template: 'article_ready',
      data: { name: 'Ayşe', title: "SEO'da 5 Hata", publicUrl: 'https://ranksup.ai/sites/s1/articles/a1', wordCount: 1200 },
    });
    expect(sonuc.ok).toBe(true);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0][0].data).toEqual({
      userId: 'u1', type: 'SYSTEM',
      title: "Makalen hazır: SEO'da 5 Hata",
      body: 'Editörden geçti, onayını bekliyor.',
      link: '/sites/s1/articles/a1',
      refKind: 'email', refId: 'article_ready', channels: ['inapp'],
    });
    // Baslik, e-postanin konusuyla AYNI
    expect((resendSend.mock.calls[0] as any[])[0].subject).toBe("Makalen hazır: SEO'da 5 Hata");
  });

  it('aylik rapor: baglanti saklanan raporu acar', async () => {
    const prisma = makePrisma();
    await new EmailService(prisma as never).send({
      userId: 'u1', to: 'a@b.co', template: 'monthly_report',
      data: { siteName: 'Örnek Klinik', siteId: 's1', reportId: 'cmrapor1', periodLabel: 'Ekim 2026', periodDays: 31, totalClicks: 5120, prevClicks: 4380, articlesPublished: 9, auditCount: 4 },
    });
    expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
      title: 'Örnek Klinik — aylık rapor hazır',
      body: '5.120 tıklama, 9 makale. Dönem raporu panelde.',
      link: '/sites/s1/report?rapor=cmrapor1',
      refId: 'monthly_report',
    });
  });

  it('AYNI olay bir kez: e-posta gidemeyip ertesi gun yeniden denenince ikinci satir yazilmaz (inceleme bulgusu)', async () => {
    // Aylik rapor 4–7'sinde, "deneme süren doldu" uc gun yeniden denenir
    const prisma = makePrisma();
    const svc = new EmailService(prisma as never);
    const aylik = { userId: 'u1', to: 'a@b.co', template: 'monthly_report' as const, data: { siteName: 'Örnek Klinik', siteId: 's1', reportId: 'cmrapor1', periodLabel: 'Ekim 2026', articlesPublished: 9, auditCount: 4 } };
    resendSend.mockResolvedValueOnce({ data: null, error: { message: 'gecici' } });
    expect((await svc.send(aylik)).ok).toBe(false);
    expect((await svc.send(aylik)).ok).toBe(true);
    await svc.send({ userId: 'u1', to: 'a@b.co', template: 'trial_expired', data: { name: 'A' } });
    await svc.send({ userId: 'u1', to: 'a@b.co', template: 'trial_expired', data: { name: 'A' } });
    expect(prisma.satirlar.map((s) => s.refId)).toEqual(['monthly_report', 'trial_expired']);
    // Kontrol yalniz son pencereye bakar: haftalik olaylar (7 gun arayla) birbirini engellemez
    const where = (prisma.notification.findFirst.mock.calls[0] as any[])[0].where;
    expect(PANEL_DEDUPE_WINDOW_MS).toBeLessThan(7 * 86_400_000);
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(PANEL_DEDUPE_WINDOW_MS - 5_000);
  });

  it('farkli olaylar ayri satir: baska makale, baska ayin raporu', async () => {
    const prisma = makePrisma();
    const svc = new EmailService(prisma as never);
    const makale = (id: string, title: string) => ({ userId: 'u1', to: 'a@b.co', template: 'article_ready' as const, data: { title, publicUrl: `https://ranksup.ai/sites/s1/articles/${id}` } });
    await svc.send(makale('a1', 'Birinci'));
    await svc.send(makale('a2', 'İkinci'));
    expect(prisma.satirlar.map((s) => s.link)).toEqual(['/sites/s1/articles/a1', '/sites/s1/articles/a2']);
  });

  it('karsilama e-postasi zile dusmez; alicisi hesap olmayan gonderim (yonetici testi) de dusmez', async () => {
    const prisma = makePrisma();
    const svc = new EmailService(prisma as never);
    await svc.send({ userId: 'u1', to: 'a@b.co', template: 'welcome_day1', data: { name: 'A' } });
    await svc.send({ to: 'a@b.co', template: 'payment_failed', data: { name: 'A' } });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(resendSend).toHaveBeenCalledTimes(2);
  });

  it('bildirim yazilamazsa e-posta YINE gider', async () => {
    const prisma = makePrisma({ notificationFails: true });
    const sonuc = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'payment_failed', data: { name: 'A' } });
    expect(sonuc.ok).toBe(true);
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  it('silme talebi olan hesaba ne e-posta ne bildirim gider', async () => {
    const prisma = makePrisma({ deletion: new Date('2026-11-01T00:00:00Z') });
    const sonuc = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'payment_failed', data: { name: 'A' } });
    expect(sonuc).toEqual({ ok: false, skipped: 'account_deletion' });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('gonderim saglayicisi yokken de olay zile duser (e-posta gidemedi ama olay oldu)', async () => {
    delete process.env.RESEND_API_KEY;
    const prisma = makePrisma();
    const sonuc = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'trial_expired', data: { name: 'A', readOnlyAtEnd: false } });
    expect(sonuc).toEqual({ ok: false, skipped: 'no_provider' });
    expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({ title: 'Deneme süren doldu', link: '/billing' });
  });
});

describe('AI gorunurluk alarmi da zile duser (davranis testi: audit/ai-mention-alarm.spec.ts)', () => {
  it('baglanti var olan bir panel sayfasi', () => {
    const sayfa = path.join(HERE, '../../../web/src/app/(dashboard)/sites/[id]/visibility/page.tsx');
    expect(readFileSync(sayfa, 'utf8').length).toBeGreaterThan(0);
  });
});
