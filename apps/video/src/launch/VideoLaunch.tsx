import React from 'react';
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { ArrowRight, Check, Download, FileText, Globe, Package, ShieldCheck } from 'lucide-react';
import { alpha, brand, light } from '../tokens';
import { LogoMark, Wordmark } from '../ui';
import { BigLine, Chip, CtaButton, GradText, M, SampleTag, Soundtrack, Stage, clamp01, fontDisplay, fontUI, ramp, snap, soft, useBrandFonts, fontMono } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import type { MarketingProps } from '../marketing/ProductIntro';
import { ARTICLE_URL, PRODUCT_URL, SITE_URL, articleExample, productExample, siteExample } from './examples';
import { Bar, BrowserCard, Mark, Phone, SourceTile, VerticalExample, WideScreen, WideSiteExample, appear, phoneWidth, type SourceKind } from './parts';

/**
 * VideoLaunch — RanksUp Video duyuru filmi, 1920×1080 @30, 32 sn (timeline.json 'VideoLaunch').
 *
 *   0-3 sn   kanca: "Makalen. Siten. Ürünün. Artık videosu da hazır." + uc gercek video telefonda
 *   3-5      RanksUp Video kilidi
 *   5-17     uc kaynak: kaynak sayfa (sematik, sayfanin kendi metni) → telefonda gercek sablon
 *   17-21    uc video yan yana: her biri sitenin markasiyla
 *   21-26    uc adim: kaynagi sec → markani kontrol et → video hazir; sayi koruyucusu
 *   26-32    kapanis: plan satiri (plans.ts VIDEOS_PER_MONTH), "Hemen dene", ranksup.ai
 *
 * Ornek videolar kobipratik.com icin sunucu hattinin gercek ciktisidir (examples.ts) ve
 * "Örnek çıktı" etiketi tasir. Izlenme/satis/siralama vaadi yok.
 */

const TL = timeline('VideoLaunch');
export const VIDEO_LAUNCH_DURATION = TL.durationInFrames;

export const VideoLaunch: React.FC<MarketingProps> = ({ muted = false }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Soundtrack tl={TL} muted={muted} />
      <Hook frame={frame} />
      <BrandLock frame={frame} />
      <SourceScene frame={frame} kind="article" />
      <SourceScene frame={frame} kind="site" />
      <SourceScene frame={frame} kind="product" />
      <Trio frame={frame} />
      <Flow frame={frame} />
      <End frame={frame} />
    </Stage>
  );
};

/* ───────────── 0-3 sn: kanca ───────────── */

const HOOK_WORDS: Array<{ kind: SourceKind; word: string; ev: string }> = [
  { kind: 'article', word: 'Makalen.', ev: 'hook.w1' },
  { kind: 'site', word: 'Siten.', ev: 'hook.w2' },
  { kind: 'product', word: 'Ürünün.', ev: 'hook.w3' },
];

