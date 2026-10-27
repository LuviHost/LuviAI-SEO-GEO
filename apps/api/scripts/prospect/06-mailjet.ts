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
 *   MAILJET_GONDEREN_ADRES (zorunlu), MAILJET_MERSIS (ticaret siciline kayitli ise) YA DA
 *   MAILJET_KIMLIK (sicile kayitli olmayan sahis isletmesi: "Ad Soyad · VKN … · … V.D." — biri zorunlu)
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
 *         ya da --input kurumsal-import.csv (07 — kurumsal rol adresleri; ad/soyad BOS → hitap "Merhaba {firma} ekibi,")
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
import { DATA_DIR, parseArgs, readCsv, sleep, jitter, toCsv } from '../../src/prospect/prospect-utils.js';
import {
  GONDERIM_SEKTORLERI, KONU_MAX, firmaKisa, isimsizHitap, kimlikEnv, kimlikSorunlari, konuSatiri, mailjetMesaj, sektorSorusu, type Alici,
} from '../../src/prospect/eposta-sablon.js';

// Spec ve geriye uyumluluk icin yeniden disari ver (06-mailjet.spec.ts bu yoldan import eder)
export { GONDERIM_SEKTORLERI, firmaKisa, isimsizHitap, konuSatiri, sektorSorusu };

const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === true;
/** --dry-run ile: ilk hedefin konu/duz metin/HTML ozetini degiskenleri doldurarak bas (gozle son onay icin) */
const ORNEK_GOSTER = args['ornek-goster'] === true;
const LIMIT = args.limit ? Number(args.limit) : 100;
const SEGMENT = typeof args.segment === 'string' ? String(args.segment) : null;
const IYS_ONAYLI = args['iys-onayli'] === true;
const TEST_TO = typeof args.test === 'string' ? String(args.test) : null;
/** Girdi dosyasi: DATA_DIR icindeki ad ya da yol (varsayilan 04'un ciktisi) */
const INPUT_FILE = typeof args.input === 'string'
  ? (path.isAbsolute(String(args.input)) || String(args.input).includes('/') ? path.resolve(String(args.input)) : path.join(DATA_DIR, String(args.input)))
  : path.join(DATA_DIR, 'jetmail-import.csv');
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

const API = 'https://api.mailjet.com';
const KEY = process.env.MAILJET_API_KEY ?? '';
const SECRET = process.env.MAILJET_SECRET ?? '';
const FROM_EMAIL = process.env.MAILJET_FROM_EMAIL ?? '';

const DURUM_FILE = path.join(DATA_DIR, 'mailjet-gonderim.csv');
const DURUM_SUTUN = ['email', 'tarih', 'messageId', 'kampanya', 'durum'];
/** Es zamanli ikinci dalgayi engelleyen kilit (yalniz gercek gonderimde alinir) */
const KILIT_FILE = path.join(DATA_DIR, 'mailjet-gonderim.lock');
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

/**
 * Elle duzeltilmis marka adlari ve haric tutulan alan adlari — DATA_DIR/marka-duzeltme.csv (web,marka,haric).
 * NEDEN: ajans unvanlari ("CONCEPT / CONCEPT YARATIM REKLAM VE İLETİŞİM HİZ. TİC.") kuralla temiz marka adina
 * inmiyor; hitap ve konu satirinda "Merhaba Concept ekibi," gorunmeli. 07 import dosyasini yeniden yazdiginda
 * duzeltme kaybolmasin diye ayri dosyada, alan adiyla eslenir. haric=1 → bu adrese gonderilmez (ör. yurt disi genel kutu).
 */
const MARKA_DUZELTME: Map<string, { marka: string; haric: boolean }> = new Map(
  readCsv(path.join(DATA_DIR, 'marka-duzeltme.csv')).map((r) => [String(r.web ?? '').trim().toLowerCase(), { marka: String(r.marka ?? '').trim(), haric: String(r.haric ?? '').trim() === '1' }]),
);
function duzeltme(r: Record<string, string>): { marka: string; haric: boolean } | undefined {
  const web = String(r.web ?? '').trim().toLowerCase();
  const dom = String(r.email ?? '').split('@')[1]?.toLowerCase() ?? '';
  return MARKA_DUZELTME.get(web) ?? MARKA_DUZELTME.get(dom);
}

/** CSV satirini Alici'ye cevir (konu_varyanti bos → A) */
const aliciYap = (r: Record<string, string>): Alici => ({ email: r.email, ad: r.ad, soyad: r.soyad, firma: r.firma, unvan: r.unvan, sektor: r.sektor, varyant: r.konu_varyanti || 'A', sektor_sorusu: r.sektor_sorusu, marka: r.marka || duzeltme(r)?.marka || undefined });

/** Script sarmalayicilari: modul hata firlatir, CLI acik mesajla cikar */
const KIMLIK_CFG = kimlikEnv(process.env);
function mesaj(to: Alici, testMi = false) {
  try {
    return mailjetMesaj(to, { kimlik: KIMLIK_CFG, kampanya: KAMPANYA, testMi });
  } catch (e: any) {
    console.error(`DURDU: ${e?.message ?? e}`);
    process.exit(1);
  }
}

