import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * I-1 — yayindaki yazinin yeniden yayini ikinci bir kopya ACMAZ.
 *
 * NEDEN VAR: PublisherService her yayinda her hedefte adapter.publish()
 * cagiriyordu; CMS adaptorleri her cagride YENI kayit acar. Icerik pivotu,
 * kapali dongu 'update', panelden yeniden yayin ve takili sayfa akisi
 * WordPress'te /yazi-2/ kopyasi aciyor, eski adres eski metinle kaliyordu.
 * Kural: yayindaki WordPress yazisi yerinde guncellenir, dosya hedeflerine
 * ayni yolun uzerine yazilir, yalniz yeni kayit acan hedeflerde yayin YAPILMAZ
 * (Turkce neden + makine okunur skipped). Otomasyon yazinin yayinda oldugu
 * hedefe yazar, varsayilan hedefe degil. Ilk yayin tarihi (publishedAt)
 * guncellemede degismez.
 *
 * Adaptorler sahte: hangi metodun cagrildigi kaydedilir. Yeniden yayin
 * karari (republish-policy.ts) ve WordPress kayit adreslemesi
 * (@luviai/adapters wordPressEntryAddressable) GERCEK.
 */

type Call = { type: string; method: 'publish' | 'update'; ref?: any; payload: any };
const calls: Call[] = [];
type Behavior = { update?: (ref: any, payload: any) => any; publish?: (payload: any) => any };
const behavior: Record<string, Behavior> = {};
const UPDATE_TYPES = new Set(['WORDPRESS_REST', 'WORDPRESS_XMLRPC']);
const FULL_PAGE_TYPES = new Set(['FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'MARKDOWN_ZIP']);

vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  const make = (type: string) => {
    class Fake {
      constructor(public creds: any) {}
      get needsFullPage() { return FULL_PAGE_TYPES.has(type); }
      async publish(payload: any) {
        calls.push({ type, method: 'publish', payload });
        return behavior[type]?.publish?.(payload) ?? { ok: true, externalUrl: `https://yeni.example/${type}/${payload.slug}`, externalId: `yeni-${type}` };
      }
      async pushLlms() { return { ok: false, skipped: 'unsupported' }; }
    }
    if (UPDATE_TYPES.has(type)) {
      (Fake.prototype as any).update = async function update(ref: any, payload: any) {
        calls.push({ type, method: 'update', ref, payload });
        return behavior[type]?.update?.(ref, payload) ?? { ok: true, externalId: ref.externalId, externalUrl: ref.externalUrl, status: 'publish' };
      };
    }
    return Fake;
  };
  return { ...real, getAdapter: (type: string) => make(type) };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('./image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('../audit/ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('./link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('./qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('./hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));

const { PublisherService } = await import('./publisher.service.js');
const { SchemaClassifierService } = await import('./schema-classifier.service.js');

// Adresler IP — adres denetimi DNS'e gitmez
const IP = '93.184.216.34';
const target = (id: string, type: string, over: Record<string, unknown> = {}) => ({
  id, type, credentials: { siteUrl: `https://${IP}`, apiUrl: `https://${IP}`, baseUrl: `https://${IP}`, endpointUrl: `https://${IP}/api`, host: IP, username: 'u', user: 'u', appPassword: 'p', password: 'p' },
  config: {}, isDefault: false, isActive: true, ...over,
});
const WP = target('t-wp', 'WORDPRESS_REST');
const WPX = target('t-wpx', 'WORDPRESS_XMLRPC');
const FTP = target('t-ftp', 'FTP', { isDefault: true });
const GHOST = target('t-ghost', 'GHOST');
const ZIP = target('t-zip', 'MARKDOWN_ZIP');

const FIRST_AT = new Date('2026-01-05T10:00:00.000Z');
const wpLive = { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://site.example/yazi/', externalId: '41', publishedAt: FIRST_AT.toISOString() };
const ftpLive = { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/blog/yazi.html` };

function build(opts: { targets: any[]; publishedTo?: unknown; publishedAt?: Date | null; slug?: string; qa?: 'PASS' | 'BLOCKED'; status?: string; schemaMarkup?: unknown }) {
  const articleUpdates: any[] = [];
  const article: any = {
    id: 'a1', siteId: 's1', slug: opts.slug ?? 'yazi', title: 'Yazı', bodyMd: '# Yazı\n\nYeni metin.',
    heroImageUrl: 'https://cdn.example/hero.jpg', metaTitle: null, metaDescription: 'Özet', category: null,
    schemaMarkup: opts.schemaMarkup ?? null, frontmatter: {}, inlineImages: [], status: opts.status ?? 'READY_TO_PUBLISH', qaStatus: null,
    qaReport: { blockers: [{ detail: 'kaynaksız istatistik' }] },
    publishedAt: opts.publishedAt === undefined ? FIRST_AT : opts.publishedAt,
    publishedTo: opts.publishedTo ?? null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    site: { id: 's1', url: 'https://site.example', name: 'Site', userId: 'u1', publishTargets: opts.targets },
  };
  // Satir durum tutar: yayinci sonda kaydi YENIDEN okur ve yalniz okudugu
  // updatedAt hala gecerliyse yazar (K10). Yazimlar eski bicimde kaydedilir
  // ({ where: { id }, data }) — kilit alani (updatedAt) beklentilere girmez.
  let tick = 0;
  const write = (data: any) => {
    const rest = { ...data };
    delete rest.updatedAt;
    articleUpdates.push({ where: { id: 'a1' }, data: rest });
    Object.assign(article, rest, { updatedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + (tick += 1) * 1000) });
  };
  const prisma = {
    article: {
      findUniqueOrThrow: vi.fn(async () => article),
      findUnique: vi.fn(async () => ({ ...article })),
      update: vi.fn(async (a: any) => { write(a.data); return {}; }),
      updateMany: vi.fn(async (a: any) => {
        if (a.where?.updatedAt instanceof Date && a.where.updatedAt.getTime() !== article.updatedAt.getTime()) return { count: 0 };
        write(a.data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => opts.targets.slice(0, 1)), update: vi.fn(async () => ({})) },
    site: { findUnique: vi.fn(async () => ({ llmsFullTxt: '' })) },
  };
  const imageGen = { generate: vi.fn(async () => ({ ok: false, error: 'kapali' })) };
  const indexingPinger = { pingUrl: vi.fn(async () => ({})) };
  const llmsFullBuilder = { build: vi.fn(async () => ({ articles: 1, bytes: 10 })), buildShortIndex: vi.fn(async () => '# kisa') };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const urlInventory = { invalidate: vi.fn() };
  const qaGate = { check: vi.fn(async () => ({ status: opts.qa ?? 'PASS' })) };
  const n = {} as any;
  const svc = new PublisherService(
    prisma as any, imageGen as any, indexingPinger as any, llmsFullBuilder as any, linkValidator as any, urlInventory as any, qaGate as any, n,
  );
  const published = () => articleUpdates.find((u) => u.data?.status === 'PUBLISHED');
  return { svc, prisma, imageGen, llmsFullBuilder, indexingPinger, qaGate, articleUpdates, published, article };
}

/**
 * Acik hedef listesi panelden gelir (kullanici, initiator 'user'); bos liste otomasyonun
 * yayinidir (initiator verilmez = 'automation': engellenen yazim agentOutputs.liveWriteBlocked'a
 * kaydedilir — content-pivot spec'leri).
 */
const run = (c: ReturnType<typeof build>, targetIds: string[]) =>
  c.svc.publishArticle('a1', targetIds, { overrideQa: true, ...(targetIds.length > 0 ? { initiator: 'user' as const } : {}) });

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(behavior)) delete behavior[k];
});

describe('yayindaki WordPress yazisi YERINDE guncellenir', () => {
  it('REST ve XML-RPC: update cagrilir, publish CAGRILMAZ; kimlik ayni kalir; ilk yayin tarihi degismez', async () => {
    for (const [t, live] of [[WP, wpLive], [WPX, { ...wpLive, targetId: 't-wpx', targetType: 'WORDPRESS_XMLRPC', externalUrl: 'https://site.example/?p=41' }]] as const) {
      calls.length = 0;
      const c = build({ targets: [t], publishedTo: [live] });
      const [r] = await run(c, [t.id]);
      expect(calls.map((x) => x.method), t.type).toEqual(['update']);
      // Cakisma denetiminin dayanagi da gider: kaydin son yazim ani (bu kayitta publishedAt)
      expect(calls[0].ref).toEqual({ externalId: '41', externalUrl: live.externalUrl, lastWriteAt: FIRST_AT.toISOString() });
      // CMS'e tam sayfa degil govde parcasi gider
      expect(calls[0].payload.bodyHtml).not.toContain('<!DOCTYPE html>');
      expect(calls[0].payload).toMatchObject({ title: 'Yazı', metaDescription: 'Özet', slug: 'yazi' });
      expect(r).toMatchObject({ targetId: t.id, ok: true, action: 'updated', externalId: '41', externalUrl: live.externalUrl });
      const pub = c.published();
      expect(pub.data).not.toHaveProperty('publishedAt');
      expect(pub.data.publishedTo).toHaveLength(1);
      expect(pub.data.publishedTo[0]).toMatchObject({ targetId: t.id, externalId: '41', action: 'updated', publishedAt: FIRST_AT.toISOString() });
      expect(Date.parse(pub.data.publishedTo[0].updatedAt)).toBeGreaterThan(FIRST_AT.getTime());
    }
  });

  it('adaptor kimlik/adres dondurmezse onceki kayittaki kimlik ve adres korunur', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: true }) };
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await run(c, ['t-wp']);
    expect(r).toMatchObject({ ok: true, externalId: '41', externalUrl: 'https://site.example/yazi/' });
  });

  it('yazi WordPress\'te kalici silinmis (notFound), kullanici bu hedefi ACIKCA secip yayinladi: yeni yazi acilir (recreated); kaydin ilk yayini simdi, yazinin ilk yayin tarihi DEGISMEZ (R11)', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, notFound: true, error: 'WP REST 404: rest_post_invalid_id' }) };
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(calls.map((x) => x.method)).toEqual(['update', 'publish']);
    expect(r).toMatchObject({ ok: true, action: 'recreated', externalId: 'yeni-WORDPRESS_REST' });
    const pub = c.published();
    // Yazi bu sitede zaten yayindaydi: silinen kopyanin yeniden olusturulmasi
    // yeni bir yayin sayilmaz (raporlar onu bu donemin uretimi saymasin)
    expect(pub.data).not.toHaveProperty('publishedAt');
    expect(pub.data.publishedTo[0]).toMatchObject({ targetId: 't-wp', externalId: 'yeni-WORDPRESS_REST', action: 'recreated' });
    expect(pub.data.publishedTo[0].publishedAt).toBe(pub.data.publishedTo[0].updatedAt);
  });

  it('cop kutusundaki yazi geri getirilmez: yayin yok, Turkce neden; kayit kimligi korunur, trashedAt yazilir (R19)', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, trashed: true, status: 'trash', error: 'çöp' }) };
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await run(c, ['t-wp']);
    expect(calls.map((x) => x.method)).toEqual(['update']);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_trashed' });
    expect(r.error).toContain('WordPress üzerinde çöp kutusunda');
    expect(r.error).toContain('geri yükleyin');
    expect(c.published()).toBeUndefined();
    expect(c.articleUpdates).toEqual([{ where: { id: 'a1' }, data: { publishedTo: [{ ...wpLive, trashedAt: expect.any(String) }] } }]);
  });

  it('guncelleme hatasi (yetki / ag): yeni yazi ACILMAZ — yazi hala yayinda olabilir', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, error: 'WP REST 403: Sorry, you are not allowed to edit this post.' }) };
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await run(c, ['t-wp']);
    expect(calls.map((x) => x.method)).toEqual(['update']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Mevcut yazı güncellenemedi; kopya açılmadı\. WP REST 403/);
    expect(c.published()).toBeUndefined();

    calls.length = 0;
    behavior.WORDPRESS_REST = { update: () => { throw new Error('ECONNRESET'); } };
    const c2 = build({ targets: [WP], publishedTo: [wpLive] });
    const [r2] = await run(c2, ['t-wp']);
    expect(calls.map((x) => x.method)).toEqual(['update']);
    expect(r2).toMatchObject({ ok: false, error: 'ECONNRESET' });
  });

  it('kaydi adreslenemeyen WordPress yazisi (kimlik ve adres yok): yayin yok, live_entry_unaddressable', async () => {
    const c = build({ targets: [WP], publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true }] });
    const [r] = await run(c, ['t-wp']);
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_unaddressable' });
    expect(r.error).toContain('kimliği ya da adresi kayıtlı değil');
  });
});

describe('yalniz yeni kayit acan hedefler: yayindaki yaziya kopya ACILMAZ', () => {
  const types: Array<[string, string]> = [
    ['GHOST', 'Ghost panelinden'], ['STRAPI', 'Strapi panelinden'], ['WEBFLOW', 'Webflow panelinden'], ['SANITY', 'Sanity panelinden'],
    ['CONTENTFUL', 'Contentful panelinden'], ['WHMCS_KB', 'WHMCS panelinden'], ['CUSTOM_PHP', 'kendi sisteminizden'],
  ];

  it('publish CAGRILMAZ; Turkce neden + skipped; gorsel uretimi, govde/ilk yayin tarihi yazimi, llms YOK; yazi eski metniyle PUBLISHED + elle guncelleme isareti', async () => {
    for (const [type, place] of types) {
      calls.length = 0;
      const t = target(`t-${type}`, type);
      const c = build({ targets: [t], publishedTo: [{ targetId: t.id, targetType: type, ok: true, externalId: 'x1', externalUrl: 'https://s.example/yazi' }], publishedAt: FIRST_AT });
      const results = await run(c, [t.id]);
      expect(calls, type).toEqual([]);
      expect(results, type).toHaveLength(1);
      expect(results[0], type).toMatchObject({ targetId: t.id, ok: false, skipped: 'already_live_create_only' });
      expect(results[0].error, type).toMatch(/^Bu yazı .+ üzerinde zaten yayında\. Bu yayın hedefi mevcut yazıyı yerinde güncelleyemediği için kopya açılmadı; güncel metni /);
      expect(results[0].error, type).toContain(place);
      // Yazi yayinda (eski metinle): durum PUBLISHED'a doner, kayit isaretlenir;
      // publishedAt ve govde onizlemesi (bodyHtml) yazilmaz
      expect(c.articleUpdates, type).toEqual([{
        where: { id: 'a1' },
        data: {
          status: 'PUBLISHED',
          publishedTo: [{ targetId: t.id, targetType: type, ok: true, externalId: 'x1', externalUrl: 'https://s.example/yazi', manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) }],
        },
      }]);
      expect(c.prisma.publishTarget.update, type).not.toHaveBeenCalled();
      expect(c.llmsFullBuilder.build, type).not.toHaveBeenCalled();
      expect(c.imageGen.generate, type).not.toHaveBeenCalled();
    }
  });

  it('hedefte yayinda DEGILSE ilk yayin bugunku gibi yapilir (created)', async () => {
    const c = build({ targets: [GHOST], publishedTo: [wpLive], publishedAt: null });
    const [r] = await run(c, ['t-ghost']);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['GHOST.publish']);
    expect(r).toMatchObject({ ok: true, action: 'created' });
    expect(c.published().data.publishedAt).toBeInstanceOf(Date);
  });

  it('karisik: guncellenebilen hedef yazilir, kopya acilacak hedef atlanir', async () => {
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1' };
    const c = build({ targets: [WP, GHOST], publishedTo: [wpLive, ghostLive] });
    const results = await run(c, ['t-wp', 't-ghost']);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['WORDPRESS_REST.update']);
    expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([['t-wp', true, 'updated'], ['t-ghost', false, 'already_live_create_only']]);
    // Ghost kaydi (yayindaki kopya) korunur; guncel metni alamadigi icin
    // "elle guncelleme bekliyor" diye isaretlenir. WordPress kaydi taze, isaretsiz.
    expect(c.published().data.publishedTo.map((e: any) => e.targetId)).toEqual(['t-wp', 't-ghost']);
    expect(c.published().data.publishedTo[1]).toEqual({ ...ghostLive, manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) });
    expect(c.published().data.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    expect(c.published().data.publishedTo[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('dosya / yol tabanli hedefler ayni yolun uzerine yazar', () => {
  it('FTP: ayni slug ile publish (overwritten); ilk yayin tarihi degismez', async () => {
    const c = build({ targets: [FTP], publishedTo: [ftpLive] });
    const [r] = await run(c, ['t-ftp']);
    expect(calls.map((x) => x.method)).toEqual(['publish']);
    expect(calls[0].payload.slug).toBe('yazi');
    expect(calls[0].payload.bodyHtml).toContain('<!DOCTYPE html>');
    expect(r).toMatchObject({ ok: true, action: 'overwritten' });
    expect(c.published().data).not.toHaveProperty('publishedAt');
  });

  it('slug yayindan sonra degismisse yayin yok (slug_changed): yeni dosya acilir, eski adres eski metinle kalirdi', async () => {
    const c = build({ targets: [FTP], publishedTo: [{ ...ftpLive, externalUrl: `ftp://${IP}/public_html/blog/eski-yazi.html` }], slug: 'yeni-yazi' });
    const [r] = await run(c, ['t-ftp']);
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ ok: false, skipped: 'slug_changed' });
    expect(r.error).toContain('yayındaki: eski-yazi, şimdiki: yeni-yazi');
    // Eski adres eski metinle yayinda: PUBLISHED + elle guncelleme isareti, baska yazim yok
    expect(c.articleUpdates).toEqual([{
      where: { id: 'a1' },
      data: { status: 'PUBLISHED', publishedTo: [expect.objectContaining({ targetId: 't-ftp', manualUpdatePending: true })] },
    }]);
  });

  it('Markdown ZIP: disa aktarim yeniden uretilir (exported), yeni yayin sayilmaz', async () => {
    const c = build({ targets: [ZIP], publishedTo: [{ targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi-1.zip' }] });
    const [r] = await run(c, ['t-zip']);
    expect(calls.map((x) => x.method)).toEqual(['publish']);
    expect(r).toMatchObject({ ok: true, action: 'exported' });
    expect(c.published().data).not.toHaveProperty('publishedAt');
  });
});

describe('otomasyon (hedef verilmedi): yazinin YAYINDA oldugu hedefler, varsayilan hedef degil', () => {
  it('yazi WordPress\'te yayinda, varsayilan sonradan FTP olmus: yalniz WordPress guncellenir, FTP\'ye kopya acilmaz', async () => {
    const c = build({ targets: [FTP, WP], publishedTo: [wpLive] });
    const results = await run(c, []);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['WORDPRESS_REST.update']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ targetId: 't-wp', ok: true, action: 'updated' });
  });

  it('yazinin yayinda oldugu hedef pasif ya da silinmis: baska hedefe yazilmaz, nedeniyle raporlanir', async () => {
    const c = build({
      targets: [FTP, { ...WP, isActive: false }],
      publishedTo: [wpLive, { targetId: 't-silinmis', targetType: 'GHOST', ok: true, externalId: 'g' }],
    });
    const results = await run(c, []);
    expect(calls).toEqual([]);
    expect(results.map((r) => [r.targetId, r.ok, r.skipped])).toEqual([['t-wp', false, 'live_target_inactive'], ['t-silinmis', false, 'live_target_inactive']]);
    expect(results[0].error).toContain('Yazının yayında olduğu hedef (WordPress) silinmiş ya da pasif');
    expect(results[1].error).toContain('(Ghost)');
    // Kopyalar eski metinle yayinda ve RanksUp onlara yazamiyor: PUBLISHED + iki kayit da isaretli
    expect(c.articleUpdates).toHaveLength(1);
    expect(c.articleUpdates[0].data.status).toBe('PUBLISHED');
    expect(c.articleUpdates[0].data.publishedTo.map((e: any) => [e.targetId, e.manualUpdatePending])).toEqual([['t-wp', true], ['t-silinmis', true]]);
  });

  it('yayinda oldugu hedeflerden biri pasif: aktif olana yazilir, pasif olan raporlanir', async () => {
    const c = build({ targets: [{ ...FTP, isActive: false }, WP], publishedTo: [wpLive, ftpLive] });
    const results = await run(c, []);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['WORDPRESS_REST.update']);
    expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([['t-wp', true, 'updated'], ['t-ftp', false, 'live_target_inactive']]);
  });

  it('yazi hic yayinlanmamis: varsayilan + aktif hedefler (eskisi gibi), ilk yayin tarihi yazilir', async () => {
    const c = build({ targets: [FTP, WP, { ...target('t-ftp2', 'FTP'), isDefault: true, isActive: false }], publishedTo: null, publishedAt: null });
    const results = await run(c, []);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['FTP.publish']);
    expect(results).toEqual([expect.objectContaining({ targetId: 't-ftp', ok: true, action: 'created' })]);
    expect(c.published().data.publishedAt).toBeInstanceOf(Date);
  });
});

describe('kalite kapisi (QA) sirasi', () => {
  it('hicbir hedefe yazilmayacaksa QA kosulmaz (LLM maliyeti yok) ve asil neden doner', async () => {
    const ghostLive = { targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1' };
    const c = build({ targets: [GHOST], publishedTo: [ghostLive], qa: 'BLOCKED' });
    const results = await c.svc.publishArticle('a1', ['t-ghost']);
    expect(c.qaGate.check).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: false, skipped: 'already_live_create_only' });

    const none = build({ targets: [FTP, { ...WP, isActive: false }], publishedTo: [wpLive], qa: 'BLOCKED' });
    expect(await none.svc.publishArticle('a1', [])).toEqual([expect.objectContaining({ skipped: 'live_target_inactive' })]);
    expect(none.qaGate.check).not.toHaveBeenCalled();
  });

  it('guncellenecek hedef varsa QA eskisi gibi uygulanir: BLOCKED yazi guncellenmez', async () => {
    const c = build({ targets: [WP], publishedTo: [wpLive], qa: 'BLOCKED' });
    await expect(c.svc.publishArticle('a1', ['t-wp'])).rejects.toThrow(/^QA_BLOCKED: Yayin engellendi — kaynaksız istatistik/);
    expect(c.qaGate.check).toHaveBeenCalledWith('a1');
    expect(calls).toEqual([]);
  });
});

