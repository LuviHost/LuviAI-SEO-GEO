import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ForbiddenException } from '@nestjs/common';
import { AffiliateService } from './affiliate.service.js';
import { AffiliateController } from './affiliate.controller.js';
import { REFERRAL_LABEL_KEEP, REFERRAL_LABEL_MAX, referralLabel, shortenReferralLabel } from './referral-label.js';

/**
 * C2 — ortaklik paneli davetlilerin kisisel verisini SIZDIRMAZ (KVKK veri minimizasyonu).
 *
 * NEDEN: getStats ortaga 1. ve 2. seviye davetlilerin tam adini ve e-postasini
 * (referredName / referredEmail), baska kullanicilarin ic kimliklerini (referredUserId,
 * 2. seviyede affiliateId / parentUserId) ve 2. seviyede 1. seviyedeki kisinin kendi komisyon
 * kazancini (totalCommissionEarned) donduruyordu. Panel yalniz kisaltilmis bir etiket
 * gosteriyordu ve 2. seviyeden komisyon yok: bu veriler amacsiz olarak ortaga gidiyordu.
 * Yonetici (destek, elle komisyon odemesi) eski bicimi aynen alir.
 */

const AFF = { id: 'ckaff0000000000000000001', name: 'Ortak Kişi', email: 'ortak@ornek.com.tr' };
const T1A = { id: 'ckt1a000000000000000001a', name: 'Ayşe Yılmaz', email: 'ayse.yilmaz@gmail.com' };
const T1B = { id: 'ckt1b000000000000000001b', name: null, email: 'mehmet.kaya.uzun.isim@firma.com.tr' };
const T1C = { id: 'ckt1c000000000000000001c', name: '  Abdurrahman Karaosmanoğlu ', email: 'abdurrahman@ornek.net' };
const T2A = { id: 'ckt2a000000000000000002a', name: 'Zeynep Demir', email: 'zeynep.demir@hotmail.com' };
/** Hesabi silinmis 2. seviye davetli: kullanici satiri yok */
const T2B_ID = 'ckt2b000000000000000002b';

const D = (iso: string) => new Date(iso);

function world() {
  const users = [AFF, T1A, T1B, T1C, T2A];
  const referral = (id: string, affiliateId: string, referredUserId: string, over: Record<string, unknown> = {}) => ({
    id, affiliateId, referredUserId,
    clickedAt: D('2026-09-01T10:00:00Z'), signedUpAt: D('2026-09-01T10:05:00Z'), firstPaidAt: null,
    commissionUntil: D('2026-11-30T10:05:00Z'), totalCommissionEarned: 0, status: 'signed_up',
    ...over,
  });
  const affiliates = [
    {
      id: 'affrow0000000000000000001', userId: AFF.id, refCode: 'ortak-kisi-ab12', commissionPct: 30, active: true,
      totalReferred: 3, totalRevenue: 1000, totalCommission: 300, totalPaid: 100,
      referrals: [
        referral('r1', 'affrow0000000000000000001', T1A.id, { status: 'paid', firstPaidAt: D('2026-09-10T08:00:00Z'), totalCommissionEarned: 300 }),
        referral('r2', 'affrow0000000000000000001', T1B.id),
        referral('r3', 'affrow0000000000000000001', T1C.id, { status: 'clicked', signedUpAt: null }),
      ],
    },
    {
      // 1. seviyedeki Ayse'nin kendi ortaklik hesabi: onun davetleri ortagin 2. seviyesi
      id: 'affrow0000000000000000002', userId: T1A.id, refCode: 'ayse-yilmaz-cd34', commissionPct: 30, active: true,
      totalReferred: 2, totalRevenue: 500, totalCommission: 150, totalPaid: 0,
      referrals: [
        referral('s1', 'affrow0000000000000000002', T2A.id, { status: 'paid', firstPaidAt: D('2026-09-20T08:00:00Z'), totalCommissionEarned: 150 }),
        referral('s2', 'affrow0000000000000000002', T2B_ID),
      ],
    },
  ];
  const prisma = {
    affiliate: {
      findUnique: vi.fn(async ({ where }: any) => affiliates.find((a) => a.userId === where.userId) ?? null),
      findMany: vi.fn(async ({ where }: any) => affiliates.filter((a) => where.userId.in.includes(a.userId))),
    },
    user: {
      findMany: vi.fn(async ({ where, select }: any) => users
        .filter((u) => where.id.in.includes(u.id))
        .map((u: any) => Object.fromEntries(Object.keys(select).map((k) => [k, u[k]])))),
    },
  };
  return { svc: new AffiliateService(prisma as any), prisma, affiliates };
}

