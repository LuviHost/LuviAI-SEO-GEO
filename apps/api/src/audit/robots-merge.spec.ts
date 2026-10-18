import { describe, it, expect } from 'vitest';
import {
  mergeRobotsTxt, parseRobots, robotsAllows, assessRobotsBody, robotsSitemapUrls, agentToken,
} from './robots-merge.js';
import { parseRobotsAiStance } from './robots-ai-stance.js';
import { KNOWN_AI_BOTS, STANCE_SCORED_BOTS } from './known-ai-bots.js';

const SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';

const WORDPRESS = [
  'User-agent: *',
  'Disallow: /wp-admin/',
  'Allow: /wp-admin/admin-ajax.php',
  '',
  'Sitemap: https://ornek.com/wp-sitemap.xml',
  '',
].join('\n');

const CLOSED_SITE = 'User-agent: *\nDisallow: /\n';

const MIXED = [
  '# elle yazildi',
  'User-agent: GPTBot',
  'Disallow: /',
  '',
  'User-agent: *',
  'Disallow: /ozel/',
  'Disallow: /*.pdf$',
  'Crawl-delay: 5',
  '',
].join('\n');

/** Her bilinen bot + isimsiz bot icin, ornek yollarda erisim once/sonra ayni mi */
function expectAccessUnchanged(before: string, after: string) {
  const pb = parseRobots(before);
  const pa = parseRobots(after);
  const paths = ['/', '/ozel/', '/ozel/x', '/dosya.pdf', '/dosya.pdfx', '/wp-admin/', '/wp-admin/admin-ajax.php', '/blog/yazi'];
  for (const agent of [...KNOWN_AI_BOTS.map((b) => b.name), 'Googlebot', 'BilinmeyenBot']) {
    for (const path of paths) {
      expect(robotsAllows(pa, agent, path), `${agent} ${path}`).toBe(robotsAllows(pb, agent, path));
    }
  }
  // Mevcut stance ayristiricisinin ETKIN durumu da degismemeli
  const sb = parseRobotsAiStance(before);
  const sa = parseRobotsAiStance(after);
  for (const b of sb.bots) expect(sa.bots.find((x) => x.name === b.name)?.effective, b.name).toBe(b.effective);
}

describe('mergeRobotsTxt — mevcut kurallar korunur', () => {
  for (const [name, txt] of [['WordPress', WORDPRESS], ['tamamen kapali', CLOSED_SITE], ['karisik', MIXED]] as const) {
    it(`${name}: icerik byte byte onek, erisim degismez, idempotent`, () => {
      const r = mergeRobotsTxt(txt, { contentSignal: SIGNAL, sitemapUrl: 'https://ornek.com/sitemap.xml' });
      expect(r.changed).toBe(true);
      expect(r.content.startsWith(txt)).toBe(true);
      expect(r.accessUnchanged).toBe(true);
      expectAccessUnchanged(txt, r.content);
      const again = mergeRobotsTxt(r.content, { contentSignal: SIGNAL, sitemapUrl: 'https://ornek.com/sitemap.xml' });
      expect(again.changed).toBe(false);
      expect(again.content).toBe(r.content);
    });
  }

  it('"User-agent: * / Disallow: /" — yeni AI grubuna Allow: / DEGIL Disallow: / kopyalanir', () => {
    const r = mergeRobotsTxt(CLOSED_SITE, { contentSignal: null });
    const added = r.content.slice(CLOSED_SITE.length);
    expect(added).toContain('Disallow: /');
    expect(added).not.toMatch(/^Allow: \/$/m);
    expect(r.copiedRules).toEqual(['Disallow: /']);
    expect(robotsAllows(parseRobots(r.content), 'GPTBot', '/')).toBe(false);
  });

  it('`*` kurallari (Crawl-delay dahil) yeni gruba aynen kopyalanir; isimle engelli GPTBot engelli kalir', () => {
    const r = mergeRobotsTxt(MIXED, { contentSignal: null });
    expect(r.copiedRules).toEqual(['Disallow: /ozel/', 'Disallow: /*.pdf$', 'Crawl-delay: 5']);
    expect(r.addedBots).not.toContain('GPTBot');
    const p = parseRobots(r.content);
    expect(robotsAllows(p, 'GPTBot', '/blog')).toBe(false);
    expect(robotsAllows(p, 'ClaudeBot', '/ozel/a')).toBe(false);
    expect(robotsAllows(p, 'ClaudeBot', '/blog')).toBe(true);
    expect(r.notes.join(' ')).toMatch(/engelleri olduğu gibi kaldı/);
  });

  it('`*` grubu yoksa AI botlari icin Allow: / (zaten serbesttiler)', () => {
    const txt = 'User-agent: BadBot\nDisallow: /\n';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.copiedRules).toEqual([]);
    expect(r.content.slice(txt.length)).toMatch(/^Allow: \/$/m);
    expectAccessUnchanged(txt, r.content);
    expect(robotsAllows(parseRobots(r.content), 'BadBot', '/')).toBe(false);
  });

  it('dosya yoksa (null): skorlanan 21 botun hepsi isimle anilir, Content-Signal ve Sitemap eklenir', () => {
    const r = mergeRobotsTxt(null, { contentSignal: SIGNAL, sitemapUrl: 'https://ornek.com/sitemap.xml' });
    const stance = parseRobotsAiStance(r.content);
    expect(stance.scored.named).toBe(STANCE_SCORED_BOTS.length);
    expect(stance.scored.block).toBe(0);
    expect(r.content).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);
    expect(r.content).toMatch(/^Sitemap: https:\/\/ornek\.com\/sitemap\.xml$/m);
    expect(r.addedContentSignal).toBe(true);
    expect(r.addedSitemap).toBe(true);
  });
});

