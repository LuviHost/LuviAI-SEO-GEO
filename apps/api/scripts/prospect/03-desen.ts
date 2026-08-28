#!/usr/bin/env tsx
/**
 * 03-desen — firma alan adi + kurumsal e-posta DESENI, yalniz firmanin KENDI
 * sitesinde yayimladigi adreslerden.
 *
 * NEDEN BU KADAR DAR:
 *  - Arama motoru / ucuncu taraf sitelerden adres toplama YOK. KVKK Kurulu
 *    2022/861: arama motorundan bulunan is e-postasina pazarlama → 150.000 TL.
 *    Firmanin kendi iletisim/basin sayfasindaki adresler firmanin bilerek
 *    yayimladigi kurumsal veridir; burada yalniz DESEN (ad.soyad mi, asoyad mi)
 *    cikarilir, adresin kendisi hedeflenmez, loglanmaz, dosyaya yazilmaz.
 *  - Tek isimsiz ornek desen SAYILMAZ (inferPattern: iki-kaynak kurali).
 *  - SMTP sondasi YOK — 04-dogrula sozdizimi + MX ile sinirli.
 *
 * Girdi : DATA_DIR/firmalar.csv (01) + DATA_DIR/kisiler.csv (02)  [--input, --kisiler]
 * Cikti : DATA_DIR/firma-desen.csv, DATA_DIR/adaylar.csv, DATA_DIR/web-tahmin.csv
 *         Kismi kosumlarda (--limit / --only-domain) mevcut dosyalarla BIRLESTIRILIR
 *         (islenen alan adlarinin satirlari yenilenir); --overwrite ile sifirdan yazar.
 * Bayrak: --limit N, --dry-run, --only-domain x.com.tr, --input, --kisiler, --overwrite
 *
 *   cd apps/api && npx tsx scripts/prospect/03-desen.ts --limit 20
 */
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';
import {
  DATA_DIR, DEFAULT_PATTERNS, SEKTORLER, type PatternKind, candidateEmails, fetchText, inferPattern,
  isGenericLocalPart, jitter, normalizeDomain, parseArgs, readCsv, sleep, slugName, titleCaseTr, translit, writeCsv,
} from '../../src/prospect/prospect-utils.js';

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DRY = args['dry-run'] === true;
const OVERWRITE = args.overwrite === true;
const ONLY = typeof args['only-domain'] === 'string' ? normalizeDomain(args['only-domain']) : null;
const PARTIAL = !!ONLY || Number.isFinite(LIMIT);
const FIRMALAR = typeof args.input === 'string' ? path.resolve(String(args.input)) : path.join(DATA_DIR, 'firmalar.csv');
const KISILER = typeof args.kisiler === 'string' ? path.resolve(String(args.kisiler)) : path.join(DATA_DIR, 'kisiler.csv');

/** Firmanin kendi sitesinde bakilacak sayfalar — once bunlar, sonra nav kesfi */
const CONTACT_PATHS = ['/iletisim', '/contact', '/bize-ulasin', '/basin', '/basin-odasi', '/press', '/yatirimci-iliskileri', '/investor-relations'];
const MAX_PAGES = 6;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Alan adi tahmininde firma adindan atilan hukuki/genel kelimeler */
const HUKUKI = /\b(a s|as|t a s|tas|anonim|sirketi|sirket|ltd|sti|limited|holding|ve|tic|san|sanayi|ticaret|hizmetleri|hizmet|grubu|group|turkiye|türkiye)\b/g;

interface FirmaDesen { web: string; desen: PatternKind | ''; guven: number; ornekSayisi: number; genelKutular: string; not: string }

/** Sayfadaki mailto: + duz metin adresleri; yalniz ayni alan adi (veya alt alani); script/style haric */
function adresleriCek(html: string, domain: string): string[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const found = new Set<string>();
  $('a[href^="mailto:"]').each((_, a) => {
    const v = ($(a).attr('href') ?? '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (v) found.add(v);
  });
  for (const m of $.root().text().match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  return [...found].filter((e) => {
    const d = e.split('@')[1] ?? '';
    return d === domain || d.endsWith('.' + domain);
  });
}

/** Ana sayfa nav'indan iletisim benzeri ic linkler (butce kalirsa) */
function navLinkleri(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const text = translit($(a).text());
    if (!/iletisim|contact|basin|press|yatirimci|investor/.test(translit(href) + ' ' + text)) return;
    try {
      const u = new URL(href, base);
      if (normalizeDomain(u.hostname) === normalizeDomain(base)) out.add(u.origin + u.pathname);
    } catch { /* gecersiz href */ }
  });
  return [...out];
}

