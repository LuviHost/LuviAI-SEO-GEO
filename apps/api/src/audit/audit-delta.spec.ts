import { describe, it, expect } from 'vitest';
import { AuditService, aiCitationsOlculdu, compareAuditRows, issueKey } from './audit.service.js';

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
  // Delta mantigi yalnizca prisma kullaniyor; kalan bagimliliklar (crawler,
  // checks, pagespeed, geo, aiCitation, jobQueue) bu testte cagrilmiyor.
  return new AuditService(
    prisma as never, null as never, null as never,
    null as never, null as never, null as never, null as never,
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
    expect(r.ozet).toEqual({ cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0, olculemeyenSayisi: 0 });
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

    expect(r.ozet).toEqual({ cozulenSayisi: 1, yeniSayisi: 1, devamEdenSayisi: 2, olculemeyenSayisi: 0 });
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
    expect(r.ozet).toEqual({ cozulenSayisi: 1, yeniSayisi: 1, devamEdenSayisi: 0, olculemeyenSayisi: 0 });
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

describe('compareAudits — olcum yontemi degisimi', () => {
  it('methodVersion farkli kontrol "metodoloji_degisti" olur, delta 0; sorunlari cozulen/yeni sayilmaz', async () => {
    const s = svc([
      tarama({
        id: 'yeni', ranAt: new Date('2026-02-01'),
        checks: { image_alt: { score: 100, details: { methodVersion: 2 } }, meta_title: { score: 80 } },
        issues: [{ type: 'image_alt_suspicious', checkId: 'image_alt' }],
      }),
      tarama({
        id: 'eski', ranAt: new Date('2026-01-01'),
        checks: { image_alt: { score: 40, details: {} }, meta_title: { score: 60 } },
        issues: [{ type: 'image_alt_low', checkId: 'image_alt' }],
      }),
    ]);
    const r = await s.compareAudits('s1');
    const alt = r.checks.find((c) => c.id === 'image_alt')!;
    expect(alt.durum).toBe('metodoloji_degisti');
    expect(alt.delta).toBe(0);
    expect(r.checks.find((c) => c.id === 'meta_title')!.durum).toBe('iyilesti');
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden.map((i) => i.type)).toEqual(['image_alt_suspicious']);
    expect(r.metodolojiDegisen).toEqual(['image_alt']);
  });
});

/**
 * F5 — olculemeyen kontrolun sorunu "Cozulen" DEGILDIR.
 *
 * NEDEN: compareAuditRows onceki taramadaki her sorunu, son taramada yoksa
 * cozulmus sayiyordu. Ama son tarama bazi seyleri hic OLCMEMIS olabilir:
 * llms.txt 403 (dogrulanamadi), GEO orneklemi bot korumasina takildi, AI
 * adimi haftalik hak yuzunden atlandi, tarama 429 ile erken durdu. Rapor
 * bunlari "donem icinde gercekten cozulen sorun" diye yaziyordu.
 */
