/**
 * Cerez onayi: karar tablosu (secim yok -> hicbir sey yuklenmez; kabul -> yuklenir;
 * ret -> asla; bozuk kayit -> secim yok), etiket yukleme sirasi, geri alma ve
 * cerez silme. Ayrica kok layout'un GTM/Clarity'yi bir daha onaysiz yuklemedigi
 * ve gizlilik metninin gercek araclari andigi kaynak metinden denetlenir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLARITY_SCRIPT_ID,
  CONSENT_CHANGE_EVENT,
  CONSENT_MAX_AGE_MS,
  CONSENT_REOPEN_EVENT,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  GA_SCRIPT_ID,
  GTM_SCRIPT_ID,
  announceConsentChange,
  clearTrackingCookies,
  cookieDomains,
  createConsentController,
  expireCookieAssignments,
  gaPageParams,
  isTrackingCookie,
  loadTrackers,
  maskTokenUrl,
  openCookiePreferences,
  parseConsent,
  planConsent,
  readConsent,
  revokeTrackers,
  serializeConsent,
  shouldLoadTrackers,
  trackersPresent,
  trackingCookieNames,
  validClarityId,
  validGaId,
  validGtmId,
  writeConsent,
  type ConsentPageEnv,
  type ConsentPlan,
  type ConsentState,
  type ConsentStorage,
  type ConsentTrigger,
  type TagEnv,
  type TagWindow,
} from './consent';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY = 86_400_000;
const IDS = { gtmId: 'GTM-TSH8KWCC', clarityId: 'x8l5as16yd' };

const DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
const GRANTED = { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' };

/** v2 kaydi; alanlar ezilebilir */
const v2 = (choice: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ v: CONSENT_VERSION, choice, ts: NOW - DAY, ...extra });

function memoryStorage(initial: string | null = null): ConsentStorage & { value: string | null } {
  const s = {
    value: initial,
    getItem: (key: string) => (key === CONSENT_STORAGE_KEY ? s.value : null),
    setItem: (key: string, value: string) => {
      if (key === CONSENT_STORAGE_KEY) s.value = value;
    },
  };
  return s;
}

type FakeEnv = TagEnv & { win: TagWindow; scripts: Map<string, string>; written: string[] };

function fakeEnv(opts: { cookies?: string; hostname?: string } = {}): FakeEnv {
  const scripts = new Map<string, string>();
  const written: string[] = [];
  return {
    win: {},
    hostname: opts.hostname ?? 'ranksup.ai',
    now: () => NOW,
    hasScript: (id) => scripts.has(id),
    addScript: (id, src) => {
      scripts.set(id, src);
    },
    readCookies: () => opts.cookies ?? '',
    writeCookie: (a) => {
      written.push(a);
    },
    scripts,
    written,
  };
}

const isArguments = (x: unknown) => Object.prototype.toString.call(x) === '[object Arguments]';
const argsOf = (x: unknown) => Array.from(x as ArrayLike<unknown>);

describe('parseConsent — saklanan kayit -> karar', () => {
  const TABLE: Array<[string, string | null | undefined, ConsentState]> = [
    ['kayit yok (null)', null, 'unset'],
    ['kayit yok (undefined)', undefined, 'unset'],
    ['bos metin', '', 'unset'],
    ['JSON degil', 'kabul', 'unset'],
    ['yarim JSON', '{"v":2,"choice":"granted"', 'unset'],
    ['dizi', '[]', 'unset'],
    ['sayi', '42', 'unset'],
    ['JSON null', 'null', 'unset'],
    ['metin JSON', '"granted"', 'unset'],
    ['kabul (v2, taze)', v2('granted'), 'granted'],
    ['ret (v2, taze)', v2('denied'), 'denied'],
    ['bilinmeyen secim', v2('maybe'), 'unset'],
    ['secim alani yok', JSON.stringify({ v: CONSENT_VERSION, ts: NOW }), 'unset'],
    ['ts yok', JSON.stringify({ v: CONSENT_VERSION, choice: 'granted' }), 'unset'],
    ['ts metin', v2('granted', { ts: String(NOW) }), 'unset'],
    ['12 aydan eski kabul', v2('granted', { ts: NOW - CONSENT_MAX_AGE_MS - 1 }), 'unset'],
    ['12 aydan eski ret', v2('denied', { ts: NOW - CONSENT_MAX_AGE_MS - 1 }), 'unset'],
    ['tam 12 ay (sinirda gecerli)', v2('granted', { ts: NOW - CONSENT_MAX_AGE_MS }), 'granted'],
    ['ileri tarihli', v2('granted', { ts: NOW + 2 * DAY }), 'unset'],
    ['v metin', v2('granted', { v: '2' }), 'unset'],
    ['v ondalik', v2('granted', { v: 2.5 }), 'unset'],
    ['v sifir', v2('denied', { v: 0 }), 'unset'],
    ['baska surumun kabulu', v2('granted', { v: CONSENT_VERSION + 1 }), 'unset'],
    ['baska surumun reddi', v2('denied', { v: CONSENT_VERSION + 1 }), 'denied'],
    ['eski bant kabul (bilgilendirilmis riza degil)', JSON.stringify({ accepted: true, ts: NOW - DAY }), 'unset'],
    ['eski bant ret', JSON.stringify({ accepted: false, ts: NOW - DAY }), 'denied'],
    ['eski bant ret, ts yok', JSON.stringify({ accepted: false }), 'unset'],
    ['eski bant ret metin', JSON.stringify({ accepted: 'false', ts: NOW - DAY }), 'unset'],
    ['eski bant ret 12 aydan eski', JSON.stringify({ accepted: false, ts: NOW - CONSENT_MAX_AGE_MS - 1 }), 'unset'],
  ];

  it.each(TABLE)('%s', (_ad, raw, beklenen) => {
    expect(parseConsent(raw, NOW)).toBe(beklenen);
  });

  it('serializeConsent ile yazilan karar ayni karar olarak okunur', () => {
    expect(parseConsent(serializeConsent('granted', NOW), NOW)).toBe('granted');
    expect(parseConsent(serializeConsent('denied', NOW), NOW)).toBe('denied');
    expect(JSON.parse(serializeConsent('granted', NOW))).toEqual({ v: CONSENT_VERSION, choice: 'granted', ts: NOW });
  });

  it('yalniz kabul etiket yukletir', () => {
    expect(shouldLoadTrackers('granted')).toBe(true);
    expect(shouldLoadTrackers('denied')).toBe(false);
    expect(shouldLoadTrackers('unset')).toBe(false);
  });
});

