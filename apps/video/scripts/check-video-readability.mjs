#!/usr/bin/env node
/**
 * RanksUp Video okunurluk denetimi — makale, site (dikey / yatay) ve urun (dikey / yatay) sablonlari,
 * uc tempo. KobiPratik denetiminin (check-kobipratik-readability) kurali, musteri sablonlarina:
 *
 *   metin  tam gorunur kalma suresi >= max(2,0 sn; 0,3 sn x kelime + 1,0 sn)
 *   liste  son oge tam gorundukten sonra tum liste >= 2,5 sn ekranda (ust uste biriken kartlar)
 *   sure   her video <= 60 sn (Reels siniri)
 *
 * "Tam gorunur" = giris yayi %95'e ulastigi kare (Remotion spring() ile BURADA hesaplanir) ile
 * cikisin basladigi kare arasi; son sahnede video sonuna kadar. Her metnin giris / cikis ani
 * asagidaki SPEC'te sablonlarin TSX'iyle ayni tutulur (ArticleShort.tsx, SiteIntro.tsx,
 * ProductShort.tsx) — planlayicinin (src/tempo/plan.mjs) kendi envanterinden BAGIMSIZ; biri
 * degisip digeri unutulursa denetim kirilir.
 *
 * Metinler: kopya koruyucusunun karakter sinirlarindan kurulan EN UZUN metin (kelime basina 5
 * karakter — Turkcede gercekci en yogun; ortalama ~7), en kisa metin, tipik metin ve tohumlu 300
 * rastgele metin (her alan sinir icinde rastgele uzunlukta). Denetlenen: normal ve slow kurali
 * HER metinde saglar, okuma payi en uzun metinde bile 1,0'in altina inmez, hicbir video 60 sn'yi
 * asmaz. 'fast' (eski 15 sn izgara) yalniz raporlanir: "hızlı — kısa metinler için".
 * Ayrica: plan.mjs yay sabitleri spring() ile ayni; fast plani eski izgarayla ayni (15 / 24 sn);
 * panelin sure tablosu (apps/web/src/lib/article-video.ts VIDEO_TEMPO_SECONDS) hesapla ayni.
 *
 * VIDEO STILLERI (src/styles/registry.mjs): classic disindaki her stil (panel, paper, swiss, chat, diagram,
 * footage) ayni tempo planini kullanir; metinlerin giris yaylari ve cikis anlari src/styles/story.ts
 * makeWin'den, cikislar stil basina STYLE_EXITS'ten. Asagidaki STYLED_SPEC bu pencereleri stil TSX'inden
 * BAGIMSIZ olarak yeniden kurar (kelime kelime girislerde de son kelime metnin %95 karesinde yerinde —
 * kit.tsx stagger) ve her stil x bicim x tempo icin ayni metin kumesiyle denetlenir. Her stilin fontlari
 * Turkce glifleri (ş ğ ı İ â ç ö ü) icermeli: TTF cmap'i burada okunur.
 *
 *   node scripts/check-video-readability.mjs            # tablolar + ozet; ihlalde cikis kodu 1
 *   node scripts/check-video-readability.mjs --brief    # yalniz ozet
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spring } from 'remotion';
import { MOTION, READ_RULE, TEMPOS, countWords, createPlanner, readSeconds } from '../src/tempo/plan.mjs';
import { STYLE_EXITS, STYLE_FONTS, VIDEO_STYLES } from '../src/styles/registry.mjs';
import { LIMITS } from './article-short/copy.mjs';
import { PROMO_LIMITS, promoCtaLabel } from './article-short/promo-copy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'src', 'marketing', 'timeline.json'), 'utf8'));
const WEB_LIB = join(ROOT, '..', 'web', 'src', 'lib', 'article-video.ts');
const FPS = TIMELINE.fps;
const MAX_SECONDS = 60;
/** gercekci en yogun metin: kelime + bosluk = 5 karakter */
const DENSE_CHARS_PER_WORD = 5;
const BRAND_NAME_MAX = 60;
const WATERMARK = 'ranksup.ai ile üretildi';

