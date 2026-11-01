/**
 * AI tarayici paneli — IP dogrulamasi yardimcilari.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  buildBotRows, ingestNotices, normalizeCounts, sourceLabel, unknownText, unverifiedText, verdictBadge,
} from './crawler-verification';

describe('sayilar', () => {
  it('eski API (alan yok): her sey dogrulanamadi, asla dogrulanmis degil', () => {
    expect(normalizeCounts(undefined, 120)).toEqual({ verified: 0, unverified: 0, unknown: 120 });
    expect(normalizeCounts({ verified: 3, unverified: -1 } as never)).toEqual({ verified: 3, unverified: 0, unknown: 0 });
  });

  it('taklit metni', () => {
    expect(unverifiedText('Claude-User', 4121)).toBe('Kendini Claude-User olarak tanıtan, doğrulanamayan istek: 4.121 — taklit olabilir');
    expect(unverifiedText(null, 5)).toContain('Kendini AI botu olarak tanıtan');
  });

  it('dogrulanamadi metni nedeni durust soyler', () => {
    expect(unknownText(50, { hasMethod: false })).toContain('resmi IP listesi yayımlamıyor');
    expect(unknownText(50, { needsCodeUpdate: true })).toContain('kodu güncelleyin');
    expect(unknownText(50)).toContain('IP bilgisi yok');
  });
});

describe('buildBotRows', () => {
  it('dogrulanmis ziyarete gore siralar; taklit hacmi buyuk bot ustte cikmaz', () => {
    const rows = buildBotRows(
      { 'Claude-User': 4121, GPTBot: 30, Bytespider: 80 },
      {
        'Claude-User': { verified: 2, unverified: 4100, unknown: 19, hasMethod: true },
        GPTBot: { verified: 30, unverified: 0, unknown: 0, hasMethod: true },
        Bytespider: { verified: 0, unverified: 0, unknown: 80, hasMethod: false },
      },
      { GPTBot: { label: 'OpenAI GPTBot', category: 'training' } },
    );
    expect(rows.map((r) => r.bot)).toEqual(['GPTBot', 'Claude-User', 'Bytespider']);
    expect(rows[0]).toMatchObject({ label: 'OpenAI GPTBot', verified: 30, claimed: 30 });
    expect(rows[2]).toMatchObject({ hasMethod: false, unknown: 80 });
  });

  it('dogrulama kirilimi olmayan bot: tum istekler dogrulanamadi', () => {
    expect(buildBotRows({ GPTBot: 9 }, undefined, undefined)[0]).toMatchObject({ verified: 0, unknown: 9, claimed: 9 });
  });
});

describe('ingestNotices', () => {
  it('IP siz isabet → "Worker kodunu güncelle"; 429 → dusen istek sayisi', () => {
    const r = ingestNotices({ needsCodeUpdate: true, events24h: 120, noIp24h: 120, throttled7d: 1500 });
    expect(r.codeUpdate).toContain('Worker kodunu güncelle');
    expect(r.codeUpdate).toContain('120 isteğin 120 tanesi');
    expect(r.throttled).toContain('1.500 bot bildirimi');
    expect(ingestNotices({ needsCodeUpdate: false, throttled7d: 0 })).toEqual({ codeUpdate: null, throttled: null });
    expect(ingestNotices(null)).toEqual({ codeUpdate: null, throttled: null });
  });
});

describe('rozet ve kaynak', () => {
  it('her sonuc icin etiket', () => {
    expect(verdictBadge('verified').tone).toBe('ok');
    expect(verdictBadge('unverified').label).toBe('taklit olabilir');
    expect(verdictBadge(undefined).label).toBe('doğrulanamadı');
    expect(sourceLabel('wp')).toBe('WordPress eklentisi');
    expect(sourceLabel(null)).toBe('Cloudflare Worker');
  });
});
