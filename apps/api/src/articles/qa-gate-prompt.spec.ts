import { describe, it, expect } from 'vitest';
import { buildQaSystemPrompt } from './qa-gate.service.js';

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
