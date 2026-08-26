import { describe, it, expect } from 'vitest';
import { parseGscAiCsv, parseNumber, parseDate, normalizeHeader, GscAiCsvError } from './gsc-ai-csv.js';

/**
 * Fixture'lar: kolon seti resmi dokumante degil; EN ve TR arayuz cikislari
 * icin makul varyantlar. Gercek export elde edilince buraya birebir eklenir.
 */
const EN = 'Date,Impressions\n2026-08-20,120\n2026-08-21,"1,234"\n2026-08-22,~\n';
const TR = '﻿Tarih;Gösterimler\n20.08.2026;120\n21.08.2026;1.234\n22.08.2026;-\n';
const PERF = 'Tarih,Tıklamalar,Gösterimler,TO,Pozisyon\n2026-08-20,15,900,"1,7%","8,2"\n';

describe('normalizeHeader / parseNumber / parseDate', () => {
  it('TR harfleri katlar, BOM ve tirnak temizler', () => {
    expect(normalizeHeader('﻿"Gösterimler"')).toBe('gosterimler');
    expect(normalizeHeader('Tıklama Oranı')).toBe('tiklama orani');
  });
  it('binlik/ondalik varyantlari', () => {
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('0,5')).toBe(0.5);
    expect(parseNumber('~')).toBe(0);
    expect(parseNumber('-')).toBe(0);
    expect(parseNumber('abc')).toBeNull();
  });
  it('tarih bicimleri', () => {
    expect(parseDate('2026-08-21')).toBe('2026-08-21');
    expect(parseDate('21.08.2026')).toBe('2026-08-21');
    expect(parseDate('21/08/2026')).toBe('2026-08-21');
    expect(parseDate('26 Ağu 2026')).toBe('2026-08-26');
    expect(parseDate('dun')).toBeNull();
  });
});

describe('parseGscAiCsv', () => {
  it('EN export: virgul, tirnakli binlik, ~ → 0', () => {
    const p = parseGscAiCsv(EN);
    expect(p.delimiter).toBe(',');
    expect(p.rows).toEqual([
      { date: '2026-08-20', impressions: 120, clicks: null, position: null },
      { date: '2026-08-21', impressions: 1234, clicks: null, position: null },
      { date: '2026-08-22', impressions: 0, clicks: null, position: null },
    ]);
    expect(p.mapping.impressions).toBe('Impressions');
  });

  it('TR export: BOM, noktali virgul, nokta binlik, - → 0', () => {
    const p = parseGscAiCsv(TR);
    expect(p.delimiter).toBe(';');
    expect(p.rows.map((r) => r.impressions)).toEqual([120, 1234, 0]);
    expect(p.rows[0].date).toBe('2026-08-20');
  });

  it('YANLIS DOSYA: tiklama dolu normal Performans raporu reddedilir', () => {
    expect(() => parseGscAiCsv(PERF)).toThrowError(GscAiCsvError);
    try { parseGscAiCsv(PERF); } catch (e: any) { expect(e.code).toBe('HAS_CLICKS'); }
  });

  it('tiklama kolonu var ama hep 0/~ ise kabul (GenAI raporu ileride kolonu ekleyebilir)', () => {
    const p = parseGscAiCsv('Date,Clicks,Impressions\n2026-08-20,0,50\n2026-08-21,~,60\n');
    expect(p.rows.map((r) => r.clicks)).toEqual([0, 0]);
  });

  it('bilinmeyen basliklar: beklenenleri listeleyen acik hata', () => {
    try { parseGscAiCsv('Foo,Bar\n1,2\n'); throw new Error('atmadi'); }
    catch (e: any) {
      expect(e.code).toBe('NO_HEADER_MATCH');
      expect(e.message).toContain('Foo | Bar');
      expect(e.message).toContain('Gösterimler/Impressions');
    }
  });

  it('bos dosya ve satirsiz dosya', () => {
    expect(() => parseGscAiCsv('')).toThrowError(/boş/);
    try { parseGscAiCsv('Date,Impressions\nxx,yy\n'); } catch (e: any) { expect(e.code).toBe('NO_ROWS'); }
  });

  it('ayni tarih iki kez: son satir alinir, uyari uretilir; satirlar tarih sirali', () => {
    const p = parseGscAiCsv('Date,Impressions\n2026-08-22,5\n2026-08-20,1\n2026-08-20,2\n');
    expect(p.rows.map((r) => `${r.date}:${r.impressions}`)).toEqual(['2026-08-20:2', '2026-08-22:5']);
    expect(p.warnings.some((w) => w.includes('2026-08-20'))).toBe(true);
  });
});
