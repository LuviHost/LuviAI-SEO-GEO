#!/usr/bin/env tsx
/**
 * 04-dogrula — aday adresleri SOZDIZIMI + MX ile ele, Jetmail import dosyasini uret.
 *
 * NEDEN SMTP SONDASI YOK: RCPT TO ile adres deneme alici sunucular tarafindan
 * kotuye kullanim sayilir ve gonderici itibarini yakar; kurumsal/M365 hibrit
 * gecitlerde cogu zaman catch-all doner, bilgi vermez. Bunun yerine:
 * (1) sozdizimi, (2) alan adinin MX (yoksa A) kaydi, (3) desen guveni → guven
 * etiketi; son ag Jetmail bounce yonetimi + siki isindirma (100 → 200 → 400/gun;
 * bounce > %3 → dur).
 *
 * Girdi : DATA_DIR/adaylar.csv (03)                      [--input]
 * Cikti : DATA_DIR/jetmail-import.csv, DATA_DIR/dogrulama.csv
 *         Kismi kosumlarda (--limit / --only-domain) mevcut dosyalarla birlestirilir; --overwrite sifirdan.
 * Bayrak: --limit N (kisi), --dry-run, --only-domain, --input, --overwrite,
 *         --dusuk-dahil (desen guveni < 0.5 olan 'dusuk' satirlar da girer — 2. dalga),
 *         --sektor-serbest (sektoru bos/kapsam disi satirlari da al; varsayilan: atla)
 *
 *   cd apps/api && npx tsx scripts/prospect/04-dogrula.ts
 */
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { DATA_DIR, SEKTORLER, normalizeDomain, parseArgs, readCsv, slugName, writeCsv } from '../../src/prospect/prospect-utils.js';

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DRY = args['dry-run'] === true;
const OVERWRITE = args.overwrite === true;
const ONLY = typeof args['only-domain'] === 'string' ? normalizeDomain(args['only-domain']) : null;
const PARTIAL = !!ONLY || Number.isFinite(LIMIT);
const DUSUK_DAHIL = args['dusuk-dahil'] === true;
const SEKTOR_SERBEST = args['sektor-serbest'] === true;
const INPUT = typeof args.input === 'string' ? path.resolve(String(args.input)) : path.join(DATA_DIR, 'adaylar.csv');

const SYNTAX_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

type MxDurum = { mx: string; kind: 'mx' | 'a_only' | 'none' };
const mxCache = new Map<string, MxDurum>();
async function mxOf(domain: string): Promise<MxDurum> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let out: MxDurum = { mx: '', kind: 'none' };
  try {
    const rows = (await dns.resolveMx(domain)).filter((m) => m.exchange && m.exchange !== '.'); // "." = null MX (RFC 7505): posta kabul etmiyor
    if (rows.length) out = { mx: rows.sort((a, b) => a.priority - b.priority)[0].exchange, kind: 'mx' };
  } catch { /* MX yok */ }
  if (out.kind === 'none') {
    try { if ((await dns.resolve4(domain)).length) out = { mx: '(A)', kind: 'a_only' }; } catch { /* A da yok */ }
  }
  mxCache.set(domain, out);
  return out;
}

function birlestirYaz(file: string, rows: Array<Record<string, unknown>>, columns: string[], key: string): number {
  let out = rows;
  if (PARTIAL && !OVERWRITE && fs.existsSync(file)) {
    const yeni = new Set(rows.map((r) => String(r[key])));
    out = [...readCsv(file).filter((r) => !yeni.has(String(r[key] ?? ''))), ...rows];
  }
  writeCsv(file, out, columns);
  return out.length;
}