const SECRET_VALUES = [
  T1A.email, T1B.email, T1C.email, T2A.email, AFF.email,
  T1A.id, T1B.id, T1C.id, T2A.id, T2B_ID,
  // 2. seviye satirlarindaki alt ortaklik hesabinin kimligi
  'affrow0000000000000000002',
  // Ad soyadin kisaltilmamis hali ve e-posta alan adlari
  'Karaosmanoğlu', 'firma.com.tr', 'gmail.com', 'hotmail.com',
];
const CONTACT_KEYS = ['referredName', 'referredEmail', 'referredUserId', 'parentUserId', 'affiliateId'];

describe('ortaklik paneli — ortaga davetlinin yalniz kisaltilmis etiketi gider (1. ve 2. seviye)', () => {
  it('1. seviye: tam ad, e-posta ve kullanici kimligi yok; panelin etiketi var; ortagin kendi komisyonu kalir', async () => {
    const { svc } = world();
    const stats: any = await svc.getStats(AFF.id);
    expect(stats.enrolled).toBe(true);
    expect(stats.referrals.map((r: any) => [r.id, r.referredLabel])).toEqual([
      ['r1', 'Ayşe Yılmaz'],
      // Ad yok: e-postanin @ oncesi, 14 karakterden uzun → ilk 12 + '…'
      ['r2', 'mehmet.kaya.…'],
      // Bosluklar kirpilir, uzun ad kisaltilir: soyadi gorunmez
      ['r3', 'Abdurrahman …'],
    ]);
    for (const r of stats.referrals) {
      for (const k of CONTACT_KEYS) expect(r, `${r.id}.${k}`).not.toHaveProperty(k);
      expect(r.tier).toBe(1);
    }
    expect(stats.referrals[0]).toMatchObject({ status: 'paid', totalCommissionEarned: 300, firstPaidAt: D('2026-09-10T08:00:00Z') });
  });

  it('2. seviye: etiket maskeli; 1. seviyedeki kisinin kazanci ve ic kimlikler yok; ust dugume davet kaydiyla baglanir', async () => {
    const { svc } = world();
    const stats: any = await svc.getStats(AFF.id);
    expect(stats.tier2Referrals).toEqual([
      {
        id: 's1', tier: 2, parentReferralId: 'r1', referredLabel: 'Zeynep Demir', status: 'paid',
        clickedAt: D('2026-09-01T10:00:00Z'), signedUpAt: D('2026-09-01T10:05:00Z'), firstPaidAt: D('2026-09-20T08:00:00Z'),
      },
      // Hesabi silinmis davetli: etiket yok (panel "Davetli N" yazar)
      {
        id: 's2', tier: 2, parentReferralId: 'r1', referredLabel: null, status: 'signed_up',
        clickedAt: D('2026-09-01T10:00:00Z'), signedUpAt: D('2026-09-01T10:05:00Z'), firstPaidAt: null,
      },
    ]);
    expect(stats.networkSize).toBe(5);
    expect(stats.networkLevels).toBe(2);
  });

  it('yanitin hicbir yerinde e-posta, kullanici kimligi ya da alt ortaklik kimligi gecmez; secenek verilmezse de maskeli', async () => {
    const { svc } = world();
    for (const stats of [await svc.getStats(AFF.id), await svc.getStats(AFF.id, { revealContacts: false })]) {
      const json = JSON.stringify(stats);
      for (const secret of SECRET_VALUES) expect(json, secret).not.toContain(secret);
      for (const k of CONTACT_KEYS) expect(json, k).not.toContain(`"${k}"`);
      // Ortagin kendi toplamlari aynen
      expect(stats).toMatchObject({ refCode: 'ortak-kisi-ab12', totalReferred: 3, totalCommission: 300, totalPaid: 100, pendingPayout: 200 });
    }
  });

  it('yonetici yaniti DEGISMEDI: tam ad, e-posta ve ic kimlikler eski bicimde', async () => {
    const { svc, affiliates } = world();
    const stats: any = await svc.getStats(AFF.id, { revealContacts: true });
    const [own, sub] = affiliates;
    const contact = (id: string) => {
      const u = [T1A, T1B, T1C, T2A].find((x) => x.id === id);
      return { referredName: u?.name ?? null, referredEmail: u?.email ?? null };
    };
    // Duzeltmeden onceki enrich ile birebir ayni nesneler
    expect(stats.referrals).toEqual(own.referrals.map((r) => ({ ...r, tier: 1, ...contact(r.referredUserId) })));
    expect(stats.tier2Referrals).toEqual(sub.referrals.map((r) => ({ ...r, tier: 2, parentUserId: T1A.id, ...contact(r.referredUserId) })));
    expect(JSON.stringify(stats)).toContain(T1A.email);
  });
});

