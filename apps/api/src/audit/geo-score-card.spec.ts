import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { GeoScoreCardService, crawlAccessNewerThanAudit, AI_CITATION_FRESH_DAYS } = await import('./geo-score-card.service.js');
const { MEASUREMENT_WINDOW_MS } = await import('../billing/measurement-allowance.js');

/**
 * GEO Score Card — Crawler Erisimi sutunu, denetimin OKUYAMADIGI kok dosyalar.
 *
 * NEDEN VAR: robots_txt / llms_txt / sitemap_xml kontrolu erisim engeli ya da
 * sunucu hatasinda details.unverified=true tasir (found=false, score=0 — olcum
 * degil). Kart bunlara "yok — auto-fix uygula" diyordu: dosya var olabilir,
 * okuyamadigimiz dosyanin yerine uretilmis dosya yazmak musterinin dosyasini
 * silmek olurdu.
 */

const unverified = (label: string, reason: string) => ({
  found: false, valid: false, score: 0, issues: [],
  details: { unverified: true, unverifiedReason: `${label} doğrulanamadı: ${reason}`, unverifiedHint: '"RanksUpBot" için izin verin.' },
});
const WAF = 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).';

function svcWith(audit: any, site: any = { llmsFullTxt: null }, access: any = null) {
  const prisma = {
    audit: { findFirst: vi.fn(async () => audit) },
    site: { findUniqueOrThrow: vi.fn(async () => site) },
    // kv_store'daki tarama erisim kaydi (sites/crawl-access.ts)
    kvStore: { findUnique: vi.fn(async () => (access ? { value: JSON.stringify(access), expiresAt: null } : null)) },
  };
  return new GeoScoreCardService(prisma as any);
}
const crawler = (svc: any) => svc.checkCrawlerAccess('s1');

