import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

/**
 * Bildirim e-postasi — silme talebi olan hesap.
 *
 * NEDEN VAR: EmailService.sendRaw silme talebini bilerek denetlemez (silme
 * talebi/tamamlandi e-postalari da onunla gider). Bildirim e-postasi
 * userId ile sendRaw cagirdigi icin kontrol burada: 30 gunluk bekleme
 * suresinde (erisim kapali) bildirim e-postasi gitmemeli. Panel kaydi yine
 * yazilir — e-posta atlanmasi bildirimi dusurmez.
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */

function kur(user: { email: string | null; deletionRequestedAt: Date | null } | null) {
  const prisma = {
    notification: {
      create: vi.fn(async ({ data }: any) => ({ id: 'bildirim-1', ...data })),
      update: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => user) },
  };
  const email = { sendRaw: vi.fn(async () => ({ ok: true })) };
  const svc = new NotificationsService(prisma as never, email as never);
  const debug = vi.spyOn((svc as any).log, 'debug').mockImplementation(() => undefined);
  return { svc, prisma, email, debug };
}

const bildirim = { userId: 'u1', type: 'SYSTEM' as const, title: 'Bot duraklatıldı', body: 'Ayrıntı', link: '/admin', channels: ['inapp', 'email'] as ('inapp' | 'email')[] };

describe('NotificationsService — e-posta kanali', () => {
  it('silme talebi olan hesaba e-posta gitmez; panel kaydi yazilir, emailSentAt damgalanmaz', async () => {
    const t = kur({ email: 'kisi@ornek.com', deletionRequestedAt: new Date('2026-10-10T00:00:00Z') });
    const kayit = await t.svc.create(bildirim);

    expect(kayit.id).toBe('bildirim-1');
    expect(t.prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(t.email.sendRaw).not.toHaveBeenCalled();
    expect(t.prisma.notification.update).not.toHaveBeenCalled();
    expect(t.debug).toHaveBeenCalledWith(expect.stringContaining('silme talebi'));
    // Kontrol ek sorgu acmaz: adresle ayni sorguda okunur
    expect(t.prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(t.prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ email: true, deletionRequestedAt: true }),
    }));
  });

  it('normal hesap: e-posta userId ile gider ve emailSentAt damgalanir (degismedi)', async () => {
    const t = kur({ email: 'kisi@ornek.com', deletionRequestedAt: null });
    await t.svc.create(bildirim);

    expect(t.email.sendRaw).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', to: 'kisi@ornek.com', subject: 'Bot duraklatıldı' }));
    expect(t.prisma.notification.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bildirim-1' } }));
  });

  it('yalniz panel kanali: kullanici sorgulanmaz, e-posta gitmez', async () => {
    const t = kur({ email: 'kisi@ornek.com', deletionRequestedAt: null });
    await t.svc.create({ ...bildirim, channels: ['inapp'] });
    expect(t.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });

  // 15.11.2026: cagiran hazir e-posta govdesi verebilir (ucretsiz test bildirimi: raporlu e-posta)
  it('hazir e-posta govdesi verilirse e-posta onunla gider; kayda yazilmaz; verilmezse genel kalip', async () => {
    const t = kur({ email: 'kisi@ornek.com', deletionRequestedAt: null });
    const html = '<html><body>RAPORLU GOVDE</body></html>';
    await t.svc.create({ ...bildirim, emailHtml: html });
    expect((t.email.sendRaw as any).mock.calls[0][0].html).toBe(html);
    // Bildirim kaydinda govde yok (panel: baslik + metin)
    const kayit = (t.prisma.notification.create as any).mock.calls[0][0].data;
    expect(JSON.stringify(kayit)).not.toContain('RAPORLU GOVDE');
    expect(Object.keys(kayit)).not.toContain('emailHtml');

    for (const bos of [undefined, '', '   ']) {
      const g = kur({ email: 'kisi@ornek.com', deletionRequestedAt: null });
      await g.svc.create({ ...bildirim, emailHtml: bos });
      const gonderilen = (g.email.sendRaw as any).mock.calls[0][0].html as string;
      expect(gonderilen).toContain('Panelde aç');
      expect(gonderilen).toContain('<!DOCTYPE html');
    }
  });
});

describe('NotificationsService — kapsam: deneme / odeme bildirimleri yalniz panele doner', () => {
  // Mobil uygulama GET /notifications'i parametresiz cagirir ve satirlari baslik + metinle ana
  // sayfasinda basar. Deneme / odeme / abonelik bildirimleri ("planlara göz atabilirsin",
  // "Ödeme alınamadı") uygulamada gosterilmez; web paneli `?scope=panel` ile ister.
  const KULLANICI = { id: 'u1', role: 'USER' as const };

  function kurListe() {
    const findMany = vi.fn(async (_a: any) => []);
    const count = vi.fn(async (_a: any) => 0);
    const svc = new NotificationsService({ notification: { findMany, count } } as never, {} as never);
    return { svc, findMany, count };
  }

  it('parametresiz (mobil): odeme satirlari disarida; refKind BOS satirlar ICERIDE kalir', async () => {
    const t = kurListe();
    await t.svc.list(KULLANICI, { limit: 5 });
    await t.svc.unreadCount(KULLANICI);
    const beklenen = { OR: [{ refKind: null }, { refKind: { not: 'email_billing' } }] };
    expect((t.findMany.mock.calls[0] as any[])[0].where).toEqual({ userId: 'u1', ...beklenen });
    expect((t.count.mock.calls[0] as any[])[0].where).toEqual({ userId: 'u1', readAt: null, ...beklenen });
  });

  it('panel (scope=panel): hepsi doner', async () => {
    const t = kurListe();
    await t.svc.list(KULLANICI, { limit: 20, includeBilling: true });
    await t.svc.unreadCount(KULLANICI, { includeBilling: true });
    expect((t.findMany.mock.calls[0] as any[])[0].where).toEqual({ userId: 'u1' });
    expect((t.count.mock.calls[0] as any[])[0].where).toEqual({ userId: 'u1', readAt: null });
  });

  it('denetleyici kapsami yalniz "panel" degeriyle acar; web zili bu parametreyi gonderir, mobil gondermez', async () => {
    const { readFileSync } = await import('node:fs');
    const oku = (yol: string) => readFileSync(new URL(yol, import.meta.url), 'utf8');
    const denetleyici = oku('./notifications.controller.ts');
    expect(denetleyici.match(/includeBilling: scope === 'panel'/g)).toHaveLength(2);
    const web = oku('../../../web/src/lib/api.ts');
    expect(web).toContain("q.set('scope', 'panel')");
    expect(web).toContain("'/notifications/unread-count?scope=panel'");
    const mobil = oku('../../../../mobile/src/api.ts');
    expect(mobil).toContain('`/notifications?limit=${limit}`');
    expect(mobil).not.toContain('scope=panel');
  });
});
