#!/usr/bin/env tsx
/**
 * 07-kurumsal-adres — firmanin KENDI sitesinden kurumsal ROL adresi (pazarlama@ / info@ / iletisim@)
 * bulur, MX ile dogrular; 06-mailjet'in okudugu gonderim dosyasini ve IYS yukleme dosyasini uretir.
 *
 * NEDEN (kullanici karari 27.10.2026): "sahsa degil, sirket maillerine atalim". Isimli adres tahmini
 * (03/04: ad.soyad@) 113 firmanin hicbirinde desen dogrulayamadi ve kisisel veri riski tasiyor;
 * rol adresi firmanin bilerek yayimladigi tuzel iletisim kanalidir. Secim kurallari ve neden-listeleri
 * src/prospect/kurumsal-adres.ts'de (saf, testli).
 *
 * NE YAPMAZ: arama motoru / ucuncu taraf site taramasi yok; "ad [at] alan" gibi kasitli gizlemeler
 * cozulmez; isimli adres yazilmaz, loglanmaz; SMTP sondasi yok (04 ile ayni gerekce).
 *
 * Girdi : DATA_DIR/firmalar.csv (01)  [--input]  + istege bagli --ek x.csv (firma[,web][,sektor] — ör. LinkedIn
 *         arastirmasindan cikan firmalar, 08-linkedin-firmalar)
 * Cikti : DATA_DIR/kurumsal-import.csv  — 06-mailjet --input kurumsal-import.csv (ad/soyad BOS → "… ekibi" hitabi)
 *         DATA_DIR/kurumsal-adres-durum.csv — alan adi basina sonuc (bulundu | rol-yok | site-yok | mx-yok | engel);
 *           sonraki kosumda islenmis alan adlari atlanir (--yenile ile yeniden bakilir)
 *         DATA_DIR/iys-yukleme.csv — IYS toplu yukleme icin (alici, tip, alici tipi) — md. 6/6
 * Bayrak: --limit N (alan adi), --dry-run, --only-domain x.com, --sektor s[,s2], --input, --ek, --yenile,
 *         --tahmin-yok (web'i bos firmada alan adi tahmini yapma)
 *
 *   cd apps/api && npx tsx scripts/prospect/07-kurumsal-adres.ts --limit 20 --dry-run
 */
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, fetchText, jitter, normalizeDomain, parseArgs, readCsv, sleep, translit, writeCsv } from '../../src/prospect/prospect-utils.js';
import { CONTACT_PATHS, HUKUKI, alanAdiTahmin, mxVar, navLinkleri } from '../../src/prospect/site-tarama.js';
import { enIyiRolAdresi, sayfadakiAdresler } from '../../src/prospect/kurumsal-adres.js';

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DRY = args['dry-run'] === true;
const YENILE = args.yenile === true;
const TAHMIN_YOK = args['tahmin-yok'] === true;
const ONLY = typeof args['only-domain'] === 'string' ? normalizeDomain(args['only-domain']) : null;
const SEKTOR = typeof args.sektor === 'string' ? new Set(String(args.sektor).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const FIRMALAR = typeof args.input === 'string' ? path.resolve(String(args.input)) : path.join(DATA_DIR, 'firmalar.csv');
const EK = typeof args.ek === 'string' ? path.resolve(String(args.ek)) : null;

const MAX_PAGES = 6;
const IMPORT_FILE = path.join(DATA_DIR, 'kurumsal-import.csv');
const DURUM_FILE = path.join(DATA_DIR, 'kurumsal-adres-durum.csv');
const IYS_FILE = path.join(DATA_DIR, 'iys-yukleme.csv');
const TAHMIN_FILE = path.join(DATA_DIR, 'web-tahmin.csv');
const IMPORT_SUTUN = ['email', 'ad', 'soyad', 'firma', 'unvan', 'sektor', 'segment', 'guven', 'konu_varyanti', 'web', 'kaynakSayfa'];
const DURUM_SUTUN = ['web', 'firma', 'sektor', 'durum', 'email', 'sayfa', 'tarih', 'not'];

type Hedef = { firma: string; web: string; sektor: string };
type Sonuc = { durum: 'bulundu' | 'rol-yok' | 'site-yok' | 'mx-yok' | 'engel'; email: string; sayfa: string; not: string };

/** Ana sayfa + iletisim sayfalari; ilk uygun rol adresinde DURMAZ (pazarlama@ info@'dan iyidir), butce MAX_PAGES */
async function rolAdresiBul(domain: string): Promise<Sonuc> {
  const base = `https://${domain}`;
  const adresSayfa = new Map<string, string>();
  let home: string;
  try {
    home = await fetchText(base, { timeoutMs: 15_000 });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    return { durum: /Engel|engel:/.test(msg) ? 'engel' : 'site-yok', email: '', sayfa: '', not: msg.match(/HTTP \d+|Engel[^ ]*/)?.[0] ?? 'ag hatasi' };
  }
  for (const e of sayfadakiAdresler(home)) if (!adresSayfa.has(e)) adresSayfa.set(e, base);
  const urls = [...new Set([...navLinkleri(home, base), ...CONTACT_PATHS.map((p) => base + p)])].slice(0, MAX_PAGES - 1);
  let gezilen = 1;
  for (const u of urls) {
    // Iyi bir rol adresi (pazarlama/isbirligi/kurumsal) bulunduysa kalan sayfalari yorma
    const simdiki = enIyiRolAdresi([...adresSayfa.keys()], domain);
    if (simdiki && simdiki.oncelik <= 8) break;
    await sleep(jitter(400, 1200));
    try {
      const html = await fetchText(u, { timeoutMs: 15_000 });
      gezilen++;
      for (const e of sayfadakiAdresler(html)) if (!adresSayfa.has(e)) adresSayfa.set(e, u);
    } catch { /* sayfa yok — normal */ }
  }
  const secilen = enIyiRolAdresi([...adresSayfa.keys()], domain);
  if (!secilen) return { durum: 'rol-yok', email: '', sayfa: '', not: `${gezilen} sayfa, ${adresSayfa.size} adres (rol kutusu yok)` };
  const adresDomain = secilen.email.split('@')[1];
  if (!(await mxVar(adresDomain))) return { durum: 'mx-yok', email: '', sayfa: '', not: `${adresDomain} MX yok` };
  return { durum: 'bulundu', email: secilen.email, sayfa: adresSayfa.get(secilen.email) ?? base, not: `${gezilen} sayfa` };
}

const firmaKey = (s: string) => translit(s).replace(HUKUKI, ' ').replace(/\s+/g, ' ').trim();

async function hedefleriTopla(): Promise<{ hedefler: Hedef[]; webYok: number; tahminBulundu: number }> {
  const satirlar = [...readCsv(FIRMALAR), ...(EK ? readCsv(EK) : [])];
  if (satirlar.length === 0) { console.error(`girdi bos/yok: ${FIRMALAR}${EK ? ` + ${EK}` : ''}`); process.exit(1); }
  const tahminler = new Map(readCsv(TAHMIN_FILE).map((r) => [r.firma, r]));
  const gorulen = new Set<string>();
  const hedefler: Hedef[] = [];
  let webYok = 0, tahminDenendi = 0, tahminBulundu = 0;
  for (const r of satirlar) {
    const sektor = (r.sektor || 'diger').trim();
    if (SEKTOR && !SEKTOR.has(sektor)) continue;
    let web = normalizeDomain(r.web);
    if (!web) {
      const t = tahminler.get(r.firma);
      if (t) web = normalizeDomain(t.web);
      else if (!TAHMIN_YOK && !ONLY && tahminDenendi < (Number.isFinite(LIMIT) ? LIMIT : 400)) {
        tahminDenendi++;
        const g = await alanAdiTahmin(r.firma);
        tahminler.set(r.firma, { firma: r.firma, web: g.web ?? '', not: g.not });
        web = g.web;
        if (web) tahminBulundu++;
      }
    }
    if (!web) { webYok++; continue; }
    if (ONLY && web !== ONLY) continue;
    // ayni alan adi tek hedef (ilk gelen kazanir — 01'in sektor onceligi korunur); ayni ad da tek hedef
    const k = firmaKey(r.firma);
    if (gorulen.has(web) || gorulen.has(`ad:${k}`)) continue;
    gorulen.add(web); gorulen.add(`ad:${k}`);
    hedefler.push({ firma: r.firma, web, sektor });
  }
  if (!DRY && tahminDenendi > 0) writeCsv(TAHMIN_FILE, [...tahminler.values()], ['firma', 'web', 'not']);
  return { hedefler, webYok, tahminBulundu };
}

async function main() {
  const { hedefler, webYok, tahminBulundu } = await hedefleriTopla();
  const durumlar = new Map(readCsv(DURUM_FILE).map((r) => [r.web, r]));
  const islenecek = hedefler
    .filter((h) => YENILE || ONLY || !durumlar.has(h.web))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  console.log(`hedef alan adi ${hedefler.length} (web'siz atlanan ${webYok}, tahminle bulunan ${tahminBulundu}) · daha once bakilmis ${hedefler.length - hedefler.filter((h) => !durumlar.has(h.web)).length} · bu kosum ${islenecek.length}${DRY ? ' · DRY' : ''}${SEKTOR ? ` · sektor ${[...SEKTOR].join(',')}` : ''}`);

  const sayac: Record<string, number> = {};
  let i = 0;
  for (const h of islenecek) {
    i++;
    const s = await rolAdresiBul(h.web);
    sayac[s.durum] = (sayac[s.durum] ?? 0) + 1;
    // NEDEN rol adi loglanir, adres loglanmaz: adres tuzel kutu olsa da log dosyalari paylasilabiliyor
    console.log(`[${i}/${islenecek.length}] ${h.web}: ${s.durum}${s.email ? ` (${s.email.split('@')[0]}@)` : ''} — ${s.not}`);
    durumlar.set(h.web, { web: h.web, firma: h.firma, sektor: h.sektor, durum: s.durum, email: s.email, sayfa: s.sayfa, tarih: new Date().toISOString().slice(0, 10), not: s.not });
    // Ara kayit: uzun kosum yarida kesilirse bastan baslamasin
    if (!DRY && i % 10 === 0) writeCsv(DURUM_FILE, [...durumlar.values()], DURUM_SUTUN);
    await sleep(jitter(800, 1600));
  }
  console.log(`sonuc: ${Object.entries(sayac).map(([k, v]) => `${k} ${v}`).join(' · ') || 'islenen yok'}`);
  if (DRY) { console.log('DRY: dosya yazilmadi'); return; }
  writeCsv(DURUM_FILE, [...durumlar.values()], DURUM_SUTUN);

  // Gonderim dosyasi: durum dosyasindaki TUM 'bulundu' satirlari (bu ve onceki kosumlar); adres tekil
  const tekil = new Set<string>();
  const satirlar: Array<Record<string, string>> = [];
  for (const d of durumlar.values()) {
    if (d.durum !== 'bulundu' || !d.email || tekil.has(d.email)) continue;
    tekil.add(d.email);
    const sektor = d.sektor || 'diger';
    satirlar.push({
      email: d.email, ad: '', soyad: '', firma: d.firma, unvan: '', sektor, segment: `${sektor}-kurumsal`,
      guven: 'yuksek', konu_varyanti: satirlar.length % 2 === 0 ? 'A' : 'B', web: d.web, kaynakSayfa: d.sayfa,
    });
  }
  writeCsv(IMPORT_FILE, satirlar, IMPORT_SUTUN);
  // IYS: tacir alicilar gonderimden ONCE yuklenir (Yonetmelik md. 6/6). Sutunlar IYS toplu yukleme
  // sablonundaki alanlarin karsiligi; panelin istedigi basliklarla birebir degilse yuklerken eslenir.
  writeCsv(IYS_FILE, satirlar.map((r) => ({ alici: r.email, tip: 'EPOSTA', aliciTipi: 'TACIR', firma: r.firma })), ['alici', 'tip', 'aliciTipi', 'firma']);
  const sektorSay = satirlar.reduce<Record<string, number>>((a, r) => { a[r.sektor] = (a[r.sektor] ?? 0) + 1; return a; }, {});
  console.log(`yazildi: ${path.basename(IMPORT_FILE)} (${satirlar.length} adres — ${Object.entries(sektorSay).map(([k, v]) => `${k} ${v}`).join(' · ')}), ${path.basename(IYS_FILE)}, ${path.basename(DURUM_FILE)} (${durumlar.size}) → ${DATA_DIR}`);
  if (!fs.existsSync(path.join(DATA_DIR, 'mailjet-gonderim.csv'))) console.log('Not: gonderim oncesi iys-yukleme.csv IYS paneline yuklenmeli; sonra 06-mailjet --input kurumsal-import.csv --dry-run --ornek-goster');
}

main().catch((err) => { console.error(err); process.exit(1); });
