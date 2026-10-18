/**
 * Turkiye telefon numarasi: E.164'e cevirme + metinden cikarma (saf).
 *
 * NEDEN: yerel olcumde (Prompt Lab yerel mod) AI cevabindaki numara ile
 * sitenin kendi numarasi karsilastiriliyor. "0216 123 45 67", "+90 (216)
 * 123-4567" ve "tel:+902161234567" ayni numaradir; karsilastirma ancak ikisi
 * de ayni bicime (E.164: +90 + ulusal anlamli numara) indirilirse dogru olur.
 *
 * Numaralandirma plani — iki bagimsiz kaynak:
 *  - BTK'nin ITU'ya bildirdigi Ulusal Numaralandirma Plani (2.III.2018):
 *    ulusal anlamli numara (NSN) en az ve en cok 10 hane; cografi alan
 *    kodlari 212..488, mobil 5xx, 800 / 811 / 812 / 850 / 888 / 898 / 900.
 *    https://www.itu.int/oth/T02020000D6 (PDF: T02020000D60002PDFE.pdf)
 *  - https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey — ulke kodu 90,
 *    yurt ici on eki 0, uluslararasi on ek 00; "444 XX XX" cagri merkezi
 *    numaralari 7 hanedir, alan koduyla aranmaz, yurt disindan 90 + numara.
 *    444'un yurt disi bicimi kurum sayfalarinda da boyle yaziliyor
 *    ("+90 444 0 448": https://www.yapikredi.com.tr/sinirsiz-bankacilik/musteri-iletisim-merkezi/kurumsal-telefon-bankaciligi/).
 *
 * Mobil onekler bilerek genis (5xx): plan 2018'den sonra yeni 5xx bloklari
 * dagitti; listeyi sabitlemek gecerli bir numarayi kacirmak demek. Cografi
 * kodlar ise 81 ile sabit — rastgele 10 haneli sayilar (siparis no, tarih)
 * numara sanilmasin diye listeyle dogrulanir.
 *
 * KKTC sabit hatlari Turkiye plani icinde 392 alan koduyla aranir (+90 392 +
 * 7 hane). Iki kaynak: Wikipedia alan kodu tablosu "392 | TRNC"
 * (https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey) ve RIPE NCC
 * uye kaydi KKTC Merkez Bankasi "+903926115102"
 * (https://ripe.net/membership/indices/data/tr.kktcmb.html). KKTC mobil
 * hatlari (533, 542, 548) zaten 5xx icinde.
 */

/** Cografi alan kodlari — ITU belgesindeki tablo (81 il, Istanbul iki kod) */
const GEO_AREA_CODES: ReadonlySet<string> = new Set([
  '212', '216', '222', '224', '226', '228', '232', '236', '242', '246', '248', '252', '256', '258',
  '262', '264', '266', '272', '274', '276', '282', '284', '286', '288',
  '312', '318', '322', '324', '326', '328', '332', '338', '342', '344', '346', '348', '352', '354',
  '356', '358', '362', '364', '366', '368', '370', '372', '374', '376', '378', '380', '382', '384',
  '386', '388',
  '412', '414', '416', '422', '424', '426', '428', '432', '434', '436', '438', '442', '446', '452',
  '454', '456', '458', '462', '464', '466', '472', '474', '476', '478', '482', '484', '486', '488',
]);

/** Cografi olmayan 10 haneli bloklar (ITU tablosu) */
const NON_GEO_CODES: ReadonlySet<string> = new Set(['800', '811', '812', '850', '888', '898', '900']);

/** KKTC sabit hat alan kodu (kaynaklar dosya basinda) */
const KKTC_AREA_CODE = '392';

/** 3 haneli ulusal hedef kodu (alan kodu / mobil / cografi olmayan) gecerli mi */
function isNdc(ndc: string): boolean {
  return /^\d{3}$/.test(ndc) && (ndc[0] === '5' || GEO_AREA_CODES.has(ndc) || NON_GEO_CODES.has(ndc) || ndc === KKTC_AREA_CODE);
}

/** 10 haneli NSN ya da 7 haneli 444 numarasi gecerli mi */
function isValidNsn(nsn: string): boolean {
  if (/^444\d{4}$/.test(nsn)) return true;
  if (!/^\d{10}$/.test(nsn)) return false;
  return isNdc(nsn.slice(0, 3));
}

/**
 * Yalniz rakamlardan olusan diziyi E.164'e cevirir. `plus`: orijinal metin
 * "+" ile basliyordu (uluslararasi bicim).
 */
