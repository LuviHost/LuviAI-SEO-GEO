/**
 * Kurumsal e-posta sablon katmani — 06-mailjet (CLI) ve sunucudaki EpostaKampanyaService ORTAK kullanir.
 * NEDEN tek yer: konu satiri, kisa marka adi, isimsiz hitap ve yasal kimlik satiri iki yerde ayri evrilirse
 * panelden giden mail ile CLI'dan giden mail farkli olur; yasal alanlarin (md. 5/1, ret linki) birinde
 * unutulmasi riski dogar. Kural ve gerekceler asagida, testler 06-mailjet.spec.ts + eposta-sablon.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SEKTORLER } from './prospect-utils.js';

const HTML_DIR = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-html');
const MD_FILE = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-sablonlari.md');
/** Konu satiri ust siniri (kurumsal-mail-sablonlari.md §1) — asarsa mobil onizlemede kesilir */
export const KONU_MAX = 60;

/** Sektor → sablon anahtari, md basligi, sektor-geneli varsayilan soru ve okunur ad */
export const SEKTOR_META: Record<string, { html: string; mdBaslik: string; soru: string; ad: string }> = {
  finans: { html: 'kurumsal-finans.html', mdBaslik: 'Şablon A', soru: 'bu alanda hangi şirketi önerirsin', ad: 'finans' },
  'eticaret-perakende-teknoloji': { html: 'kurumsal-eticaret.html', mdBaslik: 'Şablon B', soru: 'telefon almak için hangi site güvenilir', ad: 'e-ticaret ve perakende' },
  'turizm-havayolu-telekom-otomotiv': { html: 'kurumsal-turizm.html', mdBaslik: 'Şablon C', soru: 'İstanbul-Londra için hangi havayolu', ad: 'seyahat, telekom ve otomotiv' },
  // 27.10.2026: ajanslar is ortagi adayi (Sablon D), uc gruba girmeyen firmalar genel metin (Sablon E)
  ajans: { html: 'kurumsal-ajans.html', mdBaslik: 'Şablon D', soru: 'iyi bir dijital pazarlama ajansı öner', ad: 'ajans' },
  diger: { html: 'kurumsal-genel.html', mdBaslik: 'Şablon E', soru: 'bu alanda hangi şirketi önerirsin', ad: 'genel' },
};

/** Gonderime girebilecek sektorler: karnedeki uc grup + ajans + genel (diger) */
export const GONDERIM_SEKTORLERI: readonly string[] = [...SEKTORLER, 'ajans', 'diger'];

/**
 * Finans alt-sektoru → gercek musteri sorusu. NEDEN: sabit "bana bir dijital banka öner"
 * sigortaciya veya faktoring sirketine gidince mesaj inandiriciligini yitirir; alici kendi
 * isini ilgilendiren soruyu gormeli. Sira onemli:
 *  1) emeklilik EN BASTA: "Garanti Emeklilik", "Ziraat Hayat ve Emeklilik", "Vakıf Emeklilik" gibi adlar
 *     banka markasi tasir; banka deseni once gelseydi emeklilik sirketi "dijital banka" sorusu alirdi.
 *  2) sonra banka/katilim: "Aktif Yatırım Bankası" banka olarak eslesmeli (yatirim degil).
 *  3) "hayat" bankadan SONRA ("Halk Hayat"?) ama "sigorta"dan ONCE: "Anadolu Hayat" kasko sorusu almasin.
 * NEDEN \b(ing|teb)\b: "faktoring", "leasing" de "ing" ile bitiyor; sinirsiz "ing" onlari bankaya cevirirdi.
 * NEDEN [ıi]: ad katla() ile kucultulur (I ve İ → i; bkz. asagida), kucuk yazilmis "Yatırım" ise ı tasir; ikisi de eslesmeli.
 */
const FINANS_SORU: Array<[RegExp, string]> = [
  [/emeklilik/, 'bireysel emeklilik için hangi şirket'],
  [/bank|kat[ıi]l[ıi]m|bbva|\b(teb|ing)\b|garanti|ziraat|yap[ıi] kredi|qnb|denizbank|halkbank|vak[ıi]fbank/, 'bana bir dijital banka öner'],
  [/hayat/, 'bireysel emeklilik için hangi şirket'],
  [/sigorta|reasürans|reasurans/, 'en uygun kasko hangi şirkette'],
  [/faktoring|factoring|finansman|leasing|kiralama/, 'KOBİ için hangi faktoring/finansman kuruluşu'],
  [/yat[ıi]r[ıi]m|portföy|portfoy|menkul|arac[ıi] kurum/, 'hangi aracı kurum'],
  [/ödeme|odeme|e-para|elektronik para|\bpay|pos\b/, 'yurt dışından ödeme almak için hangi kuruluş'],
];

