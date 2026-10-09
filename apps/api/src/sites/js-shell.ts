import type { CheerioAPI } from 'cheerio';

/**
 * Sunucu HTML'i bos bir JavaScript iskeleti mi (SPA kabugu)? — saf.
 *
 * NEDEN: tarayicimiz JS calistirmaz. Icerigi tamamen JS ile olusan sayfalarda
 * (React/Vue/Angular SPA) her sayfaya "H1 yok" KRITIK hatasi yaziliyordu —
 * gercekte H1 var, ama yalniz JS sonrasi. Asil sorun baska: Google JS'i
 * calistirir, ChatGPT/Claude/Perplexity tarayicilari CALISTIRMAZ (defter,
 * iki bagimsiz kaynak — bkz. audit/js-free-discovery.ts) → bu sayfalarin
 * icerigi AI asistanlarina hic ulasmiyor.
 *
 * Kosullarin HEPSI: uygulama kok kabi + calistirilabilir script + <20 kelime
 * gorunur metin + hic baslik/link/gorsel. (Esikler open-seo'nun kabuk
 * tespitinden — urun parametresi; tek basina olcum iddiasi degil.)
 */
const APP_ROOT = '#root, #app, #__next, #__nuxt, #q-app, #svelte, app-root, [data-reactroot], [ng-version]';
const MIN_WORDS = 20;

export function isJsShell($: CheerioAPI): boolean {
  if ($(APP_ROOT).length === 0) return false;

  const executable = $('script').toArray().some((el) => {
    const t = ($(el).attr('type') ?? '').trim().toLowerCase();
    return !t || t === 'module' || t.includes('javascript') || t.includes('ecmascript');
  });
  if (!executable) return false;

  if ($('body h1, body h2, body h3, body h4, body h5, body h6').length > 0) return false;
  if ($('body a[href]').length > 0) return false;
  if ($('body img').length > 0) return false;

  const $body = $('body').clone();
  $body.find('script, style, noscript, template').remove();
  const words = $body.text().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  return words < MIN_WORDS;
}
