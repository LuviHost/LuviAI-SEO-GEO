import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { contentTemplateBlock } from '@luviai/shared';

/**
 * Uretim hatti — icerik tipi sablonu ve gercek yazar teli (GEO Faz 4).
 *
 * Geriye uyumluluk: tip 'guide' ve yazar kaydi yoksa 02/03/04 ajan girdileri
 * BUGUNKUYLE BIREBIR AYNI (dize esitligi) ve kapi eski secenekle (bos) cagrilir.
 */

const gateCalls: Array<Record<string, unknown> | undefined> = [];
vi.mock('@luviai/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@luviai/shared')>();
  return {
    ...real,
    checkGeoGate: (_md: string, opts?: Record<string, unknown>) => {
      gateCalls.push(opts);
      return {
        pass: true,
        issues: [],
        feedback: '',
        stats: { questionRatio: 1, tables: 1, shortAnswerCovered: 1, contentH2: 1, unsourcedNumericClaims: 0, templateMissing: [] },
      };
    },
  };
});

const { PipelineService } = await import('./pipeline.service.js');

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

const DRAFT = [
  '---',
  'title: "Başlık"',
  'slug: baslik',
  '---',
  '# Başlık',
  '',
  'Gövde metni.',
].join('\n');

const EDITOR_PASS = [
  '```json',
  JSON.stringify({ verdict: 'PASS', scores: { yapi: 9 }, total: 80, blocking_issues: [], fixes: [], article_included: false }),
  '```',
].join('\n');

interface BuildOpts {
  storedAgentOutputs?: unknown;
  queue?: unknown;
  author?: unknown;
}

function build(opts: BuildOpts = {}) {
  const site = { id: 's1', name: 'Örnek', url: 'https://ornek.com', niche: 'emlak', language: 'tr', socialProfiles: [], brain: { brandVoice: {}, personas: [], competitors: [], seoStrategy: {}, glossary: [] } };
  const prisma = {
    site: {
      findUniqueOrThrow: vi.fn(async () => site),
      findUnique: vi.fn(async () => ({ ...site, user: { id: 'u1', email: 'sahip@ornek.com', name: 'Ayşe' } })),
    },
    article: {
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      findUnique: vi.fn(async (args: any) => (args?.select?.agentOutputs && Object.keys(args.select).length === 1
        ? { agentOutputs: opts.storedAgentOutputs ?? null }
        : { id: 'a1', title: 'Başlık', wordCount: 9, frontmatter: {}, editorScore: 80, status: 'GENERATING', slug: 'generating-x', publishedTo: null, agentOutputs: opts.storedAgentOutputs ?? null })),
      count: vi.fn(async () => 0),
    },
    topicQueue: { findFirst: vi.fn(async () => opts.queue ?? null) },
    kvStore: { findUnique: vi.fn(async () => (opts.author === undefined ? null : { value: JSON.stringify(opts.author) })) },
    publishTarget: { findMany: vi.fn(async () => []) },
  };
  const inputs: Record<string, string[]> = {};
  const runner = {
    run: vi.fn(async ({ agentName, input }: { agentName: string; input: string }) => {
      (inputs[agentName] ??= []).push(input);
      return {
        output: agentName === '03-writer' ? DRAFT : agentName === '04-editor' ? EDITOR_PASS : `${agentName} cikti`,
        usage: {},
        costUsd: 0,
      };
    }),
  };
  const email = { send: vi.fn(async () => undefined) };
  const schemaClassifier = {
    classify: vi.fn(async () => ({ primary: ['Article'], reasoning: 'test' })),
    buildJsonLd: vi.fn(() => [] as unknown[]),
  };
  const settings = { getBoolean: vi.fn(async () => false) };
  const urlInventory = { getInventory: vi.fn(async () => []), isInternal: vi.fn(() => false), normalizePath: vi.fn(() => null) };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const qaGate = { checkSafe: vi.fn(async () => undefined) };
  const svc = new PipelineService(
    prisma as any, runner as any, email as any, schemaClassifier as any, settings as any,
    urlInventory as any, linkValidator as any, qaGate as any,
  );
  return { svc, prisma, inputs, schemaClassifier };
}

