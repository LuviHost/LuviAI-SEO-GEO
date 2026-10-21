/**
 * RanksUp tanitim videolari (5 sutun: GEO, SEO, ASO, Icerik, RanksUp Video) — zaman planlayicisi. TEK KAYNAK:
 * Remotion sahneleri (src/pillars/*.tsx), muzik sentezi (scripts/audio/synth-pillars.mjs) ve okunurluk
 * denetimi (scripts/check-pillars-readability.mjs) ayni fonksiyonu kullanir; metinler script.json'da.
 *
 * NEDEN: 21.10.2026 sahip geri bildirimi — onceki videolar okunamayacak kadar hizliydi. Bu yuzden sahne
 * sureleri ELLE degil METINDEN hesaplanir:
 *   metin   ≥ max(2,0 sn; 0,3 sn × kelime + 1,0 sn) tam gorunur      (plan.mjs READ_RULE)
 *   not     ≥ 3,0 sn ("Örnek ekran", kosul notlari)
 *   liste   son oge tam gorundukten sonra tum liste ≥ 2,5 sn ekranda
 * "Tam gorunur" = giris yayi %95'e ulastigi kare → sahne cikisinin basladigi kare (son sahnede video sonu).
 * Sahne bitisi bu kosullarin en gecinden sonra kucuk bir nefes payi eklenip VURUSA yuvarlanir
 * (kesmeler muzigin vurusuna oturur). Her video kendi BPM'i ve muzik uslubuyla (styles.mjs).
 *
 * Saf JavaScript: tarayici paketinde ve Node'da calisir (DOM / Remotion yok).
 */
import { MOTION, READ_RULE, countWords } from '../tempo/plan.mjs';

export const FPS = 30;
/** giris yayi vurustan LEAD kare once baslar; MOTION.calm (%95: settle kare) */
export const LEAD = 6;
export const ENTER = MOTION.calm;
/** sahne cikisi (opaklik) */
export const EXIT_FRAMES = 10;
/** kucuk not / kosul metni en az */
export const NOTE_MIN_SEC = 3.0;
/** her sahnenin sonuna eklenen nefes payi (sn) */
export const BREATH_SEC = 0.4;

export const RULES = { ...READ_RULE, noteMinSec: NOTE_MIN_SEC };

/** bir ogenin gerekli tam gorunur suresi (sn) */
export function needSeconds(item) {
  if (item.kind === 'ui') return 0;
  const w = countWords(item.text);
  const base = Math.max(READ_RULE.minSec, READ_RULE.perWordSec * w + READ_RULE.baseSec);
  return item.kind === 'note' ? Math.max(NOTE_MIN_SEC, base) : base;
}

/**
 * script.json'daki bir videonun plani.
 * Donen: { id, bpm, fpb, style, durationInFrames, scenes[], music[], events[], posterFrame }
 * scenes[i].items[id] = { text, kind, list, appear, visibleFrom, visibleTo, need }
 */
export function planVideo(script, id) {
  const def = script.videos.find((v) => v.id === id);
  if (!def) throw new Error(`script.json: '${id}' videosu yok`);
  const fpb = (FPS * 60) / def.bpm;
  const f = (beats) => Math.round(beats * fpb);
  const scenes = [];
  let startBeat = 0;
  def.scenes.forEach((sc, si) => {
    const last = si === def.scenes.length - 1;
    const start = f(startBeat);
    const items = {};
    let needEnd = start;
    const lists = {};
    for (const it of sc.items) {
      if (items[it.id]) throw new Error(`${id}/${sc.id}: '${it.id}' iki kez`);
      const appear = start + f(it.at);
      const visibleFrom = it.enter === 'instant' ? appear : appear - LEAD + ENTER.settle;
      const need = needSeconds(it);
      items[it.id] = { ...it, appear, visibleFrom, need };
      needEnd = Math.max(needEnd, visibleFrom + Math.ceil(need * FPS));
      if (it.list) (lists[it.list] ??= []).push(visibleFrom);
    }
    for (const arr of Object.values(lists)) needEnd = Math.max(needEnd, Math.max(...arr) + Math.ceil(READ_RULE.listHoldSec * FPS));
    // sahne bitisi: en gec kosul + nefes + cikis (son sahne: cikis yok, kartin ekranda kalma suresi)
    const tail = last ? Math.round((sc.holdSec ?? 1.5) * FPS) : Math.round(BREATH_SEC * FPS) + EXIT_FRAMES;
    let beats = Math.ceil((needEnd + tail - start) / fpb - 1e-9);
    if (sc.minBeats) beats = Math.max(beats, sc.minBeats);
    const endBeat = startBeat + beats;
    const end = f(endBeat);
    for (const it of Object.values(items)) {
      const outFrame = it.out !== undefined ? start + f(it.out) : end;
      it.visibleTo = last && it.out === undefined ? end : outFrame - EXIT_FRAMES;
    }
    scenes.push({ ...sc, index: si, last, startBeat, endBeat, start, end, items });
    startBeat = endBeat;
  });
  const durationInFrames = f(startBeat);

  // muzik: sahne seviyeleri; son sahne 'outro'
  const music = scenes.map((s) => [s.startBeat, s.endBeat, s.last ? 'outro' : s.music ?? 'L2']);
  // efektler: ogelerin sfx alani (vurus = ogenin vurusu) + kapanis riser/hit
  const events = [];
  for (const s of scenes) {
    for (const it of Object.values(s.items)) if (it.sfx) events.push({ id: `${s.id}.${it.id}`, at: s.startBeat + it.at, sfx: it.sfx });
    if (s.sfx) events.push({ id: `${s.id}.cut`, at: s.startBeat, sfx: s.sfx, dur: 1 });
  }
  const endScene = scenes[scenes.length - 1];
  events.push({ id: 'end.riser', at: endScene.startBeat, sfx: 'riser', dur: 1 }, { id: 'end.hit', at: endScene.startBeat, sfx: 'hit' });

  // poster: kanca sahnesinde son metin tam gorunurken
  const hook = scenes[0];
  const posterFrame = Math.min(hook.end - EXIT_FRAMES - 1, Math.max(...Object.values(hook.items).map((i) => i.visibleFrom)) + 4);

  return { id, slug: def.slug, title: def.title, bpm: def.bpm, fpb, style: def.style, energy: def.energy ?? 1, durationInFrames, scenes, music, events, posterFrame };
}

/** sahnenin [start, end) icinde mi */
export function sceneAt(plan, frame) {
  return plan.scenes.find((s) => frame >= s.start && frame < s.end) ?? plan.scenes[plan.scenes.length - 1];
}
