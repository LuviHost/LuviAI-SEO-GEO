/**
 * Panel sayfalari — gercek panelin (apps/web/src/app/(dashboard)/sites/[id]/*) yeniden CIZIMI.
 * Basliklar ve sabit etiketler panelin kendi metinleri; ornek veriler "Örnek …" etiketli.
 * Mantiksal genislik PAGE_W (dikey 740, yatay 800; parts.tsx); PanelWindow bicime gore olcekler. Her ogenin metni script.json'dan.
 */
import React from 'react';
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckSquare,
  CircleAlert,
  Clock,
  FileText,
  Gauge,
  Globe,
  Loader2,
  Lock,
  Minus,
  Package,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  WandSparkles,
  X,
} from 'lucide-react';
import { alpha, brand } from '../tokens';
import { M, clamp01, fontDisplay, fontMono, fontUI } from '../marketing/kit';
import type { PlannedScene } from './schedule.mjs';
import { PageWidth, TONE, Tag, fade, has, type A, type Get } from './parts';

const ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  lock: Lock,
  gauge: Gauge,
  wand: WandSparkles,
  check: Check,
  shield: ShieldCheck,
  clock: Clock,
};

/* ───────────── ust bilgi ───────────── */

function Header({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const t = g('title');
  const hint = g('hint');
  const tag = has(scene, 'tag') ? g('tag') : null;
  const chip = has(scene, 'chip') ? g('chip') : null;
  const plan = has(scene, 'plan') ? g('plan') : null;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, ...fade(t) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 44, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t.text}</div>
        {tag ? <Tag a={tag} size={19} style={{ marginLeft: 'auto' }} /> : null}
      </div>
      <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 24, color: M.body, marginTop: 8, lineHeight: 1.3 }}>{hint.text}</div>
      {chip || plan || scene.tabs ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          {scene.tabs ? (
            <div style={{ display: 'flex', gap: 4, padding: 5, borderRadius: 14, background: M.fill }}>
              {scene.tabs.map((tb, i) => {
                const on = i === (scene.activeTab ?? scene.tabs!.length - 1);
                return (
                  <span key={tb} style={{ padding: '7px 16px', borderRadius: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 19, background: on ? M.paper : 'transparent', color: on ? M.ink : M.muted, boxShadow: on ? `0 2px 6px ${alpha(M.ink, 0.08)}` : 'none' }}>
                    {tb}
                  </span>
                );
              })}
            </div>
          ) : null}
          {chip ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderRadius: 999, background: alpha(brand[500], 0.12), color: brand[800], fontFamily: fontUI, fontWeight: 800, fontSize: 20, opacity: chip.o }}>
              <Clock size={18} /> {chip.text}
            </span>
          ) : null}
          {plan ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderRadius: 999, background: alpha(M.ink, 0.06), color: M.inkSoft, fontFamily: fontUI, fontWeight: 700, fontSize: 19, opacity: plan.o }}>
              <Lock size={16} /> {plan.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const headerH = (scene: PlannedScene) => (has(scene, 'chip') || has(scene, 'plan') || scene.tabs ? 176 : 120);

/** alt bilgi seridi / dugme (callout) */
function Callout({ a, top }: { a: A; top: number }) {
  const W = React.useContext(PageWidth);
  const Icon = ICONS[a.it.icon ?? 'check'] ?? Check;
  if (a.it.button) {
    return (
      <div style={{ position: 'absolute', right: 0, top, ...fade(a) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 64, padding: '0 30px', borderRadius: 16, background: M.grad, color: 'white', fontFamily: fontDisplay, fontWeight: 700, fontSize: 25, boxShadow: `0 14px 34px ${alpha(brand[700], 0.25)}` }}>
          <Icon size={24} /> {a.text}
        </span>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', left: 0, top, width: W, minHeight: 70, borderRadius: 18, background: alpha(brand[500], 0.08), border: `1.5px solid ${alpha(brand[500], 0.3)}`, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', boxSizing: 'border-box', fontFamily: fontUI, fontWeight: 700, fontSize: 24, lineHeight: 1.3, color: M.inkSoft, ...fade(a) }}>
      <Icon size={26} color={brand[600]} />
      <span>{a.text}</span>
    </div>
  );
}

