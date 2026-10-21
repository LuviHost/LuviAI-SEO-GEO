import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VIDEO_APP_DIR } from './article-short-kit.js';
import { DEFAULT_VIDEO_TEMPO, LEGACY_VIDEO_TEMPO, VIDEO_COMPOSITION, VIDEO_TEMPOS } from './article-video.config.js';

/**
 * RanksUp Video tempolari — apps/video planlayicisi (src/tempo/plan.mjs), okunurluk denetimi
 * (scripts/check-video-readability.mjs) ve render hatti (render/article-short.mjs) TEK KAYNAK;
 * bu test ayni modulleri yukler (kopya yok).
 *   - normal ve slow: her metin max(2 sn; 0,3 sn x kelime + 1 sn) tam gorunur, liste son ogeden
 *     sonra >= 2,5 sn, en uzun metinde bile <= 60 sn ve okuma payi >= 1,0; panel sure tablosu = hesap
 *   - fast: eski sabit izgara (15 sn dikey, 24 sn yatay site) — geriye uyum
 *   - tempo listesi API = planlayici; eksik tempo render'da 'fast'
 */
const load = (rel: string) => import(pathToFileURL(path.join(VIDEO_APP_DIR, rel)).href);
const timeline = () => JSON.parse(readFileSync(path.join(VIDEO_APP_DIR, 'src/marketing/timeline.json'), 'utf8'));

describe('okunurluk denetimi (5 bicim x 3 tempo; en uzun, en kisa, tipik, rastgele metin)', () => {
  it('normal ve slow kurali her metinde sagliyor; hicbir video 60 sn yi asmiyor; panel tablosu hesapla ayni', async () => {
    const { checkAll } = await load('scripts/check-video-readability.mjs');
    const r = checkAll({ randomCount: 150 });
    expect(r.failures).toEqual([]);
    // Ozet tablo: normal ve slow satirlari ihlalsiz, fast yalniz raporlanir
    for (const row of r.table) {
      if (row.tempo !== 'fast') expect(row.ihlal, `${row.bicim}/${row.tempo}`).toBe(0);
      expect(Number(row['en uzun(sn)'])).toBeLessThanOrEqual(60);
    }
  }, 60_000);

  it('denetim gercekten yakalar: kural disi kisa sahne ve 60 sn asimi ihlal sayilir', async () => {
    const { evaluate, TYPICAL } = await load('scripts/check-video-readability.mjs');
    const ok = evaluate('ArticleShort', 'normal', TYPICAL);
    expect(ok.rows.every((x: any) => x.ok)).toBe(true);
    // fast (eski 15 sn) tipik metinde kurali saglamaz — "hizli — kisa metinler icin"
    const fast = evaluate('ArticleShort', 'fast', TYPICAL);
    expect(fast.rows.some((x: any) => !x.ok)).toBe(true);
  });
});

