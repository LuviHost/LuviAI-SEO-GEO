import { describe, it, expect, vi } from 'vitest';
import { IntelActionService } from './intel-action.service.js';

/**
 * Istihbarat → Aksiyon Plani koprusu: admin onayli, iki-kaynak kurali
 * sunucuda zorlanir. Prisma/ActionPlans/Ledger sahte nesnelerle.
 */
const ev = (sourceKey: string) => ({ item: { source: { key: sourceKey } } });

function build(claim: any, sites: Array<{ id: string; name: string }>) {
  const prisma = {
    intelClaim: { findUnique: vi.fn(async () => claim) },
    site: { findMany: vi.fn(async ({ where }: any) => sites.filter((s) => where.id.in.includes(s.id))) },
  };
  const actionPlans = { create: vi.fn(async (siteId: string, input: any) => ({ id: `item-${siteId}`, siteId, ...input })) };
  const ledger = { setAction: vi.fn(async () => ({})) };
  const svc = new IntelActionService(prisma as any, actionPlans as any, ledger as any);
  return { svc, prisma, actionPlans, ledger };
}

const BASE = { id: 'c1', slug: 'preferred-sources-button', statement: 'Preferred Sources butonu okuyucuyu geri getiriyor', guidance: 'Butonu site chrome\'una koy', status: 'CONFIRMED' };

describe('IntelActionService.toActionPlan', () => {
  it('TEK kaynakli iddiadan aksiyon acilmaz (ayni yayincinin iki yazisi tek kaynaktir)', async () => {
    const { svc, actionPlans } = build({ ...BASE, evidences: [ev('sej'), ev('sej')] }, [{ id: 's1', name: 'A' }]);
    await expect(svc.toActionPlan('c1', { siteIds: ['s1'] })).rejects.toThrow(/Tek kaynakli/);
    expect(actionPlans.create).not.toHaveBeenCalled();
  });

  it('kesin hukmu olmayan (EMERGING) iddiadan acilmaz', async () => {
    const { svc } = build({ ...BASE, status: 'EMERGING', evidences: [ev('a'), ev('b')] }, [{ id: 's1', name: 'A' }]);
    await expect(svc.toActionPlan('c1', { siteIds: ['s1'] })).rejects.toThrow(/kesin hukumlu/);
  });

  it('site secilmeden acilmaz; bilinmeyen site id reddedilir', async () => {
    const { svc } = build({ ...BASE, evidences: [ev('a'), ev('b')] }, [{ id: 's1', name: 'A' }]);
    await expect(svc.toActionPlan('c1', { siteIds: [] })).rejects.toThrow(/En az bir/);
    await expect(svc.toActionPlan('c1', { siteIds: ['s1', 'yok'] })).rejects.toThrow(/bulunamadi/);
  });

  it('2 bagimsiz kaynak + 2 site → 2 madde, source intel, sourceRef claim:slug, iddia PLANNED', async () => {
    const { svc, actionPlans, ledger } = build(
      { ...BASE, evidences: [ev('google-search-central'), ev('sej'), ev('sej')] },
      [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
    );
    const r = await svc.toActionPlan('c1', { siteIds: ['s1', 's2', 's1'], impact: 'high' });
    expect(r.created.map((c) => c.siteId)).toEqual(['s1', 's2']);
    expect(r.claim.distinctSources).toBe(2);
    expect(actionPlans.create).toHaveBeenCalledTimes(2);
    const [, input] = actionPlans.create.mock.calls[0];
    expect(input.source).toBe('intel');
    expect(input.sourceRef).toBe('claim:preferred-sources-button');
    expect(input.impact).toBe('high');
    expect(input.title).toBe(BASE.statement);
    expect(input.description).toContain('2 bagimsiz kaynak');
    expect(ledger.setAction).toHaveBeenCalledWith('c1', 'PLANNED', expect.stringContaining('A, B'));
  });
});