function StatusRow({ a, height = 70 }: { a: A; height?: number }) {
  const it = a.it;
  const col = TONE[it.tone ?? 'none'];
  const ok = it.tone === 'ok';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, height, padding: '0 20px', borderRadius: 16, border: `1.5px solid ${ok || it.tone === 'brand' ? M.hair : alpha(col, 0.35)}`, background: ok || it.tone === 'brand' ? M.paper : alpha(col, 0.05), boxSizing: 'border-box', opacity: a.o, transform: `translateX(${(1 - a.p) * 26}px)` }}>
      <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(col, 0.12), color: col }}>
        {ok ? <Check size={22} strokeWidth={3} /> : it.tone === 'brand' ? <Sparkles size={20} /> : it.tone === 'bad' ? <X size={22} strokeWidth={3} /> : <CircleAlert size={22} />}
      </span>
      <span style={{ fontFamily: it.mono ? fontMono : fontUI, fontWeight: 700, fontSize: 25, whiteSpace: 'nowrap' }}>{it.label}</span>
      {it.auto ? <span style={{ padding: '3px 10px', borderRadius: 8, background: alpha(M.warn, 0.12), color: M.warn, fontFamily: fontUI, fontWeight: 700, fontSize: 17 }}>otomatik</span> : null}
      <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 800, fontSize: it.tone === 'brand' ? 22 : 20, letterSpacing: it.tone === 'brand' ? 0 : '0.04em', color: col, textAlign: 'right' }}>{it.value}</span>
    </div>
  );
}

const listOf = (scene: PlannedScene, g: Get, prefix: string) =>
  Object.keys(scene.items)
    .filter((k) => new RegExp(`^${prefix}\\d+$`).test(k))
    .map((k) => g(k));

/* ───────────── icerik turleri ───────────── */

/** AI Görünürlük: 6 asistan satiri (ornek olcum) */
function Engines({ g, scene, frame }: { g: Get; scene: PlannedScene; frame: number }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'e');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((a) => {
          const col = TONE[a.it.tone ?? 'none'];
          const shown = a.o > 0.01;
          return (
            <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 66, padding: '0 20px', borderRadius: 16, border: `1.5px solid ${M.hair}`, background: shown && a.it.tone !== 'none' ? alpha(col, 0.06) : M.paper, boxSizing: 'border-box' }}>
              <span style={{ width: 150, fontFamily: fontUI, fontWeight: 800, fontSize: 25, color: M.ink }}>{a.it.label}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 99, background: alpha(M.ink, 0.07) }}>
                <div style={{ height: 10, borderRadius: 99, width: `${Math.max(4, a.it.score ?? 0) * clamp01(a.p)}%`, background: a.it.tone === 'none' ? alpha(M.ink, 0.2) : col }} />
              </div>
              <span style={{ width: 210, textAlign: 'right', fontFamily: fontUI, fontWeight: 700, fontSize: 21, color: shown ? col : M.muted, opacity: shown ? a.o : 1 }}>
                {shown ? (
                  a.it.value
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Loader2 size={20} style={{ transform: `rotate(${frame * 10}deg)` }} />
                  </span>
                )}
              </span>
              <span style={{ width: 52, textAlign: 'right', fontFamily: fontDisplay, fontWeight: 700, fontSize: 26, opacity: a.o }}>{a.it.score}</span>
            </div>
          );
        })}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + rows.length * 76 + 10} /> : null}
    </>
  );
}

