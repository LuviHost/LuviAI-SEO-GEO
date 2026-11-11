import { describe, it, expect } from 'vitest';
import { BASE_PLANS } from '../billing/plans.js';
import {
  SETUP_MEASUREMENT_LIMIT_CODE, SETUP_MEASUREMENT_WINDOW_DAYS, SETUP_MEASUREMENT_WINDOW_MS,
  decideSetupMeasurement, parseSetupRecords, pruneSetupRecords, setupHost, setupLimitMessage, setupMeasurementLimit,
  type SetupMeasurementRecord,
} from './setup-measurement-limit.js';

/**
 * Otomatik kurulum olcumu siniri — saf kural (sahip karari 11.11.2026).
 *
 * NEDEN VAR: site eklenince alinan otomatik AI olcumu "sistem" olcumudur (aylik tavana
 * ve haftalik hakka sayilmaz) ve siniri yoktu: siteyi silip yeniden ekleyen hesap
 * Profesyonel'de her seferinde 5 soru x 3 tekrar x 7 asistanlik olcumu yeniden
 * yaptirabiliyordu. Iki yon de sabitlenir: sinir kesecegini keser, izin verilen kurulumu
 * (planin site sayisi kadar farkli alan adi) kesmez.
 */

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const kayit = (host: string, daysAgo: number): SetupMeasurementRecord => ({ host, at: ago(daysAgo * DAY) });
const kayitlar = (n: number, daysAgo = 1) => Array.from({ length: n }, (_, i) => kayit(`site${i}.com`, daysAgo));

describe('setupMeasurementLimit — sayi plans.ts site sinirindan gelir (kopya yok)', () => {
  it('her planda N = planin site siniri', () => {
    for (const p of BASE_PLANS) {
      expect(setupMeasurementLimit(p.id.toUpperCase()), p.id).toBe(p.sites);
      expect(setupMeasurementLimit(p.id), p.id).toBe(p.sites);
    }
  });

  it('sahibin onayladigi sayilar: deneme 1, Baslangic 2, Profesyonel 5, Ajans 15, Kurumsal 50', () => {
    // plans.ts site sinirlari degisirse bu sinir da degisir: bilerek yapildigini bu satir sordurur
    expect(Object.fromEntries(['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE'].map((p) => [p, setupMeasurementLimit(p)])))
      .toEqual({ TRIAL: 1, STARTER: 2, PRO: 5, AGENCY: 15, ENTERPRISE: 50 });
  });

  it('bilinmeyen / bos plan en dar sinira (deneme) duser', () => {
    const deneme = BASE_PLANS.find((p) => p.id === 'trial')!.sites;
    for (const plan of ['', 'GOLD', null, undefined]) expect(setupMeasurementLimit(plan), String(plan)).toBe(deneme);
  });

  it('pencere 30 gun (musteri metinleri bu sayiyi yazar)', () => {
    expect(SETUP_MEASUREMENT_WINDOW_DAYS).toBe(30);
    expect(SETUP_MEASUREMENT_WINDOW_MS).toBe(30 * DAY);
  });
});

describe('decideSetupMeasurement — hesap tavani (kayan 30 gunde N)', () => {
  it('her planda N. olcume izin verilir, N+1. kesilir', () => {
    for (const p of BASE_PLANS) {
      const plan = p.id.toUpperCase();
      expect(decideSetupMeasurement(NOW, kayitlar(p.sites - 1), plan, 'USER', 'yeni.com'), `${p.id} N.`).toEqual({ allowed: true, exempt: false });
      expect(decideSetupMeasurement(NOW, kayitlar(p.sites), plan, 'USER', 'yeni.com'), `${p.id} N+1.`)
        .toEqual({ allowed: false, reason: 'account', limit: p.sites, used: p.sites });
    }
  });

  it('ilk site her planda olculur (kayit yok)', () => {
    for (const p of BASE_PLANS) expect(decideSetupMeasurement(NOW, [], p.id.toUpperCase(), 'USER', 'ilk.com').allowed, p.id).toBe(true);
  });

  it('pencere KAYAR: 30 gunu dolduran kayit sayilmaz, 30 gunden bir an genc olan sayilir', () => {
    const tam30 = [{ host: 'eski.com', at: ago(30 * DAY) }];
    expect(decideSetupMeasurement(NOW, tam30, 'TRIAL', 'USER', 'yeni.com')).toEqual({ allowed: true, exempt: false });
    const birAnGenc = [{ host: 'eski.com', at: ago(30 * DAY - 1) }];
    expect(decideSetupMeasurement(NOW, birAnGenc, 'TRIAL', 'USER', 'yeni.com'))
      .toEqual({ allowed: false, reason: 'account', limit: 1, used: 1 });
    // Karisik: 5 kayittan 2'si pencere disinda → Profesyonel'de (5) yer var
    const karisik = [...kayitlar(3, 2), ...kayitlar(2, 45).map((r, i) => ({ ...r, host: `eski${i}.com` }))];
    expect(decideSetupMeasurement(NOW, karisik, 'PRO', 'USER', 'yeni.com').allowed).toBe(true);
  });

  it('paket yukselince tavan da yukselir (ayni kayitlar, yeni plan)', () => {
    const iki = kayitlar(2);
    expect(decideSetupMeasurement(NOW, iki, 'STARTER', 'USER', 'yeni.com').allowed).toBe(false);
    expect(decideSetupMeasurement(NOW, iki, 'PRO', 'USER', 'yeni.com').allowed).toBe(true);
  });
});

