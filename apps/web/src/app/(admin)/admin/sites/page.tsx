'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_VARIANT: Record<string, any> = {
  ONBOARDING: 'warning',
  AUDIT_PENDING: 'secondary',
  AUDIT_COMPLETE: 'default',
  ACTIVE: 'success',
  PAUSED: 'outline',
  ERROR: 'destructive',
};

export default function AdminSitesPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminSites().then(setSites).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Tüm Siteler</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {sites.length} site kayıtlı
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3">Site</th>
                    <th className="p-3">Sahip</th>
                    <th className="p-3">Niş</th>
                    <th className="p-3">Dil</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-center">Makale</th>
                    <th className="p-3">GSC</th>
                    <th className="p-3">Eklenme</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{s.name}</div>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener"
                          className="text-xs text-muted-foreground hover:text-brand inline-flex items-center gap-1"
                        >
                          {s.url} <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="p-3 text-xs">{s.user?.email}</td>
                      <td className="p-3 text-xs text-muted-foreground">{s.niche ?? '-'}</td>
                      <td className="p-3 text-xs">{s.language}</td>
                      <td className="p-3">
                        <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                      </td>
                      <td className="p-3 text-center font-mono">{s._count?.articles ?? 0}</td>
                      <td className="p-3">
                        {s.gscConnectedAt ? (
                          <Badge variant="success">bağlı</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                  {sites.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-muted-foreground">
                        Henüz site yok.
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
