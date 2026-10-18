import { describe, it, expect, vi } from 'vitest';
import { ReportsService, aiSaglayiciKapsamNotu, olcumYontemiNotu } from './reports.service.js';

/**
 * CSV tarama karsilastirmasi — panelin yontem/kapsam uyarilari disa aktarilan
 * raporda da yazar.
 *
 * NEDEN VAR: compareAuditRows (audit.service.ts) olcum yontemi degisen
 * kontrolun farkini 0 yazar ve sorunlarini cozulen/yeni saymaz
 * (metodoloji_degisti); olculen AI asistan kumesi degistiyse aiCitations
 * farkini yalniz ORTAK asistanlar uzerinden hesaplar (aiSaglayiciKapsami).
 * CSV bunlardan yalniz kontrol kimliklerini yaziyordu: aiCitations satirindaki
 * degerler ai_gorunurluk_skoru ile celisiyor, geo_skor_farki 0 "degisim yok"
 * gibi okunuyordu. Gercek overview → compareAuditRows → toCsv zinciri.
 */

function fakePrisma(lastAudit: any, auditsInRange: any[]) {
  const defaults: Record<string, (...a: any[]) => any> = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, aggregate: async () => ({ _avg: {}, _sum: {} }), groupBy: async () => [],
  };
  const models: Record<string, Record<string, (...a: any[]) => any>> = {
    audit: { findFirst: async () => lastAudit, findMany: async () => auditsInRange },
    site: { findUnique: async () => ({ name: 'Site', url: 'https://site.com' }) },
    kvStore: { findUnique: async () => null },
    socialPost: { findMany: async () => [], count: async () => 0 },
  };
  return new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, method: string) => vi.fn(models[model]?.[method] ?? defaults[method] ?? (async () => null)),
    }),
  });
}

const EYLUL = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const satir = (csv: string, anahtar: string) => csv.split('\n').find((l) => l.startsWith(`${anahtar},`));
const p = (provider: string, score: number | null, available = true) => ({ provider, available, score });
const denetim = (id: string, ranAt: string, checks: any, opts: { geoScore?: number | null; issues?: any[] } = {}) => ({
  id, ranAt: new Date(ranAt), overallScore: 70, geoScore: opts.geoScore ?? null, checks, issues: opts.issues ?? [],
});

async function csvFor(ilk: any, son: any) {
  const svc = new ReportsService(fakePrisma(son, [ilk, son]) as never);
  const r = await svc.overview('s1', EYLUL);
  return { r, csv: svc.toCsv(r) };
}

describe('CSV — ai_saglayici_kapsami (olculen asistan kumesi farkli)', () => {
  const ilk = denetim('a', '2026-09-02T00:00:00Z', {
    aiCitations: { score: 50, providers: [p('openai', 40), p('anthropic', 60)], details: { methodVersion: 4 } },
  }, { issues: [{ type: 'ai_citation_low', checkId: 'ai_citation' }] });
  const son = denetim('b', '2026-09-28T00:00:00Z', {
    aiCitations: { score: 35, providers: [p('openai', 40), p('anthropic', null, false), p('perplexity', 30)], details: { methodVersion: 4 } },
  });

  it('not satiri: hangi asistanin yalniz bir tarafta olculdugu, farkin ortak asistanlardan hesaplandigi', async () => {
    const { r, csv } = await csvFor(ilk, son);
    expect(r.audit.karsilastirma?.aiSaglayiciKapsami).toEqual({ ortak: ['openai'], yalnizOnceki: ['anthropic'], yalnizSonraki: ['perplexity'] });
    const not = satir(csv, 'ai_saglayici_kapsami');
    expect(not).toBe(
      'ai_saglayici_kapsami,AI görünürlük ölçümünde iki taramada ölçülebilen asistanlar farklı (yalnız ilk taramada ölçülen: Anthropic Claude; yalnız son taramada ölçülen: Perplexity). aiCitations farkı yalnız iki taramada da ölçülen asistanlar (OpenAI ChatGPT) üzerinden hesaplandı; satırdaki önceki/sonraki değerler bu asistanların ortalamasıdır. AI görünürlük sorunları çözülen/yeni sayılmadı.',
    );
    // Not, ayni CSV'deki satirla tutarli: ortak asistan ortalamasi 40 → 40
    expect(satir(csv, 'aiCitations')).toBe('aiCitations,40,40,0,ayni');
    // ai_citation_low cozulen sayilmadi (karsilastirmanin kendisi zaten boyle)
    expect(satir(csv, 'cozulen_sorun')).toBe('cozulen_sorun,0');
    // Yontem degismedi: yontem notu yok
    expect(satir(csv, 'olcum_yontemi_notu')).toBeUndefined();
  });

  it('birden cok asistan adi virgul icerir: hucre RFC 4180 ile tirnaklanir, tablo kaymaz', async () => {
    const a = denetim('e', '2026-09-02T00:00:00Z', {
      aiCitations: { score: 40, providers: [p('openai', 40), p('gemini', 40), p('xai', 10)], details: { methodVersion: 4 } },
    });
    const b = denetim('f', '2026-09-28T00:00:00Z', {
      aiCitations: { score: 45, providers: [p('openai', 50), p('gemini', 40)], details: { methodVersion: 4 } },
    });
    const { csv } = await csvFor(a, b);
    const not = satir(csv, 'ai_saglayici_kapsami')!;
    expect(not.startsWith('ai_saglayici_kapsami,"')).toBe(true);
    expect(not).toContain('asistanlar (Google Gemini, OpenAI ChatGPT) üzerinden');
    expect(not).toContain('yalnız ilk taramada ölçülen: xAI Grok');
    expect(satir(csv, 'aiCitations')).toBe('aiCitations,40,45,5,iyilesti');
  });

  it('ortak asistan yoksa: kiyas yapilmadigi yazilir (aiCitations satiri da yok)', async () => {
    const yalnizClaude = denetim('c', '2026-09-28T00:00:00Z', {
      aiCitations: { score: 60, providers: [p('openai', null, false), p('anthropic', 60)], details: { methodVersion: 4 } },
    });
    const yalnizChatgpt = denetim('d', '2026-09-02T00:00:00Z', {
      aiCitations: { score: 40, providers: [p('openai', 40)], details: { methodVersion: 4 } },
    });
    const { csv } = await csvFor(yalnizChatgpt, yalnizClaude);
    expect(satir(csv, 'ai_saglayici_kapsami')).toContain('İki taramada ortak ölçülen asistan olmadığı için AI görünürlük kıyaslanmadı.');
    expect(satir(csv, 'aiCitations')).toBeUndefined();
  });
});

