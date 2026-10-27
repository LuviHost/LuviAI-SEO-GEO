/**
 * Faz 1 — acik kaynaklardan kurumsal firma listesi → DATA_DIR/firmalar.csv
 *
 * Kullanim (apps/api icinde):
 *   npx tsx scripts/prospect/01-firmalar.ts                       # tum statik kaynaklar, dosyayi yaz
 *   npx tsx scripts/prospect/01-firmalar.ts --limit 5 --dry-run   # kaynak basina 5 kayit, yazma
 *   npx tsx scripts/prospect/01-firmalar.ts --only tbb,seddk      # yalniz secilen kaynaklar (+seed).
 *                                                                 # Mevcut firmalar.csv ONCE yuklenir, secilenler
 *                                                                 # ustune birlestirilir (dosya kuculmez)
 *   npx tsx scripts/prospect/01-firmalar.ts --only tubisad --no-merge   # mevcut dosyayi yukleme (sifirdan)
 *   npx tsx scripts/prospect/01-firmalar.ts --kap-detail          # KAP genel sayfalari (web + sektor; 750+ istek)
 *   npx tsx scripts/prospect/01-firmalar.ts --via openclaw --only etid,btk   # JS-only kaynaklar (ETID, BTK)
 *                                                                 # OpenClaw tarayiciyla — SUNUCUDA kosulur
 *
 * Cikis kodu: 0 = tamam · 1 = kullanim/olumcul hata · 2 = en az bir kaynak HATA verdi ya da 0 sonuc dondu
 * (dosya yine yazilir ama EKSIKTIR; ozetteki "EKSIK KAYNAK" satirindaki komutla tamamla).
 *
 * NEDEN: 6.000 e-postalik kurumsal kampanya icin hedef firma yiginini (finans /
 * e-ticaret-perakende-teknoloji / turizm-havayolu-telekom-otomotiv) acik kaynaklardan
 * topluyoruz; ucretli veri yok. Her kaynak ayri fonksiyon: biri kirilirsa loglanir,
 * atlanir, script durmaz. Ayni alan adi = tek satir; kaynaklar '|' ile birlesir.
 *
 * Cikti sutunlari: firma,sektor,altsektor,web,sehir,calisan,kaynaklar,kaynakUrl,sektorKaynak,not
 *   - sektor 'diger': hedef uc gruba eslesmeyen (yazilir ama isaretlenir; ozet sayar)
 *   - sektorKaynak: sektor etiketinin nereden geldigi — seed | kaynak (dernek/otorite listesi) |
 *     etiket (Fortune'un kendi sektor satiri) | kap-detay (KAP "Sirketin Sektoru") | unvan (unvan/ad
 *     ipucundan TAHMIN — 03/04 ve kullanici bunu dogrulanmis satirdan ayirabilir) | bos (diger)
 *   - not: serbest metin (seed notu, OYDER/ODMD markalari, TUROB zincir otelleri)
 *   - web bos olabilir (03-desen alan adini arar)
 *
 * KVKK notu: bu dosya yalniz tuzel kisi (firma) verisi toplar; isimli veri yok (OYDER "Yetkili"
 * sutunu OKUNMAZ). Cikti reklam/pazarlama/prospect/data/ altinda ve .gitignore'dadir.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as cheerio from 'cheerio';
import {
  DATA_DIR,
  PROSPECT_DIR,
  SEKTORLER,
  type Sektor,
  fetchText,
  jitter,
  normalizeDomain,
  parseArgs,
  readCsv,
  sleep,
  translit,
  writeCsv,
} from '../../src/prospect/prospect-utils.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

/** 'ajans': RanksUp'i musterilerine kullandiracak is ortagi adayi (27.10.2026) — SEKTORLER'e girmez (karne sorulari yok) */
type Sektor3 = Sektor | 'ajans' | 'diger';
const HEDEF_SEKTOR: readonly string[] = [...SEKTORLER, 'ajans'];
const sektorOku = (s: string): Sektor3 => (HEDEF_SEKTOR.includes(s) ? (s as Sektor3) : 'diger');

/** Sektor etiketinin kaynagi; sira = guven (yuksek olan dusugu ezer, esitte ilk gelen kalir) */
type SektorKaynak = 'seed' | 'kap-detay' | 'kaynak' | 'etiket' | 'unvan' | '';
const SK_RANK: Record<SektorKaynak, number> = { seed: 4, 'kap-detay': 3, kaynak: 2, etiket: 2, unvan: 1, '': 0 };
const SK_LISTE: readonly SektorKaynak[] = ['seed', 'kap-detay', 'kaynak', 'etiket', 'unvan', ''];

/** Bir kaynaktan gelen ham kayit; sektor/altsektor verilmezse kaynagin varsayilani */
interface Ham {
  firma: string;
  web?: string | null;
  sektor?: Sektor3;
  altsektor?: string;
  sehir?: string;
  calisan?: string;
  url?: string;
  sektorKaynak?: SektorKaynak;
  not?: string;
}

interface Kaynak {
  ad: string;
  sektor: Sektor3;
  altsektor: string;
  url: string;
  run: (ctx: Ctx) => Promise<Ham[]>;
  /** JS-only kaynak: yalniz --via openclaw ile kosar, yoksa "atlandi" */
  via?: 'openclaw';
}

interface Ctx {
  limit: number | null;
  kapDetail: boolean;
  log: (msg: string) => void;
}

interface Firma {
  firma: string;
  sektor: Sektor3;
  altsektor: string;
  web: string;
  sehir: string;
  calisan: string;
  kaynaklar: string[];
  kaynakUrl: string[];
  sektorKaynak: SektorKaynak;
  not: string;
}

const COLUMNS = ['firma', 'sektor', 'altsektor', 'web', 'sehir', 'calisan', 'kaynaklar', 'kaynakUrl', 'sektorKaynak', 'not'];
const S_FIN: Sektor = 'finans';
const S_ETIC: Sektor = 'eticaret-perakende-teknoloji';
const S_TUR: Sektor = 'turizm-havayolu-telekom-otomotiv';

// ─── Ag ─────────────────────────────────────────────────────────────────────

let ilkIstek = true;

/** Gecici sayilan hatalar: zaman asimi/iptal, baglanti kopmasi, 5xx, 429 */
const GECICI_HATA_RE = /abort|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE|fetch failed|socket hang up|HTTP (5\d\d|429|408)\b/i;

/**
 * Her istek arasinda rastgele bekleme (400-1200 ms) — kaynak siteleri yormamak icin.
 * NEDEN tekrar: canli kosumda TUBISAD 30 sn'de "This operation was aborted" verdi, ikinci
 * denemede 1,3 sn'de 200 dondu; tek gecici hata 255 firmalik kaynagi sessizce dusurmesin.
 */
async function get(url: string, opts: Parameters<typeof fetchText>[1] = {}): Promise<string> {
  if (!ilkIstek) await sleep(jitter(400, 1200));
  ilkIstek = false;
  try {
    return await fetchText(url, { timeoutMs: 30_000, ...opts });
  } catch (e) {
    const err = e as Error;
    const gecici = GECICI_HATA_RE.test(err.message ?? '') || /abort/i.test(err.name ?? '');
    if (!gecici) throw e;
    await sleep(jitter(2000, 4000));
    return fetchText(url, { timeoutMs: 45_000, ...opts });
  }
}

async function getJson<T>(url: string): Promise<T> {
  const text = await get(url, { headers: { accept: 'application/json' } });
  return JSON.parse(text) as T;
}

// ─── OpenClaw tarayici (JS-only kaynaklar) ──────────────────────────────────
// x-curation.service.ts ile ayni sarmalayici: `openclaw browser <cmd> --json`; LLM YOK.
// Sunucuda kosar (gateway orada); Mac'te OPENCLAW_GATEWAY_URL/OPENCLAW_TOKEN ile de olur.

const OPENCLAW_TIMEOUT_MS = 45_000;

function openclawBrowser<T = unknown>(args: string[]): Promise<T | null> {
  const bin = process.env.OPENCLAW_BIN ?? 'openclaw';
  const full = ['browser', ...args, '--json', '--timeout', String(OPENCLAW_TIMEOUT_MS)];
  if (process.env.OPENCLAW_GATEWAY_URL) full.push('--url', process.env.OPENCLAW_GATEWAY_URL);
  if (process.env.OPENCLAW_TOKEN) full.push('--token', process.env.OPENCLAW_TOKEN);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(bin, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`openclaw browser ${args[0]} zaman asimi`)); }, OPENCLAW_TIMEOUT_MS + 15_000);
    proc.stdout.on('data', (c: Buffer) => { if (stdout.length < 4_000_000) stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c: Buffer) => { if (stderr.length < 8_000) stderr += c.toString('utf8'); });
    proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`openclaw calistirilamadi (${bin}): ${e.message}`)); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`openclaw browser ${args[0]} cikis ${code}: ${stderr.slice(0, 300)}`));
      const s = stdout.trim();
      if (!s) return resolve(null);
      const start = s.indexOf('{');
      try { resolve(JSON.parse(start >= 0 ? s.slice(start) : s) as T); } catch { resolve(null); }
    });
  });
}

/** Sayfayi ac, JS yuklensin diye bekle, salt-okunur evaluate ile veri cek, sekmeyi kapat */
async function openclawOku<T>(url: string, fn: string, bekleMs = 6_000): Promise<T | null> {
  const opened = await openclawBrowser<{ tabId?: string; targetId?: string }>(['open', url]);
  const tab = opened?.tabId ?? opened?.targetId;
  try {
    await sleep(bekleMs);
    const res = await openclawBrowser<{ result?: T }>(['evaluate', '--fn', fn]);
    return res?.result ?? null;
  } finally {
    if (tab) await openclawBrowser(['close', tab]).catch(() => undefined);
  }
}

// ─── Metin yardimcilari ─────────────────────────────────────────────────────

const temiz = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Fortune / KAP sektor etiketleri icin ACIK tablo — genel regex'ten ONCE bakilir.
 * NEDEN: "Elektronik ve telekomunikasyon" (Vestel/Arcelik tipi beyaz esya-elektronik ureticileri)
 * 'telekom' kelimesiyle turizm/havayolu/telekom/otomotiv'e, "Bilgi ve iletisim hizmetleri"
 * 'iletisim hizmet' ile telekoma dusuyordu.
 */
const ACIK_ETIKET: Array<[RegExp, Sektor3, string]> = [
  [/^elektronik ve telekomunikasyon$/, S_ETIC, 'elektronik'],
  [/^elektrikli ev aletleri/, S_ETIC, 'elektronik'], // Vestel/Arcelik/BSH — tuketici markasi, ayni kefede
  [/^bilgi ve iletisim/, S_ETIC, 'teknoloji'],
  [/^bilisim/, S_ETIC, 'teknoloji'],
];
const acikEtiket = (t: string) => ACIK_ETIKET.find(([re]) => re.test(t));

/**
 * Sektor metnini uc gruba esle (Fortune sektor satiri, KAP "Sirketin Sektoru", kisa marka adi).
 * NEDEN sira onemli: acik tablo → holding/GYO (hedef degil) → finans → turizm/havayolu/telekom/
 * otomotiv → e-tic/perakende/teknoloji. Uzun KAP unvanlari icin BUNU DEGIL gucluUnvanEsle'yi kullan.
 */
