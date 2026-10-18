import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { encrypt } from '@luviai/shared';
import { AsaService } from './asa.service.js';
import { SetAsaAutoPilotDto } from './asa.dto.js';
import type { AsaAdsClient } from './asa-types.js';

/**
 * ASA otopilot aylik harcama siniri (G17). DTO 0'i kabul ediyor (@Min(0)) ama
 * runAutoPilot dogruluk kontrolu yapiyordu (cap && spend >= cap): 0 "sinir yok"
 * sayiliyor, panel "aylik harcama siniri 0" gosterirken otopilot kelime ekleyip
 * duraklatmaya devam ediyordu. Kural: null = sinir yok, 0 = hic degisiklik yok.
 */

// main.ts ile ayni ayarlar
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = { type: 'body' as const, metatype: SetAsaAutoPilotDto, data: '' };

function fakeClient(): AsaAdsClient {
  return {
    version: 'v5',
    getAccessToken: vi.fn(async () => ({ accessToken: 't', expiresAt: new Date(Date.now() + 3600_000), tokenType: 'Bearer' })),
    getAccountInfo: vi.fn(async () => ({ contextId: '40669820', name: 'Hesap', currency: 'EUR', orgId: '1' })),
    listCampaigns: vi.fn(async () => []),
    getCampaignDailyReport: vi.fn(async () => []),
    // Son 7 gunde 30 dokunma, 0 yukleme: sinir olmasa duraklatilirdi
    getKeywordReport: vi.fn(async () => [{ keywordId: '777', impressions: 500, taps: 30, installs: 0, spend: 12 }]),
    updateTargetingKeyword: vi.fn(async () => null),
    addTargetingKeywords: vi.fn(async () => ({ created: [], failed: [] })),
  } as unknown as AsaAdsClient;
}

function build(cap: number | null, monthSpend: number) {
  const account = {
    id: 'acc-1', siteId: 'site-a', orgId: 'SEARCHADS.c', keyId: 'k', teamId: null,
    encryptedKey: encrypt('-----BEGIN PRIVATE KEY-----x'), autoPilotEnabled: true, autoPilotBudgetCap: cap, isActive: true,
  };
  const prisma: any = {
    site: { findUnique: vi.fn(async () => ({ id: 'site-a', userId: 'user-a' })) },
    asaAccount: {
      findUnique: vi.fn(async () => account),
      update: vi.fn(async ({ data }: any) => ({ ...account, ...data })),
    },
    asaCampaign: { findUnique: vi.fn(async () => null) },
    asaPerformanceDaily: {
      upsert: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { spendUsd: monthSpend } })),
    },
    asaKeywordBid: {
      findMany: vi.fn(async (args: any) => (args?.select ? [] : [{
        id: 'kb-1', asaKeywordId: '777', keyword: 'eski kelime', status: 'ACTIVE',
        adGroup: { asaAdGroupId: '9200', campaign: { asaCampaignId: '9100' } },
      }])),
      update: vi.fn(async ({ data }: any) => data),
      create: vi.fn(async ({ data }: any) => data),
    },
    asaAdGroup: { findFirst: vi.fn(async () => null) },
    kvStore: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
  };
  const svc = new AsaService(prisma);
  const client = fakeClient();
  vi.spyOn(svc as any, 'createClient').mockImplementation(() => client);
  // AI onerisi aga cikmasin: sinir yokken eklenecek kelime olmasin diye bos oneri
  vi.spyOn(svc, 'suggestCampaign').mockResolvedValue({ keywords: [], bidUsd: 1 } as any);
  return { svc, prisma, client };
}

describe('runAutoPilot — aylik harcama siniri', () => {
  it('sinir 0: otopilot HICBIR degisiklik yapmaz (ay ici harcama 1234 de, 0 da olsa)', async () => {
    for (const spend of [1234, 0]) {
      const { svc, client } = build(0, spend);
      const res = await svc.runAutoPilot('acc-1');
      expect(res.skipped).toEqual(['budget-cap-reached']);
      expect(res.reason).toBe('Aylık harcama sınırı 0 olarak ayarlı; otopilot değişiklik yapmadı.');
      expect(client.updateTargetingKeyword).not.toHaveBeenCalled();
      expect(client.addTargetingKeywords).not.toHaveBeenCalled();
    }
  });

  it('sinir yok (null): otopilot calisir (dusuk performansli kelime duraklatilir)', async () => {
    const { svc, client } = build(null, 1234);
    const res = await svc.runAutoPilot('acc-1');
    expect(res.skipped).not.toContain('budget-cap-reached');
    expect(client.updateTargetingKeyword).toHaveBeenCalledWith('9100', '9200', '777', { status: 'PAUSED' });
    expect(res.paused).toEqual(['eski kelime']);
  });

  it('pozitif sinir: harcama altindaysa calisir, ulasinca durur', async () => {
    const under = build(500, 499.99);
    expect((await under.svc.runAutoPilot('acc-1')).skipped).not.toContain('budget-cap-reached');
    const over = build(500, 500);
    const res = await over.svc.runAutoPilot('acc-1');
    expect(res.skipped).toEqual(['budget-cap-reached']);
    expect(over.client.updateTargetingKeyword).not.toHaveBeenCalled();
  });

  it('setAutoPilot 0\'i "sinir yok"a cevirmeden kaydeder', async () => {
    const { svc, prisma } = build(500, 0);
    await svc.setAutoPilot('acc-1', { enabled: true, budgetCapUsd: 0 }, { id: 'user-a', role: 'USER' });
    expect(prisma.asaAccount.update.mock.calls[0][0].data).toMatchObject({ autoPilotEnabled: true, autoPilotBudgetCap: 0 });
  });
});

describe('SetAsaAutoPilotDto — panelin uyguladigi kuralla ayni', () => {
  it('0 ve pozitif sayilar gecer; null/eksik "mevcut siniri koru" demektir', async () => {
    await expect(pipe.transform({ enabled: true, budgetCapUsd: 0 }, asBody)).resolves.toMatchObject({ budgetCapUsd: 0 });
    await expect(pipe.transform({ enabled: true, budgetCapUsd: 250.5 }, asBody)).resolves.toMatchObject({ budgetCapUsd: 250.5 });
    await expect(pipe.transform({ enabled: false, budgetCapUsd: null }, asBody)).resolves.toMatchObject({ enabled: false });
    await expect(pipe.transform({ enabled: false }, asBody)).resolves.toMatchObject({ enabled: false });
  });

  it('negatif, sayi olmayan ve sonsuz deger reddedilir', async () => {
    for (const budgetCapUsd of [-1, -0.01, '100', Number.POSITIVE_INFINITY]) {
      await expect(pipe.transform({ enabled: true, budgetCapUsd }, asBody)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
