/**
 * Faz 2 — acik kaynaklardan pazarlama tarafi karar vericileri → DATA_DIR/kisiler.csv
 *
 * Kullanim (apps/api icinde):
 *   npx tsx scripts/prospect/02-yoneticiler.ts                          # tum kaynaklar, dosyalari yaz
 *   npx tsx scripts/prospect/02-yoneticiler.ts --limit 5 --dry-run      # kaynak basina 5 firma/yazi ISLE, yazma
 *   npx tsx scripts/prospect/02-yoneticiler.ts --only kap,fortune       # yalniz secilen kaynaklar
 *   npx tsx scripts/prospect/02-yoneticiler.ts --pages 37               # Marketing Turkiye arsiv derinligi
 *   npx tsx scripts/prospect/02-yoneticiler.ts --input ../../reklam/pazarlama/prospect/seed-firmalar.csv
 *   npx tsx scripts/prospect/02-yoneticiler.ts --only kap --overwrite   # kismi kosum ama tam dosya adlarina yaz
 *
 * NEDEN: 01-firmalar.ts tuzel kisi listesini uretir; gonderim icin isimli karar
 * verici gerekir. Acik kaynakta pazarlama unvani seyrek (KAP GMY/Icra duzeyi,
 * basin "atamalar" arsivi, 2022 Fortune CMO listesi) — bulunamayan firmalar
 * manuel-liste.csv'ye hazir LinkedIn arama URL'siyle dusuyor (Faz 8 botu / elle).
 *
 * Kaynaklar ve guven:
 *   kap               KAP genel sayfasi "Yonetimde Soz Sahibi Olan Personel" (SSR)   → yuksek
 *   marketing-turkiye marketingturkiye.com.tr/kategori/atamalar (yazi tarihi ile)     → 2024+ orta, oncesi dusuk
 *   fortune           fortuneturkey.com "En Etkin 50 CMO" (~2022, guncelligi belirsiz) → dusuk
 *   todeb             TODEB uye sayfalari (temsilci/yetkili adi varsa)                → orta
 * Ayni kisi (cekirdek firma + ad + soyad) tek satir; catisma halinde oncelik yukaridaki sira.
 *
 * --limit: kaynak basina ISLENEN firma/yazi/kayit sayisini sinirlar (bulunan isim
 * sayisini degil). NEDEN: deneme kosumunda istek sayisi ongorulebilir olsun.
 *
 * Kismi kosum (--only alt kume, --limit, --pages < varsayilan) tam ciktilarin
 * ustune YAZMAZ: *.partial.csv uretir; --overwrite ile normal adlara yazar.
 *
 * Cikti:
 *   kisiler.csv             firma,web,ad,soyad,unvan,kademe,kaynak,kaynakUrl,kaynakTarihi,guven
 *   manuel-liste.csv        firma,web,sektor,linkedinAramaUrl  (ismi bulunamayan HEDEF sektor firmalari)
 *   atamalar-eslesmeyen.csv baslik,tarih,url  (firmalar.csv ile eslesmeyen atama haberleri)
 *
 * KVKK notu: uretilen veri isimli kisisel veridir; log'a YALNIZ sayilar ve HTTP
 * durum kodlari basilir (isim, unvan, haber URL'si basilmaz); dosyalar
 * reklam/pazarlama/prospect/data/ altinda ve .gitignore'dadir. Bu betik e-posta
 * adresi TOPLAMAZ; KAP genel sayfasindan yalniz yonetici tablosu ve sirketin
 * "Internet Adresi" alani okunur.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import {
  DATA_DIR,
  fetchText,
  jitter,
  normalizeDomain,
  parseArgs,
  readCsv,
  sleep,
  slugName,
  splitName,
  titleCaseTr,
  translit,
  writeCsv,
} from '../../src/prospect/prospect-utils.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type KaynakAd = 'kap' | 'marketing-turkiye' | 'fortune' | 'todeb';
export type Guven = 'yuksek' | 'orta' | 'dusuk';

/** kaynak → oncelik (kucuk = ustun). Ayni kisi iki kaynaktan gelirse bu kazanir. */
const KAYNAK_ONCELIK: Record<KaynakAd, number> = {
  kap: 0,
  'marketing-turkiye': 1,
  fortune: 2,
  todeb: 3,
};

export interface Kisi {
  firma: string;
  web: string;
  ad: string;
  soyad: string;
  unvan: string;
  kademe: number;
  kaynak: KaynakAd;
  kaynakUrl: string;
  kaynakTarihi: string;
  guven: Guven;
}

/** firmalar.csv (veya seed-firmalar.csv) satiri — sozlesme 01-firmalar.ts ile ortak */
export interface Firma {
  firma: string;
  sektor: string;
  altsektor: string;
  web: string;
  kaynaklar: string[];
  kaynakUrl: string[];
  /** Istege bagli sutun: KAP hisse kodu (varsa liste taramasina gerek kalmaz) */
  kapStockCode: string;
  /** translit eslesme anahtarlari: tam ad, hukuki ek atilmis, cekirdek, ilk ayirt edici kelime, takma adlar */
  anahtarlar: string[];
}

interface Ctx {
  limit: number | null;
  pages: number;
  log: (msg: string) => void;
}

const KISI_COLUMNS = ['firma', 'web', 'ad', 'soyad', 'unvan', 'kademe', 'kaynak', 'kaynakUrl', 'kaynakTarihi', 'guven'];
const MANUEL_COLUMNS = ['firma', 'web', 'sektor', 'linkedinAramaUrl'];
const ESLESMEYEN_COLUMNS = ['baslik', 'tarih', 'url'];
const VARSAYILAN_SAYFA = 10;

// ─── Unvan filtresi (SAF — test edilebilir) ─────────────────────────────────

/**
 * Ilgi alanimiz: pazarlama/dijital/marka/buyume/iletisim/musteri deneyimi/e-ticaret.
 * NEDEN translit uzerinden: kaynaklar "Direktörü/DIREKTORU/direktoru" karisik yaziyor;
 * Turkce buyuk-kucuk harf (I/İ) tuzagina dusmemek icin once ASCII'ye ceviriyoruz.
 */
const UNVAN_OLUMLU: RegExp[] = [
  /\bpazarlama\w*\b/, /\bmarketing\b/, /\bdijital\w*\b/, /\bdigital\b/,
  /\bmarka\w*\b/, /\bbrand\w*\b/, /\bbuyume\b/, /\bgrowth\b/,
  /\biletisim\w*\b/, /\bcommunication\w*\b/,
  /\bmusteri deneyimi\b/, /\bmusteri iliskileri\b/, /\bcustomer experience\b/,
  /\beticaret\b/, /\be ticaret\b/, /\becommerce\b/, /\be commerce\b/,
  /\bcmo\b/, /\bcdo\b/, /\bcgo\b/, /\bcxo\b/,
  /\bchief (marketing|digital|growth|brand|customer|commercial) officer\b/,
];

/**
 * Kesin elenen roller — unvanin TAMAMINI tanimlayan alanlar; olumlu kelime olsa da kazanir.
 * NEDEN: KAP "Yonetimde Soz Sahibi" tablosu tum GMY'leri listeler (BT, uyum, hukuk,
 * finans, IK...); bunlara pazarlama teklifi gitmez. "Bilgi ve Iletisim Teknolojileri
 * GMY" = CTO; "iletisim" olumlu kelimesine takilmasin.
 * NEDEN ciplak `finans\w*` YOK: "Finansal Urunler Pazarlama Muduru" pazarlama roludur;
 * finans yalniz rol biciminde (CFO, Mali Isler, Finans GMY/Direktoru, Finanstan Sorumlu) elenir.
 */
const UNVAN_OLUMSUZ: RegExp[] = [
  /\bbilgi teknolojileri\b/, /\bbilgi sistemleri\b/, /\bbilisim\b/, /\bit\b/, /\binformation technology\b/,
  /\bbilgi ve iletisim teknolojileri\b/, /\biletisim teknolojileri\b/, /\bteknolojileri genel mudur\w*\b/, /\bcto\b/, /\bcio\b/,
  /\buyum\b/, /\bcompliance\b/, /\bhukuk\w*\b/, /\blegal\b/, /\bmevzuat\b/,
  /\bcfo\b/, /\bmali isler\b/, /\bmali\b/, /\bhazine\b/, /\btreasury\b/,
  /\bfinans(tan|dan)? sorumlu\b/, /\bfinans (genel mudur|gmy|direktor|baskan|mudur|lider|yonetici)\w*\b/,
  /\bfinansal (planlama|raporlama|kontrol|analiz)\b/, /\bfinance (director|manager|head|officer|vp|lead)\b/,
  /\bic denetim\b/, /\bdenetim\b/, /\baudit\b/, /\brisk\w*\b/,
  /\binsan kaynaklari\b/, /\bhuman resources\b/, /\bhr\b/, /\bik\b/,
];

