import { describe, it, expect, vi, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { AscService, ASC_ACCOUNT_SECRET_FIELDS } from './asc.service.js';
import { AscApiClient } from './asc-api.client.js';

/**
 * AscAccount sirlari API cevabina cikmaz. connectAccount eskiden tam satiri
 * (encryptedKey: musterinin App Store Connect .p8 anahtari) donuyordu.
 */
const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AscAccount')!.fields;

afterEach(() => { vi.restoreAllMocks(); });

describe('ASC_ACCOUNT_SECRET_FIELDS', () => {
  it('alanlar semada var ve sir gibi duran her dize alan listede', () => {
    const names = new Set(fields.map((f) => f.name));
    for (const k of Object.keys(ASC_ACCOUNT_SECRET_FIELDS)) expect(names.has(k), k).toBe(true);
    const suspects = fields
      .filter((f) => f.kind === 'scalar' && f.type === 'String' && /key|token|secret/i.test(f.name) && f.name !== 'keyId')
      .map((f) => f.name);
    for (const f of suspects) expect(Object.keys(ASC_ACCOUNT_SECRET_FIELDS), f).toContain(f);
  });
});

describe('AscService.connectAccount', () => {
  function build(existing: any) {
    const prisma: any = {
      site: { findUnique: vi.fn(async () => ({ id: 'site-a', userId: 'user-a' })) },
      ascAccount: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async ({ data }: any) => ({ id: 'acc-1', ...data })),
        create: vi.fn(async ({ data }: any) => ({ id: 'acc-new', ...data })),
      },
    };
    vi.spyOn(AscApiClient.prototype, 'listApps').mockResolvedValue({ data: [] } as any);
    return { svc: new AscService(prisma), prisma };
  }
  const args = { siteId: 'site-a', issuerId: 'i', keyId: 'k', privateKeyPem: '-----BEGIN PRIVATE KEY-----x' };
  const user = { id: 'user-a', role: 'USER' as const };

  it('yeni hesap: create omit ile', async () => {
    const { svc, prisma } = build(null);
    await svc.connectAccount(args, user);
    expect(prisma.ascAccount.create.mock.calls[0][0].omit).toEqual(ASC_ACCOUNT_SECRET_FIELDS);
  });

  it('mevcut hesap: update omit ile', async () => {
    const { svc, prisma } = build({ id: 'acc-1' });
    await svc.connectAccount(args, user);
    expect(prisma.ascAccount.update.mock.calls[0][0].omit).toEqual(ASC_ACCOUNT_SECRET_FIELDS);
  });
});
