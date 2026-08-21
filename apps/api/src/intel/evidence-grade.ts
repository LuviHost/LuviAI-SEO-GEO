/**
 * Kanit tartimi — bu modulun VAR OLMA sebebi.
 *
 * SEO/GEO dunyasinin temel sorunu bilgi kitligi degil, bilgi ENFLASYONU:
 * "llms.txt sart" diyen yuzlerce ajans yazisi ile Google'in "kullanmiyoruz"
 * dedigi tek resmi not ayni arama sonucunda yan yana durur. Bir toplama
 * sistemi ikisini esit sayarsa cogunlugun yanildigi her konuda YANLIS
 * ogrenir — ve o yanlisi urunun skorlama mantigina tasir.
 *
 * Bu yuzden her kanit ikiye ayrilir:
 *   1) KANIT TURU (grade)  — icerikten cikar: N kac, metodoloji var mi,
 *                            resmi mi, yoksa birinin fikri mi?
 *   2) KAYNAK AGIRLIGI     — source-registry'den gelir (katman on-agirligi)
 *
 * Ikisinin carpimi tazelikle olceklenir ve iddia defterinde destek/karsit
 * kefelerine yazilir. Sonuc bir SAYI degil bir DURUM'dur: CONFIRMED,
 * CONTESTED, EMERGING, MYTH. Cunku ekibin ihtiyaci "0.72" degil,
 * "bunu toplantida savunabilir miyim?" cevabidir.
 */

/**
 * Kanit turu — bir iddianin arkasindaki delilin cinsi.
 * Puanlar mutlak dogruluk degil, BIRBIRINE GORE sira ifade eder.
 */
export type EvidenceGrade =
  /** Platformun kendi dokumani/duyurusu. "Google soyle diyor" degil, Google diyor. */
  | 'official-doc'
  /** Buyuk orneklem (N>=1000), metodoloji aciklanmis veri calismasi */
  | 'large-n-study'
  /** Kontrollu test: A/B, oncesi-sonrasi, degisken izole edilmis */
  | 'controlled-test'
  /** Tek vaka, sonuc raporlanmis ama kontrol grubu yok */
  | 'case-study'
  /** Taninmis uzmanin veri sunmadan yaptigi degerlendirme */
  | 'expert-opinion'
  /** Forum/tekil kullanici deneyimi */
  | 'anecdote'
  /** Iddia var, dayanak yok — cogu zaman satis amacli */
  | 'speculation';

export const GRADE_SCORE: Record<EvidenceGrade, number> = {
  'official-doc': 100,
  'large-n-study': 85,
  'controlled-test': 70,
  'case-study': 45,
  'expert-opinion': 35,
  anecdote: 20,
  speculation: 5,
};

export const GRADE_LABEL_TR: Record<EvidenceGrade, string> = {
  'official-doc': 'Resmî doküman',
  'large-n-study': 'Büyük örneklemli çalışma',
  'controlled-test': 'Kontrollü test',
  'case-study': 'Vaka çalışması',
  'expert-opinion': 'Uzman görüşü',
  anecdote: 'Anekdot',
  speculation: 'Spekülasyon',
};

/** Kanitin iddiaya karsi tutumu */
export type EvidenceStance = 'supports' | 'refutes' | 'mixed';

/** Iddianin defterdeki nihai durumu */
export type ClaimStatus =
  /** Guclu kanit, ciddi karsit yok — urunde guvenle kullanilabilir */
  | 'CONFIRMED'
  /** Iki yonde de kayda deger kanit — dikkatli konus, kosullari soyle */
  | 'CONTESTED'
  /** Yeni/zayif kanit — izlemeye al, urune yazma */
  | 'EMERGING'
  /** Guclu karsit kanit — yayginca inanilan ama yanlis */
  | 'MYTH'
  /** Kanitlar var ama eski — yeniden dogrulanmali */
  | 'STALE';

export const STATUS_LABEL_TR: Record<ClaimStatus, string> = {
  CONFIRMED: 'Doğrulandı',
  CONTESTED: 'Çekişmeli',
  EMERGING: 'Yeni sinyal',
  MYTH: 'Mit',
  STALE: 'Bayat',
};

export interface EvidenceInput {
  grade: EvidenceGrade;
  stance: EvidenceStance;
  /** Kaynak katmani on-agirligi 0-100 (source-registry) */
  sourceWeight: number;
  /** Kanitin yayin tarihi — tazelik olceklemesi icin */
  publishedAt: Date | null;
  /** Calismadaki orneklem buyuklugu; large-n-study icin dogrulama saglar */
  sampleSize?: number | null;
  /**
   * Kanitin geldigi kaynagin kimligi (IntelSource.key). Kesin hukum icin
   * FARKLI kaynak sayisi buradan olculur; verilmeyen kanit kendi basina
   * bir kaynak sayilir (eski cagiranlar/testler kirilmasin).
   */
  sourceKey?: string;
}

