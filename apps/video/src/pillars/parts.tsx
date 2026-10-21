/**
 * 5 sutun tanitim videolarinin ortak parcalari: zaman/animasyon, panel penceresi (kenar cubugu =
 * apps/web/src/lib/site-nav.ts), basliklar, etiketler.
 *
 * Gorsel dil marketing/kit.tsx ile ayni (krem zemin, Sora 800 baslik, turuncu degrade, mor yok).
 * Animasyon yalniz Remotion kare fonksiyonlari; giris/cikis sabitleri schedule.mjs'ten — okunurluk
 * denetimi (scripts/check-pillars-readability.mjs) ayni sabitlerle hesaplar.
 */
import React from 'react';
import { Easing, interpolate, spring } from 'remotion';
import {
  Activity,
  Award,
  BarChart3,
  Bot,
  Clapperboard,
  ClipboardList,
  FileBarChart,
  FileText,
  House,
  Image as ImageIcon,
  Lightbulb,
  LineChart,
  MessageSquare,
  MessagesSquare,
  Network,
  PenLine,
  Plug,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
  Zap,
  ChevronRight,
  Menu,
  type LucideIcon,
} from 'lucide-react';
import { alpha, brand } from '../tokens';
import { LogoMark } from '../ui';
import { M, clamp01, fontDisplay, fontUI } from '../marketing/kit';
import { ENTER, EXIT_FRAMES, FPS, LEAD, type PlannedItem, type PlannedScene } from './schedule.mjs';

export type Format = 'v' | 'w';

/* ───────────── zaman ───────────── */

export function ramp(frame: number, start: number, end: number, ease: (t: number) => number = Easing.out(Easing.cubic)) {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
}

export type A = { p: number; o: number; y: number; text: string; it: PlannedItem };

/** ogenin animasyon durumu: sakin giris yayi (vurustan LEAD kare once) + sahne cikisi (EXIT_FRAMES) */
export function animOf(frame: number, it: PlannedItem, sceneLast: boolean): A {
  const p = spring({ frame: frame - (it.appear - LEAD), fps: FPS, config: ENTER.config });
  const exit = sceneLast && it.out === undefined ? 0 : ramp(frame, it.visibleTo, it.visibleTo + EXIT_FRAMES, Easing.inOut(Easing.cubic));
  const o = clamp01(p * 1.4) * (1 - exit);
  return { p, o, y: (1 - p) * 26, text: it.text, it };
}

export type Get = (id: string) => A;
export function getter(frame: number, scene: PlannedScene): Get {
  return (id) => {
    const it = scene.items[id];
    if (!it) throw new Error(`script.json: ${scene.id} sahnesinde '${id}' yok`);
    return animOf(frame, it, scene.last);
  };
}
export const has = (scene: PlannedScene, id: string) => Boolean(scene.items[id]);

export const fade = (a: A, extra?: React.CSSProperties): React.CSSProperties => ({ opacity: a.o, transform: `translateY(${a.y}px)`, ...extra });

/* ───────────── kenar cubugu (site-nav.ts kopyasi) ───────────── */

