import { describe, it, expect } from 'vitest';
import { AGENT_01_KEYWORD, AGENT_02_OUTLINE, AGENT_04_EDITOR, AGENT_03_WRITER } from '@luviai/shared';

/**
 * Prompt sabitleri urun kurallari tasir; sessizce silinmesinler.
 * (Kapsama haritasi: top-10'un kapsadigi konulari en cok kapsayan sayfalar
 * daha cok atif aliyor — 3 kaynak; lede kurali — 2 kaynak.)
 */
describe('ajan promptlari — kapsama haritasi ve lede kurali', () => {
  it('01-keyword: top-10 kapsama haritasi bolumu ve TAHMIN uyarisi var', () => {
    expect(AGENT_01_KEYWORD.systemSuffix).toContain('Top-10 kapsama haritası');
    expect(AGENT_01_KEYWORD.systemSuffix).toMatch(/TAHM[İI]N/);
  });
  it('02-outline: her H2 kapsama haritasina baglanir', () => {
    expect(AGENT_02_OUTLINE.systemSuffix).toContain('kapsama haritası');
  });
  it('03-writer: ilk 200 karakter kurali olculdugu soylenir', () => {
    expect(AGENT_03_WRITER.systemSuffix).toMatch(/200 karakter/);
  });
  it('04-editor: 13. madde kapsama kontrolunu icerir', () => {
    expect(AGENT_04_EDITOR.systemSuffix).toContain('kapsama haritası');
  });
});
