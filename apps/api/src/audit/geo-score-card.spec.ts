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

/** Denetimin robots_txt kaydi (yontem v3): alti kritik botun etkin erisimi */
const KRITIK = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'];
const robotsV3 = (engelli: string[] = []) => ({
  found: true, score: engelli.length ? 30 : 100, issues: [],
  details: { methodVersion: 3, hasSitemap: true, searchBots: KRITIK.map((name) => ({ name, effective: engelli.includes(name) ? 'block' : 'allow', declared: 'unspecified' })), trainingBlocked: [] },
});

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
    expect(p.checks.map((x: any) => x.id)).toEqual(['robots', 'sitemap']);
    for (const id of ['robots', 'sitemap']) {
      const c = p.checks.find((x: any) => x.id === id);
      expect(c, id).toMatchObject({ ok: false, unverified: true });
      expect(c.detail).toContain('doğrulanamadı');
      expect(c.detail).toContain('Cloudflare');
      expect(c.detail).not.toMatch(/auto-fix|yok/i);
    }
  });

  it('robots.txt yoksa kritik botlar serbest (RFC 9309) — satir gecer; eksik sitemap yine eksik', async () => {
    const audit = { checks: { robots_txt: { found: false, score: 0, issues: [], details: {} }, llms_txt: { found: false }, sitemap_xml: { found: false } } };
    const p = await crawler(svcWith(audit));
    expect(p.checks.find((x: any) => x.id === 'robots')).toMatchObject({ ok: true, detail: 'robots.txt yok — kural olmadığı için arama botları serbest' });
    expect(p.checks.find((x: any) => x.id === 'sitemap').detail).toBe('sitemap.xml yok');
    expect(p.checks.some((x: any) => x.unverified)).toBe(false);
    expect(p.score).toBe(50);
  });

  it('hic denetim yoksa "yok" denmez: durum bilinmiyor', async () => {
    const p = await crawler(svcWith(null));
    for (const id of ['robots', 'sitemap']) {
      expect(p.checks.find((x: any) => x.id === id).detail, id).toBe('Henüz site denetimi yapılmadı — durum bilinmiyor.');
    }
  });

  it('kritik botlar acik + sitemap var: 100; llms.txt / llms-full.txt sutunda yok (08.11.2026)', async () => {
    const audit = { checks: { robots_txt: robotsV3(), llms_txt: { found: false }, sitemap_xml: { found: true } } };
    const p = await crawler(svcWith(audit, { llmsFullTxt: null }));
    expect(p.score).toBe(100);
    expect(p.checks.map((c: any) => c.id)).toEqual(['robots', 'sitemap']);
    expect(p.checks[0]).toMatchObject({ name: 'Kritik arama botları (robots.txt)', ok: true, detail: 'Engelli kritik bot yok' });
    expect(JSON.stringify(p)).not.toMatch(/llms/i);
  });

  it('kritik bot engelliyse satir kalir, engelli botlar yazilir', async () => {
    const audit = { checks: { robots_txt: robotsV3(['Googlebot', 'Claude-User']), sitemap_xml: { found: true } } };
    const p = await crawler(svcWith(audit));
    expect(p.checks[0].ok).toBe(false);
    expect(p.checks[0].detail).toContain('Engelli: Googlebot, Claude-User');
    expect(p.score).toBe(50);
  });

  it('eski (v2) kayit yalniz uc AI arama botunu tasir: eksikler sonraki taramada olculur notu', async () => {
    const v2 = { found: true, score: 100, details: { methodVersion: 2, searchBots: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'].map((name) => ({ name, effective: 'allow' })) } };
    const p = await crawler(svcWith({ checks: { robots_txt: v2, sitemap_xml: { found: true } } }));
    expect(p.checks[0].ok).toBe(true);
    expect(p.checks[0].detail).toBe('Engelli kritik bot yok (Googlebot, Bingbot, Claude-User bir sonraki taramada ölçülür)');
  });

  it('bot ayrintisi olmayan v1 kaydinda eski skor esigi (>= 70) kullanilir', async () => {
    const p = await crawler(svcWith({ checks: { robots_txt: { found: true, score: 60 }, sitemap_xml: { found: true } } }));
    expect(p.checks[0]).toMatchObject({ ok: false, detail: 'Skor: 60/100 (eski tarama — yeniden tarayınca kritik botlar ölçülür)' });
  });

  describe('denetimden YENI erisim kaydi (MCP get_audit ile ayni kural)', () => {
    const RAN_AT = new Date('2026-10-10T08:00:00Z');
    const MEASURED = { ranAt: RAN_AT, checks: { robots_txt: robotsV3(), llms_txt: { found: true }, sitemap_xml: { found: false } } };
    const ACCESS = {
      state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
      reason: WAF, hint: '"RanksUpBot" için izin verin.', at: '2026-10-15T09:00:00.000Z', source: 'audit',
    };

    it('site artik bizi engelliyorsa robots/sitemap bayat degerle gosterilmez: dogrulanamadi + neden', async () => {
      const p = await crawler(svcWith(MEASURED, { llmsFullTxt: 'x' }, ACCESS));
      for (const id of ['robots', 'sitemap']) {
        const c = p.checks.find((x: any) => x.id === id);
        expect(c, id).toMatchObject({ ok: false, unverified: true });
        expect(c.detail, id).toContain('2026-10-15 tarihli tarama denemesi siteye erişemedi');
        expect(c.detail, id).toContain(`Erişim engellendi: ${WAF}`);
        expect(c.detail, id).toContain('RanksUpBot');
        expect(c.detail, id).not.toMatch(/Mevcut|Skor:|auto-fix|yok|Engelli/i);
      }
      expect(p.checks.map((x: any) => x.id)).toEqual(['robots', 'sitemap']);
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
      expect(p.checks.find((x: any) => x.id === 'robots')).toMatchObject({ ok: true, detail: 'Engelli kritik bot yok' });
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

  it('AI Citation: hic olcum yoksa olculemedi (0 degil) ve Turkce neden; "saglayici aktif degil" denmez', async () => {
    const p = await kart({ snapshots: [] }).checkAiCitation('s1');
    expect(p.score).toBeNull();
    expect(p.status).toBe('unmeasured');
    expect(p.checks).toEqual([]);
    expect(p.unmeasuredReason).toBe("Son 9 günde AI ölçümü yok — AI Görünürlük'te Yeniden Test ile ölçülür");
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
      expect(p.checks).toEqual([]);
      expect(p.score).toBeNull();
      // Sorgu esigi ~9 gun once
      const gte: Date = findMany.mock.calls[0][0].where.date.gte;
      expect(Math.round((Date.now() - gte.getTime()) / DAY)).toBe(9);
    });
  });

  it('Multi-Modal: yalniz hero gorsel; TTS/podcast vaadi yok, Turkce metin', async () => {
    const bos = await kart({ articles: [] }).checkMultiModal('s1');
    // RanksUp makalesi yok: olculemedi (geo-score-card-olculemedi.spec.ts)
    expect(bos).toMatchObject({ score: null, status: 'unmeasured', checks: [] });
    const dolu = await kart({ articles: [{ heroImageUrl: 'https://cdn/x.webp', frontmatter: {} }, { heroImageUrl: null, frontmatter: {} }] }).checkMultiModal('s1');
    expect(dolu.checks[0]).toMatchObject({ ok: false, detail: '1/2 makalede hero görsel' });
    expect(JSON.stringify(dolu)).not.toMatch(/podcast|TTS|audio/i);
  });

  it('Yapisal Veri: tip cesitliligi, Speakable ve FAQPage odulu yok; kapsama + Organization (08.11.2026)', async () => {
    const p = await kart({ articles: [{ schemaMarkup: { types: ['Article', 'FAQPage', 'Speakable', 'HowTo', 'Organization'] } }] }).checkStructuredData('s1');
    expect(p.checks.map((c: any) => c.id)).toEqual(['schema-coverage', 'org-schema']);
    expect(JSON.stringify(p)).not.toMatch(/Speakable|FAQPage|çeşitlili|Siri|Alexa/i);
    // Tarama yok: Organization satiri olculmedi, puana girmez → yalniz kapsama (1/1)
    expect(p.checks[1]).toMatchObject({ ok: false, unverified: true });
    expect(p.score).toBe(100);
  });

  it('Crawler: site llms-full.txt uretmis olsa da satir yok', async () => {
    const p = await kart({ site: { llmsFullTxt: '# Site', llmsFullTxtAt: new Date('2026-10-13T03:00:00Z') } }).checkCrawlerAccess('s1');
    expect(p.checks.find((c: any) => c.id === 'llms-full')).toBeUndefined();
    expect(p.checks.find((c: any) => c.id === 'llms')).toBeUndefined();
  });
});

/**
 * Yapisal Veri sutunu (08.11.2026): RanksUp makalelerinde schema kapsami (>= %80)
 * + ana sayfada Organization / LocalBusiness — son v3+ Agent Readiness
 * taramasinin 'org-schema' kontrolunden (sameAs sayisi burada aranmaz).
 */
describe('GeoScoreCardService — Yapisal Veri: kapsama + Organization semasi', () => {
  const RAN = new Date('2026-11-01T04:00:00Z');
  const tarama = (org: Record<string, unknown>) => ({ ranAt: RAN, levels: [{ id: 'groundwork', checks: [{ id: 'org-schema', ...org }] }] });
  const VAR = { ok: false, state: 'fail', statusText: 'LocalBusiness schema var, 0 sameAs profili', audit: [{ step: 'PARSE', ok: true }, { step: 'CONCLUDE', ok: false }] };
  const YOK = { ok: false, state: 'fail', statusText: 'Ana sayfada Organization (ya da alt türü, ör. LocalBusiness) schema yok', audit: [{ step: 'PARSE', ok: false }] };
  const kur = (articles: any[], scan: any) => {
    const findFirst = vi.fn<(args?: unknown) => Promise<unknown>>(async () => scan);
    const prisma = { article: { findMany: vi.fn(async () => articles) }, agentReadinessScan: { findFirst } };
    return { svc: new GeoScoreCardService(prisma as any) as any, findFirst };
  };
  const makale = (schema: boolean) => ({ schemaMarkup: schema ? { types: ['Article'] } : null });

  it('Organization VAR (sameAs olmasa da) gecer; kapsama %80 alti kalir → 50', async () => {
    const t = kur([makale(true), makale(true), makale(false)], tarama(VAR));
    const p = await t.svc.checkStructuredData('s1');
    expect(p.checks[0]).toMatchObject({ id: 'schema-coverage', ok: false, detail: "2/3 makale schema'lı (önerilen: en az %80)" });
    expect(p.checks[1]).toEqual({
      id: 'org-schema', name: 'Organization / LocalBusiness şeması (site)', ok: true,
      detail: 'Ana sayfa (2026-11-01 Agent Readiness taraması): LocalBusiness schema var, 0 sameAs profili',
    });
    expect(p.score).toBe(50);
    expect(t.findFirst.mock.calls[0][0]).toMatchObject({ where: { siteId: 's1', scoreVersion: { gte: 3 } } });
  });

  it('Organization YOK: satir basarisiz ve puana girer', async () => {
    const p = await kur([makale(true)], tarama(YOK)).svc.checkStructuredData('s1');
    expect(p.checks[1]).toMatchObject({ ok: false, detail: 'Ana sayfada Organization ya da LocalBusiness şeması yok (2026-11-01 Agent Readiness taraması)' });
    expect(p.checks[1].unverified).toBeUndefined();
    expect(p.score).toBe(50);
  });

  it('ana sayfa engelli / okunamadi: dogrulanamadi, puana girmez', async () => {
    const engel = tarama({ ok: false, state: 'blocked', statusText: 'x', blocked: { reason: 'WAF engeli' } });
    const p = await kur([makale(true)], engel).svc.checkStructuredData('s1');
    expect(p.checks[1]).toMatchObject({ ok: false, unverified: true, detail: '2026-11-01 tarihli Agent Readiness taraması ana sayfayı okuyamadı: WAF engeli' });
    expect(p.score).toBe(100);
    const okunamadi = await kur([makale(true)], tarama({ ok: false, state: 'fail', statusText: 'Ana sayfa okunamadı (HTTP 500)', audit: [{ step: 'PARSE', ok: false }] })).svc.checkStructuredData('s1');
    expect(okunamadi.checks[1]).toMatchObject({ unverified: true });
  });

  it('RanksUp makalesi yok ama Organization olculdu: sutun yalniz o satirla olculur', async () => {
    const p = await kur([], tarama(VAR)).svc.checkStructuredData('s1');
    expect(p.checks[0]).toMatchObject({ id: 'schema-coverage', unverified: true });
    expect(p.score).toBe(100);
  });

  it('makale de tarama da yok: olculemedi + neden', async () => {
    const p = await kur([], null).svc.checkStructuredData('s1');
    expect(p).toMatchObject({ score: null, status: 'unmeasured', checks: [] });
    expect(p.unmeasuredReason).toContain('Organization şeması henüz ölçülmedi');
  });

  it('tarama tablosu hatasi karti dusurmez (kanit yok sayilir)', async () => {
    const prisma = { article: { findMany: vi.fn(async () => [makale(true)]) }, agentReadinessScan: { findFirst: vi.fn(async () => { throw new Error('db yok'); }) } };
    const p = await (new GeoScoreCardService(prisma as any) as any).checkStructuredData('s1');
    expect(p.checks[1]).toMatchObject({ unverified: true });
    expect(p.score).toBe(100);
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
 * Tazelik sutunu (08.11.2026): "son 30 günde 4+ / son 7 günde 1+ yayın" ve "90+ gün
 * <10 makale" kalkti (Google: taze gorunmek icin cok icerik eklemek ise yaramaz).
 * Tek olcut: yayindaki makalelerin en az %70'i son 12 ayda yayinlanmis ya da
 * guncellenmis.
 *
 * Guncelleme = son ICERIK yazimi, Article.updatedAt DEGIL (rv18 F4): satirin her
 * yazimi onu ilerletir — canlilik denetiminin defter yazimlari (liveSeenAt,
 * goneSince), iyimser kilitler, isaretler. Kural lastLiveWriteAt(publishedTo) ??
 * publishedAt (icerik pivotunun bekleme suresiyle ayni). Sorgu kosullari bellek ici
 * tabloda GERCEK anlamiyla calistirilir; bilinmeyen suzgec hata verir (sahte gecis
 * olmasin).
 */
describe('GeoScoreCardService — Tazelik: son 12 ayda yayinlanan / guncellenen oran', () => {
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
  const satir = async (rows: Row[]) => {
    const p = await tazelik(rows);
    expect(p.checks.map((c: any) => c.id)).toEqual(['updated-12m']);
    return p.checks[0];
  };

  // 400 gun once FTP'ye yayinlanan ve o gunden beri metnine dokunulmayan yazi
  const ftpCopy = (extra: Record<string, unknown> = {}) => ({
    targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.ornek.com.tr/public_html/blog/eski.html',
    publishedAt: iso(400), updatedAt: iso(400), ...extra,
  });
  const oldRow = (over: Partial<Row> = {}): Row => ({
    siteId: 's1', status: 'PUBLISHED', publishedAt: ago(400), updatedAt: ago(400), publishedTo: [ftpCopy()], ...over,
  });
  const newRow = (gun: number): Row => oldRow({ publishedAt: ago(gun), updatedAt: ago(gun), publishedTo: [ftpCopy({ publishedAt: iso(gun), updatedAt: iso(gun) })] });

  it('yayin sikligi esikleri yok: son 30/7 gunde yayin olmasa da 12 ay icindeki yazilar taze', async () => {
    const p = await tazelik([newRow(200), newRow(300)]);
    expect(p.checks.map((c: any) => c.id)).toEqual(['updated-12m']);
    expect(JSON.stringify(p)).not.toMatch(/30 gün|7 gün|90\+/);
    expect(p.checks[0]).toMatchObject({ ok: true, detail: '2/2 makale (%100) son 12 ayda yayınlandı ya da güncellendi (önerilen: en az %70)' });
    expect(p.score).toBe(100);
  });

  it('esik %70: 7/10 gecer, 6/10 gecmez', async () => {
    const yedi = [...Array.from({ length: 7 }, (_, i) => newRow(10 + i)), ...Array.from({ length: 3 }, () => oldRow())];
    expect(await satir(yedi)).toMatchObject({ ok: true });
    const alti = [...Array.from({ length: 6 }, (_, i) => newRow(10 + i)), ...Array.from({ length: 4 }, () => oldRow())];
    expect(await satir(alti)).toMatchObject({ ok: false, detail: '6/10 makale (%60) son 12 ayda yayınlandı ya da güncellendi (önerilen: en az %70)' });
  });

  it('canlilik denetiminin ilk canli gorulme yazimi (liveSeenAt, Article.updatedAt = simdi) eski yaziyi taze gostermez', async () => {
    expect(await satir([oldRow()])).toMatchObject({ ok: false, detail: expect.stringContaining('0/1 makale') });
    const now = new Date();
    const afterSighting = oldRow({ updatedAt: now, publishedTo: [ftpCopy({ liveSeenAt: now.toISOString() })] });
    expect(await satir([afterSighting])).toMatchObject({ ok: false, detail: expect.stringContaining('0/1 makale') });
  });

  it('defter yazimlari (liveSeenAt, goneSince, iyimser kilit) eski yazilari taze yapmaz', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => oldRow({
      updatedAt: ago(i % 3),
      publishedTo: [ftpCopy(i % 2 === 0 ? { liveSeenAt: iso(i % 3) } : { goneSince: iso(i % 3) })],
    }));
    expect(await satir(rows)).toMatchObject({ ok: false, detail: expect.stringContaining('0/10 makale (%0)') });
  });

  it('gercek icerik yazimi (yerinde guncelleme, ayni yolun uzerine yazma, "güncelledim") yaziyi taze yapar', async () => {
    const rewritten = oldRow({ updatedAt: ago(10), publishedTo: [ftpCopy({ updatedAt: iso(10) })] });
    expect(await satir([rewritten])).toMatchObject({ ok: true, detail: expect.stringContaining('1/1 makale (%100)') });
  });

  it('son yazimi tasimayan eski kayitta ilk yayin tarihi; emekli kopyanin yazimi sayilmaz; yayinda olmayan ve baska sitenin yazisi sayilmaz', async () => {
    const legacy = oldRow({
      publishedAt: ago(500), updatedAt: new Date(),
      publishedTo: [{ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com.tr/eski/' }],
    });
    const retiredRecentWrite = oldRow({
      updatedAt: new Date(),
      publishedTo: [ftpCopy(), {
        targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com.tr/kaldirilan/',
        updatedAt: iso(5), missingAt: iso(1), missingReason: 'public_url_gone',
      }],
    });
    const notPublished = newRow(5);
    notPublished.status = 'READY_TO_PUBLISH';
    const otherSite = newRow(5);
    otherSite.siteId = 's2';
    expect((await satir([legacy, retiredRecentWrite, notPublished, newRow(20), otherSite])).detail)
      .toBe('1/3 makale (%33) son 12 ayda yayınlandı ya da güncellendi (önerilen: en az %70)');
  });

  it('RanksUp makalesi yoksa olculemedi', async () => {
    const p = await tazelik([]);
    expect(p).toMatchObject({ score: null, status: 'unmeasured', checks: [] });
  });
});
