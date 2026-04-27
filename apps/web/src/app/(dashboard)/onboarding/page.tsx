'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const NICHES = [
  'web hosting', 'e-ticaret', 'SaaS', 'eğitim', 'sağlık',
  'finans', 'gayrimenkul', 'turizm', 'restoran', 'ajans', 'diğer',
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    url: '',
    name: '',
    niche: '',
    language: 'tr',
    persona: '',
    publishTarget: 'markdown_zip',
  });

  const next = () => setStep(s => Math.min(s + 1, 5));
  const prev = () => setStep(s => Math.max(s - 1, 1));

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      // Beta'da userId hardcoded — Faz 2'de session'dan
      const userId = 'cmohpuxgi0001lzwklj3ijs7l'; // beta@luviai.test seed

      const site = await api.createSite({
        userId,
        url: form.url,
        name: form.name,
        niche: form.niche,
        language: form.language,
      });

      // ONBOARDING_CHAIN otomatik queue'ya eklendi
      router.push(`/sites/${site.id}?onboarding=running`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>Adım {step}/5</span>
          <span>{Math.round((step / 5) * 100)}%</span>
        </div>
        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all" style={{ width: `${(step / 5) * 100}%` }} />
        </div>
      </div>

      <div className="bg-white rounded-xl p-8 shadow-sm border">
        {step === 1 && (
          <>
            <h2 className="text-2xl font-bold mb-2">Sitenizin URL'i</h2>
            <p className="text-slate-600 mb-6">Hangi siteyi büyütelim? Tam URL girin.</p>
            <input
              type="url"
              placeholder="https://siteniz.com"
              className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              autoFocus
            />
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-2xl font-bold mb-2">Marka adı</h2>
            <p className="text-slate-600 mb-6">Site/marka isminiz nedir?</p>
            <input
              type="text"
              placeholder="Örn: LuviHost"
              className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-2xl font-bold mb-2">Hangi sektördesiniz?</h2>
            <p className="text-slate-600 mb-6">AI marka sesini ve persona'larını buna göre ayarlar.</p>
            <div className="grid grid-cols-2 gap-3">
              {NICHES.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm({ ...form, niche: n })}
                  className={`px-4 py-3 border rounded-lg text-sm transition-colors ${
                    form.niche === n
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white hover:border-brand'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-2xl font-bold mb-2">İçerik dili</h2>
            <p className="text-slate-600 mb-6">Makaleler hangi dilde yayınlansın?</p>
            <div className="space-y-3">
              {[
                { value: 'tr', label: '🇹🇷 Türkçe', desc: 'Sadece Türkçe makaleler' },
                { value: 'en', label: '🇬🇧 İngilizce', desc: 'Sadece İngilizce' },
                { value: 'both', label: '🌍 Türkçe + İngilizce', desc: 'Her makale için seçim' },
              ].map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setForm({ ...form, language: o.value })}
                  className={`w-full text-left px-4 py-3 border rounded-lg ${
                    form.language === o.value ? 'bg-brand/10 border-brand' : 'hover:border-brand'
                  }`}
                >
                  <div className="font-semibold">{o.label}</div>
                  <div className="text-sm text-slate-500">{o.desc}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-2xl font-bold mb-2">Yayın hedefi</h2>
            <p className="text-slate-600 mb-6">Üretilen makaleler nereye gönderilsin?</p>
            <div className="space-y-3">
              {[
                { value: 'markdown_zip', label: '📦 Markdown ZIP', desc: 'Manuel indir, kendin yükle (test için ideal)' },
                { value: 'wordpress_rest', label: '📝 WordPress REST API', desc: 'Otomatik yayın (App Password gerekir)' },
                { value: 'ftp', label: '🌐 FTP', desc: 'Static HTML + FTP upload' },
                { value: 'sftp', label: '🔒 SFTP/SSH', desc: 'Static HTML + SSH key/password' },
              ].map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setForm({ ...form, publishTarget: o.value })}
                  className={`w-full text-left px-4 py-3 border rounded-lg ${
                    form.publishTarget === o.value ? 'bg-brand/10 border-brand' : 'hover:border-brand'
                  }`}
                >
                  <div className="font-semibold">{o.label}</div>
                  <div className="text-sm text-slate-500">{o.desc}</div>
                </button>
              ))}
            </div>
            <div className="mt-6 bg-brand/5 border border-brand/20 rounded-lg p-4 text-sm">
              <p className="font-semibold text-brand">🎁 İlk makale ücretsiz</p>
              <p className="text-slate-600 mt-1">
                "Bitir" dediğinizde sistem otomatik olarak: site analizi → topic queue → ilk makale üretimi yapar.
                ~5-10 dakika sürer, sonra dashboard'da görüntülersiniz.
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 flex justify-between">
          <button
            type="button"
            onClick={prev}
            disabled={step === 1 || loading}
            className="px-6 py-2 border rounded-lg disabled:opacity-50"
          >
            Geri
          </button>
          {step < 5 ? (
            <button
              type="button"
              onClick={next}
              disabled={
                (step === 1 && !form.url.startsWith('http')) ||
                (step === 2 && !form.name) ||
                (step === 3 && !form.niche)
              }
              className="px-6 py-2 bg-brand text-white rounded-lg disabled:opacity-50"
            >
              Devam
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="px-6 py-2 bg-brand text-white rounded-lg disabled:opacity-50"
            >
              {loading ? 'Başlatılıyor...' : 'Bitir + İlk Makaleyi Üret 🚀'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
