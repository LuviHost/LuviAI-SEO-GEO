import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { ArrowRight, Check, CreditCard, Landmark, Percent, ShieldCheck, Store } from 'lucide-react';
import { alpha } from '../tokens';
import { Soundtrack } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import type { MarketingProps } from '../marketing/ProductIntro';
import {
  Cursor,
  DISCLAIMER,
  K,
  KButton,
  KLine,
  KStage,
  OfferCard,
  POS_TYPES,
  Pill,
  SampleTag,
  SymbolTile,
  Teal,
  Wordmark,
  appear,
  clamp01,
  exitOf,
  fontK,
  ramp,
  snap,
  soft,
  useKobiFonts,
  type ProductKind,
} from './kit';

/**
 * KobiPratikReels — KobiPratik dikey reklami, 1080×1920 @30, 17 sn (Reels / TikTok / Shorts).
 * Her kesme vurusta (timeline.json 'KobiPratikReels'). Guvenli alan: metin ve arayuz
 * x 90–950, y 250–1500 (sagdaki dugme sutunu ve alttaki aciklama alani bos kalir).
 */

const TL = timeline('KobiPratikReels');
export const KOBIPRATIK_REELS_DURATION = TL.durationInFrames;

const SAFE = { left: 90, right: 950, top: 250, bottom: 1500 } as const;
const W = SAFE.right - SAFE.left; // 860

export const KobiPratikReels: React.FC<MarketingProps> = ({ muted = false }) => {
  useKobiFonts();
  const frame = useCurrentFrame();
  return (
    <KStage>
      <Soundtrack tl={TL} muted={muted} />
      <Hook frame={frame} />
      <BrandLock frame={frame} />
      <ProductScene frame={frame} kind="card" />
      <ProductScene frame={frame} kind="pos" />
      <ProductScene frame={frame} kind="credit" />
      <Flow frame={frame} />
      <End frame={frame} />
    </KStage>
  );
};

/* ───────────── 0-3 sn: kanca ───────────── */

const ASKS: Array<{ word: string; ev: string; Icon: typeof CreditCard }> = [
  { word: 'Ticari kredi?', ev: 'hook.w1', Icon: Percent },
  { word: 'POS?', ev: 'hook.w2', Icon: Store },
  { word: 'Kredi kartı?', ev: 'hook.w3', Icon: CreditCard },
];

