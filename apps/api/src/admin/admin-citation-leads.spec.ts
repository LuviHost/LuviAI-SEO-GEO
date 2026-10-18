import { describe, it, expect, vi } from 'vitest';
import { AdminService } from './admin.service.js';

/**
 * Admin anonim test listesi: markasiz skor public getHistory ile AYNI tanim.
 * Damgali kayitta damga aynen kullanilir (v4 kayitlari buildProbe'dan host'lu
 * damga tasir). Damgasiz eski kayit (CITATION_MATCH_VERSION 4 oncesi) olculdugu
 * kuralla — yalin kelime — yeniden hesaplanir; gecmis skor geriye donuk
 * degismez (gerekce public-citation.service.ts getHistory notunda).
 */

function kur(rows: any[]) {
  const prisma = {
    publicCitationCheck: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
      groupBy: vi.fn(async () => rows.map((r) => ({ domain: r.domain }))),
    },
  };
  return new AdminService(prisma as never);
}

const row = (over: Record<string, unknown>) => ({
  id: 'c1', niche: 'gayrimenkul', customNiche: null, source: 'manual', ip: 'h', totalCalls: 14, costUsd: 0.1,
  createdAt: new Date('2026-10-01T00:00:00Z'), ...over,
});

describe('AdminService.listCitationLeads — markasiz skor', () => {
  it('kayitli damga varsa o kullanilir (v4: "emlak" kelimesi markasiz, alan adi markali)', async () => {
    const svc = kur([row({
      domain: 'emlak.com', brand: 'Emlak',
      result: { queries: [
        { query: 'Emlak alanında en iyi siteler hangileri?', citedCount: 3, totalProviders: 7, brandInQuery: false },
        { query: 'emlak.com yorumları nasıl?', citedCount: 6, totalProviders: 7, brandInQuery: true },
      ] },
    })]);
    const { items } = await svc.listCitationLeads();
    // Markali soru ne pay ne paydaya girer: 1 soru x 7 cevap
    expect(items[0]).toMatchObject({ citedScore: 3, queriesCount: 1, totalProviders: 7, maxScore: 7, brandedQueries: 1, lockedQueries: 0 });
  });

  it('damgasiz eski kayit olculdugu kuralla (yalin kelime) — public gecmisle ayni sayi', async () => {
    const svc = kur([row({
      domain: 'emlak.com', brand: 'Emlak',
      result: { queries: [
        { query: 'Emlak alanında en iyi siteler hangileri?', citedCount: 3, totalProviders: 7 },
        { query: 'Kiralık daire için hangi siteler güvenilir?', citedCount: 4, totalProviders: 7 },
      ] },
    })]);
    const { items } = await svc.listCitationLeads();
    expect(items[0].citedScore).toBe(4);
  });

  it('kilitli sorular ve olculemeyen cevaplar paydaya girmez (teaser: 2 olculen + 8 kilitli soru)', async () => {
    const p = (provider: string, over: Record<string, unknown> = {}) =>
      ({ provider, cited: false, brandMentioned: false, excerpt: 'cevap', measured: true, ...over });
    const svc = kur([row({
      domain: 'ornek.com', brand: 'Ornek',
      result: { queries: [
        {
          query: 'En iyi muhasebe yazılımı hangisi?', brandInQuery: false, locked: false, citedCount: 2, totalProviders: 4,
          // Eski kayittaki calismayan Llama satiri (alinti yok, measured alani yok) paydaya girmez
          providers: [p('openai', { brandMentioned: true }), p('anthropic', { cited: true }), p('gemini'), { provider: 'meta', cited: false, brandMentioned: false }],
        },
        {
          query: 'KOBİ için ön muhasebe önerisi?', brandInQuery: false, locked: false, citedCount: 1, totalProviders: 3,
          providers: [p('openai', { brandMentioned: true }), p('anthropic', { excerpt: 'HATA: rate_limited', measured: false }), p('gemini')],
        },
        ...Array.from({ length: 8 }, (_, i) => ({ query: `kilitli soru ${i}`, locked: true, providers: [], citedCount: 0, totalProviders: 3 })),
      ] },
    })]);
    const { items } = await svc.listCitationLeads();
    // Eskiden: 3 / (10 soru x 4) = 3/40. Simdi: 3 / (3 + 2 olculen cevap) = 3/5
    expect(items[0]).toMatchObject({ citedScore: 3, maxScore: 5, queriesCount: 2, totalProviders: 3, lockedQueries: 8, brandedQueries: 0 });
  });
});
