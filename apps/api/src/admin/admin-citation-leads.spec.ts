import { describe, it, expect, vi } from 'vitest';
import { AdminService, hostKey } from './admin.service.js';

/**
 * Admin anonim test listesi: markasiz skor public getHistory ile AYNI tanim.
 * Damgali kayitta damga aynen kullanilir (v4 kayitlari buildProbe'dan host'lu
 * damga tasir). Damgasiz eski kayit (CITATION_MATCH_VERSION 4 oncesi) olculdugu
 * kuralla — yalin kelime — yeniden hesaplanir; gecmis skor geriye donuk
 * degismez (gerekce public-citation.service.ts getHistory notunda).
 */

function kur(rows: any[], attempts: any[] | 'hata' = [], sites: any[] | 'hata' = []) {
  const prisma = {
    publicCitationCheck: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
      groupBy: vi.fn(async () => rows.map((r) => ({ domain: r.domain }))),
    },
    publicCheckAttempt: {
      findMany: vi.fn(async (_: any) => { if (attempts === 'hata') throw new Error("Table 'public_check_attempts' doesn't exist"); return attempts; }),
      count: vi.fn(async () => { if (attempts === 'hata') throw new Error("Table 'public_check_attempts' doesn't exist"); return attempts.length; }),
    },
    site: {
      findMany: vi.fn(async (_: any) => { if (sites === 'hata') throw new Error('db'); return sites; }),
    },
  };
  return Object.assign(new AdminService(prisma as never), { prismaSahte: prisma });
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

/**
 * Denemeler (14.11.2026): olcum listesi yalniz TAZE olcumu tutar. Kayitli sonucu goren, sinira
 * takilan ve tamamlanamayan denemeler ayri tablodan gelir; sahip hicbirini kacirmak istemiyor.
 */
describe('AdminService.listCitationLeads — denemeler', () => {
  const deneme = (over: Record<string, unknown>) => ({
    id: 'a1', domain: 'ornek.com', outcome: 'cached', checkId: null, detail: null, notifiedAt: null,
    createdAt: new Date('2026-11-14T15:15:00Z'), ...over,
  });

  it('en yeni denemeler ve bugunku deneme sayisi ayni yanitta doner', async () => {
    const svc = kur([], [deneme({ id: 'a2', outcome: 'rate_limited', detail: 'Haftalık ücretsiz test hakkınız doldu' }), deneme({})]);
    const r = await svc.listCitationLeads();
    expect(r.attempts.map((a) => [a.id, a.outcome])).toEqual([['a2', 'rate_limited'], ['a1', 'cached']]);
    expect(r.attemptsToday).toBe(2);
    expect(svc.prismaSahte.publicCheckAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 100, where: {} }));
  });

  it('IP ozeti deneme listesine verilmez (gizlilik metni: ozet yalniz kotuye kullanim ve sinir icin)', async () => {
    const svc = kur([], [deneme({})]);
    await svc.listCitationLeads();
    const secim = (svc.prismaSahte.publicCheckAttempt.findMany.mock.calls[0] as any[])[0].select;
    expect(secim.ip).toBeUndefined();
    expect(Object.keys(secim).sort()).toEqual(['checkId', 'createdAt', 'detail', 'domain', 'id', 'notifiedAt', 'outcome']);
  });

  it('deneme tablosu okunamazsa (goc uygulanmamis) olcum listesi yine doner ve durum bildirilir', async () => {
    const svc = kur([row({ domain: 'ornek.com', brand: 'Ornek', result: { queries: [] } })], 'hata');
    const r = await svc.listCitationLeads();
    expect(r.items).toHaveLength(1);
    expect(r).toMatchObject({ attempts: [], attemptsToday: 0, attemptsError: true });
    // Tablo okunabiliyorsa bayrak kapali
    expect((await kur([], []).listCitationLeads()).attemptsError).toBe(false);
  });
});

