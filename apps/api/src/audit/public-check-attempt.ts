/**
 * Ucretsiz AI gorunurluk testinin HER denemesi — saf kurallar (I/O: public-check-attempt.service.ts).
 *
 * NEDEN VAR (14.11.2026, sahip: "uye olmadan tarayan herkesi kaydetmek istiyorum, kacirmak
 * istemiyorum"): public_citation_checks yalniz TAZE olcumu tutar. Su denemeler iz birakmiyordu:
 *  - kayitli sonucu goren ziyaretci (anonim kademede onbellegin suresi yok: bir alan adi bir kez
 *    olculduyse sonraki her ziyaretci ayni kaydi gorur),
 *  - haftalik IP sinirina ya da gunluk anonim tavana takilan,
 *  - sitesine ulasilamadigi icin tamamlanamayan.
 * Ayrica taze olcum de yalniz /admin/leads listesine dusuyor, kimse haber almiyordu.
 *
 * NE YAZILIR: alan adi (normalize host), sonuc, IP ozeti (hash), zaman. Hepsi gizlilik metninin
 * ucretsiz test maddesinde zaten sayilan veriler. Ulke / cihaz / tarayici bilgisi BILEREK yok.
 *
 * NE YAZILMAZ:
 *  - Insan dogrulamasini (Turnstile) gecemeyen ve bot olarak reddedilen istekler: kayit,
 *    dogrulamadan SONRA baslar; yoksa kimlik dogrulamasiz uc tabloyu sisirmeye acik olurdu.
 *  - Alan adina cevrilemeyen girdi. Ziyaretcinin kutuya yazdigi ham metin SAKLANMAZ: oraya
 *    e-posta adresi ya da baska kisisel bilgi yazilabilir (gizlilik metni yalniz "girdiginiz
 *    alan adi" diyor) ve takip edilecek bir site de yoktur.
 *
 * KOTUYE KULLANIM (bagimsiz inceleme, 14.11.2026): token'siz mobil yol User-Agent taklidiyle
 * Turnstile'i atlar; ucuz denemeler (haftalik sinir, cozulmeyen alan adi) tavanlari doldurup
 * gercek denemelerin kaydini ve e-postasini engelleyebilirdi. Bu yuzden TAZE OLCUM hicbir tavana
 * girmez — kendisi zaten gunluk anonim harcama tavaniyla sinirli — ve her zaman bildirilir.
 * Tavanlar yalniz olcum yapilmayan ("ucuz") denemeler icindir.
 */

export const ATTEMPT_OUTCOMES = ['measured', 'cached', 'rate_limited', 'budget', 'failed'] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** Yonetim panelinde ve bildirimde gorunen ad */
export const ATTEMPT_LABEL_TR: Record<AttemptOutcome, string> = {
  measured: 'Ölçüldü',
  cached: 'Kayıtlı sonucu gördü',
  rate_limited: 'Haftalık sınıra takıldı',
  budget: 'Günlük tavana takıldı',
  failed: 'Tamamlanamadı',
};

/** Olcum yapilmayan deneme: ayni IP'den 24 saatte en fazla bu kadari YAZILIR */
export const ATTEMPT_IP_DAILY_CAP = 20;
/** Olcum yapilmayan deneme: butun adreslerden 24 saatte yazilan en fazla kayit */
export const ATTEMPT_GLOBAL_DAILY_CAP = 500;
/** Olcum yapilmayan deneme: 24 saatte en fazla panel bildirimi (kayit yine yazilir) */
export const ATTEMPT_INAPP_DAILY_CAP = 100;
/**
 * Olcum yapilmayan deneme: 24 saatte en fazla E-POSTA; asilinca bildirim yalniz panele duser.
 * NEDEN: bildirim e-postasi hesap ve musteri e-postalariyla AYNI saglayici kotasini kullanir
 * (giris kodu, fatura, rapor). Deneme yagmuru o kotayi bitirirse musteri e-postalari gitmez.
 */
export const ATTEMPT_EMAIL_DAILY_CAP = 30;
/** Ayni alan adi + ayni sonuc icin bildirim araligi */
export const ATTEMPT_NOTIFY_WINDOW_MS = 30 * 60 * 1000;

const DOMAIN_MAX = 190; // VARCHAR(191)
const DETAIL_MAX = 190;
const TITLE_MAX = 190; // Notification.title VARCHAR(191)

/**
 * Kayda gececek alan adi: normalize host (www'siz). Girdi alan adina cevrilemiyorsa null —
 * cagiran denemeyi YAZMAZ (dosya basi: ham metin saklanmaz).
 */
export function attemptHost(raw: unknown, normalize: (input: unknown) => { host: string }): string | null {
  try {
    const host = normalize(raw).host;
    return host ? host.slice(0, DOMAIN_MAX) : null;
  } catch {
    return null;
  }
}

/** Basarili cevap: taze olcum mu, kayitli sonuc mu */
export function outcomeOfResult(result: { fromCache?: boolean } | null | undefined): AttemptOutcome {
  return result?.fromCache ? 'cached' : 'measured';
}

/**
 * Hata: 429 ise haftalik sinir ya da gunluk tavan (mesajdan ayrilir), digerleri "tamamlanamadi".
 * `budgetMessage` servis sabiti (PUBLIC_BUDGET_MESSAGE) — metin degisirse ayrim da onunla gider.
 */