function sektorEsle(text: string): Sektor3 {
  const t = translit(text);
  if (!t) return 'diger';
  const a = acikEtiket(t);
  if (a) return a[1];
  if (/\b(holding|gayrimenkul)\b/.test(t)) return 'diger';
  if (/bank\b|banka|sigorta|reasurans|emeklilik|faktoring|finansal kiralama|finansman|leasing|portfoy|menkul|yatirim ortakligi|mali kurulus|odeme|elektronik para|arac kurum|varlik yonetim/.test(t)) return S_FIN;
  if (/hava ?yol|havacilik|havalimani|turizm|otel|konaklama|seyahat|telekom|iletisim hizmet|haberlesme|otomotiv|otomobil|motorlu|tasit arac|arac kiralama/.test(t)) return S_TUR;
  if (/perakende|e-?ticaret|magazacilik|market|bilisim|yazilim|teknoloji|elektronik|bilgisayar|bilgi ve iletisim|internet/.test(t)) return S_ETIC;
  return 'diger';
}

/** Unvan/sektor metninden alt sektor etiketi (yalniz gosterim; bos olabilir) */
function altSektorTahmin(text: string): string {
  const t = translit(text);
  const a = acikEtiket(t);
  if (a) return a[2];
  // NEDEN: holding / GYO hedef degil; "yatirim" kelimesi yuzunden yatirim-kurulusu sanilmasin
  if (/\b(holding|gayrimenkul)\b/.test(t)) return '';
  const tablo: Array<[RegExp, string]> = [
    [/bank\b|banka/, 'banka'], [/reasurans/, 'reasurans'], [/sigorta/, 'sigorta'], [/emeklilik/, 'emeklilik-bes'],
    [/faktoring/, 'faktoring'], [/finansal kiralama|leasing/, 'leasing'], [/tasarruf finansman/, 'tasarruf-finansman'],
    [/finansman/, 'finansman'], [/portfoy/, 'portfoy-yonetimi'], [/varlik yonetim/, 'varlik-yonetimi'],
    [/menkul|arac kurum|yatirim/, 'yatirim-kurulusu'],
    [/odeme|elektronik para/, 'odeme-epara'],
    [/hava ?yol|havacilik/, 'havayolu'], [/havalimani/, 'havalimani'], [/turizm|otel|konaklama|seyahat/, 'turizm'],
    [/telekom|iletisim hizmet|haberlesme/, 'telekom'], [/arac kiralama/, 'otomotiv-kiralama'], [/otomotiv|otomobil|motorlu|tasit/, 'otomotiv'],
    [/e-?ticaret|internet/, 'eticaret'], [/perakende|magazacilik|market/, 'perakende'],
    [/bilisim|yazilim|teknoloji|bilgisayar|bilgi ve iletisim/, 'teknoloji'], [/elektronik/, 'elektronik'],
  ];
  for (const [re, ad] of tablo) if (re.test(t)) return ad;
  return '';
}

/**
 * Yalniz GUCLU unvan ipuclari (KAP IGS varsayilan modu — detay sayfasi cekilmediginde).
 * NEDEN: 'turizm'/'teknoloji'/'elektronik' gibi genel kelimeler unvanin herhangi bir yerinde
 * gecince (AKFEN INSAAT TURIZM, ALTINAY SAVUNMA TEKNOLOJILERI, KIRAC GALVANIZ TELEKOMINIKASYON)
 * yanlis grup uretiyordu; burada yalniz ana faaliyeti kesin belirten kaliplar var. Eslesen
 * satirlar yine de sektorKaynak='unvan' ile TAHMIN olarak isaretlenir.
 */
const GUCLU_UNVAN: Array<[RegExp, Sektor3, string]> = [
  [/\bbankasi\b|\bbank\b/, S_FIN, 'banka'],
  [/\breasurans\b/, S_FIN, 'reasurans'],
  [/\bsigorta\b/, S_FIN, 'sigorta'],
  [/\bemeklilik\b/, S_FIN, 'emeklilik-bes'],
  [/\bfaktoring\b/, S_FIN, 'faktoring'],
  [/\bfinansal kiralama\b/, S_FIN, 'leasing'],
  [/\bfinansman\b/, S_FIN, 'finansman'],
  [/\bportfoy\b/, S_FIN, 'portfoy-yonetimi'],
  [/\bmenkul degerler\b|\byatirim menkul\b|\byatirim ortakligi\b/, S_FIN, 'yatirim-kurulusu'],
  [/\bodeme (hizmetleri|kurulusu)\b|\belektronik para\b/, S_FIN, 'odeme-epara'],
  [/\bhava ?yollari\b/, S_TUR, 'havayolu'],
  [/\bhavalimanlari\b|\bhavalimani\b/, S_TUR, 'havalimani'],
  [/\botel(cilik|leri)?\b/, S_TUR, 'turizm'],
  [/\biletisim hizmetleri\b/, S_TUR, 'telekom'],
  [/\botomotiv\b|\botomobil\b/, S_TUR, 'otomotiv'],
  [/\bmagazacilik\b|\bmagazalar(i)?\b/, S_ETIC, 'perakende'],
  [/\be-?ticaret\b/, S_ETIC, 'eticaret'],
];
function gucluUnvanEsle(firma: string): { sektor: Sektor3; altsektor: string } {
  const t = translit(firma);
  if (!t || /\b(holding|gayrimenkul)\b/.test(t)) return { sektor: 'diger', altsektor: '' };
  for (const [re, sektor, altsektor] of GUCLU_UNVAN) if (re.test(t)) return { sektor, altsektor };
  return { sektor: 'diger', altsektor: '' };
}

/** Ayni firmayi adla eslemek icin anahtar: hukuki ek/sonekler atilir (A.S., T.A.S., Ltd. Sti.) */
const HUKUKI_EK = new Set(['a', 's', 'as', 'ao', 'tas', 'ltd', 'sti', 'anonim', 'sirketi', 'sirket', 'inc', 'co', 'limited', 'ortakligi']);
/**
 * NEDEN kisaltma haritasi: Fortune kisaltilmis ("ARZUM ELEKTRIKLI EV ALETLERI SAN. VE TIC."),
 * KAP tam unvan ("... SANAYI VE TICARET A.S.") yazar; normalize edilmezse ayni firma iki satir olur.
 */
const KISALTMA: Record<string, string> = {
  san: 'sanayi', sanayii: 'sanayi', tic: 'ticaret', muh: 'muhendislik', ins: 'insaat', paz: 'pazarlama',
  hiz: 'hizmetleri', hizmet: 'hizmetleri', teks: 'tekstil', end: 'endustri', endustrisi: 'endustri',
  mad: 'madencilik', tur: 'turizm', ith: 'ithalat', ihr: 'ihracat', yat: 'yatirim', hold: 'holding',
};
function adAnahtar(firma: string): string {
  const tokens = translit(firma).split(' ').map((x) => KISALTMA[x] ?? x).filter((x) => x && !HUKUKI_EK.has(x));
  return tokens.length > 0 ? tokens.join(' ') : translit(firma);
}

/** "İSTANBUL" → "İstanbul" (kaynaklar arasi tutarli sehir yazimi) */
function sehirBicim(s: string): string {
  const t = temiz(s);
  return t ? t.charAt(0).toLocaleUpperCase('tr-TR') + t.slice(1).toLocaleLowerCase('tr-TR') : '';
}

/** "Buyukdere Cad. No:145 Zincirlikuyu / ISTANBUL" → "Istanbul" */
function sehirFromAdres(adres: string): string {
  const son = temiz(adres).split('/').pop() ?? '';
  const s = temiz(son).replace(/[^\p{L}\s]/gu, '');
  if (!s || s.length > 25) return '';
  return sehirBicim(s);
}

/** "tr.rotana.com" → "Rotana", "divan.com.tr" → "Divan" (alan adindan marka etiketi) */
function alanEtiket(dom: string): string {
  const parts = dom.split('.');
  const ikili = /\.(com|net|org|gov|edu|k12|gen|web|bel)\.tr$/.test(dom) || /\.co\.uk$/.test(dom);
  const idx = Math.max(0, parts.length - (ikili ? 3 : 2));
  const label = parts[idx] ?? dom;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : dom;
}

// ─── Kaynaklar ──────────────────────────────────────────────────────────────

const URL_TBB = 'https://www.tbb.org.tr/banka-ve-sektor-bilgileri/banka-bilgileri/bankalar/internet-adresleri';
async function tbb(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_TBB));
  const out: Ham[] = [];
  // NEDEN: Drupal blogu id'siyle secilir; kirilirsa "Banka Adi" basligi olan tabloya duser
  let $rows = $('#block-bankinternetaddresses table tbody tr');
  if ($rows.length === 0) $rows = $('table').filter((_, t) => /Banka Ad/i.test($(t).find('th').first().text())).find('tbody tr');
  $rows.each((_, tr) => {
    const td = $(tr).find('td');
    const firma = temiz(td.eq(0).text());
    const web = td.eq(1).find('a').attr('href') ?? temiz(td.eq(1).text());
    if (firma) out.push({ firma, web });
  });
  ctx.log(`${out.length} banka`);
  return out;
}

const URL_SEDDK = 'https://www.seddk.gov.tr/tr/kuruluslar/sigorta-reasurans-ve-bes-sirketleri';
async function seddk(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_SEDDK));
  const out: Ham[] = [];
  $('.simple-accordion-item').each((_, item) => {
    const baslik = temiz($(item).find('.simple-accordion-item-title').first().text());
    const t = translit(baslik);
    // NEDEN: "Sirket Ruhsatlari" bolumu firma listesi degil, atlanir
    let alt = '';
    if (/reasurans/.test(t)) alt = 'reasurans';
    else if (/emeklilik/.test(t)) alt = 'emeklilik-bes';
    else if (/sigorta/.test(t)) alt = 'sigorta';
    else return;
    $(item).find('table tbody tr').each((__, tr) => {
      const td = $(tr).find('td');
      const firma = temiz(td.eq(0).text());
      const web = td.eq(1).find('a').attr('href') ?? temiz(td.eq(1).text());
      if (firma) out.push({ firma, web, altsektor: alt });
    });
  });
  ctx.log(`${out.length} sigorta/reasurans/BES`);
  return out;
}

// NEDEN: TODEB sayfa 2+ URL'leri farkli slug kullaniyor (elektronikparakuruluslari, odemekuruslari) — siteden alindi
const TODEB_SAYFALAR: Array<{ url: string; etiket: string }> = [
  { url: 'https://todeb.org.tr/sayfa/elektronik-para-kuruluslari/62/', etiket: 'EPK s1' },
  { url: 'https://todeb.org.tr/sayfa/elektronikparakuruluslari/62/2', etiket: 'EPK s2' },
  { url: 'https://todeb.org.tr/sayfa/elektronikparakuruluslari/62/3', etiket: 'EPK s3' },
  { url: 'https://todeb.org.tr/sayfa/odeme-kuruslari/61/', etiket: 'OK s1' },
  { url: 'https://todeb.org.tr/sayfa/odemekuruslari/61/2', etiket: 'OK s2' },
];
async function todeb(ctx: Ctx): Promise<Ham[]> {
  const out: Ham[] = [];
  for (const s of TODEB_SAYFALAR) {
    if (ctx.limit !== null && out.length >= ctx.limit) break;
    let html: string;
    try {
      html = await get(s.url);
    } catch (e) {
      ctx.log(`UYARI ${s.etiket} atlandi: ${(e as Error).message}`);
      continue;
    }
    const $ = cheerio.load(html);
    let n = 0;
    $('.flexCerceve').each((_, el) => {
      const firma = temiz($(el).find('h2').first().text());
      if (!firma) return;
      const web = $(el).find('a[href^="http"]').filter((__, a) => !/todeb\.org\.tr/i.test($(a).attr('href') ?? '')).first().attr('href');
      out.push({ firma, web, url: s.url });
      n++;
    });
    ctx.log(`${s.etiket}: ${n}`);
  }
  return out;
}

