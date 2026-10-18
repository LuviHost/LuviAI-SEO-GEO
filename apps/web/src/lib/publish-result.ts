import type { NoticeSpec } from './notice';

/**
 * Yayin isinin (PUBLISH_ARTICLE) sonucunu panelde GERCEGE gore gostermek —
 * saf, test edilir (publish-result.spec.mts).
 *
 * NEDEN: yayin dugmesi isi kuyruga atip "birkac saniyede tamamlanacak" diyordu;
 * sonucu hic okumuyordu. Hedef hata verse de (baglanti, yetki, adaptor hatasi)
 * ya da yayinci yaziyi bilerek atlasa da (zaten yayinda olan yazi o hedefte
 * yerinde guncellenemiyor: skipped 'already_live_create_only') kullanici
 * hicbir sey gormuyordu. Worker isin donusunu Job.result'a yazar
 * (apps/worker/src/index.ts 'completed'): PublisherService.publishArticle'in
 * hedef bazindaki PublishResult[] dizisi. Hata metinleri API'den, oldugu gibi.
 */

/** Hedef bazinda yayin sonucu — api articles/publisher.service.ts PublishResult */
export interface PublishTargetResult {
  targetId: string;
  targetType?: string;
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  /** Turkce neden (adaptor hatasi ya da atlama nedeni) — panel aynen gosterir */
  error?: string;
  /**
   * Hedef bilerek atlandi, yayin yapilmadi (kopya acmamak icin). Ornek
   * 'already_live_create_only': yazi o hedefte zaten yayinda ve hedef yaziyi
   * yerinde guncelleyemiyor. Neden metni error'da. Hata degil, uyari.
   * Degerler api articles/republish-policy.ts PublishSkip. Paylasilan sozlesme C2:
   *  - 'live_entry_edited': WordPress yazisi RanksUp'in son yazimindan sonra wp-admin'de
   *    duzenlenmis; RanksUp uzerine yazmadi (kayit manualUpdatePending alir). Panel
   *    onayla "uzerine yaz" sunar (overwriteRemoteEdits, sozlesme C1).
   *  - 'live_entry_mismatch': kayitli yazi kimligi artik baska bir yaziyi gosteriyor;
   *    hicbir sey yazilmadi, kopya acilmadi. Uzerine yazma SUNULMAZ.
   * Paylasilan sozlesme D1:
   *  - 'live_target_not_selected': yazi bu hedefte yayinda ama musteri hedefi bu yayinda
   *    secmedi; API acik listeyi aynen uyguladi, oraya yazmadi (kopya eski metinle kaldiysa
   *    kayit manualUpdatePending alir). Hata ya da RanksUp'in engeli degil, secimin sonucu.
   */
  skipped?:
    | 'already_live_create_only'
    | 'live_entry_unaddressable'
    | 'slug_changed'
    | 'live_entry_trashed'
    | 'live_target_inactive'
    | 'live_entry_edited'
    | 'live_entry_mismatch'
    | 'live_entry_missing'
    | 'live_target_not_selected'
    | (string & {});
  /** Basarili yazimda hedefte ne yapildi (eski API'de yok) */
  action?: 'created' | 'updated' | 'overwritten' | 'exported' | 'recreated' | (string & {});
}

/** GET /jobs/:id cevabinin kullanilan alanlari */
export interface JobSnapshot {
  status: string;
  error?: string | null;
  result?: unknown;
  /** Basarisiz deneme sayisi (worker 'failed' her denemede artirir) */
  attempts?: number | null;
}

export type PublishJobOutcome =
  | { kind: 'done'; results: PublishTargetResult[] }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' }
  /** Is sure siniri icinde bitmedi — arka planda suruyor */
  | { kind: 'pending' };

/**
 * Kuyruk isin deneme sayisi: job-queue.service.ts enqueue (attempts: 3,
 * backoff exponential 5000 ms). BullMQ ustel beklemesi 2^(deneme-1) x 5 sn:
 * ikinci deneme 5 sn, ucuncu 10 sn sonra (docs.bullmq.io/guide/retrying-failing-jobs).
 */
export const JOB_MAX_ATTEMPTS = 3;
/**
 * FAILED gorulup yeniden deneme hakki varsa bu kadar beklenir. NEDEN: worker
 * 'failed' olayinda isi her denemede FAILED yazar, yeniden deneme baslayinca
 * 'active' olayi PROCESSING'e ceker (apps/worker/src/index.ts). BullMQ 'failed'
 * olayini yeniden denenecek denemede de yayar — kaynak: bullmq 5.76.2
 * dist/cjs/classes/worker.js handleFailed (moveToFailed sonrasi kosulsuz
 * emit('failed')) ve WorkerListener.failed belgesi ("triggered when a job has
 * thrown an exception", dist/esm/classes/worker.d.ts). Ilk FAILED'da durmak,
 * sonra basarili olan yayini "yayinlanamadi" diye gosterirdi.
 */
