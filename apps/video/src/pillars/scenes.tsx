/**
 * Kanca, mesaj, bicim ve kapanis sahneleri (panel disi). Her metin script.json'dan; gorseller
 * mantiksal boyutta cizilir ve bicime gore olceklenir.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Activity, ArrowRight, BarChart3, Bot, CalendarDays, Check, EyeOff, Lock, Play, Search, ShieldCheck, Smartphone, Sparkles, User } from 'lucide-react';
import { alpha, brand } from '../tokens';
import { LogoMark, Wordmark } from '../ui';
import { CtaButton, M, clamp01, fontDisplay, fontMono, fontUI } from '../marketing/kit';
import { light } from '../tokens';
import type { PlannedScene } from './schedule.mjs';
import { Headline, SITE, Tag, fade, has, ramp, type A, type Format, type Get, type Rect } from './parts';

/* ───────────── ortak ───────────── */

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ position: 'absolute', borderRadius: 30, background: M.paper, border: `1px solid ${alpha(M.ink, 0.08)}`, boxShadow: `0 34px 90px ${alpha(M.ink, 0.12)}, 0 6px 18px ${alpha(M.ink, 0.05)}`, overflow: 'hidden', ...style }}>{children}</div>
);
const Bar = ({ w, h = 14, c = alpha(M.ink, 0.08), style }: { w: number | string; h?: number; c?: string; style?: React.CSSProperties }) => (
  <div style={{ width: w, height: h, borderRadius: 99, background: c, ...style }} />
);

/** mantiksal (VIS.w × VIS.h) gorseli rect'e sigdirir */
const VIS = { w: 900, h: 640 };
function Fit({ rect, children }: { rect: Rect; children: React.ReactNode }) {
  const s = Math.min(rect.w / VIS.w, rect.h / VIS.h);
  return (
    <div style={{ position: 'absolute', left: rect.x + (rect.w - VIS.w * s) / 2, top: rect.y + (rect.h - VIS.h * s) / 2, width: VIS.w, height: VIS.h, transform: `scale(${s})`, transformOrigin: '0 0' }}>{children}</div>
  );
}

/* ───────────── kanca gorselleri ───────────── */

