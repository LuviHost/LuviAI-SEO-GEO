import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { nextTheme, shownTheme, themeToggleLabel } from './theme-cycle';

/**
 * Panel kenar cubugunun altindaki tema dugmesi (sahip, 16.11.2026: "pc ikonunu kaldır, güneş ve
 * gece yeter"): yalniz acik ↔ koyu. Bildirim zili DURUR (sahip onu kullanmak istiyor).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const oku = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

describe('tema dugmesi — yalniz acik ve koyu', () => {
  it('gorunen temadan digerine gecer; ucuncu durum (sistem) yok', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme(nextTheme('light'))).toBe('light');
  });

  it('gorunen tema bilinmiyorsa koyu sayilir (uygulamanin varsayilani)', () => {
    for (const v of [undefined, null, '', 'system']) {
      expect(shownTheme(v)).toBe('dark');
      expect(nextTheme(v)).toBe('light');
    }
  });

  it('etiket hangi temada oldugunu ve tiklayinca ne olacagini soyler', () => {
    expect(themeToggleLabel('light')).toBe('Tema: açık. Koyu temaya geç');
    expect(themeToggleLabel('dark')).toBe('Tema: koyu. Açık temaya geç');
  });

  it('bilesen bilgisayar ikonunu ve "system" secenegini tasimaz; GORUNEN temaya bakar', () => {
    const dugme = oku('../components/theme-toggle.tsx');
    expect(dugme).not.toMatch(/\bMonitor\b/);
    expect(dugme).not.toMatch(/['"]system['"]/);
    // Onceden "sistem" secmis kullanicida da dogru ikon: kayitli tercih degil, gorunen tema
    expect(dugme).toContain('resolvedTheme');
    expect(dugme).toMatch(/import \{ Sun, Moon \} from 'lucide-react'/);
  });
});

describe('panel kenar cubugu — bildirim zili YERINDE', () => {
  // Sahip zili kullanmak istiyor (16.11.2026: "bildirimi neden kaldırdın? onu kullanalım dedim").
  // Ayni istekte yalniz bilgisayar ikonu kalkti; zil tema dugmesinin yaninda durur.
  it('panel duzeni zili ve tema dugmesini yan yana cizer', () => {
    const duzen = oku('../app/(dashboard)/layout.tsx');
    expect(duzen).toMatch(/<NotificationBell \/>\s*<ThemeToggle \/>/);
    expect(existsSync(path.join(HERE, '../components/notification-bell.tsx'))).toBe(true);
  });
});
