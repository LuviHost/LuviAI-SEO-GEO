'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Ziyaretçi',
  retest_cron: 'Otomatik retest',
  signup_baseline: 'Kayıt baseline',
};

const SOURCE_VARIANT: Record<string, any> = {
  manual: 'default',
  retest_cron: 'secondary',
  signup_baseline: 'success',
};

type Lead = {
  id: string; domain: string; brand: string; niche: string | null;
  source: string; ip: string | null; totalCalls: number; costUsd: number;
  createdAt: string; citedScore: number; maxScore: number; queriesCount: number; totalProviders: number;
};

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d;
  }
}

export default function AdminLeadsPage() {
  const [data, setData] = useState<{ items: Lead[]; total: number; today: number; uniqueDomains: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.getAdminCitationLeads({ limit: 200 }).then(setData).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((l) =>
      (l.domain ?? '').toLowerCase().includes(needle) ||
      (l.brand ?? '').toLowerCase().includes(needle) ||
      (l.niche ?? '').toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">AI Test Leadleri</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Üye olmadan yapılan anonim AI görünürlük testleri (citation-check)
          </p>
        </div>
        <Input
          placeholder="domain, marka veya niche ara..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {/* Özet istatistik */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-bold">{data?.total ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Toplam test</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-bold text-orange-600">{data?.uniqueDomains ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Tekil domain (lead)</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-bold text-green-600">{data?.today ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Bugün</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Henüz test kaydı yok.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Domain / Marka</th>
                  <th className="px-4 py-3 font-medium">Niche</th>
                  <th className="px-4 py-3 font-medium">AI Görünürlük</th>
                  <th className="px-4 py-3 font-medium">Kaynak</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium text-right">Maliyet</th>
                  <th className="px-4 py-3 font-medium text-right">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.brand || l.domain}</div>
                      <a href={`https://${l.domain}`} target="_blank" rel="noopener" className="text-xs text-orange-600 hover:underline">{l.domain}</a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{l.niche ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={l.citedScore > 0 ? 'font-semibold text-green-600' : 'text-muted-foreground'}>
                        {l.citedScore}/{l.maxScore || '—'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">({l.queriesCount} sorgu × {l.totalProviders} motor)</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={SOURCE_VARIANT[l.source] ?? 'outline'}>{SOURCE_LABEL[l.source] ?? l.source}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.ip ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">${(l.costUsd ?? 0).toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {data && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {q ? `${filtered.length} sonuç gösteriliyor` : `Son ${data.items.length} kayıt gösteriliyor (toplam ${data.total})`}
        </p>
      )}
    </div>
  );
}
