'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const NICHES = [
  'web hosting', 'e-ticaret', 'SaaS', 'eğitim', 'sağlık',
  'finans', 'gayrimenkul', 'turizm', 'restoran', 'ajans', 'diğer',
];

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    url: '',
    name: '',
    niche: '',
    language: 'tr', // varsayilan, sonra Ayarlar'dan degistirilebilir
  });

  const next = () => setStep((s) => Math.min(s + 1, 2));
  const prev = () => setStep((s) => Math.max(s - 1, 1));

  const submit = async () => {
    if (!session?.user?.id) {
      toast.error('Oturumun süresi doldu, lütfen tekrar giriş yapın.');
      router.push('/signin?callbackUrl=/onboarding');
      return;
    }
    if (!form.url || !form.name || !form.niche) {
      toast.error('Tüm alanları doldur');
      return;
    }
    setLoading(true);
    try {
      const site = await api.createSite({
        url: form.url,
        name: form.name,
        niche: form.niche,
        language: form.language,
      });
      toast.success('Site eklendi! Site sayfasında akış otomatik başlar.');
      router.push(`/sites/${site.id}?onboarding=running`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-4 sm:py-8">
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>Adım {step}/2</span>
          <span>{Math.round((step / 2) * 100)}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${(step / 2) * 100}%` }} />
        </div>
      </div>

      <Card>
        <CardContent className="p-6 sm:p-8">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Sitenizin URL'i</h2>
              <p className="text-muted-foreground mb-6">Hangi siteyi büyütelim? Tam URL gir.</p>
              <Input
                type="url"
                placeholder="https://siteniz.com"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-3">
                GSC ve Google Analytics entegrasyonu opsiyoneldir; site eklendikten sonra istersen Akış üzerinden bağlarsın.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Marka ve sektör</h2>
              <p className="text-muted-foreground mb-6">AI marka sesini buna göre ayarlar.</p>

              <label className="block text-sm font-medium mb-1">Marka adı</label>
              <Input
                placeholder="Örn: LuviHost"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />

              <div className="mt-5">
                <label className="block text-sm font-medium mb-2">Sektör / Niş</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NICHES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setForm({ ...form, niche: n })}
                      className={cn(
                        'px-3 py-2 border rounded-lg text-sm transition-colors',
                        form.niche === n
                          ? 'bg-brand text-white border-brand'
                          : 'bg-card hover:border-brand',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 bg-brand/5 border border-brand/20 rounded-lg p-4 text-sm">
                <p className="font-semibold text-brand mb-1">🎁 İlk makale ücretsiz</p>
                <p className="text-muted-foreground">
                  "Bitir" sonrası site sayfanda akış otomatik çalışır: marka analizi → site skoru → rakip tespiti → önerilen makaleler.
                  GSC/GA bağlamak istersen orada bir tıkla.
                </p>
              </div>
            </>
          )}

          <div className="mt-8 flex justify-between gap-3">
            <Button variant="outline" onClick={prev} disabled={step === 1 || loading}>
              Geri
            </Button>
            {step < 2 ? (
              <Button
                onClick={next}
                disabled={!form.url.startsWith('http')}
              >
                Devam
              </Button>
            ) : (
              <Button onClick={submit} disabled={loading || !form.name || !form.niche}>
                {loading ? 'Başlatılıyor…' : 'Bitir + Akışı Başlat 🚀'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
