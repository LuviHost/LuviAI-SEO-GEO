import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPT_RATE_MATURE_HOURS,
  ACCEPT_RATE_WINDOW_DAYS,
  BLOCK_TEXT_HEAD_CHARS,
  DEFAULT_LIMITS,
  acceptRateWindow,
  cutAtSidebar,
  detectBlock,
  detectWeeklyLimit,
  delayBetweenActionsMs,
  extractRef,
  extractProfileUrls,
  findRef,
  firmaKey,
  genitive,
  genitiveCertain,
  genitiveOrSafe,
  isMaturedRequest,
  isWorkWindow,
  istanbulDayStart,
  istanbulParts,
  matchUnreadToProspects,
  nameKey,
  normalizeProfileUrl,
  parseDegree,
  parseSearchResults,
  planTick,
  profileReadDelayMs,
  renderMessage,
  renderNote,
  resolveLimits,
  sektorAdi,
  shouldPause,
  type PlannedAction,
  type TickCounters,
  type TickQueue,
} from './linkedin-outreach-rules.js';
import { LINKEDIN_LABELS as L } from './linkedin-selectors.js';
import { LinkedinOutreachService, type TickAction } from './linkedin-outreach.service.js';

// Servis testleri icin agir bagimliliklar (Prisma istemcisi, SMTP) yuklenmesin
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));

const emptyCounters = (over: Partial<TickCounters> = {}): TickCounters => ({
  requestsToday: 0, messagesToday: 0, requestsWeek: 0, researchToday: 0, companyRequestsToday: {}, ...over,
});
const emptyQueue = (over: Partial<TickQueue> = {}): TickQueue => ({
  accepted: [], requested: [], queued: [], messagedCount: 0, ...over,
});
const noFail = { consecutiveFails: 0 };

describe('isWorkWindow — Europe/Istanbul hafta ici 09-18', () => {
  it('Pazartesi 10:00 TR (07:00Z) → true', () => {
    expect(isWorkWindow(new Date('2026-08-31T07:00:00Z'))).toBe(true);
  });
  it('Cumartesi / Pazar → false', () => {
    expect(isWorkWindow(new Date('2026-08-29T07:00:00Z'))).toBe(false); // Cumartesi
    expect(isWorkWindow(new Date('2026-08-30T07:00:00Z'))).toBe(false); // Pazar
  });
  it('08:59 ve 18:00 TR disarida, 09:00 ve 17:59 iceride', () => {
    expect(isWorkWindow(new Date('2026-08-31T05:59:00Z'))).toBe(false);
    expect(isWorkWindow(new Date('2026-08-31T06:00:00Z'))).toBe(true);
    expect(isWorkWindow(new Date('2026-08-31T14:59:00Z'))).toBe(true);
    expect(isWorkWindow(new Date('2026-08-31T15:00:00Z'))).toBe(false);
  });
  it('UTC gunu farkli olsa da TR gunune gore karar verir (Cuma 23:30Z = Cumartesi 02:30 TR)', () => {
    expect(isWorkWindow(new Date('2026-08-28T23:30:00Z'))).toBe(false);
  });
  it('istanbulDayStart: TR gece yarisi = 21:00Z onceki gun', () => {
    expect(istanbulDayStart(new Date('2026-08-31T00:30:00Z')).toISOString()).toBe('2026-08-30T21:00:00.000Z');
    expect(istanbulDayStart(new Date('2026-08-31T12:00:00Z')).toISOString()).toBe('2026-08-30T21:00:00.000Z');
  });
  it('AB yaz saati gecisleri Turkiye penceresini oynatmaz (TR sabit +03)', () => {
    expect(isWorkWindow(new Date('2026-03-29T07:00:00Z'))).toBe(false); // Pazar
    expect(isWorkWindow(new Date('2026-03-30T05:59:59Z'))).toBe(false);
    expect(isWorkWindow(new Date('2026-03-30T06:00:00Z'))).toBe(true);
    expect(isWorkWindow(new Date('2026-03-30T15:00:00Z'))).toBe(false);
    expect(isWorkWindow(new Date('2026-10-26T06:00:00Z'))).toBe(true);
    expect(isWorkWindow(new Date('2026-10-26T15:00:00Z'))).toBe(false);
  });
  it('TR gece yarisi (21:00Z): saat 0, gun ertesi; dayStart tutarli', () => {
    const p = istanbulParts(new Date('2026-08-31T21:00:00Z'));
    expect(p.hour).toBe(0);
    expect(p.ymd).toBe('2026-09-01');
    expect(istanbulDayStart(new Date('2026-08-31T21:00:00Z')).toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(istanbulDayStart(new Date('2026-08-31T20:59:59Z')).toISOString()).toBe('2026-08-30T21:00:00.000Z');
  });
});

describe('planTick — oncelik ve frenler', () => {
  it('sira: reply-check → message → accept-check; tick basina en fazla 3', () => {
    const plan = planTick(emptyCounters(), emptyQueue({
      messagedCount: 2,
      accepted: [{ id: 'a1', firma: 'X' }],
      requested: [{ id: 'r1', firma: 'X' }, { id: 'r2', firma: 'Y' }],
      queued: [{ id: 'q1', firma: 'Z' }],
    }));
    expect(plan.map((p) => p.type)).toEqual(['reply-check', 'message', 'accept-check']);
    expect(plan.length).toBe(DEFAULT_LIMITS.MAX_ACTIONS_PER_TICK);
  });
  it('MESSAGED yoksa reply-check planlanmaz; request kuyruktan gelir', () => {
    const plan = planTick(emptyCounters(), emptyQueue({ queued: [{ id: 'q1', firma: 'A' }, { id: 'q2', firma: 'B' }] }));
    expect(plan).toEqual([{ type: 'request', prospectId: 'q1' }, { type: 'request', prospectId: 'q2' }]);
  });
  it('gunluk / haftalik istek sayaci doluyken request secilmez', () => {
    expect(planTick(emptyCounters({ requestsToday: 20 }), emptyQueue({ queued: [{ id: 'q1', firma: 'A' }] }))).toEqual([]);
    expect(planTick(emptyCounters({ requestsWeek: 80 }), emptyQueue({ queued: [{ id: 'q1', firma: 'A' }] }))).toEqual([]);
  });
  it('sinirin bir altinda: 19/20 gun ve 79/80 hafta → tam bir istek', () => {
    const plan = planTick(emptyCounters({ requestsToday: 19, requestsWeek: 79 }), emptyQueue({ queued: [{ id: 'a', firma: 'X' }, { id: 'b', firma: 'Y' }] }));
    expect(plan).toEqual([{ type: 'request', prospectId: 'a' }]);
  });
  it('gunluk mesaj sayaci doluyken message secilmez; 14/15 → bir mesaj, kalan slotlar diger islere', () => {
    expect(planTick(emptyCounters({ messagesToday: 15 }), emptyQueue({ accepted: [{ id: 'a1', firma: 'A' }] }))).toEqual([]);
    const plan = planTick(emptyCounters({ messagesToday: 14 }), emptyQueue({
      accepted: [{ id: 'm1', firma: 'A' }, { id: 'm2', firma: 'B' }], requested: [{ id: 'r', firma: 'A' }], queued: [{ id: 'q', firma: 'C' }],
    }));
    expect(plan.map((p) => p.type)).toEqual(['message', 'accept-check', 'request']);
  });
  it('ayni firmadan gunde en fazla 2 (bugunku sayac + bu tick); dolu firma atlanir, digerleri devam', () => {
    const plan = planTick(
      emptyCounters({ companyRequestsToday: { [firmaKey('Trendyol A.Ş.')]: 1 } }),
      emptyQueue({ queued: [{ id: 'q1', firma: 'Trendyol' }, { id: 'q2', firma: 'TRENDYOL Grup' }, { id: 'q3', firma: 'Migros' }] }),
    );
    expect(plan).toEqual([{ type: 'request', prospectId: 'q1' }, { type: 'request', prospectId: 'q3' }]);
    const plan2 = planTick(
      emptyCounters({ companyRequestsToday: { [firmaKey('Akbank T.A.Ş.')]: 2 } }),
      emptyQueue({ queued: [{ id: 'a', firma: 'AKBANK' }, { id: 'b', firma: 'Akbank A.Ş.' }, { id: 'c', firma: 'Garanti' }] }),
    );
    expect(plan2).toEqual([{ type: 'request', prospectId: 'c' }]);
  });
  it('accept-check tek islem, en fazla 5 profil', () => {
    const requested = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, firma: 'A' }));
    const plan = planTick(emptyCounters(), emptyQueue({ requested }));
    expect(plan).toEqual([{ type: 'accept-check', prospectIds: ['r0', 'r1', 'r2', 'r3', 'r4'] }]);
  });
  it('research yalniz hedef verilmisse ve gunluk sinir altinda', () => {
    expect(planTick(emptyCounters(), emptyQueue())).toEqual([]);
    expect(planTick(emptyCounters(), emptyQueue({ researchTargets: ['Firma A'] }))).toEqual([{ type: 'research', firma: 'Firma A' }]);
    expect(planTick(emptyCounters({ researchToday: 50 }), emptyQueue({ researchTargets: ['Firma A'] }))).toEqual([]);
  });
  it('bekleme araliklari: 2-6 dk ve 8-20 sn', () => {
    expect(delayBetweenActionsMs(() => 0)).toBe(120_000);
    expect(delayBetweenActionsMs(() => 1)).toBe(360_000);
    expect(profileReadDelayMs(() => 0)).toBe(8_000);
    expect(profileReadDelayMs(() => 1)).toBe(20_000);
  });
});