describe('mergeRobotsTxt — Content-Signal ve Sitemap', () => {
  it('isimle anilan botlara sinyal ikinci grupla gider, kurallari tekrarlanir', () => {
    const r = mergeRobotsTxt(MIXED, { contentSignal: SIGNAL });
    const tail = r.content.slice(MIXED.length);
    // GPTBot'un ikinci grubu: User-agent + sinyal + kendi kurali (Disallow: /)
    expect(tail).toMatch(/User-agent: GPTBot\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nDisallow: \/\n/);
    expectAccessUnchanged(MIXED, r.content);
  });

  it('dosyada Content-Signal varsa yenisi eklenmez; `*` grubundaki sinyal yeni gruba kopyalanir', () => {
    const txt = 'User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n';
    const r = mergeRobotsTxt(txt, { contentSignal: SIGNAL });
    expect(r.addedContentSignal).toBe(false);
    expect((r.content.match(/Content-Signal:/g) ?? []).length).toBe(2);
    expect(r.content.slice(txt.length)).toContain('Content-Signal: search=yes, ai-train=no');
  });

  it('Sitemap satiri yalniz dosyada hic yoksa ve adres verildiyse eklenir', () => {
    expect(mergeRobotsTxt(WORDPRESS, { sitemapUrl: 'https://ornek.com/sitemap.xml' }).addedSitemap).toBe(false);
    const allNamed = mergeRobotsTxt(null, { contentSignal: SIGNAL }).content;
    expect(mergeRobotsTxt(allNamed, { contentSignal: SIGNAL }).changed).toBe(false);
    const withSitemap = mergeRobotsTxt(allNamed, { contentSignal: SIGNAL, sitemapUrl: 'https://ornek.com/s.xml' });
    expect(withSitemap.changed).toBe(true);
    expect(withSitemap.content.endsWith('Sitemap: https://ornek.com/s.xml\n')).toBe(true);
  });
});

describe('mergeRobotsTxt — bicim kenar durumlari', () => {
  it('son grup kapanmamissa bos Disallow ile kapatilir; o grubun botu degismez', () => {
    const txt = 'User-agent: *\nDisallow: /admin/\n\nUser-agent: Foo\nCrawl-delay: 10';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.closedOpenGroup).toBe(true);
    expect(r.content.startsWith(`${txt}\n# RanksUp`)).toBe(true);
    expect(r.content).toMatch(/\nDisallow:\n/);
    expect(robotsAllows(parseRobots(r.content), 'Foo', '/admin/')).toBe(true);
    expect(r.accessUnchanged).toBe(true);
    // Foo grubu AI botlarini yutmadi
    expect(parseRobots(r.content).groups.find((g) => g.agents.includes('Foo'))?.agents).toEqual(['Foo']);
  });

  it('CRLF dosyada eklenen satirlar da CRLF', () => {
    const txt = 'User-agent: *\r\nDisallow: /x/\r\n';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    const tail = r.content.slice(txt.length);
    expect(tail.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(tail)).toBe(false);
  });

  it('iki noktasi unutulmus Google tarzi satir da sayilir (GPTBot isimli kabul edilir)', () => {
    const txt = 'User-agent GPTBot\nDisallow /\n\nUser-agent: *\nAllow: /\n';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.addedBots).not.toContain('GPTBot');
    expect(robotsAllows(parseRobots(r.content), 'GPTBot', '/')).toBe(false);
  });

  it('degisecek bir sey yoksa icerik aynen doner', () => {
    const full = mergeRobotsTxt(null, { contentSignal: SIGNAL, sitemapUrl: 'https://o.com/sitemap.xml' }).content;
    const r = mergeRobotsTxt(full, { contentSignal: SIGNAL, sitemapUrl: 'https://o.com/sitemap.xml' });
    expect(r).toMatchObject({ changed: false, content: full, addedBots: [] });
  });
});

