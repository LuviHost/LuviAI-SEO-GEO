'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Users, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const USER_ID = 'cmohpuxgi0001lzwklj3ijs7l';

export default function AffiliatePage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      const res = await fetch(`${apiBase}/api/affiliate/users/${USER_ID}/stats`);
      const data = await res.json();
      setStats(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const enroll = async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      await fetch(`${apiBase}/api/affiliate/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID }),
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

  if (loading) return <Skeleton className="h-64" />;

  if (!stats?.enrolled) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-5xl mb-4">🤝</div>
            <h1 className="text-3xl font-bold mb-2">Affiliate Programı</h1>
            <p className="text-muted-foreground mb-6">
              Davet ettiğin her kullanıcının 3 ay boyunca yaptığı ödemelerin <strong>%30'u</strong> komisyonun olur.
            </p>
            <ul className="text-sm text-left max-w-md mx-auto space-y-2 mb-8">
              <li>• Pro plan davet: ₺1.299 × 3 ay × %30 = <strong>₺1.169 komisyon</strong></li>
              <li>• Aylık otomatik IBAN/Papara transfer</li>
              <li>• Sınırsız davet</li>
              <li>• Cookie tracking 60 gün</li>
            </ul>
            <Button size="lg" onClick={enroll}>Programa Kayıt Ol</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pendingPayout = Number(stats.pendingPayout ?? 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Affiliate Paneli</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Users />} label="Davet edilen" value={stats.totalReferred} />
        <StatCard icon={<TrendingUp />} label="Toplam gelir" value={`₺${Number(stats.totalRevenue).toLocaleString('tr-TR')}`} />
        <StatCard icon={<Wallet />} label="Komisyon" value={`₺${Number(stats.totalCommission).toLocaleString('tr-TR')}`} />
        <StatCard label="Bekleyen ödeme" value={`₺${pendingPayout.toLocaleString('tr-TR')}`} variant="brand" />
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Davet Linkin</h2>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-center">
            <code className="flex-1 px-4 py-3 bg-muted rounded-lg text-sm font-mono break-all">
              {stats.shareUrl}
            </code>
            <Button onClick={() => copyLink(stats.shareUrl)}>
              <Copy className="h-4 w-4 mr-2" /> Kopyala
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Ref kod: <strong>{stats.refCode}</strong> · 60 gün cookie · 3 ay komisyon süresi
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Davetlerin (son 50)</h2>
        </CardHeader>
        <CardContent className="p-0">
          {stats.referrals?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Henüz davet yok. Linki paylaş, ilk komisyonun başlasın!
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4">Tıklama</th>
                  <th className="text-left p-4">Kayıt</th>
                  <th className="text-left p-4">Ödeme</th>
                  <th className="text-right p-4">Kazanç</th>
                  <th className="text-left p-4">Durum</th>
                </tr>
              </thead>
              <tbody>
                {stats.referrals?.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-4">{new Date(r.clickedAt).toLocaleDateString('tr-TR')}</td>
                    <td className="p-4">{r.signedUpAt ? new Date(r.signedUpAt).toLocaleDateString('tr-TR') : '-'}</td>
                    <td className="p-4">{r.firstPaidAt ? new Date(r.firstPaidAt).toLocaleDateString('tr-TR') : '-'}</td>
                    <td className="p-4 text-right font-mono">₺{Number(r.totalCommissionEarned ?? 0).toLocaleString('tr-TR')}</td>
                    <td className="p-4"><Badge variant={r.status === 'paid' ? 'success' : r.status === 'signed_up' ? 'default' : 'secondary'}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, variant = 'default' }: { icon?: React.ReactNode; label: string; value: any; variant?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {icon}
          {label}
        </div>
        <div className={`text-2xl font-bold ${variant === 'brand' ? 'text-brand' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
