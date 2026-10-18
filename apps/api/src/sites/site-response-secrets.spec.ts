import { describe, it, expect, vi } from 'vitest';
import { SitesService, SITE_SECRET_FIELDS } from './sites.service.js';

/**
 * PATCH /sites/:id (update) ve onboarding "Kaydet" (completeOnboarding)
 * eskiden tam Site satirini donuyordu: ingestSecret (Live Crawler HMAC siri)
 * ve sifreli GSC/GA/Ads token'lari cevaba giriyordu. Prisma `omit` sorgu
 * duzeyinde uygulanir; sahte Prisma omit'i taklit eder.
 */
const ROW = {
  id: 's1', userId: 'u1', url: 'https://ornek.com', name: 'Örnek',
  ingestSecret: 'luvi_ing_x', gscRefreshToken: 'enc-gsc', gaRefreshToken: 'enc-ga',
  googleAdsRefreshToken: 'enc-gads', metaAdsAccessToken: 'enc-meta',
  autoGenerationFrequency: 'weekly', autoGenerationHour: 9,
};

function build() {
  const applyOmit = (row: any, omit: any) => {
    const out = { ...row };
    for (const k of Object.keys(omit ?? {})) if (omit[k]) delete out[k];
    return out;
  };
  const prisma: any = {
    site: {
      findUnique: vi.fn(async () => ROW),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data, omit }: any) => applyOmit({ ...ROW, ...data }, omit)),
      create: vi.fn(async ({ data, omit }: any) => applyOmit({ ...ROW, ...data, id: 's-new' }, omit)),
    },
    publishTarget: { count: vi.fn(async () => 1) },
  };
  const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j1' })) };
  const quota = { enforceSiteQuota: vi.fn(async () => undefined) };
  const svc = new SitesService(prisma, jobQueue as any, quota as any);
  return { svc, prisma };
}

const user = { id: 'u1', role: 'USER' as const };
const SECRET_KEYS = Object.keys(SITE_SECRET_FIELDS);

describe('Site cevaplarinda sir yok', () => {
  it('update: omit ile, sir alanlari cevapta yok', async () => {
    const { svc, prisma } = build();
    const r: any = await svc.update('s1', { name: 'Yeni ad' } as any, user);
    expect(prisma.site.update.mock.calls[0][0].omit).toBe(SITE_SECRET_FIELDS);
    expect(r.name).toBe('Yeni ad');
    for (const k of SECRET_KEYS) expect(r[k], k).toBeUndefined();
  });

  it('completeOnboarding: omit ile, sir alanlari cevapta yok', async () => {
    const { svc, prisma } = build();
    const r: any = await svc.completeOnboarding('s1', user);
    expect(prisma.site.update.mock.calls[0][0].omit).toBe(SITE_SECRET_FIELDS);
    expect(r).toMatchObject({ onboardingStep: 7, status: 'ACTIVE' });
    for (const k of SECRET_KEYS) expect(r[k], k).toBeUndefined();
  });

  it('create: omit ile (yeni satirda bos olsalar da ayni kural)', async () => {
    const { svc, prisma } = build();
    svc.urlResolver = async () => ['93.184.216.34'];
    await svc.create('u1', { url: 'https://yeni-ornek.com', name: 'Yeni' } as any);
    expect(prisma.site.create.mock.calls[0][0].omit).toBe(SITE_SECRET_FIELDS);
  });
});
