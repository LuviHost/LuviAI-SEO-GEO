import { describe, it, expect } from 'vitest';
import { brandSharePct, shareOfVoiceList, rivalsFromCompetitors } from './share-of-voice.js';

/**
 * Share of Voice testleri.
 *
 * Bu metrik iki serviste birden kullaniliyor (ai-citation aggregateProbes ve
 * ai-kpis getKpis). Eskiden iki ayri hesap vardi ve ayni site icin farkli
 * sayi donuyorlardi. Buradaki sinirlar o ayrismanin geri gelmesini engeller.
 */

describe('sayim birimi tutarliligi (public API uzerinden)', () => {
  it('bir cevapta ayni rakibi bir kez sayar (ham anilma adedi degil)', () => {
    // Eski hata: rakip bir cevapta 5 kez gecerse 5 puan aliyordu, marka ise
    // ayni cevapta 1. Marka sistematik olarak dusuk cikiyordu.
    const list = shareOfVoiceList(
      [{ brandPresent: true, rivals: ['rakip.com', 'rakip.com', 'rakip.com'] }],
      'Marka',
    );
    expect(list.find((e) => e.isBrand)?.mentions).toBe(1);
    expect(list.find((e) => e.name === 'rakip.com')?.mentions).toBe(1);
    expect(brandSharePct([{ brandPresent: true, rivals: ['rakip.com', 'rakip.com'] }])).toBe(50);
  });

  it('marka ve rakip ayni birimle sayilir — esit gorunurluk %50', () => {
    expect(
      brandSharePct([
        { brandPresent: true, rivals: ['a.com'] },
        { brandPresent: true, rivals: ['a.com'] },
      ]),
    ).toBe(50);
  });

  it('farkli cevaplarda gecen ayni rakip birikir', () => {
    const list = shareOfVoiceList(
      [
        { brandPresent: false, rivals: ['a.com'] },
        { brandPresent: false, rivals: ['a.com'] },
        { brandPresent: true, rivals: [] },
      ],
      'Marka',
    );
    expect(list.find((e) => e.name === 'a.com')?.mentions).toBe(2);
    expect(list.find((e) => e.isBrand)?.mentions).toBe(1);
  });

  it('bos ve yalniz-bosluk ad atlanir', () => {
    const list = shareOfVoiceList([{ brandPresent: true, rivals: ['', '   '] }], 'Marka');
    expect(list).toHaveLength(1); // yalnizca marka satiri
  });

  it('bastaki/sondaki bosluk ayni rakibi ikiye bolmez', () => {
    const list = shareOfVoiceList(
      [
        { brandPresent: false, rivals: ['a.com'] },
        { brandPresent: false, rivals: [' a.com '] },
      ],
      'Marka',
    );
    expect(list.find((e) => e.name === 'a.com')?.mentions).toBe(2);
  });
});

describe('rivalsFromCompetitors — gorunurluk esigi', () => {
  it('mentions > 0 olanlarin adini doner', () => {
    expect(rivalsFromCompetitors([
      { name: 'a.com', mentions: 3 },
      { name: 'b.com', mentions: 0 },
      { name: '', mentions: 5 },
      null as any,
    ])).toEqual(['a.com']);
  });

  it('bozuk girdide bos doner', () => {
    expect(rivalsFromCompetitors(null)).toEqual([]);
    expect(rivalsFromCompetitors(undefined)).toEqual([]);
  });
});

describe('brandSharePct — olculemeyen durum', () => {
  it('hicbir gozlem yoksa null doner (sifir degil)', () => {
    expect(brandSharePct([])).toBeNull();
  });

  it('ne marka ne rakip gorundüyse null doner', () => {
    // "%0 pay" ile "olculecek bir sey yok" ayni sey degil
    expect(brandSharePct([{ brandPresent: false, rivals: [] }])).toBeNull();
  });

  it('yalniz marka gorunduyse %100', () => {
    expect(brandSharePct([{ brandPresent: true, rivals: [] }])).toBe(100);
  });

  it('yalniz rakip gorunduyse %0', () => {
    expect(brandSharePct([{ brandPresent: false, rivals: ['a.com'] }])).toBe(0);
  });
});

describe('shareOfVoiceList — siralama ve tutarlilik', () => {
  const obs = [
    { brandPresent: true, rivals: ['a.com', 'b.com'] },
    { brandPresent: false, rivals: ['a.com'] },
    { brandPresent: true, rivals: ['a.com'] },
  ];

  it('marka her zaman basta ve isaretli', () => {
    const list = shareOfVoiceList(obs, 'Bizim Marka');
    expect(list[0].name).toBe('Bizim Marka');
    expect(list[0].isBrand).toBe(true);
    expect(list[0].mentions).toBe(2);
  });

  it('rakipler gorunurluge gore azalan sirada', () => {
    const list = shareOfVoiceList(obs, 'Bizim Marka');
    const rivals = list.filter((e) => !e.isBrand);
    expect(rivals.map((r) => r.name)).toEqual(['a.com', 'b.com']);
    expect(rivals[0].mentions).toBe(3);
    expect(rivals[1].mentions).toBe(1);
  });

  it('liste yuzdesi ile tek-sayi yuzdesi ayni hesaba dayanir', () => {
    // 2 marka / (2 + 3 + 1) = %33,3 → liste tam sayiya yuvarlar
    expect(brandSharePct(obs)).toBe(33.3);
    expect(shareOfVoiceList(obs, 'X')[0].pct).toBe(33);
  });

  it('olculecek sey yoksa bos liste', () => {
    expect(shareOfVoiceList([], 'X')).toEqual([]);
    expect(shareOfVoiceList([{ brandPresent: false, rivals: [] }], 'X')).toEqual([]);
  });
});
