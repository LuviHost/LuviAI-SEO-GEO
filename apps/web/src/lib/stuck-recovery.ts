import type { NoticeSpec } from './notice';
import { JOB_MAX_ATTEMPTS, JOB_RETRY_GRACE_MS, type JobSnapshot } from './publish-result';

/**
 * Takili sayfa kartlarinin dogruluk kurallari — saf, test edilir
 * (stuck-recovery.spec.mts).
 *
 * NEDEN: kart son kurtarma kaydini (recoveries[0]) yalniz RanksUp disi sayfada
 * "Oneri" sayiyordu (articleId === null). Artik makale kurtarmasi da oneri
 * uretiyor: yazinin yayinda oldugu hedef yaziyi YERINDE guncelleyemiyorsa
 * (api audit/stuck-page-autopilot.ts planArticleRepublish) recover() oneriyi
 * kaydedip yaziyi degistirmeden sayfayi DETECTED birakiyor
 * (stuck-page-recovery.service.ts, manual:true). Kart bu oneriyi "Son onarim /
 * Uygulanan degisiklikler" diye gosteriyordu: sitede olmayan bir degisiklik
 * uygulanmis gibi okunuyordu.
 *
 * Kayit tek basina oneri mi uygulama mi oldugunu soylemez (iki yol da ayni
 * alanlarla yazar); anlam sayfanin durumundan cikar (API'deki gecisler):
 *  - DETECTED: kayitli sayfa DETECTED'a yalniz oneri yolunda doner. Dedektor
 *    acik satiri gunceller; FAILED satiri yalniz kurtarma kaydi YOKSA ve
 *    bekleme suresi dolduysa DETECTED'a ceker (kayitli FAILED satir FAILED
 *    kalir), yeni tespit kayitsiz satir acar (stuck-page-detector.service.ts
 *    detect) → kayitli DETECTED her zaman oneri.
 *  - IGNORED: panel "Gozardi"yi yalniz DETECTED sayfada sunar → oneri.
 *  - RECOVERED / REVERTED: yayina giden duzeltme (REVERTED'da revertedAt dolu).
 *  - RECOVERING (makale): ikinci asama (yeniden yayin) suruyor ya da yeni bir
 *    deneme calisiyor ve kart onceki kaydi gosteriyor → 'pending'.
 *  - FAILED (makale): gosterilen kayit onceki bir oneri de olabilir, yeniden
 *    yayini bazi hedeflere ulasmis bir duzeltme de (o durumda kayit silinmez,
 *    republishFailed anyLive) → 'unknown': ikisi de iddia edilmez.
 * RanksUp disi sayfada kayit yalniz oneri ya da basarili dosya yaziminda acilir
 * (stuck-page-external-recovery.service.ts); RECOVERED disinda her zaman oneri.
 */
export type StuckRecoveryKind = 'proposal' | 'applied' | 'pending' | 'unknown';

export function stuckRecoveryKind(page: {
  status: string;
  articleId: string | null;
  recoveries?: ArrayLike<unknown> | null;
}): StuckRecoveryKind | null {
  if (!page.recoveries || page.recoveries.length === 0) return null;
  if (page.status === 'RECOVERED' || page.status === 'REVERTED') return 'applied';
  if (page.status === 'DETECTED' || page.status === 'IGNORED' || page.articleId === null) return 'proposal';
  return page.status === 'RECOVERING' ? 'pending' : 'unknown';
}

export interface StuckRecoveryCopy {
  heading: string;
  entitiesLabel: string;
  editsLabel: string;
  paragraphLabel: string;
  /** Kaydin sitede ne durumda oldugunu soyleyen not; uygulanmis kayitta yok */
  note: string | null;
}

/**
 * Makale onerisinin notu — kesin neden bilinmiyorsa (kayit nedeni tasimaz; ayni oturumda
 * is sonucundan ya da "AI Duzelt" cevabindan gelmediyse). NEDEN liste: 11. turdan beri
 * oneri yalniz "hedef yerinde guncelleyemiyor" durumunda dogmuyor; WordPress yazisi sitede
 * degistirilmis (live_copy_edited / live_entry_edited), kayitli adres takili adresle
 * eslesmiyor (url_mismatch — varsayilan taslak yayininda adres ?p=ID), kayitli kimlik baska
 * yaziyi gosteriyor (live_entry_mismatch), yazi hedefte bulunamadi (live_entry_missing),
 * hedef silinmis / pasif ya da yalniz disa aktarim var, sitedeki kopyaya son metin yazilmamis
 * ("elle guncelleme bekliyor": live_copy_stale — son yayinda yazilamadi ya da o hedef
 * secilmedi) (api audit/stuck-page-autopilot.ts planStuckRepublish,
 * stuck-page-recovery.service.ts republishAsProposal). Eski not hepsine
 * "RanksUp yazıyı yayında olduğu yerde güncelleyemiyor" diyordu: WordPress icin yanlisti
 * (inceleme S22). Not hicbir nedeni kesin diye iddia etmez. live_copy_stale listede yoktu:
 * o nedenle kaydedilen oneri bu notla okununca neden hic sayilmamis oluyordu (S22 yan etkisi).
 */
export const ARTICLE_PROPOSAL_NOTE =
  'Bu değişiklikler yazıya uygulanmadı ve yayınlanmadı: RanksUp yazıyı yerinde güncellemedi. Olası nedenler: yazı sitende RanksUp’ın son yayınından sonra değiştirilmiş (RanksUp senin değişikliklerinin üzerine yazmaz), kayıtlı yayın adresi takılı adresle eşleşmiyor (örneğin yazı taslak olarak açılmışsa), kayıtlı yazı kimliği başka bir yazıyı gösteriyor, sitendeki kopyaya son metin yazılmamış (son yayında yazılamamış ya da o hedef seçilmemiş), yazı yayın hedefinde bulunamadı, yayın hedefi silinmiş ya da pasif, ya da hedef mevcut yazıyı yerinde güncellemeyi desteklemiyor. Yazıyı sitenin yönetim panelinde açıp aşağıdaki cümleleri elle güncelle.';

/**
 * Detay bolumunun basliklari — kaydin anlamina gore (uygulandi demek yalniz 'applied').
 * knownReason: bu onerinin API'deki Turkce nedeni (toplu onarim isinin sonucu ya da tekil
 * "AI Duzelt" cevabi; republishBlockText ne yapilacagini da soyler) — varsa not odur.
 */
export function stuckRecoveryCopy(kind: StuckRecoveryKind, isArticle: boolean, knownReason?: string | null): StuckRecoveryCopy {
  switch (kind) {
    case 'applied':
      return {
        heading: 'Son onarım',
        entitiesLabel: 'Eklenen varlıklar:',
        editsLabel: 'Uygulanan değişiklikler',
        paragraphLabel: 'Eklenen paragraf:',
        note: null,
      };
    case 'proposal': {
      const neden = typeof knownReason === 'string' && knownReason.trim() ? knownReason.trim() : null;
      return {
        heading: 'Öneri',
        entitiesLabel: 'Önerilen varlıklar:',
        editsLabel: 'Önerilen değişiklikler',
        paragraphLabel: 'Eklenecek paragraf:',
        // RanksUp disi sayfada: CMS ya da dogrulanamayan statik dosya (neden bildirimde)
        note: isArticle
          ? (neden ?? ARTICLE_PROPOSAL_NOTE)
          : (neden ?? 'Bu değişiklikler sitene yazılmadı. Sayfayı sitenin yönetim panelinde (örneğin WordPress düzenleyicisinde) açıp aşağıdaki cümleleri elle güncelle.'),
      };
    }
    case 'pending':
      return {
        heading: 'Son kayıt',
        entitiesLabel: 'Kayıttaki varlıklar:',
        editsLabel: 'Kayıttaki değişiklikler',
        paragraphLabel: 'Kayıttaki paragraf:',
        note: 'Düzeltme sürüyor: yazı yeniden yayınlanınca sayfa “Düzeltildi” olur, yayın tamamlanamazsa “Başarısız” görünür.',
      };
    default:
      return {
        heading: 'Son kayıt',
        entitiesLabel: 'Kayıttaki varlıklar:',
        editsLabel: 'Kayıttaki değişiklikler',
        paragraphLabel: 'Kayıttaki paragraf:',
        note: 'Son deneme tamamlanamadı. Bu kaydın değişiklikleri sitende olmayabilir; yeniden yayın bazı yayın hedeflerine ulaştıysa kısmen yayında da olabilir. Sayfanı kontrol et.',
      };
  }
}

