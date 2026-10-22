import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccountDeletionService, freezeAccountData } from './account-deletion.service.js';
import { PaytrService } from '../billing/paytr.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { DELETE_ACCOUNT_CONFIRMATION } from './account-deletion.policy.js';
import { whereProblem } from './scoped-where.js';

type Call = { model: string; method: string; args: any; inTx?: boolean };

/**
 * Kayit tutan sahte Prisma: her `model.method(args)` cagrisi saklanir.
 * $transaction ayni nesneyle calisir (tx === db) — yazimlarin transaction
 * icinde yapildigi `inTx` bayragiyla ayrica izlenir.
 */
function makeDb(user: Record<string, any> | null, opts: { clientCount?: number; appleAccounts?: any[]; claimCount?: number; queuedJobs?: any[]; siteCount?: number } = {}) {
  const calls: (Call & { inTx: boolean })[] = [];
  let inTx = false;
  const handlers: Record<string, (args: any) => any> = {
    'user.findUnique': () => (user ? { ...user } : null),
    'user.count': () => opts.clientCount ?? 0,
    'site.count': () => opts.siteCount ?? 0,
    'user.updateMany': () => ({ count: opts.claimCount ?? 1 }),
    'user.update': ({ data }: any) => ({ id: user?.id, email: user?.email, name: user?.name, plan: user?.plan, ...data }),
    'account.findMany': () => opts.appleAccounts ?? [],
    'job.findMany': () => opts.queuedJobs ?? [],
    'invoice.findFirst': () => null,
  };
  const db: any = new Proxy({}, {
    get(_t, model: string) {
      if (model === 'then') return undefined;
      if (model === '$transaction') {
        return async (fn: (tx: any) => Promise<any>) => {
          inTx = true;
          try { return await fn(db); } finally { inTx = false; }
        };
      }
      return new Proxy({}, {
        get(_t2, method: string) {
          return async (args: any) => {
            calls.push({ model, method, args, inTx });
            const h = handlers[`${model}.${method}`];
            if (h) return h(args);
            return method.endsWith('Many') ? { count: 0 } : null;
          };
        },
      });
    },
  });
  return { db, calls };
}

function makeService(dbBundle: ReturnType<typeof makeDb>, appleOutcome = 'not_linked') {
  const email = { send: vi.fn(async () => ({ ok: true })), sendRaw: vi.fn(async () => ({ ok: true })) };
  // Gercek iptal mantigi (PaytrService.cancelSubscription) ve gercek anahtar iptali kullanilir
  const paytr = new PaytrService(dbBundle.db, { recordCommission: vi.fn() } as any, email as any, {} as any);
  const cancelSpy = vi.spyOn(paytr, 'cancelSubscription');
  const apiKeys = new ApiKeysService(dbBundle.db);
  const apple = { configured: false, revokeForDeletion: vi.fn(async () => appleOutcome) };
  const queue = { removeJob: vi.fn(async () => true) };
  const svc = new AccountDeletionService(dbBundle.db, paytr, email as any, apiKeys, apple as any, queue as any);
  return { svc, email, cancelSpy, apple, queue };
}

const ACTIVE_USER = { id: 'u1', email: 'a@b.co', name: 'Ayşe', role: 'USER', plan: 'PRO', subscriptionStatus: 'ACTIVE', deletionRequestedAt: null };

const find = (calls: Call[], model: string, method: string) => calls.filter((c) => c.model === model && c.method === method);