/** CSV'de sektor_sorusu sutunu VARSA o kazanir; yoksa firma adi/sektorden turetilir */
export function sektorSorusu(firma: string, sektor: string, csvSoru?: string): string {
  if (csvSoru && csvSoru.trim()) return csvSoru.trim();
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  if (sektor !== 'finans') return meta.soru;
  // NEDEN katla: 'tr-TR' kucultmesi "FAKTORING" → "faktorıng" yapip /faktoring/ desenini kaciriyordu
  const f = katla(firma);
  for (const [re, soru] of FINANS_SORU) if (re.test(f)) return soru;
  return meta.soru;
}

// ─── Kisa firma adi ─────────────────────────────────────────────────────────

/**
 * Eslestirme icin "katlanmis" kopya: yalniz İ→i, ardindan toLowerCase.
 * NEDEN: ECMAScript /i bayragi U+0130 (İ) ile "i"yi ESLESTIRMEZ ("TİCARET" /ticaret/i'ye takilmaz);
 * ayrica 'İ'.toLowerCase() iki kod birimi ("i̇") uretir ve indeksler kayar. Once İ→i (1:1) yapip
 * sonra toLowerCase cagirinca uzunluk korunur → katlanmis kopyadaki eslesme indeksi orijinale birebir uygulanir.
 * I→ı YAPILMAZ: Latin "I" (NISSAN, MICROSOFT) da "i"ye katlanir; desenler zaten "i" ile yazildi.
 */
function katla(s: string): string {
  return s.replace(/İ/g, 'i').toLowerCase();
}

/**
 * Sondan kirpilacak hukuki ek / genel tanimlayicilar (KATLANMIS bicimde yazildi: İ/I → i).
 * NEDEN \s+ zorunlu: "Tofaş", "Yataş", "Sinpaş" gibi adlar "AŞ" ile bitiyor; onceki `\s*` deseni
 * bunlari "Tof", "Yat" diye kirpiyordu. Bosluk sarti ile yalniz AYRI KELIME olan ek dusuyor.
 * Ilk desen bulgudaki listenin katlanmis hali (A.O. / T.A.O. / "Anonim Ortaklığı" da hukuki ektir:
 * "Türkiye Petrolleri A.O.", "Türk Hava Yolları A.O." gibi); ikincisi unvanlarda kalan "servis / hizmetleri /
 * hiz. / iç ve dış / ticaret merkezi" gibi kuyruklar ve TİCARET dusunce tek basina kalan "ve".
 * "iletişim hizmetleri" / "ürünleri" / "mağazacılık" kuyruklari da marka degil faaliyet tanimidir:
 * "Turkcell İletişim Hizmetleri" → "Turkcell", "Ebebek Mağazacılık" → "Ebebek", "Aztek Teknoloji Ürünleri" → "Aztek Teknoloji".
 * Desenler katlanmis metne uygulanir: Latin I da "i" olur ("DIŞ" → "diş", "MAĞAZACILIK" → "mağazacilik"), o yuzden ı yerine [ıi] yazilir.
 */
const EK_DESENLERI: RegExp[] = [
  /\s+(t\.?a\.?ş\.?|a\.?ş\.?|a\.?s\.?|aş|t\.?a\.?o\.?|a\.?o\.?|anonim ortakl[ıi]ğ[ıi]|anonim şirketi|anonim sirketi|ltd\.?\s*şti\.?|limited şirketi|san(ayi|ayı)?\.? ve tic(aret)?\.?|sanayi|ticaret)\s*$/,
  /\s+(ve|servis|iletişim hizmetleri|hizmetleri|hiz\.?|tic\.|san\.|iç ve d[ıi]ş|ticaret merkezi|ürünleri|mağazac[ıi]l[ıi]k)\s*$/,
  // Ajans unvan kuyruklari (Reklamcilar Dernegi / IDA): "PUNCH BBDO REKLAMCILIK VE İLETİŞİM HİZMETLERİ" → "Punch BBDO"
  /\s+(reklamc[ıi]l[ıi]k|reklam|dan[ıi]şmanl[ıi]k|iletişim|organizasyon|prodüksiyon|yap[ıi]mc[ıi]l[ıi]k)\s*$/,
  /(?<=kat[ıi]l[ıi]m)\s+bankas[ıi]\s*$/, // "Dünya Katılım Bankası" → "Dünya Katılım" (marka boyle anilir); "Yatırım Bankası" kalir
  /\s*\(\d+\)\s*$/, // "Accor otelleri (2)" gibi liste sayaci
];