function Hook({ frame }: { frame: number }) {
  const [, e] = TL.scene('hook');
  if (frame >= e) return null;
  const out = exitOf(frame, e);
  const line = TL.at('hook.line');
  const strike = TL.at('hook.strike');
  const strikeP = ramp(frame, strike - 2, strike + 8);
  // banka karolari: yuruyen nokta sirayla dolasir (kullanicinin derdi)
  const banks = [215, 540, 865];
  const dotX = interpolateKeys(frame, [
    [0, banks[0]],
    [14, banks[0]],
    [24, banks[1]],
    [30, banks[1]],
    [40, banks[2]],
    [46, banks[2]],
    [56, banks[0]],
  ]);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 70}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, top: 270 }}>
        {ASKS.map((a, i) => {
          const at = TL.at(a.ev) - (i === 0 ? 4 : 0);
          const p = snap(frame, at);
          return (
            <div key={a.ev} style={{ display: 'flex', alignItems: 'center', gap: 28, height: 136, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 46}px)` }}>
              <div style={{ width: 100, height: 100, borderRadius: 28, background: K.paper, display: 'grid', placeItems: 'center', boxShadow: `0 14px 34px ${alpha(K.navy, 0.1)}` }}>
                <a.Icon size={52} color={K.teal} strokeWidth={2.4} />
              </div>
              <span style={{ fontFamily: fontK, fontWeight: 800, fontSize: 100, letterSpacing: '-0.03em', lineHeight: 1 }}>{a.word}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 46 }}>
          <KLine frame={frame} at={line} size={118}>
            Banka banka
          </KLine>
          <KLine frame={frame} at={line + 2} size={118}>
            <Teal>dolaşma.</Teal>
          </KLine>
        </div>
      </div>
      {/* banka banka dolasma gorseli */}
      <div style={{ position: 'absolute', left: 0, top: 1210, width: 1080, height: 240 }}>
        <svg width={1080} height={240} style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d={`M ${banks[0]} 120 L ${banks[2]} 120`} stroke={alpha(K.steel, 0.45)} strokeWidth={6} strokeDasharray="4 18" strokeLinecap="round" />
        </svg>
        {banks.map((x, i) => {
          const p = snap(frame, TL.at(ASKS[i].ev), 6);
          return (
            <div
              key={x}
              style={{
                position: 'absolute',
                left: x - 75,
                top: 45,
                width: 150,
                height: 150,
                borderRadius: 38,
                background: K.paper,
                display: 'grid',
                placeItems: 'center',
                boxShadow: `0 18px 40px ${alpha(K.navy, 0.1)}`,
                opacity: clamp01(p * 1.6) * (1 - 0.55 * strikeP),
                transform: `scale(${0.6 + 0.4 * p - 0.08 * strikeP})`,
              }}
            >
              <Landmark size={74} color={K.navy} strokeWidth={1.9} />
            </div>
          );
        })}
        {frame < line + 6 ? (
          <div
            style={{
              position: 'absolute',
              left: dotX - 20,
              top: 2,
              width: 40,
              height: 40,
              borderRadius: 999,
              background: K.teal,
              boxShadow: `0 8px 20px ${alpha(K.teal, 0.45)}`,
              opacity: ramp(frame, 0, 6) * (1 - ramp(frame, line, line + 6)),
            }}
          />
        ) : null}
        {/* cizgi: "dolasma" */}
        <div style={{ position: 'absolute', left: banks[0] - 110, top: 116, width: (banks[2] - banks[0] + 220) * strikeP, height: 10, borderRadius: 10, background: K.navy, transform: 'rotate(-4deg)', transformOrigin: 'left center' }} />
      </div>
    </AbsoluteFill>
  );
}

function interpolateKeys(frame: number, keys: Array<[number, number]>) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (frame <= f1) {
      const t = Easing.inOut(Easing.cubic)((frame - f0) / Math.max(1, f1 - f0));
      return v0 + (v1 - v0) * t;
    }
  }
  return keys[keys.length - 1][1];
}

/* ───────────── 3-4 sn: marka ───────────── */

function BrandLock({ frame }: { frame: number }) {
  const [s, e] = TL.scene('brand');
  if (frame < s || frame >= e) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 3);
  const tag = appear(frame, TL.at('brand.tag'));
  const out = exitOf(frame, e);
  return (
    <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 470, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 1 - out, transform: `scale(${1 - out * 0.06})` }}>
      <div style={{ transform: `scale(${tile})` }}>
        <SymbolTile size={230} />
      </div>
      <div style={{ marginTop: 70, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 30}px)` }}>
        <Wordmark width={720} />
      </div>
      <div style={{ marginTop: 50, fontFamily: fontK, fontWeight: 700, fontSize: 56, color: K.steel, opacity: tag.opacity, transform: `translateY(${(1 - tag.p) * 20}px)`, whiteSpace: 'nowrap' }}>
        KOBİ’nin Finans Platformu
      </div>
    </div>
  );
}

/* ───────────── 4-10 sn: uc urun ───────────── */

const SCENE_META: Record<ProductKind, { n: string; title: string; sub: string; partners: [string, string, string]; overrides?: Array<Partial<Record<number, string>>> }> = {
  card: { n: '1/3', title: 'Ticari kredi kartı', sub: 'Teklifleri yan yana gör', partners: ['Örnek Banka A', 'Örnek Banka B', 'Örnek Banka C'] },
  pos: {
    n: '2/3',
    title: 'POS',
    sub: '',
    partners: ['Örnek Banka A', 'Örnek Ödeme Kuruluşu', 'Örnek Banka C'],
    overrides: [{ 2: 'Sanal Pos' }, { 2: 'Fiziksel Pos' }, { 2: 'Cep Pos' }],
  },
  credit: { n: '3/3', title: 'Ticari kredi', sub: 'Tutar ve vadene göre karşılaştır', partners: ['Örnek Banka A', 'Örnek Banka B', 'Örnek Banka C'] },
};

