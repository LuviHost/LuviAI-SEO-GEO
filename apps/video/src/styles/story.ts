import { Easing } from 'remotion';
import { ramp } from '../marketing/kit';
import type { TempoTimeline } from '../tempo/TempoTimeline';
import { STYLE_EXITS, type StyledComposition, type VideoStyle } from './registry.mjs';

/**
 * Stilli videolarin ortak "hikaye" modeli ve zaman pencereleri.
 *
 * Hikaye: kompozisyonun props'undan, CLASSIC sablonun gosterdigi metinlerin AYNISI (stil icerik eklemez /
 * cikarmaz). Site tanitiminda ust etiket (kicker) yoktur, urun tanitiminda marka adi metin olarak yoktur —
 * classic SiteIntro / ProductShort ile ayni; planlayicinin okuma butcesi (src/tempo/plan.mjs TEXTS) de buna gore.
 *
 * Pencereler: her metnin giris yayi ve cikis ani classic sablonla ayni olaylardan (useTL — tempo cizelgesi):
 * giris TL.snap / TL.soft (normal / slow'da sakin yay, fast'ta eski kit yayi), cikis STYLE_EXITS (registry.mjs).
 * Stil yalniz bu ilerleme degerlerini GORSELE cevirir (itme, savrulma, kelime kelime giris ...). Kelime
 * kelime girislerde de son kelime, tek parca metnin %95'e vardigi karede tam gorunur (stagger()). Okunurluk
 * denetimi (scripts/check-video-readability.mjs STYLED_SPEC) bu pencereleri bagimsiz olarak yeniden kurar.
 */

export type StoryKind = 'article' | 'site' | 'product';
export type StoryPoint = { title: string; detail?: string };
export type StoryBrand = { name: string; domain: string; primary?: string; logoUrl?: string };

/** Uc sablonun props birlesimi (ArticleShortProps / SiteIntroProps / ProductShortProps) */
export interface StoryProps {
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: StoryPoint[];
  cta: { label: string; domain: string; url?: string };
  brand: StoryBrand;
  sourcePath?: string;
  image?: string;
  price?: string;
  muted?: boolean;
  watermark?: boolean;
  tempo?: string;
  style?: string;
}

export interface Story {
  comp: StyledComposition;
  kind: StoryKind;
  wide: boolean;
  W: number;
  H: number;
  brand: StoryBrand;
  /** yalniz makale ve urun (site tanitiminda classic de gostermez) */
  kicker: string;
  hook: string;
  hookSub: string;
  /** yalniz makale: ekranda kaynak yolu */
  source: string;
  points: StoryPoint[];
  cta: { label: string; domain: string };
  image: string;
  price: string;
  watermark: boolean;
  /** kapanistaki buyuk ad: makale / site marka adi, urun urun adi (kanca) */
  endName: string;
  /** sahneler boyunca ustteki satir: makale marka (kancadan), site marka (maddelerden), yatay urun urun adi */
  header: string;
  /** site / urun: kartlar kapanisa dek birikir; makale: maddeler tek tek */
  list: boolean;
}

const KIND: Record<StyledComposition, StoryKind> = {
  ArticleShort: 'article',
  SiteIntro: 'site',
  SiteIntroWide: 'site',
  ProductShort: 'product',
  ProductWide: 'product',
};

export function buildStory(comp: StyledComposition, p: StoryProps): Story {
  const kind = KIND[comp];
  const wide = comp === 'SiteIntroWide' || comp === 'ProductWide';
  const t = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
  return {
    comp,
    kind,
    wide,
    W: wide ? 1920 : 1080,
    H: wide ? 1080 : 1920,
    brand: p.brand,
    kicker: kind === 'site' ? '' : t(p.kicker),
    hook: t(p.hook),
    hookSub: t(p.hookSub),
    source: kind === 'article' ? t(p.sourcePath) || t(p.cta?.domain) : '',
    points: (p.points ?? []).slice(0, 3).map((x) => ({ title: t(x.title), ...(t(x.detail) ? { detail: t(x.detail) } : {}) })),
    cta: { label: t(p.cta?.label), domain: t(p.cta?.domain) },
    image: kind === 'product' ? t(p.image) : '',
    price: kind === 'product' ? t(p.price) : '',
    watermark: p.watermark !== false,
    endName: kind === 'product' ? t(p.hook) : t(p.brand?.name),
    header: kind === 'product' ? (wide ? t(p.hook) : '') : t(p.brand?.name),
    list: kind !== 'article',
  };
}

