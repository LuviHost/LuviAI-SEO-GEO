'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Settings as SettingsIcon, RefreshCw, Save, Brain, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { NICHES } from '@/lib/niches';
import { SectionHeader } from '@/components/ui/section-header';

export default function SettingsPage() {
  const { site, refresh } = useSiteContext();

  const [name, setName] = useState(site.name);
  const [niche, setNiche] = useState<string>(site.niche ?? 'diğer');
  const [customNiche, setCustomNiche] = useState<string>(
    site.niche && !NICHES.includes(site.niche as any) ? site.niche : '',
  );
  // DB'deki ayri alan (Site.customNiche) — yukaridaki "kendim yazayim" alanindan
  // farkli: o, niche kolonuna yaziliyor; bu, spesifik kategori olarak saklaniyor.
  const [specificCategory, setSpecificCategory] = useState<string>(site.customNiche ?? '');
  const [language, setLanguage] = useState(site.language ?? 'tr');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [brainJustReady, setBrainJustReady] = useState(false);
  // Brain regenerate başlangıcındaki updatedAt — yeni updatedAt görünce iş bitti demek.
  const regenStartedAt = useRef<string | null>(null);

  useEffect(() => {
    setName(site.name);
    setNiche(NICHES.includes(site.niche as any) ? (site.niche ?? 'diğer') : 'diğer');
    setCustomNiche(site.niche && !NICHES.includes(site.niche as any) ? site.niche : '');
    setSpecificCategory(site.customNiche ?? '');
    setLanguage(site.language ?? 'tr');
  }, [site.id, site.name, site.niche, site.customNiche, site.language]);

  const useCustomNiche = niche === 'diğer' || niche === 'custom';
  const isDirty =
    name.trim() !== site.name ||
    language !== (site.language ?? 'tr') ||
    specificCategory.trim() !== (site.customNiche ?? '') ||
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
        customNiche: specificCategory.trim() || null,
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
    setBrainJustReady(false);
    const startTs = Date.now();
    // Mevcut brain.updatedAt'ı önce çek — polling başlangıç noktası
    let currentUpdatedAt: string;
    try {
      const currentBrain = await api.getBrain(site.id).catch(() => null);
      currentUpdatedAt = currentBrain?.updatedAt ?? new Date(0).toISOString();
    } catch {
      currentUpdatedAt = new Date(0).toISOString();
    }
    // ÖNCE ref'i set et, SONRA regenerating=true ile useEffect'i tetikle.
    // (Aksi halde useEffect ilk renderda ref boş diye return eder, polling hiç başlamaz.)
    regenStartedAt.current = currentUpdatedAt;
    setRegenerating(true);
    try {
      await api.regenerateBrain(site.id);
      toast.success('Marka beyni üretimi başladı — 1–2 dakikada hazır olur', { duration: 8000 });
      // Görsel feedback için min 2.5 sn loading
      const elapsed = Date.now() - startTs;
      if (elapsed < 2500) await new Promise((r) => setTimeout(r, 2500 - elapsed));
    } catch (err: any) {
      toast.error(`Marka beyni üretilemedi: ${err.message}`);
      setRegenerating(false);
      regenStartedAt.current = null;
    }
    // setRegenerating(false) polling içinde → brain.updatedAt değişince
  };

  // Polling: brain endpoint'i 5sn'de bir çek, updatedAt değişene kadar bekle.
  useEffect(() => {
    if (!regenerating || !regenStartedAt.current) return;
    const started = regenStartedAt.current;
    let cancelled = false;

    const checkBrain = async () => {
      try {
        const brain = await api.getBrain(site.id);
        if (cancelled) return;
        if (brain?.updatedAt && brain.updatedAt !== started) {
          setRegenerating(false);
          setBrainJustReady(true);
          regenStartedAt.current = null;
          toast.success('Marka beyni güncellendi — AI görünürlük testleri yeni sektörle çalışacak', { duration: 6000 });
          setTimeout(() => setBrainJustReady(false), 8000);
        }
      } catch { /* polling devam */ }
    };

    const id = setInterval(checkBrain, 5000);
    // Max 3 dakika timeout
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setRegenerating(false);
      regenStartedAt.current = null;
      toast.info('Marka beyni henüz hazır değil — birkaç dakika sonra sayfayı yenile', { duration: 6000 });
    }, 180_000);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(timeoutId);
    };
  }, [regenerating, site.id]);

  return (
    <div className="space-y-5 max-w-3xl">
      <SectionHeader icon={SettingsIcon} title="Ayarlar" description="Site adını, sektörünü ve dilini düzenle; gerekirse marka beynini yeniden üret." />

      {/* Form */}
      <div className="rounded-2xl border bg-card p-6 space-y-5">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
            Site adı
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: RanksUp"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
            URL
          </label>
          <Input value={site.url} disabled className="font-mono text-sm" />
          <p className="text-[10px] text-muted-foreground mt-1">URL değiştirilemez. Yeni URL için yeni site oluştur.</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
            Sektör
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
            Sektörü doğru seçmek AI görünürlük testlerinde daha anlamlı sorular üretir.{' '}
            <strong>“Diğer”</strong> seçilirse AI asistanlarına genel sorular gider ve anılma şansı düşer.
          </p>
        </div>

        {/* Spesifik kategori — yukarıdaki 20 seçenek çoğu siteyi tam anlatmıyor
            (ör. futbol canlı skor platformu "haber/medya"ya düşüyordu). Rakip ve
            sorgu üreten tüm modüller ÖNCE bu alanı kullanır. */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
            Özel kategori <span className="font-normal text-label">(Ürün Radarı ve rakip tespiti bunu kullanır)</span>
          </label>
          <Input
            value={specificCategory}
            onChange={(e) => setSpecificCategory(e.target.value)}
            placeholder="Örn: futbol canlı skor platformu, tüplü dalış okulu, B2B SaaS analitik"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Boş bırakırsan marka beyni üretilirken otomatik doldurulur. Yukarıdaki geniş niş etiketiyle
            çelişirse <strong>bu alan kazanır</strong> — rakiplerin doğru bulunması için en kritik alan.
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
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
            className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
          >
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          {isDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">● Değişiklik var, kaydetmedin</span>
          )}
        </div>
      </div>

      {/* Marka beyni yeniden uretimi */}
      <div className={`rounded-xl border bg-card p-6 transition-colors ${brainJustReady ? 'border-success/40 bg-success/5' : ''}`}>
        <div className="flex items-start gap-4">
          <div className={`h-10 w-10 rounded-xl border grid place-items-center shrink-0 ${
            brainJustReady ? 'bg-success/10 text-success' : 'bg-muted/50 text-foreground/70'
          }`}>
            {brainJustReady ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Brain className={`h-5 w-5 ${regenerating ? 'motion-safe:animate-pulse' : ''}`} aria-hidden />}
          </div>
          <div className="flex-1">
            <h3 className="font-brand font-semibold mb-1">
              {brainJustReady ? 'Marka beyni güncellendi' : regenerating ? 'Marka beyni üretiliyor…' : 'Marka beynini yeniden üret'}
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              {regenerating
                ? 'Sayfadan çıksan da arka planda devam eder; hazır olunca bildirilir (1–2 dk).'
                : brainJustReady
                  ? 'Yeni marka sesi, ana konular ve AI soruları kaydedildi. AI görünürlük testleri artık güncel sektörle çalışır.'
                  : <>Sektörü ya da dili değiştirdiysen marka beynini yeniden üret: marka sesi, ana konular ve AI'a sorulan sorular yenilenir. AI görünürlük ölçümünün doğruluğu buna bağlıdır. <br /><span className="text-xs">1–2 dakika sürer; mevcut site taraması sonuçları korunur.</span></>
              }
            </p>
            <Button onClick={regenerateBrain} disabled={regenerating} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Üretiliyor… (1–2 dk)' : 'Marka beynini yeniden üret'}
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Daha kapsamlı ayar için{' '}
        <Link href={`/sites/${site.id}/connections`} className="text-brand-600 hover:underline">Bağlantılar</Link>{' '}veya{' '}
        <Link href={`/sites/${site.id}/autopilot`} className="text-brand-600 hover:underline">Otomatik Akış</Link>{' '}
        sayfalarına bak.
      </div>
    </div>
  );
}
