import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  SitesService, SITE_REMOVAL_EXEMPT, SITE_REMOVAL_TX, siteRemovalSteps, type SiteRemovalIds, type SiteRemovalStep,
} from './sites.service.js';
import { promptLocalKey } from '../audit/prompt-local-key.js';
import { asaStateKeys } from '../me/unscoped-kv-keys.js';
import { whereProblem } from '../me/scoped-where.js';

/**
 * Site silme — yetim satir kalmaz, her sey tek transaction'da.
 *
 * NEDEN VAR: remove() eskiden yalniz `site.delete` cagiriyordu ve DB cascade'ine
 * guveniyordu. ai_citation_snapshots, ai_citation_runs, ai_referrer_hits,
 * ai_crawler_hits, usage_events, testimonials semada siteId'ye iliskisiz; bazi
 * uretim tablolarinda FK hic yok. Silinen sitenin olcum ve bot kayitlari
 * tabloda kaliyordu. Bu test semaya bakar: siteye bagli YENI bir model eklenip
 * plana (sites.service.ts siteRemovalSteps) konmazsa kirilir.
 */

// ── Sema okuma ────────────────────────────────────────────────────────────
const SCHEMA = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

interface Field { name: string; type: string; list: boolean; optional: boolean; relation: boolean }
const MODELS: Record<string, Field[]> = {};
for (const m of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  MODELS[m[1]] = m[2]
    .split('\n')
    .map((line) => line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/))
    .filter((x): x is RegExpMatchArray => !!x && !x[1].startsWith('@@'))
    .map((x) => ({
      name: x[1], type: x[2], list: !!x[3], optional: !!x[4],
      relation: /@relation\(/.test(x[5]) && /fields:/.test(x[5]),
    }));
}
/** Cocuk -> ebeveyn iliskileri (FK tasiyan taraf) */
const RELATIONS = Object.entries(MODELS).flatMap(([model, fields]) =>
  fields.filter((f) => f.relation && !f.list && MODELS[f.type]).map((f) => ({ child: model, parent: f.type })));

const hasSiteIdColumn = (model: string) => MODELS[model].some((f) => f.name === 'siteId');
const hasSiteRelation = (model: string) => MODELS[model].some((f) => !f.list && f.type === 'Site');

/** Siteye dogrudan (siteId / Site iliskisi) ya da FK zinciriyle bagli her model */
function siteLinkedModels(): Set<string> {
  const linked = new Set(Object.keys(MODELS).filter((m) => m !== 'Site' && m !== 'User' && (hasSiteIdColumn(m) || hasSiteRelation(m))));
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of RELATIONS) {
      if (r.child !== 'Site' && r.child !== 'User' && !linked.has(r.child) && linked.has(r.parent)) {
        linked.add(r.child);
        grew = true;
      }
    }
  }
  return linked;
}

/** cuid biciminde (25 karakter) — kv "icerir" filtresi yalniz boyle kimlikte kullanilir */
const SITE = 'cmsitexxxxxxxxxxxxxxxxx01';
const IDS: SiteRemovalIds = {
  siteId: SITE, trackedAppIds: ['ta1'], trackedAppKeywordIds: ['tk1'], asaAccountIds: ['aa1'], asaCampaignIds: ['ac1'],
  asaAdGroupIds: ['ag1'], ascAccountIds: ['sa1'], ascAppIds: ['sp1'], sdkConfigIds: ['sd1'], socialChannelIds: ['ch1'],
  stuckPageIds: ['st1'], geoPromptIds: ['gp1'], chatConversationIds: ['cc1'], queuedBullJobIds: ['bull-1'],
};

interface Recorded { stepModel: string; kind: string; accessor: string; method: string; args: any }
async function recordSteps(steps: SiteRemovalStep[] = siteRemovalSteps(IDS)): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  for (const step of steps) {
    const db: any = new Proxy({}, {
      get(_t, accessor: string) {
        return new Proxy({}, {
          get(_t2, method: string) {
            return async (args: any) => {
              recorded.push({ stepModel: step.model, kind: step.kind, accessor, method, args });
              return { count: 0 };
            };
          },
        });
      },
    });
    await step.run(db);
  }
  return recorded;
}

const filtersSite = (where: unknown, siteId = SITE) => JSON.stringify(where ?? {}).includes(`"siteId":"${siteId}"`);