type Nav = { route: string; label: string; icon: LucideIcon; group: string };
export const NAV_GROUPS: Array<{ id: string; label?: string }> = [
  { id: 'main' },
  { id: 'health', label: 'Sağlık' },
  { id: 'ai', label: 'AI Görünürlük' },
  { id: 'content', label: 'İçerik' },
  { id: 'growth', label: 'Büyüme' },
  { id: 'mobile', label: 'Mobil Uygulama' },
  { id: 'admin', label: 'Yönetim' },
];
export const NAV: Nav[] = [
  { route: 'overview', label: 'Genel Bakış', icon: House, group: 'main' },
  { route: 'actionPlan', label: 'Aksiyon Planı', icon: ClipboardList, group: 'main' },
  { route: 'chat', label: 'Asistan', icon: MessageSquare, group: 'main' },
  { route: 'audit', label: 'Site Skoru', icon: ShieldCheck, group: 'health' },
  { route: 'rankTracking', label: 'Sıralama Takibi', icon: LineChart, group: 'health' },
  { route: 'snippet', label: 'Sayfa SEO İyileştir', icon: PenLine, group: 'health' },
  { route: 'images', label: 'Görsel Alt Metinleri', icon: ImageIcon, group: 'health' },
  { route: 'stuckPages', label: 'Takılı Sayfalar', icon: Wrench, group: 'health' },
  { route: 'competitors', label: 'Rakipler', icon: Network, group: 'health' },
  { route: 'visibility', label: 'AI Görünürlük', icon: Sparkles, group: 'ai' },
  { route: 'geoLab', label: 'GEO Lab', icon: Award, group: 'ai' },
  { route: 'crawler', label: 'Canlı Tarayıcı', icon: Activity, group: 'ai' },
  { route: 'agentReadiness', label: 'Ajan Hazırlığı', icon: Bot, group: 'ai' },
  { route: 'productRadar', label: 'Ürün Radarı', icon: Radar, group: 'ai' },
  { route: 'opportunities', label: 'İçerik Fırsatları', icon: Lightbulb, group: 'content' },
  { route: 'articles', label: 'İçerikler', icon: FileText, group: 'content' },
  { route: 'videos', label: 'Videolar', icon: Clapperboard, group: 'content' },
  { route: 'communities', label: 'Topluluk Ajanı', icon: MessagesSquare, group: 'content' },
  { route: 'publishTargets', label: 'Yayın Hedefleri', icon: Send, group: 'content' },
  { route: 'analytics', label: 'Analitik', icon: BarChart3, group: 'growth' },
  { route: 'ads', label: 'Reklam', icon: TrendingUp, group: 'growth' },
  { route: 'adsHealth', label: 'Kampanya Skoru', icon: Target, group: 'growth' },
  { route: 'report', label: 'Rapor', icon: FileBarChart, group: 'growth' },
  { route: 'aso', label: 'ASO', icon: Smartphone, group: 'mobile' },
  { route: 'autopilot', label: 'Otomatik Akış', icon: Zap, group: 'admin' },
  { route: 'connections', label: 'Bağlantılar', icon: Plug, group: 'admin' },
  { route: 'settings', label: 'Ayarlar', icon: Settings, group: 'admin' },
];
export const navOf = (route: string) => {
  const n = NAV.find((x) => x.route === route);
  if (!n) throw new Error(`site-nav: '${route}' yok`);
  return n;
};
const groupLabel = (g: string) => NAV_GROUPS.find((x) => x.id === g)?.label;

const NAV_ROW = 40;
const NAV_GROUP_GAP = 34;
/** kenar cubugu satirlarinin y konumu (liste basindan) */
const NAV_Y: Record<string, number> = {};
{
  let y = 0;
  let prev = '';
  for (const n of NAV) {
    if (n.group !== prev && groupLabel(n.group)) y += NAV_GROUP_GAP;
    prev = n.group;
    NAV_Y[n.route] = y;
    y += NAV_ROW;
  }
}

/* ───────────── panel penceresi ───────────── */

export const SITE = 'ornekklinik.com';
export const TITLE_H = 54;
export const SIDE_W = 248;
export const CRUMB_H = 64;
/** sayfa iceriginin mantiksal boyutu: genislik bicime gore (dikeyde daha dar = daha buyuk olcek, telefonda okunur) */
export const PAGE_W: Record<Format, number> = { v: 740, w: 800 };
export const PageWidth = React.createContext(PAGE_W.w);

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Panel penceresi. nav: etkin menu ogesi (onceki ogeden kayarak gecer). Yatayda kenar cubugu, dikeyde
 * mobil panelin ust "kirinti" cubugu (☰ Grup › Sayfa). children: PAGE boyutunda sayfa icerigi.
 */
export function PanelWindow({
  frame,
  rect,
  format,
  nav,
  prevNav,
  navAt,
  crumb,
  opacity,
  rise,
  children,
}: {
  frame: number;
  rect: Rect;
  format: Format;
  nav: string;
  prevNav: string | null;
  navAt: number;
  crumb?: string;
  opacity: number;
  rise: number;
  children: React.ReactNode;
}) {
  const wide = format === 'w';
  const side = wide ? SIDE_W : 0;
  const top = TITLE_H + (wide ? 0 : CRUMB_H);
  const slot = { w: rect.w - side, h: rect.h - top };
  const pw = PAGE_W[format];
  const scale = (slot.w - 48) / pw;
  const pageX = side + (slot.w - pw * scale) / 2;
  const pageY = top + 22;
  const n = navOf(nav);
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: 26,
        background: M.paper,
        overflow: 'hidden',
        boxShadow: `0 40px 100px ${alpha(M.ink, 0.14)}, 0 8px 24px ${alpha(M.ink, 0.06)}`,
        border: `1px solid ${alpha(M.ink, 0.08)}`,
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      {/* baslik cubugu */}
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: TITLE_H, display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <LogoMark size={28} />
        <span style={{ marginLeft: 11, fontFamily: fontDisplay, fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>RanksUp</span>
        <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 600, fontSize: 18, color: M.muted }}>{SITE} · Panel</span>
      </div>
      {wide ? <Sidebar frame={frame} nav={nav} prevNav={prevNav} navAt={navAt} height={rect.h - TITLE_H} /> : null}
      {!wide ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TITLE_H, height: CRUMB_H, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: `1px solid ${M.hair}`, fontFamily: fontUI, fontWeight: 700, fontSize: 24, color: M.body }}>
          <Menu size={26} color={M.inkSoft} />
          {groupLabel(n.group) ? (
            <>
              <span>{groupLabel(n.group)}</span>
              <ChevronRight size={22} color={M.muted} />
            </>
          ) : null}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: brand[800] }}>
            <n.icon size={24} color={brand[600]} />
            {n.label}
          </span>
          {crumb ? (
            <>
              <ChevronRight size={22} color={M.muted} />
              <span style={{ color: M.ink }}>{crumb}</span>
            </>
          ) : null}
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: pageX, top: pageY, width: pw, height: (slot.h - 40) / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <PageWidth.Provider value={pw}>{children}</PageWidth.Provider>
      </div>
    </div>
  );
}