describe('karar tablosu: depodaki kayit -> sayfa acilisinda yuklenen etiketler', () => {
  const CASES: Array<[string, string | null, { loads: boolean; banner: boolean }]> = [
    ['secim yok', null, { loads: false, banner: true }],
    ['kabul', serializeConsent('granted', NOW), { loads: true, banner: false }],
    ['ret', serializeConsent('denied', NOW), { loads: false, banner: false }],
    ['bozuk kayit = secim yok', '{bozuk', { loads: false, banner: true }],
    ['eski bant kabulu = secim yok', JSON.stringify({ accepted: true, ts: NOW }), { loads: false, banner: true }],
    ['eski bant reddi = ret', JSON.stringify({ accepted: false, ts: NOW }), { loads: false, banner: false }],
  ];

  it.each(CASES)('%s', (_ad, raw, beklenen) => {
    const env = fakeEnv();
    const state = readConsent(() => memoryStorage(raw), NOW);
    const plan = planConsent(state, 'load', trackersPresent(env));
    if (plan.loadTrackers) loadTrackers(env, state, IDS);
    expect(env.scripts.size > 0).toBe(beklenen.loads);
    expect(plan.showBanner).toBe(beklenen.banner);
    if (!beklenen.loads) {
      // Yuklenmeyen durumda Google'a/Microsoft'a gidecek kuyruk da olusmaz
      expect(env.win.dataLayer).toBeUndefined();
      expect(env.win.clarity).toBeUndefined();
    }
  });

  it('ret hicbir tetikleyicide ve hicbir durumda yukletmez', () => {
    for (const trigger of ['load', 'choice', 'sync'] as ConsentTrigger[]) {
      for (const loaded of [false, true]) {
        expect(planConsent('denied', trigger, loaded).loadTrackers, `${trigger}/${loaded}`).toBe(false);
        expect(planConsent('unset', trigger, loaded).loadTrackers, `${trigger}/${loaded}`).toBe(false);
      }
    }
    const env = fakeEnv();
    expect(loadTrackers(env, 'denied', IDS)).toEqual({ gtm: false, clarity: false, ga: false });
    expect(loadTrackers(env, 'unset', IDS)).toEqual({ gtm: false, clarity: false, ga: false });
    expect(env.scripts.size).toBe(0);
    expect(env.win.dataLayer).toBeUndefined();
    expect(env.win.clarity).toBeUndefined();
  });
});

describe('planConsent — durum x tetikleyici x yuklu mu x forma yazildi mi', () => {
  type Row = [ConsentState, ConsentTrigger, boolean, boolean, ConsentPlan];
  const p = (
    showBanner: boolean, loadTrackers: boolean, revokeTrackers: boolean, clearCookies: boolean, reload: boolean, reloadOnNavigate: boolean,
  ): ConsentPlan => ({ showBanner, loadTrackers, revokeTrackers, clearCookies, reload, reloadOnNavigate });
  const ROWS: Row[] = [
    // secim yok: bant acilir, eski izleme cerezleri silinir, hicbir sey yuklenmez
    ['unset', 'load', false, false, p(true, false, false, true, false, false)],
    ['unset', 'sync', false, false, p(true, false, false, true, false, false)],
    // gecerli onay kalmadi (kayit silindi / 12 ay doldu) ama container bu sekmede yuklu: durdurulur
    ['unset', 'sync', true, false, p(true, false, true, true, true, false)],
    ['unset', 'sync', true, true, p(true, false, true, true, false, true)],
    // kabul: yuklenir, cerezlere dokunulmaz, hicbir durumda yenilenmez
    ['granted', 'load', false, false, p(false, true, false, false, false, false)],
    ['granted', 'choice', false, false, p(false, true, false, false, false, false)],
    ['granted', 'choice', true, false, p(false, true, false, false, false, false)],
    ['granted', 'sync', false, false, p(false, true, false, false, false, false)],
    ['granted', 'sync', true, false, p(false, true, false, false, false, false)],
    ['granted', 'sync', true, true, p(false, true, false, false, false, false)],
    // ret: yuklenmez, cerezler silinir; bu sekmede yuklu etiket varsa yenilenir
    ['denied', 'load', false, false, p(false, false, false, true, false, false)],
    ['denied', 'choice', false, false, p(false, false, false, true, false, false)],
    ['denied', 'choice', true, false, p(false, false, true, true, true, false)],
    // bu sekmede tiklandi: forma yazilmis olsa da hemen (gizlilik metni: "sayfa yenilenir")
    ['denied', 'choice', true, true, p(false, false, true, true, true, false)],
    ['denied', 'sync', false, false, p(false, false, false, true, false, false)],
    ['denied', 'sync', false, true, p(false, false, false, true, false, false)],
    // baska sekmede geri alindi ve container bu sekmede yuklu: bu sekme de hemen yenilenir (rv18 C1) ...
    ['denied', 'sync', true, false, p(false, false, true, true, true, false)],
    // ... forma yazilmissa bir sonraki sayfa gecisinde (kaydedilmemis metin silinmesin)
    ['denied', 'sync', true, true, p(false, false, true, true, false, true)],
  ];

  it.each(ROWS)('%s / %s / yuklu=%s / yazildi=%s', (state, trigger, loaded, typed, beklenen) => {
    expect(planConsent(state, trigger, loaded, { typedInput: typed })).toEqual(beklenen);
  });

  it('baglam verilmezse "yazilmadi" sayilir (yenileme ertelenmez)', () => {
    expect(planConsent('denied', 'sync', true)).toEqual(p(false, false, true, true, true, false));
  });
});

describe('readConsent / writeConsent — depo hatalari', () => {
  it('depo erisimi, okuma ya da yazma hata atarsa karar "secim yok"tur ve yazma false doner', () => {
    const throwing = () => {
      throw new Error('SecurityError');
    };
    expect(readConsent(throwing, NOW)).toBe('unset');
    expect(readConsent(() => null, NOW)).toBe('unset');
    expect(readConsent(() => ({ getItem: throwing, setItem: () => undefined }), NOW)).toBe('unset');
    expect(writeConsent(throwing, 'granted', NOW)).toBe(false);
    expect(writeConsent(() => null, 'granted', NOW)).toBe(false);
    expect(writeConsent(() => ({ getItem: () => null, setItem: throwing }), 'granted', NOW)).toBe(false);
  });

  it('yazilan karar ayni anahtardan okunur', () => {
    const store = memoryStorage();
    expect(writeConsent(() => store, 'denied', NOW)).toBe(true);
    expect(readConsent(() => store, NOW)).toBe('denied');
    expect(writeConsent(() => store, 'granted', NOW)).toBe(true);
    expect(readConsent(() => store, NOW)).toBe('granted');
  });
});

