/**
 * LinkedIn outreach botu — SAF kurallar (DB/tarayici/LLM yok).
 *
 * NEDEN AYRI DOSYA: frenler, saat penceresi, tick planlama, engel tespiti,
 * sablon doldurma ve snapshot ref bulma tarayici olmadan test edilmeli
 * (linkedin-outreach.spec.ts). Servis (linkedin-outreach.service.ts) yalnizca
 * orkestrasyon yapar: burada verilen plani OpenClaw komutlariyla uygular.
 *
 * FREN FELSEFESI: sabitler KODDA; env ile yalniz ASAGI cekilebilir (yukari
 * cikarma yok — hesap kisitlanma riski). Bkz. plan Faz 8 ve
 * docs/OPENCLAW-KURULUM.md §11.3.
 */

// ─── Frenler ────────────────────────────────────────────────────────────────

export interface OutreachLimits {
  MAX_REQUESTS_PER_DAY: number;
  MAX_MESSAGES_PER_DAY: number;
  MAX_REQUESTS_PER_WEEK: number;
  MAX_RESEARCH_PER_DAY: number;
  MAX_ACTIONS_PER_TICK: number;
  SAME_COMPANY_PER_DAY: number;
  CONSECUTIVE_FAIL_PAUSE: number;
  /**
   * OLGUNLASMIS kabul orani bunun altina duserse duraklat. Olgun istek =
   * requestedAt [simdi-14g, simdi-72sa] araliginda (bkz. acceptRateWindow).
   * NEDEN: dun atilan 20 istegin kabulu daha gelmemisken oran %0 gorunur ve
   * fren 2. gunde kendini kilitlerdi (Devam → yine duraklar). 72 saat gecmemis
   * istek sayilmaz; 14 gunden eskisi de artik sinyal degil.
   */
  ACCEPT_RATE_MIN: number;
  /** En az bu kadar OLGUN istek yoksa oran hesaplanmaz */
  ACCEPT_RATE_MIN_REQUESTS: number;
  /** Her tick'te kac REQUESTED profil kabul icin kontrol edilir */
  ACCEPT_CHECK_PER_TICK: number;
  /** Calisma penceresi — Europe/Istanbul, hafta ici, [START, END) */
  WORK_HOUR_START: number;
  WORK_HOUR_END: number;
}

export const DEFAULT_LIMITS: Readonly<OutreachLimits> = Object.freeze({
  MAX_REQUESTS_PER_DAY: 20,
  MAX_MESSAGES_PER_DAY: 15,
  MAX_REQUESTS_PER_WEEK: 80,
  MAX_RESEARCH_PER_DAY: 50,
  MAX_ACTIONS_PER_TICK: 3,
  SAME_COMPANY_PER_DAY: 2,
  CONSECUTIVE_FAIL_PAUSE: 3,
  ACCEPT_RATE_MIN: 0.15,
  ACCEPT_RATE_MIN_REQUESTS: 20,
  ACCEPT_CHECK_PER_TICK: 5,
  WORK_HOUR_START: 9,
  WORK_HOUR_END: 18,
});

export const WORK_TIMEZONE = 'Europe/Istanbul';

/** Kabul orani penceresi: istek en az bu kadar saat once atilmis olmali (olgunlasma) */
export const ACCEPT_RATE_MATURE_HOURS = 72;
/** Kabul orani penceresi: bundan eski istekler sayilmaz */
export const ACCEPT_RATE_WINDOW_DAYS = 14;

/** env'de LINKEDIN_<AD> varsa ve KUCUKSE onu kullan; buyuk/gecersiz deger yok sayilir */
const ENV_LOWERABLE: Array<keyof OutreachLimits> = [
  'MAX_REQUESTS_PER_DAY', 'MAX_MESSAGES_PER_DAY', 'MAX_REQUESTS_PER_WEEK', 'MAX_RESEARCH_PER_DAY',
  'MAX_ACTIONS_PER_TICK', 'SAME_COMPANY_PER_DAY', 'CONSECUTIVE_FAIL_PAUSE', 'ACCEPT_CHECK_PER_TICK',
];

/**
 * Env ile frenleri yalniz ASAGI cek. LINKEDIN_MAX_REQUESTS_PER_DAY=10 gibi.
 * ACCEPT_RATE_MIN icin LINKEDIN_ACCEPT_RATE_MIN yalniz YUKARI (daha sikı) alinir.
 *
 * ALT SINIR: her deger en az 1'e kirpilir. NEDEN: CONSECUTIVE_FAIL_PAUSE=0
 * "0 hata >= 0" ile her tick'te aninda duraklatirdi; SAME_COMPANY_PER_DAY=0
 * hic istek atilmamasi gibi sessiz felclere yol acardi. Tek istisna
 * MAX_ACTIONS_PER_TICK=0: bilincli OLDURME ANAHTARI — tick plan uretmez,
 * "Yapılacak iş yok" doner, tarayiciya dokunulmaz.
 */
export function resolveLimits(env: Record<string, string | undefined> = process.env): OutreachLimits {
  const out: OutreachLimits = { ...DEFAULT_LIMITS };
  for (const key of ENV_LOWERABLE) {
    const raw = env[`LINKEDIN_${key}`];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    const floor = key === 'MAX_ACTIONS_PER_TICK' ? 0 : 1;
    const v = Math.max(floor, Math.floor(n));
    if (v < out[key]) out[key] = v;
  }
  const rate = Number(env.LINKEDIN_ACCEPT_RATE_MIN);
  if (Number.isFinite(rate) && rate > out.ACCEPT_RATE_MIN && rate <= 1) out.ACCEPT_RATE_MIN = rate;
  return out;
}

// ─── Zaman ──────────────────────────────────────────────────────────────────

/** Verilen ani Istanbul saatine gore { weekday: 0-6 (0=Pazar), hour, ymd } olarak cozer */
export function istanbulParts(date: Date): { weekday: number; hour: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: WORK_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Bazi ICU surumleri saat 24'u "24" basar (gece yarisi) — 0'a cek
  const hour = Number(parts.hour) % 24;
  return { weekday: days.indexOf(parts.weekday), hour, ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Istanbul gununun baslangici (UTC ani). Turkiye 2016'dan beri sabit UTC+3, yaz saati yok. */
export function istanbulDayStart(date: Date = new Date()): Date {
  const { ymd } = istanbulParts(date);
  return new Date(`${ymd}T00:00:00+03:00`);
}

/** Hafta ici 09:00-18:00 Europe/Istanbul mu? */
export function isWorkWindow(date: Date = new Date(), limits: OutreachLimits = DEFAULT_LIMITS): boolean {
  const { weekday, hour } = istanbulParts(date);
  if (weekday === 0 || weekday === 6) return false;
  return hour >= limits.WORK_HOUR_START && hour < limits.WORK_HOUR_END;
}

/**
 * Kabul orani icin OLGUN istek penceresi: requestedAt ∈ [from, to].
 * from = simdi - 14 gun, to = simdi - 72 saat. Dunku istekler disarida kalir
 * (kabul daha gelmemis olabilir), 2 haftadan eskiler de sayilmaz.
 */
export function acceptRateWindow(now: Date = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - ACCEPT_RATE_WINDOW_DAYS * 86_400_000),
    to: new Date(now.getTime() - ACCEPT_RATE_MATURE_HOURS * 3_600_000),
  };
}

