/**
 * RanksUp API client.
 * NextAuth session cookie otomatik include edilir (credentials: 'include').
 */

import type {
  GaKeyEventSetup, LocalPromptDraft, LocalPromptInput, LocalPromptMeta, LocalRunSummary, SiteNapView,
} from './local-visibility';
import type { ArticleVideo, VideoBrandPreview, VideoQuota, VideoRequestBody } from './article-video';
import type { MusteriRaporu, PaylasilanRapor, PaylasimOzeti } from './musteri-raporu';
import { readApiErrorCode, trialErrorAction, TRIAL_ERROR_EVENT } from './trial-errors';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  /** Sunucunun makine kodu (örn. TRIAL_EXPIRED, TRIAL_SOURCE_REQUIRED); yoksa null */
  public readonly code: string | null;

  constructor(
    public readonly status: number,
    /** Kullanıcıya gösterilebilir Türkçe mesaj */
    public readonly userMessage: string,
    /** Backend'in dönüş gövdesi (debug için) */
    public readonly rawBody?: unknown,
  ) {
    super(userMessage);
    this.name = 'ApiError';
    this.code = readApiErrorCode(rawBody);
  }
}

/**
 * Deneme hatasi (403 TRIAL_EXPIRED / TRIAL_SOURCE_REQUIRED) panele duyurulur:
 * components/trial-upgrade.tsx modali acar ya da yayin hedefi baglantili bildirim
 * gosterir (lib/trial-errors.ts). Hata yine firlatilir; cagiranin akisi degismez.
 */
function announceTrialError(status: number, body: unknown, path: string): void {
  if (typeof window === 'undefined') return;
  const action = trialErrorAction(status, body, path, window.location?.pathname);
  if (!action) return;
  try {
    window.dispatchEvent(new CustomEvent(TRIAL_ERROR_EVENT, { detail: action }));
  } catch {
    // Olay kurulamadiysa (eski tarayici) cagiranin kendi bildirimi yeter
  }
}

function toUserMessage(status: number, body: unknown): string {
  // Backend zaten anlamlı bir Türkçe mesaj dönmüşse onu kullan
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    const msg =
      typeof b.message === 'string'
        ? b.message
        : Array.isArray(b.message) && b.message.length > 0 && typeof b.message[0] === 'string'
          ? b.message.join(', ')
          : null;

    if (msg && msg !== 'Internal server error' && msg !== 'Bad Request') {
      return msg;
    }
  }

  if (status === 0) return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
  if (status === 400) return 'Gönderdiğin bilgilerde bir sorun var, lütfen kontrol et.';
  if (status === 401) return 'Oturumun süresi dolmuş, lütfen tekrar giriş yap.';
  if (status === 403) return 'Bu işlem için yetkin yok.';
  if (status === 404) return 'İstenen kayıt bulunamadı.';
  if (status === 409) return 'Bu kayıt zaten mevcut.';
  if (status === 413) return 'Gönderilen dosya çok büyük.';
  if (status === 422) return 'Girilen değerler geçersiz.';
  if (status === 429) return 'Çok fazla istek attın. Birkaç saniye bekleyip tekrar dene.';
  if (status === 502 || status === 503 || status === 504) {
    return 'Sunucu şu an cevap vermiyor. Birkaç saniye sonra tekrar dene.';
  }
  if (status >= 500) {
    // Backend'in döndüğü spesifik mesajı önce dene
    if (body && typeof body === 'object') {
      const b = body as { message?: unknown; error?: unknown };
      if (typeof b.message === 'string' && b.message.length > 0 && b.message.length < 500) return b.message;
      if (typeof b.error === 'string' && b.error.length > 0 && b.error.length < 500) return b.error;
    }
    return 'Sunucu tarafında beklenmeyen bir sorun oluştu. Tekrar dene.';
  }
  return 'Beklenmeyen bir hata oluştu, lütfen tekrar dene.';
}

/**
 * Yerel önizleme: `next dev` + NEXT_PUBLIC_PREVIEW_API_KEY (canlı panelden
 * oluşturulan SALT-OKUNUR anahtar) → istekler oturum çerezi yerine anahtarla
 * gider; yazma uçları kapsam yüzünden 403 alır. Üretim build'inde boş.
 */
const PREVIEW_AUTH: Record<string, string> =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_PREVIEW_API_KEY
    ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_PREVIEW_API_KEY}` }
    : {};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...PREVIEW_AUTH,
        ...init.headers,
      },
      credentials: 'include',
    });
  } catch (err: unknown) {
    throw new ApiError(0, toUserMessage(0, null), (err as Error)?.message);
  }
  return parseResponse<T>(res, path);
}

/**
 * Cok parcali (multipart) yukleme — Content-Type'i TARAYICI koyar (boundary);
 * JSON varsayilani burada olmamali. Hata isleme request() ile ayni.
 */
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method: 'POST', body: form, credentials: 'include', headers: PREVIEW_AUTH });
  } catch (err: unknown) {
    throw new ApiError(0, toUserMessage(0, null), (err as Error)?.message);
  }
  return parseResponse<T>(res, path);
}

async function parseResponse<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[API ${res.status}] ${path}`, body);
    }
    announceTrialError(res.status, body, path);
    throw new ApiError(res.status, toUserMessage(res.status, body), body);
  }

  // NestJS handler null/undefined dondugunde govde BOS gelir (Content-Length: 0).
  // res.json() bos govdede "Unexpected end of JSON input" firlatiyordu — 200'lu
  // bos yanit hata degil, null'dir (ör. agent-readiness/latest ilk taramadan once).
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

/** Audit delta raporu — GET /sites/:id/audit/compare cevabi */
export interface AuditComparison {
  from: { id: string; ranAt: string; overallScore: number; geoScore: number | null } | null;
  to: { id: string; ranAt: string; overallScore: number; geoScore: number | null } | null;
  scoreDelta: number;
  geoScoreDelta: number;
  checks: Array<{
    id: string;
    oncekiScore: number | null;
    sonrakiScore: number | null;
    delta: number;
    durum: 'iyilesti' | 'kotulesti' | 'ayni' | 'yeni' | 'kayboldu' | 'metodoloji_degisti';
  }>;
  /** Ölçüm yöntemi değişen kontroller — genel skor farkının bir kısmı buradan */
  metodolojiDegisen?: string[];
  issues: {
    cozulen: AuditIssueRecord[];
    yeniCikan: AuditIssueRecord[];
    devamEden: AuditIssueRecord[];
    /**
     * Önceki taramadaki sorun son taramada YENİDEN ÖLÇÜLEMEDİ (erişim engeli, atlanan AI
     * ölçümü, dar sayfa kapsamı) — çözülen sayılmaz. Eski API/dondurulmuş raporda yok.
     */
    olculemedi?: AuditIssueRecord[];
  };
  ozet: { cozulenSayisi: number; yeniSayisi: number; devamEdenSayisi: number; olculemeyenSayisi?: number };
  /** Tek tarama varsa true — karsilastirilacak referans yok */
  yeterliVeriYok?: boolean;
  /** Karşılaştırma kısmiyse nedenleri (audit.service.ts KismiKarsilastirma); tam karşılaştırmada yok */
  kismi?: {
    /** Önceki taramada ölçülüp son taramada ölçülemeyen kontroller */
    olculemeyenKontroller: string[];
    /** Genel skora giren ve iki taramadan yalnız birinde ölçülebilen kontroller */
    skorKapsamiFarkli: string[];
    /** Son taramanın sayfa kapsamı öncekinden dar (erken durma / yeni engellenen sayfa) */
    sayfaKapsami: { erkenDurdu: boolean; engellenenSayfa: number } | null;
  };
  /**
   * AI gorunurluk olcumunde iki taramada olculen asistan kumesi farkli (biri 429 /
   * kota / anahtar yuzunden olculemedi). aiCitations farki yalniz `ortak` asistanlar
   * uzerinden hesaplandi (checks satirindaki skorlar o ortalama); ortak yoksa satir
   * yok. Kume ayniysa ya da eski API'de alan yok (audit.service.ts compareAuditRows).
   */
  aiSaglayiciKapsami?: { ortak: string[]; yalnizOnceki: string[]; yalnizSonraki: string[] };
}

/** Kiyas sonucu soru x saglayici cifti icin: atif > anilma > yok; 'n/a' olculmedi (hata / yok) */
export type CitationQueryOutcome = 'cited' | 'mentioned' | 'none' | 'n/a';

/** Anilma / atif sayaclari — iki kosumda da hatasiz olculen ayni ciftler uzerinden */
export interface CitationMentionCounts {
  mentioned: number;
  cited: number;
  /** Atif var ama marka adi anilmadi; eski API'de yok */
  citedNotMentioned?: number;
  /** Sayilan cift (payda) */
  measured: number;
}

/**
 * GET /sites/:id/audit/citation-runs/compare — api audit/citation-run-compare.ts RunComparison.
 *
 * GOSTEREN ICIN KURAL: methodChanged (iki kosumun matchVersion'i farkli) iken
 * farklar HESAPLANMAZ: headlineDelta ve providers[].delta null, gained/lost 0,
 * queries[].delta 0 ve comparable false. null/0 "degismedi" diye degil
 * "karsilastirilamaz (yontem degisti)" diye gosterilmeli. Ortak saglayici yoksa da
 * headlineDelta null. Manset farki yalniz headlineBasis.providers (iki kosumda da
 * olculen asistanlar) uzerinden; a/b.headlineScore kendi kosumunun tum asistanlarinin
 * ortalamasidir, farki bunlardan hesaplamak yanlis olur.
 */
export interface CitationRunComparison {
  a: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  b: { id: string; runAt: string; headlineScore: number | null; trigger?: string };
  /** headlineBasis.after - headlineBasis.before; ortak saglayici yoksa ya da yontem degistiyse null */
  headlineDelta: number | null;
  /** Manset farkinin dayanagi; eski API'de yok */
  headlineBasis?: {
    /** Iki kosumda da sayisal skor donen asistanlar */
    providers: string[];
    before: number | null;
    after: number | null;
    /** a / b manset skoruna giren asistan sayisi */
    aProviders: number;
    bProviders: number;
  };
  /** delta: iki kosumda da skor varsa ve yontem ayniysa after - before, yoksa null */
  providers: Array<{ provider: string; label?: string; before: number | null; after: number | null; delta: number | null }>;
  /** Yalniz degisen soru x saglayici ciftleri (markasiz); direction 0 = kiyaslanamaz */
  changed: Array<{ provider: string; query: string; before: CitationQueryOutcome; after: CitationQueryOutcome; direction: 1 | -1 | 0 }>;
  /** Yontem degistiyse 0 */
  gained: number;
  lost: number;
  unchanged: number;
  /** Yalniz bir kosumda olculen ciftler — kazanc / kayip degil */
  added: number;
  removed: number;
  methodChanged: boolean;
  /** Iki kosumun olcum yontemi surumleri; eski API'de yok */
  matchVersions?: { a: number; b: number };
  queries: Array<{
    query: string;
    before: number;
    after: number;
    /** comparable false ise 0 — kazanc / kayip degil */
    delta: number;
    beforeMeasured: boolean;
    afterMeasured: boolean;
    /** Ayni saglayicilar ve ayni yontemle mi; alan yoksa (eski API) kiyaslanabilir */
    comparable?: boolean;
    providers: string[];
  }>;
  mentions: { before: CitationMentionCounts; after: CitationMentionCounts };
  daysBetween: number;
}

/**
 * GET /sites/:id/audit/history satiri — api audit/audit.service.ts getHistory.
 * Liste yeni → eski gelir.
 */
export interface AuditHistoryRow {
  id: string;
  ranAt: string;
  overallScore: number;
  geoScore: number | null;
  issueCount: number;
  durationMs: number | null;
  /**
   * Taramayi kim baslatti: 'user' (panelden elle), 'system' (haftalik otomatik
   * tarama ya da site kurulumu), 'test' (dogrulama kosumu). Eski API'de yok.
   */
  trigger?: string;
  /**
   * Genel skor bir onceki satirla (listede bir sonraki) ayni yontem ve kapsamla mi
   * olculdu. false: fark iyilesme / kotulesme diye okunmaz. Listenin en eski
   * satirinda null; eski API'de alan yok (lib/audit-history.ts).
   */
  scoreComparableWithPrevious?: boolean | null;
  /** Karsilastirilamazsa Turkce neden; aksi halde null. Eski API'de yok. */
  scoreMethodNote?: string | null;
}

/**
 * Article.publishedTo kaydi — api articles/publisher.service.ts PublishResult
 * (mergePublishedTo hedef basina tek kayit tutar). Eski kayitlarda targetName / url olabilir.
 */
export interface PublishedEntry {
  targetId: string;
  targetType?: string;
  ok?: boolean;
  externalUrl?: string;
  externalId?: string | number;
  /** Hedefte ne yapildi: created | updated | overwritten | exported | recreated */
  action?: string;
  /** Bu hedefte ilk yayin (ISO) */
  publishedAt?: string;
  /** Bu hedefe son yazim (ISO) */
  updatedAt?: string;
  /**
   * true: yazi bu hedefte ESKI metinle yayinda; hedef yaziyi yerinde guncelleyemedigi
   * icin RanksUp kopya acmadi. Musteri guncel metni hedefin kendi paneline yapistirmali
   * (sonra "Elle güncelledim": markPublishedEntryUpdated).
   */
  manualUpdatePending?: boolean;
  /** manualUpdatePending'in basladigi an (ISO) */
  manualUpdatePendingSince?: string;
  /**
   * WordPress'in modified_gmt degeri (ISO), RanksUp'in bu hedefe son yaziminin ardindan
   * (paylasilan sozlesme C3). Yayinci sonraki yazimdan once wp-admin'de duzenleme var mi
   * diye buna bakar ('live_entry_edited').
   */
  remoteModifiedAt?: string;
  /**
   * Kopya WordPress cop kutusunda bulundu (ISO, sozlesme C3): kayit artik canli degil;
   * panel onu yayinda saymaz (lib/publish-targets.ts isLivePublishedEntry).
   */
  trashedAt?: string;
  /**
   * Kopya hedefte artik yok (404/410) ve yeniden olusturulmadi (ISO, sozlesme D3): canli
   * degil; musteri hedefi secip yayinlarsa yazi orada yeniden olusturulur (D2).
   */
  missingAt?: string;
  targetName?: string;
  url?: string;
}

/** published-to/:targetId/mark-updated ve /forget cevabi */
export interface PublishedEntryMutation {
  ok: true;
  /** Yazinin guncel durumu (ARTICLE_STATUS) */
  status: string;
  /** Yazinin guncel publishedTo listesi */
  publishedTo: PublishedEntry[];
}

/** Toplu takili sayfa onariminin satiri — api audit/stuck-batch-result.ts StuckBatchResult */
export interface StuckBatchRow {
  id: string;
  /** true yalniz duzeltme gercekten uygulandiysa (tekil uctaki success) */
  ok: boolean;
  recoveryId?: string;
  editsCount?: number;
  /** Basarisizligin nedeni (atilan hata ve islenmeyen satir dahil) */
  error?: string;
  /** true = oneri kaydedildi, siteye yazilmadi (ok false kalir); elle uygulanir */
  manual?: boolean;
  /** recover()'in Turkce nedeni (oneride ve basarisizlikta) */
  reason?: string;
  /** Tek istek sinirini astigi icin hic denenmedi */
  notProcessed?: boolean;
}

