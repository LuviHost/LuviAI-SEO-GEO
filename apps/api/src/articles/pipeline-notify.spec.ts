import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';

/**
 * "Makale hazir, onayini bekliyor" e-postasi yalniz yazi GERCEKTEN onay
 * beklerken gider. Sablonlar "Henuz yayinda degil — inceleyip yayina alman
 * gerekiyor" der; Tam otomatikte worker yaziyi uretimin hemen ardindan
 * yayinliyordu ve musteriye yayindaki yazi icin yanlis e-posta gidiyordu.
 */

// GEO kapisi deterministik ve kendi testleri var (geo-gate.spec.ts); burada
// editor PASS'inin e-posta dalina ulasmasi icin gecer sayilir
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
  'meta_title: "Kira Artış Oranı"',
  'meta_description: "Kira artış oranının hesaplanması."',
  '---',
  '# Kira Artış Oranı Nasıl Hesaplanır?',
  '',
  'Gövde metni.',
].join('\n');

const EDITOR_PASS = [
  '```json',
  JSON.stringify({ verdict: 'PASS', scores: { yapi: 9 }, total: 80, blocking_issues: [], fixes: [], article_included: false }),
  '```',
].join('\n');

const flush = () => new Promise((r) => setTimeout(r, 0));

function build(opts: { earlierArticles?: number; editorOutput?: string } = {}) {
  const site = { id: 's1', name: 'Site', url: 'https://ornek.com', niche: 'emlak', language: 'tr', socialProfiles: [], brain: { brandVoice: {}, personas: [], competitors: [], seoStrategy: {}, glossary: [] } };
  const prisma = {
    site: {
      findUniqueOrThrow: vi.fn(async () => site),
      findUnique: vi.fn(async () => ({ ...site, user: { id: 'u1', email: 'sahip@ornek.com', name: 'Ayşe' } })),
    },
    article: {
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      findUnique: vi.fn(async () => ({ id: 'a1', title: 'Kira Artış Oranı Nasıl Hesaplanır?', wordCount: 9, frontmatter: {}, editorScore: 80 })),
      count: vi.fn(async () => opts.earlierArticles ?? 0),
    },
    publishTarget: { findMany: vi.fn(async () => []) },
  };
  const runner = {
    run: vi.fn(async ({ agentName }: { agentName: string }) => ({
      output: agentName === '03-writer' ? DRAFT : agentName === '04-editor' ? (opts.editorOutput ?? EDITOR_PASS) : `${agentName} cikti`,
      usage: {},
      costUsd: 0,
    })),
  };
  const email = { send: vi.fn(async () => undefined) };
  const schemaClassifier = {
    classify: vi.fn(async () => ({ primary: ['Article'], reasoning: 'test' })),
    buildJsonLd: vi.fn(() => []),
  };
  const settings = { getBoolean: vi.fn(async () => false) };
  const urlInventory = { getInventory: vi.fn(async () => []), isInternal: vi.fn(() => false), normalizePath: vi.fn(() => null) };
  const linkValidator = { validateArticleMarkdown: vi.fn(async (_s: string, md: string) => ({ bodyMd: md, report: { remapped: 0, unlinked: 0 } })) };
  const qaGate = { checkSafe: vi.fn(async () => undefined) };
  const svc = new PipelineService(
    prisma as any, runner as any, email as any, schemaClassifier as any, settings as any,
    urlInventory as any, linkValidator as any, qaGate as any,
  );
  return { svc, prisma, email };
}

