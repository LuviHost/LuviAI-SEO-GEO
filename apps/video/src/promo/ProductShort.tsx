import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { Check } from 'lucide-react';
import { Soundtrack, clamp01, fontDisplay, fontUI, ramp, snap, soft, useBrandFonts } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import { fitText, type Fit } from '../article-short/fit';
import { brandPalette, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile, upperTr } from '../article-short/ArticleShort';
import { CtaPill, DISPLAY, FitLines, ImageGlow, LightField, PriceTag, ProductImageCard, UI, WatermarkLine, fitK, linesH, pillOnBrand, type PromoBaseProps } from './shared';

/**
 * ProductShort — musterinin kendi sitesindeki urun / hizmet sayfasindan tanitim videosu.
 *   ProductShort 1080×1920, 15 sn (dikey)     ProductWide 1920×1080, 15 sn (yatay)
 * Ikisi ayni izgara ve ses (timeline.json 'ProductShort').
 *
 * Gorsel dil GORSEL ONDE: urun fotografi beyaz kartta 'contain' (paket gorseli kirpilmaz), tum
 * video boyunca yavas yakinlasma; arkasinda ayni gorselin bulanik renk alani. Ozellikler isaretli
 * liste olarak birikir. Fiyat etiketi YALNIZ props.price varsa — sunucu fiyati iki kaynakla
 * dogrulamadiysa (JSON-LD/meta + sayfanin gorunur metni) bu alan hic gonderilmez.
 * Gorsel yoksa kart marka degradesi + logo/monogram olur; logo yoksa monogram.
 */

export type ProductShortProps = PromoBaseProps & {
  /** data:image/jpeg|png;base64 — sunucuda sharp ile cevrilmis (en fazla 1280 px) */
  image?: string;
  /** sayfadaki yazimiyla dogrulanmis fiyat ("47,25 TL"); dogrulanmadiysa bos */
  price?: string;
};

const TL = timeline('ProductShort');
export const PRODUCT_SHORT_DURATION = TL.durationInFrames;

export const productShortDefaults: ProductShortProps = {
  hook: 'Örnek ürün adı',
  hookSub: 'Bu metin yalnız Studio önizlemesi içindir.',
  // Bos: Remotion inputProps'u varsayilanla birlestirir; ornek ust etiket gercek videoya sizmasin
  kicker: '',
  points: [{ title: 'Örnek özellik bir' }, { title: 'Örnek özellik iki', detail: 'Gerçek videoda sayfanın kendi cümleleri yer alır.' }, { title: 'Örnek özellik üç' }],
  cta: { label: 'Hemen inceleyin', domain: 'ornekklinik.com/urun' },
  brand: { name: 'Örnek Klinik', domain: 'ornekklinik.com' },
  image: '',
  price: '',
  muted: false,
  watermark: true,
};

type Row = { title: Fit; detail: Fit | null; h: number };

function rowFits(points: PromoBaseProps['points'], textW: number, avail: number) {
  let rows: Row[] = [];
  let gap = 26;
  for (let k = 1; k >= 0.6; k -= 0.05) {
    rows = points.map((p) => {
      const title = fitK(p.title, DISPLAY, k, { maxWidth: textW, maxLines: 2, maxSize: 62, minSize: 34, weight: 750 });
      const detail = p.detail ? fitK(p.detail, UI, k, { maxWidth: textW, maxLines: 2, maxSize: 36, minSize: 26, weight: 600 }) : null;
      return { title, detail, h: 56 + Math.max(72, linesH(title, 1.1) + (detail ? 10 + linesH(detail, 1.3) : 0)) };
    });
    gap = Math.round(26 * k);
    if (rows.reduce((a, r) => a + r.h, 0) + gap * 2 <= avail) break;
  }
  return { rows, gap };
}

