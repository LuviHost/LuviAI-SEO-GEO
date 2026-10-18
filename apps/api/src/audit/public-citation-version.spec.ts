import { describe, it, expect, vi } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Public kontrol — olcum yontemi surumu (CITATION_MATCH_VERSION).
 *
 * NEDEN VAR: sonuc JSON'unda yontem surumu yoktu; abone retest'i v3 tabanla v4
 * olcumu kiyasliyordu. v4 alan adindan turetilmis jenerik markada yalin
 * kelimeyi anilma saymadigi icin ilk v4 retest'i sahte "dusus" gosterebilirdi.
 * Yeni sonuc surumu tasir; farkli (ya da alansiz = v3 ve oncesi) surumlu iki
 * kayit karsilastirilmaz.
 */

const getirici = vi.hoisted(() => ({ html: '' }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string): Promise<SafeTextResult> => ({
      status: 200, ok: true, url, redirected: false, contentType: 'text/html',
      headers: { 'content-type': 'text/html' }, text: getirici.html, truncated: false, binary: false,
    })),
  };
});

import {
  LEGACY_PUBLIC_MATCH_VERSION,
  PublicCitationService,
  publicResultMatchVersion,
} from './public-citation.service.js';
import { CITATION_MATCH_VERSION } from './host-match.js';

const GUN = 24 * 60 * 60 * 1000;

function kayit(id: string, gunOnce: number, citedCount: number, matchVersion?: number) {
  return {
    id,
    createdAt: new Date(Date.now() - gunOnce * GUN),
    source: 'manual',
    brand: 'Kobipratik',
    result: {
      ...(matchVersion === undefined ? {} : { matchVersion }),
      queries: [{ query: 'en iyi kredi karsilastirma siteleri', citedCount, totalProviders: 7, brandInQuery: false }],
    },
  };
}

function servis(history: any[] = []) {
  const prisma = {
    publicCitationCheck: {
      findMany: vi.fn(async (args: any) => {
        if (args?.distinct) return []; // IP hakki: bos
        if (args?.select?.brand) return history; // getHistory
        return []; // onbellek yok
      }),
      create: vi.fn(async () => ({ id: 'kontrol-1' })),
    },
  };
  const ai = {
    runPublicProbes: vi.fn(async ({ queries }: { queries: string[] }) => [{
      provider: 'openai', label: 'OpenAI ChatGPT', available: true, cost: 0,
      probes: queries.map((query) => ({ query, cited: false, brandMentioned: true, brandInQuery: false, excerpt: 'Kobipratik one cikiyor.' })),
    }]),
    publicAggregate: vi.fn(() => ({ shareOfVoice: [] })),
    classifyRealCompetitors: vi.fn(async () => new Set<string>()),
  };
  const niche = { detectFromUrl: vi.fn(async () => ({ niche: 'diğer', queries: [] })) };
  const svc = new PublicCitationService(prisma as never, ai as never, niche as never);
  svc.urlResolver = async () => undefined;
  return { svc, prisma };
}

describe('publicResultMatchVersion', () => {
  it('alan yoksa v3 ve oncesi sayilir; gecerli sayi aynen okunur', () => {
    expect(LEGACY_PUBLIC_MATCH_VERSION).toBe(3);
    expect(publicResultMatchVersion({ queries: [] })).toBe(3);
    expect(publicResultMatchVersion(null)).toBe(3);
    expect(publicResultMatchVersion({ matchVersion: '4' })).toBe(3);
    expect(publicResultMatchVersion({ matchVersion: 4 })).toBe(4);
  });
});

describe('check() — yeni sonuc yontem surumunu tasir', () => {
  it('cevapta ve DB kaydinin JSON alaninda matchVersion = CITATION_MATCH_VERSION', async () => {
    getirici.html = '<html><head><meta property="og:site_name" content="Kobipratik"></head></html>';
    const t = servis();
    const r = await t.svc.check('kobipratik.com', '1.2.3.4');
    expect(CITATION_MATCH_VERSION).toBe(4);
    expect(r.matchVersion).toBe(CITATION_MATCH_VERSION);
    const yazilan = (t.prisma.publicCitationCheck.create.mock.calls[0] as any[])[0].data.result;
    expect(yazilan.matchVersion).toBe(CITATION_MATCH_VERSION);
  });
});

describe('getHistory — satir yontem surumunu tasir', () => {
  it('damgali kayit kendi surumu, damgasiz eski kayit v3', async () => {
    const t = servis([kayit('yeni', 0, 2, 4), kayit('eski', 20, 5)]);
    const [yeni, eski] = await t.svc.getHistory('kobipratik.com');
    expect(yeni).toMatchObject({ id: 'yeni', matchVersion: 4, totalCitedScore: 2 });
    expect(eski).toMatchObject({ id: 'eski', matchVersion: 3, totalCitedScore: 5 });
  });
});

describe('compareWithPast — farkli yontem karsilastirilmaz', () => {
  it('v3 (alansiz) taban → v4 retest: methodChanged, fark hesaplanmaz', async () => {
    const t = servis([kayit('retest', 0, 1, 4), kayit('taban', 16, 5)]);
    const cmp = await t.svc.compareWithPast('kobipratik.com', 15);
    expect(cmp.methodChanged).toBe(true);
    expect(cmp.delta).toBe(0);
    expect(cmp.deltaPct).toBe(0);
    // Sayilar bilgi icin durur ama karsilastirilmaz
    expect(cmp.current).toMatchObject({ totalCited: 1, matchVersion: 4 });
    expect(cmp.past).toMatchObject({ totalCited: 5, matchVersion: 3 });
  });

  it('v4 → v4: eski mantik aynen (delta ve yuzde)', async () => {
    const t = servis([kayit('retest', 0, 1, 4), kayit('taban', 16, 5, 4)]);
    const cmp = await t.svc.compareWithPast('kobipratik.com', 15);
    expect(cmp).toMatchObject({ methodChanged: false, delta: -4, deltaPct: -80 });
    expect(cmp.past?.totalCited).toBe(5);
  });

  it('iki alansiz eski kayit (v3 → v3): eskisi gibi karsilastirilir', async () => {
    const t = servis([kayit('b', 0, 6), kayit('a', 16, 3)]);
    const cmp = await t.svc.compareWithPast('kobipratik.com', 15);
    expect(cmp).toMatchObject({ methodChanged: false, delta: 3, deltaPct: 100 });
  });

  it('taban zaman penceresinden secilir: yontemi farkli en yakin kayit = methodChanged', async () => {
    // 20 gun once v4 bir kayit olsa da hedefe (15 gun) en yakin onceki kayit 16 gun onceki v3
    const t = servis([kayit('retest', 0, 2, 4), kayit('taban', 16, 2), kayit('daha-eski', 20, 2, 4)]);
    const cmp = await t.svc.compareWithPast('kobipratik.com', 15);
    expect(cmp.methodChanged).toBe(true);
    expect(cmp.past?.createdAt.getTime()).toBeLessThan(Date.now() - 15 * GUN);
  });

  it('gecmis yoksa: delta 0, methodChanged false', async () => {
    const t = servis([]);
    expect(await t.svc.compareWithPast('kobipratik.com', 15)).toEqual({ delta: 0, deltaPct: 0, methodChanged: false });
  });
});
