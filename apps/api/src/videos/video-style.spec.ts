import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VIDEO_APP_DIR } from './article-short-kit.js';
import { DEFAULT_VIDEO_STYLE, VIDEO_STYLE_MESSAGE, VIDEO_STYLES, videoStyleOf } from './article-video.config.js';
import { buildPromoProps } from './video-render.service.js';

/**
 * RanksUp Video gorsel stilleri — apps/video stil kaydi (src/styles/registry.mjs), render hatti
 * (render/article-short.mjs: izin listesi + varlik denetimi), stok klip indirici (scripts/stock.mjs) ve
 * okunurluk denetimi (scripts/check-video-readability.mjs) TEK KAYNAK; bu test ayni modulleri yukler.
 *   - stil listesi API = kayit; eksik / bos stil = classic, liste disi stil render hattinda HATA
 *   - 'footage' stok klipleri: sabit Mixkit adresleri, boyut + sha256, git disi; eksikse StyleAssetError
 *   - her stil x 5 bicim x normal / slow: okunurluk kurali; denetim gercekten yakalar; fontlarda Turkce glifler
 *   - classic yol degismedi: kompozisyonlar yalniz classic disinda stilli videoya devreder
 */
const load = (rel: string) => import(pathToFileURL(path.join(VIDEO_APP_DIR, rel)).href);
const src = (rel: string) => readFileSync(path.join(VIDEO_APP_DIR, rel), 'utf8');

