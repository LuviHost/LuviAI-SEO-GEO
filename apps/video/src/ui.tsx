import React from 'react';
import { interpolate, Easing } from 'remotion';
import { alpha, brand, fontSans, logo, type Theme } from './tokens';

/** 0..1 arasi kirpilmis interpolate — kompozisyonlarda en cok kullanilan kalip */
export function progress(frame: number, start: number, end: number, ease = Easing.out(Easing.cubic)): number {
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
}

export function Card({
  theme,
  style,
  children,
}: {
  theme: Theme;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: theme.card,
        border: `1.5px solid ${theme.border}`,
        borderRadius: 20,
        padding: 26,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({
  color,
  children,
  style,
}: {
  color: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: alpha(color, 0.14),
        color,
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * "Ranks ↗ Up" logotype — apps/web/src/components/brand-logo.tsx BrandWordmark'in
 * birebir kopyasi (Next bileseni import edilmez; Remotion paketi bagimsiz).
 */
export function Wordmark({ size = 48, theme }: { size?: number; theme: Theme }) {
  const reversed = theme.name === 'dark';
  const ink = reversed ? logo.inkReversed : logo.ink;
  const accent = reversed ? logo.accentReversed : logo.accent;
  const arrow = size * 0.6;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: `'Sora', ${fontSans}`,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: ink }}>Ranks</span>
      <svg width={arrow} height={arrow} viewBox="0 0 40 40" fill="none" style={{ margin: `0 ${size * -0.015}px 0 ${size * 0.03}px` }}>
        <path d="M10 30 L30 10" stroke={accent} strokeWidth="5.5" strokeLinecap="round" />
        <path d="M17 8.5 L31.5 8.5 L31.5 23" stroke={accent} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span style={{ color: accent }}>Up</span>
    </span>
  );
}

/** Kare marka isareti (favicon ile ayni) */
export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ filter: `drop-shadow(0 ${size * 0.12}px ${size * 0.25}px ${alpha(brand[700], 0.3)})` }}>
      <defs>
        <linearGradient id="ru-tile-video" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={logo.gradFrom} />
          <stop offset="1" stopColor={logo.gradTo} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="29" fill="url(#ru-tile-video)" />
      <g transform="translate(20,20) scale(0.6)" fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round">
        <path d="M28 72 L72 28" />
        <path d="M40 26 L74 26 L74 60" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Ekranin altinda altyazi seridi (seslendirme yok — metin ekranda) */
export function Caption({ text, opacity, theme }: { text: string; opacity: number; theme: Theme }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 64,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        transform: `translateY(${(1 - opacity) * 12}px)`,
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          padding: '18px 34px',
          borderRadius: 18,
          background: theme.name === 'dark' ? 'rgba(2, 6, 23, 0.78)' : 'rgba(15, 23, 42, 0.86)',
          color: 'white',
          fontFamily: fontSans,
          fontSize: 40,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: 'center',
          letterSpacing: '-0.01em',
        }}
      >
        {text}
      </div>
    </div>
  );
}
