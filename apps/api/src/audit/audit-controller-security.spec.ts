import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SiteUserThrottlerGuard, SITE_USER_THROTTLE } from './site-user-throttler.guard.js';
import { PersonaChatThrottlerGuard } from './persona-chat-throttler.guard.js';
import { KnowledgeSubmitterService } from './knowledge-submitter.service.js';
import { SESSION_ONLY_KEY } from '../auth/session-only.decorator.js';
import { Reflector } from '@nestjs/core';

/**
 * AuditController — istemcinin belirlememesi gereken degerler ve model
 * cagiran uclarin sinirlari.
 *
 * Kurucu 38 bagimlilik aliyor ve vitest dekorator metadata'si uretmiyor:
 * nesne prototipten kurulur, yalniz handler'in kullandigi alanlar verilir
 * (audit-controller-scope.spec.ts ile ayni yontem). DTO dogrulamasi
 * audit-dto.spec.ts'te; burada handler'in DTO'dan gecmis govdeyi bile
 * servise nasil aktardigi sinanir.
 */
const { AuditController } = await import('./audit.controller.js');

const req = (id?: string) => ({ user: id ? { id } : undefined }) as any;

function controller(opts: { siteUrl?: string | null; stuck?: Record<string, { articleId: string | null }> } = {}) {
  const ctl = Object.create(AuditController.prototype) as any;
  ctl.prisma = {
    site: { findUnique: vi.fn(async () => (opts.siteUrl === null ? null : { url: opts.siteUrl ?? 'https://ornek.com' })) },
  };
  ctl.promptLab = {
    runPrompt: vi.fn(async () => ({ ok: true })),
    create: vi.fn(async () => ({ id: 'p1' })),
    update: vi.fn(async () => ({ id: 'p1' })),
    runAll: vi.fn(async () => ({ ran: 0 })),
    previewLocal: vi.fn(async () => ({ drafts: [] })),
    createLocal: vi.fn(async () => ({ created: 0 })),
  };
  ctl.knowledge = { buildWikidata: vi.fn(async () => ({ labels: { tr: { language: 'tr', value: 'Ornek' } }, createUrl: 'https://www.wikidata.org/wiki/Special:NewItem' })) };
  ctl.knowledgeSubmitter = new KnowledgeSubmitterService();
  ctl.pinger = { pingUrl: vi.fn(async () => ({ indexnow: true, google: false, bing: false, gsc: false })) };
  const stuck = opts.stuck ?? { sp1: { articleId: 'a1' }, sp2: { articleId: null } };
  ctl.stuckDetector = {
    getDetail: vi.fn(async (_siteId: string, id: string) => (stuck[id] ? { id, ...stuck[id] } : null)),
    list: vi.fn(async () => []),
  };
  ctl.stuckRecovery = {
    recover: vi.fn(async () => ({ success: true, recoveryId: 'r1' })),
    revert: vi.fn(async () => undefined),
    // Toplu onarim asenkron: uygun sayfalar kuyruga alinir (stuck-batch-result.ts)
    queueBatch: vi.fn(async (_siteId: string, ids: string[], _by: string, max: number) => ({
      results: ids.map((id, i) => (i < max ? { stuckPageId: id, id, queued: true } : { stuckPageId: id, id, queued: false, notProcessed: true, error: `Tek seferde en fazla ${max} sayfa kuyruğa alınır; bu sayfa işlenmedi, tekrar deneyin.` })),
      summary: { queued: Math.min(ids.length, max), notProcessed: Math.max(0, ids.length - max), failed: 0 },
    })),
  };
  ctl.stuckExternalRecovery = { recover: vi.fn(async () => ({ success: true, recoveryId: 'r2' })) };
  ctl.haro = { parseDigest: vi.fn(async () => []) };
  ctl.outreach = { findOpportunities: vi.fn(async () => []) };
  ctl.communityAgent = { scan: vi.fn(async () => ({})), list: vi.fn(async () => []), update: vi.fn(async () => ({})) };
  ctl.heatmap = { runForSite: vi.fn(async () => ({})) };
  ctl.opportunities = { reconcile: vi.fn(async () => undefined), list: vi.fn(async () => []) };
  ctl.personaChat = { ask: vi.fn(async () => ({ reply: 'ok', sources: [], cited: false })) };
  ctl.authorProfile = { buildForPersona: vi.fn(async () => ({})) };
  ctl.snippets = { generateForPage: vi.fn(async () => []), bulkScan: vi.fn(async () => ({})) };
  return ctl;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('prompts/:id/run — trigger istemciden ALINMAZ (aylik kota atlatma)', () => {
  it('govdede trigger:system olsa bile servise yalniz withFanout/providers gider', async () => {
    const ctl = controller();
    await ctl.runPrompt('s1', 'p1', { trigger: 'system', withFanout: true, providers: ['openai'], fanoutProviders: ['gemini'] });
    expect(ctl.promptLab.runPrompt).toHaveBeenCalledWith('s1', 'p1', { withFanout: true, providers: ['openai'], fanoutProviders: ['gemini'] });
    const opts = ctl.promptLab.runPrompt.mock.calls[0][2];
    expect('trigger' in opts).toBe(false);
  });

  it('run-all da govdeyi yaymaz', async () => {
    const ctl = controller();
    await ctl.runAllPrompts('s1', { withFanout: false, limit: 25, scope: 'local', trigger: 'system' });
    expect(ctl.promptLab.runAll).toHaveBeenCalledWith('s1', { withFanout: false, limit: 25, scope: 'local' });
  });
});

describe('prompts create/update — alanlar tek tek, source yok', () => {
  it('create: source:local servise ulasmaz', async () => {
    const ctl = controller();
    await ctl.createPrompt('s1', { text: 'Soru metni', intent: 'brand', source: 'local', tags: ['a'] });
    expect(ctl.promptLab.create).toHaveBeenCalledWith('s1', { text: 'Soru metni', intent: 'brand', locale: undefined, tags: ['a'] });
  });

  it('update: bilinmeyen alanlar servise ulasmaz', async () => {
    const ctl = controller();
    await ctl.updatePrompt('s1', 'p1', { isActive: false, source: 'local', siteId: 'baska' });
    expect(ctl.promptLab.update).toHaveBeenCalledWith('s1', 'p1', { text: undefined, intent: undefined, tags: undefined, isActive: false });
  });

  it('update: null alanlar "degistirme" sayilir (intent "null" metni, isActive false yazilmaz)', async () => {
    const ctl = controller();
    await ctl.updatePrompt('s1', 'p1', { intent: null, isActive: null, tags: null, text: null });
    expect(ctl.promptLab.update).toHaveBeenCalledWith('s1', 'p1', { text: undefined, intent: undefined, tags: undefined, isActive: undefined });
  });

  it('yerel onizleme / kayit: yalniz il, ilceler, hizmetler (+texts)', async () => {
    const ctl = controller();
    await ctl.previewLocalPrompts('s1', { il: 'İstanbul', ilceler: ['Kadıköy'], hizmetler: 'kuaför', extra: 1 });
    expect(ctl.promptLab.previewLocal).toHaveBeenCalledWith('s1', { il: 'İstanbul', ilceler: ['Kadıköy'], hizmetler: 'kuaför' });
    await ctl.createLocalPrompts('s1', { il: 'İzmir', hizmetler: ['berber'], texts: ['x'] });
    expect(ctl.promptLab.createLocal).toHaveBeenCalledWith('s1', { il: 'İzmir', ilceler: undefined, hizmetler: ['berber'], texts: ['x'] });
  });
});

describe('knowledge/submit — RanksUp bot hesabiyla gonderim yok', () => {
  it('istemci taslagi yok sayilir; sunucu taslagi elle ekleme icin doner, Wikidata cagrilmaz', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.WIKIDATA_BOT_USER = 'bot';
    process.env.WIKIDATA_BOT_PASS = 'pass';
    try {
      const ctl = controller();
      const r = await ctl.submitKnowledge('s1', { target: 'wikidata', draft: { labels: { tr: { language: 'tr', value: 'Sahte öğe' } } } });
      expect(ctl.knowledge.buildWikidata).toHaveBeenCalledWith('s1');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r).toMatchObject({ ok: false, manual: true, createUrl: 'https://www.wikidata.org/wiki/Special:NewItem' });
      expect(r.draft.labels.tr.value).toBe('Ornek');
      expect(r.warning).toMatch(/sizin adınıza öğe göndermez/);
    } finally {
      delete process.env.WIKIDATA_BOT_USER;
      delete process.env.WIKIDATA_BOT_PASS;
    }
  });

  it('wikipedia: taslak uretilmez (model cagrisi yok), elle ekleme yonlendirmesi', async () => {
    const ctl = controller();
    const r = await ctl.submitKnowledge('s1', { target: 'wikipedia', lang: 'en' });
    expect(ctl.knowledge.buildWikidata).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, manual: true, createUrl: 'https://en.wikipedia.org/wiki/Wikipedia:Articles_for_creation' });
  });
});

