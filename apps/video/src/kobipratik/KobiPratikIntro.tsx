import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { ArrowRight, BookOpen, Building2, Calculator, Check, CreditCard, Landmark, Percent, Search, ShieldCheck, Sprout, Store } from 'lucide-react';
import { alpha } from '../tokens';
import { Soundtrack } from '../marketing/kit';
import { timeline, typedCount } from '../marketing/timeline';
import type { MarketingProps } from '../marketing/ProductIntro';
import {
  Cursor,
  DISCLAIMER,
  K,
  KButton,
  KLine,
  KStage,
  OfferCard,
  PRODUCTS,
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
 * KobiPratikIntro — KobiPratik tanitim filmi, 1920×1080 @30, 36 sn; KobiPratikIntroVertical ayni
 * zaman cizelgesi ve ayni sesle 1080×1920 kesim (guvenli alan x 90–950, y 250–1500).
 * Sahneler: kanca → marka → kimin icin → urunler → araclar + rehber → 3 adim → neden KobiPratik → kapanis.
 * Iddialar yalniz kobipratik.com'da birebir gecenler (SSS: ucretsiz; "Neden KobiPratik?" listesi;
 * "KobiPratik Nedir?" yasal notu). Teklif kartlari "Örnek" etiketli ve yer tutuculu.
 */

const TL = timeline('KobiPratikIntro');
export const KOBIPRATIK_INTRO_DURATION = TL.durationInFrames;

type Box = { x: number; y: number; w: number; h: number };
type L = { v: boolean; W: number; H: number; safe: Box };

function useLayout(): L {
  const { width, height } = useVideoConfig();
  const v = height > width;
  return v
    ? { v, W: width, H: height, safe: { x: 90, y: 250, w: 860, h: 1250 } }
    : { v, W: width, H: height, safe: { x: 140, y: 110, w: 1640, h: 860 } };
}

export const KobiPratikIntro: React.FC<MarketingProps> = ({ muted = false }) => {
  useKobiFonts();
  const frame = useCurrentFrame();
  const L = useLayout();
  return (
    <KStage>
      <Soundtrack tl={TL} muted={muted} />
      <Hook frame={frame} L={L} />
      <Brand frame={frame} L={L} />
      <Who frame={frame} L={L} />
      <Products frame={frame} L={L} />
      <Tools frame={frame} L={L} />
      <How frame={frame} L={L} />
      <Trust frame={frame} L={L} />
      <End frame={frame} L={L} />
    </KStage>
  );
};

/* ───────────── ortak ───────────── */

function inScene(frame: number, name: string) {
  const [s, e] = TL.scene(name);
  return { s, e, on: frame >= s - 1 && frame < e };
}

function SceneWrap({ frame, s, e, children, slide = 'x' }: { frame: number; s: number; e: number; children: React.ReactNode; slide?: 'x' | 'y' | 'none' }) {
  const inP = snap(frame, s, 5);
  const out = exitOf(frame, e);
  const t = slide === 'x' ? `translateX(${(1 - inP) * 120 - out * 120}px)` : slide === 'y' ? `translateY(${-out * 60}px)` : undefined;
  return <AbsoluteFill style={{ opacity: (slide === 'none' ? 1 : clamp01(inP * 1.5)) * (1 - out), transform: t }}>{children}</AbsoluteFill>;
}

const card: React.CSSProperties = {
  position: 'absolute',
  boxSizing: 'border-box',
  background: K.paper,
  borderRadius: 28,
  border: `2px solid ${K.line}`,
  boxShadow: `0 22px 54px ${alpha(K.navy, 0.08)}`,
};

/* ───────────── 0-4 sn: kanca — her teklif ayri sekmede ───────────── */

const TABS = ['Banka sitesi', 'Kredi kampanyası', 'POS başvurusu', 'Kart avantajları', 'Komisyon tablosu', 'Başka bir banka', 'Kampanya koşulları', 'Başvuru formu'];

