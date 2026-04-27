const plans = [
  { name: 'Starter', price: 499, articles: 10, sites: 1, popular: false },
  { name: 'Pro', price: 1299, articles: 50, sites: 3, popular: true },
  { name: 'Agency', price: 3299, articles: 250, sites: 10, popular: false },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen p-8 bg-slate-50">
      <h1 className="text-4xl font-bold text-center mb-12">Plan Seçenekleri</h1>
      <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {plans.map(p => (
          <div key={p.name} className={`bg-white rounded-xl p-6 shadow ${p.popular ? 'border-2 border-brand' : ''}`}>
            {p.popular && <div className="text-xs uppercase text-brand font-bold mb-2">EN POPÜLER</div>}
            <h2 className="text-2xl font-bold">{p.name}</h2>
            <div className="my-4"><span className="text-4xl font-bold">₺{p.price}</span><span className="text-slate-500">/ay</span></div>
            <ul className="text-sm text-slate-600 space-y-2 mb-6">
              <li>✓ {p.articles} makale/ay</li>
              <li>✓ {p.sites} site</li>
              <li>✓ Otomatik yayın</li>
              <li>✓ TR + EN içerik</li>
            </ul>
            <a href="/login" className="block w-full text-center py-3 bg-brand text-white rounded-lg font-semibold">14 Gün Ücretsiz</a>
          </div>
        ))}
      </div>
    </main>
  );
}
