import { describe, expect, it } from 'vitest';
import { ajanCanli, ajanKomutu, epostaSerisiEngelMi, kabulKomutu, kabulNumaralari, sonKabulSlotu, anahtarDogru, anahtarOzeti, prospectGuncellemesi, sonucuAyikla, yeniAnahtar } from './linkedin-claude.js';

const simdi = new Date('2026-11-26T09:00:00Z');

describe('Claude ile LinkedIn gonderimi', () => {
  it('anahtar: yalniz dogru anahtar gecer, ozet anahtari icermez', () => {
    const a = yeniAnahtar();
    const o = anahtarOzeti(a);
    expect(o).not.toContain(a);
    expect(anahtarDogru(o, a)).toBe(true);
    expect(anahtarDogru(o, a + 'x')).toBe(false);
    expect(anahtarDogru(o, undefined)).toBe(false);
    expect(anahtarDogru(null, a)).toBe(false);
  });

  it('kuru turda kayda hic dokunulmaz', () => {
    expect(prospectGuncellemesi('GONDERILDI', true, 'not', 'x', simdi)).toBeNull();
    expect(prospectGuncellemesi('BULUNAMADI', true, 'not', 'x', simdi)).toBeNull();
  });

  it('gercek turda sonuc kayda dogru islenir', () => {
    expect(prospectGuncellemesi('GONDERILDI', false, 'Merhaba', 'ok', simdi)).toEqual({ status: 'REQUESTED', requestedAt: simdi, noteText: 'Merhaba', lastError: null });
    expect(prospectGuncellemesi('ZATEN_BAGLI', false, 'n', 'x', simdi)?.status).toBe('ACCEPTED');
    expect(prospectGuncellemesi('BULUNAMADI', false, 'n', 'ad uyusmadi', simdi)).toEqual({ status: 'FAILED', lastError: 'Claude: ad uyusmadi' });
    // Gecici hata kisiyi kuyruktan cikarmaz, yalniz not dusulur
    expect(prospectGuncellemesi('HATA', false, 'n', 'zaman asimi', simdi)).toEqual({ lastError: 'Claude: zaman asimi' });
  });

  it('ajan ciktisindaki son gecerli JSON alinir', () => {
    const cikti = 'Profili actim.\n{"durum":"HATA","aciklama":"ilk"}\nTekrar denedim.\n{"durum":"GONDERILDI","aciklama":"istek gitti"}';
    expect(sonucuAyikla(cikti)).toEqual({ durum: 'GONDERILDI', aciklama: 'istek gitti' });
    expect(sonucuAyikla('{"durum":"UYDURMA"}')).toBeNull();
    expect(sonucuAyikla('json yok')).toBeNull();
  });

  it('kuru komut Gonder\'e basmayi yasaklar, gercek komut ister; not aynen gecer', () => {
    const k = { ad: 'Ayşe', soyad: 'Kaya', firma: 'Örnek AŞ', unvan: null, profileUrl: 'https://www.linkedin.com/in/ornek/', not: 'Merhaba Ayşe Hanım, not metni.' };
    const kuru = ajanKomutu(k, true);
    const gercek = ajanKomutu(k, false);
    expect(kuru).toContain('BASMA');
    expect(kuru).toContain('KURU_TAMAM');
    expect(gercek).toContain('"GONDERILDI"');
    expect(gercek).not.toContain('KURU DENEME');
    for (const m of [kuru, gercek]) {
      expect(m).toContain('<<<\nMerhaba Ayşe Hanım, not metni.\n>>>');
      expect(m).toContain('https://www.linkedin.com/in/ornek/');
      expect(m).toContain('"ENGEL"');
    }
  });

  it('Mac servisi: is surerken kisiler arasi beklemede "kapali" gorunmez', () => {
    const t = new Date('2026-11-26T14:20:00Z');
    const dk = (n: number) => new Date(t.getTime() - n * 60_000);
    expect(ajanCanli(dk(1), false, t)).toBe(true);
    expect(ajanCanli(dk(6), false, t)).toBe(false);
    expect(ajanCanli(dk(6), true, t)).toBe(true);
    expect(ajanCanli(dk(20), true, t)).toBe(false);
    expect(ajanCanli(null, true, t)).toBe(false);
  });

  it('e-posta isteyen kisi atlanir; ust uste ikincisi isi durdurur', () => {
    expect(prospectGuncellemesi('EPOSTA_ISTIYOR', false, 'n', 'e-posta istedi', simdi)).toEqual({ status: 'FAILED', lastError: 'Claude: e-posta istedi' });
    expect(prospectGuncellemesi('EPOSTA_ISTIYOR', true, 'n', 'x', simdi)).toBeNull();
    expect(epostaSerisiEngelMi([], 'EPOSTA_ISTIYOR')).toBe(false);
    expect(epostaSerisiEngelMi([{ durum: 'GONDERILDI' }], 'EPOSTA_ISTIYOR')).toBe(false);
    expect(epostaSerisiEngelMi([{ durum: 'GONDERILDI' }, { durum: 'EPOSTA_ISTIYOR' }], 'EPOSTA_ISTIYOR')).toBe(true);
    expect(epostaSerisiEngelMi([{ durum: 'EPOSTA_ISTIYOR' }], 'GONDERILDI')).toBe(false);
    expect(ajanKomutu({ ad: 'A', soyad: 'B', firma: 'X', unvan: null, profileUrl: 'u', not: 'n' }, false)).toContain('"EPOSTA_ISTIYOR". Bu ENGEL değildir');
  });

  it('kabul kontrolu: hafta ici 10/14/17 saatleri, hafta sonu ve 10:00 oncesi yok', () => {
    // 26.11.2026 Persembe
    expect(sonKabulSlotu(new Date('2026-11-26T06:59:00Z'))).toBeNull(); // 09:59 TR
    expect(sonKabulSlotu(new Date('2026-11-26T07:00:00Z'))?.toISOString()).toBe('2026-11-26T07:00:00.000Z'); // 10:00
    expect(sonKabulSlotu(new Date('2026-11-26T12:30:00Z'))?.toISOString()).toBe('2026-11-26T11:00:00.000Z'); // 15:30 → 14:00
    expect(sonKabulSlotu(new Date('2026-11-26T20:00:00Z'))?.toISOString()).toBe('2026-11-26T14:00:00.000Z'); // 23:00 → 17:00
    expect(sonKabulSlotu(new Date('2026-11-28T09:00:00Z'))).toBeNull(); // Cumartesi
  });

  it('kabul kontrolu: yalniz okuma komutu, numaralar dogrulanir', () => {
    const k = kabulKomutu([{ no: 1, adSoyad: 'Ayşe Kaya', profileUrl: 'https://www.linkedin.com/in/ayse/' }, { no: 3, adSoyad: 'Ali Veli', profileUrl: 'https://www.linkedin.com/in/ali/' }]);
    expect(k).toContain('YALNIZ OKUMA');
    expect(k).toContain('mynetwork/invite-connect/connections');
    expect(k).toContain('3. Ali Veli — https://www.linkedin.com/in/ali/');
    expect(k).toContain('Bildirimler sayfasını açma');
    expect(kabulNumaralari({ kabul: [3, 1, 3, '2', 0, 9, 1.5, 'x'] }, 3)).toEqual([1, 2, 3]);
    expect(kabulNumaralari({ kabul: 'hepsi' }, 3)).toEqual([]);
    expect(kabulNumaralari(null, 3)).toEqual([]);
  });
});

