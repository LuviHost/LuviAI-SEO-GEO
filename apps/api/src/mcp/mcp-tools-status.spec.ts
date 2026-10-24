import { describe, it, expect, vi } from 'vitest';
import { McpToolsService, type ToolUser } from './mcp-tools.service.js';

/**
 * MCP / sohbet araclari — durum suzgeci Prisma where'a yalniz izin
 * listesindeki DIZE olarak gider. Arguman JSON oldugu icin
 * { "status": { "not": "PUBLISHED" } } eskiden filtre olarak yorumlaniyordu.
 */
const user: ToolUser = { id: 'u1', role: 'USER', plan: 'AGENCY' };
const SITE = { id: 's1', userId: 'u1', name: 'Site', url: 'https://site.com' };

function build() {
  const prisma = {
    site: { findUnique: vi.fn(async () => SITE) },
    article: { findMany: vi.fn(async () => []) },
  };
  const opportunities = { list: vi.fn(async () => []) };
  const n = null as never;
  const svc = new McpToolsService(prisma as never, n, n, n, n, n, opportunities as never, n, n, n, n, n, n);
  const tool = (name: string) => svc.list().find((t) => t.name === name)!;
  return { svc, tool, prisma, opportunities };
}

describe('list_articles', () => {
  it('nesne status reddedilir, Prisma cagrilmaz', async () => {
    const { tool, prisma } = build();
    await expect(tool('list_articles').handler(user, { site_id: 's1', status: { not: 'PUBLISHED' } })).rejects.toThrow(/Geçersiz status/);
    await expect(tool('list_articles').handler(user, { site_id: 's1', status: 'HACKED' })).rejects.toThrow(/PUBLISHED/);
    expect(prisma.article.findMany).not.toHaveBeenCalled();
  });

  it('gecerli status (buyuk/kucuk harf) dize olarak; limit 1-50', async () => {
    const { tool, prisma } = build();
    await tool('list_articles').handler(user, { site_id: 's1', status: 'published', limit: -5 });
    const args = (prisma.article.findMany.mock.calls[0] as any[])[0];
    expect(args.where).toEqual({ siteId: 's1', status: 'PUBLISHED' });
    expect(args.take).toBe(1);
    await tool('list_articles').handler(user, { site_id: 's1', limit: 1000 });
    expect((prisma.article.findMany.mock.calls[1] as any[])[0]).toMatchObject({ where: { siteId: 's1' }, take: 50 });
  });

  it('girdi semasi durumlari listeler', () => {
    const { tool } = build();
    expect(tool('list_articles').inputSchema.properties.status.enum).toContain('READY_TO_PUBLISH');
  });
});

describe('list_content_opportunities', () => {
  it('nesne/bilinmeyen status reddedilir; gecerli deger servise dize gider', async () => {
    const { tool, opportunities } = build();
    await expect(tool('list_content_opportunities').handler(user, { site_id: 's1', status: { in: ['OPEN'] } })).rejects.toThrow(/Geçersiz status/);
    expect(opportunities.list).not.toHaveBeenCalled();
    await tool('list_content_opportunities').handler(user, { site_id: 's1', status: 'OPEN' });
    expect(opportunities.list).toHaveBeenCalledWith('s1', { status: 'OPEN' });
    await tool('list_content_opportunities').handler(user, { site_id: 's1' });
    expect(opportunities.list).toHaveBeenLastCalledWith('s1', { status: undefined });
  });
});

describe('get_audit aciklamasi', () => {
  it('olculmeyen AI skoru 0 diye sunulmasin', () => {
    const { tool } = build();
    expect(tool('get_audit').description).toContain('checks.aiCitations.score null ise AI ölçümü yapılmadı (neden skipped alanında)');
  });
});