describe('hesap silme talebi', () => {
  it('onay degeri yoksa hicbir sey yazilmaz', async () => {
    const b = makeDb(ACTIVE_USER);
    const { svc } = makeService(b);
    await expect(svc.requestDeletion('u1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.requestDeletion('u1', { confirm: 'evet' })).rejects.toBeInstanceOf(BadRequestException);
    expect(b.calls.filter((c) => c.method !== 'findUnique')).toEqual([]);
  });

  it('abonelik billing iptaliyle durur, anahtarlar ve oturumlar iptal, giris engeli icin talep ani yazilir', async () => {
    const b = makeDb(ACTIVE_USER);
    const { svc, email, cancelSpy } = makeService(b);
    const before = Date.now();
    const r = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });

    // Talep: kosullu yazim + otomatik yenileme kapali + kart anahtari silindi
    const claim = find(b.calls, 'user', 'updateMany')[0];
    expect(claim.inTx).toBe(true);
    expect(claim.args.where).toEqual({ id: 'u1', deletionRequestedAt: null });
    expect(claim.args.data).toMatchObject({ autoRenew: false, paytrUtoken: null, emailVerified: null });
    expect(claim.args.data.deletionRequestedAt).toBeInstanceOf(Date);

    // Abonelik: mevcut iptal mantigi, transaction icinde, "donem sonuna kadar acik" e-postasi YOK
    expect(cancelSpy).toHaveBeenCalledWith('u1', expect.objectContaining({ notify: false }));
    const cancel = find(b.calls, 'user', 'update')[0];
    expect(cancel.inTx).toBe(true);
    expect(cancel.args.data).toEqual({ subscriptionStatus: 'CANCELED', autoRenew: false });
    expect(email.send).not.toHaveBeenCalled();

    // API anahtarlari + oturumlar + OAuth token'lari
    const keys = find(b.calls, 'apiKey', 'updateMany')[0];
    expect(keys.args.where).toEqual({ userId: 'u1', revokedAt: null });
    expect(keys.args.data.revokedAt).toBeInstanceOf(Date);
    expect(find(b.calls, 'session', 'deleteMany')[0].args).toEqual({ where: { userId: 'u1' } });
    expect(find(b.calls, 'account', 'updateMany')[0].args).toEqual({
      where: { userId: 'u1' },
      data: { access_token: null, refresh_token: null, id_token: null },
    });

    // Otomasyon durdu, ucuncu taraf giris bilgileri silindi — her yazim YALNIZ bu
    // kullanicinin kayitlarina (toEqual: filtre parcasi dusurulurse kirilir)
    const sites = find(b.calls, 'site', 'updateMany')[0];
    expect(sites.args.where).toEqual({ userId: 'u1' });
    expect(sites.args.data).toMatchObject({ status: 'PAUSED', autopilot: false, adsAutopilot: false, autoGenerationEnabled: false, gscRefreshToken: null, metaAdsAccessToken: null });
    expect(find(b.calls, 'article', 'updateMany').map((c) => c.args)).toEqual([
      { where: { site: { userId: 'u1' }, status: 'SCHEDULED' }, data: { status: 'DRAFT' } },
    ]);
    for (const model of ['publishTarget', 'siteAiProviderKey']) {
      expect(find(b.calls, model, 'deleteMany').map((c) => c.args), model).toEqual([{ where: { site: { userId: 'u1' } } }]);
    }
    for (const model of ['socialChannel', 'asaAccount', 'ascAccount', 'sdkAppConfig', 'trackedApp']) {
      expect(find(b.calls, model, 'updateMany').map((c) => c.args.where), model).toEqual([{ site: { userId: 'u1' } }]);
    }
    expect(find(b.calls, 'socialRecurringSlot', 'updateMany').map((c) => c.args.where)).toEqual([{ channel: { site: { userId: 'u1' } } }]);
    const posts = find(b.calls, 'socialPost', 'updateMany');
    expect(posts.map((c) => c.args)).toEqual([{
      where: { channel: { site: { userId: 'u1' } }, status: { in: ['NEEDS_APPROVAL', 'APPROVED', 'QUEUED'] } },
      data: { status: 'CANCELED' },
    }]);
    expect(find(b.calls, 'asaAccount', 'updateMany')[0].args.data).toMatchObject({ isActive: false, autoPilotEnabled: false, encryptedKey: '' });

    // Genel bekci: transaction icindeki HER yazim yalniz bu kullaniciya daraltilmis;
    // { site: { userId: undefined } } ya da {} (Prisma'da "filtre yok") yakalanir.
    const writes = b.calls.filter((c) => c.inTx && /^(update|delete|create|upsert)/.test(c.method));
    expect(writes.length).toBeGreaterThan(10);
    expect(writes.map((w) => [`${w.model}.${w.method}`, whereProblem(w.args?.where, ['u1'])]).filter(([, p]) => p)).toEqual([]);

    // Hicbir icerik silinmez (30 gun bekler): site/makale/kullanici delete yok
    expect(b.calls.some((c) => c.method.startsWith('delete') && ['site', 'article', 'user', 'invoice'].includes(c.model))).toBe(false);

    expect(r.alreadyRequested).toBe(false);
    expect(new Date(r.purgeAfter).getTime() - new Date(r.deletionRequestedAt).getTime()).toBe(30 * 86_400_000);
    expect(new Date(r.deletionRequestedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(email.sendRaw).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.co', subject: 'Hesap silme talebin alındı' }));
  });

  it('deneme hesabinda iptal edilecek abonelik yok — billing iptali cagrilmaz', async () => {
    const b = makeDb({ ...ACTIVE_USER, plan: 'TRIAL', subscriptionStatus: 'TRIAL' });
    const { svc, cancelSpy } = makeService(b);
    await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    expect(cancelSpy).not.toHaveBeenCalled();
    // Yine de otomatik yenileme kapatilir
    expect(find(b.calls, 'user', 'updateMany')[0].args.data.autoRenew).toBe(false);
  });

  it('inceleme: tutarsiz eski satir (plan TRIAL + durum ACTIVE) silinebilir; billing iptali cagrilmaz (400 transaction\'i dusururdu)', async () => {
    const b = makeDb({ ...ACTIVE_USER, plan: 'TRIAL', subscriptionStatus: 'ACTIVE' });
    const { svc, cancelSpy } = makeService(b);
    const r = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    expect(r.alreadyRequested).toBe(false);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(find(b.calls, 'user', 'update')).toEqual([]);
  });

  it('ajans sahibinin bagli musterisi varken silme 409 ile engellenir, hicbir sey yazilmaz', async () => {
    const b = makeDb({ ...ACTIVE_USER, role: 'AGENCY_OWNER' }, { clientCount: 2 });
    const { svc } = makeService(b);
    const err = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'agency_has_clients', blockers: [expect.objectContaining({ clientCount: 2 })] });
    expect(b.calls.some((c) => c.method === 'updateMany' || c.method === 'deleteMany')).toBe(false);
  });

  it('yonetici hesabi silinemez', async () => {
    const b = makeDb({ ...ACTIVE_USER, role: 'ADMIN' });
    const { svc } = makeService(b);
    const err = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION }).catch((e) => e);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'admin_account' });
  });

  it('talep zaten varsa ayni sonuc doner, ikinci kez yan etki olmaz', async () => {
    const at = new Date('2026-10-01T08:00:00Z');
    const b = makeDb({ ...ACTIVE_USER, deletionRequestedAt: at });
    const { svc, email } = makeService(b);
    const r = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    expect(r).toMatchObject({ alreadyRequested: true, deletionRequestedAt: at.toISOString(), purgeAfter: '2026-10-31T08:00:00.000Z' });
    expect(b.calls.some((c) => c.method === 'updateMany')).toBe(false);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('es zamanli ikinci istek talebi sahiplenemezse anahtar/abonelik islemleri tekrarlanmaz', async () => {
    const b = makeDb(ACTIVE_USER, { claimCount: 0 });
    const { svc, cancelSpy, email } = makeService(b);
    const r = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    expect(r.alreadyRequested).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(find(b.calls, 'apiKey', 'updateMany')).toHaveLength(0);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('Apple ile giris: saklanan token token temizlenmeden once okunur, taze kod iptale iletilir', async () => {
    const b = makeDb(ACTIVE_USER, { appleAccounts: [{ providerAccountId: 'apple-sub-1', refresh_token: 'iv:tag:enc' }] });
    const { svc, apple } = makeService(b, 'revoked');
    const r = await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION, appleAuthorizationCode: ' code123 ' });
    expect(apple.revokeForDeletion).toHaveBeenCalledWith({ appleSubs: ['apple-sub-1'], storedTokens: ['iv:tag:enc'], code: 'code123' });
    expect(r.apple).toBe('revoked');
    const readIdx = b.calls.findIndex((c) => c.model === 'account' && c.method === 'findMany');
    const scrubIdx = b.calls.findIndex((c) => c.model === 'account' && c.method === 'updateMany');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(scrubIdx);
  });

  it('kuyruktaki isler DB\'de iptal edilir ve BullMQ karsiliklari kuyruktan silinir', async () => {
    const b = makeDb(ACTIVE_USER, { queuedJobs: [{ bullJobId: 'article:1' }, { bullJobId: '42' }] });
    const { svc, queue } = makeService(b);
    await svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    expect(find(b.calls, 'job', 'updateMany')[0].args).toEqual({ where: { userId: 'u1', status: 'QUEUED' }, data: { status: 'CANCELED' } });
    expect(queue.removeJob.mock.calls.map((c: any[]) => c[0])).toEqual(['article:1', '42']);
  });

  it('dondurma yalniz verilen kullanicinin kayitlarina yazar (baska kullanici kimligi gecmez)', async () => {
    const b = makeDb(ACTIVE_USER);
    await freezeAccountData(b.db, 'cmuserxxxxxxxxxxxxxxxxx02');
    const writes = b.calls.filter((c) => !/^(find|count)/.test(c.method));
    // site, makale, yayin hedefi, AI anahtari, sosyal kanal/slot/gonderi, ASA, ASC, SDK, izlenen uygulama, is
    expect(writes.length).toBe(12);
    for (const w of writes) {
      expect(whereProblem(w.args?.where, ['cmuserxxxxxxxxxxxxxxxxx02']), `${w.model}.${w.method}`).toBeNull();
      expect(JSON.stringify(w.args.where), `${w.model}.${w.method}`).not.toContain('"u1"');
    }
  });

  it('kapsam bekcisinin kendisi bos gecmiyor: dusurulmus ya da undefined filtre yakalanir', () => {
    for (const bad of [{}, { site: { userId: undefined } }, { site: {} }, { status: 'SCHEDULED' }, { userId: { not: 'u1' } }, { OR: [{ userId: 'u1' }, { status: 'QUEUED' }] }]) {
      expect(whereProblem(bad, ['u1']), JSON.stringify(bad)).not.toBeNull();
    }
    expect(whereProblem(undefined, ['u1'])).not.toBeNull();
    expect(whereProblem({ channel: { site: { userId: 'u1' } }, status: { in: ['QUEUED'] } }, ['u1'])).toBeNull();
  });

  it('abonelik yoksa talep e-postasi "Aboneliğin iptal edildi" demez; e-posta silinen hesabi adiyla soyler', async () => {
    const trial = makeDb({ ...ACTIVE_USER, name: null, plan: 'TRIAL', subscriptionStatus: 'TRIAL' });
    const t = makeService(trial);
    await t.svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    const trialHtml = (t.email.sendRaw.mock.calls[0] as any[])[0].html as string;
    expect(trialHtml).not.toContain('Aboneliğin iptal edildi');
    expect(trialHtml).toContain('Kartından ödeme alınmaz; otomatik yenileme kapatıldı.');
    expect(trialHtml).toContain('Hesap: <strong>a@b.co</strong>');
    expect(trialHtml).not.toContain('Merhaba merhaba');

    const active = makeDb(ACTIVE_USER);
    const a = makeService(active);
    await a.svc.requestDeletion('u1', { confirm: DELETE_ACCOUNT_CONFIRMATION });
    const activeHtml = (a.email.sendRaw.mock.calls[0] as any[])[0].html as string;
    expect(activeHtml).toContain('Aboneliğin iptal edildi; kartından yeni ödeme alınmaz.');
    expect(activeHtml).toContain('Merhaba Ayşe,');
  });

  it('silme ekrani durumu hangi hesabin silinecegini soyler: maskeli e-posta ve site sayisi', async () => {
    const b = makeDb({ ...ACTIVE_USER, email: 'ayse.yilmaz@privaterelay.appleid.com' }, { siteCount: 3 });
    const { svc } = makeService(b);
    const s = await svc.status('u1');
    expect(s).toMatchObject({ maskedEmail: 'a***@privaterelay.appleid.com', siteCount: 3, subscriptionActive: true, purgeAfterDays: 30 });
    expect(find(b.calls, 'site', 'count')[0].args).toEqual({ where: { userId: 'u1' } });
    expect(JSON.stringify(s)).not.toContain('ayse.yilmaz');
  });

  it('musteri hesaplarini ayirma acik onay ister ve yalniz parentAgencyId kaldirir', async () => {
    const b = makeDb(ACTIVE_USER);
    const { svc } = makeService(b);
    await expect(svc.detachAgencyClients('u1', 'yes')).rejects.toBeInstanceOf(BadRequestException);
    await svc.detachAgencyClients('u1', true);
    expect(find(b.calls, 'user', 'updateMany')[0].args).toEqual({ where: { parentAgencyId: 'u1' }, data: { parentAgencyId: null } });
  });
});