/** Site Skoru: skor kutusu + kontrol satirlari (VAR · EKSİK · YOK) */
function Scores({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const s = g('s1');
  const rows = listOf(scene, g, 'r');
  const val = Number(s.it.value ?? 0);
  const R = 92;
  const circ = 2 * Math.PI * R;
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: 270, height: 4 * 80 - 10, borderRadius: 22, border: `1.5px solid ${M.hair}`, background: M.cream, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, ...fade(s) }}>
        <div style={{ position: 'relative', width: 212, height: 212 }}>
          <svg width={212} height={212} style={{ position: 'absolute', inset: 0 }}>
            <circle cx={106} cy={106} r={R} fill="none" stroke={alpha(M.ink, 0.07)} strokeWidth={16} />
            <circle cx={106} cy={106} r={R} fill="none" stroke={brand[500]} strokeWidth={16} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - (val / 100) * clamp01(s.p))} transform="rotate(-90 106 106)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: fontDisplay, fontWeight: 800, fontSize: 76, letterSpacing: '-0.04em' }}>{s.it.value}</div>
        </div>
        <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 21, color: M.body }}>{s.text}</div>
      </div>
      <div style={{ position: 'absolute', left: 296, top, width: W - 296, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((a) => (
          <StatusRow key={a.it.id} a={a} />
        ))}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + 4 * 80 + 24} /> : null}
    </>
  );
}

/** Marka beyni gibi etiket–deger satirlari */
function Rows({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'r');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((a) => (
          <StatusRow key={a.it.id} a={a} height={84} />
        ))}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + rows.length * 96 + 12} /> : null}
    </>
  );
}

/** Icerik Firsatlari: kaybedilen sorgu → adimlar */
function Steps({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const q = g('query');
  const steps = listOf(scene, g, 's');
  const icons = [FileText, Send, Gauge];
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, borderRadius: 20, border: `1.5px solid ${alpha(M.warn, 0.35)}`, background: alpha(M.warn, 0.05), padding: '22px 26px', boxSizing: 'border-box', ...fade(q) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 20, color: M.warn }}>
          <CircleAlert size={22} /> Kaybedilen sorgu
        </div>
        <div style={{ marginTop: 10, fontFamily: fontUI, fontWeight: 700, fontSize: 30, lineHeight: 1.3, color: M.ink }}>{q.text}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: top + 210, width: W, display: 'flex', alignItems: 'center', gap: 12 }}>
        {steps.map((a, i) => {
          const Icon = icons[i % icons.length];
          return (
            <React.Fragment key={a.it.id}>
              {i > 0 ? <ArrowRight size={30} color={M.muted} style={{ opacity: a.o, flexShrink: 0 }} /> : null}
              <div style={{ flex: 1, height: 130, borderRadius: 20, border: `1.5px solid ${alpha(M.success, 0.35)}`, background: alpha(M.success, 0.06), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, ...fade(a) }}>
                <Icon size={32} color={M.success} />
                <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 25, color: M.ink, whiteSpace: 'nowrap' }}>{a.text}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}

/** Siralama tablosu (Search Console / ASO anahtar kelimeleri) */
function Ranks({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'k');
  const aso = scene.nav === 'aso';
  return (
    <div style={{ position: 'absolute', left: 0, top, width: W, borderRadius: 20, border: `1.5px solid ${M.hair}`, overflow: 'hidden', opacity: g('title').o }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 58, padding: '0 24px', background: M.fill, fontFamily: fontUI, fontWeight: 800, fontSize: 19, letterSpacing: '0.04em', textTransform: 'uppercase', color: M.muted }}>
        <span style={{ flex: 1 }}>{aso ? 'Anahtar kelime' : 'Sorgu'}</span>
        <span style={{ width: 120, textAlign: 'right' }}>Sıra</span>
        <span style={{ width: 150, textAlign: 'right' }}>Değişim</span>
      </div>
      {rows.map((a) => {
        const tr = a.it.trend ?? 'flat';
        const col = tr === 'up' ? M.success : tr === 'down' ? M.warn : M.muted;
        const Icon = tr === 'up' ? ArrowUpRight : tr === 'down' ? ArrowDownRight : Minus;
        return (
          <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', height: 84, padding: '0 24px', borderTop: `1px solid ${M.hair}`, ...fade(a, { transform: `translateX(${(1 - a.p) * 26}px)` }) }}>
            <span style={{ flex: 1, fontFamily: fontUI, fontWeight: 700, fontSize: 27 }}>{a.it.label}</span>
            <span style={{ width: 120, textAlign: 'right', fontFamily: fontDisplay, fontWeight: 700, fontSize: 32 }}>{a.it.value}</span>
            <span style={{ width: 150, display: 'flex', justifyContent: 'flex-end' }}>
              <span style={{ width: 46, height: 46, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(col, 0.12), color: col }}>
                <Icon size={26} strokeWidth={2.6} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Takili Sayfalar */
function Stuck({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'p');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((a) => (
          <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 84, padding: '0 22px', borderRadius: 18, border: `1.5px solid ${M.hair}`, background: M.paper, boxSizing: 'border-box', ...fade(a, { transform: `translateX(${(1 - a.p) * 26}px)` }) }}>
            <span style={{ fontFamily: fontMono, fontWeight: 600, fontSize: 24, color: M.ink }}>{a.it.label}</span>
            <span style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 10, background: alpha(M.warn, 0.12), color: M.warn, fontFamily: fontUI, fontWeight: 800, fontSize: 21 }}>{a.it.value}</span>
            <span style={{ padding: '10px 18px', borderRadius: 12, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 19 }}>İyileştir</span>
          </div>
        ))}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + rows.length * 96 + 16} /> : null}
    </>
  );
}

