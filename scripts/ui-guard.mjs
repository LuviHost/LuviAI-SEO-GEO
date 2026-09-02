#!/usr/bin/env node
/**
 * UI bekci (ratchet) — tasarim disiplini geriye gitmesin.
 *
 * Kurallar:
 *  1) `-orange-N` sinifi → HATA (marka rengi yalniz `brand` token'i; PR-0 codemod'u
 *     sonrasi sifir — geri gelmesi yasak).
 *  2) `text-[Npx]` arbitrary boyut ve sabit hex sayisi taban dosyasini
 *     (scripts/ui-guard-baseline.json) ASAMAZ. Her goc PR'i tabani dusurur —
 *     `node scripts/ui-guard.mjs --update-baseline` ile.
 *  3) animejs importu yalniz src/components/ai-scan/ altinda.
 *
 * Kullanim: node scripts/ui-guard.mjs   (package.json: guard:ui)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/web/src');
const BASELINE_PATH = join(ROOT, 'scripts/ui-guard-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (e !== 'node_modules') walk(p); }
    else if (/\.(tsx?|css)$/.test(e)) files.push(p);
  }
})(SRC);

const ORANGE = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|decoration|outline)-orange-\d+/g;
const ARB_TEXT = /\btext-\[\d+(?:\.\d+)?px\]/g;
// globals.css tema degiskenleri hex tutabilir; sayim yalniz tsx'te
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

let orangeHits = [], arbCount = 0, hexCount = 0, animeBad = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length);
  for (const m of s.matchAll(ORANGE)) orangeHits.push(`${rel}: ${m[0]}`);
  if (f.endsWith('.tsx') || f.endsWith('.ts')) {
    arbCount += (s.match(ARB_TEXT) ?? []).length;
    hexCount += (s.match(HEX) ?? []).length;
    if (/from ['"]animejs/.test(s) && !rel.includes('components/ai-scan/')) animeBad.push(rel);
  }
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ arbitraryTextPx: arbCount, hexInTsx: hexCount, animejsAllowed: animeBad.sort() }, null, 2) + '\n');
  console.log(`Taban guncellendi: text-[Npx]=${arbCount}, hex=${hexCount}, animejs=${animeBad.length} dosya`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); }
catch { console.error('Taban dosyasi yok — once: node scripts/ui-guard.mjs --update-baseline'); process.exit(1); }

const errors = [];
if (orangeHits.length) errors.push(`orange-N sinifi yasak (brand kullan):\n  ${orangeHits.slice(0, 10).join('\n  ')}`);
if (arbCount > baseline.arbitraryTextPx) errors.push(`text-[Npx] artti: ${arbCount} > taban ${baseline.arbitraryTextPx} (token kullan: metric/label/filter)`);
if (hexCount > baseline.hexInTsx) errors.push(`sabit hex artti: ${hexCount} > taban ${baseline.hexInTsx} (chart-colors.ts / token kullan)`);
const animeYeni = animeBad.filter((f) => !(baseline.animejsAllowed ?? []).includes(f));
if (animeYeni.length) errors.push(`animejs yalniz ai-scan'de kalabilir (yeni ihlal):\n  ${animeYeni.join('\n  ')}`);

if (errors.length) { console.error('UI bekci HATA:\n\n' + errors.join('\n\n')); process.exit(1); }
console.log(`UI bekci temiz — text-[Npx]=${arbCount}/${baseline.arbitraryTextPx}, hex=${hexCount}/${baseline.hexInTsx}, animejs=${animeBad.length}/${(baseline.animejsAllowed ?? []).length}`);