describe('izleme kimlikleri', () => {
  it('gercek bicimler kabul, bicim disi ve enjeksiyon reddedilir', () => {
    expect(validGtmId('GTM-TSH8KWCC')).toBe('GTM-TSH8KWCC');
    expect(validClarityId('x8l5as16yd')).toBe('x8l5as16yd');
    for (const bad of [undefined, null, '', 'gtm-tsh8kwcc', 'GTM-', "GTM-X'+alert(1)+'", 'GTM-TSH8KWCC&l=x', ' GTM-TSH8KWCC']) {
      expect(validGtmId(bad), String(bad)).toBeNull();
    }
    for (const bad of [undefined, null, '', 'x8l5', 'x8l5as16yd"></script>', '../x8l5as16yd', 'x8l5 as16yd']) {
      expect(validClarityId(bad), String(bad)).toBeNull();
    }
  });
});

describe('loadTrackers — Google temel kip sirasi ve Clarity onayi', () => {
  it('kabul: varsayilan denied -> update granted -> gtm.js; container en son eklenir', () => {
    const env = fakeEnv();
    const sira: string[] = [];
    env.addScript = (id, src) => {
      sira.push(`${id}@${env.win.dataLayer?.length ?? 0}`);
      env.scripts.set(id, src);
    };
    expect(loadTrackers(env, 'granted', IDS)).toEqual({ gtm: true, clarity: true, ga: false });

    const dl = env.win.dataLayer!;
    expect(dl).toHaveLength(3);
    // Google kalibi arguments nesnesi iter; dizi itilseydi consent komutu islenmezdi
    expect(isArguments(dl[0])).toBe(true);
    expect(argsOf(dl[0])).toEqual(['consent', 'default', DENIED]);
    expect(isArguments(dl[1])).toBe(true);
    expect(argsOf(dl[1])).toEqual(['consent', 'update', GRANTED]);
    expect(dl[2]).toEqual({ 'gtm.start': NOW, event: 'gtm.js' });
    expect(env.scripts.get(GTM_SCRIPT_ID)).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-TSH8KWCC');
    expect(sira[0]).toBe(`${GTM_SCRIPT_ID}@3`);

    const q = env.win.clarity!.q!;
    expect(q).toHaveLength(1);
    expect(isArguments(q[0])).toBe(true);
    expect(argsOf(q[0])).toEqual(['consentv2', { ad_Storage: 'granted', analytics_Storage: 'granted' }]);
    expect(env.scripts.get(CLARITY_SCRIPT_ID)).toBe('https://www.clarity.ms/tag/x8l5as16yd');
  });

  it('bicim disi kimlik yuklenmez; bos kimlik o araci kapatir', () => {
    const env = fakeEnv();
    expect(loadTrackers(env, 'granted', { gtmId: "GTM-X'+alert(1)+'", clarityId: '' })).toEqual({ gtm: false, clarity: false, ga: false });
    expect(env.scripts.size).toBe(0);
    expect(env.win.dataLayer).toBeUndefined();
    expect(env.win.clarity).toBeUndefined();

    const yalnizClarity = fakeEnv();
    expect(loadTrackers(yalnizClarity, 'granted', { gtmId: '', clarityId: IDS.clarityId })).toEqual({ gtm: false, clarity: true, ga: false });
    expect(yalnizClarity.win.dataLayer).toBeUndefined();
  });

  it('ikinci cagri betigi yeniden eklemez, gtm.js olayini tekrarlamaz; yalniz onayi yeniden bildirir', () => {
    const env = fakeEnv();
    loadTrackers(env, 'granted', IDS);
    expect(loadTrackers(env, 'granted', IDS)).toEqual({ gtm: false, clarity: false, ga: false });
    expect(env.scripts.size).toBe(2);
    const dl = env.win.dataLayer!;
    expect(dl.filter((e) => (e as { event?: string })?.event === 'gtm.js')).toHaveLength(1);
    expect(argsOf(dl[dl.length - 1])).toEqual(['consent', 'update', GRANTED]);
    expect(env.win.clarity!.q).toHaveLength(2);
  });
});

describe('revokeTrackers / clearTrackingCookies', () => {
  const COOKIES = '_ga=GA1.1.5; _ga_TSH8KWCC=GS1; _gcl_au=1.1.1; _clck=a|1; _clsk=b|2; luvi_ref=ortak; theme=dark; authjs.session-token=x';

  it('Google\'a denied gider, Clarity consent(false) ile durdurulur, yalniz izleme cerezleri silinir', () => {
    const env = fakeEnv({ cookies: COOKIES });
    loadTrackers(env, 'granted', IDS);
    const clarityCagrilari: unknown[][] = [];
    // Betik yuklenmis Clarity'yi taklit eder (kuyruk degil, gercek fonksiyon)
    env.win.clarity = (...a: unknown[]) => {
      clarityCagrilari.push(a);
    };
    revokeTrackers(env);

    const dl = env.win.dataLayer!;
    expect(isArguments(dl[dl.length - 1])).toBe(true);
    expect(argsOf(dl[dl.length - 1])).toEqual(['consent', 'update', DENIED]);
    // consentv2 denied DEGIL: o cagri cerezsiz kipte izlemeye devam eder
    expect(clarityCagrilari).toEqual([['consent', false]]);

    const silinen = new Set(env.written.map((w) => w.slice(0, w.indexOf('='))));
    expect(silinen).toEqual(new Set(['_ga', '_ga_TSH8KWCC', '_gcl_au', '_clck', '_clsk']));
    expect(env.written).toContain('_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/');
    expect(env.written).toContain('_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.ranksup.ai');
  });

  it('Clarity hata atsa da cerezler silinir; etiket hic yuklenmemisse Google/Clarity kuyrugu olusturulmaz', () => {
    const env = fakeEnv({ cookies: '_ga=1; _clck=2' });
    env.win.clarity = () => {
      throw new Error('clarity');
    };
    expect(() => revokeTrackers(env)).not.toThrow();
    expect(env.written.length).toBeGreaterThan(0);

    const bos = fakeEnv({ cookies: '_ga=1' });
    revokeTrackers(bos);
    expect(bos.win.dataLayer).toBeUndefined();
    expect(bos.win.clarity).toBeUndefined();
    expect(bos.written.length).toBeGreaterThan(0);
  });

  it('cerez okunamazsa hata atmaz, hicbir sey yazmaz', () => {
    const env = fakeEnv();
    env.readCookies = () => {
      throw new Error('blocked');
    };
    expect(clearTrackingCookies(env)).toEqual([]);
    expect(env.written).toEqual([]);
  });
});

