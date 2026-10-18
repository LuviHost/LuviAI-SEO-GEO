import { describe, it, expect, vi } from 'vitest';
import { APP_STORE_LIMITS, GOOGLE_PLAY_LIMITS } from './store-limits.js';
import { AsoMetadataOptimizerService } from './aso-metadata-optimizer.service.js';
import { AsoLaunchChecklistService } from './aso-launch-checklist.service.js';
import { FIELD_LIMITS } from './asc/asc-metadata.js';
import { KEYWORD_FIELD_LIMIT } from './keyword-field-audit.js';
import { metadataLimitsFor } from './ai-agent.service.js';
import { AsoService } from './aso.service.js';

/**
 * Resmi sinirlar (kaynaklar store-limits.ts basliginda):
 *  - Google Play: ad 30 (Play Console 9859152 + meta veri politikasi 9898842),
 *    kisa aciklama 80, tam aciklama 4000
 *  - App Store: ad 30, alt baslik 30, anahtar kelime 100, promosyon 170,
 *    aciklama 4000, yenilikler 4000
 * Google Play adi bir yerde 50 yaziyordu; bu test sayinin yeniden dagilmasini engeller.
 */
describe('store-limits — resmi değerler', () => {
  it('Google Play: ad 30, kısa açıklama 80, tam açıklama 4000', () => {
    expect(GOOGLE_PLAY_LIMITS).toEqual({ title: 30, shortDescription: 80, fullDescription: 4000 });
  });

  it('App Store: ad 30, alt başlık 30, anahtar kelime 100, promosyon 170, açıklama 4000, yenilikler 4000', () => {
    expect(APP_STORE_LIMITS).toEqual({ name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000, whatsNew: 4000 });
  });
});

describe('store-limits — tüketiciler aynı sayıyı kullanıyor', () => {
  it('ASC alan sınırları ve anahtar kelime denetimi', () => {
    expect(FIELD_LIMITS).toEqual({ name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000 });
    expect(KEYWORD_FIELD_LIMIT).toBe(100);
  });

  it('AI üretim sınırları: Google Play adı 30 (eskiden 50)', () => {
    expect(metadataLimitsFor('ANDROID')).toMatchObject({ title: 30, subtitle: 80, description: 4000 });
    expect(metadataLimitsFor('IOS')).toMatchObject({ title: 30, subtitle: 30, description: 4000, keywordField: 100 });
  });

  it('metadata optimizer: 31 karakterlik Google Play adı sınırı aşar', () => {
    const r = new AsoMetadataOptimizerService().validateCharacterLimits({ platform: 'google', title: 'x'.repeat(31), short_description: 'y'.repeat(80) });
    expect(r.find((x) => x.field === 'title')).toMatchObject({ ok: false, limit: 30 });
    expect(r.find((x) => x.field === 'short_description')).toMatchObject({ ok: true, limit: 80 });
  });

  it('launch uyumluluk: Google Play adı 31 karakter → sorun; Türkçe harf 1 karakter sayılır', () => {
    const svc = new AsoLaunchChecklistService();
    const over = svc.validateGoogleCompliance({ title: 'ş'.repeat(31), shortDescription: 'kısa', description: 'a'.repeat(600), iconUrl: 'x' });
    expect(over.issues.map((i) => i.field)).toContain('title');
    const ok = svc.validateGoogleCompliance({ title: 'ş'.repeat(30), shortDescription: 'kısa', description: 'a'.repeat(600), iconUrl: 'x' });
    expect(ok.issues.map((i) => i.field)).not.toContain('title');
  });
});

describe('auditMetadata — Google Play adı 30 karakter', () => {
  function make(android: Record<string, unknown>) {
    const app = { id: 'a1', iosReviewCount: null, iosRating: null, androidReviewCount: 20, androidRating: 4.5, metadata: { android } };
    const prisma = { trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue(app) } };
    return new AsoService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }
  const base = { summary: 'y'.repeat(60), description: 'd'.repeat(2000), reviews: 20, score: 4.5, screenshots: [1, 2, 3, 4], headerImage: 'h', video: 'v' };

  it('31 karakter → hata, sayaç /30', async () => {
    const r = await make({ ...base, title: 'x'.repeat(31) }).auditMetadata('a1');
    const f = r.findings.find((x) => x.store === 'ANDROID' && x.field === 'title');
    expect(f).toMatchObject({ severity: 'error', current: '31/30 char' });
  });

  it('28 karakter → tamam (eskiden "kısa, 50\'yi kullan" uyarısı veriyordu)', async () => {
    const r = await make({ ...base, title: 'x'.repeat(28) }).auditMetadata('a1');
    const f = r.findings.find((x) => x.store === 'ANDROID' && x.field === 'title');
    expect(f).toMatchObject({ severity: 'ok', current: '28/30 char' });
    expect(JSON.stringify(r.findings)).not.toMatch(/\/50 char|50 char limit/);
  });

  it('kısa açıklama 81 karakter → hata', async () => {
    const r = await make({ ...base, title: 'x'.repeat(28), summary: 'y'.repeat(81) }).auditMetadata('a1');
    expect(r.findings.find((x) => x.field === 'shortDesc')).toMatchObject({ severity: 'error', current: '81/80 char' });
  });
});