/** Siteye bagli olup planda da istisnada da olmayan modeller */
function unplanned(steps: SiteRemovalStep[]): string[] {
  const planned = new Set(steps.map((s) => s.model));
  return [...siteLinkedModels()].filter((m) => !planned.has(m) && !(m in SITE_REMOVAL_EXEMPT)).sort();
}

/** siteId kolonu olup semada Site iliskisi (FK, cascade) OLMAYAN modeller */
const relationlessModels = () => Object.keys(MODELS).filter((m) => m !== 'Site' && hasSiteIdColumn(m) && !hasSiteRelation(m));

/** Iliskisiz modellerden siteId ile temizlenmeyenler */
async function unhandledRelationless(steps: SiteRemovalStep[]): Promise<string[]> {
  const recorded = await recordSteps(steps);
  return relationlessModels().filter((m) => !recorded.some((r) => r.stepModel === m && filtersSite(r.args?.where))).sort();
}

describe('site silme plani — sema kapsami', () => {
  const steps = siteRemovalSteps(IDS);
  const planned = new Set(steps.map((s) => s.model));

  it('siteye bagli HER model planda ya da gerekceli istisnada (yeni tablo unutulursa kirilir)', () => {
    // Kapanis calisiyor mu: dogrudan bagli ve yalniz FK zinciriyle bagli ornekler kumede
    expect([...siteLinkedModels()]).toEqual(expect.arrayContaining(['Audit', 'AiCrawlerHit', 'Testimonial', 'AppRanking', 'ChatMessage', 'AsaKeywordBid', 'StuckPageRecovery']));
    expect(unplanned(steps)).toEqual([]);
  });

  it('plandaki ve istisnadaki her model semada var (yazim hatasi yok)', () => {
    expect([...planned, ...Object.keys(SITE_REMOVAL_EXEMPT)].filter((m) => !MODELS[m])).toEqual([]);
  });

  it('semada Site iliskisi OLMAYAN siteId tablolari (FK yok, cascade yok) siteId ile temizlenir', async () => {
    // Ayristirici dogru calisiyor mu: bilinen iliskisiz tablolar listede
    expect(relationlessModels()).toEqual(expect.arrayContaining([
      'AiCitationSnapshot', 'AiCitationRun', 'AiReferrerHit', 'AiCrawlerHit', 'UsageEvent', 'Testimonial', 'GeoFanoutQuery', 'GeoPromptRun',
    ]));
    expect(await unhandledRelationless(steps)).toEqual([]);
  });

  it('denetimin kendisi bos gecmiyor: plandan dusen adim yakalanir', async () => {
    const dropped = steps.filter((s) => s.model !== 'AiCrawlerHit' && s.model !== 'StuckPageRecovery');
    expect(unplanned(dropped)).toEqual(['AiCrawlerHit', 'StuckPageRecovery']);
    expect(await unhandledRelationless(dropped)).toEqual(['AiCrawlerHit']);
  });

  it('siteId kolonu olan HER tablo dogrudan siteId ile secilir (uretimde eksik FK\'ya guvenilmez)', async () => {
    const recorded = await recordSteps();
    const withColumn = Object.keys(MODELS).filter((m) => m !== 'Site' && hasSiteIdColumn(m) && planned.has(m));
    expect(withColumn.filter((m) => !recorded.some((r) => r.stepModel === m && filtersSite(r.args?.where)))).toEqual([]);
  });

  it('her adim etiketlendigi modelin tablosuna yazar; delete -> deleteMany, detach -> updateMany', async () => {
    for (const r of await recordSteps()) {
      expect(r.accessor, r.stepModel).toBe(r.stepModel[0].toLowerCase() + r.stepModel.slice(1));
      expect(r.method, r.stepModel).toBe(r.kind === 'delete' ? 'deleteMany' : 'updateMany');
    }
  });

  it('her adimin filtresi silinen siteye daraltilmis; bos {} ya da undefined filtre yok (alt kaydi olmayan site dahil)', async () => {
    const empty: SiteRemovalIds = {
      ...IDS, trackedAppIds: [], trackedAppKeywordIds: [], asaAccountIds: [], asaCampaignIds: [], asaAdGroupIds: [],
      ascAccountIds: [], ascAppIds: [], sdkConfigIds: [], socialChannelIds: [], stuckPageIds: [], geoPromptIds: [], chatConversationIds: [],
    };
    for (const ids of [IDS, empty]) {
      const tokens = [ids.siteId, ...Object.values(ids).filter((v): v is string[] => Array.isArray(v)).flat()];
      const problems = (await recordSteps(siteRemovalSteps(ids)))
        .map((r) => [r.stepModel, whereProblem(r.args?.where, tokens)])
        .filter(([, p]) => p);
      expect(problems).toEqual([]);
    }
    // Denetim bos gecmiyor: filtresi dusen adim yakalanir
    expect(whereProblem({}, [SITE])).not.toBeNull();
    expect(whereProblem({ siteId: undefined }, [SITE])).not.toBeNull();
  });

  it('baglanti koparma yalniz bos birakilabilen siteId kolonunda (zorunlu kolon NULL olamaz)', async () => {
    const detached = (await recordSteps()).filter((r) => r.args?.data && 'siteId' in r.args.data);
    expect(detached.map((r) => r.stepModel).sort()).toEqual(['Job', 'SocialMediaAsset', 'Testimonial', 'TokenUsageRecord']);
    for (const r of detached) {
      expect(r.args.data.siteId).toBeNull();
      expect(MODELS[r.stepModel].find((f) => f.name === 'siteId')?.optional, r.stepModel).toBe(true);
    }
  });

  it('her cocuk tablo ebeveyninden ONCE silinir (RESTRICT FK olsa bile takilmaz)', () => {
    const firstDelete = (m: string) => steps.findIndex((s) => s.model === m && s.kind === 'delete');
    const lastDelete = (m: string) => steps.map((s) => s.model === m && s.kind === 'delete').lastIndexOf(true);
    const violations = RELATIONS
      .filter((r) => r.child !== r.parent && firstDelete(r.child) >= 0 && firstDelete(r.parent) >= 0)
      .filter((r) => lastDelete(r.child) > firstDelete(r.parent))
      .map((r) => `${r.child} -> ${r.parent}`);
    expect(violations).toEqual([]);
  });

  it('kuyruktaki is once iptal edilir, sonra site baglantisi kopar', async () => {
    const jobs = (await recordSteps()).filter((r) => r.stepModel === 'Job');
    expect(jobs.map((r) => r.args)).toEqual([
      { where: { siteId: SITE, status: 'QUEUED' }, data: { status: 'CANCELED' } },
      { where: { siteId: SITE }, data: { siteId: null } },
    ]);
  });

  it('kv_store: cuid kimlikte site anahtarlarinin hepsi, kisa kimlikte yalniz erisim kaydi', async () => {
    const kv = (await recordSteps()).filter((r) => r.stepModel === 'KvStore').at(-1);
    expect(kv?.args).toEqual({ where: { key: { contains: SITE } } });
    const short = (await recordSteps(siteRemovalSteps({ ...IDS, siteId: 's1' }))).filter((r) => r.stepModel === 'KvStore').at(-1);
    expect(short?.args).toEqual({ where: { key: 'crawl-access:s1' } });
  });

  it('Prompt Lab yerel sonuclari (telefon/adres; anahtarda site kimligi yok) prompt kimligiyle, prompt satirlarindan once silinir', async () => {
    const recorded = await recordSteps();
    const local = recorded.findIndex((r) => r.stepModel === 'KvStore' && JSON.stringify(r.args.where).includes('prompt-local:'));
    expect(recorded[local]?.args).toEqual({ where: { key: { in: [promptLocalKey('gp1')] } } });
    expect(promptLocalKey('gp1')).toBe('prompt-local:gp1');
    expect(local).toBeLessThan(recorded.findIndex((r) => r.stepModel === 'GeoPrompt'));
    // Prompt'u olmayan site: bos liste hicbir satir secmez (filtresiz silme degil)
    const none = (await recordSteps(siteRemovalSteps({ ...IDS, geoPromptIds: [] }))).find((r) => r.stepModel === 'KvStore');
    expect(none?.args).toEqual({ where: { key: { in: [] } } });
  });

  it('ASA durum anahtarlari (anahtarda yalniz ASA hesap kimligi, suresi yok) hesap satirindan once silinir', async () => {
    const recorded = await recordSteps();
    const asa = recorded.findIndex((r) => r.stepModel === 'KvStore' && JSON.stringify(r.args.where).includes('asa:'));
    expect(recorded[asa]?.args).toEqual({
      where: { key: { in: ['asa:platform-ad-account:aa1', 'asa:sync-api-version:aa1', 'asa:perf-installs-backfill:aa1'] } },
    });
    expect(asa).toBeLessThan(recorded.findIndex((r) => r.stepModel === 'AsaAccount'));
  });
});

