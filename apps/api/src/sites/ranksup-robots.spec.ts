import { describe, it, expect } from 'vitest';
import {
  isAllowedForRanksUpBot, normalizeRobotsPath, parseRanksUpBotGroup, robotsPatternMatches,
} from './ranksup-robots.js';

/**
 * RanksUpBot robots.txt grubu (RFC 9309).
 *
 * NEDEN VAR: tarayici robots.txt'i hic okumuyordu; site sahibi
 * "User-agent: RanksUpBot / Disallow: /" yazsa bile tarama surerdi. "*"
 * grubu BILEREK uygulanmaz (gerekce ranksup-robots.ts basinda) — bu testler
 * o karari da sabitler.
 */

const allowed = (txt: string, url: string) => isAllowedForRanksUpBot(parseRanksUpBotGroup(txt), url);

describe('parseRanksUpBotGroup — grup secimi', () => {
  it('acik RanksUpBot grubu yoksa null (kisit yok)', () => {
    expect(parseRanksUpBotGroup('User-agent: Googlebot\nDisallow: /')).toBeNull();
    expect(parseRanksUpBotGroup('')).toBeNull();
  });

  it('"*" grubu uygulanmaz — site sahibi denetimi kendisi istedi', () => {
    const txt = 'User-agent: *\nDisallow: /\n';
    expect(parseRanksUpBotGroup(txt)).toBeNull();
    expect(allowed(txt, 'https://ornek.com/herhangi')).toBe(true);
  });

  it('user-agent buyuk/kucuk harf duyarsiz; surum eki ve joker yok sayilir (Google belgesi)', () => {
    for (const ua of ['RanksUpBot', 'ranksupbot', 'RANKSUPBOT', 'RanksUpBot/1.0', 'RanksUpBot*']) {
      expect(allowed(`User-agent: ${ua}\nDisallow: /`, 'https://ornek.com/a'), ua).toBe(false);
    }
  });

  it('baska bir botun grubundaki kural RanksUpBot\'a uygulanmaz', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: RanksUpBot\nDisallow: /gizli\n';
    expect(allowed(txt, 'https://ornek.com/acik')).toBe(true);
    expect(allowed(txt, 'https://ornek.com/gizli/x')).toBe(false);
  });

  it('ardisik user-agent satirlari ayni grubu paylasir', () => {
    const txt = 'User-agent: Googlebot\nUser-agent: RanksUpBot\nDisallow: /ortak\n';
    expect(allowed(txt, 'https://ornek.com/ortak')).toBe(false);
  });

  it('kuraldan sonra gelen user-agent yeni grup baslatir', () => {
    const txt = 'User-agent: RanksUpBot\nDisallow: /a\nUser-agent: Googlebot\nDisallow: /b\n';
    expect(allowed(txt, 'https://ornek.com/a')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/b'), 'Googlebot kurali RanksUpBot\'a gecmemeli').toBe(true);
  });

  it('ayni ajana uyan gruplar birlesir (RFC 9309 2.2.1)', () => {
    const txt = 'User-agent: RanksUpBot\nDisallow: /a\n\nUser-agent: Googlebot\nDisallow: /\n\nUser-agent: RanksUpBot\nDisallow: /b\n';
    expect(allowed(txt, 'https://ornek.com/a')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/b')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/c')).toBe(true);
  });

  it('Sitemap gibi grup disi satirlar grubu bitirmez; yorumlar ve BOM yok sayilir', () => {
    const txt = '﻿# yorum\nUser-agent: RanksUpBot # bizim bot\nSitemap: https://ornek.com/s.xml\nDisallow: /x # gizli\n';
    expect(allowed(txt, 'https://ornek.com/x')).toBe(false);
  });

  it('bos Disallow hicbir seyi yasaklamaz', () => {
    expect(allowed('User-agent: RanksUpBot\nDisallow:\n', 'https://ornek.com/her-yer')).toBe(true);
  });
});

