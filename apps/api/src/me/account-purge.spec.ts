import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { promptLocalKey } from '../audit/prompt-local-key.js';
import {
  PURGE_EXEMPT, purgeCallProblems, purgePlanProblems, purgeScopeTokens, purgeSteps, recordPurgeCalls,
  type PurgeIds, type PurgeStep,
} from './account-purge.plan.js';
import { AccountPurgeService } from './account-purge.service.js';

// ── Sema okuma: hangi modeller kullaniciya / siteye bagli? ─────────────────
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

function linkedModels(): Set<string> {
  const linked = new Set<string>();
  for (const [model, fields] of Object.entries(MODELS)) {
    if (model === 'User' || model === 'Site') continue;
    if (fields.some((f) => f.name === 'userId' || f.name === 'siteId' || (!f.list && (f.type === 'User' || f.type === 'Site')))) linked.add(model);
  }
  // Kayitla eslesen landing abonesi (signupUserId) — adi userId degil ama kisinin verisi
  linked.add('PublicCitationSubscriber');
  // Kapanis: bagli modele FK ile bagli her model de bagli
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of RELATIONS) {
      if (r.child !== 'User' && r.child !== 'Site' && !linked.has(r.child) && linked.has(r.parent)) {
        linked.add(r.child);
        grew = true;
      }
    }
  }
  return linked;
}

/**
 * cuid biciminde (25 karakter) kimlikler: kapsam denetimi "kosul degeri kimligi
 * icerir" kuralina dayanir; kisa kimlikte ('s1') tesadufi eslesme anlamsizlastirirdi.
 */
const cid = (tag: string) => `cm${tag}`.padEnd(25, 'x');
const IDS: PurgeIds = {
  userId: cid('user'), email: 'ayse@ornek.com.tr', siteIds: [cid('site1'), cid('site2')], trackedAppIds: [cid('app')],
  trackedAppKeywordIds: [cid('appkw')], asaAccountIds: [cid('asaacc')], asaCampaignIds: [cid('asacmp')], asaAdGroupIds: [cid('asagrp')],
  ascAccountIds: [cid('ascacc')], ascAppIds: [cid('ascapp')], sdkConfigIds: [cid('sdk')], socialChannelIds: [cid('chan')],
  stuckPageIds: [cid('stuck')], geoPromptIds: [cid('prompt1'), cid('prompt2')], chatConversationIds: [cid('chat')],
  subscriberIds: [cid('sub')], affiliateId: cid('aff'), affiliateRefCode: 'ayse-x1y2',
};
/** Sitesi, alt kaydi ve ortakligi olmayan hesap: x.siteIds[0] gibi undefined filtreler burada patlar */
const EMPTY: PurgeIds = {
  userId: cid('user'), email: 'ayse@ornek.com.tr', siteIds: [], trackedAppIds: [], trackedAppKeywordIds: [],
  asaAccountIds: [], asaCampaignIds: [], asaAdGroupIds: [], ascAccountIds: [], ascAppIds: [], sdkConfigIds: [],
  socialChannelIds: [], stuckPageIds: [], geoPromptIds: [], chatConversationIds: [], subscriberIds: [],
  affiliateId: null, affiliateRefCode: null,
};

