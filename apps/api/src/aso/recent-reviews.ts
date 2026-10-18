/**
 * "Son 30 gundeki yorum sayisi" — ASO skorunun hiz alt bileseni (saf).
 *
 * Eskiden controller bu degeri sabit 0 gonderiyordu (TODO). Sifir "hic yorum
 * gelmedi" demektir; oysa cogu durumda yalnizca yorum CEKILMEMISTI. Burada uc
 * durum ayrilir:
 *   - bilinmiyor: o magaza icin hic yorum saklanmamis, son cekim 30 gunden
 *     eski ya da yorumlarin tarihi yok → skora katilmaz
 *   - kesin: saklanan yorumlardan sayilir
 *   - alt sinir: son cekim magazanin bir seferde verdigi tavana dayandi ve
 *     pencerenin basina ulasmadi, bagli magazalardan biri bilinmiyor ya da
 *     son cekim RECENT_REVIEW_FRESH_HOURS'tan eski → "en az N"
 *
 * Yorumlar yalnizca kullanici istediginde cekilir. 25 gun once cekilmis veri
 * pencerenin yalniz ilk 5 gununu kapsar; o sayiyi "son 30 gun" diye kesin
 * gostermek gercegin altinda kalan bir sayiyi dogru gibi sunmakti. Bayat
 * cekimde sayi alt sinirdir; hic yorum yoksa (0) bilinmiyor sayilir — "en az
 * 0" bilgi tasimaz. Alt sinir skorun hiz bilesenine GIRMEZ (velocityCount).
 *
 * Sayilan sey YORUM (metinli degerlendirme), puan degil: magazanin herkese
 * acik yorum akisindan cekilenler. Yalniz yildiz veren kullanicilar burada
 * yoktur; etiket bu yuzden "yorum sayisi".
 */

export const RECENT_REVIEW_WINDOW_DAYS = 30;

/** Son cekim bundan eskiyse sonradan gelen yorumlar sayilmamistir → sayi alt sinir */
export const RECENT_REVIEW_FRESH_HOURS = 48;

const DAY_MS = 86_400_000;

/** iTunes RSS yorum akisi sayfa basina 50 kayit doner (canli olculdu: page=1 → 50) */
export const IOS_REVIEW_PAGE_SIZE = 50;

export type ReviewStore = 'IOS' | 'ANDROID';

/** Son cekimin ozeti — reviews.service KvStore'a yazar */
export interface ReviewFetchRecord {
  at: string;
  /** Magazanin bu cekimde dondurdugu yorum sayisi */
  returned: number;
  /** Bu cekimde alinabilecek en fazla yorum (tavan) */
  cap: number;
  /** Donen en eski yorumun tarihi */
  oldest: string | null;
}

/** KvStore anahtari: uygulama + magaza basina tek satir (son cekim ozeti) */
export const reviewFetchKey = (trackedAppId: string, store: ReviewStore) => `aso:reviews:fetch:${trackedAppId}:${store}`;

export function parseFetchRecord(raw: string | null | undefined): ReviewFetchRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (typeof r?.at !== 'string' || typeof r?.returned !== 'number' || typeof r?.cap !== 'number') return null;
    return { at: r.at, returned: r.returned, cap: r.cap, oldest: typeof r.oldest === 'string' ? r.oldest : null };
  } catch {
    return null;
  }
}

/**
 * Cekilen yorum grubundan kayit uret. Bos grup KAYIT URETMEZ: scraper hatayi
 * yutup bos liste donduruyor, bos donus "kapsandi" sayilirsa basarisiz bir
 * cekim eski yorumlari guncelmis gibi gosterirdi.
 */
export function buildFetchRecord(dates: Array<string | Date | null | undefined>, cap: number, at: Date): ReviewFetchRecord | null {
  if (dates.length === 0) return null;
  const times = dates.map((d) => (d ? new Date(d).getTime() : Number.NaN)).filter((t) => Number.isFinite(t));
  return {
    at: at.toISOString(),
    returned: dates.length,
    cap,
    oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
  };
}

export interface StoreReviewStats {
  store: ReviewStore;
  storedTotal: number;
  storedDated: number;
  inWindow: number;
  /** En eski tarihli saklanan yorum */
  oldestStored: Date | null;
  /** Saklanan yorumlarin en yenisinin kayit zamani (eski veride son cekimin alt siniri) */
  latestFetchedAt: Date | null;
  lastFetch: ReviewFetchRecord | null;
}

export type RecentReviewSignal =
  | {
      status: 'known';
      count: number;
      /** true → gercek sayi bundan fazla olabilir ("en az N") */
      lowerBound: boolean;
      windowDays: number;
      stores: ReviewStore[];
      /** Bagli ama verisi bilinmeyen magazalar (sayiya dahil degil) */
      missingStores: ReviewStore[];
      /** Son cekimi RECENT_REVIEW_FRESH_HOURS'tan eski magazalar: sayilari alt sinir */
      staleStores: ReviewStore[];
      /** Sayiya giren magazalarin en yeni cekim zamani (ISO) */
      lastFetchAt: string;
      label: string;
    }
  | {
      status: 'unknown';
      windowDays: number;
      reason: string;
      label: string;
    };

const STORE_LABEL: Record<ReviewStore, string> = { IOS: 'App Store', ANDROID: 'Google Play' };

type StoreVerdict =
  | {
      store: ReviewStore;
      known: true;
      count: number;
      lowerBound: boolean;
      lastFetchAt: Date;
      /** Son cekim bayatsa kac gun once yapildigi; tazeyse null */
      staleDays: number | null;
    }
  | { store: ReviewStore; known: false; reason: string; stale?: boolean };

