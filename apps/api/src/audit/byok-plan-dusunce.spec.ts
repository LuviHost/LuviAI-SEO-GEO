import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('@luviai/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Sifreleme anahtari testte yok; kayitli "sifreli" deger anahtarin kendisi
  decrypt: (v: string) => v,
}));

const { AiCitationService } = await import('./ai-citation.service.js');
const { POOL_ENV_KEY } = await import('./citation-providers.js');
const { QuotaService } = await import('../billing/quota.service.js');

/**
 * Kayitli BYOK anahtari yalniz sahibin planinda 'byok' (Kurumsal) varken kullanilir.
 *
 * NEDEN VAR: kapi yalniz anahtar KAYDINDAYDI (site-ai-keys upsertKey). Kurumsal'da
 * anahtar baglayip sonra plani dusen kullanicinin anahtari olcumde kullanilmaya
 * devam ediyordu; aylik kota dolunca olcum BYOK saglayicilariyla surdugu icin
 * calistirma tavani fiilen yoktu. ADMIN rota kapilarindaki gibi muaf.
 */

const ENV_KEYS = [...new Set([...Object.values(POOL_ENV_KEY), 'GEMINI_API_KEY', 'GROQ_LLAMA_MODEL'])];
let backup: Record<string, string | undefined> = {};
beforeEach(() => {
  backup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function kur(plan: string, role = 'USER', used = 0) {
  const byokRow = { provider: 'openai', enc: 'sk-musteri-anahtari', prefix: 'sk-musteri', verified: true, lastError: null };
  const prisma = {
    appSetting: { findUnique: vi.fn(async () => null) },
    site: {
      findUnique: vi.fn(async () => ({
        id: 's1', name: 'Ornekmarka', url: 'https://ornekmarka.com', userId: 'u1', niche: 'finans',
        brain: { seoStrategy: { aeoQueries: ['en iyi kredi sitesi'] } },
        user: { id: 'u1', plan, role },
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ id: 'u1', plan, role, aiCitationTestsThisMonth: used, aiCitationQuotaResetAt: new Date() })),
      update: vi.fn(async () => ({})),
    },
    siteAiProviderKey: {
      findUnique: vi.fn(async ({ where }: any) => (where.siteId_provider.provider === 'openai' ? byokRow : null)),
      findMany: vi.fn(async () => [byokRow]),
    },
    kvStore: { findUnique: vi.fn(async () => null) },
    $executeRawUnsafe: vi.fn(async () => 1),
    $queryRawUnsafe: vi.fn(async () => []),
  };
  const quota = new QuotaService(prisma as any);
  const allowance = { reserveOutsideSession: vi.fn(async () => null), release: vi.fn(async () => undefined) };
  const svc = new AiCitationService(prisma as any, quota, {} as any, allowance as any);
  const openai = vi.fn(async (_key: string, _h: string, _b: string, qs: string[]) =>
    qs.map((query) => ({ query, cited: false, brandMentioned: true, excerpt: 'Ornekmarka iyi' })));
  (svc as any).probeOpenAI = openai;
  return { svc, prisma, openai };
}

describe('resolveKey — BYOK yalniz planda varsa', () => {
  it('Kurumsal: kayitli anahtar kullanilir', async () => {
    const { svc } = kur('ENTERPRISE');
    expect(await (svc as any).resolveKey('s1', 'openai', 'ENTERPRISE', 'USER')).toEqual({ key: 'sk-musteri-anahtari', source: 'byok' });
  });

  it('plani dusen hesap (Ajans, TRIAL): kayitli anahtar KULLANILMAZ, havuz yoluna duser', async () => {
    process.env.OPENAI_API_KEY = 'sk-ranksup-havuz';
    for (const plan of ['AGENCY', 'PRO', 'TRIAL']) {
      const { svc, prisma } = kur(plan);
      expect(await (svc as any).resolveKey('s1', 'openai', plan, 'USER'), plan).toEqual({ key: 'sk-ranksup-havuz', source: 'pool' });
      expect(prisma.siteAiProviderKey.findUnique, plan).not.toHaveBeenCalled();
    }
  });

  it('ADMIN sahipli site planindan bagimsiz BYOK kullanir (rota kapisiyla tutarli)', async () => {
    const { svc } = kur('TRIAL', 'ADMIN');
    expect(await (svc as any).resolveKey('s1', 'openai', 'TRIAL', 'ADMIN')).toMatchObject({ source: 'byok' });
  });

  it('getProviderStatus: plan yoksa kayitli anahtar etkin kaynak sayilmaz (hasByok kalir)', async () => {
    const { svc } = kur('AGENCY');
    const st = await svc.getProviderStatus('s1', 'AGENCY', 'USER');
    expect(st.find((p) => p.provider === 'openai')).toMatchObject({ hasByok: true, effectiveSource: 'none' });
    const ent = await svc.getProviderStatus('s1', 'ENTERPRISE', 'USER');
    expect(ent.find((p) => p.provider === 'openai')).toMatchObject({ hasByok: true, effectiveSource: 'byok' });
  });
});

describe('runForSite — kota doluyken eski BYOK anahtari tavani asamaz', () => {
  it('plani dusen hesap: kota dolu + kayitli anahtar → 403, saglayici cagrilmaz', async () => {
    process.env.OPENAI_API_KEY = 'sk-ranksup-havuz';
    const { svc, openai } = kur('AGENCY', 'USER', 300); // Ajans hakki 300, dolu
    await expect(svc.runForSite('s1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(openai).not.toHaveBeenCalled();
  });

  it('Kurumsal: kota dolu olsa da BYOK saglayicisi kendi anahtariyla olcer (mevcut davranis)', async () => {
    process.env.OPENAI_API_KEY = 'sk-ranksup-havuz';
    const { svc, openai } = kur('ENTERPRISE', 'USER', 1000);
    const res = await svc.runForSite('s1');
    expect(openai).toHaveBeenCalledTimes(1);
    expect(openai.mock.calls[0]![0]).toBe('sk-musteri-anahtari');
    expect(res.find((r) => r.provider === 'openai')).toMatchObject({ source: 'byok', available: true });
  });
});