function Hook({ frame, L }: { frame: number; L: L }) {
  const { e, on } = inScene(frame, 'hook');
  if (!on) return null;
  const out = exitOf(frame, e);
  const line = TL.at('hook.line');
  const line2 = TL.at('hook.line2');
  const tabAts = ['hook.t1', 'hook.t2', 'hook.t3', 'hook.t4', 'hook.t5'].map((id) => TL.at(id));
  // t5'ten sonra sekmeler hizla cogalir (her 4 karede bir)
  const count = TABS.reduce((n, _, i) => {
    const at = i < tabAts.length ? tabAts[i] : tabAts[tabAts.length - 1] + (i - tabAts.length + 1) * 4;
    return frame >= at - 3 ? i + 1 : n;
  }, 0);
  const win: Box = L.v ? { x: 90, y: 900, w: 860, h: 560 } : { x: 1030, y: 190, w: 750, h: 700 };
  const textX = L.safe.x;
  const textY = L.v ? 290 : 250;
  const big = L.v ? 92 : 96;
  const calm = ramp(frame, line2 - 2, line2 + 10);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 60}px)` }}>
      <div style={{ position: 'absolute', left: textX, top: textY }}>
        <KLine frame={frame} at={3} size={L.v ? 64 : 60} style={{ color: K.steel, fontWeight: 700 }}>
          Kredi, POS, ticari kart…
        </KLine>
        <div style={{ marginTop: 26 }}>
          <KLine frame={frame} at={line} size={big}>
            Her teklif
          </KLine>
          <KLine frame={frame} at={line + 2} size={big}>
            ayrı bir sekmede mi?
          </KLine>
        </div>
        <KLine frame={frame} at={line2} size={L.v ? 64 : 64} style={{ marginTop: 34 }}>
          <Teal>Hepsi tek platformda.</Teal>
        </KLine>
      </div>
      {/* tarayici: sekmeler cogalir */}
      <div
        style={{
          ...card,
          left: win.x,
          top: win.y,
          width: win.w,
          height: win.h,
          overflow: 'hidden',
          padding: 0,
          opacity: clamp01(snap(frame, 2, 6) * 1.5) * (1 - 0.6 * calm),
          transform: `scale(${1 - 0.05 * calm})`,
        }}
      >
        <div style={{ height: 74, background: K.mist, display: 'flex', alignItems: 'flex-end', gap: 6, padding: '0 14px', overflow: 'hidden' }}>
          {TABS.slice(0, Math.max(1, count)).map((t, i) => {
            const tw = (win.w - 28 - 6 * (Math.max(3, count) - 1)) / Math.max(3, count);
            const active = i === count - 1;
            return (
              <div
                key={t}
                style={{
                  width: tw,
                  height: 54,
                  flexShrink: 0,
                  borderRadius: '14px 14px 0 0',
                  background: active ? K.paper : alpha(K.paper, 0.55),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 12px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  fontFamily: fontK,
                  fontWeight: 600,
                  fontSize: 21,
                  color: active ? K.navy : K.gray,
                  whiteSpace: 'nowrap',
                }}
              >
                <Landmark size={20} color={K.steel} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 34 }}>
          {[0.72, 0.5, 0.86, 0.62, 0.4, 0.78].map((wPct, i) => {
            const jitter = ((count * 37 + i * 13) % 20) / 100;
            return <div key={i} style={{ height: i === 0 ? 34 : 22, width: `${(wPct - jitter) * 100}%`, borderRadius: 10, background: i === 0 ? alpha(K.navy, 0.14) : alpha(K.navy, 0.07), marginBottom: i === 0 ? 30 : 20 }} />;
          })}
          <div style={{ display: 'flex', gap: 18, marginTop: 30 }}>
            {[0, 1].map((i) => (
              <div key={i} style={{ flex: 1, height: L.v ? 120 : 190, borderRadius: 18, background: alpha(K.steel, 0.08) }} />
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ───────────── 4-6 sn: marka ───────────── */

function Brand({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'brand');
  if (!on || frame < s) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 3);
  const tag = appear(frame, s + 8);
  const sub = appear(frame, TL.at('brand.tag'));
  const out = exitOf(frame, e);
  return (
    <div style={{ position: 'absolute', left: L.safe.x, width: L.safe.w, top: L.v ? 450 : 150, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 1 - out, transform: `scale(${1 - out * 0.05})` }}>
      <div style={{ transform: `scale(${tile})` }}>
        <SymbolTile size={L.v ? 220 : 200} />
      </div>
      <div style={{ marginTop: 60, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 30}px)` }}>
        <Wordmark width={L.v ? 720 : 760} />
      </div>
      <div style={{ marginTop: 44, fontFamily: fontK, fontWeight: 800, fontSize: L.v ? 58 : 60, letterSpacing: '-0.02em', color: K.teal, opacity: tag.opacity, transform: `translateY(${(1 - tag.p) * 20}px)`, whiteSpace: 'nowrap' }}>
        KOBİ’nin Finans Platformu
      </div>
      <div style={{ marginTop: 18, textAlign: 'center', fontFamily: fontK, fontWeight: 600, fontSize: L.v ? 38 : 36, lineHeight: 1.35, color: K.gray, opacity: sub.opacity }}>
        KOBİ ve esnaf için finansal{L.v ? <br /> : ' '}karşılaştırma platformu
      </div>
    </div>
  );
}