describe('ortaklik denetleyicisi — tam iletisim bilgisi yalniz yoneticiye', () => {
  const ctl = () => {
    const getStats = vi.fn(async () => ({ enrolled: true }));
    return { ctl: new AffiliateController({ getStats } as any), getStats };
  };

  it('ortak kendi panelini maskeli alir; yonetici baska kullanicinin panelini tam alir; baskasi 403', async () => {
    const own = ctl();
    await own.ctl.stats({ user: { id: AFF.id, role: 'USER' } } as any, AFF.id);
    expect(own.getStats).toHaveBeenCalledWith(AFF.id, { revealContacts: false });

    const agency = ctl();
    await agency.ctl.stats({ user: { id: AFF.id, role: 'AGENCY_OWNER' } } as any, AFF.id);
    expect(agency.getStats).toHaveBeenCalledWith(AFF.id, { revealContacts: false });

    const admin = ctl();
    await admin.ctl.stats({ user: { id: 'admin0001', role: 'ADMIN' } } as any, AFF.id);
    expect(admin.getStats).toHaveBeenCalledWith(AFF.id, { revealContacts: true });

    const other = ctl();
    expect(() => other.ctl.stats({ user: { id: 'baska0001', role: 'USER' } } as any, AFF.id)).toThrow(ForbiddenException);
    expect(other.getStats).not.toHaveBeenCalled();
  });

  it('ortagin cagirabildigi diger uclar davetli verisi dondurmez (katilim yalniz kendi kodu, kod denetimi yalniz ok)', async () => {
    const prisma = {
      affiliate: {
        findUnique: vi.fn(async ({ where }: any) => (where.userId === AFF.id || where.refCode === 'ortak-kisi-ab12'
          ? { id: 'affrow0000000000000000001', userId: AFF.id, refCode: 'ortak-kisi-ab12', active: true }
          : null)),
      },
    };
    const svc = new AffiliateService(prisma as any);
    expect(await svc.enroll(AFF.id)).toEqual({ refCode: 'ortak-kisi-ab12' });
    expect(await svc.trackClick('ortak-kisi-ab12')).toEqual({ ok: true });
    expect(await svc.trackClick('yok')).toEqual({ ok: false });
  });
});

describe('etiket kurali — tek yardimci, panelle ayni ve idempotent', () => {
  it('ad > e-postanin @ oncesi > null; alan adi hic gorunmez; kisaltma idempotent', () => {
    expect(referralLabel('Ali Veli', 'ali@ornek.com')).toBe('Ali Veli');
    expect(referralLabel('   ', 'ali.veli@ornek.com')).toBe('ali.veli');
    expect(referralLabel(null, 'cok.uzun.bir.yerel.kisim@ornek.com')).toBe('cok.uzun.bir…');
    expect(referralLabel(null, '@ornek.com')).toBeNull();
    expect(referralLabel(undefined, undefined)).toBeNull();
    for (const label of ['Ali Veli', 'cok.uzun.bir…', 'Abdurrahman …', 'tam14karakter!']) {
      expect(shortenReferralLabel(label), label).toBe(label);
    }
  });

  it('panel (refLabel) API etiketini once kullanir ve ayni kisaltmayi uygular; 2. seviyeyi parentReferralId ile baglar', () => {
    const page = readFileSync(new URL('../../../web/src/app/(dashboard)/affiliate/page.tsx', import.meta.url), 'utf8');
    const fn = page.slice(page.indexOf('function refLabel('));
    expect(fn).toContain(`s.length > ${REFERRAL_LABEL_MAX} ? s.slice(0, ${REFERRAL_LABEL_KEEP}) + '…' : s`);
    const labelAt = fn.indexOf('r.referredLabel');
    expect(labelAt).toBeGreaterThan(0);
    expect(labelAt).toBeLessThan(fn.indexOf('r.referredName'));
    expect(page).toMatch(/p\.ref\.id === r\.parentReferralId/);
  });
});