export const JOB_RETRY_GRACE_MS = 25_000;
export const JOB_POLL_TIMEOUT_MS = 3 * 60_000;

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED']);

/**
 * Isi bitene (ya da sure dolana) kadar yoklar. Gecici ag hatasi yoklamayi
 * bitirmez. Sure dolarsa null: is arka planda suruyor olabilir.
 */
export async function pollJob<J extends JobSnapshot>(
  getJob: () => Promise<J>,
  opts: {
    timeoutMs?: number;
    isAlive?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<J | null> {
  const timeoutMs = opts.timeoutMs ?? JOB_POLL_TIMEOUT_MS;
  const alive = opts.isAlive ?? (() => true);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const start = now();
  let failedSince: number | null = null;
  while (alive()) {
    const elapsed = now() - start;
    // Kisa islerde sonuc hemen gorunsun, uzun bekleyiste istek sayisi artmasin: dakikada
    // en fazla 20 istek (API hiz siniri dakikada 60; audit-reports-panel yoklamasiyla ayni aralik)
    await sleep(elapsed < 30_000 ? 3000 : elapsed < 120_000 ? 6000 : 10_000);
    if (!alive()) return null;
    let job: J;
    try {
      job = await getJob();
    } catch {
      if (now() - start > timeoutMs) return null;
      continue;
    }
    if (job.status === 'FAILED' && typeof job.attempts === 'number' && job.attempts < JOB_MAX_ATTEMPTS) {
      failedSince ??= now();
      if (now() - failedSince < JOB_RETRY_GRACE_MS && now() - start <= timeoutMs) continue;
      return job;
    }
    if (TERMINAL.has(job.status)) return job;
    failedSince = null;
    if (now() - start > timeoutMs) return null;
  }
  return null;
}

/**
 * Article.publishedTo kaydinin "Yayin Gecmisi" gorunumu.
 *
 * NEDEN: kart targetName / url / publishedAt okuyordu; yayinci kaydi
 * PublishResult biciminde yazar (targetId, targetType, externalUrl; yeni
 * surumde publishedAt / updatedAt — publisher.service.ts mergePublishedTo).
 * Kart hedef yerine ham kimlik gosteriyor, canli adresi hic gostermiyordu.
 * Eski kayitlardaki targetName / url de okunur. Adres yalniz http(s) ise
 * baglanti olur (adaptorden gelen deger; javascript: gibi semalar tiklanmasin).
 * manualUpdatePending: hedefte ESKI metin yayinda, musteri elle guncellemeli
 * (lib/manual-update.ts); yalniz acik true sayilir.
 * Emekli kopya — kayit artik canli degil; kart onu "yayinda" gostermez, adresi baglanti
 * yapmaz, "eski surum yayinda" demez (ortada guncellenecek bir kopya yok):
 *  - trashedAt (sozlesme C3): kopya WordPress cop kutusunda bulundu;
 *  - missingAt (sozlesme D3): kopya hedefte artik yok (404/410) ve yeniden olusturulmadi.
 */
export function publishedEntryView(
  entry: unknown,
  targetName: (targetId: string) => string | undefined,
): {
  targetId: string | null;
  name: string;
  url: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  manualUpdatePending: boolean;
  manualUpdatePendingSince: string | null;
  trashedAt: string | null;
  missingAt: string | null;
} | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const targetId = str(e.targetId);
  const name = str(e.targetName) ?? (targetId ? targetName(targetId) ?? null : null) ?? str(e.targetType) ?? targetId ?? 'Yayın hedefi';
  const rawUrl = str(e.externalUrl) ?? str(e.url);
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
  const publishedAt = str(e.publishedAt);
  const updatedAt = str(e.updatedAt);
  const trashedAt = str(e.trashedAt);
  // Cop kutusunda bulunan kopya hedefte duruyor; ikisi birden gelirse cop kutusu soylenir
  const missingAt = trashedAt ? null : str(e.missingAt);
  const emekli = !!trashedAt || !!missingAt;
  const manualUpdatePending = e.manualUpdatePending === true && !emekli;
  return {
    targetId,
    name,
    url: emekli ? null : url,
    publishedAt,
    updatedAt: updatedAt && updatedAt !== publishedAt ? updatedAt : null,
    manualUpdatePending,
    manualUpdatePendingSince: manualUpdatePending ? str(e.manualUpdatePendingSince) : null,
    trashedAt,
    missingAt,
  };
}

/** Yayinci QA engelinde makine onekiyle firlatir (publisher.service.ts 'QA_BLOCKED: ...') */
function hataMetni(error: string | null | undefined): string {
  const t = typeof error === 'string' ? error.replace(/^QA_BLOCKED:\s*/, '').trim() : '';
  return t || 'Yayın işi başarısız oldu (ayrıntı dönmedi).';
}

function gecerliSonuc(x: unknown): x is PublishTargetResult {
  return !!x && typeof x === 'object' && typeof (x as { targetId?: unknown }).targetId === 'string'
    && typeof (x as { ok?: unknown }).ok === 'boolean';
}

export function publishJobOutcome(job: JobSnapshot | null): PublishJobOutcome {
  if (!job) return { kind: 'pending' };
  if (job.status === 'COMPLETED') {
    return { kind: 'done', results: Array.isArray(job.result) ? job.result.filter(gecerliSonuc) : [] };
  }
  if (job.status === 'FAILED') return { kind: 'failed', error: hataMetni(job.error) };
  if (job.status === 'CANCELED') return { kind: 'canceled' };
  return { kind: 'pending' };
}

/** API metni yoksa (beklenmez) atlama nedeninin genel karsiligi */
const SKIP_FALLBACK: Record<string, string> = {
  already_live_create_only: 'Yazı bu hedefte zaten yayında ve hedef yazıyı yerinde güncelleyemiyor; kopya açılmaması için yeniden yayınlanmadı.',
  live_entry_edited: 'Yazı WordPress panelinde RanksUp’ın son yazımından sonra düzenlenmiş; bu değişiklikleri ezmemek için RanksUp üzerine yazmadı.',
  live_entry_mismatch: 'Kayıtlı WordPress yazı kimliği artık başka bir yazıyı gösteriyor; RanksUp hiçbir şey yazmadı ve kopya açmadı.',
  live_entry_missing: 'Yazı yayın hedefinde artık bulunamadı (silinmiş olabilir); bu yayında yeniden oluşturulmadı.',
  // Kopyanin metni zaten guncelse API isaret koymaz; genel karsilik eskiligi iddia etmez
  live_target_not_selected: 'Yazı bu hedefte yayında ama bu yayında hedef seçilmedi; oradaki kopyaya yazılmadı.',
};

/** Atlanan sonucun gosterilecek nedeni: API metni oldugu gibi, yoksa genel karsilik */
export function skipReasonText(r: PublishTargetResult): string {
  return r.error?.trim() || SKIP_FALLBACK[String(r.skipped)] || 'Yayıncı bu hedefi atladı.';
}

/** WordPress'te elle duzenlendigi icin uzerine yazilmayan hedef mi (sozlesme C2) */
export function isRemoteEditedSkip(r: PublishTargetResult): boolean {
  return !r.ok && r.skipped === 'live_entry_edited';
}

/** Musteri bu yayinda secmedigi icin yazilmayan canli kopya mi (sozlesme D1) */
export function isNotSelectedSkip(r: PublishTargetResult): boolean {
  return !r.ok && r.skipped === 'live_target_not_selected';
}

/** Kayitli yazi kimligi baska bir yaziyi gosterdigi icin hicbir sey yazilmayan hedef mi (C2) */
export function isEntryMismatchSkip(r: PublishTargetResult): boolean {
  return !r.ok && r.skipped === 'live_entry_mismatch';
}

/** Hedefin son yayindaki C2 atlamasi — makale sayfasi bu oturumda hatirlar */
export interface RemoteSkipMemo {
  skipped: 'live_entry_edited' | 'live_entry_mismatch';
  /** API'nin Turkce metni (yoksa genel karsilik) */
  text: string;
  /** Ilk yayin QA engeline ragmen mi yapildi — uzerine yazma ayni karari tasir */
  overrideQa: boolean;
}

/**
 * Son yayinin sonucuyla hedef bazinda C2 atlama hafizasi (girdi degismez). Bu yayinda
 * C2 ile atlanan hedef kaydedilir; ayni hedefe baska bir sonuc (yazildi, baska neden,
 * hata) gelirse kayit silinir — "uzerine yaz" yalniz yayincinin EN SON 'live_entry_edited'
 * dedigi hedefte sunulur. Bu yayinda olmayan hedeflerin kaydi korunur. Secilmedigi icin
 * yazilmayan hedef ('live_target_not_selected', D1) de "bu yayinda yok" sayilir: yayinci
 * o kopyaya hic bakmadi, onceki kesin cevap (or. WordPress'te duzenlenmis) gecerli kalir.
 */
export function rememberRemoteSkips(
  prev: Readonly<Record<string, RemoteSkipMemo>>,
  results: readonly PublishTargetResult[],
  overrideQa: boolean,
): Record<string, RemoteSkipMemo> {
  const next: Record<string, RemoteSkipMemo> = { ...prev };
  for (const r of results) {
    if (isNotSelectedSkip(r)) continue;
    if (isRemoteEditedSkip(r) || isEntryMismatchSkip(r)) {
      next[r.targetId] = { skipped: r.skipped as RemoteSkipMemo['skipped'], text: skipReasonText(r), overrideQa };
    } else {
      delete next[r.targetId];
    }
  }
  return next;
}

/**
 * "WordPress'teki degisikliklerin uzerine yaz" onay penceresi. Yalniz yayincinin
 * az once 'live_entry_edited' dedigi hedef icin sunulur: uzerine yazma musterinin
 * kendi WordPress duzenlemelerini yazidan cikarir, geri donusu RanksUp'ta yok.
 */
export function overwriteRemoteEditsConfirm(targetNames: string[]): { title: string; description: string; confirmLabel: string } {
  const ad = targetNames.length > 0 ? targetNames.join(', ') : 'WordPress';
  return {
    title: 'WordPress’teki değişikliklerin üzerine yazılsın mı?',
    description:
      `${ad} hedefindeki yazı, RanksUp’ın son yazımından sonra WordPress panelinden düzenlenmiş. `
      + 'Devam edersen yazı RanksUp’taki güncel metinle değiştirilir; WordPress’te yapılan değişiklikler yazıdan çıkar. '
      + 'Bu değişiklikleri korumak istiyorsan vazgeç ve güncel metni WordPress’te elle birleştir.',
    confirmLabel: 'Üzerine yaz',
  };
}

/** Basarili yazimda hedefte ne yapildigi — "yayinlandi" yerine daha kesin ek */
const ACTION_SUFFIX: Record<string, string> = {
  updated: 'yerinde güncellendi',
  overwritten: 'üzerine yazıldı',
  recreated: 'yeniden oluşturuldu',
  exported: 'dışa aktarıldı',
};

function yayinAdi(r: PublishTargetResult, nameOf: (r: PublishTargetResult) => string): string {
  const ek = r.action ? ACTION_SUFFIX[String(r.action)] : undefined;
  return ek ? `${nameOf(r)} (${ek})` : nameOf(r);
}

export interface PublishOutcomeView {
  /** Yayinlanan, atlanan (hata degil) ve basarisiz hedeflerin bildirimleri */
  notices: NoticeSpec[];
  /**
   * WordPress'te elle duzenlendigi icin uzerine yazilmayan hedefler (sozlesme C2) ve
   * bildirimleri — ayri, cunku arayuz bunlara onayli "uzerine yaz" eylemi baglar.
   */
  remoteEdited: { results: PublishTargetResult[]; notice: NoticeSpec } | null;
  /**
   * Musterinin bu yayinda secmedigi canli kopyalar (sozlesme D1) ve bildirimleri — ayri,
   * cunku yalniz musterinin hedef sectigi yayinda anlamli. Hedefleri dugmenin belirledigi
   * yayinlar (tek hedefe yeniden yayin, uzerine yazma, icerik tablosu) bunu gostermez:
   * orada "secilmedi" denecek bir secim yok; kopyanin durumu Yayin Gecmisi'nde.
   */
  notSelected: { results: PublishTargetResult[]; notice: NoticeSpec } | null;
}

/**
 * Sonuc bildirimleri: yayinlanan, atlanan (hata degil) ve basarisiz hedefler
 * ayri. Hedefin kendi hata metni oldugu gibi gosterilir. 'live_entry_edited'
 * sonuclari kendi bildiriminde (remoteEdited) — genel "yeniden yayinlanmadi"
 * uyarisina karismaz, cagiran onu uzerine yazma eylemiyle gosterir.
 * 'live_target_not_selected' (D1) da kendi bildiriminde (notSelected): engel ya da hata
 * degil, musterinin secimi; "Yayınlandı" basligini da bozmaz (secilen her hedef yazildiysa
 * baslik "Yayınlandı" kalir).
 */
export function publishOutcomeView(
  outcome: PublishJobOutcome,
  nameOf: (r: PublishTargetResult) => string,
): PublishOutcomeView {
  const yalniz = (notices: NoticeSpec[]): PublishOutcomeView => ({ notices, remoteEdited: null, notSelected: null });
  if (outcome.kind === 'failed') return yalniz([{ tone: 'error', title: 'Yayınlanamadı', description: outcome.error }]);
  if (outcome.kind === 'canceled') return yalniz([{ tone: 'info', title: 'Yayın işi iptal edildi.' }]);
  if (outcome.kind === 'pending') {
    return yalniz([{ tone: 'info', title: 'Yayın sürüyor', description: 'İş arka planda devam ediyor; sonucu birazdan yazının sayfasındaki Yayın Geçmişi’nde görürsün.' }]);
  }
  const { results } = outcome;
  const notSelectedResults = results.filter(isNotSelectedSkip);
  const written = results.filter((r) => !isNotSelectedSkip(r));
  if (written.length === 0) {
    // publishArticle hedef bulamazsa [] doner: secilen kimlik bu sitede yok ya da etkin varsayilan hedef yok
    return yalniz([{ tone: 'error', title: 'Yazı hiçbir yayın hedefine gönderilmedi', description: 'Seçilen yayın hedefi bulunamadı ya da etkin bir varsayılan hedef yok.' }]);
  }
  const edited = written.filter(isRemoteEditedSkip);
  const published = written.filter((r) => r.ok);
  const skipped = written.filter((r) => !r.ok && !!r.skipped && !isRemoteEditedSkip(r));
  const failed = written.filter((r) => !r.ok && !r.skipped);
  const notices: NoticeSpec[] = [];
  if (published.length > 0) {
    const names = published.map((r) => yayinAdi(r, nameOf)).join(', ');
    const tamami = failed.length + skipped.length + edited.length === 0;
    notices.push({ tone: 'success', title: tamami ? `Yayınlandı: ${names}` : `${published.length} hedefte yayınlandı: ${names}` });
  }
  if (skipped.length > 0) {
    notices.push({
      tone: 'warning',
      title: skipped.length === 1 ? `${nameOf(skipped[0])}: yeniden yayınlanmadı` : `${skipped.length} hedefte yeniden yayınlanmadı`,
      description: skipped.map((r) => `${nameOf(r)}: ${skipReasonText(r)}`).join(' · '),
    });
  }
  if (failed.length > 0) {
    notices.push({
      tone: 'error',
      title: failed.length === 1 ? `${nameOf(failed[0])}: yayınlanamadı` : `${failed.length} hedefte yayınlanamadı`,
      description: failed.map((r) => `${nameOf(r)}: ${r.error?.trim() || 'Yayın hedefi hata döndürdü (ayrıntı yok).'}`).join(' · '),
    });
  }
  const remoteEdited = edited.length === 0 ? null : {
    results: edited,
    notice: {
      tone: 'warning' as const,
      title: edited.length === 1
        ? `${nameOf(edited[0])}: WordPress’te düzenlenmiş, üzerine yazılmadı`
        : `${edited.length} hedefte WordPress’te düzenlenmiş yazının üzerine yazılmadı`,
      description: edited.map((r) => `${nameOf(r)}: ${skipReasonText(r)}`).join(' · '),
    },
  };
  // Musteri secmedi (yayindan once uyarildi): bilgi tonu; API metni kopyanin eski metinle
  // kalip kalmadigini ve isaretlenip isaretlenmedigini soyler
  const notSelected = notSelectedResults.length === 0 ? null : {
    results: notSelectedResults,
    notice: {
      tone: 'info' as const,
      title: notSelectedResults.length === 1
        ? `${nameOf(notSelectedResults[0])}: seçilmediği için bu yayında güncellenmedi`
        : `${notSelectedResults.length} hedef seçilmediği için bu yayında güncellenmedi`,
      description: notSelectedResults.map((r) => `${nameOf(r)}: ${skipReasonText(r)}`).join(' · '),
    },
  };
  return { notices, remoteEdited, notSelected };
}

/** Tum bildirimler tek listede (uzerine yazma eylemi baglamayan cagiranlar icin) */
export function publishOutcomeNotices(
  outcome: PublishJobOutcome,
  nameOf: (r: PublishTargetResult) => string,
): NoticeSpec[] {
  const v = publishOutcomeView(outcome, nameOf);
  return [...v.notices, ...(v.remoteEdited ? [v.remoteEdited.notice] : []), ...(v.notSelected ? [v.notSelected.notice] : [])];
}