// ── Davranis: sahte veritabani ────────────────────────────────────────────
interface Call { key: string; args: any; inTx: boolean }

function makeDb(opts: { owner?: string; queued?: string[]; failOn?: string; deleteError?: string } = {}) {
  const calls: Call[] = [];
  const tx = { count: 0, options: null as any };
  const handlers: Record<string, (args: any) => any> = {
    'site.findUnique': ({ where }) => (where.id === SITE ? { id: SITE, userId: opts.owner ?? 'u1', ingestSecret: 'sir', gscRefreshToken: 'enc:rt' } : null),
    'trackedApp.findMany': () => [{ id: 'ta1' }],
    'trackedAppKeyword.findMany': () => [{ id: 'tk1' }],
    'asaAccount.findMany': () => [{ id: 'aa1' }],
    'asaCampaign.findMany': () => [{ id: 'ac1' }],
    'asaAdGroup.findMany': () => [{ id: 'ag1' }],
    'ascAccount.findMany': () => [{ id: 'sa1' }],
    'ascApp.findMany': () => [{ id: 'sp1' }],
    'sdkAppConfig.findMany': () => [{ id: 'sd1' }],
    'socialChannel.findMany': () => [{ id: 'ch1' }],
    'stuckPage.findMany': () => [{ id: 'st1' }],
    'geoPrompt.findMany': () => [{ id: 'gp1' }],
    'chatConversation.findMany': () => [{ id: 'cc1' }],
    'job.findMany': () => (opts.queued ?? ['bull-1', 'article:a1']).map((bullJobId) => ({ bullJobId })),
    'site.delete': ({ where }) => {
      if (opts.deleteError) throw Object.assign(new Error('Record to delete does not exist.'), { code: opts.deleteError });
      return { id: where.id, name: 'Örnek', url: 'https://ornek.com' };
    },
  };
  const client = (inTx: boolean): any => new Proxy({}, {
    get(_t, model: string) {
      if (model === 'then') return undefined;
      if (model === '$transaction') {
        return async (fn: (t: any) => Promise<unknown>, options: unknown) => {
          tx.count++;
          tx.options = options;
          return fn(client(true));
        };
      }
      return new Proxy({}, {
        get(_t2, method: string) {
          return async (args: any) => {
            const key = `${model}.${method}`;
            calls.push({ key, args, inTx });
            if (opts.failOn === key) throw new Error(`${key} patladi`);
            const h = handlers[key];
            if (h) return h(args);
            return method === 'findMany' ? [] : method.endsWith('Many') ? { count: 0 } : null;
          };
        },
      });
    },
  });
  const jobQueue = {
    removeJob: vi.fn(async (jobId: string) => {
      calls.push({ key: 'queue.removeJob', args: jobId, inTx: false });
      return true;
    }),
  };
  const svc = new SitesService(client(false), jobQueue as never, null as never);
  return { svc, calls, tx, jobQueue };
}