async function main() {
  const adaylar = readCsv(INPUT).filter((r) => !ONLY || normalizeDomain(r.web) === ONLY);
  if (adaylar.length === 0) { console.error(`adaylar.csv bos/yok: ${INPUT}`); process.exit(1); }

  // kisi anahtari (ad, soyad, alan adi) → adaylar (siralama sirasiyla)
  const byKisi = new Map<string, Array<Record<string, string>>>();
  for (const r of adaylar) {
    const key = `${slugName(r.ad)}|${slugName(r.soyad)}|${normalizeDomain(r.web) ?? ''}`;
    byKisi.set(key, [...(byKisi.get(key) ?? []), r]);
  }
  const kisiler = [...byKisi.entries()].slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  console.log(`adaylar: ${adaylar.length} adres · ${byKisi.size} kisi · islenecek ${kisiler.length}${DRY ? ' · DRY' : ''}${PARTIAL && !OVERWRITE ? ' · kismi (birlestirilir)' : ''}`);

  const dogrulama: Array<Record<string, string>> = [];
  const jetmail: Array<Record<string, string>> = [];
  const gorulenEmail = new Set<string>();
  let sira = 0, noMx = 0, sektorAtlandi = 0, dusukAtlandi = 0;
  for (const [, rows] of kisiler) {
    rows.sort((a, b) => Number(a.siralama) - Number(b.siralama));
    const domain = normalizeDomain(rows[0].web) ?? '';
    const mx = domain ? await mxOf(domain) : { mx: '', kind: 'none' as const };
    let secilen: Record<string, string> | null = null;
    for (const r of rows) {
      const email = r.email.trim().toLowerCase();
      let status = mx.kind === 'mx' ? 'mx_ok' : mx.kind === 'a_only' ? 'a_only' : 'no_mx';
      let not = mx.kind === 'a_only' ? 'MX yok, yalniz A kaydi' : mx.kind === 'none' ? 'alan adinin MX/A kaydi yok' : '';
      if (!SYNTAX_RE.test(email)) { status = 'syntax'; not = 'gecersiz sozdizimi'; }
      else if (gorulenEmail.has(email)) { status = 'tekrar'; not = 'ayni adres baska satirda'; }
      dogrulama.push({ email, status, mx: mx.mx, not });
      if ((status === 'mx_ok' || status === 'a_only') && !secilen) secilen = { ...r, email, _status: status };
    }
    if (mx.kind === 'none') noMx++;
    if (!secilen) continue;

    const sektor = secilen.sektor ?? '';
    if (!(SEKTORLER as readonly string[]).includes(sektor) && !SEKTOR_SERBEST) { sektorAtlandi++; continue; }
    const guvenNum = Number(secilen.desenGuven || 0);
    const guven = guvenNum >= 0.5 && secilen._status === 'mx_ok' ? 'yuksek' : 'dusuk';
    if (guven === 'dusuk' && !DUSUK_DAHIL) { dusukAtlandi++; continue; }
    gorulenEmail.add(secilen.email);
    sira++;
    jetmail.push({
      email: secilen.email, ad: secilen.ad, soyad: secilen.soyad, firma: secilen.firma, unvan: secilen.unvan,
      sektor, segment: `${sektor || 'diger'}-k${secilen.kademe || '1'}`, guven,
      konu_varyanti: sira % 2 === 0 ? 'B' : 'A',
    });
  }

  const yuksek = jetmail.filter((j) => j.guven === 'yuksek').length;
  console.log(`sonuc: jetmail-import ${jetmail.length} (yuksek ${yuksek}, dusuk ${jetmail.length - yuksek}) · atlanan: MX'siz alan adi ${noMx}, sektor disi ${sektorAtlandi}, dusuk guven ${dusukAtlandi}${DUSUK_DAHIL ? '' : ' (--dusuk-dahil ile alinir)'}`);
  console.log('HATIRLATMA: gondermeden once IYS kaydi + adres yukleme + ret kontrolu (Yonetmelik md. 5/2, 6/6); Jetmail liste dogrulama varsa once onu kos; isindirma 100→200→400/gun.');

  if (DRY) { console.log('DRY: dosya yazilmadi'); return; }
  const n1 = birlestirYaz(path.join(DATA_DIR, 'dogrulama.csv'), dogrulama, ['email', 'status', 'mx', 'not'], 'email');
  const n2 = birlestirYaz(path.join(DATA_DIR, 'jetmail-import.csv'), jetmail, ['email', 'ad', 'soyad', 'firma', 'unvan', 'sektor', 'segment', 'guven', 'konu_varyanti'], 'email');
  console.log(`yazildi: dogrulama.csv (${n1}), jetmail-import.csv (${n2}) → ${DATA_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
