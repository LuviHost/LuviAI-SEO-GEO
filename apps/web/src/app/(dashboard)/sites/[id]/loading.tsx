'use client';

/**
 * Next.js App Router otomatik loading boundary.
 * /sites/[id] sayfasi yuklenirken gosterilir.
 * Dashboard'daki SiteCard "leaving" animasyonu ile uyumlu — brand glow + skeleton.
 */
export default function SitesIdLoading() {
  return (
    <div className="relative min-h-[60vh] space-y-8 animate-[fadeInUp_300ms_ease-out_both]">
      {/* Background brand glow */}
      <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-brand/15 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 right-0 h-72 w-72 rounded-full bg-violet-500/10 blur-[120px]" />

      {/* Header skeleton */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand font-semibold">
            Site agent yükleniyor…
          </span>
        </div>
        <div className="h-9 w-72 max-w-full rounded-md bg-muted/40 animate-pulse" />
        <div className="h-4 w-48 max-w-full rounded bg-muted/40 animate-pulse mt-3" />
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-3 border-b">
        {[60, 90, 60, 75, 90, 60].map((w, i) => (
          <div
            key={i}
            className="h-9 rounded-t bg-muted/30 animate-pulse"
            style={{ width: `${w}px`, animationDelay: `${i * 50}ms` }}
          />
        ))}
      </div>

      {/* Content skeleton — KPI grid + content blocks */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-xl border bg-card relative overflow-hidden"
            style={{ animation: `fadeInUp 400ms ease-out ${i * 60 + 100}ms both` }}
          >
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 rounded-xl border bg-card relative overflow-hidden"
            style={{ animation: `fadeInUp 400ms ease-out ${i * 80 + 240}ms both` }}
          >
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
          </div>
        ))}
      </div>

      {/* Center pulsating brand orb (extra polish) */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-brand/30 blur-2xl animate-ping" />
          <span className="relative block h-10 w-10 rounded-full bg-gradient-to-br from-brand to-violet-500 shadow-[0_0_40px_rgb(124_58_237/0.6)]" />
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
