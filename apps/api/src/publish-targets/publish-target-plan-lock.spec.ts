import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from '../billing/quota.service.js';
import { PLAN_LIMIT_CODE, type UpgradeOffer } from '../billing/plan-limit.js';
import { BASE_PLANS, findPlan, publicPlans, PLAN_RANK } from '../billing/plans.js';
import { publishTargetCatalog } from './publish-target-catalog.js';
import { allowedTargetLabels, lockCatalog, publishTargetLockedMessage } from './publish-target-plan-lock.js';
import { PublishTargetsService } from './publish-targets.service.js';

/**
 * Yayin hedefi turu kilidi (sahip "yap" dedi, 15.11.2026).
 *
 * Deneme duzeyindeki hesap yalniz iki tur ekleyebilir. Katalog bunu BASTAN soyler (panel
 * kutuyu kilitli cizer); kayit ucu ayni cumleyle plan siniri hatasi doner. Bu dosya uc seyi
 * sabitler: kilit kayit kapisiyla AYNI tablodan; onerilen plan gercekten butun turleri acar;
 * cumle tur ADIYLA yazilir ve plani biten musteriye "ücretsiz deneme" denmez.
 */

const starter = findPlan('starter')!;
const BUY: UpgradeOffer = { kind: 'buy', planId: 'starter', planName: starter.name_tr };
const WAIT: UpgradeOffer = { kind: 'wait', planId: null, planName: null };

function fakePrisma(plan: string, opts: { everPaid?: boolean; ownerId?: string } = {}) {
  const user = { id: 'u1', plan, role: 'USER' };
  return {
    user: { findUniqueOrThrow: async () => user, findUnique: async () => user },
    invoice: { findFirst: async () => (opts.everPaid ? { id: 'inv1' } : null) },
    site: {
      findUnique: async () => ({ userId: opts.ownerId ?? 'u1' }),
      findUniqueOrThrow: async () => ({ userId: opts.ownerId ?? 'u1' }),
    },
    publishTarget: { updateMany: vi.fn(), create: vi.fn() },
  } as never;
}

describe('QuotaService.publishTargetAccess — kayit kapisiyla ayni tablo', () => {
  it('deneme: iki tur acik, kilidi butun turleri acan en dusuk satistaki plan acar', async () => {
    const a = await new QuotaService(fakePrisma('TRIAL')).publishTargetAccess('u1');
    expect(a.allowed).toEqual(['MARKDOWN_ZIP', 'WORDPRESS_REST']);
    expect(a.upgrade).toEqual(BUY);
    expect(a.lapsed).toBe(false);
    // Durustluk: onerilen plan gercekten butun turleri aciyor ve altinda acan baska plan yok
    expect(findPlan(a.upgrade.planId!)!.publishTargets).toBe('all');
    const dahaDusuk = publicPlans().filter((p) => PLAN_RANK[p.id] > PLAN_RANK.trial && PLAN_RANK[p.id] < PLAN_RANK[a.upgrade.planId!]);
    expect(dahaDusuk.filter((p) => p.publishTargets === 'all')).toEqual([]);
  });

  it('her plan icin: izin listesi canUsePublishTarget ile ayni karari verir', async () => {
    const turler = publishTargetCatalog().map((c) => c.type);
    for (const p of BASE_PLANS) {
      const q = new QuotaService(fakePrisma(p.id.toUpperCase()));
      const a = await q.publishTargetAccess('u1');
      for (const t of turler) {
        const kapi = await q.canUsePublishTarget('u1', t);
        expect(a.allowed === 'all' || a.allowed.includes(t), `${p.id} / ${t}`).toBe(kapi);
      }
      // plans.ts'teki bayrakla da tutarli: 'all' diyen planda kilit yok
      expect(a.allowed === 'all', p.id).toBe(p.publishTargets === 'all');
      if (a.allowed === 'all') expect(a.upgrade).toEqual(WAIT);
    }
  });

  it('plani biten eski musteri isaretlenir; taninmayan plan en dar kapsami alir', async () => {
    expect((await new QuotaService(fakePrisma('TRIAL', { everPaid: true })).publishTargetAccess('u1')).lapsed).toBe(true);
    const bilinmeyen = await new QuotaService(fakePrisma('GOLD')).publishTargetAccess('u1');
    expect(bilinmeyen.allowed).toEqual(['MARKDOWN_ZIP', 'WORDPRESS_REST']);
  });
});