function FeatureRows({ frame, pal, rows, gap, left, top, width }: { frame: number; pal: BrandPalette; rows: Row[]; gap: number; left: number; top: number; width: number }) {
  let y = top;
  return (
    <>
      {rows.map((r, i) => {
        const [s, e] = TL.scene(`p${i + 1}`);
        const rowTop = y;
        y += r.h + gap;
        if (frame < s - 6) return null;
        const inP = snap(frame, s, 30, 5);
        const det = snap(frame, TL.at(`p${i + 1}.detail`));
        const active = frame < e;
        const dim = active ? 0 : ramp(frame, e, e + 8);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left,
              top: rowTop,
              width,
              height: r.h,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '24px 30px',
              borderRadius: 30,
              background: rgba(pal.paper, 1 - dim),
              boxShadow: `0 ${20 * (1 - dim)}px ${50 * (1 - dim)}px ${rgba(pal.ink, 0.1 * (1 - dim))}`,
              border: `1.5px solid ${rgba(pal.ink, 0.08 * (1 - dim))}`,
              opacity: clamp01(inP * 1.5) * (1 - 0.4 * dim),
              transform: `translateX(${(1 - inP) * 120}px)`,
            }}
          >
            <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 999, display: 'grid', placeItems: 'center', background: `linear-gradient(150deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`, transform: `scale(${0.6 + 0.4 * inP})` }}>
              <Check size={38} color={pal.onPrimary} strokeWidth={3.2} />
            </div>
            <div style={{ minWidth: 0 }}>
              <FitLines fit={r.title} lineHeight={1.1} style={{ fontFamily: fontDisplay, fontWeight: 750, letterSpacing: '-0.03em', color: pal.ink }} />
              {r.detail ? <FitLines fit={r.detail} lineHeight={1.3} style={{ marginTop: 10, fontFamily: fontUI, fontWeight: 600, color: pal.body, opacity: clamp01(det * 1.4) }} /> : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Kicker({ text, pal, p }: { text: string; pal: BrandPalette; p: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        alignSelf: 'flex-start',
        padding: '10px 22px',
        borderRadius: 999,
        background: rgba(pal.primary, 0.12),
        color: pal.accentText,
        fontFamily: fontUI,
        fontWeight: 800,
        fontSize: 26,
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap',
        opacity: clamp01(p * 1.5),
      }}
    >
      {upperTr(text)}
    </span>
  );
}