/**
 * Kural disi marka kisaltmalari (anahtar: katlanmis ad — TAM unvan YA DA ekleri kirpilmis hali; firmaKisa
 * ikisine de bakar). NEDEN: "Kuveyt Türk Katılım Bankası" → marka "Kuveyt Türk" ama "Dünya Katılım Bankası"
 * → "Dünya Katılım"; kuralla ayirt edilemez. Kirpilmis-hal anahtarlari ("JANTSA JANT", "BİLKOM BİLİŞİM")
 * CSV'de "... SANAYİ VE TİCARET A.Ş." / "... HİZMETLERİ A.Ş." gibi ek tasisa da eslessin diye.
 */
const MARKA_KISA: Record<string, string> = Object.fromEntries(
  Object.entries({
    'KUVEYT TÜRK KATILIM BANKASI A.Ş.': 'Kuveyt Türk',
    'CARREFOURSA CARREFOUR SABANCI TİCARET MERKEZİ A.Ş.': 'CarrefourSA',
    'MICROSOFT BİLGİSAYAR YAZILIM HİZ. LTD. ŞTİ.': 'Microsoft',
    'TÜRKİYE GARANTİ BANKASI A.Ş.': 'Garanti BBVA',
    // Ekleri kirpilmis haller (marka, ticari unvanin ilk bir-iki kelimesi):
    'TÜRK TELEKOMÜNİKASYON': 'Türk Telekom',
    'AKSigorta': 'Aksigorta',
    'FAKİR HAUSGERATE': 'Fakir',
    'JANTSA JANT': 'Jantsa',
    'PENTA TEKNOLOJİ ÜRÜNLERİ DAĞITIM': 'Penta Teknoloji',
    'VOLVO CAR TURKEY OTOMOBİL': 'Volvo Car Turkey',
    'YÜCE AUTO MOTORLU ARAÇLAR': 'Yüce Auto',
    'TERA YATIRIM MENKUL DEĞERLER': 'Tera Yatırım',
    'Octet Express Ödeme Kuruluşu': 'Octet Express',
    'BİLKOM BİLİŞİM': 'Bilkom',
    'Accor otelleri': 'Accor',
    'TURKNET İLETİŞİM HİZMETLERİ A.Ş.': 'TurkNet', // NEDEN: CSV'de ayrica "TurkNet" var; iki satir ayni markayi ayni yazsin
  }).map(([k, v]) => [katla(k), v]), // NEDEN katla: arama da katlanmis adla yapilir (I/İ → i)
);

/**
 * Turkce kelime ama Turkce'ye OZGU harf icermiyor (I var, ı/İ yok) → 'en' kucultmesi "Katilim"
 * uretirdi. Kucuk istisna sozlugu: anahtar buyuk harf (CSV'deki gibi), deger dogru baslik hali.
 */
const KELIME_ISTISNA: Record<string, string> = {
  KATILIM: 'Katılım', BANKASI: 'Bankası', YATIRIM: 'Yatırım', SIGORTA: 'Sigorta', FAKTORING: 'Faktoring',
  FINANSMAN: 'Finansman', KIRALAMA: 'Kiralama', HAYAT: 'Hayat', EMEKLILIK: 'Emeklilik', ISUZU: 'Isuzu',
  AKIN: 'Akın', AYAKKABI: 'Ayakkabı', GIDA: 'Gıda', VAKIF: 'Vakıf', YAZILIM: 'Yazılım', SABANCI: 'Sabancı',
  YAPI: 'Yapı', KALKINMA: 'Kalkınma', SANAYI: 'Sanayi', HALKBANK: 'Halkbank', ILETISIM: 'İletişim',
  // NEDEN ek: bunlar da Turkce'ye ozgu harf tasimadan yazilan Turkce kelimeler; 'en' kucultmesi
  // "Vakiflar", "Istanbul", "Yollari", "Kazanci", "Sanayii" uretirdi.
  REKLAMCILIK: 'Reklamcılık', DANISMANLIK: 'Danışmanlık', AJANSI: 'Ajansı', YAPIMCILIK: 'Yapımcılık', DONANIM: 'Donanım', TASARIM: 'Tasarım', TANITIM: 'Tanıtım', YAYINCILIK: 'Yayıncılık',
  VAKIFLAR: 'Vakıflar', VAKIFBANK: 'Vakıfbank', ISTANBUL: 'İstanbul', YOLLARI: 'Yolları', KAZANCI: 'Kazancı', SANAYII: 'Sanayii',
};

