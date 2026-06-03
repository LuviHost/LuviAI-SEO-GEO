import { Sparkles } from 'lucide-react';

/**
 * RanksUp marka logosu — turuncu gradient kutu + Sparkles ikonu.
 * Tüm yerlerde tutarlı görünüm için.
 *
 * Kullanım:
 *   <BrandLogo size={32} />
 *   <BrandLogo size={24} className="rounded-md" />
 */
export function BrandLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const iconSize = Math.round(size * 0.5);
  return (
    <span
      className={`bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-lg grid place-items-center shadow-lg shadow-orange-500/20 ${className}`}
      style={{ width: size, height: size }}
      aria-label="RanksUp"
    >
      <Sparkles style={{ width: iconSize, height: iconSize }} />
    </span>
  );
}