/** buildJsonLd'ye verilen ilk arguman (mock cagri tipi bos tuple) */
const jsonLdArgs = (sc: ReturnType<typeof build>['schemaClassifier']) => (sc.buildJsonLd.mock.calls as unknown as any[][])[0][0];

const savedOutputs = (prisma: ReturnType<typeof build>['prisma']) => {
  const call = prisma.article.update.mock.calls.at(-1) as any;
  return call?.[0]?.data?.agentOutputs;
};

const TODAY = new Date().toISOString().slice(0, 10);
const DATE_NOTE = `\n\n[ZORUNLU: Bugünün tarihi ${TODAY}. Frontmatter'da date_published bu olacak. Geçmiş yıl YASAK. Kod-fence sarmalama yok.]`;

beforeEach(() => {
  gateCalls.length = 0;
});

describe('runPipeline — rehber yolu (tip yok, yazar yok): girdiler bugunkuyle birebir ayni', () => {
  it('02/03/04 girdileri dize esitligiyle eski formul; kapi bos secenekle; JSON-LD author null', async () => {
    const { svc, inputs, prisma, schemaClassifier } = build();
    await svc.runPipeline({ siteId: 's1', topic: 'Kira Artış Oranı', articleId: 'a1', skipImages: true });

    expect(inputs['01-keyword']).toEqual(['Konu: Kira Artış Oranı']);
    expect(inputs['02-outline']).toEqual(['01-keyword cikti']);
    expect(inputs['03-writer']).toEqual([`02-outline cikti${DATE_NOTE}`]);
    expect(inputs['04-editor']).toEqual([`${DRAFT}${DATE_NOTE}`]);
    for (const o of gateCalls) expect(o).toEqual({});

    expect(jsonLdArgs(schemaClassifier).article.author).toBeNull();
    expect(savedOutputs(prisma).contentPlan).toEqual({ type: 'guide', source: 'default' });
  });
});

