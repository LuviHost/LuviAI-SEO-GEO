import { describe, it, expect, vi } from 'vitest';
import { AsaService, ASA_ACCOUNT_PUBLIC_SELECT } from './asa/asa.service.js';
import { AscService, ASC_ACCOUNT_PUBLIC_SELECT } from './asc/asc.service.js';

/**
 * ASA setAutoPilot ve ASC connectAccount cevaplari tam hesap satirini
 * donuyordu: encryptedKey (.p8 ozel anahtarin sifreli hali) ve
 * tokenCacheValue dahil. Cevap artik alan listesiyle (select) sinirli.
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

function expectSafeSelect(select: Record<string, unknown> | undefined) {
  expect(select, 'select verilmeli').toBeDefined();
  for (const k of SECRETS) expect(select![k], k).toBeUndefined();
}

describe('ASA/ASC hesap cevaplarinda sir yok', () => {
  it('alan listeleri sir kolonu icermez', () => {
    expectSafeSelect(ASA_ACCOUNT_PUBLIC_SELECT);
    expectSafeSelect(ASC_ACCOUNT_PUBLIC_SELECT);
  });

  it('ASA setAutoPilot: cevap alan listesiyle; panelin okudugu alanlar yerinde', async () => {
    const update = vi.fn(async (args: any) => ({ id: 'acc1', __args: args }));
    const prisma = {
      ...site,
      asaAccount: {
        findUnique: vi.fn(async () => ({ id: 'acc1', siteId: 's1', autoPilotBudgetCap: null, encryptedKey: 'x', tokenCacheValue: 'jwt' })),
        update,
      },
    };
    await new AsaService(prisma as any).setAutoPilot('acc1', { enabled: true, budgetCapUsd: 50 }, user);
    const args = update.mock.calls[0][0];
    expectSafeSelect(args.select);
    for (const k of ['id', 'autoPilotEnabled', 'autoPilotBudgetCap']) expect(args.select[k], k).toBe(true);
  });

  it('ASC connectAccount: guncelleme ve ilk kayit cevaplari alan listesiyle', async () => {
    const update = vi.fn(async (args: any) => ({ id: 'acc-var', __args: args }));
    const create = vi.fn(async (args: any) => ({ id: 'acc-yeni', __args: args }));
    const findFirst = vi.fn().mockResolvedValueOnce({ id: 'acc-var' }).mockResolvedValueOnce(null);
    const prisma = { ...site, ascAccount: { findFirst, update, create } };
    const svc = new AscService(prisma as any);
    const body = { siteId: 's1', issuerId: 'iss', keyId: 'KEY1', privateKeyPem: PEM };

    await svc.connectAccount(body, user);
    expectSafeSelect(update.mock.calls[0][0].select);
    // anahtar DB'ye yine sifreli yazilir — yalniz cevaptan cikarildi
    expect(typeof update.mock.calls[0][0].data.encryptedKey).toBe('string');

    await svc.connectAccount(body, user);
    expectSafeSelect(create.mock.calls[0][0].select);
  });
});
