import { describe, it, expect } from 'vitest';
import { currentVersionSegment, providerTrend, versionedHeadline, type VersionedPoint } from './citation-history-trend.js';

/**
 * Gorunurluk gecmisinde yontem surumu (matchVersion) farkli noktalar
 * kiyaslanmaz. Ornek: emlak.com, marka "emlak" — v3 her "emlak" kelimesini
 * anilma sayiyordu (38), v4 yalniz "emlak.com" gecisini sayiyor (0). Bu gecis
 * "gorunurluk 38 puan dustu" ve kirmizi "RanksUp Etkisi" olarak gosteriliyordu.
 */
const pt = (date: string, score: number | null, matchVersion: number, cited = 0, mentioned = 0): VersionedPoint =>
  ({ date, score, matchVersion, cited, mentioned });

describe('currentVersionSegment', () => {
  it('son noktayla ayni surumlu son kesit', () => {
    const s = [pt('2026-10-01', 38, 3), pt('2026-10-08', 40, 3), pt('2026-10-15', 0, 4), pt('2026-10-17', 10, 4)];
    expect(currentVersionSegment(s).map((p) => p.date)).toEqual(['2026-10-15', '2026-10-17']);
    expect(currentVersionSegment([])).toEqual([]);
  });
});

describe('providerTrend — v3/v4 karisik seri', () => {
  it('v3 → tek v4 olcumu: fark yok, methodChanged, baslangic v3 degerine dayanmaz', () => {
    const t = providerTrend('openai', [pt('2026-10-01', 38, 3), pt('2026-10-08', 38, 3), pt('2026-10-15', 0, 4)]);
    expect(t.delta).toBeNull();
    expect(t.first).toBe(0);            // v4 kesitinin ilk olcumu — 38 (v3) DEGIL
    expect(t.last).toBe(0);
    expect(t.methodChanged).toBe(true);
    expect(t.methodChangedAt).toBe('2026-10-15');
    expect(t.matchVersion).toBe(4);
    expect(t.last7Avg).toBe(0);         // ortalama da yalniz v4
    expect(t.runCount).toBe(1);
  });

  it('v4 kesitinde iki olcum: fark yalniz v4 icinden', () => {
    const t = providerTrend('openai', [pt('2026-10-01', 38, 3), pt('2026-10-08', 10, 4), pt('2026-10-15', 30, 4)]);
    expect(t).toMatchObject({ first: 10, last: 30, delta: 20, firstDate: '2026-10-08', lastDate: '2026-10-15', methodChanged: true, methodChangedAt: '2026-10-08' });
  });

  it('tek surum: methodChanged yok; baslangic ilk OLCULEN nokta (olculemeyen gun null)', () => {
    const t = providerTrend('gemini', [pt('2026-10-01', null, 4), pt('2026-10-08', 20, 4), pt('2026-10-15', 50, 4)]);
    expect(t).toMatchObject({ first: 20, last: 50, delta: 30, methodChanged: false, methodChangedAt: null });
  });

  it('son kosum olculemediyse fark yok', () => {
    const t = providerTrend('gemini', [pt('2026-10-08', 20, 4), pt('2026-10-15', null, 4)]);
    expect(t).toMatchObject({ first: 20, last: null, delta: null });
  });

  it('tek olcum: fark null (ayni noktanin kendisiyle kiyas yok)', () => {
    expect(providerTrend('gemini', [pt('2026-10-15', 40, 4)])).toMatchObject({ first: 40, last: 40, delta: null, methodChanged: false });
  });
});

describe('versionedHeadline — manset', () => {
  it('karsilastirma penceresinde v3 varsa deltaVsPrev null, methodChanged true', () => {
    const { headline } = versionedHeadline({
      openai: [pt('2026-10-05', 38, 3), pt('2026-10-08', 40, 3), pt('2026-10-15', 0, 4), pt('2026-10-17', 10, 4)],
      gemini: [pt('2026-10-06', 50, 3), pt('2026-10-16', 20, 4)],
    });
    expect(headline.deltaVsPrev).toBeNull();
    expect(headline.methodChanged).toBe(true);
    expect(headline.methodChangedAt).toBe('2026-10-15');
    expect(headline.matchVersion).toBe(4);
    // manset yalniz v4 olcumlerinden: openai (0+10)/2=5, gemini 20 → 13 (12.5 yuvarlanir)
    expect(headline.score).toBe(13);
    // gunluk seri (oynaklik girdisi) yalniz v4 gunleri
    expect(headline.daily.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('v3 olcumleri 2x7 gunluk pencerenin disindaysa kiyas gecerli (ayni yontem)', () => {
    const { headline } = versionedHeadline({
      openai: [
        pt('2026-09-01', 90, 3),
        pt('2026-10-02', 20, 4), pt('2026-10-06', 40, 4),   // onceki hafta ort 30
        pt('2026-10-12', 60, 4), pt('2026-10-15', 80, 4),   // bu hafta ort 70
      ],
    });
    expect(headline.methodChanged).toBe(false);
    expect(headline.deltaVsPrev).toBe(40);
  });

  it('yeni yontemle hic olculmemis saglayici mansete girmez', () => {
    const { headline, segments } = versionedHeadline({
      openai: [pt('2026-10-15', 40, 4)],
      meta: [pt('2026-10-01', 90, 3)],
    });
    expect(Object.keys(segments)).toEqual(['openai']);
    expect(headline.score).toBe(40);
  });

  it('tek surum: eski davranis (methodChanged false, delta hesaplanir)', () => {
    const { headline } = versionedHeadline({
      openai: [pt('2026-08-08', 20, 4), pt('2026-08-10', 40, 4), pt('2026-08-15', 60, 4), pt('2026-08-21', 80, 4)],
    });
    expect(headline).toMatchObject({ score: 70, deltaVsPrev: 40, methodChanged: false, methodChangedAt: null, method: 'rolling' });
  });
});
