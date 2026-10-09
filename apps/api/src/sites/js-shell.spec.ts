import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { isJsShell } from './js-shell.js';

const shell = (body: string) => isJsShell(cheerio.load(`<html><head><title>x</title></head><body>${body}</body></html>`));

describe('isJsShell', () => {
  it('bos SPA kabugu: kok kap + script, metin yok', () => {
    expect(shell('<div id="root"></div><script src="/assets/index.js"></script>')).toBe(true);
    expect(shell('<div id="__next"></div><script type="module" src="/main.js"></script>')).toBe(true);
    expect(shell('<app-root></app-root><noscript>Lutfen JavaScript etkinlestirin</noscript><script src="/main.js"></script>')).toBe(true);
  });
  it('sunucu render edilmis SPA (icerik var) kabuk DEGIL', () => {
    expect(shell('<div id="root"><h1>Baslik</h1><p>Metin</p></div><script src="/a.js"></script>')).toBe(false);
    expect(shell('<div id="app"><a href="/x">x</a></div><script src="/a.js"></script>')).toBe(false);
  });
  it('kok kap yoksa ya da yalniz JSON script varsa kabuk DEGIL', () => {
    expect(shell('<p>kisa</p><script src="/a.js"></script>')).toBe(false);
    expect(shell('<div id="root"></div><script type="application/ld+json">{}</script>')).toBe(false);
  });
  it('20+ kelime gorunur metin varsa kabuk DEGIL', () => {
    expect(shell(`<div id="root">${'kelime '.repeat(25)}</div><script src="/a.js"></script>`)).toBe(false);
  });
});