describe('resolveLimits — env yalniz asagi, alt sinir 1, MAX_ACTIONS_PER_TICK=0 oldurme anahtari', () => {
  it('env ile fren yalniz asagi cekilir; ACCEPT_RATE_MIN yalniz yukari', () => {
    const l = resolveLimits({ LINKEDIN_MAX_REQUESTS_PER_DAY: '5', LINKEDIN_MAX_MESSAGES_PER_DAY: '99', LINKEDIN_ACCEPT_RATE_MIN: '0.3' });
    expect(l.MAX_REQUESTS_PER_DAY).toBe(5);
    expect(l.MAX_MESSAGES_PER_DAY).toBe(15);
    expect(l.ACCEPT_RATE_MIN).toBe(0.3);
    expect(resolveLimits({ LINKEDIN_ACCEPT_RATE_MIN: '0.01' }).ACCEPT_RATE_MIN).toBe(0.15);
    expect(resolveLimits({ LINKEDIN_ACCEPT_RATE_MIN: '2' }).ACCEPT_RATE_MIN).toBe(0.15);
  });
  it('MAX_ACTIONS_PER_TICK=0 → plan bos (oldurme anahtari); 1 → yalniz reply-check', () => {
    const l0 = resolveLimits({ LINKEDIN_MAX_ACTIONS_PER_TICK: '0' });
    expect(l0.MAX_ACTIONS_PER_TICK).toBe(0);
    expect(planTick(emptyCounters(), emptyQueue({ messagedCount: 1, queued: [{ id: 'a', firma: 'X' }] }), l0)).toEqual([]);
    const l1 = resolveLimits({ LINKEDIN_MAX_ACTIONS_PER_TICK: '1' });
    expect(planTick(emptyCounters(), emptyQueue({ messagedCount: 1, queued: [{ id: 'a', firma: 'X' }] }), l1)).toEqual([{ type: 'reply-check' }]);
  });
  it('negatif / NaN / bos yok sayilir; ondalik asagi yuvarlanir; 0 diger anahtarlarda 1e kirpilir', () => {
    const l = resolveLimits({
      LINKEDIN_MAX_REQUESTS_PER_DAY: '-5', LINKEDIN_MAX_MESSAGES_PER_DAY: 'abc', LINKEDIN_MAX_REQUESTS_PER_WEEK: '',
      LINKEDIN_SAME_COMPANY_PER_DAY: '1.9', LINKEDIN_CONSECUTIVE_FAIL_PAUSE: '0', LINKEDIN_ACCEPT_CHECK_PER_TICK: '0',
    });
    expect(l.MAX_REQUESTS_PER_DAY).toBe(20);
    expect(l.MAX_MESSAGES_PER_DAY).toBe(15);
    expect(l.MAX_REQUESTS_PER_WEEK).toBe(80);
    expect(l.SAME_COMPANY_PER_DAY).toBe(1);
    expect(l.CONSECUTIVE_FAIL_PAUSE).toBe(1); // 0 olsaydi "0 hata >= 0" ile her tick aninda duraklardi
    expect(l.ACCEPT_CHECK_PER_TICK).toBe(1);
    expect(shouldPause({ ...noFail, requestsMatured: 0, acceptedMatured: 0 }, l).pause).toBe(false);
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });
  it('WORK_HOUR_* env ile degistirilemez (pencere genisletilemez)', () => {
    const l = resolveLimits({ LINKEDIN_WORK_HOUR_START: '0', LINKEDIN_WORK_HOUR_END: '24' });
    expect(l.WORK_HOUR_START).toBe(9);
    expect(l.WORK_HOUR_END).toBe(18);
  });
});

describe('shouldPause — ardisik hata + OLGUN kabul orani', () => {
  it('ardisik 3 hata → duraklat', () => {
    expect(shouldPause({ consecutiveFails: 2, requestsMatured: 0, acceptedMatured: 0 }).pause).toBe(false);
    expect(shouldPause({ consecutiveFails: 3, requestsMatured: 0, acceptedMatured: 0 }).pause).toBe(true);
  });
  it('kabul orani: en az 20 OLGUN istekte %15 alti → duraklat; tam %15 gecer', () => {
    expect(shouldPause({ ...noFail, requestsMatured: 19, acceptedMatured: 0 }).pause).toBe(false);
    expect(shouldPause({ ...noFail, requestsMatured: 20, acceptedMatured: 2 }).pause).toBe(true);
    expect(shouldPause({ ...noFail, requestsMatured: 20, acceptedMatured: 3 }).pause).toBe(false);
    expect(shouldPause({ ...noFail, requestsMatured: 40, acceptedMatured: 5 }).reason).toMatch(/Olgunlaşmış kabul oranı/);
  });
  it('acceptRateWindow: [simdi-14g, simdi-72sa]; dunku istek OLGUN DEGIL (2. gun kilitlenmesi yok)', () => {
    const now = new Date('2026-09-02T09:00:00Z');
    const { from, to } = acceptRateWindow(now);
    expect(to.getTime()).toBe(now.getTime() - ACCEPT_RATE_MATURE_HOURS * 3_600_000);
    expect(from.getTime()).toBe(now.getTime() - ACCEPT_RATE_WINDOW_DAYS * 86_400_000);
    expect(isMaturedRequest(new Date('2026-09-01T09:00:00Z'), now)).toBe(false); // dun
    expect(isMaturedRequest(new Date('2026-08-30T08:59:00Z'), now)).toBe(true); // 72 sa + 1 dk
    expect(isMaturedRequest(new Date('2026-08-20T09:00:00Z'), now)).toBe(true); // 13 gun
    expect(isMaturedRequest(new Date('2026-08-18T09:00:00Z'), now)).toBe(false); // 15 gun
    expect(isMaturedRequest(null, now)).toBe(false);
  });
  it('2. gun senaryosu: dun 20 istek, 2 kabul → olgun istek 0 → DURAKLAMAZ', () => {
    const now = new Date('2026-09-02T09:00:00Z');
    const rows = Array.from({ length: 20 }, (_, i) => ({ requestedAt: new Date('2026-09-01T09:00:00Z'), acceptedAt: i < 2 ? now : null }));
    const matured = rows.filter((r) => isMaturedRequest(r.requestedAt, now));
    expect(matured.length).toBe(0);
    expect(shouldPause({ ...noFail, requestsMatured: matured.length, acceptedMatured: matured.filter((r) => r.acceptedAt).length }).pause).toBe(false);
  });
});

describe('detectBlock — URL / baslik / govde basi; haftalik limit tum metinde', () => {
  it('haftalik limit (TR/EN, kivrik kesme)', () => {
    expect(detectBlock('Şimdi bağlanamazsınız. Haftalık davet sınırınıza ulaştınız').kind).toBe('weekly-limit');
    expect(detectBlock("You've reached the weekly invitation limit").kind).toBe('weekly-limit');
    expect(detectBlock('You’ve reached the weekly invitation limit').kind).toBe('weekly-limit');
  });
  it('captcha ve guvenlik dogrulamasi (metnin basinda)', () => {
    expect(detectBlock('Please complete this CAPTCHA to continue').kind).toBe('captcha');
    expect(detectBlock('Güvenlik doğrulaması gerekiyor').kind).toBe('verification');
    expect(detectBlock('Security verification — Let’s do a quick security check').kind).toBe('verification');
  });
  it('giris duvari', () => {
    expect(detectBlock('LinkedIn\nOturum aç\nHemen katıl').kind).toBe('login-wall');
    expect(detectBlock('Sign in to LinkedIn · Join now').kind).toBe('login-wall');
    expect(detectBlock('Designing single sign-on').blocked).toBe(false);
  });
  it('normal profil metni engel degil; "Oturum açık" giris duvari sayilmaz', () => {
    expect(detectBlock('Ayşe Kaya · 2. derece bağlantı · Pazarlama Direktörü · Bağlantı kur · Mesaj').blocked).toBe(false);
    expect(detectBlock('Oturum açık: Emir').blocked).toBe(false);
    expect(detectBlock('').blocked).toBe(false);
  });
  it('KAPSAM: profil "Hakkında" metnindeki "Güvenlik doğrulaması" / "CAPTCHA" (ilk 1500 karakterden sonra) engel DEGIL', () => {
    const nav = 'Ana Sayfa Ağım İş İlanları Mesajlaşma Bildirimler Ben\nAyşe Kaya · 2. · Ürün Yöneticisi\n';
    const filler = 'Deneyim ve eğitim bilgileri. '.repeat(60); // > 1500 karakter
    expect(nav.length + filler.length).toBeGreaterThan(BLOCK_TEXT_HEAD_CHARS);
    expect(detectBlock(`${nav}${filler}Hakkında: 3D Secure ve Güvenlik doğrulaması akışlarını yönettim`).blocked).toBe(false);
    expect(detectBlock(`${nav}${filler}Skills: CAPTCHA integration, fraud`).blocked).toBe(false);
    expect(detectBlock(`${nav}${filler}Footer: Sign in · Help`).blocked).toBe(false);
  });
  it('URL ve baslik engeli kesin yakalar (govde temiz olsa da)', () => {
    expect(detectBlock('Ayşe Kaya · 2.', { url: 'https://www.linkedin.com/checkpoint/challenge/abc' }).kind).toBe('verification');
    expect(detectBlock('', { url: 'https://www.linkedin.com/authwall?trk=x' }).kind).toBe('login-wall');
    expect(detectBlock('', { url: 'https://www.linkedin.com/uas/login?session_redirect=x' }).kind).toBe('login-wall');
    expect(detectBlock('', { url: 'https://www.linkedin.com/login' }).kind).toBe('login-wall');
    expect(detectBlock('', { url: 'https://www.linkedin.com/in/ayse-kaya/' }).blocked).toBe(false);
    expect(detectBlock('', { url: 'https://www.linkedin.com/in/ayse-kaya/', title: 'Security Verification | LinkedIn' }).kind).toBe('verification');
    expect(detectBlock('', { title: 'Ayşe Kaya | LinkedIn' }).blocked).toBe(false);
  });
  it('haftalik limit modali DOM sonunda → uzun metnin SONUNDA da yakalanir', () => {
    const long = 'x'.repeat(5000) + '\nŞimdi bağlanamazsınız. Haftalık davet sınırınıza ulaştınız';
    expect(detectBlock(long).kind).toBe('weekly-limit');
    expect(detectWeeklyLimit(long).blocked).toBe(true);
    expect(detectWeeklyLimit('x'.repeat(5000) + '\nGüvenlik doğrulaması').blocked).toBe(false);
  });
});

describe('parseDegree', () => {
  it('rozet ipucu once, sonra sayfa metni', () => {
    expect(parseDegree('Ayşe Kaya · 1. derece bağlantı', [])).toBe(1);
    expect(parseDegree('John Doe · 2nd', [])).toBe(2);
    expect(parseDegree('irrelevant', ['· 3rd'])).toBe(3);
    expect(parseDegree('Ayşe Kaya\nPazarlama Direktörü', [])).toBeNull();
    expect(parseDegree('1st place winner list', [])).toBe(1);
    expect(parseDegree('Toplam 12. sıra', [])).toBeNull();
  });
  it('nav gurultusu ve ortak baglanti sayisi derece sanilmaz; 1500 sonrasi yok sayilir; "3rd+"', () => {
    expect(parseDegree('Home My Network Jobs Messaging Notifications 12 Me\nAyşe Kaya\nPazarlama Direktörü\n3 mutual connections', [])).toBeNull();
    expect(parseDegree('x'.repeat(1600) + ' · 1st', [])).toBeNull();
    expect(parseDegree('Ayşe Kaya · 3rd+', [])).toBe(3);
  });
});