describe('CSV — olcum_yontemi_notu (metodoloji_degisti)', () => {
  it('AI gorunurluk yontemi degisti: fark 0 ve sorunlar sayilmadi; genel skora girmedigi icin skor_farki uyarisi YOK', async () => {
    const ilk = denetim('a', '2026-09-02T00:00:00Z', { aiCitations: { score: 20, providers: [p('openai', 20)] } });
    const son = denetim('b', '2026-09-28T00:00:00Z', { aiCitations: { score: 45, providers: [p('openai', 45)], details: { methodVersion: 4 } } });
    const { csv } = await csvFor(ilk, son);
    // Eski satir aynen kalir (eklemeli degisiklik)
    expect(satir(csv, 'olcum_yontemi_degisen')).toBe('olcum_yontemi_degisen,aiCitations');
    expect(satir(csv, 'olcum_yontemi_notu')).toBe(
      'olcum_yontemi_notu,Ölçüm yöntemi iki tarama arasında güncellendi: aiCitations. Bu kontrollerin farkı 0 yazıldı (durum metodoloji_degisti) ve sorunları çözülen/yeni sayılmadı; skorlarındaki değişim siteden değil yöntemden kaynaklanabilir.',
    );
    expect(satir(csv, 'aiCitations')).toBe('aiCitations,20,45,0,metodoloji_degisti');
  });

  it('genel skora giren kontrol (image_alt) ve GEO yontemi degisti: skor_farki ve geo_skor_farki uyarilari', async () => {
    const ilk = denetim('a', '2026-09-02T00:00:00Z', { image_alt: { score: 40 }, geo: { score: 50 } }, { geoScore: 50 });
    const son = denetim('b', '2026-09-28T00:00:00Z', {
      image_alt: { score: 90, details: { methodVersion: 2 } }, geo: { score: 62, details: { methodVersion: 2 } },
    }, { geoScore: 62 });
    const { csv } = await csvFor(ilk, son);
    expect(satir(csv, 'geo_skor_farki')).toBe('geo_skor_farki,0');
    const not = satir(csv, 'olcum_yontemi_notu')!;
    expect(not).toContain('güncellendi: geo, image_alt.');
    expect(not).toContain('GEO skorları kıyaslanmadı (geo_skor_farki 0).');
    expect(not).toContain('image_alt genel skora girdiği için skor_farki değerinin bir kısmı da yöntem değişikliğinden kaynaklanabilir.');
    expect(not).not.toContain('geo genel skora');
  });

  it('yontem ve kapsam ayni: iki not satiri da yok', async () => {
    const ilk = denetim('a', '2026-09-02T00:00:00Z', { aiCitations: { score: 40, providers: [p('openai', 40)], details: { methodVersion: 4 } } });
    const son = denetim('b', '2026-09-28T00:00:00Z', { aiCitations: { score: 50, providers: [p('openai', 50)], details: { methodVersion: 4 } } });
    const { csv } = await csvFor(ilk, son);
    expect(satir(csv, 'olcum_yontemi_notu')).toBeUndefined();
    expect(satir(csv, 'ai_saglayici_kapsami')).toBeUndefined();
    expect(satir(csv, 'aiCitations')).toBe('aiCitations,40,50,10,iyilesti');
  });
});

describe('not yardimcilari — eski dondurulmus govde ve bozuk alan', () => {
  it('alan yoksa null (eski CSV ciktisi aynen)', () => {
    expect(olcumYontemiNotu(null)).toBeNull();
    expect(olcumYontemiNotu({})).toBeNull();
    expect(olcumYontemiNotu({ metodolojiDegisen: [] })).toBeNull();
    expect(aiSaglayiciKapsamNotu(undefined)).toBeNull();
    expect(aiSaglayiciKapsamNotu({})).toBeNull();
  });

  it('bilinmeyen asistan kimligi oldugu gibi; dize olmayan ogeler atlanir', () => {
    const not = aiSaglayiciKapsamNotu({ aiSaglayiciKapsami: { ortak: ['gemini', 5 as any], yalnizOnceki: ['yeni-asistan'], yalnizSonraki: [] } });
    expect(not).toContain('(yalnız ilk taramada ölçülen: yeni-asistan)');
    expect(not).toContain('asistanlar (Google Gemini) üzerinden');
  });
});
