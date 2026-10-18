import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_PURGE_AFTER_DAYS,
  deletedAccountMessage,
  deletionBlockers,
  deletionSummary,
  formatTrDate,
  isPurgeDue,
  purgeAfter,
  purgeCutoff,
  shouldCancelSubscription,
} from './account-deletion.policy.js';

const DAY = 86_400_000;

describe('hesap silme politikasi', () => {
  it('kalici silme talepten tam 30 gun sonra', () => {
    expect(ACCOUNT_PURGE_AFTER_DAYS).toBe(30);
    const t = new Date('2026-10-18T10:00:00Z');
    expect(purgeAfter(t).getTime() - t.getTime()).toBe(30 * DAY);
    expect(purgeCutoff(new Date('2026-11-17T10:00:00Z')).toISOString()).toBe(t.toISOString());
  });

  it('30 gun dolmadan silme zamani gelmez; talep yoksa hic gelmez', () => {
    const req = new Date('2026-10-18T10:00:00Z');
    expect(isPurgeDue(req, new Date(req.getTime() + 30 * DAY - 1000))).toBe(false);
    expect(isPurgeDue(req, new Date(req.getTime() + 30 * DAY))).toBe(true);
    expect(isPurgeDue(null, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('yalniz aktif / odemesi geciken abonelik iptal edilir', () => {
    expect(shouldCancelSubscription('ACTIVE')).toBe(true);
    expect(shouldCancelSubscription('PAST_DUE')).toBe(true);
    for (const s of ['TRIAL', 'CANCELED', 'EXPIRED', null]) expect(shouldCancelSubscription(s)).toBe(false);
  });

  it('ajans musterisi varken silme engellenir; mesaj sayiyi ve musteri verisinin silinmeyecegini soyler', () => {
    const b = deletionBlockers({ role: 'AGENCY_OWNER', clientCount: 3 });
    expect(b).toHaveLength(1);
    expect(b[0].code).toBe('agency_has_clients');
    expect(b[0].message).toContain('3 müşteri hesabı');
    expect(b[0].message).toContain('silinmez');
    expect(deletionBlockers({ role: 'AGENCY_OWNER', clientCount: 0 })).toEqual([]);
    expect(deletionBlockers({ role: 'USER', clientCount: 0 })).toEqual([]);
  });

  it('yonetici hesabi uygulamadan silinemez', () => {
    expect(deletionBlockers({ role: 'ADMIN', clientCount: 0 }).map((x) => x.code)).toEqual(['admin_account']);
  });

  it('giris engeli mesaji kalici silme tarihini (Istanbul) soyler', () => {
    const req = new Date('2026-10-18T22:30:00Z'); // Istanbul'da 19 Ekim 01:30
    const msg = deletedAccountMessage(req);
    expect(msg).toContain(formatTrDate(purgeAfter(req)));
    expect(formatTrDate(purgeAfter(req))).toBe('18 Kasım 2026');
    expect(msg).toContain('erişim kapatıldı');
  });

  it('ozet ISO tarihleri ve gun sayisini tasir', () => {
    const req = new Date('2026-10-18T10:00:00.000Z');
    expect(deletionSummary(req)).toEqual({
      deletionRequestedAt: '2026-10-18T10:00:00.000Z',
      purgeAfter: '2026-11-17T10:00:00.000Z',
      purgeAfterDays: 30,
    });
  });
});

/**
 * Politikayi sabit gun sayisiyla soyleyen metinler (account-deletion.policy.ts
 * basligindaki liste). Gun sayisi degisirse bu test kirilir; metinler ayni
 * committe guncellenir. E-postalar tarihi purgeAfter ile hesapladigi icin
 * listede yok.
 */
describe('30 gun politikasini soyleyen sabit metinler', () => {
  const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  /** [depo kokune gore dosya, politika basliginda gecen yol parcasi] */
  const METINLER: Array<[string, string]> = [
    ['apps/web/src/app/(auth)/signin/page.tsx', 'signin/page.tsx'],
    ['apps/web/src/app/(dashboard)/billing/delete-account-section.tsx', 'billing/delete-account-section.tsx'],
    ['apps/web/src/app/(marketing)/privacy/page.tsx', 'privacy/page.tsx'],
    ['mobile/app/delete-account.tsx', 'mobile/app/delete-account.tsx'],
    ['mobile/app/connect.tsx', 'mobile/app/connect.tsx'],
  ];

  it.each(METINLER)('%s politikadaki gun sayisini soyler', (dosya) => {
    expect(fs.readFileSync(path.join(KOK, dosya), 'utf8')).toContain(`${ACCOUNT_PURGE_AFTER_DAYS} gün`);
  });

  it('politika basligi her metni listeliyor', () => {
    const baslik = fs.readFileSync(path.join(KOK, 'apps/api/src/me/account-deletion.policy.ts'), 'utf8');
    for (const [, parca] of METINLER) expect(baslik, parca).toContain(parca);
  });
});