describe('index-ping kaldirildi; canli tarayici sirri yalniz oturumla', () => {
  it('index-ping rotasi yok (sahipligi dogrulanmayan site.url ile RanksUp anahtarlari kullanilabiliyordu)', () => {
    expect((AuditController.prototype as any).indexPing).toBeUndefined();
  });

  it('live-crawler snippets ve rotate-secret API anahtarina kapali (SessionOnly)', () => {
    const r = new Reflector();
    for (const m of ['liveCrawlerSnippets', 'liveCrawlerRotateSecret']) {
      expect(r.get(SESSION_ONLY_KEY, (AuditController.prototype as any)[m]), m).toBe(true);
    }
  });
});

describe('takili sayfa onarimi — denetim kaydindaki kisi oturumdan', () => {
  it('tekil: govdedeki triggeredBy yok sayilir, oturumdaki kullanici yazilir', async () => {
    const ctl = controller();
    await ctl.recoverStuckPage('s1', 'sp1', req('user-7'));
    expect(ctl.stuckRecovery.recover).toHaveBeenCalledWith('sp1', { triggeredBy: 'user-7' });
    await ctl.recoverStuckPage('s1', 'sp2', req('user-7'));
    expect(ctl.stuckExternalRecovery.recover).toHaveBeenCalledWith('sp2', { triggeredBy: 'user-7' });
    // Handler govde parametresi almiyor: imza (siteId, id, req)
    expect(AuditController.prototype.recoverStuckPage.length).toBe(3);
  });

  it('toplu: triggeredBy:autopilot gonderilse de oturum kimligi; kullanici yoksa manual', async () => {
    const ctl = controller();
    await ctl.recoverBatch('s1', { stuckPageIds: ['sp1', 'sp2', 'yok'], triggeredBy: 'autopilot' }, req('user-9'));
    expect(ctl.stuckRecovery.queueBatch).toHaveBeenCalledWith('s1', ['sp1', 'sp2', 'yok'], 'user-9', 50);
    await ctl.recoverBatch('s1', { stuckPageIds: ['sp1'] }, req());
    expect(ctl.stuckRecovery.queueBatch).toHaveBeenLastCalledWith('s1', ['sp1'], 'manual', 50);
    // Istek kurtarmayi beklemez: is kuyrukta (R14)
    expect(ctl.stuckRecovery.recover).not.toHaveBeenCalled();
    expect(ctl.stuckExternalRecovery.recover).not.toHaveBeenCalled();
  });

  it('toplu: 50 sonrasi sessizce dusmez, "islenmedi" olarak doner', async () => {
    const ids = Array.from({ length: 53 }, (_, i) => `x${i}`);
    const ctl = controller({ stuck: Object.fromEntries(ids.map((id) => [id, { articleId: 'a' }])) });
    const r = await ctl.recoverBatch('s1', { stuckPageIds: ids }, req('u1'));
    expect(ctl.stuckRecovery.queueBatch).toHaveBeenCalledWith('s1', ids, 'u1', 50);
    expect(r.results).toHaveLength(53);
    expect(r.results.slice(50).every((x: any) => x.queued === false && x.notProcessed === true && /en fazla 50 sayfa/.test(x.error))).toBe(true);
  });

  it('revert de oturum kimligi', async () => {
    const ctl = controller();
    await ctl.revertRecovery('s1', 'rec1', req('user-3'));
    expect(ctl.stuckRecovery.revert).toHaveBeenCalledWith('s1', 'rec1', 'user-3');
  });
});

