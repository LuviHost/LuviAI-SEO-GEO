import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuditService } from '../audit/audit.service.js';
import { AuditChecksService } from '../audit/audit-checks.service.js';
import { AUDIT_ADVANCES_FROM, BRAIN_ADVANCES_FROM } from './site-status.js';

/**
 * Site durumu yalniz ileri gider (site-status.ts).
 *
 * NEDEN VAR: runAudit kosulsuz AUDIT_COMPLETE, beyin uretimi kosulsuz
 * AUDIT_PENDING yaziyordu; ACTIVE secen gunluk/haftalik isler (GSC kaydi,
 * rapor e-postasi, icerik firsatlari, urun radari, haftalik plan) kurulumu
 * bitmis siteyi ilk yeniden taramada sessizce kaybediyordu.
 */

/** updateMany'nin WHERE'ini tek satirlik sahte tabloya uygulayan prisma. */
function siteTablosu(status: string) {
  const row = { id: 's1', userId: 'u1', url: 'https://site.com', status };
  const updateMany = vi.fn(async ({ where, data }: any) => {
    const inList: string[] | undefined = where?.status?.in;
    const eslesir = where.id === row.id && (!inList || inList.includes(row.status));
    if (eslesir) Object.assign(row, data);
    return { count: eslesir ? 1 : 0 };
  });
  // Kosulsuz update kalirsa test bunu yakalasin: cagrildigi an durumu yazar
  const update = vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; });
  return { row, updateMany, update };
}

function denetim(status: string) {
  const t = siteTablosu(status);
  const prisma = {
    kvStore: {
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
    site: { findUniqueOrThrow: async () => ({ ...t.row }), update: t.update, updateMany: t.updateMany },
    audit: { create: vi.fn(async ({ data }: any) => ({ id: 'a1', ...data })) },
  };
  const crawler = { crawl: vi.fn(async () => ({ baseUrl: 'https://site.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0 })) };
  const svc = new AuditService(
    prisma as never, crawler as never, new AuditChecksService(),
    { runAudit: vi.fn(async () => null) } as never,
    { runAudit: vi.fn(async () => ({ score: 50, methods: [], queries: [], details: { methodVersion: 2 } })) } as never,
    { runForSite: vi.fn(async () => []) } as never,
    null as never,
  );
  return { svc, ...t };
}

describe('runAudit — site durumunu geri dusurmez', () => {
  it.each(['ACTIVE', 'PAUSED', 'ERROR', 'AUDIT_COMPLETE'])('%s korunur', async (durum) => {
    const t = denetim(durum);
    await t.svc.runAudit('s1');
    expect(t.row.status).toBe(durum);
    expect(t.update, 'kosulsuz site.update durum yazmamali').not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: expect.anything() }) }),
    );
  });

  it.each(['ONBOARDING', 'AUDIT_PENDING'])('%s → AUDIT_COMPLETE ilerler', async (durum) => {
    const t = denetim(durum);
    await t.svc.runAudit('s1');
    expect(t.row.status).toBe('AUDIT_COMPLETE');
  });
});

describe('ilerleme listeleri', () => {
  it('tarama ve beyin ACTIVE/PAUSED/ERROR uzerine yazamaz', () => {
    for (const geri of ['ACTIVE', 'PAUSED', 'ERROR']) {
      expect(AUDIT_ADVANCES_FROM as readonly string[]).not.toContain(geri);
      expect(BRAIN_ADVANCES_FROM as readonly string[]).not.toContain(geri);
    }
    // Zincirde beyin ve tarama paralel; tarama once biterse beyin onu geri cekmesin
    expect(BRAIN_ADVANCES_FROM as readonly string[]).not.toContain('AUDIT_COMPLETE');
  });

  it('beyin uretimi durumu kosullu (updateMany + BRAIN_ADVANCES_FROM) yazar', () => {
    const src = readFileSync(new URL('./brain-generator.service.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/site\.updateMany\(\{\s*where: \{ id: siteId, status: \{ in: \[\.\.\.BRAIN_ADVANCES_FROM\]/);
    expect(src).not.toMatch(/site\.update\(\{[^}]*\}[^)]*status: 'AUDIT_PENDING'/s);
  });

  it('kurulum zinciri hala ACTIVE ile biter (worker ONBOARDING_CHAIN)', () => {
    const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
    const zincir = src.slice(src.indexOf('ONBOARDING_CHAIN: async'), src.indexOf('PROCESS_SCHEDULED: async'));
    expect(zincir).toMatch(/data: \{ status: 'ACTIVE' \}/);
  });
});