describe('mergeRobotsTxt — RFC 9309 satir sonlari (yalniz CR, karisik)', () => {
  // Kahin (oracle) ayristiricinin satir bolmesine guvenmez: once tum satir
  // sonlari LF'ye cevrilir, sonra sinanmis LF yolundan okunur.
  const norm = (s: string) => s.replace(/\r\n?/g, '\n');
  const allows = (txt: string, agent: string, path: string) => robotsAllows(parseRobots(norm(txt)), agent, path);
  const stanceOf = (txt: string, bot: string) => parseRobotsAiStance(norm(txt)).bots.find((b) => b.name === bot)!;

  it('yalniz-CR "User-agent: * / Disallow: /": Allow: / EKLENMEZ, Disallow: / kopyalanir, GPTBot engelli kalir', () => {
    const txt = 'User-agent: *\rDisallow: /\r';
    const r = mergeRobotsTxt(txt, { contentSignal: SIGNAL });
    expect(r.accessUnchanged).toBe(true);
    expect(r.content.startsWith(txt)).toBe(true);
    expect(r.copiedRules).toEqual(['Disallow: /']);
    expect(norm(r.content.slice(txt.length))).not.toMatch(/^Allow: \/$/m);
    expect(r.notes.join(' ')).not.toMatch(/zaten tam erişimleri vardı/);
    for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Bytespider']) {
      expect(allows(txt, bot, '/'), `${bot} once`).toBe(false);
      expect(allows(r.content, bot, '/'), `${bot} sonra`).toBe(false);
      expect(stanceOf(r.content, bot).effective, bot).toBe('block');
    }
  });

  it('yalniz-CR /admin/ + /private/: iki Disallow da kopyalanir; eklenen satirlar da CR', () => {
    const txt = 'User-agent: *\rDisallow: /admin/\rDisallow: /private/\r';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.copiedRules).toEqual(['Disallow: /admin/', 'Disallow: /private/']);
    const tail = r.content.slice(txt.length);
    expect(tail).not.toContain('\n');
    expect(tail).toContain('\r');
    // Dosya CR ile bittigi icin satir sonu tekrarlanmaz; okunurluk icin tek bir bos satir (CR) ayirici gelir
    expect(r.content.startsWith(`${txt}\r# RanksUp`)).toBe(true);
    for (const path of ['/admin/', '/admin/x', '/private/', '/private/y']) {
      expect(allows(r.content, 'GPTBot', path), path).toBe(false);
      expect(allows(r.content, 'PerplexityBot', path), path).toBe(false);
    }
    expect(allows(r.content, 'GPTBot', '/blog')).toBe(true);
    expect(norm(tail)).not.toMatch(/^Allow: \/$/m);
    // idempotent
    expect(mergeRobotsTxt(r.content, { contentSignal: null }).changed).toBe(false);
  });

  it('yalniz-CR isimle engelli GPTBot: yeni GPTBot grubu ve Allow: / eklenmez', () => {
    const txt = 'User-agent: GPTBot\rDisallow: /\r\rUser-agent: *\rAllow: /\r';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.addedBots).not.toContain('GPTBot');
    expect(norm(r.content.slice(txt.length))).not.toMatch(/^User-agent: GPTBot$/m);
    expect(allows(r.content, 'GPTBot', '/')).toBe(false);
    expect(allows(r.content, 'ClaudeBot', '/')).toBe(true);
    expect(r.accessUnchanged).toBe(true);
  });

  it('karisik satir sonu (CRLF + CR + LF): kurallar dogru okunur, eklenen satirlar CRLF', () => {
    const txt = 'User-agent: *\r\nDisallow: /admin/\rDisallow: /private/\n';
    const r = mergeRobotsTxt(txt, { contentSignal: null });
    expect(r.copiedRules).toEqual(['Disallow: /admin/', 'Disallow: /private/']);
    expect(r.content.startsWith(txt)).toBe(true);
    expect(/[^\r]\n/.test(r.content.slice(txt.length))).toBe(false);
    for (const path of ['/admin/', '/private/']) expect(allows(r.content, 'GPTBot', path), path).toBe(false);
    expect(r.accessUnchanged).toBe(true);
  });

  it('parseRobots ve robotsSitemapUrls yalniz-CR dosyayi satirlara boler', () => {
    const txt = 'User-agent: *\rDisallow: /x/\rSitemap: https://o.com/s.xml\r';
    expect(parseRobots(txt).groups[0].members.map((m) => m.raw)).toEqual(['Disallow: /x/']);
    expect(robotsSitemapUrls(txt)).toEqual(['https://o.com/s.xml']);
    expect(assessRobotsBody(txt)).toBe('ok');
  });
});