/** ASO Metadata: mevcut → AI onerisi, karakter sayaci */
function Compare({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'm');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((a) => {
          const it = a.it;
          const len = (it.value ?? '').length;
          return (
            <div key={it.id} style={{ borderRadius: 18, border: `1.5px solid ${M.hair}`, background: M.paper, padding: '14px 20px', ...fade(a) }}>
              <div style={{ display: 'flex', alignItems: 'center', fontFamily: fontUI, fontWeight: 800, fontSize: 21, color: M.muted }}>
                {it.label}
                <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontWeight: 700, fontSize: 19, color: len <= (it.limit ?? 999) ? M.success : '#B42318' }}>
                  {len}/{it.limit}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <span style={{ padding: '8px 14px', borderRadius: 12, background: M.fill, color: M.muted, fontFamily: it.mono ? fontMono : fontUI, fontWeight: 600, fontSize: 21, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{it.from}</span>
                <ArrowRight size={24} color={M.muted} style={{ flexShrink: 0 }} />
                <span style={{ padding: '8px 14px', borderRadius: 12, border: `2px solid ${alpha(M.success, 0.45)}`, background: alpha(M.success, 0.07), color: M.ink, fontFamily: it.mono ? fontMono : fontUI, fontWeight: 700, fontSize: it.mono ? 20 : 23, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.value}</span>
              </div>
            </div>
          );
        })}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + rows.length * 138 + 8} /> : null}
    </>
  );
}