/** Marka renkli kapanis zemini (alttan/sagdan buyuyen daire) */
function EndWipe({ frame, pal, at }: { frame: number; pal: BrandPalette; at: string }) {
  const [s] = TL.scene('end');
  if (frame < s - 8) return null;
  const grow = ramp(frame, s - 7, s + 5, Easing.bezier(0.45, 0, 0.15, 1));
  return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`, clipPath: `circle(${grow * 2400}px at ${at})` }} />;
}

/* ═════════════ dikey ═════════════ */

type VFits = { name: Fit; sub: Fit | null; rows: Row[]; gap: number; endName: Fit; domain: Fit; price: number };
const VX = { left: 90, width: 860 } as const;

export const ProductShort: React.FC<ProductShortProps> = (props) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const pal = useMemo(() => brandPalette(props.brand.primary), [props.brand.primary]);
  const points = useMemo(() => props.points.slice(0, 3), [props.points]);
  const kicker = props.kicker?.trim() || '';

  const fits = useMemo<VFits | null>(() => {
    if (!ready) return null;
    let name!: Fit;
    let sub: Fit | null = null;
    // Kanca alani: kartin altindan (980) guvenli alanin sonuna (1460)
    for (let k = 1; k >= 0.55; k -= 0.05) {
      name = fitK(props.hook, DISPLAY, k, { maxWidth: VX.width, maxLines: 3, maxSize: 92, minSize: 54 });
      sub = props.hookSub ? fitK(props.hookSub, UI, k, { maxWidth: VX.width, maxLines: 3, maxSize: 40, minSize: 28, weight: 600 }) : null;
      if ((kicker ? 66 : 0) + linesH(name, 1.06) + (sub ? 24 + linesH(sub, 1.28) : 0) <= 470) break;
    }
    const { rows, gap } = rowFits(points, VX.width - 60 - 64 - 26, 1450 - 860);
    return {
      name,
      sub,
      rows,
      gap,
      endName: fitText(props.hook, { ...DISPLAY, maxWidth: VX.width, maxLines: 2, maxSize: 84, minSize: 48 }),
      domain: fitText(props.cta.domain, { family: fontDisplay, weight: 700, letterSpacing: -0.02, maxWidth: VX.width - 200, maxLines: 1, maxSize: 52, minSize: 26 }),
      price: props.price ? fitText(props.price, { ...DISPLAY, maxWidth: 420, maxLines: 1, maxSize: 64, minSize: 36 }).size : 0,
    };
  }, [ready, props.hook, props.hookSub, props.cta.domain, props.price, points, kicker]);

  // Kart geometrisi: kanca 680 px -> ozellikler 560 px -> kapanis 420 px
  const [, hookE] = TL.scene('hook');
  const [endS] = TL.scene('end');
  const shrink = ramp(frame, hookE - 8, hookE + 4, Easing.inOut(Easing.cubic));
  const endP = ramp(frame, endS - 4, endS + 8, Easing.inOut(Easing.cubic));
  const size = interpolate(shrink, [0, 1], [680, 560]) + (420 - 560) * endP;
  const cardX = (1080 - size) / 2;
  const cardY = 250 + 40 * endP;
  const imgIn = snap(frame, TL.at('hook.image') + 4);
  const priceP = snap(frame, TL.at('hook.price'));
  const logoP = snap(frame, TL.at('hook.title'));

  return (
    <AbsoluteFill style={{ fontFamily: fontUI, color: pal.ink, overflow: 'hidden' }}>
      <Soundtrack tl={TL} muted={props.muted ?? false} />
      <LightField pal={pal} />
      <ImageGlow src={props.image} opacity={0.32 * imgIn} style={{ left: 0, top: 0, width: 1080, height: 1250, maskImage: 'radial-gradient(ellipse 60% 50% at 50% 42%, black 30%, transparent 100%)' }} />
      {fits ? (
        <>
          {/* kanca metni */}
          <VHookText frame={frame} pal={pal} fits={fits} kicker={kicker} />
          <FeatureRowsWindow frame={frame} pal={pal} rows={fits.rows} gap={fits.gap} left={VX.left} top={860} width={VX.width} />
          {props.watermark !== false && frame < endS + 2 ? <WatermarkLine top={1468} color={pal.muted} opacity={0.75 * soft(frame, 8) * (1 - ramp(frame, endS - 6, endS))} /> : null}
          <EndWipe frame={frame} pal={pal} at="540px 1920px" />
          <VEnd frame={frame} pal={pal} fits={fits} label={props.cta.label} watermark={props.watermark !== false} />
          {/* gorsel karti kapanis zemininin USTUNDE kalir */}
          <div style={{ position: 'absolute', left: cardX, top: cardY, opacity: clamp01(imgIn * 1.4), transform: `scale(${0.85 + 0.15 * imgIn})` }}>
            <ProductImageCard src={props.image} size={size} frame={frame} total={TL.durationInFrames} pal={pal} brandTile={<LogoTile brand={props.brand} size={size * 0.42} pal={pal} />} />
            {props.image ? (
              <div style={{ position: 'absolute', left: -size * 0.06, bottom: -size * 0.06, opacity: clamp01(logoP * 1.5), transform: `scale(${0.6 + 0.4 * logoP})` }}>
                <LogoTile brand={props.brand} size={Math.round(size * 0.2)} pal={pal} />
              </div>
            ) : null}
            {props.price && fits.price ? (
              <div style={{ position: 'absolute', right: -size * 0.05, top: size * 0.04 }}>
                <PriceTag text={props.price} size={fits.price * (size / 680)} pal={pal} p={priceP} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

function VHookText({ frame, pal, fits, kicker }: { frame: number; pal: BrandPalette; fits: VFits; kicker: string }) {
  const [, e] = TL.scene('hook');
  if (frame >= e + 2) return null;
  // Kanca, ozellik satirlari girmeden (s - 5) tamamen kaybolur: iki katman ust uste binmesin
  const out = ramp(frame, e - 12, e - 5, Easing.in(Easing.cubic));
  const k = snap(frame, TL.at('hook.title') - 4);
  const t = snap(frame, TL.at('hook.title'));
  const sub = soft(frame, TL.at('hook.sub'));
  return (
    <div style={{ position: 'absolute', left: VX.left, width: VX.width, top: 980, height: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: 1 - out, transform: `translateY(${out * 60}px)` }}>
      {kicker ? <Kicker text={kicker} pal={pal} p={k} /> : null}
      <FitLines fit={fits.name} lineHeight={1.06} style={{ marginTop: kicker ? 26 : 0, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(t * 1.5), transform: `translateY(${(1 - t) * 40}px)` }} />
      {fits.sub ? <FitLines fit={fits.sub} lineHeight={1.28} style={{ marginTop: 24, fontWeight: 600, color: pal.body, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }} /> : null}
    </div>
  );
}

function FeatureRowsWindow(props: { frame: number; pal: BrandPalette; rows: Row[]; gap: number; left: number; top: number; width: number }) {
  const [endS] = TL.scene('end');
  const [p1s] = TL.scene('p1');
  if (props.frame < p1s - 8 || props.frame >= endS + 4) return null;
  const total = props.rows.reduce((a, r) => a + r.h, 0) + props.gap * 2;
  const out = ramp(props.frame, endS - 6, endS, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
      <FeatureRows {...props} top={props.top + Math.max(0, (590 - total) / 2)} />
    </div>
  );
}

function VEnd({ frame, pal, fits, label, watermark }: { frame: number; pal: BrandPalette; fits: VFits; label: string; watermark: boolean }) {
  const [s] = TL.scene('end');
  if (frame < s - 2) return null;
  const nm = snap(frame, s + 5);
  const lab = soft(frame, TL.at('end.cta') - 4);
  const cta = snap(frame, TL.at('end.cta'));
  const mark = soft(frame, TL.at('end.url') + 4);
  const pill = pillOnBrand(pal);
  return (
    <>
      <div style={{ position: 'absolute', left: VX.left, width: VX.width, top: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: pal.onPrimary }}>
        <FitLines fit={fits.endName} lineHeight={1.06} align="center" style={{ fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 30}px)` }} />
        <div style={{ marginTop: 70, fontFamily: fontUI, fontWeight: 700, fontSize: 48, opacity: 0.9 * lab }}>{label}</div>
        <div style={{ marginTop: 28 }}>
          <CtaPill fit={fits.domain} bg={pill.bg} color={pill.text} scale={cta} />
        </div>
      </div>
      {watermark ? <WatermarkLine top={1440} color={pal.onPrimary} opacity={0.62 * mark} size={26} /> : null}
    </>
  );
}