/**
 * GUVENLIK KAPISI — gercek gonderim ve --test oncesi. Env bos veya render edilmis govdede kalinti varsa
 * exit 4; --dry-run'da yalnizca UYARI (prova akisi durmasin).
 */
function kimlikKapisi(sektorler: string[], mod: 'gercek' | 'dry'): void {
  const sorunlar = kimlikSorunlari(KIMLIK_CFG, sektorler);
  if (sorunlar.length === 0) return;
  const m = `Gonderici kimligi eksik (Yonetmelik md. 5/1): ${sorunlar.join(' · ')}`;
  if (mod === 'dry') { console.warn(`UYARI: ${m}`); return; }
  console.error(`DURDU: ${m}`);
  process.exit(4);
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
  const liste = readCsv(INPUT_FILE);
  if (liste.length === 0) { console.error(`${path.basename(INPUT_FILE)} bos/yok — once 04-dogrula (isimli) ya da 07-kurumsal-adres (kurumsal)`); process.exit(1); }
  const tekil = new Map<string, Record<string, string>>();
  for (const r of liste) if (!tekil.has(r.firma)) tekil.set(r.firma, r);
  console.log(`${liste.length} satir · ${tekil.size} tekil firma — firma → firma_kisa · sektor sorusu · konu A uzunlugu`);
  for (const [firma, r] of [...tekil.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'))) {
    const kisa = r.marka || duzeltme(r)?.marka || firmaKisa(firma);
    const konuA = konuSatiri(r.sektor, "A", kisa);
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
  kimlikKapisi(['finans', 'eticaret-perakende-teknoloji', 'ajans', 'diger'], 'gercek');
  const ornek: Alici = { email: to, ad: 'Ayşe', soyad: 'Yılmaz', firma: 'ÖRNEK BANK A.Ş.', unvan: 'Dijital Pazarlama Direktörü', sektor: 'finans', varyant: 'A' };
  const r = await mj<any>('POST', '/v3.1/send', { Messages: [mesaj(ornek, true), mesaj({ ...ornek, sektor: 'eticaret-perakende-teknoloji', firma: 'Örnek Market', varyant: 'B' }, true),
    // isimsiz kurumsal kutular (07): ajans is birligi + genel metin, "Merhaba {firma} ekibi," hitabi
    mesaj({ ...ornek, ad: '', soyad: '', unvan: '', sektor: 'ajans', firma: 'Örnek Ajans', varyant: 'A' }, true),
    mesaj({ ...ornek, ad: '', soyad: '', unvan: '', sektor: 'diger', firma: 'Örnek Sanayi', varyant: 'B' }, true)] });
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
  const liste = readCsv(INPUT_FILE);
  if (liste.length === 0) { console.error(`${path.basename(INPUT_FILE)} bos/yok — once 04-dogrula (isimli) ya da 07-kurumsal-adres (kurumsal)`); process.exit(1); }
  const kayit: Array<Record<string, string>> = readCsv(DURUM_FILE);
  // NEDEN dosyadaki HER adres atlanir (gonderildi/belirsiz/hata farki gozetmeden): "belirsiz" olan
  // gitmis olabilir, ikinci mail = spam sikayeti riski. Yeniden denemek istersen satiri elle sil.
  const gonderilen = new Set(kayit.map((r) => r.email.toLowerCase()));
  const hedefTumu = liste
    // NEDEN tam eslesme: "finans-k1" verildiginde "finans-k1-p1" gibi alt segmentler dahil OLMAMALI;
    // her segment ayri dalga/gun olarak planlanir, startsWith ile kota sessizce asilirdi.
    .filter((r) => !SEGMENT || r.segment === SEGMENT)
    .filter((r) => GONDERIM_SEKTORLERI.includes(r.sektor))
    .filter((r) => !duzeltme(r)?.haric)
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
    for (const h of hedef.slice(0, 3)) console.log(`  ${h.segment}/${h.konu_varyanti || 'A'} · "${aliciYap(h).marka || firmaKisa(h.firma)}" (${h.firma}) · "${sektorSorusu(h.firma, h.sektor, h.sektor_sorusu)}"`);
    const ornek = mesaj(aliciYap(hedef[0]));
    console.log(`DRY: ornek konu → "${ornek.Subject}" (${ornek.Subject.length} kr) · HTML ${ornek.HTMLPart.length} b · metin ${ornek.TextPart.length} b · ret etiketi ${ornek.HTMLPart.includes('[[UNSUB_LINK_EN]]') && ornek.TextPart.includes('[[UNSUB_LINK_EN]]') ? 'OK' : 'EKSIK'}`);
    const uzun = hedef.map((h) => konuSatiri(h.sektor, h.konu_varyanti, aliciYap(h).marka || firmaKisa(h.firma))).filter((k) => k.length > KONU_MAX);
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
