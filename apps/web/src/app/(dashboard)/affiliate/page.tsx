'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Copy, Network, Wallet, Layers as LayersIcon, Sparkles, DollarSign, Users, RefreshCw } from 'lucide-react';
import { animate, stagger } from 'animejs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Affiliate Page — gerçek multi-level network graph + para akışı animasyonu.
 *
 * Veri akışı:
 *   - Backend getStats → { referrals: [tier 1], tier2Referrals: [tier 2], ... }
 *   - Frontend graph dinamik olarak gerçek tier sayısına göre düğüm üretir
 *   - paid statüsündeki line'larda akan parçacık animasyonu (komisyon akışı görseli)
 *
 * Empty state: hiç referans yok → sadece merkez "siz" + büyük "Linkini Paylaş" CTA
 * 1 tier: merkez + N mavi düğüm (tier 1)
 * 2 tier: merkez + tier1 + tier2, tier2 her biri parentUserId ile tier1'e bağlanır
 */

const W = 900;
const H = 660;
const CX = W / 2;
const CY = H / 2;
const TIER1_R = 175;
const TIER2_R = 295;

type Referral = {
  id: string;
  referredUserId?: string | null;
  referredName?: string | null;
  referredEmail?: string | null;
  parentUserId?: string;
  status: string;
  clickedAt: string;
  signedUpAt?: string | null;
  firstPaidAt?: string | null;
  totalCommissionEarned?: number | string;
  tier?: 1 | 2;
};

type Stats = {
  enrolled: boolean;
  totalReferred: number;
  totalRevenue: number;
  totalCommission: number;
  totalPaid: number;
  pendingPayout: number;
  shareUrl: string;
  refCode: string;
  referrals?: Referral[];
  tier2Referrals?: Referral[];
  networkSize?: number;
  networkLevels?: number;
};

