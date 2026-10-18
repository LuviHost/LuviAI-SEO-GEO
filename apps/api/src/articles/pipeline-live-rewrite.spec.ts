import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * T-A madde 2 — uretim hatti YAYINDAKI yaziyi yeniden yazarken:
 *  - slug (adres) degismez; JSON-LD url canli adresten gelir
 *  - datePublished ilk yayin tarihi, dateModified bugun (gercek ve sahte hat)
 *  - kayit ezilmeden once canli metnin goruntusu agentOutputs.liveSnapshot'a
 *  - OTOMATIK yeniden yazimda (icerik pivotu) editor PASS vermezse kayit EZILMEZ
 *  - kullanicinin baslattigi guncelleme bugunku gibi kaydi ezer (REVIZE_NEEDED)
 * Eskiden hat kaydi tumden eziyordu: LLM'in yeni slug'i, bugunku datePublished,
 * canli metin kayboluyordu; reddedilen taslak canli yaziyi REVIZE_NEEDED'e cekiyordu.
 */

// GEO kapisi deterministik ve kendi testleri var (geo-gate.spec.ts): gecer sayilir
vi.mock('@luviai/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@luviai/shared')>();
  return {
    ...real,
    checkGeoGate: () => ({
      pass: true,
      issues: [],
      feedback: '',
      stats: { questionRatio: 1, tables: 1, shortAnswerCovered: 1, contentH2: 1, unsourcedNumericClaims: 0 },
    }),
  };
});

