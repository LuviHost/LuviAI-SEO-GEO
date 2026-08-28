import { describe, it, expect } from 'vitest';
import {
  translit, slugName, normalizeDomain, splitName, localPart, detectPattern, inferPattern,
  candidateEmails, decideStatus, parseCsv, toCsv, isGenericLocalPart, parseArgs, dedupeBy, titleCaseTr,
} from './prospect-utils.js';

describe('translit / slugName', () => {
  it('Turkce karakterleri ASCII yapar, noktalama siler', () => {
    expect(translit('Şükrü Özdemir')).toBe('sukru ozdemir');
    expect(translit('İbrahim Çağrı Işık')).toBe('ibrahim cagri isik');
    expect(slugName('Ayşe Nur')).toBe('aysenur');
    expect(translit("D'Angelo-Öz")).toBe('dangelooz');
  });
});

describe('normalizeDomain', () => {
  it('www, sema, yol ve buyuk harfi temizler', () => {
    expect(normalizeDomain('https://www.Papara.com/tr/kurumsal?x=1')).toBe('papara.com');
    expect(normalizeDomain('turkcell.com.tr')).toBe('turkcell.com.tr');
    expect(normalizeDomain('http://www.x.com.tr.')).toBe('x.com.tr');
  });
  it('gecersizleri eler', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('10.0.0.1')).toBeNull();
    expect(normalizeDomain('Websitesi Belirtilmemiş!')).toBeNull();
  });
});

describe('splitName / localPart / detectPattern', () => {
  it('son kelime soyad, gerisi ad; unvan onekleri atilir', () => {
    expect(splitName('Ayşe Nur Kaya')).toEqual({ ad: 'Ayşe Nur', soyad: 'Kaya' });
    expect(splitName('Dr. Murat Akgüç')).toEqual({ ad: 'Murat', soyad: 'Akgüç' });
    expect(splitName('Madonna')).toEqual({ ad: 'Madonna', soyad: '' });
  });
  it('sekiz desen', () => {
    expect(localPart('ad.soyad', 'Ayşe Nur', 'Kaya')).toBe('aysenur.kaya');
    expect(localPart('asoyad', 'Ayşe Nur', 'Kaya')).toBe('akaya');
    expect(localPart('ad_soyad', 'Ayşe Nur', 'Kaya')).toBe('aysenur_kaya');
    expect(localPart('ad', 'Ayşe Nur', 'Kaya')).toBe('aysenur');
    expect(localPart('soyad.ad', 'Ayşe Nur', 'Kaya')).toBe('kaya.aysenur');
    expect(localPart('a.soyad', 'Ayşe Nur', 'Kaya')).toBe('a.kaya');
    expect(localPart('adsoyad', 'Ayşe Nur', 'Kaya')).toBe('aysenurkaya');
    expect(localPart('ad-soyad', 'Ayşe Nur', 'Kaya')).toBe('aysenur-kaya');
  });
  it('bilinen adresten deseni bulur', () => {
    expect(detectPattern('murat.akguc@turkcell.com.tr', 'Murat', 'Akgüç')).toBe('ad.soyad');
    expect(detectPattern('makguc@turkcell.com.tr', 'Murat', 'Akgüç')).toBe('asoyad');
    expect(detectPattern('info@turkcell.com.tr', 'Murat', 'Akgüç')).toBeNull();
  });
});

describe('inferPattern', () => {
  it('isimli ornek kesin oy; genel kutular sayilmaz', () => {
    const r = inferPattern([
      { email: 'murat.akguc@x.com.tr', name: 'Murat Akgüç' },
      { email: 'info@x.com.tr' },
      { email: 'basin@x.com.tr' },
    ]);
    expect(r).toMatchObject({ kind: 'ad.soyad', confidence: 1 });
  });
  it('isimsiz orneklerde ayiricidan cikarim; coguluk kazanir', () => {
    const r = inferPattern([{ email: 'a.yilmaz@x.com' }, { email: 'b.kaya@x.com' }, { email: 'cem.demir@x.com' }]);
    expect(r?.kind).toBe('a.soyad');
    expect(r?.confidence).toBeCloseTo(0.67, 1);
  });
  it('yalniz genel kutu → null; ayiricisiz tek kelime → null (asoyad/ad ayirt edilemez)', () => {
    expect(inferPattern([{ email: 'iletisim@x.com' }])).toBeNull();
    expect(inferPattern([{ email: 'mkaya@x.com' }])).toBeNull();
  });
  it('tek isimsiz noktali adres desen SAYILMAZ (iki-kaynak); noktali genel kutular elenir', () => {
    expect(inferPattern([{ email: 'bilgi.edinme@x.com' }])).toBeNull();
    expect(inferPattern([{ email: 'sosyal.medya@x.com' }, { email: 'e.ticaret@x.com' }])).toBeNull();
    expect(inferPattern([{ email: 'cem.demir@x.com' }])).toBeNull();
    expect(inferPattern([{ email: 'cem.demir@x.com' }, { email: 'cem.demir@x.com' }])).toBeNull(); // ayni adres iki kez
    const iki = inferPattern([{ email: 'cem.demir@x.com' }, { email: 'ali.kaya@x.com' }]);
    expect(iki).toMatchObject({ kind: 'ad.soyad', confidence: 1 });
  });
  it('isimli tek ornek kesin (agirlik 2), isimsiz karsi oy onu gecemez', () => {
    const r = inferPattern([{ email: 'mkaya@x.com', name: 'Mehmet Kaya' }, { email: 'ali.veli@x.com' }]);
    expect(r?.kind).toBe('asoyad');
  });
});