function Hook({ frame }: { frame: number }) {
  const [, e] = TL.scene('hook');
  if (frame >= e) return null;
  const out = ramp(frame, e - 10, e - 1, Easing.in(Easing.cubic));
  const line = TL.at('hook.line');
  // telefon yelpazesi: sol, orta, sag (orta onde)
  const fan = [
    { x: 1190, y: 250, rot: -8, z: 1, offset: 34 },
    { x: 1430, y: 205, rot: 0, z: 3, offset: 40 },
    { x: 1670, y: 250, rot: 8, z: 2, offset: 52 },
  ];
  const ph = 640;
  const pw = phoneWidth(ph);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 50}px)` }}>
      <div style={{ position: 'absolute', left: 150, top: 150 }}>
        {HOOK_WORDS.map((w, i) => {
          const at = TL.at(w.ev) - (i === 0 ? 4 : 0);
          const p = snap(frame, at);
          return (
            <div key={w.kind} style={{ display: 'flex', alignItems: 'center', gap: 34, height: 132, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 40}px)` }}>
              <SourceTile kind={w.kind} size={100} flipAt={line} frame={frame} />
              <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 112, letterSpacing: '-0.035em', lineHeight: 1 }}>{w.word}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 44 }}>
          <BigLine frame={frame} at={line} size={92}>
            Artık
          </BigLine>
          <BigLine frame={frame} at={line + 2} size={92}>
            <GradText>videosu da hazır.</GradText>
          </BigLine>
        </div>
      </div>
      {fan.map((f, i) => {
        const at = TL.at(HOOK_WORDS[i].ev);
        const p = snap(frame, at, 30, 6);
        if (frame < at - 6) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: f.x - pw / 2,
              top: f.y,
              zIndex: f.z,
              opacity: clamp01(p * 1.6),
              transform: `translateY(${(1 - p) * 160}px) rotate(${f.rot * p}deg)`,
              transformOrigin: '50% 100%',
            }}
          >
            <Phone height={ph} style={{ position: 'relative' }}>
              <VerticalExample kind={HOOK_WORDS[i].kind} frame={frame} start={at} offset={f.offset} rate={1.2} />
            </Phone>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ───────────── 3-5 sn: RanksUp Video ───────────── */

function VideoLockup({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <Wordmark size={size} theme={light} />
      <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: size, letterSpacing: '-0.035em', lineHeight: 1 }}>
        <GradText>Video</GradText>
      </span>
    </div>
  );
}

