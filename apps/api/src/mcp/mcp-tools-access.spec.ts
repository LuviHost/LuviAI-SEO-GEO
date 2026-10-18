import { describe, it, expect, vi } from 'vitest';
import { McpToolsService, type ToolUser } from './mcp-tools.service.js';

/**
 * MCP / sohbet araclari — olculemeyen skor ajana guncel skor diye GITMEZ.
 *
 * NEDEN VAR: anasayfa okunamayan tarama Audit satiri yazmaz (crawl-access.ts);
 * en son satir ESKI bir skordur. Panel bu durumda skoru gizler, araclar ise
 * prisma.audit'i dogrudan okuyup bayat skoru "guncel" diye veriyordu. Ayni
 * sekilde engelli/ulasilamaz AXO taramasinin overallScore'u yalniz olculebilen
 * kontrolleri yansitir.
 */

const user: ToolUser = { id: 'u1', role: 'USER', plan: 'AGENCY' };
const SITE = { id: 's1', userId: 'u1', name: 'Site', url: 'https://site.com', niche: null, status: 'ACTIVE' };
const AUDIT_AT = new Date('2026-10-01T10:00:00Z');
const access = (at: string) => ({
  state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
  reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.',
  at, source: 'audit',
});

function build(opts: { audit?: any; crawlAccess?: any; scan?: any; latest?: any; scanResult?: any } = {}) {
  const prisma = {
    site: { findUnique: vi.fn(async () => SITE) },
    audit: { findFirst: vi.fn(async () => opts.audit ?? null) },
    agentReadinessScan: { findFirst: vi.fn(async (a: any) => (a?.select?.levels ? null : opts.scan ?? null)) },
    article: { count: vi.fn(async () => 3) },
    geoPrompt: { count: vi.fn(async () => 5) },
    trackedApp: { count: vi.fn(async () => 0) },
    kvStore: {
      findUnique: vi.fn(async () => (opts.crawlAccess ? { value: JSON.stringify(opts.crawlAccess), expiresAt: null } : null)),
      upsert: vi.fn(), deleteMany: vi.fn(),
    },
  };
  const agentReadiness = {
    getLatest: vi.fn(async () => opts.latest ?? null),
    scan: vi.fn(async () => opts.scanResult),
  };
  const n = null as never;
  const svc = new McpToolsService(prisma as never, n, n, n, agentReadiness as never, n, n, n, n, n, n, n);
  const tool = (name: string) => svc.list().find((t) => t.name === name)!;
  return { svc, tool, prisma };
}

const AUDIT = { id: 'a1', siteId: 's1', overallScore: 72, geoScore: 40, checks: {}, issues: [], ranAt: AUDIT_AT };

describe('get_site_overview', () => {
  it('denetimden SONRAKI deneme siteye erisemediyse skorlar null + erisim nedeni', async () => {
    const { tool } = build({ audit: AUDIT, crawlAccess: access('2026-10-05T10:00:00Z') });
    const r = await tool('get_site_overview').handler(user, { site_id: 's1' });
    expect(r.auditScore).toBeNull();
    expect(r.geoScore).toBeNull();
    expect(r.lastAuditAt).toEqual(AUDIT_AT);
    expect(r.auditAccess).toMatchObject({ state: 'blocked', kind: 'waf' });
    expect(r.auditAccess.message).toBe('Erişim engellendi: Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403). "RanksUpBot" için izin verin.');
  });

  it('erisim kaydi denetimden ESKIYSE (sonra duzelmis) skor aynen', async () => {
    const { tool } = build({ audit: AUDIT, crawlAccess: access('2026-09-20T10:00:00Z') });
    const r = await tool('get_site_overview').handler(user, { site_id: 's1' });
    expect(r).toMatchObject({ auditScore: 72, geoScore: 40, auditAccess: null });
  });

  it('engelli AXO taramasinda agentReadiness skoru null; eski alanlar (overallScore, status) korunur', async () => {
    const { tool } = build({ audit: AUDIT, scan: { id: 'x', overallScore: 30, status: 'blocked' } });
    const r = await tool('get_site_overview').handler(user, { site_id: 's1' });
    expect(r.agentReadiness).toMatchObject({ overallScore: null, status: 'blocked', measured: false });
    expect(r.agentReadiness.reason).toContain('ölçülemedi');
  });

  it('olculebilen AXO taramasi aynen', async () => {
    const { tool } = build({ scan: { id: 'x', overallScore: 81, status: 'mostly_ready' } });
    const r = await tool('get_site_overview').handler(user, { site_id: 's1' });
    expect(r.agentReadiness).toEqual({ overallScore: 81, status: 'mostly_ready', measured: true, reason: null });
    expect(r.auditScore).toBeNull();
  });
});

