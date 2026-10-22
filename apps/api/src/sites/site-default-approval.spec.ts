import { describe, it, expect, vi } from 'vitest';
import { SitesService } from './sites.service.js';
import { DEFAULT_PUBLISH_APPROVAL_MODE } from '../articles/publish-approval.js';

/**
 * Yeni site her planda Yari otomatik (her yazi onay bekler) baslar — sahip karari
 * 21.10.2026. Sema varsayilani da bu; create acikca yazar ki sema degisse bile
 * yeni siteler onaysiz yayinla baslamasin.
 */
describe('SitesService.create — varsayilan mod Yari otomatik', () => {
  it('publishApprovalMode manual_approve yazilir (istekte mod alani olsa bile)', async () => {
    const prisma: any = {
      site: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => ({ id: 's-new', ...data })),
      },
    };
    const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j1' })) };
    const svc = new SitesService(prisma, jobQueue as any, { enforceSiteQuota: vi.fn(async () => undefined) } as any);
    svc.urlResolver = async () => ['93.184.216.34'];
    await svc.create('u1', { url: 'https://yeni-ornek.com', name: 'Yeni', publishApprovalMode: 'auto_publish' } as any);
    expect(DEFAULT_PUBLISH_APPROVAL_MODE).toBe('manual_approve');
    expect(prisma.site.create.mock.calls[0][0].data.publishApprovalMode).toBe('manual_approve');
  });
});
