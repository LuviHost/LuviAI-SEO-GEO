import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiCitationService } from './ai-citation.service.js';

/**
 * "Ilk anilan" olcum tarafi (14.11.2026): buildProbe, marka da anildiysa her rakibin
 * markadan ONCE gecip gecmedigini `beforeBrand` olarak yazar. Rakibin konumu hep
 * saklaniyordu, markaninki saklanmiyordu; bu alan olmadan marka + rakip birlikte gecen
 * cevapta sira bilinemez (competitor-visibility.ts firstMentionOf → 'unknown').
 * Yol runPublicProbes; yalniz Perplexity anahtari verilir, fetch taklit edilir.
 */

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'META_MODEL_API_KEY',
];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
  for (const k of PROVIDER_KEYS) delete process.env[k];
  process.env.PERPLEXITY_API_KEY = 'pplx-testkey-1234567890';
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function service() {
  const prisma = { $executeRawUnsafe: vi.fn(async () => 1) };
  return new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
}

async function rakipler(metin: string, brand: string, host: string, competitors: string[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: metin }, finish_reason: 'stop' }], citations: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  const out = await service().runPublicProbes({ brand, host, queries: ['Influencer ajansı önerir misin?'], competitors });
  const probe = out.find((r) => r.provider === 'perplexity')!.probes[0];
  return { probe, sira: Object.fromEntries((probe.competitors ?? []).map((c) => [c.name, c.beforeBrand])) };
}

describe('buildProbe — rakip markadan once mi (beforeBrand)', () => {
  it('marka da anildiysa: once gecen rakip true, sonra gecen false', async () => {
    const { probe, sira } = await rakipler(
      'Öne çıkanlar: Creatorden, ardından ICM Turkey ve Viralif.',
      'ICM Turkey', 'icmturkey.com', ['Creatorden', 'Viralif', 'Teamfluencer'],
    );
    expect(probe.brandMentioned).toBe(true);
    expect(sira).toEqual({ Creatorden: true, Viralif: false });
  });

  it('marka anilmadiysa alan YAZILMAZ (sira rakiplerin kendi konumundan cikar)', async () => {
    const { probe } = await rakipler('Öne çıkanlar: Viralif ve Creatorden.', 'ICM Turkey', 'icmturkey.com', ['Creatorden', 'Viralif']);
    expect(probe.brandMentioned).toBe(false);
    expect(probe.competitors!.map((c) => c.name)).toEqual(['Creatorden', 'Viralif']);
    for (const c of probe.competitors!) expect('beforeBrand' in c).toBe(false);
    // Konumlar yine yazilir: Viralif metinde Creatorden'den once
    const konum = Object.fromEntries(probe.competitors!.map((c) => [c.name, c.positionFirst!]));
    expect(konum.Viralif).toBeLessThan(konum.Creatorden);
  });

  it('metnin en basindaki marka: hemen ardindan gelen rakip once sayilmaz (sinir karakteri kaymasi yok)', async () => {
    const { sira } = await rakipler('ICM Turkey, Creatorden ile birlikte anılıyor.', 'ICM Turkey', 'icmturkey.com', ['Creatorden']);
    expect(sira).toEqual({ Creatorden: false });
  });

  it('ayni yerde baslayan adlarda metinde yazan UZUN olandir', async () => {
    // Rakip markanin on eki: metinde yazan marka → rakip once sayilmaz
    const kisaRakip = await rakipler('Listede Lavanta Kuaför Moda şubesi var.', 'Lavanta Kuaför', 'lavantakuafor.com', ['Lavanta']);
    expect(kisaRakip.probe.brandMentioned).toBe(true);
    expect(kisaRakip.sira).toEqual({ Lavanta: false });
    // Marka rakibin on eki: metinde yazan rakip → rakip once
    const uzunRakip = await rakipler('En iyisi Lavanta Kuaför.', 'Lavanta', 'lavanta.example', ['Lavanta Kuaför']);
    expect(uzunRakip.probe.brandMentioned).toBe(true);
    expect(uzunRakip.sira).toEqual({ 'Lavanta Kuaför': true });
  });

  it('alan adiyla eslesen jenerik marka: konumlar ayni cetvelle kiyaslanir', async () => {
    // "Emlak" alan adindan turetilmis jenerik marka → yalniz emlak.com gecisi marka sayilir
    const once = await rakipler('Önce Sahibinden, sonra emlak.com sayılabilir.', 'Emlak', 'emlak.com', ['Sahibinden']);
    expect(once.probe.brandMentioned).toBe(true);
    expect(once.sira).toEqual({ Sahibinden: true });
    const sonra = await rakipler('Önce emlak.com, sonra Sahibinden sayılabilir.', 'Emlak', 'emlak.com', ['Sahibinden']);
    expect(sonra.sira).toEqual({ Sahibinden: false });
  });
});
