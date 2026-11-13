/**
 * Sayfa yukleme hatalari: bayat surum + yarida kesilen yukleme (13.11.2026).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  YENILEME_ANAHTARI, YENILEME_ARALIGI_MS,
  sessizYenilemeHakki, sessizYenilemeyiAl, yuklemeHatasiMetni, yuklemeHatasiTuru,
} from './yukleme-hatasi';

function depo(ilk: Record<string, string> = {}) {
  const veri = new Map(Object.entries(ilk));
  return {
    veri,
    getItem: (k: string) => veri.get(k) ?? null,
    setItem: (k: string, v: string) => { veri.set(k, v); },
  };
}
const bozukDepo = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
};
const SIMDI = 1_800_000_000_000;

describe('hata turu', () => {
  it('bayat surum: eski sekmenin isteyip bulamadigi parca', () => {
    expect(yuklemeHatasiTuru({ name: 'ChunkLoadError', message: 'Loading chunk 4125 failed.' })).toBe('bayat-surum');
    expect(yuklemeHatasiTuru({ name: 'Error', message: 'Loading chunk app/page-8ac2 failed' })).toBe('bayat-surum');
    expect(yuklemeHatasiTuru({ name: 'Error', message: 'Loading CSS chunk 12 failed' })).toBe('bayat-surum');
    // Safari ve Firefox'un kendi cumleleri
    expect(yuklemeHatasiTuru({ name: 'TypeError', message: 'Importing a module script failed.' })).toBe('bayat-surum');
    expect(yuklemeHatasiTuru({ name: 'TypeError', message: 'Failed to fetch dynamically imported module: https://ranksup.ai/x.js' })).toBe('bayat-surum');
    expect(yuklemeHatasiTuru({ name: 'TypeError', message: 'error loading dynamically imported module' })).toBe('bayat-surum');
  });

  it('yarim yukleme: React\'in tam mesaji (sayfa indirilirken baglanti kesildi)', () => {
    expect(yuklemeHatasiTuru({ name: 'Error', message: 'Connection closed.' })).toBe('yarim-yukleme');
    expect(yuklemeHatasiTuru({ name: 'Error', message: ' Connection closed ' })).toBe('yarim-yukleme');
  });

  it('icinde "connection closed" gecen BASKA hatalar ve gercek cokmeler taninmaz', () => {
    expect(yuklemeHatasiTuru({ name: 'Error', message: 'Connection closed by server while saving article' })).toBeNull();
    expect(yuklemeHatasiTuru({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'map')" })).toBeNull();
    expect(yuklemeHatasiTuru({ name: 'Error', message: '' })).toBeNull();
    expect(yuklemeHatasiTuru(null)).toBeNull();
    expect(yuklemeHatasiTuru(undefined)).toBeNull();
    expect(yuklemeHatasiTuru({ message: 42 })).toBeNull();
  });
});

describe('ekran metni', () => {
  it('iki tur icin baslik, aciklama ve dugme dolu; dugme ne yapacagini soyler', () => {
    expect(yuklemeHatasiMetni('bayat-surum')).toMatchObject({ baslik: 'Yeni sürüm yayınlandı', dugme: 'Güncel sürüme geç' });
    expect(yuklemeHatasiMetni('yarim-yukleme')).toMatchObject({ baslik: 'Sayfa tam yüklenemedi', dugme: 'Sayfayı yeniden yükle' });
    for (const tur of ['bayat-surum', 'yarim-yukleme'] as const) {
      const m = yuklemeHatasiMetni(tur)!;
      expect(m.aciklama.length).toBeGreaterThan(20);
      // Bayat sekme / kesilen yukleme veri kaybettirmez; ekran bunu soyler
      expect(m.aciklama).toContain('verilerin etkilenmedi');
    }
  });

  it('taninmayan hatada null: ekran kendi genel metnini kullanir', () => {
    expect(yuklemeHatasiMetni(null)).toBeNull();
  });
});

describe('sessiz yenileme — aralikta en fazla bir kez, dongu yok', () => {
  it('ilk hatada hak var; alininca zaman yazilir', () => {
    const d = depo();
    expect(sessizYenilemeHakki(d, SIMDI)).toBe(true);
    expect(d.veri.has(YENILEME_ANAHTARI)).toBe(false); // hak sorgusu yazmaz
    expect(sessizYenilemeyiAl(d, SIMDI)).toBe(true);
    expect(d.veri.get(YENILEME_ANAHTARI)).toBe(String(SIMDI));
  });

  it('yenilenen sayfa da ayni hatayi verirse ikinci yenileme yapilmaz', () => {
    const d = depo();
    expect(sessizYenilemeyiAl(d, SIMDI)).toBe(true);
    expect(sessizYenilemeyiAl(d, SIMDI + 5_000)).toBe(false);
    expect(sessizYenilemeHakki(d, SIMDI + YENILEME_ARALIGI_MS - 1)).toBe(false);
    expect(d.veri.get(YENILEME_ANAHTARI)).toBe(String(SIMDI)); // reddedilen deneme zamani ilerletmez
  });

  it('aralik gecince (saatler sonra yeni bir yayin / yeni bir kopma) yeniden hak dogar', () => {
    const d = depo({ [YENILEME_ANAHTARI]: String(SIMDI) });
    expect(sessizYenilemeyiAl(d, SIMDI + YENILEME_ARALIGI_MS)).toBe(true);
    expect(d.veri.get(YENILEME_ANAHTARI)).toBe(String(SIMDI + YENILEME_ARALIGI_MS));
  });

  it('cevrimdisiyken yenileme yok: tarayicinin "baglanti yok" sayfasina dusurmez', () => {
    const d = depo();
    expect(sessizYenilemeHakki(d, SIMDI, false)).toBe(false);
    expect(sessizYenilemeyiAl(d, SIMDI, false)).toBe(false);
    expect(d.veri.size).toBe(0);
  });

  it('depo yoksa ya da erisim hata firlatiyorsa yenileme yok (dongu korumasi tutulamaz)', () => {
    expect(sessizYenilemeHakki(null, SIMDI)).toBe(false);
    expect(sessizYenilemeyiAl(undefined, SIMDI)).toBe(false);
    expect(sessizYenilemeHakki(bozukDepo, SIMDI)).toBe(false);
    expect(sessizYenilemeyiAl(bozukDepo, SIMDI)).toBe(false);
    // okunuyor ama yazilamiyor (kota dolu): yenileme yapilmaz
    const yazilamaz = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(sessizYenilemeyiAl(yazilamaz, SIMDI)).toBe(false);
  });

  it('bozuk ya da gelecekteki kayit hakki kilitlemez', () => {
    expect(sessizYenilemeHakki(depo({ [YENILEME_ANAHTARI]: 'abc' }), SIMDI)).toBe(true);
    expect(sessizYenilemeHakki(depo({ [YENILEME_ANAHTARI]: String(SIMDI + 3_600_000) }), SIMDI)).toBe(true);
    expect(sessizYenilemeHakki(depo({ [YENILEME_ANAHTARI]: '0' }), SIMDI)).toBe(true);
  });
});