/** Kelimede Turkce'ye ozgu harf var mi (Ş Ğ Ü Ö Ç İ ı ve kucukleri) → 'tr' locale ile kucult */
const TR_HARF = /[ŞĞÜÖÇİışğüöç]/;

/**
 * Oldugu gibi kalacak kisaltma/markalar. NEDEN acik liste + ilk-kelime kurali: "2-3 harf buyukse kisaltma"
 * tek basina "ARZUM ELEKTRİKLİ EV ALETLERİ" → "EV", "JIMMY KEY" → "KEY", "SNEAKS UP" → "UP" uretiyordu.
 * Listedekiler her yerde; listede olmayan 2-3 harfli kelime yalniz adin ILK kelimesiyse ve Turkce'ye ozgu
 * harf icermiyorsa kisaltma sayilir (TAB Gıda, TAV, FLO, D&R; "İŞ BANKASI" → "İş Bankası").
 */
const KISALTMA = new Set(['BİM', 'TEB', 'ING', 'QNB', 'TAV', 'TAB', 'FLO', 'THY', 'TSKB', 'HSBC', 'ICBC', 'LCW', 'KFC', 'A101', 'ŞOK', 'MNG', 'PTT', 'TAÇ', 'BBVA', 'D&R', 'UPS', 'DHL', 'BBDO', 'TBWA', 'DDB', 'OMD', 'PHD', 'MRM', 'PR', 'SEO']);

/**
 * Baslik-harfe cevirme — YALNIZ ad tamamen buyuk harfse (karisik yazilmis "LC Waikiki", "PayTR" dokunulmaz).
 * Kelime bazinda: istisna sozlugu > 've'/'ile' kucuk > 2-3 harfli tamami buyuk kisaltma (BİM, TEB, ING,
 * QNB, TAV) oldugu gibi > Turkce'ye ozgu harf varsa 'tr-TR' (DOĞUŞ→Doğuş, İPEKYOL→İpekyol) yoksa 'en'
 * (NISSAN→Nissan, MICROSOFT→Microsoft, QUICK→Quick; 'tr' olsaydi "Nıssan" cikardi).
 * NEDEN tire bazinda: "MERCEDES-BENZ" tek kelime sayilinca "Mercedes-benz" cikiyordu; tireyle ayrilan her
 * parca kendi basina baslik harfi alir (Mercedes-Benz, D-Market). Ilk-kelime kisaltma kurali yalniz adin
 * ilk parcasina uygulanir ("D-MARKET" → "D" kalir, "MARKET" → "Market").
 * NEDEN /^[A-Z&]+$/: "D&R" gibi & iceren kisaltmalar da ilk-kelime kuralina girsin.
 */
function baslikHarf(s: string): string {
  const tamBuyuk = s === s.toLocaleUpperCase('tr-TR') && /[A-ZÇĞİÖŞÜ]/.test(s);
  if (!tamBuyuk) return s;
  const kelime = (w: string, ilk: boolean): string => {
    if (!w) return w;
    if (KELIME_ISTISNA[w]) return KELIME_ISTISNA[w];
    if (w === 'VE') return 've';
    if (w === 'İLE') return 'ile';
    if (KISALTMA.has(w)) return w;
    if (ilk && w.length <= 3 && /^[A-Z&]+$/.test(w)) return w;
    const locale = TR_HARF.test(w) ? 'tr-TR' : 'en-US';
    return w.charAt(0) + w.slice(1).toLocaleLowerCase(locale);
  };
  return s
    .split(' ')
    .map((w, i) => w.split('-').map((p, j) => kelime(p, i === 0 && j === 0)).join('-'))
    .join(' ');
}

/**
 * Konu/govde icin kisa firma adi. NEDEN: "ANADOLU ISUZU OTOMOTİV SANAYİ VE TİCARET A.Ş." gibi
 * ticaret sicili unvani konu satirinda hem uzun hem robotik durur; hukuki ek ("A.Ş.", "T.A.Ş.",
 * "ANONİM ŞİRKETİ", "LTD. ŞTİ.") ve sondaki genel tanimlayici ("SANAYİ VE TİCARET") kirpilir,
 * TUMU BUYUK HARF ise kelime bazinda Turkce/Ingilizce duyarli baslik harfine cevrilir.
 * Kirpma katlanmis kopyada eslestirilir, uzunluk orijinale yansitilir (bkz. katla()).
 */