export function outcomeOfError(err: { status?: number; message?: string } | null | undefined, budgetMessage: string): AttemptOutcome {
  if (err?.status === 429) return err.message === budgetMessage ? 'budget' : 'rate_limited';
  return 'failed';
}

/** Ziyaretciye gosterilen mesajin basi; ic hata metni (Prisma, saglayici) kayda GIRMEZ */
export function attemptDetail(err: { status?: number; message?: string } | null | undefined): string | null {
  if (!err?.status || typeof err.message !== 'string') return null;
  const text = err.message.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, DETAIL_MAX) : null;
}

/** Tavanlar yalniz olcum yapilmayan denemeler icindir (dosya basi: kotuye kullanim) */
export function isCappedOutcome(outcome: AttemptOutcome): boolean {
  return outcome !== 'measured';
}

/**
 * Bu sonuc e-postayla bildirilir mi.
 *  - always: taze olcum (asil haber; sayisi gunluk harcama tavaniyla sinirli)
 *  - capped: kayitli sonucu goren, haftalik sinira ya da gunluk tavana takilan — gunluk e-posta
 *    tavanina kadar
 *  - never: tamamlanamayan (cozulmeyen alan adi rastgele adlarla ucuza uretilir) — yalniz panel
 */
export function emailPolicy(outcome: AttemptOutcome): 'always' | 'capped' | 'never' {
  if (outcome === 'measured') return 'always';
  return outcome === 'failed' ? 'never' : 'capped';
}

/**
 * Bildirim araligi anahtari: alan adi + SONUC. Yalniz alan adi olsaydi "tamamlanamadi"dan bir
 * dakika sonra gelen taze olcumun bildirimi yutulurdu (sahibin elinde yalniz hata kalirdi).
 */
export function notifyKey(domain: string, outcome: AttemptOutcome): string {
  return `${domain}|${outcome}`;
}

export interface AttemptSummary {
  brand?: string | null;
  niche?: string | null;
  /** Kaynak gosterilen cevap / olculen cevap (acik, markasiz sorular) */
  cited?: number;
  total?: number;
}

/** Sonuctan bildirim ozeti: marka, sektor ve "1/12" */
export function summaryOfResult(result: {
  brand?: string; niche?: string | null; customNiche?: string | null;
  queries?: Array<{ locked?: boolean; brandInQuery?: boolean; citedCount?: number; totalProviders?: number }>;
} | null | undefined): AttemptSummary {
  if (!result) return {};
  const sayilan = (result.queries ?? []).filter((q) => q && q.locked !== true && q.brandInQuery !== true);
  return {
    brand: result.brand ?? null,
    niche: result.customNiche || result.niche || null,
    cited: sayilan.reduce((n, q) => n + (q.citedCount ?? 0), 0),
    total: sayilan.reduce((n, q) => n + (q.totalProviders ?? 0), 0),
  };
}

/** Yoneticiye giden bildirim (panel + e-posta). Kisi bilgisi yok: alan adi ve ne oldugu. */
export function attemptNotification(a: { domain: string; outcome: AttemptOutcome; detail?: string | null; summary?: AttemptSummary }): { title: string; body: string } {
  const s = a.summary ?? {};
  const satirlar: string[] = [];
  const kim = [s.brand, s.niche].filter(Boolean).join(' · ');
  if (kim) satirlar.push(kim);
  if (a.outcome === 'measured' || a.outcome === 'cached') {
    if (typeof s.total === 'number' && s.total > 0) satirlar.push(`Sonuç: ${s.cited ?? 0}/${s.total} cevapta kaynak gösterildi.`);
    satirlar.push(a.outcome === 'cached'
      ? 'Bu alan adı daha önce ölçülmüştü; ziyaretçi kayıtlı sonucu gördü, yeni ölçüm yapılmadı.'
      : 'Ana sayfadaki ücretsiz testle yapılan yeni bir ölçüm.');
  } else if (a.outcome === 'rate_limited') {
    // "Ziyaretci baska bir alan adini test etmisti" DENMEZ: sinir IP basinadir, ayni agdaki
    // baska biri de olabilir.
    satirlar.push('Aynı IP adresinden bu hafta başka bir alan adı test edilmişti; bu deneme haftalık sınıra takıldı ve ölçülmedi.');
  } else if (a.outcome === 'budget') {
    satirlar.push('Günlük ücretsiz test tavanı dolduğu için bu deneme ölçülmedi.');
  } else {
    satirlar.push(`Test tamamlanamadı${a.detail ? `: ${a.detail}` : '.'}`);
  }
  const ek = ` (${ATTEMPT_LABEL_TR[a.outcome].toLocaleLowerCase('tr-TR')})`;
  const on = 'Ücretsiz test: ';
  // Baslik sutunu 191 karakter: uzun alan adi kirpilir, sonuc eki korunur
  const alan = a.domain.length + on.length + ek.length > TITLE_MAX ? `${a.domain.slice(0, TITLE_MAX - on.length - ek.length - 1)}…` : a.domain;
  return { title: `${on}${alan}${ek}`, body: satirlar.join('\n') };
}