function HookChat({ g, frame }: { g: Get; frame: number }) {
  const q = g('q');
  const tag = g('tag');
  const typing = q.o > 0.5 ? ramp(frame, q.it.appear + 18, q.it.appear + 30) : 0;
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(q) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 82, padding: '0 30px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: alpha(M.ink, 0.07), display: 'grid', placeItems: 'center' }}>
          <Bot size={26} color={M.inkSoft} />
        </span>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>AI asistanı</span>
        <Tag a={tag} size={20} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ position: 'absolute', right: 34, top: 120, maxWidth: 640, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ padding: '22px 28px', borderRadius: '26px 26px 8px 26px', background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 700, fontSize: 34, lineHeight: 1.3 }}>{q.text}</div>
        <span style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 99, background: alpha(brand[500], 0.16), display: 'grid', placeItems: 'center' }}>
          <User size={26} color={brand[700]} />
        </span>
      </div>
      <div style={{ position: 'absolute', left: 34, top: 330, width: 640, display: 'flex', gap: 14, opacity: typing }}>
        <span style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 99, background: alpha(M.ink, 0.07), display: 'grid', placeItems: 'center' }}>
          <Sparkles size={24} color={M.inkSoft} />
        </span>
        <div style={{ flex: 1, padding: '24px 28px', borderRadius: '26px 26px 26px 8px', background: M.fill, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[0.92, 0.78, 0.86, 0.6].map((w, i) => (
            <Bar key={i} w={`${w * 100 * clamp01((frame - q.it.appear - 30 - i * 6) / 14)}%`} h={16} c={alpha(M.ink, 0.12)} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function HookSerp({ g, frame }: { g: Get; frame: number }) {
  const s = g('serp');
  const tag = g('tag');
  const mine = 7;
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(s) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 96, padding: '0 28px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 26, color: M.inkSoft }}>Google</span>
        <div style={{ flex: 1, height: 56, borderRadius: 99, border: `1.5px solid ${M.hairStrong}`, background: M.paper, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', fontFamily: fontUI, fontWeight: 600, fontSize: 24, color: M.ink }}>
          <Search size={22} color={M.muted} /> {s.it.query}
        </div>
        <Tag a={tag} size={20} />
      </div>
      <div style={{ padding: '14px 28px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
          const me = n === mine;
          const at = s.it.appear + 8 + n * 3;
          const o = clamp01((frame - at) / 8);
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 18, height: 60, padding: '0 16px', borderRadius: 14, background: me ? alpha(brand[500], 0.1) : 'transparent', border: me ? `2px solid ${alpha(brand[500], 0.5)}` : '2px solid transparent', opacity: o }}>
              <span style={{ width: 34, fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, color: n <= 3 ? M.success : me ? brand[700] : M.muted }}>{n}</span>
              {me ? (
                <span style={{ fontFamily: fontMono, fontWeight: 700, fontSize: 24, color: brand[800] }}>{SITE}</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Bar w={260 + ((n * 97) % 180)} h={14} c={alpha(M.ink, n <= 3 ? 0.16 : 0.09)} />
                  <Bar w={160 + ((n * 53) % 90)} h={9} c={alpha(M.ink, 0.06)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HookStore({ g, frame }: { g: Get; frame: number }) {
  const s = g('store');
  const tag = g('tag');
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(s) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 96, padding: '0 28px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 26, color: M.inkSoft, whiteSpace: 'nowrap' }}>App Store</span>
        <div style={{ flex: 1, height: 56, borderRadius: 16, background: alpha(M.ink, 0.06), display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', fontFamily: fontUI, fontWeight: 600, fontSize: 24, color: M.ink }}>
          <Search size={22} color={M.muted} /> {s.it.query}
        </div>
        <Tag a={tag} size={20} />
      </div>
      <div style={{ padding: '18px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[0, 1, 2, 3].map((n) => {
          const o = clamp01((frame - s.it.appear - 8 - n * 4) / 8);
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 20, height: 104, opacity: o }}>
              <span style={{ width: 84, height: 84, borderRadius: 22, background: alpha(M.ink, 0.08 + n * 0.01) }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Bar w={240 + ((n * 71) % 120)} h={16} c={alpha(M.ink, 0.14)} />
                <Bar w={170 + ((n * 37) % 80)} h={11} c={alpha(M.ink, 0.07)} />
              </div>
              <span style={{ marginLeft: 'auto', width: 92, height: 42, borderRadius: 99, background: alpha(M.ink, 0.07) }} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HookCalendar({ g }: { g: Get }) {
  const c = g('cal');
  const tag = g('tag');
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(c) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 86, padding: '0 28px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <CalendarDays size={28} color={M.inkSoft} />
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>Blog takvimi</span>
        <Tag a={tag} size={20} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
          <div key={d} style={{ textAlign: 'center', fontFamily: fontUI, fontWeight: 800, fontSize: 19, color: M.muted }}>{d}</div>
        ))}
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} style={{ height: 76, borderRadius: 12, border: `1.5px dashed ${alpha(M.ink, 0.12)}`, background: i % 7 > 4 ? M.cream : M.paper }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', justifyContent: 'center' }}>
        <span style={{ padding: '18px 32px', borderRadius: 999, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 32, boxShadow: `0 18px 40px ${alpha(M.ink, 0.25)}` }}>{c.text}</span>
      </div>
    </Card>
  );
}

function HookArticle({ g }: { g: Get }) {
  const a = g('art');
  const tag = g('tag');
  return (
    <div style={{ position: 'absolute', inset: 0, ...fade(a) }}>
      <Card style={{ left: 0, top: 40, width: 520, height: 560 }}>
        <div style={{ height: 180, background: `linear-gradient(135deg, ${alpha(brand[300], 0.5)}, ${alpha(brand[100], 0.7)})` }} />
        <div style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, background: alpha(M.success, 0.12), color: M.success, fontFamily: fontUI, fontWeight: 800, fontSize: 18 }}>
              <Check size={16} strokeWidth={3} /> Yayında
            </span>
            <Tag a={tag} size={18} />
          </div>
          <div style={{ marginTop: 14, fontFamily: fontDisplay, fontWeight: 700, fontSize: 32, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{a.text}</div>
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0.95, 0.88, 0.7].map((w, i) => (
              <Bar key={i} w={`${w * 100}%`} h={12} />
            ))}
          </div>
        </div>
      </Card>
      <ArrowRight size={44} color={M.muted} style={{ position: 'absolute', left: 552, top: 296 }} />
      <div style={{ position: 'absolute', left: 620, top: 20, width: 280, height: 600, borderRadius: 44, border: `4px dashed ${alpha(M.ink, 0.22)}`, display: 'grid', placeItems: 'center', boxSizing: 'border-box' }}>
        <span style={{ width: 96, height: 96, borderRadius: 99, background: alpha(M.ink, 0.06), display: 'grid', placeItems: 'center' }}>
          <Play size={44} color={alpha(M.ink, 0.35)} />
        </span>
      </div>
    </div>
  );
}

/** Canlı Tarayıcı kancasi: ornek site + uzerinde "?" ile bekleyen AI botlari */
const HOOK_BOTS = ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot'];
function HookBots({ g, frame }: { g: Get; frame: number }) {
  const s = g('site');
  const tag = g('tag');
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(s) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 88, padding: '0 26px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: 99, background: alpha(M.ink, 0.14) }} />
          ))}
        </div>
        <div style={{ flex: 1, height: 52, borderRadius: 99, background: M.paper, border: `1.5px solid ${M.hair}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', fontFamily: fontMono, fontWeight: 600, fontSize: 24, color: M.ink }}>
          <Lock size={20} color={M.muted} /> {s.text}
        </div>
        <Tag a={tag} size={20} />
      </div>
      <div style={{ position: 'absolute', left: 30, top: 118, width: 440 }}>
        <div style={{ height: 190, borderRadius: 20, background: `linear-gradient(135deg, ${alpha(brand[300], 0.45)}, ${alpha(brand[100], 0.7)})` }} />
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[0.92, 0.78, 0.86, 0.64, 0.8].map((w, i) => (
            <Bar key={i} w={`${w * 100}%`} h={14} />
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 496, top: 118, width: 374, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {HOOK_BOTS.map((b, i) => {
          const o = clamp01((frame - s.it.appear - 10 - i * 6) / 8);
          return (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 100, padding: '0 20px', borderRadius: 22, border: `2.5px dashed ${alpha(M.ink, 0.22)}`, background: M.paper, opacity: o, transform: `translateX(${(1 - o) * 20}px)` }}>
              <span style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 16, background: alpha(M.ink, 0.07), display: 'grid', placeItems: 'center' }}>
                <Bot size={30} color={M.inkSoft} />
              </span>
              <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 27, color: M.ink, whiteSpace: 'nowrap' }}>{b}</span>
              <span style={{ marginLeft: 'auto', fontFamily: fontDisplay, fontWeight: 800, fontSize: 40, color: brand[600] }}>?</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** JavaScript ile olcen web analitigi: insan ziyaretcisi var, AI botlari yok (temsili) */
function HookAnalytics({ g, frame }: { g: Get; frame: number }) {
  const a = g('an');
  const tag = g('tag');
  const pts = [0.42, 0.55, 0.48, 0.62, 0.58, 0.7, 0.66, 0.78, 0.72, 0.84];
  const cw = 840;
  const chH = 200;
  const draw = clamp01((frame - a.it.appear) / 24);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (pts.length - 1)) * cw} ${chH - p * chH}`).join(' ');
  const rows: Array<[string, string, boolean]> = [
    ['Ziyaretçiler', 'ölçülüyor', true],
    ['GPTBot', 'görünmüyor', false],
    ['ClaudeBot', 'görünmüyor', false],
  ];
  return (
    <Card style={{ left: 0, top: 0, width: VIS.w, height: VIS.h, ...fade(a) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 84, padding: '0 28px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <BarChart3 size={28} color={M.inkSoft} />
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>{a.text}</span>
        <Tag a={tag} size={20} style={{ marginLeft: 'auto' }} />
      </div>
      <svg width={cw} height={chH + 10} style={{ position: 'absolute', left: 30, top: 108 }}>
        <path d={path} fill="none" stroke={brand[500]} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      </svg>
      <div style={{ position: 'absolute', left: 30, right: 30, top: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(([l, v, ok], i) => {
          const o = clamp01((frame - a.it.appear - 14 - i * 6) / 8);
          return (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 76, padding: '0 22px', borderRadius: 16, border: `1.5px solid ${M.hair}`, background: ok ? M.paper : M.fill, opacity: o }}>
              <span style={{ width: 40, height: 40, borderRadius: 99, display: 'grid', placeItems: 'center', background: ok ? alpha(M.success, 0.12) : alpha(M.ink, 0.07), color: ok ? M.success : M.muted }}>
                {ok ? <Check size={22} strokeWidth={3} /> : <EyeOff size={22} />}
              </span>
              <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28, color: ok ? M.ink : M.body }}>{l}</span>
              <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 700, fontSize: 24, color: ok ? M.success : M.muted }}>{v}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const HOOKS: Record<string, React.FC<{ g: Get; frame: number }>> = {
  hookChat: HookChat,
  hookSerp: HookSerp,
  hookStore: HookStore,
  hookCalendar: HookCalendar,
  hookArticle: HookArticle,
  hookBots: HookBots,
  hookAnalytics: HookAnalytics,
};

export function HookScene({ g, scene, frame, format }: { g: Get; scene: PlannedScene; frame: number; format: Format }) {
  const V = HOOKS[scene.type];
  if (format === 'v') {
    return (
      <>
        <Headline a={g('h')} size={84} width={900} style={{ position: 'absolute', left: 90, top: 230 }} />
        <Fit rect={{ x: 90, y: 560, w: 900, h: 660 }}>
          <V g={g} frame={frame} />
        </Fit>
        <Headline a={g('h2')} size={84} width={900} accent style={{ position: 'absolute', left: 90, top: 1290 }} />
      </>
    );
  }
  return (
    <>
      <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 640, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 48 }}>
        <Headline a={g('h')} size={76} width={640} />
        <Headline a={g('h2')} size={76} width={640} accent />
      </div>
      <Fit rect={{ x: 840, y: 150, w: 980, h: 780 }}>
        <V g={g} frame={frame} />
      </Fit>
    </>
  );
}

/* ───────────── mesaj ───────────── */

export function MessageScene({ g, scene, format }: { g: Get; scene: PlannedScene; format: Format }) {
  const v = format === 'v';
  if (scene.variant === 'list') {
    const items = Object.keys(scene.items).filter((k) => /^l\d+$/.test(k)).map((k) => g(k));
    const icons = [Smartphone, Sparkles];
    return (
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: v ? 56 : 44, padding: v ? '0 90px' : '0 200px' }}>
        <Headline a={g('h')} size={v ? 88 : 80} width={v ? 900 : 1400} align="center" />
        <div style={{ display: 'flex', flexDirection: v ? 'column' : 'row', gap: 24, width: v ? 900 : 1500 }}>
          {items.map((a, i) => {
            const Icon = icons[i % icons.length];
            const [title, ...rest] = a.text.split(' — ');
            return (
              <div key={a.it.id} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 22, padding: '28px 32px', borderRadius: 26, background: M.paper, border: `1.5px solid ${M.hair}`, boxShadow: `0 20px 50px ${alpha(M.ink, 0.08)}`, ...fade(a) }}>
                <span style={{ width: 76, height: 76, flexShrink: 0, borderRadius: 20, background: alpha(brand[500], 0.12), display: 'grid', placeItems: 'center', color: brand[600] }}>
                  <Icon size={38} />
                </span>
                <div>
                  <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 38, lineHeight: 1.15 }}>{title}</div>
                  <div style={{ fontFamily: fontUI, fontWeight: 600, fontSize: 30, color: M.body, marginTop: 6 }}>{rest.join(' — ')}</div>
                </div>
              </div>
            );
          })}
        </div>
        {has(scene, 'plan') ? <Tag a={g('plan')} size={v ? 26 : 24} style={{ whiteSpace: 'normal', textAlign: 'center', maxWidth: v ? 860 : 1300, lineHeight: 1.35 }} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: v ? 40 : 30 }}>
      <Headline a={g('h')} size={v ? 92 : 88} width={v ? 900 : 1500} align="center" />
      <Headline a={g('h2')} size={v ? 92 : 88} width={v ? 900 : 1500} align="center" accent />
    </AbsoluteFill>
  );
}

/* ───────────── RanksUp Video: dikey + yatay ornek ───────────── */

const SAMPLE_BRAND = '#0E7490';
function SampleVertical({ title }: { title: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(160deg, ${SAMPLE_BRAND}, #0B4F63)`, color: 'white', padding: '70px 36px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 56, height: 56, borderRadius: 16, background: 'white', color: SAMPLE_BRAND, display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 30 }}>Ö</span>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 24 }}>Örnek Klinik</span>
      </div>
      <div style={{ marginTop: 'auto', fontFamily: fontDisplay, fontWeight: 800, fontSize: 40, lineHeight: 1.12, letterSpacing: '-0.02em' }}>{title}</div>
      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Bar w="90%" h={12} c="rgba(255,255,255,0.35)" />
        <Bar w="70%" h={12} c="rgba(255,255,255,0.35)" />
      </div>
      <div style={{ marginTop: 40, fontFamily: fontMono, fontWeight: 600, fontSize: 20, opacity: 0.85 }}>{SITE}</div>
    </div>
  );
}
function SampleWide() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(120deg, ${SAMPLE_BRAND}, #0B4F63)`, color: 'white', padding: 28, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 24 }}>
      <span style={{ width: 84, height: 84, borderRadius: 22, background: 'white', color: SAMPLE_BRAND, display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 44, flexShrink: 0 }}>Ö</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 30 }}>Örnek Klinik</span>
        <Bar w="85%" h={12} c="rgba(255,255,255,0.35)" />
        <Bar w="60%" h={12} c="rgba(255,255,255,0.35)" />
      </div>
    </div>
  );
}

