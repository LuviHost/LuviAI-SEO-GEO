import { describe, expect, it } from 'vitest';
import { firmaAnahtari, frenNedeni, gonderimPenceresinde, iceAktarSatiri, olayEsle, olayZamani, trAyBasi, trGun, trGunBasi, turKotasi } from './eposta-kurallar.js';

describe('zaman', () => {
  it('TR gunu UTC+3 ile hesaplanir', () => {
    expect(trGun(new Date('2026-10-27T21:30:00Z'))).toBe('2026-10-28'); // TR 00:30
    expect(trGunBasi(new Date('2026-10-27T21:30:00Z')).toISOString()).toBe('2026-10-27T21:00:00.000Z');
    expect(trAyBasi(new Date('2026-11-01T00:30:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('gonderim penceresi hafta ici 10-17 TR', () => {
    expect(gonderimPenceresinde(new Date('2026-10-27T07:00:00Z'))).toBe(true); // Sali 10:00
    expect(gonderimPenceresinde(new Date('2026-10-27T06:59:00Z'))).toBe(false); // 09:59
    expect(gonderimPenceresinde(new Date('2026-10-27T14:00:00Z'))).toBe(false); // 17:00
    expect(gonderimPenceresinde(new Date('2026-10-31T09:00:00Z'))).toBe(false); // Cumartesi
  });
});

describe('kota ve fren', () => {
  it('tur kotasi gunluk, aylik ve tur sinirinin en kucugu', () => {
    expect(turKotasi({ bugunGonderilen: 0, ayGonderilen: 0, gunluk: 200, aylik: 6000, turBasi: 40 })).toBe(40);
    expect(turKotasi({ bugunGonderilen: 190, ayGonderilen: 0, gunluk: 200, aylik: 6000, turBasi: 40 })).toBe(10);
    expect(turKotasi({ bugunGonderilen: 0, ayGonderilen: 5995, gunluk: 200, aylik: 6000, turBasi: 40 })).toBe(5);
    expect(turKotasi({ bugunGonderilen: 250, ayGonderilen: 0, gunluk: 200, aylik: 6000, turBasi: 40 })).toBe(0);
  });

  it('fren: az orneklemde durmaz, esik ustunde durur', () => {
    expect(frenNedeni({ gonderilen: 20, bounce: 5, spam: 0 })).toBeNull();
    expect(frenNedeni({ gonderilen: 100, bounce: 3, spam: 0 })).toBeNull();
    expect(frenNedeni({ gonderilen: 100, bounce: 4, spam: 0 })).toMatch(/geri dönme/);
    expect(frenNedeni({ gonderilen: 100, bounce: 0, spam: 1 })).toMatch(/spam/);
    expect(frenNedeni({ gonderilen: 40, bounce: 0, spam: 1 })).toBeNull();
  });
});

describe('Mailjet olaylari', () => {
  it('olaylar dogru durum ve alanlara eslenir', () => {
    expect(olayEsle({ event: 'open' })).toMatchObject({ acildi: true, sonOlay: 'open' });
    expect(olayEsle({ event: 'click' })).toMatchObject({ tiklandi: true, acildi: true });
    expect(olayEsle({ event: 'bounce', hard_bounce: true, error: 'user unknown' })).toMatchObject({ durum: 'BOUNCE', sonOlay: 'hard_bounce' });
    expect(olayEsle({ event: 'spam' })?.durum).toBe('SPAM');
    expect(olayEsle({ event: 'unsub' })?.durum).toBe('RET');
    expect(olayEsle({ event: 'bilinmeyen' })).toBeNull();
  });

  it('olay zamani unix saniye; bozuksa simdi', () => {
    expect(olayZamani({ time: 1793000000 }).toISOString()).toBe(new Date(1793000000 * 1000).toISOString());
    const simdi = new Date('2026-10-27T10:00:00Z');
    expect(olayZamani({}, simdi)).toBe(simdi);
  });
});

describe('ice aktarma', () => {
  it('kurumsal satir kabul; sektor disi diger olur; varyant ve web', () => {
    const r = iceAktarSatiri({ email: 'Info@Acme.com.tr', ad: '', soyad: '', firma: 'ACME A.Ş.', sektor: 'kozmetik', konu_varyanti: 'B', web: 'https://www.acme.com.tr/' });
    expect('satir' in r && r.satir).toMatchObject({ email: 'info@acme.com.tr', sektor: 'diger', varyant: 'B', web: 'acme.com.tr', gecmis: null });
  });

  it('kisi adli satir ve gecersiz e-posta reddedilir', () => {
    expect(iceAktarSatiri({ email: 'ayse@acme.com', ad: 'Ayşe', soyad: 'Y', firma: 'Acme', sektor: 'ajans' })).toHaveProperty('hata');
    expect(iceAktarSatiri({ email: 'bozuk', firma: 'Acme' })).toHaveProperty('hata');
  });

  it('gecmis gonderim (CLI) GONDERILDI olarak tasinir', () => {
    const r = iceAktarSatiri({ email: 'info@ajans.com', firma: 'Ajans', sektor: 'ajans', durum: 'gonderildi', kampanya: 'kurumsal-ajans-1', messageId: '123', tarih: '2026-10-27T04:00:00Z' });
    expect('satir' in r && r.satir.gecmis).toMatchObject({ kampanya: 'kurumsal-ajans-1', messageId: '123' });
  });
});

describe('firmaAnahtari', () => {
  it('hukuki ekleri atip ilk iki kelimeyle eslestirir', () => {
    expect(firmaAnahtari('PUNCH BBDO REKLAMCILIK VE İLETİŞİM HİZMETLERİ TİCARET A.Ş.')).toBe('punch bbdo');
    expect(firmaAnahtari('Punch BBDO')).toBe('punch bbdo');
  });
});
