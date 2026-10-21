/**
 * RanksUp Video tempo planlayicisi — TEK KAYNAK. Remotion sablonlari (src/tempo/TempoTimeline.tsx),
 * render hatti (render/article-short.mjs: poster karesi), ses sentezi (scripts/audio/synth.mjs:
 * kok dosya adlari) ve okunurluk denetimi (scripts/check-video-readability.mjs) ayni fonksiyonlari
 * kullanir. Saf JavaScript: hem tarayici paketinde (webpack) hem Node'da calisir; DOM ya da
 * Remotion icermez (yay sabitleri asagida sayi olarak; denetim betigi Remotion'un spring()'iyle
 * ayni oldugunu dogrular).
 *
 * NEDEN: 21.10.2026 sahip geri bildirimi — sabit 15 sn (120 BPM) videolar okunamayacak kadar hizli.
 * Uc tempo:
 *   fast    bugunku izgara (timeline.json compositions; 15 sn dikey, 24 sn yatay site). Geriye uyum:
 *           tempo alani olmayan eski istekler ve kuyruktaki isler ayni zamanlamayla render edilir
 *           (sahne / olay kareleri BIREBIR; muzik hizli tempoya ozgu enerjik pop uslubu).
 *   normal  okunur: her metin max(2,0 sn; 0,3 sn x kelime + 1,0 sn) tam gorunur kalir.
 *   slow    rahat: okuma payi 1,7 kat, daha yavas izgara (72 BPM); tipik metinde normalin ~1,5 kati.
 * normal / slow'da sahne sureleri METINDEN hesaplanir (kelime sayisi), vurusa yuvarlanir (kesmeler
 * muzigin vurusuna oturur) ve toplam MAX_SECONDS'i (Reels siniri) asmaz.
 * Muzik: her tempo kendi usluplu bestesi (scripts/audio/styles.mjs) — ayni parcanin yavaslatilmisi degil.
 */

export const TEMPOS = ['fast', 'normal', 'slow'];
/** Yeni isteklerin varsayilani (API videos.dto + panel) */
export const DEFAULT_REQUEST_TEMPO = 'normal';
/** tempo alani olmayan eski kayit / is: bugunku sabit izgara */
export const LEGACY_TEMPO = 'fast';

export function normalizeTempo(v) {
  return TEMPOS.includes(v) ? v : LEGACY_TEMPO;
}

/** Okunurluk kurali (KobiPratik dalgasindaki kuralin aynisi; check-video-readability.mjs dogrular) */
export const READ_RULE = { minSec: 2.0, perWordSec: 0.3, baseSec: 1.0, listHoldSec: 2.5 };

