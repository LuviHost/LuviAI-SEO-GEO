'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Settings as SettingsIcon, RefreshCw, Save, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { NICHES } from '@/lib/niches';

export default function SettingsPage() {
  const { site, refresh } = useSiteContext();

  const [name, setName] = useState(site.name);
  const [niche, setNiche] = useState<string>(site.niche ?? 'diğer');
  const [customNiche, setCustomNiche] = useState<string>(
    site.niche && !NICHES.includes(site.niche as any) ? site.niche : '',
  );
  const [language, setLanguage] = useState(site.language ?? 'tr');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setName(site.name);
    setNiche(NICHES.includes(site.niche as any) ? (site.niche ?? 'diğer') : 'diğer');
    setCustomNiche(site.niche && !NICHES.includes(site.niche as any) ? site.niche : '');
    setLanguage(site.language ?? 'tr');
  }, [site.id, site.name, site.niche, site.language]);

  const useCustomNiche = niche === 'diğer' || niche === 'custom';
  const isDirty =
    name.trim() !== site.name ||
    language !== (site.language ?? 'tr') ||
    (useCustomNiche
      ? customNiche.trim() !== (site.niche ?? '')
      : niche !== (site.niche ?? 'diğer'));

  const save = async () => {
    if (!isDirty) return;
    const finalNiche = useCustomNiche ? customNiche.trim() || 'diğer' : niche;
    setSaving(true);
    try {
      await api.updateSite(site.id, {
        name: name.trim(),
        niche: finalNiche,
        language,
      });
      toast.success('Ayarlar kaydedildi');
      await refresh?.();
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const regenerateBrain = async () => {
    setRegenerating(true);
    try {
      await api.regenerateBrain(site.id);
      toast.success('Brain yeniden üretiliyor — birkaç dakika sürer');
    } catch (err: any) {
      toast.error(`Brain regenerate başarısız: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-600 grid place-items-center">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Ayarlar</h2>
          <p className="text-sm text-muted-foreground">Site adı, niş ve dil ayarlarını düzenle. Brain'i yeniden üretebilirsin.</p>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-2xl border bg-card p-6 space-y-5">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Site Adı
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: LuviAI"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            URL
          </label>
          <Input value={site.url} disabled className="font-mono text-sm" />
          <p className="text-[10px] text-muted-foreground mt-1">URL değiştirilemez. Yeni URL için yeni site oluştur.</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Niş / Sektör
          </label>
          <select
            value={useCustomNiche ? 'custom' : niche}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                setNiche('diğer');
                setCustomNiche(customNiche || '');
              } else {
                setNiche(v);
                setCustomNiche('');
              }
            }}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
          >
            {NICHES.filter(n => n !== 'diğer').map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="diğer">diğer</option>
            <option value="custom">✍️ Kendim yazayım…</option>
          </select>
          {useCustomNiche && (
            <Input
              value={customNiche}
              onChange={(e) => setCustomNiche(e.target.value)}
              placeholder="Örn: AI SEO platformu, KOBİ dijitalleşme, B2B SaaS analitik"
              className="mt-2"
            />
          )}
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Spesifik niş yazmak AI Citation testlerinde daha anlamlı sorgu üretir.{' '}
            <strong>"diğer"</strong> seçeneği AI motorlarına generic sorgu gönderir, atıf alma şansı düşer.
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Dil
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
            <option value="both">İki dilli (TR + EN)</option>
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={save}
            disabled={!isDirty || saving}
            className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
          >
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          {isDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">● Değişiklik var, kaydetmedin</span>
          )}
        </div>
      </div>

      {/* Brain regenerate */}
      <div className="rounded-2xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 grid place-items-center shrink-0">
            <Brain className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">Brain'i yeniden üret</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Niş veya dil değiştirdiysen, brain'i yeniden ürettiğinde yeni marka sesi, pillar konular ve AEO/GEO
              sorguları üretilir. AI Citation skoru için kritik.
              <br />
              <span className="text-xs">~1-2 dakika sürer. Mevcut audit sonuçları korunur.</span>
            </p>
            <Button
              onClick={regenerateBrain}
              disabled={regenerating}
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Tetiklendi…' : "Brain'i yeniden üret"}
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Daha kapsamlı ayar için{' '}
        <Link href={`/sites/${site.id}/connections`} className="text-orange-600 hover:underline">Bağlantılar</Link>{' '}veya{' '}
        <Link href={`/sites/${site.id}/autopilot`} className="text-orange-600 hover:underline">Otomatik Akış</Link>{' '}
        sayfalarına bak.
      </div>
    </div>
  );
}