function e164FromDigits(digits: string, plus: boolean): string | null {
  let nsn: string;
  if (plus) {
    if (!digits.startsWith('90')) return null; // yalniz Turkiye numaralari
    nsn = digits.slice(2);
  } else if (digits.startsWith('0090')) {
    nsn = digits.slice(4);
  } else if (digits.startsWith('90') && digits.length === 12) {
    nsn = digits.slice(2);
  } else if (digits.startsWith('0') && (digits.length === 11 || /^0444\d{4}$/.test(digits))) {
    // "0444 ..." teknik olarak yanlis ama sitelerde yaziliyor; 0 dusurulur
    nsn = digits.slice(1);
  } else {
    nsn = digits;
  }
  // "+90 (0216) ..." — uluslararasi bicimde yurt ici 0'i da yazanlar
  if (nsn.length === 11 && nsn.startsWith('0')) nsn = nsn.slice(1);
  // Alan koduyla yazilmis 444 numarasi ("0212 444 0 448") 7 haneli 444
  // numarasidir: 444 XXXX ulkenin her yerinden alan kodsuz ayni rakamla aranir
  // (Ulusal Numaralandirma Plani "yerel aranir numara" — TELKODER'in BTK
  // basvurusu, 24.12.2020: https://telkoder.org.tr/wp-content/uploads/2020/12/Forseti-2020-12-24.pdf),
  // alan koduyla arayana IVR kodsuz aramasini soyler
  // (https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey). Site "0212 444
  // 0 448", AI "444 0 448" yazinca ikisi ayni numaraya inmeli.
  if (nsn.length === 10 && GEO_AREA_CODES.has(nsn.slice(0, 3)) && nsn.startsWith('444', 3)) nsn = nsn.slice(3);
  return isValidNsn(nsn) ? `+90${nsn}` : null;
}

/**
 * Tek bir numara metnini E.164'e cevirir: "+90 216 123 45 67" → "+902161234567".
 * "tel:" oneki, yuzde kodlamasi ve dahili (;ext=, ",", "p") kismi atilir.
 * Turkiye numarasi degilse ya da plana uymuyorsa null.
 */
export function normalizeTrPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > 60) return null;
  s = s.replace(/^tel:/i, '');
  try { s = decodeURIComponent(s); } catch { /* bozuk kodlama — oldugu gibi */ }
  // Dahili numara / bekleme: "tel:+902161234567;ext=12", "0216 123 45 67 p12"
  s = s.split(/[;,]|\bext\b|\bdahili\b|\bx(?=\d)|p(?=\d)/i)[0];
  const plus = s.trimStart().startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 14) return null;
  return e164FromDigits(digits, plus);
}