describe('kullanicinin sectigi hedefler', () => {
  it('yayinda oldugu hedef guncellenir, bilerek ekledigi yeni hedefe ilk yayin yapilir; yazi zaten yayinda oldugu icin publishedAt DEGISMEZ (R11)', async () => {
    const c = build({ targets: [WP, GHOST, FTP], publishedTo: [wpLive] });
    const results = await run(c, ['t-wp', 't-ghost']);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['WORDPRESS_REST.update', 'GHOST.publish']);
    expect(results.map((r) => [r.targetId, r.action])).toEqual([['t-wp', 'updated'], ['t-ghost', 'created']]);
    const pub = c.published();
    expect(pub.data).not.toHaveProperty('publishedAt');
    expect(pub.data.publishedTo.map((e: any) => [e.targetId, e.externalId])).toEqual([['t-wp', '41'], ['t-ghost', 'yeni-GHOST']]);
    // Yazinin tek canli kopyasi secildi: "secilmedi" raporu yok
    expect(results.some((r) => r.skipped === 'live_target_not_selected')).toBe(false);
  });

  it('D1: yayinda oldugu hedef secilmezse ona yazilmaz (update cagrilmaz); sonucta live_target_not_selected, kayit isaretli', async () => {
    const c = build({ targets: [WP, GHOST, FTP], publishedTo: [wpLive] });
    const results = await run(c, ['t-ghost']);
    expect(calls.map((x) => `${x.type}.${x.method}`)).toEqual(['GHOST.publish']);
    expect(results.map((r) => [r.targetId, r.ok, r.action ?? r.skipped])).toEqual([['t-ghost', true, 'created'], ['t-wp', false, 'live_target_not_selected']]);
    const wp = c.published().data.publishedTo.find((e: any) => e.targetId === 't-wp');
    // Izsiz eski kayit + yeniden yazilmis metin (READY_TO_PUBLISH): eski metin yayinda
    expect(wp).toEqual({ ...wpLive, manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) });
  });
});

