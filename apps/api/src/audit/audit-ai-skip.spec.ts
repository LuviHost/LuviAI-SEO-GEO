import { describe, it, expect, vi } from 'vitest';
import { HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { AuditService, aiCitationSkipFromError, aiCitationSkipFromResults, compareAuditRows } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { CITATION_MATCH_VERSION } from './host-match.js';

/**
 * F6 — atlanan AI olcumu `score: 0` olarak YAZILMAZ.
 *
 * NEDEN VAR: runForSite haftalik olcum hakki dolunca 429 firlatir; runAudit bu
 * hatayi yutup aiCitations'a `score: aiCitationAvg ?? 0` yaziyordu. Hak
 * kullanildiktan sonraki 7 gun icinde baslatilan HER kullanici denetimi
 * (Tekrar dene, kuyruktaki SITE_AUDIT) bu yola dusuyor: panel "0/100" ve
 * "0 AI asistaninda olculdu", karsilastirma sahte dusus gosteriyordu.
 */

function servis(runForSite: () => Promise<any[]>) {
  const rows = new Map<string, { value: string; expiresAt: Date | null }>();
  const auditCreate = vi.fn(async ({ data }: any) => ({ id: 'a1', ...data }));
  const prisma = {
    kvStore: {
      upsert: vi.fn(async ({ where, create }: any) => { rows.set(where.key, create); }),
      deleteMany: vi.fn(async () => ({})),
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
    },
    site: { findUniqueOrThrow: async () => ({ id: 's1', userId: 'u1', url: 'https://site.com' }), update: vi.fn(async () => ({})) },
    audit: { create: auditCreate },
  };
  const crawler = { crawl: vi.fn(async () => ({ baseUrl: 'https://site.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0 })) };
  const pagespeed = { runAudit: vi.fn(async () => null) };
  const geo = { runAudit: vi.fn(async () => ({ score: 50, methods: [], queries: [], details: { methodVersion: 2 } })) };
  const aiCitation = { runForSite: vi.fn(runForSite) };
  const svc = new AuditService(prisma as never, crawler as never, new AuditChecksService(), pagespeed as never, geo as never, aiCitation as never, null as never);
  const kaydedilen = () => auditCreate.mock.calls[0][0].data;
  return { svc, kaydedilen };
}

const haftalikLimit = () =>
  new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: 'WEEKLY_MEASUREMENT_LIMIT',
      message: 'Bu haftaki AI ölçüm hakkını kullandın.',
      nextAvailableAt: '2026-10-20T08:00:00.000Z',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

describe('runAudit — AI adimi atlandiginda', () => {
  it('haftalik hak dolu (429): skor null + neden + bir sonraki hak; 0 yazilmaz, ai_citation_low uretilmez', async () => {
    const t = servis(async () => { throw haftalikLimit(); });
    await t.svc.runAudit('s1');
    const data = t.kaydedilen();
    expect(data.checks.aiCitations.score, 'olculmeyen AI skoru 0 yazildi').toBeNull();
    expect(data.checks.aiCitations.providers).toEqual([]);
    expect(data.checks.aiCitations.skipped).toEqual({
      code: 'WEEKLY_MEASUREMENT_LIMIT',
      message: 'Haftalık AI ölçüm hakkı kullanıldığı için bu taramada AI ölçümü yapılmadı.',
      nextAvailableAt: '2026-10-20T08:00:00.000Z',
    });
    expect((data.issues as any[]).some((i) => i.type === 'ai_citation_low')).toBe(false);
    // Denetimin geri kalani yine yazildi
    expect(typeof data.overallScore).toBe('number');
  });

  it('saglayicilarin hicbiri olcum donduremedi: skor null, NO_PROVIDER', async () => {
    const t = servis(async () => [
      { provider: 'openai', label: 'OpenAI ChatGPT', available: false, score: null, probes: [], reason: 'NO_KEY' },
      { provider: 'meta', label: 'Meta AI (Llama)', available: false, score: null, probes: [] },
    ]);
    await t.svc.runAudit('s1');
    const ai = t.kaydedilen().checks.aiCitations;
    expect(ai.score).toBeNull();
    expect(ai.skipped.code).toBe('NO_PROVIDER');
    expect(ai.providers).toHaveLength(2);
  });

  it('gercek olcum: ortalama skor yazilir, skipped YOK; dusukse ai_citation_low uretilir', async () => {
    const t = servis(async () => [
      { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 10, probes: [] },
      { provider: 'anthropic', label: 'Anthropic Claude', available: true, score: 30, probes: [] },
      { provider: 'meta', label: 'Meta AI (Llama)', available: false, score: null, probes: [] },
    ]);
    await t.svc.runAudit('s1');
    const data = t.kaydedilen();
    expect(data.checks.aiCitations.score).toBe(20);
    expect(data.checks.aiCitations).not.toHaveProperty('skipped');
    expect(data.checks.aiCitations.name).toBe('AI arama görünürlüğü');
    const dusuk = (data.issues as any[]).find((i) => i.type === 'ai_citation_low');
    expect(dusuk).toMatchObject({ checkId: 'ai_citation' });
    expect(dusuk.description).toContain('20/100');
  });

  it('GEO sonucu yontem surumuyle birlikte kaydedilir (checks.geo.details.methodVersion)', async () => {
    const t = servis(async () => []);
    await t.svc.runAudit('s1');
    expect(t.kaydedilen().checks.geo.details).toEqual({ methodVersion: 2 });
  });

  /**
   * G6 — aiCitations yontem surumu tasimiyordu: checkMethodVersion alan yoksa 1
   * okudugu icin v3 ve v4 denetimi "ayni yontem" sayiliyor, v4'un anilma/HATA
   * kurali yuzunden degisen skor (site degismeden 40 → 0) "kotulesti" ve
   * ai_citation_low "yeni cikan" gorunuyordu (panel, donem raporu CSV'si,
   * dondurulmus rapor).
   */
  it('AI olcumu yontem surumuyle kaydedilir; surumsuz eski denetimle kiyasi metodoloji_degisti olur', async () => {
    const t = servis(async () => [
      { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 0, probes: [] },
    ]);
    await t.svc.runAudit('s1');
    const yeni = t.kaydedilen();
    expect(yeni.checks.aiCitations.details).toEqual({ methodVersion: CITATION_MATCH_VERSION });

    // Ayni site, v3 ile yapilmis eski denetim: jenerik markada yalin kelime anilma sayiliyordu
    const aiDusuk = (yeni.issues as any[]).find((i) => i.type === 'ai_citation_low');
    expect(aiDusuk).toBeDefined();
    const eski = {
      id: 'eski', ranAt: new Date('2026-10-01'), overallScore: yeni.overallScore, geoScore: 50,
      checks: { ...yeni.checks, aiCitations: { id: 'ai_citations', score: 40, providers: [{ provider: 'openai', available: true, score: 40 }] } },
      issues: (yeni.issues as any[]).filter((i) => i.type !== 'ai_citation_low'),
    };
    const r = compareAuditRows(eski, { id: 'yeni', ranAt: new Date('2026-10-18'), ...yeni });
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 40, sonrakiScore: 0, delta: 0, durum: 'metodoloji_degisti' });
    expect(r.metodolojiDegisen).toContain('aiCitations');
    expect(r.issues.yeniCikan.map((i) => i.type)).not.toContain('ai_citation_low');
    expect(r.issues.devamEden.map((i) => i.type)).toContain('ai_citation_low');
  });
});

describe('aiCitationSkipFromError / FromResults', () => {
  it('kota (403) ham mesaj gecirmeden CITATION_QUOTA; bilinmeyen hata ERROR', () => {
    expect(aiCitationSkipFromError(new ForbiddenException('Aylık 300 AI Citation testi hakkın doldu (300/300). BYOK...'))).toEqual({
      code: 'CITATION_QUOTA',
      message: 'Aylık AI ölçüm kotası dolduğu için bu taramada AI ölçümü yapılmadı.',
      nextAvailableAt: null,
    });
    expect(aiCitationSkipFromError(new Error('ag koptu')).code).toBe('ERROR');
    expect(aiCitationSkipFromError(null).code).toBe('ERROR');
  });

  it('hic sonuc yok: NOT_RUN; asistanlar cevap verdi ama skor yok: NO_SCORE', () => {
    expect(aiCitationSkipFromResults([]).code).toBe('NOT_RUN');
    expect(aiCitationSkipFromResults([{ available: true, score: null }]).code).toBe('NO_SCORE');
  });
});
