import { describe, it, expect } from 'vitest';
import { hashList, nextCreativeAssetState, buildIosCreativeAssetFindings } from './creative-asset-findings.js';

const NOW = new Date('2026-08-27T12:00:00Z');
const ios = { screenshots: ['a.png', 'b.png'], ipadScreenshots: [], updated: '2026-05-01T00:00:00Z', version: '2.3' };

describe('nextCreativeAssetState', () => {
  it('ilk gorusme: hash + simdi', () => {
    const s = nextCreativeAssetState(ios, null, NOW)!;
    expect(s.iosShotCount).toBe(2); expect(s.lastChangedAt).toBe(NOW.toISOString());
  });
  it('ayni set: lastChangedAt korunur; set degisince yenilenir', () => {
    const prev = nextCreativeAssetState(ios, null, new Date('2026-01-01T00:00:00Z'))!;
    expect(nextCreativeAssetState(ios, prev, NOW)!.lastChangedAt).toBe(prev.lastChangedAt);
    const s2 = nextCreativeAssetState({ ...ios, screenshots: ['a.png', 'c.png'] }, prev, NOW)!;
    expect(s2.lastChangedAt).toBe(NOW.toISOString());
    expect(hashList(['a', 'b'])).not.toBe(hashList(['a', 'c']));
  });
  it('ios yoksa onceki durum aynen doner', () => {
    expect(nextCreativeAssetState(null, null, NOW)).toBeNull();
  });
});

describe('buildIosCreativeAssetFindings', () => {
  it('90 gundur degismeyen set uyari; iPad yoksa bilgi; video her zaman checklist (olculemez)', () => {
    const state = { iosShotHash: 'x', iosShotCount: 2, ipadShotCount: 0, lastChangedAt: '2026-04-01T00:00:00Z' };
    const f = buildIosCreativeAssetFindings(ios, state, NOW);
    expect(f.find((x) => x.field === 'creativeAssetsFreshness')?.severity).toBe('warning');
    expect(f.find((x) => x.field === 'ipadScreenshots')?.severity).toBe('info');
    const video = f.find((x) => x.field === 'video')!;
    expect(video.severity).toBe('info'); expect(video.current).toBeNull();
  });
  it('taze set ok', () => {
    const state = { iosShotHash: 'x', iosShotCount: 2, ipadShotCount: 3, lastChangedAt: '2026-08-20T00:00:00Z' };
    const f = buildIosCreativeAssetFindings({ ...ios, ipadScreenshots: ['1', '2', '3'] }, state, NOW);
    expect(f.find((x) => x.field === 'creativeAssetsFreshness')?.severity).toBe('ok');
    expect(f.find((x) => x.field === 'ipadScreenshots')?.severity).toBe('ok');
  });
  it('ios yoksa bos', () => { expect(buildIosCreativeAssetFindings(null, null, NOW)).toEqual([]); });
});
