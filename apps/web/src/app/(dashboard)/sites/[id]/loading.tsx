'use client';

import { Rocket } from 'lucide-react';

/**
 * Next.js App Router otomatik loading boundary.
 * /sites/[id] yuklenirken gosterilir.
 * Dashboard'daki PageTransitionOverlay ile gorsel sureklilik (orbital + brand orb)
 * sagladigindan kullanici sahnenin kesintisiz devam ettigini hisseder.
 */
export default function SitesIdLoading() {
  return (
    <div className="relative min-h-[80vh] grid place-items-center">
      {/* Background gradient mesh */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-1/4 left-1/2 -translate-x-1/2 h-[120vh] w-[120vh] rounded-full bg-brand/15 blur-[120px]"
          style={{ animation: 'orbBreathe 2.4s ease-in-out infinite' }}
        />
        <div
          className="absolute top-1/3 left-1/4 h-72 w-72 rounded-full bg-violet-500/20 blur-[100px]"
          style={{ animation: 'orbBreathe 3s ease-in-out infinite 0.4s' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-[100px]"
          style={{ animation: 'orbBreathe 2.6s ease-in-out infinite 0.8s' }}
        />
      </div>

      {/* Merkez orbital sistem */}
      <div className="relative flex flex-col items-center gap-8" style={{ animation: 'fadeInUp 500ms ease-out both' }}>
        <div className="relative h-44 w-44 sm:h-56 sm:w-56">
          {/* Pulse rings */}
          <div className="absolute inset-0 rounded-full border-2 border-brand/50" style={{ animation: 'pulseRing 1.6s ease-out infinite' }} />
          <div className="absolute inset-0 rounded-full border-2 border-violet-500/40" style={{ animation: 'pulseRing 1.6s ease-out infinite 0.5s' }} />
          <div className="absolute inset-0 rounded-full border-2 border-fuchsia-500/30" style={{ animation: 'pulseRing 1.6s ease-out infinite 1s' }} />

          {/* Orbital rings */}
          <div className="absolute inset-2 rounded-full border border-dashed border-brand/40" style={{ animation: 'orbitalSpin 8s linear infinite' }}>
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-brand shadow-[0_0_20px_rgb(124_58_237/0.8)]" />
          </div>
          <div className="absolute inset-6 rounded-full border border-violet-400/30" style={{ animation: 'orbitalSpinReverse 5s linear infinite' }}>
            <div className="absolute top-1/2 -right-1 -translate-y-1/2 h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_12px_rgb(167_139_250/0.9)]" />
          </div>

          {/* Merkez orb */}
          <div
            className="absolute inset-12 rounded-full bg-gradient-to-br from-brand via-violet-500 to-fuchsia-500 shadow-[0_0_60px_rgba(124,58,237,0.7),0_0_120px_rgba(217,70,239,0.4)] grid place-items-center"
            style={{ animation: 'orbBreathe 1.8s ease-in-out infinite' }}
          >
            <Rocket className="h-7 w-7 sm:h-9 sm:w-9 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]" />
          </div>
        </div>

        <div className="text-center" style={{ animation: 'fadeInUp 600ms ease-out 200ms both' }}>
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-brand font-semibold">
              Site Agent · Booting
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/70" style={{ animation: 'textShimmer 1.4s ease-in-out infinite' }}>
            Brain · Topic engine · Channels
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes orbitalSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes orbitalSpinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes pulseRing {
          0%   { transform: scale(0.6); opacity: 0.7; }
          80%  { opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes orbBreathe {
          0%, 100% { transform: scale(1);   filter: brightness(1); }
          50%      { transform: scale(1.08); filter: brightness(1.25); }
        }
        @keyframes textShimmer {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