function BrandLock({ frame }: { frame: number }) {
  const [s, e] = TL.scene('brand');
  if (frame < s || frame >= e) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 5);
  const tag = soft(frame, TL.at('brand.tag') - 4);
  const out = ramp(frame, e - 8, e - 1, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 56, opacity: 1 - out, transform: `scale(${1 - out * 0.06})` }}>
      <div style={{ transform: `scale(${tile})` }}>
        <LogoMark size={170} />
      </div>
      <div style={{ opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 30}px)` }}>
        <VideoLockup size={124} />
      </div>
      <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 48, letterSpacing: '-0.02em', color: M.body, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
        Makalenden, sitenden, ürününden — senin markanla kısa video.
      </div>
    </AbsoluteFill>
  );
}

/* ───────────── 5-17 sn: uc kaynak ───────────── */

const SOURCE_META: Record<SourceKind, { n: string; eyebrow: string; title: string; sub: string; note: string; url: string; offset: number }> = {
  article: { n: '1', eyebrow: 'Makaleden', title: 'Yayındaki makalenden', sub: '15 sn dikey video · Reels, Shorts, TikTok', note: 'Başlık → kanca · 3 bölüm → 3 madde', url: ARTICLE_URL, offset: 22 },
  site: { n: '2', eyebrow: 'Site tanıtımı', title: 'Sitenin kendisinden', sub: '15 sn dikey ya da 24 sn yatay', note: 'Logon, ne yaptığın, 3 hizmetin', url: SITE_URL, offset: 12 },
  product: { n: '3', eyebrow: 'Ürün tanıtımı', title: 'Ürün sayfandan', sub: 'Ürün ya da hizmet sayfası · 15 sn, dikey ya da yatay', note: 'Fiyat yalnız sayfada doğrulanırsa', url: PRODUCT_URL, offset: 12 },
};

const ICONS = { article: FileText, site: Globe, product: Package } as const;

function SourceScene({ frame, kind }: { frame: number; kind: SourceKind }) {
  const [s, e] = TL.scene(kind);
  if (frame < s - 1 || frame >= e) return null;
  const meta = SOURCE_META[kind];
  const inP = snap(frame, s, 30, 6);
  const out = ramp(frame, e - 8, e - 1, Easing.in(Easing.cubic));
  const phoneAt = TL.at(`${kind}.phone`);
  const phone = snap(frame, phoneAt);
  const marks = [1, 2, 3, 4].map((k) => ramp(frame, TL.at(`${kind}.h${k}`) - 2, TL.at(`${kind}.h${k}`) + 4));
  const note = appear(frame, TL.at(`${kind}.format`));
  const arrow = ramp(frame, phoneAt - 4, phoneAt + 8) * (kind === 'site' ? 1 - ramp(frame, TL.at('site.wide') - 6, TL.at('site.wide')) : 1);
  const Icon = ICONS[kind];
  const ph = 900;
  const pw = phoneWidth(ph);
  const phoneLeft = 1450 - pw / 2;
  return (
    <AbsoluteFill style={{ opacity: clamp01(inP * 1.5) * (1 - out), transform: `translateX(${(1 - inP) * 120 - out * 120}px)` }}>
      <div style={{ position: 'absolute', left: 150, top: 96, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Chip color={brand[700]} size={26}>
          <Icon size={26} /> {meta.n}/3 · {meta.eyebrow}
        </Chip>
        <SampleTag size={22} label="Örnek çıktı · kobipratik.com" />
      </div>
      <div style={{ position: 'absolute', left: 150, top: 160 }}>
        <BigLine frame={frame} at={s + 2} size={76}>
          {meta.title}
        </BigLine>
        <div style={{ marginTop: 14, fontFamily: fontUI, fontWeight: 700, fontSize: 34, color: M.body, opacity: soft(frame, s + 6) }}>{meta.sub}</div>
      </div>
      <BrowserCard url={meta.url} width={830} height={536} style={{ left: 150, top: 370 }} urlHighlight={kind === 'product' ? marks[3] : 0}>
        <SourcePage kind={kind} marks={marks} />
      </BrowserCard>
      <div style={{ position: 'absolute', left: 150, top: 918, opacity: note.opacity, transform: `translateY(${(1 - note.p) * 20}px)` }}>
        <Chip color={M.success} size={28}>
          <Check size={28} strokeWidth={3} /> {meta.note}
        </Chip>
      </div>
      {/* kaynak → video oku */}
      <div style={{ position: 'absolute', left: 1006, top: 600, width: phoneLeft - 1006 - 26, height: 60, display: 'flex', alignItems: 'center', opacity: arrow }}>
        <div style={{ flex: 1, height: 6, borderRadius: 99, background: M.gradH, transform: `scaleX(${arrow})`, transformOrigin: 'left center' }} />
        <ArrowRight size={52} color={logoTo} strokeWidth={3} style={{ marginLeft: -18 }} />
      </div>
      {frame >= phoneAt - 6 ? (
        <div style={{ position: 'absolute', left: phoneLeft, top: 90, opacity: clamp01(phone * 1.6), transform: `translateY(${(1 - phone) * 90}px) scale(${0.92 + 0.08 * phone})` }}>
          <Phone height={ph} style={{ position: 'relative' }}>
            <VerticalExample kind={kind} frame={frame} start={phoneAt} offset={meta.offset} rate={1.6} />
          </Phone>
        </div>
      ) : null}
      {kind === 'site' ? <WideInset frame={frame} /> : null}
    </AbsoluteFill>
  );
}

const logoTo = brand[700];

function WideInset({ frame }: { frame: number }) {
  const at = TL.at('site.wide');
  if (frame < at - 6) return null;
  const p = snap(frame, at);
  return (
    <div style={{ position: 'absolute', left: 1010, top: 650, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 60}px) scale(${0.9 + 0.1 * p})`, transformOrigin: '20% 100%' }}>
      <WideScreen width={560} style={{ position: 'relative' }}>
        <WideSiteExample frame={frame} start={at} offset={40} rate={1.4} />
      </WideScreen>
      <Chip color="#ffffff" bg={M.ink} size={24} style={{ position: 'absolute', left: 18, top: -22 }}>
        Yatay · 24 sn
      </Chip>
    </div>
  );
}