/** Toplu onarim ucunun satiri (api audit.controller recoverBatch, stuck-batch-result.ts) */
export interface BatchRecoverResult {
  id: string;
  ok: boolean;
  error?: string;
  /** Oneri kaydedildi, yazi degismedi (tekil uctaki manual); ok false gelir */
  manual?: boolean;
  /** recover()'in Turkce nedeni */
  reason?: string;
  /** Tek istek sinirini (STUCK_BATCH_MAX) astigi icin hic denenmedi; error'da API metni */
  notProcessed?: boolean;
}

/** API'nin toplu sonuc ozeti (stuck-batch-result.ts stuckBatchSummary); eski API'de yok */
export interface BatchRecoveryServerSummary {
  succeeded: number;
  proposals: number;
  failed: number;
  notProcessed: number;
}

export interface BatchRecoverySummary {
  /** Degisiklik yaziya uygulandi, yeniden yayin sirada (sayfa RECOVERING) */
  queued: number;
  /** Sayfa Duzeltildi (RECOVERED) */
  recovered: number;
  /** Oneri kaydedildi, yazi degismedi (sayfa DETECTED'da kaldi) */
  proposals: number;
  failed: number;
  /** Istek sinirini astigi icin denenmedi — basarisiz degil, yeniden secilip denenir */
  notProcessed: number;
  /** API'nin hata metinleri, oldugu gibi ve tekil */
  errors: string[];
}

const sayac = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function gecerliOzet(s: BatchRecoveryServerSummary | null | undefined): s is BatchRecoveryServerSummary {
  return !!s && sayac(s.succeeded) && sayac(s.proposals) && sayac(s.failed) && sayac(s.notProcessed);
}

/**
 * Toplu onarim sonucu — istek bittikten sonra okunan sayfa durumlariyla.
 *
 * NEDEN: eski toplu uc yalniz { ok, error } donuyordu; oneri (success:false, manual)
 * "basarisiz", yeniden yayini kuyrukta bekleyen makale "duzeltildi" sayiliyordu.
 * recover() her basarisizlik yolunda sayfayi FAILED yapar, basarida RECOVERING
 * (makale, ikinci asama kuyrukta) ya da RECOVERED (RanksUp disi dosya yazimi),
 * oneride DETECTED birakir (stuck-page-recovery.service.ts,
 * stuck-page-external-recovery.service.ts). Hata atmadan donen ok:false ve
 * DETECTED kalan sayfa bu yuzden oneridir (eski API icin tahmin).
 *
 * Yeni API satirda manual ve notProcessed, yanitta summary doner. Sinir ustundeki
 * satir (notProcessed) hic denenmedi: "duzeltilemedi" demek yanlis olurdu, ayri sayilir.
 * server (yanitin summary alani) verilirse oneri / islenmeyen / basarisiz sayilari
 * sunucunun siniflamasidir; ok satirlari yine tazelenen durumla kuyrukta / duzeltildi
 * diye ayrilir, ok donup yeniden yayini bu arada FAILED olan sayfa basarisiza eklenir
 * (sayfa durumu yanittan daha yeni).
 */
