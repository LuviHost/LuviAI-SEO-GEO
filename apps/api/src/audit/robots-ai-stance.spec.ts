import { describe, it, expect } from 'vitest';
import { parseRobotsAiStance } from './robots-ai-stance.js';

const find = (r: ReturnType<typeof parseRobotsAiStance>, name: string) => r.bots.find((b) => b.name === name)!;

describe('parseRobotsAiStance', () => {
  it('bos robots.txt: hepsi unspecified, etkin allow, skorlanan isim 0', () => {
    const r = parseRobotsAiStance('');
    expect(r.bots.length).toBe(27);
    expect(r.unspecified).toBe(27);
    expect(r.bots.every((b) => b.effective === 'allow')).toBe(true);
    expect(r.scored).toEqual({ allow: 0, block: 0, named: 0, total: 21 });
  });

  it('wildcard tam kapatma: isimsiz botlar ETKIN block, stance unspecified kalir', () => {
    const r = parseRobotsAiStance('User-agent: *\nDisallow: /\n');
    expect(find(r, 'GPTBot').stance).toBe('unspecified');
    expect(find(r, 'GPTBot').effective).toBe('block');
  });

  it('isimle allow/block sayilir; disallow:/ + allow varsa allow', () => {
    const r = parseRobotsAiStance([
      'User-agent: GPTBot', 'Allow: /', '',
      'User-agent: CCBot', 'Disallow: /', '',
      'User-agent: PerplexityBot', 'Disallow: /', 'Allow: /blog/', '',
    ].join('\n'));
    expect(find(r, 'GPTBot').stance).toBe('allow');
    expect(find(r, 'CCBot').stance).toBe('block');
    expect(find(r, 'PerplexityBot').stance).toBe('allow');
    expect(r.allow).toBe(2); expect(r.block).toBe(1);
    expect(r.scored.named).toBe(3);
  });

  it('user-triggered bot isimle anilsa da SKORLANAN sayima girmez', () => {
    // Kanit: ChatGPT-User / Perplexity-User robots.txt'e guvenilir uymuyor
    const r = parseRobotsAiStance('User-agent: ChatGPT-User\nAllow: /\nUser-agent: Perplexity-User\nDisallow: /\n');
    expect(r.allow).toBe(1); expect(r.block).toBe(1);   // genel sayim gorur
    expect(r.scored.named).toBe(0);                      // skor gormez
    expect(find(r, 'ChatGPT-User').category).toBe('user-triggered');
  });

  it('ardisik User-agent satirlari ayni kural grubunu paylasir', () => {
    const r = parseRobotsAiStance('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n');
    expect(find(r, 'GPTBot').stance).toBe('block');
    expect(find(r, 'ClaudeBot').stance).toBe('block');
  });

  it('yalniz-CR dosya (RFC 9309 NL): wildcard Disallow okunur, botlar etkin block', () => {
    const r = parseRobotsAiStance('User-agent: *\rDisallow: /\r');
    expect(find(r, 'GPTBot').effective).toBe('block');
    expect(find(r, 'ClaudeBot').effective).toBe('block');
    const named = parseRobotsAiStance('User-agent: GPTBot\rDisallow: /\r\rUser-agent: *\rAllow: /\r');
    expect(find(named, 'GPTBot').stance).toBe('block');
    expect(find(named, 'ClaudeBot').effective).toBe('allow');
  });

  it('bastaki UTF-8 BOM ilk User-agent satirini gizlemez', () => {
    const r = parseRobotsAiStance('\uFEFFUser-agent: GPTBot\nDisallow: /\n');
    expect(find(r, 'GPTBot').stance).toBe('block');
  });

  it('bot adi buyuk/kucuk harf duyarsiz, yorumlar atlanir', () => {
    const r = parseRobotsAiStance('# yorum\nuser-agent: gptbot # satir sonu yorum\nallow: /\n');
    expect(find(r, 'GPTBot').stance).toBe('allow');
  });
});
