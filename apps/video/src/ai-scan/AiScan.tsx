import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { alpha, fontMono, fontSans, type ThemeName } from '../tokens';

/**
 * AiScan — ~7 sn, parametrik "markan AI motorlarinda" ozeti.
 *
 * inputProps:
 *   domain  — test edilen alan adi (erisilebilirlik etiketi)
 *   score   — 0-100 gorunurluk skoru (rakam buna sayar)
 *   engines — (istege bagli) motor bazinda gercek sonuc. Verilmezse 7 varsayilan
 *             etiket kullanilir ve "anildi" sayisi skordan turetilir.
 *   theme   — 'light' | 'dark'
 *   locale  — 'tr' | 'en' (ekrandaki etiketler)
 *
 * Landing'de @remotion/player ile, kullanici alan adi testini GONDERDIKTEN sonra
 * gercek sonucla oynatilir (ilk yukleme paketine girmez). Logo kullanilmaz —
 * yalniz metin etiketler.
 *
 * GORUNUM (15.11.2026): sitenin vitrin dili — notr zemin, ince cizgi, golge ve
 * degrade YOK, buyuk ince rakam, mono etiket; renk yalniz durum bildirir (anildi
 * = yesil). Eski hali lacivert zemin + turuncu degrade kure + golgeydi; koyu
 * vitrine gecince (11.11.2026) siyah sayfanin icinde yabanci duruyordu.
 *
 * PALET: apps/web/src/app/globals.css'teki :root / .dark degerleriyle AYNI
 * tutulur (zemin = kart rengi; oynatici bir kartin icinde durur). tokens.ts'teki
 * `themes` musteri videolarinin paletidir, bu kompozisyon ONU KULLANMAZ.
 *
 * ETIKET UZUNLUGU: kutular icerige gore genisler ve satir kirmaz. Eskiden sabit
 * 172px kutuya "Anthropic Claude" gibi iki kelimelik ad sigmiyor, yazi kutunun
 * disina tasiyordu.
 */

export type AiScanEngine = { label: string; cited: boolean };

export type AiScanProps = {
  domain: string;
  score: number;
  engines?: AiScanEngine[];
  theme?: ThemeName;
  locale?: 'tr' | 'en';
};

type ScanTheme = {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
};

/** globals.css :root ve .dark (zemin = --card) */
const SCAN_THEMES: Record<ThemeName, ScanTheme> = {
  light: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(0 0% 7%)',
    muted: 'hsl(0 0% 96%)',
    mutedForeground: 'hsl(0 0% 40%)',
    border: 'hsl(0 0% 89%)',
    success: 'hsl(152 61% 34%)',
    warning: 'hsl(32 95% 40%)',
    danger: 'hsl(0 72% 48%)',
  },
  dark: {
    background: 'hsl(0 0% 6.5%)',
    foreground: 'hsl(0 0% 97%)',
    muted: 'hsl(0 0% 11%)',
    mutedForeground: 'hsl(30 4% 64%)',
    border: 'hsl(0 0% 17%)',
    success: 'hsl(152 55% 52%)',
    warning: 'hsl(38 92% 58%)',
    danger: 'hsl(0 84% 66%)',
  },
};

// Cumle duzeni: CSS/JS buyuk harf yok (EN'de "i" → "İ" hatasi, globals.css .v-rail notu)
const LABELS = {
  tr: { cited: 'Anıldı', notCited: 'Anılmadı', score: 'skor / 100', summary: (n: number, k: number) => [`${n} AI motorunun `, `${k}`, ' tanesinde anıldın'] },
  en: { cited: 'Cited', notCited: 'Not cited', score: 'score / 100', summary: (n: number, k: number) => [`Cited by `, `${k}`, ` of ${n} AI engines`] },
} as const;

export const AI_SCAN_FPS = 30;
export const AI_SCAN_DURATION = 200;
export const AI_SCAN_WIDTH = 1280;
export const AI_SCAN_HEIGHT = 520;

