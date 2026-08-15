import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * google-play-scraper suggest yamasi.
 *
 * NEDEN VAR — uretimde olculdu: Android anahtar kelime skorlamasi uzun kuyruk
 * terimlerde TAMAMEN cokuyordu:
 *   analyzeGPlayKeyword("kobi kredisi")
 *     -> Cannot read properties of null (reading 'map')
 *     -> popularity, difficulty, traffic HEPSI null
 * Ayni cagri "kredi karti" gibi yaygin terimlerde calisiyordu.
 *
 * KOK NEDEN: google-play-scraper/lib/suggest.js. Play, oneri bulamadiginda
 * null DONMEZ — dolu bir zarf doner ve yalnizca oneri yuvasi bostur:
 *   [[null,["CAhKAggD"],[[null,[[172800],null,[604800]]]]]]
 * Kutuphanenin korumasi sadece `data === null` bakiyordu; `data[0][0]` null
 * oldugu icin `.map` patliyordu.
 *
 * ETKISI: aso-v2 bu cagriyi yalnizca traffic.suggest icin yapiyor, ama hata
 * yukari firladigi icin analyzeGPlayKeyword komple dusuyor ve difficulty ile
 * traffic de kayboluyordu. Tek satirlik koruma bunlari geri getirdi:
 *   "kobi kredisi"       once: cokme      sonra: difficulty 5.07 traffic 3.42
 *   "ticari leasing"     once: cokme      sonra: difficulty 1.93 traffic 1.33
 *   "faktoring hizmeti"  once: cokme      sonra: difficulty 2.14 traffic 1.24
 */

const YAMA = new URL('../../../../patches/google-play-scraper@10.1.3.patch', import.meta.url);

describe('gplay suggest yamasi', () => {
  const patch = readFileSync(YAMA, 'utf8');

  it('yama dosyasi duruyor', () => {
    expect(patch.length).toBeGreaterThan(200);
    expect(patch).toContain('lib/suggest.js');
  });

  it('eski yetersiz koruma kaldirilmis', () => {
    expect(patch).toContain('-        if (data === null) {');
  });

  it('yeni koruma oneri yuvasini da kontrol ediyor', () => {
    expect(patch).toContain('+        if (!data?.[0]?.[0]) {');
  });

  it('package.json yamayi kayitli tutuyor', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.pnpm?.patchedDependencies?.['google-play-scraper@10.1.3']).toBe(
      'patches/google-play-scraper@10.1.3.patch',
    );
  });

  it('yama GERCEKTEN COZULEN kopyaya uygulanmis', () => {
    // pnpm store'da bayat kopya kalabiliyor: paket dizini patch_hash tasiyip
    // icerik yamasiz olabiliyor. Bu kurulumda tam olarak boyle oldu — dizin
    // adinda hash vardi ama dosya yamasizdi ve dizini silip yeniden kurmak
    // gerekti. Bu test o SESSIZ durumu yakalar.
    //
    // Tum surumleri taramak yerine GERCEKTEN COZULEN kopyaya bakiyoruz:
    // node_modules'te kullanilmayan eski surumler (ornegin 9.2.0) kalintisi
    // durabiliyor ve onlari yamalamak gereksiz — hicbir sey onlara baglanmiyor.
    const req = createRequire(import.meta.url);
    const giris = req.resolve('google-play-scraper');
    const suggest = giris.replace(/index\.js$/, 'lib/suggest.js');
    const src = readFileSync(suggest, 'utf8');
    expect(src, `${suggest} yamasiz — Android skorlari uzun kuyruk terimlerde cokecek`).toContain('data?.[0]?.[0]');
  });
});