describe('sablonlar', () => {
  const p = { ad: 'Ayşe', soyad: 'Kaya', firma: 'Trendyol', sektor: 'eticaret-perakende-teknoloji' };
  it('renderNote: hitap "Merhaba Ad Soyad," — Bey/Hanım yok, sektor adi ve firma gecer, <=300', () => {
    const n = renderNote(p);
    expect(n.startsWith('Merhaba Ayşe Kaya,')).toBe(true);
    expect(n).not.toMatch(/Bey|Hanım/);
    expect(n).toContain('e-ticaret, perakende ve teknoloji');
    expect(n).toContain('Trendyol kapsamda');
    expect(n.length).toBeLessThanOrEqual(300);
  });
  it('renderNote: cok uzun isim/firma → yine <=300; uzun firma cumlesi atilir, CTA kalir', () => {
    const long = { ad: 'Muhammed Abdurrahman Emirhan', soyad: 'Karaosmanoğlu-Yıldırımhanoğulları', firma: 'Uluslararası Entegre Lojistik ve Dijital Perakende Teknolojileri Anonim Şirketi Holding Grubu', sektor: 'turizm-havayolu-telekom-otomotiv' };
    const n = renderNote(long);
    expect(n.length).toBeLessThanOrEqual(300);
    expect(n.startsWith('Merhaba Muhammed')).toBe(true);
    const absurd = { ...long, ad: 'A'.repeat(200), soyad: 'B'.repeat(120) };
    expect(renderNote(absurd).length).toBeLessThanOrEqual(300);
    const f160 = renderNote({ ad: 'Ayşe', soyad: 'Kaya', firma: 'F'.repeat(160), sektor: 'finans' });
    expect(f160.length).toBeLessThanOrEqual(300);
    expect(f160).not.toContain('FFFF');
    expect(f160).toContain('bağlantı kurmak isterim');
  });
  it('bos soyad → "Merhaba Ad," cift bosluksuz', () => {
    expect(renderNote({ ad: 'Ayşe', soyad: '', firma: 'X', sektor: 'finans' }).startsWith('Merhaba Ayşe,')).toBe(true);
  });
  it('renderMessage: tesekkur, sektor sorusu, CTA "Evet", ret garantisi, dogru tamlayan eki, <110 kelime', () => {
    const m = renderMessage(p);
    expect(m.startsWith('Merhaba Ayşe Kaya, bağlantı için teşekkürler.')).toBe(true);
    expect(m).toContain('"telefon almak için hangi site güvenilir"');
    expect(m).toContain("Trendyol'un nerede göründüğünü");
    expect(m).toContain('"Evet" yeterli');
    expect(m).toContain('İstemezseniz bir daha yazmayacağım.');
    expect(m).not.toMatch(/Bey|Hanım/);
    expect(m.split(/\s+/).length).toBeLessThan(110);
    const thy = renderMessage({ ad: 'Ali', soyad: 'Veli', firma: 'Türk Hava Yolları', sektor: 'turizm-havayolu-telekom-otomotiv' });
    expect(thy).toContain("Türk Hava Yolları'nın");
    expect(thy).toContain('7 AI asistanında');
  });
  it('genitive: buyuk unlu uyumu', () => {
    expect(genitive('Trendyol')).toBe("Trendyol'un");
    expect(genitive('Hepsiburada')).toBe("Hepsiburada'nın");
    expect(genitive('Akbank')).toBe("Akbank'ın");
    expect(genitive('Migros')).toBe("Migros'un");
    expect(genitive('Türk Telekom')).toBe("Türk Telekom'un");
    expect(genitive('Getir')).toBe("Getir'in");
  });
  it('genitiveOrSafe: rakamla biten / unsuz / kisa buyuk harf kisaltma → "X markasının" (kesme isareti yok)', () => {
    expect(genitiveCertain('Trendyol')).toBe(true);
    expect(genitiveCertain('N11')).toBe(false);
    expect(genitiveCertain('A101')).toBe(false);
    expect(genitiveCertain('THY')).toBe(false);
    expect(genitiveCertain('BİM')).toBe(false);
    expect(genitiveOrSafe('N11')).toBe('N11 markasının');
    expect(genitiveOrSafe('THY')).toBe('THY markasının');
    expect(genitiveOrSafe('Trendyol')).toBe("Trendyol'un");
    expect(renderMessage({ ad: 'A', soyad: 'B', firma: 'N11', sektor: null })).toContain('N11 markasının nerede göründüğünü');
    expect(renderMessage({ ad: 'A', soyad: 'B', firma: 'N11', sektor: null })).not.toContain("N11'");
  });
  it('sektor bilinmiyor ya da slug tanimsiz → "kurumsal" (ham slug metne sizmaz); tr kucuk harf', () => {
    expect(renderNote({ ad: 'Ali', soyad: 'Veli', firma: 'X', sektor: null })).toContain('Türkiye kurumsal sektörü');
    const unk = renderNote({ ad: 'A', soyad: 'B', firma: 'X', sektor: 'saglik-ilac' });
    expect(unk).toContain('Türkiye kurumsal sektörü');
    expect(unk).not.toContain('saglik-ilac');
    expect(sektorAdi('SAĞLIK')).toBe('kurumsal');
    expect(sektorAdi('FİNANS')).toBe('finans'); // İ → i (tr)
    expect(renderMessage({ ad: 'Ali', soyad: 'Veli', firma: 'X', sektor: 'finans' })).toContain('"bana bir dijital banka öner"');
    expect(renderMessage({ ad: 'Ali', soyad: 'Veli', firma: 'X', sektor: 'saglik-ilac' })).toContain('"bu alanda hangi markayı önerirsin"');
  });
});

describe('findRef — snapshot ref bicimleri', () => {
  it('Playwright ai bicimi: - button "Bağlantı kur" [ref=e12]', () => {
    const snap = [
      '- navigation "Ana" [ref=e1]',
      '  - textbox "Ara" [ref=e2]',
      '- main [ref=e3]',
      '  - heading "Ayşe Kaya" [ref=e4]',
      '  - button "Bağlantı kur" [ref=e12] [cursor=pointer]',
      '  - button "Mesaj" [ref=e13]',
    ].join('\n');
    expect(findRef(snap, ['Bağlantı kur', 'Connect'])).toBe('e12');
    expect(findRef(snap, ['Mesaj', 'Message'], { role: 'button' })).toBe('e13');
    expect(findRef(snap, ['Takip et', 'Follow'])).toBeNull();
  });
  it('diger olasi bicimler: ref=e3, [e7], (e4), @e9, JSON; e-posta benzeri "@e1" ref degil; rol satiri sonunda ":"', () => {
    expect(findRef('button "Connect" ref=e3', ['Connect'])).toBe('e3');
    expect(findRef('[e7] button: Add a note', ['Not ekle', 'Add a note'])).toBe('e7');
    expect(findRef('(e4) link "Mesaj"', ['Mesaj'])).toBe('e4');
    expect(findRef('button "Send" @e9', ['Gönder', 'Send'])).toBe('e9');
    expect(findRef('{"role":"button","name":"Gönder","ref":"e21"}', ['Gönder'])).toBe('e21');
    expect(extractRef('- button "X"')).toBeNull();
    expect(extractRef('- link "info@e1.com"')).toBeNull();
    expect(findRef('- button "Gönder" [ref=e9]:', ['Gönder'], { role: 'button', exact: true })).toBe('e9');
  });
  it('tam eslesme icerene tercih edilir: "Gönder" vs "Notsuz gönder"', () => {
    const snap = ['- button "Notsuz gönder" [ref=e1]', '- button "Gönder" [ref=e2]'].join('\n');
    expect(findRef(snap, ['Gönder', 'Send'])).toBe('e2');
    expect(findRef(snap, ['Gönder'], { exact: true })).toBe('e2');
    expect(findRef('- button "Send without a note" [ref=e1]', ['Send'], { exact: true })).toBeNull();
    expect(findRef('- button "Send without a note" [ref=e1]', ['Send'])).toBe('e1');
  });
  it('Turkce buyuk/kucuk harf duyarsiz (İ/ı)', () => {
    expect(findRef('- button "BAĞLANTI KUR" [ref=e5]', ['Bağlantı kur'])).toBe('e5');
    expect(findRef('- button "İstek gönder" [ref=e6]', ['istek gönder'])).toBe('e6');
  });
  it('yalniz role: textbox; arama kutusu dislanir, son aday secilir (modal DOM sonunda)', () => {
    const snap = [
      '- textbox "Ara" [ref=e2]',
      '- button "Bağlantı kur" [ref=e12]',
      '- dialog "Not ekle" [ref=e30]',
      '  - textbox [ref=e31]',
      '  - button "Gönder" [ref=e32]',
    ].join('\n');
    expect(findRef(snap, [], { role: 'textbox', exclude: ['Ara', 'Search'], pick: 'last' })).toBe('e31');
    expect(findRef(snap, [], { role: 'textbox' })).toBe('e2');
    expect(findRef(snap, ['Gönder'], { role: 'textbox' })).toBeNull();
  });
  it('bos snapshot → null', () => {
    expect(findRef('', ['Connect'])).toBeNull();
    expect(findRef(null, ['Connect'])).toBeNull();
  });
});