/**
 * "Uye oldu" (14.11.2026, sahip: "kimler taramis gorelim"): test edilen alan adini sonradan
 * sitesi olarak ekleyen uye listede gorunur. Eslesme alan adiyla — IP ozetiyle DEGIL.
 */
describe('AdminService.listCitationLeads — uye eslesmesi', () => {
  const uyeSite = (url: string, createdAt: string, user: Record<string, unknown>) => ({
    url, createdAt: new Date(createdAt),
    user: { name: 'Batuhan Kartal', email: 'k@ornek.com', plan: 'TRIAL', subscriptionStatus: 'TRIAL', ...user },
  });
  const deneme = (over: Record<string, unknown>) => ({
    id: 'a1', domain: 'murataktas.co.uk', outcome: 'measured', checkId: 'c1', detail: null, notifiedAt: null,
    createdAt: new Date('2026-11-14T15:15:00Z'), ...over,
  });

  it('alan adi (www ve yol farki gozetmeden) uye sitesiyle eslesir; eslesmeyende null', async () => {
    const svc = kur(
      [row({ domain: 'murataktas.co.uk', brand: 'Murat Aktaş', result: { queries: [] } }), row({ id: 'c2', domain: 'baska.com', brand: 'Baska', result: { queries: [] } })],
      [deneme({}), deneme({ id: 'a2', domain: 'baska.com', outcome: 'cached' })],
      [uyeSite('https://www.MuratAktas.co.uk/tr/', '2026-11-14T15:44:22Z', {})],
    );
    const r = await svc.listCitationLeads();
    const uye = { name: 'Batuhan Kartal', email: 'k@ornek.com', plan: 'TRIAL', status: 'TRIAL', siteAddedAt: new Date('2026-11-14T15:44:22Z') };
    expect(r.items.map((i) => i.member)).toEqual([uye, null]);
    expect(r.attempts.map((a) => a.member)).toEqual([uye, null]);
  });

  it('ayni alan adini iki uye eklediyse ILK ekleyen; yonetici hesaplarinin siteleri sorguya girmez', async () => {
    const svc = kur(
      [], [deneme({})],
      [uyeSite('https://murataktas.co.uk', '2026-11-14T15:44:22Z', { email: 'ilk@ornek.com' }), uyeSite('https://murataktas.co.uk', '2026-11-20T10:00:00Z', { email: 'sonra@ornek.com' })],
    );
    const r = await svc.listCitationLeads();
    expect(r.attempts[0].member?.email).toBe('ilk@ornek.com');
    expect(svc.prismaSahte.site.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { user: { role: { not: 'ADMIN' } } }, orderBy: { createdAt: 'asc' },
    }));
    // Eslesme IP ozetiyle degil: site sorgusu IP alani okumaz
    expect(JSON.stringify((svc.prismaSahte.site.findMany.mock.calls[0] as any[])[0])).not.toMatch(/"ip"/);
  });

  it('uye siteleri okunamazsa liste yine doner (uye bilgisi bos)', async () => {
    const svc = kur([], [deneme({})], 'hata');
    const r = await svc.listCitationLeads();
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].member).toBeNull();
  });

  it('alan adi anahtari: adres ya da host, www\'siz ve kucuk harf; bozuk girdi bos', () => {
    expect(hostKey('https://WWW.Ornek.com/yol?x=1')).toBe('ornek.com');
    expect(hostKey('ornek.com')).toBe('ornek.com');
    expect(hostKey('blog.ornek.com')).toBe('blog.ornek.com');
    expect(hostKey('')).toBe('');
    expect(hostKey(null)).toBe('');
    expect(hostKey('http://')).toBe('');
  });

  it('arama denemelerde alan adina uygulanir', async () => {
    const svc = kur([], []);
    await svc.listCitationLeads({ search: ' murat ' });
    expect(svc.prismaSahte.publicCheckAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domain: { contains: 'murat' } } }));
  });
});