describe('runPipeline — notifyReady', () => {
  it('varsayilan: PASS olan yazi icin "onayini bekliyor" e-postasi gider (eski davranis)', async () => {
    const { svc, email } = build();
    const r = await svc.runPipeline({ siteId: 's1', topic: 'Kira', articleId: 'a1', skipImages: true });
    expect(r.editorVerdict).toBe('PASS');
    await flush();
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'sahip@ornek.com', template: 'first_article_published' }));
  });

  it('notifyReady: false (worker hemen yayinlayacak): e-posta YOK, yazi yine READY_TO_PUBLISH kaydedilir', async () => {
    const { svc, email, prisma } = build();
    const r = await svc.runPipeline({ siteId: 's1', topic: 'Kira', articleId: 'a1', skipImages: true, notifyReady: false });
    expect(r.editorVerdict).toBe('PASS');
    await flush();
    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.article.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY_TO_PUBLISH' }) }));
  });

  it('PASS olmayan yazi icin e-posta zaten yok', async () => {
    const editor = ['```json', JSON.stringify({ verdict: 'FAIL', scores: { yapi: 2 }, total: 20, blocking_issues: ['kaynaksiz sayi'] }), '```'].join('\n');
    const { svc, email } = build({ editorOutput: editor });
    const r = await svc.runPipeline({ siteId: 's1', topic: 'Kira', articleId: 'a1', skipImages: true });
    expect(r.editorVerdict).toBe('FAIL');
    await flush();
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('notifyArticleReady — worker yayinlayamadiginda kendisi cagirir (public)', () => {
  it('ilk hazir yazi icin first_article_published, sonrakiler icin article_ready', async () => {
    const first = build({ earlierArticles: 0 });
    await first.svc.notifyArticleReady('s1', 'a1');
    expect(first.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'first_article_published', userId: 'u1' }));
    const later = build({ earlierArticles: 3 });
    await later.svc.notifyArticleReady('s1', 'a1');
    expect(later.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'article_ready', data: expect.objectContaining({ articlesPublished: 4 }) }));
  });

  it('daha once yayinlanmis yazinin yeniden yazimi "İlk makalen hazır" sayilmaz (sitede baska yazi olmasa da)', async () => {
    for (const published of [{ publishedAt: new Date('2026-01-05T10:00:00Z') }, { publishedTo: [{ targetId: 't-wp', ok: true }] }]) {
      const c = build({ earlierArticles: 0 });
      c.prisma.article.findUnique.mockResolvedValueOnce({ id: 'a1', title: 'Kira', wordCount: 9, frontmatter: {}, editorScore: 80, ...published } as any);
      await c.svc.notifyArticleReady('s1', 'a1');
      expect(c.email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'article_ready' }));
    }
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — onay e-postasi', () => {
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('GENERATE_ARTICLE: async'), src.indexOf('PUBLISH_ARTICLE: async'));

  it('hemen yayinlanacak yazi icin pipeline e-postasi kapali', () => {
    expect(handler).toContain('notifyReady: !plan.publish');
  });

  it('yayin planlanip olmadiysa (mod degisti, QA engeli, hicbir hedef yazamadi) e-posta worker\'dan gider', () => {
    expect(handler).toContain('services.pipeline.notifyArticleReady(siteId, result.articleId)');
    // Uretim sirasinda Yari otomatige gecildi
    expect(handler).toMatch(/if \(!now\.publish\) \{[\s\S]*?notifyAwaitingApproval\(\);[\s\S]*?publishSkipped: now\.reason/);
    // Hedeflerin hicbiri yazamadi (hata / hedef yok): karar republish-policy.ts
    // autoPublishFollowUp'ta; TUM hedefler bilerek atlandiysa e-posta YOK (yazinin eski hali yayinda)
    expect(handler).toMatch(/const follow = autoPublishFollowUp\(publishResults\);\s*if \(follow\.notifyAwaitingApproval\) notifyAwaitingApproval\(\);/);
    // QA engeli vb. yayin hatasi
    expect(handler).toMatch(/\} catch \(err: any\) \{[\s\S]*?notifyAwaitingApproval\(\);\s*return \{ \.\.\.result, publishError:/);
    // Sahte (mock) icerik test modudur: e-posta yok (mock hat hic gondermez)
    const mockBranch = handler.slice(handler.indexOf('if (plan.publish && (result as any).mock)'), handler.indexOf("publishSkipped: 'mock'"));
    expect(mockBranch).not.toContain('notifyAwaitingApproval');
  });
});