describe('GeoScoreCardService — Crawler Erisimi', () => {
  it('dogrulanamayan dosyada neden gosterilir; "yok" ve auto-fix onerisi YOK', async () => {
    const audit = { checks: { robots_txt: unverified('robots.txt', WAF), llms_txt: unverified('llms.txt', WAF), sitemap_xml: unverified('sitemap.xml', WAF) } };
    const p = await crawler(svcWith(audit));
    for (const id of ['robots', 'llms', 'sitemap']) {
      const c = p.checks.find((x: any) => x.id === id);
      expect(c, id).toMatchObject({ ok: false, unverified: true });
      expect(c.detail).toContain('doğrulanamadı');
      expect(c.detail).toContain('Cloudflare');
      expect(c.detail).not.toMatch(/auto-fix|yok/i);
    }
  });

  it('gercekten eksik dosyada eski yonlendirme korunur (auto-fix yalniz olculmus eksiklikte)', async () => {
    const audit = { checks: { robots_txt: { found: false, score: 0, issues: [], details: {} }, llms_txt: { found: false }, sitemap_xml: { found: false } } };
    const p = await crawler(svcWith(audit));
    expect(p.checks.find((x: any) => x.id === 'robots')).toMatchObject({ ok: false, detail: 'robots.txt yok — auto-fix uygula' });
    expect(p.checks.find((x: any) => x.id === 'sitemap').detail).toBe('sitemap.xml yok');
    expect(p.checks.some((x: any) => x.unverified)).toBe(false);
  });

  it('hic denetim yoksa "yok" denmez: durum bilinmiyor', async () => {
    const p = await crawler(svcWith(null));
    for (const id of ['robots', 'llms', 'sitemap']) {
      expect(p.checks.find((x: any) => x.id === id).detail, id).toBe('Henüz site denetimi yapılmadı — durum bilinmiyor.');
    }
  });

  it('mevcut dosyalar ok; puan formulu degismedi', async () => {
    const audit = { checks: { robots_txt: { found: true, score: 90 }, llms_txt: { found: true }, sitemap_xml: { found: true } } };
    const p = await crawler(svcWith(audit, { llmsFullTxt: 'x' }));
    expect(p.score).toBe(100);
    expect(p.checks.every((c: any) => c.ok)).toBe(true);
  });

  describe('denetimden YENI erisim kaydi (MCP get_audit ile ayni kural)', () => {
    const RAN_AT = new Date('2026-10-10T08:00:00Z');
    const MEASURED = { ranAt: RAN_AT, checks: { robots_txt: { found: true, score: 90 }, llms_txt: { found: true }, sitemap_xml: { found: false } } };
    const ACCESS = {
      state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
      reason: WAF, hint: '"RanksUpBot" için izin verin.', at: '2026-10-15T09:00:00.000Z', source: 'audit',
    };

    it('site artik bizi engelliyorsa robots/llms/sitemap bayat degerle gosterilmez: dogrulanamadi + neden', async () => {
      const p = await crawler(svcWith(MEASURED, { llmsFullTxt: 'x' }, ACCESS));
      for (const id of ['robots', 'llms', 'sitemap']) {
        const c = p.checks.find((x: any) => x.id === id);
        expect(c, id).toMatchObject({ ok: false, unverified: true });
        expect(c.detail, id).toContain('2026-10-15 tarihli tarama denemesi siteye erişemedi');
        expect(c.detail, id).toContain(`Erişim engellendi: ${WAF}`);
        expect(c.detail, id).toContain('RanksUpBot');
        expect(c.detail, id).not.toMatch(/Mevcut|Skor:|auto-fix|yok/i);
      }
      // llms-full.txt RanksUp DB'sinden gelir — erisimden etkilenmez
      expect(p.checks.find((x: any) => x.id === 'llms-full')).toMatchObject({ ok: true });
    });

    it('ulasilamayan site: "Siteye ulaşılamadı" nedeni', async () => {
      const dns = { ...ACCESS, state: 'unreachable', kind: 'dns', status: null, vendor: null, reason: 'Alan adı çözülemedi.', hint: 'DNS kayıtlarını kontrol edin.' };
      const p = await crawler(svcWith(MEASURED, undefined, dns));
      expect(p.checks.find((x: any) => x.id === 'robots').detail).toContain('Siteye ulaşılamadı: Alan adı çözülemedi.');
    });

    it('denetimden ESKI kayit yok sayilir (erisim sonradan duzeldi): olculen degerler gosterilir', async () => {
      const old = { ...ACCESS, at: '2026-10-01T00:00:00.000Z' };
      const p = await crawler(svcWith(MEASURED, { llmsFullTxt: 'x' }, old));
      expect(p.checks.some((x: any) => x.unverified)).toBe(false);
      expect(p.checks.find((x: any) => x.id === 'robots')).toMatchObject({ ok: true, detail: 'Skor: 90/100' });
      expect(p.checks.find((x: any) => x.id === 'sitemap')).toMatchObject({ ok: false, detail: 'sitemap.xml yok' });
    });

    it('hic denetim yokken erisim kaydi varsa "durum bilinmiyor" yerine erisim nedeni', async () => {
      const p = await crawler(svcWith(null, undefined, ACCESS));
      expect(p.checks.find((x: any) => x.id === 'sitemap').detail).toContain('siteye erişemedi');
    });
  });

  it('crawlAccessNewerThanAudit: yalniz denetimden yeni kayit gecerli; tarih bozuksa guvenli taraf', () => {
    const rec: any = { at: '2026-10-15T09:00:00.000Z' };
    expect(crawlAccessNewerThanAudit(null, new Date())).toBeNull();
    expect(crawlAccessNewerThanAudit(rec, null)).toBe(rec);
    expect(crawlAccessNewerThanAudit(rec, '2026-10-14T00:00:00Z')).toBe(rec);
    expect(crawlAccessNewerThanAudit(rec, '2026-10-16T00:00:00Z')).toBeNull();
    expect(crawlAccessNewerThanAudit({ at: 'bozuk' } as any, '2026-10-14T00:00:00Z')).toBeNull();
    expect(crawlAccessNewerThanAudit(rec, 'bozuk')).toBe(rec);
  });

  it('oneriler listesinde de dogrulanamayan dosya icin auto-fix gecmez', async () => {
    const audit = { checks: { robots_txt: unverified('robots.txt', WAF), llms_txt: { found: true }, sitemap_xml: { found: true } } };
    const svc: any = svcWith(audit);
    // Diger sutunlar bu testin konusu degil — sabit, zayif olmayan sutunlar
    const pillar = (id: string) => async () => ({ id, name: id, weight: 1, score: 100, status: 'great', checks: [] });
    for (const m of ['checkStructuredData', 'checkAiCitation', 'checkAuthority', 'checkFreshness', 'checkMultiModal']) svc[m] = pillar(m);
    const card = await svc.build('s1');
    const robotsRec = card.recommendations.find((r: string) => r.includes('robots.txt'));
    expect(robotsRec).toContain('doğrulanamadı');
    expect(card.recommendations.join(' ')).not.toMatch(/auto-fix/);
  });
});