/** Panel / rapor anahtari -> kompozisyon */
export const FORMATS = {
  'article.vertical': 'ArticleShort',
  'site.vertical': 'SiteIntro',
  'site.horizontal': 'SiteIntroWide',
  'product.vertical': 'ProductShort',
  'product.horizontal': 'ProductWide',
};

/* ───────────── giris yaylari (spring ile, plan.mjs'ten bagimsiz) ───────────── */

function settleOf(config) {
  for (let f = 0; f < 200; f++) if (spring({ frame: f, fps: FPS, config }) >= 0.95) return f;
  return 200;
}
const SETTLE = { fast: settleOf(MOTION.fast.config), calm: settleOf(MOTION.calm.config), soft: settleOf(MOTION.soft.config) };
/** kit.tsx snap() yayi: plan.mjs'teki 'fast' ayari onunla AYNI olmali */
const KIT_SNAP = { damping: 15, stiffness: 210, mass: 0.7 };

/* ───────────── sablon tanimlari (TSX ile ayni) ───────────── */

/**
 * Metin: { id, text, from(P) -> tam gorunur karesi, to(P) -> cikis karesi, list? }
 * P: { at(id), scene(name), total, snap(at, lead=4), soft(at) }
 */
const snapAt = (ev, d = 0, lead = 4) => (P) => P.snap(P.at(ev) + d, lead);
const sceneSnap = (sc, d = 0, lead = 4) => (P) => P.snap(P.scene(sc)[0] + d, lead);
const softAt = (ev, d = 0) => (P) => P.soft(P.at(ev) + d);
const until = (sc, back) => (P) => P.scene(sc)[1] - back;
const untilEnd = (back) => (P) => P.scene('end')[0] - back;
const toTotal = () => (P) => P.total;
const max = (...fs) => (P) => Math.max(...fs.map((f) => f(P)));
/** satir satir giren basligin SON satiri (en fazla 4 satir varsayilir — tutucu) */
const lastLine = (ev, stagger, lines = 4) => (P) => P.snap(P.at(ev) + stagger * (lines - 1), 4);

function endItems(p, name) {
  return [
    { id: 'kapanis.ad', text: name, from: sceneSnap('end', 5), to: toTotal() },
    { id: 'kapanis.cta', text: p.cta.label, from: softAt('end.cta', -4), to: toTotal() },
    { id: 'kapanis.adres', text: p.cta.domain, from: snapAt('end.cta'), to: toTotal() },
    { id: 'kapanis.filigran', text: WATERMARK, from: softAt('end.url', 4), to: toTotal() },
  ];
}

