'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.listSites(), api.getAdminOverview()])
      .then(([s, o]) => { setSites(s); setOverview(o); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ONBOARDING: 'bg-yellow-100 text-yellow-700',
      AUDIT_PENDING: 'bg-blue-100 text-blue-700',
      AUDIT_COMPLETE: 'bg-purple-100 text-purple-700',
      ACTIVE: 'bg-green-100 text-green-700',
      PAUSED: 'bg-slate-100 text-slate-700',
      ERROR: 'bg-red-100 text-red-700',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs ${colors[status] ?? 'bg-slate-100'}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Link
          href="/onboarding"
          className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand/90"
        >
          + Yeni Site
        </Link>
      </div>

      {overview && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Stat label="Sites" value={overview.sites} />
          <Stat label="Users" value={overview.users} />
          <Stat label="Published" value={overview.publishedArticles} />
          <Stat label="Failed Jobs" value={overview.failedJobs} color={overview.failedJobs > 0 ? 'red' : 'slate'} />
        </div>
      )}

      <div className="bg-white rounded-xl border">
        <div className="p-6 border-b">
          <h2 className="font-bold">Sitelerim</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-500">Yükleniyor...</div>
        ) : sites.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 mb-4">Henüz site eklenmemiş.</p>
            <Link href="/onboarding" className="text-brand font-semibold">İlk siteni ekle →</Link>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 text-sm text-slate-600">
              <tr>
                <th className="text-left p-4">Site</th>
                <th className="text-left p-4">URL</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Niş</th>
                <th className="text-right p-4"></th>
              </tr>
            </thead>
            <tbody>
              {sites.map(s => (
                <tr key={s.id} className="border-t hover:bg-slate-50">
                  <td className="p-4 font-semibold">{s.name}</td>
                  <td className="p-4 text-sm text-slate-600">{s.url}</td>
                  <td className="p-4">{statusBadge(s.status)}</td>
                  <td className="p-4 text-sm">{s.niche ?? '-'}</td>
                  <td className="p-4 text-right">
                    <Link href={`/sites/${s.id}`} className="text-brand text-sm font-semibold">Aç →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'brand' }: { label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    brand: 'bg-brand/10 text-brand',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-50 text-slate-600',
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}