/**
 * K6 — kart urunde olmayan ozellikleri puanlamaz, olculen asistanlarin
 * hepsini sayar, Turkce konusur.
 *
 * NEDEN VAR: Otorite sutununda 'Sosyal kanal aktif', Multi-Modal sutununda
 * 'TTS audio' ve 'Podcast RSS' kontrolleri, kaldirilan modullere (sosyal
 * yayin, TTS, podcast — commit 0db5a1c) bagliydi: hicbir site gecemiyordu ve
 * podcast satiri olmayan bir ozelligi vaat ediyordu. AI Citation sutunu 6
 * olculen asistanin yalniz 4'unu puanliyordu.
 */
describe('GeoScoreCardService — K6', () => {
  const kart = (over: Record<string, any>) => {
    const prisma = {
      audit: { findFirst: vi.fn(async () => null) },
      site: { findUniqueOrThrow: vi.fn(async () => over.site ?? { brain: null, llmsFullTxt: null }) },
      kvStore: { findUnique: vi.fn(async () => null) },
      aiCitationSnapshot: { findMany: vi.fn(async () => over.snapshots ?? []) },
      article: { findMany: vi.fn(async () => over.articles ?? []), count: vi.fn(async () => 0) },
      agentReadinessScan: { findFirst: vi.fn(async () => over.scan ?? null) },
    };
    return new GeoScoreCardService(prisma as any) as any;
  };
  const snap = (provider: string, score: number | null, available = true) => ({ provider, score, available });

  it('Otorite: sosyal kanal kontrolu puanda yok', async () => {
    const p = await kart({ site: { brain: { competitors: [{}, {}, {}] }, gscConnectedAt: new Date(), socialProfiles: ['a', 'b'] } }).checkAuthority('s1');
    expect(p.checks.map((c: any) => c.id)).toEqual(['social-sameAs', 'competitive-landscape', 'gsc']);
    expect(p.score).toBe(100);
  });

  it('AI Citation: olculen tum asistanlar (Grok, DeepSeek dahil) sayilir; olcum alinamayan asistan paydada yok', async () => {
    const p = await kart({
      snapshots: [
        snap('anthropic', 40), snap('gemini', 10), snap('openai', 50), snap('perplexity', 35),
        snap('xai', 60), snap('deepseek', 5),
        snap('meta', null, false), // Llama yapilandirilmamis: olcum degil
      ],
    }).checkAiCitation('s1');
    expect(p.name).toBe('AI Citation');
    expect(p.checks.map((c: any) => c.name)).toEqual(['Claude', 'Gemini', 'ChatGPT', 'Perplexity', 'Grok (xAI)', 'DeepSeek']);
    // 6 olculen asistanin 4'u >= 30
    expect(p.score).toBe(67);
    expect(p.checks[0].detail).toBe('Son 9 gün ortalaması: 40/100');
  });

  it('AI Citation: hic olcum yoksa tek satir ve Turkce neden; "saglayici aktif degil" denmez', async () => {
    const p = await kart({ snapshots: [] }).checkAiCitation('s1');
    expect(p.score).toBe(0);
    expect(p.checks).toEqual([{ id: 'cite-none', name: 'AI ölçümü', ok: false, detail: 'Son 9 günde hiçbir AI asistanından ölçüm alınmadı.' }]);
  });

  /**
   * NEDEN VAR: pencere 7 gundu. Snapshot tarihi UTC gece yarisina yuvarlanir, olcum hakki
   * ise son olcumden tam 7x24 saat sonra acilir: haftada bir olcen kullanici yeniden olcum
   * yapamadan saatlerce sutunu 0 goruyordu. Mock, gercek sorgu gibi date >= since uygular.
   */
  describe('AI Citation tazelik penceresi', () => {
    const DAY = 86_400_000;
    /** Snapshot tarihi tracker gibi UTC gece yarisina yuvarlanir */
    const gunOnce = (gun: number) => {
      const d = new Date(Date.now() - gun * DAY);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };
    const pencereli = (rows: Array<{ provider: string; score: number; date: Date }>) => {
      const findMany = vi.fn(async (args: any) =>
        rows.filter((r) => r.date.getTime() >= args.where.date.gte.getTime()).map(({ provider, score }) => ({ provider, score, available: true })));
      const prisma = { aiCitationSnapshot: { findMany } };
      return { svc: new GeoScoreCardService(prisma as any) as any, findMany };
    };

    it('pencere 9 gun = 7 gunluk olcum hakki + 1 gun tarih yuvarlamasi + 1 gun pay', () => {
      expect(AI_CITATION_FRESH_DAYS).toBe(9);
      expect(AI_CITATION_FRESH_DAYS).toBe(MEASUREMENT_WINDOW_MS / DAY + 2);
    });

    it('8 gun once (tarihi yuvarlanmis) alinan olcum hala sayilir', async () => {
      const { svc } = pencereli([{ provider: 'openai', score: 50, date: gunOnce(8) }]);
      const p = await svc.checkAiCitation('s1');
      expect(p.checks.map((c: any) => c.id)).toEqual(['cite-openai']);
      expect(p.score).toBe(100);
    });

    it('10 gun onceki olcum sayilmaz', async () => {
      const { svc, findMany } = pencereli([{ provider: 'openai', score: 50, date: gunOnce(10) }]);
      const p = await svc.checkAiCitation('s1');
      expect(p.checks.map((c: any) => c.id)).toEqual(['cite-none']);
      expect(p.score).toBe(0);
      // Sorgu esigi ~9 gun once
      const gte: Date = findMany.mock.calls[0][0].where.date.gte;
      expect(Math.round((Date.now() - gte.getTime()) / DAY)).toBe(9);
    });
  });

  it('Multi-Modal: yalniz hero gorsel; TTS/podcast vaadi yok, Turkce metin', async () => {
    const bos = await kart({ articles: [] }).checkMultiModal('s1');
    expect(bos.checks).toEqual([{ id: 'hero-image', name: 'Hero görsel', ok: false, detail: 'Henüz yayınlanmış makale yok' }]);
    const dolu = await kart({ articles: [{ heroImageUrl: 'https://cdn/x.webp', frontmatter: {} }, { heroImageUrl: null, frontmatter: {} }] }).checkMultiModal('s1');
    expect(dolu.checks[0]).toMatchObject({ ok: false, detail: '1/2 makalede hero görsel' });
    expect(JSON.stringify(dolu)).not.toMatch(/podcast|TTS|audio/i);
  });

  it('Speakable: Siri/Alexa iddiasi yok; Google Asistan (ABD, Ingilizce haber, beta) olarak anlatilir', async () => {
    const yok = await kart({ articles: [{ schemaMarkup: { types: ['Article', 'FAQPage'] } }] }).checkStructuredData('s1');
    const s = yok.checks.find((c: any) => c.id === 'speakable');
    expect(s).toMatchObject({ name: 'Speakable (Google Asistan)', ok: false });
    expect(s.detail).toMatch(/Google Asistan/);
    expect(s.detail).toMatch(/ABD/);
    expect(s.detail).toMatch(/İngilizce haber/);
    expect(s.detail).toMatch(/beta/);
    expect(JSON.stringify(yok)).not.toMatch(/Siri|Alexa/i);
    const var_ = await kart({ articles: [{ schemaMarkup: { types: ['Speakable'] } }] }).checkStructuredData('s1');
    expect(var_.checks.find((c: any) => c.id === 'speakable')).toMatchObject({ ok: true, detail: 'Aktif' });
  });

  it('llms-full.txt satiri Turkce ve dogrulanabilir: olusturma tarihi + haftalik yenileme', async () => {
    const p = await kart({ site: { llmsFullTxt: '# Site', llmsFullTxtAt: new Date('2026-10-13T03:00:00Z') } }).checkCrawlerAccess('s1');
    expect(p.checks.find((c: any) => c.id === 'llms-full')).toMatchObject({ ok: true, detail: 'Oluşturuldu (2026-10-13); her hafta otomatik yenilenir' });
  });
});