export const DEFAULT_ENGINES = ['ChatGPT', 'Gemini', 'Claude', 'Perplexity', 'Copilot', 'Grok', 'DeepSeek'];

export function resolveEngines(score: number, engines?: AiScanEngine[]): AiScanEngine[] {
  if (engines && engines.length > 0) return engines.slice(0, 8);
  const citedCount = Math.round((clampScore(score) / 100) * DEFAULT_ENGINES.length);
  return DEFAULT_ENGINES.map((label, i) => ({ label, cited: i < citedCount }));
}

function clampScore(s: number) {
  return Math.max(0, Math.min(100, Number.isFinite(s) ? s : 0));
}

const CX = AI_SCAN_WIDTH / 2;
const CY = 232;
/** Yatayda genis elips: genis ve alcak kareye oturur */
const RX = 452;
const RY = 166;
/** Merkez halkasi */
const R = 102;

/** Isinlarin baslangici ve suresi (kare) */
const BEAM_START = 14;
const BEAM_GAP = 9;
const BEAM_LEN = 16;
/** Rakam bu karede saymaya baslar (en fazla 8 motorun isini bittikten sonra) */
const COUNT_FROM = 100;
const COUNT_TO = 150;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const AiScan: React.FC<AiScanProps> = ({ domain, score, engines, theme: themeName = 'light', locale = 'tr' }) => {
  const theme = SCAN_THEMES[themeName];
  const L = LABELS[locale];
  const frame = useCurrentFrame();
  const list = resolveEngines(score, engines);
  const target = clampScore(score);
  const citedTotal = list.filter((e) => e.cited).length;

  const gaugeP = interpolate(frame, [COUNT_FROM, COUNT_TO], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const shown = Math.round(target * gaugeP);
  const numberIn = interpolate(frame, [COUNT_FROM - 6, COUNT_FROM + 4], [0, 1], clamp);
  const summaryP = interpolate(frame, [COUNT_TO, COUNT_TO + 16], [0, 1], clamp);
  const circ = 2 * Math.PI * R;
  const gaugeColor = target >= 60 ? theme.success : target >= 30 ? theme.warning : theme.danger;
  const [pre, count, post] = L.summary(list.length, citedTotal);

  return (
    <AbsoluteFill
      aria-label={`${domain}: ${pre}${count}${post}`}
      style={{
        background: theme.background,
        // Tarayicida sitenin kendi fontu (next/font degiskeni); render ortaminda yedek yigin
        fontFamily: `var(--font-sans, ${fontSans})`,
        color: theme.foreground,
        overflow: 'hidden',
      }}
    >
      <svg width={AI_SCAN_WIDTH} height={AI_SCAN_HEIGHT} style={{ position: 'absolute', inset: 0 }}>
        {/* Yorunge — ince kesik cizgi, yavas doner */}
        <ellipse
          cx={CX}
          cy={CY}
          rx={RX}
          ry={RY}
          fill="none"
          stroke={theme.border}
          strokeWidth={1}
          strokeDasharray="3 9"
          strokeDashoffset={-frame * 0.4}
        />
        {list.map((e, i) => {
          const { x, y } = pos(i, list.length);
          const start = BEAM_START + i * BEAM_GAP;
          const beam = interpolate(frame, [start, start + BEAM_LEN], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
          const settled = frame > start + BEAM_LEN;
          // Isin merkez halkasinin kenarindan baslar (rakamin ustunden gecmez)
          const dx = x - CX;
          const dy = y - CY;
          const len = Math.hypot(dx, dy) || 1;
          const sx = CX + (dx / len) * (R + 12);
          const sy = CY + (dy / len) * (R + 12);
          const hx = sx + (x - sx) * beam;
          const hy = sy + (y - sy) * beam;
          return (
            <g key={e.label}>
              <line
                x1={sx}
                y1={sy}
                x2={hx}
                y2={hy}
                stroke={settled ? (e.cited ? theme.success : theme.border) : theme.foreground}
                strokeOpacity={settled ? (e.cited ? 0.75 : 1) : 0.55}
                strokeWidth={settled && e.cited ? 1.5 : 1}
                strokeDasharray={settled && !e.cited ? '3 7' : undefined}
              />
              {beam > 0 && beam < 1 && <circle cx={hx} cy={hy} r={3.5} fill={theme.foreground} />}
            </g>
          );
        })}
        {/* Merkez halkasi: ince iz + skor yayi */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={theme.border} strokeWidth={1} />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={gaugeColor}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - (target / 100) * gaugeP)}
          transform={`rotate(-90 ${CX} ${CY})`}
          opacity={gaugeP > 0 && target > 0 ? 1 : 0}
        />
      </svg>

      {/* Merkez: buyuk ince rakam + mono etiket */}
      <div
        style={{
          position: 'absolute',
          left: CX - R,
          top: CY - R,
          width: R * 2,
          height: R * 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 84,
            fontWeight: 450,
            letterSpacing: '-0.06em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            opacity: numberIn,
          }}
        >
          {shown}
        </div>
        <div
          style={{
            fontFamily: `var(--font-mono, ${fontMono})`,
            fontSize: 14,
            letterSpacing: '0.01em',
            color: theme.mutedForeground,
            marginTop: 8,
          }}
        >
          {L.score}
        </div>
      </div>

      {/* Motor dugumleri — duz kutu, icerige gore genisler */}
      {list.map((e, i) => {
        const { x, y } = pos(i, list.length);
        const start = BEAM_START + i * BEAM_GAP;
        const settled = frame > start + BEAM_LEN;
        const ok = settled && e.cited;
        return (
          <div
            key={e.label}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              minWidth: 136,
              padding: '10px 18px',
              borderRadius: 8,
              background: ok ? mix(theme.success, theme.background, 0.1) : theme.muted,
              border: `1px solid ${ok ? alpha(theme.success, 0.5) : theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              opacity: interpolate(frame, [i * 3, i * 3 + 10], [0, 1], clamp),
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{e.label}</div>
            <div
              style={{
                fontFamily: `var(--font-mono, ${fontMono})`,
                fontSize: 13,
                lineHeight: 1.3,
                color: e.cited ? theme.success : theme.mutedForeground,
                opacity: settled ? 1 : 0,
                marginTop: 2,
              }}
            >
              {e.cited ? L.cited : L.notCited}
            </div>
          </div>
        );
      })}

      {/* Ozet */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 30,
          textAlign: 'center',
          fontSize: 20,
          fontWeight: 450,
          letterSpacing: '-0.02em',
          color: theme.mutedForeground,
          opacity: summaryP,
        }}
      >
        {pre}
        <span style={{ color: theme.foreground, fontWeight: 500 }}>{count}</span>
        {post}
      </div>
    </AbsoluteFill>
  );
};

function pos(i: number, n: number) {
  const angle = ((-90 + (360 / n) * i) * Math.PI) / 180;
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
}

/**
 * Iki hsl(...) rengini OPAK karistirir (a'dan `t` kadar, b'den 1-t). Kutunun
 * zemini opak olmali: yari saydam zemin, arkasindan gecen isin cizgisini gosterir.
 */
function mix(a: string, b: string, t: number): string {
  const pa = parseHsl(a);
  const pb = parseHsl(b);
  if (!pa || !pb) return b;
  // Notr zeminle karisim: ton durum renginden, doygunluk ve aciklik agirlikli
  const s = pa.s * t + pb.s * (1 - t);
  const l = pa.l * t + pb.l * (1 - t);
  return `hsl(${pa.h} ${round(s)}% ${round(l)}%)`;
}

function parseHsl(c: string): { h: number; s: number; l: number } | null {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(c);
  return m ? { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) } : null;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
