/**
 * RanksUp marka logosu — turuncu squircle + yukarı ok + kıvılcımlar.
 * Tek SVG; favicon.svg ile birebir aynı tasarım.
 *
 * Kullanım:
 *   <BrandLogo size={32} />
 *   <BrandLogo size={24} className="rounded-md" />
 */
export function BrandLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shadow-lg shadow-orange-500/20 rounded-[22%] ${className}`}
      aria-label="RanksUp"
      role="img"
    >
      <defs>
        <linearGradient id="ranksup-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7a45" />
          <stop offset="1" stopColor="#c2410e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#ranksup-grad)" />
      <g fill="#ffffff">
        {/* Yukarı ok */}
        <path d="M200 126 L130 260 L270 260 Z" />
        <rect x="171" y="250" width="58" height="150" rx="16" />
        {/* Kıvılcımlar (4 köşeli yıldız) */}
        <path d="M352 128 Q352 170 394 170 Q352 170 352 212 Q352 170 310 170 Q352 170 352 128 Z" />
        <path d="M410 238 Q410 262 434 262 Q410 262 410 286 Q410 262 386 262 Q410 262 410 238 Z" />
        <path d="M398 96 Q398 112 414 112 Q398 112 398 128 Q398 112 382 112 Q398 112 398 96 Z" />
      </g>
    </svg>
  );
}