describe('sorgu parametreleri yalniz duz metin', () => {
  it('stuck-pages: enum disi durum 400, nesne yok sayilir, limit sinirli', async () => {
    const ctl = controller();
    await expect(ctl.listStuckPages('s1', 'HACKED')).rejects.toBeInstanceOf(BadRequestException);
    await ctl.listStuckPages('s1', { not: 'IGNORED' } as any, '100000');
    expect(ctl.stuckDetector.list).toHaveBeenLastCalledWith('s1', { status: undefined, limit: 200 });
    await ctl.listStuckPages('s1', 'DETECTED', 'abc');
    expect(ctl.stuckDetector.list).toHaveBeenLastCalledWith('s1', { status: 'DETECTED', limit: undefined });
  });

  it('community PATCH: null alanlar degistirilmez (servis "null" metni yazardi)', async () => {
    const ctl = controller();
    await ctl.communityUpdate('s1', 'c1', { draftReply: null, status: null } as any);
    expect(ctl.communityAgent.update).toHaveBeenCalledWith('s1', 'c1', { status: undefined, draftReply: undefined });
    await ctl.communityUpdate('s1', 'c1', { status: 'POSTED' });
    expect(ctl.communityAgent.update).toHaveBeenLastCalledWith('s1', 'c1', { status: 'POSTED', draftReply: undefined });
  });

  it('opportunities / community: dizi ya da nesne status filtreye donusmez', async () => {
    const ctl = controller();
    await ctl.listOpportunities('s1', ['OPEN', 'PLANNED'] as any, { not: 'LOST' } as any);
    expect(ctl.opportunities.list).toHaveBeenCalledWith('s1', { status: undefined, coverage: undefined });
    await ctl.communityList('s1', { in: ['NEW'] } as any);
    expect(ctl.communityAgent.list).toHaveBeenCalledWith('s1', { status: undefined });
  });

  it('snippets: pageUrl dizisi 500 yerine anasayfa yoluna duser; author-profile persona kesilir', async () => {
    const ctl = controller();
    ctl.snippets.generateOrganizationJsonLd = vi.fn(async () => ({ type: 'organization' }));
    await ctl.getSnippets('s1', ['https://a', 'https://b'] as any);
    expect(ctl.snippets.generateForPage).toHaveBeenCalledWith('s1', 'https://ornek.com');
    await ctl.authorProfileGet('s1', 'x'.repeat(500));
    expect(ctl.authorProfile.buildForPersona).toHaveBeenCalledWith('s1', 'x'.repeat(80));
  });
});