describe('D2 — silinen kaydin yeniden olusturulmasi kimin yayini oldugune baglidir', () => {
  const notFound = () => ({ ok: false, notFound: true, error: 'WP REST 404: rest_post_invalid_id' });

  it.each([
    ['otomasyon (initiator yok), bos liste', [], {}],
    ['otomasyon, acik liste', ['t-wp'], { initiator: 'automation' }],
    ['kullanici, bos liste (hedef adi verilmedi)', [], { initiator: 'user' }],
    ['kullanici, acik liste ama recreateMissing:false (takili sayfa)', ['t-wp'], { initiator: 'user', recreateMissing: false }],
  ] as const)('%s: publish CAGRILMAZ, live_entry_missing', async (_name, ids, opts) => {
    behavior.WORDPRESS_REST = { update: notFound };
    const c = build({ targets: [WP], publishedTo: [wpLive], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', [...ids], { overrideQa: true, ...opts });
    expect(calls.map((x) => x.method)).toEqual(['update']);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_missing' });
  });

  it('kullanici + acik liste: yeniden olusturulur', async () => {
    behavior.WORDPRESS_REST = { update: notFound };
    const c = build({ targets: [WP], publishedTo: [wpLive], status: 'PUBLISHED' });
    const [r] = await c.svc.publishArticle('a1', ['t-wp'], { overrideQa: true, initiator: 'user' });
    expect(calls.map((x) => x.method)).toEqual(['update', 'publish']);
    expect(r).toMatchObject({ ok: true, action: 'recreated' });
  });
});

const { articleContentHash } = await import('./republish-policy.js');

describe('yayindaki yazi yeni metni alamazsa: durum gercegi + elle guncelleme isareti (T-A madde 3)', () => {
  // build() makalesinin metni — basarili yazimda kayda bu iz yazilir
  const CURRENT_HASH = articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı\n\nYeni metin.' });
  const ghostLive = (over: Record<string, unknown> = {}) => ({ targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', externalUrl: 'https://s.example/yazi', ...over });

  it('basarili yazimda kayda hedefe giden metnin izi (contentHash) yazilir', async () => {
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await run(c, ['t-wp']);
    expect(r.contentHash).toBe(CURRENT_HASH);
    expect(c.published().data.publishedTo[0].contentHash).toBe(CURRENT_HASH);
  });

  it('yazi zaten PUBLISHED, izsiz eski kayit, metin degismemis: yeniden "Yayınla" sahte isaret uretmez, kayda yazilmaz', async () => {
    const c = build({ targets: [GHOST], publishedTo: [ghostLive()], status: 'PUBLISHED' });
    const [r] = await run(c, ['t-ghost']);
    expect(r).toMatchObject({ ok: false, skipped: 'already_live_create_only' });
    expect(c.articleUpdates).toEqual([]);
  });

  it('kayitta iz var ve metin ayni: isaret konmaz, onceki isaret kalkar; yazi yayinda oldugu icin PUBLISHED', async () => {
    const c = build({ targets: [GHOST], publishedTo: [ghostLive({ contentHash: CURRENT_HASH, manualUpdatePending: true, manualUpdatePendingSince: '2026-09-01T00:00:00.000Z' })] });
    await run(c, ['t-ghost']);
    expect(c.articleUpdates).toEqual([{ where: { id: 'a1' }, data: { status: 'PUBLISHED', publishedTo: [ghostLive({ contentHash: CURRENT_HASH })] } }]);
  });

  it('kayitta iz var, metin farkli (durumu degistirmeyen duzenleme: capraz link, snippet): PUBLISHED yazida da isaretlenir', async () => {
    const c = build({ targets: [GHOST], publishedTo: [ghostLive({ contentHash: 'eski-metnin-izi' })], status: 'PUBLISHED' });
    await run(c, ['t-ghost']);
    // Durum zaten PUBLISHED: yalniz kayit guncellenir
    expect(c.articleUpdates).toEqual([{
      where: { id: 'a1' },
      data: { publishedTo: [ghostLive({ contentHash: 'eski-metnin-izi', manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) })] },
    }]);
  });

  it('isaret ilk konuldugu ani korur; tekrar atlanan yayin onu tasimaz', async () => {
    const since = '2026-09-01T00:00:00.000Z';
    const c = build({ targets: [GHOST], publishedTo: [ghostLive({ manualUpdatePending: true, manualUpdatePendingSince: since })] });
    await run(c, ['t-ghost']);
    expect(c.articleUpdates).toEqual([{ where: { id: 'a1' }, data: { status: 'PUBLISHED' } }]);
    // izsiz eski kayitta isaret kendiliginden kalkmaz (neyin yayinda oldugu bilinmiyor)
    const again = build({ targets: [GHOST], publishedTo: [ghostLive({ manualUpdatePending: true, manualUpdatePendingSince: since })], status: 'PUBLISHED' });
    await run(again, ['t-ghost']);
    expect(again.articleUpdates).toEqual([]);
  });

  it('hedefe sonraki basarili yazim isareti kaldirir (yeni kayit eskisinin yerine gecer)', async () => {
    const c = build({ targets: [WP], publishedTo: [{ ...wpLive, manualUpdatePending: true, manualUpdatePendingSince: '2026-09-01T00:00:00.000Z' }] });
    const [r] = await run(c, ['t-wp']);
    expect(r).toMatchObject({ ok: true, action: 'updated' });
    const entry = c.published().data.publishedTo[0];
    expect(entry).not.toHaveProperty('manualUpdatePending');
    expect(entry).not.toHaveProperty('manualUpdatePendingSince');
    expect(entry.contentHash).toBe(CURRENT_HASH);
  });

  it('bir hedef HATA verdiyse durum degismez (onay / yeniden deneme bekler); yazamadigi diger canli kopya yine isaretlenir', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, error: 'WP REST 403: yetki yok' }) };
    const c = build({ targets: [WP, GHOST], publishedTo: [wpLive, ghostLive()] });
    const results = await run(c, ['t-wp', 't-ghost']);
    expect(results.map((r) => [r.targetId, r.ok, r.skipped ?? null])).toEqual([['t-wp', false, null], ['t-ghost', false, 'already_live_create_only']]);
    expect(c.articleUpdates).toHaveLength(1);
    expect(c.articleUpdates[0].data).not.toHaveProperty('status');
    expect(c.articleUpdates[0].data.publishedTo).toEqual([wpLive, ghostLive({ manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) })]);
  });

  it('cop kutusundaki kopya canli sayilmaz: onaydaki yazinin durumu degismez, isaret yok; kayda yalniz trashedAt yazilir', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, trashed: true, status: 'trash' }) };
    const c = build({ targets: [WP], publishedTo: [wpLive] });
    const [r] = await run(c, ['t-wp']);
    expect(r).toMatchObject({ ok: false, skipped: 'live_entry_trashed' });
    expect(c.articleUpdates).toEqual([{ where: { id: 'a1' }, data: { publishedTo: [{ ...wpLive, trashedAt: expect.any(String) }] } }]);
    expect(c.llmsFullBuilder.build).not.toHaveBeenCalled();
  });

  it('kayit adreslenemeyen WordPress yazisi: eski metinle yayinda — PUBLISHED + isaret', async () => {
    const c = build({ targets: [WP], publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true }] });
    await run(c, ['t-wp']);
    expect(c.articleUpdates).toEqual([{
      where: { id: 'a1' },
      data: { status: 'PUBLISHED', publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, manualUpdatePending: true, manualUpdatePendingSince: expect.any(String) }] },
    }]);
  });

  it('hic hedef yoksa ve yazi hic yayinlanmamissa durum degismez (yalniz yeni yazi)', async () => {
    const c = build({ targets: [{ ...FTP, isActive: false }], publishedTo: null, publishedAt: null });
    expect(await run(c, [])).toEqual([]);
    expect(c.articleUpdates).toEqual([]);
  });
});