describe('assessRobotsBody — metin diye cozulmus ikili govde', () => {
  it('yonergesiz NUL / U+FFFD govde "bos" degil gecersiz (uzerine birlestirilmez)', () => {
    expect(assessRobotsBody('\u0000\u0001PK\u0003\u0004')).toBe('invalid');
    expect(assessRobotsBody('\uFFFD\uFFFD\uFFFD')).toBe('invalid');
    expect(assessRobotsBody('   \n# yorum\n')).toBe('empty');
  });
});

describe('robotsAllows (RFC 9309)', () => {
  it('en uzun eslesme kazanir, esitlikte allow; joker ve $', () => {
    const p = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\nDisallow: /x\nAllow: /x\n');
    expect(robotsAllows(p, 'Bot', '/a/c')).toBe(false);
    expect(robotsAllows(p, 'Bot', '/a/b/c')).toBe(true);
    expect(robotsAllows(p, 'Bot', '/f.pdf')).toBe(false);
    expect(robotsAllows(p, 'Bot', '/f.pdf?x')).toBe(true);
    expect(robotsAllows(p, 'Bot', '/x')).toBe(true);
  });

  it('ozel grup varsa `*` hic okunmaz (kural icermese bile)', () => {
    const p = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nCrawl-delay: 2\n');
    expect(robotsAllows(p, 'GPTBot', '/')).toBe(true);
    expect(robotsAllows(p, 'ClaudeBot', '/')).toBe(false);
  });

  it('allow/disallow ile kapanmamis grup sonraki User-agent ile birlesir (Google ayristiricisi)', () => {
    const p = parseRobots('User-agent: GPTBot\nCrawl-delay: 2\n\nUser-agent: *\nDisallow: /\n');
    expect(p.groups.length).toBe(1);
    expect(p.groups[0].agents).toEqual(['GPTBot', '*']);
    expect(robotsAllows(p, 'GPTBot', '/')).toBe(false);
  });

  it('ayni bota ait gruplar birlesir; surum ekli User-agent belirtece indirgenir', () => {
    const p = parseRobots('User-agent: GPTBot/1.1\nDisallow: /a\n\nUser-agent: gptbot\nDisallow: /b\n');
    expect(robotsAllows(p, 'GPTBot', '/a')).toBe(false);
    expect(robotsAllows(p, 'GPTBot', '/b')).toBe(false);
    expect(agentToken('AI2Bot')).toBe('ai2bot');
    expect(agentToken('* ')).toBe('*');
  });
});

describe('assessRobotsBody / robotsSitemapUrls', () => {
  it('HTML (SPA catch-all) robots.txt degildir', () => {
    expect(assessRobotsBody('<!DOCTYPE html><html><head><title>App</title></head></html>')).toBe('html');
    expect(assessRobotsBody('\n  <html lang="tr">')).toBe('html');
  });
  it('yonerge yoksa empty / invalid; UTF-8 bozuksa encoding', () => {
    expect(assessRobotsBody('# yalniz yorum\n\n')).toBe('empty');
    expect(assessRobotsBody('{"error":"not found"}')).toBe('invalid');
    expect(assessRobotsBody('User-agent: *\nDisallow:')).toBe('ok');
    expect(assessRobotsBody('# T\uFFFDrkçe\nUser-agent: *\nAllow: /')).toBe('encoding');
    expect(assessRobotsBody('Sitemap: https://x.com/s.xml')).toBe('ok');
  });
  it('Sitemap satirlari: mutlak http(s), tekil', () => {
    expect(robotsSitemapUrls('Sitemap: https://x.com/a.xml\nsitemap: https://x.com/a.xml\nSitemap: /goreli.xml\nSITEMAP: http://x.com/b.xml.gz')).toEqual([
      'https://x.com/a.xml', 'http://x.com/b.xml.gz',
    ]);
  });
});