/** Toplu onarim ozeti — api audit/stuck-batch-result.ts stuckBatchSummary; eski API'de yok */
export interface StuckBatchSummary {
  succeeded: number;
  proposals: number;
  failed: number;
  notProcessed: number;
}

/**
 * Toplu onarimin KUYRUGA ALMA satiri (paylasilan sozlesme C4/D4): uc her uygun sayfa icin
 * bir STUCK_PAGE_RECOVER isi acar ve hemen doner; duzeltme arka planda calisir. Sonuc
 * sayfa basina is kaydindan (getJob(jobId): Job.result, atlamada { skipped, reason }) ve
 * sayfa durumundan okunur (lib/stuck-recovery.ts pollStuckBatch).
 */
export interface StuckBatchQueueRow {
  stuckPageId: string;
  /** true: is kuyruga alindi */
  queued: boolean;
  /** DB is kimligi — GET /jobs/:id (sahiplik denetimli) */
  jobId?: string;
  /**
   * Hic denenmedi: tek istek siniri, sayfa zaten sirada / isleniyor ya da is kosarken
   * atlanacagi belli (D4: onay bekleyen surum, cop kutusu...); neden reason / error'da
   */
  notProcessed?: boolean;
  /** API'nin Turkce nedeni (panel oldugu gibi gosterir) */
  reason?: string;
  error?: string;
}

/** Kuyruga alma ozeti (sozlesme C4) */
export interface StuckBatchQueueSummary {
  queued: number;
  notProcessed: number;
  failed: number;
}

export interface AuditIssueRecord {
  severity?: 'critical' | 'warning' | 'info' | string;
  type?: string;
  page?: string;
  description?: string;
  fixable?: boolean;
  checkId?: string;
}

/**
 * Makale kotasi — api billing/article-quota-view.ts. GET /me/dashboard ve
 * GET /billing/users/:userId/current doner; servis okuyamazsa null (sayi uydurulmaz).
 */
export interface ArticleQuota {
  /** Plan limiti: ucretli planda aylik, denemede omur boyu (2, aylik sifirlanmaz) */
  limit: number;
  /** max(0, limit - used) */
  remaining: number;
  /** Ay basi sifirlamasi uygulanmis sayac */
  used: number;
}

/**
 * Satin alma durumu — api billing/paytr.service.ts checkoutStatus.
 * GET /billing/plans (herkese acik: anonim ziyaretci karari) ve
 * GET /billing/users/:userId/current (o hesaba gore: PayTR test modunda yalniz
 * yonetici acik) `checkout` alaninda doner. Eski API'de alan yok.
 */
export interface CheckoutAvailability {
  /** Bu hesap (ya da anonim ziyaretci) odeme baslatabilir mi */
  open: boolean;
  /** PayTR test modunda mi — odemeler gercek tahsilat degil */
  testMode: boolean;
  /** Kapaliyken gosterilecek metin (API'nin 403 metniyle ayni); acikken null */
  message: string | null;
}

/** GET /me/dashboard — api admin.service.ts getMyDashboard */
export interface MyDashboard {
  plan?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  sitesCount: number;
  articlesPublished: number;
  drafts: number;
  /** Sifirlamayi dikkate alan sayac (eski istemciler bunu okur) */
  articlesUsedThisMonth: number;
  /** Eski API'de alan yok; kota okunamazsa null */
  articleQuota?: ArticleQuota | null;
  lastInvoice?: { paidAt: string | null; amount: unknown; description: string | null } | null;
}

/**
 * Kalici rapor kaydi.
 *
 * Liste ucunda `data` GELMEZ — yalnizca getReportById'de gelir; dondurulmus
 * govde rapor basina yuzlerce KB ve liste satirinda hicbir ise yaramiyor.
 * Skor alanlari NULLABLE: "olculemedi" ile "sifir" ayni sey degil.
 */
export interface RaporKaydi {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  trigger: string;
  seoScore: number | null;
  geoScore: number | null;
  aiVisibility: number | null;
  asoAvgRank: number | null;
  clicks: number;
  impressions: number;
  articlesPublished: number;
  costUsd: string | number;
  status: string;
  durationMs: number | null;
  generatedAt: string;
}

// ──────────────────────────────────────────────────────────
//  Intel -> LinkedIn outreach (admin) — /api/intel/linkedin/*
// ──────────────────────────────────────────────────────────

export type LinkedinProspectStatus =
  | 'QUEUED' | 'REQUESTED' | 'ACCEPTED' | 'MESSAGED'
  | 'REPLIED' | 'SKIPPED' | 'FAILED';

export type LinkedinKampanya = 'MUSTERI' | 'YATIRIMCI' | 'ISBIRLIGI';
/** Cevap sonrasi satis hunisi (insan ekseni) */
export type LinkedinSatisAsamasi =
  | 'YOK' | 'GORUSULDU' | 'KARNE_GONDERILDI' | 'TOPLANTI' | 'TEKLIF' | 'KAZANILDI' | 'KAYBEDILDI';