describe('canonical: yayindaki yazida canli kopyanin adresi (JSON-LD url ile ayni kural)', () => {
  const ftpLiveTarget = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/blog' } });
  const ftpDefault = target('t-ftp2', 'FTP', { isDefault: true, config: { remotePath: '/public_html/rehber' } });
  const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];

  it('yazi yayindayken varsayilan hedef degismis: canonical sayfanin GERCEK adresi (varsayilanin yolu degil)', async () => {
    const c = build({ targets: [ftpDefault, ftpLiveTarget], publishedTo: [{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/blog/yazi.html` }] });
    const [r] = await run(c, ['t-ftp']);
    expect(r).toMatchObject({ ok: true, action: 'overwritten' });
    expect(canonicalOf(calls[0].payload.bodyHtml)).toBe('https://site.example/blog/yazi.html');
  });

  it('ilk yayin: canonical yazilan kopyanin KENDI adresi — varsayilan hedefin yolu degil (o hedefe yazilmadi, adres 404)', async () => {
    const c = build({ targets: [ftpDefault, ftpLiveTarget], publishedTo: null, publishedAt: null });
    await run(c, ['t-ftp']);
    // Eskiden varsayilan hedefin yolu (/rehber/yazi.html) yaziliyordu: o adreste sayfa yok
    expect(canonicalOf(calls[0].payload.bodyHtml)).toBe('https://site.example/blog/yazi.html');
    expect(calls[0].payload.bodyHtml).toContain('<meta property="og:url" content="https://site.example/blog/yazi.html">');
  });
});

/**
 * C1 madde 4 — canonical ILAN kuralina gecti (ai-sitemap.service fullPageCanonicalUrl:
 * advertisedArticleEntry; yoksa yazilan kopyanin kendi adresi; o da yoksa canonical yok).
 * NEDEN: articlePublicUrl hic canli gorulmemis WordPress taslaginin ?p= baglantisini (anonim
 * ziyaretciye ve tarayiciya 404) dosya sayfasinin kanonik adresi yapiyordu; 404'e isaret eden
 * canonical sayfanin dizine alinmasina zarar verir.
 */
describe('canonical: ilan edilen adres; yoksa yazilan kopyanin kendi adresi (self-canonical)', () => {
  const ftpT = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/blog' } });
  const sftpT = target('t-sftp', 'SFTP', { config: { remotePath: '/var/www/html/rehber' } });
  const wpT = target('t-wp', 'WORDPRESS_REST', { config: { postStatus: 'draft' } });
  const zipT = target('t-zip', 'MARKDOWN_ZIP', { isDefault: true });
  const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  const htmlOf = (type: string) => calls.find((x) => x.type === type)!.payload.bodyHtml as string;
  const wpTaslak = (over: Record<string, unknown> = {}) => ({
    targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://site.example/?p=41', ...over,
  });

  it('hic canli gorulmemis WordPress taslagi (?p=) canonical olmaz: dosya sayfasi kendi adresini gosterir', async () => {
    const c = build({ targets: [wpT, ftpT], publishedTo: [wpTaslak()] });
    await run(c, ['t-ftp']);
    const html = htmlOf('FTP');
    expect(canonicalOf(html)).toBe('https://site.example/blog/yazi.html');
    expect(html).not.toContain('?p=41');
  });

  it('canlilik denetimi ?p= adresini bir kez canli gorduyse (ilan ediliyor) canonical o adres', async () => {
    const c = build({ targets: [wpT, ftpT], publishedTo: [wpTaslak({ liveSeenAt: '2026-10-19T02:20:00.000Z', liveSeenUrl: 'https://site.example/?p=41' })] });
    await run(c, ['t-ftp']);
    expect(canonicalOf(htmlOf('FTP'))).toBe('https://site.example/?p=41');
  });

  it('klasoru sonradan degisen dosya hedefine yeniden yayin: canonical yeni klasordeki (yazilan) sayfa — kayittaki eski adres degil', async () => {
    const tasindi = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/makaleler' } });
    const c = build({ targets: [tasindi], publishedTo: [{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/blog/yazi.html` }] });
    const [r] = await run(c, ['t-ftp']);
    expect(r).toMatchObject({ ok: true, action: 'overwritten' });
    expect(canonicalOf(htmlOf('FTP'))).toBe('https://site.example/makaleler/yazi.html');
  });

  it('yazilmayan canli dosya kopyasi eski klasorde duruyorsa yeni hedefin sayfasi onu gosterir (kayittaki konum, bugunku ayar degil)', async () => {
    const tasindi = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/makaleler' } });
    const c = build({ targets: [tasindi, sftpT], publishedTo: [{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/blog/yazi.html` }] });
    await run(c, ['t-sftp']);
    expect(canonicalOf(htmlOf('SFTP'))).toBe('https://site.example/blog/yazi.html');
  });

  it('ilan edilecek adres yokken iki dosya hedefine ilk yayin: her sayfa kendi adresini gosterir', async () => {
    const c = build({ targets: [ftpT, sftpT], publishedTo: null, publishedAt: null });
    await run(c, ['t-ftp', 't-sftp']);
    expect(canonicalOf(htmlOf('FTP'))).toBe('https://site.example/blog/yazi.html');
    expect(canonicalOf(htmlOf('SFTP'))).toBe('https://site.example/rehber/yazi.html');
  });

  it('adresi bilinmeyen tam sayfa (Markdown ZIP) ve ilan edilecek adres yok: canonical yazilmaz (tahmini adres yerine)', async () => {
    const c = build({ targets: [zipT], publishedTo: null, publishedAt: null });
    await run(c, ['t-zip']);
    const html = htmlOf('MARKDOWN_ZIP');
    expect(canonicalOf(html)).toBeUndefined();
    expect(html).not.toContain('og:url');
  });

  it('ilan edilen canli kopya varsa ZIP sayfasi da onu gosterir', async () => {
    const c = build({ targets: [wpT, zipT], publishedTo: [wpTaslak({ externalUrl: 'https://site.example/yazi/', remoteStatus: 'publish' })] });
    await run(c, ['t-zip']);
    expect(canonicalOf(htmlOf('MARKDOWN_ZIP'))).toBe('https://site.example/yazi/');
  });
});

/**
 * D1 madde 2 — tam sayfanin JSON-LD'si sayfanin canonical'iyla ayni adresi bildirir.
 * NEDEN: JSON-LD uretim aninda (pipeline) kurulur; yayinci sayfaya baska bir canonical yazabilir
 * (yeni hedefe ilk yayin, klasoru degisen dosya hedefi, varsayilan hedefin yol kuralindan tahmin
 * edilen adres). Ayni sayfada canonical bir adresi, JSON-LD 404 veren baska bir adresi
 * bildiriyordu. Canonical yoksa (Markdown ZIP) JSON-LD'ye adres yazilmaz. JSON-LD gercek
 * schema-classifier buildJsonLd ciktisi (AI cagrisi yok).
 */
describe('tam sayfa JSON-LD: yazi adresi alanlari canonical ile ayni (yoksa yazilmaz)', () => {
  const ftpT = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/blog' } });
  const sftpT = target('t-sftp', 'SFTP', { isDefault: true, config: { remotePath: '/var/www/html/rehber' } });
  const zipT = target('t-zip', 'MARKDOWN_ZIP');
  const BASE = 'https://site.example';
  const htmlOf = (type: string) => calls.find((x) => x.type === type)!.payload.bodyHtml as string;
  const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  const ldOf = (html: string): any[] => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const byType = (ld: any[], type: string) => ld.find((n) => n['@type'] === type);
  /** Uretim hattinin kurdugu JSON-LD (pipeline.service: Anasayfa + yazi kirintisi) */
  const schemaFor = (articleUrl: string) => {
    const types = ['BlogPosting', 'BreadcrumbList', 'Speakable', 'HowTo', 'Organization'] as any[];
    const jsonLd = new SchemaClassifierService().buildJsonLd({
      types,
      article: {
        title: 'Yazı', url: articleUrl, slug: 'yazi', metaDescription: 'Özet', datePublished: FIRST_AT.toISOString(), dateModified: FIRST_AT.toISOString(),
        heroImage: null, faqs: [], author: null,
        breadcrumbs: [{ name: 'Anasayfa', url: BASE }, { name: 'Yazı', url: articleUrl }],
      },
      site: { name: 'Site', url: BASE, sameAs: ['https://x.com/site'] },
    });
    return { types, reasoning: 'test', jsonLd };
  };
  /** Yazi adresi alanlari: Article url + mainEntityOfPage, son kirinti, Speakable url, HowTo adimi */
  const articleUrlFields = (ld: any[]) => {
    const post = byType(ld, 'BlogPosting');
    const crumbs = byType(ld, 'BreadcrumbList').itemListElement;
    return {
      url: post.url,
      mainEntityOfPage: post.mainEntityOfPage?.['@id'],
      lastCrumb: crumbs[crumbs.length - 1].item,
      speakable: byType(ld, 'WebPage').url,
      howToStep: byType(ld, 'HowTo').step[0].url,
    };
  };

  it('hic yayinlanmamis yazi: JSON-LD varsayilan hedefin (SFTP /rehber) yolundan tahmin edilmisti, FTP\'ye ilk yayin — JSON-LD adresi canonical (yazilan sayfa)', async () => {
    const schemaMarkup = schemaFor(`${BASE}/rehber/yazi.html`);
    const c = build({ targets: [sftpT, ftpT], publishedTo: null, publishedAt: null, schemaMarkup });
    await run(c, ['t-ftp']);
    const html = htmlOf('FTP');
    const canonical = `${BASE}/blog/yazi.html`;
    expect(canonicalOf(html)).toBe(canonical);
    const ld = ldOf(html);
    expect(articleUrlFields(ld)).toEqual({ url: canonical, mainEntityOfPage: canonical, lastCrumb: canonical, speakable: canonical, howToStep: canonical });
    expect(html).not.toContain('/rehber/yazi.html');
    // Site adresleri (yayinci, kurulus, ilk kirinti) degismez
    expect(byType(ld, 'BlogPosting').publisher.url).toBe(BASE);
    expect(byType(ld, 'Organization').url).toBe(BASE);
    expect(byType(ld, 'BreadcrumbList').itemListElement[0].item).toBe(BASE);
    // Kayittaki JSON-LD'nin adresi degismez (yalniz yayinlanan sayfa hizalanir; yayinci kayda
    // yalniz hero gorselini yazar)
    expect(articleUrlFields((c.article.schemaMarkup as any).jsonLd).url).toBe(`${BASE}/rehber/yazi.html`);
  });

  it('klasoru sonradan degisen dosya hedefine yeniden yayin: JSON-LD eski klasordeki adresi degil yeni (yazilan) adresi bildirir', async () => {
    const tasindi = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/makaleler' } });
    const c = build({
      targets: [tasindi],
      publishedTo: [{ targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: `ftp://${IP}/public_html/blog/yazi.html` }],
      schemaMarkup: schemaFor(`${BASE}/blog/yazi.html`),
    });
    await run(c, ['t-ftp']);
    const html = htmlOf('FTP');
    const canonical = `${BASE}/makaleler/yazi.html`;
    expect(canonicalOf(html)).toBe(canonical);
    expect(articleUrlFields(ldOf(html))).toEqual({ url: canonical, mainEntityOfPage: canonical, lastCrumb: canonical, speakable: canonical, howToStep: canonical });
  });

  // canli-oncesi-21 madde 2: CMS govde parcasi (WordPress) da ayni kuralla hizalanir; adres
  // ilan edilen adrestir (advertisedArticleEntry), bilinmiyorsa adres alanlari yazilmaz
  it('hic yayinlanmamis yazi WordPress\'e ilk kez: govde parcasinin JSON-LD\'si tahmin edilen adresi (varsayilan SFTP yolu) bildirmez; sema gecerli', async () => {
    const c = build({ targets: [sftpT, WP], publishedTo: null, publishedAt: null, schemaMarkup: schemaFor(`${BASE}/rehber/yazi.html`) });
    await run(c, ['t-wp']);
    const html = htmlOf('WORDPRESS_REST');
    expect(html).not.toContain('<!DOCTYPE html>');
    expect(html).not.toContain('/rehber/yazi.html');
    const ld = ldOf(html);
    const post = byType(ld, 'BlogPosting');
    expect(post).not.toHaveProperty('url');
    expect(post).not.toHaveProperty('mainEntityOfPage');
    expect(byType(ld, 'BreadcrumbList').itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Yazı' });
    expect(byType(ld, 'WebPage')).not.toHaveProperty('url');
    expect(JSON.stringify(ld)).not.toContain('"@id"');
    // Site adresleri degismez; panel onizlemesi (bodyHtml) ayni parca
    expect(post.publisher.url).toBe(BASE);
    expect(c.article.bodyHtml).toBe(html);
  });

  it('WordPress\'te yayindaki yazinin yerinde guncellemesi: govde parcasinin JSON-LD\'si yazinin gercek (ilan edilen) adresini bildirir', async () => {
    const wpYayinda = { ...wpLive, remoteStatus: 'publish' };
    const c = build({ targets: [sftpT, WP], publishedTo: [wpYayinda], schemaMarkup: schemaFor(`${BASE}/rehber/yazi.html`) });
    await run(c, ['t-wp']);
    expect(calls[0]).toMatchObject({ type: 'WORDPRESS_REST', method: 'update' });
    const html = htmlOf('WORDPRESS_REST');
    expect(html).not.toContain('/rehber/yazi.html');
    const real = 'https://site.example/yazi/';
    expect(articleUrlFields(ldOf(html))).toEqual({ url: real, mainEntityOfPage: real, lastCrumb: real, speakable: real, howToStep: real });
  });

  it('iki dosya hedefine ilk yayin: her sayfanin JSON-LD\'si kendi canonical\'ini bildirir', async () => {
    const c = build({ targets: [sftpT, ftpT], publishedTo: null, publishedAt: null, schemaMarkup: schemaFor(`${BASE}/rehber/yazi.html`) });
    await run(c, ['t-ftp', 't-sftp']);
    expect(articleUrlFields(ldOf(htmlOf('FTP'))).url).toBe(`${BASE}/blog/yazi.html`);
    expect(articleUrlFields(ldOf(htmlOf('SFTP'))).url).toBe(`${BASE}/rehber/yazi.html`);
  });

  it('canonical yok (Markdown ZIP, ilan edilen adres yok): JSON-LD\'ye adres yazilmaz; sema gecerli kalir (kopuk @id yok)', async () => {
    const c = build({ targets: [zipT], publishedTo: null, publishedAt: null, schemaMarkup: schemaFor(`${BASE}/rehber/yazi.html`) });
    await run(c, ['t-zip']);
    const html = htmlOf('MARKDOWN_ZIP');
    expect(canonicalOf(html)).toBeUndefined();
    expect(html).not.toContain('/rehber/yazi.html');
    const ld = ldOf(html);
    const post = byType(ld, 'BlogPosting');
    expect(post).toMatchObject({ '@type': 'BlogPosting', headline: 'Yazı', publisher: { url: BASE } });
    expect(post).not.toHaveProperty('url');
    expect(post).not.toHaveProperty('mainEntityOfPage');
    const crumbs = byType(ld, 'BreadcrumbList').itemListElement;
    expect(crumbs.map((x: any) => x.position)).toEqual([1, 2]);
    expect(crumbs[0].item).toBe(BASE);
    expect(crumbs[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Yazı' });
    expect(byType(ld, 'WebPage')).not.toHaveProperty('url');
    expect(byType(ld, 'WebPage').speakable).toBeTruthy();
    expect(byType(ld, 'HowTo').step[0]).not.toHaveProperty('url');
    // Hicbir dugum baska bir dugume @id ile baglanmiyor: silinen mainEntityOfPage kopuk referans birakmaz
    expect(JSON.stringify(ld)).not.toContain('"@id"');
  });

  it('JSON-LD zaten canonical\'i bildiriyorsa sayfa aynen kalir; adressiz uretilmis JSON-LD\'ye adres eklenmez', async () => {
    // Yayinci JSON-LD'ye yalniz hero gorselini ekler (applyHeroImageToJsonLd); karsilastirmada atilir
    const withoutImage = (ld: any[]) => ld.map((n) => {
      const rest = { ...n };
      delete rest.image;
      return rest;
    });
    const ayni = schemaFor(`${BASE}/blog/yazi.html`);
    const c = build({ targets: [ftpT], publishedTo: null, publishedAt: null, schemaMarkup: structuredClone(ayni) });
    await run(c, ['t-ftp']);
    expect(withoutImage(ldOf(htmlOf('FTP')))).toEqual(ayni.jsonLd);

    calls.length = 0;
    // Uretim hatti ilan edilecek adres bulamadi: JSON-LD adressiz kaydedildi (omitJsonLdArticleUrl)
    const { omitJsonLdArticleUrl } = await import('./pipeline.service.js');
    const adressiz = { ...ayni, jsonLd: omitJsonLdArticleUrl(ayni.jsonLd, `${BASE}/blog/yazi.html`) };
    const d = build({ targets: [ftpT], publishedTo: null, publishedAt: null, schemaMarkup: structuredClone(adressiz) });
    await run(d, ['t-ftp']);
    expect(canonicalOf(htmlOf('FTP'))).toBe(`${BASE}/blog/yazi.html`);
    expect(withoutImage(ldOf(htmlOf('FTP')))).toEqual(adressiz.jsonLd);
  });
});

/**
 * canli-oncesi-21 madde 3 — tam sayfa kopyasinin canonical'i yazinin ilan edilen BASKA bir
 * kopyasini (WordPress) gosterebilir. O kopya emekliye ayrilinca (cop kutusu, silinmis) site
 * haritasi dosya kopyasini ilan etmeye baslar, dosya sayfasi ise hala 404 veren adresi kanonik
 * bildirir. Yayinci sayfaya yazdigi canonical'i kayda gecirir (canonicalUrl) ve boyle kopyayi
 * "elle guncelleme bekliyor" diye isaretler (hedefe yeniden yayin sayfayi duzeltir).
 */
describe('canli-oncesi-21 — emekli kopyanin adresini canonical bildiren dosya kopyasi isaretlenir', () => {
  const ftpT = target('t-ftp', 'FTP', { config: { remotePath: '/public_html/blog' } });
  const WP_URL = 'https://site.example/yazi/';
  const FTP_URL = 'https://site.example/blog/yazi.html';
  const FTP_REMOTE = `ftp://${IP}/public_html/blog/yazi.html`;
  const HASH_NOW = articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı\n\nYeni metin.' });
  const wpYayinda = { ...wpLive, remoteStatus: 'publish', contentHash: 'eski' };
  const ftpOf = (c: ReturnType<typeof build>) => (c.article.publishedTo as any[]).find((e) => e.targetId === 't-ftp');
  const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];

  it('tam sayfa yazimi sayfaya yazilan canonical\'i kayda gecirir; CMS hedefi gecirmez', async () => {
    behavior.FTP = { publish: () => ({ ok: true, externalUrl: FTP_REMOTE }) };
    const c = build({ targets: [ftpT, WP], publishedTo: [wpYayinda] });
    await run(c, ['t-ftp', 't-wp']);
    expect(canonicalOf(calls.find((x) => x.type === 'FTP')!.payload.bodyHtml)).toBe(WP_URL);
    expect(ftpOf(c)).toMatchObject({ canonicalUrl: WP_URL });
    expect((c.article.publishedTo as any[]).find((e) => e.targetId === 't-wp')).not.toHaveProperty('canonicalUrl');
  });

  it('WordPress kopyasi cop kutusunda bulundu, hicbir sey yazilmadi: canonical\'i ona isaret eden FTP kopyasi isaretlenir, yazi PUBLISHED kalir', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, trashed: true, status: 'trash' }) };
    const ftp = { ...ftpLive, externalUrl: FTP_REMOTE, contentHash: HASH_NOW, canonicalUrl: WP_URL };
    const c = build({ targets: [ftpT, WP], publishedTo: [wpYayinda, ftp], status: 'PUBLISHED' });
    const res = await run(c, ['t-wp']);
    expect(res.map((r: any) => [r.targetId, r.skipped])).toEqual([['t-wp', 'live_entry_trashed'], ['t-ftp', 'live_target_not_selected']]);
    expect(ftpOf(c)).toMatchObject({ manualUpdatePending: true, canonicalUrl: WP_URL });
    expect(c.article.status).toBe('PUBLISHED');
  });

  it('kendi adresini canonical bildiren FTP kopyasi isaretlenmez (metni guncel)', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, trashed: true, status: 'trash' }) };
    const ftp = { ...ftpLive, externalUrl: FTP_REMOTE, contentHash: HASH_NOW, canonicalUrl: FTP_URL };
    const c = build({ targets: [ftpT, WP], publishedTo: [wpYayinda, ftp], status: 'PUBLISHED' });
    await run(c, ['t-wp']);
    expect(ftpOf(c)).not.toHaveProperty('manualUpdatePending');
  });

  it('ayni yayinda FTP\'ye de yazildi: sayfasi yayindan onceki listeyle (WordPress canonical\'iyla) kuruldugu icin o da isaretlenir', async () => {
    behavior.WORDPRESS_REST = { update: () => ({ ok: false, trashed: true, status: 'trash' }) };
    behavior.FTP = { publish: () => ({ ok: true, externalUrl: FTP_REMOTE }) };
    const ftp = { ...ftpLive, externalUrl: FTP_REMOTE, contentHash: 'eski', canonicalUrl: FTP_URL };
    const c = build({ targets: [ftpT, WP], publishedTo: [wpYayinda, ftp], status: 'PUBLISHED' });
    await run(c, ['t-wp', 't-ftp']);
    expect(canonicalOf(calls.find((x) => x.type === 'FTP')!.payload.bodyHtml)).toBe(WP_URL);
    expect(ftpOf(c)).toMatchObject({ canonicalUrl: WP_URL, manualUpdatePending: true, contentHash: HASH_NOW });
  });
});
