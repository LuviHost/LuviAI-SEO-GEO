/**
 * RanksUp "Basamak" marka logosu.
 *  - BrandLogo: kare işaret (yükselen ok, flat turuncu squircle) — favicon/app icon ile aynı.
 *  - BrandWordmark: "Ranks" + gömülü yükselen ok + "Up" logotype.
 *
 * Palet (kanonik): turuncu #E04E24 · turuncu-bright #F1652F · ink #171310 · bone #F6F3EC
 */

export function BrandLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`rounded-[29%] ${className}`}
      aria-label="RanksUp"
      role="img"
    >
      <rect width="100" height="100" rx="29" fill="#E04E24" />
      {/* Yükselen ok (Basamak işareti) */}
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
  const arrow = size * 0.6;
  // reversed: zemin her zaman koyu (ink) → bone + turuncu-bright sabit.
  // normal: tema-farkında — açıkta ink #171310, koyu temada bone #F6F3EC (text-ink dark:text-bone).
  const inkClass = reversed ? 'text-[#F6F3EC]' : 'text-ink dark:text-bone';
  const accentClass = reversed ? 'text-[#F1652F]' : 'text-brand dark:text-brand-400';
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap ${className}`}
      style={{
        fontFamily: "var(--font-sora), 'Sora', system-ui, sans-serif",
        fontWeight: 700, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1,
      }}
      aria-label="RanksUp"
    >
      <span className={inkClass}>Ranks</span>
      <svg
        width={arrow}
        height={arrow}
        viewBox="0 0 40 40"
        fill="none"
        className={accentClass}
        style={{ margin: `0 ${size * -0.015}px 0 ${size * 0.03}px` }}
        aria-hidden="true"
      >
        <path d="M10 30 L30 10" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M17 8.5 L31.5 8.5 L31.5 23" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span className={accentClass}>Up</span>
    </span>
  );
}