/** kelime sayisi; noktalama / isaret tek basina kelime sayilmaz */
export function countWords(text) {
  return String(text ?? '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** bir metnin tam gorunur kalmasi gereken sure (sn); bos metin 0 */
export function readSeconds(text) {
  const w = countWords(text);
  if (!w) return 0;
  return Math.max(READ_RULE.minSec, READ_RULE.perWordSec * w + READ_RULE.baseSec);
}

/**
 * Giris yaylari. fast = marketing/kit.tsx snap() (degismedi); calm = normal/slow'un daha sakin
 * girisi (asma yok). settle: yayin %95'e ulastigi kare (30 fps) — denetim betigi spring() ile
 * yeniden hesaplayip esitligi dogrular.
 */
export const MOTION = {
  fast: { config: { damping: 15, stiffness: 210, mass: 0.7 }, settle: 5 },
  calm: { config: { damping: 20, stiffness: 120, mass: 0.9 }, settle: 12 },
  soft: { config: { damping: 200 }, settle: 15 },
};
export const motionOf = (tempo) => (tempo === 'fast' ? MOTION.fast : MOTION.calm);

/** Bu sablonlarda video planlanir; ProductWide, ProductShort'un planini kullanir */
export const PLAN_TEMPLATE = {
  ArticleShort: 'ArticleShort',
  SiteIntro: 'SiteIntro',
  SiteIntroWide: 'SiteIntroWide',
  ProductShort: 'ProductShort',
  ProductWide: 'ProductShort',
};

const WATERMARK = 'ranksup.ai ile üretildi';
const POINTS = ['p1', 'p2', 'p3'];

/**
 * Planlayicinin metin envanteri — sablonlarin GERCEK giris anlariyla (TSX). Denetim betigi bunu
 * DEGIL kendi bagimsiz tanimini kullanir (cikislar ve kalici kartlar dahil); ikisi ayrisirsa
 * denetim kirilir.
 *   at     sahne icindeki olay ('hook.title', 'p.detail' -> p1.detail ...) ya da '@' (sahne basi)
 *   d      olaya gore kare farki     enter  'snap' | 'soft'     lead  snap'in on basi (kare)
 *   lines / stagger  satir satir giris: son satir (lines-1)*stagger kare sonra
 */
const TEXTS = {
  ArticleShort: (p) => ({
    hook: [
      { t: p.kicker, at: 'hook.title', d: -6 },
      { t: p.hook, at: 'hook.title', lines: 4, stagger: 3 },
      { t: p.hookSub, at: 'hook.sub', enter: 'soft' },
      { t: p.sourcePath || p.cta?.domain, at: 'hook.source', enter: 'soft' },
    ],
    point: (pt) => [
      { t: pt?.title, at: '@', lead: 5 },
      { t: pt?.title, at: 'p.title', lines: 4, stagger: 2 },
      { t: pt?.detail, at: 'p.detail' },
    ],
    end: endTexts(p, p.brand?.name),
  }),
  SiteIntro: (p) => ({
    hook: [
      { t: p.brand?.name, at: 'hook.name' },
      { t: p.hook, at: 'hook.title' },
      { t: p.hookSub, at: 'hook.sub', enter: 'soft' },
    ],
    // Kart basligi ve aciklamasi kartla birlikte girer (sahne basi, lead 5)
    point: (pt) => [
      { t: pt?.title, at: '@', lead: 5 },
      { t: pt?.detail, at: '@', lead: 5 },
    ],
    end: endTexts(p, p.brand?.name),
  }),
  SiteIntroWide: (p) => TEXTS.SiteIntro(p),
  ProductShort: (p) => ({
    hook: [
      { t: p.kicker, at: 'hook.title', d: -4 },
      { t: p.hook, at: 'hook.title' },
      { t: p.hookSub, at: 'hook.sub', enter: 'soft' },
      { t: p.price, at: 'hook.price' },
    ],
    point: (pt) => [
      { t: pt?.title, at: '@', lead: 5 },
      { t: pt?.detail, at: 'p.detail' },
    ],
    // Kapanista urun adi (kanca) tekrar yazilir
    end: endTexts(p, p.hook),
  }),
};

function endTexts(p, name) {
  return [
    { t: name, at: '@', d: 5 },
    { t: p.cta?.label, at: 'end.cta', d: -4, enter: 'soft' },
    { t: p.cta?.domain, at: 'end.cta' },
    { t: p.watermark === false ? '' : WATERMARK, at: 'end.url', d: 4, enter: 'soft' },
  ];
}

/**
 * Sahne cikisi (kare): metin bu kadar kare ONCE solmaya baslar (TSX'teki ramp(e - n, ...)).
 * Kalici kartlar (site / urun) kendi sahnelerinden sonra da gorunur; planlayici yine de her
 * kartin okuma suresini KENDI sahnesine sigdirir (tutucu), listenin son ogesi icin listHold.
 */
const EXIT = {
  ArticleShort: { hook: 6, point: 6, list: false },
  SiteIntro: { hook: 10, point: 6, list: true },
  SiteIntroWide: { hook: 10, point: 6, list: true },
  ProductShort: { hook: 12, point: 6, list: true },
};

/**
 * timeline.json okuyan planlayici. Remotion tarafi JSON'u import eder, Node tarafi readFileSync.
 * @param {any} timeline  src/marketing/timeline.json
 */
export function createPlanner(timeline) {
  const FPS = timeline.fps;
  const T = timeline.tempo;

  /** hizli uslubun sablon basina tek dosyasi (eski izgara, synth.mjs 'full' isi) */
  const fastFile = (template) => `${T.templates[template].audio}-fast.wav`;

  function presetOf(tempo) {
    const p = T.presets[tempo];
    if (!p) throw new Error(`Bilinmeyen tempo: ${String(tempo).slice(0, 20)}`);
    return p;
  }

  /** Bugunku sabit izgara (fast) — timeline.json compositions, 120 BPM; ses: hizli uslubun tek dosyasi */
  function legacyPlan(template) {
    const def = timeline.compositions[template];
    const fpb = (FPS * 60) / (def.bpm ?? timeline.bpm);
    const f = (b) => Math.round(b * fpb);
    const scenes = Object.fromEntries(Object.entries(def.scenes).map(([k, [a, b]]) => [k, [f(a), f(b)]]));
    const events = Object.fromEntries(def.events.map((e) => [e.id, f(e.at)]));
    const total = f(def.beats);
    return {
      template, tempo: 'fast', bpm: def.bpm ?? timeline.bpm, fpb, fps: FPS, read: null, compressed: false,
      durationInFrames: total, scenes, events,
      audio: [{ src: `audio/tempo/${fastFile(template)}`, from: 0, durationInFrames: total, trimBefore: 0, fadeIn: 0, fadeOut: 0 }],
      posterFrame: null,
    };
  }

  /** bir sahnenin gereken uzunlugu (kare, cikis dahil) — okuma payi r ile */
  function sceneNeed(items, rel, fpb, settle, r, exit, extraHold = 0) {
    let need = 0;
    let lastVisible = 0;
    for (const it of items) {
      const sec = readSeconds(it.t);
      if (!sec) continue;
      const at = (it.at === '@' ? 0 : rel(it.at)) + (it.d ?? 0);
      const visible = it.enter === 'soft' ? at + MOTION.soft.settle : at - (it.lead ?? 4) + settle + ((it.lines ?? 1) - 1) * (it.stagger ?? 0);
      lastVisible = Math.max(lastVisible, visible);
      need = Math.max(need, visible + Math.ceil(sec * r * FPS));
    }
    if (extraHold) need = Math.max(need, lastVisible + Math.ceil(extraHold * r * FPS));
    return need + exit;
  }

  function dynamicPlan(template, tempo, props, r) {
    const preset = presetOf(tempo);
    const cfg = T.templates[template];
    const fpb = (FPS * 60) / preset.bpm;
    const settle = MOTION.calm.settle;
    const texts = TEXTS[template](props ?? {});
    const exits = EXIT[template];
    const evRel = (list, prefix) => (id) => {
      const key = prefix ? id.replace(/^p\./, `${prefix}.`) : id;
      const row = list.find(([eid]) => (prefix ? `${prefix}.${eid}` : eid) === key);
      if (!row) throw new Error(`timeline.json tempo.${template}: '${key}' olayi yok`);
      return Math.round(row[1] * fpb);
    };
    const beatsFor = (frames, min) => Math.max(min, Math.ceil(frames / fpb - 1e-9));

    const scenes = {};
    const events = {};
    const sfx = [];
    let cursor = 0;
    const place = (name, beats, list, prefix) => {
      const s = cursor;
      const e = s + Math.round(beats * fpb);
      scenes[name] = [s, e];
      for (const [id, at, fx] of list) {
        const full = prefix ? `${prefix}.${id}` : id;
        const frame = s + Math.round(at * fpb);
        events[full] = frame;
        if (fx) sfx.push({ id: full, name: fx, frame });
      }
      cursor = e;
    };

    place('hook', beatsFor(sceneNeed(texts.hook, evRel(cfg.hook), fpb, settle, r, exits.hook), cfg.minBeats.hook), cfg.hook);
    const pts = Array.isArray(props?.points) ? props.points : [];
    POINTS.forEach((pid, i) => {
      const last = i === POINTS.length - 1;
      const need = sceneNeed(texts.point(pts[i]), evRel(cfg.point, pid), fpb, settle, r, exits.point, exits.list && last ? READ_RULE.listHoldSec : 0);
      place(pid, beatsFor(need, cfg.minBeats.point), cfg.point, pid);
    });
    // Kapanis videonun sonuna kadar surer: cikis yok
    place('end', beatsFor(sceneNeed(texts.end, evRel(cfg.end), fpb, settle, r, 0), cfg.minBeats.end), cfg.end);
    const total = cursor;

    // Ses: sablon basina uc kok (giris / govde dongusu / kapanis) + tempo basina efektler
    const L = Math.round(T.loopBeats * fpb);
    const dir = 'audio/tempo';
    const audio = [];
    // Dongu parcalari arka arkaya kesintisiz (solma yok); yalniz son parca kesmede solar
    // (giriste yarim vurus: eski izgaradaki p1 oncesi sessizlik; govdede tik sesini onleyen 3 kare)
    const loop = (src, from, to, lastFade) => {
      for (let f = from; f < to; f += L) {
        const len = Math.min(L, to - f);
        audio.push({ src, from: f, durationInFrames: len, trimBefore: 0, fadeIn: 0, fadeOut: f + L >= to ? lastFade : 0 });
      }
    };
    const [p1s] = scenes.p1;
    const [endS] = scenes.end;
    loop(`${dir}/${cfg.audio}-${tempo}-intro.wav`, 0, p1s, Math.round(fpb / 2));
    loop(`${dir}/${cfg.audio}-${tempo}-body.wav`, p1s, endS, 3);
    // Kapanis koku bir vurus once baslar (riser kesmeye tirmanir); video sonunda yumusak kapanis
    const outroFrom = endS - Math.round(fpb);
    const outroLen = Math.round((T.outroBeats + 1) * fpb);
    audio.push({ src: `${dir}/${cfg.audio}-${tempo}-outro.wav`, from: outroFrom, durationInFrames: Math.min(outroLen, total - outroFrom), trimBefore: 0, fadeIn: 0, fadeOut: outroLen > total - outroFrom ? Math.round(FPS / 2) : 0 });
    // Efekt dosyalari vurustan bir vurus once baslar (whoosh tepe noktasi kesmeye otursun)
    for (const fx of sfx) {
      const from = fx.frame - Math.round(fpb);
      const len = Math.min(Math.round(T.sfxBeats * fpb), total - from);
      if (len <= 0) continue;
      audio.push({ src: `${dir}/sfx-${tempo}-${fx.name}.wav`, from: Math.max(0, from), durationInFrames: len + Math.min(0, from), trimBefore: Math.max(0, -from), fadeIn: 0, fadeOut: 0 });
    }

    // Poster: kanca tam gorunurken, cikis baslamadan hemen once
    const posterFrame = scenes.hook[1] - exits.hook - 2;
    return { template, tempo, bpm: preset.bpm, fpb, fps: FPS, read: r, compressed: r < preset.read, durationInFrames: total, scenes, events, audio, posterFrame };
  }

  /**
   * Tam plan. tempo yoksa / bilinmiyorsa 'fast' (eski kayitlar). normal / slow: okuma payi
   * preset.read; toplam MAX_SECONDS'i asarsa pay 0,05 adimlarla kuculur (yalniz kopya koruyucusunun
   * gercekci en yogun metninden de yogun metinde — denetim betigi normal ve slow'un en uzun metinde
   * payi 1,0'in altina dusurmedigini dogrular).
   */
  function plan(compositionId, tempo, props) {
    const template = PLAN_TEMPLATE[compositionId];
    if (!template) throw new Error(`Planlanamayan sablon: ${String(compositionId).slice(0, 40)}`);
    const t = normalizeTempo(tempo);
    if (t === 'fast') return legacyPlan(template);
    const preset = presetOf(t);
    const max = T.maxSeconds * FPS;
    let r = preset.read;
    let out = dynamicPlan(template, t, props, r);
    while (out.durationInFrames > max && r > 0) {
      r = Math.max(0, Number((r - 0.05).toFixed(2)));
      out = dynamicPlan(template, t, props, r);
    }
    return out;
  }

  /** synth.mjs icin: hizli tek dosyalar (sablon), kok dosyalari (sablon x tempo) ve efektler (tempo) */
  function stemJobs() {
    const jobs = [];
    for (const [template, cfg] of Object.entries(T.templates)) {
      jobs.push({ kind: 'full', template, tempo: 'fast', bpm: timeline.compositions[template].bpm ?? timeline.bpm, cfg, file: fastFile(template) });
    }
    for (const tempo of Object.keys(T.presets)) {
      const { bpm } = presetOf(tempo);
      for (const [template, cfg] of Object.entries(T.templates)) {
        for (const part of ['intro', 'body', 'outro']) jobs.push({ kind: part, template, tempo, bpm, cfg, file: `${cfg.audio}-${tempo}-${part}.wav` });
      }
      const names = new Set();
      for (const cfg of Object.values(T.templates)) for (const list of [cfg.hook, cfg.point, cfg.end]) for (const [, , fx] of list) if (fx) names.add(fx);
      for (const name of [...names].sort()) jobs.push({ kind: 'sfx', name, tempo, bpm, file: `sfx-${tempo}-${name}.wav` });
    }
    return jobs;
  }

  return { plan, stemJobs, FPS };
}