export interface LinkedinProspect {
  id: string;
  ad: string;
  soyad: string;
  firma: string;
  unvan: string | null;
  profileUrl: string;
  sektor: string | null;
  /** 1 = karar verici, 2 = etkileyici */
  kademe: number | null;
  /** Kampanya turu — not/mesaj sablonunu belirler */
  kampanya?: LinkedinKampanya | null;
  /** Satis asamasi (insan ekseni; bot dokunmaz) */
  satisAsamasi?: LinkedinSatisAsamasi | null;
  satisNotu?: string | null;
  hatirlatmaAt?: string | null;
  status: LinkedinProspectStatus;
  noteText?: string | null;
  messageText?: string | null;
  requestedAt?: string | null;
  acceptedAt?: string | null;
  messagedAt?: string | null;
  repliedAt?: string | null;
  lastError?: string | null;
  screenshotPath?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LinkedinOverview {
  /** OPENCLAW_LINKEDIN_OUTREACH_ENABLED=1 mi — kapaliysa tick "Kapali" doner */
  enabled?: boolean;
  paused: boolean;
  pauseReason?: string | null;
  /** Su an hafta ici 09-18 Europe/Istanbul penceresinde miyiz */
  workWindow?: boolean;
  today: { requests: number; messages: number; inmails?: number };
  week: { requests: number };
  queued: number;
  /** ORAN (0-1): olgunlasmis isteklerde (72 sa - 14 gun) kabul / istek; 20 istek altinda null */
  acceptRate7d: number | null;
  acceptRateWindow?: string;
  acceptRateBase?: { requests: number; accepted: number; minRequests: number };
  byStatus?: Partial<Record<LinkedinProspectStatus, number>>;
  /** Arka uctaki etkin frenler (env ile yalniz asagi cekilmis olabilir) */
  limits?: Record<string, number>;
  recent: LinkedinProspect[];
  /** Firma bazli dagilim — panel ozet seridi */
  byFirma?: Array<{ firma: string; toplam: number; kuyrukta: number }>;
  /** DB'deki toplam kayit (recent kesilmis olabilir) */
  recentTotal?: number;
  /** Bayrak nereden: 'panel' (KvStore) ya da 'env' */
  enabledSource?: 'panel' | 'env';
  /** Iletisim modu: baglanti istegi / Premium InMail / karma */
  mod?: 'baglanti' | 'inmail' | 'karma';
  /** Son gorulen InMail kredisi */
  inmailKredi?: number | null;
  /** Cevap verip beklemede kalanlar + hatirlatmasi gelenler */
  ilgilenilecek?: Array<{
    id: string;
    ad: string;
    soyad: string;
    firma: string;
    unvan: string | null;
    status: LinkedinProspectStatus;
    satisAsamasi: LinkedinSatisAsamasi;
    hatirlatmaAt: string | null;
    repliedAt: string | null;
    profileUrl: string;
  }>;
  /** Panelden kaydedilmis ayarlar (bos = varsayilan) */
  ayarlar?: Record<string, number | number[]>;
  /** Her ayarin izin verilen araligi */
  ayarTavan?: Record<string, { min: number; max: number }>;
  /** Kampanya sablonlari — panelde onizleme */
  sablonlar?: Array<{
    kampanya: LinkedinKampanya;
    ad: string;
    not: string;
    notUzunluk: number;
    notSinir: number;
    mesaj: string;
    /** Premium InMail (dogrudan mesaj) metni ve konusu */
    inmail?: string;
    inmailKonu?: string;
    /** Metinde kisiye gore degisen parcalar (panelde vurgulanir) */
    ornek?: { kisi: string; firma: string };
  }>;
}

export interface LinkedinImportRow {
  ad: string;
  soyad: string;
  firma: string;
  unvan?: string;
  sektor?: string;
  kademe?: number;
  profileUrl: string;
}

export interface LinkedinTickAction {
  type: string;
  prospectId?: string;
  ok: boolean;
  note?: string;
}

export interface LinkedinTickResult {
  actions: LinkedinTickAction[];
  paused?: boolean;
  /** Gercek tick arka planda baslatildi (senkron sonuc yok); kuru tick senkron doner */
  started?: boolean;
  dryRun?: boolean;
  reason?: string;
}

export const api = {
  // Generic raw request (custom endpoints icin)
  request: <T = any>(path: string, options?: RequestInit) => request<T>(path, options),

  // Sites
  createSite: (body: { url: string; name: string; niche?: string; customNiche?: string; language?: string }) =>
    request<any>('/sites', { method: 'POST', body: JSON.stringify(body) }),

  // Sprint Onboarding
  updateSite: (id: string, body: any) =>
    request<any>(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  completeOnboarding: (siteId: string) =>
    request<any>(`/sites/${siteId}/complete-onboarding`, { method: 'POST' }),

  getUserQuota: (userId: string) =>
    request<{
      articles: { allowed: boolean; remaining: number; limit: number };
      sites: { allowed: boolean; current: number; limit: number };
      /** AI gorunurluk calistirmasi (AI Citation + Prompt Lab ayni kovadan duser) */
      aiRuns: { allowed: boolean; used: number; limit: number; remaining: number };
      budget: { used: number; cap: number; pct: number; warn: boolean; hardBlock: boolean };
    }>(`/billing/users/${userId}/quota`),

  /** Haftalik AI olcum hakki — hesap basina 7 gunde 1 (ADMIN: limited=false) */
  getMeasurementAllowance: () =>
    request<{
      limited: boolean;
      allowed: boolean;
      lastMeasuredAt: string | null;
      nextAvailableAt: string | null;
    }>('/billing/measurement-allowance'),

  detectNiche: (url: string) =>
    request<{
      niche: string;
      customNiche?: string;
      confidence: number;
      reasoning: string;
      alternatives: Array<{ niche: string; confidence: number }>;
    }>('/sites/detect-niche', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  regenerateBrain: (siteId: string) =>
    request<any>(`/sites/${siteId}/brain/regenerate`, { method: 'POST' }),

  listSites: () => request<any[]>('/sites'),

  getSite: (id: string) => request<any>(`/sites/${id}`),

  getBrain: (siteId: string) => request<any>(`/sites/${siteId}/brain`),

  deleteSite: (id: string) =>
    request<{ id: string }>(`/sites/${id}`, { method: 'DELETE' }),

  // Audit
  getLatestAudit: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/latest`),

  /**
   * SENKRON tarama — istek tarama bitene kadar (1-3 dk) acik kalir.
   * Vekil sunucu (Cloudflare varsayilani ~100 sn) bunu keser; UI icin
   * queueAudit + getJob yoklamasi kullanin. Eski cagrilar bozulmasin diye
   * duruyor.
   */
  runAuditNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/run-now`, { method: 'POST' }),

  /** Taramayi KUYRUGA atar, hemen doner. Durum icin getJob ile yoklayin. */
  queueAudit: (siteId: string) =>
    request<{ id: string; status: string }>(`/sites/${siteId}/audit/run`, { method: 'POST' }),

  /** Is durumu — QUEUED | PROCESSING | COMPLETED | FAILED | CANCELED */
  getJob: (jobId: string) =>
    request<{
      id: string;
      status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
      error: string | null;
      result: unknown;
      finishedAt: string | null;
      /**
       * Basarisiz deneme sayisi. Worker her basarisiz denemede FAILED yazar ve
       * artirir; yeniden deneme baslayinca durum PROCESSING'e doner (is 3 deneme,
       * job-queue.service.ts) — FAILED + attempts < 3 kesin sonuc degil.
       */
      attempts?: number;
    }>(`/jobs/${jobId}`),

  // Tarama geçmişi + iki tarama arası fark
  getAuditHistory: (siteId: string, limit = 20) =>
    request<AuditHistoryRow[]>(`/sites/${siteId}/audit/history?limit=${limit}`),

  compareAudits: (siteId: string, opts: { fromId?: string; toId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.fromId) qs.set('fromId', opts.fromId);
    if (opts.toId) qs.set('toId', opts.toId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AuditComparison>(`/sites/${siteId}/audit/compare${suffix}`);
  },

  previewStaticWrite: (siteId: string, pageUrl: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/static-preview`, { method: 'POST', body: JSON.stringify({ pageUrl, snippets }) }),

  writeStatic: (siteId: string, pageUrl: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/static-write`, { method: 'POST', body: JSON.stringify({ pageUrl, snippets }) }),

  applySnippets: (siteId: string, snippets: any[]) =>
    request<any>(`/sites/${siteId}/audit/snippets/apply`, { method: 'POST', body: JSON.stringify({ snippets }) }),

  // Toplu snippet tarama — root URL'den alt sayfaları tara, SEO durumlarını çıkar (AI çağrısı yok)
  bulkScanSnippets: (siteId: string, rootUrl?: string, maxPages = 30) =>
    request<BulkScanResult>(`/sites/${siteId}/audit/snippets/bulk-scan?${rootUrl ? `rootUrl=${encodeURIComponent(rootUrl)}&` : ''}maxPages=${maxPages}`),

  getSnippets: (siteId: string, pageUrl?: string) =>
    request<any>(`/sites/${siteId}/audit/snippets${pageUrl ? `?pageUrl=${encodeURIComponent(pageUrl)}` : ""}`),

  runCitationTest: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/citation-test`, { method: 'POST' }),

  // ── Prompt Lab — kullanıcının takip ettiği sorular ────────────
  listPrompts: (siteId: string, includeInactive = false) =>
    request<Array<{
      id: string; text: string; intent: string; locale: string; source: string;
      tags: unknown; isActive: boolean; fanoutCount: number;
      lastRunAt: string | null; lastCitedCount: number; lastTotalCount: number;
      lastScore: number | null; createdAt: string;
      /** Yerel soru: il/ilce/hizmet (yerel degilse null) */
      local?: LocalPromptMeta | null;
      /** Yerel sorunun son olcumundeki marka + telefon/adres sonucu */
      lastLocal?: LocalRunSummary | null;
    }>>(`/sites/${siteId}/audit/prompts${includeInactive ? '?includeInactive=1' : ''}`),

  createPrompt: (siteId: string, body: { text: string; intent?: string; locale?: string; tags?: string[] }) =>
    request<any>(`/sites/${siteId}/audit/prompts`, { method: 'POST', body: JSON.stringify(body) }),

  updatePrompt: (siteId: string, promptId: string, body: { text?: string; intent?: string; isActive?: boolean }) =>
    request<any>(`/sites/${siteId}/audit/prompts/${promptId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deletePrompt: (siteId: string, promptId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/prompts/${promptId}`, { method: 'DELETE' }),

  importPromptsFromBrain: (siteId: string) =>
    request<{ imported: number; skipped: number }>(`/sites/${siteId}/audit/prompts/import-brain`, { method: 'POST' }),

  runPrompt: (siteId: string, promptId: string, body: { withFanout?: boolean } = {}) =>
    request<{
      promptId: string; text: string;
      main: { cited: number; mentioned: number; total: number; score: number };
      fanout: { cited: number; mentioned: number; total: number; score: number } | null;
      providers: Array<{ provider: string; label: string; available: boolean; reason?: string; probes: any[] }>;
      weakestBranches: Array<{ id: string; text: string; kind: string; citedCount: number; total: number }>;
      /** Yalniz yerel sorularda */
      local?: LocalRunSummary | null;
      runAt: string;
    }>(`/sites/${siteId}/audit/prompts/${promptId}/run`, { method: 'POST', body: JSON.stringify(body) }),

  /** scope 'local': yalniz yerel sorular (ayni haftalik olcum hakki) */
  runAllPrompts: (siteId: string, body: { withFanout?: boolean; limit?: number; scope?: 'all' | 'local' } = {}) =>
    request<any>(`/sites/${siteId}/audit/prompts/run-all`, { method: 'POST', body: JSON.stringify(body) }),

  // ── Prompt Lab yerel mod — il/ilce + hizmet sorulari (AI cagrisi yok, olcum hakki harcamaz) ──
  previewLocalPrompts: (siteId: string, body: LocalPromptInput) =>
    request<{ spec: LocalPromptInput; drafts: LocalPromptDraft[] }>(
      `/sites/${siteId}/audit/prompts/local/preview`, { method: 'POST', body: JSON.stringify(body) },
    ),

  /** texts: onizlemeden secilen soru metinleri (metinler sunucuda yeniden uretilir) */
  createLocalPrompts: (siteId: string, body: LocalPromptInput & { texts: string[] }) =>
    request<{ created: number; skipped: number; limitReached: boolean }>(
      `/sites/${siteId}/audit/prompts/local`, { method: 'POST', body: JSON.stringify(body) },
    ),

  /** Sitede bulunan telefon/adres — kayitli veri, siteye istek atmaz (null = henuz okunmadi) */
  getLocalSiteNap: (siteId: string) =>
    request<SiteNapView | null>(`/sites/${siteId}/audit/prompts/local/site-nap`),

  /** Sitenin ana sayfasini yeniden okur (10 dakikada bir) */
  refreshLocalSiteNap: (siteId: string) =>
    request<SiteNapView>(`/sites/${siteId}/audit/prompts/local/site-nap/refresh`, { method: 'POST' }),

  promptCoverage: (siteId: string, days = 30) =>
    request<{
      siteId: string; days: number;
      /** score null = olculecek MARKASIZ satir yok ("%0 kapsama" degil) */
      main: { cited: number; mentioned: number; total: number; score: number | null };
      fanout: { cited: number; mentioned: number; total: number; score: number | null };
      byKind: Array<{ kind: string; cited: number; mentioned: number; total: number; score: number }>;
      gap: number | null;
    }>(`/sites/${siteId}/audit/prompts/coverage?days=${days}`),

  promptHistory: (siteId: string, promptId: string, days = 30) =>
    request<Array<{ date: string; cited: number; mentioned: number; total: number; score: number }>>(
      `/sites/${siteId}/audit/prompts/${promptId}/history?days=${days}`,
    ),

  // ── Fan-out — modelin arka planda açtığı alt sorgu dalları ────
  listFanout: (siteId: string, promptId: string) =>
    request<Array<{
      id: string; text: string; kind: string; likelihood: number;
      rank: number; isActive: boolean; generatedBy: string;
    }>>(`/sites/${siteId}/audit/prompts/${promptId}/fanout`),

  generateFanout: (siteId: string, promptId: string, max = 8) =>
    request<{
      promptId: string;
      generated: number;
      /** Ayni metinle daha once uretilmis, gecmisi korunarak yeniden aktive edilen dal sayisi */
      reactivated: number;
      branches: Array<{ text: string; kind: string; likelihood: number }>;
    }>(
      `/sites/${siteId}/audit/prompts/${promptId}/fanout/generate`,
      { method: 'POST', body: JSON.stringify({ max }) },
    ),

  addFanout: (siteId: string, promptId: string, text: string, kind?: string) =>
    request<any>(`/sites/${siteId}/audit/prompts/${promptId}/fanout`, {
      method: 'POST', body: JSON.stringify({ text, kind }),
    }),

  toggleFanout: (siteId: string, fanoutId: string, isActive: boolean) =>
    request<any>(`/sites/${siteId}/audit/fanout/${fanoutId}`, {
      method: 'PATCH', body: JSON.stringify({ isActive }),
    }),

  deleteFanout: (siteId: string, fanoutId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/fanout/${fanoutId}`, { method: 'DELETE' }),

  /** App Store Connect (ASO Faz 2) */
  connectAsc: (siteId: string, body: { issuerId: string; keyId: string; privateKeyPem: string }) =>
    request<any>(`/sites/${siteId}/aso/asc/connect`, { method: 'POST', body: JSON.stringify(body) }),

  listAscAccounts: (siteId: string) =>
    request<Array<{
      id: string; issuerId: string; keyId: string;
      isActive: boolean; lastSyncAt: string | null; lastError: string | null; createdAt: string;
      apps: Array<{ id: string; appleAppId: string; bundleId: string; name: string; latestVersion: string | null; latestReleaseAt: string | null }>;
    }>>(`/sites/${siteId}/aso/asc/accounts`),

  disconnectAsc: (accountId: string) =>
    request<{ ok: boolean }>(`/aso/asc/accounts/${accountId}`, { method: 'DELETE' }),

  syncAscApps: (accountId: string) =>
    request<{ synced: number }>(`/aso/asc/accounts/${accountId}/sync`, { method: 'POST' }),

  syncAscReleases: (appId: string) =>
    request<{ synced: number }>(`/aso/asc/apps/${appId}/sync-releases`, { method: 'POST' }),

  fetchAscReviews: (appId: string) =>
    request<{
      appId: string;
      appName: string;
      avgRating: string | null;
      reviews: Array<{
        id: string; rating: number; title: string; body: string;
        reviewerNickname: string; territory: string; createdDate: string | null;
        /** Herkese acik yanitimiz; PENDING_PUBLISH = gonderildi, magazada henuz yok */
        response: { body: string; state: 'PUBLISHED' | 'PENDING_PUBLISH' | null; lastModifiedDate: string | null } | null;
      }>;
    }>(`/aso/asc/apps/${appId}/reviews`),

  /** Yanit TASLAGI (gonderme yok) — notes: dogrulanmis bilgi ("1.2'de duzeldi") */
  draftAscReviewReply: (appId: string, reviewId: string, body: { notes?: string; supportContact?: string }) =>
    request<{ reply: string; report: boolean; reason: string | null; placeholders: string[]; existingResponse: string | null }>(
      `/aso/asc/apps/${appId}/reviews/${reviewId}/draft`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  replyAscReview: (appId: string, reviewId: string, body: string) =>
    request<any>(`/aso/asc/apps/${appId}/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  listAscAlerts: (siteId: string) =>
    request<Array<{
      id: string; severity: string; message: string; daysSinceUpdate: number;
      acknowledgedAt: string | null; createdAt: string;
      app: { name: string; appleAppId: string };
    }>>(`/sites/${siteId}/aso/asc/alerts`),

  acknowledgeAscAlert: (alertId: string) =>
    request<any>(`/aso/asc/alerts/${alertId}/acknowledge`, { method: 'POST' }),

  // ASC metadata — cek / plan (dry-run) / uygula / gecmis / geri al (yalniz panel oturumu)
  getAscMetadata: (siteId: string, ascAppId: string) =>
    request<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/metadata`),
  planAscMetadata: (siteId: string, ascAppId: string, body: { locale: string; fields: Record<string, string> }) =>
    request<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/metadata/plan`, { method: 'POST', body: JSON.stringify(body) }),
  applyAscMetadata: (siteId: string, ascAppId: string, planId: string) =>
    request<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/metadata/apply`, { method: 'POST', body: JSON.stringify({ planId, confirm: true }) }),
  getAscMetadataHistory: (siteId: string, ascAppId: string) =>
    request<any[]>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/metadata/history`),
  revertAscMetadata: (siteId: string, ascAppId: string, fixId: string) =>
    request<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/metadata/revert/${fixId}`, { method: 'POST' }),

  // ASC ekran goruntuleri — dosya basina tek istek (prod nginx 25 MB/istek)
  getAscScreenshots: (siteId: string, ascAppId: string, locale?: string) =>
    request<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/screenshots${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`),
  checkAscScreenshot: (siteId: string, ascAppId: string, file: File, displayType: string) => {
    const form = new FormData();
    form.append('displayType', displayType);
    form.append('file', file);
    return requestForm<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/screenshots/check`, form);
  },
  uploadAscScreenshot: (siteId: string, ascAppId: string, file: File, locale: string, displayType: string) => {
    const form = new FormData();
    form.append('locale', locale);
    form.append('displayType', displayType);
    form.append('confirm', 'true');
    form.append('file', file);
    return requestForm<any>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/screenshots/upload`, form);
  },
  clearAscScreenshots: (siteId: string, ascAppId: string, locale: string, displayType: string) =>
    request<{ deleted: number }>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/screenshots/clear`, { method: 'POST', body: JSON.stringify({ locale, displayType, confirm: true }) }),
  deleteAscScreenshot: (siteId: string, ascAppId: string, screenshotId: string) =>
    request<{ deleted: number }>(`/sites/${siteId}/aso/asc/apps/${ascAppId}/screenshots/${screenshotId}/delete`, { method: 'POST', body: JSON.stringify({ confirm: true }) }),

  /** Testimonials */
  submitTestimonial: (body: { siteId?: string; rating: number; body: string; role?: string; company?: string; metric?: string }) =>
    request<{ id: string }>(`/testimonials`, { method: 'POST', body: JSON.stringify(body) }),

  listPublicTestimonials: (limit = 6) =>
    request<Array<{
      id: string; rating: number; body: string; role: string | null; company: string | null;
      metric: string | null; displayName: string; initials: string; createdAt: string;
    }>>(`/testimonials/public?limit=${limit}`),

  listAdminTestimonials: (filter: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    request<Array<any>>(`/testimonials/admin?filter=${filter}`),

  moderateTestimonial: (id: string, action: 'approve' | 'reject' | 'feature' | 'unfeature') =>
    request<any>(`/testimonials/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }),

  deleteTestimonial: (id: string) =>
    request<{ ok: boolean }>(`/testimonials/${id}`, { method: 'DELETE' }),

  /** Landing analytics admin summary */
  getLandingAnalytics: (days = 7) =>
    request<{
      window: { daysBack: number; since: string };
      totals: { sessions: number; events: number; pageviews: number; ctaClicks: number; signups: number };
      funnel: { sessionToCtaPct: number; sessionToSignupPct: number };
      byType: Record<string, number>;
      topCtas: Array<{ id: string; count: number }>;
      topSections: Array<{ id: string; count: number }>;
      timeline: Array<{ date: string; pageviews: number; signups: number }>;
    }>(`/analytics/landing/summary?days=${days}`),

  /** AI Citation + GEO Roadmap (Maya tarzı öneri) */
  runCitationRoadmap: (siteId: string) =>
    request<{
      results: any[];
      roadmap: {
        summary: string;
        actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }>;
      } | null;
      runAt: string;
    }>(`/sites/${siteId}/audit/citation-roadmap`, { method: 'POST' }),

  /** Per-page citations + grounding queries (Microsoft Clarity tarzı) */
  runCitationPerPage: (siteId: string) =>
    request<{
      breakdown: {
        pages: Array<{ url: string; cites: number; queries: Array<{ query: string; provider: string; cites: number }> }>;
        topPages: Array<{ url: string; cites: number }>;
        groundingQueries: Array<{ query: string; cites: number; pages: string[] }>;
        totalCites: number;
      };
      runAt: string;
    }>(`/sites/${siteId}/audit/citation-per-page`, { method: 'POST' }),

  // ── Stuck Pages (On-page.ai Recipe 1) ──
  listStuckPages: (siteId: string, status?: string) =>
    request<Array<{
      id: string;
      siteId: string;
      articleId: string | null;
      url: string;
      title: string | null;
      impressions: number;
      clicks: number;
      ctr: number;
      position: number;
      stuckScore: number;
      status: string;
      topQueries: string[] | null;
      detectedAt: string;
      /**
       * Yalniz son kayit (stuck-page-detector list take 1). Kayit oneri mi uygulanmis
       * duzeltme mi oldugunu tasimaz; anlam sayfa durumundan (lib/stuck-recovery.ts).
       */
      recoveries: Array<{
        id: string;
        appliedAt: string;
        entitiesAdded: string[];
        edits: any[];
        paragraphAdded?: string | null;
        revertedAt: string | null;
      }>;
    }>>(
      `/sites/${siteId}/audit/stuck-pages${status ? `?status=${status}` : ''}`,
    ),

  detectStuckPages: (siteId: string) =>
    request<{ found: number; created: number; updated: number; skipped: number }>(
      `/sites/${siteId}/audit/stuck-pages/detect`,
      { method: 'POST' },
    ),

  getStuckPage: (siteId: string, id: string) =>
    request<any>(`/sites/${siteId}/audit/stuck-pages/${id}`),

  // triggeredBy govdede GONDERILMEZ: sunucu varsayilani zaten 'manual' ve
  // denetim izindeki aktor istemciden alinmamali (govdeden aktor ezme acigi);
  // uc DTO'ya gecip fazla alani reddettiginde (forbidNonWhitelisted) istek
  // 400 almasin.
  recoverStuckPage: (siteId: string, id: string) =>
    request<{
      /**
       * true: makalede degisiklik yaziya uygulandi ve yerinde yeniden yayin kuyrukta
       * (sayfa RECOVERING; yayin basarilinca RECOVERED). RanksUp disi sayfada dosya
       * yazildi (RECOVERED).
       */
      success: boolean;
      recoveryId?: string;
      editsCount?: number;
      reason?: string;
      /**
       * true = oneri kaydedildi, sitede hicbir sey degismedi; elle uygulanir. RanksUp
       * disi sayfa otomatik yazilamadi (stuck-page-external-recovery.service.ts) ya da
       * makalenin yayin hedefi yaziyi yerinde guncelleyemiyor (stuck-page-recovery.service.ts).
       * success false gelir, sayfa "Tespit edildi"de kalir; reason Turkce neden.
       */
      manual?: boolean;
      /**
       * true = sayfa bu istekte islenmedi, hicbir sey degismedi (or. zaten isleniyor ya da
       * duzeltildi; otopilot kurali). reason API'nin Turkce metni — panel oldugu gibi
       * gosterir (paylasilan sozlesme C5), "basarisiz" demez.
       */
      skipped?: boolean;
      /** Makale: yeniden yayin ikinci asamada (STUCK_PAGE_RECOVER phase 'republish') */
      needsRepublish?: boolean;
      articleId?: string;
    }>(`/sites/${siteId}/audit/stuck-pages/${id}/recover`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /**
   * Toplu onarim — KUYRUGA ALIR (sozlesme C4): her uygun sayfa icin bir
   * STUCK_PAGE_RECOVER isi, hemen doner. Eskiden tum LLM onarimlari tek istekte
   * siralaniyordu; Cloudflare'in ~100 sn siniri istegi 524 ile kesiyor, sunucu
   * duzenlemeye devam ederken panel "tekrar dene" diyordu.
   * Satir dizisi results (ya da rows) altinda gelir; eski (senkron) API'nin
   * StuckBatchRow satirlari da okunur — lib/stuck-recovery.ts readQueuedBatch.
   */
  recoverStuckPagesBatch: (siteId: string, stuckPageIds: string[]) =>
    request<{
      siteId?: string;
      results?: Array<StuckBatchQueueRow | StuckBatchRow>;
      rows?: StuckBatchQueueRow[];
      summary?: StuckBatchQueueSummary | StuckBatchSummary;
    }>(
      `/sites/${siteId}/audit/stuck-pages/recover-batch`,
      { method: 'POST', body: JSON.stringify({ stuckPageIds }) },
    ),

  revertStuckPageRecovery: (siteId: string, recoveryId: string) =>
    request<{ ok: boolean }>(
      `/sites/${siteId}/audit/stuck-pages/recovery/${recoveryId}/revert`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  ignoreStuckPage: (siteId: string, id: string) =>
    request<{ ok: boolean }>(
      `/sites/${siteId}/audit/stuck-pages/${id}/ignore`,
      { method: 'POST' },
    ),

  // ── BYOK (Bring Your Own Key) — Sprint BYOK ──
  getAiKeysStatus: (siteId: string) =>
    request<any>(`/sites/${siteId}/ai-keys`),

  upsertAiKey: (siteId: string, provider: string, key: string) =>
    request<any>(`/sites/${siteId}/ai-keys`, {
      method: 'POST',
      body: JSON.stringify({ provider, key }),
    }),

  deleteAiKey: (siteId: string, provider: string) =>
    request<any>(`/sites/${siteId}/ai-keys/${provider}`, { method: 'DELETE' }),

  retestAiKey: (siteId: string, provider: string) =>
    request<any>(`/sites/${siteId}/ai-keys/${provider}/test`, { method: 'POST' }),

  // Görsel alt metni (sites/:id/audit/images) — öneri → onay → siteye yazma
  listSiteImages: (siteId: string, params: { status?: string; state?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.state) qs.set('state', params.state);
    if (params.page) qs.set('page', String(params.page));
    const q = qs.toString();
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(`/sites/${siteId}/audit/images${q ? `?${q}` : ''}`);
  },
  getSiteImagesSummary: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/images/summary`),
  suggestSiteImages: (siteId: string, body: { imageIds?: string[]; all?: boolean; max?: number }) =>
    request<{ queued: number; jobIds: string[] }>(`/sites/${siteId}/audit/images/suggest`, { method: 'POST', body: JSON.stringify(body) }),
  suggestSiteImage: (siteId: string, imageId: string) =>
    request<any>(`/sites/${siteId}/audit/images/${imageId}/suggest`, { method: 'POST' }),
  decideSiteImage: (siteId: string, imageId: string, body: { decision: 'approve' | 'decorative' | 'dismiss' | 'reset'; approvedAlt?: string }) =>
    request<any>(`/sites/${siteId}/audit/images/${imageId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  applySiteImages: (siteId: string, body: { imageIds?: string[]; all?: boolean }) =>
    request<{ queued: number; jobIds: string[] }>(`/sites/${siteId}/audit/images/apply`, { method: 'POST', body: JSON.stringify(body) }),
  revertSiteImage: (siteId: string, imageId: string) =>
    request<{ ok: boolean; status: string; note?: string }>(`/sites/${siteId}/audit/images/${imageId}/revert`, { method: 'POST' }),
  getSiteImageSnippets: (siteId: string) =>
    request<Array<{ id: string; src: string; firstPageUrl: string; approvedAlt: string | null; html: string }>>(`/sites/${siteId}/audit/images/snippets`),

  /**
   * Kök dosya düzeltmelerini uygular. confirm: { [fix]: previewToken } —
   * robots.txt her zaman önizleme onayı ister (previewAutoFix); sitemap/llms
   * onaysız yalnız dosya YOKKEN oluşturulur.
   */
  applyAutoFix: (siteId: string, fixes: string[], confirm?: Record<string, string>) =>
    request<AutoFixNowResult>(`/sites/${siteId}/audit/auto-fix-now`, {
      method: 'POST',
      body: JSON.stringify(confirm ? { fixes, confirm } : { fixes }),
    }),

  /** Yazmadan önizleme: mevcut içerik, önerilen içerik, satır farkı, previewToken */
  previewAutoFix: (siteId: string, fix: string, options?: { aiTrain?: 'yes' | 'no' }) =>
    request<AutoFixPreview>(`/sites/${siteId}/audit/auto-fix/preview`, {
      method: 'POST',
      body: JSON.stringify({ fix, ...(options ? { options } : {}) }),
    }),

  getAutoFixHistory: (siteId: string) =>
    request<AutoFixHistoryItem[]>(`/sites/${siteId}/audit/auto-fix/history`),

  revertAutoFix: (siteId: string, fixId: string) =>
    request<{ ok: boolean; code?: string; error?: string; verified?: boolean; note?: string }>(
      `/sites/${siteId}/audit/auto-fix/${fixId}/revert`,
      { method: 'POST' },
    ),

  // Topics
  getTopicQueue: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/queue`),

  regenerateTopics: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/regenerate`, { method: 'POST' }),

  runTopicsNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/run-now`, { method: 'POST' }),

  runTopicEngineNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/topics/run-now`, { method: 'POST' }),

  // Articles
  listArticles: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/articles${status ? `?status=${status}` : ''}`),

  listScheduledArticles: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/articles/scheduled`),

  // scheduleArticleBatch silindi: POST schedule-batch API'den kaldirildi
  // (articles.controller.ts KALDIRILAN UCLAR) ve hicbir bilesen cagirmiyordu.

  scheduleTopicToCalendar: (siteId: string, payload: { topic: string; scheduledAt: string; slug?: string; pillar?: string }) =>
    request<any>(`/sites/${siteId}/articles/schedule-topic`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),


  rescheduleArticle: (siteId: string, articleId: string, scheduledAt: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/reschedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduledAt }),
    }),

  unscheduleArticle: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/scheduled/${articleId}`, {
      method: 'DELETE',
    }),