// rv18 C1: onay baska sekmede geri alininca GTM'i yuklemis sekme yalniz consent
// "denied" itiyor ve container'i calistirmaya devam ediyordu (Google etiketleri o
// durumda cerezsiz olcum gonderir); gizlilik metni "sayfa yenilenir ve bu araclar
// bir daha yuklenmez" diyor. Inceleyicinin yeniden uretimi buradan:
// scratchpad/rv18/consent-rv18.spec.mts.
describe('başka sekmede geri alma: GTM yüklü sekme de durur (rv18 C1)', () => {
  type Tab = { env: FakeEnv & ConsentPageEnv; reloads: () => number; c: ReturnType<typeof createConsentController> };
  function tab(): Tab {
    let reloads = 0;
    const env = Object.assign(fakeEnv({ cookies: '_ga=GA1.1.1.1; _clck=x; luvi_ref=ortak' }), {
      reload: () => {
        reloads++;
      },
    });
    return { env, reloads: () => reloads, c: createConsentController(env) };
  }
  /** Sekme A: daha once kabul edilmis, GTM + Clarity yuklu */
  function acceptedTab(): Tab {
    const t = tab();
    t.c.apply('granted', 'load', IDS);
    expect(t.env.scripts.has(GTM_SCRIPT_ID)).toBe(true);
    expect(t.env.scripts.has(CLARITY_SCRIPT_ID)).toBe(true);
    return t;
  }
  const lastPush = (env: FakeEnv) => argsOf(env.win.dataLayer![env.win.dataLayer!.length - 1]);
  const silinen = (env: FakeEnv) => new Set(env.written.map((w) => w.slice(0, w.indexOf('='))));

  it('B sekmesinde ret -> A sekmesi ("sync") Google\'a denied gönderir, çerezleri siler ve HEMEN yenilenir', () => {
    const a = acceptedTab();
    const plan = a.c.apply('denied', 'sync', IDS);
    expect(plan.reload).toBe(true);
    expect(plan.reloadOnNavigate).toBe(false);
    expect(a.reloads()).toBe(1);
    expect(lastPush(a.env)).toEqual(['consent', 'update', DENIED]);
    expect(silinen(a.env)).toEqual(new Set(['_ga', '_clck']));
    expect(a.c.reloadPending).toBe(false);
  });

  it('kayıt silindi ya da süresi doldu ("unset" sync): geçerli onay yok, A yine yenilenir; bant yenilenen sayfada açılır', () => {
    const a = acceptedTab();
    const plan = a.c.apply('unset', 'sync', IDS);
    expect(plan.showBanner).toBe(true);
    expect(a.reloads()).toBe(1);
  });

  it('A\'da bir forma yazılmışsa yenileme bir sonraki sayfa geçişine kalır; geçişte yalnız bir kez yenilenir', () => {
    const a = acceptedTab();
    a.c.noteInput();
    const plan = a.c.apply('denied', 'sync', IDS);
    expect(plan.reload).toBe(false);
    expect(plan.reloadOnNavigate).toBe(true);
    // Container hemen yenilenmese de onay geri alinir ve cerezler silinir
    expect(lastPush(a.env)).toEqual(['consent', 'update', DENIED]);
    expect(silinen(a.env)).toEqual(new Set(['_ga', '_clck']));
    expect(a.reloads()).toBe(0);
    expect(a.c.reloadPending).toBe(true);
    a.c.routeChanged();
    expect(a.reloads()).toBe(1);
    expect(a.c.reloadPending).toBe(false);
    a.c.routeChanged();
    expect(a.reloads()).toBe(1);
  });

  it('bekleyen yenilemeyle onay yeniden verilirse ("granted" sync) yenileme iptal olur, container onayla devam eder', () => {
    const a = acceptedTab();
    a.c.noteInput();
    a.c.apply('denied', 'sync', IDS);
    expect(a.c.reloadPending).toBe(true);
    const plan = a.c.apply('granted', 'sync', IDS);
    expect(plan.loadTrackers).toBe(true);
    expect(a.c.reloadPending).toBe(false);
    expect(lastPush(a.env)).toEqual(['consent', 'update', GRANTED]);
    a.c.routeChanged();
    expect(a.reloads()).toBe(0);
  });

  it('"yazıldı" işareti yalnız o sayfa için: sayfa geçişinden sonra gelen geri alma hemen yeniler', () => {
    const a = acceptedTab();
    a.c.noteInput();
    a.c.routeChanged();
    expect(a.reloads()).toBe(0);
    a.c.apply('denied', 'sync', IDS);
    expect(a.reloads()).toBe(1);
  });

  it('aynı sekmede ret ("choice"): forma yazılmış olsa da hemen yenilenir', () => {
    const a = acceptedTab();
    a.c.noteInput();
    a.c.apply('denied', 'choice', IDS);
    expect(a.reloads()).toBe(1);
    expect(a.c.reloadPending).toBe(false);
  });

  it('bu sekmede etiket hiç yüklenmediyse (onay hiç verilmedi) geri alma yenilemez, yalnız çerezleri siler', () => {
    const b = tab();
    b.c.apply('denied', 'load', IDS);
    expect(b.c.apply('denied', 'sync', IDS)).toMatchObject({ reload: false, reloadOnNavigate: false, revokeTrackers: false });
    b.c.apply('unset', 'sync', IDS);
    expect(b.reloads()).toBe(0);
    expect(b.env.scripts.size).toBe(0);
    expect(b.env.win.dataLayer).toBeUndefined();
    expect(silinen(b.env)).toEqual(new Set(['_ga', '_clck']));
  });

  it('kabul hiçbir tetikleyicide yenilemez', () => {
    const a = acceptedTab();
    for (const trigger of ['load', 'choice', 'sync'] as ConsentTrigger[]) a.c.apply('granted', trigger, IDS);
    a.c.routeChanged();
    expect(a.reloads()).toBe(0);
    expect(a.env.scripts.size).toBe(2);
  });
});