/** Kaynak sayfanin sematik gorunumu — metinler examples.ts'teki sayfa metinleri */
function SourcePage({ kind, marks }: { kind: SourceKind; marks: number[] }) {
  const teal = siteExample.brand.primary!;
  if (kind === 'article') {
    const a = articleExample;
    return (
      <div style={{ fontFamily: fontUI, color: M.ink }}>
        <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '0.06em', color: teal }}>PRATİK KOBİ REHBERİ</div>
        <Mark on={marks[0]} style={{ marginTop: 10 }}>
          <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 44, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{a.hook}</div>
        </Mark>
        <Bar w="94%" mt={16} />
        <Bar w="70%" />
        {a.points.map((p, i) => (
          <div key={i} style={{ marginTop: 22 }}>
            <Mark on={marks[i + 1]}>
              <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{p.title}</div>
            </Mark>
            <Bar w={`${[88, 76, 82][i]}%`} mt={10} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'site') {
    const st = siteExample;
    return (
      <div style={{ fontFamily: fontUI, color: M.ink }}>
        <Mark on={marks[0]} style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
          <Img src={st.brand.logoUrl!} style={{ width: 46, height: 46, objectFit: 'contain' }} />
          <span style={{ fontWeight: 800, fontSize: 28 }}>{st.brand.name}</span>
        </Mark>
        <Mark on={marks[1]} style={{ marginTop: 16 }}>
          <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 38, letterSpacing: '-0.03em', lineHeight: 1.12 }}>{st.hook}</div>
        </Mark>
        <Mark on={marks[2]} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 23, lineHeight: 1.35, color: M.body }}>{st.hookSub}</div>
        </Mark>
        <Mark on={marks[3]} style={{ marginTop: 18, display: 'flex', gap: 14 }}>
          {st.points.map((p) => (
            <div key={p.title} style={{ flex: 1, padding: '16px 16px', borderRadius: 14, border: `1.5px solid ${M.hair}`, background: M.paper, fontWeight: 800, fontSize: 21, whiteSpace: 'nowrap' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: alpha(teal, 0.14), marginBottom: 10 }} />
              {p.title}
            </div>
          ))}
        </Mark>
      </div>
    );
  }
  const pr = productExample;
  return (
    <div style={{ fontFamily: fontUI, color: M.ink }}>
      <Mark on={marks[0]}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 48, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{pr.hook}</div>
      </Mark>
      <Mark on={marks[1]} style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 24, lineHeight: 1.38, color: M.body }}>{pr.hookSub}</div>
      </Mark>
      <Mark on={marks[2]} style={{ marginTop: 18 }}>
        {pr.points.map((p) => (
          <div key={p.title} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 54, fontWeight: 800, fontSize: 27 }}>
            <span style={{ width: 34, height: 34, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(teal, 0.14), color: teal }}>
              <Check size={22} strokeWidth={3} />
            </span>
            {p.title}
          </div>
        ))}
      </Mark>
    </div>
  );
}

/* ───────────── 17-21 sn: uc video yan yana ───────────── */