describe('model cagrisi sayisi govdeyle buyumez', () => {
  it('haro/parse: 30 sorudan fazlasi 400, servis cagrilmaz', async () => {
    const ctl = controller();
    const digest = Array.from({ length: 31 }, (_, i) => `\n${i + 1}) Summary: konu ${i}\nQuery: soru ${i}`).join('');
    await expect(ctl.haroParse('s1', { emailContent: digest })).rejects.toThrow(/en fazla 30 HARO sorusu.*31 soru/);
    expect(ctl.haro.parseDigest).not.toHaveBeenCalled();
    const ok = Array.from({ length: 30 }, (_, i) => `\n${i + 1}) Summary: konu ${i}\nQuery: soru ${i}`).join('');
    await ctl.haroParse('s1', { emailContent: ok });
    expect(ctl.haro.parseDigest).toHaveBeenCalledWith('s1', ok);
  });

  it('community find/scan ve heatmap: servisin tavani yok, controller sikistirir', async () => {
    const ctl = controller();
    await ctl.findCommunity('s1', { limit: 1000 });
    expect(ctl.outreach.findOpportunities).toHaveBeenCalledWith('s1', { limit: 20 });
    await ctl.findCommunity('s1', {});
    expect(ctl.outreach.findOpportunities).toHaveBeenLastCalledWith('s1', { limit: 10 });
    await ctl.communityScan('s1', { limit: 500 });
    expect(ctl.communityAgent.scan).toHaveBeenCalledWith('s1', { limit: 20 });
    await ctl.geoHeatmap('s1', { maxQueries: 999 });
    expect(ctl.heatmap.runForSite).toHaveBeenCalledWith('s1', { maxQueries: 20 });
    await ctl.geoHeatmap('s1', {});
    expect(ctl.heatmap.runForSite).toHaveBeenLastCalledWith('s1', { maxQueries: 10 });
  });

  it('persona chat: gecmis dizi degilse servise bos liste gider (servis 400 verir)', async () => {
    const ctl = controller();
    await ctl.personaChatAsk('s1', { history: 'x' } as any);
    expect(ctl.personaChat.ask).toHaveBeenCalledWith('s1', []);
  });
});

describe('hiz siniri rota metadata', () => {
  const proto = AuditController.prototype as any;
  const limitOf = (h: string) => Reflect.getMetadata(`THROTTLER:LIMIT${SITE_USER_THROTTLE}`, proto[h]);
  const ttlOf = (h: string) => Reflect.getMetadata(`THROTTLER:TTL${SITE_USER_THROTTLE}`, proto[h]);
  const guardsOf = (h: string) => Reflect.getMetadata('__guards__', proto[h]) ?? [];

  it.each([
    ['crossLinkSuggest', 20, 60 * 60_000],
    ['findCommunity', 10, 60 * 60_000],
    ['communityScan', 10, 60 * 60_000],
    ['haroParse', 5, 60 * 60_000],
    ['wikipediaDraft', 10, 60 * 60_000],
    ['wikidataDraft', 30, 60 * 60_000],
    ['generateFanout', 30, 60 * 60_000],
    ['authorProfileGet', 30, 60 * 60_000],
    ['recoverStuckPage', 30, 60 * 60_000],
    ['recoverBatch', 5, 60 * 60_000],
  ])('%s: SiteUserThrottlerGuard %i istek / %i ms', (handler, limit, ttl) => {
    expect(guardsOf(handler as string)).toContain(SiteUserThrottlerGuard);
    expect(limitOf(handler as string)).toBe(limit);
    expect(ttlOf(handler as string)).toBe(ttl);
  });

  it('persona/chat: herkese acik + IP/site guard', () => {
    expect(Reflect.getMetadata('isPublic', proto.personaChatAsk)).toBe(true);
    expect(guardsOf('personaChatAsk')).toContain(PersonaChatThrottlerGuard);
  });
});