/* ───────────── 6-9 sn: kimin icin ───────────── */

const PERSONAS: Array<{ ev: string; title: string; sub: string; Icon: typeof Store }> = [
  { ev: 'who.p1', title: 'Esnaf', sub: 'Tahsilat için POS, harcama için ticari kart', Icon: Store },
  { ev: 'who.p2', title: 'KOBİ’ler', sub: 'Nakit ve finansman ihtiyacı', Icon: Building2 },
  { ev: 'who.p3', title: 'Yeni kurulan işletmeler', sub: 'Onlar da başvuru yapabilir', Icon: Sprout },
];

function Who({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'who');
  if (!on) return null;
  const col: Box = L.v ? { x: 90, y: 560, w: 860, h: 0 } : { x: 900, y: 200, w: 880, h: 0 };
  return (
    <SceneWrap frame={frame} s={s} e={e}>
      <div style={{ position: 'absolute', left: L.safe.x, top: L.v ? 290 : 330 }}>
        <KLine frame={frame} at={s} size={L.v ? 110 : 112}>
          Kimin için?
        </KLine>
        <div style={{ marginTop: 18, fontFamily: fontK, fontWeight: 700, fontSize: L.v ? 42 : 44, color: K.gray, opacity: soft(frame, s + 5), whiteSpace: 'nowrap' }}>
          KOBİ ve esnafa özel odaklanma
        </div>
      </div>
      {PERSONAS.map((p, i) => {
        const a = appear(frame, TL.at(p.ev));
        return (
          <div
            key={p.ev}
            style={{
              ...card,
              left: col.x,
              top: col.y + i * (L.v ? 205 : 230),
              width: col.w,
              height: L.v ? 175 : 200,
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              padding: '0 36px',
              opacity: a.opacity,
              transform: `translateX(${(1 - a.p) * 80}px)`,
            }}
          >
            <div style={{ width: 100, height: 100, borderRadius: 28, background: K.mist, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <p.Icon size={54} color={K.teal} strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontFamily: fontK, fontWeight: 800, fontSize: 50, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{p.title}</div>
              <div style={{ marginTop: 6, fontFamily: fontK, fontWeight: 600, fontSize: L.v ? 31 : 32, color: K.gray, whiteSpace: 'nowrap' }}>{p.sub}</div>
            </div>
          </div>
        );
      })}
    </SceneWrap>
  );
}

/* ───────────── 9-14 sn: urunler ───────────── */

const ORDER: ProductKind[] = ['credit', 'card', 'pos'];
const PARTNERS: Record<ProductKind, string> = { credit: 'Örnek Banka A', card: 'Örnek Banka B', pos: 'Örnek Ödeme Kuruluşu' };

function Products({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'products');
  if (!on) return null;
  const pick = TL.at('products.pick');
  const sel = snap(frame, pick, 0);
  const pressed = frame >= pick && frame < pick + 6 ? 1 : 0;
  const cmp = appear(frame, TL.at('products.cmp'));
  const colW = 510;
  const gap = (L.safe.w - colW * 3) / 2;
  // imlec hedefi: ortadaki (kart) teklifin dugmesi
  const target = L.v ? { x: 90 + 860 - 30 - 120, y: 575 + 268 + 66 } : { x: 140 + colW + gap + colW / 2, y: 388 + 300 };
  return (
    <SceneWrap frame={frame} s={s} e={e}>
      <div style={{ position: 'absolute', left: L.safe.x, width: L.safe.w, top: L.v ? 262 : 110, display: 'flex', justifyContent: L.v ? 'flex-end' : 'flex-end' }}>
        <SampleTag size={L.v ? 22 : 22} />
      </div>
      <div style={{ position: 'absolute', left: L.safe.x, top: L.v ? 330 : 150 }}>
        {L.v ? (
          <>
            <KLine frame={frame} at={s} size={84}>
              Teklifleri tek ekranda
            </KLine>
            <KLine frame={frame} at={s + 2} size={84}>
              <Teal>karşılaştır.</Teal>
            </KLine>
          </>
        ) : (
          <KLine frame={frame} at={s} size={78}>
            Teklifleri tek ekranda <Teal>karşılaştır.</Teal>
          </KLine>
        )}
      </div>
      {ORDER.map((kind, i) => {
        const a = appear(frame, TL.at(`products.p${i + 1}`));
        const P = PRODUCTS[kind];
        const isPick = i === 1;
        if (L.v) {
          return (
            <div key={kind} style={{ position: 'absolute', left: 90, top: 575 + i * 268, opacity: a.opacity, transform: `translateY(${(1 - a.p) * 80}px)` }}>
              <OfferCard kind={kind} partner={PARTNERS[kind]} width={860} selected={isPick ? sel : 0} dim={isPick ? 0 : sel} pressed={isPick ? pressed : 0} />
            </div>
          );
        }
        const x = 140 + i * (colW + gap);
        return (
          <div key={kind} style={{ position: 'absolute', left: x, top: 290, width: colW, opacity: a.opacity, transform: `translateY(${(1 - a.p) * 80}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 64 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: K.teal, display: 'grid', placeItems: 'center' }}>
                <P.Icon size={30} color="white" strokeWidth={2.4} />
              </div>
              <span style={{ fontFamily: fontK, fontWeight: 800, fontSize: 36, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{P.title}</span>
            </div>
            <OfferCard kind={kind} partner={PARTNERS[kind]} width={colW} s={1} layout="column" selected={isPick ? sel : 0} dim={isPick ? 0 : sel} pressed={isPick ? pressed : 0} style={{ marginTop: 34 }} />
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: L.safe.x,
          width: L.safe.w,
          top: L.v ? 1385 : 860,
          textAlign: L.v ? 'left' : 'center',
          fontFamily: fontK,
          fontWeight: 700,
          fontSize: L.v ? 34 : 38,
          lineHeight: 1.3,
          color: K.steel,
          opacity: cmp.opacity,
          transform: `translateY(${(1 - cmp.p) * 18}px)`,
        }}
      >
        Bankaların ve ödeme kuruluşlarının güncel kampanyaları,{L.v ? <br /> : ' '}tek platformda.
      </div>
      <Cursor
        frame={frame}
        clicks={[pick]}
        path={[
          [pick - 20, L.v ? 1000 : 1500, L.v ? 1560 : 1010],
          [pick - 2, target.x, target.y],
          [pick + 30, target.x + 8, target.y + 6],
        ]}
      />
    </SceneWrap>
  );
}

/* ───────────── 14-18 sn: araclar + rehber ───────────── */

const QUERY = 'KDV hes';
const RESULTS = ['KDV Hesaplama', 'KDV Tevkifatı Hesaplama'];
const CATEGORIES = ['Vergi ve Beyanname', 'Bordro ve Personel', 'Kredi ve Finansman'];
// Pratik KOBİ Rehberi'nde yayinda olan basliklar (kobipratik.com/llms.txt, 2026)
const GUIDES: Array<{ tag: string; title: string }> = [
  { tag: 'POS Çözümleri', title: 'İşletmeniz İçin Doğru POS Nasıl Seçilir?' },
  { tag: 'Finansman & Nakit Akışı', title: 'Nakit Akışı Yönetimi: KOBİ Rehberi' },
  { tag: 'KOBİ Kredileri', title: 'Yeni Kurulan Şirketler Kredi Alabilir Mi?' },
];

function Tools({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'tools');
  if (!on) return null;
  const typed = typedCount(frame, TL, 'tools.type', QUERY.length);
  const calc = TL.at('tools.calc');
  const showRes = frame >= TL.at('tools.type') + 10;
  const hl = ramp(frame, calc, calc + 6);
  const left: Box = L.v ? { x: 90, y: 440, w: 860, h: 470 } : { x: 140, y: 280, w: 790, h: 620 };
  const right: Box = L.v ? { x: 90, y: 945, w: 860, h: 545 } : { x: 990, y: 280, w: 790, h: 620 };
  const gAts = ['tools.g1', 'tools.g2', 'tools.g3'].map((id) => TL.at(id));
  const leftIn = appear(frame, s + 2);
  const rightIn = appear(frame, s + 6);
  return (
    <SceneWrap frame={frame} s={s} e={e}>
      <div style={{ position: 'absolute', left: L.safe.x, top: L.v ? 280 : 120 }}>
        <KLine frame={frame} at={s} size={L.v ? 76 : 80}>
          Hesapla, <Teal>öğren.</Teal>
        </KLine>
      </div>
      {/* Pratik Araclar */}
      <div style={{ ...card, left: left.x, top: left.y, width: left.w, height: left.h, padding: L.v ? 32 : 40, opacity: leftIn.opacity, transform: `translateY(${(1 - leftIn.p) * 50}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Calculator size={40} color={K.teal} strokeWidth={2.2} />
          <span style={{ fontFamily: fontK, fontWeight: 800, fontSize: 36 }}>Pratik Araçlar</span>
        </div>
        <div style={{ marginTop: 10, fontFamily: fontK, fontWeight: 700, fontSize: L.v ? 30 : 32, color: K.steel }}>100+ ücretsiz hesaplama aracı</div>
        <div style={{ marginTop: L.v ? 22 : 30, height: 76, borderRadius: 18, border: `2px solid ${alpha(K.teal, 0.6)}`, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px', fontFamily: fontK, fontSize: 34, fontWeight: 600 }}>
          <Search size={32} color={K.gray} />
          <span>{QUERY.slice(0, typed)}</span>
          <span style={{ width: 3, height: 38, background: K.teal, opacity: Math.floor(frame / 8) % 2 === 0 ? 1 : 0, marginLeft: -12 }} />
        </div>
        <div style={{ marginTop: 14 }}>
          {RESULTS.map((r, i) => {
            const a = appear(frame, TL.at('tools.type') + 10 + i * 3);
            const active = i === 0;
            return showRes ? (
              <div
                key={r}
                style={{
                  height: L.v ? 62 : 70,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 22px',
                  borderRadius: 16,
                  background: active ? alpha(K.teal, 0.08 + 0.1 * hl) : 'transparent',
                  fontFamily: fontK,
                  fontWeight: 700,
                  fontSize: 31,
                  color: active ? K.navy : K.gray,
                  opacity: a.opacity,
                }}
              >
                {r}
                {active ? <ArrowRight size={30} color={K.teal} style={{ opacity: hl }} /> : null}
              </div>
            ) : null;
          })}
        </div>
        <div style={{ marginTop: L.v ? 16 : 26, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {CATEGORIES.map((c, i) => {
            const a = appear(frame, gAts[i]);
            return (
              <Pill key={c} size={L.v ? 24 : 25} color={K.steel} style={{ opacity: a.opacity, transform: `scale(${0.8 + 0.2 * a.p})` }}>
                {c}
              </Pill>
            );
          })}
        </div>
      </div>
      {/* Pratik KOBI Rehberi */}
      <div style={{ ...card, left: right.x, top: right.y, width: right.w, height: right.h, padding: L.v ? 32 : 40, opacity: rightIn.opacity, transform: `translateY(${(1 - rightIn.p) * 50}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BookOpen size={40} color={K.teal} strokeWidth={2.2} />
          <span style={{ fontFamily: fontK, fontWeight: 800, fontSize: 36 }}>Pratik KOBİ Rehberi</span>
        </div>
        <div style={{ marginTop: 10, fontFamily: fontK, fontWeight: 700, fontSize: L.v ? 30 : 32, color: K.steel }}>KOBİ ve esnafa uygulamalı rehberler</div>
        <div style={{ marginTop: L.v ? 22 : 30, display: 'flex', flexDirection: 'column', gap: L.v ? 14 : 18 }}>
          {GUIDES.map((g, i) => {
            const a = appear(frame, gAts[i]);
            return (
              <div
                key={g.title}
                style={{ borderRadius: 18, background: K.bg, padding: L.v ? '16px 22px' : '20px 24px', opacity: a.opacity, transform: `translateX(${(1 - a.p) * 50}px)` }}
              >
                <div style={{ fontFamily: fontK, fontWeight: 700, fontSize: 21, color: K.teal, letterSpacing: '0.02em' }}>{g.tag}</div>
                <div style={{ marginTop: 6, fontFamily: fontK, fontWeight: 800, fontSize: L.v ? 30 : 31, lineHeight: 1.2, color: K.navy, whiteSpace: 'nowrap' }}>{g.title}</div>
              </div>
            );
          })}
        </div>
      </div>
      <Cursor
        frame={frame}
        clicks={[calc]}
        path={[
          [calc - 16, left.x + left.w + 60, left.y + left.h + 40],
          [calc - 2, left.x + 300, left.y + (L.v ? 252 : 284)],
          [calc + 24, left.x + 306, left.y + (L.v ? 256 : 288)],
        ]}
      />
    </SceneWrap>
  );
}

/* ───────────── 18-25 sn: 3 adim ───────────── */

function How({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'how');
  if (!on) return null;
  const s1 = TL.at('how.s1');
  const s2 = TL.at('how.s2');
  const s3 = TL.at('how.s3');
  const done = TL.at('how.done');
  const colW = 510;
  const gap = (1640 - colW * 3) / 2;
  const box = (i: number): Box => (L.v ? { x: 90, y: 540 + i * 320, w: 860, h: 295 } : { x: 140 + i * (colW + gap), y: 300, w: colW, h: 600 });
  const steps = [
    { n: 1, title: 'İhtiyacını seç', sub: 'Ticari kredi, kart ya da POS', at: s1 },
    { n: 2, title: 'Teklifleri karşılaştır', sub: 'Güncel kampanyalar tek ekranda', at: s2 },
    { n: 3, title: 'Kolayca başvur', sub: 'Başvurun ilgili kuruma iletilir', at: s3 },
  ];
  // imlec: her adimin etkilesim noktasi
  const hit = (i: number) => {
    const b = box(i);
    if (L.v) return { x: b.x + 860 - 200, y: b.y + [211, 138, 148][i] };
    return { x: b.x + colW / 2 + 40, y: b.y + [455, 382, 392][i] };
  };
  return (
    <SceneWrap frame={frame} s={s} e={e}>
      <div style={{ position: 'absolute', left: L.safe.x, top: L.v ? 290 : 120 }}>
        {L.v ? (
          <>
            <KLine frame={frame} at={s} size={96}>
              3 adımda
            </KLine>
            <KLine frame={frame} at={s + 2} size={96}>
              <Teal>karşılaştır, başvur.</Teal>
            </KLine>
          </>
        ) : (
          <KLine frame={frame} at={s} size={80}>
            3 adımda <Teal>karşılaştır, başvur.</Teal>
          </KLine>
        )}
      </div>
      {steps.map((st, i) => {
        const b = box(i);
        const a = appear(frame, s + 4 + i * 4);
        const active = frame >= st.at - 2;
        const isDone = i === 2 ? frame >= done - 2 : frame >= [s2, s3, done][i];
        return (
          <div
            key={st.n}
            style={{
              ...card,
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              padding: L.v ? '30px 34px' : 40,
              border: `3px solid ${active ? alpha(K.teal, 0.6) : K.line}`,
              opacity: a.opacity,
              transform: `translateY(${(1 - a.p) * 60}px)`,
              display: 'flex',
              flexDirection: L.v ? 'row' : 'column',
              gap: L.v ? 30 : 0,
            }}
          >
            <div style={{ width: L.v ? 400 : undefined, flexShrink: 0 }}>
              <span style={{ width: 80, height: 80, borderRadius: 24, display: 'grid', placeItems: 'center', background: isDone ? K.teal : K.mist, color: isDone ? 'white' : K.teal, fontFamily: fontK, fontWeight: 800, fontSize: 42 }}>
                {isDone ? <Check size={46} strokeWidth={3.2} /> : st.n}
              </span>
              <div style={{ marginTop: 22, fontFamily: fontK, fontWeight: 800, fontSize: L.v ? 42 : 44, letterSpacing: '-0.02em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{st.title}</div>
              <div style={{ marginTop: 8, fontFamily: fontK, fontWeight: 600, fontSize: L.v ? 27 : 29, color: K.gray, whiteSpace: L.v ? 'normal' : 'nowrap', lineHeight: 1.3 }}>{st.sub}</div>
            </div>
            <div style={{ marginTop: L.v ? 0 : 40, flex: 1 }}>
              {i === 0 ? <StepPick frame={frame} at={s1} /> : i === 1 ? <StepCompare frame={frame} at={s2} /> : <StepApply frame={frame} at={s3} done={done} />}
            </div>
          </div>
        );
      })}
      <Cursor
        frame={frame}
        clicks={[s1, s2, s3]}
        path={[
          [s1 - 18, L.v ? 1000 : 900, L.v ? 1560 : 1010],
          [s1 - 2, hit(0).x, hit(0).y],
          [s1 + 12, hit(0).x, hit(0).y],
          [s2 - 2, hit(1).x, hit(1).y],
          [s2 + 12, hit(1).x, hit(1).y],
          [s3 - 2, hit(2).x, hit(2).y],
          [s3 + 40, hit(2).x + 10, hit(2).y + 8],
        ]}
      />
    </SceneWrap>
  );
}

function StepPick({ frame, at }: { frame: number; at: number }) {
  const opts: Array<{ label: string; Icon: typeof Percent }> = [
    { label: 'Ticari kredi', Icon: Percent },
    { label: 'Ticari kart', Icon: CreditCard },
    { label: 'POS', Icon: Store },
  ];
  const on = ramp(frame, at, at + 6);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {opts.map((o, i) => {
        const sel = i === 2 ? on : 0;
        return (
          <div
            key={o.label}
            style={{
              height: 62,
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '0 18px',
              background: sel > 0 ? alpha(K.teal, 0.1 * sel) : K.bg,
              border: `2px solid ${sel > 0 ? alpha(K.teal, sel) : 'transparent'}`,
              fontFamily: fontK,
              fontWeight: 700,
              fontSize: 27,
              color: K.navy,
            }}
          >
            <o.Icon size={28} color={K.teal} />
            {o.label}
            {sel > 0.5 ? <Check size={28} color={K.teal} strokeWidth={3} style={{ marginLeft: 'auto' }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function StepCompare({ frame, at }: { frame: number; at: number }) {
  const on = ramp(frame, at, at + 6);
  const rows = ['Örnek Banka A', 'Örnek Kuruluş B', 'Örnek Banka C'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r, i) => {
        const sel = i === 1 ? on : 0;
        return (
          <div
            key={r}
            style={{
              height: 62,
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 18px',
              background: sel > 0 ? alpha(K.teal, 0.1 * sel) : K.bg,
              border: `2px solid ${sel > 0 ? alpha(K.teal, sel) : 'transparent'}`,
              fontFamily: fontK,
              fontWeight: 700,
              fontSize: 25,
              color: K.navy,
              opacity: 1 - 0.45 * on * (i === 1 ? 0 : 1),
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Landmark size={24} color={K.steel} /> {r}
            </span>
            <span style={{ color: alpha(K.steel, 0.8), fontWeight: 800 }}>%X,XX</span>
          </div>
        );
      })}
    </div>
  );
}

function StepApply({ frame, at, done }: { frame: number; at: number; done: number }) {
  const pressed = frame >= at && frame < at + 6 ? 1 : 0;
  const d = appear(frame, done);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ height: 62, borderRadius: 16, background: K.bg, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', fontFamily: fontK, fontWeight: 700, fontSize: 25, color: K.navy }}>
        <Landmark size={24} color={K.steel} /> Örnek Kuruluş B
      </div>
      <KButton size={30} pressed={pressed} style={{ width: '100%', boxSizing: 'border-box' }}>
        Hemen Başvur
      </KButton>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: fontK, fontWeight: 700, fontSize: 25, color: K.teal, opacity: d.opacity, transform: `translateY(${(1 - d.p) * 14}px)` }}>
        <ArrowRight size={28} /> İlgili kurumun dijital kanalına
      </div>
    </div>
  );
}

/* ───────────── 25-30 sn: neden KobiPratik ───────────── */

// "Neden KobiPratik?" listesi + SSS (kobipratik.com, ana sayfa ve /kobipratik-nedir)
const REASONS: Array<{ ev: string; title: string; sub: string }> = [
  { ev: 'trust.t1', title: 'Kullanmak ücretsiz', sub: 'Üyelik ya da başvuru ücreti yok' },
  { ev: 'trust.t2', title: 'Şeffaf karşılaştırma', sub: 'Güncel ve anlaşılır bilgiler' },
  { ev: 'trust.t3', title: 'Dijital ve pratik başvuru', sub: 'Birçok üründe şubeye gitmeden' },
  { ev: 'trust.t4', title: 'Yalnız seçtiğin kuruma', sub: 'Başvurun onay verdiğin kurumla paylaşılır' },
];

function Trust({ frame, L }: { frame: number; L: L }) {
  const { s, e, on } = inScene(frame, 'trust');
  if (!on) return null;
  const note = appear(frame, TL.at('trust.note'));
  const list: Box = L.v ? { x: 90, y: 545, w: 860, h: 0 } : { x: 900, y: 150, w: 880, h: 0 };
  return (
    <SceneWrap frame={frame} s={s} e={e}>
      <div style={{ position: 'absolute', left: L.safe.x, top: L.v ? 290 : 300, width: L.v ? 860 : 700 }}>
        <KLine frame={frame} at={s} size={L.v ? 96 : 100}>
          Neden
        </KLine>
        <KLine frame={frame} at={s + 2} size={L.v ? 96 : 100}>
          <Teal>KobiPratik?</Teal>
        </KLine>
      </div>
      {REASONS.map((r, i) => {
        const a = appear(frame, TL.at(r.ev));
        return (
          <div
            key={r.ev}
            style={{
              ...card,
              left: list.x,
              top: list.y + i * (L.v ? 182 : 185),
              width: list.w,
              height: L.v ? 160 : 165,
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              padding: '0 34px',
              opacity: a.opacity,
              transform: `translateX(${(1 - a.p) * 70}px)`,
            }}
          >
            <span style={{ width: 72, height: 72, borderRadius: 999, background: K.teal, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Check size={42} color="white" strokeWidth={3.2} />
            </span>
            <div>
              <div style={{ fontFamily: fontK, fontWeight: 800, fontSize: 44, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ marginTop: 4, fontFamily: fontK, fontWeight: 600, fontSize: L.v ? 29 : 30, color: K.gray, whiteSpace: 'nowrap' }}>{r.sub}</div>
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: L.safe.x,
          top: L.v ? 1285 : 640,
          width: L.v ? 860 : 680,
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
          opacity: note.opacity,
          transform: `translateY(${(1 - note.p) * 20}px)`,
        }}
      >
        <ShieldCheck size={52} color={K.teal} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: fontK, fontWeight: 700, fontSize: L.v ? 33 : 32, lineHeight: 1.35, color: K.navy }}>
          KobiPratik kredi veren bir kurum değildir. Değerlendirme ve onay ilgili kuruma aittir.
        </span>
      </div>
    </SceneWrap>
  );
}

/* ───────────── 30-36 sn: kapanis ───────────── */

function End({ frame, L }: { frame: number; L: L }) {
  const [s] = TL.scene('end');
  if (frame < s) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 4);
  const head = snap(frame, s + 8);
  const cta = snap(frame, TL.at('end.cta'));
  const url = appear(frame, TL.at('end.url'));
  const note = appear(frame, TL.at('end.note'));
  return (
    <div style={{ position: 'absolute', left: L.safe.x, width: L.safe.w, top: L.v ? 290 : 120, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: `scale(${tile})` }}>
        <SymbolTile size={L.v ? 160 : 140} />
      </div>
      <div style={{ marginTop: L.v ? 44 : 36, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 24}px)` }}>
        <Wordmark width={L.v ? 600 : 640} />
      </div>
      <div style={{ marginTop: L.v ? 50 : 40, textAlign: 'center', fontFamily: fontK, fontWeight: 800, fontSize: L.v ? 112 : 116, letterSpacing: '-0.035em', lineHeight: 1.04, opacity: clamp01(head * 1.5), transform: `translateY(${(1 - head) * 30}px)` }}>
        Karşılaştır,{L.v ? <br /> : ' '}
        <Teal>başvur.</Teal>
      </div>
      <div style={{ marginTop: L.v ? 52 : 44, display: 'flex', flexDirection: L.v ? 'column' : 'row', alignItems: 'center', gap: L.v ? 36 : 30 }}>
        <div style={{ opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
          <KButton size={L.v ? 56 : 50}>
            <span style={{ opacity: url.opacity }}>kobipratik.com</span> <ArrowRight size={L.v ? 54 : 48} strokeWidth={2.8} />
          </KButton>
        </div>
        <div style={{ opacity: url.opacity, transform: `translateY(${(1 - url.p) * 16}px)` }}>
          <Pill size={L.v ? 34 : 32} color={K.teal} bg={K.paper} style={{ boxShadow: `0 8px 22px ${alpha(K.navy, 0.07)}` }}>
            <Check size={L.v ? 34 : 32} strokeWidth={3} /> Kullanmak ücretsiz
          </Pill>
        </div>
      </div>
      <div style={{ marginTop: L.v ? 56 : 50, width: L.v ? 800 : 1300, textAlign: 'center', fontFamily: fontK, fontWeight: 600, fontSize: L.v ? 25 : 24, lineHeight: 1.4, color: K.gray, opacity: note.opacity }}>{DISCLAIMER}</div>
    </div>
  );
}
