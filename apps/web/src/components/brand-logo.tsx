/**
 * RanksUp "Bridge" marka logosu.
 *  - BrandLogo: kare işaret (yükselen ok, gradient squircle) — favicon/app icon ile aynı.
 *  - BrandWordmark: "Ranks" + gömülü yükselen ok + "Up" logotype.
 *
 * Palet: primary #E04E24 · deep #AF2C1F · ink #271610 · grad #F36D32→#B63325
 */

export function BrandLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shadow-lg shadow-[#c2410e]/25 rounded-[29%] ${className}`}
      aria-label="RanksUp"
      role="img"
    >
      <defs>
        <linearGradient id="ru-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F36D32" />
          <stop offset="1" stopColor="#B63325" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="29" fill="url(#ru-tile)" />
      {/* Yükselen ok (Bridge işareti) */}
      <g transform="translate(20,20) scale(0.6)" fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round">
        <path d="M28 72 L72 28" />
        <path d="M40 26 L74 26 L74 60" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function BrandWordmark({
  size = 28,
  reversed = false,
  className = '',
}: { size?: number; reversed?: boolean; className?: string }) {
  const ink = reversed ? '#ffffff' : '#271610';
  const accent = reversed ? '#F47F46' : '#E04E24';
  const arrow = size * 0.6;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: "var(--font-sora), 'Sora', system-ui, sans-serif",
        fontWeight: 700, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, whiteSpace: 'nowrap',
      }}
      aria-label="RanksUp"
    >
      <span style={{ color: ink }}>Ranks</span>
      <svg width={arrow} height={arrow} viewBox="0 0 40 40" fill="none" style={{ margin: `0 ${size * -0.015}px 0 ${size * 0.03}px` }} aria-hidden="true">
        <path d="M10 30 L30 10" stroke={accent} strokeWidth="5.5" strokeLinecap="round" />
        <path d="M17 8.5 L31.5 8.5 L31.5 23" stroke={accent} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span style={{ color: accent }}>Up</span>
    </span>
  );
}