  // Otopilot + platform
  setAutopilot: (siteId: string, enabled: boolean) =>
    request<any>(`/sites/${siteId}/autopilot`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  createDemoSite: () =>
    request<{ siteId: string; articles: number }>(`/sites/demo`, { method: 'POST' }),

  // Sprint B — Agency
  getAgencyOverview: () => request<any>(`/agency/overview`),
  inviteAgencyClient: (payload: { email: string; name?: string }) =>
    request<any>(`/agency/invite`, { method: 'POST', body: JSON.stringify(payload) }),
  updateWhitelabel: (payload: any) =>
    request<any>(`/agency/whitelabel`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Sprint C — API Keys
  listApiKeys: () => request<any[]>(`/api-keys`),
  createApiKey: (payload: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) =>
    request<any>(`/api-keys`, { method: 'POST', body: JSON.stringify(payload) }),
  revokeApiKey: (id: string) => request<any>(`/api-keys/${id}`, { method: 'DELETE' }),

  detectPlatform: (siteId: string) =>
    request<any>(`/sites/${siteId}/detect-platform`, { method: 'POST' }),

  // GEO
  getCitationHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/citation-history?days=${days}`),
  /** Hafif manset: probe JSON'suz — overview/analytics kartlari icin */
  getCitationHeadline: (siteId: string, days = 14) =>
    request<any>(`/sites/${siteId}/audit/citation-history?days=${days}&headline=1`),

  /** Test gecmisi — her "Yeniden Test" kalici; iki kosum karsilastirilabilir */
  getCitationRuns: (siteId: string, limit = 30) =>
    request<any[]>(`/sites/${siteId}/audit/citation-runs?limit=${limit}`),
  getCitationRun: (siteId: string, id: string) =>
    request<any>(`/sites/${siteId}/audit/citation-runs/${id}`),
  /** Iki AI gorunurluk testinin kiyasi — panelde tuketen bilesen yok (rapor HTML'i API'de uretilir) */
  compareCitationRuns: (siteId: string, a: string, b: string) =>
    request<CitationRunComparison>(`/sites/${siteId}/audit/citation-runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  triggerCitationSnapshot: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/citation-snapshot`, { method: 'POST' }),

  buildLlmsFull: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/llms-full/build`, { method: 'POST' }),

  getLlmsFullUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/llms-full.txt`;
  },

  runGeoHeatmap: (siteId: string, maxQueries = 10) =>
    request<any>(`/sites/${siteId}/audit/geo-heatmap`, {
      method: 'POST',
      body: JSON.stringify({ maxQueries }),
    }),

  getWikidataDraft: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/knowledge/wikidata`),