const SPEC = {
  // ArticleShort.tsx: Header / Hook (cikis e-6) / Point (cikis e-6; kutu snap(s, 5)) / Watermark / End
  ArticleShort: (p) => [
    { id: 'ust.marka', text: p.brand.name, from: snapAt('hook.brand', 4), to: untilEnd(6) },
    { id: 'kanca.etiket', text: p.kicker, from: snapAt('hook.title', -6), to: until('hook', 6) },
    { id: 'kanca.baslik', text: p.hook, from: lastLine('hook.title', 3), to: until('hook', 6) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', 6) },
    { id: 'kanca.kaynak', text: p.sourcePath, from: softAt('hook.source'), to: until('hook', 6) },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => {
      const sc = `p${i + 1}`;
      return [
        { id: `${sc}.baslik`, text: pt.title, from: max(sceneSnap(sc, 0, 5), lastLine(`${sc}.title`, 2)), to: until(sc, 6) },
        { id: `${sc}.aciklama`, text: pt.detail, from: max(sceneSnap(sc, 0, 5), snapAt(`${sc}.detail`)), to: until(sc, 6) },
      ];
    }),
    ...endItems(p, p.brand.name),
  ],
  // SiteIntro.tsx VHook (cikis e-10) / VHeader / VCards (kartlar kapanisa kadar kalir: endS-6) / EndCard
  SiteIntro: (p) => [
    { id: 'kanca.ad', text: p.brand.name, from: snapAt('hook.name'), to: until('hook', 10) },
    { id: 'kanca.baslik', text: p.hook, from: snapAt('hook.title'), to: until('hook', 10) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', 10) },
    { id: 'ust.marka', text: p.brand.name, from: sceneSnap('p1'), to: untilEnd(6) },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => [
      { id: `p${i + 1}.baslik`, text: pt.title, from: sceneSnap(`p${i + 1}`, 0, 5), to: untilEnd(6), list: 'kartlar' },
      { id: `p${i + 1}.aciklama`, text: pt.detail, from: sceneSnap(`p${i + 1}`, 0, 5), to: untilEnd(6), list: 'kartlar' },
    ]),
    ...endItems(p, p.brand.name),
  ],
  // SiteIntroWide: WHook (cikis e-10) / WCards (ust satir snap(p1s), kartlar endS-6) / EndCard
  SiteIntroWide: (p) => SPEC.SiteIntro(p),
  // ProductShort.tsx VHookText (cikis e-12) / fiyat etiketi gorsel kartinda sona dek / FeatureRows (endS-6) / VEnd
  ProductShort: (p) => [
    { id: 'kanca.etiket', text: p.kicker, from: snapAt('hook.title', -4), to: until('hook', 12) },
    { id: 'kanca.ad', text: p.hook, from: snapAt('hook.title'), to: until('hook', 12) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', 12) },
    { id: 'fiyat', text: p.price, from: snapAt('hook.price'), to: toTotal() },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => {
      const sc = `p${i + 1}`;
      return [
        { id: `${sc}.baslik`, text: pt.title, from: sceneSnap(sc, 0, 5), to: untilEnd(6), list: 'ozellikler' },
        { id: `${sc}.aciklama`, text: pt.detail, from: max(sceneSnap(sc, 0, 5), snapAt(`${sc}.detail`)), to: untilEnd(6), list: 'ozellikler' },
      ];
    }),
    ...endItems(p, p.hook),
  ],
  // ProductWide: kanca (cikis e-12) + ozellikler ustunde urun adi (snap(p1s), endS-6)
  ProductWide: (p) => [...SPEC.ProductShort(p), { id: 'ust.ad', text: p.hook, from: sceneSnap('p1'), to: untilEnd(6) }],
};

/**
 * Stilli videolarin metin pencereleri (src/styles/story.ts makeWin + stil kitleri). X: STYLE_EXITS[stil][bicim]
 * — kanca X.hook, makale maddesi X.point kare once cikar; liste ve ust satir kapanistan X.list kare once.
 * Baslik tek parca yayla gelir (kelime kelime giris yayin %95'inde biter): son satir payi yok.
 * Site tanitiminda ust etiket, urun tanitiminda marka adi metni yok (classic ile ayni metin kumesi).
 */