describe('compareAuditRows — olculemeyen kontrol (F5)', () => {
  const onceki = (over: Partial<any> = {}) => tarama({ id: 'eski', ranAt: new Date('2026-10-01'), ...over });
  const sonraki = (over: Partial<any> = {}) => tarama({ id: 'yeni', ranAt: new Date('2026-10-18'), ...over });
  const llmsYok = { type: 'llms_missing', checkId: 'llms_txt', severity: 'warning', description: 'llms.txt yok' };
  const unverified = { score: 0, details: { unverified: true, unverifiedReason: 'llms.txt doğrulanamadı: HTTP 403' } };

  it('llms_missing → llms dogrulanamadi: cozulen BOS, olculemedi = [llms_missing]', () => {
    const r = compareAuditRows(
      onceki({ checks: { llms_txt: { score: 30 } }, issues: [llmsYok] }),
      sonraki({
        checks: { llms_txt: unverified },
        issues: [{ type: 'llms_txt_unverified', checkId: 'crawl_access', severity: 'info', description: 'llms.txt doğrulanamadı' }],
      }),
    );
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.olculemedi).toEqual([llmsYok]);
    expect(r.ozet).toEqual({ cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0, olculemeyenSayisi: 1 });
    // Kapsam notu (crawl_access) "yeni cikan sorun" degildir
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.kismi).toMatchObject({ olculemeyenKontroller: ['llms_txt'], skorKapsamiFarkli: ['llms_txt'], sayfaKapsami: null });
  });

  it('GEO orneklemi engellendi: geo_* sorunlari olculemedi, cozulen degil', () => {
    const faq = { type: 'faq_missing', checkId: 'geo_faq', severity: 'warning' };
    const r = compareAuditRows(
      onceki({ geoScore: 40, checks: { geo: { score: 40, details: { methodVersion: 2 } } }, issues: [faq] }),
      sonraki({ geoScore: null, checks: { geo: { score: null, methods: [], blocked: { kind: 'challenge', reason: 'x' }, details: { methodVersion: 2 } } }, issues: [] }),
    );
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.olculemedi.map((i) => i.type)).toEqual(['faq_missing']);
    expect(r.geoScoreDelta).toBe(0);
    expect(r.kismi?.olculemeyenKontroller).toEqual(['geo']);
  });

  it('PageSpeed bu kez olculemedi (null): eski pagespeed_* onerileri cozulmus sayilmaz', () => {
    const ps = { type: 'pagespeed_unused-javascript', checkId: 'pagespeed', description: 'JS kaldir — 1.2s' };
    const r = compareAuditRows(
      onceki({ checks: { pagespeed: { performanceScore: 40, opportunities: [] } }, issues: [ps] }),
      sonraki({ checks: { pagespeed: null }, issues: [] }),
    );
    expect(r.issues.olculemedi).toEqual([ps]);
    expect(r.kismi?.olculemeyenKontroller).toEqual(['pagespeed']);
  });

  it('ters yon: onceki taramada dogrulanamayan kontrolun sorunu "yeni cikan" degil, mevcut durum', () => {
    const r = compareAuditRows(
      onceki({ checks: { llms_txt: unverified }, issues: [] }),
      sonraki({ checks: { llms_txt: { score: 30 } }, issues: [llmsYok] }),
    );
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden).toEqual([llmsYok]);
    expect(r.issues.olculemedi).toEqual([]);
    // Son taramada olculemeyen kontrol yok — yalniz genel skor kapsami farkli
    expect(r.kismi).toMatchObject({ olculemeyenKontroller: [], skorKapsamiFarkli: ['llms_txt'] });
  });

  it('son taramada girdisi hic olmayan kontrolun sorunu olculemedi ve nedeni listede', () => {
    const eskiKontrol = { type: 'x_missing', checkId: 'kaldirilan_kontrol' };
    const r = compareAuditRows(
      onceki({ checks: {}, issues: [eskiKontrol] }),
      sonraki({ checks: {}, issues: [] }),
    );
    expect(r.issues.olculemedi).toEqual([eskiKontrol]);
    expect(r.kismi?.olculemeyenKontroller).toEqual(['kaldirilan_kontrol']);
  });

  it('gercekten olculup kaybolan sorun hala COZULEN; tam karsilastirmada kismi alani yok', () => {
    const r = compareAuditRows(
      onceki({ checks: { llms_txt: { score: 30 } }, issues: [llmsYok] }),
      sonraki({ checks: { llms_txt: { score: 100 } }, issues: [] }),
    );
    expect(r.issues.cozulen).toEqual([llmsYok]);
    expect(r.issues.olculemedi).toEqual([]);
    expect(r.kismi).toBeUndefined();
  });

  it('tarama bot korumasi yuzunden erken durdu: sayfa kontrolu sorunu olculemedi, site geneli sorun cozulebilir', () => {
    const baslik = { type: 'meta_title_missing', checkId: 'meta_title', page: 'https://x.com/sayfa-60' };
    const https = { type: 'no_https', checkId: 'https' };
    const r = compareAuditRows(
      onceki({ checks: { meta_title: { score: 70 }, https: { score: 0 } }, issues: [baslik, https] }),
      sonraki({
        checks: {
          meta_title: { score: 90 }, https: { score: 100 },
          crawlCoverage: { blockedCount: 1, blockedPages: [{ url: 'https://x.com/b' }], stoppedEarly: 'HTTP 429' },
        },
        issues: [],
      }),
    );
    expect(r.issues.olculemedi).toEqual([baslik]);
    expect(r.issues.cozulen).toEqual([https]);
    expect(r.kismi?.sayfaKapsami).toEqual({ erkenDurdu: true, engellenenSayfa: 1 });
  });

  it('yeni engellenen sayfa varsa sayfa kontrolu sorunlari olculemedi', () => {
    const og = { type: 'og_low_coverage', checkId: 'open_graph' };
    const r = compareAuditRows(
      onceki({ checks: { open_graph: { score: 50 } }, issues: [og] }),
      sonraki({ checks: { open_graph: { score: 90 }, crawlCoverage: { blockedCount: 2, blockedPages: [{ url: 'https://x.com/a' }, { url: 'https://x.com/b' }], stoppedEarly: null } }, issues: [] }),
    );
    expect(r.issues.olculemedi).toEqual([og]);
    expect(r.kismi?.sayfaKapsami).toEqual({ erkenDurdu: false, engellenenSayfa: 2 });
  });

  it('AYNI sayfalar iki taramada da engelliyse kapsam ayni: sayfa kontrolu sorunu cozulebilir (kalici engel susturmaz)', () => {
    const og = { type: 'og_low_coverage', checkId: 'open_graph' };
    const kapsam = { blockedCount: 1, blockedPages: [{ url: 'https://x.com/wp-admin' }], stoppedEarly: null };
    const r = compareAuditRows(
      onceki({ checks: { open_graph: { score: 50 }, crawlCoverage: kapsam }, issues: [og] }),
      sonraki({ checks: { open_graph: { score: 90 }, crawlCoverage: kapsam }, issues: [] }),
    );
    expect(r.issues.cozulen).toEqual([og]);
    expect(r.kismi).toBeUndefined();
  });

  it('onceki tarama erken durduysa sonraki taramada gorulen sayfa sorunu "yeni cikan" sayilmaz', () => {
    const h1 = { type: 'h1_missing', checkId: 'h1_uniqueness' };
    const r = compareAuditRows(
      onceki({ checks: { h1_uniqueness: { score: 100 }, crawlCoverage: { blockedCount: 1, blockedPages: [{ url: 'https://x.com/a' }], stoppedEarly: 'WAF' } }, issues: [] }),
      sonraki({ checks: { h1_uniqueness: { score: 80 } }, issues: [h1] }),
    );
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden).toEqual([h1]);
  });
});

