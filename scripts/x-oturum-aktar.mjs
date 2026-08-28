#!/usr/bin/env node
// Geri uyum sarmalayicisi: eski komut adi korunur, gercek is oturum-aktar.mjs'de (--site x).
if (!process.argv.some((a) => a === '--site' || a.startsWith('--site='))) process.argv.push('--site', 'x');
await import('./oturum-aktar.mjs');
