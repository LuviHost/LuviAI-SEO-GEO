'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Check, Copy, Link2, RefreshCw, Users, Wallet, Receipt } from 'lucide-react';
import { motion } from 'motion/react';
import { EASE_APPLE } from '@/lib/motion-presets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { MetricCard } from '@/components/ui/metric';
import { cn } from '@/lib/utils';

/**
 * Ortaklik programi — panelin sakin diliyle (Ekim 2026; eski mor/sari "uzay"
 * temasi, ucusan para emojileri ve buyuk harfli etiketler kaldirildi).
 *
 * DURUSTLUK (koddan dogrulandi, affiliate.service.ts):
 *  - Komisyon yalniz DOGRUDAN davetlinin odemelerinden: recordCommission
 *    referral.affiliate'e yazar. 2. seviye davetler senin kazancini ARTIRMAZ —
 *    agda gosterilir ama "ag buyudukce daha cok kazanirsin" denmez.
 *  - Sure: kayittan sonraki 90 gun (commissionUntil); oran Affiliate.commissionPct (varsayilan %30).
 *  - Davet cerezi 60 gun (ref-tracker.tsx).
 *  - Otomatik odeme altyapisi YOK → "aylik otomatik IBAN/Papara" vaadi kaldirildi.
 *  - Sabit "₺1.169 / Pro davet" kaldirildi: fiyat USD bazli, TL tutari kura gore degisir.
 */

const W = 900;
const H = 560;
const CX = W / 2;
const CY = H / 2;
const TIER1_R = 160;
const TIER2_R = 250;

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

const STATUS_LABEL: Record<string, string> = {
  clicked: 'Tıkladı',
  signed_up: 'Kayıt oldu',
  paid: 'Ödeme yaptı',
};
const STATUS_TONE: Record<string, 'success' | 'info' | 'secondary'> = {
  paid: 'success',
  signed_up: 'info',
};

