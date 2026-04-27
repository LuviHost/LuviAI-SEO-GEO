'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const USER_ID = 'cmohpuxgi0001lzwklj3ijs7l'; // beta seed

export default function BillingPage() {
  const [current, setCurrent] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    Promise.all([
      fetch(`${apiBase}/api/billing/users/${USER_ID}/current`).then(r => r.json()),
      fetch(`${apiBase}/api/billing/users/${USER_ID}/invoices`).then(r => r.json()),
      fetch(`${apiBase}/api/billing/users/${USER_ID}/quota`).then(r => r.json()),
    ]).then(([c, i, q]) => {
      setCurrent(c);
      setInvoices(i);
      setQuota(q);
    });
  }, []);

  const cancel = async () => {
    if (!confirm('Aboneliği iptal etmek istediğine emin misin?')) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    await fetch(`${apiBase}/api/billing/users/${USER_ID}/cancel`, { method: 'POST' });
    location.reload();
  };

  if (!current) return <div className="p-8">Yükleniyor...</div>;

  const plan = current.plan;
  const articleUsage = quota?.articles ?? { remaining: 0, limit: 0 };
  const usagePct = articleUsage.limit > 0
    ? Math.round((1 - articleUsage.remaining / articleUsage.limit) * 100)
    : 0;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Abonelik & Faturalama</h1>

      <div className="bg-white border rounded-xl p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-sm text-slate-500">Mevcut planınız</div>
            <h2 className="text-2xl font-bold mt-1">{plan?.name ?? '-'}</h2>
            <div className="text-sm mt-1">
              <span className={`px-2 py-1 rounded ${
                current.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                current.status === 'TRIAL' ? 'bg-blue-100 text-blue-700' :
                'bg-slate-100'
              }`}>{current.status}</span>
            </div>
          </div>
          <div className="text-right">
            {plan?.monthly > 0 && (
              <div className="text-2xl font-bold">₺{plan.monthly}<span className="text-sm text-slate-500">/ay</span></div>
            )}
            {current.trialEndsAt && current.status === 'TRIAL' && (
              <div className="text-xs text-slate-500 mt-1">
                Trial bitiş: {new Date(current.trialEndsAt).toLocaleDateString('tr-TR')}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Bu ay kullanım</span>
            <span>{articleUsage.limit - articleUsage.remaining} / {articleUsage.limit} makale</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${usagePct}%` }} />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Link href="/pricing" className="px-4 py-2 bg-brand text-white rounded-lg">Plan Yükselt</Link>
          {current.status === 'ACTIVE' && (
            <button onClick={cancel} className="px-4 py-2 border rounded-lg text-red-600">İptal Et</button>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-xl">
        <div className="p-6 border-b">
          <h2 className="font-bold">Fatura Geçmişi</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Henüz fatura yok.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 text-sm">
              <tr>
                <th className="text-left p-4">Tarih</th>
                <th className="text-left p-4">Açıklama</th>
                <th className="text-right p-4">Tutar</th>
                <th className="text-left p-4">Durum</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t">
                  <td className="p-4 text-sm">{new Date(inv.createdAt).toLocaleDateString('tr-TR')}</td>
                  <td className="p-4 text-sm">{inv.description}</td>
                  <td className="p-4 text-sm text-right">₺{Number(inv.amount).toLocaleString('tr-TR')}</td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-1 rounded ${
                      inv.status === 'PAID' ? 'bg-green-100 text-green-700' :
                      inv.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>{inv.status}</span>
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
