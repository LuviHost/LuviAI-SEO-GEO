#!/usr/bin/env node
/**
 * Mac'teki tarayici oturumunu (X veya LinkedIn) sunucudaki OpenClaw
 * tarayicisina aktarir.
 *
 * NEDEN VAR: sunucuda (datacenter IP) X'e / LinkedIn'e giris yapmak
 * dogrulama duvarina takilir. Bunun yerine Mac'te zaten acik olan oturumun
 * cerezlerini sunucudaki yonetilen Chrome profiline yaziyoruz.
 *
 * Cerez degerleri yalnizca bu surecin belleginde durur; ekrana basilmaz,
 * diske yazilmaz.
 *
 * Kullanim:
 *   node scripts/oturum-aktar.mjs --site x          (varsayilan)
 *   node scripts/oturum-aktar.mjs --site linkedin
 *
 * Gereken: Mac'te Chrome'da ilgili sitenin oturumu acik olmali. Calisirken
 * macOS Keychain izin penceresi cikar — "Allow" deyin.
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

/**
 * Site tablosu. Her site icin: hangi host'un cerezleri okunacak, hangileri
 * zorunlu (yoksa oturum yok demektir), hangileri istege bagli (varsa yazilir),
 * cerezler hangi URL'ye yazilacak, dogrulama icin hangi sayfa acilacak ve
 * giris duvari snapshot'ta nasil taninacak.
 */
const SITES = {
  x: {
    label: 'X',
    hostLike: '%x.com',
    /** X'te oturumu ayakta tutan iki cerez: oturum token'i ve CSRF token'i */
    wanted: ['auth_token', 'ct0'],
    optional: [],
    url: 'https://x.com',
    verifyUrl: 'https://x.com/search?q=geo%20seo&src=typed_query&f=live',
    loginWall: /Continue with phone|See what's happening|Sign in to X/i,
    basari: 'X arama sonuclari geliyor.',
  },
  linkedin: {
    label: 'LinkedIn',
    hostLike: '%linkedin.com',
    /**
     * li_at = oturum token'i; JSESSIONID = CSRF token'i ("ajax:..." degeri
     * CIFT tirnakli gelir, bu normaldir — oldugu gibi yazilir).
     */
    wanted: ['li_at', 'JSESSIONID'],
    /** Cihaz/yuk dengeleme cerezleri: varsa yazilir, yoksa hata degil */
    optional: ['bcookie', 'lidc'],
    url: 'https://www.linkedin.com',
    verifyUrl: 'https://www.linkedin.com/feed/',
    loginWall: /Sign in|Oturum aç|Join now|Hemen katıl|Giriş yap/i,
    basari: 'LinkedIn akisi (feed) geliyor.',
  },
};

/** --site x | --site=linkedin ; verilmezse x (geri uyum) */
function siteSec(argv) {
  let ad = 'x';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site') ad = argv[i + 1] ?? '';
    else if (a.startsWith('--site=')) ad = a.slice('--site='.length);
  }
  ad = ad.trim().toLowerCase();
  if (!SITES[ad]) {
    console.error(`HATA: bilinmeyen site "${ad}". Gecerli: ${Object.keys(SITES).join(' | ')}`);
    process.exit(2);
  }
  return SITES[ad];
}

const SITE = siteSec(process.argv.slice(2));
const WANTED = SITE.wanted;
const ISTENEN = [...SITE.wanted, ...SITE.optional];

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
    // host_key parametre olarak baglanir; site tablosundan geliyor, kullanicidan degil
    const rows = db
      .prepare('SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?')
      .all(SITE.hostLike);

    const key = pbkdf2Sync(pass, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');

    const out = {};
    for (const r of rows) {
      if (!ISTENEN.includes(r.name)) continue;
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
    // Degerler tek tirnak icinde gecer; tek tirnak iceren deger kabugu kirar.
    // Cift tirnak (LinkedIn JSESSIONID = "ajax:...") tek tirnak icinde sorunsuz gecer.
    if (value.includes("'")) throw new Error(`${name} degerinde tek tirnak var — beklenmedik`);
    lines.push(`${b} cookies set ${name} '${value}' --url ${SITE.url} >/dev/null`);
  }
  lines.push(
    `${b} open "${SITE.verifyUrl}" >/dev/null 2>&1`,
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

console.log(`Site: ${SITE.label} (${SITE.url})`);
const cookies = extract();
for (const n of WANTED) {
  if (!cookies[n]) {
    console.error(`HATA: ${n} bulunamadi. Chrome'da (${CHROME_PROFILE} profili) ${SITE.label} oturumu acik mi?`);
    process.exit(1);
  }
  console.log(`${n}: bulundu (${cookies[n].length} karakter)`);
}
for (const n of SITE.optional) {
  // Istege bagli cerez: yoksa uyari bile degil, sadece bilgi
  console.log(cookies[n] ? `${n}: bulundu (${cookies[n].length} karakter)` : `${n}: yok (istege bagli, atlandi)`);
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
const girisEkrani = SITE.loginWall.test(snapshot);
const snapshotBos = snapshot.trim().length === 0;

if (eksik.length) {
  console.error(`\nBASARISIZ: sunucuya yazilamayan cerez(ler): ${eksik.join(', ')}`);
  process.exit(1);
} else if (snapshotBos) {
  console.error('\nBELIRSIZ: cerezler yazildi ama snapshot bos dondu — sunucuda elle kontrol edin.');
  process.exit(1);
} else if (girisEkrani) {
  console.error(`\nBASARISIZ: cerezler yazildi ama ${SITE.label} hala giris ekrani gosteriyor (oturum gecersiz olabilir).`);
  process.exit(1);
} else {
  console.log(`\nBASARILI: ${WANTED.join(', ')} sunucuda; ${SITE.basari}`);
}

console.log('\n--- sunucudaki snapshot (ilk satirlar) ---');
console.log(snapshot.trim().split('\n').slice(0, 20).join('\n'));
