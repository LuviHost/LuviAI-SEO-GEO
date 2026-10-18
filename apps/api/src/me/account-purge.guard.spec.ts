import { describe, it, expect, vi } from 'vitest';

/**
 * Kalici silme calistirilmadan once plan denetlenir: tek bir filtresiz adim
 * bile varsa HICBIR yazim yapilmaz (transaction yok; yarida durmak, silinmis
 * satirlari geri getirmez). Plana bozuk bir adim eklenerek denenir.
 */
vi.mock('./account-purge.plan.js', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    purgeSteps: (x: any) => {
      const steps = real.purgeSteps(x);
      // Ortaya yerlestirilir: denetim olmasaydi oncesindeki adimlar silmeye baslamis olurdu
      steps.splice(10, 0, { model: 'Notification', kind: 'delete', run: (db: any) => db.notification.deleteMany({ where: {} }) });
      return steps;
    },
  };
});

const { AccountPurgeService } = await import('./account-purge.service.js');

describe('kalici silme — calistirma oncesi guvenlik denetimi', () => {
  it('filtresiz adim varsa hicbir sey yazilmaz, hata hesabin turda yeniden denenmesi icin yukari cikar', async () => {
    const writes: string[] = [];
    const db: any = new Proxy({}, {
      get(_t, model: string) {
        if (model === 'then') return undefined;
        return new Proxy({}, {
          get(_t2, method: string) {
            return async () => {
              if (!/^find|count/.test(method)) writes.push(`${model}.${method}`);
              if (model === 'user' && method === 'findUnique') {
                return { id: 'cmuserxxxxxxxxxxxxxxxxxxx', email: 'a@b.co', name: null, deletionRequestedAt: new Date('2026-01-01T00:00:00Z') };
              }
              return method === 'findMany' ? [] : method.endsWith('Many') ? { count: 0 } : null;
            };
          },
        });
      },
    });
    const email = { sendRaw: vi.fn(async () => ({ ok: true })) };
    const svc = new AccountPurgeService(db, email as any);
    await expect(svc.purgeUser('cmuserxxxxxxxxxxxxxxxxxxx', new Date('2026-11-20T03:45:00Z'))).rejects.toThrow(/güvenlik denetiminden geçmedi.*Notification/);
    expect(writes).toEqual([]);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });
});
