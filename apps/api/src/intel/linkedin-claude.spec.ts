import { describe, expect, it } from 'vitest';
import { ajanCanli, ajanKomutu, anahtarDogru, anahtarOzeti, prospectGuncellemesi, sonucuAyikla, yeniAnahtar } from './linkedin-claude.js';

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
});
