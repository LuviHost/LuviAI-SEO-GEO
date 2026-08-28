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

type Sektor3 = Sektor | 'diger';

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
    const sektor = (SEKTORLER as readonly string[]).includes(r.sektor) ? (r.sektor as Sektor) : 'diger';
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
  { ad: 'etid', sektor: S_ETIC, altsektor: 'eticaret', url: URL_ETID, run: etid, via: 'openclaw' },
  { ad: 'fortune', sektor: 'diger', altsektor: '', url: 'https://www.fortuneturkey.com/fortune-500', run: fortune },
  // NEDEN 'diger': RVD her sektorden reklamveren; varsayilan e-tic olunca Shell/Coca-Cola/Bayer e-ticaret sanilir
  { ad: 'rvd', sektor: 'diger', altsektor: 'reklamveren', url: URL_RVD, run: rvd },
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
      const sektor: Sektor3 = (SEKTORLER as readonly string[]).includes(r.sektor) ? (r.sektor as Sektor) : 'diger';
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
    const sira: Record<string, number> = { finans: 0, 'eticaret-perakende-teknoloji': 1, 'turizm-havayolu-telekom-otomotiv': 2, diger: 3 };
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