export function FormatsScene({ g, format }: { g: Get; format: Format }) {
  const v = g('v');
  const w = g('w');
  const tag = g('tag');
  const sample = g('sample').text;
  const phone = (h: number, x: number, y: number) => {
    const wd = Math.round((h * 9) / 16);
    return (
      <div style={{ position: 'absolute', left: x, top: y, ...fade(v) }}>
        <div style={{ position: 'relative', width: wd, height: h, borderRadius: 42, background: M.ink, padding: 12, boxSizing: 'border-box', boxShadow: `0 40px 90px ${alpha(M.ink, 0.25)}` }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 32, overflow: 'hidden' }}>
            <SampleVertical title={sample} />
          </div>
        </div>
        <div style={{ marginTop: 22, width: wd + 120, marginLeft: -60, textAlign: 'center', fontFamily: fontUI, fontWeight: 800, fontSize: 32, color: M.inkSoft }}>{v.text}</div>
      </div>
    );
  };
  const wide = (wd: number, x: number, y: number) => (
    <div style={{ position: 'absolute', left: x, top: y, ...fade(w) }}>
      <div style={{ position: 'relative', width: wd, height: Math.round((wd * 9) / 16), borderRadius: 22, background: M.ink, padding: 10, boxSizing: 'border-box', boxShadow: `0 34px 80px ${alpha(M.ink, 0.22)}` }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 14, overflow: 'hidden' }}>
          <SampleWide />
        </div>
      </div>
      <div style={{ marginTop: 22, width: wd, textAlign: 'center', fontFamily: fontUI, fontWeight: 800, fontSize: 32, color: M.inkSoft }}>{w.text}</div>
    </div>
  );
  if (format === 'v') {
    return (
      <>
        <Headline a={g('h')} size={80} width={900} style={{ position: 'absolute', left: 90, top: 220 }} />
        <Tag a={tag} size={24} style={{ position: 'absolute', left: 90, top: 470 }} />
        {phone(760, 120, 560)}
        {wide(420, 580, 760)}
        <Claim a={g('claim')} style={{ position: 'absolute', left: 90, top: 1440, width: 900 }} />
      </>
    );
  }
  return (
    <>
      <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 600, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30 }}>
        <Headline a={g('h')} size={76} width={600} />
        <div>
          <Tag a={tag} size={22} />
        </div>
        <Claim a={g('claim')} style={{ width: 600 }} />
      </div>
      {phone(780, 800, 90)}
      {wide(560, 1290, 300)}
    </>
  );
}

