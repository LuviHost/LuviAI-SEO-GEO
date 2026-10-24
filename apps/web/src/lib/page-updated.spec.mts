/**
 * Sayfa guncelleme tarihleri: sitemap lastModified, gorunur "Son güncelleme" satiri ve
 * JSON-LD dateModified tek kaynaktan (page-updated.ts) gelir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import { CONTENT_AUTHOR, PUBLIC_PAGES, SITE_URL, formatPageDate, pageUpdated, pageUpdatedText } from './page-updated';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const MARKETING = join(SRC, 'app/(marketing)');
const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

const TR_AY: Record<string, string> = {
  Ocak: '01', Şubat: '02', Mart: '03', Nisan: '04', Mayıs: '05', Haziran: '06',
  Temmuz: '07', Ağustos: '08', Eylül: '09', Ekim: '10', Kasım: '11', Aralık: '12',
};

describe('sitemap', () => {
  const entries = sitemap();

  it('her URL gercek bir tarih tasiyor (YYYY-MM-DD), gelecekte degil, bugune sabitlenmemis', () => {
    expect(entries.length).toBe(PUBLIC_PAGES.length);
    const bugun = new Date().toISOString().slice(0, 10);
    for (const e of entries) {
      expect(typeof e.lastModified, e.url).toBe('string');
      const d = e.lastModified as string;
      expect(d, e.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${d}T00:00:00Z`)), e.url).toBe(false);
      expect(d <= bugun, `${e.url} gelecekte: ${d}`).toBe(true);
    }
  });

  it('tum tarihler ayni gun degil (eski `new Date()` davranisi geri gelmedi)', () => {
    expect(new Set(entries.map((e) => e.lastModified)).size).toBeGreaterThan(1);
  });

  it('URL listesi tekrar icermiyor ve hepsi ranksup.ai altinda', () => {
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith(`${SITE_URL}/`), u).toBe(true);
  });

  it('her sitemap yolu icin bir sayfa dosyasi var (404 URL yayimlanmiyor)', () => {
    const appDir = join(SRC, 'app');
    for (const p of PUBLIC_PAGES) {
      const rel = p.path === '/' ? 'page.tsx' : `(marketing)${p.path}/page.tsx`;
      expect(() => read(join(appDir, rel)), `${p.path} -> ${rel}`).not.toThrow();
    }
  });
});

describe('gorunur tarih ve JSON-LD ayni kaynaktan', () => {
  const kaynaklar = walk(SRC).map((f) => ({ f, s: read(f) }));

  it('PageUpdatedLine ve pageUpdated() yalniz PUBLIC_PAGES yollarini kullaniyor', () => {
    const yollar = new Set(PUBLIC_PAGES.map((p) => p.path));
    let sayi = 0;
    for (const { f, s } of kaynaklar) {
      for (const m of s.matchAll(/PageUpdatedLine path="([^"]+)"|pageUpdated\('([^']+)'\)/g)) {
        sayi++;
        const yol = m[1] ?? m[2];
        expect(yollar.has(yol), `${f}: ${yol} PUBLIC_PAGES'te yok`).toBe(true);
      }
    }
    expect(sayi).toBeGreaterThan(5);
  });

  it('istenen sayfalarin hepsinde gorunur satir var (/, /pricing, /faq, /use-cases, /compare, /help, /help/*)', () => {
    const satirVar = (rel: string, yol: string) =>
      read(join(SRC, rel)).includes(`PageUpdatedLine path="${yol}"`);
    expect(satirVar('app/page.tsx', '/')).toBe(true);
    expect(satirVar('app/(marketing)/pricing/pricing-view.tsx', '/pricing')).toBe(true);
    expect(satirVar('app/(marketing)/faq/page.tsx', '/faq')).toBe(true);
    expect(satirVar('app/(marketing)/use-cases/page.tsx', '/use-cases')).toBe(true);
    expect(satirVar('app/(marketing)/compare/compare-view.tsx', '/compare')).toBe(true);
    expect(satirVar('app/(marketing)/help/page.tsx', '/help')).toBe(true);
    expect(satirVar('app/(marketing)/help/glossary/page.tsx', '/help/glossary')).toBe(true);
    // Diger yardim sayfalari HelpArticle uzerinden: slug -> /help/<slug>
    const ha = read(join(SRC, 'components/help-article.tsx'));
    expect(ha).toContain('<PageUpdatedLine path={path}');
    expect(ha).toContain('dateModified: updated');
    for (const p of PUBLIC_PAGES.filter((x) => x.path.startsWith('/help/') && x.path !== '/help/glossary')) {
      const slug = p.path.slice('/help/'.length);
      const page = read(join(MARKETING, 'help', slug, 'page.tsx'));
      expect(page, `${p.path} HelpArticle slug'i`).toContain(`slug="${slug}"`);
    }
  });

  it('yasal sayfalarin metnindeki "Son güncelleme" tarihi PUBLIC_PAGES ile ayni', () => {
    for (const yol of ['/privacy', '/terms', '/kvkk']) {
      const s = read(join(MARKETING, yol.slice(1), 'page.tsx'));
      const m = /Son güncelleme: (\d{1,2}) (\S+) (\d{4})/.exec(s);
      expect(m, `${yol} metninde tarih yok`).not.toBeNull();
      const [, gun, ay, yil] = m!;
      expect(`${yil}-${TR_AY[ay]}-${gun.padStart(2, '0')}`, yol).toBe(pageUpdated(yol));
    }
  });
});

describe('ajan belgelerinin "Son güncelleme" satiri', () => {
  it('llms.txt, llms-full.txt ve agent-setup.txt tam gun tarihi tasiyor ("Ekim 2026" degil), gelecekte degil', () => {
    const bugun = new Date().toISOString().slice(0, 10);
    for (const f of ['llms.txt', 'llms-full.txt', 'agent-setup.txt']) {
      const doc = read(join(SRC, '../public', f));
      const m = /^Son güncelleme: (\d{1,2}) (\S+) (\d{4})/m.exec(doc);
      expect(m, `${f}: tam tarihli "Son güncelleme" satiri yok`).not.toBeNull();
      const [, gun, ay, yil] = m!;
      expect(TR_AY[ay], `${f}: ay adi`).toBeDefined();
      const iso = `${yil}-${TR_AY[ay]}-${gun.padStart(2, '0')}`;
      expect(iso <= bugun, `${f} gelecekte: ${iso}`).toBe(true);
    }
  });
});

describe('formatPageDate / pageUpdatedText', () => {
  it('TR ve EN bicimi, saat dilimi kaymasi yok', () => {
    expect(formatPageDate('2026-10-24', 'tr')).toBe('24 Ekim 2026');
    expect(formatPageDate('2026-01-01', 'tr')).toBe('1 Ocak 2026');
    expect(formatPageDate('2026-08-09', 'en')).toBe('August 9, 2026');
  });

  it('yazar tek sabitten', () => {
    expect(pageUpdatedText('2026-10-22', 'tr')).toBe(`Son güncelleme: 22 Ekim 2026 · ${CONTENT_AUTHOR.tr}`);
    expect(pageUpdatedText('2026-10-22', 'en')).toBe(`Last updated: October 22, 2026 · ${CONTENT_AUTHOR.en}`);
  });

  it('gecersiz tarih ve bilinmeyen yol hata verir', () => {
    expect(() => formatPageDate('24.10.2026', 'tr')).toThrow();
    expect(() => pageUpdated('/yok')).toThrow();
  });
});