const URL_FKB = 'https://www.fkb.org.tr/uyelerimiz';
async function fkb(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_FKB));
  const out: Ham[] = [];
  $('.member-card').each((_, el) => {
    const firma = temiz($(el).find('.member-card__title').first().text());
    if (!firma) return;
    const web = $(el).find('a.member-card__link').attr('href');
    const adres = temiz($(el).find('.member-card__description').first().text());
    out.push({ firma, web, altsektor: altSektorTahmin(firma) || 'leasing-faktoring', sehir: sehirFromAdres(adres) });
  });
  ctx.log(`${out.length} uye`);
  return out;
}

// KAP: dort uye tipi. IGS = borsa sirketleri (sektor detaydan ya da guclu unvan ipucundan), YK/PYS/BDK = finans.
interface KapItem { kapMemberOid: string; mkkMemberOid: string; kapMemberTitle: string; stockCode: string | null; cityName: string | null; companyCode?: string }
interface KapFilterItem { companyCode: string; mkkMemberOid: string; title: string; permaLink: string }

function kapKaynak(tip: 'IGS' | 'YK' | 'PYS' | 'BDK', altsektor: string) {
  return async (ctx: Ctx): Promise<Ham[]> => {
    const listUrl = `https://www.kap.org.tr/tr/api/company/items/${tip}/A`;
    let items = await getJson<KapItem[]>(listUrl);
    if (!Array.isArray(items)) throw new Error('KAP JSON dizi degil');
    ctx.log(`${items.length} kayit (${tip})`);
    if (ctx.limit !== null) items = items.slice(0, ctx.limit);
    const out: Ham[] = [];
    let tahmin = 0;
    for (const it of items) {
      const firma = temiz(it.kapMemberTitle);
      if (!firma) continue;
      const ham: Ham = { firma, sehir: sehirBicim(it.cityName ?? ''), url: listUrl };
      if (tip === 'IGS') {
        // NEDEN: detay yokken YALNIZ guclu unvan ipucu (BANKASI, SIGORTA, HAVA YOLLARI, MAGAZACILIK...);
        // 'turizm'/'teknoloji' gibi genel kelimeler kullanilmaz. Eslesen satir sektorKaynak='unvan' (tahmin).
        const g = gucluUnvanEsle(firma);
        ham.sektor = g.sektor;
        ham.altsektor = g.altsektor;
        if (g.sektor !== 'diger') { ham.sektorKaynak = 'unvan'; tahmin++; }
      } else {
        // NEDEN: YK listesinde bankalar da var (Akbank, Albaraka...) → unvan ipucu varsa o, yoksa tipin varsayilani
        ham.altsektor = altSektorTahmin(firma) || altsektor;
      }
      if (ctx.kapDetail) {
        try {
          const d = await kapDetay(it);
          if (d) {
            ham.web = d.web;
            ham.url = d.url;
            if (tip === 'IGS' && d.sektorMetni) {
              ham.sektor = sektorEsle(d.sektorMetni);
              ham.altsektor = altSektorTahmin(d.sektorMetni) || ham.altsektor;
              ham.sektorKaynak = 'kap-detay';
            }
          }
        } catch (e) {
          ctx.log(`UYARI detay atlandi ${firma}: ${(e as Error).message}`);
        }
      }
      out.push(ham);
    }
    if (tip === 'IGS' && !ctx.kapDetail) ctx.log(`${tahmin} satir guclu unvan ipucuyla siniflandi (sektorKaynak=unvan); gerisi diger — kesin etiket icin --kap-detail`);
    return out;
  };
}

/** stockCode → permaLink → genel sayfa (RSC yuku icinde "kpy41_acc1_int_addres" / "kpy41_acc2_sektor") */
async function kapDetay(it: KapItem): Promise<{ web: string | null; sektorMetni: string | null; url: string } | null> {
  const q = it.stockCode || it.kapMemberTitle.split(' ')[0];
  if (!q) return null;
  const list = await getJson<KapFilterItem[]>(`https://www.kap.org.tr/tr/api/member/filter/${encodeURIComponent(q)}`);
  if (!Array.isArray(list) || list.length === 0) return null;
  // NEDEN: filter ucu metin aramasi yapar (ACA → birden cok sonuc); mkkMemberOid ile kesin eslesme
  const hit = list.find((x) => x.mkkMemberOid === it.mkkMemberOid) ?? list.find((x) => temiz(x.title) === temiz(it.kapMemberTitle));
  if (!hit?.permaLink) return null;
  const url = `https://www.kap.org.tr/tr/sirket-bilgileri/genel/${hit.permaLink}`;
  const html = await get(url);
  // Next.js RSC yuku: \"itemKey\":\"kpy41_acc1_int_addres\",\"value\":\"www.x.com\" (ters egik cizgiler HTML icinde literal)
  const web = html.match(/kpy41_acc1_int_addres\\?",\\?"value\\?":\\?"([^"\\]+)/)?.[1] ?? null;
  const sektorMetni = html.match(/kpy41_acc2_sektor\\?",\\?"value\\?":\\?"([^"\\]+)/)?.[1] ?? null;
  return { web, sektorMetni: sektorMetni ? temiz(sektorMetni) : null, url };
}

const URL_BMD = 'https://www.birlesmismarkalar.org.tr/markalar';
async function bmd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_BMD));
  const out: Ham[] = [];
  let webYok = 0;
  $('.brand-inner').each((_, el) => {
    const firma = temiz($(el).find('.brand-name').text());
    const web = $(el).attr('href') || temiz($(el).find('.brand-link').text());
    if (!firma) return;
    // NEDEN: BMD yalniz web'i olan markalar icin kullanilir (alan adi = birlestirme anahtari)
    if (!normalizeDomain(web)) { webYok++; return; }
    out.push({ firma, web });
  });
  ctx.log(`${out.length} marka (web'siz ${webYok} atlandi)`);
  return out;
}

const URL_TUBISAD = 'https://www.tubisad.org.tr/tr/uyelik/detay/Uye-Listesi/213/4206/0';
async function tubisad(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_TUBISAD));
  const out: Ham[] = [];
  $('td a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const dom = normalizeDomain(href);
    if (!dom || /tubisad\.org\.tr/i.test(dom)) return;
    // NEDEN: cogu uye yalniz logo (alt bos) → firma adi yerine alan adi yazilir; birlesmede daha iyi ad gelirse degisir
    const firma = temiz($(a).text()) || temiz($(a).find('img').attr('alt')) || dom;
    out.push({ firma, web: href });
  });
  ctx.log(`${out.length} uye`);
  return out;
}

const URL_TESID = 'https://www.tesid.org.tr/uyelerimiz';
async function tesid(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_TESID));
  const out: Ham[] = [];
  $('.boxuye_detay a[href]').each((_, a) => {
    const firma = temiz($(a).text());
    const href = $(a).attr('href') ?? '';
    if (!firma || !normalizeDomain(href)) return;
    out.push({ firma, web: href });
  });
  ctx.log(`${out.length} uye`);
  return out;
}

/**
 * Reklamcilar Dernegi tuzel uyeleri (yaratici / medya / dijital ajans). Tablo satiri: firma | yetkili | adres |
 * telefon | faks | e-posta | web | uyelik | tur. KVKK: YALNIZ firma adi + web + tur okunur; "yetkili" sutunu ve
 * mailto (cogu kisinin kendi adresi) OKUNMAZ — kurumsal adres 07'de firmanin kendi sitesinden bulunur.
 */
const URL_RD = 'https://rd.org.tr/uyeler';
async function rd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_RD));
  const out: Ham[] = [];
  $('tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 8) return;
    const firma = temiz(td.eq(0).text());
    const web = $(tr).find('a.web-icon').attr('href')?.trim() ?? '';
    const tur = temiz(td.last().text());
    if (!firma || !normalizeDomain(web)) return;
    const altsektor = /medya/i.test(tur) ? 'medya-ajansi' : /dijital/i.test(tur) ? 'dijital-ajans' : 'reklam-ajansi';
    out.push({ firma, web, altsektor, not: tur });
  });
  ctx.log(`${out.length} ajans`);
  return out;
}

/** IDA (Iletisim Danismanligi Sirketleri Dernegi) uyeleri: PR ajanslari. Yalniz ad + web; "Yonetici Ortak" OKUNMAZ. */
const URL_IDA = 'https://www.ida.org.tr/ornek-sayfa/uyelerimiz/';
async function ida(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_IDA));
  const out: Ham[] = [];
  $('table').each((_, t) => {
    const firma = temiz($(t).find('td[colspan] strong').first().text());
    const webTd = $(t).find('tr').filter((__, r) => /^web:?$/i.test(temiz($(r).find('td').first().text()))).find('td').eq(1);
    const web = webTd.find('a').attr('href')?.trim() || temiz(webTd.text());
    if (firma && normalizeDomain(web)) out.push({ firma, web });
  });
  ctx.log(`${out.length} PR ajansi`);
  return out;
}

const URL_RVD = 'https://www.rvd.org.tr/uyeler';
/** Logo dosya adindan firma adi: "firma_Ak-Gida_vo" → "Ak Gida", "aktifbank-26042024" → "aktifbank" */
function rvdAd(raw: string): string {
  let s = temiz(raw).replace(/\.(png|jpe?g|gif|webp)$/i, '');
  s = s.replace(/^firma_/i, '').replace(/[-_]?\d{6,8}$/, '').replace(/_[a-z0-9]{2}$/i, '');
  s = s.replace(/[_-]+/g, ' ').replace(/\blogo(su|lar|lari)?\b/gi, '').replace(/\s+\d+$/, '');
  // Bitisik ek: "arzumlogo" → "arzum" (kalan ad en az 3 harf olmali)
  s = s.replace(/^(\S{3,}?)logo(su|lar|lari)?$/i, '$1');
  s = temiz(s);
  if (!s || /^(logolar|rvd)$/i.test(s)) return '';
  return s;
}
async function rvd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_RVD));
  const out: Ham[] = [];
  let tahminli = 0;
  $('ul.member-list li img').each((_, img) => {
    const firma = rvdAd($(img).attr('alt') || $(img).attr('title') || '');
    if (!firma) return;
    // NEDEN: RVD uyeleri her sektorden (Akbank, Ford Otosan, Coca-Cola, Shell...). Ad ipucu varsa
    // TAHMIN olarak (sektorKaynak=unvan) yazilir; yoksa 'diger' kalir — Fortune/KAP'in gercek etiketi
    // birlesmede kazanir. Eskiden varsayilan e-tic/perakende idi ve Shell'e e-ticaret sablonu gidiyordu.
    const tahmin = sektorEsle(firma);
    if (tahmin === 'diger') out.push({ firma });
    else { tahminli++; out.push({ firma, sektor: tahmin, altsektor: altSektorTahmin(firma) || 'reklamveren', sektorKaynak: 'unvan' }); }
  });
  ctx.log(`${out.length} reklamveren (web yok; ${tahminli} ad ipucuyla tahmin, gerisi diger)`);
  return out;
}

