/**
 * AI cevaplarinda rakip gorunurlugu — panel metinleri (13.11.2026).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  alanAdindanAd, degisimMetni, gunMetni, ilkAnilanMetni, kaynakMetni, listedeVar, olcumVar, oneridenRakip, ozetMetni, payYuzdesi,
} from './rakip-gorunurlugu';

const toplam = { answers: 120, questions: 20, providers: ['openai', 'xai', 'gemini'], firstMeasuredAt: '2026-11-10', lastMeasuredAt: '2026-11-11', comparablePairs: 48 };

describe('ozet ve pay', () => {
  it('ozet satiri: cevap, soru, asistan ve son olcum gunu', () => {
    expect(ozetMetni(toplam)).toBe('120 cevap · 20 soru · 3 asistan · son ölçüm 11 Kasım');
    expect(ozetMetni({ ...toplam, lastMeasuredAt: null })).toBe('120 cevap · 20 soru · 3 asistan');
  });

  it('gun metni UTC: saat dilimi bir gun kaydirmaz; bozuk tarih bos', () => {
    expect(gunMetni('2026-11-01')).toBe('1 Kasım');
    expect(gunMetni('bozuk')).toBe('');
    expect(gunMetni(null)).toBe('');
  });

  it('pay yuzdesi tam sayi; toplam yoksa 0', () => {
    expect(payYuzdesi(7, 120)).toBe(6);
    expect(payYuzdesi(37, 119)).toBe(31);
    expect(payYuzdesi(3, 0)).toBe(0);
  });

  it('olcum var mi', () => {
    expect(olcumVar({ totals: toplam })).toBe(true);
    expect(olcumVar({ totals: { ...toplam, answers: 0 } })).toBe(false);
    expect(olcumVar(null)).toBe(false);
  });
});

describe('ilk anilan — payda yalniz sirasi kayitli cevaplar (14.11.2026)', () => {
  it('sayi / sirasi kayitli cevap; aciklama ne sayildigini soyler', () => {
    expect(ilkAnilanMetni({ answers: 12, firstAnswers: 5, firstUnknown: 0 })).toEqual({
      text: '5', payda: 12, bilinmeyen: 0,
      title: 'Sırası kayıtlı 12 cevaptan 5 tanesinde, markan ve rakiplerin arasında ilk bu ad geçti (tek başına geçtiği cevaplar dahil).',
    });
    expect(ilkAnilanMetni({ answers: 4, firstAnswers: 0, firstUnknown: 0 })).toMatchObject({ text: '0', payda: 4, bilinmeyen: 0 });
  });

  it('sirasi bilinmeyen cevap paydadan duser; sayisi hucrede gorunsun diye ayrica doner', () => {
    const m = ilkAnilanMetni({ answers: 12, firstAnswers: 3, firstUnknown: 4 });
    expect(m).toMatchObject({ text: '3', payda: 8, bilinmeyen: 4 });
    expect(m.title).toContain('4 cevapta sıra kayıtlı değil (eski ölçüm); bunlar sayılmadı.');
  });

  it('yayin gunu marka satiri: yalniz tek basina gectigi cevaplar bilinir → "4 / 4" yaninda 6 bilinmeyen', () => {
    expect(ilkAnilanMetni({ answers: 10, firstAnswers: 4, firstUnknown: 6 })).toMatchObject({ text: '4', payda: 4, bilinmeyen: 6 });
  });

  it('adi gecmeyen, sirasi hic kayitli olmayan ve eski sunucu: cizgi', () => {
    expect(ilkAnilanMetni({ answers: 0, firstAnswers: 0, firstUnknown: 0 })).toMatchObject({ text: '—', payda: null, bilinmeyen: 0 });
    expect(ilkAnilanMetni({ answers: 3, firstAnswers: 0, firstUnknown: 3 })).toEqual({
      text: '—', payda: null, bilinmeyen: 3, title: 'Adının geçtiği 3 cevapta sıra kayıtlı değil (eski ölçüm).',
    });
    expect(ilkAnilanMetni({ answers: 3 })).toEqual({ text: '—', payda: null, bilinmeyen: 0, title: '' });
  });
});

describe('degisim metni — yalniz karsilastirilabilir cevaplar', () => {
  it('artis, azalis (gercek eksi isareti) ve ayni', () => {
    expect(degisimMetni({ pairs: 40, before: 2, now: 5 })).toMatchObject({ text: '+3', yon: 'artti' });
    expect(degisimMetni({ pairs: 40, before: 5, now: 2 })).toMatchObject({ text: '−3', yon: 'azaldi' });
    expect(degisimMetni({ pairs: 40, before: 4, now: 4 })).toMatchObject({ text: 'aynı', yon: 'ayni' });
    expect(degisimMetni({ pairs: 40, before: 2, now: 5 }).title).toBe('Önceki ölçümde 2, şimdi 5 cevapta geçiyor (40 karşılaştırılabilir cevapta).');
  });

  it('onceki olcum yoksa cizgi ve aciklama', () => {
    expect(degisimMetni(null)).toMatchObject({ text: '—', yon: 'yok' });
    expect(degisimMetni({ pairs: 0, before: 0, now: 0 }).yon).toBe('yok');
  });
});

describe('kaynak ve oneri', () => {
  it('adres tanimli degilse "adres yok"; tanimliysa sayi (0 dahil)', () => {
    expect(kaynakMetni(null)).toBe('adres yok');
    expect(kaynakMetni(0)).toBe('0');
    expect(kaynakMetni(4)).toBe('4');
  });

  it('alan adindan ad: ilk etiket, bas harf buyuk (yerelden bagimsiz: "i" → "I", "İ" degil)', () => {
    expect(alanAdindanAd('www.influencerman.com.tr')).toBe('Influencerman');
    expect(alanAdindanAd('creatorden.com')).toBe('Creatorden');
    expect(alanAdindanAd('iddaa.com')).toBe('Iddaa');
  });

  it('oneri → rakip kaydi: https adresi, yol atilir', () => {
    expect(oneridenRakip('Viralif.com')).toEqual({ name: 'Viralif', url: 'https://viralif.com' });
    expect(oneridenRakip('https://share.com.tr/hakkimizda')).toEqual({ name: 'Share', url: 'https://share.com.tr' });
  });

  it('listede ayni adres ya da ayni ad varsa yeniden eklenmez', () => {
    const liste = [{ name: 'Creatorden', url: 'https://www.creatorden.com/tr' }, { name: 'Share' }];
    expect(listedeVar(liste, { name: 'Baska', url: 'https://creatorden.com' })).toBe(true);
    expect(listedeVar(liste, { name: 'share', url: 'https://growbyshare.com' })).toBe(true);
    expect(listedeVar(liste, { name: 'Viralif', url: 'https://viralif.com' })).toBe(false);
  });
});