const STYLED_SPEC = {
  ArticleShort: (p, X) => [
    { id: 'ust.marka', text: p.brand.name, from: snapAt('hook.brand', 4), to: untilEnd(X.list) },
    { id: 'kanca.etiket', text: p.kicker, from: snapAt('hook.title', -6), to: until('hook', X.hook) },
    { id: 'kanca.baslik', text: p.hook, from: snapAt('hook.title'), to: until('hook', X.hook) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', X.hook) },
    { id: 'kanca.kaynak', text: p.sourcePath, from: softAt('hook.source'), to: until('hook', X.hook) },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => {
      const sc = `p${i + 1}`;
      return [
        { id: `${sc}.baslik`, text: pt.title, from: max(sceneSnap(sc, 0, 5), snapAt(`${sc}.title`)), to: until(sc, X.point) },
        { id: `${sc}.aciklama`, text: pt.detail, from: max(sceneSnap(sc, 0, 5), snapAt(`${sc}.detail`)), to: until(sc, X.point) },
      ];
    }),
    ...endItems(p, p.brand.name),
  ],
  SiteIntro: (p, X) => [
    { id: 'kanca.ad', text: p.brand.name, from: snapAt('hook.name'), to: until('hook', X.hook) },
    { id: 'kanca.baslik', text: p.hook, from: snapAt('hook.title'), to: until('hook', X.hook) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', X.hook) },
    { id: 'ust.marka', text: p.brand.name, from: sceneSnap('p1'), to: untilEnd(X.list) },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => [
      { id: `p${i + 1}.baslik`, text: pt.title, from: sceneSnap(`p${i + 1}`, 0, 5), to: untilEnd(X.list), list: 'kartlar' },
      { id: `p${i + 1}.aciklama`, text: pt.detail, from: sceneSnap(`p${i + 1}`, 0, 5), to: untilEnd(X.list), list: 'kartlar' },
    ]),
    ...endItems(p, p.brand.name),
  ],
  SiteIntroWide: (p, X) => STYLED_SPEC.SiteIntro(p, X),
  ProductShort: (p, X) => [
    { id: 'kanca.etiket', text: p.kicker, from: snapAt('hook.title', -4), to: until('hook', X.hook) },
    { id: 'kanca.ad', text: p.hook, from: snapAt('hook.title'), to: until('hook', X.hook) },
    { id: 'kanca.alt', text: p.hookSub, from: softAt('hook.sub'), to: until('hook', X.hook) },
    { id: 'fiyat', text: p.price, from: snapAt('hook.price'), to: toTotal() },
    { id: 'filigran', text: WATERMARK, from: (P) => P.soft(8), to: untilEnd(6) },
    ...p.points.flatMap((pt, i) => {
      const sc = `p${i + 1}`;
      return [
        { id: `${sc}.baslik`, text: pt.title, from: sceneSnap(sc, 0, 5), to: untilEnd(X.list), list: 'ozellikler' },
        { id: `${sc}.aciklama`, text: pt.detail, from: max(sceneSnap(sc, 0, 5), snapAt(`${sc}.detail`)), to: untilEnd(X.list), list: 'ozellikler' },
      ];
    }),
    ...endItems(p, p.hook),
  ],
  ProductWide: (p, X) => [...STYLED_SPEC.ProductShort(p, X), { id: 'ust.ad', text: p.hook, from: sceneSnap('p1'), to: untilEnd(X.list) }],
};

/** Stilin metin envanteri: classic -> SPEC, digerleri -> STYLED_SPEC (stilin cikislariyla) */
function specOf(compositionId, style) {
  if (style === 'classic') return (props) => SPEC[compositionId](props);
  const X = STYLE_EXITS[style]?.[compositionId];
  if (!X) throw new Error(`STYLE_EXITS.${style}.${compositionId} tanimsiz`);
  return (props) => STYLED_SPEC[compositionId](props, X);
}

/* ───────────── metinler ───────────── */

const fill = (chars, wordLen = DENSE_CHARS_PER_WORD - 1) => {
  const n = Math.floor((chars + 1) / (wordLen + 1));
  return Array.from({ length: n }, (_, i) => 'abcdefghijkl'.slice(0, wordLen).replace(/^./, String.fromCharCode(97 + (i % 26)))).join(' ');
};
const LONGEST_LABEL = [promoCtaLabel('site', 'tr'), promoCtaLabel('site', 'en'), promoCtaLabel('product', 'tr'), promoCtaLabel('product', 'en'), 'Tamamını oku', 'Read the full article'].sort((a, b) => countWords(b) - countWords(a))[0];