function Trio({ frame }: { frame: number }) {
  const [s, e] = TL.scene('trio');
  if (frame < s - 1 || frame >= e) return null;
  const head = snap(frame, s, 30, 6);
  const line = soft(frame, TL.at('trio.line') - 4);
  const out = ramp(frame, e - 8, e - 1, Easing.in(Easing.cubic));
  const ph = 660;
  const pw = phoneWidth(ph);
  const items: Array<{ kind: SourceKind; label: string; offset: number }> = [
    { kind: 'article', label: 'Makaleden', offset: 300 },
    { kind: 'site', label: 'Site tanıtımı', offset: 200 },
    { kind: 'product', label: 'Ürün tanıtımı', offset: 250 },
  ];
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 40}px)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 70, textAlign: 'center', opacity: clamp01(head * 1.5), transform: `translateY(${(1 - head) * 40}px)` }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 80, letterSpacing: '-0.035em', lineHeight: 1.1 }}>
          Her video <GradText>senin markanla.</GradText>
        </div>
        <div style={{ marginTop: 14, fontFamily: fontUI, fontWeight: 700, fontSize: 34, color: M.body, opacity: line }}>
          Adın, logon ve rengin sitenden okunur; üretmeden önce düzeltebilirsin.
        </div>
      </div>
      {items.map((it, i) => {
        const at = TL.at(`trio.p${i + 1}`);
        const p = snap(frame, at);
        if (frame < at - 6) return null;
        const cx = 960 + (i - 1) * 480;
        return (
          <div key={it.kind} style={{ position: 'absolute', left: cx - pw / 2, top: 300, width: pw, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 120}px)` }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <Chip color={brand[700]} size={24}>
                {it.label}
              </Chip>
            </div>
            <Phone height={ph} style={{ position: 'relative' }}>
              <VerticalExample kind={it.kind} frame={frame} start={at} offset={it.offset} rate={1} />
            </Phone>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ───────────── 21-26 sn: uc adim ───────────── */

function StepCard({ frame, at, n, title, children, left }: { frame: number; at: number; n: string; title: string; children: React.ReactNode; left: number }) {
  const p = snap(frame, at);
  const active = clamp01(p);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: 300,
        width: 500,
        height: 420,
        boxSizing: 'border-box',
        padding: 40,
        borderRadius: 34,
        background: M.paper,
        border: `1.5px solid ${M.hair}`,
        boxShadow: `0 30px 80px ${alpha(M.ink, 0.1)}`,
        opacity: clamp01(p * 1.6),
        transform: `translateY(${(1 - p) * 70}px) scale(${0.94 + 0.06 * active})`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={{ width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', background: M.grad, color: 'white', fontFamily: fontDisplay, fontWeight: 800, fontSize: 30 }}>{n}</span>
        <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 40, letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>{title}</span>
      </div>
      <div style={{ marginTop: 32 }}>{children}</div>
    </div>
  );
}

function Flow({ frame }: { frame: number }) {
  const [s, e] = TL.scene('flow');
  if (frame < s - 1 || frame >= e) return null;
  const out = ramp(frame, e - 8, e - 1, Easing.in(Easing.cubic));
  const trust = appear(frame, TL.at('flow.trust'));
  const lefts = [150, 710, 1270];
  const opt = (Icon: typeof FileText, label: string, on: boolean) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 70, padding: '0 22px', marginBottom: 14, borderRadius: 18, border: `2px solid ${on ? alpha(brand[500], 0.6) : M.hair}`, background: on ? alpha(brand[500], 0.07) : M.paper, fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>
      <Icon size={30} color={brand[600]} /> {label}
    </div>
  );
  const sel = Math.floor(clamp01((frame - TL.at('flow.s1')) / 60) * 2.99);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 40}px)` }}>
      <div style={{ position: 'absolute', left: 150, top: 110 }}>
        <BigLine frame={frame} at={s + 2} size={84}>
          Üç adımda <GradText>hazır.</GradText>
        </BigLine>
      </div>
      <StepCard frame={frame} at={TL.at('flow.s1')} n="1" title="Kaynağı seç" left={lefts[0]}>
        {opt(FileText, 'Makaleden', sel === 0)}
        {opt(Globe, 'Site tanıtımı', sel === 1)}
        {opt(Package, 'Ürün tanıtımı', sel === 2)}
      </StepCard>
      <StepCard frame={frame} at={TL.at('flow.s2')} n="2" title="Markanı kontrol et" left={lefts[1]}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 84, height: 84, borderRadius: 22, background: '#fff', border: `1.5px solid ${M.hair}`, display: 'grid', placeItems: 'center' }}>
            <Img src={siteExample.brand.logoUrl!} style={{ width: 58, height: 58, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, height: 70, borderRadius: 16, border: `2px solid ${M.hair}`, display: 'flex', alignItems: 'center', padding: '0 20px', fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>{siteExample.brand.name}</div>
        </div>
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 16, fontFamily: fontUI, fontWeight: 700, fontSize: 26, color: M.inkSoft }}>
          <span style={{ width: 52, height: 52, borderRadius: 14, background: siteExample.brand.primary }} />
          Tema rengi
          <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontWeight: 600, fontSize: 24, color: M.muted }}>{siteExample.brand.primary}</span>
        </div>
        <div style={{ marginTop: 22, fontFamily: fontUI, fontWeight: 600, fontSize: 24, lineHeight: 1.35, color: M.body }}>Sitenden okunur; rengi, logoyu ve adı değiştirebilirsin.</div>
      </StepCard>
      <StepCard frame={frame} at={TL.at('flow.s3')} n="3" title="Video hazır" left={lefts[2]}>
        <Chip color={M.success} size={28}>
          <Check size={28} strokeWidth={3} /> Hazır
        </Chip>
        <div style={{ marginTop: 22, fontFamily: fontUI, fontWeight: 700, fontSize: 28, color: M.inkSoft }}>Panelde izle, MP4 olarak indir.</div>
        <div style={{ marginTop: 30, display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 30px', borderRadius: 18, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 30 }}>
          <Download size={30} /> İndir
        </div>
      </StepCard>
      {[0, 1].map((i) => {
        const p = ramp(frame, TL.at(i === 0 ? 'flow.s2' : 'flow.s3') - 8, TL.at(i === 0 ? 'flow.s2' : 'flow.s3'));
        return (
          <div key={i} style={{ position: 'absolute', left: lefts[i] + 500 + 6, top: 488, opacity: p, transform: `translateX(${(1 - p) * -12}px)` }}>
            <ArrowRight size={48} color={brand[600]} strokeWidth={3} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center', opacity: trust.opacity, transform: `translateY(${(1 - trust.p) * 30}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '24px 40px', borderRadius: 26, background: M.paper, border: `2px solid ${alpha(M.success, 0.3)}`, boxShadow: `0 20px 50px ${alpha(M.ink, 0.08)}`, fontFamily: fontUI, fontWeight: 800, fontSize: 36, color: M.ink }}>
          <ShieldCheck size={42} color={M.success} />
          Metni AI yazar; videodaki her sayı kaynağında birebir geçmek zorunda.
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ───────────── 26-32 sn: kapanis ───────────── */

const PLAN_LINE: Array<[string, number]> = [
  // apps/api/src/billing/plans.ts VIDEOS_PER_MONTH (pro 20, agency 60, enterprise 200)
  ['Profesyonel', 20],
  ['Ajans', 60],
  ['Kurumsal', 200],
];

function End({ frame }: { frame: number }) {
  const [s] = TL.scene('end');
  if (frame < s) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 6);
  const plan = appear(frame, TL.at('end.plan'));
  const cta = snap(frame, TL.at('end.cta'));
  const url = appear(frame, TL.at('end.url'));
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 175 }}>
      <div style={{ transform: `scale(${tile})` }}>
        <LogoMark size={150} />
      </div>
      <div style={{ marginTop: 44, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 24}px)` }}>
        <VideoLockup size={112} />
      </div>
      <div style={{ marginTop: 50, opacity: plan.opacity, transform: `translateY(${(1 - plan.p) * 20}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 40, letterSpacing: '-0.02em', color: M.inkSoft }}>Profesyonel ve üstü planlarda</div>
        <div style={{ display: 'flex', gap: 14 }}>
          {PLAN_LINE.map(([name, n]) => (
            <Chip key={name} color={M.inkSoft} bg={M.paper} size={28} style={{ border: `1.5px solid ${M.hair}` }}>
              {name} · ayda <b style={{ color: brand[700] }}>{n}</b> video
            </Chip>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 56, display: 'flex', alignItems: 'center', gap: 40 }}>
        <div style={{ opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
          <CtaButton size={50}>
            Hemen dene <ArrowRight size={48} strokeWidth={2.8} />
          </CtaButton>
        </div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 64, letterSpacing: '-0.035em', opacity: url.opacity, transform: `translateX(${(1 - url.p) * -20}px)` }}>ranksup.ai</div>
      </div>
    </AbsoluteFill>
  );
}