const isWrite = (c: Call) => !/^(find|count)/.test(c.key.split('.')[1]) && c.key !== 'queue.removeJob';

describe('SitesService.remove', () => {
  it('baskasinin sitesi: 403, hicbir yazim ve transaction yok', async () => {
    const t = makeDb({ owner: 'baska' });
    await expect(t.svc.remove(SITE, { id: 'u1', role: 'USER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.calls.filter(isWrite)).toEqual([]);
    expect(t.tx.count).toBe(0);
    expect(t.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('tum yazimlar TEK transaction icinde; site satiri en son ve sirlar cevapta yok', async () => {
    const t = makeDb();
    const deleted = await t.svc.remove(SITE, { id: 'u1', role: 'USER' });
    expect(t.tx.count).toBe(1);
    expect(t.tx.options).toEqual(SITE_REMOVAL_TX);
    expect(SITE_REMOVAL_TX.timeout).toBeGreaterThanOrEqual(60_000);
    const writes = t.calls.filter(isWrite);
    expect(writes.length).toBeGreaterThan(50);
    expect(writes.every((c) => c.inTx)).toBe(true);
    const last = writes[writes.length - 1];
    expect(last.key).toBe('site.delete');
    expect(last.args.where).toEqual({ id: SITE });
    expect(last.args.omit).toMatchObject({ ingestSecret: true, gscRefreshToken: true, gaRefreshToken: true, googleAdsRefreshToken: true, metaAdsAccessToken: true });
    expect(deleted).toEqual({ id: SITE, name: 'Örnek', url: 'https://ornek.com' });
  });

  it('iliskisiz tablolar siteId ile silinir, kullanici yorumu kalir (yalniz site baglantisi kopar)', async () => {
    const t = makeDb();
    await t.svc.remove(SITE, { id: 'u1', role: 'USER' });
    for (const accessor of ['aiCitationSnapshot', 'aiCitationRun', 'aiReferrerHit', 'aiCrawlerHit', 'usageEvent', 'gscAiVisibilitySnapshot']) {
      expect(t.calls.find((c) => c.key === `${accessor}.deleteMany`)?.args, accessor).toEqual({ where: { siteId: SITE } });
    }
    expect(t.calls.find((c) => c.key === 'geoPromptRun.deleteMany')?.args).toEqual({ where: { OR: [{ siteId: SITE }, { promptId: { in: ['gp1'] } }] } });
    expect(t.calls.some((c) => c.key === 'testimonial.deleteMany')).toBe(false);
    expect(t.calls.find((c) => c.key === 'testimonial.updateMany')?.args).toEqual({ where: { siteId: SITE }, data: { siteId: null } });
    expect(t.calls.filter((c) => c.key === 'kvStore.deleteMany').map((c) => c.args)).toEqual([
      { where: { key: { in: ['prompt-local:gp1'] } } },
      { where: { key: { in: asaStateKeys(['aa1']) } } },
      { where: { key: { contains: SITE } } },
    ]);
  });

  it('kuyruktaki isler iptal edilir; BullMQ karsiliklari commit SONRASI silinir', async () => {
    const t = makeDb({ queued: ['bull-1', 'article:a1'] });
    await t.svc.remove(SITE, { id: 'u1', role: 'USER' });
    expect(t.calls.find((c) => c.key === 'job.findMany')?.args.where).toEqual({ siteId: SITE, status: 'QUEUED', bullJobId: { not: null } });
    expect(t.jobQueue.removeJob.mock.calls.map((c) => c[0])).toEqual(['bull-1', 'article:a1']);
    const deleteAt = t.calls.findIndex((c) => c.key === 'site.delete');
    const firstRemove = t.calls.findIndex((c) => c.key === 'queue.removeJob');
    expect(firstRemove).toBeGreaterThan(deleteAt);
  });

  it('kuyruktan silme hatasi silmeyi bozmaz (worker iptal edilmis isi zaten atlar)', async () => {
    const t = makeDb({ queued: ['bull-1'] });
    t.jobQueue.removeJob.mockRejectedValueOnce(new Error('redis yok'));
    await expect(t.svc.remove(SITE, { id: 'u1', role: 'USER' })).resolves.toMatchObject({ id: SITE });
  });

  it('yarida hata: site silinmez, kuyruga dokunulmaz, hata yukari cikar', async () => {
    const t = makeDb({ failOn: 'aiCrawlerHit.deleteMany' });
    await expect(t.svc.remove(SITE, { id: 'u1', role: 'USER' })).rejects.toThrow('aiCrawlerHit.deleteMany patladi');
    expect(t.calls.some((c) => c.key === 'site.delete')).toBe(false);
    expect(t.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('es zamanli ikinci silme (P2025): 404, 500 degil', async () => {
    const t = makeDb({ deleteError: 'P2025' });
    await expect(t.svc.remove(SITE, { id: 'u1', role: 'USER' })).rejects.toBeInstanceOf(NotFoundException);
    expect(t.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('yonetici baskasinin sitesini silebilir', async () => {
    const t = makeDb({ owner: 'baska' });
    await expect(t.svc.remove(SITE, { id: 'admin1', role: 'ADMIN' })).resolves.toMatchObject({ id: SITE });
  });
});