/** Bu istek kabul orani hesabina girer mi (olgunlasmis ve pencere icinde)? */
export function isMaturedRequest(requestedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!requestedAt) return false;
  const { from, to } = acceptRateWindow(now);
  const t = requestedAt.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Islemler arasi bekleme: 2-6 dk rastgele (insan temposu) */
export function delayBetweenActionsMs(rand: () => number = Math.random): number {
  return Math.round((2 + rand() * 4) * 60_000);
}

/** Profilde "okuma" suresi: 8-20 sn */
export function profileReadDelayMs(rand: () => number = Math.random): number {
  return Math.round((8 + rand() * 12) * 1_000);
}

// ─── Tick plani ─────────────────────────────────────────────────────────────

export interface TickCounters {
  requestsToday: number;
  messagesToday: number;
  requestsWeek: number;
  researchToday: number;
  /** firmaKey(firma) → bugun o firmaya gonderilen istek sayisi */
  companyRequestsToday: Record<string, number>;
}

export interface QueueProspect {
  id: string;
  firma: string;
}

export interface TickQueue {
  /** ACCEPTED — mesaj bekleyenler (eski kabul once) */
  accepted: QueueProspect[];
  /** REQUESTED — kabul kontrolu bekleyenler (eski istek once) */
  requested: QueueProspect[];
  /** QUEUED — istek bekleyenler (eklenme sirasi) */
  queued: QueueProspect[];
  /** MESSAGED kayit sayisi — 0 ise cevap kontrolune gerek yok */
  messagedCount: number;
  /** Arastirma hedefleri (firma adlari) — yalniz opsiyon verilirse dolu */
  researchTargets?: string[];
}

export type PlannedAction =
  | { type: 'reply-check' }
  | { type: 'message'; prospectId: string }
  | { type: 'accept-check'; prospectIds: string[] }
  | { type: 'request'; prospectId: string }
  | { type: 'research'; firma: string };

/** Ayni firmanin farkli yazimlarini (A.S., buyuk/kucuk, Grup) tek anahtara indirger */
const FIRMA_STOP = new Set(['a', 'ş', 's', 'aş', 'as', 'anonim', 'şirketi', 'şirket', 'ltd', 'şti', 'sti', 'holding', 'grup', 'group', 'inc', 'co', 't', 'taş', 'tas']);
export function firmaKey(firma: string): string {
  return firma
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t && !FIRMA_STOP.has(t))
    .join(' ');
}

/**
 * Tick'te yapilacak islemler — oncelik sirasi:
 *   1) reply-check (MESSAGED varsa; cevap gelen kisiye bir daha yazilmasin)
 *   2) message (ACCEPTED; gunluk mesaj siniri)
 *   3) accept-check (en fazla 5 REQUESTED, tek islem)
 *   4) request (QUEUED; gunluk/haftalik istek siniri, ayni firmadan gunde <=2)
 *   5) research (yalniz hedef verilmisse; gunluk arastirma siniri)
 * Toplam islem MAX_ACTIONS_PER_TICK ile sinirli.
 */
export function planTick(counters: TickCounters, queue: TickQueue, limits: OutreachLimits = DEFAULT_LIMITS): PlannedAction[] {
  const out: PlannedAction[] = [];
  const full = () => out.length >= limits.MAX_ACTIONS_PER_TICK;

  if (queue.messagedCount > 0 && !full()) out.push({ type: 'reply-check' });

  let messages = counters.messagesToday;
  for (const p of queue.accepted) {
    if (full() || messages >= limits.MAX_MESSAGES_PER_DAY) break;
    out.push({ type: 'message', prospectId: p.id });
    messages++;
  }

  if (!full() && queue.requested.length > 0) {
    out.push({ type: 'accept-check', prospectIds: queue.requested.slice(0, limits.ACCEPT_CHECK_PER_TICK).map((p) => p.id) });
  }

  let day = counters.requestsToday;
  let week = counters.requestsWeek;
  const company: Record<string, number> = { ...counters.companyRequestsToday };
  for (const p of queue.queued) {
    if (full() || day >= limits.MAX_REQUESTS_PER_DAY || week >= limits.MAX_REQUESTS_PER_WEEK) break;
    const key = firmaKey(p.firma);
    if ((company[key] ?? 0) >= limits.SAME_COMPANY_PER_DAY) continue;
    out.push({ type: 'request', prospectId: p.id });
    company[key] = (company[key] ?? 0) + 1;
    day++;
    week++;
  }

  let research = counters.researchToday;
  for (const firma of queue.researchTargets ?? []) {
    if (full() || research >= limits.MAX_RESEARCH_PER_DAY) break;
    out.push({ type: 'research', firma });
    research++;
  }

  return out;
}

// ─── Engel tespiti ──────────────────────────────────────────────────────────

export type BlockKind = 'weekly-limit' | 'captcha' | 'verification' | 'login-wall';

export interface BlockResult {
  blocked: boolean;
  kind?: BlockKind;
  match?: string;
}

