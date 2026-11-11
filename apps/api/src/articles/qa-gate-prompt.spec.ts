import { describe, it, expect, vi } from 'vitest';
import { QaGateService, buildQaSystemPrompt } from './qa-gate.service.js';

/**
 * QA LLM istemi: QA blocker yayini durdurur (publisher QA_BLOCKED). Urun fiyati
 * talimati yalniz acikca belirlenmis urun tipinde; rehber ve diger her makale
 * main 9ebb3cc'deki istemin BIREBIR aynisini alir.
 */
const MAIN_PROMPT = [
      'Sen bir yayin oncesi dogruluk denetcisisin. Sana verilen Turkce/Ingilizce makalede SADECE su uc sinifi ara:',
      '1. fabricated_attribution — belirli bir kisi/kurum/rapora atif var ama kaynak linki/adi dogrulanabilir degil ("Webtures\'a gore...", "Gartner raporunda..." gibi, link yok).',
      '2. unsourced_claim — spesifik sayisal iddia (yuzde, adet, fiyat araligi, "arastirmalara gore X%") kaynak gosterilmeden verilmis.',
      '3. fabricated_entity — var olmayan/uydurma gorunumlu calisma, arac, kurum adi.',
      '',
      'Genel bilgiler, yazarin kendi yorumu ve "genellikle/cogu zaman" gibi nitelenmis ifadeler SORUN DEGIL. Asiri hassas olma: yalnizca yayinda utandiracak net vakalari isaretle.',
      '',
      'YANIT FORMATI — yalnizca JSON dizi, baska hicbir sey yazma:',
      '[{"severity":"blocker|warning","type":"fabricated_attribution|unsourced_claim|fabricated_entity","detail":"tek cumle Turkce aciklama","excerpt":"makaleden ilgili kesit (max 150 karakter)"}]',
      'Sorun yoksa [] dondur. En fazla 8 madde. Kaynakli net atiflar (linkli) blocker DEGILDIR; belirsiz ama zararsiz olanlar warning.',
    ].join('\n');

describe('buildQaSystemPrompt', () => {
  it('urun modu kapali (rehber, howto, liste, siniflandirici tahmini): eski istem birebir', () => {
    expect(buildQaSystemPrompt({ productMode: false })).toBe(MAIN_PROMPT);
    expect(buildQaSystemPrompt({ productMode: false, site: { name: 'Örnek', url: 'https://ornek.com' } })).toBe(MAIN_PROMPT);
  });

  it('urun modu: adi gecen urunun fiyati / limiti ve sitenin kendi urunu istisnasi', () => {
    const p = buildQaSystemPrompt({ productMode: true, site: { name: 'Örnek', url: 'https://ornek.com' } });
    expect(p).toMatch(/Adi gecen bir urunun\/hizmetin fiyati veya plan limiti/);
    expect(p).toContain('1.039 ₺');
    expect(p).toContain('Makale Örnek (https://ornek.com) sitesinde yayinlanacak');
    expect(p).toMatch(/Blocker yalniz BASKA markalarin/);
  });
});

describe('QaGateService — urun modu yalniz kayittaki acik/siralayici urun tipinde', () => {
  it('kaynak metninde karar readStoredContentPlan + isProductFactType ile veriliyor', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./qa-gate.service.ts', import.meta.url), 'utf8');
    expect(src).toContain('const plan = readStoredContentPlan(agentOutputs);');
    expect(src).toContain('const productMode = !!plan && isProductFactType(plan.type);');
    expect(src).toContain('await this.checkWithLlm(article.siteId, body, article.agentOutputs)');
  });
});

// 11.11.2026 (bagimsiz inceleme): aylik AI butcesi makale hattini sayiyor ama QA kapisinin cagrisi
// sahipsizdi (userId yok): her makalenin QA maliyeti sahibin sayacina yazilmiyordu.
describe('QaGateService — QA cagrisinin maliyeti site sahibinin AI butcesine yazilir', () => {
  const makale = { id: 'a1', siteId: 's1', bodyMd: 'x'.repeat(600), wordCount: 100, agentOutputs: null, title: 'Baslik', metaDescription: 'm', slug: 'baslik' };
  const kur = (site: unknown) => {
    const prisma = {
      article: { findFirst: vi.fn(async () => makale), update: vi.fn(async () => ({})) },
      site: { findUnique: vi.fn(async () => { if (site instanceof Error) throw site; return site; }) },
    };
    const llm = { chat: vi.fn(async (_req: any) => ({ output: '[]' })) };
    return { svc: new QaGateService(prisma as any, llm as any), prisma, llm };
  };

  it('cagri sahibin kimligiyle gider (LLMProviderService sayaci onunla artirir)', async () => {
    const { svc, llm, prisma } = kur({ userId: 'sahip-1' });
    await svc.check('a1');
    expect(prisma.site.findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, select: { userId: true } });
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(llm.chat.mock.calls[0][0]).toMatchObject({ context: 'qa-gate', siteId: 's1', userId: 'sahip-1' });
  });

  it('sahip okunamazsa QA yine kosar (cagri sahipsiz gider; yayin kilitlenmez)', async () => {
    for (const site of [null, new Error('db yok')]) {
      const { svc, llm } = kur(site);
      const r = await svc.check('a1');
      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(llm.chat.mock.calls[0][0].userId).toBeUndefined();
      expect(r.stats.llmUsed).toBe(true);
    }
  });
});
