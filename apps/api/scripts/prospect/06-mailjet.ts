#!/usr/bin/env tsx
/**
 * 06-mailjet — kurumsal kampanyayi Mailjet Send API (v3.1) ile GUNLUK DALGA halinde gonderir.
 *
 * NEDEN dalga: 141+ adres tahmini (ad.soyad) → ilk gunler bounce yuksek olabilir; gunde
 * 100 → 200 ritmi ve bounce > %3'te DURMA kurali alan adi itibarini korur. Gunluk ust sinir
 * 200'dur (durum dosyasindan bugun gonderilen sayisi okunur, asilmaz).
 * NEDEN --iys-onayli sart: Yonetmelik md. 5/2 (gonderici IYS kaydi) ve 6/6 (tacir
 * adresleri gonderimden ONCE IYS'ye yuklenir, ret listesi kontrol edilir). Bu bayrak
 * "yukledim ve kontrol ettim" beyanidir; olmadan gercek gonderim yapilmaz.
 * NEDEN gonderici kimligi kapisi: Yonetmelik md. 5/1 — ticari iletide gonderenin unvani,
 * MERSIS no ve adresi bulunmak ZORUNDA. Sablonda "[Ad Soyad]" gibi yer tutucu kalmis bir
 * mail cikarsa hem hukuki risk hem itibar kaybi olur; bu yuzden render edilmis govde taranir.
 * NEDEN otomatik fren: --onceki unutulursa bir onceki dalganin bounce'u hic bakilmadan yeni
 * dalga giderdi; durum dosyasindaki son farkli kampanya kendiliginden fren kaynagi olur,
 * Mailjet'te bulunamazsa gonderim DURUR (bilincli atlama: --frensiz).
 * NEDEN write-ahead durum kaydi: parca POST'tan ONCE 'belirsiz' olarak dosyaya yazilir, yanit gelince
 * gercek sonuca guncellenir. Script POST sirasinda olurse (OOM, kill -9, elektrik) dosyada iz kalir ve
 * sonraki kosum o adreslere ikinci mail atmaz. Dosya her seferinde tmp + rename ile ATOMIK yazilir;
 * yarim yazilmis CSV okunup "hic gonderilmemis" sanilmasin.
 * NEDEN kilit dosyasi: iki terminalde ayni anda dalga kosulursa ikisi de ayni adreslere gonderir
 * (durum dosyasini ikisi de bos okur). DATA_DIR/mailjet-gonderim.lock 'wx' ile acilir; varsa DURUR (exit 6).
 *
 * Kullanim (--ornek-goster: --dry-run ile; ilk hedef icin konu + duz metin + HTML ozetini degiskenleri doldurup basar):
 *   npx tsx scripts/prospect/06-mailjet.ts --segment finans-k1-p1 --dry-run --ornek-goster
 *
 * Env (apps/api/.env — sohbete yazilmaz):
 *   MAILJET_API_KEY, MAILJET_SECRET, MAILJET_FROM_EMAIL (orn. info@ranksup.ai),
 *   MAILJET_FROM_NAME (orn. "Emir Burgazlı · RanksUp"), MAILJET_REPLY_TO (istege bagli)
 *   MAILJET_GONDEREN_AD (vars. "Emir Burgazlı"), MAILJET_GONDEREN_UNVAN (vars. "Kurucu, RanksUp · Luvi Host"),
 *   MAILJET_GONDEREN_ADRES (zorunlu — md. 5/1), MAILJET_MERSIS (zorunlu — md. 5/1)
 *
 * Kullanim:
 *   npx tsx scripts/prospect/06-mailjet.ts --dns                       # gonderici alan adi icin SPF/DKIM kayitlari + durum
 *   npx tsx scripts/prospect/06-mailjet.ts --firmalar                  # CSV'deki TUM firmalar: firma → firma_kisa · sektor sorusu (API yok, gozle kontrol)
 *   npx tsx scripts/prospect/06-mailjet.ts --test sen@ranksup.ai       # ornek degerlerle GERCEK test maili (IYS gerekmez; TEK adres; --segment/--iys-onayli/--dry-run ile birlikte KULLANILMAZ)
 *   npx tsx scripts/prospect/06-mailjet.ts --segment finans-k1 --limit 100 --dry-run
 *   npx tsx scripts/prospect/06-mailjet.ts --segment finans-k1 --limit 100 --iys-onayli [--onceki kurumsal-2026-09-08 | --frensiz]   # dalga
 *   npx tsx scripts/prospect/06-mailjet.ts --stats [--kampanya <ad>]   # kampanya istatistigi + bounce orani; >%3 → DUR (exit 5)
 *
 * Cikis kodlari: 1 genel hata/sablon yok · 2 env/arguman eksik · 3 IYS onayi yok · 4 gonderici kimligi eksik · 5 bounce > %3 / fren kaynagi bulunamadi
 *                6 baska bir dalga suruyor (kilit) / hiz siniri (429, Mailjet islemedi, kayit yazilmadi — birkac dk sonra tekrar kos)
 *
 * Girdi : DATA_DIR/jetmail-import.csv (04) — email,ad,soyad,firma,unvan,sektor,segment,guven,konu_varyanti[,sektor_sorusu]
 * Durum : DATA_DIR/mailjet-gonderim.csv — email,tarih,messageId,kampanya,durum (tmp + rename ile atomik yazilir)
 *         durum: gonderildi | belirsiz (POST oncesi on-kayit; yanit alinamadi/okunamadi, gitmis olabilir) | hata:...
 *         — dosyada olan HER adres sonraki kosumda atlanir
 * Kilit : DATA_DIR/mailjet-gonderim.lock — yalniz gercek dalga sirasinda; cikista/SIGINT'te silinir
 * Sablon: reklam/pazarlama/kurumsal-mail-html/kurumsal-<sektor>.html (yoksa finans) + duz metin esi
 *         (kurumsal-mail-sablonlari.md §2-4'ten uretilir). {{ad}} → {{var:ad}}, {{unsubscribe}} → [[UNSUB_LINK_EN]].
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, REPO_ROOT, SEKTORLER, parseArgs, readCsv, sleep, jitter, toCsv } from '../../src/prospect/prospect-utils.js';

const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === true;
/** --dry-run ile: ilk hedefin konu/duz metin/HTML ozetini degiskenleri doldurarak bas (gozle son onay icin) */
const ORNEK_GOSTER = args['ornek-goster'] === true;
const LIMIT = args.limit ? Number(args.limit) : 100;
const SEGMENT = typeof args.segment === 'string' ? String(args.segment) : null;
const IYS_ONAYLI = args['iys-onayli'] === true;
const TEST_TO = typeof args.test === 'string' ? String(args.test) : null;
const KAMPANYA = typeof args.kampanya === 'string' ? String(args.kampanya) : `kurumsal-${new Date().toISOString().slice(0, 10)}`;
const ONCEKI = typeof args.onceki === 'string' ? String(args.onceki) : null;
/** Otomatik/onceki dalga frenini bilincli atla (yalniz ilk dalga ya da Mailjet'te kampanya gercekten yokken) */
const FRENSIZ = args.frensiz === true;