describe('planlayici', () => {
  it('tempo listesi, varsayilan ve eski kayit tempusu API ile ayni', async () => {
    const plan = await load('src/tempo/plan.mjs');
    expect([...plan.TEMPOS]).toEqual([...VIDEO_TEMPOS]);
    expect(plan.DEFAULT_REQUEST_TEMPO).toBe(DEFAULT_VIDEO_TEMPO);
    expect(plan.LEGACY_TEMPO).toBe(LEGACY_VIDEO_TEMPO);
    expect(plan.normalizeTempo(undefined)).toBe('fast');
    expect(plan.normalizeTempo('turbo')).toBe('fast');
    // Her API sablonu planlanabilir
    for (const byFormat of Object.values(VIDEO_COMPOSITION)) for (const id of Object.values(byFormat)) if (id) expect(plan.PLAN_TEMPLATE[id], id).toBeTruthy();
  });

  it('fast eski izgarayla BIREBIR (15 sn dikey, 24 sn yatay site; sahne ve olay kareleri); muzik hizli uslubun tek dosyasi', async () => {
    const { createPlanner } = await load('src/tempo/plan.mjs');
    const tl = timeline();
    const P = createPlanner(tl);
    const files = new Set(P.stemJobs().map((j: any) => `audio/tempo/${j.file}`));
    for (const [id, beats] of [['ArticleShort', 30], ['SiteIntro', 30], ['SiteIntroWide', 48], ['ProductShort', 30], ['ProductWide', 30]] as const) {
      const p = P.plan(id, 'fast', { hook: 'x '.repeat(40), points: [] });
      expect(p.durationInFrames, id).toBe(beats * 15);
      const def = tl.compositions[p.template];
      for (const e of def.events) expect(p.events[e.id], `${id} ${e.id}`).toBe(Math.round(e.at * 15));
      // Ses: pazarlama izi (public/audio/<ad>.wav) DEGIL, hizli tempoya ozgu uslup (synth.mjs 'full' isi)
      const src = `audio/tempo/${tl.tempo.templates[p.template].audio}-fast.wav`;
      expect(files.has(src), src).toBe(true);
      expect(p.audio).toEqual([{ src, from: 0, durationInFrames: beats * 15, trimBefore: 0, fadeIn: 0, fadeOut: 0 }]);
    }
  });

  it('her tempo kendi uslubu: ton, akor yurusu, enstrumanlar farkli; BPM uslup araliginda (ayni muzigin yavaslatilmisi degil)', async () => {
    const { STYLES } = await load('scripts/audio/styles.mjs');
    const tl = timeline();
    const bpm: Record<string, number> = { fast: tl.bpm, normal: tl.tempo.presets.normal.bpm, slow: tl.tempo.presets.slow.bpm };
    const infos = ['fast', 'normal', 'slow'].map((t) => STYLES[t].info);
    for (const k of ['key', 'progression', 'instruments', 'genre'] as const) expect(new Set(infos.map((i: any) => i[k])).size, k).toBe(3);
    for (const t of ['fast', 'normal', 'slow']) {
      const [lo, hi] = STYLES[t].info.bpmRange;
      expect(bpm[t], t).toBeGreaterThanOrEqual(lo);
      expect(bpm[t], t).toBeLessThanOrEqual(hi);
      // timeline.json'daki her muzik seviyesi uslupte tanimli
      for (const level of ['pulse', 'L1', 'L2', 'L3', 'L4']) expect(STYLES[t].levels[level], `${t}/${level}`).toBeTruthy();
    }
    expect(STYLES.normal.info.swing).toBeGreaterThanOrEqual(0.58);
    expect(STYLES.normal.info.swing).toBeLessThanOrEqual(0.62);
  });

  it('sure metinden: uzun metin daha uzun video; slow tipik metinde normalin 1,4-1,6 kati; hepsi <= 60 sn', async () => {
    const { createPlanner } = await load('src/tempo/plan.mjs');
    const { TYPICAL } = await load('scripts/check-video-readability.mjs');
    const P = createPlanner(timeline());
    for (const id of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort']) {
      const n = P.plan(id, 'normal', TYPICAL).durationInFrames;
      const s = P.plan(id, 'slow', TYPICAL).durationInFrames;
      expect(s / n, id).toBeGreaterThanOrEqual(1.4);
      expect(s / n, id).toBeLessThanOrEqual(1.6);
      const longer = { ...TYPICAL, points: TYPICAL.points.map((p: any) => ({ ...p, detail: `${p.detail} ${p.detail}` })) };
      expect(P.plan(id, 'normal', longer).durationInFrames, id).toBeGreaterThan(n);
      // Asiri yogun (tek harfli kelimeler) metin bile 60 sn'yi asmaz: okuma payi kuculur
      const absurd = { ...TYPICAL, hook: 'a '.repeat(55), hookSub: 'a '.repeat(70), points: [0, 1, 2].map(() => ({ title: 'a '.repeat(45), detail: 'a '.repeat(55) })) };
      for (const t of ['normal', 'slow']) expect(P.plan(id, t, absurd).durationInFrames, `${id}/${t}`).toBeLessThanOrEqual(60 * 30);
    }
  });

  it('sahneler vurusa oturur; ses parcalari videodan tasmaz, govde dongusu bitisik, kokler sentezlenen dosyalar', async () => {
    const { createPlanner } = await load('src/tempo/plan.mjs');
    const { TYPICAL } = await load('scripts/check-video-readability.mjs');
    const P = createPlanner(timeline());
    const files = new Set(P.stemJobs().map((j: any) => `audio/tempo/${j.file}`));
    for (const id of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort']) {
      for (const t of ['normal', 'slow']) {
        const p = P.plan(id, t, TYPICAL);
        for (const [, [a, b]] of Object.entries(p.scenes) as Array<[string, [number, number]]>) {
          expect(a % p.fpb, `${id}/${t} sahne basi vurusta`).toBe(0);
          expect(b % p.fpb).toBe(0);
        }
        for (const a of p.audio) {
          expect(files.has(a.src), a.src).toBe(true);
          expect(a.from).toBeGreaterThanOrEqual(0);
          expect(a.from + a.durationInFrames).toBeLessThanOrEqual(p.durationInFrames);
        }
        const body = p.audio.filter((a: any) => a.src.endsWith('-body.wav'));
        expect(body[0].from).toBe(p.scenes.p1[0]);
        for (let i = 1; i < body.length; i++) expect(body[i].from).toBe(body[i - 1].from + body[i - 1].durationInFrames);
        expect(body.at(-1).from + body.at(-1).durationInFrames).toBe(p.scenes.end[0]);
        // Dongu sinirinda solma yok (kesintisiz); yalniz son parca solar
        expect(body.slice(0, -1).every((a: any) => a.fadeOut === 0)).toBe(true);
        expect(p.audio.find((a: any) => a.src.endsWith('-outro.wav')).from).toBe(p.scenes.end[0] - p.fpb);
      }
    }
  });
});

describe('render hatti ve Remotion kompozisyonlari', () => {
  it('eksik tempo render da fast; poster normal/slow da kanca tam gorunurken (plan karesi)', async () => {
    const r = await load('render/article-short.mjs');
    const { TYPICAL } = await load('scripts/check-video-readability.mjs');
    expect(r.withTempo({ hook: 'x' }).tempo).toBe('fast');
    expect(r.withTempo({ hook: 'x', tempo: 'slow' }).tempo).toBe('slow');
    expect(r.posterSecondsFor('ArticleShort', { ...TYPICAL })).toBe(2.6);
    const { createPlanner } = await load('src/tempo/plan.mjs');
    const P = createPlanner(timeline());
    for (const id of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort', 'ProductWide']) {
      const p = P.plan(id, 'normal', TYPICAL);
      const sec = r.posterSecondsFor(id, { ...TYPICAL, tempo: 'normal' });
      expect(sec, id).toBeCloseTo(p.posterFrame / 30, 2);
      expect(sec * 30, id).toBeLessThan(p.scenes.hook[1]);
      expect(sec * 30, id).toBeGreaterThan(p.events['hook.sub'] ?? 0);
    }
  });

  it('Root.tsx: RanksUp Video kompozisyonlarinin suresi props tan (calculateMetadata)', () => {
    const root = readFileSync(path.join(VIDEO_APP_DIR, 'src/Root.tsx'), 'utf8');
    for (const id of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort', 'ProductWide']) {
      expect(root, id).toMatch(new RegExp(`id="${id}"[\\s\\S]{0,120}calculateMetadata=\\{tempoMetadata\\('${id}'\\)\\}`));
    }
  });
});
