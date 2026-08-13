import { describe, it, expect } from 'vitest';
import { AuditService, issueKey } from './audit.service.js';

/**
 * Audit delta raporu — compareAudits'in saf mantigi.
 *
 * NEDEN: Her tarama ayri satir olarak yaziliyor ve prod'da gercek seriler var
 * (bir sitede 85 -> 99, baskasinda 64 -> 86), ama iki tarama arasindaki fark
 * hicbir yerde hesaplanmiyordu. Buradaki testler o hesabin sekli bir daha
 * kaymasin diye: issue eslesmesi `type + page` uzerinden yurur (issue'larin
 * kalici id'si yok), tek tarama durumu HATA ATMAZ, ve yeni/kaybolan
 * kontroller sahte delta uretmez.
 */

/** Prisma sahtesi — yalnizca compareAudits/getHistory'nin dokundugu uclar. */
function svc(rows: any[]) {
  // rows: en yeni ONCE (ranAt desc) sirali varsayilir
  const prisma = {
    audit: {
      findMany: async ({ take, where }: any = {}) => {
        let liste = rows;
        if (where?.ranAt?.lt) liste = liste.filter((r) => r.ranAt < where.ranAt.lt);
        return typeof take === 'number' ? liste.slice(0, take) : liste;
      },
      findFirst: async ({ where }: any = {}) => {
        let liste = rows;
        if (where?.id) liste = liste.filter((r) => r.id === where.id);
        if (where?.ranAt?.lt) liste = liste.filter((r) => r.ranAt < where.ranAt.lt);
        return liste[0] ?? null;
      },
    },
  };
  return new AuditService(
    prisma as never, null as never, null as never,
    null as never, null as never, null as never,
  );
}

function tarama(over: Partial<any> = {}) {
  return {
    id: 'a1',
    siteId: 's1',
    ranAt: new Date('2026-01-01T00:00:00Z'),
    overallScore: 64,
    geoScore: 40,
    durationMs: 1000,
    checks: {},
    issues: [],
    ...over,
  };
}

describe('compareAudits — skor deltasi', () => {
  it('parametresiz cagirinca son IKI taramayi karsilastirir (from=onceki, to=son)', async () => {
    const s = svc([
      tarama({ id: 'yeni', ranAt: new Date('2026-02-01'), overallScore: 86, geoScore: 71 }),
      tarama({ id: 'eski', ranAt: new Date('2026-01-01'), overallScore: 64, geoScore: 40 }),
    ]);

    const r = await s.compareAudits('s1');

    expect(r.from?.id).toBe('eski');
    expect(r.to?.id).toBe('yeni');
    expect(r.scoreDelta).toBe(22);
    expect(r.geoScoreDelta).toBe(31);
    expect(r.yeterliVeriYok).toBeUndefined();
  });

  it('skor dususu negatif delta verir', async () => {
    const s = svc([
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), overallScore: 50 }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), overallScore: 80 }),
    ]);

    const r = await s.compareAudits('s1');
    expect(r.scoreDelta).toBe(-30);
  });

  it('geoScore taraflardan birinde null ise geoScoreDelta 0 kalir', async () => {
    const s = svc([
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), overallScore: 70, geoScore: 55 }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), overallScore: 60, geoScore: null }),
    ]);

    const r = await s.compareAudits('s1');
    expect(r.scoreDelta).toBe(10);
    // null'i 0 sayip "+55" gostermek yalan trend uretirdi
    expect(r.geoScoreDelta).toBe(0);
  });
});

describe('compareAudits — tek tarama durumu', () => {
  it('tek tarama varsa hata atmaz, yeterliVeriYok:true ve to=son tarama doner', async () => {
    const s = svc([tarama({ id: 'tek', overallScore: 72 })]);

    const r = await s.compareAudits('s1');

    expect(r.yeterliVeriYok).toBe(true);
    expect(r.from).toBeNull();
    expect(r.to?.id).toBe('tek');
    expect(r.scoreDelta).toBe(0);
    expect(r.checks).toEqual([]);
    expect(r.ozet).toEqual({ cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0 });
  });

  it('hic tarama yoksa da hata atmaz', async () => {
    const r = await svc([]).compareAudits('s1');
    expect(r.yeterliVeriYok).toBe(true);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });
});