async function firmaDeseni(domain: string): Promise<FirmaDesen> {
  const base = `https://${domain}`;
  const samples = new Set<string>();
  let pagesTried = 0;
  let home = '';
  try {
    home = await fetchText(base, { timeoutMs: 15_000 });
    pagesTried++;
    for (const e of adresleriCek(home, domain)) samples.add(e);
  } catch (err: any) {
    const code = String(err.message).match(/HTTP \d+/)?.[0] ?? 'ag hatasi';
    return { web: domain, desen: '', guven: 0, ornekSayisi: 0, genelKutular: '', not: `ana sayfa alinamadi: ${code}` };
  }
  const urls = [...new Set([...CONTACT_PATHS.map((p) => base + p), ...navLinkleri(home, base)])].slice(0, MAX_PAGES);
  for (const u of urls) {
    if (samples.size >= 12) break;
    await sleep(jitter(400, 1200));
    try {
      const html = await fetchText(u, { timeoutMs: 15_000 });
      pagesTried++;
      for (const e of adresleriCek(html, domain)) samples.add(e);
    } catch { /* sayfa yok — normal */ }
  }
  const list = [...samples];
  const genel = list.filter((e) => isGenericLocalPart(e.split('@')[0]));
  const inferred = inferPattern(list.map((email) => ({ email })));
  return {
    web: domain,
    desen: inferred?.kind ?? '',
    guven: inferred?.confidence ?? 0,
    ornekSayisi: list.length - genel.length,
    genelKutular: genel.map((e) => e.split('@')[0]).join('|'),
    not: `${pagesTried} sayfa`,
  };
}

async function mxVar(domain: string): Promise<boolean> {
  try { return (await dns.resolveMx(domain)).some((m) => m.exchange && m.exchange !== '.'); } catch { return false; }
}

/**
 * Web'i bos firma icin tek tahmin: <cekirdek>.com.tr / <cekirdek>.com.
 * Kabul sarti: alan adinin MX'i var VE sayfa basligi cekirdek adin tamamini
 * (ya da en az 2 kelimesini) iceriyor — "Anadolu", "Global" gibi tek kelime
 * eslesmesiyle yanlis siteye gitmemek icin.
 */
