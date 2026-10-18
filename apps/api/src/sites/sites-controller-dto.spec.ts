import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateSiteDto, GaPropertyDto, GscPropertyDto, SetCompetitorsDto, SiteAutopilotDto, SiteWebhookDto, UpdateSiteDto,
} from './sites.dto.js';
import { SitesController } from './sites.controller.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

function setup() {
  const update = vi.fn(async (args: any) => ({ id: 's1', ...args.data }));
  const sites = {
    findOne: vi.fn(async () => ({ id: 's1', userId: 'u1', url: 'https://ornek.com' })),
    setCompetitors: vi.fn(async (_id: string, list: any[]) => list),
  };
  const ctl = new SitesController(sites as any, {} as any, {} as any, {} as any, {} as any, {} as any, { site: { update } } as any);
  return { ctl, update, sites, req: { user: { id: 'u1', role: 'USER' } } as any };
}

describe('site guncelleme govdesi — tip dogrulamasi (servis govdeyi prisma.site.update\'e yayar)', () => {
  it('Prisma islem nesnesi, "false" dizesi, iliski yazimi ve sinir disi deger 400', async () => {
    await expect(pipe.transform({ autoGenerationCount: { increment: 1000 } }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ onboardingStep: { set: 99 } }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ autopilot: 'false' }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ autoGenerationHour: 30 }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ publishApprovalMode: 'yolo' }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ autoGenerationCron: '* * * * * rm -rf' }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ user: { update: { role: 'ADMIN' } } }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ userId: 'baskasi' }, asBody(UpdateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ url: 'https://ornek.com', name: 'x', autopilot: 'evet' }, asBody(CreateSiteDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panelin gonderdigi govdeler gecer', async () => {
    await expect(pipe.transform({ name: 'Örnek', niche: 'diğer', customNiche: null, language: 'tr' }, asBody(UpdateSiteDto))).resolves.toBeDefined();
    await expect(pipe.transform({ publishApprovalMode: 'auto_publish' }, asBody(UpdateSiteDto))).resolves.toBeDefined();
    await expect(pipe.transform({ autoGenerationCron: '0 9 * * 1,3,5', autoGenerationHour: 9, onboardingStep: 7, autopilot: true }, asBody(UpdateSiteDto))).resolves.toBeDefined();
    await expect(pipe.transform({ url: 'https://ornek.com', name: 'Örnek', niche: 'e-ticaret', language: 'tr' }, asBody(CreateSiteDto))).resolves.toBeDefined();
  });
});

describe('site eylem govdeleri', () => {
  it('autopilot/webhook/property govdeleri tipli', async () => {
    await expect(pipe.transform({ enabled: 'false' }, asBody(SiteAutopilotDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ enabled: true }, asBody(SiteAutopilotDto))).resolves.toBeDefined();
    await expect(pipe.transform({ url: 'https://hooks.slack.com/x', kind: 'teams' }, asBody(SiteWebhookDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ url: '' }, asBody(SiteWebhookDto))).resolves.toBeDefined();
    await expect(pipe.transform({ propertyUrl: { not: '' } }, asBody(GscPropertyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ propertyUrl: 'sc-domain:ornek.com' }, asBody(GscPropertyDto))).resolves.toBeDefined();
    await expect(pipe.transform({ propertyId: 123 }, asBody(GaPropertyDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rakip listesi: beyin ciktisindaki ek alanlar 400 vermez, nesne olmayan oge 400', async () => {
    const fromBrain = [{ name: 'Rakip', url: 'https://rakip.com', strengths: ['hızlı'], reason: 'LLM ek alani' }];
    await expect(pipe.transform({ competitors: fromBrain }, asBody(SetCompetitorsDto))).resolves.toBeDefined();
    await expect(pipe.transform({ competitors: ['https://rakip.com'] }, asBody(SetCompetitorsDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ competitors: 'x' }, asBody(SetCompetitorsDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('autopilot/webhook cevabinda sirlar yok; "false" dizesi pipe atlansa da acmaz', async () => {
    const { ctl, update, req } = setup();
    await ctl.setAutopilot(req, 's1', { enabled: 'false' } as any);
    expect(update.mock.calls[0][0].data).toEqual({ autopilot: false });
    expect(update.mock.calls[0][0].omit).toMatchObject({ ingestSecret: true, gscRefreshToken: true, gaRefreshToken: true, googleAdsRefreshToken: true, metaAdsAccessToken: true });
    await ctl.setWebhook(req, 's1', { url: '' });
    expect(update.mock.calls[1][0].data).toEqual({ notifyWebhookUrl: null, notifyWebhookKind: null });
    expect(update.mock.calls[1][0].omit.ingestSecret).toBe(true);
  });

  it('rakip ogeleri tek tek okunur: dize olmayan alanlar ve ek alanlar servise gitmez', async () => {
    const { ctl, sites, req } = setup();
    await ctl.setCompetitors(req, 's1', { competitors: [{ name: 'R', url: 'https://r.com', strengths: ['a', { x: 1 }, 5], reason: 'x', __proto__x: 1 }] } as any);
    const list = (sites.setCompetitors.mock.calls[0] as any)[1];
    expect(list).toEqual([{ name: 'R', url: 'https://r.com', strengths: ['a'], weaknesses: undefined }]);
  });
});
