import { describe, it, expect, vi } from 'vitest';
import { DemoSeederService } from './demo-seeder.service.js';

/**
 * Demo sitesinin AI gorunurluk karti olculen 6 asistani anlatmali: eskiden ad
 * 4 asistan sayiyordu ve iki satir musteriye "OPENAI_API_KEY env yok" gibi ic
 * yapilandirma metni gosteriyordu. Vitest dekorator metadata'si uretmez —
 * servis elle kurulur.
 */
function kur() {
  const auditCreate = vi.fn<(args: any) => Promise<unknown>>(async () => ({}));
  const snapshotCreate = vi.fn<(args: any) => Promise<unknown>>(async () => ({}));
  const prisma = {
    site: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'demo1' })) },
    brain: { create: vi.fn(async () => ({})) },
    audit: { create: auditCreate },
    topicQueue: { create: vi.fn(async () => ({})) },
    article: { create: vi.fn(async () => ({})) },
    aiCitationSnapshot: { create: snapshotCreate },
  };
  return { svc: new DemoSeederService(prisma as any), auditCreate, snapshotCreate };
}

const OLCULEN = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];

describe('DemoSeederService — AI gorunurluk ornegi', () => {
  it('kart 6 olculen asistani adiyla sayar; skor saglayici ortalamasi; ic yapilandirma metni yok', async () => {
    const t = kur();
    await t.svc.createDemoSiteForUser('u1');
    const ai = t.auditCreate.mock.calls[0][0].data.checks.aiCitations;
    expect(ai.name).toBe('AI arama görünürlüğü (ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek)');
    expect(ai.providers.map((p: any) => p.provider)).toEqual(OLCULEN);
    const ort = Math.round(ai.providers.reduce((a: number, p: any) => a + p.score, 0) / ai.providers.length);
    expect(ai.score).toBe(ort);
    expect(JSON.stringify(ai)).not.toMatch(/API_KEY|env yok/);
  });

  it('gecmis grafigi ayni 6 asistani tasir (14 gun)', async () => {
    const t = kur();
    await t.svc.createDemoSiteForUser('u1');
    const saglayicilar = new Set(t.snapshotCreate.mock.calls.map((c: any[]) => c[0].data.provider));
    expect([...saglayicilar].sort()).toEqual([...OLCULEN].sort());
    expect(t.snapshotCreate).toHaveBeenCalledTimes(14 * OLCULEN.length);
  });
});