/** Yorumlar: ornek yorum + AI taslak + onay */
function Review({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const r = g('review');
  const d = g('draft');
  const [label, ...rest] = d.text.split(': ');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, borderRadius: 20, border: `1.5px solid ${M.hair}`, background: M.cream, padding: '20px 24px', boxSizing: 'border-box', ...fade(r) }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={24} color={i < 3 ? brand[500] : alpha(M.ink, 0.2)} fill={i < 3 ? brand[500] : 'transparent'} />
          ))}
        </div>
        <div style={{ marginTop: 10, fontFamily: fontUI, fontWeight: 700, fontSize: 28, lineHeight: 1.3 }}>{r.text}</div>
      </div>
      <div style={{ position: 'absolute', left: 60, top: top + 168, width: W - 60, borderRadius: 20, border: `2px solid ${alpha(brand[500], 0.4)}`, background: alpha(brand[500], 0.06), padding: '18px 24px', boxSizing: 'border-box', ...fade(d) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: fontUI, fontWeight: 800, fontSize: 20, color: brand[700] }}>
          <Sparkles size={20} /> {label}
        </div>
        <div style={{ marginTop: 8, fontFamily: fontUI, fontWeight: 600, fontSize: 26, lineHeight: 1.3, color: M.inkSoft }}>{rest.join(': ')}</div>
      </div>
      {has(scene, 'callout') ? (
        <div style={{ position: 'absolute', left: 0, top: top + 346, width: W, ...fade(g('callout')) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderRadius: 18, background: M.fill, padding: '16px 22px', fontFamily: fontUI, fontWeight: 700, fontSize: 24, lineHeight: 1.3, color: M.inkSoft }}>
            <CheckSquare size={28} color={M.success} style={{ flexShrink: 0 }} />
            {g('callout').text}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 60, padding: '0 30px', borderRadius: 16, background: M.grad, color: 'white', fontFamily: fontDisplay, fontWeight: 700, fontSize: 24 }}>
              <Send size={22} /> Gönder
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Icerikler: 5 ajanli uretim hatti */
function Pipeline({ g, scene, frame }: { g: Get; scene: PlannedScene; frame: number }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const steps = listOf(scene, g, 'p');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((a, i) => {
          const done = a.o > 0.01;
          const next = steps[i + 1];
          const finished = done && (!next || next.o > 0.5 || has(scene, 'callout'));
          return (
            <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', gap: 16, height: 68, padding: '0 20px', borderRadius: 16, background: finished ? alpha(M.success, 0.07) : alpha(brand[500], 0.07), border: `1.5px solid ${finished ? alpha(M.success, 0.3) : alpha(brand[500], 0.3)}`, ...fade(a, { transform: `translateX(${(1 - a.p) * 26}px)` }) }}>
              <span style={{ width: 36, height: 36, borderRadius: 99, display: 'grid', placeItems: 'center', background: finished ? alpha(M.success, 0.14) : alpha(brand[500], 0.14), color: finished ? M.success : brand[600] }}>
                {finished ? <Check size={22} strokeWidth={3} /> : <Loader2 size={22} style={{ transform: `rotate(${frame * 10}deg)` }} />}
              </span>
              <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 25, color: M.ink }}>
                {i + 1}. {a.text}
              </span>
            </div>
          );
        })}
      </div>
      {has(scene, 'callout') ? (
        <div style={{ position: 'absolute', left: 0, top: top + steps.length * 78 + 14, ...fade(g('callout')) }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderRadius: 999, background: alpha(M.success, 0.12), color: M.success, fontFamily: fontUI, fontWeight: 800, fontSize: 26 }}>
            <ShieldCheck size={28} /> {g('callout').text}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Otomatik Akis: iki mod karti + yayin hedefleri */
function Modes({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const modes = listOf(scene, g, 'm');
  const targets = g('targets');
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {modes.map((a, i) => (
          <div key={a.it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 22px', borderRadius: 18, border: `2px solid ${i === 0 ? alpha(brand[500], 0.5) : M.hair}`, background: i === 0 ? alpha(brand[500], 0.06) : M.paper, ...fade(a) }}>
            <span style={{ marginTop: 4, width: 26, height: 26, borderRadius: 99, border: `2.5px solid ${i === 0 ? brand[600] : M.hairStrong}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              {i === 0 ? <span style={{ width: 13, height: 13, borderRadius: 99, background: brand[600] }} /> : null}
            </span>
            <div>
              <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 27 }}>{a.it.label}</div>
              <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 22, color: M.body, marginTop: 4, lineHeight: 1.3 }}>{a.it.value}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, top: top + 262, width: W, ...fade(targets) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontUI, fontWeight: 800, fontSize: 20, color: M.muted }}>
          <Send size={20} color={brand[600]} /> Yayın Hedefleri
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {targets.text.split(' · ').map((t) => (
            <span key={t} style={{ padding: '8px 16px', borderRadius: 12, border: `1.5px solid ${M.hair}`, background: M.paper, fontFamily: fontUI, fontWeight: 700, fontSize: 21, color: M.inkSoft }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + 420} /> : null}
    </>
  );
}

/** Videolar: uc kaynak karti */
function Sources({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const cards = listOf(scene, g, 'c');
  const icons = [FileText, Globe, Package];
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cards.map((a, i) => {
          const Icon = icons[i % icons.length];
          return (
            <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', gap: 18, height: 96, padding: '0 24px', borderRadius: 18, border: `1.5px solid ${M.hair}`, background: M.paper, ...fade(a, { transform: `translateX(${(1 - a.p) * 26}px)` }) }}>
              <span style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: alpha(brand[500], 0.12), color: brand[600] }}>
                <Icon size={28} />
              </span>
              <div>
                <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 27 }}>{a.text}</div>
                <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 21, color: M.body, marginTop: 2 }}>{a.it.sub}</div>
              </div>
              <span style={{ marginLeft: 'auto', padding: '10px 18px', borderRadius: 12, background: M.grad, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 19 }}>Video üret</span>
            </div>
          );
        })}
      </div>
      {has(scene, 'callout') ? <Callout a={g('callout')} top={top + cards.length * 108 + 12} /> : null}
    </>
  );
}

/** Aylik video hakki (plans.ts VIDEOS_PER_MONTH) */
function Quota({ g, scene }: { g: Get; scene: PlannedScene }) {
  const W = React.useContext(PageWidth);
  const top = headerH(scene);
  const rows = listOf(scene, g, 'q');
  return (
    <div style={{ position: 'absolute', left: 0, top, width: W, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((a, i) => (
        <div key={a.it.id} style={{ display: 'flex', alignItems: 'center', gap: 18, height: 108, padding: '0 28px', borderRadius: 20, border: `${i === 0 ? 2 : 1.5}px solid ${i === 0 ? alpha(brand[500], 0.5) : M.hair}`, background: i === 0 ? alpha(brand[500], 0.06) : M.paper, ...fade(a) }}>
          <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 30 }}>{a.it.label}</span>
          <span style={{ marginLeft: 'auto', fontFamily: fontDisplay, fontWeight: 800, fontSize: 54, letterSpacing: '-0.03em', color: i === 0 ? brand[700] : M.ink }}>{a.it.value}</span>
          <span style={{ width: 150, fontFamily: fontUI, fontWeight: 700, fontSize: 22, color: M.body }}>video / ay</span>
        </div>
      ))}
    </div>
  );
}

export function PageContent({ g, scene, frame }: { g: Get; scene: PlannedScene; frame: number }) {
  const c = scene.content;
  return (
    <div lang="tr" style={{ position: 'absolute', inset: 0 }}>
      <Header g={g} scene={scene} />
      {c === 'engines' ? <Engines g={g} scene={scene} frame={frame} /> : null}
      {c === 'scores' ? <Scores g={g} scene={scene} /> : null}
      {c === 'rows' ? <Rows g={g} scene={scene} /> : null}
      {c === 'steps' ? <Steps g={g} scene={scene} /> : null}
      {c === 'ranks' ? <Ranks g={g} scene={scene} /> : null}
      {c === 'stuck' ? <Stuck g={g} scene={scene} /> : null}
      {c === 'compare' ? <Compare g={g} scene={scene} /> : null}
      {c === 'review' ? <Review g={g} scene={scene} /> : null}
      {c === 'pipeline' ? <Pipeline g={g} scene={scene} frame={frame} /> : null}
      {c === 'modes' ? <Modes g={g} scene={scene} /> : null}
      {c === 'sources' ? <Sources g={g} scene={scene} /> : null}
      {c === 'quota' ? <Quota g={g} scene={scene} /> : null}
    </div>
  );
}