describe('runPipeline — tip secimi ve sablon blogu', () => {
  it('baslik siniflandiricisi: "X vs Y" → comparison blogu taslak, yazar ve editor girdisinde', async () => {
    const { svc, inputs, prisma } = build();
    await svc.runPipeline({ siteId: 's1', topic: 'Shopify vs WooCommerce', articleId: 'a1', skipImages: true });

    expect(inputs['02-outline'][0]).toBe(`${contentTemplateBlock('comparison', 'outline')}\n\n---\n\n01-keyword cikti`);
    expect(inputs['03-writer'][0]).toBe(`${contentTemplateBlock('comparison', 'writer')}\n\n---\n\n02-outline cikti${DATE_NOTE}`);
    expect(inputs['04-editor'][0].startsWith(contentTemplateBlock('comparison', 'editor'))).toBe(true);
    // 01-keyword degismez
    expect(inputs['01-keyword']).toEqual(['Konu: Shopify vs WooCommerce']);
    expect(gateCalls.every((o) => o?.contentType === 'comparison')).toBe(true);
    expect(savedOutputs(prisma).contentPlan).toEqual({ type: 'comparison', source: 'classifier' });
  });

  it('siralayicinin content_type alani siniflandiriciyi ezer', async () => {
    const queue = { tier1Topics: [{ topic: 'Shopify vs WooCommerce', content_type: 'best_for' }], tier2Topics: [], tier3Topics: [] };
    const { svc, inputs, prisma } = build({ queue });
    await svc.runPipeline({ siteId: 's1', topic: 'Shopify vs WooCommerce', articleId: 'a1', skipImages: true });
    expect(inputs['03-writer'][0]).toContain('EN İYİ SEÇENEKLER');
    expect(savedOutputs(prisma).contentPlan).toEqual({ type: 'best_for', source: 'ranker' });
  });

  it('kayittaki acik secim siralayici ve siniflandiriciyi ezer; uretim sonrasi korunur', async () => {
    const queue = { tier1Topics: [{ topic: 'Shopify vs WooCommerce', content_type: 'best_for' }], tier2Topics: [], tier3Topics: [] };
    const { svc, inputs, prisma } = build({ queue, storedAgentOutputs: { contentPlan: { type: 'pricing', source: 'explicit' } } });
    await svc.runPipeline({ siteId: 's1', topic: 'Shopify vs WooCommerce', articleId: 'a1', skipImages: true });
    expect(inputs['03-writer'][0]).toContain('FİYATLAR');
    expect(prisma.topicQueue.findFirst).not.toHaveBeenCalled();
    expect(savedOutputs(prisma).contentPlan).toEqual({ type: 'pricing', source: 'explicit' });
  });

  it('takvimde kayda yazilmis siralayici karari kuyruk degisse de kullanilir', async () => {
    const { svc, inputs, prisma } = build({ storedAgentOutputs: { contentPlan: { type: 'howto', source: 'ranker' } } });
    await svc.runPipeline({ siteId: 's1', topic: 'E-Fatura', articleId: 'a1', skipImages: true });
    expect(inputs['03-writer'][0]).toContain('NASIL YAPILIR');
    expect(prisma.topicQueue.findFirst).not.toHaveBeenCalled();
    expect(savedOutputs(prisma).contentPlan).toEqual({ type: 'howto', source: 'ranker' });
  });

  it('kuyruk okuma hatasi uretimi durdurmaz (siniflandiriciya duser)', async () => {
    const { svc, prisma, inputs } = build();
    prisma.topicQueue.findFirst.mockRejectedValueOnce(new Error('db down'));
    await svc.runPipeline({ siteId: 's1', topic: 'Paraşüt Fiyatları', articleId: 'a1', skipImages: true });
    expect(inputs['03-writer'][0]).toContain('FİYATLAR');
  });
});

describe('runPipeline — gercek yazar teli (author-profile.service readSiteAuthor)', () => {
  it('kayitli yazar: JSON-LD author Person alanlari, yazar/editor girdisinde gorunur satir notu, kapi adla olcer', async () => {
    const author = { name: 'Ayşe Yılmaz', url: 'https://ornek.com/yazar/ayse', sameAs: ['https://www.linkedin.com/in/ayse'], jobTitle: 'Mali müşavir' };
    const { svc, inputs, schemaClassifier, prisma } = build({ author });
    await svc.runPipeline({ siteId: 's1', topic: 'Kira Artış Oranı', articleId: 'a1', skipImages: true });

    expect(prisma.kvStore.findUnique).toHaveBeenCalledWith({ where: { key: 'site-author:s1' } });
    expect(jsonLdArgs(schemaClassifier).article.author).toEqual({
      name: 'Ayşe Yılmaz',
      url: 'https://ornek.com/yazar/ayse',
      sameAs: ['https://www.linkedin.com/in/ayse'],
      jobTitle: 'Mali müşavir',
    });
    expect(inputs['03-writer'][0]).toContain('"**Bu makale Ayşe Yılmaz tarafından hazırlandı.**"');
    expect(inputs['04-editor'][0]).toContain('Ayşe Yılmaz tarafından hazırlandı');
    expect(gateCalls.every((o) => o?.authorName === 'Ayşe Yılmaz')).toBe(true);
  });

  it('adsiz / bozuk kayit yazar sayilmaz: Organization (author null), girdi degismez', async () => {
    const { svc, inputs, schemaClassifier } = build({ author: { url: 'https://x.com' } });
    await svc.runPipeline({ siteId: 's1', topic: 'Kira Artış Oranı', articleId: 'a1', skipImages: true });
    expect(jsonLdArgs(schemaClassifier).article.author).toBeNull();
    expect(inputs['03-writer']).toEqual([`02-outline cikti${DATE_NOTE}`]);
  });
});
