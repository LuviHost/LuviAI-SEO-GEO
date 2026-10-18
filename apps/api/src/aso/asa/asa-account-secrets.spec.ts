import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AsaService, ASA_ACCOUNT_SECRET_FIELDS } from './asa.service.js';

/**
 * AsaAccount sirlari API cevabina cikmaz. setAutoPilot eskiden tam satiri
 * donuyordu: encryptedKey (musterinin .p8 anahtari) ve tokenCacheValue
 * (Apple'a karsi imzali, gecerli client-secret JWT'si). Prisma `omit` sorgu
 * duzeyinde uygulanir; sahte Prisma omit'i taklit eder, ayrica omit
 * tablosunun semadaki her sir alanini kapsadigi sinanir.
 */
const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AsaAccount')!.fields;

describe('ASA_ACCOUNT_SECRET_FIELDS', () => {
  it('alanlar semada var ve sir gibi duran her dize alan listede', () => {
    const names = new Set(fields.map((f) => f.name));
    for (const k of Object.keys(ASA_ACCOUNT_SECRET_FIELDS)) expect(names.has(k), k).toBe(true);
    const suspects = fields
      .filter((f) => f.kind === 'scalar' && f.type === 'String' && /key|token|secret/i.test(f.name) && f.name !== 'keyId')
      .map((f) => f.name);
    for (const f of suspects) expect(Object.keys(ASA_ACCOUNT_SECRET_FIELDS), f).toContain(f);
  });
});

describe('AsaService.setAutoPilot', () => {
  it('guncelleme omit ile yapilir; cevapta sir yok', async () => {
    const row = { id: 'acc-1', siteId: 'site-a', orgId: 'o', keyId: 'k', encryptedKey: 'ENC', tokenCacheValue: 'JWT', autoPilotBudgetCap: null };
    const prisma: any = {
      site: { findUnique: vi.fn(async () => ({ id: 'site-a', userId: 'user-a' })) },
      asaAccount: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async ({ data, omit }: any) => {
          const out: any = { ...row, ...data };
          for (const k of Object.keys(omit ?? {})) if (omit[k]) delete out[k];
          return out;
        }),
      },
    };
    const svc = new AsaService(prisma);
    const r: any = await svc.setAutoPilot('acc-1', { enabled: true, budgetCapUsd: 50 }, { id: 'user-a', role: 'USER' });
    expect(prisma.asaAccount.update.mock.calls[0][0].omit).toEqual(ASA_ACCOUNT_SECRET_FIELDS);
    expect(r).toMatchObject({ id: 'acc-1', autoPilotEnabled: true, autoPilotBudgetCap: 50 });
    expect(r.encryptedKey).toBeUndefined();
    expect(r.tokenCacheValue).toBeUndefined();
  });
});