describe('candidateEmails', () => {
  it('varsayilan uc desen, sirali, tekrarsiz', () => {
    expect(candidateEmails('Şükrü', 'Özdemir', 'x.com.tr')).toEqual([
      'sukru.ozdemir@x.com.tr', 'sozdemir@x.com.tr', 'sukru_ozdemir@x.com.tr',
    ]);
    expect(candidateEmails('Şükrü', '', 'x.com.tr')).toEqual([]);
  });
  it('cok kelimeli ad: birlesik + yalniz ilk ad varyanti (cift soyad)', () => {
    expect(candidateEmails('Elif Yılmaz', 'Kaya', 'x.com', ['ad.soyad'])).toEqual(['elifyilmaz.kaya@x.com', 'elif.kaya@x.com']);
  });
});

describe('splitName ekleri / titleCaseTr', () => {
  it('parantez ve akademik onekler temizlenir', () => {
    expect(splitName('Yrd. Doç. Dr. Ali Veli')).toEqual({ ad: 'Ali', soyad: 'Veli' });
    expect(splitName('Ali Veli (Vekil)')).toEqual({ ad: 'Ali', soyad: 'Veli' });
  });
  it('BUYUK HARF isimler Turkce baslik harfine doner, karisik olanlara dokunmaz', () => {
    expect(titleCaseTr('MEHMET ALİ IŞIK')).toBe('Mehmet Ali Işık');
    expect(titleCaseTr('İBRAHİM ÇAĞRI')).toBe('İbrahim Çağrı');
    expect(titleCaseTr('Ayşe Nur')).toBe('Ayşe Nur');
  });
});

describe('decideStatus', () => {
  it('karar tablosu', () => {
    expect(decideStatus({ rcptCode: 250, randomCode: 550 })).toBe('valid');
    expect(decideStatus({ rcptCode: 250, randomCode: 250 })).toBe('catch_all');
    expect(decideStatus({ rcptCode: 550, randomCode: 550 })).toBe('invalid');
    expect(decideStatus({ rcptCode: 250, randomCode: null })).toBe('unknown');
    expect(decideStatus({ rcptCode: 451, randomCode: 550 })).toBe('unknown');
    expect(decideStatus({ rcptCode: null, randomCode: null })).toBe('unknown');
  });
});

describe('csv', () => {
  it('tirnak, virgul ve satir sonu gidis-donus', () => {
    const rows = [{ firma: 'A, B "Ltd"', web: 'a.com', not: 'satır\nkırık' }, { firma: 'C', web: '', not: '' }];
    const text = toCsv(rows, ['firma', 'web', 'not']);
    expect(parseCsv(text)).toEqual(rows);
  });
  it('BOM ve CRLF', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('yardimcilar', () => {
  it('genel kutu tespiti', () => {
    expect(isGenericLocalPart('info')).toBe(true);
    expect(isGenericLocalPart('investor.relations')).toBe(true); // noktali genel kutu — desen cikariminda ad.soyad sanilmamali
    expect(isGenericLocalPart('kurumsal.iletisim')).toBe(true);
    expect(isGenericLocalPart('insan_kaynaklari')).toBe(true);
    expect(isGenericLocalPart('murat.akguc')).toBe(false);
  });
  it('parseArgs ve dedupeBy', () => {
    expect(parseArgs(['--sektor', 'finans', '--apply', '--limit', '20'])).toEqual({ sektor: 'finans', apply: true, limit: '20' });
    expect(dedupeBy([{ d: 'a' }, { d: 'a' }, { d: null }, { d: 'b' }], (r) => r.d)).toHaveLength(3);
  });
});