describe('findRef — ust kart / yan panel ayrimi (gercek LinkedIn erisilebilirlik etiketleri)', () => {
  const who = ['Ayşe', 'Kaya'];
  const snapMoreMenu = [
    '- navigation [ref=e1]:',
    '  - link "Mesajlaşma" [ref=e2]',
    '- main [ref=e3]:',
    '  - heading "Ayşe Kaya" [ref=e4]',
    '  - button "Takip et" [ref=e10]',
    '  - button "Daha fazla" [ref=e11]',
    '- complementary [ref=e20]:',
    '  - heading "Diğer kişiler de baktı" [ref=e21]',
    '  - link "Mehmet Öz" [ref=e22]',
    '  - button "Mehmet Öz adlı kişiyi bağlantı kurmaya davet et" [ref=e23]',
    '  - button "Zeynep Ak adlı kişiyi bağlantı kurmaya davet et" [ref=e24]',
  ].join('\n');
  it('include: ust kartta Connect yokken yan paneldeki yabancinin dugmesi DONMEZ', () => {
    // eski davranis (include yok) yabanciyi bulurdu — hatanin belgesi
    expect(findRef(snapMoreMenu, L.baglantiKur, { role: 'button' })).toBe('e23');
    expect(findRef(snapMoreMenu, L.baglantiKur, { role: 'button', include: who })).toBeNull();
    expect(findRef(snapMoreMenu, L.baglantiKur, { include: who })).toBeNull();
    // "Daha fazla" ust kartta bulunur
    expect(findRef(cutAtSidebar(snapMoreMenu), L.daha, { role: 'button' })).toBe('e11');
  });
  it('cutAtSidebar: ilk yan panel basligindan kesilir; basliksiz snapshot aynen kalir', () => {
    const cut = cutAtSidebar(snapMoreMenu);
    expect(cut).toContain('Daha fazla');
    expect(cut).not.toContain('Mehmet Öz');
    expect(findRef(cut, L.baglantiKur, { role: 'button' })).toBeNull();
    expect(cutAtSidebar('- button "Bağlantı kur" [ref=e1]')).toBe('- button "Bağlantı kur" [ref=e1]');
    for (const h of ['People also viewed', 'More profiles for you', 'Sizin için', 'Bu profili görüntüleyenler']) {
      expect(cutAtSidebar(`- button "A" [ref=e1]\n- heading "${h}"\n- button "B" [ref=e2]`)).toBe('- button "A" [ref=e1]');
    }
    expect(cutAtSidebar('')).toBe('');
  });
  it('Daha fazla menusu acilinca kisi adli "bağlantı kur" ogesi bulunur (button ya da menuitem)', () => {
    const menu = [
      '- main [ref=e3]:',
      '  - button "Daha fazla" [ref=e11]',
      '  - menuitem "Ayşe Kaya adlı kişiyi bağlantı kurmaya davet et" [ref=e15]',
      '- heading "Diğer kişiler de baktı" [ref=e21]',
      '  - button "Mehmet Öz adlı kişiyi bağlantı kurmaya davet et" [ref=e23]',
    ].join('\n');
    const top = cutAtSidebar(menu);
    expect(findRef(top, L.baglantiKur, { role: 'button', include: who }) ?? findRef(top, L.baglantiKur, { role: 'menuitem', include: who })).toBe('e15');
  });
  it('EN "Invite Ayşe Kaya to connect": include ile dogru kisi; translit-duyarsiz ("Ayse")', () => {
    const snap = '- button "Invite John Doe to connect" [ref=e40]\n- button "Invite Ayse Kaya to connect" [ref=e12]';
    expect(findRef(snap, L.baglantiKur, { role: 'button', include: who })).toBe('e12');
    expect(findRef(snap, L.baglantiKur, { role: 'button', include: ['John', 'Doe'] })).toBe('e40');
    expect(findRef(snap, L.baglantiKur, { role: 'button', include: ['Ayşe', 'Yılmaz'] })).toBeNull(); // hepsi gecmeli
  });
  it('Bekliyor/Pending tam etiketle (exact yok) kisi adiyla yakalanir; yabanci Connect secilmez', () => {
    const snap = '- button "Pending, click to withdraw invitation sent to Ayşe Kaya" [ref=e12]\n- button "Invite John Doe to connect" [ref=e40]';
    expect(findRef(snap, L.bekliyor, { role: 'button', exact: true })).toBeNull(); // eski yol kacirirdi
    expect(findRef(snap, L.bekliyor, { role: 'button', include: who })).toBe('e12');
    expect(findRef(snap, L.baglantiKur, { role: 'button', include: who })).toBeNull();
    const tr = '- button "Bekliyor, Ayşe Kaya adlı kişiye gönderilen daveti geri çekmek için tıklayın" [ref=e13]';
    expect(findRef(tr, L.bekliyor, { role: 'button', include: who })).toBe('e13');
  });
  it('Mesaj: yalniz DUGME + kisi adi; nav "Mesajlaşma" linki ve baskasinin dugmesi secilmez', () => {
    const snap = [
      '- link "Mesajlaşma" [ref=e2]',
      '- button "Takip et" [ref=e10]',
      '- button "Message Ayşe Kaya" [ref=e14]',
      '- heading "Diğer kişiler de baktı" [ref=e21]',
      '- button "Message Mehmet Öz" [ref=e25]',
    ].join('\n');
    expect(findRef(snap, L.mesaj, { role: 'link' })).toBe('e2'); // link fallback'in neden kaldirildigi
    expect(findRef(cutAtSidebar(snap), L.mesaj, { role: 'button', include: who })).toBe('e14');
    expect(findRef(cutAtSidebar('- link "Mesajlaşma" [ref=e2]\n- button "Takip et" [ref=e10]'), L.mesaj, { role: 'button', include: who })).toBeNull();
    expect(findRef('- button "Ayşe Kaya adlı kişiye mesaj gönder" [ref=e14]', L.mesaj, { role: 'button', include: who })).toBe('e14');
  });
  it('arama kutulari her durumda dislanir ("Mesajlarda ara" / "Search messages"); kutu tiklanan dugmeden SONRA aranir', () => {
    expect(findRef('- textbox "Mesajlarda ara" [ref=e50]', [], { role: 'textbox', exclude: L.aramaKutusu, pick: 'last' })).toBeNull();
    expect(findRef('- textbox "Search messages" [ref=e50]', [], { role: 'textbox', exclude: L.aramaKutusu, pick: 'last' })).toBeNull();
    expect(findRef('- textbox "Ara" [ref=e50]', [], { role: 'textbox', exclude: L.aramaKutusu })).toBeNull();
    // kelime siniri: "Karakter" icindeki "ara" dislamaz
    expect(findRef('- textbox "Karakter sayısı" [ref=e51]', [], { role: 'textbox', exclude: L.aramaKutusu })).toBe('e51');
    const snap = [
      '- textbox "Mesajlarda ara" [ref=e50]',
      '- textbox "Not ekle" [ref=e60]',
      '- button "Message Ayşe Kaya" [ref=e14]',
      '- textbox "Mesajlarda ara" [ref=e70]',
      '- textbox "Mesaj yaz" [ref=e80]',
    ].join('\n');
    expect(findRef(snap, L.mesajKutusu, { role: 'textbox', after: 'e14', exclude: L.aramaKutusu, pick: 'last' })).toBe('e80');
    expect(findRef(snap, [], { role: 'textbox', after: 'e14', exclude: L.aramaKutusu, pick: 'last' })).toBe('e80');
    expect(findRef(snap, [], { role: 'textbox', after: 'e14', exclude: L.aramaKutusu, pick: 'first' })).toBe('e80');
    expect(findRef(snap, [], { role: 'textbox', after: 'e999', exclude: L.aramaKutusu })).toBeNull(); // ref yoksa hicbir sey
    expect(findRef(snap, [], { role: 'textbox', exclude: L.aramaKutusu, pick: 'first' })).toBe('e60'); // after yoksa eski davranis
  });
});

describe('profil URL ve eslesme', () => {
  it('normalizeProfileUrl: varyantlar tek bicime', () => {
    expect(normalizeProfileUrl('linkedin.com/in/ayse-kaya')).toBe('https://www.linkedin.com/in/ayse-kaya/');
    expect(normalizeProfileUrl('https://tr.linkedin.com/in/ayse-kaya/?originalSubdomain=tr')).toBe('https://www.linkedin.com/in/ayse-kaya/');
    expect(normalizeProfileUrl('https://www.linkedin.com/in/ayse-kaya-1a2b3c/details/experience/')).toBe('https://www.linkedin.com/in/ayse-kaya-1a2b3c/');
    expect(normalizeProfileUrl('https://www.linkedin.com/company/trendyol/')).toBeNull();
    expect(normalizeProfileUrl('https://example.com/in/x')).toBeNull();
    expect(normalizeProfileUrl('')).toBeNull();
  });
  it('extractProfileUrls: metinden tekil profil URL listesi', () => {
    const t = 'bak https://www.linkedin.com/in/a-b?x=1 ve https://tr.linkedin.com/in/a-b/ ve https://www.linkedin.com/in/c-d';
    expect(extractProfileUrls(t)).toEqual(['https://www.linkedin.com/in/a-b/', 'https://www.linkedin.com/in/c-d/']);
  });
  it('firmaKey: A.S./Grup/buyuk-kucuk farki yok; nameKey translit', () => {
    expect(firmaKey('Trendyol Grup A.Ş.')).toBe('trendyol');
    expect(firmaKey('TRENDYOL')).toBe('trendyol');
    expect(firmaKey('Türk Hava Yolları A.O.')).toBe('türk hava yolları o');
    expect(nameKey('Şükrü Özdemir')).toBe('sukru ozdemir');
  });
  it('parseSearchResults: snapshot metninden ad + unvan + url', () => {
    const snap = [
      '- link "Ayşe Kaya" [ref=e10] https://www.linkedin.com/in/ayse-kaya?miniProfile=1',
      '  - text "· 2."',
      '  - text "Pazarlama Direktörü · Trendyol"',
      '- link "Mehmet Öz" [ref=e11]',
      '  https://www.linkedin.com/in/mehmet-oz/',
      '  - text "Marka Müdürü"',
    ].join('\n');
    const hits = parseSearchResults(snap);
    expect(hits).toEqual([
      { ad: 'Ayşe', soyad: 'Kaya', unvan: 'Pazarlama Direktörü · Trendyol', profileUrl: 'https://www.linkedin.com/in/ayse-kaya/' },
      { ad: 'Mehmet', soyad: 'Öz', unvan: 'Marka Müdürü', profileUrl: 'https://www.linkedin.com/in/mehmet-oz/' },
    ]);
  });
});

describe('matchUnreadToProspects — cevap tespiti', () => {
  const sentAt = new Date('2026-09-01T09:00:00Z');
  it('translit ile ad soyad eslesir, yalniz okunmamis (adassiz)', () => {
    const convs = [
      { text: 'Ayse Kaya · okunmamış · Merhaba, evet ilgilenirim', unread: true },
      { text: 'Mehmet Öz · Teşekkürler', unread: false },
      { text: 'ŞÜKRÜ ÖZDEMİR · 1 unread message', unread: true },
    ];
    const prospects = [
      { id: 'p1', ad: 'Ayşe', soyad: 'Kaya' },
      { id: 'p2', ad: 'Mehmet', soyad: 'Öz' },
      { id: 'p3', ad: 'Şükrü', soyad: 'Özdemir' },
      { id: 'p4', ad: 'Ali', soyad: 'Veli' },
    ];
    expect(matchUnreadToProspects(convs, prospects)).toEqual({ replied: ['p1', 'p3'], ambiguous: [] });
    expect(matchUnreadToProspects([], prospects)).toEqual({ replied: [], ambiguous: [] });
  });
  it('ADAS: ayni adli iki MESSAGED kayit, tek okunmamis konusma → ikisi de REPLIED OLMAZ, belirsiz', () => {
    const r = matchUnreadToProspects([{ text: 'Mehmet Yılmaz · okunmamış', unread: true }], [
      { id: 'a', ad: 'Mehmet', soyad: 'Yılmaz', firma: 'Akbank' }, { id: 'b', ad: 'Mehmet', soyad: 'Yilmaz', firma: 'Garanti' },
    ]);
    expect(r.replied).toEqual([]);
    expect(r.ambiguous.sort()).toEqual(['a', 'b']);
  });
  it('ADAS: firma kart metninde geciyorsa yalniz o kayit; profil linki (slug) varsa kesin', () => {
    const byFirma = matchUnreadToProspects([{ text: 'Mehmet Yılmaz · Garanti BBVA · okunmamış', unread: true }], [
      { id: 'a', ad: 'Mehmet', soyad: 'Yılmaz', firma: 'Akbank' }, { id: 'b', ad: 'Mehmet', soyad: 'Yilmaz', firma: 'Garanti' },
    ]);
    expect(byFirma).toEqual({ replied: ['b'], ambiguous: [] });
    const bySlug = matchUnreadToProspects(
      [{ text: 'Mehmet Yılmaz · okunmamış', unread: true, links: ['https://www.linkedin.com/in/mehmet-yilmaz-akbank?x=1'] }],
      [
        { id: 'a', ad: 'Mehmet', soyad: 'Yılmaz', firma: 'Akbank', profileUrl: 'https://www.linkedin.com/in/mehmet-yilmaz-akbank/' },
        { id: 'b', ad: 'Mehmet', soyad: 'Yilmaz', firma: 'Garanti', profileUrl: 'https://www.linkedin.com/in/mehmet-yilmaz-garanti/' },
      ],
    );
    expect(bySlug).toEqual({ replied: ['a'], ambiguous: [] });
  });
  it('okunmamis degil ama son mesaj bizim mesajdan sonra ve bizden degil → cevap; "Siz:" onekli ya da eski → degil', () => {
    const p = [{ id: 'p1', ad: 'Ayşe', soyad: 'Kaya', messagedAt: sentAt }];
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya · Evet ilgilenirim', unread: false, lastAt: '2026-09-01T12:00:00Z' }], p).replied).toEqual(['p1']);
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya · Siz: Merhaba Ayşe Kaya', unread: false, lastAt: '2026-09-01T12:00:00Z' }], p).replied).toEqual([]);
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya · You: hello', unread: false, lastAt: '2026-09-01T12:00:00Z' }], p).replied).toEqual([]);
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya · eski', unread: false, lastAt: '2026-08-30T12:00:00Z' }], p).replied).toEqual([]);
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya · bizim mesaj', unread: false, lastAt: '2026-09-01T09:01:00Z' }], p).replied).toEqual([]); // 2 dk toleransi
    expect(matchUnreadToProspects([{ text: 'Ayşe Kaya', unread: false }], p).replied).toEqual([]);
  });
});

