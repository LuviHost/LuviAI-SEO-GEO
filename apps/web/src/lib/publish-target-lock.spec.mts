import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lockedGroupTitle, lockedTargetRequest, splitCatalogByLock } from './publish-target-lock';

/**
 * Yayin hedefi turu kilidi (sahip "yap" dedi, 15.11.2026): kilitli tur bastan kilitli cizilir,
 * tiklayinca form yerine plan penceresi acilir. Karar sunucudan; web plan tablosu tutmaz.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), 'utf8');

const BUY = { kind: 'buy', planId: 'starter', planName: 'Başlangıç' };
const REASON = 'Ücretsiz denemede yalnız WordPress (REST API) ve Markdown ZIP yayın hedefi eklenebilir. Webflow CMS için Başlangıç plana geçebilirsin.';
const KATALOG = [
  { type: 'WORDPRESS_REST', label: 'WordPress (REST API)' },
  { type: 'WEBFLOW', label: 'Webflow CMS', locked: true, upgrade: BUY, lockedReason: REASON },
  { type: 'MARKDOWN_ZIP', label: 'Markdown ZIP' },
  { type: 'GHOST', label: 'Ghost', locked: true, upgrade: BUY, lockedReason: 'Ghost cümlesi' },
];

describe('splitCatalogByLock', () => {
  it('acik turler ve kilitliler ayri; sunucunun sirasi korunur', () => {
    const g = splitCatalogByLock(KATALOG);
    expect(g.open.map((c) => c.type)).toEqual(['WORDPRESS_REST', 'MARKDOWN_ZIP']);
    expect(g.locked.map((c) => c.type)).toEqual(['WEBFLOW', 'GHOST']);
  });

  it('eski API (locked alani yok): hicbir tur kilitli cizilmez', () => {
    const eski = KATALOG.map(({ type, label }) => ({ type, label }));
    expect(splitCatalogByLock(eski)).toEqual({ open: eski, locked: [] });
    // Yalniz true kilitler: "false", 1, 'true' gibi degerler kilit sayilmaz
    expect(splitCatalogByLock([{ type: 'X', label: 'X', locked: 'true' as unknown as boolean }]).locked).toEqual([]);
  });
});

describe('lockedGroupTitle', () => {
  it('kilidi acan plan sunucunun onerisinden', () => {
    expect(lockedGroupTitle(splitCatalogByLock(KATALOG).locked)).toBe('Başlangıç ve üzeri planlarda açılır');
    expect(lockedGroupTitle([{ type: 'X', label: 'X', locked: true, upgrade: { kind: 'quote', planId: 'enterprise', planName: 'Kurumsal' } }]))
      .toBe('Kurumsal planında açılır (teklifle)');
  });

  it('plan bilinmiyorsa / hicbir plan acmiyorsa satis vaat etmez', () => {
    for (const upgrade of [undefined, null, { kind: 'wait', planId: null, planName: null }, { kind: 'buy' }, 'bozuk']) {
      expect(lockedGroupTitle([{ type: 'X', label: 'X', locked: true, upgrade }])).toBe('Bu planda eklenemeyen yayın hedefleri');
    }
  });
});

describe('lockedTargetRequest', () => {
  it('kilitli tur: plan penceresi istegi, gerekce sunucunun cumlesi', () => {
    expect(lockedTargetRequest(KATALOG[1])).toEqual({ offer: BUY, reason: REASON });
  });

  it('acik tur, yol yok ya da bicim disi: pencere acilmaz', () => {
    expect(lockedTargetRequest(KATALOG[0])).toBeNull();
    expect(lockedTargetRequest({ type: 'X', label: 'X', locked: true, upgrade: { kind: 'wait', planId: null, planName: null } })).toBeNull();
    expect(lockedTargetRequest({ type: 'X', label: 'X', locked: true })).toBeNull();
  });

  it('cumle gelmediyse tur adiyla notr gerekce', () => {
    expect(lockedTargetRequest({ type: 'X', label: 'Strapi', locked: true, upgrade: BUY })?.reason).toBe('Strapi bu planda eklenemiyor.');
  });
});

describe('panel baglantisi', () => {
  const tab = read('../components/settings-tab.tsx');
  const api = read('./api.ts');

  it('katalog site kimligiyle istenir (kilit sitenin sahibinin planina gore)', () => {
    expect(tab).toContain('api.getPublishTargetsCatalog(siteId)');
    expect(api).toContain('`/publish-targets/catalog${siteId ? `?siteId=${encodeURIComponent(siteId)}` : \'\'}`');
  });

  it('kilitli kutu formu ACMAZ: plan penceresi acar', () => {
    const blok = tab.slice(tab.indexOf('{catalogGroups.locked.map('), tab.indexOf('{(adding || editing) && ('));
    expect(blok).toContain('lockedTargetRequest(c)');
    expect(blok).toContain('openUpgrade(request)');
    expect(blok).not.toContain('setAdding(');
    // Acik kutular eskisi gibi formu acar
    const acik = tab.slice(tab.indexOf('{catalogGroups.open.map('), tab.indexOf('{catalogGroups.locked.length > 0'));
    expect(acik).toContain('setAdding(c)');
  });
});