function longest(kind) {
  const L = kind === 'article' ? LIMITS : PROMO_LIMITS;
  return {
    kicker: fill(L.kicker),
    hook: fill(L.hook),
    hookSub: fill(L.hookSub),
    sourcePath: 'ornekalanadi.com.tr/blog/kategori',
    price: '12.499,90 TL',
    points: [0, 1, 2].map(() => ({ title: fill(L.title), detail: fill(L.detail) })),
    cta: { label: LONGEST_LABEL, domain: 'ornekalanadi.com.tr/…/urun-adi' },
    brand: { name: fill(BRAND_NAME_MAX), domain: 'ornekalanadi.com.tr' },
    watermark: true,
  };
}
const SHORTEST = {
  kicker: '', hook: 'Kısa', hookSub: '', sourcePath: 'a.com', price: '',
  points: [{ title: 'Bir' }, { title: 'İki' }, { title: 'Üç' }],
  cta: { label: 'Tamamını oku', domain: 'a.com' }, brand: { name: 'A', domain: 'a.com' }, watermark: true,
};
export const TYPICAL = {
  kicker: 'Pratik KOBİ Rehberi',
  hook: 'Fatura finansmanı nedir ve nasıl çalışır?',
  hookSub: 'İşletmeler için nakit akışını hızlandırmanın pratik yolu',
  sourcePath: 'kobipratik.com/pratik-kobi-rehberi',
  price: '',
  points: [
    { title: 'Faturanı beklemeden nakde çevir', detail: 'Vadeli faturalar finans kuruluşuna devredilir, tutarın büyük kısmı hemen ödenir.' },
    { title: 'Kredi değil, alacak satışı', detail: 'Bilançoda borç olarak görünmez; teminat yükü daha hafiftir.' },
    { title: 'Maliyeti vadeye göre değişir', detail: 'Komisyon ve iskonto oranını teklifler arasında karşılaştır.' },
  ],
  cta: { label: 'Tamamını oku', domain: 'kobipratik.com' },
  brand: { name: 'KobiPratik', domain: 'kobipratik.com' },
  watermark: true,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** sinir icinde rastgele uzunlukta, 2-12 harfli kelimelerden metin */
function randomText(rand, maxChars, minChars = 3) {
  const target = Math.floor(minChars + rand() * (maxChars - minChars));
  const out = [];
  let len = 0;
  for (;;) {
    const w = 'k'.repeat(2 + Math.floor(rand() * 11));
    if (len + w.length + (out.length ? 1 : 0) > target) break;
    out.push(w);
    len += w.length + (out.length > 1 ? 1 : 0);
  }
  return out.join(' ') || 'kk';
}
function randomCopy(rand, kind) {
  const L = kind === 'article' ? LIMITS : PROMO_LIMITS;
  const opt = (s) => (rand() < 0.3 ? '' : s);
  return {
    kicker: opt(randomText(rand, L.kicker)),
    hook: randomText(rand, L.hook, 10),
    hookSub: opt(randomText(rand, L.hookSub)),
    sourcePath: 'ornek.com/blog',
    price: rand() < 0.5 ? '1.299 TL' : '',
    points: [0, 1, 2].map(() => ({ title: randomText(rand, L.title, 8), detail: opt(randomText(rand, L.detail, 20)) })),
    cta: { label: LONGEST_LABEL, domain: 'ornek.com' },
    brand: { name: randomText(rand, BRAND_NAME_MAX, 2), domain: 'ornek.com' },
    watermark: true,
  };
}

/* ───────────── denetim ───────────── */

const planner = createPlanner(TIMELINE);

function probe(plan) {
  const settle = plan.tempo === 'fast' ? SETTLE.fast : SETTLE.calm;
  return {
    total: plan.durationInFrames,
    at: (id) => {
      const f = plan.events[id];
      if (f === undefined) throw new Error(`${plan.template}/${plan.tempo}: '${id}' olayi yok`);
      return f;
    },
    scene: (n) => plan.scenes[n],
    snap: (at, lead = 4) => at - lead + settle,
    soft: (at) => at + SETTLE.soft,
  };
}

/** Bir kompozisyon + tempo + metin (+ stil): her metnin gorunur suresi, gereken, liste paylari */
export function evaluate(compositionId, tempo, props, style = 'classic', plan = planner.plan(compositionId, tempo, props)) {
  const P = probe(plan);
  const items = specOf(compositionId, style)(props).filter((it) => countWords(it.text) > 0);
  const rows = items.map((it) => {
    const from = it.from(P);
    const to = it.to(P);
    const vis = (to - from) / FPS;
    const req = readSeconds(it.text);
    return { id: it.id, words: countWords(it.text), from, to, vis, req, ok: vis + 1e-9 >= req, list: it.list };
  });
  const lists = {};
  for (const r of rows) if (r.list) (lists[r.list] ??= []).push(r);
  const listRows = Object.entries(lists).map(([name, rs]) => {
    const last = Math.max(...rs.map((r) => r.from));
    const end = Math.min(...rs.map((r) => r.to));
    const hold = (end - last) / FPS;
    return { id: name, items: rs.length, hold, ok: hold + 1e-9 >= READ_RULE.listHoldSec };
  });
  return { plan, rows, listRows, seconds: plan.durationInFrames / FPS };
}

/**
 * Tum denetim. Donus: { failures: string[], table: [...], ranges } — spec dosyasi
 * (apps/api/src/videos/video-tempo.spec.ts) ayni fonksiyonu cagirir.
 */
export function checkAll({ randomCount = 300 } = {}) {
  const failures = [];
  const table = [];
  const ranges = {};
  const styles = VIDEO_STYLES.filter((x) => x !== 'classic');
  /** stil -> tempo -> { metin, ihlal, enDar, enDarMetin } */
  const styleStats = Object.fromEntries(styles.map((x) => [x, Object.fromEntries(TEMPOS.map((t) => [t, { checked: 0, violations: 0, worst: Infinity, worstText: '' }]))]));
  failures.push(...checkStyleFonts());
  // 1) yay sabitleri
  if (JSON.stringify(MOTION.fast.config) !== JSON.stringify(KIT_SNAP)) failures.push('plan.mjs MOTION.fast, kit.tsx snap() yayiyla ayni degil');
  for (const k of ['fast', 'calm', 'soft']) {
    if (MOTION[k].settle !== SETTLE[k]) failures.push(`plan.mjs MOTION.${k}.settle=${MOTION[k].settle}, spring() ${SETTLE[k]} diyor`);
  }
  for (const [key, comp] of Object.entries(FORMATS)) {
    const kind = key.split('.')[0];
    const cases = { 'en kısa': SHORTEST, tipik: TYPICAL, 'en uzun': longest(kind) };
    const rand = mulberry32(comp.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 11));
    const randoms = Array.from({ length: randomCount }, () => randomCopy(rand, kind));
    ranges[key] = {};
    for (const tempo of TEMPOS) {
      const strict = tempo !== 'fast';
      const secs = {};
      let worstMargin = Infinity;
      let worstText = '';
      let minRead = Infinity;
      let violations = 0;
      const all = [...Object.entries(cases), ...randoms.map((c, i) => [`rastgele#${i}`, c])];
      let lo = Infinity;
      let hi = 0;
      for (const [name, props] of all) {
        const r = evaluate(comp, tempo, props);
        // Ayni plan, her stilin kendi metin pencereleriyle
        for (const style of styles) {
          const st = styleStats[style][tempo];
          const rs = evaluate(comp, tempo, props, style, r.plan);
          st.checked++;
          for (const row of rs.rows) {
            if (row.vis - row.req < st.worst) {
              st.worst = row.vis - row.req;
              st.worstText = `${comp}/${name}:${row.id}`;
            }
            if (!row.ok) {
              st.violations++;
              if (strict) failures.push(`[${style}] ${comp}/${tempo}/${name}: '${row.id}' ${row.vis.toFixed(2)} sn gorunur, ${row.req.toFixed(2)} sn gerekli (${row.words} kelime)`);
            }
          }
          for (const l of rs.listRows) {
            if (!l.ok) {
              st.violations++;
              if (strict) failures.push(`[${style}] ${comp}/${tempo}/${name}: liste '${l.id}' son ogeden sonra ${l.hold.toFixed(2)} sn (< ${READ_RULE.listHoldSec})`);
            }
          }
        }
        lo = Math.min(lo, r.seconds);
        hi = Math.max(hi, r.seconds);
        if (cases[name]) secs[name] = r.seconds;
        if (r.seconds > MAX_SECONDS + 1e-9) failures.push(`${comp}/${tempo}/${name}: ${r.seconds.toFixed(1)} sn > ${MAX_SECONDS} sn`);
        if (strict) {
          minRead = Math.min(minRead, r.plan.read);
          if (r.plan.read < 1) failures.push(`${comp}/${tempo}/${name}: okuma payi ${r.plan.read} < 1,0 (metin 60 sn'ye sigmadi)`);
        }
        for (const row of r.rows) {
          if (row.vis - row.req < worstMargin) {
            worstMargin = row.vis - row.req;
            worstText = `${name}:${row.id}`;
          }
          if (!row.ok) {
            violations++;
            if (strict) failures.push(`${comp}/${tempo}/${name}: '${row.id}' ${row.vis.toFixed(2)} sn gorunur, ${row.req.toFixed(2)} sn gerekli (${row.words} kelime)`);
          }
        }
        for (const l of r.listRows) {
          if (!l.ok) {
            violations++;
            if (strict) failures.push(`${comp}/${tempo}/${name}: liste '${l.id}' son ogeden sonra ${l.hold.toFixed(2)} sn (< ${READ_RULE.listHoldSec})`);
          }
        }
      }
      if (tempo === 'fast') {
        const legacy = TIMELINE.compositions[comp === 'ProductWide' ? 'ProductShort' : comp];
        const legacySec = legacy.beats * 60 / TIMELINE.bpm;
        if (Math.abs(lo - legacySec) > 1e-9 || Math.abs(hi - legacySec) > 1e-9) failures.push(`${comp}/fast: sure ${lo}-${hi} sn, eski izgara ${legacySec} sn olmali`);
      }
      ranges[key][tempo] = [lo, hi];
      table.push({
        bicim: key,
        tempo,
        'en kisa(sn)': secs['en kısa'].toFixed(1),
        'tipik(sn)': secs.tipik.toFixed(1),
        'en uzun(sn)': secs['en uzun'].toFixed(1),
        'aralik(sn)': `${lo.toFixed(1)}–${hi.toFixed(1)}`,
        'en dusuk pay': strict ? minRead.toFixed(2) : '-',
        ihlal: strict ? violations : `${violations} (rapor)`,
        'en dar pay(sn)': worstMargin.toFixed(2),
        'en dar metin': worstText.slice(0, 34),
      });
    }
  }
  // 3) panelin sure tablosu = hesap (alt sinir 5'e asagi, ust sinir 5'e yukari; fast tam)
  const web = readWebTable();
  for (const [key, byTempo] of Object.entries(ranges)) {
    for (const [tempo, [lo, hi]] of Object.entries(byTempo)) {
      const want = displayRange(tempo, lo, hi);
      const got = web?.[key]?.[tempo];
      if (!got || got[0] !== want[0] || got[1] !== want[1]) failures.push(`panel tablosu ${key}.${tempo}: ${JSON.stringify(got ?? null)} yaziyor, hesap ${JSON.stringify(want)}`);
    }
  }
  const styleTable = styles.flatMap((style) => TEMPOS.map((tempo) => {
    const st = styleStats[style][tempo];
    return { stil: style, tempo, 'video (5 bicim)': st.checked, ihlal: tempo === 'fast' ? `${st.violations} (rapor)` : st.violations, 'en dar pay(sn)': st.worst.toFixed(2), 'en dar metin': st.worstText.slice(0, 44) };
  }));
  return { failures, table, styleTable, ranges, settle: SETTLE };
}

