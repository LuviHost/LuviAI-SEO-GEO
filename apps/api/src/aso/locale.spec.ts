import { describe, it, expect } from 'vitest';
import {
  resolveStoreLocale,
  isKnownCountry,
  DEFAULT_COUNTRY,
  FALLBACK_LANG_TAG,
} from './locale.js';

describe('resolveStoreLocale — ulke -> dil cozumlemesi', () => {
  it('Turkiye icin Turkce dondurur ve storefront tr kalir', () => {
    const loc = resolveStoreLocale('tr');
    expect(loc.country).toBe('tr');
    expect(loc.measuredLocale).toBe('tr-TR');
    expect(loc.appleSearchLang).toBe('tr-tr');
    expect(loc.appleLookupLang).toBe('tr_tr');
    expect(loc.googleLang).toBe('tr');
  });

  it('gorevde istenen tum ulkeler dogru dile cozulur', () => {
    const beklenen: Record<string, string> = {
      tr: 'tr-TR',
      us: 'en-US',
      de: 'de-DE',
      gb: 'en-GB',
      fr: 'fr-FR',
      es: 'es-ES',
      it: 'it-IT',
      nl: 'nl-NL',
      ru: 'ru-RU',
      sa: 'ar-SA',
      jp: 'ja-JP',
      kr: 'ko-KR',
      cn: 'zh-CN',
      br: 'pt-BR',
    };
    for (const [country, locale] of Object.entries(beklenen)) {
      expect(resolveStoreLocale(country).measuredLocale, `ulke: ${country}`).toBe(locale);
    }
  });

  it('bolgesi tabloda yazili olan ulkelerde google bolgeli, digerlerinde sade kod alir', () => {
    // 'us' -> 'en-us' (tabloda bolge var) => hl=en-US
    expect(resolveStoreLocale('us').googleLang).toBe('en-US');
    expect(resolveStoreLocale('br').googleLang).toBe('pt-BR');
    // 'de' -> 'de' (tabloda bolge yok) => hl=de
    expect(resolveStoreLocale('de').googleLang).toBe('de');
    expect(resolveStoreLocale('ru').googleLang).toBe('ru');
  });

  it('Apple lookup formu alt cizgili, search formu tirelidir', () => {
    const loc = resolveStoreLocale('jp');
    expect(loc.appleSearchLang).toBe('ja-jp');
    expect(loc.appleLookupLang).toBe('ja_jp');
    expect(loc.appleLookupLang).not.toContain('-');
  });

  it('dil ayni ama storefront farkliysa bolge storefront ulkesinden gelir', () => {
    // Avusturya Almanca konusur ama storefront ayri; bilgi kaybolmamali.
    const at = resolveStoreLocale('at');
    expect(at.country).toBe('at');
    expect(at.measuredLocale).toBe('de-AT');
    const de = resolveStoreLocale('de');
    expect(de.measuredLocale).toBe('de-DE');
  });

  it('buyuk harfli ve bosluklu girdi normalize edilir', () => {
    expect(resolveStoreLocale('TR').measuredLocale).toBe('tr-TR');
    expect(resolveStoreLocale('  Us  ').measuredLocale).toBe('en-US');
    expect(resolveStoreLocale('GB').country).toBe('gb');
  });

  it('tr-TR / tr_TR gibi bicimlerden ulke kodu ayiklanir', () => {
    expect(resolveStoreLocale('tr-TR').country).toBe('tr');
    expect(resolveStoreLocale('pt_BR').country).toBe('pt');
  });

  it('bilinmeyen ulkede scraper varsayilanina (en-US) duser ama storefront korunur', () => {
    const loc = resolveStoreLocale('zz');
    expect(loc.country).toBe('zz');
    expect(loc.measuredLocale).toBe('en-US');
    expect(loc.appleSearchLang).toBe(FALLBACK_LANG_TAG);
    expect(loc.googleLang).toBe('en-US');
  });

  it('bos / gecersiz girdide varsayilan ulkeye duser', () => {
    for (const girdi of [undefined, null, '', '   ', 'x', 'turkiye', '12']) {
      expect(resolveStoreLocale(girdi as any).country, `girdi: ${String(girdi)}`).toBe(DEFAULT_COUNTRY);
    }
    expect(resolveStoreLocale(undefined).measuredLocale).toBe('tr-TR');
  });

  it('cozumleme deterministiktir — ayni girdi ayni cikti', () => {
    expect(resolveStoreLocale('br')).toEqual(resolveStoreLocale('BR'));
  });

  it('measuredLocale her zaman BCP-47 dil-BOLGE bicimindedir', () => {
    for (const c of ['tr', 'us', 'br', 'zz', 'at', 'sa', 'tw']) {
      expect(resolveStoreLocale(c).measuredLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });
});

describe('isKnownCountry — teshis/uyari icin', () => {
  it('tabloda olan ulkeler icin true doner', () => {
    expect(isKnownCountry('tr')).toBe(true);
    expect(isKnownCountry('US')).toBe(true);
    expect(isKnownCountry('br')).toBe(true);
  });

  it('tabloda olmayan ulke icin false doner', () => {
    expect(isKnownCountry('zz')).toBe(false);
  });

  it('bos girdide varsayilan ulke bilindigi icin true doner', () => {
    expect(isKnownCountry(undefined)).toBe(true);
  });
});
