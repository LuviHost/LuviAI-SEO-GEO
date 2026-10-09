import { describe, it, expect } from 'vitest';
import { compareCells, type TrendRow } from './comparable-trend.js';

const row = (cell: string, current: boolean, value: number, version = 1): TrendRow => ({ cell, current, value, version });

describe('compareCells', () => {
  it('ayni hucreler: ortak hucre ortalamalari kiyaslanir', () => {
    const r = compareCells([
      row('p1|claude', false, 0), row('p1|claude', true, 1),
      row('p2|claude', false, 1), row('p2|claude', true, 1),
    ]);
    expect(r).toMatchObject({ state: 'comparable', previous: 0.5, current: 1, delta: 0.5, matchedCells: 2, coverage: 1 });
  });

  it('prompt seti degisti (beyin yenilendi) → scope_changed, delta YOK (eskiden sahte dusus)', () => {
    const r = compareCells([
      row('eski1|claude', false, 1), row('eski2|claude', false, 1),
      row('yeni1|claude', true, 0), row('yeni2|claude', true, 0),
    ]);
    expect(r.state).toBe('scope_changed');
    expect(r.delta).toBeNull();
    expect(r.current).toBe(0);
    expect(r.previous).toBe(1);
  });

  it('kapsam esigin altinda (1/3 ortak) → scope_changed', () => {
    const r = compareCells([
      row('a', false, 1), row('b', false, 1), row('c', false, 1),
      row('a', true, 1), row('d', true, 0), row('e', true, 0),
    ]);
    expect(r).toMatchObject({ state: 'scope_changed', matchedCells: 1 });
  });

  it('olcum yontemi degisti → method_changed', () => {
    const r = compareCells([row('a', false, 1, 1), row('a', true, 0, 2)]);
    expect(r.state).toBe('method_changed');
    expect(r.delta).toBeNull();
  });

  it('veri yok / onceki donem yok', () => {
    expect(compareCells([]).state).toBe('no_data');
    expect(compareCells([row('a', true, 1)]).state).toBe('no_previous');
  });

  it('ayni hucrede birden cok olcum hucre ortalamasina indirgenir (hucre agirligi esit)', () => {
    const r = compareCells([
      row('a', false, 0), row('a', false, 0), row('a', false, 0), row('a', false, 1),
      row('a', true, 1),
      row('b', false, 1), row('b', true, 1),
    ]);
    // onceki: a=0.25, b=1 → 0.625 ; simdi: a=1, b=1 → 1
    expect(r.previous).toBeCloseTo(0.625);
    expect(r.delta).toBeCloseTo(0.375);
  });
});