/** Gunluk ust sinir — itibar isinmasi (warm-up) icin; asilmaz */
const GUNLUK_KOTA = 200;
/** Bounce esigi — ustunde sonraki dalga ATILMAZ */
const BOUNCE_ESIK = 0.03;
/** Bir Send cagrisinda gonderilen adres sayisi (Mailjet v3.1 ust siniri 50) */
const PARCA = 50;
/** Konu satiri ust siniri (kurumsal-mail-sablonlari.md §1) — asarsa mobil onizlemede kesilir, DRY'da uyarilir */
const KONU_MAX = 60;

const API = 'https://api.mailjet.com';
const KEY = process.env.MAILJET_API_KEY ?? '';
const SECRET = process.env.MAILJET_SECRET ?? '';
const FROM_EMAIL = process.env.MAILJET_FROM_EMAIL ?? '';
const FROM_NAME = process.env.MAILJET_FROM_NAME ?? 'RanksUp';
const REPLY_TO = process.env.MAILJET_REPLY_TO ?? FROM_EMAIL;
/**
 * Gonderici kimligi (Yonetmelik md. 5/1) — ad/unvan varsayilanli, adres/MERSIS zorunlu.
 * NEDEN ||: .env'de "MAILJET_GONDEREN_AD=" (bos) birakilirsa ?? bos dizeyi kabul eder ve imza adsiz
 * cikardi; || bos dizeyi de varsayilana dusurur. kimlikKapisi ayrica bos adi yakalar.
 */
const GONDEREN_AD = process.env.MAILJET_GONDEREN_AD || 'Emir Burgazlı';
const GONDEREN_UNVAN = process.env.MAILJET_GONDEREN_UNVAN || 'Kurucu, RanksUp · Luvi Host';
const GONDEREN_ADRES = process.env.MAILJET_GONDEREN_ADRES ?? '';
const MERSIS = process.env.MAILJET_MERSIS ?? '';

const DURUM_FILE = path.join(DATA_DIR, 'mailjet-gonderim.csv');
const DURUM_SUTUN = ['email', 'tarih', 'messageId', 'kampanya', 'durum'];
/** Es zamanli ikinci dalgayi engelleyen kilit (yalniz gercek gonderimde alinir) */
const KILIT_FILE = path.join(DATA_DIR, 'mailjet-gonderim.lock');
const HTML_DIR = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-html');
const MD_FILE = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'kurumsal-mail-sablonlari.md');

/** Sektor → sablon anahtari, md basligi, sektor-geneli varsayilan soru ve okunur ad */
const SEKTOR_META: Record<string, { html: string; mdBaslik: string; soru: string; ad: string }> = {
  finans: { html: 'kurumsal-finans.html', mdBaslik: 'Şablon A', soru: 'bu alanda hangi şirketi önerirsin', ad: 'finans' },
  'eticaret-perakende-teknoloji': { html: 'kurumsal-eticaret.html', mdBaslik: 'Şablon B', soru: 'telefon almak için hangi site güvenilir', ad: 'e-ticaret ve perakende' },
  'turizm-havayolu-telekom-otomotiv': { html: 'kurumsal-turizm.html', mdBaslik: 'Şablon C', soru: 'İstanbul-Londra için hangi havayolu', ad: 'seyahat, telekom ve otomotiv' },
};

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
const KISALTMA = new Set(['BİM', 'TEB', 'ING', 'QNB', 'TAV', 'TAB', 'FLO', 'THY', 'TSKB', 'HSBC', 'ICBC', 'LCW', 'KFC', 'A101', 'ŞOK', 'MNG', 'PTT', 'TAÇ', 'BBVA', 'D&R', 'UPS', 'DHL']);

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
  return baslikHarf(f);
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

function auth(): string {
  if (!KEY || !SECRET) { console.error('MAILJET_API_KEY / MAILJET_SECRET yok (apps/api/.env)'); process.exit(2); }
  return 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');
}

/**
 * status null → yanit hic alinamadi (zaman asimi / ag); gonderimde "belirsiz" sayilir.
 * govde → HTTP hata govdesi (ham metin). NEDEN tasinir: Send API 400 donse bile Messages[] icinde
 * mesaj bazinda success/error verebilir (karisik yanit); dalga() bunu okuyup adres adres kaydeder.
 */
class MjHata extends Error {
  constructor(msg: string, public status: number | null, public govde: string = '') { super(msg); }
}

/** Tekrar bekleme (2s/6s/18s), ustel. NEDEN: Mailjet gecici hata verirken parcayi kaybetmemek */
const TEKRAR_BEKLEME = [2_000, 6_000, 18_000];
const ZAMAN_ASIMI_MS = 45_000;

/**
 * Mailjet REST cagrisi. NEDEN AbortController: fetch varsayilan olarak suresiz bekler; Send API
 * 50'lik parcada takilirsa script sonsuza kadar asili kalir ve durum dosyasi yazilmaz.
 * NEDEN POST yalniz 429'da tekrarlanir: 5xx "islenmedi" garantisi vermez (gateway 502'nin arkasinda
 * Mailjet maili kabul etmis olabilir) → tekrar = ayni kisiye ikinci mail; 429 ise "hic islemedim"
 * anlamina gelir, guvenle tekrarlanir. Ag hatasinda da POST tekrarlanmaz. GET'ler 429/5xx/ag'da tekrarlanir.
 */