// ─── Servis: tick dongusu (tarayici/DB stub) ────────────────────────────────

type Stubs = {
  plan?: PlannedAction[];
  queue?: Partial<TickQueue>;
  run?: (a: PlannedAction) => Promise<TickAction>;
  fails?: number;
};

function makeService(stubs: Stubs = {}) {
  // NEDEN prisma stub'i: isEnabled() panel ayarini KvStore'dan okur (varsayilan: kayit yok → env gecerli)
  const prisma: any = { kvStore: { findUnique: async () => null, upsert: async () => undefined, deleteMany: async () => undefined } };
  const svc = new LinkedinOutreachService(prisma, {} as any);
  const s = svc as any;
  const calls = { setFails: [] as number[], bumps: 0, errors: [] as Array<{ id: string; msg: string; fail: boolean }>, paused: [] as string[], shots: [] as string[], locked: 0 };
  s.pausedReason = async () => null;
  s.acquireLock = async () => { calls.locked++; return true; };
  s.releaseLock = async () => undefined;
  s.closeTab = async () => undefined;
  s.counters = async () => ({
    counters: { ...emptyCounters(), fails: stubs.fails ?? 0 },
    requestsMatured: 0,
    acceptedMatured: 0,
  });
  s.buildQueue = async () => emptyQueue(stubs.queue ?? { queued: [{ id: 'q1', firma: 'X' }] });
  s.runAction = stubs.run ?? (async (a: PlannedAction) => ({ type: a.type, ok: true } as TickAction));
  s.setFails = async (n: number) => { calls.setFails.push(n); };
  s.bumpFails = async () => { calls.bumps++; return (stubs.fails ?? 0) + calls.bumps; };
  s.setError = async (id: string, msg: string, fail: boolean) => { calls.errors.push({ id, msg, fail }); };
  s.pauseWithNotice = async (r: string) => { calls.paused.push(r); };
  s.screenshot = async (id: string, step: string) => { calls.shots.push(`${id}-${step}`); return null; };
  return { svc, s, calls };
}

async function runTick(svc: LinkedinOutreachService, opts: Parameters<LinkedinOutreachService['tick']>[0]) {
  const p = svc.tick(opts);
  await vi.runAllTimersAsync();
  return p;
}

describe('LinkedinOutreachService.tick — sayac, ritim, pencere, engel', () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T07:00:00Z')); // Pazartesi 10:00 TR
    process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED = '1';
    delete process.env.OPENCLAW_ENABLED;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...env };
  });

  it('bayrak: env tek basina yeter; PANEL ayari env\'i ezer (acik/kapali)', async () => {
    const { svc } = makeService();
    expect(svc.envEnabled).toBe(true);
    expect(await svc.isEnabled()).toBe(true);
    delete process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED;
    expect(svc.envEnabled).toBe(false);
    expect(await svc.isEnabled()).toBe(false);
    expect((await svc.tick({ dryRun: true })).reason).toMatch(/Kapalı/);
    // Panelden acilinca env kapali olsa da calisir
    (svc as any).prisma.kvStore.findUnique = async ({ where }: any) => (where?.key === 'linkedin-outreach:enabled' ? { value: '1' } : null);
    expect(await svc.isEnabled()).toBe(true);
    // Panelden kapatilinca env acik olsa da durur
    process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED = '1';
    (svc as any).prisma.kvStore.findUnique = async ({ where }: any) => (where?.key === 'linkedin-outreach:enabled' ? { value: '0' } : null);
    expect(await svc.isEnabled()).toBe(false);
    expect((await svc.tick({ dryRun: true })).reason).toMatch(/Kapalı/);
  });

  it('ardisik hata sayaci: okuma adimi (reply-check) basarisi sayaci SIFIRLAMAZ; basarisiz istekler sayar', async () => {
    const { svc, calls } = makeService({
      queue: { messagedCount: 1, queued: [{ id: 'q1', firma: 'X' }, { id: 'q2', firma: 'Y' }] },
      run: async (a) => { if (a.type === 'request') throw new Error('"Not ekle" düğmesi bulunamadı'); return { type: a.type, ok: true }; },
    });
    const r = await runTick(svc, { dryRun: false, jitter: false });
    expect(r.actions.map((a) => [a.type, a.ok])).toEqual([['reply-check', true], ['request', false], ['request', false]]);
    expect(calls.setFails).toEqual([]); // reply-check ok → sifirlama YOK
    expect(calls.bumps).toBe(2);
    expect(calls.errors.map((e) => [e.id, e.fail])).toEqual([['q1', true], ['q2', true]]);
    expect(calls.shots).toEqual(['q1-hata', 'q2-hata']); // FAILED yazilmadan once ekran goruntusu
    expect(r.paused).toBeUndefined();
  });

  it('3. ardisik basarisiz istek → duraklat; basarili istek sayaci sifirlar', async () => {
    const bad = makeService({ fails: 2, run: async () => { throw new Error('x'); } });
    const r = await runTick(bad.svc, { dryRun: false, jitter: false });
    expect(r.paused).toBe(true);
    expect(bad.calls.paused[0]).toMatch(/Ardışık 3 hata/);

    const good = makeService();
    await runTick(good.svc, { dryRun: false, jitter: false });
    expect(good.calls.setFails).toEqual([0]);
  });

  it('okuma adimi HATASI sayaca girmez (accept-check patlasa da bump yok, duraklama yok)', async () => {
    const { svc, calls } = makeService({
      fails: 2,
      queue: { requested: [{ id: 'r1', firma: 'X' }] },
      run: async () => { throw new Error('Sayfa okunamadı'); },
    });
    const r = await runTick(svc, { dryRun: false, jitter: false });
    expect(r.actions).toEqual([{ type: 'accept-check', prospectId: undefined, ok: false, note: 'Sayfa okunamadı' }]);
    expect(calls.bumps).toBe(0);
    expect(calls.paused).toEqual([]);
    expect(calls.shots).toEqual(['accept-check-hata']);
  });

  it('engel (captcha/dogrulama) → duraklat, lastError yaz ama FAILED yapma (sira sonuna gider), ekran goruntusu', async () => {
    const { svc, s, calls } = makeService();
    s.runAction = async () => { s.assertNoBlock({ text: 'Güvenlik doğrulaması gerekiyor', url: '', title: '', dist: [] }); };
    const r = await runTick(svc, { dryRun: false, jitter: false });
    expect(r.paused).toBe(true);
    expect(r.reason).toMatch(/Engel: verification/);
    expect(calls.errors).toEqual([{ id: 'q1', msg: expect.stringMatching(/Engel/), fail: false }]);
    expect(calls.shots).toEqual(['q1-engel']);
    expect(calls.bumps).toBe(0);
  });

  it('ritim: gercek tick %25 rastgele atlanir (jitter varsayilan acik); kuru ve elle tick atlanmaz', async () => {
    (Math.random as any).mockReturnValue(0.1);
    const { svc, calls } = makeService();
    expect((await runTick(svc, { dryRun: false })).skipped).toBe(true);
    expect((await runTick(svc, { dryRun: false, jitter: true })).skipped).toBe(true);
    expect((await runTick(svc, { dryRun: false, jitter: false })).skipped).toBeUndefined();
    expect((await runTick(svc, { dryRun: true })).skipped).toBeUndefined();
    expect(calls.locked).toBe(2);
    (Math.random as any).mockReturnValue(0.5);
    expect((await runTick(svc, { dryRun: false })).skipped).toBeUndefined();
  });

  it('calisma penceresi kuru modda da gecerli; force:true yalniz kuru tick icin asar', async () => {
    vi.setSystemTime(new Date('2026-08-29T07:00:00Z')); // Cumartesi
    const { svc, calls } = makeService();
    expect((await runTick(svc, { dryRun: true })).reason).toMatch(/Çalışma penceresi dışı/);
    expect((await runTick(svc, { dryRun: true, force: true })).actions.length).toBe(1);
    expect((await runTick(svc, { dryRun: false, force: true, jitter: false })).reason).toMatch(/Çalışma penceresi dışı/);
    expect(calls.locked).toBe(1);
  });

  it('kuru tick sayaclari oynatmaz: hata olsa da setError/bump yok', async () => {
    const { svc, calls } = makeService({ run: async () => { throw new Error('x'); } });
    const r = await runTick(svc, { dryRun: true });
    expect(r.actions[0].ok).toBe(false);
    expect(calls.errors).toEqual([]);
    expect(calls.bumps).toBe(0);
    expect(calls.shots).toEqual(['q1-hata']);
  });
});

describe('arastirma unvan filtresi (isTargetTitle / researchKademe)', () => {
  it('pazarlama unvanlari gecer, muhendis/QA/tasarimci elenir', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.isTargetTitle('Dijital Pazarlama Direktörü')).toBe(true);
    expect(m.isTargetTitle('Brand Marketing Manager')).toBe(true);
    expect(m.isTargetTitle('Growth Lead')).toBe(true);
    expect(m.isTargetTitle('Senior Android Engineer')).toBe(false);
    expect(m.isTargetTitle('Senior QA Engineer at Getir')).toBe(false);
    expect(m.isTargetTitle('Product Designer - Getir')).toBe(false);
    expect(m.isTargetTitle('Marketing Data Engineer')).toBe(false);
    expect(m.isTargetTitle('')).toBe(false);
  });
  it('kademe: direktor/mudur/head → 1, uzman → 2', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.researchKademe('Pazarlama Direktörü')).toBe(1);
    expect(m.researchKademe('Head of Growth')).toBe(1);
    expect(m.researchKademe('Dijital Pazarlama Uzmanı')).toBe(2);
  });
  it('parseSearchResults: unvan satiri manager kelimesi olmadan da okunur, konum satiri unvan sanilmaz', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const snap = [
      '- link "Nilay Yıldız Sayar" [ref=e10] /url: https://www.linkedin.com/in/nilay-yildiz-sayar/',
      '- generic "Senior Android Engineer"',
      '- generic "Ankara, Türkiye"',
      '- link "Ayşe Demir" [ref=e20] /url: https://www.linkedin.com/in/ayse-demir-123/',
      '- generic "Dijital Pazarlama Direktörü"',
      '- generic "İstanbul, Türkiye"',
    ].join('\n');
    const hits = m.parseSearchResults(snap);
    expect(hits.map((h) => h.unvan)).toEqual(['Senior Android Engineer', 'Dijital Pazarlama Direktörü']);
    expect(hits.filter((h) => m.isTargetTitle(h.unvan)).map((h) => h.soyad)).toEqual(['Demir']);
  });
});