const { PipelineService } = await import('./pipeline.service.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

const DRAFT = [
  '---',
  'title: "Kira Artış Oranı Nasıl Hesaplanır?"',
  'slug: kira-artis-orani',
  'date_published: "2026-10-18"',
  'meta_title: "Kira Artış Oranı"',
  'meta_description: "Kira artış oranının hesaplanması."',
  '---',
  '# Kira Artış Oranı Nasıl Hesaplanır?',
  '',
  'Gövde metni.',
].join('\n');

const editorJson = (verdict: 'PASS' | 'REVIZE' | 'FAIL', blocking: string[] = []) => [
  '```json',
  JSON.stringify({ verdict, scores: { yapi: verdict === 'PASS' ? 9 : 3 }, total: verdict === 'PASS' ? 80 : 30, blocking_issues: blocking }),
  '```',
].join('\n');

const FIRST_AT = new Date('2026-01-05T10:00:00.000Z');
const LIVE_URL = 'https://ornek.com/eski-adres/';
const OLD_OUTPUTS = { writer: { output: 'eski yazar ciktisi' }, geoGate: { pass: true } };

/** Yayindaki (PUBLISHED, WordPress'te) kayit */
const liveRow = (over: Record<string, unknown> = {}) => ({
  status: 'PUBLISHED',
  slug: 'eski-adres',
  title: 'Eski Başlık',
  metaTitle: 'Eski Meta',
  metaDescription: 'Eski açıklama',
  bodyMd: '# Eski Başlık\n\nYayındaki metin.',
  faqs: [{ q: 'Eski soru?', a: 'Eski cevap.' }],
  schemaMarkup: { jsonLd: [{ '@type': 'Article', url: LIVE_URL }] },
  publishedAt: FIRST_AT,
  publishedTo: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: LIVE_URL }],
  agentOutputs: OLD_OUTPUTS,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function build(opts: { existing?: Record<string, unknown> | null; editor?: string; aiDisabled?: boolean; targets?: any[] } = {}) {
  const site = { id: 's1', name: 'Site', url: 'https://ornek.com', niche: 'emlak', language: 'tr', socialProfiles: [], brain: { brandVoice: {}, personas: [], competitors: [], seoStrategy: {}, glossary: [] } };
  const prisma = {
    site: {
      findUniqueOrThrow: vi.fn(async () => site),
      findUnique: vi.fn(async () => ({ ...site, user: { id: 'u1', email: 'sahip@ornek.com', name: 'Ayşe' } })),
    },
    article: {
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, title: data.title ?? 'Eski Başlık', ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      // Hat mevcut kaydi EXISTING_ARTICLE_SELECT ile okur; e-posta yolu tum satiri
      findUnique: vi.fn(async (args: any) => (args?.select?.agentOutputs
        ? (opts.existing === undefined ? liveRow() : opts.existing)
        : { id: 'a1', title: 'Kira', wordCount: 9, frontmatter: {}, editorScore: 80 })),
      count: vi.fn(async () => 3),
    },
    publishTarget: { findMany: vi.fn(async () => opts.targets ?? []) },
  };
  const runner = {
    run: vi.fn(async ({ agentName }: { agentName: string }) => ({
      output: agentName === '03-writer' ? DRAFT : agentName === '04-editor' ? (opts.editor ?? editorJson('PASS')) : `${agentName} cikti`,
      usage: {},
      costUsd: 0.25,
    })),
  };
  const email = { send: vi.fn(async () => undefined) };
  const schemaClassifier = {
    classify: vi.fn(async () => ({ primary: ['Article'], reasoning: 'test' })),
    buildJsonLd: vi.fn<(args: any) => unknown[]>(() => [{ '@type': 'Article' }]),
  };
  const settings = { getBoolean: vi.fn(async () => opts.aiDisabled === true) };
  const urlInventory = { getInventory: vi.fn(async () => []), isInternal: vi.fn(() => false), normalizePath: vi.fn(() => null) };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const qaGate = { checkSafe: vi.fn(async () => undefined) };
  const svc = new PipelineService(
    prisma as any, runner as any, email as any, schemaClassifier as any, settings as any,
    urlInventory as any, linkValidator as any, qaGate as any,
  );
  const writes = () => prisma.article.update.mock.calls.map((c: any) => c[0].data);
  const lastWrite = () => writes().at(-1);
  const jsonLdArgs = () => (schemaClassifier.buildJsonLd.mock.calls.at(-1) as any)?.[0];
  return { svc, prisma, email, qaGate, schemaClassifier, writes, lastWrite, jsonLdArgs };
}

const run = (c: ReturnType<typeof build>, extra: Record<string, unknown> = {}) =>
  c.svc.runPipeline({ siteId: 's1', topic: 'Kira', articleId: 'a1', skipImages: true, ...extra });

afterEach(() => { vi.useRealTimers(); });

describe('yayindaki yazinin yeniden yazimi (kullanici baslatti: kapali dongu "guncelle")', () => {
  it('PASS: slug korunur, JSON-LD canli adres + ilk yayin tarihi, dateModified bugun; canli metnin goruntusu saklanir', async () => {
    const c = build();
    const before = Date.now();
    const r = await run(c);
    expect(r.slug).toBe('eski-adres');
    const data = c.lastWrite();
    expect(data).toMatchObject({ slug: 'eski-adres', status: 'READY_TO_PUBLISH', title: 'Kira Artış Oranı Nasıl Hesaplanır?' });
    // JSON-LD: canli adres (WordPress kalici baglantisi), yeni slug'li uydurma adres degil
    const ld = c.jsonLdArgs().article;
    expect(ld.url).toBe(LIVE_URL);
    expect(ld.slug).toBe('eski-adres');
    expect(ld.datePublished).toBe(FIRST_AT.toISOString());
    expect(Date.parse(ld.dateModified)).toBeGreaterThanOrEqual(before);
    // Canli metin DB'de kaybolmaz
    expect(data.agentOutputs.liveSnapshot).toEqual({
      title: 'Eski Başlık', metaTitle: 'Eski Meta', metaDescription: 'Eski açıklama', bodyMd: '# Eski Başlık\n\nYayındaki metin.',
      faqs: [{ q: 'Eski soru?', a: 'Eski cevap.' }], schemaMarkup: { jsonLd: [{ '@type': 'Article', url: LIVE_URL }] },
      slug: 'eski-adres', publishedAt: FIRST_AT.toISOString(), takenAt: expect.any(String),
    });
    // Yeni ajan ciktilari da yazilir
    expect(data.agentOutputs.writer.output).toBe(DRAFT);
  });

  it('frontmatter (JSON ve govdedeki blok) da yayindaki adresi ve ilk yayin tarihini soyler', async () => {
    const c = build();
    await run(c);
    const data = c.lastWrite();
    expect(data.frontmatter).toMatchObject({ slug: 'eski-adres', date_published: '2026-01-05' });
    expect(data.bodyMd).toContain('\nslug: eski-adres\n');
    expect(data.bodyMd).toContain('\ndate_published: "2026-01-05"\n');
    expect(data.bodyMd).not.toContain('kira-artis-orani');
  });

  it('onceki metnin QA sonucu ve yayin parcasi (bodyHtml) yeni metne tasinmaz', async () => {
    const c = build();
    await run(c);
    expect(c.lastWrite()).toMatchObject({ qaStatus: null, qaCheckedAt: null, bodyHtml: null });
    expect(c.lastWrite().qaReport).toBe(Prisma.DbNull);
  });

  it('REVIZE: bugunku anlam korunur (kayit REVIZE_NEEDED ile ezilir) ama slug, tarih ve canli metin korunur', async () => {
    const c = build({ editor: editorJson('REVIZE', ['kaynaksız sayı']) });
    const r = await run(c);
    expect(r.editorVerdict).toBe('REVIZE');
    expect(r.liveKept).toBeUndefined();
    expect(c.lastWrite()).toMatchObject({ slug: 'eski-adres', status: 'REVIZE_NEEDED' });
    expect(c.lastWrite().agentOutputs.liveSnapshot.bodyMd).toBe('# Eski Başlık\n\nYayındaki metin.');
  });
});

describe('OTOMATIK yeniden yazim (icerik pivotu, automatedRewrite)', () => {
  it('editor PASS vermezse yayindaki kayit EZILMEZ: yalniz reddedilen taslagin ozeti agentOutputs\'a eklenir; QA ve e-posta yok', async () => {
    const c = build({ editor: editorJson('FAIL', ['kaynaksız sayı', 'uydurma atıf']) });
    const r = await run(c, { automatedRewrite: true });
    await flush();
    expect(r).toMatchObject({ liveKept: true, editorVerdict: 'FAIL', slug: 'eski-adres', title: 'Eski Başlık' });
    expect(c.writes()).toHaveLength(1);
    const data = c.writes()[0];
    // Metin, slug, durum, skor, QA: hicbiri yazilmaz
    expect(Object.keys(data)).toEqual(['agentOutputs']);
    // Onceki ajan ciktilari aynen kalir (panel editor olcegini geoGate'ten okur)
    expect(data.agentOutputs).toMatchObject(OLD_OUTPUTS);
    expect(data.agentOutputs.rejectedRewrite).toEqual({
      at: expect.any(String), topic: 'Kira', verdict: 'FAIL', score: 30, maxScore: 90,
      title: 'Kira Artış Oranı Nasıl Hesaplanır?', wordCount: expect.any(Number),
      blockingIssues: ['kaynaksız sayı', 'uydurma atıf'], geoGateIssues: [], totalCostUsd: expect.any(Number),
    });
    expect(c.qaGate.checkSafe).not.toHaveBeenCalled();
    expect(c.email.send).not.toHaveBeenCalled();
  });

  it('editor PASS verirse kaydi ezer (onaya duser ya da Tam otomatikte yayinlanir) — slug, tarih, goruntu kurallari ayni', async () => {
    const c = build();
    const r = await run(c, { automatedRewrite: true, notifyReady: false });
    expect(r.liveKept).toBeUndefined();
    expect(c.lastWrite()).toMatchObject({ slug: 'eski-adres', status: 'READY_TO_PUBLISH' });
    expect(c.lastWrite().agentOutputs.liveSnapshot.slug).toBe('eski-adres');
    expect(c.jsonLdArgs().article.datePublished).toBe(FIRST_AT.toISOString());
  });

  it('yazi artik yayinda degilse (kayitlari unutulmus, READY_TO_PUBLISH) bayrak kaydi korumaz: normal ezme', async () => {
    const c = build({ existing: liveRow({ status: 'READY_TO_PUBLISH', publishedTo: [] }), editor: editorJson('REVIZE') });
    const r = await run(c, { automatedRewrite: true });
    expect(r.liveKept).toBeUndefined();
    expect(c.lastWrite()).toMatchObject({ status: 'REVIZE_NEEDED', slug: 'kira-artis-orani' });
  });
});

describe('yayinda olmayan kayit (yer tutucu) — eski davranis', () => {
  it('slug LLM frontmatter\'indan normalize edilir, tarihler bugun, canli metin goruntusu yok', async () => {
    const c = build({ existing: { status: 'GENERATING', slug: 'generating-abc', publishedAt: null, publishedTo: null, agentOutputs: null } });
    const before = Date.now();
    await run(c);
    const data = c.lastWrite();
    expect(data.slug).toBe('kira-artis-orani');
    expect(data.agentOutputs).not.toHaveProperty('liveSnapshot');
    expect(data.frontmatter.date_published).toBe('2026-10-18');
    const ld = c.jsonLdArgs().article;
    expect(Date.parse(ld.datePublished)).toBeGreaterThanOrEqual(before);
    expect(ld.url).toBe('https://ornek.com/kira-artis-orani');
  });
});

describe('canli metin goruntusu yalniz GERCEKTEN canli olan metinden alinir', () => {
  it('kayit onaydaki (hic yayinlanmamis) bir yeniden yazimsa onceki goruntu korunur', async () => {
    const previous = { title: 'Canlıdaki', bodyMd: 'canlı metin', slug: 'eski-adres', takenAt: '2026-09-01T00:00:00.000Z' };
    const c = build({ existing: liveRow({ status: 'READY_TO_PUBLISH', title: 'Onaydaki taslak', agentOutputs: { liveSnapshot: previous } }) });
    await run(c);
    expect(c.lastWrite().agentOutputs.liveSnapshot).toEqual(previous);
    expect(c.lastWrite().slug).toBe('eski-adres');
  });

  it('canli adres sitede bilinmiyorsa (baska alan adindaki Ghost) JSON-LD korunan slug ile yol kuralindan', async () => {
    const c = build({ existing: liveRow({ publishedTo: [{ targetId: 't-ghost', targetType: 'GHOST', ok: true, externalId: 'g1', externalUrl: 'https://blog.baska.com/eski-adres/' }] }) });
    await run(c);
    expect(c.jsonLdArgs().article.url).toBe('https://ornek.com/eski-adres');
  });
});

describe('sahte hat (AI_GLOBAL_DISABLED) ayni kurallar', () => {
  it('yayindaki yazi: uretim boyunca durumu degismez; slug korunur, datePublished ilk yayin, dateModified var, goruntu saklanir', async () => {
    vi.useFakeTimers();
    const c = build({ aiDisabled: true });
    const p = run(c);
    await vi.runAllTimersAsync();
    await p;
    // GENERATING / EDITING yazimi yok: tek yazim, sonuc
    expect(c.writes()).toHaveLength(1);
    const data = c.writes()[0];
    expect(data.slug).toBe('eski-adres');
    expect(data.schemaMarkup[0].datePublished).toBe(FIRST_AT.toISOString());
    expect(typeof data.schemaMarkup[0].dateModified).toBe('string');
    expect(data.agentOutputs.liveSnapshot.bodyMd).toBe('# Eski Başlık\n\nYayındaki metin.');
    expect(data.qaStatus).toBeNull();
  });

  it('otomatik yeniden yazim sahte metni yayindaki yaziya YAZMAZ (kayda hic dokunulmaz)', async () => {
    const c = build({ aiDisabled: true });
    const r: any = await run(c, { automatedRewrite: true });
    expect(r).toMatchObject({ liveKept: true, mock: true, slug: 'eski-adres' });
    expect(c.writes()).toEqual([]);
  });

  it('yer tutucu (yayinda degil): eski davranis — GENERATING, EDITING, sonuc', async () => {
    vi.useFakeTimers();
    const c = build({ aiDisabled: true, existing: { status: 'GENERATING', slug: 'generating-x', publishedAt: null, publishedTo: null, agentOutputs: null } });
    const p = run(c);
    await vi.runAllTimersAsync();
    await p;
    expect(c.writes().map((d: any) => d.status)).toEqual(['GENERATING', 'EDITING', 'READY_TO_PUBLISH']);
    expect(c.writes()[2].slug).toBe('kira');
  });
});
