import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { accountLimitsView, normalizeAccountLimits } from './account-limits.js';
import { ownerEngines } from '../billing/plan-engines.js';

describe('yonetici hesap ayarlari (asistan kapatma, soru tavani)', () => {
  it('Grok kapatilir; olcum kapsamindan da cikar', () => {
    const d = normalizeAccountLimits('PARTNER', { disabledEngines: ['xai'], promptsPerSite: null });
    expect(d).toEqual({ disabledEngines: ['xai'], promptsPerSiteOverride: null });
    expect(ownerEngines({ plan: 'PARTNER', role: 'USER', disabledEngines: d.disabledEngines })).not.toContain('xai');
    expect(ownerEngines({ plan: 'PARTNER', role: 'USER' })).toContain('xai');
  });

  it('plan disi asistan acilamaz ve listeye yazilmaz; bilinmeyen ad atilir', () => {
    // Baslangic'ta Grok yok: kapatma istegi bos sayilir
    expect(normalizeAccountLimits('STARTER', { disabledEngines: ['xai', 'uydurma'], promptsPerSite: null }).disabledEngines).toBeNull();
    expect(ownerEngines({ plan: 'STARTER', role: 'USER', disabledEngines: ['xai'] })).not.toContain('xai');
  });

  it('planin butun asistanlari kapatilamaz', () => {
    const hepsi = accountLimitsView({ plan: 'STARTER' }).engines.map((e) => e.id);
    expect(() => normalizeAccountLimits('STARTER', { disabledEngines: hepsi, promptsPerSite: null })).toThrow(BadRequestException);
  });

  it('soru tavani 1–200 ya da null (plan degeri)', () => {
    expect(normalizeAccountLimits('PRO', { disabledEngines: [], promptsPerSite: 8 }).promptsPerSiteOverride).toBe(8);
    expect(normalizeAccountLimits('PRO', { disabledEngines: [], promptsPerSite: null }).promptsPerSiteOverride).toBeNull();
    for (const bad of [0, 201, 2.5, '10']) {
      expect(() => normalizeAccountLimits('PRO', { disabledEngines: [], promptsPerSite: bad }), String(bad)).toThrow(BadRequestException);
    }
  });

  it('gorunum: planin asistanlari acik/kapali, soru tavaninin plan degeri', () => {
    const v = accountLimitsView({ plan: 'PRO', disabledEngines: ['xai'], promptsPerSiteOverride: null });
    expect(v.engines.find((e) => e.id === 'xai')).toMatchObject({ label: 'Grok', enabled: false });
    expect(v.engines.find((e) => e.id === 'openai')).toMatchObject({ enabled: true });
    expect(v.promptsPerSite).toEqual({ override: null, planDefault: 10 });
  });
});