const URL_FORTUNE = 'https://www.fortuneturkey.com/wp-admin/admin-ajax.php';
async function fortune(ctx: Ctx): Promise<Ham[]> {
  const html = await get(URL_FORTUNE, {
    method: 'POST',
    body: 'action=fortune500_search&yil=2024&tip=1&tumu=1',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      referer: 'https://www.fortuneturkey.com/fortune-500',
    },
  });
  const $ = cheerio.load(html);
  const out: Ham[] = [];
  const dagilim: Record<string, number> = {};
  $('table.f500firmadetaytb').each((_, t) => {
    const firma = temiz($(t).find('.SirketAdiText').text());
    if (!firma) return;
    const parcalar = ($(t).find('.SehirAdiGoster').html() ?? '')
      .split(/<br\s*\/?>/i)
      .map((p) => temiz(cheerio.load(`<div>${p}</div>`)('div').text()));
    const sehir = parcalar[0] ?? '';
    const sektorMetni = parcalar[1] ?? '';
    let sektor = sektorEsle(sektorMetni);
    // NEDEN: Fortune "Bilgi ve iletisim hizmetleri" hem Koc Sistem'i (teknoloji) hem Turkcell'i (operator)
    // kapsar; unvaninda "ILETISIM HIZMETLERI" gecen operator telekom grubunda kalir
    // Ayni sekilde "Elektronik ve telekomunikasyon" etiketi TURK TELEKOMUNIKASYON / MOBILTEL gibi operatorlere de verilir
    if (sektor === S_ETIC && /^(bilgi ve iletisim|elektronik ve telekomunikasyon)/.test(translit(sektorMetni)) && gucluUnvanEsle(firma).altsektor === 'telekom') sektor = S_TUR;
    dagilim[sektor] = (dagilim[sektor] ?? 0) + 1;
    const href = $(t).closest('a').attr('href');
    out.push({
      firma,
      sehir: sehirBicim(sehir),
      sektor,
      // NEDEN: Fortune'un kendi sektor etiketi korunur (kullaniciya "neden bu grup" gorunur)
      altsektor: sektorMetni || undefined,
      sektorKaynak: 'etiket',
      url: href ? `https://www.fortuneturkey.com${href}` : undefined,
    });
  });
  ctx.log(`${out.length} firma · ${Object.entries(dagilim).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  return out;
}

/** Wikipedia parse API: sayfa adi → wikitext */
const wikiUrl = (sayfa: string) => `https://tr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(sayfa)}&prop=wikitext&format=json`;
const WIKI_HAVAYOLU = 'Türkiye_merkezli_havayolu_şirketleri_listesi';
const WIKI_MVNO = "Türkiye'deki_mobil_sanal_ağ_operatörleri_listesi";
/** Wikitext tablolarinin ilk hucresi: "|[[Pegasus Hava Yollari|Pegasus]]" → "Pegasus" */
function wikiHucreAd(cell: string): string {
  let s = cell.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/'{2,}/g, '');
  s = temiz(s.replace(/<[^>]+>/g, ''));
  if (!s || /^(dosya|file|image):/i.test(s) || s.length < 2) return '';
  return s;
}
/**
 * Wikitext tablolarindan ilk sutun (ad). sadeceIlkTablo: MVNO sayfasinda ikinci tablo
 * "Feshedilen ya da durumu belli olmayan operatorler" — hedef degil, atlanir.
 */
function wikiKaynak(sayfa: string, etiket: string, sadeceIlkTablo: boolean) {
  return async (ctx: Ctx): Promise<Ham[]> => {
    const data = await getJson<{ parse?: { wikitext?: { '*': string } } }>(wikiUrl(sayfa));
    const wt = data.parse?.wikitext?.['*'];
    if (!wt) throw new Error('wikitext yok');
    const out: Ham[] = [];
    let tabloda = false;
    let satirBasi = false;
    let tabloNo = 0;
    for (const raw of wt.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('{|')) { tabloda = true; satirBasi = false; tabloNo++; continue; }
      if (line.startsWith('|}')) { tabloda = false; if (sadeceIlkTablo) break; continue; }
      if (!tabloda) continue;
      if (line.startsWith('|-')) { satirBasi = true; continue; }
      if (line.startsWith('!') || line.startsWith('|+')) { satirBasi = false; continue; }
      if (satirBasi && line.startsWith('|')) {
        satirBasi = false;
        const firma = wikiHucreAd(line.slice(1).split('||')[0]);
        if (firma) out.push({ firma });
      }
    }
    ctx.log(`${out.length} ${etiket} (${tabloNo} tablo, web yok)`);
    return out;
  };
}

const URL_TUROB = 'https://www.turob.com/tr/uyelerimiz/category/5-yildizli-oteller';
/** Kuresel zincir alan adlari: Turkiye pazarlama karar vericisinin e-posta alani DEGIL (03-desen TR alt alan adi arar) */
const GLOBAL_ZINCIR = [
  'hilton.com', 'marriott.com', 'ihg.com', 'accor.com', 'radissonhotels.com', 'hyatt.com', 'wyndhamhotels.com',
  'kempinski.com', 'fourseasons.com', 'mandarinoriental.com', 'shangri-la.com', 'swissotel.com', 'movenpick.com',
  'rotana.com', 'barcelo.com', 'melia.com', 'sheraton.com', 'fairmont.com', 'raffles.com', 'jumeirah.com', 'sofitel.com',
  'pullmanhotels.com', 'novotel.com', 'ibis.com', 'mercure.com', 'bestwestern.com', 'ritzcarlton.com', 'waldorfastoria.com',
  'conradhotels.com', 'doubletree.com', 'crowneplaza.com', 'holidayinn.com', 'ramada.com', 'nh-hotels.com', 'steigenberger.com',
  'wyndham.com', 'ihg.com.tr',
];
const globalZincir = (dom: string) => GLOBAL_ZINCIR.some((g) => dom === g || dom.endsWith('.' + g));
async function turob(ctx: Ctx): Promise<Ham[]> {
  const oteller: Array<{ firma: string; web?: string }> = [];
  const parse = (html: string) => {
    const $ = cheerio.load(html);
    let n = 0;
    // NEDEN: otel adi + web modal icinde (liste kartinda yalniz ad var)
    $('.modal').each((_, m) => {
      const firma = temiz($(m).find('.modal-title').first().text());
      if (!firma) return;
      // NEDEN: bazi oteller web yerine kisaltilmis link (bit.ly) yazmis — alan adi olarak anlamsiz, atlanir
      const web = $(m).find('.HotelProperties a[target="_blank"]')
        .filter((__, a) => /^https?:/i.test($(a).attr('href') ?? '') && !/bit\.ly|goo\.gl|tinyurl\.com|t\.co\//i.test($(a).attr('href') ?? ''))
        .first().attr('href');
      oteller.push({ firma, web });
      n++;
    });
    const startlar = [...html.matchAll(/5-yildizli-oteller\?start=(\d+)/g)].map((m) => Number(m[1]));
    return { n, maxStart: startlar.length ? Math.max(...startlar) : 0 };
  };
  const ilk = parse(await get(URL_TUROB));
  ctx.log(`s1: ${ilk.n} (son start=${ilk.maxStart})`);
  // NEDEN: sayfalama ?start=12,24,... (12/sayfa); ust sinir 15 sayfa — sonsuz dongu korumasi
  const adim = 12;
  for (let start = adim, sayfa = 2; start <= ilk.maxStart && sayfa <= 15; start += adim, sayfa++) {
    if (ctx.limit !== null && oteller.length >= ctx.limit) break;
    try {
      const r = parse(await get(`${URL_TUROB}?start=${start}`));
      ctx.log(`s${sayfa}: ${r.n}`);
      if (r.n === 0) break;
    } catch (e) {
      ctx.log(`UYARI sayfa ${sayfa} atlandi: ${(e as Error).message}`);
    }
  }
  // NEDEN: zincir oteller ayni alan adinda (hilton.com.tr → 5 otel) — tek satira inerken ilk otelin
  // adi kalmasin: firma = zincir etiketi, oteller not'ta; kuresel marka alan adi ayrica isaretlenir
  const byDom = new Map<string, Array<{ firma: string; web?: string }>>();
  const out: Ham[] = [];
  for (const o of oteller) {
    const dom = normalizeDomain(o.web);
    if (!dom) { out.push({ firma: o.firma }); continue; }
    const list = byDom.get(dom) ?? [];
    list.push(o);
    byDom.set(dom, list);
  }
  let zincir = 0;
  for (const [dom, list] of byDom) {
    const global = globalZincir(dom);
    if (list.length === 1) {
      out.push({ firma: list[0].firma, web: dom, altsektor: global ? 'otel-zincir-global' : undefined });
      continue;
    }
    zincir++;
    out.push({
      firma: `${alanEtiket(dom)} otelleri (${list.length})`,
      web: dom,
      // 'otel-zinciri' = seed-firmalar.csv'deki yazim (Dedeman, Divan, Barut ile ayni etiket)
      altsektor: global ? 'otel-zincir-global' : 'otel-zinciri',
      not: `oteller: ${list.map((o) => o.firma).join('|')}`,
    });
  }
  ctx.log(`${oteller.length} otel → ${out.length} satir (${zincir} zincir alan adi birlesti)`);
  return out;
}

const URL_OSD = 'https://www.osd.org.tr/osd-uyeleri';
const SOSYAL_RE = /osd\.org\.tr|facebook|twitter|x\.com|linkedin|instagram|youtube|google|mevzuat\.gov|europa\.eu|w3\.org|schema\.org|fonts\./i;
async function osd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_OSD));
  let slugs = [...new Set($('a[href^="/osd-uyeleri/"]').map((_, a) => $(a).attr('href') ?? '').get().filter(Boolean))];
  if (ctx.limit !== null) slugs = slugs.slice(0, ctx.limit);
  const out: Ham[] = [];
  for (const slug of slugs) {
    const url = `https://www.osd.org.tr${slug}`;
    try {
      // NEDEN: liste sayfasinda yalniz logo var (alt bos); ad + web uye detay sayfasindan
      const $d = cheerio.load(await get(url));
      const firma = temiz($d('h1').first().text()) || temiz(slug.split('/').pop()?.replace(/-/g, ' ') ?? '');
      const web = $d('a[href^="http"]').filter((_, a) => !SOSYAL_RE.test($d(a).attr('href') ?? '')).first().attr('href');
      if (firma) out.push({ firma, web, url });
    } catch (e) {
      ctx.log(`UYARI ${slug} atlandi: ${(e as Error).message}`);
    }
  }
  ctx.log(`${out.length}/${slugs.length} uye`);
  return out;
}

/** Unvandaki genel kelimeler — alan adi/unvan uyumu bakilirken sayilmaz */
const UNVAN_GENEL = new Set([
  'otomotiv', 'motorlu', 'araclar', 'vasitalar', 'pazarlama', 'ticaret', 'sanayi', 'ithalat', 'ihracat', 'dagitim',
  'servis', 'hizmet', 'hizmetleri', 'teknoloji', 'turkiye', 'turkey', 'otomobil', 'fabrikasi', 'satis', 'imal', 'oto',
  'grup', 'group', 'elektrikli', 'arac', 'motor', 'motors', 'auto', 'cars', 'turk', 'insaat', 'tekstil', 'nakliyat',
]);
/**
 * Web alan adi unvanla uyumlu mu? (BORUSAN OTOMOTIV → bmw.com.tr: hayir → marka vitrini, calisanlar
 * @borusanotomotiv.com). null = unvanda ayirt edici kelime yok, karar verilemez.
 */
function webAdUyumlu(firma: string, dom: string): boolean | null {
  const tokens = adAnahtar(firma).split(' ').filter((t) => t.length >= 4 && !UNVAN_GENEL.has(t));
  if (tokens.length === 0) return null;
  const d = dom.replace(/[^a-z0-9]/g, '');
  return tokens.some((t) => d.includes(t));
}

