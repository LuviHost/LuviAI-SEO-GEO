import { describe, it, expect, vi } from 'vitest';
import { AsaService, ASA_ACCOUNT_SECRET_FIELDS } from './asa/asa.service.js';
import { AscService, ASC_ACCOUNT_SECRET_FIELDS } from './asc/asc.service.js';

/**
 * ASA setAutoPilot ve ASC connectAccount cevaplari tam hesap satirini
 * donuyordu: encryptedKey (.p8 ozel anahtarin sifreli hali) ve
 * tokenCacheValue dahil. Cevap artik sir kolonlari disarida birakilarak
 * donuyor: Prisma `omit` (ya da sir icermeyen bir `select`).
 */

// Apple'a gercek istek atilmasin: baglanti dogrulamasi sahte istemciyle gecer
vi.mock('./asc/asc-api.client.js', () => ({
  AscApiClient: class {
    listApps = vi.fn(async () => ({ data: [] }));
  },
}));

const SECRETS = ['encryptedKey', 'tokenCacheValue'];
const user = { id: 'u1', role: 'USER' as const };
const site = { site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1' })) } };
const PEM = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

/** Sorgu argumani sirlari cevaptan cikariyor mu: omit ikisini de kapsar ya da select onlari secmez */
function expectSecretsExcluded(args: { select?: Record<string, unknown>; omit?: Record<string, unknown> } | undefined) {
  expect(args, 'sorgu argumani').toBeDefined();
  if (args!.select) {
    for (const k of SECRETS) expect(args!.select[k], k).toBeUndefined();
    return;
  }
  expect(args!.omit, 'omit ya da select verilmeli').toBeDefined();
  for (const k of SECRETS) expect(args!.omit![k], k).toBe(true);
}

describe('ASA/ASC hesap cevaplarinda sir yok', () => {
  it('omit tablolari iki sir kolonunu da kapsar', () => {
    expectSecretsExcluded({ omit: ASA_ACCOUNT_SECRET_FIELDS as Record<string, unknown> });
    expectSecretsExcluded({ omit: ASC_ACCOUNT_SECRET_FIELDS as Record<string, unknown> });
  });

  it('ASA setAutoPilot: cevapta sir yok', async () => {
    const update = vi.fn(async (args: any) => ({ id: 'acc1', __args: args }));
    const prisma = {
      ...site,
      asaAccount: {
        findUnique: vi.fn(async () => ({ id: 'acc1', siteId: 's1', autoPilotBudgetCap: null, encryptedKey: 'x', tokenCacheValue: 'jwt' })),
        update,
      },
    };
    await new AsaService(prisma as any).setAutoPilot('acc1', { enabled: true, budgetCapUsd: 50 }, user);
    expectSecretsExcluded(update.mock.calls[0][0]);
  });

  it('ASC connectAccount: guncelleme ve ilk kayit cevaplarinda sir yok', async () => {
    const update = vi.fn(async (args: any) => ({ id: 'acc-var', __args: args }));
    const create = vi.fn(async (args: any) => ({ id: 'acc-yeni', __args: args }));
    const findFirst = vi.fn().mockResolvedValueOnce({ id: 'acc-var' }).mockResolvedValueOnce(null);
    const prisma = { ...site, ascAccount: { findFirst, update, create } };
    const svc = new AscService(prisma as any);
    const body = { siteId: 's1', issuerId: 'iss', keyId: 'KEY1', privateKeyPem: PEM };

    await svc.connectAccount(body, user);
    expectSecretsExcluded(update.mock.calls[0][0]);
    // anahtar DB'ye yine sifreli yazilir — yalniz cevaptan cikarildi
    expect(typeof update.mock.calls[0][0].data.encryptedKey).toBe('string');

    await svc.connectAccount(body, user);
    expectSecretsExcluded(create.mock.calls[0][0]);
  });
});