describe('pickTitleFromCard — DOM kart satirlarindan unvan', () => {
  it('isimden sonraki ilk unvan satiri; derece, konum ve Mevcut: satirlari atlanir', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const lines = ['Nilay Yıldız Sayar', '· 2.', 'Senior Android Engineer', 'Ankara, Türkiye', 'Mevcut: Getir şirketinde Senior Software Engineer - I', 'HARUN KÖR, Hande Hoşkal ve 38 diğer ortak bağlantınız', 'Bağlantı kur'];
    expect(m.pickTitleFromCard(lines, 'Nilay Yıldız Sayar')).toBe('Senior Android Engineer');
    expect(m.isTargetTitle(m.pickTitleFromCard(lines, 'Nilay Yıldız Sayar'))).toBe(false);
    const l2 = ['Ayşe Demir', '· 2.', 'Dijital Pazarlama Direktörü @ Papara', 'İstanbul, Türkiye', 'Bağlantı kur'];
    expect(m.pickTitleFromCard(l2, 'Ayşe Demir')).toBe('Dijital Pazarlama Direktörü @ Papara');
    expect(m.pickTitleFromCard(['Bağlantı kur'], 'Ali Veli')).toBe('');
  });
});

describe('arastirma — arama URL\'si ve firma eslesmesi', () => {
  it('researchSearchUrl: her terim AYRI arama (boolean yok); facet varsa currentCompany + terim, yoksa "<firma> <terim>"', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const f = new URL(m.researchSearchUrl(' Papara ', '10232743'));
    expect(f.pathname).toBe('/search/results/people/');
    expect(f.searchParams.get('currentCompany')).toBe('["10232743"]');
    expect(f.searchParams.get('keywords')).toBe('CEO');
    const urls = m.researchSearchUrls('Papara', '10232743');
    expect(urls).toHaveLength(m.RESEARCH_KEYWORD_QUERIES.length);
    expect(urls.length).toBeGreaterThanOrEqual(10);
    const kws = urls.map((u) => new URL(u).searchParams.get('keywords'));
    expect(kws).toEqual([...m.RESEARCH_KEYWORD_QUERIES]);
    for (const k of kws) { expect(k).not.toMatch(/\bOR\b|\bAND\b|[()]/); } // birlesik arama yok
    expect(kws.slice(0, 6)).toEqual(['CEO', 'CTO', 'CMO', 'Founder', 'Kurucu', 'Genel Müdür']); // ust yonetim once
    expect(kws).toContain('Pazarlama');
    expect(kws).toContain('Marketing');
    const y = new URL(m.researchSearchUrl('Papara', null, 'Pazarlama'));
    expect(y.searchParams.get('currentCompany')).toBeNull();
    expect(y.searchParams.get('keywords')).toBe('Papara Pazarlama');
    expect(m.researchSearchUrls('Papara', null)).toHaveLength(m.RESEARCH_KEYWORD_QUERIES.length);
    // Yutulan parametreler kullanilmiyor
    for (const u of [f, y]) { expect(u.searchParams.get('title')).toBeNull(); expect(u.searchParams.get('titleFreeText')).toBeNull(); }
  });

  it('pickCompanySlug: birebir ad once; "Acquired by X" / "X Menkul" sonra; hicbiri yoksa ilk; encode cozulur', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const links = [
      { href: 'https://www.linkedin.com/company/finfreeapp/', text: 'Finfree (Acquired by Papara)\n\nFinansal Hizmetler' },
      { href: 'https://www.linkedin.com/company/papara-menkul-de%C4%9Ferler/', text: 'Papara Menkul Değerler\n\nFinansal Hizmetler' },
      { href: 'https://www.linkedin.com/company/papara/', text: 'Papara \n\nFinansal Hizmetler\n\nIstanbul' },
      { href: 'https://www.linkedin.com/company/papara/', text: 'Papara' },
    ];
    expect(m.pickCompanySlug(links, 'Papara')).toBe('papara');
    expect(m.pickCompanySlug(links.slice(0, 2), 'Papara')).toBe('papara-menkul-değerler'); // "papara menkul…" ile baslayan
    expect(m.pickCompanySlug(links.slice(0, 1), 'Papara')).toBe('finfreeapp'); // iceren
    expect(m.pickCompanySlug([{ href: 'https://www.linkedin.com/company/x/', text: 'X' }], 'Papara')).toBe('x'); // ilk
    expect(m.pickCompanySlug([], 'Papara')).toBeNull();
    expect(m.pickCompanySlug(links, '')).toBeNull();
    expect(m.pickCompanySlug([{ href: 'https://www.linkedin.com/company/turk-hava-yollari/', text: 'Türk Hava Yolları A.Ş.' }], 'Türk Hava Yolları')).toBe('turk-hava-yollari');
  });

  it('pickCompanyId: network= icermeyen "Çalışanları gör" baglantisi once; encode cozulur', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const hs = [
      'http://www.linkedin.com/search/results/people/?origin=COMPANY_PAGE_CANNED_SEARCH&network=%5B%22F%22%5D&currentCompany=%5B%2220323326%22%5D',
      'https://www.linkedin.com/search/results/people/?currentCompany=%5B%2210232743%22%5D&origin=COMPANY_PAGE_CANNED_SEARCH',
    ];
    expect(m.pickCompanyId(hs)).toBe('10232743');
    expect(m.pickCompanyId(hs.slice(0, 1))).toBe('20323326');
    expect(m.pickCompanyId(['https://www.linkedin.com/company/papara/people/'])).toBeNull();
    expect(m.pickCompanyId([])).toBeNull();
  });

  it('isAnonymousMember: "LinkedIn Üyesi"/"LinkedIn Member" aday degil', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.isAnonymousMember('LinkedIn Üyesi')).toBe(true);
    expect(m.isAnonymousMember('LinkedIn Member')).toBe(true);
    expect(m.isAnonymousMember('Ayşe Demir')).toBe(false);
  });

  it('cardCompanyMatch: Mevcut/Current → current; yalniz Geçmiş → past; baslikta firma → headline; hicbiri → none', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.cardCompanyMatch(['Ayşe Demir', '· 2.', 'Pazarlama Müdürü', 'İstanbul, Türkiye', 'Mevcut: Papara Elektronik Para A.Ş. şirketinde Pazarlama Müdürü'], 'Papara', 'Pazarlama Müdürü')).toBe('current');
    expect(m.cardCompanyMatch(['John Doe', '· 2nd', 'Marketing Manager', 'Current: Marketing Manager at Getir'], 'Getir', 'Marketing Manager')).toBe('current');
    expect(m.cardCompanyMatch(['Okan Özmen • 2.', 'Software Engineer', 'Ordu, Türkiye', 'Bağlantı kur', 'Geçmiş: Papara şirketinde Senior Software Engineer'], 'Papara', 'Software Engineer')).toBe('past');
    expect(m.cardCompanyMatch(['Ayşe Demir', '· 2.', 'Dijital Pazarlama Direktörü @ Papara', 'İstanbul, Türkiye'], 'Papara', 'Dijital Pazarlama Direktörü @ Papara')).toBe('headline');
    expect(m.cardCompanyMatch(['Ali Veli', "Trendyol'da Marka Müdürü"], 'Trendyol', "Trendyol'da Marka Müdürü")).toBe('headline');
    // Baska firmada pazarlamaci: "Papara" aramasinda cikti ama firma yok → none
    expect(m.cardCompanyMatch(['Deniz Lök', '· 2.', 'Satış uzmanı', 'Mevcut: Samka Metal Ambalaj şirketinde Satış ve Pazarlama Uzmanı'], 'Papara', 'Satış uzmanı')).toBe('none');
    // Cok kelimeli firma: tum anlamli parcalar gerekli
    expect(m.cardCompanyMatch(['X Y', 'Mevcut: Türk Hava Yolları şirketinde Pazarlama Müdürü'], 'Türk Hava Yolları', 'Pazarlama Müdürü')).toBe('current');
    expect(m.cardCompanyMatch(['X Y', 'Mevcut: Türk Telekom şirketinde Pazarlama Müdürü'], 'Türk Hava Yolları', 'Pazarlama Müdürü')).toBe('none');
    expect(m.cardCompanyMatch([], '', 'Pazarlama Müdürü')).toBe('none');
  });

  it('urlMatchesTarget: yol + hedef sorgu parametreleri (origin haric) ayni olmali', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const target = m.researchSearchUrl('Papara');
    expect(m.urlMatchesTarget(target, target)).toBe(true);
    expect(m.urlMatchesTarget(target.replace('origin=GLOBAL_SEARCH_HEADER', 'origin=FACETED_SEARCH') + '&sid=abc', target)).toBe(true);
    expect(m.urlMatchesTarget(m.researchSearchUrl('Getir'), target)).toBe(false);
    // Facet URL: LinkedIn parametre sirasini degistirir — sira onemsiz
    const facet = m.researchSearchUrl('Papara', '10232743');
    expect(m.urlMatchesTarget('https://www.linkedin.com/search/results/people/?keywords=CEO&origin=FACETED_SEARCH&currentCompany=%5B%2210232743%22%5D', facet)).toBe(true);
    expect(m.urlMatchesTarget('https://www.linkedin.com/feed/', target)).toBe(false);
    expect(m.urlMatchesTarget('https://www.linkedin.com/checkpoint/challenge/', target)).toBe(false);
    expect(m.urlMatchesTarget('', target)).toBe(false);
    expect(m.urlMatchesTarget('bozuk', target)).toBe(false);
  });
});