describe('lockCatalog / publishTargetLockedMessage', () => {
  const katalog = publishTargetCatalog().filter((c) => !c.adminOnly);
  const deneme = { allowed: ['MARKDOWN_ZIP', 'WORDPRESS_REST'], upgrade: BUY, lapsed: false };

  it('her tur aciksa katalog AYNEN doner (kilit alani eklenmez)', () => {
    expect(lockCatalog(katalog, { allowed: 'all', upgrade: WAIT, lapsed: false })).toBe(katalog);
  });

  it('deneme: iki tur acik, digerleri kilitli; her kilitli tur yolu ve cumlesini tasir', () => {
    const out = lockCatalog(katalog, deneme);
    expect(out.filter((c) => !c.locked).map((c) => c.type).sort()).toEqual(['MARKDOWN_ZIP', 'WORDPRESS_REST']);
    expect(out.filter((c) => c.locked)).toHaveLength(katalog.length - 2);
    const webflow = out.find((c) => c.type === 'WEBFLOW')!;
    expect(webflow.upgrade).toEqual(BUY);
    expect(webflow.lockedReason).toBe(
      `Ücretsiz denemede yalnız WordPress (REST API) ve Markdown ZIP yayın hedefi eklenebilir. Webflow CMS için ${starter.name_tr} plana geçebilirsin.`,
    );
    // Form alanlari kilitli turde de durur (yanit bicimi degismedi)
    expect(webflow.fields.length).toBeGreaterThan(0);
  });

  it('cumle tur ADIYLA yazilir; ham tur kodu ve eski "Ücretli bir plana" kalibi yok', () => {
    for (const c of lockCatalog(katalog, deneme).filter((x) => x.locked)) {
      expect(c.lockedReason).toContain(`${c.label} için`);
      expect(c.lockedReason).not.toMatch(/Ücretli bir plana|planına dahil değil/);
      // Etiketi kodu icermeyen turlerde (WEBFLOW → "Webflow CMS") ham kod cumlede gecmez;
      // "FTP" ve "SFTP / SSH" etiketleri kodun kendisini icerir
      if (!c.label.includes(c.type)) expect(c.lockedReason).not.toContain(c.type);
    }
  });

  it('plani biten musteriye "Ücretsiz denemede" denmez', () => {
    const m = publishTargetLockedMessage('Ghost', allowedTargetLabels(katalog, deneme), { upgrade: BUY, lapsed: true });
    expect(m).toBe(`Planın sona erdi; hesabın deneme düzeyinde; bu düzeyde yalnız WordPress (REST API) ve Markdown ZIP yayın hedefi eklenebilir. Ghost için ${starter.name_tr} plana geçebilirsin.`);
    expect(m).not.toMatch(/ücretsiz/i);
  });

  it('yol teklifle ya da yoksa cumle ona gore', () => {
    const teklif = publishTargetLockedMessage('Ghost', ['Markdown ZIP'], { upgrade: { kind: 'quote', planId: 'enterprise', planName: 'Kurumsal' }, lapsed: false });
    expect(teklif).toBe('Ücretsiz denemede yalnız Markdown ZIP yayın hedefi eklenebilir. Ghost için Kurumsal planı teklifle sunuluyor.');
    expect(publishTargetLockedMessage('Ghost', ['Markdown ZIP'], { upgrade: WAIT, lapsed: false })).toBe('Ücretsiz denemede yalnız Markdown ZIP yayın hedefi eklenebilir.');
  });
});

describe('PublishTargetsService — katalog ve kayit', () => {
  const USER = { id: 'u1', role: 'USER' };
  const servis = (plan: string, opts: { everPaid?: boolean; ownerId?: string } = {}) => {
    const prisma = fakePrisma(plan, opts);
    return new PublishTargetsService(prisma, new QuotaService(prisma));
  };

  it('katalog: site verilince sahibin planina gore kilitler; site yoksa ve yoneticide kilit yok', async () => {
    const svc = servis('TRIAL');
    const kilitli = await svc.catalogFor('s1', USER);
    expect(kilitli.find((c) => c.type === 'WEBFLOW')?.locked).toBe(true);
    expect(kilitli.find((c) => c.type === 'WORDPRESS_REST')?.locked).toBeUndefined();
    expect((await svc.catalogFor(undefined, USER)).some((c) => c.locked)).toBe(false);
    expect((await svc.catalogFor('s1', { id: 'admin', role: 'ADMIN' })).some((c) => c.locked)).toBe(false);
    // Ucretli plan: hic kilit yok
    expect((await servis('STARTER').catalogFor('s1', USER)).some((c) => c.locked)).toBe(false);
  });

  it('katalog: baskasinin sitesi icin plan bilgisi sizmaz (403)', async () => {
    await expect(servis('TRIAL', { ownerId: 'baska' }).catalogFor('s1', USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('kayit: kilitli tur plan siniri hatasi (kod + yol), cumle katalogdakiyle AYNI', async () => {
    const svc = servis('TRIAL');
    const err = await svc
      .create('s1', { type: 'WEBFLOW', name: 'Webflow', credentials: { apiToken: 'x', siteId: 'y', collectionId: 'z' } }, USER)
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    const body = err.getResponse() as { code: string; message: string; upgrade: UpgradeOffer };
    expect(body.code).toBe(PLAN_LIMIT_CODE);
    expect(body.upgrade).toEqual(BUY);
    const katalogdaki = (await svc.catalogFor('s1', USER)).find((c) => c.type === 'WEBFLOW')!.lockedReason;
    expect(body.message).toBe(katalogdaki);
    expect(body.message).not.toContain('WEBFLOW');
  });
});
