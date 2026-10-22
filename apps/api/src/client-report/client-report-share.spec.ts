import { describe, it, expect } from 'vitest';
import {
  EN_COK_GUN, SNAPSHOT_EN_COK_BAYT, VARSAYILAN_GUN, anahtarCoz, gecerliGun, gecerliToken, paylasimAnahtari, snapshotSigdir, yeniToken,
  type PaylasimKaydi,
} from './client-report-share.js';
import { buildClientReport } from './client-report-build.js';
import { mukellefGirdisi } from './client-report.fixture.js';

const SITE = 'cmsitemukellef00000000001';

describe('paylasim tokeni ve anahtari', () => {
  it('token 32 karakter base64url, her seferinde farkli', () => {
    const set = new Set(Array.from({ length: 200 }, () => yeniToken()));
    expect(set.size).toBe(200);
    for (const t of set) expect(gecerliToken(t)).toBe(true);
  });

  it('anahtar → token + site; bozuk anahtar null', () => {
    const t = yeniToken();
    expect(anahtarCoz(paylasimAnahtari(t, SITE))).toEqual({ token: t, siteId: SITE });
    expect(anahtarCoz('crawl-access:x')).toBeNull();
    expect(anahtarCoz('musteri-raporu:kisa:x')).toBeNull();
    expect(anahtarCoz(`musteri-raporu:${t}:`)).toBeNull();
  });

  it('gun: varsayilan 30, 1..90 araligina sikistirilir', () => {
    expect(gecerliGun(undefined)).toBe(VARSAYILAN_GUN);
    expect(gecerliGun('abc')).toBe(VARSAYILAN_GUN);
    expect(gecerliGun(0)).toBe(1);
    expect(gecerliGun(365)).toBe(EN_COK_GUN);
    expect(gecerliGun('7')).toBe(7);
  });
});

describe('snapshotSigdir — TEXT kolonuna sigar, sessiz kayip yok', () => {
  const kayit = (): PaylasimKaydi => ({
    v: 1, siteId: SITE, olusturan: 'u1', olusturuldu: '2026-10-22T10:00:00.000Z', sonGecerlilik: '2026-11-21T10:00:00.000Z',
    rapor: buildClientReport(mukellefGirdisi(), new Date('2026-10-22T10:00:00.000Z')),
  });

  it('normal rapor oldugu gibi yazilir', () => {
    const k = kayit();
    expect(snapshotSigdir(k)).toBe(JSON.stringify(k));
  });

  it('cok uzun ornek adresler kisaltilir ve rapora not duser', () => {
    const k = kayit();
    if (k.rapor.seo.olculemedi) throw new Error('seo');
    for (const s of k.rapor.seo.sayfaSorunlari) s.ornekler = Array.from({ length: 10 }, (_, i) => `https://mukellef.co/${'ç'.repeat(1200)}-${i}`);
    const json = snapshotSigdir(k);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(SNAPSHOT_EN_COK_BAYT);
    const geri = JSON.parse(json) as PaylasimKaydi;
    expect(geri.rapor.yontem.join(' ')).toContain('kısaltıldı');
    if (geri.rapor.seo.olculemedi) throw new Error('seo');
    expect(geri.rapor.seo.sayfaSorunlari.every((s) => s.ornekler.length <= 3)).toBe(true);
  });

  it('kisaltma da yetmezse hata (yarim kayit yazilmaz)', () => {
    const k = kayit();
    k.rapor.yontem.push('x'.repeat(70_000));
    expect(() => snapshotSigdir(k)).toThrow('RAPOR_COK_BUYUK');
  });
});
