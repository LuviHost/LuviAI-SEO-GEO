/**
 * Panelden yonetici ekleme kurallari.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib/admin-yetki.spec.mts
 */
import { describe, expect, it } from 'vitest';
import { adminGirisIzni, kurucuListesi, kurucuMu, yetkiIslemiKontrol } from './admin-yetki';

const LISTE = kurucuListesi({ ADMIN_EMAILS: ' Kurucu@Kalem.com , ikinci@kalem.com' });
const kurucu = { email: 'kurucu@kalem.com', role: 'ADMIN' };
const kullanici = { email: 'ayse@kalem.com', role: 'USER' as const, adminYetkiAt: null, deletionRequestedAt: null };

describe('kurucuListesi / kurucuMu', () => {
  it('virgulle ayrilmis listeyi kucuk harfe ceker; ADMIN_EMAIL yedegi', () => {
    expect(LISTE).toEqual(['kurucu@kalem.com', 'ikinci@kalem.com']);
    expect(kurucuListesi({ ADMIN_EMAIL: 'tek@kalem.com' })).toEqual(['tek@kalem.com']);
    expect(kurucuListesi({})).toEqual([]);
    expect(kurucuMu('KURUCU@kalem.com ', LISTE)).toBe(true);
    expect(kurucuMu('', LISTE)).toBe(false);
  });
});

describe('adminGirisIzni', () => {
  it('kurucu ya da panelden yetkili ADMIN girer', () => {
    expect(adminGirisIzni(kurucu, LISTE)).toBe(true);
    expect(adminGirisIzni({ email: 'ayse@kalem.com', role: 'ADMIN', adminYetkili: true }, LISTE)).toBe(true);
  });
  it('rolu ADMIN ama yetkisi panelden verilmemis eski hesap giremez; rol USER ise yetki bayragi yetmez', () => {
    expect(adminGirisIzni({ email: 'eski@kalem.com', role: 'ADMIN', adminYetkili: false }, LISTE)).toBe(false);
    expect(adminGirisIzni({ email: 'ayse@kalem.com', role: 'USER', adminYetkili: true }, LISTE)).toBe(false);
  });
});

describe('yetkiIslemiKontrol', () => {
  it('yalniz kurucu yonetici ekler; panel yoneticisi ekleyemez', () => {
    expect(yetkiIslemiKontrol('ver', kurucu, kullanici, LISTE)).toEqual({ ok: true });
    const r = yetkiIslemiKontrol('ver', { email: 'baska@kalem.com', role: 'ADMIN' }, kullanici, LISTE);
    expect(r.ok).toBe(false);
  });
  it('kurucu hesabi, ajans hesabi, silme talepli hesap ve zaten yonetici olan reddedilir', () => {
    expect(yetkiIslemiKontrol('al', kurucu, { email: 'ikinci@kalem.com', role: 'ADMIN', adminYetkiAt: null, deletionRequestedAt: null }, LISTE).ok).toBe(false);
    expect(yetkiIslemiKontrol('ver', kurucu, { ...kullanici, role: 'AGENCY_OWNER' }, LISTE).ok).toBe(false);
    expect(yetkiIslemiKontrol('ver', kurucu, { ...kullanici, deletionRequestedAt: '2026-11-01' }, LISTE).ok).toBe(false);
    expect(yetkiIslemiKontrol('ver', kurucu, { ...kullanici, role: 'ADMIN', adminYetkiAt: '2026-11-23' }, LISTE).ok).toBe(false);
    expect(yetkiIslemiKontrol('ver', kurucu, null, LISTE).ok).toBe(false);
  });
  it('yalniz panelden verilmis yoneticilik geri alinir', () => {
    expect(yetkiIslemiKontrol('al', kurucu, { ...kullanici, role: 'ADMIN', adminYetkiAt: '2026-11-23' }, LISTE)).toEqual({ ok: true });
    expect(yetkiIslemiKontrol('al', kurucu, { ...kullanici, role: 'ADMIN', adminYetkiAt: null }, LISTE).ok).toBe(false);
    expect(yetkiIslemiKontrol('al', kurucu, kullanici, LISTE).ok).toBe(false);
  });
});