describe('cerez adlari ve alanlari', () => {
  it('Google ve Clarity cerezleri izleme sayilir; kendi cerezlerimiz sayilmaz', () => {
    for (const n of ['_ga', '_ga_TSH8KWCC', '_gid', '_gat', '_gat_UA-1', '_gcl_au', '_gcl_aw', '_gac_UA-1', '_gaexp', '_gaexp_rc', '_clck', '_clsk', 'FPGCLAW', 'FPAU', 'FPGSID']) {
      expect(isTrackingCookie(n), n).toBe(true);
    }
    for (const n of ['luvi_ref', 'authjs.session-token', '__Secure-authjs.session-token', '__Host-authjs.csrf-token', 'luviai_admin_unlocked', 'theme', 'ga', '_galaxy', '_clckx', 'cf_clearance', '__cf_bm', 'luvi_lsid']) {
      expect(isTrackingCookie(n), n).toBe(false);
    }
  });

  it('document.cookie metni ayristirilir, tekrarlar tekillesir', () => {
    expect(trackingCookieNames('')).toEqual([]);
    expect(trackingCookieNames(' _ga=1;_ga=2 ; luvi_ref=x; noeq; _clsk=')).toEqual(['_ga', '_clsk']);
  });

  it('silme alanlari: her ust alan; localhost ve IP adresinde yalniz host', () => {
    expect(cookieDomains('ranksup.ai')).toEqual(['.ranksup.ai']);
    expect(cookieDomains('www.ranksup.ai')).toEqual(['.www.ranksup.ai', '.ranksup.ai']);
    expect(cookieDomains('RanksUp.AI.')).toEqual(['.ranksup.ai']);
    expect(cookieDomains('localhost')).toEqual([]);
    expect(cookieDomains('127.0.0.1')).toEqual([]);
    expect(cookieDomains('::1')).toEqual([]);
    expect(cookieDomains('')).toEqual([]);
    expect(expireCookieAssignments(['_clck'], 'www.ranksup.ai')).toEqual([
      '_clck=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
      '_clck=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.www.ranksup.ai',
      '_clck=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.ranksup.ai',
    ]);
  });
});

describe('olaylar', () => {
  it('"Cerez tercihleri" dugmesi bandi acan olayi, karar degisimi durum olayini yayar', () => {
    const hedef = new EventTarget();
    const gelen: string[] = [];
    hedef.addEventListener(CONSENT_REOPEN_EVENT, (e) => gelen.push(e.type));
    hedef.addEventListener(CONSENT_CHANGE_EVENT, (e) => gelen.push(e.type));
    openCookiePreferences(hedef);
    announceConsentChange(hedef);
    expect(gelen).toEqual([CONSENT_REOPEN_EVENT, CONSENT_CHANGE_EVENT]);
  });
});