describe('decideSetupMeasurement — ayni alan adi 30 gunde bir kez (sil + yeniden ekle olcturmez)', () => {
  it('tavanin altinda olsa da ayni alan adi kesilir; baska alan adi kesilmez', () => {
    const r = [kayit('ornek.com', 3)];
    expect(decideSetupMeasurement(NOW, r, 'PRO', 'USER', 'ornek.com')).toEqual({ allowed: false, reason: 'domain', limit: 5, used: 1 });
    expect(decideSetupMeasurement(NOW, r, 'PRO', 'USER', 'baska.com')).toEqual({ allowed: true, exempt: false });
  });

  it('30 gun dolunca ayni alan adi yeniden olculebilir', () => {
    expect(decideSetupMeasurement(NOW, [kayit('ornek.com', 31)], 'PRO', 'USER', 'ornek.com')).toEqual({ allowed: true, exempt: false });
    expect(decideSetupMeasurement(NOW, [kayit('ornek.com', 29)], 'PRO', 'USER', 'ornek.com').allowed).toBe(false);
  });

  it('iki kural birden tutuyorsa neden alan adidir (daha belirli)', () => {
    const dolu = [kayit('ornek.com', 1)];
    expect(decideSetupMeasurement(NOW, dolu, 'TRIAL', 'USER', 'ornek.com')).toMatchObject({ allowed: false, reason: 'domain' });
  });
});

describe('decideSetupMeasurement — ADMIN muaf', () => {
  it('tavan dolu ve ayni alan adi olsa da ADMIN olcer', () => {
    const dolu = [...kayitlar(60), kayit('ornek.com', 1)];
    expect(decideSetupMeasurement(NOW, dolu, 'TRIAL', 'ADMIN', 'ornek.com')).toEqual({ allowed: true, exempt: true });
    // Muafiyet role baglidir, plana degil
    expect(decideSetupMeasurement(NOW, dolu, 'ENTERPRISE', 'USER', 'ornek.com').allowed).toBe(false);
  });
});

describe('setupHost — alan adi (www / protokol / yol / buyuk harf fark etmez)', () => {
  it.each([
    ['https://ornek.com', 'ornek.com'],
    ['https://www.ornek.com/', 'ornek.com'],
    ['HTTP://WWW.Ornek.COM/blog?x=1#y', 'ornek.com'],
    ['ornek.com', 'ornek.com'],
    ['www.ornek.com/yol', 'ornek.com'],
    ['https://ornek.com.', 'ornek.com'],
    ['https://ornek.com:8443/a', 'ornek.com'],
    ['https://blog.ornek.com', 'blog.ornek.com'],
    ['', ''],
  ])('%s → %s', (url, host) => {
    expect(setupHost(url)).toBe(host);
  });

  it('bos / tanimsiz deger bos alan adidir ve alan adi kuralini tetiklemez (hesap tavani yine gecerli)', () => {
    expect(setupHost(null)).toBe('');
    expect(setupHost(undefined)).toBe('');
    expect(decideSetupMeasurement(NOW, [{ host: '', at: ago(DAY) }], 'PRO', 'USER', '').allowed).toBe(true);
    expect(decideSetupMeasurement(NOW, [{ host: '', at: ago(DAY) }], 'TRIAL', 'USER', '')).toMatchObject({ allowed: false, reason: 'account' });
  });
});

describe('kayit deposu — ayristirma ve budama', () => {
  it('bozuk / bos / dizi olmayan deger bos listedir (sinir kaydi yok sayilir)', () => {
    for (const v of [null, undefined, '', 'bozuk{', '{"host":"a.com"}', '42']) expect(parseSetupRecords(v), String(v)).toEqual([]);
  });

  it('bicimi bozuk kayitlar atilir; saglamlar yalniz host + at ile doner', () => {
    const value = JSON.stringify([
      { host: 'a.com', at: ago(DAY), fazladan: 'x' },
      { host: 'b.com' },
      { host: 7, at: ago(DAY) },
      { host: 'c.com', at: 'tarih degil' },
      null,
    ]);
    expect(parseSetupRecords(value)).toEqual([{ host: 'a.com', at: ago(DAY) }]);
  });

  it('pruneSetupRecords 30 gunden eskileri dusurur, sirayi korur', () => {
    const r = [kayit('a.com', 40), kayit('b.com', 10), kayit('c.com', 30), kayit('d.com', 1)];
    expect(pruneSetupRecords(r, NOW).map((x) => x.host)).toEqual(['b.com', 'd.com']);
  });
});

describe('setupLimitMessage — ne oldu ve ne yapilabilir', () => {
  it('hesap tavani: sinirin doldugunu, sayiyi ve olcumun haftalik hakla baslatilabilecegini soyler', () => {
    expect(setupLimitMessage('account', 5)).toBe('Otomatik kurulum ölçümü sınırı doldu (30 günde en fazla 5 site); ilk ölçümü haftalık ölçüm hakkınla başlatabilirsin.');
  });

  it('alan adi: bu alan adinin yakin zamanda olculdugunu soyler', () => {
    expect(setupLimitMessage('domain', 5)).toBe('Bu alan adının otomatik kurulum ölçümü son 30 gün içinde yapıldı; yeni ölçümü haftalık ölçüm hakkınla başlatabilirsin.');
  });

  it('atlama kodu sabit (panel ve raporlar koda bakar)', () => {
    expect(SETUP_MEASUREMENT_LIMIT_CODE).toBe('SETUP_MEASUREMENT_LIMIT');
  });
});