/* ═════════════ yatay (16:9) ═════════════ */

const WX = { left: 1010, width: 790 } as const;
type WFits = { name: Fit; sub: Fit | null; head: Fit; rows: Row[]; gap: number; endName: Fit; domain: Fit; price: number };

export const ProductWide: React.FC<ProductShortProps> = (props) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const pal = useMemo(() => brandPalette(props.brand.primary), [props.brand.primary]);
  const points = useMemo(() => props.points.slice(0, 3), [props.points]);
  const kicker = props.kicker?.trim() || '';

  const fits = useMemo<WFits | null>(() => {
    if (!ready) return null;
    let name!: Fit;
    let sub: Fit | null = null;
    for (let k = 1; k >= 0.55; k -= 0.05) {
      name = fitK(props.hook, DISPLAY, k, { maxWidth: WX.width, maxLines: 3, maxSize: 92, minSize: 54 });
      sub = props.hookSub ? fitK(props.hookSub, UI, k, { maxWidth: WX.width, maxLines: 3, maxSize: 38, minSize: 26, weight: 600 }) : null;
      if ((kicker ? 66 : 0) + linesH(name, 1.06) + (sub ? 24 + linesH(sub, 1.28) : 0) <= 700) break;
    }
    const { rows, gap } = rowFits(points, WX.width - 60 - 64 - 26, 700);
    return {
      name,
      sub,
      rows,
      gap,
      head: fitText(props.hook, { ...DISPLAY, maxWidth: WX.width, maxLines: 1, maxSize: 44, minSize: 26 }),
      endName: fitText(props.hook, { ...DISPLAY, maxWidth: WX.width, maxLines: 2, maxSize: 76, minSize: 44 }),
      domain: fitText(props.cta.domain, { family: fontDisplay, weight: 700, letterSpacing: -0.02, maxWidth: WX.width - 180, maxLines: 1, maxSize: 46, minSize: 24 }),
      price: props.price ? fitText(props.price, { ...DISPLAY, maxWidth: 380, maxLines: 1, maxSize: 60, minSize: 34 }).size : 0,
    };
  }, [ready, props.hook, props.hookSub, props.cta.domain, props.price, points, kicker]);

  const size = 760;
  const imgIn = snap(frame, TL.at('hook.image') + 4);
  const priceP = snap(frame, TL.at('hook.price'));
  const logoP = snap(frame, TL.at('hook.title'));
  const [, hookE] = TL.scene('hook');
  const [p1s] = TL.scene('p1');
  const [endS] = TL.scene('end');

  return (
    <AbsoluteFill style={{ fontFamily: fontUI, color: pal.ink, overflow: 'hidden' }}>
      <Soundtrack tl={TL} muted={props.muted ?? false} />
      <LightField pal={pal} />
      <ImageGlow src={props.image} opacity={0.32 * imgIn} style={{ left: 0, top: 0, width: 1100, height: 1080, maskImage: 'radial-gradient(ellipse 55% 60% at 47% 50%, black 30%, transparent 100%)' }} />
      {fits ? (
        <>
          {frame < hookE + 2 ? (
            <div
              style={{
                position: 'absolute', left: WX.left, width: WX.width, top: 160, height: 760, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                opacity: 1 - ramp(frame, hookE - 12, hookE - 5, Easing.in(Easing.cubic)),
              }}
            >
              {kicker ? <Kicker text={kicker} pal={pal} p={snap(frame, TL.at('hook.title') - 4)} /> : null}
              <FitLines fit={fits.name} lineHeight={1.06} style={{ marginTop: kicker ? 26 : 0, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(snap(frame, TL.at('hook.title')) * 1.5) }} />
              {fits.sub ? <FitLines fit={fits.sub} lineHeight={1.28} style={{ marginTop: 24, fontWeight: 600, color: pal.body, opacity: soft(frame, TL.at('hook.sub')) }} /> : null}
            </div>
          ) : null}
          {frame >= p1s - 8 && frame < endS + 4 ? (
            <div style={{ position: 'absolute', inset: 0, opacity: 1 - ramp(frame, endS - 6, endS, Easing.in(Easing.cubic)) }}>
              <FitLines fit={fits.head} lineHeight={1.1} style={{ position: 'absolute', left: WX.left, top: 110, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.03em', opacity: clamp01(snap(frame, p1s) * 1.5) }} />
              <FeatureRows frame={frame} pal={pal} rows={fits.rows} gap={fits.gap} left={WX.left} top={200 + Math.max(0, (720 - (fits.rows.reduce((a, r) => a + r.h, 0) + fits.gap * 2)) / 2)} width={WX.width} />
            </div>
          ) : null}
          {props.watermark !== false && frame < endS + 2 ? <WatermarkLine top={1012} color={pal.muted} opacity={0.75 * soft(frame, 8) * (1 - ramp(frame, endS - 6, endS))} size={22} /> : null}
          <EndWipe frame={frame} pal={pal} at="1920px 540px" />
          {frame >= endS - 2 ? (
            <>
              <div style={{ position: 'absolute', left: WX.left, width: WX.width, top: 200, height: 680, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', color: pal.onPrimary }}>
                <FitLines fit={fits.endName} lineHeight={1.06} style={{ fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(snap(frame, endS + 5) * 1.5) }} />
                <div style={{ marginTop: 56, fontFamily: fontUI, fontWeight: 700, fontSize: 42, opacity: 0.9 * soft(frame, TL.at('end.cta') - 4) }}>{props.cta.label}</div>
                <div style={{ marginTop: 26, transformOrigin: 'left center' }}>
                  <CtaPill fit={fits.domain} bg={pillOnBrand(pal).bg} color={pillOnBrand(pal).text} scale={snap(frame, TL.at('end.cta'))} />
                </div>
              </div>
              {props.watermark !== false ? <WatermarkLine top={1012} color={pal.onPrimary} opacity={0.62 * soft(frame, TL.at('end.url') + 4)} size={22} /> : null}
            </>
          ) : null}
          <div style={{ position: 'absolute', left: 130, top: 160, opacity: clamp01(imgIn * 1.4), transform: `scale(${0.85 + 0.15 * imgIn})` }}>
            <ProductImageCard src={props.image} size={size} frame={frame} total={TL.durationInFrames} pal={pal} brandTile={<LogoTile brand={props.brand} size={size * 0.42} pal={pal} />} />
            {props.image ? (
              <div style={{ position: 'absolute', left: -28, bottom: -28, opacity: clamp01(logoP * 1.5), transform: `scale(${0.6 + 0.4 * logoP})` }}>
                <LogoTile brand={props.brand} size={140} pal={pal} />
              </div>
            ) : null}
            {props.price && fits.price ? (
              <div style={{ position: 'absolute', right: -40, top: 30 }}>
                <PriceTag text={props.price} size={fits.price} pal={pal} p={priceP} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