describe('GA4 (gtag.js) — yalniz onayla, tek kez, GTM ile ayni dataLayer', () => {
  const GA = 'G-Y5W4W5EHE7';
  const GA_URL = 'https://www.googletagmanager.com/gtag/js?id=G-Y5W4W5EHE7';
  const IDS_GA = { ...IDS, gaId: GA };
  const cmds = (env: FakeEnv) => env.win.dataLayer!.map((e) => (isArguments(e) ? argsOf(e) : e));
  type PageEnv = FakeEnv & ConsentPageEnv;
  const page = (opts: { cookies?: string; hostname?: string } = {}) => {
    let reloads = 0;
    const env: PageEnv = Object.assign(fakeEnv(opts), {
      reload: () => {
        reloads++;
      },
    });
    return { env, c: createConsentController(env), reloads: () => reloads };
  };

  it('kimlik bicimi: G- + buyuk harf/rakam; bicim disi ve enjeksiyon reddedilir', () => {
    expect(validGaId(GA)).toBe(GA);
    expect(validGaId('G-ABCD')).toBe('G-ABCD');
    for (const bad of [undefined, null, '', 'G-', 'G-ABC', 'g-y5w4w5ehe7', 'G-y5w4w5ehe7', 'UA-12345-1', 'GTM-TSH8KWCC', ' G-Y5W4W5EHE7', 'G-Y5W4W5EHE7 ', "G-ABCD'+alert(1)+'", 'G-ABCD&l=x', 'G-ABCD"></script>']) {
      expect(validGaId(bad), String(bad)).toBeNull();
    }
  });

  it('kabul: consent varsayilan/update bir kez, sonra gtm.js, sonra js + config; gtag.js en son eklenir', () => {
    const env = fakeEnv();
    const sira: string[] = [];
    env.addScript = (id, src) => {
      sira.push(`${id}@${env.win.dataLayer?.length ?? 0}`);
      env.scripts.set(id, src);
    };
    expect(loadTrackers(env, 'granted', IDS_GA)).toEqual({ gtm: true, clarity: true, ga: true });
    const dl = env.win.dataLayer!;
    expect(dl).toHaveLength(5);
    expect(argsOf(dl[0])).toEqual(['consent', 'default', DENIED]);
    expect(argsOf(dl[1])).toEqual(['consent', 'update', GRANTED]);
    expect(dl[2]).toEqual({ 'gtm.start': NOW, event: 'gtm.js' });
    // Google kalibi: arguments nesnesi, js'e Date, config'e kimlik
    expect(isArguments(dl[3])).toBe(true);
    const js = argsOf(dl[3]);
    expect(js[0]).toBe('js');
    expect(js[1]).toBeInstanceOf(Date);
    expect((js[1] as Date).getTime()).toBe(NOW);
    expect(isArguments(dl[4])).toBe(true);
    expect(argsOf(dl[4])).toEqual(['config', GA]);
    expect(env.scripts.get(GA_SCRIPT_ID)).toBe(GA_URL);
    expect(sira).toEqual([`${GTM_SCRIPT_ID}@3`, `${GA_SCRIPT_ID}@5`, `${CLARITY_SCRIPT_ID}@5`]);
    // window.gtag tanimlanir (sign_up olayi bunu kullanir) ve ayni dataLayer'a iter
    expect(typeof env.win.gtag).toBe('function');
    env.win.gtag!('event', 'x');
    expect(argsOf(dl[5])).toEqual(['event', 'x']);
  });

  it('yalniz GA4 (GTM kapali): consent sirasi yine once, gtag.js en son', () => {
    const env = fakeEnv();
    expect(loadTrackers(env, 'granted', { gtmId: '', clarityId: '', gaId: GA })).toEqual({ gtm: false, clarity: false, ga: true });
    expect(cmds(env)).toEqual([
      ['consent', 'default', DENIED],
      ['consent', 'update', GRANTED],
      ['js', new Date(NOW)],
      ['config', GA],
    ]);
    expect([...env.scripts.keys()]).toEqual([GA_SCRIPT_ID]);
    expect(trackersPresent(env)).toBe(true);
  });

  it('ret ve secim yok: hicbir tetikleyicide gtag.js eklenmez, gtag/dataLayer olusmaz', () => {
    for (const state of ['denied', 'unset'] as ConsentState[]) {
      for (const trigger of ['load', 'choice', 'sync'] as ConsentTrigger[]) {
        const t = page();
        t.c.apply(state, trigger, IDS_GA);
        expect(t.env.scripts.size, `${state}/${trigger}`).toBe(0);
        expect(t.env.win.dataLayer).toBeUndefined();
        expect(t.env.win.gtag).toBeUndefined();
      }
    }
    const env = fakeEnv();
    expect(loadTrackers(env, 'denied', IDS_GA)).toEqual({ gtm: false, clarity: false, ga: false });
  });

  it('bicim disi kimlik yok sayilir: gtag.js eklenmez, GTM etkilenmez', () => {
    for (const bad of ['', 'G-abc', "G-ABCD'+alert(1)+'", 'UA-1-1']) {
      const env = fakeEnv();
      expect(loadTrackers(env, 'granted', { gtmId: IDS.gtmId, gaId: bad }), bad).toEqual({ gtm: true, clarity: false, ga: false });
      expect(env.scripts.has(GA_SCRIPT_ID)).toBe(false);
      expect(cmds(env).some((c) => Array.isArray(c) && (c[0] === 'config' || c[0] === 'js'))).toBe(false);
    }
    const yok = fakeEnv();
    expect(loadTrackers(yok, 'granted', { gaId: 'G-x' })).toEqual({ gtm: false, clarity: false, ga: false });
    expect(yok.win.dataLayer).toBeUndefined();
    expect(yok.win.gtag).toBeUndefined();
  });

  it('tekrar yok: ikinci yukleme gtag.js/js/config/consent varsayilanini tekrarlamaz; yalniz onayi yeniden bildirir', () => {
    const t = page();
    t.c.apply('granted', 'load', IDS_GA);
    t.c.apply('granted', 'sync', IDS_GA);
    t.c.apply('granted', 'choice', IDS_GA);
    const c = cmds(t.env);
    const say = (ad: string) => c.filter((x) => Array.isArray(x) && x[0] === ad).length;
    expect(say('config')).toBe(1);
    expect(say('js')).toBe(1);
    expect(c.filter((x) => Array.isArray(x) && x[1] === 'default')).toHaveLength(1);
    expect(c[c.length - 1]).toEqual(['consent', 'update', GRANTED]);
    expect(t.env.scripts.size).toBe(3);
  });

  it('sayfada zaten gtag ve dataLayer varsa yeniden tanimlanmaz; ayni dizi ve mevcut kayitlar korunur', () => {
    const env = fakeEnv();
    const onceki = { event: 'onceki' };
    const dl: unknown[] = [onceki];
    const cagrilar: unknown[][] = [];
    const mevcut = function gtag(...a: unknown[]) {
      cagrilar.push(a);
      dl.push(a);
    };
    env.win.dataLayer = dl;
    env.win.gtag = mevcut;
    loadTrackers(env, 'granted', IDS_GA);
    expect(env.win.gtag).toBe(mevcut);
    expect(env.win.dataLayer).toBe(dl);
    expect(dl[0]).toBe(onceki);
    expect(cagrilar.map((a) => a[0])).toEqual(['consent', 'consent', 'js', 'config']);
  });

  it('geri alma: _ga ve _ga_<kimlik> ust alanda ve alt alanda silinir, sayfa yenilenir', () => {
    const t = page({ hostname: 'www.ranksup.ai', cookies: '_ga=GA1.1.1.1; _ga_Y5W4W5EHE7=GS2.1.s1; luvi_ref=ortak' });
    t.c.apply('granted', 'load', { gaId: GA });
    expect(t.env.scripts.has(GA_SCRIPT_ID)).toBe(true);
    expect(t.env.written).toEqual([]);
    const plan = t.c.apply('denied', 'choice', { gaId: GA });
    expect(plan).toMatchObject({ revokeTrackers: true, clearCookies: true, reload: true });
    expect(t.reloads()).toBe(1);
    expect(cmds(t.env).at(-1)).toEqual(['consent', 'update', DENIED]);
    for (const ad of ['_ga', '_ga_Y5W4W5EHE7']) {
      expect(t.env.written).toContain(`${ad}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`);
      expect(t.env.written).toContain(`${ad}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.www.ranksup.ai`);
      expect(t.env.written).toContain(`${ad}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.ranksup.ai`);
    }
    expect(t.env.written.some((w) => w.startsWith('luvi_ref='))).toBe(false);
  });

  it('jeton maskesi: /rapor/<jeton> ve /karne/<jeton> -> /[token], sorgu ve parca atilir; diger yollar dokunulmaz', () => {
    expect(maskTokenUrl('https://ranksup.ai/rapor/abcDEF123_-x')).toBe('https://ranksup.ai/rapor/[token]');
    expect(maskTokenUrl('https://www.ranksup.ai/karne/9f8e7d?utm_source=mail#ozet')).toBe('https://www.ranksup.ai/karne/[token]');
    expect(maskTokenUrl('https://ranksup.ai/rapor/abc/ek')).toBe('https://ranksup.ai/rapor/[token]');
    for (const u of ['https://ranksup.ai/', 'https://ranksup.ai/rapor', 'https://ranksup.ai/rapor/', 'https://ranksup.ai/raporlar/abc', 'https://ranksup.ai/sites/x/report', 'https://ranksup.ai/blog/karne/abc', 'bozuk', '']) {
      expect(maskTokenUrl(u), u).toBeNull();
    }
    expect(gaPageParams('https://ranksup.ai/pricing', 'https://google.com/')).toBeNull();
    expect(gaPageParams('https://ranksup.ai/rapor/gizli', '')).toEqual({ page_location: 'https://ranksup.ai/rapor/[token]' });
    expect(gaPageParams('https://ranksup.ai/pricing', 'https://ranksup.ai/karne/gizli')).toEqual({ page_referrer: 'https://ranksup.ai/karne/[token]' });
  });

  it('jetonlu sayfada config page_location maskeli gider, jeton dataLayer\'a hic girmez; normal sayfada parametre yok', () => {
    const env = fakeEnv();
    env.pageUrl = () => 'https://ranksup.ai/rapor/GIZLIJETON123?x=1';
    env.referrer = () => 'https://mail.example.com/';
    loadTrackers(env, 'granted', { gaId: GA });
    expect(cmds(env).at(-1)).toEqual(['config', GA, { page_location: 'https://ranksup.ai/rapor/[token]' }]);
    expect(JSON.stringify(cmds(env))).not.toContain('GIZLIJETON123');

    const normal = fakeEnv();
    normal.pageUrl = () => 'https://ranksup.ai/pricing?utm_source=x';
    normal.referrer = () => '';
    loadTrackers(normal, 'granted', { gaId: GA });
    expect(cmds(normal).at(-1)).toEqual(['config', GA]);
  });

  it('src/app altindaki her jetonlu dinamik yol maskelenir (yeni [token] yolu eklenirse bu test hatirlatir)', () => {
    const root = fileURLToPath(new URL('../app/', import.meta.url));
    const routes: string[] = [];
    (function walk(dir: string, segs: string[]) {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`;
        if (!statSync(p).isDirectory()) continue;
        const next = /^\(.*\)$/.test(e) ? segs : [...segs, e];
        if (/^\[.*(token|code|secret|invite|reset).*\]$/i.test(e) && !segs.includes('api')) routes.push(next.join('/'));
        walk(p, next);
      }
    })(root.replace(/\/$/, ''), []);
    expect(routes.sort()).toEqual(['karne/[token]', 'rapor/[token]']);
    for (const r of routes) {
      const url = `https://ranksup.ai/${r.replace(/\[[^\]]+\]/g, 'GIZLI42')}`;
      expect(maskTokenUrl(url), r).not.toBeNull();
      expect(maskTokenUrl(url)).not.toContain('GIZLI42');
    }
  });

  it('jetonlu sayfalara uygulama ici baglanti yok (yalniz tam sayfa yuklemesi; config maskesi SPA gecisinde tasinmaz)', () => {
    const src = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
    const hits: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && /(href=|router\.(push|replace)\(|redirect\()[^\n]*['"`]\/(rapor|karne)\//.test(readFileSync(p, 'utf8'))) hits.push(p.slice(src.length));
      }
    })(src);
    expect(hits).toEqual([]);
  });

  it('baska sekmede geri alma: yalniz GA4 yuklu sekme de yenilenir', () => {
    const t = page({ cookies: '_ga=1' });
    t.c.apply('granted', 'load', { gaId: GA });
    t.c.apply('denied', 'sync', { gaId: GA });
    expect(t.reloads()).toBe(1);
  });
});

// --- Kaynak metin denetimi: onaysiz yukleme ve yanlis gizlilik iddiasi geri gelmesin ---

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Yorumlar neyin neden kaldirildigini anlatir; yalniz kod taranir */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

describe('kaynak: kok layout, bant ve gizlilik metni', () => {
  it('kok layout GTM ve Clarity\'yi kendisi yuklemez (noscript iframe dahil); kimlikleri banda verir; AI sayaci kalir', () => {
    const lay = stripComments(read('../app/layout.tsx'));
    expect(lay).not.toMatch(/googletagmanager\.com|clarity\.ms|ns\.html|<noscript/);
    expect(lay).toContain('<CookieConsent gtmId={GTM_ID} clarityId={CLARITY_PROJECT_ID} gaId={GA_MEASUREMENT_ID} />');
    expect(lay).toContain("const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID ?? 'G-Y5W4W5EHE7';");
    expect(lay).toContain('<SignupEvent gaId={GA_MEASUREMENT_ID} />');
    expect(lay).toContain('/api/tracker.js?site=');
  });

  it('bant araclari ve amaci soyler, onayi Gizlilik Politikasi onayina baglamaz, iki dugme esit', () => {
    const cc = stripComments(read('../components/cookie-consent.tsx'));
    expect(cc).toContain('Google Analytics/Tag Manager');
    expect(cc).toContain('Microsoft Clarity');
    expect(cc).toContain('yalnız kabul edersen yüklenir');
    expect(cc).toContain('Oturum için zorunlu çerezler her zaman kullanılır');
    expect(cc).not.toMatch(/onaylamış olursun|Kabul ederek/);
    // Kabul ve Ret ayni varyant ve boyutta (KVKK rehberi 7.3)
    const dugmeler = [...cc.matchAll(/<Button size="sm" variant="(\w+)" onClick=\{\(\) => choose\('(granted|denied)'\)\}/g)];
    expect(dugmeler.map((m) => m[2]).sort()).toEqual(['denied', 'granted']);
    expect(new Set(dugmeler.map((m) => m[1])).size).toBe(1);
  });

  it('bant bileşeni kararı denetleyiciyle uygular: storage ve bfcache dönüşü "sync", form yazımı ve sayfa geçişi bildirilir (rv18 C1)', () => {
    const cc = stripComments(read('../components/cookie-consent.tsx'));
    expect(cc).toContain('createConsentController(browserPageEnv())');
    expect(cc).toContain('controller().apply(next, trigger, { gtmId, clarityId, gaId })');
    // Yenileme yalniz denetleyicinin ortamindan (planla); bilesen kendi basina yenilemez
    expect(cc).not.toContain('location.reload');
    // Baska sekmedeki karar
    expect(cc).toMatch(/const onStorage = \(e: StorageEvent\) => \{[\s\S]*?apply\(readConsent\(browserConsentStorage, Date\.now\(\)\), 'sync'\);[\s\S]*?window\.addEventListener\('storage', onStorage\)/);
    // Geri/ileri onbellekten donen sayfa storage olayini kacirmis olabilir
    expect(cc).toMatch(/if \(e\.persisted\) apply\(readConsent\(browserConsentStorage, Date\.now\(\)\), 'sync'\);[\s\S]*?window\.addEventListener\('pageshow', onPageShow\)/);
    // Form yazimi (yakalama asamasinda, her alan icin) ve sayfa gecisi
    expect(cc).toContain('const onInput = () => controller().noteInput();');
    expect(cc).toContain("document.addEventListener('input', onInput, true)");
    expect(cc).toContain('const pathname = usePathname();');
    expect(cc).toMatch(/if \(prev !== null && prev !== pathname\) controller\(\)\.routeChanged\(\);/);
    const lib = stripComments(read('./consent.ts'));
    expect(lib).toMatch(/export function browserPageEnv\(\): ConsentPageEnv \{\s*return \{ \.\.\.browserTagEnv\(\), reload: \(\) => window\.location\.reload\(\) \};/);
  });

  // Bolum 2 "pazarlama amacli paylasilmaz" diyordu; bant ve bolum 4 onay verende Google
  // Ads donusum olcumu + yeniden pazarlama etiketlerini anlatiyor. Iki iddia celisiyordu.
  it('gizlilik bölüm 2: veri satılmaz; pazarlama/yeniden pazarlama paylaşımı yalnız onaylı Google etiketleriyle — bant ve çerez bölümüyle çelişmez (TR + EN)', () => {
    const pv = stripComments(read('../app/(marketing)/privacy/page.tsx'));
    const s2 = [...pv.matchAll(/\n\s*s2p: '([^']*)',/g)].map((m) => m[1]);
    expect(s2, 'TR + EN bolum 2').toHaveLength(2);
    const [tr, en] = s2;

    // Bant ve bolum 4 yeniden pazarlamayi anlatiyor: bolum 2 onu inkar edemez
    expect(stripComments(read('../components/cookie-consent.tsx'))).toMatch(/yeniden pazarlama[\s\S]*remarketing/);
    expect(pv).toContain('Google Ads dönüşüm ölçümü ve yeniden pazarlama (Google)');
    expect(tr).not.toMatch(/pazarlama amaçlı paylaşılmaz|sadece hizmet sunumu|yalnızca hizmet sunumu/i);
    expect(en).not.toMatch(/shared for marketing\.|solely for service delivery|only for service delivery/i);

    // Satis yok; pazarlama paylasimi yalniz bant onayiyla yuklenen Google etiketleriyle; ayrinti bolum 4
    expect(tr).toContain('üçüncü taraflara satılmaz');
    expect(tr).toContain('Pazarlama ve yeniden pazarlama için veri paylaşımı yalnız çerez bandında “Kabul et” derseniz yüklenen Google etiketleriyle olur');
    expect(tr).toContain('Google Ads dönüşüm ölçümü ve yeniden pazarlama');
    expect(tr).toContain('kabul etmezseniz hiçbiri yüklenmez');
    expect(tr).toContain('4. bölüm');
    expect(en).toContain('not sold to third parties');
    expect(en).toContain('Data is shared for marketing and remarketing only through the Google tags that load if you click “Accept” in the cookie banner');
    expect(en).toContain('Google Ads conversion measurement and remarketing');
    expect(en).toContain('if you do not accept, none of them load');
    expect(en).toContain('Section 4');
    // Bandin dugme adlariyla ayni (cookie-consent.tsx TEXT.accept)
    const cc = read('../components/cookie-consent.tsx');
    expect(cc).toContain("accept: 'Kabul et'");
    expect(cc).toContain("accept: 'Accept'");
  });

  it('gizlilik metni Plausible demez; gercek araclari, cerezleri ve geri alma yolunu TR + EN anlatir', () => {
    const pv = stripComments(read('../app/(marketing)/privacy/page.tsx'));
    expect(pv).not.toMatch(/Plausible|cookie-free/i);
    for (const s of ['Google Analytics 4', 'Google Ads', 'Microsoft Clarity', '_ga', '_gcl_au', '_clck', '_clsk', 'luvi_ref', 'luvi_lsid', 'tracker.js']) {
      expect(pv.split(s).length - 1, s).toBeGreaterThanOrEqual(2);
    }
    expect(pv).toContain('yalnız onayınızla');
    expect(pv).toContain('only with your consent');
    expect(pv).toContain('openCookiePreferences()');
    expect(pv).toContain('id="cerezler"');
  });
});

describe('kaynak: altbilgi ve KVKK metni', () => {
  it('pazarlama altbilgisinde "Çerez tercihleri" düğmesi bandı yeniden açar (onay her sayfadan geri alınabilir)', () => {
    const footer = stripComments(read('../components/site-footer.tsx'));
    expect(footer).toContain("import { openCookiePreferences } from '@/lib/consent';");
    // Baglanti degil dugme: sayfa degistirmez, bandi acar (CONSENT_REOPEN_EVENT)
    expect(footer).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => openCookiePreferences\(\)\}[\s\S]*?Çerez tercihleri/);
    expect(footer).toContain("'Cookie preferences'");
    // Altbilgi yalniz pazarlama sayfalarinda; bant kok layout'ta, yani her sayfada dinliyor
    expect(read('../app/(marketing)/layout.tsx')).toContain('<SiteFooter />');
    expect(stripComments(read('../components/cookie-consent.tsx'))).toContain('window.addEventListener(CONSENT_REOPEN_EVENT, onReopen)');
  });

  it('KVKK aktarılan taraflar: Google (Analytics/Tag Manager/Ads) ve Microsoft (Clarity) yalnız onayla; yurt dışı aktarım için hukuki dayanak iddiası yok', () => {
    const kvkk = stripComments(read('../app/(marketing)/kvkk/page.tsx'));
    const bolum = kvkk.slice(kvkk.indexOf('Aktarılan Taraflar'), kvkk.indexOf('Veri Sahibinin Hakları'));
    for (const s of ['Google Tag Manager', 'Google Analytics 4', 'Google Ads', 'Microsoft Clarity']) {
      expect(bolum, s).toContain(s);
    }
    expect(bolum).toContain('Yalnız çerez bandında “Kabul et” derseniz');
    expect(bolum).toContain('“Reddet” derseniz ya da seçim yapmazsanız bu araçlar hiç yüklenmez');
    // Gizlilik sayfasinin cerez bolumuyle ayni olgu cumlesi
    const olgu = 'Bu araçların topladığı veriler yurt dışında yerleşik Google ve Microsoft’a aktarılır';
    expect(bolum.replace(/\s+/g, ' ')).toContain(olgu);
    expect(read('../app/(marketing)/privacy/page.tsx')).toContain(olgu);
    expect(bolum).toContain('/privacy#cerezler');
    expect(bolum).not.toMatch(/standart sözleşme|açık rızanız(a|la) dayan|yeterlilik kararı|m\.\s?9|madde 9/i);
  });
});
