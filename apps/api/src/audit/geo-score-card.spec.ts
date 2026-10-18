import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { GeoScoreCardService, crawlAccessNewerThanAudit } = await import('./geo-score-card.service.js');

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
    expect(p.checks[0].detail).toBe('Son 7 gün ortalaması: 40/100');
  });

  it('AI Citation: hic olcum yoksa tek satir ve Turkce neden; "saglayici aktif degil" denmez', async () => {
    const p = await kart({ snapshots: [] }).checkAiCitation('s1');
    expect(p.score).toBe(0);
    expect(p.checks).toEqual([{ id: 'cite-none', name: 'AI ölçümü', ok: false, detail: 'Son 7 günde hiçbir AI asistanından ölçüm alınmadı.' }]);
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
