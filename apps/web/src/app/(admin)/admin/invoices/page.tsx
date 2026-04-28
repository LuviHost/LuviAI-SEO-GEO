'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_VARIANT: Record<string, any> = {
  PAID: 'success',
  PENDING: 'warning',
  FAILED: 'destructive',
  REFUNDED: 'outline',
};

const STATUS_FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'PAID', label: 'Ödenmiş' },
  { value: 'PENDING', label: 'Bekleyen' },
  { value: 'FAILED', label: 'Başarısız' },
];

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const refresh = () => {
    setLoading(true);
    api
      .getAdminInvoices(filter || undefined)
      .then(setInvoices)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [filter]);

  const totalPaid = useMemo(
    () => invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + Number(i.amount), 0),
    [invoices],
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Faturalar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {invoices.length} fatura · Toplam ödenmiş: ₺{totalPaid.toLocaleString('tr-TR')}
          </p>
        </div>
        <div className="flex gap-1 bg-card border rounded-lg p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-brand text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3">Tarih</th>
                    <th className="p-3">Kullanıcı</th>
                    <th className="p-3">Açıklama</th>
                    <th className="p-3 text-right">Tutar</th>
                    <th className="p-3">PayTR ID</th>
                    <th className="p-3">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 text-xs whitespace-nowrap">
                        {new Date(inv.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-sm">{inv.user?.email}</div>
                        {inv.user?.plan && (
                          <div className="text-[10px] text-muted-foreground">
                            {inv.user.plan}
                          </div>
                        )}
                      </td>
                      <td className="p-3">{inv.description}</td>
                      <td className="p-3 text-right font-mono">
                        ₺{Number(inv.amount).toLocaleString('tr-TR')}
                      </td>
                      <td className="p-3 font-mono text-[10px] text-muted-foreground">
                        {inv.paytrTransactionId ?? '-'}
                      </td>
                      <td className="p-3">
                        <Badge variant={STATUS_VARIANT[inv.status] ?? 'outline'}>
                          {inv.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-muted-foreground">
                        Fatura bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
