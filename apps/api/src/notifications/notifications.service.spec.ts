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
});