/**
 * F6 — atlanan AI olcumu 0 DEGIL. Haftalik olcum hakki kullanildiktan sonra
 * baslatilan her denetim AI adimini atliyor; eskiden `score: 0` yaziliyor ve
 * karsilastirma "aiCitations 20 → 0 (−20)" + ai_citation_low "cozuldu" diyordu.
 */
describe('compareAuditRows — atlanan AI olcumu (F6)', () => {
  const olculmus = { id: 'ai_citations', score: 20, providers: [{ provider: 'openai', available: true, score: 20 }] };
  const aiDusuk = { type: 'ai_citation_low', checkId: 'ai_citation', severity: 'warning' };

  it('yeni kayit (score null + skipped): durum kayboldu (dusus yok), ai_citation_low olculemedi', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-13'), checks: { aiCitations: olculmus }, issues: [aiDusuk] }),
      tarama({
        id: 'b', ranAt: new Date('2026-10-15'),
        checks: { aiCitations: { id: 'ai_citations', score: null, providers: [], skipped: { code: 'WEEKLY_MEASUREMENT_LIMIT', message: 'x', nextAvailableAt: '2026-10-20T08:00:00.000Z' } } },
        issues: [],
      }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 20, sonrakiScore: null, delta: 0, durum: 'kayboldu' });
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.olculemedi).toEqual([aiDusuk]);
    expect(r.kismi?.olculemeyenKontroller).toEqual(['aiCitations']);
  });

  it('ESKI kayit (score 0, providers []) okuma tarafinda da olcum sayilmaz', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), checks: { aiCitations: olculmus }, issues: [aiDusuk] }),
      tarama({ id: 'b', ranAt: new Date('2026-10-05'), checks: { aiCitations: { score: 0, providers: [] } }, issues: [] }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ sonrakiScore: null, durum: 'kayboldu' });
    expect(r.issues.olculemedi).toEqual([aiDusuk]);
  });

  it('hicbir saglayici available degilken yazilan skor da olcum degil', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), checks: { aiCitations: { score: 0, providers: [{ provider: 'openai', available: false, score: null }] } } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-05'), checks: { aiCitations: olculmus }, issues: [aiDusuk] }),
    );
    // Onceki taraf olculmedi: sonraki sorun "yeni cikan" degil, mevcut durum
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: null, sonrakiScore: 20, durum: 'yeni' });
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden).toEqual([aiDusuk]);
  });

  it('gercekten olculup 0 cikan AI skoru korunur (olcum sayilir)', () => {
    const sifir = { score: 0, providers: [{ provider: 'openai', available: true, score: 0 }] };
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), checks: { aiCitations: olculmus } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-05'), checks: { aiCitations: sifir } }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 20, sonrakiScore: 0, delta: -20, durum: 'kotulesti' });
  });
});