  getWikipediaDraft: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/knowledge/wikipedia`),

  // generateArticleAudio silindi: TTS ses uretimi 0db5a1c'de urunden cikti,
  // articles/:id/audio ucu yok ve cagiran yoktu.

  // RanksUp Wikidata/Wikipedia'ya otomatik gonderim YAPMAZ: uc her zaman
  // { ok: false, manual: true, warning, createUrl } doner (wikidata'da sunucunun
  // urettigi taslak da). Taslak govdede GONDERILMEZ — sunucu kendi verisinden
  // uretir; SubmitKnowledgeDto fazla alani (draft) 400 ile reddeder.
  submitKnowledge: (siteId: string, target: 'wikidata' | 'wikipedia', lang?: 'tr' | 'en') =>
    request<{
      ok: boolean;
      /** true: gonderim yapilmadi, elle ekleme yonergesi */
      manual?: boolean;
      warning?: string;
      /** Elle ekleme sayfasi (Wikidata Special:NewItem / Vikipedi rehberi) */
      createUrl?: string;
      /** Yalniz wikidata: sunucuda sitenin verisinden uretilen taslak */
      draft?: Record<string, unknown>;
      error?: string;
    }>(`/sites/${siteId}/audit/knowledge/submit`, {
      method: 'POST',
      body: JSON.stringify({ target, lang }),
    }),

  findCommunity: (siteId: string, limit = 10) =>
    request<any[]>(`/sites/${siteId}/audit/community/find`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  suggestCrossLinks: (siteId: string, articleId: string, limit = 5) =>
    request<any[]>(`/sites/${siteId}/audit/cross-link/suggest`, {
      method: 'POST',
      body: JSON.stringify({ articleId, limit }),
    }),

  applyCrossLink: (siteId: string, suggestion: any) =>
    request<any>(`/sites/${siteId}/audit/cross-link/apply`, {
      method: 'POST',
      body: JSON.stringify({ suggestion }),
    }),

  getTrainingDataMetadata: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/training-data`),

  getTrainingDataDownloadUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/training-data.jsonl`;
  },

  ingestCrawlerLog: (siteId: string, logContent: string) =>
    request<any>(`/sites/${siteId}/audit/crawler/ingest`, {
      method: 'POST',
      body: JSON.stringify({ logContent }),
    }),

  getCrawlerHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/crawler/history?days=${days}`),

  getGeoScoreCard: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/score-card`),

  validateSchema: (siteId: string, url: string) =>
    request<any>(`/sites/${siteId}/audit/schema-validate`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  getTrackerEmbedUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/tracker.js?site=${siteId}`;
  },

  getAiSitemapUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/audit/sitemap-ai.xml`;
  },

  getAuthorProfile: (siteId: string, persona: string) =>
    request<any>(`/sites/${siteId}/audit/author-profile?persona=${encodeURIComponent(persona)}`),

  parseHaroDigest: (siteId: string, emailContent: string) =>
    request<any[]>(`/sites/${siteId}/audit/haro/parse`, {
      method: 'POST',
      body: JSON.stringify({ emailContent }),
    }),

  generateProgrammaticCities: (siteId: string, payload: { template: string; cities?: string[]; spreadDays?: number; maxQuota?: number }) =>
    request<any>(`/sites/${siteId}/articles/programmatic/cities`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAiReferrerHistory: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/audit/ai-referrer/history?days=${days}`),

  getWidgetEmbedUrl: (siteId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/widget.js?site=${siteId}`;
  },



  // Faz 11 — Ads Manager
  listAdCampaigns: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/ads/campaigns${status ? `?status=${status}` : ''}`),

  // buildAudience / buildAdCopy / buildAdImages / buildCampaign silindi:
  // ads/audience, ads/copy, ads/images ve ads/build uclari 0db5a1c'de API'den
  // kalkti (ads.controller.ts); kampanya sihirbazi da panelden kaldirildi,
  // cagiran yok.

  launchCampaign: (siteId: string, campaignId: string) =>
    request<any>(`/sites/${siteId}/ads/${campaignId}/launch`, { method: 'POST' }),

  pauseCampaign: (siteId: string, campaignId: string) =>
    request<any>(`/sites/${siteId}/ads/${campaignId}/pause`, { method: 'POST' }),

  // Faz 11.2 — Direkt API entegrasyonu (Ryze AI MCP kaldırıldı)
  getAdsConnections: (siteId: string) =>
    request<{ google: boolean; meta: boolean }>(`/sites/${siteId}/ads/connections`),

  connectGoogleAds: (siteId: string, payload: { customerId?: string; refreshToken?: string }) =>
    request<any>(`/sites/${siteId}/ads/google-ads`, { method: 'PATCH', body: JSON.stringify(payload) }),

  connectMetaAds: (siteId: string, payload: { accountId?: string; accessToken?: string; pageId?: string; instagramActorId?: string }) =>
    request<any>(`/sites/${siteId}/ads/meta-ads`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Baglanti kesme DELETE ile: suresi dolan deneme (salt okunur) de kesebilsin (api trial-expiry.guard.ts)
  disconnectGoogleAds: (siteId: string) =>
    request<any>(`/sites/${siteId}/ads/google-ads`, { method: 'DELETE' }),

  disconnectMetaAds: (siteId: string) =>
    request<any>(`/sites/${siteId}/ads/meta-ads`, { method: 'DELETE' }),

  updateAdsSettings: (siteId: string, payload: { adsAutopilot?: boolean }) =>
    request<any>(`/sites/${siteId}/ads/settings`, { method: 'PATCH', body: JSON.stringify(payload) }),

  // Faz 12 — Ads Audit (Kampanya Skoru, claude-ads port'u)
  runAdsAudit: (siteId: string, platform: 'google' | 'meta' = 'google', industry: string = 'saas') =>
    request<any>(`/sites/${siteId}/ads/audit/run-now?platform=${platform}&industry=${industry}`, { method: 'POST' }),

  getLatestAdsAudit: (siteId: string, platform: 'google' | 'meta' = 'google') =>
    request<any>(`/sites/${siteId}/ads/audit/latest?platform=${platform}`),

  // Faz 11.5 — OAuth popup flow
  getOAuthStartUrl: (provider: 'google-ads' | 'meta-ads', siteId: string) =>
    request<{ url: string }>(`/oauth/${provider}/start?siteId=${siteId}`),

  getOAuthOptions: (provider: 'google-ads' | 'meta-ads', siteId: string) =>
    request<any>(`/oauth/${provider}/options?siteId=${siteId}`),

  selectOAuthAccount: (provider: 'google-ads' | 'meta-ads', siteId: string, body: any) =>
    request<any>(`/oauth/${provider}/select?siteId=${siteId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Reports
  getReport: (siteId: string, range: 'week' | 'month' | 'year' = 'month') =>
    request<any>(`/sites/${siteId}/analytics/report?range=${range}`),

  getReportCsvUrl: (siteId: string, range: 'week' | 'month' | 'year' = 'month') => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/analytics/report.csv?range=${range}`;
  },

  // ── Kalici rapor (dondurulmus) ───────────────────────────────────
  // Canli hesaplanan getReport'tan farki: sonuc URETILDIGI ANDA saklanir ve
  // bir daha degismez. Altindaki kaynaklar degistigi icin (reklam metrikleri
  // cron ile uzerine yaziliyor, crawler kayitlari temizleniyor, aylik kotalar
  // sifirlaniyor) canli hesap ayni donem icin zamanla FARKLI sayi doner.

  /** Raporu uretir ve kaydeder. Donem: range VEYA from+to. */
  runReport: (siteId: string, donem: { range?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (donem.from && donem.to) { q.set('from', donem.from); q.set('to', donem.to); }
    else q.set('range', donem.range ?? 'month');
    return request<RaporKaydi>(`/sites/${siteId}/analytics/reports/run?${q.toString()}`, { method: 'POST' });
  },

  /** Gecmis — dondurulmus govde HARIC (liste satiri basina yuzlerce KB olurdu) */
  getReportHistory: (siteId: string, limit = 30) =>
    request<RaporKaydi[]>(`/sites/${siteId}/analytics/reports?limit=${limit}`),

  /** Tek rapor — dondurulmus tam govde ile */
  getReportById: (siteId: string, reportId: string) =>
    request<RaporKaydi & { data: any }>(`/sites/${siteId}/analytics/reports/${reportId}`),

  // ── Musteri raporu (Site Raporu) ─────────────────────────────────
  // Kayitli son olcumlerden tek govde — yeni tarama / AI sorgusu KOSMAZ.

  getClientReport: (siteId: string) =>
    request<MusteriRaporu>(`/sites/${siteId}/client-report`),

  listClientReportShares: (siteId: string) =>
    request<PaylasimOzeti[]>(`/sites/${siteId}/client-report/shares`),

  /** Raporun o anki halini dondurur ve herkese acik baglanti uretir (gun: 1-90) */
  createClientReportShare: (siteId: string, gun: number) =>
    request<PaylasimOzeti>(`/sites/${siteId}/client-report/shares`, { method: 'POST', body: JSON.stringify({ gun }) }),

  revokeClientReportShare: (siteId: string, token: string) =>
    request<{ ok: true }>(`/sites/${siteId}/client-report/shares/${encodeURIComponent(token)}`, { method: 'DELETE' }),

  /** Herkese acik paylasim — oturum gerekmez; TARAYICIDAN cagrilir (hiz siniri ziyaretci IP'sine) */
  getSharedClientReport: (token: string) =>
    request<PaylasilanRapor>(`/public/rapor/${encodeURIComponent(token)}`),

  deleteReport: (siteId: string, reportId: string) =>
    request<{ id: string }>(`/sites/${siteId}/analytics/reports/${reportId}`, { method: 'DELETE' }),

  getReportByIdCsvUrl: (siteId: string, reportId: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    return `${apiBase}/api/sites/${siteId}/analytics/reports/${reportId}/csv`;
  },

  getArticle: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}`),

  // ── RanksUp Video (makale, site ve urun tanitim videolari; api videos/videos.controller.ts) ──
  listVideos: (siteId: string) => request<ArticleVideo[]>(`/sites/${siteId}/videos`),
  getVideoQuota: (siteId: string) => request<VideoQuota>(`/sites/${siteId}/videos/quota`),
  /** Ad / renk / logo onizlemesi — Profesyonel ve ustu (alt planda 403; panel cagirmaz) */
  getVideoBrand: (siteId: string) => request<VideoBrandPreview>(`/sites/${siteId}/videos/brand`),
  requestVideo: (siteId: string, body: VideoRequestBody) =>
    request<{ video: ArticleVideo; remaining: number; limit: number }>(`/sites/${siteId}/videos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteVideo: (siteId: string, videoId: string) =>
    request<{ ok: true; refunded: boolean }>(`/sites/${siteId}/videos/${videoId}`, { method: 'DELETE' }),

  // Async queue (placeholder Article = GENERATING + worker job).
  // F5 yenilense bile Article DB'de inflight kalır → progress UI persist eder.
  generateArticle: (siteId: string, topic: string) =>
    request<any>(`/sites/${siteId}/articles/generate`, {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }),

  /**
   * Yayini KUYRUGA atar (articles.service queuePublish → JobQueueService.enqueue).
   * Sonuc is kaydinda: getJob(dbJobId).result = hedef bazinda PublishResult[]
   * (lib/publish-result.ts); yayin dugmeleri bunu yoklayip gosterir.
   *
   * targetIds (sozlesme D1): bos olmayan liste AYNEN uygulanir — yazinin yayinda oldugu
   * ama listede olmayan hedefe yazilmaz (sonucta 'live_target_not_selected'). Bos liste:
   * yazi sitede yayindaysa yazinin YAYINDA oldugu aktif hedefler, degilse varsayilan +
   * aktif hedef (lib/publish-targets.ts).
   * overwriteRemoteEdits (paylasilan sozlesme C1): yalniz kullanici, yayincinin
   * 'live_entry_edited' dedigi WordPress yazisi icin onay penceresinde "Uzerine yaz"
   * dediginde true. Govdeye yalniz true iken eklenir: alan DTO'da yokken (eski API,
   * forbidNonWhitelisted) siradan yayinlar 400 almasin. Otomasyon bunu hic gondermez.
   */
  publishArticle: (siteId: string, articleId: string, targetIds: string[], overrideQa?: boolean, overwriteRemoteEdits?: boolean) =>
    request<{ dbJobId: string; bullJobId?: string | number }>(`/sites/${siteId}/articles/${articleId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ targetIds, overrideQa, ...(overwriteRemoteEdits === true ? { overwriteRemoteEdits: true } : {}) }),
    }),

  /**
   * Musteri guncel metni hedefin kendi paneline elle yapistirdi: kaydin
   * manualUpdatePending isareti kalkar. Kayit yoksa 404.
   */
  markPublishedEntryUpdated: (siteId: string, articleId: string, targetId: string) =>
    request<PublishedEntryMutation>(
      `/sites/${siteId}/articles/${articleId}/published-to/${encodeURIComponent(targetId)}/mark-updated`,
      { method: 'POST' },
    ),

  /**
   * Musteri yaziyi o hedefte sildi: kayit publishedTo'dan cikar, o hedefe sonraki
   * yayin YENI kayit acar. Eski yazi hedefte duruyorsa kopya olusur; panel bunu
   * onay penceresinde soyler. Kayit yoksa 404.
   */
  forgetPublishedEntry: (siteId: string, articleId: string, targetId: string) =>
    request<PublishedEntryMutation>(
      `/sites/${siteId}/articles/${articleId}/published-to/${encodeURIComponent(targetId)}/forget`,
      { method: 'POST' },
    ),

  runArticleQaCheck: (siteId: string, articleId: string) =>
    request<{
      status: 'PASS' | 'WARN' | 'BLOCKED';
      blockers: Array<{ type: string; detail: string; excerpt?: string }>;
      warnings: Array<{ type: string; detail: string; excerpt?: string }>;
      stats: { wordCount: number; llmUsed: boolean };
      checkedAt: string;
    }>(`/sites/${siteId}/articles/${articleId}/qa-check`, { method: 'POST' }),

  // SCHEDULED article'ı şimdi üretime al (cron'u bekleme).
  triggerArticleNow: (siteId: string, articleId: string) =>
    request<any>(`/sites/${siteId}/articles/${articleId}/trigger-now`, {
      method: 'POST',
    }),

  // Publish Targets
  getPublishTargetsCatalog: () => request<any[]>('/publish-targets/catalog'),
  listPublishTargets: (siteId: string) => request<any[]>(`/sites/${siteId}/publish-targets`),
  createPublishTarget: (siteId: string, body: any) =>
    request<any>(`/sites/${siteId}/publish-targets`, { method: 'POST', body: JSON.stringify(body) }),
  updatePublishTarget: (id: string, body: any) =>
    request<any>(`/publish-targets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePublishTarget: (id: string) =>
    request<any>(`/publish-targets/${id}`, { method: 'DELETE' }),
  testPublishTarget: (id: string) =>
    request<any>(`/publish-targets/${id}/test`, { method: 'POST' }),

  // Admin
  getAdminOverview: () => request<any>('/admin/overview'),
  getAdminUsers: () => request<any[]>('/admin/users'),
  getAdminInvoices: (status?: string) =>
    request<any[]>(`/admin/invoices${status ? `?status=${status}` : ''}`),
  getAdminSites: () => request<any[]>('/admin/sites'),
  getAdminFailedJobs: () => request<any[]>('/admin/jobs/failed'),
  getAdminCitationLeads: (params: { limit?: number; offset?: number; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.search) qs.set('search', params.search);
    const q = qs.toString();
    return request<{
      items: Array<{
        id: string; domain: string; brand: string; niche: string | null;
        source: string; ip: string | null; totalCalls: number; costUsd: number;
        createdAt: string; citedScore: number; maxScore: number; queriesCount: number; totalProviders: number;
      }>;
      total: number; today: number; uniqueDomains: number;
    }>(`/admin/citation-leads${q ? `?${q}` : ''}`);
  },

  // Faz 12 — LLM Spend (LibreChat tx pattern)
  getAdminSpend: (days = 30) =>
    request<{
      totalUsd: number;
      byProvider: Record<string, number>;
      byContext: Record<string, number>;
      byDate: Record<string, number>;
      requestCount: number;
    }>(`/admin/spend?days=${days}`),

  getSiteSpend: (siteId: string, days = 30) =>
    request<{
      totalUsd: number;
      byProvider: Record<string, number>;
      byContext: Record<string, number>;
      byDate: Record<string, number>;
      requestCount: number;
    }>(`/sites/${siteId}/spend?days=${days}`),

  // Admin Queue Monitor (BullMQ)
  adminQueueStats: () => request<{ counts: Record<string, number>; paused: boolean }>('/admin/queue/stats'),
  adminQueueJobs: (state: string, limit = 50) =>
    request<any[]>(`/admin/queue/jobs?state=${state}&limit=${limit}`),
  adminQueueRetryJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }),
  adminQueuePromoteJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/promote`, { method: 'POST' }),
  adminQueueRemoveJob: (jobId: string) =>
    request<{ ok: boolean }>(`/admin/queue/jobs/${encodeURIComponent(jobId)}/remove`, { method: 'POST' }),
  adminQueuePause: () => request<{ ok: boolean; paused: boolean }>('/admin/queue/pause', { method: 'POST' }),
  adminQueueResume: () => request<{ ok: boolean; paused: boolean }>('/admin/queue/resume', { method: 'POST' }),
  sendAdminEmailTest: (body: { to: string; template?: string; name?: string }) =>
    request<{ ok: boolean; resendId?: string; mode: string; template: string; to: string }>(
      '/admin/email-test',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Admin -> Settings (runtime ayar yönetimi)
  getAdminSettings: () => request<any[]>('/admin/settings'),
  getAdminSettingsGrouped: () => request<Record<string, any[]>>('/admin/settings?grouped=1'),
  updateAdminSetting: (key: string, value: string | number | boolean) =>
    request<{ key: string; value: string; unchanged: boolean; oldValue?: string }>(
      `/admin/settings/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    ),
  getAdminSettingsAudit: (limit = 100) =>
    request<any[]>(`/admin/settings/audit?limit=${limit}`),
  getAdminSettingAudit: (key: string) =>
    request<any[]>(`/admin/settings/${encodeURIComponent(key)}/audit`),

  // Intel -> LinkedIn outreach (admin). Uclar apps/api/src/intel altinda;
  // tick'i normalde worker atar, buradaki tick elle tetikleme icindir.
  getLinkedinOverview: () => request<LinkedinOverview>('/intel/linkedin/overview'),
  /**
   * Tek istekte en fazla ~400 satir gonderin (lib/linkedin-import.ts runImportBatches):
   * API JSON govdesini 100 KB ve 10.000 oge ile sinirlar; butun liste tek istekte ~575
   * satirdan sonra 413 alir. Sunucu profileUrl ile upsert eder (yeniden deneme guvenli).
   */
  importLinkedinProspects: (rows: LinkedinImportRow[]) =>
    request<{ upserted: number; skipped?: number }>('/intel/linkedin/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  /** Gonderimi panelden ac/kapat (kalici) */
  setLinkedinEnabled: (enabled: boolean) =>
    request<{ enabled: boolean; kaynak?: string }>('/intel/linkedin/enabled', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  /** Fren ve calisma saati ayarlarini kaydet */
  setLinkedinAyarlar: (ayarlar: Record<string, number | number[] | string>) =>
    request<{ ayarlar: Record<string, number | number[]>; limits: Record<string, number | number[]> }>('/intel/linkedin/ayarlar', {
      method: 'POST',
      body: JSON.stringify(ayarlar),
    }),
  pauseLinkedin: (reason?: string) =>
    request<{ ok?: boolean; paused?: boolean; pauseReason?: string | null }>('/intel/linkedin/pause', {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  resumeLinkedin: () =>
    request<{ ok?: boolean; paused?: boolean }>('/intel/linkedin/resume', { method: 'POST' }),
  tickLinkedin: (opts: { dryRun: boolean; force?: boolean }) =>
    request<LinkedinTickResult>('/intel/linkedin/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: opts.dryRun, force: opts.force === true }),
    }),
  /** Kullanicinin yapistirdigi LinkedIn arama linklerini tara (gonderim yok) */
  researchLinkedinUrls: (opts: { urls: string; kampanya?: LinkedinKampanya; sektor?: string | null; dryRun?: boolean; sayfa?: number }) =>
    request<{
      started: boolean;
      urls: number;
      gecersiz: string[];
      reason?: string;
      ok?: boolean;
      sonuclar?: Array<{ url: string; sayfa?: number; aday: number; yeni: number; elenen: number; firmasiz: number; hata?: string }>;
    }>('/intel/linkedin/research-urls', {
      method: 'POST',
      body: JSON.stringify({ urls: opts.urls, kampanya: opts.kampanya, sektor: opts.sektor ?? null, dryRun: opts.dryRun === true, sayfa: opts.sayfa }),
    }),
  setLinkedinKampanya: (ids: string[], kampanya: LinkedinKampanya) =>
    request<{ updated: number }>('/intel/linkedin/prospects/kampanya', {
      method: 'POST',
      body: JSON.stringify({ ids, kampanya }),
    }),
  /** Cevap sonrasi satis asamasi / not / hatirlatma */
  setLinkedinSatis: (id: string, veri: { asama?: LinkedinSatisAsamasi; not?: string | null; hatirlatmaAt?: string | null }) =>
    request<{ ok: boolean }>(`/intel/linkedin/prospects/${encodeURIComponent(id)}/satis`, {
      method: 'POST',
      body: JSON.stringify(veri),
    }),
  /** Bu aday icin ucretsiz karne uret (arka planda; bitince bildirim) */
  uretLinkedinKarne: (id: string, opts: { host: string; sektor?: string; altsektor?: string; rakipler?: string[] }) =>
    request<{ started: boolean; reason?: string }>(`/intel/linkedin/prospects/${encodeURIComponent(id)}/karne`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  /** Bu adaya uretilmis karneler (link + goruntulenme) */
  getLinkedinKarneler: (id: string) =>
    request<Array<{ id: string; token: string; url: string; host: string; gorulmeSayisi: number; sonGorulmeAt: string | null; createdAt: string }>>(
      `/intel/linkedin/prospects/${encodeURIComponent(id)}/karneler`,
    ),
  skipLinkedinProspect: (id: string) =>
    request<{ ok?: boolean; status?: LinkedinProspectStatus }>(
      `/intel/linkedin/prospects/${encodeURIComponent(id)}/skip`,
      { method: 'POST' },
    ),

  // Me (login olmuş kullanıcı)
  getMe: () => request<any>('/me'),
  getMyDashboard: () => request<MyDashboard>('/me/dashboard'),

  // Billing
  /**
   * Plan listesi + o an kullanilan kur.
   * Fiyat USD kanonik (`monthly`/`annual`); TL karsiligi gunun TCMB kuruyla
   * hesaplanip `monthlyTry`/`annualTry` alanlarinda gelir.
   */
  getPlans: (locale?: string) =>
    request<{
      plans: Array<{
        id: string; name: string;
        monthly: number; annual: number; currency: 'USD';
        monthlyTry: number; annualTry: number;
        articlesPerMonth: number;
        sites: number; aiRunsPerMonth: number; aiProviders: number;
        publishTargets: string; support: string;
        /** Kart maddeleri — tek kaynak apps/api/src/billing/plans.ts */
        features: string[];
        /** "Buyume'deki her sey, arti:" — kok planda undefined */
        inheritsLabel?: string;
        popular?: boolean; contactSales?: boolean;
      }>;
      fx: { rate: number; fetchedAt: string; source: 'TCMB' | 'fallback'; stale: boolean };
      /** Satin alma acik mi (test modunda kapali; metin locale'e gore). Eski API'de yok */
      checkout?: CheckoutAvailability;
    }>(`/billing/plans${locale ? '?locale=' + locale : ''}`),
  // enterpriseInquiry / getCurrentFxRate silindi: billing/enterprise-inquiry ve
  // billing/fx-rate uclari API'de yok (Kurumsal iletisim mailto; kur /billing/plans
  // yanitindaki fx alaninda), cagiran yoktu.

  // Analytics
  getAnalyticsOverview: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/analytics/overview?days=${days}`),

  getTopArticles: (siteId: string, limit = 10) =>
    request<any[]>(`/sites/${siteId}/analytics/top-articles?limit=${limit}`),

  getTrendingQueries: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/analytics/trending`),

  getImprovementSuggestions: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/analytics/suggestions`),

  // Google AI yuzeyi — GSC Generative AI raporu (CSV import) + AI-Mode-suphesi sorgular
  previewGscAiCsv: (siteId: string, csv: string) =>
    request<any>(`/sites/${siteId}/analytics/gsc-ai-csv/preview`, { method: 'POST', body: JSON.stringify({ csv }) }),
  importGscAiCsv: (siteId: string, csv: string, fileName?: string) =>
    request<any>(`/sites/${siteId}/analytics/gsc-ai-csv`, { method: 'POST', body: JSON.stringify({ csv, fileName }) }),
  getGscAiSeries: (siteId: string, days = 90) =>
    request<any>(`/sites/${siteId}/analytics/gsc-ai-series?days=${days}`),
  getAiModeQueries: (siteId: string, days = 28) =>
    request<any>(`/sites/${siteId}/analytics/ai-mode-queries?days=${days}`),

  triggerSnapshotNow: (siteId: string) =>
    request<any>(`/sites/${siteId}/analytics/snapshot-now`, { method: 'POST' }),

  getGaSummary: (siteId: string, days = 30) =>
    request<any>(`/sites/${siteId}/analytics/ga-summary?days=${days}`),

  /** Telefon tiklamasi ve form/randevu gonderimi GA4'te onemli etkinlik olarak olculuyor mu */
  getGaKeyEvents: (siteId: string, days = 28) =>
    request<GaKeyEventSetup>(`/sites/${siteId}/analytics/ga-key-events?days=${days}`),

  /** GSC 4–20. sira × GA4 organik acilis sayfalari — skor yok, bilesen kolonlu siralama */
  getSearchOpportunities: (siteId: string, limit = 50) =>
    request<any>(`/sites/${siteId}/analytics/search-opportunities?limit=${limit}`),

  // GSC OAuth
  getGscAuthUrl: (siteId: string) =>
    request<{ url: string }>(`/auth/gsc/start?siteId=${encodeURIComponent(siteId)}`),

  disconnectGsc: (siteId: string) =>
    request<{ ok: boolean }>(`/auth/gsc/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ siteId }),
    }),

  listGscProperties: (siteId: string) =>
    request<Array<{ siteUrl: string; permissionLevel: string | null }>>(
      `/sites/${siteId}/gsc/properties`,
    ),

  setGscProperty: (siteId: string, propertyUrl: string) =>
    request<{ siteUrl: string }>(`/sites/${siteId}/gsc/property`, {
      method: 'PATCH',
      body: JSON.stringify({ propertyUrl }),
    }),

  // GA4 OAuth
  getGaAuthUrl: (siteId: string) =>
    request<{ url: string }>(`/auth/ga/start?siteId=${encodeURIComponent(siteId)}`),

  disconnectGa: (siteId: string) =>
    request<{ ok: boolean }>(`/auth/ga/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ siteId }),
    }),

  listGaProperties: (siteId: string) =>
    request<Array<{ propertyId: string; displayName: string; accountName: string }>>(
      `/sites/${siteId}/ga/properties`,
    ),

  setGaProperty: (siteId: string, propertyId: string) =>
    request<{ propertyId: string; displayName: string; accountName: string }>(
      `/sites/${siteId}/ga/property`,
      {
        method: 'PATCH',
        body: JSON.stringify({ propertyId }),
      },
    ),

  // Competitors (brain)
  listCompetitors: (siteId: string) =>
    request<Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>>(
      `/sites/${siteId}/competitors`,
    ),

  setCompetitors: (
    siteId: string,
    competitors: Array<{ name: string; url: string; strengths?: string[]; weaknesses?: string[] }>,
  ) =>
    request<typeof competitors>(`/sites/${siteId}/competitors`, {
      method: 'PUT',
      body: JSON.stringify({ competitors }),
    }),

  // Sosyal modul istemcisi (LinkedIn sayfasi, medya politikasi, onay akisi,
  // gelen kutusu, medya kutuphanesi, fikir panosu) silindi: API'de 'social'
  // denetleyicisi yok (modul 0db5a1c'de kalkti), hicbir bilesen cagirmiyordu.

  // Notifications
  listNotifications: (params: { unreadOnly?: boolean; type?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.unreadOnly) q.set('unread', '1');
    if (params.type) q.set('type', params.type);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const tail = q.toString() ? `?${q.toString()}` : '';
    return request<Array<any>>(`/notifications${tail}`);
  },
  notificationsUnreadCount: () => request<number>('/notifications/unread-count'),
  markNotificationRead: (id: string) => request<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<number>('/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────────────
  // Video Factory (Faz 12)
  // ──────────────────────────────────────────────────────────────────






  // ──────────────────────────────────────────────────────────────────
  // ASO Health (claude-code-aso-skill port) — score gauge + competitors
  // ──────────────────────────────────────────────────────────────────

  asoCalculateScore: (
    siteId: string,
    appId: string,
    body: {
      targetKeywords?: string[];
      keywordPerformance?: { top_10?: number; top_50?: number; top_100?: number; improving_keywords?: number };
      conversion?: { impression_to_install?: number; downloads_last_30_days?: number; downloads_trend?: 'up' | 'stable' | 'down' };
    } = {},
  ) =>
    request<{
      appId: string;
      appName: string;
      computedAt: string;
      overall_score: number;
      grade: 'A' | 'B' | 'C' | 'D' | 'F';
      breakdown: Record<string, { score: number; weight: number; weighted_contribution: number; notes?: string[] }>;
      recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low'; action: string; details: string; expected_impact: string }>;
      strengths: string[];
      weaknesses: string[];
      /** Skorun dayandigi sinyaller (apps/api aso.controller.ts calculateScore). Eski API'de yok. */
      signals?: AsoScoreSignals;
    }>(`/sites/${siteId}/aso/apps/${appId}/score`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  asoListCompetitors: (siteId: string, category: string, country = 'tr', limit = 10) =>
    request<{
      category: string;
      country: string;
      count: number;
      results: Array<{
        app_id?: number;
        app_name?: string;
        developer?: string;
        category?: string;
        rating: number;
        ratings_count: number;
        description: string;
        icon_url?: string;
        app_store_url?: string;
        price: string;
        screenshots: string[];
      }>;
    }>(`/sites/${siteId}/aso/competitors?category=${encodeURIComponent(category)}&country=${country}&limit=${limit}`),

  asoCompareCompetitors: (siteId: string, names: string[], country = 'tr') =>
    request<{
      country: string;
      count: number;
      results: Array<any>;
    }>(`/sites/${siteId}/aso/competitors/compare`, {
      method: 'POST',
      body: JSON.stringify({ names, country }),
    }),

  // ──────────────────────────────────────────────────────────────────
  // Studio — multi-modal AI content (image / video / text) — DB-backed
  // ──────────────────────────────────────────────────────────────────







  // ─── ASO Faz 1 — Apple Search Ads ──────────────────────

  connectAsa: (siteId: string, body: { orgId: string; keyId: string; privateKeyPem: string; teamId?: string }) =>
    request<{ id: string; orgId: string; status: 'created' | 'updated' }>(
      `/sites/${siteId}/aso/asa/connect`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listAsaAccounts: (siteId: string) =>
    request<Array<{
      id: string; orgId: string; keyId: string; teamId: string | null;
      isActive: boolean; lastSyncAt: string | null; lastError: string | null; createdAt: string;
      _count: { campaigns: number };
    }>>(`/sites/${siteId}/aso/asa/accounts`),

  disconnectAsa: (accountId: string) =>
    request<{ ok: boolean }>(`/aso/asa/accounts/${accountId}`, { method: 'DELETE' }),

  syncAsaCampaigns: (accountId: string) =>
    request<{ synced: number; removed?: number }>(`/aso/asa/accounts/${accountId}/sync`, { method: 'POST' }),

  listAsaCampaigns: (siteId: string) =>
    request<Array<{
      id: string; asaCampaignId: string; name: string; budget: number; status: string;
      countriesOrRegions: string[]; supplySources: string[]; appAdamId: string | null;
      createdAt: string;
      account: { id: string; orgId: string };
      _count: { adGroups: number };
    }>>(`/sites/${siteId}/aso/asa/campaigns`),

  /** AI ile yeni kampanya önerisi (form pre-fill için) */
  suggestAsaCampaign: (siteId: string) =>
    request<{
      name: string;
      dailyBudgetUsd: number;
      countries: string[];
      appleAppId: number;
      bidUsd: number;
      keywords: string[];
      meta: { keywordCount: number; country: string; appName: string };
    }>(`/sites/${siteId}/aso/asa/suggest`),

  /** Auto-Pilot toggle + budget cap */
  setAsaAutoPilot: (accountId: string, body: { enabled: boolean; budgetCapUsd?: number | null }) =>
    request<{ id: string; autoPilotEnabled: boolean; autoPilotBudgetCap: number | null }>(
      `/aso/asa/accounts/${accountId}/autopilot`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  /** Auto-Pilot manual run */
  runAsaAutoPilot: (accountId: string) =>
    request<{ added: string[]; paused: string[]; skipped: string[]; reason?: string }>(
      `/aso/asa/accounts/${accountId}/autopilot/run`,
      { method: 'POST' },
    ),

  createAsaCampaign: (body: {
    accountId: string;
    name: string;
    dailyBudgetUsd: number;
    countries: string[];
    appleAppId: number;
    keywords?: Array<{ text: string; bidUsd: number; matchType?: 'EXACT' | 'BROAD' }>;
  }) =>
    // warnings: eklenemeyen anahtar kelimeler / reklam adimi (asa.service.ts) — kampanya yine olusur
    request<{ campaignId: string; asaCampaignId: string; warnings?: string[] }>(`/aso/asa/campaigns`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAsaKeywordBid: (keywordBidId: string, bidUsd: number) =>
    request<any>(`/aso/asa/keyword-bids/${keywordBidId}`, {
      method: 'PUT',
      body: JSON.stringify({ bidUsd }),
    }),

  getAsaPerformance: (siteId: string, daysBack = 30) =>
    request<{
      daysBack: number;
      totals: {
        impressions: number; taps: number; installs: number; spendUsd: number;
        avgCpt: number; avgCpa: number; ttr: number; conversionRate: number;
      };
      dailyRows: Array<{
        id: string; date: string; impressions: number; taps: number; installs: number;
        spendUsd: number; avgCpt: number | null; avgCpa: number | null;
        campaign: { name: string; asaCampaignId: string };
      }>;
    }>(`/sites/${siteId}/aso/asa/performance?daysBack=${daysBack}`),

  // ──────────────────────────────────────────────────────────
  //  AGENT READINESS (AXO)
  // ──────────────────────────────────────────────────────────
  getAgentReadiness: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/agent-readiness/latest`),

  runAgentReadiness: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/agent-readiness/run`, { method: 'POST' }),

  /** score: erişim engelli/ulaşılamaz taramada null; scoreVersion metodoloji değişimini işaretler */
  getAgentReadinessHistory: (siteId: string, days = 90) =>
    request<Array<{ date: string; score: number | null; status?: string; scoreVersion?: number; agentsAllowed: number | null; agentsTotal: number | null }>>(
      `/sites/${siteId}/audit/agent-readiness/history?days=${days}`,
    ),

  // ──────────────────────────────────────────────────────────
  //  CONTENT OPPORTUNITIES (kapalı döngü)
  // ──────────────────────────────────────────────────────────
  listOpportunities: (siteId: string, opts: { status?: string; coverage?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.coverage) qs.set('coverage', opts.coverage);
    return request<any[]>(`/sites/${siteId}/audit/opportunities${qs.size ? `?${qs}` : ''}`);
  },

  deriveOpportunities: (siteId: string) =>
    request<{ created: number; updated: number; scanned: number }>(
      `/sites/${siteId}/audit/opportunities/derive`, { method: 'POST' },
    ),

  updateOpportunity: (siteId: string, id: string, status: string) =>
    request<any>(`/sites/${siteId}/audit/opportunities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  generateFromOpportunity: (siteId: string, id: string) =>
    request<{ opportunityId: string; articleId: string; jobId: string }>(
      `/sites/${siteId}/audit/opportunities/${id}/generate`, { method: 'POST' },
    ),

  remeasureOpportunity: (siteId: string, id: string) =>
    request<any>(`/sites/${siteId}/audit/opportunities/${id}/remeasure`, { method: 'POST' }),

  // ──────────────────────────────────────────────────────────
  //  AI KPI ŞERİDİ + PRODUCT RADAR + COMMUNITY
  // ──────────────────────────────────────────────────────────
  getAiKpis: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/ai-kpis`),

  getProductRadar: (siteId: string) =>
    request<any>(`/sites/${siteId}/audit/product-radar`),

  runProductRadar: (siteId: string) =>
    request<{ snapshots: number; queries: string[] }>(
      `/sites/${siteId}/audit/product-radar/run`, { method: 'POST' },
    ),

  listCommunityOpportunities: (siteId: string, status?: string) =>
    request<any[]>(`/sites/${siteId}/audit/community${status ? `?status=${status}` : ''}`),

  scanCommunity: (siteId: string, limit?: number) =>
    request<{ found: number; created: number }>(`/sites/${siteId}/audit/community/scan`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),

  updateCommunityOpportunity: (siteId: string, id: string, body: { status?: string; draftReply?: string }) =>
    request<any>(`/sites/${siteId}/audit/community/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCommunityOpportunity: (siteId: string, id: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/audit/community/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────
  //  LIVE CRAWLER
  // ──────────────────────────────────────────────────────────
  getLiveCrawler: (siteId: string, minutes = 10, limit = 50) =>
    request<{
      windowMinutes: number;
      workerConnected: boolean;
      lastEventAt: string | null;
      lastEventSource: string | null;
      total: number;
      byBot: Array<{ bot: string; hits: number }>;
      events: Array<{ id: string; ts: string; bot: string; path: string; status: number; isCiteFetch: boolean; source: string }>;
      citeFetches24h: Array<{ ts: string; bot: string; path: string }>;
    }>(`/sites/${siteId}/audit/live-crawler?minutes=${minutes}&limit=${limit}`),

  // ingestSecret snippet'lerin icine gomulu gelir; ekranda "bu kod gizli" uyarisi
  // gosterebilmek icin tipte de acikca duruyor.
  getLiveCrawlerSnippets: (siteId: string) =>
    request<{ ingestUrl: string; ingestSecret: string; cloudflareWorker: string; wordpress: string; nginx: string }>(
      `/sites/${siteId}/audit/live-crawler/snippets`,
    ),

  // Sir yenilenince eski snippet'lerin imzasi aninda gecersiz olur; cagiran
  // taraf snippet'leri yeniden cekip kullaniciya kurulum uyarisini gostermeli.
  rotateIngestSecret: (siteId: string) =>
    request<{ secret: string; warning: string }>(
      `/sites/${siteId}/audit/live-crawler/rotate-secret`, { method: 'POST' },
    ),

  // ──────────────────────────────────────────────────────────
  //  ACTION PLAN
  // ──────────────────────────────────────────────────────────
  listActionPlan: (siteId: string, opts: { status?: string; source?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.source) qs.set('source', opts.source);
    return request<any[]>(`/sites/${siteId}/action-plan${qs.size ? `?${qs}` : ''}`);
  },

  getActionPlanCounts: (siteId: string) =>
    request<{ todo: number; inProgress: number; done: number }>(`/sites/${siteId}/action-plan/counts`),

  addActionPlanItem: (siteId: string, body: {
    title: string; description?: string; source?: string; sourceRef?: string;
    impact?: string; effort?: string; dueAt?: string;
  }) =>
    request<any>(`/sites/${siteId}/action-plan`, { method: 'POST', body: JSON.stringify(body) }),

  updateActionPlanItem: (siteId: string, id: string, body: any) =>
    request<any>(`/sites/${siteId}/action-plan/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteActionPlanItem: (siteId: string, id: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/action-plan/${id}`, { method: 'DELETE' }),

  // ──────────────────────────────────────────────────────────
  //  CHAT + SKILLS
  // ──────────────────────────────────────────────────────────
  listChatSkills: (siteId: string) =>
    request<Array<{
      key: string; name: string; tag: string; description: string;
      accesses: string[]; needsInput?: boolean; inputPlaceholder?: string;
    }>>(`/sites/${siteId}/chat/skills`),

  listChatConversations: (siteId: string) =>
    request<any[]>(`/sites/${siteId}/chat/conversations`),

  getChatConversation: (siteId: string, conversationId: string) =>
    request<any>(`/sites/${siteId}/chat/conversations/${conversationId}`),

  deleteChatConversation: (siteId: string, conversationId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/chat/conversations/${conversationId}`, { method: 'DELETE' }),

  sendChatMessage: (siteId: string, body: { conversationId?: string; message?: string; skill?: string }) =>
    request<{
      conversationId: string;
      message: { id: string; role: string; content: string; toolCalls: any[]; createdAt: string };
      costUsd: number;
    }>(`/sites/${siteId}/chat/messages`, { method: 'POST', body: JSON.stringify(body) }),

  // ──────────────────────────────────────────────────────────
  //  APP PROMPT LAB (ASO ⨉ GEO)
  // ──────────────────────────────────────────────────────────
  listAppPrompts: (siteId: string, appId: string) =>
    request<any[]>(`/sites/${siteId}/aso/apps/${appId}/prompts`),

  addAppPrompt: (siteId: string, appId: string, text: string) =>
    request<any>(`/sites/${siteId}/aso/apps/${appId}/prompts`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  suggestAppPrompts: (siteId: string, appId: string) =>
    request<{ suggested: string[]; created: number }>(
      `/sites/${siteId}/aso/apps/${appId}/prompts/suggest`, { method: 'POST' },
    ),

  runAppPrompt: (siteId: string, appId: string, promptId: string) =>
    request<any>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}/run`, { method: 'POST' }),

  deleteAppPrompt: (siteId: string, appId: string, promptId: string) =>
    request<{ ok: boolean }>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}`, { method: 'DELETE' }),

  getAppPromptHistory: (siteId: string, appId: string, promptId: string, days = 30) =>
    request<any[]>(`/sites/${siteId}/aso/apps/${appId}/prompts/${promptId}/history?days=${days}`),

  buildReviewContentPack: (siteId: string, appId: string) =>
    request<{
      appId: string; appName: string;
      basedOn: { negativeCount: number; themes: Array<{ theme: string; count: number }> };
      whatsNew: string;
      /** What's New taslaktir: hangi duzeltmenin yayinlandigini yalniz gelistirici bilir */
      whatsNewNote: string;
      /** Politika bekcisinin What's New metninden cikardigi / isaretledigi ifadeler (metadata-guard.ts) */
      whatsNewIssues: Array<{ field: string; code: string; action: 'removed' | 'flagged'; excerpt: string; message: string; source: string }>;
      faqs: Array<{ q: string; a: string }>;
      blogTopics: Array<{ title: string; opportunityId: string | null }>;
    }>(`/sites/${siteId}/aso/apps/${appId}/review-content-pack`, { method: 'POST' }),

  // ──────────────────────────────────────────────────────────
  //  PUBLIC — anonim landing checker (auth yok)
  // ──────────────────────────────────────────────────────────
  publicCitationCheck: (domain: string, turnstileToken?: string) =>
    request<{
      domain: string;
      brand: string;
      niche: string;
      customNiche?: string;
      queries: Array<{
        query: string;
        category?: string;
        /** true = soru listelendi ama olculmedi; providers BOS gelir. */
        locked?: boolean;
        providers: Array<{
          provider: string;
          label: string;
          /**
           * false = saglayici bu soruda hata verdi ('HATA: ...'); citedCount ve
           * totalProviders'a girmez, arayuz notr "olculemedi" cizer. Calismayan
           * saglayici hic satir olarak gelmez (public-citation.service.ts).
           * Bu alandan once yazilmis yanitta yok.
           */
          measured?: boolean;
          cited: boolean;
          brandMentioned: boolean;
          excerpt?: string;
        }>;
        /** Yalniz measured satirlardan */
        citedCount: number;
        totalProviders: number;
        /** Sorunun kendisinde marka adi geciyor — anilma totolojik, skor disi */
        brandInQuery?: boolean;
      }>;
      competitorRanking: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>;
      totalLlmCalls: number;
      fromCache: boolean;
      cachedAt?: string;
      access?: {
        tier: 'anon' | 'member';
        unlockedQueries: number;
        totalQueries: number;
        lockedQueries: number;
      };
      /** Bu olcumun PublicCitationCheck kaydi (taze sonucta, yazildiysa) */
      checkId?: string;
      /**
       * Olcum yontemi surumu (CITATION_MATCH_VERSION). Onbellekten donen eski
       * kayitta yok (v3 ya da daha eski); farkli surumlu iki sonuc kiyaslanmaz.
       */
      matchVersion?: number;
    }>('/public/citation-check', {
      method: 'POST',
      body: JSON.stringify({ domain, turnstileToken }),
    }),

  /**
   * Teaser kilidini acar — GIRIS + ODENMIS PLAN gerekir. Odememis kullaniciya
   * 402 doner; cagiran taraf bunu satis ekranina cevirir.
   */
  publicCitationUnlock: (domain: string) =>
    request<Awaited<ReturnType<typeof api.publicCitationCheck>>>('/public/citation-check/unlock', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),

  publicCitationRateLimit: () =>
    request<{ ok: boolean; remaining: number; resetIn?: string }>('/public/citation-check/rate-limit', {
      method: 'POST',
    }),
};

// ──────────────────────────────────────────────────────────
//  KÖK DOSYA DÜZELTMELERİ (önizlemeli) — robots.txt / sitemap.xml / llms.txt
// ──────────────────────────────────────────────────────────
export type AutoFixAction = 'merge' | 'create' | 'regenerate' | 'none' | 'refuse';

export interface AutoFixPreview {
  fix: string;
  canonical: 'robots' | 'sitemap' | 'llms';
  filename: string;
  url: string;
  action: AutoFixAction;
  canApply: boolean;
  reason: string;
  notes: string[];
  current: { exists: boolean; status: number | null; content: string | null };
  proposed: string | null;
  diff: Array<{ op: 'same' | 'add' | 'del'; text: string }>;
  stats: { added: number; removed: number };
  previewToken: string | null;
  target: { name: string | null; type: string } | null;
}

export interface AutoFixHistoryItem {
  id: string;
  fix: string;
  filename: string;
  status: 'APPLIED' | 'FAILED' | 'REVERTED' | string;
  action: AutoFixAction | null;
  verified: boolean | null;
  error: string | null;
  url: string | null;
  appliedAt: string;
  revertedAt: string | null;
  revertible: boolean;
  revertNote: string | null;
}

/**
 * auto-fix-now hata kodlari (apps/api audit/auto-fix.service.ts runAutoFix):
 *  preview_required — robots.txt onizleme + acik onay olmadan yazilmaz
 *  preview_stale    — dosya ya da oneri onizlemeden sonra degisti
 *  preview_expired  — onizleme anahtarinin suresi doldu / bulunamadi
 *  refused          — canli dosya guvenle okunamadi ya da uzerine yazilmaz
 *  wrong_root       — kok klasor kaniti: dogrulama dosyasi (ranksup-verify.txt)
 *                     yuklendi ama sitenin adresinde gorunmedi; yayin hedefinin
 *                     klasoru bu siteyi sunmuyor (eklenti alan adi vb.). HICBIR
 *                     kok dosya yazilmadi (baska sitenin dosyasi ezilmesin diye)
 *  root_unverified  — dogrulama dosyasinin adresi okunamadi (engel / zaman asimi);
 *                     klasor kanitlanamadi, kok dosya yazilmadi
 *  write_failed     — yayin hedefine yukleme basarisiz (dogrulama dosyasi dahil)
 *  no_file_target   — dosya yazabilen hedef (SFTP / FTP / cPanel) yok
 *  error            — beklenmeyen hata
 */
export type AutoFixErrorCode =
  | 'preview_required' | 'preview_stale' | 'preview_expired'
  | 'refused' | 'wrong_root' | 'root_unverified' | 'write_failed' | 'no_file_target' | 'error';

/**
 * Hata kodunun Turkce karsiligi — YALNIZ API metin dondurmediginde (bos ya da
 * yer tutucu 'unknown': runAutoFix `error: w.error ?? 'unknown'`). API metni
 * varsa o, oldugu gibi gosterilir (daha ayrintili: adres, denenen klasorler).
 */
export const AUTO_FIX_ERROR_TEXT: Record<AutoFixErrorCode, string> = {
  preview_required: 'robots.txt yalnız önizleme ve açık onayla yazılır.',
  preview_stale: 'Dosya önizlemeden sonra değişti; yeniden önizleyin.',
  preview_expired: 'Önizlemenin süresi doldu ya da bulunamadı; yeniden önizleyin.',
  refused: 'Sitedeki dosya güvenle okunamadı ya da üzerine yazılmaz; dosya yazılmadı.',
  wrong_root: 'Yayın hedefinin yazdığı klasör bu siteyi sunmuyor: doğrulama dosyası sitenin adresinde görünmedi. Başka bir sitenin dosyasının üzerine yazmamak için kök dosya yazılmadı.',
  root_unverified: 'Yayın hedefinin bu siteyi sunduğu doğrulanamadı: doğrulama dosyasının adresi okunamadı. Kök dosya yazılmadı.',
  write_failed: 'Dosya yayın hedefine yüklenemedi.',
  no_file_target: 'Dosya yazabilen bir yayın hedefi yok (SFTP / FTP / cPanel).',
  error: 'Beklenmeyen bir hata oluştu; dosya yazılmadı.',
};

/** Hatanin gosterilecek metni: API'ninki, yoksa kodun karsiligi */
export function autoFixErrorText(e: { error?: string | null; code?: string | null }): string {
  const t = typeof e.error === 'string' ? e.error.trim() : '';
  if (t && t !== 'unknown') return t;
  return (e.code && (AUTO_FIX_ERROR_TEXT as Record<string, string>)[e.code]) || 'Düzeltme uygulanmadı (ayrıntı dönmedi).';
}

/** POST /sites/:id/audit/auto-fix-now cevabi — eski API surumlerinde bazi alanlar yok */
export interface AutoFixNowResult {
  /**
   * Yayin hedefine YUKLENEN duzeltmeler — canli adreste dogrulanamayanlar dahil.
   * Sitede gorundugu kesin olanlar: files[].verified === true (autoFixMessages verified).
   */
  applied?: string[];
  errors?: Array<{ fix: string; error: string; code?: AutoFixErrorCode | (string & {}) }>;
  /** Degisiklik gerekmedi (dosya zaten uygun) — hata degil */
  unchanged?: Array<{ fix: string; reason: string }>;
  /** Otomatik uretilemeyen anahtarlar (snippet / elle duzeltilenler) */
  unsupported?: string[];
  skipped?: string[];
  /** verified: yazimdan sonra canli adres yeniden okundu ve icerik birebir ayni */
  files?: Array<{ fix: string; filename: string; content: string; externalUrl?: string; verified?: boolean; action?: AutoFixAction }>;
  /** Yuklendi ama canli adreste henuz gorunmuyor (onbellek / CDN) — duz basari degil; reason Turkce */
  unverified?: Array<{ fix: string; filename: string; url: string; reason: string }>;
  reason?: 'nothing-auto-fixable' | 'no-publish-target' | 'no-file-target' | (string & {});
}

// ──────────────────────────────────────────────────────────
//  KOK DOSYA DUZELTMESI — panel kurallari (saf yardimcilar)
// ──────────────────────────────────────────────────────────

/**
 * robots.txt toplu "otomatik duzelt"e girmez: API yalniz onizleme + acik onayla
 * yazar (aksi halde 'preview_required'). Panel bunun yerine AutoFixPreviewDialog acar.
 */
export function isRobotsFixKey(key: string | null | undefined): boolean {
  return key === 'robots' || key === 'robots_txt';
}

/**
 * Kok dosya (robots.txt / sitemap.xml / llms.txt) yazabilen yayin hedefi turleri:
 * packages/adapters'ta supportsRootFiles=true olanlar (ftp.ts, sftp.ts,
 * cpanel-api.ts). WordPress REST kok dosya yazamaz; auto-fix bu durumda
 * 'no_file_target' doner (auto-fix.service.ts pickRootFileTarget).
 */
export const ROOT_FILE_TARGET_TYPES: ReadonlySet<string> = new Set(['FTP', 'SFTP', 'CPANEL_API']);

/** Aktif ve kok dosya yazabilen hedef — varsayilan once (sunucudaki secimle ayni kural) */
export function rootFileTarget<T extends { type?: string | null; isActive?: boolean | null; isDefault?: boolean | null }>(
  targets: T[] | null | undefined,
): T | null {
  const capable = (targets ?? []).filter((t) => !!t?.isActive && ROOT_FILE_TARGET_TYPES.has(String(t.type)));
  return capable.find((t) => !!t.isDefault) ?? capable[0] ?? null;
}

/** Kontrol dogrulanamadi mi (checks[id].details.unverified — dosyaya erisim engellendi / sunucu hatasi) */
export function isUnverifiedCheck(audit: any, checkId: string | null | undefined): boolean {
  return !!checkId && audit?.checks?.[checkId]?.details?.unverified === true;
}

/**
 * Otomatik kok dosya duzeltmesi onerilebilecek sorunlar (fixRoute 'auto_fix').
 * Dogrulanamayan kontrolde oneri YOK: okuyamadigimiz bir dosyanin yerine
 * uretilmis dosya yazmak musterinin kendi dosyasini silmek olurdu. Yeni
 * taramalarda API bu sorunlari zaten uretmiyor; eski kayitlar icin panel de suzer.
 */
export function autoFixIssues(audit: any): any[] {
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  return issues.filter((i) => i?.fixRoute === 'auto_fix' && !isUnverifiedCheck(audit, i?.checkId));
}

/**
 * auto-fix-now sonucunu gosterilecek satirlara cevirir — GERCEK hata metinleriyle
 * (eskiden yalniz "N duzeltme basarisiz" deniyordu). Ayni metni tasiyan
 * duzeltmeler tek satirda birlesir (or. no_file_target her dosya icin ayni).
 *
 * DOGRULAMA: `applied` yayin hedefine yuklenen her duzeltmedir. API yazimdan
 * sonra canli adresi yeniden okur; icerik gorunmuyorsa (onbellek / CDN) dosya
 * files[].verified=false ve unverified listesinde doner (auto-fix.service.ts
 * runAutoFix). Toplu bildirimler eskiden bunu okumuyor, dogrulanmamis yazimi
 * duz "uygulandi" diye gosteriyordu. Artik:
 *  - verified: yalniz files[].verified === true olanlar (kanit yoksa iddia yok)
 *  - unverified: yuklendi ama sitede dogrulanamadi — API'nin Turkce nedeniyle
 * Onizleme diyalogu (auto-fix-preview-dialog.tsx) ayni kurali files[0].verified ile uygular.
 */
export function autoFixMessages(result: AutoFixNowResult | null | undefined, label: (fix: string) => string = (f) => f) {
  const group = (items: Array<{ fix: string; text: string }>) => {
    const byText = new Map<string, string[]>();
    for (const it of items) {
      const name = label(it.fix);
      const prev = byText.get(it.text) ?? [];
      if (!prev.includes(name)) prev.push(name);
      byText.set(it.text, prev);
    }
    return [...byText].map(([text, names]) => `${names.join(', ')}: ${text}`);
  };
  const errors = Array.isArray(result?.errors) ? result!.errors : [];
  const unchanged = Array.isArray(result?.unchanged) ? result!.unchanged : [];
  const applied = Array.isArray(result?.applied) ? result!.applied : [];
  const files = Array.isArray(result?.files) ? result!.files : [];
  const unverifiedList = Array.isArray(result?.unverified) ? result!.unverified : [];
  const verified = applied.filter(
    (fix) => files.some((f) => f?.fix === fix && f.verified === true) && !unverifiedList.some((u) => u?.fix === fix),
  );
  const unverifiedFixes = applied.filter((fix) => !verified.includes(fix));
  // API nedeni dosya adini ve adresi zaten soyler; yoksa dosya adiyla genel metin
  const unverified = [...new Set(unverifiedFixes.map((fix) => {
    const reason = unverifiedList.find((u) => u?.fix === fix)?.reason?.trim();
    const filename = files.find((f) => f?.fix === fix)?.filename ?? label(fix);
    return reason || `${filename} yüklendi ama sitede görünüp görünmediği doğrulanamadı.`;
  }))];
  return {
    /** Yuklenen tum duzeltmeler (dogrulanmayanlar dahil) — eski alan */
    applied,
    /** Yuklenip canli adreste birebir okunan duzeltmeler */
    verified,
    /** Yuklendi ama sitede dogrulanamadi */
    unverifiedFixes,
    /** unverifiedFixes'in Turkce nedenleri (tekil) */
    unverified,
    errors: group(errors.map((e) => ({ fix: e.fix, text: autoFixErrorText(e) }))),
    unchanged: group(unchanged.map((u) => ({ fix: u.fix, text: u.reason }))),
    unsupported: Array.isArray(result?.unsupported) ? result!.unsupported : [],
    previewRequired: errors.some((e) => e.code === 'preview_required'),
  };
}

// ──────────────────────────────────────────────────────────
//  GEO TARAMASI ERISIM ENGELI — audit.checks.geo (geo-runner.service.ts)
// ──────────────────────────────────────────────────────────

/** GEO orneklemi guvenlik duvarina / bot dogrulamasina takildi: skor VERILMEDI */
export interface GeoAccessBlock {
  kind: string;
  vendor: string | null;
  status: number;
  /** Kullaniciya gosterilecek Turkce neden (block-detect.ts) */
  reason: string;
  /** Site sahibinin yapmasi gereken (RanksUpBot'a izin) */
  hint: string;
  url: string;
}

/** GEO skorunun dayandigi orneklem: olculen sayfa sayisi ve engel yuzunden disarida kalanlar */
export interface GeoSample {
  measured: number;
  blocked: number;
}

/** audit.checks.geo → erisim engeli + orneklem. Eski taramalarda ikisi de null. */
export function geoAccessOf(audit: any): { blocked: GeoAccessBlock | null; sample: GeoSample | null } {
  const geo = audit?.checks?.geo;
  const b = geo?.blocked;
  const s = geo?.sample;
  return {
    blocked: b && typeof b.reason === 'string' ? (b as GeoAccessBlock) : null,
    sample: s && Number.isFinite(s.measured) && Number.isFinite(s.blocked) ? { measured: s.measured, blocked: s.blocked } : null,
  };
}

/** Orneklemin bir kismi engele takildiysa skorun yanina not; takilmadiysa (ya da skor hic yoksa) null */
export function geoSampleNote(sample: GeoSample | null | undefined): string | null {
  if (!sample || !(sample.blocked > 0) || !(sample.measured > 0)) return null;
  return `${sample.blocked} sayfa erişim engeline takıldı; skor ${sample.measured} sayfadan hesaplandı.`;
}

/**
 * Rapor govdesindeki GEO erisim alanlari: canli rapor (getReport) `audit` ve dondurulmus
 * raporun `seo.audit` bolumu — reports.service.ts bunlari raporun kendi son taramasindan
 * (lastAudit.checks.geo) doldurur. Eski API'de alanlar HIC yoktur (undefined); yeni API'de
 * engel / orneklem yoksa null. undefined'da panel son taramaya (site context) duser.
 */
export interface ReportAuditGeo {
  geoScore?: number | null;
  geoBlocked?: GeoAccessBlock | null;
  geoSample?: GeoSample | null;
}

/**
 * Rapor gövdesindeki tarama erişimi (reports.service.ts overview → audit). Bu taramadan
 * SONRAKİ deneme siteye erişemediyse API skorları null döner; eski değer yalnız tarihiyle
 * `sonBasarili`da. Bu alanlardan önce dondurulmuş raporlarda hiçbiri yok (undefined).
 */
export interface ReportAuditAccess {
  overallScore?: number | null;
  /** Son başarılı taramanın zamanı (ISO) */
  ranAt?: string | null;
  /** web lib/crawl-access.ts CrawlAccess ile aynı şekil — currentCrawlAccess(x, null) ile doğrula */
  accessBlocked?: unknown;
  sonBasarili?: { ranAt: string; overallScore: number; geoScore: number | null } | null;
  olculemeyenSayisi?: number;
}

// ──────────────────────────────────────────────────────────
//  TARAMADAKİ AI ÖLÇÜMÜ — audit.checks.aiCitations (audit.service.ts runAudit)
// ──────────────────────────────────────────────────────────

/** AI adımı atlandıysa nedeni (haftalık ölçüm hakkı, kota, sağlayıcı yok) */
export interface AiCitationSkip {
  code: string;
  /** Kullanıcıya gösterilecek Türkçe açıklama (API) */
  message: string;
  /** Haftalık hak doluysa bir sonraki ölçümün açılacağı an (ISO) */
  nextAvailableAt: string | null;
}

export interface AiCitationState {
  /** true = en az bir asistan sayısal skor döndürdü; skor gerçek bir ölçüm */
  measured: boolean;
  score: number | null;
  /** Skor döndüren (available + sayısal skor) asistan sayısı */
  measuredProviders: number;
  skipped: AiCitationSkip | null;
}

/**
 * audit.checks.aiCitations → ölçüm durumu. API kuralı (audit.service.ts aiCitationsOlculdu) ile
 * aynı: atlanmış (`skipped`) ya da hiçbir asistanın skor döndürmediği kayıt ölçüm DEĞİLDİR.
 * Eski taramalar bu durumda `score: 0, providers: []` yazıyordu — 0/100 diye gösterilmez.
 * Girdi yoksa null.
 */
export function aiCitationOf(audit: any): AiCitationState | null {
  const e = audit?.checks?.aiCitations;
  if (!e || typeof e !== 'object') return null;
  const providers: any[] = Array.isArray(e.providers) ? e.providers : [];
  const measuredProviders = providers.filter((p) => p?.available === true && typeof p?.score === 'number').length;
  const s = e.skipped;
  const skipped: AiCitationSkip | null = s && typeof s === 'object' && typeof s.message === 'string'
    ? { code: String(s.code ?? ''), message: s.message, nextAvailableAt: typeof s.nextAvailableAt === 'string' ? s.nextAvailableAt : null }
    : null;
  const scoreOk = typeof e.score === 'number' && Number.isFinite(e.score);
  const measured = !skipped && scoreOk && measuredProviders > 0;
  return { measured, score: measured ? e.score : null, measuredProviders, skipped };
}

const AI_SKIP_DATE_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * Ölçülmeyen AI adımının kısa açıklaması — "Ölçülmedi: haftalık ölçüm hakkı kullanıldı
 * (sonraki: 25 Ekim 14:05)". Neden bilinmiyorsa (eski kayıt) genel cümle.
 */
export function aiCitationSkipLabel(state: AiCitationState | null | undefined): string {
  const skip = state?.skipped;
  if (skip?.code === 'WEEKLY_MEASUREMENT_LIMIT') {
    const next = skip.nextAvailableAt ? Date.parse(skip.nextAvailableAt) : NaN;
    return `Ölçülmedi: haftalık ölçüm hakkı kullanıldı${Number.isFinite(next) ? ` (sonraki: ${AI_SKIP_DATE_FMT.format(new Date(next))})` : ''}`;
  }
  if (skip?.message) return `Ölçülmedi: ${skip.message}`;
  return 'Ölçülmedi: bu taramada hiçbir AI asistanından skor alınamadı.';
}

// ──────────────────────────────────────────────────────────
//  TOPLU SNIPPET TARAMASI — snippet-generator.service.ts bulkScan
// ──────────────────────────────────────────────────────────

/** Toplu taramada tek sayfanin SEO durumu */
export interface BulkScanPage {
  url: string;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1: string | null;
  hasCanonical: boolean;
  hasOG: boolean;
  hasTwitter: boolean;
  hasSchema: boolean;
  hasFAQ: boolean;
  score: number;
  issues: string[];
  /** Erisim engeli (WAF / bot dogrulamasi): skor olculmedi, ortalamaya girmez. Eski API'de yok. */
  blocked?: boolean;
  /** Sayfa okunamadi (indirilemedi): skor olculmedi, ortalamaya ve "Sorunlu"ya girmez. Eski API'de yok. */
  failed?: boolean;
  /** failed ise kullaniciya gosterilecek neden */
  failReason?: string;
}

export interface BulkScanResult {
  pages: BulkScanPage[];
  totalScanned: number;
  /** Yalniz gercekten okunan sayfalarin ortalamasi (engelli ve okunamayan sayfalar haric) */
  averageScore: number;
  /** Engel yuzunden olculemeyen sayfa sayisi. Eski API'de yok. */
  blockedPages?: number;
  /** Okunamayan sayfa sayisi. Eski API'de yok. */
  failedPages?: number;
}

// ──────────────────────────────────────────────────────────
//  ASO SKOR SINYALLERI (apps/api aso.controller.ts calculateScore)
// ──────────────────────────────────────────────────────────
export type AsoStoreId = 'IOS' | 'ANDROID';

/**
 * Son 30 gundeki yorum sayisi (apps/api aso/recent-reviews.ts RecentReviewSignal).
 * Bilinmiyorsa API bu alt bileseni skora katmaz, sifir saymaz. Ayrimli birlesim
 * (status) bilerek: aso/_components/score.ts HealthResult bu tipi kabul eder.
 */
export type AsoRecentReviewSignal =
  | {
      status: 'known';
      count: number;
      /** true → gercek sayi bundan fazla olabilir ("en az N") */
      lowerBound: boolean;
      windowDays: number;
      stores: AsoStoreId[];
      /** Bagli ama verisi bilinmeyen magazalar (sayiya dahil degil) */
      missingStores: AsoStoreId[];
      /**
       * Son cekimi RECENT_REVIEW_FRESH_HOURS'tan eski magazalar: sayilari alt
       * sinir (apps/api aso/recent-reviews.ts). Eski API yanitinda yok.
       */
      staleStores?: AsoStoreId[];
      lastFetchAt: string;
      label: string;
    }
  | { status: 'unknown'; windowDays: number; reason: string; label: string };

export interface AsoScoreSignals {
  recentReviews30d: AsoRecentReviewSignal;
  /** App Store'da aciklama yogunlugu skora girmez (densityCounted=false) */
  metadataStores: Array<{ store: AsoStoreId; keywordDensity: number | null; densityCounted: boolean }>;
}