function Sidebar({ frame, nav, prevNav, navAt, height }: { frame: number; nav: string; prevNav: string | null; navAt: number; height: number }) {
  const listTop = 92;
  const viewH = height - listTop;
  // etkin oge gorunur alanin ~%40'ina gelsin; kayarak gecis (12 kare)
  const target = (r: string) => Math.max(0, NAV_Y[r] - viewH * 0.4);
  const k = prevNav ? ramp(frame, navAt, navAt + 14, Easing.inOut(Easing.cubic)) : 1;
  const from = prevNav ?? nav;
  const scroll = target(from) + (target(nav) - target(from)) * k;
  const hiY = NAV_Y[from] + (NAV_Y[nav] - NAV_Y[from]) * k;
  let prevGroup = '';
  return (
    <div style={{ position: 'absolute', left: 0, top: TITLE_H, width: SIDE_W, height, borderRight: `1px solid ${M.hair}`, background: M.cream, overflow: 'hidden' }}>
      <div style={{ margin: '18px 16px 0', height: 56, borderRadius: 14, border: `1px solid ${M.hair}`, background: M.paper, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: alpha(brand[500], 0.16), display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 15, color: brand[700] }}>Ö</span>
        <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 17, color: M.ink }}>{SITE}</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: listTop, bottom: 0, overflow: 'hidden', maskImage: 'linear-gradient(transparent 0, black 30px, black calc(100% - 50px), transparent 100%)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll }}>
          <div style={{ position: 'absolute', left: 12, right: 12, top: hiY + 2, height: NAV_ROW - 4, borderRadius: 11, background: alpha(brand[500], 0.13) }} />
          {NAV.map((n) => {
            const on = n.route === nav && k > 0.5;
            const label = n.group !== prevGroup ? groupLabel(n.group) : undefined;
            prevGroup = n.group;
            return (
              <React.Fragment key={n.route}>
                {label ? (
                  <div style={{ position: 'absolute', left: 26, top: NAV_Y[n.route] - 24, fontFamily: fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: M.muted }}>{label}</div>
                ) : null}
                <div style={{ position: 'absolute', left: 24, right: 14, top: NAV_Y[n.route], height: NAV_ROW, display: 'flex', alignItems: 'center', gap: 11, fontFamily: fontUI, fontWeight: on ? 800 : 600, fontSize: 16.5, color: on ? brand[800] : M.inkSoft, whiteSpace: 'nowrap' }}>
                  <n.icon size={19} color={on ? brand[600] : M.body} />
                  {n.label}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────── tipografi ───────────── */

export function Headline({ a, size, width, accent = false, align = 'left', style }: { a: A; size: number; width: number; accent?: boolean; align?: 'left' | 'center'; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width,
        fontFamily: fontDisplay,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.12,
        letterSpacing: '-0.03em',
        color: M.ink,
        textAlign: align,
        textWrap: 'balance',
        ...fade(a),
        ...style,
      } as React.CSSProperties}
    >
      {accent ? (
        <span style={{ backgroundImage: M.gradH, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: '0.12em', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } as React.CSSProperties}>{a.text}</span>
      ) : (
        a.text
      )}
    </div>
  );
}

/** kucuk not / "Örnek" etiketi */
export function Tag({ a, size = 18, style }: { a: A; size?: number; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `${size * 0.3}px ${size * 0.7}px`,
        borderRadius: 999,
        background: alpha(M.ink, 0.06),
        color: M.body,
        fontFamily: fontUI,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        opacity: a.o,
        ...style,
      }}
    >
      {a.text}
    </span>
  );
}

export const TONE: Record<string, string> = { ok: M.success, warn: M.warn, bad: '#B42318', brand: brand[700], none: M.muted };
