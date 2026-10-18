import type { AuditHistoryRow } from './api';

/**
 * Tarama gecmisi listesinin (audit-reports-panel.tsx) rozet kurallari — saf, test
 * edilir (audit-history.spec.mts).
 *
 * NEDEN: liste ardisik iki taramanin genel skor farkini yesil/kirmizi okla "iyilesti /
 * kotulesti" diye gosteriyordu. Genel skora giren bir kontrolun olcum yontemi
 * degistiyse ya da kontrol iki taramadan yalniz birinde olculebildiyse farkin bir
 * kismi sitenin degil olcunun degisimidir (karsilastirma panelinde ayni kural:
 * compare-notes.ts overallDeltaComparable). GET /audit/history artik her satir icin
 * bir onceki satira gore scoreComparableWithPrevious ve Turkce scoreMethodNote doner.
 */

export type HistoryDeltaView =
  /** Listede onceki satir yok ve liste kesilmedi: gercekten sitenin ilk taramasi */
  | { kind: 'first' }
  /**
   * Listede onceki satir yok ama liste sinira dayandi: daha eski tarama listenin
   * disinda kalmis olabilir. "ilk tarama" denmez; notr PREVIOUS_NOT_LISTED_LABEL.
   */
  | { kind: 'none' }
  /** Ayni yontem ve kapsam: fark hukum olarak okunabilir */
  | { kind: 'comparable'; delta: number }
  /**
   * Genel skora giren bir kontrolun yontemi degisti ya da kontrol yalniz bir taramada
   * olculebildi (api genelSkorKiyasi: yontemiDegisen / kapsamiFarkli): sayi notr,
   * NOT_COMPARABLE_LABEL etiketi, API'nin Turkce nedeni satirin altinda
   */
  | { kind: 'not_comparable'; delta: number; note: string }
  /** API karsilastirilabilirligi soylemedi (eski API): sayi notr, hukum yok */
  | { kind: 'unknown'; delta: number };

/**
 * Karsilastirilamayan farkin etiketi. NEDEN "yontem/kapsam": API false'u yalniz yontem
 * degisiminde degil, kontrol iki taramadan yalniz birinde olculebildiginde de doner
 * (audit.service getHistory); yalniz "yontem degisti" demek kapsam durumunda yanlis olurdu.
 */
export const NOT_COMPARABLE_LABEL = 'yöntem/kapsam değişti';

/** Yontem notu gelmezse (beklenmez) genel aciklama */
const METHOD_FALLBACK = 'Ölçüm yöntemi ya da kapsamı önceki taramadan farklı; fark iyileşme veya kötüleşme sayılmaz.';

/** Gercekten ilk tarama olan satirin etiketi */
export const FIRST_AUDIT_LABEL = 'ilk tarama';

/**
 * Onceki taramasi listenin disinda kalan en eski satirin etiketi. NEDEN: API bu satirda
 * scoreComparableWithPrevious null doner — "onceki tarama bu listede yok" demektir,
 * sitenin ilk taramasi demek DEGIL; limit 20'yi asan sitelerde "ilk tarama" yanlisti.
 */
export const PREVIOUS_NOT_LISTED_LABEL = 'önceki tarama listede yok';

/**
 * API'nin satir siniri: audit.service getHistory guvenliLimit = min(100, istenen). Ilk
 * tarama yalniz liste bu sinirin ALTINDA kaldiysa kesindir (uc siteId'nin tum taramalarini
 * ranAt'e gore suzmeden doner; tarama satiri yalniz site / hesap silinince silinir).
 */
export const HISTORY_API_MAX = 100;

/**
 * rows: API sirasiyla yeni → eski. limit: istenen satir sayisi — liste bu sayiya (ya da
 * API ust sinirina) ulastiysa en eski satirin oncesinde baska tarama olabilir.
 */
export function historyDeltaView(
  rows: ReadonlyArray<Pick<AuditHistoryRow, 'overallScore' | 'scoreComparableWithPrevious' | 'scoreMethodNote'>>,
  i: number,
  limit: number,
): HistoryDeltaView {
  const row = rows[i];
  const prev = rows[i + 1];
  if (!row || !prev) return rows.length < Math.min(limit, HISTORY_API_MAX) ? { kind: 'first' } : { kind: 'none' };
  const delta = row.overallScore - prev.overallScore;
  if (row.scoreComparableWithPrevious === true) return { kind: 'comparable', delta };
  if (row.scoreComparableWithPrevious === false) {
    const note = typeof row.scoreMethodNote === 'string' && row.scoreMethodNote.trim() ? row.scoreMethodNote.trim() : METHOD_FALLBACK;
    return { kind: 'not_comparable', delta, note };
  }
  return { kind: 'unknown', delta };
}

/**
 * Taramanin kaynagi rozeti. api audit.service.ts getHistory: liste taramanin
 * kaynagini gosterir ama gizlemez; rapor "Kullanici Taramasi" sayisinda yalniz
 * 'user' taramalarini sayar (reports.service, site-report.service). AuditTrigger:
 * 'user' (panelden elle), 'system' (haftalik otomatik tarama — audit.cron — ya da
 * site kurulumu — worker ONBOARDING_CHAIN), 'test' (uretimde dogrulama kosumu).
 * Bilinmeyen deger icin rozet yok (anlamini bilmedigimiz bir iddia yazilmaz).
 */
export function auditTriggerBadge(trigger: string | null | undefined): { label: string; title: string } | null {
  if (trigger === 'system') {
    return {
      label: 'Otomatik',
      title: 'RanksUp’ın kendiliğinden başlattığı tarama (haftalık otomatik tarama ya da site kurulumu). Rapordaki “Kullanıcı Taraması” sayısına girmez.',
    };
  }
  if (trigger === 'test') {
    return {
      label: 'Doğrulama',
      title: 'Doğrulama amacıyla çalıştırılan tarama. Rapordaki “Kullanıcı Taraması” sayısına girmez.',
    };
  }
  return null;
}
