'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function PricingPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getPlans().then(setPlans).catch(() => {});
  }, []);

  const subscribe = async (planId: string) => {
    setLoading(true);
    try {
      const userId = 'cmohpuxgi0001lzwklj3ijs7l'; // beta seed
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/billing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, planId, cycle,
          userEmail: 'beta@luviai.test',
          userName: 'Beta Tester',
        }),
      });
      const data = await res.json();
      if (data.iframeUrl) {
        window.location.href = data.iframeUrl;
      } else {
        alert('Hata: ' + (data.message ?? JSON.stringify(data)));
      }
    } finally {
      setLoading(false);
    }
  };

  const realPlans = plans.filter(p => p.id !== 'trial');

  return (
    <main className="min-h-screen p-8 bg-slate-50">
      <h1 className="text-4xl font-bold text-center mb-2">Plan Seçenekleri</h1>
      <p className="text-center text-slate-600 mb-8">14 gün ücretsiz başla, dilediğin zaman iptal et.</p>

      <div className="flex justify-center mb-8">
        <div className="inline-flex bg-white border rounded-lg p-1">
          <button
            onClick={() => setCycle('monthly')}
            className={`px-4 py-2 rounded ${cycle === 'monthly' ? 'bg-brand text-white' : 'text-slate-600'}`}
          >Aylık</button>
          <button
            onClick={() => setCycle('annual')}
            className={`px-4 py-2 rounded ${cycle === 'annual' ? 'bg-brand text-white' : 'text-slate-600'}`}
          >Yıllık <span className="text-xs ml-1">-%20</span></button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {realPlans.map((p) => {
          const price = cycle === 'annual' ? p.annual : p.monthly;
          const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
          return (
            <div
              key={p.id}
              className={`bg-white rounded-xl p-6 shadow ${
                p.popular ? 'border-2 border-brand ring-4 ring-brand/10' : ''
              }`}
            >
              {p.popular && (
                <div className="text-xs uppercase text-brand font-bold mb-2">EN POPÜLER</div>
              )}
              <h2 className="text-2xl font-bold">{p.name}</h2>
              <div className="my-4">
                <span className="text-4xl font-bold">₺{price.toLocaleString('tr-TR')}</span>
                <span className="text-slate-500">/{cycle === 'annual' ? 'yıl' : 'ay'}</span>
                {cycle === 'annual' && (
                  <div className="text-sm text-slate-400 mt-1">aylık ortalama ₺{monthlyEq}</div>
                )}
              </div>
              <ul className="text-sm text-slate-600 space-y-2 mb-6">
                <li>✓ {p.articlesPerMonth} makale/ay</li>
                <li>✓ {p.sites} site</li>
                <li>✓ {p.publishTargets === 'all' ? 'Tüm yayın hedefleri' : 'Sadece Markdown ZIP'}</li>
                <li>✓ {p.support}</li>
                <li>✓ TR + EN içerik</li>
                <li>✓ AI search (GEO) optimizasyonu</li>
              </ul>
              <button
                onClick={() => subscribe(p.id)}
                disabled={loading}
                className="block w-full text-center py-3 bg-brand text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {loading ? 'Yönlendiriliyor...' : '14 Gün Ücretsiz Başla'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-12 max-w-3xl mx-auto text-center text-sm text-slate-500">
        <p>💳 PayTR güvenli ödeme · ✅ İstediğin zaman iptal · 🇹🇷 KDV dahil</p>
      </div>
    </main>
  );
}