/* ───────────── stil fontlari: Turkce glifler (TTF cmap) ───────────── */

const TR_GLYPHS = 'şŞğĞıİâÂçÇöÖüÜîÎûÛ';

/** TrueType cmap'inden kod noktalari (bicim 4 ve 12; Unicode alt tablolari) */
export function fontCodepoints(file) {
  const b = readFileSync(file);
  const n = b.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < n; i++) {
    const rec = 12 + 16 * i;
    if (b.toString('latin1', rec, rec + 4) === 'cmap') cmap = b.readUInt32BE(rec + 8);
  }
  if (cmap < 0) throw new Error(`${file}: cmap tablosu yok`);
  const cps = new Set();
  const subtables = b.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = b.readUInt16BE(cmap + 4 + 8 * i);
    const enc = b.readUInt16BE(cmap + 6 + 8 * i);
    if (!(platform === 0 || (platform === 3 && (enc === 1 || enc === 10)))) continue;
    const off = cmap + b.readUInt32BE(cmap + 8 + 8 * i);
    const format = b.readUInt16BE(off);
    if (format === 4) {
      const segX2 = b.readUInt16BE(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      for (let k = 0; k < segX2 / 2; k++) {
        const end = b.readUInt16BE(ends + 2 * k);
        const start = b.readUInt16BE(starts + 2 * k);
        for (let c = start; c <= end && c !== 0xffff; c++) cps.add(c);
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const start = b.readUInt32BE(off + 16 + 12 * g);
        const end = b.readUInt32BE(off + 20 + 12 * g);
        for (let c = start; c <= end && c - start < 70000; c++) cps.add(c);
      }
    }
  }
  return cps;
}