async function mj<T = any>(method: 'GET' | 'POST', yol: string, body?: unknown): Promise<T> {
  const basic = auth();
  for (let deneme = 0; ; deneme++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ZAMAN_ASIMI_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetch(API + yol, {
        method,
        headers: { authorization: basic, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (e: any) {
      clearTimeout(t);
      const agHatasi = new MjHata(`Mailjet ${method} ${yol} → yanit yok (${e?.name === 'AbortError' ? `${ZAMAN_ASIMI_MS / 1000} sn zaman asimi` : e?.message ?? e})`, null);
      if (method === 'GET' && deneme < TEKRAR_BEKLEME.length) { await sleep(TEKRAR_BEKLEME[deneme]); continue; }
      throw agHatasi;
    }
    clearTimeout(t);
    if (res.ok) return text ? JSON.parse(text) : ({} as T);
    const gecici = res.status === 429 || (method === 'GET' && res.status >= 500);
    if (gecici && deneme < TEKRAR_BEKLEME.length) {
      console.warn(`  Mailjet HTTP ${res.status} — ${TEKRAR_BEKLEME[deneme] / 1000} sn sonra tekrar (${deneme + 1}/${TEKRAR_BEKLEME.length})`);
      await sleep(TEKRAR_BEKLEME[deneme]);
      continue;
    }
    throw new MjHata(`Mailjet ${method} ${yol} → HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, text);
  }
}

// ─── Gonderici kimligi (Yonetmelik md. 5/1) ────────────────────────────────

/**
 * Hem {{gonderen_*}}/{{mersis}} yer tutucularini hem de eski "[Ad Soyad]" / "[adres]" /
 * "MERSİS [no]" / "[MERSİS]" literal'lerini env degerleriyle doldurur. NEDEN iki bicim:
 * sablon dosyalari ayri ajan tarafindan guncelleniyor; hangi surumle karsilasirsak
 * karsilasalim kimlik alanlari dolmali, dolmayan kaldiysa kimlikKalinti() yakalar.
 */
function kimlikDoldur(s: string): string {
  return s
    .replace(/\{\{gonderen_ad\}\}/g, GONDEREN_AD)
    .replace(/\{\{gonderen_unvan\}\}/g, GONDEREN_UNVAN)
    .replace(/\{\{gonderen_adres\}\}/g, GONDEREN_ADRES)
    .replace(/\{\{mersis\}\}/g, MERSIS)
    .replace(/\[Ad Soyad\]/g, GONDEREN_AD)
    .replace(/\[adres\]/g, GONDEREN_ADRES)
    .replace(/MERSİS \[no\]/g, `MERSİS ${MERSIS}`)
    .replace(/\[MERSİS\]/g, `MERSİS ${MERSIS}`);
}

/** Render sonrasi govdede kalan kimlik yer tutuculari (bos dizi = temiz) */
function kimlikKalinti(s: string): string[] {
  const desenler = ['[Ad Soyad]', '[adres]', '[no]', '[MERSİS]', '{{gonderen', '{{mersis'];
  return desenler.filter((d) => s.includes(d));
}

/**
 * GUVENLIK KAPISI — gercek gonderim ve --test oncesi. Env bos veya render edilmis govdede
 * kalinti varsa exit 4; --dry-run'da yalnizca UYARI (prova akisi durmasin).
 */
function kimlikKapisi(sektorler: string[], mod: 'gercek' | 'dry'): void {
  const sorunlar: string[] = [];
  if (!GONDEREN_AD.trim()) sorunlar.push('MAILJET_GONDEREN_AD bos');
  if (!GONDEREN_UNVAN.trim()) sorunlar.push('MAILJET_GONDEREN_UNVAN bos');
  if (!GONDEREN_ADRES) sorunlar.push('MAILJET_GONDEREN_ADRES bos');
  if (!MERSIS) sorunlar.push('MAILJET_MERSIS bos');
  for (const s of new Set(sektorler)) {
    const h = kimlikKalinti(htmlSablon(s));
    const m = kimlikKalinti(metinSablon(s));
    if (h.length) sorunlar.push(`${s} HTML'de kalinti: ${h.join(' ')}`);
    if (m.length) sorunlar.push(`${s} duz metinde kalinti: ${m.join(' ')}`);
  }
  if (sorunlar.length === 0) return;
  const mesaj = `Gonderici kimligi eksik (Yonetmelik md. 5/1): ${sorunlar.join(' · ')}`;
  if (mod === 'dry') { console.warn(`UYARI: ${mesaj}`); return; }
  console.error(`DURDU: ${mesaj}`);
  process.exit(4);
}

// ─── Sablonlar ──────────────────────────────────────────────────────────────

/** Regex icinde guvenli kullanim icin ozel karakterleri kacir */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ortak Mailjet sozdizimi cevirisi. NEDEN [[UNSUB_LINK_EN]]: Mailjet'in ret etiketi 20 dilde var,
 * Turkce YOK — [[UNSUB_LINK_TR]] yazilirsa etiket islenmez ve mail ret linksiz cikar (md. 6/6 ihlali).
 */
function mailjetSozdizimi(s: string): string {
  return kimlikDoldur(s)
    .replace(/\{\{unsubscribe\}\}/g, '[[UNSUB_LINK_EN]]')
    .replace(/\[\[UNSUB_LINK_TR\]\]/g, '[[UNSUB_LINK_EN]]') // sablona dogrudan TR yazilmissa da islenmeyen etiket kalmasin
    .replace(/\{\{gonderen_eposta\}\}/g, REPLY_TO)
    // NEDEN: sablonda sabit "kurumsal-finans-A" yazildiysa varyant B'ye veya finans HTML'i ile giden
    // e-ticaret alicisina yanlis etiket olur → sektor ve varyant ikisi de degiskenden gelir
    .replace(/utm_campaign=kurumsal-[a-z-]+?-(?:A|B|\{\{var:varyant\}\})(?![A-Za-z0-9])/g, 'utm_campaign=kurumsal-{{var:sektor}}-{{var:varyant}}')
    .replace(/\{\{(ad|soyad|firma|firma_tam|sektor|sektor_sorusu|unvan|varyant|firma_url)\}\}/g, '{{var:$1}}');
}

/** HTML sablonu Mailjet sozdizimine cevir (mailto konu satirinda URL-kodlu firma kullanilir) */
function htmlSablon(sektor: string): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  let f = path.join(HTML_DIR, meta.html);
  if (!fs.existsSync(f)) f = path.join(HTML_DIR, 'kurumsal-finans.html'); // sektor HTML'i henuz yoksa finans govdesi
  let html = fs.readFileSync(f, 'utf8');
  // NEDEN: mailto:?subject=... icinde ham "{{firma}}" bosluk/ozel karakterle linki bozar → encodeURIComponent'li degisken
  html = html.replace(/href="mailto:[^"]*"/g, (m) => m.replace(/\{\{(var:)?firma(_kisa)?\}\}/g, '{{var:firma_url}}'));
  return mailjetSozdizimi(html);
}

/**
 * Duz metin sablon: markdown'daki ilgili ``` blogu. Baslik "## 2. Şablon A — ..." gibi
 * numarali oldugu icin numaraya dayanikli regex ile aranir; BULUNAMAZSA sessiz kisa metne
 * dusulmez, hata verilip cikilir (kimliksiz/eksik metin gitmesin).
 */
function metinSablon(sektor: string): string {
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.finans;
  if (!fs.existsSync(MD_FILE)) { console.error(`Duz metin sablon dosyasi yok: ${MD_FILE}`); process.exit(1); }
  const md = fs.readFileSync(MD_FILE, 'utf8');
  const bas = md.search(new RegExp('^## (\\d+\\. )?' + escapeRe(meta.mdBaslik), 'm'));
  const blok = bas >= 0 ? md.slice(bas).match(/```\n([\s\S]*?)\n```/)?.[1] : null;
  if (!blok) { console.error(`"${meta.mdBaslik}" duz metin blogu ${path.relative(REPO_ROOT, MD_FILE)} icinde bulunamadi — sablon basligini ve kod blogunu kontrol et.`); process.exit(1); }
  return mailjetSozdizimi(blok);
}

type Alici = { email: string; ad: string; soyad: string; firma: string; unvan?: string; sektor: string; varyant: string; sektor_sorusu?: string };

/** CSV satirini Alici'ye cevir (konu_varyanti bos → A) */
const aliciYap = (r: Record<string, string>): Alici => ({ email: r.email, ad: r.ad, soyad: r.soyad, firma: r.firma, unvan: r.unvan, sektor: r.sektor, varyant: r.konu_varyanti || 'A', sektor_sorusu: r.sektor_sorusu });

function mesaj(to: Alici, testMi = false) {
  const varyant = KONU[to.varyant] ? to.varyant : 'A';
  const firma = firmaKisa(to.firma);
  const soru = sektorSorusu(to.firma, to.sektor, to.sektor_sorusu);
  const konu = KONU[varyant](firma);
  return {
    From: { Email: FROM_EMAIL, Name: FROM_NAME },
    ReplyTo: { Email: REPLY_TO, Name: FROM_NAME },
    To: [{ Email: to.email, Name: `${to.ad} ${to.soyad}`.trim() }],
    Subject: testMi ? `[TEST] ${konu}` : konu,
    TextPart: metinSablon(to.sektor),
    HTMLPart: htmlSablon(to.sektor),
    TemplateLanguage: true,
    Variables: {
      ad: to.ad, soyad: to.soyad, firma, firma_tam: to.firma, firma_url: encodeURIComponent(firma),
      unvan: to.unvan ?? '', sektor: to.sektor, sektor_sorusu: soru, varyant,
    },
    CustomCampaign: KAMPANYA,
    // NEDEN mesaj seviyesinde: DeduplicateCampaign v3.1'de Messages[] elemaninin ozelligidir (govde ust
    // seviyesinde 400 "unknown property"). Ayni CustomCampaign icinde ayni adrese ikinci gonderimi Mailjet
    // tarafinda da engeller (durum dosyasina ek emniyet); CustomCampaign olmadan verilirse 400 doner.
    DeduplicateCampaign: true,
    CustomID: `${KAMPANYA}:${to.email}`,
    TrackOpens: 'enabled',
    TrackClicks: 'enabled',
    // NEDEN mailto: Gmail/Outlook "abonelikten cik" dugmesi icin List-Unsubscribe sart (RFC 2369).
    // List-Unsubscribe-Post (RFC 8058 tek-tik) BILEREK YOK: RFC 8058 https URI'li List-Unsubscribe ister,
    // bizde yalniz mailto var; Post basligi tek basina gecersiz olur ve Gmail bunu spam sinyali sayabilir.
    // Govdede [[UNSUB_LINK_EN]] oldugundan Mailjet kendi https ret URL'sini (ve muhtemelen kendi
    // List-Unsubscribe'ini) ekler; mailto burada yedek kanal (ret e-postasi Reply-To'ya "ret" konusuyla duser).
    // KONTROL (ilk --test'te): ham basliklarda Mailjet'in kendi https List-Unsubscribe'i ile birlikte iki
    // List-Unsubscribe basligi olusuyor mu bak; olusuyorsa bu satiri kaldir, tek baslik kalsin.
    Headers: {
      'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=ret>`,
    },
  };
}

// ─── Komutlar ───────────────────────────────────────────────────────────────

async function dns(): Promise<void> {
  if (!FROM_EMAIL.includes('@')) { console.error('MAILJET_FROM_EMAIL yok'); process.exit(2); }
  const domain = FROM_EMAIL.split('@')[1];
  const r = await mj<{ Data: any[] }>('GET', `/v3/REST/dns/${domain}`);
  const d = r.Data?.[0];
  if (!d) { console.log(`Mailjet'te ${domain} kayitli degil — once Mailjet panelinden gonderici alan adi olarak ekle (Senders & Domains).`); return; }
  console.log(`Alan adi: ${domain}\n  SPF  durum: ${d.SPFStatus}  → TXT @ (${domain})  "${d.SPFRecordValue}"\n  DKIM durum: ${d.DKIMStatus}  → TXT ${d.DKIMRecordName}  "${d.DKIMRecordValue}"\n  DMARC (Mailjet vermez, kendin ekle): TXT _dmarc.${domain}  "v=DMARC1; p=quarantine; rua=mailto:dmarc@ranksup.ai"`);
  const s = await mj<{ Data: any[] }>('GET', `/v3/REST/sender?Email=${encodeURIComponent(FROM_EMAIL)}`).catch(() => ({ Data: [] }));
  console.log(`  Gonderici ${FROM_EMAIL}: ${s.Data?.[0]?.Status ?? 'kayitli degil (Mailjet > Senders & Domains > Add sender)'}`);
}

/**
 * --firmalar: CSV'deki TUM (tekil) firma adlari icin firma_kisa ve sektor sorusu tablosu. NEDEN: konu
 * satirina giden adin kirpma/harf hatasi ("Tof", "Nıssan") ancak gozle yakalanir; API'ye dokunulmaz.
 */
function firmalar(): void {
  const liste = readCsv(path.join(DATA_DIR, 'jetmail-import.csv'));
  if (liste.length === 0) { console.error('jetmail-import.csv bos/yok — once 04-dogrula'); process.exit(1); }
  const tekil = new Map<string, Record<string, string>>();
  for (const r of liste) if (!tekil.has(r.firma)) tekil.set(r.firma, r);
  console.log(`${liste.length} satir · ${tekil.size} tekil firma — firma → firma_kisa · sektor sorusu · konu A uzunlugu`);
  for (const [firma, r] of [...tekil.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'))) {
    const kisa = firmaKisa(firma);
    const konuA = KONU.A(kisa);
    const uyari = konuA.length > KONU_MAX ? ` ⚠ konu ${konuA.length} kr > ${KONU_MAX}` : '';
    console.log(`  ${firma}  →  "${kisa}"  ·  "${sektorSorusu(firma, r.sektor, r.sektor_sorusu)}"${uyari}`);
  }
}

/**
 * Test maili. NEDEN kisitlar: --test tek bir adrese gider; --segment veya --iys-onayli ile ayni
 * komutta verilirse "test sandim, listeye gitti" kazasi olmasin diye reddedilir. --dry-run ile de
 * reddedilir: --test GERCEK mail atar, "dry" sanip calistirma kazasi olmasin.
 */
async function test(to: string): Promise<void> {
  if (DRY) { console.error('--test GERCEK mail atar; prova icin --segment <x> --dry-run'); process.exit(2); }
  if (IYS_ONAYLI || SEGMENT) { console.error('--test ile --iys-onayli / --segment ayni komutta kullanilamaz (test yalniz tek adrese gider).'); process.exit(2); }
  if (!/^[^\s,;@]+@[^\s,;@]+\.[^\s,;@]+$/.test(to)) { console.error(`--test tek bir e-posta adresi ister, verilen: "${to}"`); process.exit(2); }
  if (!FROM_EMAIL) { console.error('MAILJET_FROM_EMAIL yok'); process.exit(2); }
  kimlikKapisi(['finans', 'eticaret-perakende-teknoloji'], 'gercek');
  const ornek: Alici = { email: to, ad: 'Ayşe', soyad: 'Yılmaz', firma: 'ÖRNEK BANK A.Ş.', unvan: 'Dijital Pazarlama Direktörü', sektor: 'finans', varyant: 'A' };
  const r = await mj<any>('POST', '/v3.1/send', { Messages: [mesaj(ornek, true), mesaj({ ...ornek, sektor: 'eticaret-perakende-teknoloji', firma: 'Örnek Market', varyant: 'B' }, true)] });
  for (const m of r.Messages ?? []) console.log(`test → ${m.Status}${m.Errors ? ' ' + JSON.stringify(m.Errors).slice(0, 200) : ''}`);
  console.log('Gelen kutusunda: HTML gorunumu, duz metin surumu, ret linki, List-Unsubscribe basligi (Mailjet\'in kendi https basligiyla CIFT olusuyor mu?) ve imza (ad/unvan/adres/MERSIS) — mail-tester.com adresine de gonderip puanina bak (>=9/10).');
}

type Sayac = { kampanyaSayisi: number; sent: number; hard: number; soft: number; blocked: number; spam: number; opened: number; clicked: number };

/**
 * Kampanya sayaclari. NEDEN statcounters: eski campaignoverview/messagesentstatistics yolu
 * bounce alanlarini guvenilir vermiyordu; statcounters (Lifetime, Message) hard/soft bounce'u ayri sayar.
 * Ayni CustomCampaign adiyla birden fazla Mailjet kampanyasi olusabilir (farkli konu satiri = ayri kampanya;
 * konu A/B + firma adi → adres basina ayri kampanya olabilir) → Limit=100 ile Offset uzerinden sayfalanir, hepsi toplanir.
 */
async function kampanyaSayac(ad: string): Promise<Sayac | null> {
  const SAYFA = 100;
  const idler: number[] = [];
  for (let offset = 0; ; offset += SAYFA) {
    const k = await mj<{ Count?: number; Total?: number; Data: any[] }>('GET', `/v3/REST/campaign?CustomCampaign=${encodeURIComponent(ad)}&Limit=${SAYFA}&Offset=${offset}`);
    const sayfa = (k.Data ?? []).map((c: any) => c.ID).filter(Boolean);
    idler.push(...sayfa);
    // NEDEN Total'e BAKILMAZ: Mailjet, countOnly=1 verilmedikce Total'i sayfadaki Count ile ayni dondurur
    // (Total = 100 iken offset+100 < 100 false → 101. kampanyadan sonrasi hic okunmaz, bounce orani eksik cikardi).
    // Guvenli olcut: dolu sayfa (=SAYFA) geldigi surece bir sonraki sayfayi iste; eksik/bos sayfa = son.
    // NEDEN ham uzunluk: ID'siz kayit filtrelenince 99 < 100 gibi yanlis 'son sayfa' karari verilmesin
    if ((k.Data ?? []).length < SAYFA) break;
  }
  if (idler.length === 0) return null;
  const s: Sayac = { kampanyaSayisi: idler.length, sent: 0, hard: 0, soft: 0, blocked: 0, spam: 0, opened: 0, clicked: 0 };
  for (const id of idler) {
    const r = await mj<{ Data: any[] }>('GET', `/v3/REST/statcounters?CounterSource=Campaign&CounterTiming=Message&CounterResolution=Lifetime&SourceID=${id}`);
    const d = r.Data?.[0] ?? {};
    s.sent += Number(d.MessageSentCount ?? 0);
    s.hard += Number(d.MessageHardBouncedCount ?? 0);
    s.soft += Number(d.MessageSoftBouncedCount ?? 0);
    s.blocked += Number(d.MessageBlockedCount ?? 0);
    s.spam += Number(d.MessageSpamCount ?? 0);
    s.opened += Number(d.MessageOpenedCount ?? 0);
    s.clicked += Number(d.MessageClickedCount ?? 0);
  }
  return s;
}

const bounceOrani = (s: Sayac) => (s.sent > 0 ? (s.hard + s.soft) / s.sent : 0);

function sayacYazdir(ad: string, s: Sayac): void {
  console.log(`kampanya ${ad} (${s.kampanyaSayisi} Mailjet kampanyasi): gonderilen ${s.sent} · hard bounce ${s.hard} · soft bounce ${s.soft} (toplam %${(bounceOrani(s) * 100).toFixed(1)}) · engellenen ${s.blocked} · spam sikayeti ${s.spam} · acilma ${s.opened} · tiklama ${s.clicked}`);
}

/** --stats: bounce > %3 → DUR ve exit 5 (sonraki dalga otomasyonu bu kodla kesilsin) */
async function stats(): Promise<void> {
  const s = await kampanyaSayac(KAMPANYA);
  if (!s) { console.log(`Istatistik yok (kampanya: ${KAMPANYA}). --kampanya <ad> ile baska kampanya sec.`); return; }
  sayacYazdir(KAMPANYA, s);
  if (bounceOrani(s) > BOUNCE_ESIK) {
    console.error(`⛔ DUR: bounce %${(bounceOrani(s) * 100).toFixed(1)} > %${BOUNCE_ESIK * 100} — sonraki dalgayi ATMA; bounce alan adresler icin adaylar.csv sira 2 desenine gec, listeyi yeniden dogrula.`);
    process.exit(5);
  }
  console.log(`✅ bounce esik altinda — sonraki dalga en fazla ${GUNLUK_KOTA}/gun.`);
}

/** Durum dosyasindan bugun (UTC gunu — tarih ISO yazildigi icin ayni olcek) gonderilmis/belirsiz sayisi */
function bugunGonderilen(kayit: Array<Record<string, string>>): number {
  const bugun = new Date().toISOString().slice(0, 10);
  // NEDEN belirsiz de sayilir: yanit alinamayan parca gitmis olabilir; kotayi asagi degil yukari yuvarlamak guvenli
  return kayit.filter((r) => (r.tarih ?? '').startsWith(bugun) && (r.durum === 'gonderildi' || r.durum === 'belirsiz')).length;
}

/**
 * Fren kaynagi: --onceki verildiyse o; yoksa durum dosyasinda (tarihe gore) EN SON yazilmis ve bu
 * kosumun kampanyasindan FARKLI kampanya adi. NEDEN farkli: ayni gun ikinci parti icin kendi kampanyasi
 * "onceki" sayilmaz (sayaclar henuz olusmamistir). Dosya bos / farkli kampanya yoksa null (ilk dalga).
 */
function frenKaynagi(kayit: Array<Record<string, string>>): string | null {
  if (ONCEKI) return ONCEKI;
  let son: { kampanya: string; tarih: string } | null = null;
  for (const r of kayit) {
    if (!r.kampanya || r.kampanya === KAMPANYA) continue;
    if (!son || (r.tarih ?? '') > son.tarih) son = { kampanya: r.kampanya, tarih: r.tarih ?? '' };
  }
  return son?.kampanya ?? null;
}

/**
 * Durum dosyasini ATOMIK yaz: once yan dosyaya (.tmp), sonra rename. NEDEN: writeFileSync ortada kesilirse
 * (kill, disk dolu) yarim CSV kalir; sonraki kosum onu okuyup "bu adresler hic gonderilmedi" sanir ve ikinci
 * mail atar. rename ayni dosya sisteminde atomiktir: dosya ya eski ya yeni halidir, asla yarim degil.
 */
function durumYaz(kayit: Array<Record<string, string>>): void {
  fs.mkdirSync(path.dirname(DURUM_FILE), { recursive: true });
  const tmp = `${DURUM_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, toCsv(kayit, DURUM_SUTUN), 'utf8');
  fs.renameSync(tmp, DURUM_FILE);
}

/**
 * Write-ahead on-kayit: parca POST'a gitmeden ONCE her adres 'belirsiz' olarak kayda eklenir ve dosya yazilir.
 * NEDEN: POST sirasinda script olurse (kill -9, OOM) yanit hic islenemez; dosyada iz olmazsa sonraki kosum
 * ayni adreslere ikinci mail atar. 'belirsiz' = "gitmis olabilir", sonraki kosumda atlanir.
 * Donus: eklenen satir nesneleri (kayit icindeki AYNI referanslar) — yanit gelince yerinde guncellenir.
 */
function onKayit(parca: Array<Record<string, string>>, simdi: string, kayit: Array<Record<string, string>>): Array<Record<string, string>> {
  const satirlar = parca.map((r) => ({ email: r.email, tarih: simdi, messageId: '', kampanya: KAMPANYA, durum: 'belirsiz' }));
  kayit.push(...satirlar);
  durumYaz(kayit);
  return satirlar;
}

/**
 * On-kaydi GERI AL (429 / yetki hatasi gibi "Mailjet hic islemedi" kesin olan durumlar). NEDEN: 'belirsiz'
 * birakilsa o adresler sonsuza kadar atlanir, oysa mail gitmedi; satirlar silinir, dosya yeniden yazilir.
 */
function onKayitGeriAl(satirlar: Array<Record<string, string>>, kayit: Array<Record<string, string>>): void {
  for (const s of satirlar) {
    const i = kayit.indexOf(s);
    if (i >= 0) kayit.splice(i, 1);
  }
  durumYaz(kayit);
}

/**
 * Send yanitindaki Messages[] dizisini on-kayit satirlariyla eslestirip YERINDE gunceller (dosyayi cagiran yazar).
 * NEDEN uzunluk kontrolu: Mailjet Messages[]'i istek sirasiyla dondurur; eksik/fazla gelirse eslestirme
 * kayar ve yanlis adrese "gonderildi" yazilir → o durumda hicbirini eslestirme, TUMU 'belirsiz' KALSIN.
 * Donus: [ok, hata, belirsiz] sayilari.
 */
function yanitIsle(satirlar: Array<Record<string, string>>, mesajlar: unknown): [number, number, number] {
  if (!Array.isArray(mesajlar) || mesajlar.length !== satirlar.length) return [0, 0, satirlar.length];
  let ok = 0, hata = 0;
  mesajlar.forEach((m: any, j: number) => {
    const s = satirlar[j];
    const basarili = m?.Status === 'success';
    s.durum = basarili ? 'gonderildi' : `hata:${JSON.stringify(m?.Errors ?? m?.Status ?? '').slice(0, 80)}`;
    s.messageId = String(m?.To?.[0]?.MessageID ?? '');
    if (basarili) ok++; else hata++;
  });
  return [ok, hata, 0];
}

/**
 * Kilit al: DATA_DIR/mailjet-gonderim.lock 'wx' (yoksa olustur, varsa hata). NEDEN: iki terminalde ayni anda
 * dalga kosulursa ikisi de durum dosyasini ayni halde okur ve ayni adreslere gonderir. Kilit varsa exit 6.
 * process 'exit' (normal cikis ve process.exit) ve SIGINT/SIGTERM'de silinir; kill -9'da kalir → mesajda
 * dosya yolu verilir, kullanici bayat kilidi elle siler.
 */
function kilitAl(): void {
  fs.mkdirSync(path.dirname(KILIT_FILE), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(KILIT_FILE, 'wx');
  } catch (e: any) {
    if (e?.code === 'EEXIST') {
      console.error(`DURDU: baska bir dalga suruyor (kilit: ${KILIT_FILE}). Bitmesini bekle; script olduyse kilidi elle sil.`);
      process.exit(6);
    }
    throw e;
  }
  fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  fs.closeSync(fd);
  const kaldir = () => { try { fs.unlinkSync(KILIT_FILE); } catch { /* zaten yok */ } };
  process.on('exit', kaldir);
  // NEDEN ayri sinyal isleyici: sinyal varsayilani 'exit' olayini tetiklemeden oldurur; kilit kalirdi
  // SIGHUP: terminal/SSH oturumu kapaninca kilit kalmasin (kill -9 kalintisi bilincli olarak kabul edilir)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { kaldir(); process.exit(sig === 'SIGINT' ? 130 : sig === 'SIGHUP' ? 129 : 143); });
}

/**
 * Mailjet template dili benzetimi (yalniz --ornek-goster / gozle onay icin): {{var:x}} → Variables.x,
 * [[UNSUB_LINK_EN]] → temsili URL. Gercek gonderimde bu is Mailjet'te yapilir.
 */
function ornekRender(m: ReturnType<typeof mesaj>): { konu: string; metin: string; html: string } {
  const doldur = (s: string) => s
    .replace(/\{\{var:(\w+)\}\}/g, (_, k: string) => String((m.Variables as Record<string, string>)[k] ?? `{{var:${k}}}`))
    .replace(/\[\[UNSUB_LINK_EN\]\]/g, 'https://mailjet-ret-linki.example'); // NEDEN acisiz ayrac yok: htmlOzet etiket temizleyicisini bozmasin
  return { konu: m.Subject, metin: doldur(m.TextPart), html: doldur(m.HTMLPart) };
}

/** HTML'i okunur ozete indir: <title>, on izleme, govde metni (etiketler atilir, bosluk sikistirilir) */
function htmlOzet(html: string): string {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
  const govde = html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const metin = govde
    .replace(/<\/(p|div|tr|td)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return `<title>: ${title}\n${metin}`;
}

async function dalga(): Promise<void> {
  const liste = readCsv(path.join(DATA_DIR, 'jetmail-import.csv'));
  if (liste.length === 0) { console.error('jetmail-import.csv bos/yok — once 04-dogrula'); process.exit(1); }
  const kayit: Array<Record<string, string>> = readCsv(DURUM_FILE);
  // NEDEN dosyadaki HER adres atlanir (gonderildi/belirsiz/hata farki gozetmeden): "belirsiz" olan
  // gitmis olabilir, ikinci mail = spam sikayeti riski. Yeniden denemek istersen satiri elle sil.
  const gonderilen = new Set(kayit.map((r) => r.email.toLowerCase()));
  const hedefTumu = liste
    // NEDEN tam eslesme: "finans-k1" verildiginde "finans-k1-p1" gibi alt segmentler dahil OLMAMALI;
    // her segment ayri dalga/gun olarak planlanir, startsWith ile kota sessizce asilirdi.
    .filter((r) => !SEGMENT || r.segment === SEGMENT)
    .filter((r) => (SEKTORLER as readonly string[]).includes(r.sektor))
    .filter((r) => !gonderilen.has(r.email.toLowerCase()));
  const bugun = bugunGonderilen(kayit);
  const kalanKota = Math.max(0, GUNLUK_KOTA - bugun);
  let hedef = hedefTumu.slice(0, LIMIT);
  let kotaNotu = '';
  if (hedef.length > kalanKota) {
    kotaNotu = ` · KOTA: bugun ${bugun} gonderilmis, gunluk ${GUNLUK_KOTA} siniri icin ${kalanKota} kaldi → dalga ${hedef.length}'den ${kalanKota}'e kesildi`;
    hedef = hedef.slice(0, kalanKota);
  }
  console.log(`liste ${liste.length} · segment ${SEGMENT ?? 'tumu'} · daha once gonderilmis ${gonderilen.size} · uygun ${hedefTumu.length} · bu dalga ${hedef.length}${DRY ? ' · DRY' : ''}${kotaNotu}`);
  if (hedef.length === 0) { if (kalanKota === 0) console.log(`Gunluk kota (${GUNLUK_KOTA}) doldu; yarin devam et.`); return; }

  const sektorler = [...new Set(hedef.map((h) => h.sektor))];
  const fren = frenKaynagi(kayit);
  if (DRY) {
    kimlikKapisi(sektorler, 'dry');
    console.log('DRY: gonderim yok; ilk 3 hedef (segment/varyant · firma_kisa · sektor sorusu):');
    for (const h of hedef.slice(0, 3)) console.log(`  ${h.segment}/${h.konu_varyanti || 'A'} · "${firmaKisa(h.firma)}" (${h.firma}) · "${sektorSorusu(h.firma, h.sektor, h.sektor_sorusu)}"`);
    const ornek = mesaj(aliciYap(hedef[0]));
    console.log(`DRY: ornek konu → "${ornek.Subject}" (${ornek.Subject.length} kr) · HTML ${ornek.HTMLPart.length} b · metin ${ornek.TextPart.length} b · ret etiketi ${ornek.HTMLPart.includes('[[UNSUB_LINK_EN]]') && ornek.TextPart.includes('[[UNSUB_LINK_EN]]') ? 'OK' : 'EKSIK'}`);
    const uzun = hedef.map((h) => KONU[KONU[h.konu_varyanti] ? h.konu_varyanti : 'A'](firmaKisa(h.firma))).filter((k) => k.length > KONU_MAX);
    if (uzun.length) console.warn(`DRY UYARI: ${uzun.length} konu ${KONU_MAX} karakteri asiyor, ornek: "${uzun[0]}" (${uzun[0].length} kr)`);
    if (FRENSIZ) console.log('DRY: --frensiz → onceki dalga bounce freni ATLANACAK.');
    else if (fren) console.log(`DRY: fren kaynagi ${fren}${ONCEKI ? ' (--onceki)' : ' (durum dosyasindaki son farkli kampanya)'} — bounce kontrolu gercek kosumda yapilacak; Mailjet'te bulunamazsa gonderim durur (API'ye dokunulmadi).`);
    else console.log('DRY: durum dosyasinda onceki kampanya yok → ilk dalga, fren uygulanmayacak.');
    if (ORNEK_GOSTER) {
      // NEDEN: kurucu metni son kez GOZLE onaylar; degiskenleri doldurulmus konu + duz metin + HTML ozeti basilir
      const r = ornekRender(ornek);
      console.log(`\n===== ORNEK (ilk hedef, degiskenler dolduruldu) =====\nKONU: ${r.konu}\n\n----- DUZ METIN -----\n${r.metin}\n----- DUZ METIN SONU -----\n\n----- HTML OZETI -----\n${htmlOzet(r.html)}\n----- HTML OZETI SONU -----`);
    }
    return;
  }
  if (!IYS_ONAYLI) {
    console.error('\nDURDU: --iys-onayli yok. Gercek gonderim icin once (1) Luvi Host IYS kaydi, (2) bu adreslerin IYS\'ye yuklenmesi, (3) ret listesi kontrolu. Bunlari yaptiysan --iys-onayli ile tekrar kos. Prova icin --dry-run.');
    process.exit(3);
  }
  if (!FROM_EMAIL) { console.error('MAILJET_FROM_EMAIL yok'); process.exit(2); }
  // NEDEN kilit burada: yalniz gercek gonderim (DRY degil, IYS onayli) icin; fren GET'lerinden de once ki
  // iki kosum ayni anda fren kontrolunu gecip ikisi de gondermesin.
  kilitAl();
  // NEDEN yeniden okuma: durum dosyasi kilitten ONCE okundu; tam o arada biten baska bir dalga yeni satirlar
  // yazmis olabilir (TOCTOU). Kilit altinda tekrar okunur, o adresler bu dalgadan dusurulur.
  {
    const taze = readCsv(DURUM_FILE);
    if (taze.length !== kayit.length) {
      const tazeSet = new Set(taze.map((r) => r.email.toLowerCase()));
      const once = hedef.length;
      hedef = hedef.filter((h) => !tazeSet.has(h.email.toLowerCase()));
      kayit.length = 0; kayit.push(...taze);
      if (hedef.length !== once) console.warn(`UYARI: kilit alinirken durum dosyasi degisti; ${once - hedef.length} adres bu dalgadan dusuruldu (baska bir dalga yeni yazmis).`);
      if (hedef.length === 0) { console.log('Gonderilecek adres kalmadi.'); return; }
    }
  }
  kimlikKapisi(sektorler, 'gercek');

  // NEDEN onceki dalga freni: bounce > %3 ise itibar zaten yaralidir; yeni dalga alan adini karaliste riskine sokar.
  // Kaynak Mailjet'te yoksa "fren uygulanamadi" deyip gecmek yerine DURULUR: yanlis kampanya adi / henuz
  // olusmamis sayaclar kor gonderime yol acmasin. Bilincli atlama: --frensiz.
  if (FRENSIZ) console.warn(`UYARI: --frensiz → onceki dalga bounce freni atlandi${fren ? ` (kaynak olacakti: ${fren})` : ''}.`);
  else if (fren) {
    const s = await kampanyaSayac(fren);
    if (!s) { console.error(`⛔ DUR: fren kaynagi ${fren} Mailjet'te bulunamadi (CustomCampaign). Adi kontrol et (--onceki <ad>) ya da bilincli atla: --frensiz.`); process.exit(5); }
    sayacYazdir(fren, s);
    if (bounceOrani(s) > BOUNCE_ESIK) { console.error(`⛔ DUR: onceki dalga bounce %${(bounceOrani(s) * 100).toFixed(1)} > %${BOUNCE_ESIK * 100} — bu dalga reddedildi.`); process.exit(5); }
  } else console.log('Durum dosyasinda onceki kampanya yok → ilk dalga, fren uygulanmadi.');

  let ok = 0, hata = 0, belirsiz = 0;
  for (let i = 0; i < hedef.length; i += PARCA) {
    const parca = hedef.slice(i, i + PARCA);
    const no = i / PARCA + 1;
    const body = { Messages: parca.map((r) => mesaj(aliciYap(r))) };
    const simdi = new Date().toISOString();
    // WRITE-AHEAD: POST'tan ONCE 'belirsiz' on-kayit + atomik yazim (bkz. onKayit NEDEN'i)
    const satirlar = onKayit(parca, simdi, kayit);
    let mesajlar: unknown;
    try {
      const resp = await mj<any>('POST', '/v3.1/send', body);
      mesajlar = resp?.Messages;
    } catch (e: any) {
      const h = e as MjHata;
      if (h.status === 401 || h.status === 403) {
        // NEDEN geri al: yetki reddi = Mailjet hicbir mesaji islemedi; 'belirsiz' kalsa bu adresler bos yere atlanirdi
        onKayitGeriAl(satirlar, kayit);
        console.error(`parca ${no}: yetki hatasi — ${h.message.slice(0, 200)} (on-kayit geri alindi, kayit yazilmadi)`);
        process.exit(2);
      }
      if (h.status === 429) {
        // NEDEN 'belirsiz' YAZILMAZ: 429 = "hic islemedim" garantisi (mj() zaten 3 kez tekrarladi); on-kayit
        // geri alinir, dalga DURUR ki kalan parcalar da hiz sinirina carpmasin; birkac dk sonra ayni komut kaldigi yerden devam eder.
        onKayitGeriAl(satirlar, kayit);
        console.error(`parca ${no}: hiz siniri (HTTP 429), Mailjet islemedi, kayit yazilmadi; birkac dk sonra tekrar kos. (gonderildi ${ok} · hata ${hata} · belirsiz ${belirsiz})`);
        process.exit(6);
      }
      if (h.status === null || h.status >= 500) {
        // Yanit yok / 5xx: gitmis OLABILIR → on-kayit 'belirsiz' olarak KALIR, sonraki kosum atlar.
        // NEDEN DUR (continue degil): Mailjet cokukken dongu kalan parcalari da 'belirsiz'e gomer ve
        // 200 adres limboda kalirdi; en fazla 1 parca (50) elle dogrulanir, sonra ayni komut kaldigi yerden surer.
        belirsiz += parca.length;
        console.error(`parca ${no}: ${h.message.slice(0, 200)} → ${parca.length} adres 'belirsiz' kaldi. DALGA DURDU: status.mailjet.com'a ve Mailjet > Messages'ta CustomID ${KAMPANYA}:<email> ile bu adreslere bak; gidenleri durum dosyasinda 'gonderildi' yap, gitmeyenlerin satirini sil, sonra ayni komutu tekrar kos. (gonderildi ${ok} · hata ${hata} · belirsiz ${belirsiz})`);
        process.exit(7);
      }
      // 4xx: KARISIK YANIT olabilir — Mailjet v3.1 bir mesaj hatali diye 400 donerken digerlerini gondermis
      // olabilir; govdedeki Messages[] okunur, adres adres guncellenir. Govde bos/bozuk/kisa ise tumu 'belirsiz' kalir.
      let govdeMesajlar: unknown = null;
      try { govdeMesajlar = JSON.parse(h.govde || '')?.Messages; } catch { /* bozuk govde */ }
      if (!Array.isArray(govdeMesajlar)) {
        // NEDEN geri al: govdede Messages[] yoksa istek BUTUN olarak reddedilmistir (tip uyusmazligi, bilinmeyen
        // alan, 413...) = hic islenmedi. 'belirsiz' birakmak butun dalgayi kalici olarak atlatirdi (adres kaybi).
        onKayitGeriAl(satirlar, kayit);
        console.error(`parca ${no}: Mailjet istegi butunuyle reddetti (HTTP ${h.status}) — ${h.message.slice(0, 300)}. Kayit yazilmadi; istegi/sablonu duzeltip ayni komutu tekrar kos.`);
        process.exit(6);
      }
      const [o, ha, b] = yanitIsle(satirlar, govdeMesajlar);
      ok += o; hata += ha; belirsiz += b;
      console.error(`parca ${no}: HTTP ${h.status} — ${h.message.slice(0, 200)} → govdeden ${o} gonderildi · ${ha} hata · ${b} belirsiz yazildi`);
      durumYaz(kayit);
      continue;
    }
    const [o, ha, b] = yanitIsle(satirlar, mesajlar);
    ok += o; hata += ha; belirsiz += b;
    if (b) console.warn(`parca ${no}: 200 ama Messages[] eksik/bozuk → ${b} adres 'belirsiz' kaldi`);
    // NEDEN yanittan hemen sonra yaz: on-kayit 'belirsiz'di; gercek sonuc (gonderildi/hata) dosyaya ATOMIK islenir
    durumYaz(kayit);
    console.log(`parca ${no}: ${parca.length} islendi (toplam gonderildi ${ok} · hata ${hata} · belirsiz ${belirsiz})`);
    if (i + PARCA < hedef.length) await sleep(jitter(1500, 3000));
  }
  console.log(`gonderildi ${ok} · hata ${hata} · belirsiz ${belirsiz} · durum dosyasi: ${DURUM_FILE}\nYARIN: --stats --kampanya ${KAMPANYA} ile bounce oranina bak; > %3 ise bir sonraki dalgayi ATMA, listeyi yeniden dogrula.`);
}

async function main() {
  if (args.dns === true) return dns();
  if (args.firmalar === true) return firmalar();
  if (args.test === true) { console.error('--test icin adres ver: --test sen@ranksup.ai'); process.exit(2); }
  if (TEST_TO) return test(TEST_TO);
  if (args.stats === true) return stats();
  return dalga();
}

// NEDEN dogrudan-kosum kapisi: firmaKisa/sektorSorusu test dosyasindan import edilebilsin, import'ta dalga() calismasin
const dogrudan = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (dogrudan) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