// ODMD "sortial" ucu: marka basina satir; ayni distributor birden cok markada → UNVANLA tekillesir
const URL_ODMD = 'https://www.odmd.org.tr/web_2837_1/sortial.aspx?sp_table=Tk_2837_Distributors&sp_primary=distributor_id&sp_fields=,name,telephone,fax,web,address&sp_language=0&sp_table_extra';
async function odmd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_ODMD));
  const byName = new Map<string, Ham & { webler: string[] }>();
  let satir = 0;
  $('#TableMembers tr[onclick]').each((_, tr) => {
    const onclick = $(tr).attr('onclick') ?? '';
    const web = onclick.match(/window\.open\('([^']+)'/)?.[1];
    const firma = temiz($(tr).find('b').first().text());
    if (!firma) return;
    satir++;
    // Hucre metni: unvan / tel-faks / adres (son satir)
    const satirlar = ($(tr).find('td').last().html() ?? '').split(/<br\s*\/?>/i).map((p) => temiz(cheerio.load(`<div>${p}</div>`)('div').text())).filter(Boolean);
    const adres = satirlar.length > 1 ? satirlar[satirlar.length - 1] : '';
    const sehir = sehirFromAdres(adres);
    const dom = normalizeDomain(web) ?? '';
    const key = adAnahtar(firma);
    const cur = byName.get(key);
    if (!cur) {
      byName.set(key, { firma, web: dom || undefined, sehir, altsektor: 'otomotiv-distributor', webler: dom ? [dom] : [] });
      return;
    }
    // NEDEN: ayni unvan ikinci markada → yeni satir acma; web icin unvanla uyumlu (kurumsal) siteyi tercih et
    if (dom && !cur.webler.includes(dom)) {
      cur.webler.push(dom);
      if (!cur.web) cur.web = dom;
      else if (webAdUyumlu(firma, dom) === true && webAdUyumlu(firma, cur.web) !== true) cur.web = dom;
    }
    if (!cur.sehir && sehir) cur.sehir = sehir;
  });
  const out: Ham[] = [];
  let markaSitesi = 0;
  for (const { webler, ...ham } of byName.values()) {
    if (webler.length > 0) ham.not = `marka siteleri: ${webler.join('|')}`;
    // NEDEN: web marka vitriniyse 03-desen orada desen bulamaz → isaret; TR kurumsal alan adi aranir.
    // Isaret not'a da yazilir: birlesmede (Fortune satiri once geldiyse) altsektor korunmaz, not korunur.
    if (ham.web && webAdUyumlu(ham.firma, ham.web) === false) {
      ham.altsektor = 'otomotiv-distributor:marka-sitesi';
      ham.not = `${ham.not ? `${ham.not}; ` : ''}web marka sitesi olabilir`;
      markaSitesi++;
    }
    out.push(ham);
  }
  ctx.log(`${satir} marka satiri → ${out.length} distributor (${markaSitesi} web'i marka sitesi olabilir)`);
  return out;
}

const URL_OYDER = 'https://www.oyder-tr.org/uyelerimiz';
/** Plan: 800 bayiden "marka bazli ilk 100" (her markadan sirayla birer bayi) */
const OYDER_TOPLAM = 100;
async function oyder(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_OYDER));
  // KVKK: 3. sutun "Yetkili" kisi adidir — bu script'te OKUNMAZ ve LOGLANMAZ (isimli veri Faz 2 kisiler.csv rejimine ait)
  const markaBayi = new Map<string, Ham[]>();
  let toplam = 0;
  $('#UyelerTable tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 2) return; // baslik satiri (th)
    const firma = temiz(td.eq(1).text());
    if (!firma) return;
    const markalar = temiz(td.eq(0).text()).split(',').map((m) => temiz(m)).filter(Boolean);
    const ilk = markalar[0] ?? 'DİĞER';
    toplam++;
    const list = markaBayi.get(ilk) ?? [];
    list.push({ firma, altsektor: 'otomotiv-bayi', not: markalar.length ? `marka: ${markalar.join('|')}` : undefined });
    markaBayi.set(ilk, list);
  });
  const tavan = ctx.limit !== null ? Math.min(ctx.limit, OYDER_TOPLAM) : OYDER_TOPLAM;
  const out: Ham[] = [];
  const kuyruklar = [...markaBayi.values()];
  // NEDEN round-robin: tek markanin (Renault/Fiat) 100 bayisi yerine her markadan temsil
  for (let tur = 0; out.length < tavan; tur++) {
    let eklendi = false;
    for (const q of kuyruklar) {
      if (tur < q.length && out.length < tavan) { out.push(q[tur]); eklendi = true; }
    }
    if (!eklendi) break;
  }
  ctx.log(`${toplam} bayi / ${markaBayi.size} marka → ${out.length} (marka bazli ilk ${OYDER_TOPLAM}, web yok)`);
  return out;
}

// ─── Dernek uye listeleri (27.10.2026 dalgasi) ──────────────────────────────
// KVKK: hepsinde YALNIZ firma/marka adi + firmanin kendi web adresi (+ kategori metni) okunur.
// Kisi adi, kisisel e-posta, telefon OKUNMAZ (TGSD "Adi Soyadi" ve IAB "name" alanlari dahil).

/** Sosyal ag / genel platform alan adlari — "firma sitesi" sayilmaz */
const SOSYAL_GENEL_RE = /facebook\.|twitter\.|(^|\.)x\.com|linkedin\.|instagram\.|youtube\.|youtu\.be|tiktok\.|pinterest\.|flickr\.|whatsapp\.|wa\.me|t\.me|google\.|goo\.gl|bit\.ly|apple\.com|play\.google/i;

/**
 * Ayni kaynakta ayni alan adi bir kez (carousel/tekrarli liste); web'siz kayit ada gore tekillesir.
 * NEDEN sosyal temizligi: TURYID'de 12 uyenin "sitesi" instagram.com — alan adi birlestirme anahtari
 * oldugu icin hepsi tek satira inerdi; bu kayitlar web'siz yazilir (03-desen alan adini arar).
 */
