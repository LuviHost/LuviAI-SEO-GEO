import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Yonetici ucretsiz test sayfasi: her olcum ve deneme satirinda "Raporu gör" (sahip 16.11.2026:
 * "ücretsiz tarayan kişilerin raporlarını görebilirsem onlara yazabilirim").
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sayfa = readFileSync(path.join(HERE, '../app/(admin)/admin/leads/page.tsx'), 'utf8');
const api = readFileSync(path.join(HERE, 'api.ts'), 'utf8');

describe('AI Test Leadleri — Raporu gör', () => {
  it('rapor yonetici ucundan alinir ve yalitilmis cercevede cizilir (betik calismaz)', () => {
    expect(api).toContain('/admin/citation-leads/${encodeURIComponent(id)}/report');
    expect(sayfa).toContain('api.getCitationLeadReport(id)');
    expect(sayfa).toMatch(/<iframe[^>]*srcDoc=\{rapor\.html\}[^>]*sandbox="allow-popups allow-popups-to-escape-sandbox"/);
    expect(sayfa).not.toMatch(/sandbox="[^"]*allow-scripts/);
  });

  it('olcum satiri kendi kaydini, "kayitli sonucu gordu" denemesi alan adinin son olcumunu acar', () => {
    expect(sayfa).toContain('<RaporDugmesi onClick={() => setRaporId(l.id)} />');
    expect(sayfa).toContain('setRaporId(d.checkId || sonOlcum.get(d.domain)!)');
  });

  it('pencere testi yapanin alan adinin sahibi olmayabilecegini soyler (yazarken dikkat)', () => {
    expect(sayfa).toContain('Testi kimin yaptığı bilinmez — alan adının sahibi olmayabilir.');
  });
});