export default function AffiliatePage() {
  const { data: session, status } = useSession();
  const userId = (session?.user as any)?.id;
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (!userId) { setLoading(false); return; }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    setRefreshing(true);
    try {
      const res = await fetch(`${apiBase}/api/affiliate/users/${userId}/stats`, { credentials: 'include' });
      const data = await res.json();
      setStats(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (status !== 'loading') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, status]);

  // Aktif referans varsa 30sn'de bir polling — ödeme akışı canlı görünür
  useEffect(() => {
    if (!stats?.enrolled) return;
    const hasActive = (stats.referrals ?? []).some((r) => r.status === 'signed_up' || r.status === 'paid')
      || (stats.tier2Referrals ?? []).some((r) => r.status === 'signed_up' || r.status === 'paid');
    if (!hasActive) return;
    const t = setInterval(() => refresh(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.enrolled, stats?.referrals?.length, stats?.tier2Referrals?.length]);

  const enroll = async () => {
    if (!userId) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      await fetch(`${apiBase}/api/affiliate/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      });
      toast.success('Affiliate programına kayıt oldunuz!');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('Link kopyalandı');
  };

  if (loading) return <Skeleton className="h-screen" />;
  if (!stats?.enrolled) return <EnrollHero onEnroll={enroll} />;

  return <AffiliateDashboard stats={stats} onCopy={copyLink} onRefresh={refresh} refreshing={refreshing} />;
}

// ──────────────────────────────────────────────────────────────────
//  Network graph — gerçek veriye bağlı
// ──────────────────────────────────────────────────────────────────

function AffiliateDashboard({
  stats, onCopy, onRefresh, refreshing,
}: {
  stats: Stats;
  onCopy: (s: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const tier1 = (stats.referrals ?? []).filter((r) => (r.tier ?? 1) === 1).slice(0, 8);
  const tier2 = (stats.tier2Referrals ?? []).slice(0, 16);

  const tier1Pos = useMemo(() => {
    if (tier1.length === 0) return [];
    return tier1.map((r, i) => {
      const a = (i / tier1.length) * Math.PI * 2 - Math.PI / 2;
      return { x: CX + Math.cos(a) * TIER1_R, y: CY + Math.sin(a) * TIER1_R, ref: r };
    });
  }, [tier1]);

  // Tier 2 her biri parent userId üzerinden tier 1'deki düğüme bağlanır
  const tier2Pos = useMemo(() => {
    if (tier2.length === 0 || tier1Pos.length === 0) return [];
    return tier2.map((r, i) => {
      const parentIdx = tier1Pos.findIndex((p) => p.ref.referredUserId === r.parentUserId);
      const safeParent = parentIdx >= 0 ? parentIdx : (i % tier1Pos.length);
      const parent = tier1Pos[safeParent];
      // parent'in üzerine doğru sapan açı + offset
      const baseA = Math.atan2(parent.y - CY, parent.x - CX);
      const spreadIdx = (i % 3) - 1; // -1, 0, +1 — 3 yan dizilim
      const a = baseA + (spreadIdx * 0.35);
      return {
        x: CX + Math.cos(a) * TIER2_R,
        y: CY + Math.sin(a) * TIER2_R,
        ref: r,
        parentIdx: safeParent,
      };
    });
  }, [tier2, tier1Pos]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!svgRef.current || playedRef.current) return;
    playedRef.current = true;

    // 1) Merkez pop in
    animate('.aff-node-center, .aff-node-center-glow, .aff-node-center-label', {
      scale: [0, 1],
      opacity: [0, 1],
      duration: 700,
      easing: 'cubicBezier(0.16, 1, 0.3, 1)',
    });

    // 2) Tier 1 çizgileri (varsa)
    if (tier1Pos.length > 0) {
      animate('.aff-line-tier1', {
        strokeDashoffset: [TIER1_R, 0],
        opacity: [0, 0.7],
        duration: 600,
        easing: 'easeOutQuad',
        delay: stagger(110, { start: 500 }),
      });
      animate('.aff-node-tier1', {
        scale: [0, 1],
        opacity: [0, 1],
        duration: 500,
        easing: 'outBack(1.7)',
        delay: stagger(110, { start: 900 }),
      });
    }

    // 3) Tier 2 çizgileri + düğümler
    if (tier2Pos.length > 0) {
      const t1End = 900 + tier1Pos.length * 110;
      animate('.aff-line-tier2', {
        strokeDashoffset: [TIER2_R - TIER1_R, 0],
        opacity: [0, 0.45],
        duration: 500,
        easing: 'easeOutQuad',
        delay: stagger(70, { start: t1End + 200 }),
      });
      animate('.aff-node-tier2', {
        scale: [0, 1],
        opacity: [0, 1],
        duration: 400,
        easing: 'outBack(1.5)',
        delay: stagger(70, { start: t1End + 500 }),
      });
    }

    // 4) Para akışı: paid statüsündeki line'larda akan parçacık (sürekli loop)
    animate('.aff-flow-particle', {
      offsetDistance: ['0%', '100%'],
      opacity: [0, 1, 0],
      duration: 2200,
      loop: true,
      easing: 'linear',
      delay: stagger(280),
    });

    // 5) Background money emoji floating
    animate('.aff-money', {
      translateY: [0, -8, 0],
      opacity: [0.15, 0.35, 0.15],
      duration: 3000,
      loop: true,
      easing: 'easeInOutSine',
      delay: stagger(400),
    });

    // 6) Count-up
    animateCountUp('.aff-kpi-money', Number(stats.totalCommission), 1500, '₺');
    animateCountUp('.aff-kpi-pending', Number(stats.pendingPayout), 1500, '₺');
    animateCountUp('.aff-kpi-refs', Number(stats.networkSize ?? stats.totalReferred), 1500);
  }, [tier1Pos.length, tier2Pos.length, stats.totalCommission, stats.pendingPayout, stats.networkSize, stats.totalReferred]);

  const networkLevels = stats.networkLevels ?? (tier2.length > 0 ? 2 : tier1.length > 0 ? 1 : 0);

  return (
    <div className="relative -mx-4 -my-6 sm:-mx-6 sm:-my-8 px-4 py-6 sm:px-6 sm:py-8 min-h-[calc(100vh-3rem)] overflow-hidden bg-gradient-to-br from-violet-950 via-purple-950 to-indigo-950 text-white">
      <StarField />
      <MoneyField />

      {/* KPI üst bar */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 max-w-6xl mx-auto">
        <KpiBox icon={<DollarSign className="h-4 w-4" />} label="Toplam Komisyon"
          value={<span className="aff-kpi-money text-yellow-300">₺0</span>} accent="yellow" />
        <KpiBox icon={<Users className="h-4 w-4" />} label="Toplam Referans (T1+T2)"
          value={<span className="aff-kpi-refs">0</span>} accent="violet" />
        <KpiBox icon={<LayersIcon className="h-4 w-4" />} label="Ağ Seviyeleri"
          value={<span>{networkLevels}</span>} accent="violet" />
      </div>

      {/* Graph header — refresh */}
      <div className="relative z-10 max-w-5xl mx-auto mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-white/60 font-mono">
          {tier1.length === 0 ? 'Henüz davet yok' : `${tier1.length} doğrudan · ${tier2.length} alt seviye`}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white font-mono uppercase tracking-widest"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'yenileniyor' : 'yenile'}
        </button>
      </div>

      {/* SVG network */}
      <div className="relative z-10 max-w-5xl mx-auto">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: '660px' }}>
          <defs>
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fb923c" stopOpacity="0.7" />
              <stop offset="60%" stopColor="#f97316" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="tier1Glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="tier2Glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Tier 1 çizgileri */}
          {tier1Pos.map((p, i) => {
            const dx = p.x - CX;
            const dy = p.y - CY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const isPaid = p.ref.status === 'paid';
            return (
              <line
                key={`l1-${i}`}
                className="aff-line-tier1"
                x1={CX} y1={CY} x2={p.x} y2={p.y}
                stroke={isPaid ? 'rgba(250, 204, 21, 0.85)' : 'rgba(96, 165, 250, 0.6)'}
                strokeWidth={isPaid ? 2.5 : 2}
                strokeDasharray={len}
                strokeDashoffset={len}
                style={{ opacity: 0 }}
              />
            );
          })}

          {/* Tier 2 çizgileri */}
          {tier2Pos.map((p, i) => {
            const parent = tier1Pos[p.parentIdx];
            const dx = p.x - parent.x;
            const dy = p.y - parent.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const isPaid = p.ref.status === 'paid';
            return (
              <line
                key={`l2-${i}`}
                className="aff-line-tier2"
                x1={parent.x} y1={parent.y} x2={p.x} y2={p.y}
                stroke={isPaid ? 'rgba(250, 204, 21, 0.7)' : 'rgba(74, 222, 128, 0.45)'}
                strokeWidth={isPaid ? 2 : 1.5}
                strokeDasharray={len}
                strokeDashoffset={len}
                style={{ opacity: 0 }}
              />
            );
          })}

          {/* Merkez */}
          <circle className="aff-node-center-glow" cx={CX} cy={CY} r={70}
            fill="url(#centerGlow)"
            style={{ opacity: 0, transformOrigin: `${CX}px ${CY}px` }} />
          <circle className="aff-node-center" cx={CX} cy={CY} r={36}
            fill="#fb923c" stroke="#fdba74" strokeWidth={3}
            style={{ opacity: 0, transformOrigin: `${CX}px ${CY}px`, filter: 'drop-shadow(0 0 24px rgba(251,146,60,0.7))' }} />
          <text className="aff-node-center-label" x={CX} y={CY + 60}
            textAnchor="middle" fontSize={13} fill="#fed7aa" fontWeight={600}
            style={{ opacity: 0 }}>
            siz
          </text>

          {/* Tier 1 düğümler */}
          {tier1Pos.map((p, i) => {
            const isPaid = p.ref.status === 'paid';
            return (
              <g key={`n1-${i}`} className="aff-node-tier1"
                style={{ opacity: 0, transformOrigin: `${p.x}px ${p.y}px` }}>
                <circle cx={p.x} cy={p.y} r={26} fill="url(#tier1Glow)" />
                <circle cx={p.x} cy={p.y} r={16}
                  fill={isPaid ? '#facc15' : '#3b82f6'}
                  stroke={isPaid ? '#fde68a' : '#93c5fd'}
                  strokeWidth={2.5}
                  style={{ filter: `drop-shadow(0 0 12px ${isPaid ? 'rgba(250,204,21,0.7)' : 'rgba(59,130,246,0.6)'})` }} />
                <text x={p.x} y={clampLabelY(p.y, p.y < CY, 28, 36)}
                  textAnchor="middle" fontSize={10} fill="#bfdbfe" fontWeight={500}>
                  T1 · {refLabel(p.ref, i + 1)}
                </text>
              </g>
            );
          })}

          {/* Tier 2 düğümler */}
          {tier2Pos.map((p, i) => {
            const isPaid = p.ref.status === 'paid';
            return (
              <g key={`n2-${i}`} className="aff-node-tier2"
                style={{ opacity: 0, transformOrigin: `${p.x}px ${p.y}px` }}>
                <circle cx={p.x} cy={p.y} r={18} fill="url(#tier2Glow)" />
                <circle cx={p.x} cy={p.y} r={10}
                  fill={isPaid ? '#facc15' : '#22c55e'}
                  stroke={isPaid ? '#fde68a' : '#86efac'}
                  strokeWidth={2}
                  style={{ filter: `drop-shadow(0 0 8px ${isPaid ? 'rgba(250,204,21,0.6)' : 'rgba(34,197,94,0.5)'})` }} />
                <text x={p.x} y={clampLabelY(p.y, p.y < CY, 16, 22)}
                  textAnchor="middle" fontSize={9} fill="#bbf7d0" fontWeight={500}>
                  T2 · {refLabel(p.ref, i + 1)}
                </text>
              </g>
            );
          })}

          {/* Paid line akan parçacıklar — komisyon akışı görseli */}
          {tier1Pos.filter((p) => p.ref.status === 'paid').map((p, i) => (
            <FlowParticleOnLine key={`fp1-${i}`} x1={CX} y1={CY} x2={p.x} y2={p.y} />
          ))}
          {tier2Pos.filter((p) => p.ref.status === 'paid').map((p, i) => {
            const parent = tier1Pos[p.parentIdx];
            return (
              <FlowParticleOnLine key={`fp2-${i}`} x1={parent.x} y1={parent.y} x2={p.x} y2={p.y} />
            );
          })}
        </svg>

        {/* Empty state — hiç davet yoksa CTA */}
        {tier1.length === 0 && (
          <div className="-mt-32 text-center pointer-events-none">
            <p className="text-sm text-white/70 mb-1">Henüz davet etmedin.</p>
            <p className="text-xs text-white/50 mb-4">Linkini paylaş — tıklayan ilk kullanıcı tier 1, onun davetlileri tier 2 olarak ağına eklenir.</p>
          </div>
        )}

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 justify-center text-xs">
          <LegendDot color="#fb923c" label="Ana Hesap (siz)" />
          <LegendDot color="#3b82f6" label="Tier 1 — Doğrudan davet" />
          <LegendDot color="#22c55e" label="Tier 2 — Alt seviye" />
          <LegendDot color="#facc15" label="Ödeme yapan (komisyon akıyor)" />
        </div>
      </div>

      {/* Davet linki + bilgi */}
      <div className="relative z-10 max-w-3xl mx-auto mt-8 space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
          <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-widest text-white/60 font-mono">
            <Network className="h-3.5 w-3.5" />
            Davet Linkin
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 px-3 py-2.5 bg-black/40 rounded-lg text-xs sm:text-sm font-mono break-all text-white/90 border border-white/10">
              {stats.shareUrl}
            </code>
            <Button onClick={() => onCopy(stats.shareUrl)} className="bg-yellow-400 text-black hover:bg-yellow-300 font-semibold">
              <Copy className="h-4 w-4 mr-2" /> Kopyala
            </Button>
          </div>
          <p className="text-[10px] text-white/50 mt-2 font-mono">
            Ref: <strong className="text-white/80">{stats.refCode}</strong> · 60 gün cookie · 3 ay komisyon · multi-level (siz → T1 → T2)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-yellow-400/30 bg-gradient-to-br from-yellow-400/10 to-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-yellow-300/80 font-mono mb-2">
              <Wallet className="h-3.5 w-3.5" />
              Bekleyen Ödeme
            </div>
            <div className="text-2xl font-bold text-yellow-300 aff-kpi-pending">
              ₺{Number(stats.pendingPayout ?? 0).toLocaleString('tr-TR')}
            </div>
            <p className="text-[10px] text-white/60 mt-1">Aylık otomatik IBAN/Papara transfer</p>
          </div>
          <div className="rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-violet-300/80 font-mono mb-2">
              <Sparkles className="h-3.5 w-3.5" />
              Toplam Gelir (Davetliler)
            </div>
            <div className="text-2xl font-bold text-violet-200">
              ₺{Number(stats.totalRevenue).toLocaleString('tr-TR')}
            </div>
            <p className="text-[10px] text-white/60 mt-1">Davetlilerinin tüm ödemeleri</p>
          </div>
        </div>

        {/* Davetler tablosu */}
        {tier1.length + tier2.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-widest text-white/60 font-mono">
              Tüm Davetler ({tier1.length + tier2.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-white/60">
                    <th className="text-left px-4 py-2 font-medium">Seviye</th>
                    <th className="text-left px-4 py-2 font-medium">Tıklama</th>
                    <th className="text-left px-4 py-2 font-medium">Kayıt</th>
                    <th className="text-left px-4 py-2 font-medium">Ödeme</th>
                    <th className="text-right px-4 py-2 font-medium">Kazanç</th>
                    <th className="text-left px-4 py-2 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tier1, ...tier2].map((r) => (
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="px-4 py-2 text-white/80">
                        <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${(r.tier ?? 1) === 1 ? 'border-blue-400/40 text-blue-300' : 'border-emerald-400/40 text-emerald-300'}`}>
                          T{r.tier ?? 1}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-white/80">{new Date(r.clickedAt).toLocaleDateString('tr-TR')}</td>
                      <td className="px-4 py-2 text-white/80">{r.signedUpAt ? new Date(r.signedUpAt).toLocaleDateString('tr-TR') : '-'}</td>
                      <td className="px-4 py-2 text-white/80">{r.firstPaidAt ? new Date(r.firstPaidAt).toLocaleDateString('tr-TR') : '-'}</td>
                      <td className="px-4 py-2 text-right font-mono text-yellow-300">
                        ₺{Number(r.totalCommissionEarned ?? 0).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2"><Badge variant={r.status === 'paid' ? 'success' : r.status === 'signed_up' ? 'default' : 'secondary'}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Flow particle — paid line üzerinde akan komisyon noktası
// ──────────────────────────────────────────────────────────────────

function FlowParticleOnLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  // CSS offset-path ile path takip ediyoruz — anime.js bunu offsetDistance ile sürer
  const path = `path('M ${x1} ${y1} L ${x2} ${y2}')`;
  return (
    <foreignObject x="0" y="0" width={W} height={H} style={{ pointerEvents: 'none' }}>
      <div className="aff-flow-particle" style={{
        position: 'absolute',
        width: 6, height: 6,
        borderRadius: '50%',
        background: '#facc15',
        boxShadow: '0 0 12px rgba(250, 204, 21, 0.9), 0 0 6px #fde68a',
        offsetPath: path,
        offsetRotate: '0deg',
        opacity: 0,
      } as React.CSSProperties} />
    </foreignObject>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────

function clampLabelY(nodeY: number, above: boolean, aboveOffset: number, belowOffset: number): number {
  // Label SVG viewBox'ının (0..H) üst/alt kenarına taşıyorsa otomatik öbür tarafa çevir.
  if (above) {
    const proposed = nodeY - aboveOffset;
    if (proposed < 14) return nodeY + belowOffset;
    return proposed;
  }
  const proposed = nodeY + belowOffset;
  if (proposed > H - 8) return nodeY - aboveOffset;
  return proposed;
}

function refLabel(r: Referral, idx: number): string {
  if (r.referredName && r.referredName.trim()) {
    const n = r.referredName.trim();
    return n.length > 14 ? n.slice(0, 12) + '…' : n;
  }
  if (r.referredEmail) {
    const at = r.referredEmail.indexOf('@');
    const local = at > 0 ? r.referredEmail.slice(0, at) : r.referredEmail;
    return local.length > 14 ? local.slice(0, 12) + '…' : local;
  }
  if (r.referredUserId) return r.referredUserId.slice(-4);
  return String(idx);
}

function EnrollHero({ onEnroll }: { onEnroll: () => void }) {
  return (
    <div className="relative -mx-4 -my-6 sm:-mx-6 sm:-my-8 px-4 py-12 sm:px-6 sm:py-20 min-h-[calc(100vh-3rem)] overflow-hidden bg-gradient-to-br from-violet-950 via-purple-950 to-indigo-950 text-white grid place-items-center">
      <StarField />
      <MoneyField />
      <div className="relative z-10 max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full border border-yellow-400/40 bg-yellow-400/10 font-mono text-[10px] uppercase tracking-[0.3em] text-yellow-300">
          <Sparkles className="h-3 w-3" />
          Affiliate Programı · Multi-level · %30
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Davet Et, <span className="text-yellow-300">Kazan</span>
        </h1>
        <p className="text-lg text-white/70 mb-8 max-w-xl mx-auto">
          Davet ettiğin kullanıcının 3 ay boyunca yaptığı ödemelerin <strong className="text-yellow-300">%30'u</strong> komisyonun olur.
          Onlar da kendi linklerini paylaşırsa ağ büyür, sen daha çok kazanırsın.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 max-w-xl mx-auto">
          <FeatureBox icon="💰" label="₺1.169 / Pro davet" />
          <FeatureBox icon="🌐" label="Multi-level network" />
          <FeatureBox icon="🔁" label="Aylık otomatik ödeme" />
        </div>
        <Button onClick={onEnroll} size="lg"
          className="bg-yellow-400 text-black hover:bg-yellow-300 font-semibold text-base px-8 py-6 shadow-[0_0_40px_-10px_rgba(250,204,21,0.6)]">
          Programa Kayıt Ol →
        </Button>
        <p className="text-xs text-white/50 mt-4 font-mono">60 gün cookie · 3 ay komisyon süresi</p>
      </div>
    </div>
  );
}

function KpiBox({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent: 'yellow' | 'violet' }) {
  const cls = accent === 'yellow'
    ? 'border-yellow-400/40 bg-gradient-to-br from-yellow-400/10 to-amber-500/5'
    : 'border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5';
  const valueCls = accent === 'yellow' ? 'text-yellow-300' : 'text-violet-200';
  return (
    <div className={`rounded-xl border ${cls} backdrop-blur-sm p-4`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/70 font-mono mb-2">
        {icon}
        {label}
      </div>
      <div className={`text-3xl font-bold tabular-nums ${valueCls} font-mono`}>{value}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="text-white/80">{label}</span>
    </div>
  );
}

function FeatureBox({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm py-3 px-2 text-sm">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-white/80">{label}</div>
    </div>
  );
}

function StarField() {
  const stars = useMemo(() => {
    const out: { x: number; y: number; s: number; o: number }[] = [];
    let seed = 1337;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 60; i++) {
      out.push({ x: rnd() * 100, y: rnd() * 100, s: rnd() * 1.5 + 0.5, o: rnd() * 0.5 + 0.2 });
    }
    return out;
  }, []);
  return (
    <div className="absolute inset-0 pointer-events-none">
      {stars.map((s, i) => (
        <div key={i} className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.s}px`, height: `${s.s}px`, opacity: s.o }} />
      ))}
    </div>
  );
}

function MoneyField() {
  const items = useMemo(() => {
    const out: { x: number; y: number; r: number }[] = [];
    let seed = 7331;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 8; i++) {
      out.push({ x: rnd() * 90 + 2, y: rnd() * 80 + 10, r: rnd() * 30 - 15 });
    }
    return out;
  }, []);
  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map((it, i) => (
        <div key={i} className="aff-money absolute text-xl"
          style={{ left: `${it.x}%`, top: `${it.y}%`, transform: `rotate(${it.r}deg)`, opacity: 0.15 }}>
          💰
        </div>
      ))}
    </div>
  );
}

function animateCountUp(selector: string, target: number, durationMs: number, prefix: string = '') {
  if (!Number.isFinite(target) || target <= 0) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => { el.textContent = `${prefix}0`; });
    return;
  }
  const els = document.querySelectorAll<HTMLElement>(selector);
  if (els.length === 0) return;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / durationMs);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = Math.round(target * eased);
    els.forEach((el) => { el.textContent = `${prefix}${v.toLocaleString('tr-TR')}`; });
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