/**
 * Otorite 'sameAs' kontrolu: Site.socialProfiles'i yazan hicbir yol yok (yalniz
 * eski veri). Kanit sitenin ana sayfasindaki Organization JSON-LD'si; denetim
 * onu kalici saklamadigi icin son v3+ Agent Readiness taramasinin 'org-schema'
 * sonucu okunur. Olculemeyen durum puana girmez.
 */
describe('GeoScoreCardService — Otorite sameAs (ana sayfa Organization)', () => {
  const RAN = new Date('2026-10-13T04:15:00Z');
  const tarama = (orgCheck: Record<string, unknown>) => ({
    ranAt: RAN,
    levels: [
      { id: 'L1', checks: [{ id: 'robots-ai', ok: true }] },
      { id: 'L2', checks: [{ id: 'llms-full', ok: false }, { id: 'org-schema', ...orgCheck }] },
    ],
  });
  const kur = (over: { scan?: any; site?: any; scanThrows?: boolean }) => {
    const findFirst = vi.fn<(args?: unknown) => Promise<unknown>>(async () => {
      if (over.scanThrows) throw new Error('db yok');
      return over.scan ?? null;
    });
    const prisma = {
      site: { findUniqueOrThrow: vi.fn(async () => over.site ?? { brain: { competitors: [{}, {}, {}] }, gscConnectedAt: null, socialProfiles: null }) },
      agentReadinessScan: { findFirst },
    };
    return { svc: new GeoScoreCardService(prisma as any) as any, findFirst };
  };

  it('tarama Organization + 2 sameAs buldu: gecer, kaynak ve tarih yazar; yalniz v3+ tarama okunur', async () => {
    const t = kur({ scan: tarama({ ok: true, state: 'pass', statusText: 'HairSalon schema var, 3 sameAs profili' }) });
    const p = await t.svc.checkAuthority('s1');
    expect(p.checks[0]).toEqual({
      id: 'social-sameAs', name: 'Kimlik grafiği (Organization sameAs)', ok: true,
      detail: 'Ana sayfa (2026-10-13 Agent Readiness taraması): HairSalon schema var, 3 sameAs profili',
    });
    // rakip 3 (ok) + GSC yok → 2/3
    expect(p.score).toBe(67);
    expect(t.findFirst.mock.calls[0][0]).toMatchObject({ where: { siteId: 's1', scoreVersion: { gte: 3 } }, orderBy: { ranAt: 'desc' } });
  });

  it('sameAs eksik: kalir, puana girer, oneri yazar', async () => {
    const t = kur({ scan: tarama({ ok: false, state: 'fail', statusText: 'Organization schema var, 1 sameAs profili' }) });
    const p = await t.svc.checkAuthority('s1');
    expect(p.checks[0]).toMatchObject({ ok: false, detail: expect.stringContaining('1 sameAs profili — en az 2 sameAs profili önerilir') });
    expect(p.checks[0].unverified).toBeUndefined();
    expect(p.score).toBe(33);
  });

  it('ana sayfa engellendi: dogrulanamadi + neden, puana girmez', async () => {
    const t = kur({ scan: tarama({ ok: false, state: 'blocked', statusText: 'x', blocked: { reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).' } }) });
    const p = await t.svc.checkAuthority('s1');
    expect(p.checks[0]).toMatchObject({ ok: false, unverified: true });
    expect(p.checks[0].detail).toBe('2026-10-13 tarihli Agent Readiness taraması ana sayfayı okuyamadı: Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).');
    // yalniz rakip (ok) + GSC (yok) sayilir → 1/2
    expect(p.score).toBe(50);
  });

  it('tarama yok, eski veri yok: "henüz ölçülmedi" — puana girmez; tablo hatasi karti dusurmez', async () => {
    for (const t of [kur({}), kur({ scanThrows: true })]) {
      const p = await t.svc.checkAuthority('s1');
      expect(p.checks[0]).toMatchObject({ id: 'social-sameAs', ok: false, unverified: true });
      expect(p.checks[0].detail).toContain('henüz ölçülmedi');
      expect(p.checks[0].detail).not.toMatch(/0 sosyal profil/);
      expect(p.score).toBe(50);
    }
  });

  it('tarama yoksa eski socialProfiles verisi yedek olarak okunur', async () => {
    const t = kur({ site: { brain: null, gscConnectedAt: new Date(), socialProfiles: ['https://x.com/a', 'https://linkedin.com/company/a'] } });
    const p = await t.svc.checkAuthority('s1');
    expect(p.checks[0]).toMatchObject({ ok: true, detail: '2 sosyal profil kayıtlı' });
  });
});

/**
 * rv18 F4 — Tazelik sutununun 'Eskimiş içerik' satiri Article.updatedAt'e bakiyordu. Satirin
 * her yazimi onu ilerletir: canlilik denetiminin defter yazimlari (liveSeenAt, goneSince),
 * iyimser kilitler, isaretler. Denetim dagitimdan sonraki ilk turunda her canli dosya
 * kopyasina liveSeenAt yazar; 5 aydir dokunulmamis yazi 90 gun "taze" gorunur, kart
 * 'Eskimiş içerik yok' derdi. Kural artik icerik yazimi: lastLiveWriteAt(publishedTo) ??
 * publishedAt (icerik pivotunun bekleme suresiyle ayni). Sorgu kosullari bellek ici tabloda
 * GERCEK anlamiyla calistirilir; bilinmeyen suzgec hata verir (sahte gecis olmasin).
 */
describe('GeoScoreCardService — Tazelik: eskimis icerik son icerik yazimina gore (rv18 F4)', () => {
  const DAY = 86400000;
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const iso = (d: number) => ago(d).toISOString();
  type Row = { siteId: string; status: string; publishedAt: Date | null; updatedAt: Date; publishedTo: unknown };

  // Tarih kosulu { gte?, lte? }: SQL'deki gibi NULL hicbir karsilastirmayi gecmez
  const dateOk = (v: Date | null, cond: unknown): boolean => {
    if (!cond || typeof cond !== 'object') throw new Error(`testin desteklemedigi tarih kosulu: ${JSON.stringify(cond)}`);
    return Object.entries(cond).every(([op, bound]) => {
      if (!(bound instanceof Date) || (op !== 'gte' && op !== 'lte')) throw new Error(`testin desteklemedigi tarih kosulu: ${op}`);
      if (v === null) return false;
      return op === 'gte' ? v.getTime() >= bound.getTime() : v.getTime() <= bound.getTime();
    });
  };
  const matches = (r: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, cond]) => {
    if (key === 'siteId') return r.siteId === cond;
    if (key === 'status') return r.status === cond;
    if (key === 'publishedAt') return dateOk(r.publishedAt, cond);
    if (key === 'updatedAt') return dateOk(r.updatedAt, cond);
    throw new Error(`testin desteklemedigi suzgec: ${key}`);
  });
  const tazelik = (rows: Row[]) => {
    const prisma = {
      article: {
        count: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).length),
        // select uygulanir: servis secmedigi bir alana (or. updatedAt) dayanamasin
        findMany: vi.fn(async ({ where, select }: any) => rows.filter((r) => matches(r, where)).map((r) => (select
          ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (r as any)[k]]))
          : r))),
      },
    };
    return (new GeoScoreCardService(prisma as any) as any).checkFreshness('s1');
  };
  const eskimis = async (rows: Row[]) => (await tazelik(rows)).checks.find((c: any) => c.id === 'stale-content');

  // 170 gun once FTP'ye yayinlanan ve o gunden beri metnine dokunulmayan yazi
  const ftpCopy = (extra: Record<string, unknown> = {}) => ({
    targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.ornek.com.tr/public_html/blog/eski.html',
    publishedAt: iso(170), updatedAt: iso(170), ...extra,
  });
  const oldRow = (over: Partial<Row> = {}): Row => ({
    siteId: 's1', status: 'PUBLISHED', publishedAt: ago(170), updatedAt: ago(170), publishedTo: [ftpCopy()], ...over,
  });
  const ONE_STALE = '1 makale 90+ gündür güncellenmedi (content pivot çalıştır)';

  it('canlilik denetiminin ilk canli gorulme yazimi (liveSeenAt, Article.updatedAt = simdi) eski yaziyi taze gostermez', async () => {
    expect(await eskimis([oldRow()])).toMatchObject({ ok: true, detail: ONE_STALE });
    // Denetimin yazdigi: kayda liveSeenAt, satira updatedAt = simdi; metne dokunulmadi
    const now = new Date();
    const afterSighting = oldRow({ updatedAt: now, publishedTo: [ftpCopy({ liveSeenAt: now.toISOString() })] });
    expect(await eskimis([afterSighting])).toMatchObject({ ok: true, detail: ONE_STALE });
  });

  it('defter yazimlari (liveSeenAt, goneSince, iyimser kilit) 10 eski yaziyi kartta eskimis birakir: satir basarisiz kalir', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => oldRow({
      updatedAt: ago(i % 3),
      publishedTo: [ftpCopy(i % 2 === 0 ? { liveSeenAt: iso(i % 3) } : { goneSince: iso(i % 3) })],
    }));
    expect(await eskimis(rows)).toMatchObject({ ok: false, detail: '10 makale 90+ gündür güncellenmedi (content pivot çalıştır)' });
  });

  it('gercek icerik yazimi (yerinde guncelleme, ayni yolun uzerine yazma, "güncelledim") yaziyi taze yapar', async () => {
    const rewritten = oldRow({ updatedAt: ago(10), publishedTo: [ftpCopy({ updatedAt: iso(10) })] });
    expect(await eskimis([rewritten])).toMatchObject({ ok: true, detail: 'Eskimiş içerik yok' });
  });

  it('son yazimi tasimayan eski kayitta ilk yayin tarihi; emekli kopyanin yazimi sayilmaz; yayinda olmayan, yeni ve baska sitenin yazisi sayilmaz', async () => {
    const legacy = oldRow({
      publishedAt: ago(120), updatedAt: new Date(),
      publishedTo: [{ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com.tr/eski/' }],
    });
    const retiredRecentWrite = oldRow({
      updatedAt: new Date(),
      publishedTo: [ftpCopy(), {
        targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com.tr/kaldirilan/',
        updatedAt: iso(5), missingAt: iso(1), missingReason: 'public_url_gone',
      }],
    });
    const notPublished = oldRow({ status: 'READY_TO_PUBLISH' });
    const recent = oldRow({ publishedAt: ago(20), updatedAt: ago(20), publishedTo: [ftpCopy({ publishedAt: iso(20), updatedAt: iso(20) })] });
    const otherSite = oldRow({ siteId: 's2' });
    expect((await eskimis([legacy, retiredRecentWrite, notPublished, recent, otherSite])).detail)
      .toBe('2 makale 90+ gündür güncellenmedi (content pivot çalıştır)');
  });
});