export function firmaKisa(firma: string): string {
  let f = firma.trim().replace(/\s+/g, ' ');
  const marka = MARKA_KISA[katla(f)];
  if (marka) return marka;
  // NEDEN dongu: "... SANAYİ VE TİCARET A.Ş." → once A.Ş. sonra SANAYİ VE TİCARET dusmeli
  let onceki = '';
  while (onceki !== f) {
    onceki = f;
    for (const re of EK_DESENLERI) {
      const m = re.exec(katla(f));
      if (m && m.index > 0) f = f.slice(0, m.index).trim(); // index 0 = adin tamami ek → kirpma (olmamali)
    }
  }
  if (!f) f = firma.trim(); // her sey kirpildiysa (olmamali) ozgun ad
  // NEDEN ikinci bakis: MARKA_KISA anahtarlarinin bir kismi ekleri kirpilmis hal ("JANTSA JANT"); CSV'de
  // "JANTSA JANT SANAYİ VE TİCARET A.Ş." yazdigi icin tam-ad aramasi bulamaz, kirpilmis ad bulur.
  const markaKirpik = MARKA_KISA[katla(f)];
  if (markaKirpik) return markaKirpik;
  return uzunAdKirp(baslikHarf(f));
}

/**
 * Uzun unvanlarda faaliyet kuyrugu: "ARKSİGNER Yazılım ve Donanım" → "ARKSİGNER", "Belbim Elektronik Para ve Ödeme" →
 * "Belbim". NEDEN: hitap ("Merhaba … ekibi,") ve konu satirinda 40+ karakterlik ticaret unvani robotik durur.
 * Yalniz 22 karakteri asan adlarda ve kalan marka en az 4 harfse kesilir; finans/otel kelimeleri listede YOK
 * ("Ankara Anonim Türk Sigorta" → "Ankara Anonim Türk" gibi anlamsiz kesim olmasin).
 */
const FAALIYET_KELIME = /\s(elektronik|elektrik|elektro|yazılım|yazilim|donanım|teknoloji\S*|tekonoloji\S*|bilişim|bilisim|bilgi|otomasyon|mühendislik|imalat|endüstri\S*|enerji|tasarım|üretim|destek|cihazlar|sistem\S*|sist\.|veri|entegrasyon|danışmanlık|eğitim|bağlantı|inşaat|petrol|test|mekanik|savunma|medikal|telekomünikasyon|bilgisayar)(\s|,|$)/iu;
function uzunAdKirp(ad: string): string {
  if (ad.length <= 22) return ad;
  const m = FAALIYET_KELIME.exec(ad);
  if (!m || m.index < 4) return ad;
  const kisa = ad.slice(0, m.index).replace(/[\s,.\-–]+$/u, '').trim();
  return kisa.replace(/[^\p{L}\p{N}]/gu, '').length >= 4 ? kisa : ad;
}

/**
 * Konu satirlari — A/B, kurumsal-mail-sablonlari.md §1 ile BIREBIR. NEDEN sektor sorusu konuda yok:
 * "ChatGPT 'bana bir dijital banka öner' dendiğinde ..." kalibi 60 karakteri asiyordu (md §1 notu).
 * NEDEN "karne"/"evet" yok: kurucunun onayladigi yeni metin — konu da govde gibi gozlem dilinde, satis dilinde degil.
 */
const KONU: Record<string, (firma: string) => string> = {
  A: (firma) => `${firma} — AI asistanlarında görünürlük`,
  B: (firma) => `ChatGPT ${firma} hakkında ne söylüyor?`,
};

/**
 * Ajans konu satirlari (kurumsal-mail-sablonlari.md §1, Sablon D). NEDEN ayri: ajansa "ChatGPT sizin hakkinizda ne
 * soyluyor" degil, musterileri uzerinden is birligi teklifi gidiyor; konu da bunu soylemeli.
 */
const KONU_AJANS: Record<string, (firma: string) => string> = {
  A: () => `Müşterileriniz ChatGPT'de görünüyor mu?`,
  B: (firma) => `${firma} için AI görünürlük iş birliği`,
};