/**
 * Tazelik carpani. Arama tarafi hizli degisiyor: 2024'te dogru olan bir
 * olcum 2026'da gecersiz olabilir. Resmi dokumanlar da eskir (Google
 * rehberini gunceller), o yuzden istisna yapmiyoruz.
 */
export function recencyFactor(publishedAt: Date | null, now = new Date()): number {
  if (!publishedAt) return 0.6; // tarih bilinmiyorsa temkinli
  const ageDays = (now.getTime() - publishedAt.getTime()) / 86_400_000;
  if (ageDays < 0) return 1;          // ileri tarihli (feed hatasi) — cezalandirma
  if (ageDays <= 90) return 1;
  if (ageDays <= 180) return 0.85;
  if (ageDays <= 365) return 0.7;
  if (ageDays <= 730) return 0.45;
  return 0.25;
}

/**
 * Tek bir kanitin etkili agirligi.
 *
 * sampleSize DOGRULAMASI: LLM bir yaziyi 'large-n-study' diye
 * etiketleyip N vermediyse, etiketi tam puanla odullendirmek analiz
 * hatasini sisteme sabitler. N yoksa ya da 1000'in altindaysa puan
 * controlled-test seviyesine cekilir.
 */
export function evidenceWeight(e: EvidenceInput, now = new Date()): number {
  let base = GRADE_SCORE[e.grade] ?? 0;

  if (e.grade === 'large-n-study') {
    const n = e.sampleSize ?? 0;
    if (n < 1000) base = GRADE_SCORE['controlled-test'];
  }

  const src = Math.max(0, Math.min(100, e.sourceWeight)) / 100;
  return base * src * recencyFactor(e.publishedAt, now);
}

export interface ClaimVerdict {
  status: ClaimStatus;
  /** -1 (tamamen curutulmus) .. +1 (tamamen desteklenmis) */
  confidence: number;
  supportWeight: number;
  refuteWeight: number;
  /** Kefelerdeki toplam kanit agirligi — yeterlilik esigi icin */
  totalWeight: number;
  /** En guclu tek kanitin agirligi — tek resmi dokuman 10 anekdotu yener */
  peakWeight: number;
  evidenceCount: number;
}

/**
 * Bir iddianin toplam kanit durumunu hesaplar.
 *
 * MIXED kanit iki kefeye de yarim agirlikla yazilir: "kismen dogru"
 * bilgisini atmak, iddiayi oldugundan kesin gostermek olur.
 */
export function computeVerdict(evidences: EvidenceInput[], now = new Date()): ClaimVerdict {
  let support = 0;
  let refute = 0;
  let supportPeak = 0;
  let refutePeak = 0;

  for (const e of evidences) {
    const w = evidenceWeight(e, now);
    if (e.stance === 'supports') {
      support += w;
      if (w > supportPeak) supportPeak = w;
    } else if (e.stance === 'refutes') {
      refute += w;
      if (w > refutePeak) refutePeak = w;
    } else {
      support += w / 2;
      refute += w / 2;
      if (w / 2 > supportPeak) supportPeak = w / 2;
      if (w / 2 > refutePeak) refutePeak = w / 2;
    }
  }

  // KADEME BASKINLIGI — bu modulun en kritik kurali.
  //
  // Duz toplamda alt kademe kanitlar YIGILARAK ust kademeyi dengeleyebilir:
  // dort ajans blogu (her biri ~12) toplamda 47 eder ve Google'in resmi
  // notu + 137 bin siteli calismayi (177) "cekismeli" gosterir. Oysa bilgi
  // boyle calismaz — bin blog yazisi platformun kendi aciklamasini
  // curutemez.
  //
  // Kural: bir tarafta belirleyici kanit (resmi dokuman / buyuk-N calisma)
  // varken diger tarafin en guclu tekil kaniti vaka calismasi esiginin
  // altinda kaliyorsa, zayif taraf KENDI EN IYI ORNEGI kadar sayilir;
  // coklugu ona ek guc vermez.
  const dominance = applyGradeDominance(support, refute, supportPeak, refutePeak);
  support = dominance.support;
  refute = dominance.refute;

  const peak = Math.max(supportPeak, refutePeak);
  const total = support + refute;
  const confidence = total > 0 ? (support - refute) / total : 0;

  return {
    status: decideStatus({ total, peak, confidence, evidences, now }),
    confidence: Math.round(confidence * 100) / 100,
    supportWeight: Math.round(support),
    refuteWeight: Math.round(refute),
    totalWeight: Math.round(total),
    peakWeight: Math.round(peak),
    evidenceCount: evidences.length,
  };
}

/**
 * YETERLILIK ESIGI: bir tarafin kazanmis sayilmasi icin sadece oran degil
 * MUTLAK agirlik da gerekir. Aksi halde tek bir Medium yazisi (agirlik ~7)
 * confidence=+1 uretip iddiayi "CONFIRMED" yapardi.
 */
