import { describe, it, expect } from 'vitest';
import { competitorTerms, competitorHitInFolded } from './competitor-match.js';
import { foldForMatch } from '../common/text-normalize.js';

describe('rakip adi terimleri — prod\'daki gercek aciklamali adlar (22.11.2026)', () => {
  it.each([
    ['Ingenico Turkey', ['ingenico']],
    ['Verifone Turkey', ['verifone']],
    ['Hugin (Olivetti)', ['hugin']],
    ['Gittigidiyor (eBay Turkey)', ['gittigidiyor']],
    ['Udemy TR', ['udemy']],
    ['Sovos Türkiye (eBildiri)', ['sovos']],
    ['HAVAS Turkey', ['havas']],
    ['Vallet (Halkbank)', ['vallet']],
    ['Insider (useinsider.com)', ['useinsider.com', 'insider']],
    ['ProDapt (eski adıyla Telesis)', ['telesis', 'prodapt']],
    ['Alere / Abbott Diagnostics', ['alere', 'abbott diagnostics']],
    ['Excel + Google Sheets (DIY)', ['excel', 'google sheets']],
    ['Beko (Arçelik) — doğrudan kanal', ['beko']],
    ['Akinon / genel SaaS POS', ['akinon']],
    ['Bant.io / Yerli Alternatifler', ['bant.io']],
    ['Instagram / Diecast TR Toplulukları', ['instagram']],
    ['Dijital Ajans (dijitalajans.com)', ['dijitalajans.com']],
    ['Becton Dickinson (BD)', ['becton dickinson']],
    ['EBA (Eğitim Bilişim Ağı)', ['eba']],
  ])('%s', (ad, beklenen) => {
    expect(competitorTerms(ad)).toEqual(beklenen);
  });
  it('yalin ad aynen kalir; kucuk harfli tek kelimelik marka gecerli', () => {
    expect(competitorTerms('PayTR')).toEqual(['paytr']);
    expect(competitorTerms('iyzico')).toEqual(['iyzico']);
    expect(competitorTerms('inPOS')).toEqual(['inpos']);
  });
  it('hic terim cikmazsa tam ad (eski davranis); bos ad bos', () => {
    expect(competitorTerms('genel saas araçları')).toEqual([foldForMatch('genel saas araçları')]);
    expect(competitorTerms('')).toEqual([]);
  });
  it('Turkce buyuk I katlamasi: "İyzico" ile "iyzico" ayni', () => {
    expect(competitorTerms('İyzico Türkiye')).toEqual(competitorTerms('iyzico'));
  });
});

describe('rakip gecisi — cevap metninde', () => {
  const hit = (ad: string, metin: string) => competitorHitInFolded(foldForMatch(metin), competitorTerms(ad));
  it('aciklamali ad, cevaptaki yalin adla yakalanir (eskiden kaciyordu)', () => {
    expect(hit('Ingenico Turkey', 'Genel kullanim icin Beko veya Ingenico iyi secenektir.')?.mentions).toBe(1);
    expect(hit('Hugin (Olivetti)', "Fiyat/performans icin inPOS / Hugin.")).not.toBeNull();
  });
  it('ana sirketin anilmasi rakibin anilmasi sayilmaz', () => {
    expect(hit('Vallet (Halkbank)', 'Halkbank POS hizmeti sunuyor.')).toBeNull();
    expect(hit('Hugin (Olivetti)', 'Olivetti yazar kasalari.')).toBeNull();
  });
  it('alternatiflerden ilki gecen ve toplam gecis', () => {
    const h = hit('Alere / Abbott Diagnostics', 'Abbott Diagnostics ve Alere; yine Alere.')!;
    expect(h.mentions).toBe(3);
    expect(h.start).toBe(0);
  });
  it('kelime siniri: "Udemy TR" → "udemyx" sayilmaz, "Udemy\'nin" sayilir', () => {
    expect(hit('Udemy TR', 'udemyx bir site.')).toBeNull();
    expect(hit('Udemy TR', "Udemy'nin kurslari.")).not.toBeNull();
  });
  it('alan adi terimi alt alanla da yakalanir', () => {
    expect(hit('Dijital Ajans (dijitalajans.com)', 'Kaynak: www.dijitalajans.com/blog')).not.toBeNull();
    expect(hit('Dijital Ajans (dijitalajans.com)', 'Bir dijital ajans ile calisin.')).toBeNull();
  });
});