/** Konu satiri: sektor + varyant (bilinmeyen varyant → A) */
export function konuSatiri(sektor: string, varyant: string, firma: string): string {
  const tablo = sektor === 'ajans' ? KONU_AJANS : KONU;
  return (tablo[varyant] ?? tablo.A)(firma);
}

/**
 * Isimsiz (kurumsal rol) alicida hitap. NEDEN: sablonlar "Sayın {{ad}} {{soyad}}," ile basliyor; info@'ya
 * "Sayın  ," gitmesin. Donus: hitap degistirilmis govde; sablonda hitap satiri BULUNAMAZSA null
 * (cagiran gonderimi durdurur — bos adli selam asla gitmez).
 */
export function isimsizHitap(govde: string): string | null {
  const re = /Sayın \{\{var:ad\}\} \{\{var:soyad\}\},/g;
  if (!re.test(govde)) return null;
  const out = govde.replace(re, 'Merhaba {{var:firma}} ekibi,');
  // NEDEN yorumlar haric: HTML basindaki aciklama yorumu merge alanlarini ({{ad}} {{soyad}}) listeler; gorunmez
  return /\{\{var:(ad|soyad)\}\}/.test(out.replace(/<!--[\s\S]*?-->/g, '')) ? null : out;
}

// ─── Gonderici kimligi (Yonetmelik md. 5/1) ────────────────────────────────

export interface EpostaKimlik {
  fromEmail: string;
  fromName: string;
  replyTo: string;
  gonderenAd: string;
  gonderenUnvan: string;
  gonderenAdres: string;
  /** Ticaret siciline kayitliysa */
  mersis: string;
  /** Sicile kayitli olmayan sahis isletmesi: "Ad Soyad · VKN … · … V.D." (MERSIS yerine) */
  kimlik: string;
}

/**
 * Env → kimlik. NEDEN || (?? degil): .env'de "MAILJET_GONDEREN_AD=" bos birakilirsa ?? bos dizeyi kabul
 * eder, imza adsiz cikardi; || varsayilana dusurur. kimlikSorunlari ayrica bos alanlari yakalar.
 */
export function kimlikEnv(env: Record<string, string | undefined> = process.env): EpostaKimlik {
  const fromEmail = env.MAILJET_FROM_EMAIL ?? '';
  return {
    fromEmail,
    fromName: env.MAILJET_FROM_NAME || 'RanksUp',
    replyTo: env.MAILJET_REPLY_TO || fromEmail,
    gonderenAd: env.MAILJET_GONDEREN_AD || 'Emir Burgazlı',
    gonderenUnvan: env.MAILJET_GONDEREN_UNVAN || 'Kurucu, RanksUp · Luvi Host',
    gonderenAdres: env.MAILJET_GONDEREN_ADRES ?? '',
    mersis: env.MAILJET_MERSIS ?? '',
    kimlik: env.MAILJET_KIMLIK?.trim() || '',
  };
}

/**
 * Hem {{gonderen_*}}/{{mersis}} yer tutucularini hem de eski "[Ad Soyad]" / "[adres]" / "MERSİS [no]" /
 * "[MERSİS]" literal'lerini doldurur. "MERSİS {{mersis}}" → kimlik satiri (MERSIS'i olmayan sahis isletmesi
 * icin ad soyad + VKN; 27.10.2026). Dolmayan kalinti kimlikKalinti() ile yakalanir.
 */
function kimlikDoldur(s: string, k: EpostaKimlik): string {
  const satir = k.kimlik || `MERSİS ${k.mersis}`;
  return s
    .replace(/\{\{gonderen_ad\}\}/g, k.gonderenAd)
    .replace(/\{\{gonderen_unvan\}\}/g, k.gonderenUnvan)
    .replace(/\{\{gonderen_adres\}\}/g, k.gonderenAdres)
    .replace(/MERSİS \{\{mersis\}\}/g, satir)
    .replace(/\{\{mersis\}\}/g, k.kimlik || k.mersis)
    .replace(/\[Ad Soyad\]/g, k.gonderenAd)
    .replace(/\[adres\]/g, k.gonderenAdres)
    .replace(/MERSİS \[no\]/g, satir)
    .replace(/\[MERSİS\]/g, satir);
}

/** Render sonrasi govdede kalan kimlik yer tutuculari (bos dizi = temiz) */
function kimlikKalinti(s: string): string[] {
  const desenler = ['[Ad Soyad]', '[adres]', '[no]', '[MERSİS]', '{{gonderen', '{{mersis'];
  return desenler.filter((d) => s.includes(d));
}

