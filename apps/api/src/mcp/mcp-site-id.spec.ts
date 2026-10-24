import { describe, it, expect, vi } from 'vitest';
import { McpToolsService, type ToolUser } from './mcp-tools.service.js';
import { SITE_NOT_FOUND_MESSAGE } from '../auth/site-access.guard.js';

/**
 * MCP / sohbet araclari — site_id KANONIK olmali (common/site-id.ts).
 *
 * NEDEN VAR: resolveSite findUnique ile bakiyordu; utf8mb4_unicode_ci
 * harmanlamasi 'S1', 's1 ' ya da 'CMSQ..' yazimini ayni satira esler. Ajanin
 * farkli yazimla gonderdigi kimlik kabul ediliyordu. Artik SiteAccessGuard ile
 * ayni kural ve ayni metin (SITE_NOT_FOUND_MESSAGE): kurala uymayan kimlik
 * DB'ye gitmeden, bulunan satir birebir ayni kimlikte degilse de ayni hata.
 * Sahte DB harmanlamayi taklit eder (duzeltme olmadan varyant gercekten gecer).
 */

const collate = (s: string) => s.replace(/ +$/, '').toLowerCase();
const user: ToolUser = { id: 'u1', role: 'USER', plan: 'AGENCY' };
const admin: ToolUser = { id: 'a1', role: 'ADMIN' };

function build(sites: Array<{ id: string; userId: string }>) {
  const prisma = {
    site: {
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sites.find((x) => collate(x.id) === collate(String(where.id)));
        return s ? { ...s, name: 'Site', url: 'https://site.com', niche: null, status: 'ACTIVE' } : null;
      }),
    },
    audit: { findFirst: vi.fn(async () => null) },
    kvStore: { findUnique: vi.fn(async () => null), upsert: vi.fn(), deleteMany: vi.fn() },
  };
  const n = null as never;
  const svc = new McpToolsService(prisma as never, n, n, n, n, n, n, n, n, n, n, n, n);
  const getAudit = svc.list().find((t) => t.name === 'get_audit')!;
  return { prisma, getAudit };
}

describe('resolveSite — varyant site_id', () => {
  it('buyuk harf / sonu bosluk / karisik yazim: "Site bulunamadı", DB sorgusu yok (ADMIN dahil)', async () => {
    for (const v of ['S1', 's1 ', 'CMSQ25BKO005FARSWO54HF856', 'Cmsq25bko005farswo54hf856']) {
      const { prisma, getAudit } = build([{ id: 's1', userId: 'u1' }, { id: 'cmsq25bko005farswo54hf856', userId: 'u1' }]);
      await expect(getAudit.handler(user, { site_id: v }), v).rejects.toThrow(SITE_NOT_FOUND_MESSAGE);
      await expect(getAudit.handler(admin, { site_id: v }), v).rejects.toThrow(SITE_NOT_FOUND_MESSAGE);
      expect(prisma.site.findUnique, v).not.toHaveBeenCalled();
      expect(prisma.audit.findFirst, v).not.toHaveBeenCalled();
    }
  });

  it('kanonik kimlik calisir; sahiplik kurali aynen (Turkce metin)', async () => {
    const { getAudit } = build([{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }]);
    await expect(getAudit.handler(user, { site_id: 's1' })).resolves.toMatchObject({ message: expect.stringContaining('audit') });
    await expect(getAudit.handler(user, { site_id: 's2' })).rejects.toThrow('Bu site sana ait değil');
    await expect(getAudit.handler(user, { site_id: 'yok' })).rejects.toThrow(SITE_NOT_FOUND_MESSAGE);
    await expect(getAudit.handler(user, {})).rejects.toThrow('site_id zorunlu');
  });

  it('ikinci kapi: elle yazilmis kanonik olmayan satiri kanonik girdi bulsa da reddedilir', async () => {
    const { prisma, getAudit } = build([{ id: 'S3', userId: 'u1' }]);
    await expect(getAudit.handler(user, { site_id: 's3' })).rejects.toThrow(SITE_NOT_FOUND_MESSAGE);
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.audit.findFirst).not.toHaveBeenCalled();
  });
});