describe('isAllowedForRanksUpBot — en uzun eslesme', () => {
  it('RFC 9309 5.1 ornegi: Allow alt yolu Disallow /\'u yener', () => {
    const txt = 'User-agent: RanksUpBot\nAllow: /example/page.html\nAllow: /example/allowed.gif\nDisallow: /\n';
    expect(allowed(txt, 'https://ornek.com/example/page.html')).toBe(true);
    expect(allowed(txt, 'https://ornek.com/example/allowed.gif')).toBe(true);
    expect(allowed(txt, 'https://ornek.com/example/baska.html')).toBe(false);
  });

  it('RFC 9309 5.2 ornegi: daha uzun Disallow kisa Allow\'u yener', () => {
    const txt = 'User-agent: RanksUpBot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n';
    expect(allowed(txt, 'https://ornek.com/example/page/disallowed.gif')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/example/page/ok.gif')).toBe(true);
  });

  it('esit uzunlukta Allow kazanir (RFC 9309 2.2.2)', () => {
    expect(allowed('User-agent: RanksUpBot\nDisallow: /ayni\nAllow: /ayni\n', 'https://ornek.com/ayni')).toBe(true);
  });

  it('/robots.txt her zaman serbest', () => {
    expect(allowed('User-agent: RanksUpBot\nDisallow: /\n', 'https://ornek.com/robots.txt')).toBe(true);
  });

  it('sorgu dizesi eslesmeye dahil: "Disallow: /*?" sorgulu adresleri kapatir', () => {
    const txt = 'User-agent: RanksUpBot\nDisallow: /*?\n';
    expect(allowed(txt, 'https://ornek.com/sayfa?_rc=1')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/sayfa')).toBe(true);
  });

  it('yol eslesmesi buyuk/kucuk harf duyarli', () => {
    const txt = 'User-agent: RanksUpBot\nDisallow: /Gizli\n';
    expect(allowed(txt, 'https://ornek.com/Gizli')).toBe(false);
    expect(allowed(txt, 'https://ornek.com/gizli')).toBe(true);
  });

  it('"/" ile baslamayan deger yol olarak yorumlanir', () => {
    expect(allowed('User-agent: RanksUpBot\nDisallow: admin\n', 'https://ornek.com/admin/x')).toBe(false);
  });
});

describe('robotsPatternMatches — joker ve $', () => {
  it('* sifir ya da daha fazla karakter, desen basa sabitli', () => {
    expect(robotsPatternMatches('/fish*', '/fish')).toBe(true);
    expect(robotsPatternMatches('/fish*', '/fishheads/yummy.html')).toBe(true);
    expect(robotsPatternMatches('/*.php', '/index.php')).toBe(true);
    expect(robotsPatternMatches('/*.php', '/folder/any.php.file.html')).toBe(true);
    expect(robotsPatternMatches('/fish', '/Fish.asp')).toBe(false);
    expect(robotsPatternMatches('/fish', '/catfish')).toBe(false);
  });

  it('sondaki $ adresin sonunu belirtir', () => {
    expect(robotsPatternMatches('/*.php$', '/filename.php')).toBe(true);
    expect(robotsPatternMatches('/*.php$', '/filename.php?parameters')).toBe(false);
    expect(robotsPatternMatches('/*.php$', '/filename.php5')).toBe(false);
  });

  it('ortadaki $ duz karakterdir', () => {
    expect(robotsPatternMatches('/a$b', '/a$b/c')).toBe(true);
  });

  it('cok yildizli desen katastrofik geri izlemeye girmez', () => {
    const pattern = '/' + '*a'.repeat(30) + 'b';
    const path = '/' + 'a'.repeat(5000);
    const t0 = Date.now();
    expect(robotsPatternMatches(pattern, path)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('normalizeRobotsPath — yuzde kodlamasi', () => {
  it('kodlu "unreserved" cozulur: /foo/bar/%62%61%7A = /foo/bar/baz (RFC 9309 Sekil 4)', () => {
    expect(normalizeRobotsPath('/foo/bar/%62%61%7A')).toBe('/foo/bar/baz');
    expect(allowed('User-agent: RanksUpBot\nDisallow: /foo/bar/baz\n', 'https://ornek.com/foo/bar/%62%61%7A')).toBe(false);
  });

  it('Turkce karakterli desen, URL\'deki kodlu yolla eslesir', () => {
    expect(allowed('User-agent: RanksUpBot\nDisallow: /ürünler\n', 'https://ornek.com/ürünler/x')).toBe(false);
  });

  it('ayrilmis karakterin kodu korunur, onaltilik buyuk harfe cekilir', () => {
    expect(normalizeRobotsPath('/a%2fb')).toBe('/a%2Fb');
  });
});