/** Gonderim oncesi kimlik/sablon denetimi; bos dizi = gonderilebilir */
export function kimlikSorunlari(k: EpostaKimlik, sektorler: Iterable<string>): string[] {
  const sorunlar: string[] = [];
  if (!k.fromEmail.includes('@')) sorunlar.push('MAILJET_FROM_EMAIL bos');
  if (!k.gonderenAd.trim()) sorunlar.push('MAILJET_GONDEREN_AD bos');
  if (!k.gonderenUnvan.trim()) sorunlar.push('MAILJET_GONDEREN_UNVAN bos');
  if (!k.gonderenAdres.trim()) sorunlar.push('MAILJET_GONDEREN_ADRES bos');
  if (!k.mersis && !k.kimlik) sorunlar.push('MAILJET_MERSIS ve MAILJET_KIMLIK ikisi de bos');
  for (const s of new Set(sektorler)) {
    try {
      const h = kimlikKalinti(htmlSablon(s, k));
      const m = kimlikKalinti(metinSablon(s, k));
      if (h.length) sorunlar.push(`${s} HTML'de kalinti: ${h.join(' ')}`);
      if (m.length) sorunlar.push(`${s} duz metinde kalinti: ${m.join(' ')}`);
    } catch (e: any) {
      sorunlar.push(String(e?.message ?? e));
    }
  }
  return sorunlar;
}

// ─── Sablonlar ──────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ortak Mailjet sozdizimi cevirisi. NEDEN [[UNSUB_LINK_EN]]: Mailjet'in ret etiketi 20 dilde var,
 * Turkce YOK — [[UNSUB_LINK_TR]] yazilirsa etiket islenmez ve mail ret linksiz cikar (md. 6/6 ihlali).
 */
function mailjetSozdizimi(s: string, k: EpostaKimlik): string {
  return kimlikDoldur(s, k)
    .replace(/\{\{unsubscribe\}\}/g, '[[UNSUB_LINK_EN]]')
    .replace(/\[\[UNSUB_LINK_TR\]\]/g, '[[UNSUB_LINK_EN]]')
    .replace(/\{\{gonderen_eposta\}\}/g, k.replyTo)
    // NEDEN: sablonda sabit "kurumsal-finans-A" yazildiysa baska sektore yanlis etiket gider → degiskenden
    .replace(/utm_campaign=kurumsal-[a-z-]+?-(?:A|B|\{\{var:varyant\}\})(?![A-Za-z0-9])/g, 'utm_campaign=kurumsal-{{var:sektor}}-{{var:varyant}}')
    .replace(/\{\{(ad|soyad|firma|firma_tam|sektor|sektor_sorusu|unvan|varyant|firma_url)\}\}/g, '{{var:$1}}');
}

/** HTML sablonu Mailjet sozdizimine cevir (mailto konu satirinda URL-kodlu firma kullanilir) */
export function htmlSablon(sektor: string, k: EpostaKimlik): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  let f = path.join(HTML_DIR, meta.html);
  if (!fs.existsSync(f)) f = path.join(HTML_DIR, 'kurumsal-finans.html'); // sektor HTML'i henuz yoksa finans govdesi
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/href="mailto:[^"]*"/g, (m) => m.replace(/\{\{(var:)?firma(_kisa)?\}\}/g, '{{var:firma_url}}'));
  return mailjetSozdizimi(html, k);
}

/**
 * Duz metin sablon: markdown'daki ilgili ``` blogu. BULUNAMAZSA hata firlatilir — kimliksiz/eksik metin
 * sessizce gitmesin (CLI cikar, servis o turu durdurur).
 */
export function metinSablon(sektor: string, k: EpostaKimlik): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  if (!fs.existsSync(MD_FILE)) throw new Error(`Duz metin sablon dosyasi yok: ${MD_FILE}`);
  const md = fs.readFileSync(MD_FILE, 'utf8');
  const bas = md.search(new RegExp('^## (\\d+\\. )?' + escapeRe(meta.mdBaslik), 'm'));
  const blok = bas >= 0 ? md.slice(bas).match(/```\n([\s\S]*?)\n```/)?.[1] : null;
  if (!blok) throw new Error(`"${meta.mdBaslik}" duz metin blogu ${path.relative(REPO_ROOT, MD_FILE)} icinde bulunamadi`);
  return mailjetSozdizimi(blok, k);
}

export type Alici = { email: string; ad: string; soyad: string; firma: string; unvan?: string; sektor: string; varyant: string; sektor_sorusu?: string; marka?: string };

