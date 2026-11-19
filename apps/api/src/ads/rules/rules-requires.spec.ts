import { describe, it, expect } from 'vitest';
import { GOOGLE_RULES } from './google-rules.js';
import { META_RULES } from './meta-rules.js';
import { buildFullRuleSet, trimSnapshotForPrompt } from './rule-factory.js';
import { NO_CAMPAIGN_FINDING, NO_DATA_FINDING, firstMissingRequirement } from './requires.js';
import { evaluateDeterministic } from '../ads-audit.service.js';
import type { AccountSnapshot, AuditRule } from './types.js';

/**
 * Kampanya Skoru yalniz hesaptan okudugunu soyler. Okunmayan alan (undefined)
 * 'na' + "veri okunamadı"; okunmus bos dizi gercek veridir ve kural fail
 * edebilir. Eskiden G42 / G43 / G45 veri yokken "tanımlı değil / kapalı" diye
 * fail donuyordu.
 */

const rule = (id: string): AuditRule => {
  const r = [...GOOGLE_RULES, ...META_RULES].find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r as AuditRule;
};
const run = (id: string, s: AccountSnapshot) => evaluateDeterministic(rule(id), s, 'saas');

describe('requires — her deterministik kural', () => {
  const det = [...GOOGLE_RULES, ...META_RULES].filter((r) => !r.llm) as AuditRule[];

  it('requires listesi tanimli', () => {
    for (const r of det) expect(r.requires?.length, r.id).toBeGreaterThan(0);
  });

  it('bos snapshot\'ta (hicbir sey okunmadi) hepsi na + veri okunamadi', () => {
    for (const r of det) {
      const out = evaluateDeterministic(r, {}, 'saas');
      expect(out.verdict, r.id).toBe('na');
      expect(out.finding, r.id).toBe(NO_DATA_FINDING);
      expect(out.noData, r.id).toBe(true);
    }
  });

  it('kampanyalar okundu ama alanlari okunmadi: kampanya alanina bakan kurallar na', () => {
    const s: AccountSnapshot = { campaigns: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] };
    for (const id of ['G11', 'G12', 'G20', 'G21', 'G27', 'G29', 'G39', 'G50']) {
      expect(run(id, s), id).toMatchObject({ verdict: 'na', finding: NO_DATA_FINDING, noData: true });
    }
  });

  it('kampanya listesi okundu ve bos: na ama veri eksikligi sayilmaz', () => {
    const out = run('G50', { campaigns: [] });
    expect(out).toMatchObject({ verdict: 'na', finding: NO_CAMPAIGN_FINDING });
    expect(out.noData).toBeUndefined();
  });

  it('yol cozumleme: dizi ogesinde alan', () => {
    expect(firstMissingRequirement({ campaigns: [{ id: '1', name: 'a', sitelinks: 0 }] }, ['campaigns[].sitelinks'])).toBeNull();
    expect(firstMissingRequirement({ capi: { active: true, deduplicationRate: 0.9 } }, ['capi.deduplicationRate'])).toBeNull();
    expect(firstMissingRequirement({ metaCampaigns: [{ id: '1', cbo: false }] }, ['metaCampaigns[].adSets[]'])).toEqual({ path: 'metaCampaigns[].adSets[]', reason: 'not_read' });
  });
});

describe('G42 donusum islemleri', () => {
  it('okunmadiysa na (eskiden "Hiç primary conversion action tanımlı değil" fail)', () => {
    expect(run('G42', {})).toMatchObject({ verdict: 'na', finding: NO_DATA_FINDING });
  });
  it('okundu ve bos: fail (hesapta gercekten yok)', () => {
    expect(run('G42', { conversionActions: [] }).verdict).toBe('fail');
  });
  it('etkin primary varsa pass', () => {
    expect(run('G42', { conversionActions: [{ id: '1', primary: true, status: 'enabled' }] }).verdict).toBe('pass');
  });
});

describe('G43 Enhanced Conversions / G45 Consent Mode', () => {
  it('okunmadiysa na', () => {
    expect(run('G43', {}).verdict).toBe('na');
    expect(run('G45', {}).verdict).toBe('na');
  });
  it('okunan deger puanlanir', () => {
    expect(run('G43', { enhancedConversionsActive: true }).verdict).toBe('pass');
    expect(run('G43', { enhancedConversionsActive: false }).verdict).toBe('fail');
    expect(run('G45', { consentModeV2: 'advanced' }).verdict).toBe('pass');
    expect(run('G45', { consentModeV2: 'basic' }).verdict).toBe('warning');
    expect(run('G45', { consentModeV2: 'none' }).verdict).toBe('fail');
  });
});