function Claim({ a, style }: { a: A; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px', borderRadius: 20, background: alpha(M.success, 0.08), border: `1.5px solid ${alpha(M.success, 0.3)}`, fontFamily: fontUI, fontWeight: 700, fontSize: 30, lineHeight: 1.3, color: M.inkSoft, boxSizing: 'border-box', ...fade(a), ...style }}>
      <ShieldCheck size={34} color={M.success} style={{ flexShrink: 0 }} />
      {a.text}
    </div>
  );
}

/* ───────────── kapanis ───────────── */

export function EndScene({ g, scene, format }: { g: Get; scene: PlannedScene; format: Format }) {
  const v = format === 'v';
  const logo = g('logo');
  const url = g('url');
  const cta = g('cta');
  const note = g('note');
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: v ? 44 : 34 }}>
      <div style={{ display: 'flex', flexDirection: v ? 'column' : 'row', alignItems: 'center', gap: v ? 34 : 30, opacity: logo.o, transform: `translateY(${logo.y}px) scale(${0.94 + 0.06 * logo.p})` }}>
        <LogoMark size={v ? 170 : 140} />
        <Wordmark size={v ? 120 : 110} theme={light} />
      </div>
      <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: v ? 58 : 52, letterSpacing: '-0.02em', color: brand[700], ...fade(url) }}>{url.text}</div>
      <div style={{ ...fade(cta), marginTop: v ? 20 : 12 }}>
        <CtaButton size={v ? 52 : 46}>
          {cta.text}
          <ArrowRight size={v ? 50 : 44} strokeWidth={2.6} />
        </CtaButton>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 700, fontSize: v ? 36 : 30, color: M.body, ...fade(note) }}>
        <ShieldCheck size={v ? 34 : 28} color={M.success} /> {note.text}
      </div>
      {has(scene, 'plan') ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: v ? -16 : -12, fontFamily: fontUI, fontWeight: 700, fontSize: v ? 32 : 28, color: M.body, ...fade(g('plan')) }}>
          <Activity size={v ? 30 : 26} color={brand[600]} /> {g('plan').text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