/**
 * Mailjet Send v3.1 mesaj nesnesi. Isimsiz (kurumsal kutu) alicida hitap "Merhaba {firma} ekibi,";
 * sablonda hitap satiri yoksa HATA (bos adli selam gitmez).
 */
export function mailjetMesaj(to: Alici, opts: { kimlik: EpostaKimlik; kampanya: string; testMi?: boolean }) {
  const { kimlik: k, kampanya } = opts;
  const varyant = to.varyant === 'B' ? 'B' : 'A';
  const firma = to.marka?.trim() || firmaKisa(to.firma);
  const soru = sektorSorusu(to.firma, to.sektor, to.sektor_sorusu);
  const konu = konuSatiri(to.sektor, varyant, firma);
  const isimsiz = !to.ad?.trim();
  let TextPart = metinSablon(to.sektor, k);
  let HTMLPart = htmlSablon(to.sektor, k);
  if (isimsiz) {
    const t = isimsizHitap(TextPart), h = isimsizHitap(HTMLPart);
    if (!t || !h) throw new Error(`${to.sektor} sablonunda "Sayın {{ad}} {{soyad}}," hitap satiri yok — isimsiz alici icin hitap kurulamadi`);
    TextPart = t; HTMLPart = h;
  }
  return {
    From: { Email: k.fromEmail, Name: k.fromName },
    ReplyTo: { Email: k.replyTo, Name: k.fromName },
    To: [{ Email: to.email, Name: isimsiz ? firma : `${to.ad} ${to.soyad}`.trim() }],
    Subject: opts.testMi ? `[TEST] ${konu}` : konu,
    TextPart,
    HTMLPart,
    TemplateLanguage: true,
    Variables: {
      ad: to.ad, soyad: to.soyad, firma, firma_tam: to.firma, firma_url: encodeURIComponent(firma),
      unvan: to.unvan ?? '', sektor: to.sektor, sektor_sorusu: soru, varyant,
    },
    CustomCampaign: kampanya,
    // NEDEN mesaj seviyesinde: DeduplicateCampaign v3.1'de Messages[] elemaninin ozelligidir; ayni kampanyada
    // ayni adrese ikinci gonderimi Mailjet tarafinda da engeller.
    DeduplicateCampaign: true,
    CustomID: `${kampanya}:${to.email}`,
    TrackOpens: 'enabled',
    TrackClicks: 'enabled',
    // NEDEN mailto: Gmail/Outlook "abonelikten cik" dugmesi icin List-Unsubscribe (RFC 2369); govdedeki
    // [[UNSUB_LINK_EN]] Mailjet'in https ret linkidir, mailto yedek kanal (ret Reply-To'ya "ret" konusuyla duser).
    Headers: { 'List-Unsubscribe': `<mailto:${k.replyTo}?subject=ret>` },
  };
}

/**
 * Render edilmis mesajin yasal zorunluluklari tasidigini DOGRULA (sablon duzenlemesi footer'i silerse gonderim durur):
 * her iki govdede ret etiketi, gonderen adi, adres ve kimlik/MERSIS satiri. Bos dizi = gonderilebilir.
 */
export function mesajDenetimi(m: { TextPart: string; HTMLPart: string }, k: EpostaKimlik): string[] {
  const gerekli: Array<[string, string]> = [
    ['ret linki', '[[UNSUB_LINK_EN]]'],
    ['gönderen adı', k.gonderenAd.trim()],
    ['adres', k.gonderenAdres.trim()],
    ['kimlik/MERSİS', (k.kimlik || k.mersis).trim()],
  ];
  const eksik: string[] = [];
  // Imza satiri butun olarak: "<adres> · <kimlik>" (gonderen adi giris cumlesinde de gectigi icin tek basina yetmez)
  const imza = `${k.gonderenAdres.trim()} · ${k.kimlik.trim() || `MERSİS ${k.mersis.trim()}`}`;
  if (!m.TextPart.includes(imza)) eksik.push('düz metinde imza/kimlik satırı yok');
  if (!m.HTMLPart.includes(imza)) eksik.push("HTML'de imza/kimlik satırı yok");
  for (const [ad, deger] of gerekli) {
    if (!deger) { eksik.push(`${ad} tanımsız`); continue; }
    if (!m.TextPart.includes(deger)) eksik.push(`düz metinde ${ad} yok`);
    if (!m.HTMLPart.includes(deger)) eksik.push(`HTML'de ${ad} yok`);
  }
  return eksik;
}