describe('G14 negatif listeler / G16 bosa harcama', () => {
  it('G14: okunmus bos liste fail, okunmamis na', () => {
    expect(run('G14', {}).verdict).toBe('na');
    expect(run('G14', { negativeKeywordLists: [] }).verdict).toBe('fail');
  });
  it('G16: USD esigi — USD disi hesapta na, USD hesapta puanlanir', () => {
    const terms = [{ term: 'a', cost: 50, conversions: 0 }, { term: 'b', cost: 50, conversions: 3 }];
    expect(run('G16', { searchTerms: terms }).verdict).toBe('na'); // para birimi okunmadi
    const tr = run('G16', { searchTerms: terms, currency: 'TRY' });
    expect(tr.verdict).toBe('na');
    expect(tr.finding).toContain('TRY');
    expect(run('G16', { searchTerms: terms, currency: 'USD' }).verdict).toBe('fail');
  });
});

describe('kampanya alanlari okununca', () => {
  it('G50: arama kampanyalarindan en az sitelinkli; 0 okunmussa fail', () => {
    const s: AccountSnapshot = { campaigns: [{ id: '1', name: 'Display' }, { id: '2', name: 'Arama', sitelinks: 0 }] };
    expect(run('G50', s).verdict).toBe('fail');
    expect(run('G50', { campaigns: [{ id: '2', name: 'Arama', sitelinks: 5 }] }).verdict).toBe('pass');
  });
  it('G11: herhangi bir kampanyada "interest" fail', () => {
    expect(run('G11', { campaigns: [{ id: '1', name: 'a', geoTargeting: 'people_in' }] }).verdict).toBe('pass');
    expect(run('G11', { campaigns: [{ id: '1', name: 'a', geoTargeting: 'people_in' }, { id: '2', name: 'b', geoTargeting: 'interest' }] }).verdict).toBe('fail');
  });
  it('G12: ilk kampanya Display olsa da arama kampanyasinin ag ayari okunur', () => {
    const s: AccountSnapshot = { campaigns: [
      { id: '1', name: 'Display' },
      { id: '2', name: 'Arama', network: { search: true, searchPartners: true, display: true } },
    ] };
    expect(run('G12', s).verdict).toBe('fail');
  });
  it('G29: reklam gucu okunmamis RSA na, okunmus en zayif puanlanir', () => {
    expect(run('G29', { campaigns: [{ id: '1', name: 'a', rsa: { count: 2, headlines: 10, descriptions: 4 } }] }).verdict).toBe('na');
    expect(run('G29', { campaigns: [
      { id: '1', name: 'a', rsa: { count: 2, headlines: 10, descriptions: 4, adStrength: 'excellent' } },
      { id: '2', name: 'b', rsa: { count: 1, headlines: 4, descriptions: 2, adStrength: 'poor' } },
    ] }).verdict).toBe('fail');
  });
  it('G06: kur donusumu yok — USD disi na; PMax sayisi kanal turunden', () => {
    expect(run('G06', { campaigns: [], monthlySpend: 50_000, currency: 'TRY' }).verdict).toBe('na');
    expect(run('G06', { campaigns: [{ id: '1', name: 'p', objective: 'PERFORMANCE_MAX' }], monthlySpend: 2000, monthlySpendUsd: 2000, currency: 'USD' }).verdict).toBe('pass');
    expect(run('G06', { campaigns: [{ id: '1', name: 's', objective: 'SEARCH' }], monthlySpend: 2000, monthlySpendUsd: 2000, currency: 'USD' }).verdict).toBe('fail');
  });
});

describe('Meta kurallari', () => {
  it('CAPI / alan adi / atif penceresi okunmadiysa na (eskiden fail)', () => {
    for (const id of ['M02', 'M05', 'M35']) expect(run(id, { metaCampaigns: [{ id: '1', cbo: true }] }).verdict, id).toBe('na');
  });
  it('M11 kampanya sayisi okunan kampanya listesinden', () => {
    const cs = Array.from({ length: 7 }, (_, i) => ({ id: String(i), cbo: false }));
    expect(run('M11', { metaCampaigns: cs }).verdict).toBe('fail');
  });
  it('reklam seti okunmadiysa kreatif kurallari na', () => {
    for (const id of ['M25', 'M26', 'M28', 'M-CR1', 'M-CR2', 'M-CR4', 'M31', 'M13', 'M16']) {
      expect(run(id, { metaCampaigns: [{ id: '1', cbo: true }] }), id).toMatchObject({ verdict: 'na', noData: true });
    }
  });
});

describe('LLM snapshot ozeti', () => {
  it('yalniz okunan alanlar gider; undefined anahtar yok', () => {
    const t = trimSnapshotForPrompt({ currency: 'TRY', campaigns: [{ id: '1', name: 'A', budget: undefined, geoTargeting: undefined }] }, 'google');
    expect(t).toEqual({ currency: 'TRY', campaigns: [{ id: '1', name: 'A' }] });
    expect(trimSnapshotForPrompt({}, 'meta')).toEqual({});
  });

  it('JSON kurallari LLM, manuel kurallar onlari ezer', () => {
    const all = buildFullRuleSet(GOOGLE_RULES, 'google');
    expect(all.filter((r) => r.id === 'G42')).toHaveLength(1);
    expect(all.some((r) => r.llm)).toBe(true);
  });
});
