import { describe, it, expect } from 'vitest';
import { snapshotTrend } from './ai-mention-alarm.service.js';

const snap = (provider: string, probes: any[], extra: any = {}) => ({ provider, available: true, probes, matchVersion: 2, ...extra });
const q = (query: string, cited: boolean, brandMentioned = cited, more: any = {}) => ({ query, cited, brandMentioned, ...more });

describe('snapshotTrend — alarm karsilastirmasi', () => {
  it('ayni sorular: puanlar citation-score ile ayni (alinti 100, anilma 50)', () => {
    const t = snapshotTrend(
      [snap('anthropic', [q('en iyi hosting', false, true), q('ucuz vps', false, false)])],
      [snap('anthropic', [q('en iyi hosting', true), q('ucuz vps', true)])],
      'anthropic',
    );
    expect(t.state).toBe('comparable');
    expect(t.previous).toBe(100);
    expect(t.current).toBe(25);
  });

  it('beyin yenilendi, sorular degisti → karsilastirma YOK (eskiden sahte dusus e-postasi)', () => {
    const t = snapshotTrend(
      [snap('anthropic', [q('yeni soru 1', false), q('yeni soru 2', false)])],
      [snap('anthropic', [q('eski soru 1', true), q('eski soru 2', true)])],
      'anthropic',
    );
    expect(t.state).toBe('scope_changed');
  });

  it('alinti olcum yontemi degisti (matchVersion 1 → 2) → method_changed', () => {
    const t = snapshotTrend(
      [snap('openai', [q('a', false)], { matchVersion: 2 })],
      [snap('openai', [q('a', true)], { matchVersion: 1 })],
      'openai',
    );
    expect(t.state).toBe('method_changed');
  });

  it('olculemeyen snapshot, HATA probe ve markali soru sayilmaz', () => {
    const t = snapshotTrend(
      [snap('gemini', [q('a', true), q('b', false, false, { excerpt: 'HATA: 429' }), q('marka x', true, true, { brandInQuery: true })])],
      [snap('gemini', [q('a', true)]), snap('gemini', [q('a', false)], { available: false })],
      'gemini',
    );
    expect(t).toMatchObject({ state: 'comparable', current: 100, previous: 100, matchedCells: 1 });
  });
});