describe('compareAudits — issue eslestirme (type + page)', () => {
  const eski = tarama({
    id: 'eski',
    ranAt: new Date('2026-01-01'),
    overallScore: 60,
    issues: [
      { type: 'meta_title_missing', page: '/a', description: 'Title yok', severity: 'critical' },
      { type: 'meta_title_missing', page: '/b', description: 'Title yok', severity: 'critical' },
      { type: 'no_https', page: '/', description: 'HTTPS yok', severity: 'critical' },
    ],
  });
  const yeni = tarama({
    id: 'yeni',
    ranAt: new Date('2026-02-01'),
    overallScore: 80,
    issues: [
      // /a cozuldu, /b duruyor
      { type: 'meta_title_missing', page: '/b', description: 'Title yok', severity: 'critical' },
      { type: 'no_https', page: '/', description: 'HTTPS yok', severity: 'critical' },
      { type: 'h1_missing', page: '/c', description: 'H1 yok', severity: 'critical' },
    ],
  });

  it('cozulen / yeni cikan / devam eden dogru ayrisir', async () => {
    const r = await svc([yeni, eski]).compareAudits('s1');

    expect(r.ozet).toEqual({ cozulenSayisi: 1, yeniSayisi: 1, devamEdenSayisi: 2 });
    expect(r.issues.cozulen[0].page).toBe('/a');
    expect(r.issues.yeniCikan[0].type).toBe('h1_missing');
    expect(r.issues.devamEden.map((i) => i.type).sort()).toEqual([
      'meta_title_missing', 'no_https',
    ]);
  });

  it('ayni type farkli sayfada AYRI sorun sayilir', async () => {
    const r = await svc([
      tarama({
        id: 'b', ranAt: new Date('2026-02-01'),
        issues: [{ type: 'meta_desc_missing', page: '/x', description: 'yok' }],
      }),
      tarama({
        id: 'a', ranAt: new Date('2026-01-01'),
        issues: [{ type: 'meta_desc_missing', page: '/y', description: 'yok' }],
      }),
    ]).compareAudits('s1');

    // page ayrimi yapilmasaydi ikisi eslesip "devam eden" gorunurdu
    expect(r.ozet).toEqual({ cozulenSayisi: 1, yeniSayisi: 1, devamEdenSayisi: 0 });
  });

  it('type/page yoksa description ilk 80 karaktere duser — kuyruktaki degisen sayi sorunu bolmez', () => {
    const ortak = 'PageSpeed onerisi: kullanilmayan JavaScript kaldirilmali, bu ciddi bir kazanim saglar';
    const a = { description: `${ortak} — 2.4s tasarruf` };
    const b = { description: `${ortak} — 3.1s tasarruf` };

    expect(issueKey(a)).toBe(issueKey(b));
    expect(issueKey(a).startsWith('desc:')).toBe(true);
  });

  it('type varken page yoksa da anahtar uretilir ve description a dusmez', () => {
    expect(issueKey({ type: 'ai_citation_low', description: 'x' })).toBe('ai_citation_low|');
  });
});

