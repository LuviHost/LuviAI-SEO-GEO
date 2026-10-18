import { describe, it, expect } from 'vitest';
import { lineDiff, splitLines } from './line-diff.js';
import { mergeRobotsTxt } from './robots-merge.js';

/** Farktan iki tarafi geri kur — fark her zaman tutarli olmali */
const rebuild = (lines: { op: string; text: string }[], side: 'before' | 'after') =>
  lines.filter((l) => l.op === 'same' || l.op === (side === 'before' ? 'del' : 'add')).map((l) => l.text);

describe('splitLines', () => {
  it('sondaki satir sonu hayalet satir uretmez; CRLF ayrilir', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
    expect(splitLines(null)).toEqual([]);
  });

  it('yalniz CR (RFC 9309 NL) ve karisik satir sonlari da ayrilir', () => {
    expect(splitLines('User-agent: *\rDisallow: /\r')).toEqual(['User-agent: *', 'Disallow: /']);
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitLines('a\r\rb')).toEqual(['a', '', 'b']);
  });

  it('yalniz-CR robots birlestirmesi: mevcut satirlar same, silme yok', () => {
    const before = 'User-agent: *\rDisallow: /admin/\r';
    const after = mergeRobotsTxt(before, { contentSignal: null }).content;
    const d = lineDiff(before, after);
    expect(d.removed).toBe(0);
    expect(d.lines.slice(0, 2)).toEqual([{ op: 'same', text: 'User-agent: *' }, { op: 'same', text: 'Disallow: /admin/' }]);
  });
});

describe('lineDiff', () => {
  it('robots birlestirmesi: eski satirlarin hepsi same, yeni satirlar add, silme yok', () => {
    const before = 'User-agent: *\nDisallow: /admin/\n';
    const after = mergeRobotsTxt(before, { contentSignal: 'search=yes' }).content;
    const d = lineDiff(before, after);
    expect(d.removed).toBe(0);
    expect(d.lines.slice(0, 2)).toEqual([{ op: 'same', text: 'User-agent: *' }, { op: 'same', text: 'Disallow: /admin/' }]);
    expect(d.added).toBe(splitLines(after).length - 2);
  });

  it('dosya yoksa her satir eklenir', () => {
    const d = lineDiff(null, 'a\nb\n');
    expect(d).toEqual({ lines: [{ op: 'add', text: 'a' }, { op: 'add', text: 'b' }], added: 2, removed: 0 });
  });

  it('ortadaki degisiklik LCS ile en kucuk farka iner ve iki taraf geri kurulabilir', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nx\nc\nd\ny\ne';
    const d = lineDiff(before, after);
    expect(d.removed).toBe(1);
    expect(d.added).toBe(2);
    expect(rebuild(d.lines, 'before')).toEqual(splitLines(before));
    expect(rebuild(d.lines, 'after')).toEqual(splitLines(after));
  });

  it('hucre tavani asilinca sil+ekle doner ama yine tutarli', () => {
    const before = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
    const d = lineDiff(before, after, 100);
    expect(d.removed).toBe(50);
    expect(d.added).toBe(50);
    expect(rebuild(d.lines, 'after')).toEqual(splitLines(after));
  });
});