const tl = (n: number | string | null | undefined) =>
  `₺${Number(n ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
const tarih = (d?: string | null) => (d ? new Date(d).toLocaleDateString('tr-TR') : '—');

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

  // Aktif referans varsa 30 sn'de bir yenile — odeme durumu canli gorunur
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
      toast.success('Ortaklık programına katıldın');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ortaklık programı"
        description="RanksUp'ı önerdiğin işletmeler ödeme yaptıkça komisyon kazan."
        actions={stats?.enrolled ? (
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden />
            {refreshing ? 'Yenileniyor' : 'Yenile'}
          </Button>
        ) : undefined}
      />
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-72" />
        </div>
      ) : !stats?.enrolled ? (
        <EnrollCard onEnroll={enroll} />
      ) : (
        <AffiliateDashboard stats={stats} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Katilim (henuz uye degil)
// ──────────────────────────────────────────────────────────────────

const STEPS = [
  { title: 'Linkini paylaş', body: 'Sana özel davet linkini müşterilerine, takipçilerine ya da ekibine gönder.' },
  { title: 'Davetlin abone olur', body: 'Link 60 gün geçerli; bu sürede kayıt olan kişi senin davetlin sayılır.' },
  { title: 'Komisyonun yazılır', body: 'Davetlinin kayıttan sonraki 3 ay içindeki ödemelerinin %30\'u hesabına eklenir.' },
];

function EnrollCard({ onEnroll }: { onEnroll: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="font-brand text-h4 font-semibold tracking-tight [text-wrap:balance]">
            Önerdiğin her işletmeden %30 komisyon
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Davet ettiğin kişi abone olduğunda, ilk 3 ayındaki ödemelerinin %30&apos;u senin olur.
            Katılım ücretsiz, linkin hemen oluşur.
          </p>
          <Button onClick={onEnroll} size="lg" className="mt-6">
            Programa katıl
          </Button>
        </div>
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border font-brand text-sm font-semibold tabular-nums">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Uye paneli
// ──────────────────────────────────────────────────────────────────

function AffiliateDashboard({ stats }: { stats: Stats }) {
  const tier1 = (stats.referrals ?? []).filter((r) => (r.tier ?? 1) === 1);
  const tier2 = stats.tier2Referrals ?? [];
  const paidCount = tier1.filter((r) => r.status === 'paid').length;

  return (
    <div className="space-y-6">
      <ShareLink url={stats.shareUrl} refCode={stats.refCode} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Receipt} label="Toplam komisyon" value={Number(stats.totalCommission ?? 0)} prefix="₺" />
        <MetricCard icon={Wallet} label="Ödenmeyi bekleyen" value={Number(stats.pendingPayout ?? 0)} prefix="₺"
          hint={Number(stats.totalPaid) > 0 ? `${tl(stats.totalPaid)} ödendi` : undefined} />
        <MetricCard icon={Users} label="Doğrudan davet" value={tier1.length}
          hint={paidCount > 0 ? `${paidCount} tanesi ödeme yaptı` : 'Komisyon bunlardan gelir'} />
        <MetricCard icon={Link2} label="Davetlilerin ödemeleri" value={Number(stats.totalRevenue ?? 0)} prefix="₺" />
      </div>

      <Card className="p-5">
        <SectionHeader
          as="h3"
          title="Davet ağın"
          description={tier1.length === 0
            ? 'Henüz davet yok. Linkini paylaştığında davet ettiklerin burada görünür.'
            : `${tier1.length} doğrudan davet${tier2.length > 0 ? `, onların ${tier2.length} daveti` : ''}. Komisyon yalnız doğrudan davetlilerinin ödemelerinden gelir.`}
        />
        <NetworkGraph tier1={tier1.slice(0, 8)} tier2={tier2.slice(0, 16)} />
      </Card>

      {tier1.length + tier2.length > 0 && <ReferralTable rows={[...tier1, ...tier2]} />}
    </div>
  );
}

function ShareLink({ url, refCode }: { url: string; refCode: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link kopyalandı');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopyalanamadı — linki elle seç');
    }
  };
  return (
    <Card className="p-5">
      <SectionHeader as="h3" title="Davet linkin" description={`Kodun: ${refCode} · 60 gün geçerli`} />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <code className="flex-1 break-all rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm">
          {url}
        </code>
        <Button onClick={copy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? 'Kopyalandı' : 'Linki kopyala'}
        </Button>
      </div>
    </Card>
  );
}

function ReferralTable({ rows }: { rows: Referral[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-5 py-4">
        <SectionHeader as="h3" title="Tüm davetler" description={`${rows.length} kayıt`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-label text-muted-foreground">
            <tr>
              <th className="px-5 py-2.5 font-medium">Kişi</th>
              <th className="px-5 py-2.5 font-medium">Seviye</th>
              <th className="px-5 py-2.5 font-medium">Tıklama</th>
              <th className="px-5 py-2.5 font-medium">Kayıt</th>
              <th className="px-5 py-2.5 font-medium">İlk ödeme</th>
              <th className="px-5 py-2.5 text-right font-medium">Komisyon</th>
              <th className="px-5 py-2.5 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="px-5 py-2.5 font-medium">{refLabel(r, i + 1)}</td>
                <td className="px-5 py-2.5 text-muted-foreground">{(r.tier ?? 1) === 1 ? 'Doğrudan' : '2. seviye'}</td>
                <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{tarih(r.clickedAt)}</td>
                <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{tarih(r.signedUpAt)}</td>
                <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{tarih(r.firstPaidAt)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {(r.tier ?? 1) === 1 ? tl(r.totalCommissionEarned) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-5 py-2.5">
                  <Badge variant={STATUS_TONE[r.status] ?? 'secondary'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
//  Ag grafigi — token renkleri; odeme yapan baglar turuncu
// ──────────────────────────────────────────────────────────────────

function NetworkGraph({ tier1, tier2 }: { tier1: Referral[]; tier2: Referral[] }) {
  const tier1Pos = useMemo(() => tier1.map((r, i) => {
    const a = (i / Math.max(1, tier1.length)) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + Math.cos(a) * TIER1_R, y: CY + Math.sin(a) * TIER1_R, ref: r };
  }), [tier1]);

  // 2. seviye: parentUserId ile 1. seviyedeki dugume baglanir
  const tier2Pos = useMemo(() => {
    if (tier1Pos.length === 0) return [];
    return tier2.map((r, i) => {
      const idx = tier1Pos.findIndex((p) => p.ref.referredUserId === r.parentUserId);
      const parentIdx = idx >= 0 ? idx : i % tier1Pos.length;
      const parent = tier1Pos[parentIdx];
      const a = Math.atan2(parent.y - CY, parent.x - CX) + ((i % 3) - 1) * 0.35;
      return { x: CX + Math.cos(a) * TIER2_R, y: CY + Math.sin(a) * TIER2_R, ref: r, parentIdx };
    });
  }, [tier2, tier1Pos]);

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ maxHeight: 520 }} role="img" aria-label="Davet ağı">
        {tier1Pos.map((p, i) => (
          <motion.line
            key={`l1-${i}`} x1={CX} y1={CY} x2={p.x} y2={p.y}
            className={p.ref.status === 'paid' ? 'stroke-brand' : 'stroke-border'}
            strokeWidth={p.ref.status === 'paid' ? 2.5 : 1.5}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, ease: EASE_APPLE, delay: 0.2 + i * 0.06 }}
          />
        ))}
        {tier2Pos.map((p, i) => {
          const parent = tier1Pos[p.parentIdx];
          return (
            <motion.line
              key={`l2-${i}`} x1={parent.x} y1={parent.y} x2={p.x} y2={p.y}
              className="stroke-border" strokeWidth={1} strokeDasharray="3 4"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: EASE_APPLE, delay: 0.6 + i * 0.04 }}
            />
          );
        })}

        {/* Sen */}
        <circle cx={CX} cy={CY} r={30} className="fill-brand" />
        <text x={CX} y={CY + 5} textAnchor="middle" className="fill-white font-brand text-[14px] font-semibold">Sen</text>

        {tier1Pos.map((p, i) => {
          const paid = p.ref.status === 'paid';
          return (
            <g key={`n1-${i}`}>
              <circle cx={p.x} cy={p.y} r={15} className={cn('stroke-[2.5]', paid ? 'fill-brand/15 stroke-brand' : 'fill-card stroke-foreground/40')} />
              <text x={p.x} y={p.y < CY ? p.y - 24 : p.y + 32} textAnchor="middle" className="fill-foreground text-[12px] font-medium">
                {refLabel(p.ref, i + 1)}
              </text>
            </g>
          );
        })}
        {tier2Pos.map((p, i) => (
          <g key={`n2-${i}`}>
            <circle cx={p.x} cy={p.y} r={8} className="fill-muted stroke-foreground/25 stroke-[1.5]" />
            <text x={p.x} y={p.y < CY ? p.y - 15 : p.y + 22} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {refLabel(p.ref, i + 1)}
            </text>
          </g>
        ))}
      </svg>

      <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-label text-muted-foreground">
        <li className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand" aria-hidden />Ödeme yapan doğrudan davet</li>
        <li className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-foreground/40" aria-hidden />Doğrudan davet</li>
        <li className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-muted ring-1 ring-foreground/25" aria-hidden />2. seviye (komisyon yok)</li>
      </ul>
    </div>
  );
}

function refLabel(r: Referral, idx: number): string {
  const kisalt = (s: string) => (s.length > 14 ? s.slice(0, 12) + '…' : s);
  if (r.referredName?.trim()) return kisalt(r.referredName.trim());
  if (r.referredEmail) {
    const at = r.referredEmail.indexOf('@');
    return kisalt(at > 0 ? r.referredEmail.slice(0, at) : r.referredEmail);
  }
  if (r.referredUserId) return `Davetli ${r.referredUserId.slice(-4)}`;
  return `Davetli ${idx}`;
}