/** Zaman pencereleri — hepsi kare -> 0..1 (giris yaylari asabilir: >1) */
export interface Win {
  tl: TempoTimeline;
  fpb: number;
  total: number;
  hookE: number;
  endS: number;
  scene: (i: number) => [number, number];
  /** site: buyuk logo; makale: ust marka satiri; urun: gorsel karti */
  logoIn: (f: number) => number;
  kickerIn: (f: number) => number;
  titleIn: (f: number) => number;
  /** site: kancadaki marka adi */
  nameIn: (f: number) => number;
  subIn: (f: number) => number;
  sourceIn: (f: number) => number;
  priceIn: (f: number) => number;
  hookOut: (f: number) => number;
  headerIn: (f: number) => number;
  headerOut: (f: number) => number;
  pointIn: (i: number, f: number) => number;
  pointTitleIn: (i: number, f: number) => number;
  detailIn: (i: number, f: number) => number;
  pointOut: (i: number, f: number) => number;
  /** sahnelerdeki kucuk filigran gorunurlugu */
  wm: (f: number) => number;
  endWipe: (f: number) => number;
  endTileIn: (f: number) => number;
  endNameIn: (f: number) => number;
  labelIn: (f: number) => number;
  ctaIn: (f: number) => number;
  markIn: (f: number) => number;
  /** f karesinde son vurustan bu yana gecen kare (vurus nabzi icin) */
  sinceBeat: (f: number, beats?: number) => number;
}

export function makeWin(tl: TempoTimeline, story: Story, style: VideoStyle): Win {
  const X = STYLE_EXITS[style][story.comp];
  const at = (id: string) => tl.at(id);
  const [, hookE] = tl.scene('hook');
  const [endS] = tl.scene('end');
  const scene = (i: number) => tl.scene(`p${i + 1}`);
  const fpb = tl.plan.fpb;
  const kind = story.kind;
  const hookSpan = Math.min(8, X.hook);
  const exitEase = Easing.in(Easing.cubic);
  return {
    tl,
    fpb,
    total: tl.durationInFrames,
    hookE,
    endS,
    scene,
    logoIn: (f) => tl.snap(f, at(kind === 'site' ? 'hook.logo' : kind === 'product' ? 'hook.image' : 'hook.brand') + 4),
    kickerIn: (f) => tl.snap(f, at('hook.title') + (kind === 'product' ? -4 : -6)),
    titleIn: (f) => tl.snap(f, at('hook.title')),
    nameIn: (f) => (kind === 'site' ? tl.snap(f, at('hook.name')) : 0),
    subIn: (f) => tl.soft(f, at('hook.sub')),
    sourceIn: (f) => (kind === 'article' ? tl.soft(f, at('hook.source')) : 0),
    priceIn: (f) => (kind === 'product' ? tl.snap(f, at('hook.price')) : 0),
    hookOut: (f) => ramp(f, hookE - X.hook, hookE - X.hook + hookSpan, exitEase),
    headerIn: (f) => (kind === 'article' ? tl.snap(f, at('hook.brand') + 4) : tl.snap(f, scene(0)[0])),
    headerOut: (f) => ramp(f, endS - X.list, endS, exitEase),
    pointIn: (i, f) => tl.snap(f, scene(i)[0], 30, 5),
    pointTitleIn: (i, f) => (kind === 'article' ? Math.min(tl.snap(f, scene(i)[0], 30, 5), tl.snap(f, at(`p${i + 1}.title`))) : tl.snap(f, scene(i)[0], 30, 5)),
    detailIn: (i, f) => (kind === 'site' ? tl.snap(f, scene(i)[0], 30, 5) : Math.min(tl.snap(f, scene(i)[0], 30, 5), tl.snap(f, at(`p${i + 1}.detail`)))),
    pointOut: (i, f) => (story.list ? ramp(f, endS - X.list, endS, exitEase) : ramp(f, scene(i)[1] - X.point, scene(i)[1], exitEase)),
    wm: (f) => tl.soft(f, 8) * (1 - ramp(f, endS - 6, endS)),
    endWipe: (f) => ramp(f, endS - 7, endS + 5, Easing.bezier(0.45, 0, 0.15, 1)),
    endTileIn: (f) => tl.snap(f, endS + 1),
    endNameIn: (f) => tl.snap(f, endS + 5),
    labelIn: (f) => tl.soft(f, at('end.cta') - 4),
    ctaIn: (f) => tl.snap(f, at('end.cta')),
    markIn: (f) => tl.soft(f, at('end.url') + 4),
    sinceBeat: (f, beats = 1) => {
      const period = fpb * beats;
      return ((f % period) + period) % period;
    },
  };
}