/**
 * Kademe 1 = karar verici (butce/imza), 2 = etkileyici.
 * Mudur / Manager / Yonetici / Head of / Lead → 1; Uzman / Sorumlu / Koordinator / Specialist → 2.
 */
const KADEME1: RegExp[] = [
  /\bdirektor\w*\b/, /\bdirector\b/, /\bgmy\b/, /\bgenel mudur\w*\b/, /\bbaskan\w*\b/, /\bpresident\b/,
  /\bchief\b/, /\bicra kurulu\b/, /\bicra baskan\w*\b/, /\bmurahhas\b/, /\bcmo\b/, /\bcdo\b/, /\bcgo\b/, /\bcxo\b/, /\bceo\b/,
  /\bmudur\w*\b/, /\bmanager\b/, /\byonetici\w*\b/, /\blider\w*\b/, /\blead\b/, /\bhead\b/, /\bvp\b/, /\bvice president\b/, /\bofficer\b/,
];
const KADEME2: RegExp[] = [/\buzman\w*\b/, /\bsorumlu\w*\b/, /\bkoordinator\w*\b/, /\bspecialist\b/, /\bcoordinator\b/];

const APOSTROF = /['’`]/;

/**
 * Turkce iyelik/hal eki temizligi: "CMO'su" → "CMO", "Direktörlüğü'ne" → "Direktörlüğü".
 * NEDEN: translit apostrofu siler ve "cmosu" tek kelime olur; \bcmo\b tutmaz.
 */
export function unvanEkiAt(unvan: string): string {
  return bosluk((unvan ?? '').replace(/(\S)['’`][A-Za-zÇĞİÖŞÜçğıöşü]*/g, '$1'));
}

const unvanNormal = (unvan: string): string => translit(unvanEkiAt(unvan));

/** Unvan pazarlama tarafinda mi? (kesin olumsuz liste her zaman kazanir) */
export function unvanUygunMu(unvan: string): boolean {
  const t = unvanNormal(unvan);
  if (!t) return false;
  if (UNVAN_OLUMSUZ.some((re) => re.test(t))) return false;
  return UNVAN_OLUMLU.some((re) => re.test(t));
}

/** 1 = karar verici, 2 = etkileyici. NEDEN kademe1 once: "Pazarlamadan Sorumlu GMY" karar vericidir. */
export function kademe(unvan: string): number {
  const t = unvanNormal(unvan);
  if (KADEME1.some((re) => re.test(t))) return 1;
  if (KADEME2.some((re) => re.test(t))) return 2;
  // Bilinmeyen unvan: etkileyici varsayilir (fazla iyimser olmamak icin)
  return 2;
}

// ─── Metin yardimcilari (SAF) ───────────────────────────────────────────────

function bosluk(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Eslesme metni: apostroflu ek ayri kelime olsun ("Vodafone'a" → "vodafone a"), sonra translit */
const eslesmeMetni = (s: string): string => translit((s ?? '').replace(/['’`]/g, ' '));

/** Hukuki ekler — firma adinin her yerinden atilir */
const HUKUKI_EK = new Set(['as', 'a', 's', 'tas', 't', 'ao', 'anonim', 'sirketi', 'sirket', 'sti', 'ltd', 'limited', 'gmbh', 'inc', 'co', 'llc', 'plc']);
/** Jenerik sektor kelimeleri — cekirdek ad icin atilir (basin bunlari yazmaz: "Turkcell", "Yapi Kredi") */
const JENERIK = new Set([
  'holding', 'grup', 'group', 'sanayi', 'sanayii', 'ticaret', 'hizmetleri', 'hizmet', 'bankasi', 've', 'iletisim',
  'telekomunikasyon', 'isletmeleri', 'isletme', 'magazacilik', 'magazalar', 'perakende',
]);
/** Tek basina ayirt edici olmayan ilk kelime → iki kelime alinir ("turk telekomunikasyon", "yapi kredi") */
const JENERIK_ILK = new Set([
  'turk', 'turkiye', 'yapi', 'anadolu', 'istanbul', 'ankara', 'izmir', 'bursa', 'ege', 'marmara', 'akdeniz', 'karadeniz',
  'dogu', 'bati', 'kuzey', 'guney', 'orta', 'milli', 'ulusal', 'global', 'yeni', 'ilk', 'birlesik', 'buyuk', 'kucuk',
  'the', 'new', 'uluslararasi', 'avrupa', 'asya', 'dunya',
]);
/**
 * Tek basina anahtar OLAMAYACAK kelimeler. NEDEN: "Sigorta", "Yatirim" gibi sektor
 * adlari her basligi yakalar; "Koc"/"Sabanci" yaygin soyadi (aile uyeleri, vakiflar).
 */
const ANAHTAR_YASAK = new Set([
  ...JENERIK, ...JENERIK_ILK, ...HUKUKI_EK,
  'sigorta', 'banka', 'bank', 'yatirim', 'menkul', 'degerler', 'kiymetler', 'portfoy', 'yonetimi', 'yonetim', 'finans',
  'finansal', 'finansman', 'faktoring', 'leasing', 'kiralama', 'emeklilik', 'hayat', 'gayrimenkul', 'girisim', 'sermayesi',
  'enerji', 'elektrik', 'insaat', 'gida', 'tekstil', 'otomotiv', 'teknoloji', 'teknolojileri', 'bilgi', 'bilisim', 'dijital',
  'medya', 'reklam', 'lojistik', 'turizm', 'hava', 'yollari', 'otel', 'saglik', 'ilac', 'kimya', 'metal', 'demir', 'celik',
  'cimento', 'cam', 'kagit', 'plastik', 'petrol', 'madencilik', 'tarim', 'mobilya', 'deri', 'bagimsiz', 'denetim',
  'danismanlik', 'koc', 'sabanci', 'ile', 'var', 'yok', 'bir', 'son', 'iki', 'alt', 'ust', 'gun', 'genel',
]);

/**
 * Bilinen markalar: basin yazimi ↔ KAP tuzel adi. NEDEN: "Turk Telekom" ile
 * "TURK TELEKOMUNIKASYON A.S." ancak bu tabloyla bulusur. Regex translit tam ada bakar.
 */
const TAKMA_ADLAR: Array<[RegExp, string[]]> = [
  [/^turk telekom/, ['turk telekom', 'turktelekom']],
  [/^turkcell\b/, ['turkcell']],
  [/^vodafone\b/, ['vodafone']],
  [/^yapi ve kredi bankasi\b|^yapi kredi\b/, ['yapi kredi', 'yapikredi']],
  [/^turkiye is bankasi\b|^is bankasi\b/, ['is bankasi', 'isbank']],
  [/^turkiye garanti bankasi\b|^garanti bbva\b/, ['garanti bbva', 'garanti']],
  [/^qnb\b|^finansbank\b/, ['qnb', 'qnb finansbank', 'finansbank']],
  [/^akbank\b/, ['akbank']],
  [/^migros\b/, ['migros']],
  [/^turk hava yollari\b|^thy\b|^turkish airlines\b/, ['thy', 'turk hava yollari', 'turkish airlines']],
  [/^pegasus\b/, ['pegasus']],
  [/^trendyol\b|^dsm grup\b/, ['trendyol']],
  [/^hepsiburada\b|^d market\b/, ['hepsiburada']],
  [/^getir\b/, ['getir']],
  [/^anadolu efes\b/, ['anadolu efes', 'efes']],
  [/^arcelik\b/, ['arcelik']],
  [/^vestel\b/, ['vestel']],
  [/^koc holding\b/, ['koc holding', 'koc grubu', 'koc toplulugu']],
  [/^haci omer sabanci holding\b|^sabanci holding\b/, ['sabanci holding', 'sabanci grubu', 'sabanci toplulugu']],
  [/^turkiye cumhuriyeti ziraat bankasi\b|^tc ziraat\b|^ziraat\b/, ['ziraat bankasi', 'ziraat']],
  [/^turkiye halk bankasi\b|^halkbank\b/, ['halkbank', 'halk bankasi']],
  [/^turkiye vakiflar bankasi\b|^vakifbank\b/, ['vakifbank', 'vakiflar bankasi', 'vakif bank']],
  [/^denizbank\b/, ['denizbank', 'deniz bank']],
  [/^turk ekonomi bankasi\b|^teb\b/, ['teb', 'turk ekonomi bankasi']],
  [/^ing bank\b|^ing\b/, ['ing', 'ing bank', 'ing turkiye']],
  [/^sekerbank\b/, ['sekerbank']],
  [/^enpara\b/, ['enpara']],
  [/^papara\b/, ['papara']],
];

/** Anahtar en az 3 karakter (n11, BIM) ve tek basina yasakli kelime olmasin */
const anahtarGecerli = (a: string): boolean => a.length >= 3 && !ANAHTAR_YASAK.has(a);

interface FirmaParcalari { tam: string; yasal: string[]; cekirdek: string[] }

function firmaParcala(firma: string): FirmaParcalari | null {
  const tam = translit(firma);
  if (!tam) return null;
  const kelimeler = tam.split(' ');
  const yasal = kelimeler.filter((k) => !HUKUKI_EK.has(k));
  let cekirdek = yasal.filter((k) => !JENERIK.has(k));
  // NEDEN: "TURK TELEKOMUNIKASYON" → jenerik atilinca "turk" kalir; tek basina jenerik ad anlamsiz
  if (cekirdek.length === 0 || (cekirdek.length === 1 && JENERIK_ILK.has(cekirdek[0]))) cekirdek = yasal.length ? yasal : kelimeler;
  return { tam, yasal, cekirdek };
}

/** Tekillestirme/kapsama anahtari: hukuki + jenerik kelimeler atilmis cekirdek ad (translit) */
export function firmaCekirdek(firma: string): string {
  const p = firmaParcala(firma);
  return p ? p.cekirdek.join(' ') : '';
}

/**
 * Firma adindan eslesme anahtarlari: (a) tam ad, hukuki eki atilmis ad, cekirdek ad;
 * (b) ilk ayirt edici kelime (jenerik ilk kelimede 2 kelime); (c) takma ad tablosu.
 */
export function firmaAnahtarlari(firma: string): string[] {
  const p = firmaParcala(firma);
  if (!p) return [];
  const out = new Set<string>();
  const ekle = (a: string) => { if (anahtarGecerli(a)) out.add(a); };
  ekle(p.tam);
  ekle(p.yasal.join(' '));
  ekle(p.cekirdek.join(' '));
  const ilk = p.cekirdek[0] ?? '';
  if (JENERIK_ILK.has(ilk) && p.cekirdek.length >= 2) ekle(p.cekirdek.slice(0, 2).join(' '));
  else ekle(ilk);
  for (const [re, adlar] of TAKMA_ADLAR) if (re.test(p.tam)) for (const a of adlar) ekle(a);
  return [...out];
}

const reKac = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Metin bu anahtari kelime siniriyla iceriyor mu? (metin eslesmeMetni ile normalize edilmis olmali)
 * NEDEN kelime siniri: "Getir" anahtari "getirildi" icinde gecmesin.
 */
export function anahtarGeciyorMu(metinTranslit: string, anahtar: string): boolean {
  if (anahtar.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${reKac(anahtar)}([^a-z0-9]|$)`).test(metinTranslit);
}

/** Metne en iyi eslesen firma (en uzun anahtar kazanir; esitlikte listedeki ilk; yoksa null) */
export function firmaEslestir(metin: string, firmalar: Firma[]): Firma | null {
  const t = eslesmeMetni(metin);
  if (!t) return null;
  let enIyi: Firma | null = null;
  let enUzun = 0;
  for (const f of firmalar) {
    for (const a of f.anahtarlar) {
      if (a.length > enUzun && anahtarGeciyorMu(t, a)) {
        enIyi = f;
        enUzun = a.length;
      }
    }
  }
  return enIyi;
}

/**
 * Atama basliginda HEDEF firma: "X, Y'den Z'ye Pazarlama Direktoru olarak gecti" → Z.
 * NEDEN: en uzun anahtar kurali eski isvereni secebilir; unvandan hemen onceki
 * apostroflu kurum parcasi (son apostrofa kadar) varis sirketidir. Bulunamazsa
 * unvan oncesi metin, o da olmazsa tum baslik.
 */
export function hedefFirmaEslestir(baslik: string, unvanKonumu: number, firmalar: Firma[]): Firma | null {
  const metin = bosluk(baslik);
  const onceki = metin.slice(0, Math.max(0, unvanKonumu));
  const kelimeler = onceki.split(/\s+/).filter(Boolean);
  let son = -1;
  for (let i = kelimeler.length - 1; i >= 0; i--) if (APOSTROF.test(kelimeler[i])) { son = i; break; }
  if (son >= 0) {
    let bas = son - 1;
    while (bas >= 0 && !APOSTROF.test(kelimeler[bas]) && !/[,;:]$/.test(kelimeler[bas])) bas--;
    const parca = firmaEslestir(kelimeler.slice(bas + 1, son + 1).join(' '), firmalar);
    if (parca) return parca;
  }
  return (onceki && firmaEslestir(onceki, firmalar)) || firmaEslestir(metin, firmalar);
}

/** Unvan basindaki kurum baglami — kirpildiktan sonra da kalabilen jenerik kelimeler */
const KURUM_KELIME = new Set(['grup', 'group', 'holding', 'turkiye', 'turkey', 'as', 'a', 's', 'ticaret', 'sanayi', 've', 'global', 'international']);

/**
 * "Trendyol Group CMO'su" → "CMO'su". NEDEN: Fortune pozisyon metni ve basin
 * baslıklari firma adi + unvani birlesik yaziyor; kisiler.csv'de yalniz unvan olsun.
 */
export function firmayiKirp(unvan: string, anahtarlar: string[]): string {
  let kelimeler = bosluk(unvan).split(/\s+/).filter(Boolean);
  // Uzun anahtar once: "watsons turkiye" varken yalniz "watsons" kirpilmasin
  for (const a of [...anahtarlar].sort((x, y) => y.length - x.length)) {
    const n = a.split(' ').length;
    if (kelimeler.length > n && eslesmeMetni(kelimeler.slice(0, n).join(' ')) === a) { kelimeler = kelimeler.slice(n); break; }
  }
  while (kelimeler.length > 1 && KURUM_KELIME.has(translit(kelimeler[0]).replace(/[^a-z0-9]/g, ''))) kelimeler.shift();
  return bosluk(kelimeler.join(' ')) || bosluk(unvan);
}

/** Basliktaki baglaclar/dolgu kelimeler — unvanin basindan atilir */
const UNVAN_DOLGU = new Set(['ve', 'ile', 'yeni', 'olarak', 'gorevine', 'gorevi', 'gorev', 'olan', 'yeniden', 'artik', 'bu', 'the', 'of', 'to', 'as']);

const UNVAN_KUYRUK =
  '(?:CMO|CDO|CGO|CXO|CEO|Chief\\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\\s+Officer|Head\\s+of\\s+[A-Za-zÇĞİÖŞÜçğıöşü]+(?:\\s+[A-Za-zÇĞİÖŞÜçğıöşü]+){0,2}' +
  '|Direkt[öo]r|M[üu]d[üu]r|Ba[şs]kan|Lider|Y[öo]netici|Koordinat[öo]r|Uzman|Sorumlu)[A-Za-zÇĞİÖŞÜçğıöşü]*';
const UNVAN_ADAY_RE = new RegExp(
  `((?:[A-Za-zÇĞİÖŞÜçğıöşü&/.\\-'’]+\\s+){0,5}${UNVAN_KUYRUK})`,
  'g',
);

/**
 * Basliktan unvan ifadesi + basliktaki karakter konumu; yalniz pazarlama tarafinda olan doner.
 * NEDEN apostrof kesimi: Turkcede kurum adi "Izocam'da / Edenred'in" gibi ek alir —
 * apostroflu son kelimeye kadarki her sey kurum baglamidir, unvan degil.
 */
export function unvanCikarDetay(baslik: string): { unvan: string; konum: number } | null {
  const metin = bosluk(baslik);
  if (!metin) return null;
  for (const m of metin.matchAll(UNVAN_ADAY_RE)) {
    let kelimeler = m[1].split(/\s+/).filter(Boolean);
    // NEDEN dizi sonundan tarama: findLastIndex ES2023, hedef ES2022
    let sonApostrof = -1;
    for (let i = kelimeler.length - 1; i >= 0; i--) if (APOSTROF.test(kelimeler[i])) { sonApostrof = i; break; }
    if (sonApostrof >= 0 && sonApostrof < kelimeler.length - 1) kelimeler = kelimeler.slice(sonApostrof + 1);
    while (kelimeler.length > 1 && UNVAN_DOLGU.has(translit(kelimeler[0]))) kelimeler.shift();
    const ilkKelime = kelimeler[0];
    // Son kelimedeki ek: "Direktörlüğü'ne" → "Direktörlüğü"
    kelimeler[kelimeler.length - 1] = kelimeler[kelimeler.length - 1].replace(/['’`]\S*$/, '');
    const aday = bosluk(kelimeler.join(' ')).replace(/[.,;:]+$/, '');
    if (aday && unvanUygunMu(aday)) {
      const konum = metin.indexOf(ilkKelime, m.index ?? 0);
      return { unvan: aday, konum: konum >= 0 ? konum : (m.index ?? 0) };
    }
  }
  return null;
}

export function unvanCikar(baslik: string): string | null {
  return unvanCikarDetay(baslik)?.unvan ?? null;
}

/**
 * Ayrilis haberleri: bu basliklardan ASLA atama uretilmez.
 * NEDEN: "X gorevinden ayrildi" / "istifa etti" basliklari da unvan + isim icerir.
 */
const NEGATIF_FIILI = /\b(ayrildi|ayriliyor|ayrilacak|ayrildigini|istifa\w*|veda\w*|birakti|birakiyor|emekli\w*|gorevden alindi|gorevden ayrildi|gorevine son|vefat\w*|hayatini kaybetti)\b/;
/** Olumlu atama fiili — yoksa baslik atama sayilmaz (ilk buyuk harfli diziye ASLA dusulmez) */
const ATAMA_FIILI = /\b(atandi|atanacak|atanmistir|ataniyor|oldu|olacak|getirildi|ustlendi|ustlenecek|katildi|basladi|devraldi|yukseldi|terfi\w*|secildi|gecti|yurutecek)\b/;

export const negatifFiilVarMi = (baslik: string): boolean => NEGATIF_FIILI.test(translit(baslik));
export const atamaFiiliVarMi = (baslik: string): boolean => ATAMA_FIILI.test(translit(baslik));

/** Isim olamayacak buyuk harfli kelimeler (kurum/unvan/dolgu) */
const AD_OLMAZ = new Set([
  'turkiye', 'turk', 'grup', 'group', 'holding', 'genel', 'mudur', 'muduru', 'mudurlugu', 'yardimcisi', 'direktor',
  'direktoru', 'direktorlugu', 'baskan', 'baskani', 'baskanligi', 'pazarlama', 'pazarlamadan', 'satis', 'satistan',
  'dijital', 'marka', 'iletisim', 'kurumsal', 'yeni', 'gorev', 'gorevi', 'gorevine', 'sorumlu', 'sorumlusu', 'lider', 'lideri',
  'koordinator', 'koordinatoru', 'uzman', 'uzmani', 'yonetici', 'yoneticisi',
  'yonetim', 'kurulu', 'uyesi', 'icra', 'is', 'dunyasinda', 'haftanin', 'atamalari', 'atama', 'sirket', 'sirketi',
  'anonim', 'as', 'bolge', 'bolum', 'ulke', 'global', 'chief', 'officer', 'head', 'cmo', 'cdo', 'ceo', 'operasyon',
  'insan', 'kaynaklari', 'finans', 'hukuk', 'teknoloji', 'teknolojileri', 'musteri', 'deneyimi', 'urun', 'strateji',
  'deneyimli', 'pazarlamaci',
]);

const buyukHarfli = (k: string) => /^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.]*$/.test(k);

/**
 * Basliktan kisi adini cikarir. Ayrilis fiili varsa ya da olumlu atama fiili
 * YOKSA null. Sira: (1) atama fiilinden hemen onceki buyuk harfli dizi,
 * (2) basliktaki ilk dizi (virgul/apostrofla biten). NEDEN: TR atama
 * basliklarinda ad ya fiile bitisiktir ("... Sertan Sahin atandi") ya da basta
 * durur ("X, Y'ye ... atandi"). "En uzun dizi" yedegi kaldirildi: kurum adi yakaliyordu.
 */
export function adCikar(baslik: string, ekYasak: string[] = []): { ad: string; soyad: string } | null {
  if (negatifFiilVarMi(baslik) || !atamaFiiliVarMi(baslik)) return null;
  const yasak = new Set([...AD_OLMAZ, ...ekYasak.flatMap((s) => translit(s).split(' ')).filter(Boolean)]);
  const kelimeler = bosluk(baslik).split(/\s+/).filter(Boolean);
  const diziler: Array<{ bas: number; son: number; kelimeler: string[] }> = [];
  let cur: string[] = [];
  let bas = 0;
  const kapat = (son: number) => {
    if (cur.length >= 2 && cur.length <= 4) diziler.push({ bas, son, kelimeler: [...cur] });
    cur = [];
  };
  for (let i = 0; i < kelimeler.length; i++) {
    const ham = kelimeler[i];
    const temiz = ham.replace(/['’`]\S*$/, '').replace(/[.,;:!?()]+$/, '');
    const t = translit(temiz);
    const uygun = temiz.length >= 2 && buyukHarfli(temiz) && t.length >= 2 && !yasak.has(t);
    if (uygun) {
      if (cur.length === 0) bas = i;
      cur.push(temiz);
      // Virgul/apostrof sonrasi dizi biter
      if (/[,;:]$/.test(ham) || APOSTROF.test(ham)) kapat(i);
    } else kapat(i - 1);
  }
  kapat(kelimeler.length - 1);
  if (diziler.length === 0) return null;

  const fiilIdx = kelimeler.findIndex((k) => ATAMA_FIILI.test(translit(k)));
  let secim = fiilIdx > 0 ? diziler.find((d) => d.son === fiilIdx - 1) : undefined;
  if (!secim) secim = diziler.find((d) => d.bas === 0);
  if (!secim) return null;
  const { ad, soyad } = splitName(secim.kelimeler.join(' '));
  if (!ad || !soyad) return null;
  return { ad, soyad };
}

// ─── Ag ─────────────────────────────────────────────────────────────────────

/** Her istekten sonra insan hizina yakin bekleme (kaynak sunucusuna saygi) */
async function get(url: string): Promise<string> {
  const html = await fetchText(url, { timeoutMs: 25_000 });
  await sleep(jitter(400, 1200));
  return html;
}

/**
 * Hata → log'a basilabilir kisa kod. NEDEN: fetchText mesaji URL icerir; log'a
 * yalniz kaynak + HTTP durumu (ya da hata turu) yazilir, haber/sayfa URL'si yazilmaz.
 */
export function hataKodu(e: unknown): string {
  const err = (e ?? {}) as { name?: string; message?: string };
  const m = /HTTP (\d{3})/.exec(err.message ?? '');
  if (m) return `HTTP ${m[1]}`;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'zaman asimi';
  if (err.name === 'SyntaxError') return 'yanit JSON degil';
  return err.name || 'hata';
}

/** Hata kodlarini sayar; ozet tek satirda: "HTTP 404 ×2, zaman asimi ×1" */
class HataSayaci {
  private readonly sayilar = new Map<string, number>();
  ekle(e: unknown): void { const k = hataKodu(e); this.sayilar.set(k, (this.sayilar.get(k) ?? 0) + 1); }
  get toplam(): number { let n = 0; for (const v of this.sayilar.values()) n += v; return n; }
  ozet(): string { return [...this.sayilar.entries()].map(([k, n]) => `${k} ×${n}`).join(', '); }
}

// ─── (a) KAP genel sayfasi ──────────────────────────────────────────────────

const KAP_PERSONEL_KEY = /kpy41_acc\d+_yonetimde_soz_sahibi/;
/**
 * KAP genel sayfasi Next.js RSC yuku icinde JSON tasir; tirnaklar kacisli
 * (\"nameSurname\":\"...\"). "Yonetimde Soz Sahibi Olan Personel" tablosunun
 * satirlari: nameSurname, tcknYkn, credentialKey, title (Gorevi) sirasiyla.
 */
export function kapPersonelParcala(html: string): Array<{ isim: string; unvan: string }> {
  const m = KAP_PERSONEL_KEY.exec(html);
  if (!m) return [];
  const sonra = html.slice(m.index + m[0].length);
  const bitis = sonra.search(/\\?"itemKey\\?"/);
  const dilim = bitis > 0 ? sonra.slice(0, bitis) : sonra.slice(0, 200_000);
  const satirRe = /\\?"nameSurname\\?"\s*:\s*\\?"([^"\\]{2,120})[\s\S]{0,400}?\\?"title\\?"\s*:\s*\\?"([^"\\]{2,240})/g;
  const out: Array<{ isim: string; unvan: string }> = [];
  for (const s of dilim.matchAll(satirRe)) {
    const isim = bosluk(s[1]);
    const unvan = bosluk(s[2]);
    if (isim && unvan) out.push({ isim, unvan });
  }
  return out;
}

/**
 * KAP genel sayfasindaki "Internet Adresi" (itemKey kpy41_acc1_int_addres) → alan adi; yoksa/gecersizse ''.
 * NEDEN: 03-desen alan adi ister; KAP firmalarinda 01 --kap-detail kosulmadiysa web bos.
 */
export function kapWebParcala(html: string): string {
  const ham = html.match(/kpy41_acc1_int_addres\\?",\\?"value\\?":\\?"([^"\\]+)/)?.[1] ?? '';
  return normalizeDomain(ham) ?? '';
}

/** kaynakUrl/kapStockCode'dan KAP kimligi: member/filter/<stockCode> veya sirket-bilgileri/genel/<permaLink> */
export function kapKimlik(urls: string[], kapStockCode = ''): { stockCode?: string; permaLink?: string } | null {
  for (const u of urls) {
    const genel = u.match(/\/sirket-bilgileri\/genel\/([^/?#]+)/);
    if (genel) return { permaLink: genel[1] };
    const filtre = u.match(/\/api\/member\/filter\/([^/?#]+)/);
    if (filtre) return { stockCode: decodeURIComponent(filtre[1]) };
  }
  const kod = bosluk(kapStockCode);
  if (kod) return { stockCode: kod };
  return null;
}

export interface KapListeKaydi { unvan: string; stockCode: string | null; mkkMemberOid: string; tip: string }
/** ilk: ilk ayirt edici kelime → kayit; listede birden cok kayitta geciyorsa null (belirsiz) */
export interface KapIndeks { tam: Map<string, KapListeKaydi>; yasal: Map<string, KapListeKaydi>; ilk: Map<string, KapListeKaydi | null> }

const KAP_TIPLERI = ['IGS', 'YK', 'PYS', 'BDK'] as const;

/** 4 KAP listesinden translit tam ad, hukuki eki atilmis ad ve ilk ayirt edici kelime → kayit indeksi */
export function kapIndeksOlustur(kayitlar: KapListeKaydi[]): KapIndeks {
  const tam = new Map<string, KapListeKaydi>();
  const yasal = new Map<string, KapListeKaydi>();
  const ilk = new Map<string, KapListeKaydi | null>();
  for (const k of kayitlar) {
    const p = firmaParcala(k.unvan);
    if (!p) continue;
    if (!tam.has(p.tam)) tam.set(p.tam, k);
    const y = p.yasal.join(' ');
    if (y && !yasal.has(y)) yasal.set(y, k);
    // NEDEN jenerik ilk kelime atlanir: "TURKIYE GARANTI BANKASI" da 'garanti' adayi olsun ki
    // "GARANTI FAKTORING" ile belirsizlik gorulsun (tek kayit sanilip yanlis eslesmesin)
    const ilkKelime = (JENERIK_ILK.has(p.cekirdek[0] ?? '') ? p.cekirdek[1] : p.cekirdek[0]) ?? '';
    if (ilkKelime.length >= 4 && !ANAHTAR_YASAK.has(ilkKelime)) ilk.set(ilkKelime, ilk.has(ilkKelime) ? null : k);
  }
  return { tam, yasal, ilk };
}

/**
 * Firma adini KAP listesinde bul: (1) tam ad, (2) hukuki eki atilmis ad,
 * (3) tek kelimelik marka adi listede TEK kayitta ilk kelime ise ("Otokar" →
 * "OTOKAR OTOMOTIV VE SAVUNMA SANAYI A.S."). NEDEN 3: 01 birlestirmede Fortune'un
 * kisa marka adi kalabiliyor; belirsiz ilk kelime ("garanti") asla eslesmez.
 */
export function kapKimlikBul(firma: string, indeks: KapIndeks): KapListeKaydi | null {
  const p = firmaParcala(firma);
  if (!p) return null;
  const hit = indeks.tam.get(p.tam) ?? indeks.yasal.get(p.yasal.join(' '));
  if (hit) return hit;
  const ilkKelime = p.cekirdek[0] ?? '';
  if (p.cekirdek.length === 1 && ilkKelime.length >= 4) return indeks.ilk.get(ilkKelime) ?? null;
  return null;
}

/**
 * Listeleri bir kez yukler. NEDEN: 01 varsayilan ciktisinda kaynakUrl liste
 * URL'sidir (/api/company/items/IGS/A) — kimlik tasimaz; firma adi ile listeden
 * stockCode/mkkMemberOid bulunur. Bir liste dusse de digerleri kullanilir.
 */
async function kapListeYukle(ctx: Ctx): Promise<KapIndeks> {
  const kayitlar: KapListeKaydi[] = [];
  const hatalar = new HataSayaci();
  for (const tip of KAP_TIPLERI) {
    try {
      const liste = JSON.parse(await get(`https://www.kap.org.tr/tr/api/company/items/${tip}/A`)) as Array<{
        kapMemberTitle?: string; stockCode?: string | null; mkkMemberOid?: string;
      }>;
      if (!Array.isArray(liste)) throw new SyntaxError('liste dizi degil');
      for (const it of liste) {
        const unvan = bosluk(it.kapMemberTitle ?? '');
        if (unvan && it.mkkMemberOid) kayitlar.push({ unvan, stockCode: it.stockCode || null, mkkMemberOid: it.mkkMemberOid, tip });
      }
    } catch (e) {
      hatalar.ekle(e);
    }
  }
  if (hatalar.toplam) ctx.log(`kap UYARI: ${hatalar.toplam} liste yuklenemedi (${hatalar.ozet()})`);
  ctx.log(`kap: liste indeksi ${kayitlar.length} kayit`);
  return kapIndeksOlustur(kayitlar);
}

/** stockCode (ya da BDK gibi kodsuzlarda unvanin ilk kelimesi) → member/filter → permaLink */
async function kapPermaLink(kayit: KapListeKaydi): Promise<string | undefined> {
  // NEDEN: stockCode "GRM, GRYAT" gibi coklu olabilir; ilki yeter
  const q = (kayit.stockCode ?? '').split(',')[0].trim() || kayit.unvan.split(' ')[0];
  if (!q) return undefined;
  const liste = JSON.parse(await get(`https://www.kap.org.tr/tr/api/member/filter/${encodeURIComponent(q)}`)) as Array<{
    mkkMemberOid?: string; title?: string; permaLink?: string;
  }>;
  if (!Array.isArray(liste)) return undefined;
  // NEDEN: filter ucu metin aramasi yapar (ACA → birden cok sonuc); mkkMemberOid ile kesin eslesme
  const hit = liste.find((x) => x.mkkMemberOid === kayit.mkkMemberOid)
    ?? liste.find((x) => translit(x.title ?? '') === translit(kayit.unvan))
    ?? (kayit.stockCode ? liste[0] : undefined);
  return hit?.permaLink;
}

const SEKTOR_SIRA: Record<string, number> = { 'turizm-havayolu-telekom-otomotiv': 0, 'eticaret-perakende-teknoloji': 1, finans: 2 };
const KAP_TIP_SIRA = (f: Firma): number => (f.kaynaklar.includes('kap-igs') ? 0 : f.kaynaklar.includes('kap-yk') ? 1 : f.kaynaklar.includes('kap-pys') ? 2 : 3);

async function kapKaynak(firmalar: Firma[], ctx: Ctx): Promise<Kisi[]> {
  const kapli = firmalar.filter((f) => f.kaynaklar.some((k) => k.startsWith('kap')));
  // NEDEN: 'diger'/bos sektor hedef disi (manuel listeye de girmez); istek harcanmaz
  const hedef = kapli.filter((f) => f.sektor && f.sektor !== 'diger');
  // NEDEN siralama: --limit ile deneme kosumunda pazarlama GMY'si olasi firmalar (hedef sektor,
  // Fortune 500'de de gecen, borsa sirketi) once gelsin; sira deterministik.
  hedef.sort((a, b) =>
    (SEKTOR_SIRA[a.sektor] ?? 9) - (SEKTOR_SIRA[b.sektor] ?? 9)
    || Number(!a.kaynaklar.includes('fortune')) - Number(!b.kaynaklar.includes('fortune'))
    || KAP_TIP_SIRA(a) - KAP_TIP_SIRA(b)
    || a.firma.localeCompare(b.firma, 'tr'));
  ctx.log(`kap: ${kapli.length} firma KAP kaynakli, ${kapli.length - hedef.length} hedef disi sektor (diger/bos) atlandi, ${hedef.length} islenecek`);
  if (hedef.length === 0) return [];
  const out: Kisi[] = [];
  const hatalar = new HataSayaci();
  let islenen = 0;
  let kimlikYok = 0;
  let kimlikli = 0;
  let parseSifir = 0;
  let webBulunan = 0;
  let indeks: KapIndeks | null = null;
  for (const f of hedef) {
    if (ctx.limit !== null && islenen >= ctx.limit) break;
    islenen++;
    try {
      let kimlik = kapKimlik(f.kaynakUrl, f.kapStockCode);
      let kayit: KapListeKaydi | null = null;
      if (!kimlik) {
        if (!indeks) indeks = await kapListeYukle(ctx);
        kayit = kapKimlikBul(f.firma, indeks);
        if (!kayit) { kimlikYok++; continue; }
        kimlik = { stockCode: kayit.stockCode ?? undefined };
      }
      let permaLink = kimlik.permaLink;
      if (!permaLink) {
        permaLink = await kapPermaLink(kayit ?? { unvan: f.firma, stockCode: kimlik.stockCode ?? null, mkkMemberOid: '', tip: '' });
      }
      if (!permaLink) { kimlikYok++; continue; }
      kimlikli++;
      const url = `https://www.kap.org.tr/tr/sirket-bilgileri/genel/${permaLink}`;
      const html = await get(url);
      const satirlar = kapPersonelParcala(html);
      const kapWeb = kapWebParcala(html);
      if (kapWeb) webBulunan++;
      if (satirlar.length === 0) { parseSifir++; continue; }
      for (const s of satirlar) {
        if (!unvanUygunMu(s.unvan)) continue;
        const { ad, soyad } = splitName(s.isim);
        if (!ad || !soyad) continue;
        out.push({
          firma: f.firma, web: kapWeb || f.web, ad, soyad, unvan: s.unvan, kademe: kademe(s.unvan),
          kaynak: 'kap', kaynakUrl: url, kaynakTarihi: '', guven: 'yuksek',
        });
      }
    } catch (e) {
      hatalar.ekle(e);
    }
  }
  if (hatalar.toplam) ctx.log(`kap UYARI: ${hatalar.toplam} firma hata ile atlandi (${hatalar.ozet()})`);
  if (kimlikYok) ctx.log(`kap: ${kimlikYok} firmada stockCode/permaLink bulunamadi, atlandi`);
  if (islenen > 0 && kimlikli === 0) ctx.log('kap UYARI (KRITIK): hicbir KAP firmasi kimlik alamadi — liste API/permaLink akisi kirik olabilir');
  if (parseSifir) ctx.log(`kap: ${parseSifir} sayfada "Yonetimde Soz Sahibi" tablosu bos ya da yok (KAP'ta doldurulmamis; parser hatasi degil)`);
  ctx.log(`kap: islenen ${islenen} firma (kimlikli ${kimlikli}, web adresi bulunan ${webBulunan}), bulunan ${out.length} uygun unvan`);
  return out;
}

// ─── (b) Marketing Turkiye "Atamalar" arsivi ────────────────────────────────

const MT_ARSIV = 'https://www.marketingturkiye.com.tr/kategori/atamalar/page/';

function mtListe(html: string): Array<{ url: string; baslik: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ url: string; baslik: string }> = [];
  $('.post-title h3 a[href]').each((_, a) => {
    const url = ($(a).attr('href') ?? '').split('#')[0];
    const baslik = bosluk($(a).text());
    if (/marketingturkiye\.com\.tr\/haberler\//.test(url) && baslik) out.push({ url, baslik });
  });
  return out;
}

/** "Ilgili Haberler / Benzer Haberler" gibi govde ici liste basliklari — sonrasi okunmaz */
const MT_DUR_RE = /^(ilgili|benzer|diger haberler|bunlar da|bunlari da|one cikan|en cok okunan|son haberler|populer)/;

/**
 * Yazi sayfasi: tarih (article:published_time) + baslik adaylari (og:title + govde basliklari).
 * NEDEN govde kisiti: h2/h3 yalniz yazi govdesinden (.post-content/.entry-content) alinir;
 * ilgili/benzer yazi kutulari (.related, .yarpp, .thb-related-posts) atilir, "Ilgili ..."
 * basligindan sonrasi okunmaz — baska haberlerin basliklari atama sanilmasin.
 */
export function mtYazi(html: string): { tarih: string; basliklar: string[] } {
  const tarih = html.match(/article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
  const $ = cheerio.load(html);
  const basliklar: string[] = [];
  const og = bosluk($('meta[property="og:title"]').attr('content') ?? '').split(' | ')[0];
  if (og) basliklar.push(og);
  const govde = $('.post-content').first().length ? $('.post-content').first() : $('.entry-content').first();
  govde.find('.related, .yarpp, .thb-related-posts, [class*="related"], [class*="ilgili"], [class*="benzer"], aside, footer').remove();
  let dur = false;
  govde.find('h2, h3, h4').each((_, h) => {
    if (dur) return;
    const t = bosluk($(h).text());
    if (MT_DUR_RE.test(translit(t))) { dur = true; return; }
    if (t && t.length >= 10 && t.length <= 220) basliklar.push(t);
  });
  return { tarih, basliklar: [...new Set(basliklar)] };
}

/** 2024 oncesi haber "eski atama" sayilir → guven dusuk (plan Faz 2) */
export function tarihGuven(tarih: string): Guven {
  const yil = Number(tarih.slice(0, 4));
  return Number.isFinite(yil) && yil >= 2024 ? 'orta' : 'dusuk';
}

async function marketingTurkiyeKaynak(
  firmalar: Firma[],
  ctx: Ctx,
): Promise<{ kisiler: Kisi[]; eslesmeyen: Array<Record<string, string>> }> {
  const kisiler: Kisi[] = [];
  const eslesmeyen: Array<Record<string, string>> = [];
  const gorulen = new Set<string>();
  const hatalar = new HataSayaci();
  let islenen = 0;
  let parseSifir = 0;
  let negatif = 0;

  for (let sayfa = 1; sayfa <= ctx.pages; sayfa++) {
    if (ctx.limit !== null && islenen >= ctx.limit) break;
    let liste: Array<{ url: string; baslik: string }>;
    try {
      liste = mtListe(await get(`${MT_ARSIV}${sayfa}/`));
    } catch (e) {
      ctx.log(`marketing-turkiye UYARI sayfa ${sayfa} atlandi: ${hataKodu(e)}`);
      continue;
    }
    if (liste.length === 0) { ctx.log(`marketing-turkiye UYARI: sayfa ${sayfa} parse 0 sonuc (secici degismis olabilir)`); continue; }
    ctx.log(`marketing-turkiye: sayfa ${sayfa} → ${liste.length} yazi`);

    for (const y of liste) {
      if (ctx.limit !== null && islenen >= ctx.limit) break;
      if (gorulen.has(y.url)) continue;
      gorulen.add(y.url);
      islenen++;
      let yazi: { tarih: string; basliklar: string[] };
      try {
        yazi = mtYazi(await get(y.url));
      } catch (e) {
        hatalar.ekle(e);
        continue;
      }
      if (yazi.basliklar.length === 0) { parseSifir++; continue; }
      const guven = tarihGuven(yazi.tarih);
      for (const baslik of yazi.basliklar) {
        // NEDEN once ayrilis kontrolu: "gorevinden ayrildi" basligi eslesmeyen listesine bile girmesin
        if (negatifFiilVarMi(baslik)) { negatif++; continue; }
        const d = unvanCikarDetay(baslik);
        if (!d) continue;
        const f = hedefFirmaEslestir(baslik, d.konum, firmalar);
        if (!f) {
          // NEDEN: unvani pazarlama tarafinda ama firmasi listemizde yok — elle bakilsin
          eslesmeyen.push({ baslik, tarih: yazi.tarih, url: y.url });
          continue;
        }
        const kisi = adCikar(baslik, [f.firma, d.unvan]);
        if (!kisi) continue;
        const temizUnvan = unvanEkiAt(firmayiKirp(d.unvan, f.anahtarlar));
        kisiler.push({
          firma: f.firma, web: f.web, ad: kisi.ad, soyad: kisi.soyad, unvan: temizUnvan, kademe: kademe(temizUnvan),
          kaynak: 'marketing-turkiye', kaynakUrl: y.url, kaynakTarihi: yazi.tarih, guven,
        });
      }
    }
  }
  if (hatalar.toplam) ctx.log(`marketing-turkiye UYARI: ${hatalar.toplam} yazi hata ile atlandi (${hatalar.ozet()})`);
  if (parseSifir) ctx.log(`marketing-turkiye UYARI: ${parseSifir} yazida baslik parse 0 sonuc`);
  ctx.log(`marketing-turkiye: islenen ${islenen} yazi, ${negatif} ayrilis basligi atlandi, bulunan ${kisiler.length} isim, ${eslesmeyen.length} eslesmedi`);
  return { kisiler, eslesmeyen };
}

// ─── (c) Fortune "En Etkin 50 CMO" ──────────────────────────────────────────

const FORTUNE_URL = 'https://www.fortuneturkey.com/turkiyenin-en-etkin-50-cmosu';
/** NEDEN sabit tarih: sayfada yayin tarihi yok; gorsel yollari 2022/04 → guven dusuk */
const FORTUNE_TARIH = '2022';

async function fortuneKaynak(firmalar: Firma[], ctx: Ctx): Promise<Kisi[]> {
  let html: string;
  try {
    html = await get(FORTUNE_URL);
  } catch (e) {
    ctx.log(`fortune UYARI atlandi: ${hataKodu(e)}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out: Kisi[] = [];
  let toplam = 0;
  let islenen = 0;
  let eslesmeyen = 0;
  $('.lhea-member-name').each((_, el) => {
    if (ctx.limit !== null && islenen >= ctx.limit) return false;
    const isim = bosluk($(el).text());
    const pozisyon = bosluk($(el).parent().find('.lhea-member-position').first().text());
    if (!isim || !pozisyon) return;
    toplam++;
    islenen++;
    const f = firmaEslestir(pozisyon, firmalar);
    if (!f) { eslesmeyen++; return; }
    // Pozisyon metni "Firma + Unvan" birlesik; bastaki firma adini kirp, iyelik ekini at ("CMO'su" → "CMO")
    const unvan = unvanEkiAt(firmayiKirp(pozisyon, f.anahtarlar));
    if (!unvanUygunMu(unvan)) return;
    const { ad, soyad } = splitName(isim);
    if (!ad || !soyad) return;
    out.push({
      firma: f.firma, web: f.web, ad, soyad, unvan, kademe: kademe(unvan),
      kaynak: 'fortune', kaynakUrl: FORTUNE_URL, kaynakTarihi: FORTUNE_TARIH, guven: 'dusuk',
    });
  });
  if (toplam === 0) ctx.log('fortune UYARI: parse 0 sonuc (.lhea-member-name secicisi degismis olabilir)');
  ctx.log(`fortune: islenen ${islenen} kayit, ${eslesmeyen} firma eslesmedi, bulunan ${out.length} uygun unvan`);
  return out;
}

// ─── (d) TODEB uye sayfalari ────────────────────────────────────────────────

/** Kart metninde "Genel Mudur / Yetkili / Temsilci: Ad Soyad" kalibi */
const TODEB_KISI_RE = /(Genel\s+M[üu]d[üu]r[^:\n]{0,20}|Yetkili[^:\n]{0,20}|Temsilci[^:\n]{0,20})\s*:?\s*([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+){1,3})/g;

async function todebKaynak(firmalar: Firma[], ctx: Ctx): Promise<Kisi[]> {
  const hedef = firmalar.filter((f) => f.kaynaklar.includes('todeb'));
  ctx.log(`todeb: ${hedef.length} firma TODEB kaynakli`);
  if (hedef.length === 0) return [];
  const sayfalar = [...new Set(hedef.flatMap((f) => f.kaynakUrl).filter((u) => /todeb\.org\.tr/.test(u)))];
  const out: Kisi[] = [];
  const hatalar = new HataSayaci();
  let islenen = 0;
  let kart = 0;
  for (const url of sayfalar) {
    if (ctx.limit !== null && islenen >= ctx.limit) break;
    islenen++;
    let html: string;
    try {
      html = await get(url);
    } catch (e) {
      hatalar.ekle(e);
      continue;
    }
    const $ = cheerio.load(html);
    $('.flexCerceve').each((_, el) => {
      const firmaAdi = bosluk($(el).find('h2').first().text());
      if (!firmaAdi) return;
      kart++;
      const f = firmaEslestir(firmaAdi, hedef);
      if (!f) return;
      const metin = bosluk($(el).text());
      for (const m of metin.matchAll(TODEB_KISI_RE)) {
        const unvan = bosluk(m[1]) || 'Genel Müdür';
        const { ad, soyad } = splitName(bosluk(m[2]));
        if (!ad || !soyad) continue;
        out.push({
          firma: f.firma, web: f.web, ad, soyad, unvan, kademe: 1,
          kaynak: 'todeb', kaynakUrl: url, kaynakTarihi: '', guven: 'orta',
        });
      }
    });
  }
  if (hatalar.toplam) ctx.log(`todeb UYARI: ${hatalar.toplam} sayfa hata ile atlandi (${hatalar.ozet()})`);
  if (out.length === 0) {
    // NEDEN: 28.08.2026 itibariyla TODEB uye kartlari yalniz telefon/adres/web
    // gosteriyor; "Temsilciler" listesi sube/acente kayitlari (yonetici degil).
    ctx.log(`todeb UYARI: ${kart} kartta yonetici adi parse 0 sonuc (kartlarda kisi adi yayinlanmiyor)`);
  }
  ctx.log(`todeb: islenen ${islenen} sayfa, bulunan ${out.length} isim`);
  return out;
}

// ─── Girdi / cikti ──────────────────────────────────────────────────────────

/** Firma nesnesi kur (anahtarlar dahil). NEDEN disari acik: testler ve firmalariOku ayni yolu kullansin */
export function firmaYap(firma: string, alanlar: Partial<Omit<Firma, 'firma' | 'anahtarlar'>> = {}): Firma {
  return {
    firma: bosluk(firma),
    sektor: alanlar.sektor ?? '',
    altsektor: alanlar.altsektor ?? '',
    // NEDEN: gecersiz web '' olsun, ham metin degil (03-desen alan adi bekler)
    web: normalizeDomain(alanlar.web ?? '') ?? '',
    kaynaklar: alanlar.kaynaklar ?? [],
    kaynakUrl: alanlar.kaynakUrl ?? [],
    kapStockCode: bosluk(alanlar.kapStockCode ?? ''),
    anahtarlar: firmaAnahtarlari(firma),
  };
}

function firmalariOku(dosya: string): Firma[] {
  const rows = readCsv(dosya);
  const out: Firma[] = [];
  const bol = (s: string | undefined) => bosluk(s ?? '').split('|').map((x) => x.trim()).filter(Boolean);
  for (const r of rows) {
    const firma = bosluk(r.firma ?? '');
    if (!firma) continue;
    out.push(firmaYap(firma, {
      sektor: bosluk(r.sektor ?? ''),
      altsektor: bosluk(r.altsektor ?? ''),
      web: r.web ?? '',
      kaynaklar: bol(r.kaynaklar),
      kaynakUrl: bol(r.kaynakUrl),
      kapStockCode: r.kapStockCode ?? '',
    }));
  }
  return out;
}

export function linkedinAramaUrl(firma: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${firma} Pazarlama Direktörü`)}`;
}

/**
 * Ayni kisi tek satir. Anahtar: cekirdek firma (hukuki/jenerik ek atilmis) + slug(ad) + slug(soyad).
 * NEDEN cekirdek: KAP "TURKCELL ILETISIM HIZMETLERI A.S." ile Fortune "Turkcell" ayni firmadir.
 * Catismada kaynak oncelik KAP > MT > Fortune > TODEB (KAP satiri kalir).
 */
export function kisileriBirlestir(kisiler: Kisi[]): Kisi[] {
  const harita = new Map<string, Kisi>();
  for (const k of kisiler) {
    const anahtar = `${firmaCekirdek(k.firma) || translit(k.firma)}|${slugName(k.ad)}|${slugName(k.soyad)}`;
    const mevcut = harita.get(anahtar);
    if (!mevcut || KAYNAK_ONCELIK[k.kaynak] < KAYNAK_ONCELIK[mevcut.kaynak]) harita.set(anahtar, k);
  }
  return [...harita.values()];
}

// ─── main ───────────────────────────────────────────────────────────────────

const TUM_KAYNAKLAR: KaynakAd[] = ['kap', 'marketing-turkiye', 'fortune', 'todeb'];
const KAYNAK_TAKMA: Record<string, KaynakAd> = {
  kap: 'kap',
  mt: 'marketing-turkiye',
  'marketing-turkiye': 'marketing-turkiye',
  marketingturkiye: 'marketing-turkiye',
  fortune: 'fortune',
  todeb: 'todeb',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] === true;
  const overwrite = args.overwrite === true;
  const limit = typeof args.limit === 'string' ? Number(args.limit) : null;
  const pages = typeof args.pages === 'string' ? Number(args.pages) : VARSAYILAN_SAYFA;
  const input = typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : path.join(DATA_DIR, 'firmalar.csv');
  const only = typeof args.only === 'string'
    ? args.only.split(',').map((s) => KAYNAK_TAKMA[s.trim().toLowerCase()]).filter(Boolean)
    : null;
  const secili = only && only.length > 0 ? TUM_KAYNAKLAR.filter((k) => only.includes(k)) : TUM_KAYNAKLAR;

  const firmalar = firmalariOku(input);
  if (firmalar.length === 0) {
    console.error(`Firma listesi bos veya bulunamadi: ${input}\nOnce 01-firmalar.ts kosun ya da --input ile tohum CSV verin.`);
    process.exit(1);
  }
  const ctx: Ctx = {
    limit: Number.isFinite(limit) && (limit ?? 0) > 0 ? limit : null,
    pages: Number.isFinite(pages) && pages > 0 ? pages : VARSAYILAN_SAYFA,
    log: (m) => console.log(`  ${m}`),
  };
  // NEDEN kismi: alt kume kaynak, islem siniri ya da sig arsiv → tam ciktinin ustune yazilmaz
  const kismi = secili.length < TUM_KAYNAKLAR.length
    || ctx.limit !== null
    || (secili.includes('marketing-turkiye') && ctx.pages < VARSAYILAN_SAYFA);
  const sonek = kismi && !overwrite ? '.partial' : '';
  console.log(`Girdi: ${input} → ${firmalar.length} firma`);
  console.log(`Kaynaklar: ${secili.join(', ')}${ctx.limit ? ` | limit ${ctx.limit} islem/kaynak` : ''} | mt sayfa ${ctx.pages}${kismi ? ` | KISMI kosum${overwrite ? ' (--overwrite)' : ''}` : ''}${dryRun ? ' | DRY-RUN' : ''}`);

  const hepsi: Kisi[] = [];
  const eslesmeyen: Array<Record<string, string>> = [];
  const kaynakSayi: Record<string, number> = {};

  for (const k of secili) {
    console.log(`\n[${k}]`);
    try {
      if (k === 'kap') { const r = await kapKaynak(firmalar, ctx); kaynakSayi[k] = r.length; hepsi.push(...r); }
      else if (k === 'marketing-turkiye') {
        const r = await marketingTurkiyeKaynak(firmalar, ctx);
        kaynakSayi[k] = r.kisiler.length; hepsi.push(...r.kisiler); eslesmeyen.push(...r.eslesmeyen);
      } else if (k === 'fortune') { const r = await fortuneKaynak(firmalar, ctx); kaynakSayi[k] = r.length; hepsi.push(...r); }
      else { const r = await todebKaynak(firmalar, ctx); kaynakSayi[k] = r.length; hepsi.push(...r); }
    } catch (e) {
      // NEDEN: bir kaynak kirilirsa digerleri calismaya devam etsin
      console.warn(`  UYARI ${k} tamamen atlandi: ${hataKodu(e)}`);
      kaynakSayi[k] = 0;
    }
  }

  const kisiler = kisileriBirlestir(hepsi);
  const kapsananFirma = new Set(kisiler.map((k) => firmaCekirdek(k.firma) || translit(k.firma)));
  // NEDEN: manuel liste yalniz hedef sektor firmalari; 'diger'/bos sektor elle aranmaz
  const hedefFirmalar = firmalar.filter((f) => f.sektor && f.sektor !== 'diger');
  const manuel = hedefFirmalar
    .filter((f) => !kapsananFirma.has(firmaCekirdek(f.firma) || translit(f.firma)))
    .map((f) => ({ firma: f.firma, web: f.web, sektor: f.sektor, linkedinAramaUrl: linkedinAramaUrl(f.firma) }));

  // NEDEN titleCaseTr yazarken: KAP adlari BUYUK HARF ("ALI TAHA KOC"); e-posta/hitap icin "Ali Taha Koc"
  const kisiRows = kisiler.map((k) => ({ ...k, ad: titleCaseTr(k.ad), soyad: titleCaseTr(k.soyad) }));
  const kisilerFile = path.join(DATA_DIR, `kisiler${sonek}.csv`);
  const manuelFile = path.join(DATA_DIR, `manuel-liste${sonek}.csv`);
  const eslesmeyenFile = path.join(DATA_DIR, `atamalar-eslesmeyen${sonek}.csv`);
  const dosyaOzeti = `${kisilerFile} (${kisiRows.length}), ${manuelFile} (${manuel.length}), ${eslesmeyenFile} (${eslesmeyen.length})`;
  if (dryRun) {
    console.log(`\nDRY-RUN: dosya yazilmadi; yazilacaktı: ${dosyaOzeti}`);
  } else {
    writeCsv(kisilerFile, kisiRows, KISI_COLUMNS);
    writeCsv(manuelFile, manuel, MANUEL_COLUMNS);
    writeCsv(eslesmeyenFile, eslesmeyen, ESLESMEYEN_COLUMNS);
    console.log(`\nYazildi: ${dosyaOzeti}`);
    if (sonek) console.log('  NOT: kismi kosum → *.partial.csv; tam adlara yazmak icin --overwrite');
  }

  // ─── Ozet (YALNIZ sayilar — isim/unvan basilmaz, KVKK) ───
  const k1 = kisiler.filter((k) => k.kademe === 1).length;
  const kapsananHedef = hedefFirmalar.filter((f) => kapsananFirma.has(firmaCekirdek(f.firma) || translit(f.firma))).length;
  const kapsam = hedefFirmalar.length > 0 ? Math.round((kapsananHedef / hedefFirmalar.length) * 1000) / 10 : 0;
  console.log('\n─── Ozet ───');
  for (const k of secili) console.log(`  ${k}: ${kaynakSayi[k] ?? 0} isim (tekillestirme oncesi)`);
  console.log(`  Tekil kisi: ${kisiler.length} (yinelenen ${hepsi.length - kisiler.length} elendi)`);
  console.log(`  Kademe: 1 → ${k1}, 2 → ${kisiler.length - k1}`);
  console.log(`  Guven: yuksek ${kisiler.filter((k) => k.guven === 'yuksek').length}, orta ${kisiler.filter((k) => k.guven === 'orta').length}, dusuk ${kisiler.filter((k) => k.guven === 'dusuk').length}`);
  console.log(`  Web adresi olan kisi satiri: ${kisiler.filter((k) => k.web).length}/${kisiler.length}`);
  console.log(`  Hedef sektor firma kapsama: ${kapsananHedef}/${hedefFirmalar.length} (%${kapsam}) | manuel liste ${manuel.length}`);
  console.log(`  Eslesmeyen atama haberi: ${eslesmeyen.length}`);
}

// NEDEN: dosya dogrudan kosuldugunda main; import edilirse (test) yalniz saf fonksiyonlar
const dogrudan = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (dogrudan) {
  main().catch((e) => {
    console.error(hataKodu(e));
    process.exit(1);
  });
}