/** E.164 → okunur bicim: "+90 216 123 45 67", "+90 444 12 34" */
export function formatTrPhone(e164: string): string {
  const m = /^\+90(\d+)$/.exec(e164 || '');
  if (!m) return e164;
  const n = m[1];
  if (n.length === 7) return `+90 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5)}`;
  if (n.length === 10) return `+90 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  return e164;
}

export interface FoundPhone {
  e164: string;
  /** Metindeki baslangic indeksi (yakinlik hesabi icin) */
  index: number;
  raw: string;
}

/**
 * Aday: istege bagli "+"/"00", ardindan rakam-bosluk-nokta-tire-parantez
 * dizisi. "/" ve virgul BILEREK sinif disinda — "0216 ... / 0532 ..." gibi
 * yan yana iki numara tek aday olmasin. Harf/rakama yapisik diziler (siparis
 * kodu "ID2161234567") aday degil.
 */
const CANDIDATE = /(?<![\p{L}\p{N}_+])(?:\+|00)?\(?\d[\d \t().-]{5,40}\d(?![\p{L}\p{N}_])/gu;

interface DigitGroup {
  d: string;
  at: number;
}

/**
 * Numara bu gruptan baslayabilir mi. 1-2 haneli grup yalnizca yurt ici on ek
 * ("0 216 ..."), uluslararasi on ek ("00 90 ...") ya da ulke kodu ("90 ...")
 * olabilir. Adresteki "Kat 5", "No:12", liste numarasi "5." ya da puan "4.5"
 * numara basi sayilmaz: "5" + sonraki 9 hane "gecerli" bir 5xx mobil numara
 * uretip gercek numarayi yutuyordu.
 */
function canStartAt(groups: DigitGroup[], k: number): boolean {
  const d = groups[k].d;
  return d.length >= 3 || d === '0' || d === '00' || d === '90';
}

/**
 * k. grup yurt ici on ekle (0) yazilmis YENI bir numaranin basi mi ("0216",
 * "(0532)", "02161234567"). Yurt ici on ek numaranin en basina yazilir; bir
 * numaranin ortasinda 0 ile baslayan 4+ haneli grup gorulmuyor, gorulurse
 * onceki gruplar baska bir sayidir ("No:312 0216 ..."). "00" ile baslayan
 * grup uluslararasi on ektir, yurt ici on ek degil.
 */
function isTrunkStart(groups: DigitGroup[], k: number): boolean {
  const d = groups[k].d;
  return d.length >= 4 && d[0] === '0' && d[1] !== '0';
}

/** "0" + gecerli 3 haneli kod: "0 216 ..." bicimindeki numara basi */
function isZeroThenNdc(groups: DigitGroup[], k: number): boolean {
  return groups[k].d === '0' && !!groups[k + 1] && isNdc(groups[k + 1].d);
}

/**
 * Simdiye kadar biriken yalniz ulke kodu mu ("+90", "0090", "00 90") — ardindan
 * "(0216)" gelebilir. "+"siz "90" sayilmaz: "No:90 0850 ..." kapi numarasidir;
 * "90 216 ..." yazimi zaten bu istisnaya ihtiyac duymaz.
 */
const isCountryCodeOnly = (acc: string, plusAtStart: boolean) => acc === '0090' || (plusAtStart && acc === '90');

/**
 * Bir aday dizideki numaralar. Rakam gruplari soldan biriktirilir; ilk
 * gecerli uzunlukta numara alinir ve kalan gruplarla devam edilir — bosluklu
 * yazilmis iki numara ("0216 123 45 67 0532 111 22 33") ikisi de bulunur.
 *
 * Biriktirme, ortada yeni bir numaranin basi gorulunce durur ve o gruptan
 * yeniden baslar: "No:312 0216 123 45 67" icinde "312" + "0216..." gecerli
 * gorunen ama sahte bir 312 numarasi uretiyordu. Istisnalar: ulke kodundan
 * sonraki "(0216)" ve "444 0 448" / "0850 222 0 444" gibi gercek yazimlar.
 */
function phonesInCandidate(cand: string, baseIndex: number): FoundPhone[] {
  const plus = cand.startsWith('+');
  const groups: DigitGroup[] = [...cand.matchAll(/\d+/g)].map((m) => ({ d: m[0], at: m.index ?? 0 }));
  const out: FoundPhone[] = [];
  let i = 0;
  // Turkiye disi uluslararasi numara ("+1 212 555 0100", "0044 20 ..."): bastaki
  // numara yabancidir; parcasindan Turkiye numarasi (212 = Istanbul) uydurulmaz.
  // Aday icinde yurt ici on ekli ikinci bir numara varsa ondan devam edilir.
  if (groups.length && (plus || groups[0].d.startsWith('00'))) {
    const lead = plus ? groups[0].d : groups[0].d.slice(2) || groups[1]?.d || '';
    if (!lead.startsWith('90')) {
      i = groups.findIndex((_, k) => k > 0 && isTrunkStart(groups, k));
      if (i < 0) return out;
    }
  }
  while (i < groups.length) {
    if (!canStartAt(groups, i)) { i++; continue; }
    let acc = '';
    let found = false;
    for (let j = i; j < groups.length && acc.length < 15; j++) {
      if (j > i && !isCountryCodeOnly(acc, plus && i === 0)) {
        if (isTrunkStart(groups, j)) break;
        // "312 0 216 ...": tek kisa grubun ardindan "0 + alan kodu" yeni numaradir.
        // "444 0 212" ise 444'lu cagri merkezi numarasinin yazimi olabilir.
        if (j === i + 1 && acc.length <= 3 && acc !== '444' && isZeroThenNdc(groups, j)) break;
      }
      acc += groups[j].d;
      if (acc.length < 7) continue;
      const e164 = e164FromDigits(acc, plus && i === 0);
      if (e164) {
        const from = groups[i].at;
        const to = groups[j].at + groups[j].d.length;
        out.push({ e164, index: baseIndex + from, raw: cand.slice(from, to) });
        i = j + 1;
        found = true;
        break;
      }
    }
    if (!found) i++;
  }
  return out;
}

/**
 * Metindeki Turkiye telefon numaralari — metindeki sirayla, tekrarsiz
 * (ayni numara ikinci kez gecerse ilk konumu kalir).
 */
export function extractTrPhones(text: string, limit = 20): FoundPhone[] {
  const out: FoundPhone[] = [];
  const seen = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(CANDIDATE)) {
    for (const p of phonesInCandidate(m[0], m.index ?? 0)) {
      if (seen.has(p.e164)) continue;
      seen.add(p.e164);
      out.push(p);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
