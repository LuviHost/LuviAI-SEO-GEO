import { BrandWordmark } from '@/components/brand-logo';
import { cn } from '@/lib/utils';

/**
 * BrandLockup — ortaklık kartı: ink zemin, ortada "Ranks↗Up × {partner}".
 * × işareti muted, partner logosu/adı bone. FLAT, 1px border, 14px radius.
 */
export function BrandLockup({
  partner,
  partnerLogo,
  className,
}: {
  partner: string;
  partnerLogo?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center gap-4 rounded-[14px] border border-bone/[0.13] bg-ink px-8 py-6 text-bone',
        className,
      )}
    >
      <BrandWordmark size={24} reversed />
      <span aria-hidden="true" className="font-brandDisplay text-lg font-semibold text-[#A99F92]">
        ×
      </span>
      {partnerLogo ? (
        <span className="inline-flex items-center gap-2">
          {partnerLogo}
          <span className="sr-only">{partner}</span>
        </span>
      ) : (
        <span className="font-brandDisplay text-xl font-bold tracking-[-0.02em] text-bone">
          {partner}
        </span>
      )}
    </div>
  );
}
