import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import {
  ArrowRight,
  BarChart3,
  Check,
  CircleAlert,
  FastForward,
  FileText,
  House,
  Loader2,
  Lock,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-react';
import { alpha, brand, light, logo } from '../tokens';
import { LogoMark, Wordmark } from '../ui';
import {
  Chip,
  CtaButton,
  Cursor,
  ENGINES,
  M,
  SAMPLE_RESULT,
  SampleTag,
  Soundtrack,
  Stage,
  clamp01,
  fontDisplay,
  fontMono,
  fontUI,
  keyed,
  mentionMeta,
  ramp,
  snap,
  soft,
  useBrandFonts,
} from './kit';
import type { MarketingProps } from './ProductIntro';
import { timeline, typedCount } from './timeline';

/**
 * FeatureExplainer — 1920×1080, 72 sn, "canli ekran kaydi" uslubunda panel turu.
 *
 * Panel yeniden CIZILIR (ekran goruntusu yok); menu adlari apps/web/src/lib/site-nav.ts ile ayni.
 * Imlec = kullanici. Kamera ekran kaydi yazilimi gibi imlece / ilgili ogeye yaklasir (zoom ≥ 1).
 * Altyazilar timeline.json "captions" (her biri ≥ 1.8 sn). Ornek veriler "Örnek ekran" etiketli.
 */

const TL = timeline('FeatureExplainer');
export const FEATURE_EXPLAINER_DURATION = TL.durationInFrames;

/* ───────────── yerlesim ───────────── */

const WIN = { x: 140, y: 70, w: 1640, h: 860 };
const BAR = 50;
const SIDE = 280;
const MAIN = { x: WIN.x + SIDE, y: WIN.y + BAR, w: WIN.w - SIDE, h: WIN.h - BAR };
const CX = MAIN.x + 44;
const CY = MAIN.y + 44;
const CW = MAIN.w - 88;

type NavItem = { key: string; label: string; icon: React.ReactNode; group?: string };
const NAV: NavItem[] = [
  { key: 'overview', label: 'Genel Bakış', icon: <House size={22} /> },
  { key: 'audit', label: 'Site Skoru', icon: <ShieldCheck size={22} />, group: 'Sağlık' },
  { key: 'visibility', label: 'AI Görünürlük', icon: <Sparkles size={22} />, group: 'AI Görünürlük' },
  { key: 'articles', label: 'İçerikler', icon: <FileText size={22} />, group: 'İçerik' },
  { key: 'targets', label: 'Yayın Hedefleri', icon: <Send size={22} /> },
  { key: 'analytics', label: 'Analitik', icon: <BarChart3 size={22} />, group: 'Büyüme' },
  { key: 'aso', label: 'ASO', icon: <Smartphone size={22} />, group: 'Mobil Uygulama' },
  { key: 'autopilot', label: 'Otomatik Akış', icon: <Zap size={22} />, group: 'Yönetim' },
  { key: 'connections', label: 'Bağlantılar', icon: <Plug size={22} /> },
];
const NAV_Y: Record<string, number> = {};
{
  let y = MAIN.y + 104;
  for (const n of NAV) {
    if (n.group) y += 34;
    NAV_Y[n.key] = y + 22;
    y += 46;
  }
}
const navPoint = (key: string): [number, number] => [WIN.x + 120, NAV_Y[key]];

/* önemli hedef noktalari (ekran koordinati, kamera oncesi) */
const P = {
  addSite: [MAIN.x + MAIN.w / 2, MAIN.y + 470] as [number, number],
  modal: { x: MAIN.x + 300, y: MAIN.y + 170, w: 760, h: 340 },
  field: [MAIN.x + 300 + 300, MAIN.y + 170 + 162] as [number, number],
  start: [MAIN.x + 300 + 640, MAIN.y + 170 + 270] as [number, number],
  preview: [CX + CW - 82, CY + 90 + 2 * 70 + 31] as [number, number],
  approve: [MAIN.x + MAIN.w - 150, MAIN.y + MAIN.h - 58] as [number, number],
  chip1: [CX + 85, CY + 250] as [number, number],
  publish: [MAIN.x + MAIN.w - 140, MAIN.y + MAIN.h - 58] as [number, number],
  retest: [CX + CW - 115, CY + 30] as [number, number],
  weekly: [CX + CW - 340, CY + 30] as [number, number],
  legend: [CX + 500 + 386, CY + 650] as [number, number],
  gsc: [CX + 620 - 100, CY + 300] as [number, number],
};

/* ───────────── kompozisyon ───────────── */

export const FeatureExplainer: React.FC<MarketingProps> = ({ muted = false }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const [endS] = TL.scene('end');

  // kamera: [kare, zoom, odakX, odakY] — odak noktasi ekranda (960, 500)'e gelir
  const cam: Array<[number, number, number, number]> = [
    [0, 1, 960, 500],
    [160, 1, 960, 500],
    [178, 1.38, P.field[0], P.field[1] - 10],
    [206, 1.38, P.field[0] + 40, P.field[1] - 10],
    [236, 1, 960, 500],
    [512, 1, 960, 500],
    [540, 1.1, CX + 836, CY + 360],
    [632, 1.1, CX + 836, CY + 360],
    [664, 1.32, P.preview[0] - 160, P.preview[1] + 40],
    [690, 1, 960, 500],
    [812, 1, 960, 500],
    [838, 1.18, CX + 640, CY + 690],
    [880, 1.18, CX + 640, CY + 690],
    [904, 1, 960, 500],
    [1230, 1.06, 960, 480],
    [1318, 1, 960, 500],
    [1392, 1, 960, 500],
    [1420, 1.1, CX + 886, CY + 380],
    [1505, 1.1, CX + 886, CY + 380],
    [1530, 1.22, P.legend[0], P.legend[1] - 40],
    [1580, 1.22, P.legend[0], P.legend[1] - 40],
    [1604, 1.75, P.weekly[0] + 80, P.weekly[1] + 70],
    [1700, 1.75, P.weekly[0] + 80, P.weekly[1] + 70],
    [1730, 1, 960, 500],
    [1862, 1, 960, 500],
    [1884, 1.14, CX + 560, CY + 380],
    [1950, 1.14, CX + 560, CY + 380],
    [1972, 1, 960, 500],
  ];
  const z = keyed(frame, cam.map(([f, zz]) => [f, zz] as [number, number]));
  const fx = keyed(frame, cam.map(([f, , x]) => [f, x] as [number, number]));
  const fy = keyed(frame, cam.map(([f, , , y]) => [f, y] as [number, number]));

  // pencere girisi ve kapanista logo karosuna cokme
  const winIn = soft(frame, -4);
  const collapse = ramp(frame, endS - 10, endS + 6, Easing.bezier(0.45, 0, 0.15, 1));
  const tile = { x: 880, y: 170, w: 160, h: 160 };
  const r = {
    x: WIN.x + (tile.x - WIN.x) * collapse,
    y: WIN.y + (tile.y - WIN.y) * collapse,
    w: WIN.w + (tile.w - WIN.w) * collapse,
    h: WIN.h + (tile.h - WIN.h) * collapse,
  };
  const contentFade = 1 - ramp(frame, endS - 12, endS - 4);
  const spot = Math.min(ramp(frame, 1596, 1612), 1 - ramp(frame, 1700, 1724));

  return (
    <Stage grid={false}>
      <Soundtrack tl={TL} muted={muted} />
      <AbsoluteFill style={{ transform: `translate(${960 - fx * z}px, ${500 - fy * z}px) scale(${z})`, transformOrigin: '0 0' }}>
        {/* pencere */}
        <div
          style={{
            position: 'absolute',
            left: r.x,
            top: r.y,
            width: r.w,
            height: r.h,
            borderRadius: 22 + 24 * collapse,
            background: M.paper,
            overflow: 'hidden',
            boxShadow: `0 40px 100px ${alpha(M.ink, 0.16)}, 0 8px 24px ${alpha(M.ink, 0.06)}`,
            border: `1px solid ${alpha(M.ink, 0.08)}`,
            opacity: clamp01(winIn * 1.4),
            transform: `translateY(${(1 - winIn) * 80}px) scale(${0.94 + 0.06 * winIn})`,
          }}
        >
          <div style={{ position: 'absolute', inset: 0, background: M.grad, opacity: ramp(frame, endS - 6, endS + 2) }} />
          {collapse > 0.5 ? (
            <svg width={r.w} height={r.h} style={{ position: 'absolute', inset: 0, opacity: ramp(frame, endS - 2, endS + 4) }} viewBox={`0 0 ${r.w} ${r.h}`}>
              <g transform={`translate(${r.w / 2 - 30},${r.h / 2 - 30}) scale(0.6)`} fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round">
                <path d="M28 72 L72 28" />
                <path d="M40 26 L74 26 L74 60" strokeLinejoin="round" />
              </g>
            </svg>
          ) : null}
        </div>
        {frame < endS ? (
          <div style={{ position: 'absolute', inset: 0, opacity: contentFade * clamp01(winIn * 1.4), transform: `translateY(${(1 - winIn) * 80}px)` }}>
            <TitleBar frame={frame} />
            <Sidebar frame={frame} />
            <Pages frame={frame} />
            <ExplainerCursor frame={frame} />
          </div>
        ) : null}
      </AbsoluteFill>

      {spot > 0 ? <AbsoluteFill style={{ background: `radial-gradient(ellipse 34% 30% at 43% 35%, transparent 40%, ${alpha(M.ink, 0.45)} 100%)`, opacity: spot }} /> : null}
      <ChapterPill frame={frame} />
      <Captions frame={frame} />
      <EndCard frame={frame} />
    </Stage>
  );
};

/* ───────────── pencere kabugu ───────────── */

function TitleBar({ frame }: { frame: number }) {
  const hasSite = frame >= TL.at('site.go') + 12;
  return (
    <div style={{ position: 'absolute', left: WIN.x, top: WIN.y, width: WIN.w, height: BAR, display: 'flex', alignItems: 'center', padding: '0 20px', boxSizing: 'border-box', borderBottom: `1px solid ${M.hair}`, background: M.cream, borderRadius: '22px 22px 0 0' }}>
      <LogoMark size={28} />
      <span style={{ marginLeft: 12, fontFamily: fontDisplay, fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em' }}>RanksUp</span>
      <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: fontUI, fontWeight: 600, fontSize: 18, color: M.muted, pointerEvents: 'none' }}>
        {hasSite ? 'ornekklinik.com · Panel' : 'Panel'}
      </span>
      <span style={{ marginLeft: 'auto' }}>
        <SampleTag size={15} />
      </span>
    </div>
  );
}

function activeNav(frame: number): string | null {
  if (frame >= TL.at('conn.aso')) return 'aso';
  if (frame >= TL.scene('connect')[0]) return 'connections';
  if (frame >= TL.at('vis.nav')) return 'visibility';
  if (frame >= TL.at('content.nav')) return 'articles';
  if (frame >= TL.at('audit.nav')) return 'audit';
  if (frame >= TL.at('site.go') + 12) return 'overview';
  return null;
}

function Sidebar({ frame }: { frame: number }) {
  const active = activeNav(frame);
  const hasSite = frame >= TL.at('site.go') + 12;
  return (
    <div style={{ position: 'absolute', left: WIN.x, top: MAIN.y, width: SIDE, height: MAIN.h, borderRight: `1px solid ${M.hair}`, background: M.cream, borderRadius: '0 0 0 22px' }}>
      <div style={{ margin: '18px 16px 0', height: 58, borderRadius: 14, border: `1px solid ${M.hair}`, background: M.paper, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: hasSite ? alpha(brand[500], 0.16) : M.fill, display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 15, color: brand[700] }}>{hasSite ? 'Ö' : ''}</span>
        <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 18, color: hasSite ? M.ink : M.muted }}>{hasSite ? 'ornekklinik.com' : 'Site seç'}</span>
      </div>
      {NAV.map((n) => {
        const y = NAV_Y[n.key] - MAIN.y;
        const on = active === n.key;
        return (
          <React.Fragment key={n.key}>
            {n.group ? (
              <div style={{ position: 'absolute', left: 28, top: y - 22 - 30, fontFamily: fontUI, fontWeight: 700, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: M.muted }}>{n.group}</div>
            ) : null}
            <div
              style={{
                position: 'absolute',
                left: 14,
                right: 14,
                top: y - 21,
                height: 42,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 14px',
                background: on ? alpha(brand[500], 0.12) : 'transparent',
                color: on ? brand[800] : hasSite ? M.inkSoft : alpha(M.ink, 0.35),
                fontFamily: fontUI,
                fontWeight: on ? 800 : 600,
                fontSize: 18,
              }}
            >
              <span style={{ color: on ? brand[600] : 'inherit', display: 'flex' }}>{n.icon}</span>
              {n.label}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ───────────── sayfalar ───────────── */

function PageHeader({ title, hint, right }: { title: string; hint: string; right?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: CX, top: CY, width: CW, display: 'flex', alignItems: 'center' }}>
      <div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 36, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 19, color: M.muted, marginTop: 6 }}>{hint}</div>
      </div>
      {right ? <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>{right}</div> : null}
    </div>
  );
}

/** sayfa gorunurlugu: [baslangic, bitis) arasinda, kenarlarda 8 karelik bulanik gecis */
function pageVis(frame: number, from: number, to: number) {
  const v = Math.min(ramp(frame, from, from + 8), 1 - ramp(frame, to - 8, to));
  return { v, style: { position: 'absolute', inset: 0, opacity: v, filter: v < 1 ? `blur(${(1 - v) * 6}px)` : undefined } as React.CSSProperties };
}

function Pages({ frame }: { frame: number }) {
  const go = TL.at('site.go');
  return (
    <>
      <EmptyPage frame={frame} to={go + 10} />
      <OnboardingPage frame={frame} from={go + 10} to={TL.at('audit.nav') + 2} />
      <AuditPage frame={frame} from={TL.at('audit.nav') + 2} to={TL.at('content.nav') + 2} />
      <ContentPage frame={frame} from={TL.at('content.nav') + 2} to={TL.at('vis.nav') + 2} />
      <VisibilityPage frame={frame} from={TL.at('vis.nav') + 2} to={TL.scene('connect')[0] + 4} />
      <ConnectionsPage frame={frame} from={TL.scene('connect')[0] + 4} to={TL.at('conn.aso') + 2} />
      <AsoPage frame={frame} from={TL.at('conn.aso') + 2} to={TL.scene('end')[0] + 2} />
    </>
  );
}

/* Giris: bos durum + site ekleme penceresi */
function EmptyPage({ frame, to }: { frame: number; to: number }) {
  const { v, style } = pageVis(frame, -10, to);
  if (v <= 0) return null;
  const title = snap(frame, TL.at('intro.title'));
  const click = TL.at('site.click');
  const modalP = snap(frame, TL.at('site.modal'));
  const showModal = frame >= TL.at('site.modal') - 4;
  const typed = typedCount(frame, TL, 'site.type', 'ornekklinik.com'.length);
  const go = TL.at('site.go');
  const btnPress = frame >= click && frame < click + 6 ? 0.95 : 1;
  const goPress = frame >= go && frame < go + 6 ? 0.95 : 1;
  return (
    <div style={style}>
      <div style={{ position: 'absolute', left: MAIN.x, top: MAIN.y + 190, width: MAIN.w, textAlign: 'center', opacity: clamp01(title * 1.5), transform: `translateY(${(1 - title) * 20}px)` }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 64, letterSpacing: '-0.035em' }}>İlk siteni ekle</div>
        <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 26, color: M.body, marginTop: 14 }}>Adresini yapıştırman yeterli; tarama ve analiz kendiliğinden başlar.</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: P.addSite[0] - 150,
          top: P.addSite[1] - 40,
          width: 300,
          height: 80,
          borderRadius: 20,
          background: M.grad,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: 28,
          opacity: clamp01(title * 1.5),
          transform: `scale(${btnPress})`,
          boxShadow: `0 16px 40px ${alpha(logo.gradTo, 0.28)}`,
        }}
      >
        <Plus size={30} strokeWidth={3} /> Site ekle
      </div>
      {showModal ? (
        <>
          <div style={{ position: 'absolute', left: MAIN.x, top: MAIN.y, width: MAIN.w, height: MAIN.h, background: alpha(M.ink, 0.22 * clamp01(modalP)), borderRadius: '0 0 22px 0' }} />
          <div
            style={{
              position: 'absolute',
              left: P.modal.x,
              top: P.modal.y,
              width: P.modal.w,
              height: P.modal.h,
              borderRadius: 26,
              background: M.paper,
              boxShadow: `0 30px 80px ${alpha(M.ink, 0.25)}`,
              padding: 40,
              boxSizing: 'border-box',
              opacity: clamp01(modalP * 1.5),
              transform: `scale(${0.9 + 0.1 * modalP})`,
            }}
          >
            <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 32 }}>Site ekle</div>
            <div style={{ fontFamily: fontUI, fontSize: 19, color: M.muted, marginTop: 6 }}>Sitenin adresi</div>
            <div style={{ marginTop: 16, height: 76, borderRadius: 16, border: `2.5px solid ${alpha(brand[500], 0.55)}`, boxShadow: `0 0 0 5px ${alpha(brand[500], 0.1)}`, display: 'flex', alignItems: 'center', padding: '0 22px', fontFamily: fontMono, fontWeight: 600, fontSize: 32 }}>
              <span style={{ color: typed ? M.ink : M.muted }}>{typed ? 'ornekklinik.com'.slice(0, typed) : 'siteadresin.com'}</span>
              {frame < go ? <span style={{ display: 'inline-block', width: 3, height: 34, marginLeft: 3, background: brand[500], opacity: Math.floor(frame / 8) % 2 ? 0.2 : 1 }} /> : null}
            </div>
            <div style={{ position: 'absolute', right: 40, bottom: 34, height: 64, padding: '0 34px', borderRadius: 16, background: M.grad, color: 'white', display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, transform: `scale(${goPress})` }}>
              {frame >= go ? <Loader2 size={24} style={{ transform: `rotate(${frame * 14}deg)` }} /> : null}
              Başlat
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StepRow({ frame, label, sub, start, done }: { frame: number; label: string; sub: string; start: number; done: number }) {
  const running = frame >= start && frame < done;
  const ok = frame >= done;
  const p = snap(frame, done);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, height: 104, padding: '0 26px', borderRadius: 20, border: `1.5px solid ${ok ? alpha(M.success, 0.35) : running ? alpha(brand[500], 0.4) : M.hair}`, background: ok ? alpha(M.success, 0.05) : M.paper, opacity: frame >= start - 6 ? 1 : 0.45 }}>
      <span style={{ width: 52, height: 52, borderRadius: 99, display: 'grid', placeItems: 'center', background: ok ? alpha(M.success, 0.14) : alpha(brand[500], 0.1), color: ok ? M.success : brand[600] }}>
        {ok ? <Check size={30} strokeWidth={3} style={{ transform: `scale(${0.6 + 0.4 * p})` }} /> : running ? <Loader2 size={30} style={{ transform: `rotate(${frame * 12}deg)` }} /> : null}
      </span>
      <div>
        <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 26 }}>{label}</div>
        <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 19, color: M.muted, marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

function OnboardingPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const s1 = TL.at('site.s1');
  const s2 = TL.at('site.s2');
  const s3 = TL.at('site.s3');
  const brain = TL.at('site.brain');
  const done = snap(frame, TL.at('site.done'));
  const BRAIN: Array<[string, string]> = [
    ['Sektör', 'Diş kliniği · İstanbul'],
    ['Marka sesi', 'Güven veren, sade'],
    ['Persona', 'Kadıköy’de yaşayan yetişkinler'],
    ['Rakipler', 'Klinik A · Klinik B · Klinik C'],
    ['Hedef sorular', 'diş taşı · implant · beyazlatma'],
  ];
  return (
    <div style={style}>
      <PageHeader title="Kurulum" hint="ornekklinik.com · ilk tarama ve analiz" />
      <div style={{ position: 'absolute', left: CX, top: CY + 96, width: 600, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StepRow frame={frame} label="Site taranıyor" sub="Sayfalar ve içerik okunuyor" start={from} done={s1} />
        <StepRow frame={frame} label="Marka beyni" sub="Ton, persona, rakipler, hedef sorular" start={s1} done={s2} />
        <StepRow frame={frame} label="Denetim, ilk ölçüm, takvim" sub="Site Skoru · AI görünürlük · konu takvimi" start={s2} done={s3} />
      </div>
      <div style={{ position: 'absolute', left: CX + 640, top: CY + 96, width: CW - 640, height: 344, borderRadius: 22, border: `1.5px solid ${alpha(brand[500], 0.3)}`, background: alpha(brand[500], 0.03), padding: 26, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 24 }}>
          <Sparkles size={24} color={brand[600]} /> Marka beyni
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
          {BRAIN.map(([k, val], i) => {
            const p = snap(frame, brain + i * 6);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: clamp01(p * 1.5), transform: `translateX(${(1 - p) * 20}px)` }}>
                <span style={{ width: 150, fontFamily: fontUI, fontWeight: 600, fontSize: 18, color: M.muted }}>{k}</span>
                <Chip color={brand[800]} size={19}>
                  {val}
                </Chip>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: CX, top: CY + 480, width: CW, height: 76, borderRadius: 18, background: alpha(M.success, 0.1), color: M.success, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px', boxSizing: 'border-box', fontFamily: fontUI, fontWeight: 800, fontSize: 24, opacity: clamp01(done * 1.5), transform: `translateY(${(1 - done) * 20}px)` }}>
        <Check size={28} strokeWidth={3} /> Kurulum tamam — ilk makale hazırlanıyor
      </div>
    </div>
  );
}

const GEO_ROWS: Array<{ id: string; name: string; ok: boolean; note: string }> = [
  { id: 'audit.r1', name: 'JSON-LD şema', ok: true, note: 'Var' },
  { id: 'audit.r2', name: 'Başlık hiyerarşisi', ok: true, note: 'Düzenli' },
  { id: 'audit.r3', name: 'llms.txt', ok: false, note: 'Eksik' },
  { id: 'audit.r4', name: 'OG / canonical', ok: true, note: 'Var' },
  { id: 'audit.r5', name: 'SSS / soru-cevap', ok: false, note: 'Zayıf' },
  { id: 'audit.r6', name: 'Tanım yoğunluğu', ok: true, note: 'İyi' },
  { id: 'audit.r7', name: 'Tazelik', ok: true, note: 'İyi' },
  { id: 'audit.r8', name: 'Alıntı biçimi', ok: true, note: 'İyi' },
];

const LLMS_LINES = [
  '# Örnek Diş Kliniği',
  '> Kadıköy’de diş kliniği: tedaviler, randevu, SSS.',
  '',
  '## Sayfalar',
  '- [Tedaviler](https://ornekklinik.com/tedaviler)',
  '- [Blog](https://ornekklinik.com/blog)',
];

function AuditPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const ringP = ramp(frame, from + 6, TL.at('audit.r8') + 8, Easing.inOut(Easing.quad)) * 0.72;
  const grade = snap(frame, TL.at('audit.r8') + 10);
  const drawerIn = ramp(frame, TL.at('audit.drawer') - 4, TL.at('audit.drawer') + 8, Easing.out(Easing.cubic));
  const drawerOut = ramp(frame, TL.at('audit.ok') + 8, TL.at('audit.ok') + 22, Easing.in(Easing.cubic));
  const drawer = drawerIn * (1 - drawerOut);
  const fixed = frame >= TL.at('audit.ok') + 14;
  const linesStart = TL.at('audit.lines');
  const lineEvery = (TL.event('audit.lines').every ?? 0.5) * 15;
  const preview = TL.at('audit.preview');
  const approve = TL.at('audit.approve');
  const note = snap(frame, TL.scene('audit')[1] - 100);
  const R = 120;
  const circ = 2 * Math.PI * R;
  return (
    <div style={style}>
      <PageHeader
        title="Site Skoru"
        hint="SEO + GEO kontrolleri"
        right={
          <div style={{ display: 'flex', gap: 6, padding: 5, borderRadius: 14, background: M.fill }}>
            {['SEO', 'GEO'].map((t) => (
              <span key={t} style={{ padding: '8px 20px', borderRadius: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 18, background: t === 'GEO' ? M.paper : 'transparent', color: t === 'GEO' ? M.ink : M.muted, boxShadow: t === 'GEO' ? `0 2px 6px ${alpha(M.ink, 0.08)}` : 'none' }}>
                {t}
              </span>
            ))}
          </div>
        }
      />
      <div style={{ position: 'absolute', left: CX, top: CY + 90, width: 360, height: 560, borderRadius: 22, border: `1.5px solid ${M.hair}`, background: M.cream, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ position: 'relative', width: 280, height: 280 }}>
          <svg width={280} height={280} style={{ position: 'absolute', inset: 0 }}>
            <circle cx={140} cy={140} r={R} fill="none" stroke={alpha(M.ink, 0.07)} strokeWidth={18} />
            <circle cx={140} cy={140} r={R} fill="none" stroke={brand[500]} strokeWidth={18} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - ringP)} transform="rotate(-90 140 140)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 128, letterSpacing: '-0.05em', opacity: clamp01(grade * 1.5), transform: `scale(${0.7 + 0.3 * grade})` }}>B</span>
          </div>
        </div>
        <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 24 }}>GEO notu</div>
        <SampleTag size={15} label="Örnek rapor" />
      </div>
      <div style={{ position: 'absolute', left: CX + 400, top: CY + 90, width: CW - 400, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GEO_ROWS.map((row, i) => {
          const p = snap(frame, TL.at(row.id));
          const ok = row.ok || (i === 2 && fixed);
          const col = ok ? M.success : M.warn;
          const note = i === 2 && fixed ? 'Yüklendi' : row.note;
          return (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 62, padding: '0 20px', borderRadius: 16, border: `1.5px solid ${ok ? M.hair : alpha(M.warn, 0.35)}`, background: ok ? M.paper : alpha(M.warn, 0.05), opacity: clamp01(p * 1.5), transform: `translateX(${(1 - p) * 30}px)` }}>
              <span style={{ width: 36, height: 36, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(col, 0.12), color: col }}>{ok ? <Check size={22} strokeWidth={3} /> : <CircleAlert size={22} />}</span>
              <span style={{ fontFamily: row.name.includes('.txt') ? fontMono : fontUI, fontWeight: 700, fontSize: 22 }}>{row.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 700, fontSize: 19, color: col }}>{note}</span>
              {i === 2 && !fixed ? (
                <span style={{ marginLeft: 8, padding: '8px 18px', borderRadius: 10, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 17, transform: `scale(${frame >= preview && frame < preview + 6 ? 0.94 : 1})` }}>Önizle</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: CX, top: CY + 676, width: CW, height: 62, borderRadius: 16, background: M.fill, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', boxSizing: 'border-box', fontFamily: fontUI, fontWeight: 700, fontSize: 21, color: M.inkSoft, opacity: clamp01(note * 1.4) }}>
        <Lock size={22} color={brand[600]} /> robots.txt değişikliği yalnız sen önizleyip onayladığında yazılır.
      </div>
      {drawer > 0 ? (
        <div style={{ position: 'absolute', left: MAIN.x + MAIN.w - 620 + (1 - drawer) * 640, top: MAIN.y, width: 620, height: MAIN.h, background: M.paper, borderLeft: `1px solid ${M.hair}`, boxShadow: `-30px 0 60px ${alpha(M.ink, 0.12)}`, padding: 32, boxSizing: 'border-box', borderRadius: '0 0 22px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: fontMono, fontWeight: 700, fontSize: 26 }}>llms.txt</span>
            <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 22 }}>önizleme</span>
            <Chip color={brand[700]} size={16} style={{ marginLeft: 'auto' }}>
              Yeni dosya
            </Chip>
          </div>
          <div style={{ marginTop: 22, height: 330, borderRadius: 16, background: '#1C1411', padding: 24, boxSizing: 'border-box', fontFamily: fontMono, fontSize: 18, lineHeight: 1.7, color: '#F3E9E2' }}>
            {LLMS_LINES.map((l, i) => {
              const at = linesStart + i * lineEvery;
              return (
                <div key={i} style={{ opacity: ramp(frame, at, at + 4), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: l.startsWith('#') ? '#FDBA74' : l.startsWith('>') ? '#D6C5BA' : '#F3E9E2' }}>
                  <span style={{ color: alpha('#F3E9E2', 0.35), marginRight: 14 }}>{String(i + 1).padStart(2, ' ')}</span>
                  {l || ' '}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 600, fontSize: 18, color: M.body, lineHeight: 1.4 }}>
            <Send size={18} color={brand[600]} /> Onaylarsan FTP / SFTP / cPanel yayın hedefine yüklenir.
          </div>
          <div style={{ position: 'absolute', left: 32, right: 32, bottom: 26, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <span style={{ height: 60, padding: '0 26px', borderRadius: 14, border: `1.5px solid ${M.hairStrong}`, display: 'flex', alignItems: 'center', fontFamily: fontUI, fontWeight: 700, fontSize: 20, color: M.body }}>Vazgeç</span>
            <span style={{ height: 60, padding: '0 28px', borderRadius: 14, background: frame >= TL.at('audit.ok') ? M.success : M.grad, color: 'white', display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 20, transform: `scale(${frame >= approve && frame < approve + 6 ? 0.95 : 1})` }}>
              {frame >= TL.at('audit.ok') ? <Check size={22} strokeWidth={3} /> : null}
              {frame >= TL.at('audit.ok') ? 'Yüklendi' : 'Onayla ve yükle'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const TOPICS = ['Diş taşı temizliği ne sıklıkla yapılmalı?', 'İmplant mı köprü mü?', 'Diş beyazlatma güvenli mi?', 'Çocuklarda ilk diş muayenesi', 'Diş eti kanaması neden olur?', 'Kanal tedavisi kaç seans sürer?'];
const PIPE = ['Anahtar kelime', 'Taslak', 'Yazar', 'Editör', 'Görsel'];
const TARGETS = ['WordPress', 'FTP / SFTP', 'cPanel', 'Ghost', 'Webflow', 'GitHub'];

function ContentPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const snapAt = TL.at('content.snap');
  const colW = (CW - 6 * 14) / 7;
  const panelIn = ramp(frame, TL.at('content.panel') - 4, TL.at('content.panel') + 8, Easing.out(Easing.cubic));
  const panelOut = ramp(frame, TL.at('content.done') + 22, TL.at('content.done') + 36, Easing.in(Easing.cubic));
  const panel = panelIn * (1 - panelOut);
  const published = frame >= TL.at('content.done');
  const locks = snap(frame, TL.at('content.done') + 40);
  const pAt = ['content.p1', 'content.p2', 'content.p3', 'content.p4', 'content.p5'].map((id) => TL.at(id));
  const gate = snap(frame, TL.at('content.gate'));
  const toast = snap(frame, TL.at('content.done'));
  const fast = frame >= pAt[0] - 8 && frame < TL.at('content.gate');
  const lines = ramp(frame, pAt[1], pAt[4] + 8, Easing.linear);
  const pub = TL.at('content.publish');
  const sending = frame >= TL.at('content.send') && frame < TL.at('content.done');
  return (
    <div style={style}>
      <PageHeader
        title="İçerikler"
        hint="Önerilen konular + üretilen yazılar"
        right={
          <Chip color={brand[700]} size={18}>
            <Zap size={18} /> Otomatik akış: açık
          </Chip>
        }
      />
      <div style={{ position: 'absolute', left: CX, top: CY + 96, width: CW, display: 'flex', gap: 14 }}>
        {DAYS.map((d, i) => (
          <div key={d} style={{ width: colW, height: 300, borderRadius: 18, border: `1.5px solid ${M.hair}`, background: i % 7 > 4 ? M.cream : M.paper, padding: 12, boxSizing: 'border-box' }}>
            <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 18, color: M.muted }}>{d}</div>
          </div>
        ))}
      </div>
      {TOPICS.map((t, i) => {
        const p = snap(frame, snapAt, 30, 6);
        const tx = CX + i * (colW + 14) + 12;
        const ty = CY + 96 + 48;
        // sag ustteki "Otomatik akış" cipinden kendi gunune egri yolla
        const sx = CX + CW - 120;
        const sy = CY + 10;
        const k = clamp01(p);
        const x = sx + (tx - sx) * k;
        const y = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 60;
        const locked = i >= 2;
        const state = i === 0 ? (published ? 'live' : frame >= TL.at('content.open') ? 'writing' : 'plan') : 'plan';
        const tint = state === 'live' ? M.success : brand[600];
        return (
          <div
            key={t}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: colW - 24,
              height: 150,
              borderRadius: 14,
              background: state === 'live' ? alpha(M.success, 0.08) : alpha(brand[500], 0.07),
              border: `1.5px solid ${alpha(tint, i === 0 && frame >= TL.at('content.open') - 10 ? 0.6 : 0.25)}`,
              padding: 12,
              boxSizing: 'border-box',
              opacity: clamp01(k * 2) * (locked ? 1 - 0.45 * locks : 1),
              transform: `scale(${0.6 + 0.4 * k})`,
            }}
          >
            <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 17, lineHeight: 1.3, color: M.ink, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{t}</div>
            <div style={{ position: 'absolute', left: 12, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontFamily: fontUI, fontWeight: 800, fontSize: 14, color: locked && locks > 0.5 ? M.muted : tint }}>
              {locked && locks > 0.5 ? <Lock size={14} /> : state === 'live' ? <Check size={15} strokeWidth={3} /> : null}
              {locked && locks > 0.5 ? 'Planla açılır' : state === 'live' ? 'Yayında' : state === 'writing' ? 'Yazılıyor' : 'Planlandı'}
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: CX, top: CY + 420, width: CW, height: 64, borderRadius: 16, background: M.fill, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', boxSizing: 'border-box', fontFamily: fontUI, fontWeight: 700, fontSize: 20, color: M.inkSoft, opacity: clamp01(locks * 1.4) }}>
        <Lock size={20} color={brand[600]} /> Ücretsiz deneme: toplam 2 makale · kalan konular planını yükselttiğinde yazılır
      </div>

      {panel > 0 ? (
        <div style={{ position: 'absolute', left: MAIN.x + MAIN.w - 880 + (1 - panel) * 900, top: MAIN.y, width: 880, height: MAIN.h, background: M.paper, borderLeft: `1px solid ${M.hair}`, boxShadow: `-30px 0 60px ${alpha(M.ink, 0.12)}`, padding: 34, boxSizing: 'border-box', borderRadius: '0 0 22px 0' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 30, lineHeight: 1.2, letterSpacing: '-0.02em', maxWidth: 560 }}>{TOPICS[0]}</div>
            {fast ? (
              <Chip color={M.inkSoft} size={16} bg={alpha(M.ink, 0.07)} style={{ marginLeft: 'auto', opacity: Math.floor(frame / 10) % 2 ? 0.55 : 1 }}>
                <FastForward size={16} /> hızlandırıldı
              </Chip>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 30, marginTop: 26 }}>
            <div style={{ width: 250, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {PIPE.map((s, i) => {
                const ok = frame >= pAt[i];
                const run = !ok && frame >= (i === 0 ? pAt[0] - 14 : pAt[i - 1]);
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 50, padding: '0 14px', borderRadius: 12, background: ok ? alpha(M.success, 0.08) : run ? alpha(brand[500], 0.08) : M.cream, color: ok ? M.success : run ? brand[700] : M.muted, fontFamily: fontUI, fontWeight: 800, fontSize: 19 }}>
                    {ok ? <Check size={20} strokeWidth={3} /> : run ? <Loader2 size={20} style={{ transform: `rotate(${frame * 12}deg)` }} /> : <span style={{ width: 20 }} />}
                    {i + 1}. {s}
                  </div>
                );
              })}
              <Chip color={M.success} size={18} style={{ marginTop: 6, alignSelf: 'flex-start', opacity: clamp01(gate * 1.5), transform: `scale(${0.8 + 0.2 * gate})` }}>
                <ShieldCheck size={18} /> Kalite kapısı: geçti
              </Chip>
            </div>
            <div style={{ flex: 1, borderRadius: 16, border: `1.5px solid ${M.hair}`, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, height: 380, boxSizing: 'border-box' }}>
              <div style={{ height: 120, borderRadius: 12, background: `linear-gradient(135deg, ${alpha(brand[300], 0.5)}, ${alpha(brand[100], 0.6)})`, opacity: ramp(frame, pAt[4] - 6, pAt[4] + 4) }} />
              {[0.96, 0.88, 0.93, 0.7, 0.9, 0.84, 0.6].map((w, i) => (
                <div key={i} style={{ height: 11, borderRadius: 99, background: i === 3 ? alpha(M.ink, 0.16) : alpha(M.ink, 0.08), width: `${w * 100 * clamp01(lines * 7 - i)}%` }} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 26, fontFamily: fontUI, fontWeight: 700, fontSize: 18, color: M.muted }}>Yayın hedefi</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', width: 560 }}>
            {TARGETS.map((t, i) => (
              <span key={t} style={{ height: 44, padding: '0 16px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontFamily: fontUI, fontWeight: 700, fontSize: 18, border: `1.5px solid ${i === 0 ? alpha(published ? M.success : brand[500], 0.55) : M.hair}`, background: i === 0 ? alpha(published ? M.success : brand[500], 0.07) : M.paper, color: i === 0 ? (published ? M.success : M.ink) : M.body }}>
                {i === 0 && published ? <Check size={18} strokeWidth={3} /> : null}
                {t}
              </span>
            ))}
          </div>
          <div style={{ position: 'absolute', right: 34, bottom: 30, width: 200, height: 64, borderRadius: 16, background: published ? M.success : M.grad, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, transform: `scale(${frame >= pub && frame < pub + 6 ? 0.95 : 1})` }}>
            {sending ? <Loader2 size={24} style={{ transform: `rotate(${frame * 14}deg)` }} /> : published ? <Check size={24} strokeWidth={3} /> : <Send size={22} />}
            {published ? 'Yayında' : 'Yayınla'}
          </div>
          <div style={{ position: 'absolute', left: 34, bottom: 34, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderRadius: 14, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 700, fontSize: 19, opacity: clamp01(toast * 1.5), transform: `translateY(${(1 - toast) * 16}px)` }}>
            <Check size={20} color="#7ee2a8" strokeWidth={3} /> Yayınlandı · WordPress
          </div>
        </div>
      ) : null}
    </div>
  );
}

const QUESTIONS = ['Kadıköy’de diş taşı temizliği nerede yaptırılır?', 'İmplant tedavisi için iyi bir klinik önerir misin?', 'Diş beyazlatma fiyatı neye göre değişir?'];

function VisibilityPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const test = TL.at('vis.test');
  const rowAt = ['vis.e1', 'vis.e2', 'vis.e3', 'vis.e4', 'vis.e5', 'vis.e6'].map((id) => TL.at(id));
  const legend = snap(frame, TL.at('vis.legend'));
  const clicked = frame >= test;
  return (
    <div style={style}>
      <PageHeader
        title="AI Görünürlük"
        hint="AI asistanlarda atıf takibi"
        right={
          <>
            <Chip color={brand[700]} size={18} style={{ height: 30 }}>
              <RefreshCw size={16} /> Haftada 1 ölçüm
            </Chip>
            <span style={{ height: 60, width: 220, borderRadius: 16, background: M.grad, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: fontDisplay, fontWeight: 700, fontSize: 22, transform: `scale(${frame >= test && frame < test + 6 ? 0.95 : 1})` }}>
              <RefreshCw size={22} style={{ transform: `rotate(${clicked && frame < rowAt[5] ? (frame - test) * 12 : 0}deg)` }} /> Yeniden Test
            </span>
          </>
        }
      />
      <div style={{ position: 'absolute', left: CX, top: CY + 96, width: 460, borderRadius: 20, border: `1.5px solid ${M.hair}`, background: M.cream, padding: 24, boxSizing: 'border-box' }}>
        <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 21 }}>Sorular</div>
        <div style={{ fontFamily: fontUI, fontWeight: 600, fontSize: 16, color: M.muted, marginTop: 4 }}>Marka beyninden · marka adı geçmez</div>
        {QUESTIONS.map((q) => (
          <div key={q} style={{ marginTop: 14, padding: '14px 16px', borderRadius: 14, background: M.paper, border: `1px solid ${M.hair}`, fontFamily: fontUI, fontWeight: 600, fontSize: 18, lineHeight: 1.35, color: M.inkSoft }}>
            “{q}”
          </div>
        ))}
        <SampleTag size={14} label="Örnek ölçüm" style={{ marginTop: 16 }} />
      </div>
      <div style={{ position: 'absolute', left: CX + 500, top: CY + 96, width: CW - 500, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ENGINES.map((e, i) => {
          const res = SAMPLE_RESULT[i];
          const meta = mentionMeta[res];
          const shown = frame >= rowAt[i];
          const p = snap(frame, rowAt[i]);
          const asking = clicked && !shown;
          return (
            <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 72, padding: '0 20px', borderRadius: 16, border: `1.5px solid ${M.hair}`, background: shown && res !== 'none' ? alpha(meta.color, 0.06) : M.paper }}>
              <span style={{ width: 140, fontFamily: fontUI, fontWeight: 800, fontSize: 22 }}>{e}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 99, background: alpha(M.ink, 0.07) }}>
                <div style={{ height: 10, borderRadius: 99, width: `${(shown ? Math.max(4, meta.score) : 0) * clamp01(p)}%`, background: res === 'none' ? alpha(M.ink, 0.2) : meta.color }} />
              </div>
              <span style={{ width: 190, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, fontFamily: fontUI, fontWeight: 700, fontSize: 19, color: shown ? meta.color : M.muted }}>
                {asking ? <Loader2 size={19} style={{ transform: `rotate(${frame * 12}deg)` }} /> : null}
                {shown ? meta.label : asking ? 'Soruluyor…' : 'Önceki ölçüm'}
              </span>
              <span style={{ width: 52, textAlign: 'right', fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, opacity: shown ? clamp01(p * 1.5) : 0 }}>{meta.score}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 10, height: 66, borderRadius: 16, display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px', background: alpha(brand[500], 0.08 * clamp01(legend)), border: `1.5px solid ${alpha(brand[500], 0.35 * clamp01(legend))}`, fontFamily: fontUI, fontWeight: 700, fontSize: 19, color: M.inkSoft, opacity: 0.35 + 0.65 * clamp01(legend) }}>
          <span style={{ fontWeight: 800 }}>Puanlama</span>
          <span style={{ color: M.success }}>URL alıntısı 100</span>
          <span style={{ color: brand[700] }}>Marka adı 50</span>
          <span style={{ color: M.muted }}>Geçmezse 0</span>
        </div>
      </div>
    </div>
  );
}

function ConnectionsPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const click = TL.at('conn.click');
  const ok = frame >= TL.at('conn.ok');
  const okP = snap(frame, TL.at('conn.ok'));
  const card = (title: string, body: string, icon: React.ReactNode, active: boolean, x: number) => (
    <div style={{ position: 'absolute', left: x, top: CY + 96, width: 600, height: 250, borderRadius: 22, border: `1.5px solid ${active && ok ? alpha(M.success, 0.4) : M.hair}`, background: active && ok ? alpha(M.success, 0.04) : M.paper, padding: 28, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: M.fill, display: 'grid', placeItems: 'center', color: M.inkSoft }}>{icon}</span>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 25 }}>{title}</span>
      </div>
      <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 19, color: M.body, marginTop: 16, lineHeight: 1.4, maxWidth: 520 }}>{body}</div>
      <div style={{ position: 'absolute', right: 28, bottom: 26, height: 56, padding: '0 28px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 8, fontFamily: fontUI, fontWeight: 800, fontSize: 20, background: active && ok ? alpha(M.success, 0.12) : active ? M.grad : M.fill, color: active && ok ? M.success : active ? 'white' : M.inkSoft, transform: `scale(${active && frame >= click && frame < click + 6 ? 0.95 : active && ok ? 1 + 0.05 * Math.sin(clamp01(okP) * Math.PI) : 1})` }}>
        {active && ok ? <Check size={22} strokeWidth={3} /> : active && frame >= click ? <Loader2 size={22} style={{ transform: `rotate(${frame * 14}deg)` }} /> : null}
        {active && ok ? 'Bağlandı' : 'Bağla'}
      </div>
    </div>
  );
  return (
    <div style={style}>
      <PageHeader title="Bağlantılar" hint="Search Console, GA4, AI anahtarları" />
      {card('Google Search Console', 'Konu seçimi ve makale iyileştirmeleri gerçek arama verisine dayanır.', <Search size={26} />, true, CX)}
      {card('Google Analytics 4', 'Ziyaret ve dönüşüm verisi raporlara eklenir.', <BarChart3 size={26} />, false, CX + 640)}
      <div style={{ position: 'absolute', left: CX, top: CY + 380, width: CW, borderRadius: 22, border: `1.5px solid ${M.hair}`, background: M.cream, padding: 28, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: fontUI, fontWeight: 800, fontSize: 23 }}>
          <Send size={24} color={brand[600]} /> Yayın hedefleri
          <span style={{ fontWeight: 600, fontSize: 18, color: M.muted }}>14 hedef arasından seç</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          {['WordPress', 'Webflow', 'Ghost', 'FTP / SFTP', 'cPanel', 'GitHub'].map((t, i) => (
            <Chip key={t} color={i === 0 ? M.success : M.inkSoft} size={19} bg={i === 0 ? alpha(M.success, 0.1) : M.paper} style={{ border: `1px solid ${M.hair}` }}>
              {i === 0 ? <Check size={18} strokeWidth={3} /> : null}
              {t}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

function AsoPage({ frame, from, to }: { frame: number; from: number; to: number }) {
  const { v, style } = pageVis(frame, from, to);
  if (v <= 0) return null;
  const strike = ramp(frame, from + 6, from + 16);
  const next = snap(frame, from + 20);
  const kw = ['conn.k1', 'conn.k2', 'conn.k3'].map((id) => snap(frame, TL.at(id)));
  return (
    <div style={style}>
      <PageHeader title="ASO" hint="App Store optimizasyonu" />
      <div style={{ position: 'absolute', left: CX, top: CY + 96, width: CW, height: 400, borderRadius: 22, border: `1.5px solid ${M.hair}`, background: M.paper, padding: 32, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ width: 72, height: 72, borderRadius: 18, background: `linear-gradient(135deg, ${brand[200]}, ${brand[400]})`, display: 'grid', placeItems: 'center', color: 'white' }}>
            <Smartphone size={34} />
          </span>
          <div>
            <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 26 }}>Örnek Klinik</div>
            <div style={{ fontFamily: fontUI, fontWeight: 600, fontSize: 18, color: M.muted }}>App Store · uygulama kaydı</div>
          </div>
          <SampleTag size={15} style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 18, color: M.muted, marginTop: 34 }}>Başlık önerisi</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12 }}>
          <span style={{ position: 'relative', padding: '16px 22px', borderRadius: 14, background: M.fill, fontFamily: fontMono, fontSize: 24, color: M.muted }}>
            Örnek Klinik
            <span style={{ position: 'absolute', left: 18, top: '50%', height: 2.5, width: `calc(${strike * 100}% - 36px)`, background: M.muted }} />
          </span>
          <ArrowRight size={28} color={M.muted} />
          <span style={{ padding: '16px 22px', borderRadius: 14, border: `2px solid ${alpha(M.success, 0.5)}`, background: alpha(M.success, 0.07), fontFamily: fontMono, fontWeight: 700, fontSize: 24, opacity: clamp01(next * 1.5), transform: `scale(${0.9 + 0.1 * next})` }}>
            Örnek Klinik: Diş Randevusu
          </span>
        </div>
        <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 18, color: M.muted, marginTop: 36 }}>Anahtar kelime fırsatları</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          {['diş randevusu', 'diş hekimi', 'ağız sağlığı'].map((k, i) => (
            <span key={k} style={{ padding: '12px 20px', borderRadius: 12, background: alpha(brand[500], 0.1), color: brand[800], fontFamily: fontUI, fontWeight: 800, fontSize: 21, opacity: clamp01(kw[i] * 1.5), transform: `scale(${0.8 + 0.2 * kw[i]})` }}>
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── ust katmanlar ───────────── */

const CHAPTERS: Array<[string, string, string]> = [
  ['site', '01', 'Site ekle'],
  ['audit', '02', 'Site Skoru'],
  ['content', '03', 'İçerik ve otomatik akış'],
  ['visibility', '04', 'AI görünürlük'],
  ['connect', '05', 'Bağlantılar ve ASO'],
];

function ChapterPill({ frame }: { frame: number }) {
  return (
    <>
      {CHAPTERS.map(([scene, n, label]) => {
        const [a, b] = TL.scene(scene);
        if (frame < a - 2 || frame >= b) return null;
        const inP = snap(frame, a + 2);
        const out = ramp(frame, b - 8, b);
        return (
          <div key={n} style={{ position: 'absolute', left: WIN.x, top: 14, display: 'flex', alignItems: 'center', gap: 12, height: 44, padding: '0 20px 0 8px', borderRadius: 999, background: 'rgba(255,255,255,0.88)', border: `1px solid ${M.hair}`, boxShadow: `0 8px 24px ${alpha(M.ink, 0.08)}`, opacity: clamp01(inP * 1.5) * (1 - out), transform: `translateY(${(1 - inP) * -16}px)`, clipPath: `inset(0 ${(1 - clamp01(inP)) * 100}% 0 0 round 999px)`, zIndex: 5 }}>
            <span style={{ width: 30, height: 30, borderRadius: 99, background: M.grad, color: 'white', display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 14 }}>{n}</span>
            <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 19 }}>{label}</span>
          </div>
        );
      })}
    </>
  );
}

function Captions({ frame }: { frame: number }) {
  const cap = TL.captions.find((c) => frame >= c.from && frame < c.to);
  if (!cap) return null;
  const inP = ramp(frame, cap.from, cap.from + 5);
  const out = ramp(frame, cap.to - 5, cap.to);
  const o = Math.min(inP, 1 - out);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', opacity: o, transform: `translateY(${(1 - inP) * 10}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: 1500, padding: '18px 32px', borderRadius: 999, background: 'rgba(28, 15, 9, 0.86)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: `0 14px 36px ${alpha(M.ink, 0.25)}`, color: 'white', fontFamily: fontUI, fontWeight: 600, fontSize: 32, lineHeight: 1.25, letterSpacing: '-0.005em' }}>
        <span style={{ width: 12, height: 12, borderRadius: 99, background: brand[400], flex: 'none' }} />
        {cap.text}
      </div>
    </div>
  );
}

function EndCard({ frame }: { frame: number }) {
  const [endS] = TL.scene('end');
  if (frame < endS) return null;
  const w = snap(frame, endS + 8);
  const cta = snap(frame, TL.at('end.cta'));
  const url = snap(frame, TL.at('end.cta') + 8);
  const note = soft(frame, TL.at('end.cta') + 16);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44 }}>
      <div style={{ opacity: clamp01(w * 1.4), transform: `translateY(${(1 - w) * 24}px)` }}>
        <Wordmark size={112} theme={light} />
      </div>
      <div style={{ opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
        <CtaButton size={48}>
          2 makale ücretsiz dene <ArrowRight size={46} strokeWidth={2.8} />
        </CtaButton>
      </div>
      <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 64, letterSpacing: '-0.035em', opacity: clamp01(url * 1.5), transform: `translateY(${(1 - url) * 20}px)` }}>ranksup.ai</div>
      <div style={{ marginTop: -24, fontFamily: fontUI, fontWeight: 600, fontSize: 30, color: M.body, opacity: note }}>Kart gerekmez · İstediğin zaman iptal</div>
    </div>
  );
}

/* ───────────── imlec yolu ───────────── */

function ExplainerCursor({ frame }: { frame: number }) {
  const c = {
    site: TL.at('site.click'),
    go: TL.at('site.go'),
    audit: TL.at('audit.nav'),
    preview: TL.at('audit.preview'),
    approve: TL.at('audit.approve'),
    content: TL.at('content.nav'),
    open: TL.at('content.open'),
    publish: TL.at('content.publish'),
    vis: TL.at('vis.nav'),
    test: TL.at('vis.test'),
    gsc: TL.at('conn.click'),
    aso: TL.at('conn.aso'),
  };
  const path: Array<[number, number, number]> = [
    [100, 1500, 820],
    [c.site - 1, P.addSite[0] + 10, P.addSite[1] + 6],
    [c.site + 14, P.field[0] - 40, P.field[1] + 70],
    [c.go - 14, P.start[0] - 140, P.start[1] + 30],
    [c.go - 1, P.start[0], P.start[1]],
    [c.go + 40, 1280, 700],
    [c.audit - 24, 900, 600],
    [c.audit - 1, ...navPoint('audit')],
    [c.audit + 40, 1000, 640],
    [c.preview - 22, P.preview[0] - 160, P.preview[1] + 120],
    [c.preview - 1, P.preview[0], P.preview[1]],
    [c.preview + 30, P.approve[0] - 200, P.approve[1] - 200],
    [c.approve - 1, P.approve[0], P.approve[1]],
    [c.approve + 40, 1150, 760],
    [c.content - 24, 700, 700],
    [c.content - 1, ...navPoint('articles')],
    [c.open - 20, P.chip1[0] + 120, P.chip1[1] + 140],
    [c.open - 1, P.chip1[0], P.chip1[1]],
    [c.open + 40, 1200, 760],
    [c.publish - 20, P.publish[0] - 180, P.publish[1] - 140],
    [c.publish - 1, P.publish[0], P.publish[1]],
    [c.publish + 50, 1100, 700],
    [c.vis - 24, 700, 600],
    [c.vis - 1, ...navPoint('visibility')],
    [c.vis + 24, 1100, 450],
    [c.test - 1, P.retest[0], P.retest[1] + 6],
    [c.test + 40, P.retest[0] - 160, P.retest[1] + 240],
    [c.gsc - 24, P.gsc[0] - 200, P.gsc[1] + 200],
    [c.gsc - 1, P.gsc[0], P.gsc[1]],
    [c.gsc + 30, 900, 650],
    [c.aso - 22, 600, 700],
    [c.aso - 1, ...navPoint('aso')],
    [c.aso + 40, 1200, 820],
  ];
  return <Cursor frame={frame} path={path} clicks={Object.values(c)} visibleFrom={110} visibleTo={c.aso + 60} />;
}