function tekil(list: Ham[]): Ham[] {
  const seen = new Set<string>();
  return list.map((h) => (SOSYAL_GENEL_RE.test(normalizeDomain(h.web) ?? '') ? { ...h, web: undefined } : h)).filter((h) => {
    const key = normalizeDomain(h.web) ?? `ad:${adAnahtar(h.firma)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tamami kucuk harf olan adi kelime basi buyuk yap ("7 mehmet restaurant" → "7 Mehmet Restaurant") */
function kelimeBasi(s: string): string {
  if (s !== s.toLocaleLowerCase('tr-TR')) return s;
  return s.replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('tr-TR'));
}

/** Logo dosya adi / alt metni artiklarini temizle: uzanti, "-150x150", "logo", "-1" soneki, tire/alt cizgi */
function logoAd(raw: string): string {
  let s = temiz(raw);
  try { s = decodeURIComponent(s); } catch { /* bozuk kodlama: oldugu gibi */ }
  s = s.replace(/\.(png|jpe?g|gif|webp|svg)$/i, '').replace(/-\d{2,4}x\d{2,4}$/i, '');
  s = s.replace(/[_-]+/g, ' ').replace(/\blogo(su|lar|lari)?\b/gi, ' ').replace(/\s+\d{1,2}$/, '');
  return temiz(s);
}

const URL_GYODER = 'https://www.gyoder.org.tr/uyelerimiz';
/** GYODER (Gayrimenkul ve Gayrimenkul Yatirim Ortakligi Dernegi): kart = site linki, ad span.companyName */
async function gyoder(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_GYODER));
  const out: Ham[] = [];
  $('a.about-us-annual-report-card').each((_, a) => {
    const web = $(a).attr('href')?.trim() ?? '';
    const firma = temiz($(a).find('span.companyName').text()) || temiz($(a).find('img').attr('alt'));
    if (firma && normalizeDomain(web) && !/gyoder\.org\.tr/i.test(web)) out.push({ firma, web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} gayrimenkul uyesi`);
  return t;
}

const URL_MOSDER = 'https://www.mosder.org.tr/uyelerimiz';
/** MOSDER (Mobilya Dernegi): her uye div.filter-item; site linki + logo alt metni = marka adi */
async function mosder(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_MOSDER));
  const out: Ham[] = [];
  $('div.filter-item').each((_, el) => {
    const a = $(el).find('a[target="_blank"]').first();
    const web = a.attr('href')?.trim() ?? '';
    const firma = temiz($(el).find('img').attr('alt')) || temiz($(el).find('h3').text());
    if (firma && normalizeDomain(web)) out.push({ firma, web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} mobilya markasi`);
  return t;
}

const URL_IMOS = 'https://www.imos.org.tr/uyelerimiz/';
/** IMOS (Inegol Mobilya Sanayicileri Dernegi): title niteligi = marka adi, ic link = site */
async function imos(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_IMOS));
  const out: Ham[] = [];
  $('div.wpwax-lsu-item-inner[title]').each((_, el) => {
    const firma = temiz($(el).attr('title'));
    const web = $(el).find('a[href]').first().attr('href')?.trim() ?? '';
    if (firma && normalizeDomain(web) && !/imos\.org\.tr/i.test(web)) out.push({ firma, web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} mobilya uyesi`);
  return t;
}

const URL_TGSD = 'https://tgsd.org.tr/uyelerimiz/';
/**
 * TGSD (Turkiye Giyim Sanayicileri Dernegi): tablo = logo | Adi Soyadi | Firma | Web Sitesi.
 * KVKK: 2. sutun KISI ADIDIR — OKUNMAZ; yalniz firma + web sutunu.
 */
async function tgsd(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_TGSD));
  const out: Ham[] = [];
  $('table tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 4) return; // baslik (th) ya da eksik satir
    const firma = temiz(td.eq(2).text());
    const web = td.eq(3).find('a').attr('href')?.trim() || temiz(td.eq(3).text());
    if (firma && normalizeDomain(web)) out.push({ firma, web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} hazir giyim firmasi`);
  return t;
}

const URL_TURYID = 'https://turyid.org/uye-listesi/';
/** TURYID (Turkiye Restoran ve Eglence Yatirimcilari Dernegi): a.member-card; ad data-member-name ya da logo alt */
async function turyid(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_TURYID));
  const out: Ham[] = [];
  $('a.member-card').each((_, a) => {
    const href = $(a).attr('href')?.trim() ?? '';
    const dom = normalizeDomain(href);
    if (dom && /turyid\.org/i.test(dom)) return;
    // NEDEN: ad cogu zaman logo dosya adindan uretilmis ("baba kebap logo", "life-group-entertainment-1")
    let firma = logoAd($(a).attr('data-member-name') || $(a).find('img').attr('alt') || '');
    if ((!firma || /^\d+$/.test(firma)) && dom) firma = alanEtiket(dom);
    if (!firma) return;
    // 31 uyede href="#" (site yok) — ad yine alinir, web bos kalir
    out.push({ firma: kelimeBasi(firma), web: dom ? href : undefined });
  });
  const t = tekil(out);
  ctx.log(`${t.length} restoran/zincir (web'siz ${t.filter((h) => !h.web).length})`);
  return t;
}

/** AYD (Alisveris Merkezleri ve Perakendeciler Dernegi): li.membersPage > a; ad title niteligi, bossa alan adi etiketi */
function aydKaynak(url: string, etiket: string) {
  return async (ctx: Ctx): Promise<Ham[]> => {
    const $ = cheerio.load(await get(url));
    const out: Ham[] = [];
    $('li.membersPage > a[href]').each((_, a) => {
      const web = $(a).attr('href')?.trim() ?? '';
      const dom = normalizeDomain(web);
      if (!dom || /ayd\.org\.tr/i.test(dom)) return;
      out.push({ firma: temiz($(a).attr('title')) || alanEtiket(dom), web });
    });
    const t = tekil(out);
    ctx.log(`${t.length} ${etiket}`);
    return t;
  };
}
const URL_AYD_KURUMSAL = 'https://www.ayd.org.tr/kurumsal-uyeler';
const URL_AYD_FAALIYET = 'https://www.ayd.org.tr/faaliyet-uyeleri';

const URL_ZINCIR = 'https://www.zincirmagazalar.org/?page_id=131';
/**
 * Zincir Magazalar Dernegi uyeleri: Elementor gorsel widget'lari (logo + site linki). Ad metin olarak yok;
 * logo dosya adi cogu zaman unvandir ("Boyner-Buyuk-Magazacilik-A.S..jpg"). Dosya adi "logo" iceriyor ya da
 * kucuk harfle basliyorsa (atasun.jpg, flo_logo-01) alan adi etiketi kullanilir. Ust banner slider'i
 * (sponsor reklamlari, metaslider) secilmez.
 */
async function zincir(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_ZINCIR));
  const out: Ham[] = [];
  $('.elementor-widget-image').each((_, w) => {
    const web = $(w).find('a[href]').first().attr('href')?.trim() ?? '';
    const dom = normalizeDomain(web);
    if (!dom || /zincirmagazalar\.org/i.test(dom)) return;
    let dosya = ($(w).find('img').attr('src') ?? '').split('/').pop() ?? '';
    try { dosya = decodeURIComponent(dosya); } catch { /* oldugu gibi */ }
    dosya = dosya.replace(/\.(png|jpe?g|gif|webp|svg)$/i, '').replace(/-\d{2,4}x\d{2,4}$/i, '');
    const ad = temiz(dosya.replace(/-/g, ' '));
    const iyi = ad.length >= 2 && !/logo/i.test(ad) && /^\p{Lu}/u.test(ad);
    out.push({ firma: iyi ? ad : alanEtiket(dom), web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} zincir magaza/uye`);
  return t;
}

const URL_MEYED = 'https://meyed.org.tr/uyelerimiz/';
/** MEYED (Meyve Suyu Endustrisi Dernegi): <p><strong>UNVAN</strong><br><a>site</a></p> */
async function meyed(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_MEYED));
  const out: Ham[] = [];
  $('p').each((_, p) => {
    const firma = temiz($(p).children('strong').first().text());
    const web = $(p).find('a[href]').first().attr('href')?.trim() ?? '';
    if (firma && normalizeDomain(web) && !/meyed\.org\.tr/i.test(web)) out.push({ firma, web });
  });
  const t = tekil(out);
  ctx.log(`${t.length} icecek/meyve suyu firmasi`);
  return t;
}

const URL_YOK_VAKIF = 'https://www.yok.gov.tr/university?type=2';
/** YOK vakif universiteleri: her kart div.university-card-uni (h3 = ad, data-city = sehir, "Web Sitesi" satiri = site) */
async function yokVakif(ctx: Ctx): Promise<Ham[]> {
  const $ = cheerio.load(await get(URL_YOK_VAKIF));
  const out: Ham[] = [];
  $('div.university-card-uni').each((_, card) => {
    const firma = temiz($(card).find('h3').first().text()) || temiz($(card).attr('data-name'));
    const satir = $(card).find('.detail-item-uni').filter((__, d) => /web sitesi/i.test($(d).find('.detail-label-uni').text()));
    const web = satir.find('a[href]').first().attr('href')?.trim() || temiz(satir.find('.detail-value-uni').text());
    if (!firma) return;
    out.push({ firma, web: normalizeDomain(web) ? web : undefined, sehir: sehirBicim($(card).attr('data-city') ?? '') });
  });
  const t = tekil(out);
  ctx.log(`${t.length} vakif universitesi (web'li ${t.filter((h) => h.web).length})`);
  return t;
}

/**
 * IAB Turkiye uyeleri: sayfa ilk 18'i satir ici JS'te verir ama kategori bos; admin-ajax "load_more_member"
 * ucu kategori dahil 18'erli sayfalar dondurur. NEDEN offset 18'den: canli denemede offset=0 ve 18 ayni ilk
 * 18'i, 36 sonraki 18'i dondurdu (offset = sayfanin BITIS indeksi). KVKK: "name" (yetkili) ve "phone" OKUNMAZ;
 * "explain" yalniz hukuki unvan gibi gorunuyorsa not'a yazilir.
 */
const URL_IAB = 'https://iabtr.org/iab-uyeleri/';
const URL_IAB_AJAX = 'https://iabtr.org/wp-admin/admin-ajax.php';
const IAB_ADIM = 18;
const IAB_MAX_ISTEK = 30;
const UNVAN_RE = /\b(a\.?\s?ş|ltd|şti|sti|anonim|limited|inc|llc|gmbh|b\.v|s\.a|corp|holding|şirketi|sirketi)\b/i;
interface IabUye { title?: string; url?: string; category?: string; explain?: string }
async function iab(ctx: Ctx): Promise<Ham[]> {
  const out: Ham[] = [];
  let toplam = 0;
  for (let i = 0, offset = IAB_ADIM; i < IAB_MAX_ISTEK; i++, offset += IAB_ADIM) {
    if (ctx.limit !== null && out.length >= ctx.limit) break;
    const body = new URLSearchParams({ action: 'load_more_member', offset: String(offset), search: '', category: 'Tümü', letter: 'Sıralama' }).toString();
    const text = await get(URL_IAB_AJAX, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', referer: URL_IAB },
    });
    const j = JSON.parse(text) as { data?: IabUye[]; count?: number };
    const data = j.data ?? [];
    if (j.count) toplam = j.count;
    if (data.length === 0) break;
    for (const u of data) {
      const firma = temiz(u.title);
      const web = temiz(u.url);
      if (!firma) continue;
      const kat = temiz(u.category);
      const unvan = UNVAN_RE.test(temiz(u.explain)) ? temiz(u.explain) : '';
      const not = [kat && `IAB: ${kat}`, unvan].filter(Boolean).join('; ') || undefined;
      if (/^ajans$/i.test(kat)) { out.push({ firma, web, sektor: 'ajans', altsektor: 'dijital-ajans', sektorKaynak: 'kaynak', not }); continue; }
      // NEDEN: reklamveren her sektorden (Akbank, A101...) — RVD gibi guclu unvan ipucu varsa TAHMIN, yoksa diger
      const g = gucluUnvanEsle(unvan || firma);
      const altsektor = !kat || /^reklamveren$/i.test(kat) ? 'reklamveren' : /^di[gğ]er$/i.test(kat) ? 'iab-diger' : translit(kat).replace(/\s+/g, '-');
      if (g.sektor !== 'diger') out.push({ firma, web, sektor: g.sektor, altsektor: g.altsektor, sektorKaynak: 'unvan', not });
      else out.push({ firma, web, altsektor, not });
    }
    if (toplam && offset >= toplam) break;
  }
  const t = tekil(out);
  ctx.log(`${t.length}/${toplam || '?'} uye (ajans ${t.filter((h) => h.sektor === 'ajans').length})`);
  return t;
}

/**
 * UFRAD (Ulusal Franchising Dernegi): liste sayfalarinda yalniz marka adi + detay linki; site detay sayfasindaki
 * "Internet Sitesi" kutusunda. Kutu yoksa icerikteki ilk dis link (sosyal/kurum degil, adla celismeyen) alinir.
 * Destekci uyeler (hukuk/danismanlik) ayri altsektorle isaretlenir.
 */
const UFRAD_LISTELER: Array<{ url: string; maxSayfa: number; altsektor: string }> = [
  { url: 'https://ufrad.org/asil-uyeler/', maxSayfa: 8, altsektor: 'franchise' },
  { url: 'https://ufrad.org/destekci-uyeler/', maxSayfa: 3, altsektor: 'franchise-destekci' },
  { url: 'https://ufrad.org/aday-uyeler/', maxSayfa: 2, altsektor: 'franchise' },
];
const UFRAD_MAX_DETAY = 200;
const UFRAD_DISLA_RE = /ufrad\.org|armiya\.com|ito\.org\.tr|iso\.org\.tr|deik\.org\.tr|worldfranchisecouncil|franchise-apfc|eff-franchise/i;
async function ufrad(ctx: Ctx): Promise<Ham[]> {
  const markalar: Array<{ firma: string; detay: string; altsektor: string }> = [];
  const gorulen = new Set<string>();
  for (const l of UFRAD_LISTELER) {
    for (let s = 1; s <= l.maxSayfa; s++) {
      const url = s === 1 ? l.url : `${l.url}page/${s}/`;
      let html: string;
      try {
        html = await get(url);
      } catch (e) {
        // NEDEN: son sayfadan sonrasi 404 doner — sayfalamanin dogal sonu
        if (s === 1) ctx.log(`UYARI ${url} atlandi: ${(e as Error).message}`);
        break;
      }
      const $ = cheerio.load(html);
      let yeni = 0;
      $('a.gyan-portfolio-title-link').each((_, a) => {
        const detay = $(a).attr('href')?.trim() ?? '';
        const firma = temiz($(a).text());
        if (!firma || !detay || gorulen.has(detay)) return;
        gorulen.add(detay);
        markalar.push({ firma, detay, altsektor: l.altsektor });
        yeni++;
      });
      if (yeni === 0) break;
    }
  }
  ctx.log(`${markalar.length} marka listelendi`);
  const tavan = Math.min(UFRAD_MAX_DETAY, ctx.limit ?? UFRAD_MAX_DETAY);
  const out: Ham[] = [];
  let webYok = 0;
  for (const m of markalar.slice(0, tavan)) {
    let web: string | undefined;
    try {
      const $ = cheerio.load(await get(m.detay));
      const kutu = $('.gyan-info-box').filter((_, b) => /internet sitesi|web sitesi/i.test(translit($(b).find('.gyan-infobox-title').text())));
      web = kutu.find('a[href^="http"]').first().attr('href')?.trim();
      if (!normalizeDomain(web)) {
        const aday = $('#content a[href^="http"]')
          .filter((_, a) => $(a).closest('footer, nav, .menu-item, header').length === 0)
          .map((_, a) => $(a).attr('href') ?? '').get()
          .find((h) => { const d = normalizeDomain(h); return !!d && !UFRAD_DISLA_RE.test(d) && !SOSYAL_GENEL_RE.test(d) && webAdUyumlu(m.firma, d) !== false; });
        web = aday;
      }
    } catch (e) {
      ctx.log(`UYARI ${m.firma} detay atlandi: ${(e as Error).message}`);
    }
    if (!normalizeDomain(web)) { webYok++; web = undefined; }
    out.push({ firma: m.firma, web, altsektor: m.altsektor, url: m.detay });
  }
  const t = tekil(out);
  ctx.log(`${t.length} marka (web'siz ${webYok})`);
  return t;
}

// ─── JS-only kaynaklar (--via openclaw) ─────────────────────────────────────
// NEDEN: ETID uye sayfasi WordPress + JS ("Yukleniyor" yer tutucusu, statik HTML'de 0 uye);
// BTK yeni sitesi Next.js SPA. Statik fetch ise yaramaz; OpenClaw tarayicida salt-okunur evaluate.
// Secici bilgisi tarayici disinda dogrulanamadi → cikarim genel (dis baglanti + logo alt metni /
// tablo satirlari); 0 sonuc donerse "parse 0 sonuc" uyarisi + cikis kodu 2.

const URL_ETID = 'https://etid.org.tr/uyelerimiz/';
const ETID_FN = `() => {
  const kotu = /etid\\.org\\.tr|facebook|twitter|x\\.com|instagram|linkedin|youtube|wp-content|google|whatsapp|mailto:|tel:/i;
  const out = []; const seen = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href || '';
    if (!/^https?:\\/\\//.test(href) || kotu.test(href)) return;
    const img = a.querySelector('img');
    const ad = ((a.textContent || '').replace(/\\s+/g, ' ').trim()) || (img ? (img.alt || img.title || '') : '').trim();
    const key = href.toLowerCase().replace(/\\/+$/, '');
    if (seen.has(key)) return; seen.add(key);
    out.push({ ad, web: href });
  });
  document.querySelectorAll('img[alt]').forEach((img) => {
    const ad = (img.alt || '').trim();
    if (ad.length < 2 || /^(etid|yukleniyor|yükleniyor|logo)$/i.test(ad) || img.closest('a[href]')) return;
    out.push({ ad, web: '' });
  });
  return { baslik: document.title, uyeler: out };
}`;
async function etid(ctx: Ctx): Promise<Ham[]> {
  const r = await openclawOku<{ baslik?: string; uyeler?: Array<{ ad: string; web: string }> }>(URL_ETID, ETID_FN);
  if (!r) throw new Error('evaluate bos dondu (tarayici acilamadi?)');
  const out: Ham[] = [];
  for (const u of r.uyeler ?? []) {
    const dom = normalizeDomain(u.web);
    const firma = temiz(u.ad) || dom || '';
    if (!firma) continue;
    out.push({ firma, web: dom ?? undefined });
  }
  ctx.log(`${out.length} uye (sayfa: ${temiz(r.baslik)})`);
  return out;
}

// BTK isletmeci listesi: yeni SPA'da liste URL'si sitemap'te yok (eski /isletmeciler 404) —
// yetkilendirme sayfasindaki tablo(lar) okunur; unvan gibi gorunen hucre alinir. URL dogrulanmadi.
const URL_BTK = 'https://www.btk.gov.tr/yetkilendirme';
const BTK_FN = `() => {
  const rows = [];
  document.querySelectorAll('table tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean);
    if (cells.length) rows.push(cells.slice(0, 6));
  });
  return { baslik: document.title, rows };
}`;
async function btk(ctx: Ctx): Promise<Ham[]> {
  const r = await openclawOku<{ baslik?: string; rows?: string[][] }>(URL_BTK, BTK_FN);
  if (!r) throw new Error('evaluate bos dondu (tarayici acilamadi?)');
  const out: Ham[] = [];
  for (const cells of r.rows ?? []) {
    const unvan = cells.find((c) => /A\.?\s?Ş|LTD|ŞTİ|STI|SAN\.|TİC\.|ANONİM|LİMİTED/i.test(c)) ?? '';
    if (!unvan) continue;
    out.push({ firma: unvan });
  }
  ctx.log(`${out.length} isletmeci (sayfa: ${temiz(r.baslik)}; tablo satiri ${r.rows?.length ?? 0})`);
  return out;
}

const SEED_FILE = path.join(PROSPECT_DIR, 'seed-firmalar.csv');
async function seed(ctx: Ctx): Promise<Ham[]> {
  const rows = readCsv(SEED_FILE);
  const out: Ham[] = [];
  for (const r of rows) {
    if (!r.firma) continue;
    const sektor = sektorOku(r.sektor);
    if (sektor === 'diger') ctx.log(`UYARI bilinmeyen sektor "${r.sektor}" (${r.firma}) → diger`);
    out.push({ firma: r.firma, sektor, altsektor: r.altsektor, web: r.web, sektorKaynak: 'seed', not: r.not });
  }
  ctx.log(`${out.length} tohum`);
  return out;
}

/**
 * Sira onemli: seed once (sektor onceligi), sonra dernek/otorite listeleri, sonra Fortune (gercek etiket),
 * RVD en sona yakin (yalniz ad tahmini; Fortune/KAP etiketi kazansin), sonra web'siz listeler.
 */
const KAYNAKLAR: Kaynak[] = [
  { ad: 'seed', sektor: 'diger', altsektor: '', url: 'seed-firmalar.csv', run: seed },
  { ad: 'tbb', sektor: S_FIN, altsektor: 'banka', url: URL_TBB, run: tbb },
  { ad: 'seddk', sektor: S_FIN, altsektor: 'sigorta', url: URL_SEDDK, run: seddk },
  { ad: 'todeb', sektor: S_FIN, altsektor: 'odeme-epara', url: TODEB_SAYFALAR[0].url, run: todeb },
  { ad: 'fkb', sektor: S_FIN, altsektor: 'leasing-faktoring', url: URL_FKB, run: fkb },
  { ad: 'kap-yk', sektor: S_FIN, altsektor: 'yatirim-kurulusu', url: 'https://www.kap.org.tr/tr/api/company/items/YK/A', run: kapKaynak('YK', 'yatirim-kurulusu') },
  { ad: 'kap-pys', sektor: S_FIN, altsektor: 'portfoy-yonetimi', url: 'https://www.kap.org.tr/tr/api/company/items/PYS/A', run: kapKaynak('PYS', 'portfoy-yonetimi') },
  { ad: 'kap-bdk', sektor: S_FIN, altsektor: 'bagimsiz-denetim', url: 'https://www.kap.org.tr/tr/api/company/items/BDK/A', run: kapKaynak('BDK', 'bagimsiz-denetim') },
  { ad: 'kap-igs', sektor: 'diger', altsektor: '', url: 'https://www.kap.org.tr/tr/api/company/items/IGS/A', run: kapKaynak('IGS', '') },
  { ad: 'bmd', sektor: S_ETIC, altsektor: 'marka-perakende', url: URL_BMD, run: bmd },
  { ad: 'tubisad', sektor: S_ETIC, altsektor: 'bilisim', url: URL_TUBISAD, run: tubisad },
  { ad: 'tesid', sektor: S_ETIC, altsektor: 'elektronik', url: URL_TESID, run: tesid },
  { ad: 'mosder', sektor: S_ETIC, altsektor: 'mobilya', url: URL_MOSDER, run: mosder },
  { ad: 'imos', sektor: S_ETIC, altsektor: 'mobilya', url: URL_IMOS, run: imos },
  { ad: 'tgsd', sektor: S_ETIC, altsektor: 'hazir-giyim', url: URL_TGSD, run: tgsd },
  { ad: 'zincir', sektor: S_ETIC, altsektor: 'zincir-perakende', url: URL_ZINCIR, run: zincir },
  { ad: 'etid', sektor: S_ETIC, altsektor: 'eticaret', url: URL_ETID, run: etid, via: 'openclaw' },
  { ad: 'fortune', sektor: 'diger', altsektor: '', url: 'https://www.fortuneturkey.com/fortune-500', run: fortune },
  // NEDEN 'diger': RVD her sektorden reklamveren; varsayilan e-tic olunca Shell/Coca-Cola/Bayer e-ticaret sanilir
  { ad: 'rvd', sektor: 'diger', altsektor: 'reklamveren', url: URL_RVD, run: rvd },
  { ad: 'rd', sektor: 'ajans', altsektor: 'reklam-ajansi', url: URL_RD, run: rd },
  { ad: 'ida', sektor: 'ajans', altsektor: 'pr-ajansi', url: URL_IDA, run: ida },
  // NEDEN 'diger': IAB uyeleri ajans + reklamveren + yayinci karisik; ajans satiri kendi sektorunu tasir
  { ad: 'iab', sektor: 'diger', altsektor: 'reklamveren', url: URL_IAB, run: iab },
  { ad: 'gyoder', sektor: 'diger', altsektor: 'gayrimenkul', url: URL_GYODER, run: gyoder },
  { ad: 'turyid', sektor: 'diger', altsektor: 'restoran-zinciri', url: URL_TURYID, run: turyid },
  { ad: 'ayd-kurumsal', sektor: 'diger', altsektor: 'avm', url: URL_AYD_KURUMSAL, run: aydKaynak(URL_AYD_KURUMSAL, 'kurumsal uye (AVM)') },
  { ad: 'ayd-faaliyet', sektor: 'diger', altsektor: 'avm', url: URL_AYD_FAALIYET, run: aydKaynak(URL_AYD_FAALIYET, 'faaliyet uyesi') },
  { ad: 'meyed', sektor: 'diger', altsektor: 'icecek', url: URL_MEYED, run: meyed },
  { ad: 'yok-vakif', sektor: 'diger', altsektor: 'vakif-universitesi', url: URL_YOK_VAKIF, run: yokVakif },
  { ad: 'ufrad', sektor: 'diger', altsektor: 'franchise', url: UFRAD_LISTELER[0].url, run: ufrad },
  { ad: 'wiki-havayolu', sektor: S_TUR, altsektor: 'havayolu', url: wikiUrl(WIKI_HAVAYOLU), run: wikiKaynak(WIKI_HAVAYOLU, 'havayolu', false) },
  { ad: 'wiki-mvno', sektor: S_TUR, altsektor: 'telekom-mvno', url: wikiUrl(WIKI_MVNO), run: wikiKaynak(WIKI_MVNO, 'MVNO', true) },
  { ad: 'btk', sektor: S_TUR, altsektor: 'telekom', url: URL_BTK, run: btk, via: 'openclaw' },
  { ad: 'turob', sektor: S_TUR, altsektor: 'otel', url: URL_TUROB, run: turob },
  { ad: 'osd', sektor: S_TUR, altsektor: 'otomotiv', url: URL_OSD, run: osd },
  { ad: 'odmd', sektor: S_TUR, altsektor: 'otomotiv-distributor', url: URL_ODMD, run: odmd },
  { ad: 'oyder', sektor: S_TUR, altsektor: 'otomotiv-bayi', url: URL_OYDER, run: oyder },
];

// ─── Birlestirme ────────────────────────────────────────────────────────────

/** g'nin alanlarini f'e tasi (f kalir). Sektor: 'diger' ya da daha dusuk guvenli etiket ezilir. */
function firmaBirles(f: Firma, g: Firma): void {
  for (const s of g.kaynaklar) if (!f.kaynaklar.includes(s)) f.kaynaklar.push(s);
  for (const u of g.kaynakUrl) if (!f.kaynakUrl.includes(u)) f.kaynakUrl.push(u);
  if (g.sektor !== 'diger' && (f.sektor === 'diger' || SK_RANK[g.sektorKaynak] > SK_RANK[f.sektorKaynak])) {
    f.sektor = g.sektor;
    f.altsektor = g.altsektor || f.altsektor;
    f.sektorKaynak = g.sektorKaynak;
  } else if (!f.altsektor && g.altsektor) f.altsektor = g.altsektor;
  if (!f.web && g.web) f.web = g.web;
  if (!f.sehir && g.sehir) f.sehir = g.sehir;
  if (!f.calisan && g.calisan) f.calisan = g.calisan;
  if (g.not) f.not = !f.not ? g.not : f.not.includes(g.not) ? f.not : `${f.not}; ${g.not}`;
  // Alan adi yer tutucusu (TUBISAD logo-only) yerine gercek ad
  if (f.firma === f.web && g.firma && g.firma !== g.web) f.firma = g.firma;
}

const bol = (s: string | undefined) => temiz(s).split('|').map((x) => x.trim()).filter(Boolean);

class Havuz {
  private byDomain = new Map<string, Firma>();
  private byName = new Map<string, Firma>();
  /** adAnahtar → alan adi (web'siz kayitlari web'li satira baglamak icin) */
  private nameToDomain = new Map<string, string>();

  /** Kayit ekler; true = yeni satir, false = mevcut satira birlesti */
  ekle(h: Ham, k: Kaynak): boolean {
    const sektor = h.sektor ?? k.sektor;
    const sektorKaynak: SektorKaynak = sektor === 'diger' ? '' : (h.sektorKaynak ?? (h.sektor !== undefined ? 'etiket' : 'kaynak'));
    return this.ekleFirma({
      firma: temiz(h.firma),
      sektor,
      altsektor: h.altsektor ?? k.altsektor,
      web: normalizeDomain(h.web) ?? '',
      sehir: temiz(h.sehir),
      calisan: temiz(h.calisan),
      kaynaklar: [k.ad],
      kaynakUrl: [h.url ?? k.url],
      sektorKaynak,
      not: temiz(h.not),
    });
  }

  /** Onceki kosumun firmalar.csv satirlarini yukler (--only birlestirmesi); donus: yeni satir sayisi */
  yukle(rows: Record<string, string>[]): number {
    let n = 0;
    for (const r of rows) {
      const firma = temiz(r.firma);
      if (!firma) continue;
      const sektor: Sektor3 = sektorOku(r.sektor);
      const skRaw = temiz(r.sektorKaynak) as SektorKaynak;
      // NEDEN: eski dosyada sutun yoksa 'kaynak' varsayilir (tahmin degil); 'diger' her zaman bos
      const sektorKaynak: SektorKaynak = sektor === 'diger' ? '' : SK_LISTE.includes(skRaw) && skRaw ? skRaw : 'kaynak';
      const g: Firma = {
        firma, sektor, altsektor: temiz(r.altsektor), web: normalizeDomain(r.web) ?? '', sehir: temiz(r.sehir), calisan: temiz(r.calisan),
        kaynaklar: bol(r.kaynaklar), kaynakUrl: bol(r.kaynakUrl), sektorKaynak, not: temiz(r.not),
      };
      if (this.ekleFirma(g)) n++;
    }
    return n;
  }

  private ekleFirma(g: Firma): boolean {
    const nk = adAnahtar(g.firma);
    if (g.web) {
      let f = this.byDomain.get(g.web);
      const adsiz = this.byName.get(nk);
      if (adsiz) {
        // Daha once web'siz gelen ayni ad → web'li satira tasi (sektor/altsektor/calisan dahil, ayni birlesme kurali)
        this.byName.delete(nk);
        if (f) firmaBirles(f, adsiz);
        else { adsiz.web = g.web; this.byDomain.set(g.web, adsiz); f = adsiz; }
      }
      if (f) { firmaBirles(f, g); this.nameToDomain.set(nk, g.web); return false; }
      this.byDomain.set(g.web, g);
      this.nameToDomain.set(nk, g.web);
      return true;
    }
    // web yok: ada gore
    const dom = this.nameToDomain.get(nk);
    if (dom) { const f = this.byDomain.get(dom); if (f) { firmaBirles(f, g); return false; } }
    const f = this.byName.get(nk);
    if (f) { firmaBirles(f, g); return false; }
    this.byName.set(nk, g);
    return true;
  }

  satirlar(): Firma[] {
    const all = [...this.byDomain.values(), ...this.byName.values()];
    const sira: Record<string, number> = { finans: 0, 'eticaret-perakende-teknoloji': 1, 'turizm-havayolu-telekom-otomotiv': 2, ajans: 3, diger: 4 };
    return all.sort((a, b) => (sira[a.sektor] - sira[b.sektor]) || a.firma.localeCompare(b.firma, 'tr'));
  }
}

// ─── Ana akis ───────────────────────────────────────────────────────────────

const BILINEN_BAYRAKLAR = new Set(['dry-run', 'kap-detail', 'no-merge', 'limit', 'only', 'via']);

/** `--x` degersiz verilirse (parseArgs true doner) sessizce yutulmasin */
function bayrakDeger(args: Record<string, string | boolean>, ad: string): string | null {
  const v = args[ad];
  if (v === undefined) return null;
  if (v === true) { console.error(`--${ad} için değer eksik (örn. --${ad} <değer>)`); process.exit(1); }
  return typeof v === 'string' ? v : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of Object.keys(args)) if (!BILINEN_BAYRAKLAR.has(k)) console.warn(`UYARI bilinmeyen bayrak --${k} yok sayıldı (geçerli: ${[...BILINEN_BAYRAKLAR].map((b) => `--${b}`).join(' ')})`);
  const dryRun = args['dry-run'] === true;
  const kapDetail = args['kap-detail'] === true;
  const noMerge = args['no-merge'] === true;
  const limitStr = bayrakDeger(args, 'limit');
  let limit: number | null = null;
  if (limitStr !== null) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) { console.error(`--limit tam sayı (≥1) olmalı, verilen: "${limitStr}"`); process.exit(1); }
    limit = n;
  }
  const onlyStr = bayrakDeger(args, 'only');
  const only = onlyStr !== null ? onlyStr.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (only && only.length === 0) { console.error('--only boş (örn. --only tbb,seddk)'); process.exit(1); }
  const via = bayrakDeger(args, 'via');
  if (via && via !== 'openclaw') { console.error(`Bilinmeyen --via: "${via}" (desteklenen: openclaw)`); process.exit(1); }

  const adlar = KAYNAKLAR.map((k) => k.ad);
  const jsOnly = KAYNAKLAR.filter((k) => k.via === 'openclaw').map((k) => k.ad);
  const openclawKomut = `npx tsx scripts/prospect/01-firmalar.ts --via openclaw --only ${jsOnly.join(',')}`;
  if (only) {
    const bilinmeyen = only.filter((o) => !adlar.includes(o));
    if (bilinmeyen.length) { console.error(`Bilinmeyen --only kaynağı: ${bilinmeyen.join(', ')}\nGeçerli: ${adlar.join(', ')}`); process.exit(1); }
    const jsIstenen = only.filter((o) => jsOnly.includes(o));
    if (jsIstenen.length && via !== 'openclaw') {
      console.error(`${jsIstenen.join(', ')} JS-only kaynak — yalnız OpenClaw tarayıcıyla koşar (sunucuda): ${openclawKomut}`);
      process.exit(1);
    }
  }
  // NEDEN: seed her zaman okunur (sektor onceligi + elle eklenen kritik markalar)
  const secili = KAYNAKLAR.filter((k) => (k.ad === 'seed' || !only || only.includes(k.ad)) && (!k.via || via === k.via));
  const atlanan = KAYNAKLAR.filter((k) => k.via && via !== k.via && (!only || only.includes(k.ad))).map((k) => k.ad);

  console.log(`Kaynak: ${secili.map((k) => k.ad).join(', ')}${limit !== null ? ` · limit=${limit}` : ''}${kapDetail ? ' · kap-detail' : ''}${via ? ` · via=${via}` : ''}${dryRun ? ' · kuru koşum' : ''}`);
  if (atlanan.length) console.warn(`UYARI atlandı (JS-only, ETİD e-ticaret üyeleri / BTK işletmeciler): ${atlanan.join(', ')} — sunucuda: ${openclawKomut}`);

  const havuz = new Havuz();
  const outFile = path.join(DATA_DIR, 'firmalar.csv');
  // NEDEN: --only tek kaynagi tamamlamak icindir; dosyayi yalniz secili kaynaklarla EZMEK 2.450 satiri 340'a indirirdi
  if (only && !noMerge) {
    const mevcut = readCsv(outFile);
    if (mevcut.length) {
      const n = havuz.yukle(mevcut);
      console.log(`Mevcut ${outFile}: ${mevcut.length} satır yüklendi (${n} tekil) — seçili kaynaklar üstüne birleştirilir (--no-merge ile kapat)`);
    }
  }

  const ozet: Array<{ ad: string; bulunan: number; yeni: number; hata?: string }> = [];

  for (const k of secili) {
    const ctx: Ctx = { limit, kapDetail, log: (m) => console.log(`  [${k.ad}] ${m}`) };
    console.log(`→ ${k.ad}`);
    let ham: Ham[];
    try {
      ham = await k.run(ctx);
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`  [${k.ad}] HATA, kaynak atlandı: ${msg}`);
      ozet.push({ ad: k.ad, bulunan: 0, yeni: 0, hata: msg });
      continue;
    }
    if (limit !== null) ham = ham.slice(0, limit);
    if (ham.length === 0) {
      console.warn(`  [${k.ad}] UYARI: parse 0 sonuç — seçici kırılmış olabilir, sayfa yapısını kontrol et: ${k.url}`);
      ozet.push({ ad: k.ad, bulunan: 0, yeni: 0, hata: 'parse 0 sonuç' });
      continue;
    }
    let yeni = 0;
    for (const h of ham) if (havuz.ekle(h, k)) yeni++;
    ozet.push({ ad: k.ad, bulunan: ham.length, yeni });
  }

  const satirlar = havuz.satirlar();
  const csvRows = satirlar.map((f) => ({ ...f, kaynaklar: f.kaynaklar.join('|'), kaynakUrl: f.kaynakUrl.join('|') }));

  console.log('\n─── Özet ───');
  for (const o of ozet) console.log(`  ${o.ad.padEnd(14)} bulunan ${String(o.bulunan).padStart(4)} · yeni satır ${String(o.yeni).padStart(4)}${o.hata ? ` · HATA: ${o.hata}` : ''}`);
  const dagilim: Record<string, number> = {};
  const skDagilim: Record<string, number> = {};
  let webli = 0;
  for (const f of satirlar) {
    dagilim[f.sektor] = (dagilim[f.sektor] ?? 0) + 1;
    if (f.sektor !== 'diger') skDagilim[f.sektorKaynak || '?'] = (skDagilim[f.sektorKaynak || '?'] ?? 0) + 1;
    if (f.web) webli++;
  }
  console.log(`  toplam ${satirlar.length} firma · web'li ${webli} · web'siz ${satirlar.length - webli}`);
  console.log(`  sektör: ${Object.entries(dagilim).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`  sektör kaynağı: ${Object.entries(skDagilim).map(([k, v]) => `${k}=${v}`).join(' · ')}${skDagilim.unvan ? ` — 'unvan' TAHMİNDİR, 03/04 ayrı ele alsın` : ''}`);
  if (dagilim.diger) console.log(`  NOT: ${dagilim.diger} firma 'diger' (hedef üç gruba eşleşmedi) — elle sınıfla ya da --kap-detail ile KAP sektör satırını çek.`);

  // NEDEN: hata alan kaynak sessizce kaybolmasin — orkestrasyon/kullanici cikis koduyla fark etsin
  const eksik = ozet.filter((o) => o.hata).map((o) => o.ad);
  if (eksik.length) {
    console.warn(`\nEKSİK KAYNAK: ${eksik.join(', ')} — çıktı eksik; tamamlamak için: npx tsx scripts/prospect/01-firmalar.ts --only ${eksik.join(',')}${eksik.some((e) => jsOnly.includes(e)) ? ' --via openclaw' : ''}`);
    process.exitCode = 2;
  }

  if (dryRun) {
    console.log(`\n(kuru koşum — yazılmadı) Hedef: ${outFile}`);
    console.log('İlk 10 satır:');
    for (const r of csvRows.slice(0, 10)) console.log(`  ${r.sektor} | ${r.altsektor} | ${r.firma} | ${r.web} | ${r.sehir} | ${r.kaynaklar} | ${r.sektorKaynak}${r.not ? ` | ${r.not}` : ''}`);
    return;
  }
  writeCsv(outFile, csvRows, COLUMNS);
  console.log(`\nYazıldı: ${outFile} (${csvRows.length} satır)${eksik.length ? ' — EKSİK, yukarıdaki uyarıya bak' : ''}`);
}

main().catch((e) => {
  console.error('HATA:', e);
  process.exit(1);
});