/** Her stilin (ve ortak Sora / Plus Jakarta Sans) fontu Turkce glifleri iceriyor mu */
export function checkStyleFonts() {
  const out = [];
  const files = new Set(['fonts/Sora.ttf', 'fonts/PlusJakartaSans.ttf']);
  for (const style of VIDEO_STYLES) for (const f of STYLE_FONTS[style]) files.add(f.file);
  for (const f of files) {
    let cps;
    try {
      cps = fontCodepoints(join(ROOT, 'public', f));
    } catch (e) {
      out.push(`font okunamadi: ${f} (${e.message})`);
      continue;
    }
    const missing = [...TR_GLYPHS].filter((ch) => !cps.has(ch.codePointAt(0)));
    if (missing.length) out.push(`font ${f}: Turkce glif eksik: ${missing.join(' ')}`);
  }
  return out;
}

/** Panelde gosterilen yaklasik aralik: fast tam saniye; digerleri 5 sn'ye yuvarlanmis */
export function displayRange(tempo, lo, hi) {
  if (tempo === 'fast') return [Math.round(lo), Math.round(hi)];
  return [Math.floor(lo / 5) * 5, Math.min(MAX_SECONDS, Math.ceil(hi / 5) * 5)];
}

function readWebTable() {
  let src;
  try {
    src = readFileSync(WEB_LIB, 'utf8');
  } catch {
    return null;
  }
  const block = /export const VIDEO_TEMPO_SECONDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  if (!block) return null;
  const out = {};
  for (const m of block.matchAll(/'([a-z]+\.[a-z]+)':\s*\{([^}]*)\}/g)) {
    out[m[1]] = {};
    for (const t of m[2].matchAll(/(fast|normal|slow):\s*\[(\d+),\s*(\d+)\]/g)) out[m[1]][t[1]] = [Number(t[2]), Number(t[3])];
  }
  return out;
}