/**
 * G6 — aiCitations bir asistan ORTALAMASI. Ayni yontemle olculmus iki
 * denetimde olculen asistan kumesi farkliysa (biri 429/kota yuzunden
 * olculemedi) ham fark bilesimden gelir: Claude 80 + ChatGPT 0 iken Claude
 * olculemeyince 40 → 0 "kotulesti" ve ai_citation_low "yeni cikan" diyordu.
 */
describe('compareAuditRows — AI olcumunde asistan kapsami (G6)', () => {
  const v4 = (providers: any[], score: number) => ({ id: 'ai_citations', score, providers, details: { methodVersion: 4 } });
  const olc = (provider: string, score: number) => ({ provider, available: true, score });
  const yok = (provider: string) => ({ provider, available: false, score: null });
  const aiDusuk = { type: 'ai_citation_low', checkId: 'ai_citation', severity: 'warning' };

  it('kume farkli: fark yalniz iki denetimde de olculen asistanlardan; ai_citation_low yeni/cozulen sayilmaz', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-10'), checks: { aiCitations: v4([olc('openai', 0), olc('anthropic', 80)], 40) }, issues: [] }),
      tarama({ id: 'b', ranAt: new Date('2026-10-17'), checks: { aiCitations: v4([olc('openai', 0), yok('anthropic')], 0) }, issues: [aiDusuk] }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 0, sonrakiScore: 0, delta: 0, durum: 'ayni' });
    expect(r.aiSaglayiciKapsami).toEqual({ ortak: ['openai'], yalnizOnceki: ['anthropic'], yalnizSonraki: [] });
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden).toEqual([aiDusuk]);
    // Yontem degismedi: panelde "yontem guncellendi" notu cikmamali
    expect(r.metodolojiDegisen).toBeUndefined();
  });

  it('ortak asistanlarda gercek degisim korunur', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-10'), checks: { aiCitations: v4([olc('openai', 20), olc('gemini', 40)], 30) } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-17'), checks: { aiCitations: v4([olc('openai', 60), yok('gemini'), olc('xai', 0)], 30) } }),
    );
    // Ham skorlar 30 → 30 "ayni" derdi; ortak tek asistan (openai) 20 → 60
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 20, sonrakiScore: 60, delta: 40, durum: 'iyilesti' });
    expect(r.aiSaglayiciKapsami).toEqual({ ortak: ['openai'], yalnizOnceki: ['gemini'], yalnizSonraki: ['xai'] });
  });

  it('ortak asistan yoksa aiCitations satiri uretilmez (kiyaslanacak bir sey yok)', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-10'), checks: { aiCitations: v4([olc('openai', 40), yok('gemini')], 40) }, issues: [aiDusuk] }),
      tarama({ id: 'b', ranAt: new Date('2026-10-17'), checks: { aiCitations: v4([yok('openai'), olc('gemini', 10)], 10) }, issues: [aiDusuk] }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toBeUndefined();
    expect(r.aiSaglayiciKapsami?.ortak).toEqual([]);
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.devamEden).toEqual([aiDusuk]);
  });

  it('kume ayniysa alan yok, fark ham skorlardan', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-10'), checks: { aiCitations: v4([olc('openai', 40), yok('meta')], 40) } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-17'), checks: { aiCitations: v4([olc('openai', 10), yok('meta')], 10) } }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ oncekiScore: 40, sonrakiScore: 10, delta: -30, durum: 'kotulesti' });
    expect(r).not.toHaveProperty('aiSaglayiciKapsami');
  });

  it('surumsuz eski kayit ile v4 kaydi: kapsamdan once yontem farki — metodoloji_degisti', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), checks: { aiCitations: { score: 40, providers: [olc('openai', 40)] } } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-17'), checks: { aiCitations: v4([olc('openai', 0), olc('gemini', 0)], 0) }, issues: [aiDusuk] }),
    );
    expect(r.checks.find((c) => c.id === 'aiCitations')).toMatchObject({ delta: 0, durum: 'metodoloji_degisti' });
    expect(r.metodolojiDegisen).toEqual(['aiCitations']);
    expect(r.issues.yeniCikan).toEqual([]);
  });
});

