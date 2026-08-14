#!/usr/bin/env node
/**
 * X oturumunu Mac'ten sunucudaki OpenClaw tarayicisina aktarir.
 *
 * NEDEN VAR: sunucuda (datacenter IP) X'e giris yapmak dogrulama duvarina
 * takilir. Bunun yerine Mac'te zaten acik olan oturumun cerezlerini
 * sunucudaki yonetilen Chrome profiline yaziyoruz.
 *
 * Cerez degerleri yalnizca bu surecin belleginde durur; ekrana basilmaz,
 * diske yazilmaz.
 *
 * Kullanim:
 *   node scripts/x-oturum-aktar.mjs
 *
 * Gereken: Mac'te Chrome'da X oturumu acik olmali. Calisirken macOS
 * Keychain izin penceresi cikar — "Allow" deyin.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const HOST = process.env.OPENCLAW_HOST ?? 'root@87.76.142.108';
const PROFILE = process.env.OPENCLAW_PROFILE ?? 'openclaw';
const CHROME_PROFILE = process.env.CHROME_PROFILE ?? 'Default';
const COOKIES_DB = `${process.env.HOME}/Library/Application Support/Google/Chrome/${CHROME_PROFILE}/Cookies`;
/** X'te oturumu ayakta tutan iki cerez: oturum token'i ve CSRF token'i */
const WANTED = ['auth_token', 'ct0'];

function extract() {
  // macOS Keychain'den Chrome'un cerez sifreleme parolasi (izin penceresi burada cikar)
  const pass = execFileSync(
    'security',
    ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
    { encoding: 'utf8' },
  ).trim();

  // Chrome calisirken DB kilitli olabilir — kopya uzerinden okuyoruz
  const dir = mkdtempSync(join(tmpdir(), 'xck-'));
  const dbPath = join(dir, 'Cookies');
  copyFileSync(COOKIES_DB, dbPath);

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%x.com'")
      .all();

    const key = pbkdf2Sync(pass, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');

    const out = {};
    for (const r of rows) {
      if (!WANTED.includes(r.name)) continue;
      const buf = Buffer.from(r.encrypted_value);
      const ver = buf.subarray(0, 3).toString();
      if (ver !== 'v10' && ver !== 'v11') continue;

      const d = createDecipheriv('aes-128-cbc', key, iv);
      d.setAutoPadding(false);
      let plain = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
      const pad = plain[plain.length - 1];
      if (pad > 0 && pad <= 16) plain = plain.subarray(0, plain.length - pad);
      // Yeni Chrome surumleri duz metnin basina 32 baytlik alan-adi hash'i ekliyor
      const s = plain.toString('utf8');
      out[r.name] = /[\x00-\x08\x0e-\x1f]/.test(s.slice(0, 32))
        ? plain.subarray(32).toString('utf8')
        : s;
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function push(cookies) {
  const b = `openclaw browser --browser-profile ${PROFILE}`;
  const lines = [
    'set -u',
    'export NVM_DIR=$HOME/.nvm',
    '. "$NVM_DIR/nvm.sh"',
    `${b} start >/dev/null 2>&1 || true`,
  ];
  for (const [name, value] of Object.entries(cookies)) {
    // Degerler tek tirnak icinde gecer; X token'lari hex ama yine de kontrol et
    if (value.includes("'")) throw new Error(`${name} degerinde tek tirnak var — beklenmedik`);
    lines.push(`${b} cookies set ${name} '${value}' --url https://x.com >/dev/null`);
  }
  lines.push(
    `${b} open "https://x.com/search?q=geo%20seo&src=typed_query&f=live" >/dev/null 2>&1`,
    'sleep 8',
    'echo "###COOKIES###"',
    `${b} --json cookies 2>/dev/null || true`,
    'echo "###SNAPSHOT###"',
    `${b} snapshot 2>&1 | head -60`,
  );

  // NEDEN BASE64: uzak komut once SSH'in kabugu, sonra su'nun kabugu tarafindan
  // ayristiriliyor. Duz metin gonderince satir sonlari yeniyor ve $HOME yanlis
  // kullanicida genisliyordu. Base64 yalnizca [A-Za-z0-9+/=] icerir, iki kabuk
  // da ona dokunamaz.
  const b64 = Buffer.from(lines.join('\n'), 'utf8').toString('base64');
  return execFileSync(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', HOST,
     `printf %s ${b64} | base64 -d | su - openclaw -s /bin/bash`],
    { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024 },
  );
}

const cookies = extract();
for (const n of WANTED) {
  if (!cookies[n]) {
    console.error(`HATA: ${n} bulunamadi. Chrome'da (${CHROME_PROFILE} profili) X oturumu acik mi?`);
    process.exit(1);
  }
  console.log(`${n}: bulundu (${cookies[n].length} karakter)`);
}

console.log(`\nSunucuya yaziliyor (${HOST}, profil ${PROFILE})...`);
const out = push(cookies);

// DOGRULAMA cereze bakar, snapshot metnine DEGIL. Onceki surum snapshot'i
// regex'le kontrol ediyordu; komut zinciri kirildiginda snapshot bos donuyor,
// regex eslesmiyor ve basarisizlik "oturum acik" diye raporlaniyordu.
const [, cookiesRaw = '', snapshot = ''] = out.split(/###(?:COOKIES|SNAPSHOT)###/);

let sunucudaki = [];
try {
  sunucudaki = (JSON.parse(cookiesRaw.trim() || '{}').cookies ?? []).map((c) => c.name);
} catch {
  console.error('UYARI: sunucudaki cerez listesi okunamadi.');
}

const eksik = WANTED.filter((n) => !sunucudaki.includes(n));
const girisEkrani = /Continue with phone|See what's happening|Sign in to X/i.test(snapshot);
const snapshotBos = snapshot.trim().length === 0;

if (eksik.length) {
  console.error(`\nBASARISIZ: sunucuya yazilamayan cerez(ler): ${eksik.join(', ')}`);
  process.exit(1);
} else if (snapshotBos) {
  console.error('\nBELIRSIZ: cerezler yazildi ama snapshot bos dondu — sunucuda elle kontrol edin.');
  process.exit(1);
} else if (girisEkrani) {
  console.error('\nBASARISIZ: cerezler yazildi ama X hala giris ekrani gosteriyor (oturum gecersiz olabilir).');
  process.exit(1);
} else {
  console.log(`\nBASARILI: ${WANTED.join(', ')} sunucuda; X arama sonuclari geliyor.`);
}

console.log('\n--- sunucudaki snapshot (ilk satirlar) ---');
console.log(snapshot.trim().split('\n').slice(0, 20).join('\n'));