describe('kalici silme plani — sema kapsami', () => {
  const steps = purgeSteps(IDS);
  const planned = new Set(steps.map((s) => s.model));

  it('kullaniciya/siteye bagli HER model planda ya da gerekceli istisnada (yeni tablo unutulursa kirilir)', () => {
    const missing = [...linkedModels()].filter((m) => !planned.has(m) && !(m in PURGE_EXEMPT));
    expect(missing).toEqual([]);
  });

  it('plandaki her model semada var (yazim hatasi yok)', () => {
    expect([...planned].filter((m) => !MODELS[m])).toEqual([]);
  });

  it('once muhasebe kayitlari koparilir, en son site ve kullanici silinir', () => {
    expect(steps.slice(0, 2).map((s) => [s.model, s.kind])).toEqual([['Invoice', 'detach'], ['VideoCreditPurchase', 'detach']]);
    expect(steps.some((s) => (s.model === 'Invoice' || s.model === 'VideoCreditPurchase') && s.kind === 'delete')).toBe(false);
    expect(steps.slice(-2).map((s) => [s.model, s.kind])).toEqual([['Site', 'delete'], ['User', 'delete']]);
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
});

// ── Her adimin GERCEKTE ne yaptigi: tablo, yontem, filtre ─────────────────
// Kapsam testleri yalniz step.model etiketine bakiyordu; yanlis tabloya ya da
// filtresiz yazan bir adim yesil geciyordu (bkz. site-removal.spec.ts ayni denetim).
describe('kalici silme plani — adimlarin yazdigi yer ve filtre', () => {
  it.each([['tam hesap', IDS], ['sitesi/alt kaydi olmayan hesap', EMPTY]] as const)(
    '%s: her adim etiketindeki tabloya, turune uyan yontemle ve hesaba daraltilmis filtreyle yazar',
    async (_ad, ids) => {
      const steps = purgeSteps(ids);
      const calls = await recordPurgeCalls(steps);
      expect(calls).toHaveLength(steps.length);
      for (const c of calls) {
        expect(c.accessor, `#${c.step} ${c.model}`).toBe(c.model[0].toLowerCase() + c.model.slice(1));
        expect(c.method, `#${c.step} ${c.model}`).toBe(c.kind === 'delete' ? 'deleteMany' : 'updateMany');
        expect(c.args?.where, `#${c.step} ${c.model}`).toBeTruthy();
      }
      expect(purgeCallProblems(steps, calls, purgeScopeTokens(ids))).toEqual([]);
      expect(await purgePlanProblems(steps, ids)).toEqual([]);
    },
  );

  it('buyuk hesapta (on binlerce siralama kimligi) denetim hizli kalir', async () => {
    const big: PurgeIds = {
      ...IDS,
      trackedAppKeywordIds: Array.from({ length: 20_000 }, (_, i) => cid(`kw${i}`)),
      geoPromptIds: Array.from({ length: 400 }, (_, i) => cid(`gp${i}`)),
    };
    const t0 = Date.now();
    expect(await purgePlanProblems(purgeSteps(big), big)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('kopar (detach) adimlari yalniz NULL yazar ve yalniz bos birakilabilen kolonlara', async () => {
    const detached = (await recordPurgeCalls(purgeSteps(IDS))).filter((c) => c.kind === 'detach');
    expect(detached.length).toBeGreaterThan(5);
    for (const c of detached) {
      for (const [col, val] of Object.entries(c.args.data ?? {})) {
        expect(val, `${c.model}.${col}`).toBeNull();
        expect(MODELS[c.model].find((f) => f.name === col)?.optional, `${c.model}.${col}`).toBe(true);
      }
    }
  });

  it('denetimin kendisi bos gecmiyor: filtresiz, undefined filtreli, yanlis tabloya yazan ve yontemi uymayan adim yakalanir', async () => {
    const userId = IDS.userId;
    const bad: PurgeStep[] = [
      { model: 'Article', kind: 'delete', run: (db) => db.article.deleteMany({ where: {} }) },
      { model: 'Notification', kind: 'delete', run: (db) => db.notification.deleteMany({ where: { siteId: undefined } as any }) },
      { model: 'AppReview', kind: 'delete', run: (db) => db.trackedApp.deleteMany({ where: { userId } as any }) },
      { model: 'Job', kind: 'detach', run: (db) => db.job.deleteMany({ where: { userId } }) },
      { model: 'Testimonial', kind: 'delete', run: (db) => db.testimonial.deleteMany({ where: { userId: { not: userId } } }) },
      { model: 'UsageEvent', kind: 'delete', run: (db) => db.usageEvent.deleteMany({ where: { OR: [{ userId }, { siteId: { notIn: [] } }] } }) },
    ];
    const problems = purgeCallProblems(bad, await recordPurgeCalls(bad), purgeScopeTokens(IDS));
    for (const label of ['#0 Article', '#1 Notification', '#2 AppReview', '#3 Job', '#4 Testimonial', '#5 UsageEvent']) {
      expect(problems.some((p) => p.startsWith(label)), label).toBe(true);
    }
    // Hic cagri yapmayan adim da yakalanir
    const silent: PurgeStep[] = [{ model: 'Video', kind: 'delete', run: async () => ({ count: 0 }) }];
    expect(purgeCallProblems(silent, await recordPurgeCalls(silent), purgeScopeTokens(IDS))).toEqual(['#0 Video: 0 çağrı (tam 1 bekleniyor)']);
  });

  it('Prompt Lab yerel sonuclari (telefon/adres) prompt kimligiyle, prompt satirlarindan ONCE silinir', async () => {
    const calls = await recordPurgeCalls(purgeSteps(IDS));
    const local = calls.find((c) => c.model === 'KvStore' && JSON.stringify(c.args.where).includes('prompt-local:'));
    expect(local?.args).toEqual({ where: { key: { in: IDS.geoPromptIds.map(promptLocalKey) } } });
    expect(promptLocalKey(IDS.geoPromptIds[0])).toBe(`prompt-local:${IDS.geoPromptIds[0]}`);
    const promptDelete = calls.find((c) => c.model === 'GeoPrompt');
    expect(local!.step).toBeLessThan(promptDelete!.step);
  });

  it('ASA durum anahtarlari (secilen reklam hesabi kimligi vb.; suresi yok) ASA hesap kimligiyle, hesap satirindan ONCE silinir', async () => {
    const calls = await recordPurgeCalls(purgeSteps(IDS));
    const asa = calls.find((c) => c.model === 'KvStore' && JSON.stringify(c.args.where).includes('asa:'));
    const id = IDS.asaAccountIds[0];
    expect(asa?.args).toEqual({ where: { key: { in: [`asa:platform-ad-account:${id}`, `asa:sync-api-version:${id}`, `asa:perf-installs-backfill:${id}`] } } });
    expect(asa!.step).toBeLessThan(calls.find((c) => c.model === 'AsaAccount')!.step);
  });
});

// ── Davranis: sahte veritabani ────────────────────────────────────────────
function makeDb(opts: { user: any; invoices?: any[]; credits?: any[]; failOn?: string }) {
  const state = {
    user: opts.user ? { ...opts.user } : null,
    invoices: (opts.invoices ?? []).map((r) => ({ ...r })),
    credits: (opts.credits ?? []).map((r) => ({ ...r })),
    emailLogs: [] as any[],
  };
  const writes: string[] = [];
  const handlers: Record<string, (a: any) => any> = {
    'user.findUnique': () => (state.user ? { ...state.user } : null),
    'user.deleteMany': ({ where }: any) => {
      if (state.user?.id === where.id) { state.user = null; return { count: 1 }; }
      return { count: 0 };
    },
    'site.findMany': () => (state.user ? [{ id: 's1' }] : []),
    'affiliate.findUnique': () => null,
    'invoice.updateMany': ({ where, data }: any) => {
      const rows = state.invoices.filter((r) => r.userId === where.userId);
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    'videoCreditPurchase.updateMany': ({ where, data }: any) => {
      const rows = state.credits.filter((r) => r.userId === where.userId);
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    'emailLog.deleteMany': ({ where }: any) => {
      const before = state.emailLogs.length;
      state.emailLogs = state.emailLogs.filter((l) => !(l.to === where.to && l.userId == null) && !(where.OR && (l.userId === 'u1' || l.to === 'a@b.co')));
      return { count: before - state.emailLogs.length };
    },
  };
  const db: any = new Proxy({}, {
    get(_t, model: string) {
      if (model === 'then') return undefined;
      return new Proxy({}, {
        get(_t2, method: string) {
          return async (args: any) => {
            const key = `${model}.${method}`;
            if (opts.failOn === key) throw new Error(`${key} patladi`);
            if (!/^find|count/.test(method)) writes.push(key);
            const h = handlers[key];
            if (h) return h(args);
            return method === 'findMany' ? [] : method.endsWith('Many') ? { count: 0 } : null;
          };
        },
      });
    },
  });
  const email = {
    sendRaw: vi.fn(async (o: any) => {
      state.emailLogs.push({ to: o.to, userId: o.userId ?? null, subject: o.subject });
      return { ok: true };
    }),
  };
  return { db, state, writes, email };
}

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T03:45:00Z');
const dueUser = { id: 'u1', email: 'a@b.co', name: 'Ayşe', deletionRequestedAt: new Date(NOW.getTime() - 31 * DAY) };

describe('kalici silme isi', () => {
  it('fatura ve odeme kayitlari SAKLANIR, kisiyle baglantisi kopar; hesap silinir; tamamlandi e-postasi gider ve izi kalmaz', async () => {
    const t = makeDb({
      user: dueUser,
      invoices: [
        { id: 'i1', userId: 'u1', amount: 1499, status: 'PAID', paytrTransactionId: 'LUVIabcdefghPRO1' },
        { id: 'i2', userId: 'u1', amount: 1499, status: 'FAILED', paytrTransactionId: 'LUVIabcdefghPRO2' },
        { id: 'i3', userId: 'baska', amount: 999, status: 'PAID', paytrTransactionId: 'LUVIzzzzzzzzSTA3' },
      ],
      credits: [{ id: 'c1', userId: 'u1', priceTry: 499, status: 'PAID' }],
    });
    const svc = new AccountPurgeService(t.db, t.email as any);
    const r = await svc.purgeUser('u1', NOW);

    expect(r).toEqual({ purged: true, retainedInvoices: 2, retainedCreditPurchases: 1 });
    expect(t.state.invoices).toHaveLength(3);
    expect(t.state.invoices.filter((i) => i.userId === null).map((i) => [i.id, i.amount, i.status])).toEqual([['i1', 1499, 'PAID'], ['i2', 1499, 'FAILED']]);
    expect(t.state.invoices.find((i) => i.id === 'i3')!.userId).toBe('baska');
    expect(t.state.credits[0]).toMatchObject({ userId: null, priceTry: 499, status: 'PAID' });
    expect(t.state.user).toBeNull();
    // Muhasebe adimi tum silmelerden once
    expect(t.writes[0]).toBe('invoice.updateMany');
    expect(t.writes.indexOf('user.deleteMany')).toBe(t.writes.length - 2); // ardindan yalniz onay e-postasi izinin silinmesi
    expect(t.email.sendRaw).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.co', subject: 'Hesabın silindi' }));
    expect(t.state.emailLogs).toEqual([]);
  });

  it('tekrar calistirmak guvenli: silinmis hesapta hicbir sey yazilmaz', async () => {
    const t = makeDb({ user: dueUser });
    const svc = new AccountPurgeService(t.db, t.email as any);
    await svc.purgeUser('u1', NOW);
    const writesAfterFirst = t.writes.length;
    expect(await svc.purgeUser('u1', NOW)).toEqual({ purged: false, reason: 'not_found' });
    expect(t.writes.length).toBe(writesAfterFirst);
    expect(t.email.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('30 gun dolmadan ya da talep yokken ASLA silmez', async () => {
    for (const user of [
      { ...dueUser, deletionRequestedAt: new Date(NOW.getTime() - 29 * DAY) },
      { ...dueUser, deletionRequestedAt: null },
    ]) {
      const t = makeDb({ user });
      const svc = new AccountPurgeService(t.db, t.email as any);
      expect(await svc.purgeUser('u1', NOW)).toEqual({ purged: false, reason: 'not_due' });
      expect(t.writes).toEqual([]);
      expect(t.email.sendRaw).not.toHaveBeenCalled();
    }
  });

  it('yarida kalan silmede kullanici satiri silinmez, onay e-postasi gitmez (ertesi tur tamamlar)', async () => {
    const t = makeDb({ user: dueUser, failOn: 'article.deleteMany' });
    const svc = new AccountPurgeService(t.db, t.email as any);
    await expect(svc.purgeUser('u1', NOW)).rejects.toThrow('article.deleteMany patladi');
    expect(t.state.user).not.toBeNull();
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });

  it('gunluk tur: yalniz suresi dolanlari secer, hata alan hesap turu durdurmaz ve ayni turda tekrar secilmez', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValueOnce([]);
    const prisma: any = { user: { findMany } };
    const svc = new AccountPurgeService(prisma, {} as any);
    const purgeUser = vi.spyOn(svc, 'purgeUser')
      .mockRejectedValueOnce(new Error('FK'))
      .mockResolvedValueOnce({ purged: true, retainedInvoices: 0, retainedCreditPurchases: 0 });
    const r = await svc.purgeDue(NOW);
    expect(r).toEqual({ purged: 1, failed: 1 });
    expect(purgeUser).toHaveBeenCalledTimes(2);
    const firstWhere = findMany.mock.calls[0][0].where;
    expect(firstWhere.deletionRequestedAt).toEqual({ not: null, lte: new Date(NOW.getTime() - 30 * DAY) });
    expect(findMany.mock.calls[1][0].where.id).toEqual({ notIn: ['u1'] });
  });
});
