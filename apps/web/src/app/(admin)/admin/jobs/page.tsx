'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminFailedJobs().then(setJobs).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Hatalı İşler</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Son 50 başarısız job (worker queue)
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <div className="text-4xl mb-2">✓</div>
              Hiçbir başarısız iş yok.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3">Başlangıç</th>
                    <th className="p-3">Tip</th>
                    <th className="p-3">User / Site</th>
                    <th className="p-3">Hata</th>
                    <th className="p-3">Bitiş</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t hover:bg-muted/30 align-top">
                      <td className="p-3 text-xs whitespace-nowrap">
                        {j.startedAt ? new Date(j.startedAt).toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="p-3 text-xs font-mono">{j.type}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {j.userId?.slice(-6) ?? '-'} · {j.siteId?.slice(-6) ?? '-'}
                      </td>
                      <td className="p-3 text-xs text-red-500 max-w-md break-words">
                        {j.errorMessage ?? '(detay yok)'}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {j.finishedAt ? new Date(j.finishedAt).toLocaleString('tr-TR') : '-'}
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