describe('get_audit', () => {
  it('bayat denetim isaretlenir: current=false, accessBlocked + not; mevcut alanlar korunur', async () => {
    const { tool } = build({ audit: AUDIT, crawlAccess: access('2026-10-05T10:00:00Z') });
    const r = await tool('get_audit').handler(user, { site_id: 's1' });
    expect(r).toMatchObject({ overallScore: 72, geoScore: 40, ranAt: AUDIT_AT, current: false });
    expect(r.accessBlocked).toMatchObject({ state: 'blocked', at: '2026-10-05T10:00:00Z' });
    expect(r.note).toContain('Bu skor güncel değil');
    expect(r.note).toContain('2026-10-05');
    expect(r.note).toContain('2026-10-01');
  });

  it('erisim sorunu yoksa current=true, not yok', async () => {
    const { tool } = build({ audit: AUDIT });
    const r = await tool('get_audit').handler(user, { site_id: 's1' });
    expect(r).toMatchObject({ overallScore: 72, current: true, accessBlocked: null });
    expect(r.note).toBeUndefined();
  });

  it('hic puanli denetim yok ama deneme engellendiyse "hic kosulmamis" denmez', async () => {
    const { tool } = build({ crawlAccess: access('2026-10-05T10:00:00Z') });
    const r = await tool('get_audit').handler(user, { site_id: 's1' });
    expect(r.message).toContain('son tarama denemesi siteye erişemedi');
    expect(r.message).toContain('RanksUpBot');
    expect(r.accessBlocked).toBeTruthy();
  });

  it('hic denetim ve kayit yoksa eski mesaj', async () => {
    const { tool } = build();
    expect(await tool('get_audit').handler(user, { site_id: 's1' })).toEqual({ message: 'Henuz audit kosulmamis. run_audit ile baslatabilirsin.' });
  });
});

describe('AXO araclari', () => {
  it('get_agent_readiness: blocked/unreachable → overallScore null, measured false; access korunur', async () => {
    const latest = { id: 'x', overallScore: 30, status: 'unreachable', access: { state: 'unreachable', reason: 'Site zamanında yanıt vermedi (zaman aşımı).' } };
    const { tool } = build({ latest });
    const r = await tool('get_agent_readiness').handler(user, { site_id: 's1' });
    expect(r).toMatchObject({ overallScore: null, status: 'unreachable', measured: false, access: latest.access });
  });

  it('run_agent_readiness_scan: olculebilen sonuc aynen (+ measured true)', async () => {
    const { tool } = build({ scanResult: { overallScore: 64, status: 'needs_work', access: null } });
    const r = await tool('run_agent_readiness_scan').handler(user, { site_id: 's1' });
    expect(r).toMatchObject({ overallScore: 64, status: 'needs_work', measured: true });
  });

  it('aciklamalar: "ölçülemedi" anlami ve kodla uyumlu sure (~15 sn iddiasi yok)', () => {
    const { tool } = build();
    for (const name of ['get_agent_readiness', 'run_agent_readiness_scan']) {
      const d = tool(name).description;
      expect(d, name).toMatch(/'blocked' ya da 'unreachable'/);
      expect(d, name).toMatch(/ölçülemedi/i);
      expect(d, name).not.toMatch(/15 sn/);
    }
    // agent-readiness.service: FETCH_TIMEOUT_MS = 10 sn, CONCURRENCY = 4
    expect(tool('run_agent_readiness_scan').description).toContain('istek başına en fazla 10 sn, aynı anda en fazla 4 istek');
  });
});