describe('compareAudits — check durum siniflandirmasi', () => {
  it('iyilesti / kotulesti / ayni / yeni / kayboldu dogru atanir', async () => {
    const r = await svc([
      tarama({
        id: 'b', ranAt: new Date('2026-02-01'), overallScore: 80,
        checks: {
          sitemap_xml: { id: 'sitemap_xml', score: 100 },
          meta_title: { id: 'meta_title', score: 40 },
          robots_txt: { id: 'robots_txt', score: 70 },
          aiCitations: { id: 'aiCitations', score: 25 },
        },
      }),
      tarama({
        id: 'a', ranAt: new Date('2026-01-01'), overallScore: 60,
        checks: {
          sitemap_xml: { id: 'sitemap_xml', score: 60 },
          meta_title: { id: 'meta_title', score: 90 },
          robots_txt: { id: 'robots_txt', score: 70 },
          llms_txt: { id: 'llms_txt', score: 30 },
        },
      }),
    ]).compareAudits('s1');

    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));

    expect(byId.sitemap_xml).toMatchObject({ oncekiScore: 60, sonrakiScore: 100, delta: 40, durum: 'iyilesti' });
    expect(byId.meta_title).toMatchObject({ delta: -50, durum: 'kotulesti' });
    expect(byId.robots_txt).toMatchObject({ delta: 0, durum: 'ayni' });
    expect(byId.aiCitations).toMatchObject({ oncekiScore: null, sonrakiScore: 25, durum: 'yeni' });
    expect(byId.llms_txt).toMatchObject({ oncekiScore: 30, sonrakiScore: null, durum: 'kayboldu' });
  });

  it('yeni/kayboldu kontrollerde delta 0 kalir — sahte sicrama uretmez', async () => {
    const r = await svc([
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), checks: { yeni_check: { score: 95 } } }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), checks: {} }),
    ]).compareAudits('s1');

    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]).toMatchObject({ id: 'yeni_check', delta: 0, durum: 'yeni' });
  });

  it('skoru olmayan girdiler (pagespeed null) listeye hic girmez', async () => {
    const r = await svc([
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), checks: { pagespeed: null, geo: { score: 50 } } }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), checks: { pagespeed: null, geo: { score: 50 } } }),
    ]).compareAudits('s1');

    expect(r.checks.map((c) => c.id)).toEqual(['geo']);
  });

  it('checks mutlak deltaya gore siralanir — en cok degisen basta', async () => {
    const r = await svc([
      tarama({
        id: 'b', ranAt: new Date('2026-02-01'),
        checks: { az: { score: 55 }, cok: { score: 100 }, orta: { score: 70 } },
      }),
      tarama({
        id: 'a', ranAt: new Date('2026-01-01'),
        checks: { az: { score: 50 }, cok: { score: 10 }, orta: { score: 50 } },
      }),
    ]).compareAudits('s1');

    expect(r.checks.map((c) => c.id)).toEqual(['cok', 'orta', 'az']);
  });
});

describe('compareAudits — acik id ile', () => {
  it('toId verilince from otomatik olarak ondan ONCEKI tarama olur', async () => {
    const s = svc([
      tarama({ id: 'c', ranAt: new Date('2026-03-01'), overallScore: 99 }),
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), overallScore: 86 }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), overallScore: 64 }),
    ]);

    const r = await s.compareAudits('s1', { toId: 'b' });

    expect(r.to?.id).toBe('b');
    expect(r.from?.id).toBe('a');
    expect(r.scoreDelta).toBe(22);
  });

  it('fromId + toId birlikte verilince tam o ikisi karsilastirilir', async () => {
    const s = svc([
      tarama({ id: 'c', ranAt: new Date('2026-03-01'), overallScore: 99 }),
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), overallScore: 86 }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), overallScore: 64 }),
    ]);

    const r = await s.compareAudits('s1', { fromId: 'a', toId: 'c' });

    expect(r.from?.id).toBe('a');
    expect(r.to?.id).toBe('c');
    expect(r.scoreDelta).toBe(35);
  });
});

describe('getHistory', () => {
  it('issueCount issues dizisinin uzunlugundan gelir, limit uygulanir', async () => {
    const s = svc([
      tarama({ id: 'c', ranAt: new Date('2026-03-01'), issues: [{ type: 'x' }, { type: 'y' }] }),
      tarama({ id: 'b', ranAt: new Date('2026-02-01'), issues: [] }),
      tarama({ id: 'a', ranAt: new Date('2026-01-01'), issues: null }),
    ]);

    const hepsi = await s.getHistory('s1');
    expect(hepsi.map((h) => h.issueCount)).toEqual([2, 0, 0]);

    const ikisi = await s.getHistory('s1', 2);
    expect(ikisi.map((h) => h.id)).toEqual(['c', 'b']);
  });
});
