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

const PUBLISH_TARGETS = [
  { value: 'markdown_zip',     label: '📦 Markdown ZIP',        desc: 'Manuel indir, kendin yükle (test için ideal)' },
  { value: 'wordpress_rest',   label: '📝 WordPress REST',      desc: 'Otomatik yayın (App Password)' },
  { value: 'wordpress_xmlrpc', label: '📝 WordPress XML-RPC',   desc: 'Eski WP sürümleri (4.7 öncesi)' },
  { value: 'ftp',              label: '🌐 FTP',                 desc: 'Static HTML + FTP upload' },
  { value: 'sftp',             label: '🔒 SFTP / SSH',          desc: 'Static HTML + SSH key veya password' },
  { value: 'cpanel_api',       label: '🎛️ cPanel API',          desc: 'cPanel File Manager (token auth)' },
  { value: 'github',           label: '🐙 GitHub Repo',         desc: 'Hugo, Jekyll, Astro, MDX siteler' },
  { value: 'webflow',          label: '🎨 Webflow CMS',         desc: 'Webflow CMS Collection' },
  { value: 'sanity',           label: '✨ Sanity',              desc: 'Headless CMS (Portable Text)' },
  { value: 'contentful',       label: '📚 Contentful',          desc: 'Management API + auto publish' },
  { value: 'ghost',            label: '👻 Ghost',               desc: 'Ghost Admin API (JWT)' },
  { value: 'whmcs_kb',         label: '🛠️ WHMCS Bilgi Bankası', desc: 'WHMCS Knowledgebase makalesi' },
  { value: 'strapi',           label: '🚀 Strapi',              desc: 'Strapi 4+ REST API' },
  { value: 'custom_php',       label: '🔧 Custom PHP',          desc: 'Kendi PHP API\'ınız + HMAC' },
];

const LANGS = [
  { value: 'tr', label: '🇹🇷 Türkçe', desc: 'Sadece Türkçe makaleler' },
  { value: 'en', label: '🇬🇧 İngilizce', desc: 'Sadece İngilizce' },
  { value: 'both', label: '🌍 İkisi de', desc: 'Her makale için seçim' },
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
    language: 'tr',
    publishTarget: 'markdown_zip',
  });

  const next = () => setStep((s) => Math.min(s + 1, 5));
  const prev = () => setStep((s) => Math.max(s - 1, 1));

  const submit = async () => {
    if (!session?.user?.id) {
      toast.error('Oturumun süresi doldu, lütfen tekrar giriş yapın.');
      router.push('/signin?callbackUrl=/onboarding');
      return;
    }
    setLoading(true);
    try {
      const site = await api.createSite({
        userId: session.user.id,
        url: form.url,
        name: form.name,
        niche: form.niche,
        language: form.language,
      });
      toast.success('Site eklendi! Onboarding chain başlatıldı.');
      router.push(`/sites/${site.id}?onboarding=running`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>Adım {step}/5</span>
          <span>{Math.round((step / 5) * 100)}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${(step / 5) * 100}%` }} />
        </div>
      </div>

      <Card>
        <CardContent className="p-8">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Sitenizin URL'i</h2>
              <p className="text-muted-foreground mb-6">Hangi siteyi büyütelim? Tam URL girin.</p>
              <Input
                type="url"
                placeholder="https://siteniz.com"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                autoFocus
              />
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Marka adı</h2>
              <p className="text-muted-foreground mb-6">Site/marka isminiz nedir?</p>
              <Input
                placeholder="Örn: LuviHost"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Hangi sektördesiniz?</h2>
              <p className="text-muted-foreground mb-6">AI marka sesini buna göre ayarlar.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {NICHES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm({ ...form, niche: n })}
                    className={cn(
                      'px-3 py-3 border rounded-lg text-sm transition-colors',
                      form.niche === n
                        ? 'bg-brand text-white border-brand'
                        : 'bg-card hover:border-brand',
                    )}
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
              <p className="text-muted-foreground mb-6">Makaleler hangi dilde yayınlansın?</p>
              <div className="space-y-3">
                {LANGS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setForm({ ...form, language: o.value })}
                    className={cn(
                      'w-full text-left p-4 border rounded-lg transition-colors',
                      form.language === o.value
                        ? 'bg-brand/10 border-brand'
                        : 'hover:border-brand/50',
                    )}
                  >
                    <div className="font-semibold">{o.label}</div>
                    <div className="text-sm text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <h2 className="text-2xl font-bold mb-2">Yayın hedefi</h2>
              <p className="text-muted-foreground mb-6">Üretilen makaleler nereye gönderilsin?</p>
              <div className="space-y-3">
                {PUBLISH_TARGETS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setForm({ ...form, publishTarget: o.value })}
                    className={cn(
                      'w-full text-left p-4 border rounded-lg transition-colors',
                      form.publishTarget === o.value
                        ? 'bg-brand/10 border-brand'
                        : 'hover:border-brand/50',
                    )}
                  >
                    <div className="font-semibold">{o.label}</div>
                    <div className="text-sm text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
              <div className="mt-6 bg-brand/5 border border-brand/20 rounded-lg p-4 text-sm">
                <p className="font-semibold text-brand mb-1">🎁 İlk makale ücretsiz</p>
                <p className="text-muted-foreground">
                  "Bitir" dediğinizde sistem: site analizi → topic queue → ilk makale üretir. ~5-10 dk.
                </p>
              </div>
            </>
          )}

          <div className="mt-8 flex justify-between gap-3">
            <Button
              variant="outline"
              onClick={prev}
              disabled={step === 1 || loading}
            >
              Geri
            </Button>
            {step < 5 ? (
              <Button
                onClick={next}
                disabled={
                  (step === 1 && !form.url.startsWith('http')) ||
                  (step === 2 && !form.name) ||
                  (step === 3 && !form.niche)
                }
              >
                Devam
              </Button>
            ) : (
              <Button onClick={submit} disabled={loading}>
                {loading ? 'Başlatılıyor…' : 'Bitir + İlk Makaleyi Üret 🚀'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