describe('isTargetTitle — ust yonetim/kurucu + pazarlama ailesi', () => {
  it('CEO/CTO/founder/kurucu/genel mudur/direktor/head/VP kabul, kademe 1', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    for (const t of ['CEO', 'Chief Executive Officer', 'CTO at Papara', 'Co-Founder & CEO', 'Kurucu Ortak', 'Founder', 'Genel Müdür', 'Genel Müdür Yardımcısı (GMY)', 'Managing Director', 'Country Manager Turkey', 'Satış Direktörü', 'Head of Product', 'VP of Sales', 'İcra Kurulu Üyesi', 'Chief Product Officer', 'Chief Revenue Officer']) {
      expect(m.isTargetTitle(t), t).toBe(true);
      expect(m.researchKademe(t), t).toBe(1);
    }
  });
  it('pazarlama ailesi her kademede kabul; mudur/manager kademe 1, uzman kademe 2', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.isTargetTitle('Dijital Pazarlama Müdürü')).toBe(true);
    expect(m.researchKademe('Dijital Pazarlama Müdürü')).toBe(1);
    expect(m.isTargetTitle('Brand Marketing Manager')).toBe(true);
    expect(m.isTargetTitle('Growth Specialist')).toBe(true);
    expect(m.researchKademe('Growth Specialist')).toBe(2);
    expect(m.isTargetTitle('Marketing Director, Luxury Brands')).toBe(true); // "ux" alt dizesi elemesin
    expect(m.isTargetTitle('İletişim Direktörü')).toBe(true); // buyuk İ (U+0130) regex i-bayragina takilmasin
    expect(m.isTargetTitle('MARKETING DIRECTOR')).toBe(true);
    expect(m.isTargetTitle('İNSAN KAYNAKLARI DİREKTÖRÜ')).toBe(false);
  });
  it('hedef disi: CFO/CHRO/CISO/CLO, muhendislik yoneticisi, duz manager, IK, stajyer', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    for (const t of ['CFO', 'Chief Financial Officer', 'Chief Human Resources Officer', 'Chief People Officer', 'Chief Information Security Officer', 'Chief Legal Officer', 'Chief Risk Officer', 'Engineering Manager', 'Software Development Manager', 'Product Manager', 'Project Manager', 'Operations Director', 'Finans Direktörü', 'İnsan Kaynakları Müdürü', 'Marketing Intern', 'Senior Software Engineer', 'Head of IT', 'Chief Accountant', 'People & Culture Director', 'Business Intelligence Director', 'Chief Data Officer', 'Kurucu Avukat', 'General Counsel', 'Executive Assistant to CEO', 'CEO Asistanı', 'Co-Founder & Trainer', 'Growth Coach', 'CS Business Strategy Executive at Getir', 'Sales Executive', 'CEO Office', 'Head of CEO Office', 'CEO Office Senior Lead', 'CEO | CFO | Private Investor', 'DİREKTÖR /ENDÜSTRİ İLİŞKİLERİ & DESTEK HİZMETLER', 'CIO', 'Talent & Culture Director', 'Talent Acquisition & Employer Branding Director', 'Direktör, Kurumsal Krediler ve Sürdürülebilirlik Riski', 'Executive Director, Global Markets - Quantitative Solutions', 'İç Denetim Direktörü', 'Compliance Director', 'Associate Director of Information Technology @ Turkcell', 'Associate Director, AI Science', 'Lead Business Analyst | FinTech, Digital Banking', 'Head of Employee Experience and Akbank Academy', 'Head of Infrastructure Technologies', 'Özel Bankacılık Pazarlama Uzman Yardımcısı', 'Satış ve Pazarlama Yetkilisi', 'Junior Marketing Specialist', '']) {
      expect(m.isTargetTitle(t), t).toBe(false);
    }
  });
});

describe('currentTitleFromCard — "Mevcut:" satirindan pozisyon unvani', () => {
  it('TR "X şirketinde Y", EN "Y at X"; yoksa bos', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.currentTitleFromCard(['Türker Karakaş', '• 2.', 'Growth', 'Beşiktaş, İstanbul, Türkiye', 'Takip Et', 'Mevcut: Papara şirketinde Director of Growth'])).toBe('Director of Growth');
    expect(m.researchKademe(m.currentTitleFromCard(['Mevcut: Papara şirketinde Director of Growth']))).toBe(1);
    expect(m.currentTitleFromCard(['Current: Marketing Manager at Getir'])).toBe('Marketing Manager');
    expect(m.currentTitleFromCard(['Mevcut: Papara şirketinde Software Engineering Manager - …their professional growth while'])).toBe('Software Engineering Manager');
    expect(m.currentTitleFromCard(['Ayşe Demir', '• 2.', 'Pazarlama Müdürü', 'Geçmiş: X şirketinde Y'])).toBe('');
    expect(m.currentTitleFromCard([])).toBe('');
  });
});

describe('headlineNamesOtherCompany — facet modunda baska firma basligi', () => {
  it('"at X" / "@ X" / "X şirketinde" / "X\'da" baska firma → true; firma basligin icindeyse false', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.headlineNamesOtherCompany('Co-Founder at Finfree Co', 'Papara')).toBe(true);
    expect(m.headlineNamesOtherCompany('CEO @ SuperMassive', 'Papara')).toBe(true);
    expect(m.headlineNamesOtherCompany('Acme şirketinde Genel Müdür', 'Papara')).toBe(true);
    expect(m.headlineNamesOtherCompany("Acme'de Pazarlama Direktörü", 'Papara')).toBe(true);
    expect(m.headlineNamesOtherCompany('CEO at Papara', 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany('Head of Product @ Papara | Products People Love', 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany("Papara'da Marka Müdürü", 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany('CTO', 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany('SuperMassive CEO (Esports Investment)', 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany('Founder - MLS Marine Ship Supply Co.', 'Getir')).toBe(true); // sirket eki
    expect(m.headlineNamesOtherCompany('Founder - CEO', 'Papara')).toBe(false);
    expect(m.headlineNamesOtherCompany('Kurucu | VizeFirmalari.com | Dijital Platform Geliştiricisi', 'Migros')).toBe(true); // alan adi
    expect(m.headlineNamesOtherCompany('Tazeantep.com Founder', 'Trendyol')).toBe(true);
    expect(m.headlineNamesOtherCompany('Trendyol.com Marka Müdürü', 'Trendyol')).toBe(false); // firma kendi alan adi
    expect(m.isFounderOrCLevel('Co-Founder')).toBe(true);
    expect(m.isFounderOrCLevel('CTO')).toBe(true);
    expect(m.isFounderOrCLevel('Performance Marketing Director')).toBe(false);
    expect(m.headlineNamesOtherCompany('', 'Papara')).toBe(false);
  });
});

describe('looksLikePersonName — sirket hesaplari kisi degil', () => {
  it('kucuk harf sart, rakam/sirket kelimesi yok', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    for (const ok of ['Fatih BAYINDIR', 'Ayşe Demir', 'Ahmed F. Karslı', 'İnci Seda Cankurtaran Cuco', "Deniz O'Neil"]) expect(m.looksLikePersonName(ok), ok).toBe(true);
    for (const bad of ['BF AYDINLATMA', 'ACME LTD', 'Acme Bilişim', 'Papara Teknoloji', 'Ali 123', 'X Y Holding', '']) expect(m.looksLikePersonName(bad), bad).toBe(false);
    // Chief Executive Officer / Executive Director hala ust yonetim; duz "Executive" degil
    expect(m.isTargetTitle('Chief Executive Officer')).toBe(true);
    expect(m.isTargetTitle('Executive Director')).toBe(true);
    expect(m.isTargetTitle('Corporate Communications Executive at Getir')).toBe(true); // iletisim ailesi, kademe 2
    expect(m.researchKademe('Corporate Communications Executive at Getir')).toBe(2);
  });
});

describe('planTick — researchOnly', () => {
  it('kuyrukta QUEUED varken bile 3 slot arastirmaya kalir; istek/mesaj plana girmez', () => {
    const counters: TickCounters = { requestsToday: 0, messagesToday: 0, requestsWeek: 0, researchToday: 0, companyRequestsToday: {} };
    const q = (id: string, firma = 'Papara') => ({ id, firma }) as any;
    const queue: TickQueue = { accepted: [q('a1')], requested: [q('r1')], queued: [q('q1'), q('q2'), q('q3', 'Getir')], messagedCount: 2, researchTargets: ['Getir', 'Trendyol', 'Hepsiburada', 'Migros'] };
    const plan = planTick(counters, queue, DEFAULT_LIMITS, { researchOnly: true });
    expect(plan.map((p) => p.type)).toEqual(['research', 'research', 'research']);
    expect(plan.map((p: any) => p.firma)).toEqual(['Getir', 'Trendyol', 'Hepsiburada']);
    // Normal planda istekler once gelir, arastirmaya en fazla kalan slot
    const normal = planTick(counters, queue, DEFAULT_LIMITS);
    expect(normal.filter((p) => p.type === 'research').length).toBeLessThan(3);
    // Gunluk arastirma siniri researchOnly'de de gecerli
    const limited = planTick({ ...counters, researchToday: DEFAULT_LIMITS.MAX_RESEARCH_PER_DAY }, queue, DEFAULT_LIMITS, { researchOnly: true });
    expect(limited).toEqual([]);
  });
});

describe('kampanya sablonlari (musteri / yatirimci / is birligi)', () => {
  it('renderNote: her kampanya farkli metin, hepsi <=300 karakter, hitap dogru', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const p = { ad: 'Ayşe', soyad: 'Demir', firma: 'Trendyol', sektor: 'eticaret-perakende-teknoloji' };
    const musteri = m.renderNote({ ...p, kampanya: 'MUSTERI' });
    const yatirimci = m.renderNote({ ...p, kampanya: 'YATIRIMCI' });
    const isbirligi = m.renderNote({ ...p, kampanya: 'ISBIRLIGI' });
    for (const n of [musteri, yatirimci, isbirligi]) {
      expect(n.length).toBeLessThanOrEqual(m.NOTE_MAX_CHARS);
      expect(n.startsWith('Merhaba Ayşe Demir')).toBe(true);
    }
    expect(new Set([musteri, yatirimci, isbirligi]).size).toBe(3);
    expect(yatirimci).toMatch(/kurucusuyum/);
    expect(isbirligi).toMatch(/iş birliği|İş birliği/);
    // Kampanya verilmezse musteri sablonu
    expect(m.renderNote(p)).toBe(musteri);
    expect(m.renderNote({ ...p, kampanya: 'BILINMEYEN' as any })).toBe(musteri);
  });

  it('renderMessage: yatirimci/isbirligi mesajlari ret garantisi tasir, dogrulanmamis sayi icermez', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const p = { ad: 'Ali', soyad: 'Veli', firma: 'Migros', sektor: null };
    for (const k of ['MUSTERI', 'YATIRIMCI', 'ISBIRLIGI'] as const) {
      const msg = m.renderMessage({ ...p, kampanya: k });
      expect(msg).toMatch(/bir daha yazmayacağım/);
      // Sablonda hicbir yuzde/adet iddiasi olmamali (tek kaynakli sayi yasagi)
      expect(msg).not.toMatch(/%\d|\d+\s*(müşteri|kurum|marka|kullanıcı)/);
    }
    expect(m.renderMessage({ ...p, kampanya: 'YATIRIMCI' })).toMatch(/20 dakika/);
  });

  it('normalizeKampanya: bilinmeyen deger MUSTERI', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.normalizeKampanya('yatirimci')).toBe('YATIRIMCI');
    expect(m.normalizeKampanya('ISBIRLIGI')).toBe('ISBIRLIGI');
    expect(m.normalizeKampanya(null)).toBe('MUSTERI');
    expect(m.normalizeKampanya('x')).toBe('MUSTERI');
  });
});

describe('parseSearchUrls / currentCompanyFromCard', () => {
  it('yalniz linkedin kisi arama URL\'leri kabul; tekrar temizlenir; gecersizler sayilir', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const r = m.parseSearchUrls([
      'https://www.linkedin.com/search/results/people/?keywords=CEO&origin=SWITCH_SEARCH_VERTICAL',
      'linkedin.com/search/results/people/?keywords=CMO',
      'https://www.linkedin.com/search/results/people/?keywords=CEO&origin=SWITCH_SEARCH_VERTICAL',
      'https://www.linkedin.com/in/ayse-demir/',
      'https://www.linkedin.com/search/results/companies/?keywords=Papara',
      'https://google.com/search?q=ceo',
      'saçma satır',
    ].join('\n'));
    expect(r.urls).toHaveLength(2);
    expect(r.urls[0]).toContain('keywords=CEO');
    expect(r.urls[1]).toBe('https://www.linkedin.com/search/results/people/?keywords=CMO');
    expect(r.gecersiz).toHaveLength(4); // profil, sirket aramasi, google, 'saçma satır'
    expect(m.parseSearchUrls('').urls).toEqual([]);
  });

  it('currentCompanyFromCard: Mevcut/Current satiri, yoksa baslik; bulunamazsa bos', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.currentCompanyFromCard(['Ayşe Demir', '• 2.', 'Pazarlama Müdürü', 'Mevcut: Trendyol Grup şirketinde Pazarlama Müdürü'])).toBe('Trendyol Grup');
    expect(m.currentCompanyFromCard(['John', 'Current: Marketing Manager at Getir'])).toBe('Getir');
    expect(m.currentCompanyFromCard(['Ali'], 'CTO at Papara')).toBe('Papara');
    expect(m.currentCompanyFromCard(['Ali'], 'Head of Product @ Getir | Products People Love')).toBe('Getir');
    expect(m.currentCompanyFromCard(['Ali'], 'CTO')).toBe('');
    expect(m.currentCompanyFromCard([])).toBe('');
  });
});