export function summarizeBatchRecovery(
  results: BatchRecoverResult[],
  statusAfter: (id: string) => string | undefined,
  server?: BatchRecoveryServerSummary | null,
): BatchRecoverySummary {
  const s: BatchRecoverySummary = { queued: 0, recovered: 0, proposals: 0, failed: 0, notProcessed: 0, errors: [] };
  let okSonraBasarisiz = 0;
  for (const r of results) {
    if (r.manual === true) { s.proposals++; continue; }
    if (r.notProcessed === true) { s.notProcessed++; continue; }
    const st = statusAfter(r.id);
    if (st === 'RECOVERED') { s.recovered++; continue; }
    // Yeniden yayin bu arada basarisiz olduysa (FAILED) kuyrukta sayilmaz
    if (r.ok && st !== 'FAILED') { s.queued++; continue; }
    if (r.ok) okSonraBasarisiz++;
    if (!r.ok && !r.error && st === 'DETECTED') { s.proposals++; continue; }
    s.failed++;
    if (r.error && !s.errors.includes(r.error)) s.errors.push(r.error);
  }
  if (gecerliOzet(server)) {
    s.proposals = server.proposals;
    s.notProcessed = server.notProcessed;
    s.failed = server.failed + okSonraBasarisiz;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
//  TOPLU ONARIM KUYRUGU (paylasilan sozlesme C4 / D4)
//
//  NEDEN kuyruk: toplu uc her sayfanin GEO taramasini ve LLM duzeltmesini tek istekte
//  sirayla calistiriyordu (sayfa basina ~30-60 sn). Uretim Cloudflare arkasinda (~100 sn
//  siniri): 4+ sayfalik secimde panel 524 aliyor, "tekrar dene" diyordu; sunucu ise
//  duzenlemeye devam ediyor, ikinci deneme ayni yazilari ikinci kez duzenliyordu. Uc
//  artik her uygun sayfa icin bir STUCK_PAGE_RECOVER isi acip hemen doner. D4: is
//  kosarken atlanacagi belli olan sayfa (onay bekleyen surum, cop kutusu, bos govde...)
//  hemen notProcessed + nedenle doner; kuyruga alinan satir jobId tasir.
//
//  NEDEN sonuc SAYFA BASINA ve is kaydindan: recover() bir sayfayi atladiginda sayfa da
//  kurtarma kaydi da hic degismez; liste tek basina "hala sirada" ile "atlandi"yi
//  ayiramiyordu. Eskiden tek bir atlanan sayfa butun toplu islemi 15 dk mesgul tutuyor,
//  ozet hic gelmiyor, neden (is sonucunda duran) hic gosterilmiyordu (inceleme S9/S13).
//  Artik her sayfa kendi sonucu gelince serbest kalir; neden is kaydindan
//  (GET /jobs/:id, sahiplik denetimli) okunur.
// ─────────────────────────────────────────────────────────────────────────

/** Kuyruga alma satiri (normalize) */
export interface QueuedBatchRow {
  id: string;
  /** Is kuyruga alindi */
  queued: boolean;
  /** Hic denenmedi (sinir, sayfa zaten isleniyor / sirada, kosarken atlanacak...) — basarisiz degil */
  notProcessed: boolean;
  /** API'nin Turkce nedeni (reason ya da error), oldugu gibi; yoksa null */
  message: string | null;
  /**
   * DB is kimligi (GET /jobs/:id) — sonuc buradan okunur; eski API'de yok. Kuyruga alinan
   * satirda yeni is; alreadyQueued satirinda sayfanin zaten bekleyen isi.
   */
  jobId: string | null;
  /**
   * Sayfa icin bir duzeltme zaten sirada (D4: sayfa basina tek is; API ikinci isi acmaz,
   * bekleyen isin kimligini doner). Panel bu sayfayi da "sirada" gosterir ve sonucunu
   * okur — sayfa yenilendikten sonra yeniden secilen bekleyen sayfa boyle geri gelir.
   */
  alreadyQueued: boolean;
}

export interface QueuedBatchSummary {
  queued: number;
  notProcessed: number;
  failed: number;
}

export type BatchResponseView =
  | { kind: 'queued'; rows: QueuedBatchRow[]; summary: QueuedBatchSummary }
  /** Eski (senkron) API: satirlar ok / manual / notProcessed tasir — summarizeBatchRecovery */
  | { kind: 'legacy'; results: BatchRecoverResult[]; summary: BatchRecoveryServerSummary | null };

const nesne = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const metin = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function gecerliKuyrukOzeti(s: unknown): s is QueuedBatchSummary {
  return nesne(s) && sayac(s.queued) && sayac(s.notProcessed) && sayac(s.failed);
}

/**
 * Toplu ucun cevabi → gorunum. Satir dizisi results ya da rows altinda olabilir
 * (sozlesme yalniz satir bicimini sabitler). Satirda `queued` varsa yeni (kuyruk)
 * bicim; yalniz `ok` varsa eski senkron uc (dagitim aninda eski API'ye denk gelen
 * panel de dogru ozet gostersin). Ozet sayilari gecerliyse sunucudan (K1).
 */
export function readBatchResponse(raw: unknown): BatchResponseView {
  const r = nesne(raw) ? raw : {};
  const arr: unknown[] = Array.isArray(r.results) ? r.results : Array.isArray(r.rows) ? r.rows : [];
  const satirlar = arr.filter(nesne);
  const yeni = satirlar.some((x) => typeof x.queued === 'boolean');
  const eski = !yeni && (satirlar.some((x) => typeof x.ok === 'boolean') || (satirlar.length === 0 && nesne(r.summary) && sayac(r.summary.succeeded)));
  if (eski) {
    const results: BatchRecoverResult[] = satirlar.map((x) => ({
      id: String(x.id ?? x.stuckPageId ?? ''),
      ok: x.ok === true,
      ...(metin(x.error) ? { error: metin(x.error)! } : {}),
      ...(x.manual === true ? { manual: true } : {}),
      ...(metin(x.reason) ? { reason: metin(x.reason)! } : {}),
      ...(x.notProcessed === true ? { notProcessed: true } : {}),
    }));
    return { kind: 'legacy', results, summary: gecerliOzet(r.summary as BatchRecoveryServerSummary) ? (r.summary as BatchRecoveryServerSummary) : null };
  }
  const rows: QueuedBatchRow[] = satirlar.map((x) => {
    const queued = x.queued === true;
    const jobId = metin(x.jobId);
    return {
      id: String(x.stuckPageId ?? x.id ?? ''),
      queued,
      notProcessed: !queued && x.notProcessed === true,
      message: metin(x.reason) ?? metin(x.error),
      jobId,
      // Kuyruga alinmayan satirda is kimligi yalniz bekleyen isi gosterir (api stuck-batch-result.ts 'already_queued')
      alreadyQueued: !queued && !!jobId,
    };
  });
  const summary: QueuedBatchSummary = gecerliKuyrukOzeti(r.summary)
    ? { queued: r.summary.queued, notProcessed: r.summary.notProcessed, failed: r.summary.failed }
    : {
      queued: rows.filter((x) => x.queued).length,
      notProcessed: rows.filter((x) => x.notProcessed).length,
      failed: rows.filter((x) => !x.queued && !x.notProcessed).length,
    };
  return { kind: 'queued', rows, summary };
}

/** Benzersiz nedenler (en fazla 3) */
function nedenler(rows: QueuedBatchRow[]): string {
  const out: string[] = [];
  for (const r of rows) if (r.message && !out.includes(r.message)) out.push(r.message);
  return out.slice(0, 3).join(' · ');
}

/** Kuyruga alma bildirimi — "duzeltildi" demez: is daha calismadi */
export function queuedBatchNotice(v: Extract<BatchResponseView, { kind: 'queued' }>): NoticeSpec {
  const { queued, failed } = v.summary;
  // Zaten sirada olan sayfa "islenmedi" degil: onceki isi suruyor, sonucu kartinda gorunur
  const sirada = v.rows.filter((r) => r.alreadyQueued).length;
  const notProcessed = Math.max(0, v.summary.notProcessed - sirada);
  const aciklama: string[] = [];
  if (sirada > 0) aciklama.push(`${sirada} sayfa zaten sıradaydı; ikinci kez sıraya alınmadı, sonucu kartında görünür`);
  if (notProcessed > 0) {
    const n = nedenler(v.rows.filter((r) => r.notProcessed && !r.alreadyQueued));
    aciklama.push(`${notProcessed} sayfa işlenmedi${n ? `: ${n}` : ''}`);
  }
  if (failed > 0) {
    const n = nedenler(v.rows.filter((r) => !r.queued && !r.notProcessed));
    aciklama.push(`${failed} sayfa sıraya alınamadı${n ? `: ${n}` : ''}`);
  }
  const title = queued > 0
    ? `${queued} sayfa sıraya alındı; her sayfanın sonucu hazır olunca kartında görünür`
    : failed > 0 ? 'Toplu onarım başlatılamadı'
      : sirada > 0 && notProcessed === 0 ? 'Seçilen sayfalar zaten sırada' : 'Toplu onarım: sıraya alınan sayfa yok';
  const tone: NoticeSpec['tone'] = failed > 0
    ? (queued > 0 ? 'warning' : 'error')
    : notProcessed > 0 ? 'warning' : 'info';
  return { tone, title, description: aciklama.length > 0 ? aciklama.join(' · ') : undefined };
}

/** Sayfanin kuyruga alindigi andaki durumu — sonuc bundan ayrisinca okunur */
export interface QueuedPageBaseline {
  id: string;
  status: string;
  /** En son kurtarma kaydi (liste yalniz sonuncuyu doner) */
  recoveryId: string | null;
}

interface StuckRowLike {
  id: string;
  status: string;
  articleId?: string | null;
  recoveries?: ArrayLike<{ id?: unknown }> | null;
}

function sonKayit(row: Pick<StuckRowLike, 'recoveries'> | null | undefined): string | null {
  const r = row?.recoveries && row.recoveries.length > 0 ? row.recoveries[0] : null;
  return r && typeof r.id === 'string' ? r.id : null;
}

export function queuedPageBaseline(id: string, row: Pick<StuckRowLike, 'status' | 'recoveries'> | null | undefined): QueuedPageBaseline {
  return { id, status: row?.status ?? 'DETECTED', recoveryId: sonKayit(row) };
}

/**
 * Kuyruktaki sayfanin listeden okunan durumu. Gecisler (api stuck-page-recovery.service.ts):
 * is baslayinca RECOVERING (kayit yok: LLM calisiyor), duzenleme yaziya uygulaninca
 * RECOVERING + yeni kayit (yeniden yayin sirada), yayin bitince RECOVERED; oneri yeni
 * kayitla DETECTED'da kalir; basarisizlik FAILED. Kayit ve durum degismediyse liste
 * sonucu bilmiyor ('waiting'): is daha bitmedi YA DA is sayfayi atladi — ayrimi is kaydi
 * yapar (stuckJobOutcome).
 */
export type QueuedPageState = 'waiting' | 'republishing' | 'recovered' | 'proposal' | 'failed' | 'other';

export function queuedPageState(base: QueuedPageBaseline, now: StuckRowLike | undefined): QueuedPageState {
  // Sayfa listeden cikti (silindi): bekleyecek bir sey yok
  if (!now) return 'other';
  const yeniKayit = sonKayit(now) !== base.recoveryId;
  switch (now.status) {
    case 'RECOVERED': return 'recovered';
    case 'RECOVERING': return yeniKayit ? 'republishing' : 'waiting';
    case 'DETECTED': return yeniKayit ? 'proposal' : 'waiting';
    case 'FAILED': return base.status !== 'FAILED' || yeniKayit ? 'failed' : 'waiting';
    default: return now.status !== base.status ? 'other' : 'waiting';
  }
}

/**
 * Sayfanin son eyleminin (toplu onarim isi ya da tekil "AI Duzelt") sonucu — kartta
 * gosterilir. notProcessed: uc sayfayi hic kuyruga almadi; skipped: is kostu ama sayfayi
 * atladi (ikisinde de hicbir sey degismedi). unknown: sure doldu, sonuc okunamadi.
 */
export type BatchPageOutcome =
  | { kind: 'notProcessed'; reason: string | null }
  | { kind: 'skipped'; reason: string }
  | { kind: 'proposal'; reason: string | null }
  | { kind: 'republishing' }
  | { kind: 'recovered' }
  | { kind: 'failed'; reason: string | null }
  | { kind: 'other' }
  | { kind: 'unknown' };

/** Is kaydinin sonucu (worker STUCK_PAGE_RECOVER donusu, Job.result) */
export type StuckJobOutcome =
  | { kind: 'pending' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'proposal'; reason: string | null }
  | { kind: 'applied' }
  | { kind: 'failed'; reason: string | null }
  /** Tamamlandi ama sonuc bicimi taninmadi */
  | { kind: 'unrecognized' };

/**
 * Worker'in makine kodlari (apps/worker/src/index.ts STUCK_PAGE_RECOVER) → Turkce. Ham kod
 * musteriye gosterilmez; bilinmeyen kod genel metne duser.
 */
const JOB_REASON_TEXT: Record<string, string> = {
  AI_GLOBAL_DISABLED: 'Yapay zekâ özellikleri şu an geçici olarak kapalı; sayfa işlenmedi, hiçbir şey değişmedi. Biraz sonra tekrar dene.',
  STUCK_PAGE_NOT_FOUND: 'Takılı sayfa kaydı bulunamadı (silinmiş olabilir); hiçbir şey değişmedi.',
  EXTERNAL_PAGE_MANUAL_ONLY: 'RanksUp dışı sayfa yalnız elle başlatılan onarımla düzeltilir; hiçbir şey değişmedi.',
};
const ATLANDI_GENEL = 'Sayfa bu işte işlenmedi; hiçbir şey değişmedi.';

/** Is sonucundaki nedenin kartta gosterilen en fazla uzunlugu (beklenmeyen uzun hata metnine karsi) */
const NEDEN_SINIRI = 400;
/**
 * Oneri nedeninin siniri. NEDEN ayri: API'nin oneri metni (republishBlockText(...,
 * 'proposal')) neden + "Öneriler kaydedildi, yazı değiştirilmedi; ..." ekidir; varsayilan
 * WordPress taslak kurulumunda (draft_link) ve gercekci adreslerle url_mismatch'te 445-471
 * karakter (inceleme rv15 lengths). 400'de kesilen not "…Öneriler kaydedildi, yazı
 * değişt…" diye olumsuzlugun hemen onunde bitiyordu (S22 yan etkisi). Tekil "AI Düzelt"
 * yolu ayni metni hic kesmeden gosterir; toplu yol da tamamini gostersin.
 */
const ONERI_NEDEN_SINIRI = 2000;

/**
 * Siniri asan metni cumle ortasinda kesmez: sinira sigan son cumlenin sonunda biter (. ! ? …
 * ve varsa kapanis tirnagi / parantez, ardindan bosluk). NEDEN: karakterden kesim anlami
 * tersine cevirebiliyordu ("yazı değişt…" — "değiştirilmedi" okunamiyordu). Sigan cumle sonu
 * yoksa ya da metnin yarisindan onceyse (tek uzun cumle, or. ham hata metni) sozcuk
 * sinirinda kesilir ve "…" eklenir: o durumda yarim kalan bir aciklama oldugu gorunur.
 */
function cumleSinirindaKisalt(t: string, max: number): string {
  if (t.length <= max) return t;
  let son = 0;
  for (const m of t.slice(0, max + 1).matchAll(/[.!?…]["'”’)\]]*(?=\s)/g)) son = (m.index ?? 0) + m[0].length;
  if (son >= max / 2) return t.slice(0, son);
  const bosluk = t.lastIndexOf(' ', max - 1);
  return `${t.slice(0, bosluk >= max / 2 ? bosluk : max - 1).trimEnd()}…`;
}

/**
 * Is sonucundaki neden: Turkce metin oldugu gibi (uzunsa cumle sinirinda kisaltilir), bilinen
 * kod Turkcesiyle, bilinmeyen kod null.
 */
export function jobReasonText(raw: unknown, max: number = NEDEN_SINIRI): string | null {
  const t = metin(raw);
  if (!t) return null;
  if (JOB_REASON_TEXT[t]) return JOB_REASON_TEXT[t];
  if (/^[A-Za-z0-9_]+$/.test(t)) return null;
  return cumleSinirindaKisalt(t, max);
}

/**
 * GET /jobs/:id → sayfanin is sonucu. Bicimler (api stuck-page-recovery.service.ts ve
 * stuck-page-external-recovery.service.ts StuckRecoverResult, worker atlamalari):
 *  - { skipped: true, reason } → atlandi (D4: recover() atlamalari is sonucuna boyle yazilir)
 *  - { manual: true, reason } → oneri kaydedildi, yazi degismedi
 *  - { success: true } → degisiklik uygulandi (makalede yeniden yayin sirada)
 *  - { success: false, reason } → duzeltilemedi
 *  - FAILED (son deneme) → duzeltilemedi, neden is hatasi; CANCELED → islenmedi
 * Ara deneme hatasi (FAILED, attempts < 3) burada kesin sayilir; yeniden deneme payini
 * yoklayici tanir (pollStuckBatch).
 */
export function stuckJobOutcome(job: JobSnapshot | null | undefined): StuckJobOutcome {
  if (!job) return { kind: 'pending' };
  switch (job.status) {
    case 'COMPLETED': {
      const r = nesne(job.result) ? job.result : {};
      if (r.skipped === true) return { kind: 'skipped', reason: jobReasonText(r.reason) ?? ATLANDI_GENEL };
      if (r.manual === true) return { kind: 'proposal', reason: jobReasonText(r.reason, ONERI_NEDEN_SINIRI) };
      if (r.success === true) return { kind: 'applied' };
      if (r.success === false) return { kind: 'failed', reason: jobReasonText(r.reason) };
      return { kind: 'unrecognized' };
    }
    case 'FAILED': return { kind: 'failed', reason: jobReasonText(job.error) };
    case 'CANCELED': return { kind: 'skipped', reason: 'İş iptal edildi; hiçbir şey değişmedi.' };
    default: return { kind: 'pending' };
  }
}

/**
 * Sayfanin sonucu: is sonucu ve listedeki durum birlikte. Uygulanan duzeltmede liste daha
 * yeni olabilir (yeniden yayin bitti → RECOVERED, yayin basarisiz → FAILED, yayin
 * aninda WordPress'te degisiklik bulundu → oneri). Is bilinmiyorsa listeden; liste de
 * sonucu bilmiyorsa null (bekleniyor).
 */
export function settleQueuedPage(job: StuckJobOutcome | null, list: QueuedPageState): BatchPageOutcome | null {
  if (job) {
    switch (job.kind) {
      case 'skipped': return { kind: 'skipped', reason: job.reason };
      case 'proposal': return { kind: 'proposal', reason: job.reason };
      case 'failed': return { kind: 'failed', reason: job.reason };
      case 'applied':
        return list === 'recovered' ? { kind: 'recovered' }
          : list === 'failed' ? { kind: 'failed', reason: null }
            : list === 'proposal' ? { kind: 'proposal', reason: null }
              : list === 'other' ? { kind: 'other' }
                : { kind: 'republishing' };
      case 'unrecognized':
        if (list === 'waiting') return { kind: 'skipped', reason: ATLANDI_GENEL };
        break;
      default:
        break;
    }
  }
  switch (list) {
    case 'recovered': return { kind: 'recovered' };
    case 'republishing': return { kind: 'republishing' };
    case 'proposal': return { kind: 'proposal', reason: null };
    case 'failed': return { kind: 'failed', reason: null };
    case 'other': return { kind: 'other' };
    default: return null;
  }
}

/** Kuyruktaki sayfanin sonucu toplu ozette ve kartta "duzeltildi" yalniz RECOVERED icin */
export function queuedBatchSettledNotice(outcomes: Iterable<BatchPageOutcome>): NoticeSpec {
  const c = { recovered: 0, republishing: 0, proposal: 0, skipped: 0, failed: 0, other: 0, unknown: 0 };
  const neden: string[] = [];
  const ekle = (onek: string, r: string | null) => {
    const m = r ? `${onek}: ${r}` : null;
    if (m && !neden.includes(m)) neden.push(m);
  };
  for (const o of outcomes) {
    switch (o.kind) {
      case 'recovered': c.recovered++; break;
      case 'republishing': c.republishing++; break;
      case 'proposal': c.proposal++; break;
      case 'skipped': case 'notProcessed': c.skipped++; ekle('İşlenmedi', o.reason); break;
      case 'failed': c.failed++; ekle('Düzeltilemedi', o.reason); break;
      case 'other': c.other++; break;
      default: c.unknown++;
    }
  }
  const parts: string[] = [];
  if (c.recovered > 0) parts.push(`${c.recovered} sayfa düzeltildi`);
  if (c.republishing > 0) parts.push(`${c.republishing} sayfada değişiklik yazıya uygulandı, yeniden yayın sırada`);
  if (c.proposal > 0) parts.push(`${c.proposal} sayfa için öneri kaydedildi (yazı değişmedi, elle uygulanır)`);
  if (c.skipped > 0) parts.push(`${c.skipped} sayfa işlenmedi (hiçbir şey değişmedi)`);
  if (c.failed > 0) parts.push(`${c.failed} sayfa düzeltilemedi`);
  if (c.other > 0) parts.push(`${c.other} sayfanın durumu başka bir işlemle değişti`);
  if (c.unknown > 0) parts.push(`${c.unknown} sayfanın sonucu henüz gelmedi`);
  if (parts.length === 0) return { tone: 'info', title: 'Toplu onarım: işlenen sayfa yok' };
  const done = c.recovered + c.republishing + c.proposal;
  const tone: NoticeSpec['tone'] = c.failed > 0
    ? (done === 0 ? 'error' : 'warning')
    : c.skipped > 0 || c.unknown > 0 ? 'warning'
      : c.proposal > 0 || c.republishing > 0 || c.other > 0 ? 'info' : 'success';
  return {
    tone,
    title: `Toplu onarım sonucu: ${parts.join(', ')}`,
    description: neden.length > 0 ? neden.slice(0, 3).join(' · ') : undefined,
  };
}

/** Kartta sayfanin son eyleminin sonucu (kisa; uzun neden Detay'daki notta) */
export function pageOutcomeNote(o: BatchPageOutcome): { tone: 'success' | 'info' | 'warning' | 'danger'; text: string } {
  switch (o.kind) {
    case 'notProcessed':
    case 'skipped':
      return { tone: 'warning', text: o.reason ? `İşlenmedi. ${o.reason}` : 'İşlenmedi; hiçbir şey değişmedi.' };
    case 'proposal':
      return { tone: 'info', text: o.reason ? 'Öneri kaydedildi; yazı değişmedi. Nedeni ve önerilen cümleler Detay’da.' : 'Öneri kaydedildi; yazı değişmedi. Önerilen cümleler Detay’da.' };
    case 'republishing':
      return { tone: 'info', text: 'Değişiklikler yazıya uygulandı; yeniden yayın sırada.' };
    case 'recovered':
      return { tone: 'success', text: 'Düzeltildi ve sitende güncellendi.' };
    case 'failed':
      return { tone: 'danger', text: o.reason ? `Düzeltilemedi. ${o.reason}` : 'Düzeltilemedi.' };
    case 'other':
      return { tone: 'info', text: 'Sayfanın durumu bu arada başka bir işlemle değişti.' };
    default:
      return { tone: 'info', text: 'Sonuç henüz gelmedi; sayfayı yenileyince güncel durumu görürsün.' };
  }
}

/** Sonucu beklenen sayfa: is kimligi (yoksa yalniz listeden okunur) ve kuyruga alindigi an */
export interface TrackedQueuedPage {
  id: string;
  jobId: string | null;
  base: QueuedPageBaseline;
  /**
   * Kuyruga alindigi an (yoklayicinin now() saatiyle ayni). Varsa 30 dk siniri buradan
   * sayilir: sayfa yenilenince yeni bir 30 dk baslamaz. Yoksa donguye eklendigi an.
   */
  queuedAt?: number;
  /**
   * Sure dolunca sonucu okunamamis sayfa ('unknown'): sayfa yenilenince is kaydi BIR KEZ
   * daha okunur (stuckRecheckPages). Is hala bitmediyse sonuc yine 'unknown'. NEDEN: kart
   * notu "sayfayı yenileyince güncel durumu görürsün" diyor ama yenileme isi hic yeniden
   * okumuyordu; is sonradan atlansa da kart "Sonuç henüz gelmedi" kaliyordu (S13 yan etkisi).
   */
  recheck?: boolean;
}

/** onSettle'in ek bilgisi: notun ait oldugu kayit ve yenilemede yeniden okuma icin is */
export interface SettledPageInfo {
  /**
   * Sonucun ait oldugu son kurtarma kaydi: oneride ve uygulanan duzeltmede isin actigi kayit
   * (is sonucundaki recoveryId; liste onu henuz gostermiyor olabilir), digerlerinde listede o
   * an gorunen son kayit. Kart son kayit degisince notu gizler (visiblePageOutcome).
   */
  recoveryId: string | null;
  jobId: string | null;
  base: QueuedPageBaseline;
  /** Sayfa yenilenince yapilan tek okuma: sonuc yine 'unknown' olabilir */
  recheck: boolean;
}

/** Yoklama istegi hakki — sekmeler ve gonderimler arasinda paylasilan (sharedPollBudget) */
export interface StuckPollBudget {
  /** Bir istek hakki alir; yoksa false doner ve istek atilmaz */
  take(now: number): boolean;
}

export interface StuckPollOptions {
  load: () => Promise<readonly StuckRowLike[] | null>;
  getJob?: (jobId: string) => Promise<JobSnapshot>;
  onSettle?: (id: string, outcome: BatchPageOutcome, status: string | null, info: SettledPageInfo) => void;
  onAllSettled?: (outcomes: ReadonlyMap<string, BatchPageOutcome>) => void;
  isAlive?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  /** Her liste ve is kaydi okumasindan once hak alinir; yoksa yalniz turun kendi siniri */
  budget?: StuckPollBudget;
}

/**
 * Yoklama ust siniri (sayfa basina, kuyruga alindigi andan). Her sayfa sonucu gelince ayri
 * serbest kalir; sinir yalniz sonucu hic okunamayan sayfa icindir. Worker varsayilan 2 is
 * paralel calistirir (WORKER_CONCURRENCY), sayfa basina ~30-60 sn; 50 sayfalik secim ~15-20
 * dk surebilir.
 */
export const STUCK_BATCH_POLL_MS = 30 * 60_000;

/** Yenileme okumasinin (recheck) siniri: bu surede okunamazsa (butce, ag) sayfa yine 'unknown' */
export const STUCK_RECHECK_MS = 5 * 60_000;

/**
 * Dakikada en fazla yoklama istegi — bir sitenin degil, TARAYICININ toplami (butun sekmeler
 * ve gonderimler; liste + is kaydi). API siniri istemci (IP) basina dakikada 60 (api
 * app.module.ts ThrottlerModule, RATE_LIMIT_MAX varsayilani); bildirim zili ve kota
 * izleyici dakikada 2 istek daha atar. 24 tek dongunun ilk dakikadaki tavanidir (12 liste +
 * 12 is): tek sekme hic yavaslamaz. NEDEN paylasilan: her gonderim ve her sekme kendi
 * dongusunu kendi butcesiyle calistiriyordu; iki gonderim + ikinci sekme dakikada ~70 istek
 * atiyor, kullanicinin kendi istekleri 429 aliyordu (S13 yan etkisi).
 */
export const STUCK_POLL_MAX_PER_MIN = 24;

/** Paylasilan butcenin depo anahtari: sinir IP basina oldugu icin site basina degil, tek */
export const STUCK_POLL_BUDGET_KEY = 'ranksup:stuck-batch-budget';

/**
 * Sekmeler arasi paylasilan yoklama butcesi: son 60 sn'deki istek zamanlari localStorage'da
 * (kayan pencere). Depolama yoksa ya da hata verirse (gizli pencere, engelli site verisi)
 * sayac yalniz bu sekmede tutulur — sayfa yine calisir. Sekmeler ayni anda okuyup yazarsa
 * nadiren bir iki istek fazla gidebilir (kabul edilebilir: tavan API sinirinin cok altinda).
 */
export function sharedPollBudget(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  opts: { key?: string; limit?: number } = {},
): StuckPollBudget {
  const key = opts.key ?? STUCK_POLL_BUDGET_KEY;
  const limit = opts.limit ?? STUCK_POLL_MAX_PER_MIN;
  let yerel: number[] = [];
  return {
    take(now) {
      let kayit: unknown = yerel;
      if (storage) {
        try {
          const raw = storage.getItem(key);
          kayit = raw ? JSON.parse(raw) : [];
        } catch {
          kayit = yerel;
        }
      }
      // Son 60 sn; bozuk ya da cok ileri tarihli deger yok sayilir (butceyi kilitlemesin)
      const zamanlar = (Array.isArray(kayit) ? kayit : [])
        .filter((t): t is number => typeof t === 'number' && now - t < 60_000 && t - now < 60_000);
      if (zamanlar.length >= limit) {
        yerel = zamanlar;
        return false;
      }
      zamanlar.push(now);
      yerel = zamanlar;
      if (storage) {
        try {
          storage.setItem(key, JSON.stringify(zamanlar));
        } catch {
          /* depolama yazilamadi: sayac yalniz bu sekmede */
        }
      }
      return true;
    },
  };
}

/**
 * Bir turda okunan en fazla is kaydi. Liste her turda bir istek. Ilk dakika (son eklemeden
 * beri) 5 sn'de bir tur: 12 liste + 12 is = 24/dk; sonra 10 sn (6 + 12 = 18/dk) ve 20 sn
 * (3 + 9 = 12/dk). Sayfa sayisi ne olursa olsun bu tavanlar asilmaz.
 */
function isKaydiButcesi(elapsed: number): number {
  return elapsed < 60_000 ? 1 : elapsed < 5 * 60_000 ? 2 : 3;
}

/** Is sonucundaki kurtarma kaydi (oneri ve uygulanan duzeltme recoveryId tasir) */
function isinKurtarmaKaydi(job: JobSnapshot): string | null {
  return nesne(job.result) ? metin(job.result.recoveryId) : null;
}

/**
 * Kuyruktaki sayfalarin sonucunu okur. Her turda liste bir kez okunur; sonucu listede
 * gorunmeyen (atlanan, henuz baslamayan) sayfalarin is kaydi butce icinde okunur. Oncelik:
 *  1. listede degismis ama nedeni bilinmeyen sayfa (oneri / hata nedeni is sonucunda);
 *  2. yenileme okumasi (recheck: tek okuma, hemen biter);
 *  3. kendisinden sonra siraya alinan bir sayfa sonuclandigi halde bekleyen sayfa (worker
 *     isleri sirayla alir: buyuk olasilikla calisti ya da atlandi);
 *  4. en uzun suredir okunmayan bekleyen sayfa.
 * onSettle: sayfanin sonucu belli oldu (kart serbest kalir) ya da yeniden yayini biten
 * sayfanin sonucu degisti; status listedeki son durum, info notun ait oldugu kayit.
 * onAllSettled: o ana kadar eklenen sayfalarin hicbiri beklemiyor (yeniden yayini suren
 * olabilir) — ozet her eklenen grup icin bir kez (yenileme okumalari ozete girmez). Yeniden
 * yayini suren sayfa listeden izlenmeye devam eder. Sayfanin suresi dolunca 'unknown'. Liste
 * okunamazsa ya da paylasilan butce izin vermezse tur atlanir. gelen: calisan donguye
 * sonradan eklenen sayfalar (stuckBatchWatcher); bitti: dongu cikmadan hemen once
 * (senkron). Sayfa kapaninca null.
 */
async function stuckPollLoop(
  opts: StuckPollOptions,
  ilk: readonly TrackedQueuedPage[],
  gelen: () => readonly TrackedQueuedPage[],
  bitti: () => void,
): Promise<ReadonlyMap<string, BatchPageOutcome> | null> {
  const alive = opts.isAlive ?? (() => true);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? STUCK_BATCH_POLL_MS;

  interface Iz {
    p: TrackedQueuedPage;
    /** Donguye eklenme sirasi (isler kuyruga bu sirayla girdi) */
    i: number;
    outcome: BatchPageOutcome | null;
    job: StuckJobOutcome | null;
    /** Is sonucundaki kurtarma kaydi (oneri / uygulama) */
    isKaydi: string | null;
    /** Is kaydinin son okundugu tur (-1: hic) */
    okundu: number;
    /** Listede ilk degistigi tur (nedeni okunacak sayfa bir tur bekletilir) */
    degisti: number | null;
    failedSince: number | null;
    /** Sure siniri buradan sayilir */
    basla: number;
    /** Bir ozete girdi */
    ozetlendi: boolean;
  }
  const izler: Iz[] = [];
  let sira = 0;
  // Tur sikligi ve is kaydi butcesi son eklemeden beri gecen sureye gore: yeni gelen sayfanin
  // sonucu da ilk dakikada hizli okunur (tavan yine 24/dk)
  let sonEkleme = now();
  const ekle = (pages: readonly TrackedQueuedPage[]) => {
    if (pages.length === 0) return;
    const t = now();
    sonEkleme = t;
    for (const p of pages) {
      const basla = !p.recheck && typeof p.queuedAt === 'number' && Number.isFinite(p.queuedAt) ? Math.min(p.queuedAt, t) : t;
      const z: Iz = { p, i: sira++, outcome: null, job: null, isKaydi: null, okundu: -1, degisti: null, failedSince: null, basla, ozetlendi: false };
      // Ayni sayfa yeniden geldiyse (yeni is ya da yenileme okumasi) eski izin yerine gecer
      const eski = izler.findIndex((x) => x.p.id === p.id);
      if (eski >= 0) izler.splice(eski, 1, z);
      else izler.push(z);
    }
  };
  ekle(ilk);
  ekle(gelen());
  if (izler.length === 0) {
    bitti();
    return new Map();
  }
  let tur = 0;
  let sonDurum = new Map<string, string>();
  let sonKayitlar = new Map<string, string | null>();
  const sonuclar = () => new Map(izler.filter((z) => z.outcome).map((z) => [z.p.id, z.outcome!]));
  const suresiDoldu = (z: Iz) => now() - z.basla > (z.p.recheck ? STUCK_RECHECK_MS : timeoutMs);
  // Sonucu beklenen ya da (suresi icinde) yeniden yayini listeden izlenen sayfa
  const izleniyor = (z: Iz) => !z.outcome || (z.outcome.kind === 'republishing' && !suresiDoldu(z));
  const kapat = (z: Iz, o: BatchPageOutcome) => {
    z.outcome = o;
    const isinKaydi = o.kind === 'proposal' || o.kind === 'republishing' || o.kind === 'recovered' ? z.isKaydi : null;
    const listedeki = sonKayitlar.has(z.p.id) ? sonKayitlar.get(z.p.id)! : z.p.base.recoveryId;
    opts.onSettle?.(z.p.id, o, sonDurum.get(z.p.id) ?? null, {
      recoveryId: isinKaydi ?? listedeki,
      jobId: z.p.jobId,
      base: z.p.base,
      recheck: z.p.recheck === true,
    });
  };
  const ozet = () => {
    const aday = izler.filter((z) => !z.p.recheck && !z.ozetlendi);
    if (aday.length === 0 || !aday.every((z) => z.outcome)) return;
    for (const z of aday) z.ozetlendi = true;
    opts.onAllSettled?.(new Map(aday.map((z) => [z.p.id, z.outcome!])));
  };
  const isOkunur = (z: Iz) => !!z.p.jobId && !!opts.getJob;
  // Paylasilan butce: her istekten once bir hak (sekmeler + gonderimler toplami)
  const hak = () => !opts.budget || opts.budget.take(now());
  // Ara deneme hatasi (FAILED, attempts < 3) yeniden denenecek: bir sure beklenir (publish-result.ts pollJob)
  const isSonucu = (z: Iz, job: JobSnapshot): StuckJobOutcome => {
    if (job.status === 'FAILED' && typeof job.attempts === 'number' && job.attempts < JOB_MAX_ATTEMPTS) {
      z.failedSince ??= now();
      if (now() - z.failedSince < JOB_RETRY_GRACE_MS) return { kind: 'pending' };
    } else {
      z.failedSince = null;
    }
    return stuckJobOutcome(job);
  };

  for (;;) {
    if (!alive()) {
      bitti();
      return null;
    }
    ekle(gelen());
    for (const z of izler) if (!z.outcome && suresiDoldu(z)) kapat(z, { kind: 'unknown' });
    ozet();
    if (!izler.some(izleniyor)) {
      // Cikmadan once gelen kutusu SENKRON yeniden okunur: bitti() ile ayni adimda bos ise
      // sonradan eklenen sayfa yeni bir dongu baslatir, hicbir sayfa kaybolmaz
      const son = gelen();
      if (son.length === 0) {
        bitti();
        return sonuclar();
      }
      ekle(son);
      continue;
    }
    const elapsed = now() - sonEkleme;
    await sleep(elapsed < 60_000 ? 5000 : elapsed < 5 * 60_000 ? 10_000 : 20_000);
    if (!alive()) {
      bitti();
      return null;
    }
    ekle(gelen());
    if (!hak()) continue;
    let rows: readonly StuckRowLike[] | null = null;
    try {
      rows = await opts.load();
    } catch {
      rows = null;
    }
    if (!rows) continue;
    tur++;
    const byId = new Map(rows.map((r) => [r.id, r]));
    sonDurum = new Map(rows.map((r) => [r.id, r.status]));
    sonKayitlar = new Map(rows.map((r) => [r.id, sonKayit(r)]));
    const listede = (z: Iz) => queuedPageState(z.p.base, byId.get(z.p.id));

    // 1) Listede sonucu gorunen sayfalar; yeniden yayini suren sayfanin son hali. Neden
    //    yalniz oneri ve hatada gerekir (is sonucunda); digerleri listeden hemen kapanir.
    const nedenOkunacak: Iz[] = [];
    for (const z of izler) {
      const ls = listede(z);
      if (z.outcome) {
        if (z.outcome.kind === 'republishing' && ls !== 'republishing' && ls !== 'waiting') kapat(z, settleQueuedPage(z.job, ls) ?? { kind: 'other' });
        continue;
      }
      if (ls === 'waiting') continue;
      const nedenGerek = (ls === 'proposal' || ls === 'failed') && isOkunur(z);
      if ((z.job && z.job.kind !== 'pending') || !nedenGerek) {
        kapat(z, settleQueuedPage(z.job, ls) ?? { kind: 'other' });
        continue;
      }
      z.degisti ??= tur;
      nedenOkunacak.push(z);
    }

    // 2) Is kaydi okumalari — butce icinde, oncelik sirasiyla
    const enGecSonuclanan = Math.max(-1, ...izler.filter((z) => z.outcome).map((z) => z.i));
    const bekleyen = izler
      .filter((z) => !z.outcome && isOkunur(z) && !nedenOkunacak.includes(z))
      .sort((a, b) => (Number(!!b.p.recheck) - Number(!!a.p.recheck))
        || (Number(b.i < enGecSonuclanan) - Number(a.i < enGecSonuclanan)) || (a.okundu - b.okundu) || (a.i - b.i));
    let butce = isKaydiButcesi(elapsed);
    for (const z of [...nedenOkunacak, ...bekleyen]) {
      if (butce <= 0 || !hak()) break;
      butce--;
      z.okundu = tur;
      let job: JobSnapshot;
      try {
        job = await opts.getJob!(z.p.jobId!);
      } catch {
        continue;
      }
      const jo = isSonucu(z, job);
      if (jo.kind === 'pending') {
        // Yenileme okumasi: is hala bitmedi — kart "henuz gelmedi" kalir, yeniden okunmaz
        if (z.p.recheck) kapat(z, { kind: 'unknown' });
        continue;
      }
      z.job = jo;
      z.isKaydi = isinKurtarmaKaydi(job);
      const o = settleQueuedPage(jo, listede(z));
      if (o) kapat(z, o);
    }
    // 3) Nedeni okunamayan (butce, is kaydi henuz guncellenmedi) degismis sayfa en fazla bir
    //    tur bekler, sonra nedensiz kapanir: kart sonucu bilinen bir sayfa icin bekletilmez
    for (const z of nedenOkunacak) {
      if (!z.outcome && tur - (z.degisti ?? tur) >= 1) kapat(z, settleQueuedPage(null, listede(z)) ?? { kind: 'other' });
    }

    ozet();
  }
}

/**
 * Sabit bir sayfa grubunun sonucunu okur (tek dongu). Dongu sonuclari doner; sayfa kapaninca
 * null. Panel tek yoklayici icin stuckBatchWatcher kullanir.
 */
export async function pollStuckBatch(
  opts: StuckPollOptions & { pages: readonly TrackedQueuedPage[] },
): Promise<ReadonlyMap<string, BatchPageOutcome> | null> {
  return stuckPollLoop(opts, opts.pages, () => [], () => undefined);
}

export interface StuckBatchWatcher {
  /** Sayfalari calisan donguye ekler; calisan dongu yoksa baslatir */
  add(pages: readonly TrackedQueuedPage[]): void;
  /** Dongu calisiyor mu */
  readonly running: boolean;
}

/**
 * Site basina TEK yoklayici. NEDEN: her toplu gonderim ve sayfa yenileme kendi
 * pollStuckBatch dongusunu kendi istek butcesi ve kendi tur sikligiyla baslatiyordu; 100
 * satirda iki kez "Tümünü seç" dakikada 47, ucuncu gonderim 69 istek demekti (API siniri 60,
 * S13 yan etkisi). Yeni sayfalar calisan donguye katilir; tur ve butce tektir. Sekmeler
 * arasi tavan icin opts.budget'a sharedPollBudget verilir.
 */
export function stuckBatchWatcher(opts: StuckPollOptions): StuckBatchWatcher {
  let kutu: TrackedQueuedPage[] = [];
  let calisiyor = false;
  const al = () => {
    const x = kutu;
    kutu = [];
    return x;
  };
  const durdu = () => {
    calisiyor = false;
  };
  return {
    add(pages) {
      if (pages.length === 0) return;
      kutu.push(...pages);
      if (calisiyor) return;
      calisiyor = true;
      stuckPollLoop(opts, al(), al, durdu).catch(durdu);
    },
    get running() {
      return calisiyor;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  SAYFA YENILENINCE (D4): kuyruktaki sayfalar ve son sonuclar tarayicida tutulur
//
//  NEDEN: kuyruktaki sayfanin isareti bilesen durumundaydi; sayfa yenilenince sirada
//  bekleyen kart yeniden "Tespit edildi" gorunuyor, secilip ikinci kez kuyruga
//  alinabiliyordu (inceleme S24). API ayni sayfaya ikinci isi reddeder (D4), ama panel
//  de bekleyen sayfayi "sirada" gostermeli ve sonucunu okumayi surdurmeli. Yalniz bu
//  tarayicidaki kolaylik: depolama yoksa (gizli pencere, engelli site verisi) liste
//  sunucudaki durumla calisir, API yinelenen isi yine reddeder.
// ─────────────────────────────────────────────────────────────────────────

/** Kartta sonucun gosterilme suresi — sonra liste durumu yeterli */
export const STUCK_OUTCOME_TTL_MS = 2 * 60 * 60_000;

export interface StoredQueuedPage extends TrackedQueuedPage {
  queuedAt: number;
}

export interface StoredPageOutcome {
  outcome: BatchPageOutcome;
  /** Sonuc yazildiginda sayfanin listedeki durumu — durum degisince not eskimis sayilir */
  status: string | null;
  at: number;
  /**
   * Sonucun ait oldugu son kurtarma kaydi (SettledPageInfo.recoveryId). Listedeki son kayit
   * bundan farkliysa not gosterilmez. NEDEN: oneride durum DETECTED kalir; baska cihazdan
   * sonradan yapilan yeni oneri, durum degismedigi icin onceki onerinin nedeniyle
   * gosteriliyordu (S22 yan etkisi). Eski kayitta yok (undefined): denetlenmez.
   */
  recoveryId?: string | null;
  /** Yalniz 'unknown' sonucta: sayfa yenilenince bu is kaydi yeniden okunur (stuckRecheckPages) */
  jobId?: string | null;
  base?: QueuedPageBaseline;
}

export interface StuckBatchStore {
  pages: StoredQueuedPage[];
  outcomes: Record<string, StoredPageOutcome>;
}

export function stuckBatchStoreKey(siteId: string): string {
  return `ranksup:stuck-batch:${siteId}`;
}

const SONUC_TURLERI = new Set(['notProcessed', 'skipped', 'proposal', 'republishing', 'recovered', 'failed', 'other', 'unknown']);

function okunanSonuc(v: unknown): BatchPageOutcome | null {
  if (!nesne(v) || typeof v.kind !== 'string' || !SONUC_TURLERI.has(v.kind)) return null;
  const reason = metin(v.reason);
  switch (v.kind) {
    case 'skipped': return { kind: 'skipped', reason: reason ?? ATLANDI_GENEL };
    case 'notProcessed': case 'proposal': case 'failed': return { kind: v.kind, reason };
    default: return { kind: v.kind as 'republishing' | 'recovered' | 'other' | 'unknown' };
  }
}

function okunanBaz(b: unknown, id: string): QueuedPageBaseline | null {
  if (!nesne(b)) return null;
  return { id, status: metin(b.status) ?? 'DETECTED', recoveryId: metin(b.recoveryId) };
}

/**
 * Depodaki kayit → dogrulanmis, suresi gecmemis hali. Bozuk ya da baska surumden kalan
 * veri yok sayilir (yalniz bu tarayicidaki kolaylik; hata sayfayi bozmamali).
 * Yoklama siniri sayfa kapaliyken dolan sayfa (30 dk'dan eski, sonucu hic okunmamis) is
 * kimligiyle 'unknown' sonuca doner: yenilemede is kaydi bir kez okunur. NEDEN: eskiden
 * bu sayfa iz birakmadan dusuyor, is sonradan atlansa da nedeni hic gosterilmiyordu.
 */
export function readStuckBatchStore(raw: string | null | undefined, now: number): StuckBatchStore {
  const bos: StuckBatchStore = { pages: [], outcomes: {} };
  if (!raw) return bos;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return bos;
  }
  if (!nesne(v)) return bos;
  const outcomes: Record<string, StoredPageOutcome> = {};
  if (nesne(v.outcomes)) {
    for (const [id, o] of Object.entries(v.outcomes)) {
      if (!nesne(o) || typeof o.at !== 'number' || now - o.at > STUCK_OUTCOME_TTL_MS || o.at > now + 60_000) continue;
      const outcome = okunanSonuc(o.outcome);
      if (!outcome) continue;
      const kayit: StoredPageOutcome = { outcome, status: metin(o.status), at: o.at };
      if ('recoveryId' in o) kayit.recoveryId = metin(o.recoveryId);
      const base = okunanBaz(o.base, id);
      const jobId = metin(o.jobId);
      if (outcome.kind === 'unknown' && jobId && base) {
        kayit.jobId = jobId;
        kayit.base = base;
      }
      outcomes[id] = kayit;
    }
  }
  const pages: StoredQueuedPage[] = [];
  for (const p of Array.isArray(v.pages) ? v.pages : []) {
    if (!nesne(p) || !metin(p.id) || !nesne(p.base) || typeof p.queuedAt !== 'number') continue;
    if (p.queuedAt > now + 60_000) continue;
    const id = metin(p.id)!;
    const base = okunanBaz(p.base, id)!;
    const jobId = metin(p.jobId);
    if (now - p.queuedAt > STUCK_BATCH_POLL_MS) {
      const at = p.queuedAt + STUCK_BATCH_POLL_MS;
      if (jobId && !(id in outcomes) && now - at <= STUCK_OUTCOME_TTL_MS) {
        outcomes[id] = { outcome: { kind: 'unknown' }, status: base.status, at, recoveryId: base.recoveryId, jobId, base };
      }
      continue;
    }
    pages.push({ id, jobId, base, queuedAt: p.queuedAt });
  }
  return { pages, outcomes };
}

/**
 * Sayfa yenilenince is kaydi yeniden okunacak sayfalar: suresi dolup 'unknown' kalan ve is
 * kimligi bilinenler. Yoklayici her birini butce icinde BIR KEZ okur (TrackedQueuedPage.recheck).
 * Hala sirada izlenen sayfa (sirada) atlanir: tek okuma suren izlemenin yerine gecmesin.
 */
export function stuckRecheckPages(
  outcomes: Readonly<Record<string, StoredPageOutcome>>,
  sirada: readonly { id: string }[] = [],
): TrackedQueuedPage[] {
  const izlenen = new Set(sirada.map((p) => p.id));
  const out: TrackedQueuedPage[] = [];
  for (const [id, o] of Object.entries(outcomes)) {
    if (o.outcome.kind === 'unknown' && o.jobId && o.base && !izlenen.has(id)) out.push({ id, jobId: o.jobId, base: o.base, recheck: true });
  }
  return out;
}

/**
 * Kartta gosterilecek sonuc: sayfanin durumu sonuc yazildigindan beri degismediyse ve
 * (currentRecoveryId verildiyse) listedeki son kurtarma kaydi sonucun kaydiyla ayniysa.
 * currentRecoveryId: listedeki son kaydin kimligi, kayit yoksa null.
 */
export function visiblePageOutcome(
  stored: StoredPageOutcome | undefined,
  currentStatus: string | undefined,
  currentRecoveryId?: string | null,
): BatchPageOutcome | null {
  if (!stored) return null;
  if (stored.status && currentStatus && stored.status !== currentStatus) return null;
  // Sonuctan sonra yeni bir kurtarma kaydi acildi (or. baska cihazdan "AI Düzelt"): not eskidi
  if (currentRecoveryId !== undefined && stored.recoveryId !== undefined && stored.recoveryId !== currentRecoveryId) return null;
  return stored.outcome;
}

/**
 * Toplu istek hata verdiyse secimden artik uygun olmayan sayfalar cikar (isleniyor,
 * duzeltildi...). NEDEN: zaman asiminda sunucu isi yine de yapmis olabilir; secimi
 * oldugu gibi birakmak ayni sayfalarin kor yeniden denemesine davet ediyordu.
 */
export function pruneBatchSelection(selected: Iterable<string>, rows: readonly StuckRowLike[]): Set<string> {
  const uygun = new Set(rows.filter((r) => r.status === 'DETECTED' && !!r.articleId).map((r) => r.id));
  return new Set([...selected].filter((id) => uygun.has(id)));
}

/** Toplu onarim bildirimi — "duzeltildi" yalniz gercekten RECOVERED olan sayfa icin */
export function batchRecoveryNotice(s: BatchRecoverySummary): NoticeSpec {
  const parts: string[] = [];
  if (s.queued > 0) parts.push(`${s.queued} sayfada değişiklik yazıya uygulandı, yeniden yayın sırada`);
  if (s.recovered > 0) parts.push(`${s.recovered} sayfa düzeltildi`);
  if (s.proposals > 0) parts.push(`${s.proposals} sayfa için öneri kaydedildi (yazı değişmedi, elle uygulanır)`);
  if (s.failed > 0) parts.push(`${s.failed} sayfa düzeltilemedi`);
  // Denenmeyen sayfa basarisiz degil; kullanici yeniden secip dener
  if (s.notProcessed > 0) parts.push(`${s.notProcessed} sayfa işlenmedi (tek seferdeki sayfa sınırı aşıldı; bu sayfaları yeniden seçip tekrar dene)`);
  if (parts.length === 0) return { tone: 'info', title: 'Toplu onarım: işlenen sayfa yok' };
  const done = s.queued + s.recovered + s.proposals;
  const tone: NoticeSpec['tone'] = s.failed > 0
    ? (done === 0 ? 'error' : 'warning')
    : s.notProcessed > 0 ? 'warning' : s.proposals > 0 ? 'info' : 'success';
  return {
    tone,
    title: `Toplu onarım: ${parts.join(', ')}`,
    description: s.errors.length > 0 ? s.errors.slice(0, 3).join(' · ') : undefined,
  };
}
