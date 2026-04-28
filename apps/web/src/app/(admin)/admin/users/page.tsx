'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

const PLAN_VARIANT: Record<string, any> = {
  TRIAL: 'secondary',
  STARTER: 'default',
  PRO: 'default',
  AGENCY: 'success',
  ENTERPRISE: 'success',
};

const SUB_VARIANT: Record<string, any> = {
  TRIAL: 'secondary',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'outline',
  EXPIRED: 'destructive',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.getAdminUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      (u.email ?? '').toLowerCase().includes(needle) ||
      (u.name ?? '').toLowerCase().includes(needle),
    );
  }, [users, q]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Kullanıcılar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toplam {users.length} kullanıcı · Filtrelenmiş: {filtered.length}
          </p>
        </div>
        <Input
          placeholder="email veya isim ara..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
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
                    <th className="p-3">Email / İsim</th>
                    <th className="p-3">Rol</th>
                    <th className="p-3">Plan</th>
                    <th className="p-3">Sub Status</th>
                    <th className="p-3 text-center">Site</th>
                    <th className="p-3 text-center">Job</th>
                    <th className="p-3 text-center">Fatura</th>
                    <th className="p-3">Kayıt</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{u.email}</div>
                        {u.name && <div className="text-xs text-muted-foreground">{u.name}</div>}
                      </td>
                      <td className="p-3">
                        <Badge variant={u.role === 'ADMIN' ? 'default' : 'outline'} className={u.role === 'ADMIN' ? 'bg-amber-500 text-white' : ''}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={PLAN_VARIANT[u.plan] ?? 'outline'}>{u.plan}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={SUB_VARIANT[u.subscriptionStatus] ?? 'outline'}>
                          {u.subscriptionStatus}
                        </Badge>
                      </td>
                      <td className="p-3 text-center font-mono">{u._count?.sites ?? 0}</td>
                      <td className="p-3 text-center font-mono">{u._count?.jobs ?? 0}</td>
                      <td className="p-3 text-center font-mono">{u._count?.invoices ?? 0}</td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-muted-foreground">
                        Kullanıcı bulunamadı.
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