describe('sayfalama ve firma cikarimi (30.08 kullanici ekrani)', () => {
  it('searchUrlWithPage: sayfa 1 parametresiz, 2+ page=N, sinir 10', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const u = 'https://www.linkedin.com/search/results/people/?keywords=cto&origin=SWITCH_SEARCH_VERTICAL';
    expect(m.searchUrlWithPage(u, 1)).not.toContain('page=');
    expect(new URL(m.searchUrlWithPage(u, 3)).searchParams.get('page')).toBe('3');
    expect(new URL(m.searchUrlWithPage(u, 99)).searchParams.get('page')).toBe(String(m.MAX_SEARCH_PAGES));
    expect(new URL(m.searchUrlWithPage(u, 0)).searchParams.get('page')).toBeNull();
    // Mevcut page parametresi degistirilir, digerleri korunur
    const withPage = m.searchUrlWithPage(`${u}&page=2`, 4);
    expect(new URL(withPage).searchParams.get('page')).toBe('4');
    expect(new URL(withPage).searchParams.get('keywords')).toBe('cto');
    expect(m.searchUrlWithPage('bozuk-url', 2)).toBe('bozuk-url');
  });

  it('cekirdek hedef unvanlar negatif kelimeye ragmen kabul; hedef disi C-level yine elenir', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    // Kullanicinin ekranindaki gercek ornekler
    expect(m.isTargetTitle('Founder & CTO at FinPay Software')).toBe(true);
    expect(m.isTargetTitle('CTO & Head of Engineering at Vakko')).toBe(true);
    expect(m.isTargetTitle('Co-founder & CTO at Cypher Games')).toBe(true);
    expect(m.isTargetTitle('Chief Technology Officer  - fintech')).toBe(true);
    // Muafiyet hedef disi C-level'lari geri getirmez
    expect(m.isTargetTitle('CFO')).toBe(false);
    expect(m.isTargetTitle('Chief Human Resources Officer')).toBe(false);
    expect(m.isTargetTitle('Chief Information Security Officer')).toBe(false);
    // Orta kademe muhendislik hala elenir
    expect(m.isTargetTitle('Engineering Manager')).toBe(false);
    expect(m.isTargetTitle('Software Engineering Manager at Papara')).toBe(false);
  });

  it('currentCompanyFromCard: tire/virgul kalibi buyuk harfli firmayi alir, alan tanimini almaz', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.currentCompanyFromCard([], 'CTO - Getmobil')).toBe('Getmobil');
    expect(m.currentCompanyFromCard([], 'CTO, Cypher Games')).toBe('Cypher Games');
    expect(m.currentCompanyFromCard([], 'Chief Technology Officer  - fintech')).toBe('');
    expect(m.currentCompanyFromCard([], 'Founder & CTO')).toBe('');
    // "at" kalibi tireden once gelir
    expect(m.currentCompanyFromCard([], 'CTO at Hepsiburada - İstanbul')).toBe('Hepsiburada');
  });
});

describe('panel ayarlari (fren + calisma penceresi)', () => {
  it('normalizePanelAyarlari: tavana kirpar, gecersizi atar, bozuk pencereyi varsayilana birakir', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const a = m.normalizePanelAyarlari({ MAX_REQUESTS_PER_DAY: 999, MAX_MESSAGES_PER_DAY: 0, WORK_HOUR_START: 8, WORK_HOUR_END: 20, WORK_DAYS: [1, 2, 3, 4, 5, 6], bilinmeyen: 5 });
    expect(a.MAX_REQUESTS_PER_DAY).toBe(m.AYAR_TAVAN.MAX_REQUESTS_PER_DAY.max); // 999 → tavan
    expect(a.MAX_MESSAGES_PER_DAY).toBe(1); // 0 → alt sinir
    expect(a.WORK_HOUR_START).toBe(8);
    expect(a.WORK_HOUR_END).toBe(20);
    expect(a.WORK_DAYS).toEqual([1, 2, 3, 4, 5, 6]);
    expect((a as any).bilinmeyen).toBeUndefined();
    // Bitis <= baslangic → pencere ayari yok sayilir
    const b = m.normalizePanelAyarlari({ WORK_HOUR_START: 18, WORK_HOUR_END: 9 });
    expect(b.WORK_HOUR_START).toBeUndefined();
    expect(b.WORK_HOUR_END).toBeUndefined();
    expect(m.normalizePanelAyarlari(null)).toEqual({});
    expect(m.normalizePanelAyarlari({ WORK_DAYS: [] }).WORK_DAYS).toBeUndefined();
    expect(m.normalizePanelAyarlari({ WORK_DAYS: [9, -1, 3] }).WORK_DAYS).toEqual([3]);
  });

  it('applyPanelAyarlari + isWorkWindow: panelden verilen saat/gun gecerli olur', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const limits = m.applyPanelAyarlari(m.DEFAULT_LIMITS, m.normalizePanelAyarlari({ WORK_HOUR_START: 8, WORK_HOUR_END: 22, WORK_DAYS: [0, 6] }));
    expect(limits.WORK_HOUR_START).toBe(8);
    expect(limits.MAX_REQUESTS_PER_DAY).toBe(m.DEFAULT_LIMITS.MAX_REQUESTS_PER_DAY); // dokunulmayan alan korunur
    const pazar20 = new Date('2026-08-30T17:00:00Z'); // Pazar 20:00 TR
    expect(m.isWorkWindow(pazar20, m.DEFAULT_LIMITS)).toBe(false); // varsayilan: hafta ici
    expect(m.isWorkWindow(pazar20, limits)).toBe(true); // panelde hafta sonu + 08-22 acildi
    const pazartesi7 = new Date('2026-08-31T04:00:00Z'); // Pazartesi 07:00 TR
    expect(m.isWorkWindow(pazartesi7, limits)).toBe(false); // pazartesi WORK_DAYS'te yok
  });
});

describe('30.08 denetim duzeltmeleri', () => {
  it('findRef include: kelime siniri — "Ali" kaydi "Alican" satirini secmez', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const snap = [
      '- button "Alican Demirtaş adlı kişiyi bağlantı kurmaya davet et" [ref=e10]',
      '- button "Ali Can adlı kişiyi bağlantı kurmaya davet et" [ref=e11]',
    ].join('\n');
    expect(m.findRef(snap, ['bağlantı'], { role: 'button', include: ['ali', 'can'] })).toBe('e11');
    // Yalniz yabancinin satiri varsa HICBIR SEY donmemeli
    const yalnizYabanci = '- button "Alican Demirtaş adlı kişiyi bağlantı kurmaya davet et" [ref=e10]';
    expect(m.findRef(yalnizYabanci, ['bağlantı'], { role: 'button', include: ['ali', 'can'] })).toBeNull();
  });

  it('matchUnreadToProspects: kartta birden cok profil linki varsa hepsi REPLIED olmaz', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const eski = new Date('2026-08-20T10:00:00Z');
    const konusma = {
      text: 'Ayşe Kaya Burak Şen Siz: Merhaba Burak Şen, bağlantı için teşekkürler Cem Ak',
      unread: true,
      links: ['https://www.linkedin.com/in/ayse-kaya/', 'https://www.linkedin.com/in/burak-sen/', 'https://www.linkedin.com/in/cem-ak/'],
      lastAt: new Date('2026-08-25T10:00:00Z'),
    } as any;
    const kisiler = [
      { id: 'a', ad: 'Ayşe', soyad: 'Kaya', firma: 'X', profileUrl: 'https://www.linkedin.com/in/ayse-kaya/', messagedAt: eski },
      { id: 'b', ad: 'Burak', soyad: 'Şen', firma: 'Y', profileUrl: 'https://www.linkedin.com/in/burak-sen/', messagedAt: eski },
    ] as any;
    const r = m.matchUnreadToProspects([konusma], kisiler);
    expect(r.replied).toEqual([]); // ikisi birden isaretlenmez
    expect(r.ambiguous.sort()).toEqual(['a', 'b']); // insan baksin
  });

  it('applyPanelAyarlari: env freni panelden GEVSETILEMEZ (oldurme anahtari korunur)', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const env = { LINKEDIN_MAX_ACTIONS_PER_TICK: '0', LINKEDIN_MAX_REQUESTS_PER_DAY: '5' };
    const l = m.applyPanelAyarlari(m.DEFAULT_LIMITS, { MAX_ACTIONS_PER_TICK: 6, MAX_REQUESTS_PER_DAY: 20, WORK_HOUR_START: 8 }, env);
    expect(l.MAX_ACTIONS_PER_TICK).toBe(0); // env kill-switch kazanir
    expect(l.MAX_REQUESTS_PER_DAY).toBe(5); // env tavani kazanir
    expect(l.WORK_HOUR_START).toBe(8); // saat tercihi env kapsaminda degil
    // env yoksa panel degeri gecerli
    const l2 = m.applyPanelAyarlari(m.DEFAULT_LIMITS, { MAX_REQUESTS_PER_DAY: 8 }, {});
    expect(l2.MAX_REQUESTS_PER_DAY).toBe(8);
  });

  it('normalizePanelAyarlari: bos/null deger 0 sayilmaz (kutu temizlenince bot durmasin)', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    const a = m.normalizePanelAyarlari({ MAX_ACTIONS_PER_TICK: '', MAX_REQUESTS_PER_DAY: null, MAX_MESSAGES_PER_DAY: 7 });
    expect(a.MAX_ACTIONS_PER_TICK).toBeUndefined();
    expect(a.MAX_REQUESTS_PER_DAY).toBeUndefined();
    expect(a.MAX_MESSAGES_PER_DAY).toBe(7);
    // Bilincli 0 (oldurme anahtari) yine gecerli
    expect(m.normalizePanelAyarlari({ MAX_ACTIONS_PER_TICK: 0 }).MAX_ACTIONS_PER_TICK).toBe(0);
  });

  it('currentCompanyFromCard: rol kelimesi firma sanilmaz ("CFO & Co-Founder")', async () => {
    const m = await import('./linkedin-outreach-rules.js');
    expect(m.currentCompanyFromCard([], 'CFO & Co-Founder')).toBe('');
    expect(m.currentCompanyFromCard([], 'CTO - Getmobil')).toBe('Getmobil'); // gercek firma bozulmadi
    expect(m.currentCompanyFromCard([], 'Growth Lead, Freelance')).toBe('');
  });
});