async function alanAdiTahmin(firma: string): Promise<{ web: string | null; not: string }> {
  const cekirdek = translit(firma).replace(HUKUKI, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cekirdek.split(' ').filter((t) => t.length >= 3);
  const slug = cekirdek.replace(/\s+/g, '');
  if (slug.length < 4 || tokens.length === 0) return { web: null, not: 'cekirdek ad cok kisa' };
  for (const d of [`${slug}.com.tr`, `${slug}.com`]) {
    if (!(await mxVar(d))) continue;
    try {
      const html = await fetchText(`https://${d}`, { timeoutMs: 10_000 });
      const title = translit(cheerio.load(html)('title').first().text());
      const tam = title.includes(cekirdek) || title.includes(slug);
      const ikiKelime = tokens.filter((t) => title.includes(t)).length >= Math.min(2, tokens.length);
      if (tam || (tokens.length >= 2 && ikiKelime)) return { web: d, not: 'baslik eslesti' };
    } catch { /* yok */ }
    await sleep(jitter(300, 800));
  }
  return { web: null, not: 'tahmin dogrulanamadi' };
}

function birlestirYaz(file: string, rows: Array<Record<string, unknown>>, columns: string[], key: string, islenen: Set<string>) {
  let out = rows;
  if (PARTIAL && !OVERWRITE && fs.existsSync(file)) {
    const eski = readCsv(file).filter((r) => !islenen.has(String(r[key] ?? '')) && !rows.some((n) => String(n[key]) === r[key]));
    out = [...eski, ...rows];
  }
  writeCsv(file, out, columns);
  return out.length;
}

async function main() {
  const firmalar = readCsv(FIRMALAR);
  const kisiler = readCsv(KISILER);
  if (firmalar.length === 0) { console.error(`firmalar.csv bos/yok: ${FIRMALAR}`); process.exit(1); }
  if (kisiler.length === 0) { console.error(`kisiler.csv bos/yok: ${KISILER} — once 02-yoneticiler kos`); process.exit(1); }
  console.log(`firmalar: ${firmalar.length} · kisiler: ${kisiler.length}${Number.isFinite(LIMIT) ? ` · limit ${LIMIT}` : ''}${DRY ? ' · DRY' : ''}${ONLY ? ` · only ${ONLY}` : ''}${PARTIAL && !OVERWRITE ? ' · kismi (birlestirilir)' : ''}`);

  // firma → (web, sektor); tahmin onbellegi
  const firmaKey = (s: string) => translit(s).replace(HUKUKI, ' ').replace(/\s+/g, ' ').trim();
  const firmaWeb = new Map<string, string>();
  const firmaSektor = new Map<string, string>();
  for (const f of firmalar) {
    const k = firmaKey(f.firma);
    const d = normalizeDomain(f.web);
    if (d && !firmaWeb.has(k)) firmaWeb.set(k, d);
    if (f.sektor && !firmaSektor.has(k)) firmaSektor.set(k, f.sektor);
  }
  const tahminFile = path.join(DATA_DIR, 'web-tahmin.csv');
  const tahminler = new Map(readCsv(tahminFile).map((r) => [r.firma, r]));

  // kisi → alan adi (kisiler.web > firmalar.web > tahmin onbellegi > tahmin) — yalniz kisisi olan firmalar
  const kisiDomainCache = new Map<string, string | null>();
  let tahminDenendi = 0, tahminBulundu = 0;
  const kisiDomain = async (k: Record<string, string>): Promise<string | null> => {
    const direct = normalizeDomain(k.web);
    if (direct) return direct;
    const key = firmaKey(k.firma);
    if (kisiDomainCache.has(key)) return kisiDomainCache.get(key)!;
    let d: string | null = firmaWeb.get(key) ?? null;
    if (!d) {
      const cached = tahminler.get(k.firma);
      if (cached) d = normalizeDomain(cached.web);
      else if (!ONLY && tahminDenendi < (Number.isFinite(LIMIT) ? LIMIT : 400)) {
        tahminDenendi++;
        const t = await alanAdiTahmin(k.firma);
        tahminler.set(k.firma, { firma: k.firma, web: t.web ?? '', not: t.not });
        d = t.web;
        if (d) tahminBulundu++;
      }
    }
    kisiDomainCache.set(key, d);
    return d;
  };

  const kisiDomains: Array<[Record<string, string>, string | null]> = [];
  for (const k of kisiler) kisiDomains.push([k, await kisiDomain(k)]);
  const webYokKisi = kisiDomains.filter(([, d]) => !d).length;
  console.log(`alan adi: tahmin denendi ${tahminDenendi}, bulundu ${tahminBulundu} · alan adsiz kisi ${webYokKisi}`);

  // alan adi → desen (ONLY/LIMIT burada)
  const domains = [...new Set(kisiDomains.map(([, d]) => d).filter((d): d is string => !!d))]
    .filter((d) => !ONLY || d === ONLY)
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  const desenler = new Map<string, FirmaDesen>();
  let i = 0;
  for (const d of domains) {
    i++;
    const r = await firmaDeseni(d);
    desenler.set(d, r);
    console.log(`[${i}/${domains.length}] ${d}: desen=${r.desen || '-'} guven=${r.guven} ornek=${r.ornekSayisi} (${r.not})`);
    await sleep(jitter(800, 1600));
  }

  // kisi → aday adresler (ad, soyad, alan adi bazinda tekil)
  const adaylar: Array<Record<string, string | number>> = [];
  const gorulen = new Set<string>();
  let kisiSayisi = 0, sektorBos = 0, sektorDisi = 0;
  for (const [k, d] of kisiDomains) {
    if (!d || !desenler.has(d)) continue;
    const ad = titleCaseTr(k.ad), soyad = titleCaseTr(k.soyad);
    const tekil = `${slugName(ad)}|${slugName(soyad)}|${d}`;
    if (gorulen.has(tekil)) continue;
    gorulen.add(tekil);
    const fd = desenler.get(d)!;
    const kinds: PatternKind[] = fd.desen ? [fd.desen] : DEFAULT_PATTERNS;
    const emails = candidateEmails(ad, soyad, d, kinds);
    if (emails.length === 0) continue;
    const sektor = k.sektor || firmaSektor.get(firmaKey(k.firma)) || '';
    if (!sektor) sektorBos++;
    else if (!(SEKTORLER as readonly string[]).includes(sektor)) sektorDisi++;
    kisiSayisi++;
    emails.forEach((email, idx) => adaylar.push({
      email, ad, soyad, firma: k.firma, web: d, unvan: k.unvan, sektor, kademe: k.kademe || '1',
      desen: fd.desen || 'varsayilan', desenGuven: fd.desen ? fd.guven : 0, siralama: idx + 1,
    }));
  }
  const desenli = [...desenler.values()].filter((x) => x.desen).length;
  console.log(`adaylar: ${adaylar.length} adres / ${kisiSayisi} kisi · desenli alan adi ${desenli}/${desenler.size} · sektor bos ${sektorBos}, kapsam disi ${sektorDisi}`);

  if (DRY) { console.log('DRY: dosya yazilmadi'); return; }
  const n1 = birlestirYaz(path.join(DATA_DIR, 'firma-desen.csv'), [...desenler.values()] as unknown as Array<Record<string, unknown>>, ['web', 'desen', 'guven', 'ornekSayisi', 'genelKutular', 'not'], 'web', new Set(domains));
  const n2 = birlestirYaz(path.join(DATA_DIR, 'adaylar.csv'), adaylar, ['email', 'ad', 'soyad', 'firma', 'web', 'unvan', 'sektor', 'kademe', 'desen', 'desenGuven', 'siralama'], 'email', new Set());
  writeCsv(tahminFile, [...tahminler.values()], ['firma', 'web', 'not']);
  console.log(`yazildi: firma-desen.csv (${n1}), adaylar.csv (${n2}), web-tahmin.csv (${tahminler.size}) → ${DATA_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