describe('stil kaydi', () => {
  it('liste ve varsayilan API ile ayni; eski / bozuk kayit classic', async () => {
    const reg = await load('src/styles/registry.mjs');
    expect([...reg.VIDEO_STYLES]).toEqual([...VIDEO_STYLES]);
    expect(reg.DEFAULT_STYLE).toBe(DEFAULT_VIDEO_STYLE);
    expect(DEFAULT_VIDEO_STYLE).toBe('classic');
    expect(videoStyleOf(undefined)).toBe('classic');
    expect(videoStyleOf({})).toBe('classic');
    expect(videoStyleOf({ style: 'Panel' })).toBe('classic');
    expect(videoStyleOf({ style: 'swiss' })).toBe('swiss');
    expect(VIDEO_STYLE_MESSAGE).toBe("style 'classic', 'panel', 'paper', 'swiss', 'chat', 'diagram' ya da 'footage' olmalı.");
    // Her stilin her kompozisyonda okunurluk cikislari tanimli ve classic'ten erken degil
    for (const s of reg.VIDEO_STYLES) {
      for (const comp of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort', 'ProductWide']) {
        const x = reg.STYLE_EXITS[s][comp];
        const c = reg.STYLE_EXITS.classic[comp];
        expect(x.hook, `${s}/${comp}`).toBeLessThanOrEqual(c.hook);
        expect(x.point).toBeLessThanOrEqual(c.point);
        expect(x.list).toBeLessThanOrEqual(c.list);
      }
    }
  });

  it('render hatti: stil her zaman acik; eksik = classic; liste disi deger HATA (dosya / modul secemez)', async () => {
    const r = await load('render/article-short.mjs');
    expect(r.renderProps({ hook: 'x' })).toMatchObject({ style: 'classic', tempo: 'fast' });
    expect(r.renderProps({ hook: 'x', style: '' }).style).toBe('classic');
    expect(r.renderProps({ hook: 'x', style: 'chat', tempo: 'slow' })).toMatchObject({ style: 'chat', tempo: 'slow' });
    for (const bad of ['Panel', '../footage', 'stock/x.mp4', 7, {}]) expect(() => r.renderProps({ hook: 'x', style: bad })).toThrow(/Bilinmeyen video stili/);
    expect(() => r.assertStyleAssets('../../etc/passwd')).toThrow(/Bilinmeyen video stili/);
  });

  it("footage stok klipleri: sabit Mixkit adresleri, boyut + sha256 kayitli, git disi; eksik / yarim dosya StyleAssetError (kod: VIDEO_STYLE_ASSETS_MISSING)", async () => {
    const reg = await load('src/styles/registry.mjs');
    const r = await load('render/article-short.mjs');
    expect(reg.STOCK_CLIPS.length).toBeGreaterThanOrEqual(3);
    for (const c of reg.STOCK_CLIPS) {
      expect(c.url).toMatch(/^https:\/\/assets\.mixkit\.co\/videos\/\d+\/\d+-1080\.mp4$/);
      expect(c.page).toMatch(/^https:\/\/mixkit\.co\/free-stock-video\//);
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(c.bytes).toBeGreaterThan(1_000_000);
      expect(c.file).toMatch(/^mixkit-\d+-[a-z-]+\.mp4$/);
      expect(c.use[1]).toBeGreaterThan(c.use[0]);
    }
    expect(src('.gitignore')).toMatch(/^public\/stock\/$/m);
    expect(reg.styleAssets('footage').stock.map((x: any) => x.file)).toEqual(reg.STOCK_CLIPS.map((c: any) => `stock/${c.file}`));
    expect(reg.styleAssets('panel').stock).toEqual([]);

    // Sahte kok: fontlar var, klipler yok -> hata; yarim klip (yanlis boyut) -> hata; dogru boyut -> gecer
    const root = mkdtempSync(path.join(os.tmpdir(), 'rv-style-'));
    try {
      mkdirSync(path.join(root, 'public', 'fonts'), { recursive: true });
      mkdirSync(path.join(root, 'public', 'stock'), { recursive: true });
      for (const f of ['Anton.ttf', 'Caveat.ttf', 'Inter.ttf']) writeFileSync(path.join(root, 'public', 'fonts', f), 'x');
      expect(r.assertStyleAssets('classic', root)).toBe('classic');
      expect(r.assertStyleAssets('paper', root)).toBe('paper');
      let err: any;
      try {
        r.assertStyleAssets('footage', root);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(r.StyleAssetError);
      expect(err.code).toBe('VIDEO_STYLE_ASSETS_MISSING');
      expect(err.missing).toHaveLength(reg.STOCK_CLIPS.length);
      for (const c of reg.STOCK_CLIPS) writeFileSync(path.join(root, 'public', 'stock', c.file), Buffer.alloc(16));
      expect(() => r.assertStyleAssets('footage', root)).toThrow(/dosya eksik/);
      // boyut tutunca gecer (sha256 deploy'da dogrulanir; burada seyrek dosya yeter)
      for (const c of reg.STOCK_CLIPS) {
        rmSync(path.join(root, 'public', 'stock', c.file));
        writeFileSync(path.join(root, 'public', 'stock', c.file), '');
        const fd = path.join(root, 'public', 'stock', c.file);
        const { truncateSync } = await import('node:fs');
        truncateSync(fd, c.bytes);
      }
      expect(r.assertStyleAssets('footage', root)).toBe('footage');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('footage klip plani: her bicim x tempo x metin uzunlugunda klip YALNIZ yuzsuz araliginda ve izinli biciminde oynar', async () => {
    const { createPlanner } = await load('src/tempo/plan.mjs');
    const { footageScenes } = await load('src/styles/footage-plan.mjs');
    const { TYPICAL } = await load('scripts/check-video-readability.mjs');
    const reg = await load('src/styles/registry.mjs');
    const P = createPlanner(JSON.parse(readFileSync(path.join(VIDEO_APP_DIR, 'src/marketing/timeline.json'), 'utf8')));
    const short = { ...TYPICAL, hook: 'Kısa', hookSub: '', points: [{ title: 'Bir' }, { title: 'İki' }, { title: 'Üç' }] };
    const absurd = { ...TYPICAL, hook: 'a '.repeat(55), hookSub: 'a '.repeat(70), points: [0, 1, 2].map(() => ({ title: 'a '.repeat(45), detail: 'a '.repeat(55) })) };
    // 42652 ~4 sn'den sonra yuz gosterir: yuzsuz aralik 4 sn'yi gecmemeli
    expect(reg.STOCK_CLIPS.find((c: any) => c.id === 'laptop-hands').use[1]).toBeLessThanOrEqual(3.8);
    expect(reg.STOCK_CLIPS.find((c: any) => c.id === 'office-desk').formats).toEqual(['vertical']);
    let checked = 0;
    for (const comp of ['ArticleShort', 'SiteIntro', 'SiteIntroWide', 'ProductShort', 'ProductWide']) {
      for (const tempo of ['fast', 'normal', 'slow']) {
        for (const props of [short, TYPICAL, absurd]) {
          const p = P.plan(comp, tempo, props);
          const wide = comp.endsWith('Wide');
          const scenes = footageScenes({ cuts: [0, p.scenes.p1[0], p.scenes.p2[0], p.scenes.p3[0], p.scenes.end[0]], fpb: p.fpb, wide });
          expect(scenes).toHaveLength(4);
          for (const sc of scenes) {
            const tag = `${comp}/${tempo}/${sc.clip.id}`;
            expect(sc.clip.formats, tag).toContain(wide ? 'horizontal' : 'vertical');
            expect(sc.srcStart, tag).toBeGreaterThanOrEqual(sc.clip.use[0]);
            expect(sc.srcEnd, tag).toBeLessThanOrEqual(sc.clip.use[1]);
            if (sc.loopFrames) expect(sc.loopFrames, tag).toBeLessThan(sc.dur);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(5 * 3 * 3 * 4);
  });

  it('stok indirici: idempotent; boyut / sha256 tutmazsa dosya yerine konmaz; yalniz kayittaki adres', async () => {
    const stock = await load('scripts/stock.mjs');
    const reg = await load('src/styles/registry.mjs');
    const { createHash } = await import('node:crypto');
    const { existsSync } = await import('node:fs');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rv-stock-'));
    try {
      const body = Buffer.from('ornek klip icerigi');
      const clip = { file: 'mixkit-1-ornek.mp4', url: 'https://assets.mixkit.co/videos/1/1-1080.mp4', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
      const seen: string[] = [];
      const ok = async (url: string) => {
        seen.push(url);
        return new Response(body, { status: 200 });
      };
      await expect(stock.ensureStock({ fetchImpl: ok, dir, clips: [clip] })).resolves.toEqual([{ file: clip.file, status: 'downloaded' }]);
      // ikinci calisma: dosya dogrulanir, ag istegi yok
      await expect(stock.ensureStock({ fetchImpl: ok, dir, clips: [clip] })).resolves.toEqual([{ file: clip.file, status: 'ok' }]);
      expect(seen).toEqual([clip.url]);
      // degismis / yarim dosya: hata, yerine konmaz, .part kalmaz
      const bad = { ...clip, file: 'mixkit-2-ornek.mp4' };
      await expect(stock.ensureStock({ fetchImpl: async () => new Response(Buffer.from('baska'), { status: 200 }), dir, clips: [bad] })).rejects.toThrow(/boyut \/ sha256 tutmadi/);
      expect(existsSync(path.join(dir, bad.file))).toBe(false);
      expect(existsSync(path.join(dir, `${bad.file}.part`))).toBe(false);
      await expect(stock.ensureStock({ fetchImpl: async () => new Response('yok', { status: 404 }), dir, clips: [bad] })).rejects.toThrow(/HTTP 404/);
      // Boyut sinirlari: bildirilen boyut buyukse hic indirilmez; bildirmeden fazlasini akitirsa kesilir
      const partDir = path.join(dir, '..', `${path.basename(dir)}-part`);
      const big = (headers: Record<string, string>) => async () => ({ ok: true, status: 200, url: clip.url, headers: new Headers(headers), body: new Response(Buffer.alloc(clip.bytes + 10, 1)).body });
      await expect(stock.ensureStock({ fetchImpl: big({ 'content-length': String(clip.bytes + 10) }), dir, clips: [bad], partDir })).rejects.toThrow(/bildirdi/);
      await expect(stock.ensureStock({ fetchImpl: big({}), dir, clips: [bad], partDir })).rejects.toThrow(/asti/);
      // Yonlendirme baska sunucuya gittiyse indirilmez; kayitta izinsiz adres hic istenmez
      const redirected = async () => ({ ok: true, status: 200, url: 'https://evil.example.com/x.mp4', headers: new Headers(), body: new Response(body).body });
      await expect(stock.ensureStock({ fetchImpl: redirected, dir, clips: [bad], partDir })).rejects.toThrow(/izinli olmayan sunucuya/);
      const asked: string[] = [];
      await expect(stock.ensureStock({ fetchImpl: async (u: string) => { asked.push(u); return new Response(body); }, dir, clips: [{ ...bad, url: 'http://assets.mixkit.co/a.mp4' }], partDir })).rejects.toThrow(/izinli olmayan adres/);
      expect(asked).toEqual([]);
      // Yarim dosya public/stock disinda; eski surumun biraktigi .part en basta silinir
      writeFileSync(path.join(dir, 'eski.mp4.part'), 'x');
      await stock.ensureStock({ fetchImpl: ok, dir, clips: [clip], partDir });
      expect(existsSync(path.join(dir, 'eski.mp4.part'))).toBe(false);
      expect(stock.PART_PATH).not.toContain(`${path.sep}public${path.sep}`);
      rmSync(partDir, { recursive: true, force: true });
      // varsayilan liste kayittaki Mixkit klipleri
      expect(reg.STOCK_CLIPS.every((c: any) => c.url.startsWith('https://assets.mixkit.co/'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('okunurluk — her stil x 5 bicim x 3 tempo', () => {
  it('normal ve slow: her stilde her metin ve liste kurali saglaniyor; stil fontlarinda Turkce glifler var', async () => {
    const { checkAll } = await load('scripts/check-video-readability.mjs');
    const r = checkAll({ randomCount: 60 });
    expect(r.failures).toEqual([]);
    const styles = VIDEO_STYLES.filter((s) => s !== 'classic');
    expect(new Set(r.styleTable.map((x: any) => x.stil))).toEqual(new Set(styles));
    for (const row of r.styleTable) {
      expect(row['video (5 bicim)'], `${row.stil}/${row.tempo}`).toBeGreaterThan(0);
      if (row.tempo !== 'fast') expect(row.ihlal, `${row.stil}/${row.tempo}`).toBe(0);
    }
  }, 60_000);

  it('denetim gercekten yakalar: bir stilin cikisi erkene alinirsa ihlal; eksik Turkce glif yakalanir', async () => {
    const m = await load('scripts/check-video-readability.mjs');
    const reg = await load('src/styles/registry.mjs');
    const saved = reg.STYLE_EXITS.chat;
    try {
      reg.STYLE_EXITS.chat = { ...saved, ArticleShort: { hook: 40, point: 40, list: 6 } };
      const r = m.checkAll({ randomCount: 5 });
      expect(r.failures.some((f: string) => f.startsWith('[chat] ArticleShort/normal'))).toBe(true);
      expect(r.failures.some((f: string) => f.startsWith('[panel]'))).toBe(false);
    } finally {
      reg.STYLE_EXITS.chat = saved;
    }
    const cps = m.fontCodepoints(path.join(VIDEO_APP_DIR, 'public', 'fonts', 'Anton.ttf'));
    for (const ch of 'şŞğĞıİâçöü') expect(cps.has(ch.codePointAt(0)), ch).toBe(true);
    expect(m.checkStyleFonts()).toEqual([]);
  });
});

describe('Remotion kompozisyonlari', () => {
  it('bes kompozisyon yalniz classic disinda stilli videoya devreder; classic yol ayni dosyada', () => {
    for (const [file, ids] of [
      ['src/article-short/ArticleShort.tsx', ['ArticleShort']],
      ['src/promo/SiteIntro.tsx', ['SiteIntro', 'SiteIntroWide']],
      ['src/promo/ProductShort.tsx', ['ProductShort', 'ProductWide']],
    ] as const) {
      const s = src(file);
      for (const id of ids) {
        expect(s, id).toMatch(new RegExp(`export const ${id}: React\\.FC<[^>]+> = \\(props\\) =>\\s+isStyled\\(props\\.style\\) \\? <StyledVideo compositionId="${id}" props=\\{props\\} /> : <${id}Classic \\{\\.\\.\\.props\\} />;`));
        expect(s, id).toMatch(new RegExp(`const ${id}Classic: React\\.FC`));
      }
    }
    const styled = src('src/styles/StyledVideo.tsx');
    for (const s of VIDEO_STYLES.filter((x) => x !== 'classic')) expect(styled, s).toMatch(new RegExp(`\\b${s}: [A-Z][a-z]+Style`));
    // Kaynaklar ve lisanslar kayitli
    const credits = src('src/styles/CREDITS.md');
    for (const k of ['video-shotcraft', 'Apache-2.0', 'lemo-opuscar', 'motion-engine', 'MIT', 'HyperFrames', 'Manim', 'MoviePy', 'Mixkit', 'OFL']) expect(credits, k).toContain(k);
  });

  it('tanitim props una da stil gider (varsayilan classic)', () => {
    const copy: any = { script: { hook: 'H', hookSub: '', kicker: '', points: [{ title: 'T' }], cta: { label: 'L', domain: 'd.com' } } };
    const brand: any = { name: 'B', domain: 'd.com', primary: null, logoDataUri: null };
    const source: any = { domain: 'd.com' };
    expect(buildPromoProps(copy, brand, source, { tempo: 'normal' })).toMatchObject({ style: 'classic', tempo: 'normal' });
    expect(buildPromoProps(copy, brand, source, { tempo: 'slow', style: 'footage' })).toMatchObject({ style: 'footage', tempo: 'slow' });
  });
});