const WEEKLY_LIMIT_RE = /Şimdi bağlanamazsınız|haftalık davet sınırı|You(?:'|’)?ve reached the weekly invitation limit|weekly invitation limit|davet sınırına ulaştınız/iu;

/** Sayfa GOVDESININ basinda / basliginda aranan engel kaliplari */
const BLOCK_PATTERNS: Array<{ kind: BlockKind; re: RegExp }> = [
  { kind: 'weekly-limit', re: WEEKLY_LIMIT_RE },
  { kind: 'captcha', re: /captcha|robot olmadığınızı|verify you(?:'|’)?re (?:a )?human/iu },
  { kind: 'verification', re: /Güvenlik doğrulaması|Security verification|quick security check|hızlı bir güvenlik kontrolü|Doğrulama kodu|Verification code/iu },
  // Giris duvari: kelime sinirlari Unicode'a gore (\b Turkce harfle calismaz)
  { kind: 'login-wall', re: /(?:^|[^\p{L}])(Oturum aç|Sign in|Join now|Hemen katıl|Giriş yap)(?![\p{L}])/u },
];

/** URL'den engel: checkpoint (dogrulama/captcha), authwall / login (giris duvari) */
const BLOCK_URL_PATTERNS: Array<{ kind: BlockKind; re: RegExp }> = [
  { kind: 'verification', re: /\/checkpoint\//i },
  { kind: 'login-wall', re: /\/authwall(?:[/?#]|$)|\/uas\/login(?:[/?#]|$)|\/login(?:[/?#]|$)/i },
];

/** Govde metninin yalniz bu kadar basi taranir (nav + ust kart); profil "Hakkında" metni disarida kalir */
export const BLOCK_TEXT_HEAD_CHARS = 1500;

export interface BlockPageInfo {
  url?: string | null;
  title?: string | null;
}

/**
 * Engel tespiti: limit / captcha / dogrulama / giris duvari (TR/EN).
 * Sira: URL → document.title → govde metninin ILK 1500 karakteri.
 *
 * NEDEN kisitli: eskiden tum innerText taranirdi; "Güvenlik doğrulaması
 * akışlarını yönettim" yazan bir urun yoneticisinin Hakkında metni tum servisi
 * duraklatiyor ve Devam'dan sonra ayni kayit yine ilk secilip yine
 * duraklatiyordu (kilitlenme). Gercek engel sayfalarinda ipucu URL'de,
 * baslikta ve metnin en basindadir.
 *
 * Haftalik limit kalibi ISTISNA: gonderim sonrasi modal DOM sonuna eklenir,
 * bu yuzden tum metinde aranir (kalip sayfa metninde baska baglamda gecmez).
 */
export function detectBlock(text: string | null | undefined, page: BlockPageInfo = {}): BlockResult {
  const url = page.url ?? '';
  for (const { kind, re } of BLOCK_URL_PATTERNS) {
    const m = url.match(re);
    if (m) return { blocked: true, kind, match: m[0].slice(0, 80) };
  }
  const title = page.title ?? '';
  if (title) {
    for (const { kind, re } of BLOCK_PATTERNS) {
      const m = title.match(re);
      if (m) return { blocked: true, kind, match: (m[1] ?? m[0]).slice(0, 80) };
    }
  }
  if (!text) return { blocked: false };
  const wl = detectWeeklyLimit(text);
  if (wl.blocked) return wl;
  const head = text.slice(0, BLOCK_TEXT_HEAD_CHARS);
  for (const { kind, re } of BLOCK_PATTERNS) {
    const m = head.match(re);
    if (m) return { blocked: true, kind, match: (m[1] ?? m[0]).slice(0, 80) };
  }
  return { blocked: false };
}

/** Yalniz haftalik davet limiti — TUM metinde (gonderim sonrasi modal DOM sonunda) */
export function detectWeeklyLimit(text: string | null | undefined): BlockResult {
  if (!text) return { blocked: false };
  const m = text.match(WEEKLY_LIMIT_RE);
  return m ? { blocked: true, kind: 'weekly-limit', match: m[0].slice(0, 80) } : { blocked: false };
}

// ─── Duraklatma ─────────────────────────────────────────────────────────────

export interface PauseInput {
  /** Ardisik basarisiz MUTASYON (istek/mesaj) sayisi — okuma adimlari sayilmaz */
  consecutiveFails: number;
  /** Olgun pencere [simdi-14g, simdi-72sa] icindeki istek sayisi (acceptRateWindow) */
  requestsMatured: number;
  /** Ayni penceredeki isteklerden kabul edilenler */
  acceptedMatured: number;
}

export function shouldPause(input: PauseInput, limits: OutreachLimits = DEFAULT_LIMITS): { pause: boolean; reason?: string } {
  if (input.consecutiveFails >= limits.CONSECUTIVE_FAIL_PAUSE) {
    return { pause: true, reason: `Ardışık ${input.consecutiveFails} hata` };
  }
  if (input.requestsMatured >= limits.ACCEPT_RATE_MIN_REQUESTS) {
    const rate = input.acceptedMatured / input.requestsMatured;
    if (rate < limits.ACCEPT_RATE_MIN) {
      return {
        pause: true,
        reason: `Olgunlaşmış kabul oranı %${Math.round(rate * 100)} (< %${Math.round(limits.ACCEPT_RATE_MIN * 100)}; ${ACCEPT_RATE_MATURE_HOURS} sa–${ACCEPT_RATE_WINDOW_DAYS} gün penceresi, ${input.requestsMatured} istek) — spam sinyali`,
      };
    }
  }
  return { pause: false };
}

// ─── Derece ─────────────────────────────────────────────────────────────────

/**
 * Profil sayfasindan baglanti derecesi: rozet ipuclari (".dist-value" vb.)
 * once, sonra sayfa metninin basindaki "· 1st" / "· 1." kalibi. Bulunamazsa null.
 */
export function parseDegree(text: string | null | undefined, hints: string[] = []): 1 | 2 | 3 | null {
  const pick = (s: string): 1 | 2 | 3 | null => {
    const m = s.match(/(?:^|[\s·•])([123])(?:st|nd|rd|\.)(?:\s*(?:degree|derece|dereceden))?(?![\p{L}\p{N}])/iu);
    if (!m) return null;
    return Number(m[1]) as 1 | 2 | 3;
  };
  for (const h of hints) {
    const d = pick(h.trim());
    if (d) return d;
  }
  if (!text) return null;
  // Isim + rozet sayfanin basinda; sonraki "1st" (ortak baglantilar vb.) yaniltmasin
  return pick(text.slice(0, 1500));
}

// ─── Sablonlar (reklam/pazarlama/kurumsal-mail-sablonlari.md §7) ────────────

export interface ProspectLike {
  ad: string;
  soyad: string;
  firma: string;
  sektor?: string | null;
}

export const NOTE_MAX_CHARS = 300;

const SEKTOR_ADI: Record<string, string> = {
  finans: 'finans',
  'eticaret-perakende-teknoloji': 'e-ticaret, perakende ve teknoloji',
  'turizm-havayolu-telekom-otomotiv': 'turizm, havayolu, telekom ve otomotiv',
};

const SEKTOR_SORUSU: Record<string, string> = {
  finans: 'bana bir dijital banka öner',
  'eticaret-perakende-teknoloji': 'telefon almak için hangi site güvenilir',
  'turizm-havayolu-telekom-otomotiv': 'İstanbul-Londra için hangi havayolu',
};

/**
 * Sektor slug'i → okunur ad. Bilinmeyen slug ("saglik-ilac" gibi) HAM
 * BASILMAZ; genel "kurumsal" kullanilir (NEDEN: slug metne sizinca
 * "Türkiye saglik-ilac sektörü" gibi bozuk cumle gidiyordu).
 */
export function sektorAdi(sektor: string | null | undefined): string {
  const key = (sektor ?? '').trim().toLocaleLowerCase('tr');
  if (!key) return 'kurumsal';
  return SEKTOR_ADI[key] ?? 'kurumsal';
}

export function sektorSorusu(sektor: string | null | undefined): string {
  const key = (sektor ?? '').trim().toLocaleLowerCase('tr');
  return SEKTOR_SORUSU[key] ?? 'bu alanda hangi markayı önerirsin';
}

/**
 * Tamlayan eki ('nin/'nın/'nun/'nün ya da 'in/'ın/'un/'ün) — buyuk unlu uyumu.
 * "Trendyol'un", "Migros'un", "Akbank'ın", "Hepsiburada'nın". Unlu bulunamazsa 'nın.
 * Emin olunamayan haller icin genitiveOrSafe kullanin.
 */
export function genitive(word: string): string {
  const w = word.trim();
  const letters = w.replace(/[^\p{L}]/gu, '');
  const lower = letters.toLocaleLowerCase('tr');
  const vowels = lower.match(/[aeıioöuü]/g);
  if (!letters || !vowels) return `${w}'nın`;
  const last = vowels[vowels.length - 1];
  const suffixVowel = 'aı'.includes(last) ? 'ı' : 'ei'.includes(last) ? 'i' : 'ou'.includes(last) ? 'u' : 'ü';
  const endsWithVowel = /[aeıioöuü]$/.test(lower);
  return `${w}'${endsWithVowel ? 'n' : ''}${suffixVowel}n`;
}

/**
 * Tamlayan eki guvenle uretilebilir mi? Belirsiz haller: unlu yok, rakamla ya
 * da harf/rakam disi karakterle bitiyor ("N11", "A101", "Web 2.0"), kisa buyuk
 * harf kisaltma ("THY" harf harf okunur: te-he-ye → uyum kelimeden cikmaz).
 */
export function genitiveCertain(word: string): boolean {
  const w = word.trim();
  const letters = w.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  if (!/[aeıioöuü]/.test(letters.toLocaleLowerCase('tr'))) return false;
  if (!/\p{L}$/u.test(w)) return false;
  if (letters.length <= 5 && letters === letters.toLocaleUpperCase('tr')) return false;
  return true;
}

/**
 * Emin degilsek "{{firma}} markasının" — kesme isareti yok, her ad icin dogru
 * ("N11 markasının", "THY markasının"); eminsek "Trendyol'un".
 */
export function genitiveOrSafe(word: string): string {
  const w = word.trim();
  return genitiveCertain(w) ? genitive(w) : `${w} markasının`;
}

function hitap(p: ProspectLike): string {
  return `Merhaba ${p.ad.trim()} ${p.soyad.trim()}`.replace(/\s+/g, ' ').trim();
}

/**
 * Baglanti notu — <=300 karakter GARANTI. Once tam metin, sigmazsa firma
 * cumlesi atilir, hala sigmazsa kelime sinirindan kirpilir.
 * Hitap "Merhaba {{ad}} {{soyad}}," — Bey/Hanim YOK (cinsiyet verisi yok).
 */
export function renderNote(p: ProspectLike): string {
  const sektor = sektorAdi(p.sektor);
  const firma = p.firma.trim();
  const full =
    `${hitap(p)}, RanksUp'ta Türkiye ${sektor} sektörü için bağımsız bir AI görünürlük araştırması yürütüyorum; ` +
    `${firma} kapsamda. Kurumunuza özel karneyi ücretsiz paylaşmak için bağlantı kurmak isterim.`;
  if (full.length <= NOTE_MAX_CHARS) return full;
  const short =
    `${hitap(p)}, RanksUp'ta Türkiye ${sektor} sektörü için bağımsız bir AI görünürlük araştırması yürütüyorum. ` +
    `Kurumunuza özel karneyi ücretsiz paylaşmak için bağlantı kurmak isterim.`;
  if (short.length <= NOTE_MAX_CHARS) return short;
  const cut = short.slice(0, NOTE_MAX_CHARS);
  const sp = cut.lastIndexOf(' ');
  return (sp > 200 ? cut.slice(0, sp) : cut).trim();
}

/** Kabul sonrasi mesaj (~80 kelime) — CTA "Evet", ret garantisi icerir */
export function renderMessage(p: ProspectLike): string {
  const firma = p.firma.trim();
  return (
    `${hitap(p)}, bağlantı için teşekkürler.\n\n` +
    `Müşteriler artık "${sektorSorusu(p.sektor)}" sorusunu Google'a değil ChatGPT'ye soruyor ve cevapta 3 isim geçiyor. ` +
    `RanksUp olarak 7 AI asistanında, marka adı geçmeyen gerçek sorularla ${genitiveOrSafe(firma)} nerede göründüğünü ölçüp ` +
    `yalnız size iletebilirim — kurum bazlı sonuç kamuya açılmaz.\n\n` +
    `Karnenizi çıkarmamı ister misiniz? "Evet" yeterli, 2 iş günü içinde iletiyorum. İstemezseniz bir daha yazmayacağım.`
  );
}

// ─── Snapshot ref bulma ─────────────────────────────────────────────────────

/**
 * Snapshot satirindan ref belirtecini yakala. OpenClaw 2026.7.1 "ai"
 * snapshot'i Playwright kokenli: `- button "Connect" [ref=e12]`; ref'ler
 * `e<sayi>`. Bicim kesin bilinmedigi icin birkac olasi yazim kapsanir:
 *   [ref=e12] · ref=e12 · ref: e12 · "ref":"e12" · [e12] · (e12) · @e12
 */
export function extractRef(line: string): string | null {
  const patterns = [
    /\[ref=([A-Za-z0-9_-]+)\]/,
    /(?:^|[\s,{])ref\s*[=:]\s*"?([A-Za-z0-9_-]+)"?/,
    /"ref"\s*:\s*"([A-Za-z0-9_-]+)"/,
    /\[(e\d+)\]/,
    /\((e\d+)\)/,
    // "@e9" — e-posta benzeri "info@e1.com" ref sayilmasin: onunde harf/rakam/nokta olamaz
    /(?:^|[^\w.-])@(e\d+)(?![\w.-])/,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Satirdaki rol (buton, textbox, link...) — `- button "X"` ya da `role: button` */
function lineRole(line: string): string | null {
  const m = line.match(/^\s*-?\s*([a-z]+)\b/i) ?? line.match(/"role"\s*:\s*"([a-z]+)"/i);
  return m ? m[1].toLowerCase() : null;
}

/** Satirdaki tirnakli metinler ("Bağlantı kur" gibi) — tam eslesme tercihi icin */
function quotedTexts(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]{1,200})"/g)) out.push(m[1]);
  return out;
}

export interface FindRefOptions {
  /** Yalniz bu roldeki satirlar (button, textbox, link, ...) */
  role?: string;
  /** Etiket tam eslesmeli (tirnakli metin == etiket); varsayilan: once tam, sonra icerir */
  exact?: boolean;
  /**
   * Bu etiketleri tasiyan satirlar atlanir: tirnakli metin esit, tirnakli
   * metinde TAM KELIME olarak geciyor ("Mesajlarda ara" ← "ara") ya da 6+
   * karakterli etiket satirda geciyor. NEDEN kelime esleme: eskiden kisa
   * etiketler ("Ara") yalniz tam esitlikte disliyordu; "Mesajlarda ara" arama
   * kutusu mesaj kutusu sanilip yanlis kisiye DM gidebilirdi.
   */
  exclude?: readonly string[];
  /**
   * HEPSI satirda gecmeli (translit-duyarsiz: "Ayşe" = "Ayse"). Kisi adi ile
   * ust kart dugmesini yan paneldeki "Mehmet Öz adlı kişiyi ... davet et"
   * kartlarindan ayirmak icin; LinkedIn erisilebilirlik etiketine kisinin
   * adini koyar ("Invite Ayşe Kaya to connect", "Message Ayşe Kaya").
   */
  include?: readonly string[];
  /** Yalniz bu ref'in gectigi satirdan SONRAKI satirlar taranir (tiklanan dugmeden sonra acilan kutu) */
  after?: string;
  /** Birden cok aday varsa hangisi: ilk (varsayilan) ya da son (LinkedIn modallari DOM sonuna eklenir) */
  pick?: 'first' | 'last';
}

/** Tirnakli metinde x tam kelime olarak geciyor mu (Unicode harf siniri) */
function hasWord(text: string, x: string): boolean {
  let idx = text.indexOf(x);
  while (idx >= 0) {
    const before = idx === 0 ? '' : text[idx - 1];
    const after = text[idx + x.length] ?? '';
    if (!/\p{L}|\p{N}/u.test(before) && !/\p{L}|\p{N}/u.test(after)) return true;
    idx = text.indexOf(x, idx + 1);
  }
  return false;
}

/**
 * Snapshot metnini satir satir tarar; etiketlerden birini iceren satirdaki
 * ref'i dondurur. Tercih sirasi: tirnakli metin tam esit > satir iceriyor.
 * labels bos ve role verilmisse: o roldeki ilk/son ref.
 * Buyuk/kucuk harf Turkce'ye gore (I/ı, İ/i) esitlenir.
 */
export function findRef(snapshotText: string | null | undefined, labels: readonly string[], opts: FindRefOptions = {}): string | null {
  if (!snapshotText) return null;
  const norm = (s: string) => s.toLocaleLowerCase('tr').trim();
  const wants = labels.map(norm).filter(Boolean);
  const excludes = (opts.exclude ?? []).map(norm).filter(Boolean);
  const includes = (opts.include ?? []).map(nameKey).filter(Boolean);
  const lines = snapshotText.split(/\r?\n/);
  const exactHits: string[] = [];
  const containHits: string[] = [];
  // after verildiyse o ref gorulene kadar satirlar atlanir; ref hic yoksa (snapshot yenilendi) hicbir sey donmez
  let armed = !opts.after;

  for (const line of lines) {
    const ref = extractRef(line);
    if (!ref) continue;
    if (!armed) {
      if (ref === opts.after) armed = true;
      continue;
    }
    if (opts.role && lineRole(line) !== opts.role.toLowerCase()) continue;
    const quoted = quotedTexts(line).map(norm);
    const l = norm(line);
    if (excludes.length && excludes.some((x) => quoted.some((q) => q === x || hasWord(q, x)) || (x.length >= 6 && l.includes(x)))) continue;
    if (includes.length) {
      const lk = nameKey(line);
      if (!includes.every((inc) => lk.includes(inc))) continue;
    }
    if (wants.length === 0) {
      exactHits.push(ref);
      continue;
    }
    if (quoted.some((q) => wants.includes(q))) exactHits.push(ref);
    else if (!opts.exact && wants.some((w) => l.includes(w))) containHits.push(ref);
  }
  const pool = exactHits.length ? exactHits : containHits;
  if (pool.length === 0) return null;
  return opts.pick === 'last' ? pool[pool.length - 1] : pool[0];
}

/** Profil yan paneli basliklari — bu satirdan itibaren snapshot kesilir (baska kisilerin kartlari) */
export const SIDEBAR_HEADINGS: readonly string[] = [
  'Diğer kişiler de baktı', 'People also viewed',
  'More profiles for you', 'Sizin için',
  'Bu profili görüntüleyenler', 'Who viewed this profile',
  'Tanıyor olabileceğiniz kişiler', 'People you may know',
  'Bu kişiler de takip ediliyor', 'People also follow',
];

/**
 * Profil snapshot'ini ilk yan panel basligindan KESER: sonrasi "Diğer kişiler
 * de baktı" gibi baska kisilerin Connect/Follow kartlaridir. NEDEN: ust kart
 * "Takip et"+"Daha fazla" gosterirken ilk bulunan "bağlantı kur" dugmesi yan
 * paneldeki yabanciya aitti → yanlis kisiye davet gidiyordu. Erken kesim
 * zararsizdir (ust kart her zaman main'in basinda); modal/dialog aramasinda
 * KULLANILMAZ (modal DOM sonuna eklenir).
 */
export function cutAtSidebar(snapshotText: string | null | undefined): string {
  if (!snapshotText) return '';
  const heads = SIDEBAR_HEADINGS.map((h) => h.toLocaleLowerCase('tr'));
  const lines = snapshotText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLocaleLowerCase('tr');
    if (heads.some((h) => l.includes(h))) return lines.slice(0, i).join('\n');
  }
  return snapshotText;
}

// ─── Profil URL / eslesme ───────────────────────────────────────────────────

/** linkedin.com/in/<slug> → https://www.linkedin.com/in/<slug>/ ; degilse null */
export function normalizeProfileUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/in\/([^/?#]+)/i);
  if (!m) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    slug = m[1];
  }
  slug = slug.trim();
  if (!slug) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(slug).replace(/%2F/gi, '')}/`;
}

/** Arama sonucu snapshot'indan profil URL'leri (tekil, sirali) */
export function extractProfileUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'<>)\]?#]+/gi)) {
    const n = normalizeProfileUrl(m[0]);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

const TR_ASCII: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};

/** Ad karsilastirmasi icin: kucuk harf (tr), Turkce → ASCII, tek bosluk */
export function nameKey(s: string): string {
  let out = '';
  for (const ch of s.toLocaleLowerCase('tr')) out += TR_ASCII[ch] ?? ch;
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface UnreadConversation {
  text: string;
  unread: boolean;
  /** Kart icindeki profil linkleri (varsa) — slug eslesmesi en guvenilir sinyal */
  links?: string[];
  /** Son mesajin zamani (ISO, <time datetime>) — varsa */
  lastAt?: string | null;
}

export interface MessagedProspect {
  id: string;
  ad: string;
  soyad: string;
  firma?: string | null;
  profileUrl?: string | null;
  messagedAt?: Date | string | null;
}

export interface ReplyMatch {
  /** REPLIED yapilacaklar */
  replied: string[];
  /** Ayni adli birden cok kayit, firma/slug ile ayrilamadi → insana not, REPLIED YOK */
  ambiguous: string[];
}

/** Konusma kartindaki son mesaj bizden mi ("Siz: ..." / "You: ...") */
function lastMessageIsOurs(text: string): boolean {
  return /(?:^|\s)(?:siz|you)\s*:/iu.test(text);
}

/**
 * Konusmada cevap var mi: okunmamis isareti VEYA son mesaj bizim mesajdan
 * en az 2 dk sonra ve bizden degil. NEDEN: kullanici kutuyu kendi acip
 * okuduysa "okunmamis" gider; zaman damgasi cevabi yine yakalar.
 */
function conversationHasReply(c: UnreadConversation, messagedAt: Date | string | null | undefined): boolean {
  if (c.unread) return true;
  if (!c.lastAt || !messagedAt) return false;
  const last = Date.parse(c.lastAt);
  const sent = messagedAt instanceof Date ? messagedAt.getTime() : Date.parse(String(messagedAt));
  if (!Number.isFinite(last) || !Number.isFinite(sent)) return false;
  return last > sent + 120_000 && !lastMessageIsOurs(c.text);
}

/**
 * Mesaj kutusundaki konusmalari MESSAGED kayitlarla eslestir.
 *   1) Kart icinde profil linki varsa slug birebir → kesin.
 *   2) Yoksa ad+soyad (translit) kart metninde geciyor mu.
 * ADAS (ayni ad+soyad birden cok kayit): yalniz firma adi kart metninde
 * gecen ya da slug eslesen kayit REPLIED olur; ayrilamiyorsa hepsi
 * `ambiguous` (insan bakar) — yanlis kisiyi REPLIED yapip botu susturmayalim.
 */
export function matchUnreadToProspects(conversations: UnreadConversation[], prospects: MessagedProspect[]): ReplyMatch {
  const replied = new Set<string>();
  const ambiguous = new Set<string>();
  if (conversations.length === 0 || prospects.length === 0) return { replied: [], ambiguous: [] };

  const byName = new Map<string, MessagedProspect[]>();
  for (const p of prospects) {
    const k = nameKey(`${p.ad} ${p.soyad}`);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  for (const c of conversations) {
    const slugs = new Set((c.links ?? []).map((u) => normalizeProfileUrl(u)).filter((u): u is string => !!u));
    const t = nameKey(c.text);

    // 1) slug — kesin
    let hitBySlug = false;
    for (const p of prospects) {
      const u = normalizeProfileUrl(p.profileUrl);
      if (u && slugs.has(u)) {
        hitBySlug = true;
        if (conversationHasReply(c, p.messagedAt)) replied.add(p.id);
      }
    }
    if (hitBySlug) continue;

    // 2) ad + soyad
    for (const [k, group] of byName) {
      if (!t.includes(k)) continue;
      const cands = group.filter((p) => conversationHasReply(c, p.messagedAt));
      if (cands.length === 0) continue;
      if (cands.length === 1) { replied.add(cands[0].id); continue; }
      // adas: firma ile ayir
      const byFirma = cands.filter((p) => { const f = firmaKey(p.firma ?? ''); return f.length >= 3 && t.includes(f); });
      if (byFirma.length === 1) replied.add(byFirma[0].id);
      else for (const p of cands) ambiguous.add(p.id);
    }
  }
  for (const id of replied) ambiguous.delete(id);
  return { replied: [...replied], ambiguous: [...ambiguous] };
}

/** Arastirma: arama sonucu satirlarindan (ad, unvan, url) uclusu — regex, LLM yok */
export interface ResearchHit {
  ad: string;
  soyad: string;
  unvan: string;
  profileUrl: string;
}

/**
 * Arama sayfasi metninden adaylari cikar. Beklenen kalip (LinkedIn kisi arama):
 *   Ad Soyad
 *   · 2. / 2nd
 *   Unvan · Firma
 *   ... https://www.linkedin.com/in/slug
 * Snapshot'ta link satiri `- link "Ad Soyad" [ref=e5]` ve altinda url gecebilir;
 * bu yuzden URL'ye en yakin onceki isim satiri alinir.
 */
export function parseSearchResults(text: string | null | undefined): ResearchHit[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ResearchHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const urls = extractProfileUrls(lines[i]);
    if (urls.length === 0) continue;
    const url = urls[0];
    if (seen.has(url)) continue;
    // Ayni satirda tirnakli isim varsa o; yoksa yukari dogru ilk "isim gibi" satir
    let name = quotedTexts(lines[i]).find((q) => /^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)+$/u.test(q)) ?? '';
    let unvan = '';
    for (let k = i - 1; k >= Math.max(0, i - 6) && !name; k--) {
      const q = quotedTexts(lines[k]);
      const cand = (q.length ? q : [lines[k].replace(/^-\s*\w+\s*/, '')]).find((s) => /^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)+$/u.test(s.trim()));
      if (cand) name = cand.trim();
    }
    // NEDEN: unvan satiri her zaman "Manager" gibi bir kelime icermez ("Senior Android Engineer");
    // isimden sonraki ilk konum/"Mevcut:" olmayan metin unvandir. Filtre isTargetTitle'da.
    for (let k = i + 1; k < Math.min(lines.length, i + 6) && !unvan; k++) {
      const q = quotedTexts(lines[k]);
      const cand = (q.length ? q[0] : lines[k].replace(/^-\s*\w+\s*/, '')).trim();
      if (!cand || cand.length < 3 || !/\p{L}{3,}/u.test(cand)) continue; // "· 2." gibi derece isaretleri
      if (/^(mevcut|geçmiş|current|past|önceki)\s*:/iu.test(cand)) continue;
      if (/ortak bağlantı|mutual connection|takipçi|followers|bağlantı kur|connect|mesaj|message/iu.test(cand)) continue;
      if (/^[\p{L}\s.]+,\s*[\p{L}\s.]+$/u.test(cand) && /türkiye|turkey|istanbul|ankara|izmir|bursa|antalya|kocaeli|london|berlin/iu.test(cand)) continue; // "Ankara, Türkiye"
      if (/^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)+$/u.test(cand) && cand.split(/\s+/).length <= 3 && !/\b(engineer|manager|director|müdür|direktör|uzman|specialist|lead|head)\b/iu.test(cand)) continue; // baska bir isim satiri
      unvan = cand.slice(0, 160);
    }
    if (!name) continue;
    const parts = name.split(/\s+/);
    seen.add(url);
    out.push({ ad: parts.slice(0, -1).join(' '), soyad: parts[parts.length - 1], unvan, profileUrl: url });
  }
  return out;
}

/**
 * Arastirma adayi HEDEF unvanda mi? Iki aile kabul edilir (kullanici karari 29.08.2026:
 * "yalniz pazarlama degil; CEO/CTO, founder/co-founder, manager tarzi"):
 *   1) Ust yonetim / kurucu: CEO, CTO, CMO, COO, chief…, founder/kurucu, genel mudur/GMY,
 *      managing director, country/general manager, direktor/director, head, VP, baskan, icra/yonetim kurulu
 *   2) Pazarlama ailesi (her kademe): pazarlama/marketing, marka/brand, dijital, growth, iletisim,
 *      musteri deneyimi, e-ticaret, performans, CRM, icerik, SEO, sosyal medya, reklam
 * Duz "Manager" tek basina yeterli DEGIL (muhendislik/operasyon yoneticilerini getirir); yalniz 2. aileyle.
 * Negatif kelimeler (muhendis, yazilim, IK, finans, hukuk, operasyon, satin alma, stajyer…) her iki
 * ailede baskindir — "Marketing Data Engineer", "CFO", "Chief Legal Officer" aday degil.
 * Unvan bos ya da hedef disiysa aday DEGIL — yanlis kisiye baglanti istegi hem israf hem spam sinyali.
 */
const UST_YONETIM = /(\bceo\b|\bcto\b|\bcmo\b|\bcdo\b|\bcgo\b|\bcoo\b|\bcpo\b|\bcro\b|\bchief\b|co-?founder|founder|kurucu|genel müdür|genel mudur|\bgmy\b|managing director|general manager|country manager|başkan|baskan|president|\bvp\b|vice president|direktör|direktor|director|head of|\bhead\b|yönetim kurulu|yonetim kurulu|board member|icra kurulu|executive)/iu;
const PAZARLAMA_POZITIF = /(pazarlama|marketing|marka|brand|dijital|digital|growth|büyüme|buyume|iletişim|iletisim|communications?|müşteri deneyimi|musteri deneyimi|customer experience|e-?ticaret|e-?commerce|performance|kampanya|campaign|crm|içerik|icerik|content|seo|sosyal medya|social media|reklam|advertis)/iu;
const HEDEF_NEGATIF = /(engineer|mühendis|muhendis|developer|yazılım|yazilim|software|\bqa\b|\btest|data scien|veri bilim|devops|\bit\b|bilgi teknolojileri|security|güvenlik|guvenlik|financ|finans|muhasebe|account(?:ing|ant)|hukuk|legal|avukat|attorney|lawyer|counsel|\brisk\b|insan kaynakları|insan kaynaklari|human resources|chief people|people officer|people (?:&|and) culture|business intelligence|analytics|analitik|\bdata\b|\bveri\b|\bhr\b|recruit|işe alım|ise alim|operasyon|operations|lojistik|logistic|satın alma|satin alma|procurement|product designer|\bux\b|ui designer|intern\b|stajyer|öğrenci|ogrenci|student|assistant|asistan|secretary|sekreter|trainer|eğitmen|egitmen|\bcoach\b|\bkoç\b|\bkoc\b)/iu;

/**
 * NEDEN: JS regex `i` bayragi U+0130 (İ) harfini "i"ye katlamaz — "İcra Kurulu", "İletişim"
 * eslesmiyordu. Once İ→i, sonra toLowerCase (Ingilizce buyuk harfli "MARKETING DIRECTOR" bozulmasin;
 * toLocaleLowerCase('tr') I→ı yapar ve "director"i kirar).
 */
function titleKey(unvan: string | null | undefined): string {
  return (unvan ?? '').trim().replace(/İ/g, 'i').toLowerCase();
}

export function isTargetTitle(unvan: string | null | undefined): boolean {
  const t = titleKey(unvan);
  if (!t) return false;
  if (!UST_YONETIM.test(t) && !PAZARLAMA_POZITIF.test(t)) return false;
  // "Marketing Data Engineer", "CFO" gibi karisik/hedef disi unvanlar: negatif kelime baskin sayilir
  if (HEDEF_NEGATIF.test(t)) return false;
  return true;
}

/** Karar verici mi (kademe 1) yoksa etkileyici mi (kademe 2) — arastirma adayi icin */
export function researchKademe(unvan: string | null | undefined): 1 | 2 {
  const t = titleKey(unvan);
  return UST_YONETIM.test(t) || /(müdür|mudur|manager|lider|\blead\b|yönetici|yonetici)/iu.test(t) ? 1 : 2;
}

/**
 * Arama karti satirlarindan unvani sec: isim satirindan sonraki ilk "konum / Mevcut: /
 * derece / ortak baglanti / dugme" olmayan satir. parseSearchResults ile ayni kurallar;
 * NEDEN ayri fonksiyon: DOM yolu (SEARCH_LINKS_FN) satir dizisi verir, snapshot yolu metin.
 */
export function pickTitleFromCard(lines: string[], name: string): string {
  const temiz = lines.map((l) => l.trim()).filter(Boolean);
  const nameKeyed = name.trim().toLowerCase();
  let start = temiz.findIndex((l) => l.toLowerCase() === nameKeyed || l.toLowerCase().startsWith(nameKeyed));
  if (start < 0) start = -1;
  for (let k = start + 1; k < Math.min(temiz.length, start + 8); k++) {
    const cand = temiz[k];
    if (cand.length < 3 || !/\p{L}{3,}/u.test(cand)) continue;                       // "· 2." derece
    if (cand.toLowerCase() === nameKeyed) continue;                                       // isim tekrari
    if (/^(mevcut|geçmiş|current|past|önceki)\s*:/iu.test(cand)) continue;             // "Mevcut: X sirketinde ..."
    if (/ortak bağlantı|mutual connection|takipçi|followers|bağlantı kur|connect\b|mesaj|message|görüntüle|view profile|1\. derece|2\. derece|3\. derece|\b1st\b|\b2nd\b|\b3rd\b/iu.test(cand)) continue;
    if (/^[\p{L}\s.]+,\s*[\p{L}\s.]+$/u.test(cand) && /türkiye|turkey|istanbul|ankara|izmir|bursa|antalya|kocaeli|london|berlin|amsterdam|dubai/iu.test(cand)) continue; // konum
    return cand.slice(0, 160);
  }
  return '';
}

// ── Arastirma: arama URL'si + firma eslesmesi ─────────────────

/**
 * Arastirma arama terimleri — HER TERIM AYRI ARAMA (kullanici karari 30.08.2026: "birlesik arama yok,
 * hepsini tek tek arayacaksin"). Sonuclar profil URL'sine gore tekillestirilir, kademe 1 once.
 * Sira: ust yonetim/kurucu → direktor → pazarlama ailesi.
 * Not: `title=` / `titleFreeText=` URL parametreleri yutuluyor; yalniz `currentCompany` facet'i calisiyor;
 * uzun boolean OR "Sonuç bulunamadı" veriyordu (29.08 denemesi) — boolean artik hic kullanilmiyor.
 */
export const RESEARCH_KEYWORD_QUERIES: readonly string[] = Object.freeze([
  'CEO', 'CTO', 'CMO', 'Founder', 'Kurucu', 'Genel Müdür',
  'Director', 'Direktör',
  'Pazarlama', 'Marketing', 'Growth', 'Marka', 'Brand',
]);

const PEOPLE_SEARCH = 'https://www.linkedin.com/search/results/people/?';

/**
 * Tek terimlik kisi arama URL'si. companyId varsa `currentCompany=["id"]` facet'i (su anki calisanlar)
 * + terim; yoksa `"<firma> <terim>"` anahtar kelimesi (kart "Mevcut:/baslik" firma eslesmesi ZORUNLU —
 * firma adi profilin her yerinde gecebilir).
 */
export function researchSearchUrl(firma: string, companyId?: string | null, term: string = RESEARCH_KEYWORD_QUERIES[0]): string {
  if (companyId) {
    const q = new URLSearchParams({ currentCompany: JSON.stringify([String(companyId)]), keywords: term, origin: 'FACETED_SEARCH' });
    return PEOPLE_SEARCH + q.toString();
  }
  const q = new URLSearchParams({ keywords: `${firma.trim()} ${term}`, origin: 'GLOBAL_SEARCH_HEADER' });
  return PEOPLE_SEARCH + q.toString();
}

/** Bir arastirma turunda gezilecek arama sayfalari: terim basina bir (facet ya da anahtar kelime yedegi) */
export function researchSearchUrls(firma: string, companyId?: string | null): string[] {
  return RESEARCH_KEYWORD_QUERIES.map((t) => researchSearchUrl(firma, companyId, t));
}

/** Sirket arama URL'si (sirket kimligi cozumlemenin ilk adimi) */
export function companySearchUrl(firma: string): string {
  const q = new URLSearchParams({ keywords: firma.trim(), origin: 'SWITCH_SEARCH_VERTICAL' });
  return `https://www.linkedin.com/search/results/companies/?${q.toString()}`;
}

/**
 * Sirket arama sonuclarindan dogru sirket sayfasinin slug'i. Tercih: ad firmaKey ile birebir →
 * onunla baslayan → iceren → ilk sonuc. NEDEN: "Papara" aramasi "Finfree (Acquired by Papara)",
 * "Papara Menkul Değerler" gibi sonuclar da getirir; birebir ad once.
 */
export function pickCompanySlug(links: ReadonlyArray<{ href: string; text: string }>, firma: string): string | null {
  const key = firmaKey(firma);
  if (!key) return null;
  const cands: Array<{ slug: string; name: string }> = [];
  for (const l of links) {
    const m = /\/company\/([^/?#]+)/.exec(l.href ?? '');
    if (!m) continue;
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { /* oldugu gibi */ }
    const name = firmaKey((l.text ?? '').split('\n')[0]);
    if (!cands.some((c) => c.slug === slug)) cands.push({ slug, name });
  }
  if (cands.length === 0) return null;
  return (
    cands.find((c) => c.name === key)?.slug ??
    cands.find((c) => c.name.startsWith(key + ' '))?.slug ??
    cands.find((c) => c.name.includes(key))?.slug ??
    cands[0].slug
  );
}

/**
 * Sirket sayfasindaki "Çalışanları gör" baglantilarindan sayisal kimlik. `network=` iceren
 * (baglantilarim filtresi) baglanti bazen ana sirket/istirak kimligi tasir → once onsuz olan.
 */
export function pickCompanyId(hrefs: readonly string[]): string | null {
  const parse = (h: string): string | null => {
    let d = h;
    try { d = decodeURIComponent(h); } catch { /* oldugu gibi */ }
    const m = /currentCompany=\[\s*"?(\d+)"?/.exec(d);
    return m ? m[1] : null;
  };
  const plain = hrefs.filter((h) => !/[?&]network=/.test(h));
  for (const h of plain) { const id = parse(h); if (id) return id; }
  for (const h of hrefs) { const id = parse(h); if (id) return id; }
  return null;
}

/** "LinkedIn Üyesi" / "LinkedIn Member" — profili gizli anonim sonuc; profil URL'si yok, aday olamaz */
export function isAnonymousMember(name: string | null | undefined): boolean {
  return /^linkedin\s+(üyesi|uyesi|member)$/iu.test((name ?? '').trim());
}

export type CardCompanyMatch = 'current' | 'headline' | 'past' | 'none';

/**
 * Kart bu kisinin SU AN aranan firmada oldugunu gosteriyor mu?
 *   'current'  — "Mevcut: <firma> şirketinde …" / "Current: … at <firma>"
 *   'headline' — basligin kendisinde firma adi ("Pazarlama Müdürü @ Papara")
 *   'past'     — yalniz "Geçmiş:/Past:" satirinda firma → eski calisan, aday DEGIL
 *   'none'     — hicbir satirda firma yok → aday DEGIL (yanlis kisiye istek = israf + spam sinyali)
 * Firma eslesmesi firmaKey uzerinden (A.Ş./Grup/buyuk-kucuk harf farki yok; "Papara'da" → papara da).
 */
export function cardCompanyMatch(lines: readonly string[], firma: string, unvan?: string | null): CardCompanyMatch {
  const tokens = firmaKey(firma).split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return 'none';
  const has = (s: string): boolean => {
    const k = ` ${firmaKey(s)} `;
    return tokens.every((t) => k.includes(t));
  };
  let past = false;
  for (const raw of lines) {
    const m = /^(mevcut|current|geçmiş|gecmis|past|önceki|onceki|previous)\s*:\s*(.+)$/iu.exec(raw.trim());
    if (!m) continue;
    if (!has(m[2])) continue;
    if (/^(mevcut|current)$/iu.test(m[1])) return 'current';
    past = true;
  }
  if (unvan && has(unvan)) return 'headline';
  return past ? 'past' : 'none';
}

/**
 * Tarayici gercekten hedef sayfada mi? Yol ayni + hedefin her sorgu parametresi mevcut URL'de ayni.
 * NEDEN: tunel uzerinden LinkedIn aramasi gateway'in 20 sn navigate suresini asabiliyor;
 * zaman asimi sayfanin yuklenmedigi anlamina gelmiyor — URL ile dogrulanir.
 */
export function urlMatchesTarget(current: string | null | undefined, target: string): boolean {
  if (!current) return false;
  try {
    const a = new URL(current);
    const b = new URL(target);
    if (a.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '')) return false;
    if (a.pathname.replace(/\/+$/, '') !== b.pathname.replace(/\/+$/, '')) return false;
    for (const [k, v] of b.searchParams) {
      if (k === 'origin') continue;
      if (a.searchParams.get(k) !== v) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Karttaki "Mevcut: <firma> şirketinde <unvan>" / "Current: <unvan> at <firma>" satirindan gercek
 * pozisyon unvani. NEDEN: baslik serbest metindir ("Growth", "Fintech & Banking"); kademe ve hedef
 * filtresi icin pozisyon unvani daha guvenilir. Satir yoksa ''.
 */
export function currentTitleFromCard(lines: readonly string[]): string {
  for (const raw of lines) {
    const m = /^(mevcut|current)\s*:\s*(.+)$/iu.exec(raw.trim());
    if (!m) continue;
    const rest = m[2].trim();
    const tr = /^(.+?)\s+(?:şirketinde|sirketinde|'da|'de|’da|’de)\s+(.+)$/iu.exec(rest);
    if (tr) return tr[2].replace(/\s*[-–—]\s*[.…].*$/u, '').trim().slice(0, 160);
    const en = /^(.+?)\s+at\s+(.+)$/iu.exec(rest);
    if (en) return en[1].trim().slice(0, 160);
    return rest.slice(0, 160);
  }
  return '';
}

/**
 * Baslik ACIKCA baska bir firmayi mi soyluyor? ("Co-Founder at Finfree Co", "CEO @ SuperMassive",
 * "X şirketinde GM", "Y'de Direktör"). NEDEN: currentCompany facet'i kisinin firmada bir kaydi oldugunu
 * garanti eder ama baslik baska sirketteki asil rolunu anlatiyorsa yanlis kisiye istek gider.
 * Baslikta firma geciyorsa (cardCompanyMatch 'headline') baska firma sayilmaz.
 */
export function headlineNamesOtherCompany(unvan: string | null | undefined, firma: string): boolean {
  const t = (unvan ?? '').trim();
  if (!t) return false;
  if (cardCompanyMatch([], firma, t) === 'headline') return false;
  return /(\s+at\s+\S|\s*@\s*\S|\s+şirketinde\b|\s+sirketinde\b|\S['’](?:da|de|ta|te)\s+\S)/iu.test(t);
}