describe('aiCitationsOlculdu', () => {
  it('atlama isareti, skor yoklugu ve olcumsuz saglayici listesi olcum degildir', () => {
    expect(aiCitationsOlculdu(null)).toBe(false);
    expect(aiCitationsOlculdu({ score: null, providers: [] })).toBe(false);
    expect(aiCitationsOlculdu({ score: 0, providers: [] })).toBe(false);
    expect(aiCitationsOlculdu({ score: 40, providers: [{ available: true, score: 40 }], skipped: { code: 'X' } })).toBe(false);
    expect(aiCitationsOlculdu({ score: 30, providers: [{ available: true, score: null }] })).toBe(false);
    expect(aiCitationsOlculdu({ score: 0, providers: [{ available: true, score: 0 }] })).toBe(true);
    // Saglayici listesi tasimayan elle yazilmis kayit: skor oldugu gibi
    expect(aiCitationsOlculdu({ score: 25 })).toBe(true);
  });
});

/**
 * F7 — GEO olcum yontemi (GEO_METHOD_VERSION) degisti: fark siteye yazilmaz.
 */
describe('compareAuditRows — GEO yontemi degisimi (F7)', () => {
  const faq = { type: 'faq_missing', checkId: 'geo_faq' };

  it('v1 (details yok) → v2: geoScoreDelta 0, metodolojiDegisen geo, geo_* sorunlari cozulen/yeni sayilmaz', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), geoScore: 60, checks: { geo: { score: 60, methods: [] } }, issues: [faq] }),
      tarama({ id: 'b', ranAt: new Date('2026-10-18'), geoScore: 51, checks: { geo: { score: 51, methods: [], details: { methodVersion: 2 } } }, issues: [{ type: 'definition_missing', checkId: 'geo_definition' }] }),
    );
    expect(r.geoScoreDelta).toBe(0);
    expect(r.metodolojiDegisen).toEqual(['geo']);
    expect(r.checks.find((c) => c.id === 'geo')).toMatchObject({ durum: 'metodoloji_degisti', delta: 0 });
    expect(r.issues.cozulen).toEqual([]);
    expect(r.issues.yeniCikan).toEqual([]);
    expect(r.issues.devamEden.map((i) => i.type)).toEqual(['definition_missing']);
  });

  it('ayni yontem: GEO farki aynen', () => {
    const v2 = (score: number) => ({ score, methods: [], details: { methodVersion: 2 } });
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), geoScore: 51, checks: { geo: v2(51) } }),
      tarama({ id: 'b', ranAt: new Date('2026-10-18'), geoScore: 58, checks: { geo: v2(58) } }),
    );
    expect(r.geoScoreDelta).toBe(7);
    expect(r.metodolojiDegisen).toBeUndefined();
  });

  it('internal_linking v1 → v2 (www katlama): "+60 iyilesti" yerine metodoloji_degisti', () => {
    const r = compareAuditRows(
      tarama({ id: 'a', ranAt: new Date('2026-10-01'), checks: { internal_linking: { score: 20, details: { orphans: [] } } }, issues: [{ type: 'orphan_pages', checkId: 'internal_linking' }] }),
      tarama({ id: 'b', ranAt: new Date('2026-10-18'), checks: { internal_linking: { score: 80, details: { methodVersion: 2, orphans: [] } } }, issues: [] }),
    );
    expect(r.checks.find((c) => c.id === 'internal_linking')).toMatchObject({ durum: 'metodoloji_degisti', delta: 0 });
    expect(r.issues.cozulen).toEqual([]);
  });
});
