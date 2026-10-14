import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { alpha, brand, fontSans, themes, type ThemeName } from '../tokens';

/**
 * AiScan — 10 sn, parametrik "markan AI motorlarinda" ozeti.
 *
 * inputProps:
 *   domain  — test edilen alan adi (merkezde)
 *   score   — 0-100 gorunurluk skoru (gosterge buna sayar)
 *   engines — (istege bagli) motor bazinda gercek sonuc. Verilmezse 7 varsayilan
 *             etiket kullanilir ve "anildi" sayisi skordan turetilir.
 *   theme   — 'light' | 'dark'
 *   locale  — 'tr' | 'en' (ekrandaki etiketler)
 *
 * Landing'de @remotion/player ile, kullanici alan adi testini GONDERDIKTEN sonra
 * gercek sonucla oynatilir (ilk yukleme paketine girmez). Logo kullanilmaz —
 * yalniz metin etiketler.
 */

export type AiScanEngine = { label: string; cited: boolean };

export type AiScanProps = {
  domain: string;
  score: number;
  engines?: AiScanEngine[];
  theme?: ThemeName;
  locale?: 'tr' | 'en';
};

const LABELS = {
  tr: { cited: 'Anıldı', notCited: 'Anılmadı', score: 'SKOR / 100', summary: (n: number, k: number) => [`${n} AI motorunun `, `${k}`, ' tanesinde anıldın'] },
  en: { cited: 'Cited', notCited: 'Not cited', score: 'SCORE / 100', summary: (n: number, k: number) => [`Cited by `, `${k}`, ` of ${n} AI engines`] },
} as const;

export const AI_SCAN_FPS = 30;
export const AI_SCAN_DURATION = 300;
export const AI_SCAN_WIDTH = 1280;
export const AI_SCAN_HEIGHT = 720;

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
const CY = AI_SCAN_HEIGHT / 2 - 10;
const ORBIT = 250;
/** Yatayda genis elips: 16:9 kareye daha iyi oturur */
const STRETCH = 1.55;

export const AiScan: React.FC<AiScanProps> = ({ domain, score, engines, theme: themeName = 'light', locale = 'tr' }) => {
  const theme = themes[themeName];
  const L = LABELS[locale];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const list = resolveEngines(score, engines);
  const target = clampScore(score);
  const citedTotal = list.filter((e) => e.cited).length;

  const centerIn = spring({ frame, fps, config: { damping: 14 } });
  const gaugeP = interpolate(frame, [150, 235], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const shown = Math.round(target * gaugeP);
  const summaryP = interpolate(frame, [240, 262], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const R = 92;
  const circ = 2 * Math.PI * R;
  const gaugeColor = target >= 60 ? theme.success : target >= 30 ? theme.warning : theme.danger;

  return (
    <AbsoluteFill style={{ background: theme.background, fontFamily: fontSans, color: theme.foreground, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(520px 520px at 50% 48%, ${alpha(brand[500], theme.name === 'dark' ? 0.16 : 0.09)}, transparent 70%)` }}
      />
      <svg width={AI_SCAN_WIDTH} height={AI_SCAN_HEIGHT} style={{ position: 'absolute', inset: 0 }}>
        {/* Yorunge halkasi — yavas doner */}
        <ellipse
          cx={CX}
          cy={CY}
          rx={ORBIT * STRETCH}
          ry={ORBIT}
          fill="none"
          stroke={alpha(brand[500], 0.25)}
          strokeWidth={1.5}
          strokeDasharray="5 9"
          strokeDashoffset={-frame * 0.6}
        />
        <ellipse cx={CX} cy={CY} rx={ORBIT * STRETCH * 0.62} ry={ORBIT * 0.62} fill="none" stroke={theme.border} strokeWidth={1.5} />
        {list.map((e, i) => {
          const { x, y } = pos(i, list.length);
          const start = 30 + i * 12;
          const beam = interpolate(frame, [start, start + 22], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.inOut(Easing.quad),
          });
          const settled = frame > start + 22;
          const color = settled ? (e.cited ? theme.success : theme.mutedForeground) : brand[500];
          // Isin ucundaki parlak nokta
          const hx = CX + (x - CX) * beam;
          const hy = CY + (y - CY) * beam;
          return (
            <g key={e.label}>
              <line
                x1={CX}
                y1={CY}
                x2={hx}
                y2={hy}
                stroke={color}
                strokeOpacity={settled ? (e.cited ? 0.6 : 0.2) : 0.85}
                strokeWidth={settled && e.cited ? 3 : 2}
                strokeDasharray={settled && !e.cited ? '4 8' : undefined}
              />
              {beam > 0 && beam < 1 && <circle cx={hx} cy={hy} r={6} fill={brand[500]} />}
            </g>
          );
        })}
        {/* Merkez gosterge */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={theme.muted} strokeWidth={14} />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={frame < 150 ? brand[500] : gaugeColor}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - (target / 100) * gaugeP)}
          transform={`rotate(-90 ${CX} ${CY})`}
          opacity={centerIn}
        />
      </svg>

      {/* Merkez: alan adi + skor */}
      <div
        style={{
          position: 'absolute',
          left: CX - 78,
          top: CY - 78,
          width: 156,
          height: 156,
          borderRadius: 999,
          background: `linear-gradient(135deg, ${brand[500]}, ${brand[700]})`,
          boxShadow: `0 18px 48px ${alpha(brand[500], 0.4)}`,
          display: 'grid',
          placeItems: 'center',
          transform: `scale(${centerIn})`,
          color: 'white',
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 50, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {frame < 150 ? '…' : shown}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.9, marginTop: 6 }}>{L.score}</div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: CY + 102,
          textAlign: 'center',
          fontSize: 24,
          fontWeight: 700,
          opacity: centerIn,
        }}
      >
        {domain}
      </div>

      {/* Motor dugumleri */}
      {list.map((e, i) => {
        const { x, y } = pos(i, list.length);
        const start = 30 + i * 12;
        const arrive = spring({ frame: frame - (start + 20), fps, config: { damping: 12 } });
        const settled = frame > start + 22;
        const ring = settled ? (e.cited ? theme.success : theme.border) : alpha(brand[500], 0.5);
        return (
          <div
            key={e.label}
            style={{
              position: 'absolute',
              left: x - 86,
              top: y - 34,
              width: 172,
              height: 68,
              borderRadius: 18,
              background: theme.card,
              border: `2.5px solid ${ring}`,
              boxShadow: settled && e.cited ? `0 8px 26px ${alpha(theme.success, 0.25)}` : '0 6px 18px rgba(15,23,42,0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${0.85 + 0.15 * Math.min(1, arrive)})`,
              opacity: interpolate(frame, [i * 4, i * 4 + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{e.label}</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
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
          bottom: 26,
          textAlign: 'center',
          fontSize: 26,
          fontWeight: 600,
          opacity: summaryP,
          transform: `translateY(${(1 - summaryP) * 10}px)`,
        }}
      >
        {(() => {
          const [pre, count, post] = L.summary(list.length, citedTotal);
          return (
            <>
              {pre}
              <span style={{ color: brand[600], fontWeight: 800 }}>{count}</span>
              {post}
            </>
          );
        })()}
      </div>
    </AbsoluteFill>
  );
};

function pos(i: number, n: number) {
  const angle = ((-90 + (360 / n) * i) * Math.PI) / 180;
  return { x: CX + ORBIT * STRETCH * Math.cos(angle), y: CY + ORBIT * Math.sin(angle) };
}