const MIN_TOTAL_FOR_VERDICT = 60;
/** Tek basina hukum verdirebilecek kanit gucu — resmi dokuman bu esigin ustunde */
const DECISIVE_PEAK = 70;
/**
 * Karsi tarafin en guclu kaniti bu esigin altindaysa "ast kademe" sayilir
 * ve yigilamaz. Vaka calismasi tam puani (45) esik olarak alindi: vaka
 * calismasi ve ustu ciddiye alinir, uzman gorusu/anekdot/spekulasyon
 * yigini belirleyici kanita karsi tek ornegi kadar sayilir.
 */
const SUBORDINATE_PEAK = 45;
/** Bu yastan sonra kanit yenilenmeliyse iddia bayat sayilir */
/**
 * Kesin hukum (CONFIRMED/MYTH) icin gereken FARKLI kaynak sayisi.
 *
 * URUN KARARI (2026-08-21): tek kanitla is yapilmaz. Tek guclu kanit
 * (peak >= 70) daha once tek basina CONFIRMED verebiliyordu ve defterin
 * 206 CONFIRMED'inin 158'i tek kanitliydi — tek bir yazinin (kaynak ne
 * kadar guclu olursa olsun) urun mantigini yonlendirmesi kabul edilmedi.
 * Ikinci bagimsiz kaynak gelene kadar iddia EMERGING'de bekler; guidance
 * da "izlemede tut, urune yazma" der. MYTH icin de simetrik: tek calisma
 * bir inanisi "curutulmus" ilan edemez.
 */
const MIN_DISTINCT_SOURCES = 2;

const STALE_AFTER_DAYS = 270;

function applyGradeDominance(
  support: number,
  refute: number,
  supportPeak: number,
  refutePeak: number,
): { support: number; refute: number } {
  // Curutme tarafi baskin: destek yigini kendi en iyi ornegine kirpilir
  if (refutePeak >= DECISIVE_PEAK && supportPeak < SUBORDINATE_PEAK) {
    return { support: Math.min(support, supportPeak), refute };
  }
  // Destek tarafi baskin — simetrik
  if (supportPeak >= DECISIVE_PEAK && refutePeak < SUBORDINATE_PEAK) {
    return { support, refute: Math.min(refute, refutePeak) };
  }
  // Iki tarafta da ciddi kanit var — gercek bir cekisme, kirpma yapilmaz
  return { support, refute };
}

function decideStatus(ctx: {
  total: number;
  peak: number;
  confidence: number;
  evidences: EvidenceInput[];
  now: Date;
}): ClaimStatus {
  const { total, peak, confidence, evidences, now } = ctx;

  if (evidences.length === 0) return 'EMERGING';

  // Yeterli agirlik yok VE tek basina belirleyici bir kanit da yok
  if (total < MIN_TOTAL_FOR_VERDICT && peak < DECISIVE_PEAK) return 'EMERGING';

  // TEK KAYNAKLA KESIN HUKUM YOK (bkz. MIN_DISTINCT_SOURCES notu).
  // sourceKey verilmemis kanit kendi basina bir kaynak sayilir.
  const distinctSources = new Set(
    evidences.map((e, i) => e.sourceKey ?? `__anon_${i}`),
  ).size;
  if (distinctSources < MIN_DISTINCT_SOURCES) return 'EMERGING';

  // Bayatlik hukumden ONCE bakilir: eski bir "CONFIRMED" yanlis guven verir
  const newest = evidences
    .map((e) => e.publishedAt?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  if (newest > 0) {
    const ageDays = (now.getTime() - newest) / 86_400_000;
    if (ageDays > STALE_AFTER_DAYS) return 'STALE';
  }

  if (confidence >= 0.6) return 'CONFIRMED';
  if (confidence <= -0.6) return 'MYTH';
  return 'CONTESTED';
}

/**
 * Ekip icin tek cumlelik kullanim talimati — digest ve panelde gosterilir.
 * "Skor 0.71" degil "bunu su sekilde konus" demek isin asil ciktisi.
 */
export function verdictGuidance(v: ClaimVerdict, status: ClaimStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Ürün mantığında ve müşteri konuşmasında dayanak olarak kullanılabilir.';
    case 'MYTH':
      return 'Sen söyle, onlar sormadan: yaygın inanışın aksine kanıt bunu çürütüyor. Savunmaya geçme, veriyi göster.';
    case 'CONTESTED':
      return 'Koşullu konuş — hangi durumda geçerli olduğunu söyle, kesin dil kullanma.';
    case 'EMERGING':
      return 'İzlemede tut. Ürüne veya söyleme henüz yazma; kanıt biriktikçe yeniden değerlendirilecek.';
    case 'STALE':
      return 'Kanıtlar eskimiş — yeniden doğrulanmadan kullanma.';
  }
}
