'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const USER_ID = 'cmohpuxgi0001lzwklj3ijs7l';

export default function BillingPage() {
  const [current, setCurrent] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    Promise.all([
      fetch(`${apiBase}/api/billing/users/${USER_ID}/current`).then((r) => r.json()),
      fetch(`${apiBase}/api/billing/users/${USER_ID}/invoices`).then((r) => r.json()),
      fetch(`${apiBase}/api/billing/users/${USER_ID}/quota`).then((r) => r.json()),
    ])
      .then(([c, i, q]) => {
        setCurrent(c);
        setInvoices(i);
        setQuota(q);
      })
      .finally(() => setLoading(false));
  }, []);

  const cancel = async () => {
    if (!confirm('Aboneliği iptal etmek istediğine emin misin?')) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      await fetch(`${apiBase}/api/billing/users/${USER_ID}/cancel`, { method: 'POST' });
      toast.success('Abonelik iptal edildi');
      location.reload();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!current) {
    return <div className="text-muted-foreground">Veri yüklenemedi.</div>;
  }

  const plan = current.plan;
  const articleUsage = quota?.articles ?? { remaining: 0, limit: 0 };
  const used = articleUsage.limit - articleUsage.remaining;
  const usagePct = articleUsage.limit > 0 ? Math.round((used / articleUsage.limit) * 100) : 0;

  const statusBadge = {
    ACTIVE: 'success',
    TRIAL: 'default',
    CANCELED: 'outline',
    EXPIRED: 'destructive',
    PAST_DUE: 'warning',
  } as Record<string, any>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Abonelik &amp; Faturalama</h1>

      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
            <div>
              <div className="text-sm text-muted-foreground">Mevcut planınız</div>
              <h2 className="text-2xl font-bold mt-1">{plan?.name ?? '-'}</h2>
              <Badge className="mt-2" variant={statusBadge[current.status] ?? 'secondary'}>
                {current.status}
              </Badge>
            </div>
            <div className="text-right">
              {plan?.monthly > 0 && (
                <div className="text-2xl font-bold">
                  ₺{plan.monthly}<span className="text-sm text-muted-foreground">/ay</span>
                </div>
              )}
              {current.trialEndsAt && current.status === 'TRIAL' && (
                <div className="text-xs text-muted-foreground mt-1">
                  Trial bitiş: {new Date(current.trialEndsAt).toLocaleDateString('tr-TR')}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Bu ay kullanım</span>
              <span className="font-mono">{used} / {articleUsage.limit} makale</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${usagePct > 80 ? 'bg-red-500' : 'bg-brand'}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>

          <div className="mt-6 flex gap-3 flex-wrap">
            <Button asChild><Link href="/pricing">Plan Yükselt</Link></Button>
            {current.status === 'ACTIVE' && (
              <Button variant="outline" onClick={cancel} className="text-red-500 border-red-200 hover:bg-red-50 dark:hover:bg-red-950">
                İptal Et
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Fatura Geçmişi</h2>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Henüz fatura yok.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-4">Tarih</th>
                    <th className="text-left p-4">Açıklama</th>
                    <th className="text-right p-4">Tutar</th>
                    <th className="text-left p-4">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="p-4">{new Date(inv.createdAt).toLocaleDateString('tr-TR')}</td>
                      <td className="p-4">{inv.description}</td>
                      <td className="p-4 text-right font-mono">
                        ₺{Number(inv.amount).toLocaleString('tr-TR')}
                      </td>
                      <td className="p-4">
                        <Badge
                          variant={
                            inv.status === 'PAID'
                              ? 'success'
                              : inv.status === 'PENDING'
                              ? 'warning'
                              : 'destructive'
                          }
                        >
                          {inv.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
