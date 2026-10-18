import { describe, it, expect } from 'vitest';
import { AttemptWindow, isMobileAppClient } from './public-subscribe-limits.js';

/** Abonelik ucunun bellek ici deneme sayaci ve mobil istemci tanimasi. */

describe('AttemptWindow', () => {
  it('pencere icinde limit kadar deneme; pencere kayinca yeniden izin', () => {
    const w = new AttemptWindow(1000);
    expect(w.take('ip', 2, 0)).toBe(true);
    expect(w.take('ip', 2, 100)).toBe(true);
    expect(w.take('ip', 2, 200)).toBe(false);
    // reddedilen deneme pencereyi uzatmaz: ilk deneme 1000'de duser
    expect(w.take('ip', 2, 1001)).toBe(true);
    expect(w.take('baska', 2, 200)).toBe(true);
  });

  it('daha siki limit ayni sayaci okur (dogrulanmamis istek daha erken durur)', () => {
    const w = new AttemptWindow(1000);
    expect(w.take('ip', 5, 0)).toBe(true);
    expect(w.take('ip', 5, 1)).toBe(true);
    expect(w.take('ip', 2, 2)).toBe(false);
    expect(w.take('ip', 5, 3)).toBe(true);
  });

  it('bellek tavani: suresi dolanlar, yetmezse en eski anahtarlar silinir', () => {
    const w = new AttemptWindow(1000, 3);
    w.take('a', 1, 0);
    w.take('b', 1, 10);
    w.take('c', 1, 2000);
    w.take('d', 1, 2001); // tavan asildi: a ve b'nin suresi dolmus → silinir
    expect(w.take('a', 1, 2002)).toBe(true);
    expect(w.take('c', 1, 2003)).toBe(false);
    for (let i = 0; i < 10; i++) w.take(`yeni-${i}`, 1, 2100);
    expect((w as any).hits.size).toBeLessThanOrEqual(3);
  });
});

describe('isMobileAppClient', () => {
  it('uygulamanin User-Agent imi', () => {
    expect(isMobileAppClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RanksUp-iOS/1.0')).toBe(true);
    expect(isMobileAppClient('Mozilla/5.0 (Linux; Android 15) RanksUp-Android/1.2')).toBe(true);
    expect(isMobileAppClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe(false);
    expect(isMobileAppClient('RanksUp-iOS')).toBe(false);
    expect(isMobileAppClient(undefined)).toBe(false);
  });
});