function judgeStore(s: StoreReviewStats, since: Date, now: Date): StoreVerdict {
  const name = STORE_LABEL[s.store];
  // "Hic yorum yok" ile "cekim basarisiz" ayirt edilemiyor (scraper hatayi yutar) → bilinmiyor
  if (s.storedTotal === 0) return { store: s.store, known: false, reason: `${name} için saklanmış yorum yok` };
  const recordAt = s.lastFetch ? new Date(s.lastFetch.at) : null;
  const lastFetchAt = recordAt && !Number.isNaN(+recordAt) ? recordAt : s.latestFetchedAt;
  if (!lastFetchAt) return { store: s.store, known: false, reason: `${name} yorumlarının çekilme zamanı bilinmiyor` };
  if (lastFetchAt < since) {
    return { store: s.store, known: false, reason: `${name} yorumları son ${RECENT_REVIEW_WINDOW_DAYS} günde çekilmedi` };
  }
  if (s.storedDated === 0) return { store: s.store, known: false, reason: `${name} yorumlarının tarihi yok` };

  // Cekimden sonra gelen yorumlar sayilmadi: sayi pencerenin yalniz bir kismini kapsar
  const ageMs = now.getTime() - lastFetchAt.getTime();
  const staleDays = ageMs > RECENT_REVIEW_FRESH_HOURS * 3_600_000 ? Math.floor(ageMs / DAY_MS) : null;
  if (staleDays != null && s.inWindow === 0) {
    return {
      store: s.store,
      known: false,
      stale: true,
      reason: `${name} yorumları en son ${staleDays} gün önce çekildi; sonraki yorumlar sayılmadı`,
    };
  }

  // Son cekim tavana dayandi ve pencerenin basina ulasmadiysa aradaki yorumlar
  // eksik olabilir. Kayit yoksa (eski veri) saklanan en eski yoruma bakilir.
  let truncated: boolean;
  if (s.lastFetch) {
    const oldest = s.lastFetch.oldest ? new Date(s.lastFetch.oldest) : null;
    truncated = s.lastFetch.returned >= s.lastFetch.cap && (!oldest || Number.isNaN(+oldest) || oldest > since);
  } else {
    truncated = s.storedDated >= IOS_REVIEW_PAGE_SIZE && (!s.oldestStored || s.oldestStored > since);
  }
  const undatedMayHide = s.storedDated < s.storedTotal;
  return {
    store: s.store,
    known: true,
    count: s.inWindow,
    lowerBound: truncated || undatedMayHide || staleDays != null,
    lastFetchAt,
    staleDays,
  };
}

export function summarizeRecentReviews(stats: StoreReviewStats[], now: Date): RecentReviewSignal {
  const windowDays = RECENT_REVIEW_WINDOW_DAYS;
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const verdicts = stats.map((s) => judgeStore(s, since, now));
  const known = verdicts.filter((v): v is Extract<StoreVerdict, { known: true }> => v.known);
  const unknown = verdicts.filter((v): v is Extract<StoreVerdict, { known: false }> => !v.known);

  if (known.length === 0) {
    const reason = unknown.length ? unknown.map((u) => u.reason).join('; ') : 'Uygulamaya bağlı mağaza yok';
    return {
      status: 'unknown',
      windowDays,
      reason,
      label: `Son ${windowDays} gündeki yorum sayısı bilinmiyor — ${reason}`,
    };
  }

  const count = known.reduce((a, v) => a + v.count, 0);
  const missingStores = unknown.map((u) => u.store);
  const stale = known.filter((v) => v.staleDays != null);
  const lowerBound = known.some((v) => v.lowerBound) || missingStores.length > 0;
  const lastFetchAt = new Date(Math.max(...known.map((v) => v.lastFetchAt.getTime())));
  const storesText = known.map((v) => STORE_LABEL[v.store]).join(' + ');
  // Kapsam etiketin icinde: hangi magazanin verisi ne zamana kadar
  const notes = [
    ...stale.map((v) => `${STORE_LABEL[v.store]} yorumları en son ${v.staleDays} gün önce çekildi, sonrası sayılmadı`),
    ...unknown.filter((u) => u.stale).map((u) => u.reason),
  ];
  const noData = unknown.filter((u) => !u.stale).map((u) => STORE_LABEL[u.store]);
  if (noData.length) notes.push(`${noData.join(', ')} verisi yok`);
  return {
    status: 'known',
    count,
    lowerBound,
    windowDays,
    stores: known.map((v) => v.store),
    missingStores,
    staleStores: stale.map((v) => v.store),
    lastFetchAt: lastFetchAt.toISOString(),
    label:
      `Son ${windowDays} gündeki yorum sayısı: ${lowerBound ? 'en az ' : ''}${count} (${storesText}, çekilen yorumlardan)` +
      (notes.length ? ` — ${notes.join('; ')}` : ''),
  };
}

/**
 * Skorun hiz bilesenine girecek sayi: YALNIZ kesin sayi. "En az N" gercegin
 * altinda kalabilir (25 gun once cekilmis veri 3 der, gercek 33 olabilir);
 * hiz kademesini (>10, >50, >100) eksik sayiyla secmek skoru haksiz yere
 * dusururdu → null: bilesen skora katilmaz, sifir sayilmaz.
 */
export function velocityCount(signal: RecentReviewSignal): number | null {
  return signal.status === 'known' && !signal.lowerBound ? signal.count : null;
}