const ICONS: Record<ProductKind, typeof CreditCard> = { card: CreditCard, pos: Store, credit: Percent };

const CARD_TOP = 575;
const CARD_STEP = 268;

function ProductScene({ frame, kind }: { frame: number; kind: ProductKind }) {
  const [s, e] = TL.scene(kind);
  if (frame < s - 1 || frame >= e) return null;
  const m = SCENE_META[kind];
  const Icon = ICONS[kind];
  const inP = snap(frame, s, 5);
  const out = exitOf(frame, e);
  const pick = TL.at(`${kind}.pick`);
  const sel = snap(frame, pick, 0);
  const pressed = frame >= pick && frame < pick + 6 ? 1 : 0;
  // imlec: 2. kartin "Hemen Başvur" dugmesine
  const btnX = SAFE.left + W - 30 - 120;
  const btnY = CARD_TOP + CARD_STEP + 66;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateX(${(1 - inP) * 140 - out * 140}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 262, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: clamp01(inP * 1.5) }}>
        <Pill color={K.teal} size={28}>
          <Icon size={28} strokeWidth={2.4} /> {m.n}
        </Pill>
        <SampleTag size={22} />
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, top: 335 }}>
        <KLine frame={frame} at={s} size={kind === 'pos' ? 110 : 92}>
          {m.title}
        </KLine>
        {kind === 'pos' ? (
          <div style={{ marginTop: 18, display: 'flex', gap: 12 }}>
            {POS_TYPES.map((t, i) => {
              const p = appear(frame, s + 3 + i * 2);
              return (
                <Pill key={t} size={27} color={K.steel} bg={K.paper} style={{ opacity: p.opacity, transform: `translateY(${(1 - p.p) * 16}px)`, boxShadow: `0 6px 16px ${alpha(K.navy, 0.06)}` }}>
                  {t}
                </Pill>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontFamily: fontK, fontWeight: 700, fontSize: 42, color: K.gray, opacity: soft(frame, s + 4), whiteSpace: 'nowrap' }}>{m.sub}</div>
        )}
      </div>
      {m.partners.map((name, i) => {
        const at = TL.at(`${kind}.c${i + 1}`);
        if (frame < at - 5) return null;
        const p = snap(frame, at);
        const isPick = i === 1;
        return (
          <div key={name} style={{ position: 'absolute', left: SAFE.left, top: CARD_TOP + i * CARD_STEP, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 90}px)` }}>
            <OfferCard
              kind={kind}
              partner={name}
              width={W}
              selected={isPick ? sel : 0}
              dim={isPick ? 0 : sel}
              pressed={isPick ? pressed : 0}
              fieldOverride={m.overrides?.[i]}
            />
          </div>
        );
      })}
      <Cursor
        frame={frame}
        clicks={[pick]}
        path={[
          [pick - 18, 1000, 1560],
          [pick - 2, btnX, btnY],
          [pick + 20, btnX + 6, btnY + 4],
        ]}
      />
    </div>
  );
}

/* ───────────── 10-13 sn: karsilastir → basvur ───────────── */

const STEPS: Array<{ ev: string; title: string; sub: string }> = [
  { ev: 'flow.s1', title: 'İhtiyacını seç', sub: 'Kredi, kart ya da POS' },
  { ev: 'flow.s2', title: 'Teklifleri karşılaştır', sub: 'Tek ekranda, yan yana' },
  { ev: 'flow.s3', title: 'Kolayca başvur', sub: 'Başvurun seçtiğin kuruma iletilir' },
];

function Flow({ frame }: { frame: number }) {
  const [s, e] = TL.scene('flow');
  if (frame < s - 1 || frame >= e) return null;
  const out = exitOf(frame, e);
  const note = appear(frame, TL.at('flow.note'));
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-out * 60}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, top: 285 }}>
        <KLine frame={frame} at={s} size={104}>
          Karşılaştır,
        </KLine>
        <KLine frame={frame} at={s + 3} size={104}>
          <Teal>kolayca başvur.</Teal>
        </KLine>
      </div>
      {STEPS.map((st, i) => {
        const p = snap(frame, TL.at(st.ev));
        const done = i === 2;
        return (
          <div
            key={st.ev}
            style={{
              position: 'absolute',
              left: SAFE.left,
              top: 585 + i * 196,
              width: W,
              height: 168,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              padding: '0 36px',
              borderRadius: 30,
              background: K.paper,
              border: `3px solid ${done ? alpha(K.teal, 0.55) : K.line}`,
              boxShadow: `0 22px 54px ${alpha(K.navy, 0.08)}`,
              opacity: clamp01(p * 1.6),
              transform: `translateX(${(1 - p) * 80}px)`,
            }}
          >
            <span style={{ width: 88, height: 88, borderRadius: 26, flexShrink: 0, display: 'grid', placeItems: 'center', background: done ? K.teal : K.mist, color: done ? 'white' : K.teal, fontFamily: fontK, fontWeight: 800, fontSize: 46 }}>
              {done ? <Check size={50} strokeWidth={3.2} /> : i + 1}
            </span>
            <div>
              <div style={{ fontFamily: fontK, fontWeight: 800, fontSize: 52, letterSpacing: '-0.02em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{st.title}</div>
              <div style={{ marginTop: 6, fontFamily: fontK, fontWeight: 600, fontSize: 32, color: K.gray, whiteSpace: 'nowrap' }}>{st.sub}</div>
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 1210, display: 'flex', alignItems: 'center', gap: 22, opacity: note.opacity, transform: `translateY(${(1 - note.p) * 24}px)` }}>
        <ShieldCheck size={58} color={K.teal} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: fontK, fontWeight: 700, fontSize: 36, lineHeight: 1.3, color: K.navy }}>
          Değerlendirme ve onay
          <br />
          ilgili bankaya ya da kuruma aittir.
        </span>
      </div>
    </div>
  );
}

/* ───────────── 13-17 sn: kapanis ───────────── */

function End({ frame }: { frame: number }) {
  const [s] = TL.scene('end');
  if (frame < s) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 4);
  const head = snap(frame, s + 8);
  const cta = snap(frame, TL.at('end.cta'));
  const url = appear(frame, TL.at('end.url'));
  const free = appear(frame, TL.at('end.free'));
  return (
    <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 285, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: `scale(${tile})` }}>
        <SymbolTile size={160} />
      </div>
      <div style={{ marginTop: 44, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 24}px)` }}>
        <Wordmark width={600} />
      </div>
      <div style={{ marginTop: 50, textAlign: 'center', fontFamily: fontK, fontWeight: 800, fontSize: 112, letterSpacing: '-0.035em', lineHeight: 1.04, opacity: clamp01(head * 1.5), transform: `translateY(${(1 - head) * 30}px)` }}>
        Karşılaştır,
        <br />
        <Teal>başvur.</Teal>
      </div>
      <div style={{ marginTop: 52, opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
        <KButton size={56}>
          <span style={{ opacity: url.opacity }}>kobipratik.com</span> <ArrowRight size={54} strokeWidth={2.8} />
        </KButton>
      </div>
      <div style={{ marginTop: 36, opacity: free.opacity, transform: `translateY(${(1 - free.p) * 16}px)` }}>
        <Pill size={34} color={K.teal} bg={K.paper} style={{ boxShadow: `0 8px 22px ${alpha(K.navy, 0.07)}` }}>
          <Check size={34} strokeWidth={3} /> Kullanmak ücretsiz
        </Pill>
      </div>
      <div style={{ marginTop: 56, width: 800, textAlign: 'center', fontFamily: fontK, fontWeight: 600, fontSize: 25, lineHeight: 1.4, color: K.gray, opacity: free.opacity }}>{DISCLAIMER}</div>
    </div>
  );
}