/* ───────────── CLI ───────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const brief = process.argv.includes('--brief');
  const r = checkAll();
  if (!brief) {
    for (const comp of ['ArticleShort', 'SiteIntro', 'ProductShort']) {
      for (const tempo of TEMPOS) {
        const e = evaluate(comp, tempo, TYPICAL);
        console.log(`\n══ ${comp} · ${tempo} · tipik metin · ${e.seconds.toFixed(1)} sn · ${e.plan.bpm} BPM ══`);
        console.table(e.rows.map((x) => ({ metin: x.id, kelime: x.words, 'gorunur(sn)': `${(x.from / FPS).toFixed(2)}–${(x.to / FPS).toFixed(2)}`, 'sure(sn)': x.vis.toFixed(2), 'gerekli(sn)': x.req.toFixed(2), sonuc: x.ok ? 'OK' : 'KISA' })));
        if (e.listRows.length) console.table(e.listRows.map((l) => ({ liste: l.id, oge: l.items, 'son ogeden sonra(sn)': l.hold.toFixed(2), sonuc: l.ok ? 'OK' : 'KISA' })));
      }
    }
  }
  console.log(`\nGiris yayi %95: hizli ${r.settle.fast} kare, sakin ${r.settle.calm} kare, yumusak ${r.settle.soft} kare. Kural: max(${READ_RULE.minSec} sn, ${READ_RULE.perWordSec} sn x kelime + ${READ_RULE.baseSec} sn); liste ${READ_RULE.listHoldSec} sn; en fazla ${MAX_SECONDS} sn.`);
  console.log("'fast' (hızlı — kısa metinler için) eski 15 / 24 sn izgaradir; ihlalleri yalniz raporlanir.");
  console.table(r.table);
  console.log(`\nVideo stilleri (${VIDEO_STYLES.filter((x) => x !== 'classic').join(', ')}): ayni plan, stilin metin pencereleri; her satir 5 bicim x (en kisa + tipik + en uzun + rastgele) metin.`);
  console.table(r.styleTable);
  if (r.failures.length) {
    console.error(`\n${r.failures.length} ihlal:\n- ${r.failures.slice(0, 40).join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nnormal ve slow: her stilde her metin ve liste kurali sagliyor; tum videolar <= 60 sn; panel tablosu hesapla ayni; stil fontlarinda Turkce glifler var.');
}
