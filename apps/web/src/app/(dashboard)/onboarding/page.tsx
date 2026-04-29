'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

const STEPS = [
  { num: 1, label: 'Site Adresi' },
  { num: 2, label: 'Marka & Niş' },
  { num: 3, label: 'Bağlantılar' },
  { num: 4, label: 'Yayın Hedefi' },
  { num: 5, label: 'Otomatik Üretim' },
  { num: 6, label: 'Sosyal Medya' },
];

const FREQUENCIES = [
  { value: 'weekly',          label: 'Haftada 1 yazı',  hint: 'Pazartesi günleri',          articlesPerMonth: 4 },
  { value: 'three_per_week',  label: 'Haftada 3 yazı',  hint: 'Pzt / Çrş / Cum günleri',    articlesPerMonth: 12 },
  { value: 'daily',           label: 'Her gün',         hint: 'Yoğun içerik üretimi',       articlesPerMonth: 30 },
];

type LocalState = {
  siteId?: string;
  step: number;
  url: string;
  name: string;
  niche: string;
  language: string;
  publishApprovalMode: 'manual_approve' | 'auto_publish';
  autoGenerationFrequency: 'daily' | 'three_per_week' | 'weekly';
  autoGenerationHour: number;
  autopilot: boolean;
  publishTargetCount: number;
  socialChannelCount: number;
};

const STORAGE_KEY = 'luviai-onboarding-v2';

const DEFAULT_STATE: LocalState = {
  step: 1,
  url: '',
  name: '',
  niche: '',
  language: 'tr',
  publishApprovalMode: 'manual_approve',
  autoGenerationFrequency: 'weekly',
  autoGenerationHour: 9,
  autopilot: true,
  publishTargetCount: 0,
  socialChannelCount: 0,
};

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();

  const [state, setState] = useState<LocalState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState({ ...DEFAULT_STATE, ...parsed });
      }
    } catch (_e) { /* noop */ }
    setHydrated(true);
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_e) { /* noop */ }
  }, [state, hydrated]);

  // Resume from URL ?siteId=...&step=N
  useEffect(() => {
    if (!hydrated) return;
    const sid = params.get('siteId');
    const sp = params.get('step');
    if (sid && sid !== state.siteId) setState((s) => ({ ...s, siteId: sid }));
    if (sp) setState((s) => ({ ...s, step: Math.max(1, Math.min(6, parseInt(sp, 10) || 1)) }));
  }, [hydrated, params]);

  const update = (patch: Partial<LocalState>) => setState((s) => ({ ...s, ...patch }));

  const goNext = () => update({ step: Math.min(6, state.step + 1) });
  const goPrev = () => update({ step: Math.max(1, state.step - 1) });
  const goStep = (n: number) => {
    if (n <= state.step || state.siteId) update({ step: n });
  };

  // ─── ADIM 1 → siteyi olustur veya devam et
  const handleStep1Continue = async () => {
    if (!state.url.startsWith('http')) {
      toast.error('Geçerli bir URL gir (https:// ile başlamalı)');
      return;
    }
    if (!session?.user?.id) {
      router.push('/signin?callbackUrl=/onboarding');
      return;
    }
    setLoading(true);
    try {
      let siteId = state.siteId;
      if (!siteId) {
        // Site'i hemen olustur (placeholder name + niche)
        const guessedName = (() => {
          try { return new URL(state.url).hostname.replace(/^www\./, '').split('.')[0]; }
          catch { return 'My Site'; }
        })();
        const created = await api.createSite({
          url: state.url,
          name: guessedName,
          niche: 'diğer',
          language: state.language,
        } as any);
        siteId = created.id;
        update({ siteId, name: guessedName });
        toast.success('Site oluşturuldu — arka planda tarama başlatıldı');
      } else {
        await api.updateSite(siteId, { onboardingStep: 2 });
      }
      goNext();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── ADIM 2 → marka/nis kaydet
  const handleStep2Continue = async () => {
    if (!state.siteId) return;
    if (!state.name.trim()) { toast.error('Marka adı zorunlu'); return; }
    if (!state.niche) { toast.error('Sektör seç'); return; }
    setLoading(true);
    try {
      await api.updateSite(state.siteId, { name: state.name, niche: state.niche, onboardingStep: 3 });
      goNext();
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  // ─── ADIM 5 → takvim/onay kaydet
  const handleStep5Continue = async () => {
    if (!state.siteId) return;
    setLoading(true);
    try {
      await api.updateSite(state.siteId, {
        publishApprovalMode: state.publishApprovalMode,
        autoGenerationFrequency: state.autoGenerationFrequency,
        autoGenerationHour: state.autoGenerationHour,
        onboardingStep: 6,
      });
      goNext();
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  // ─── BITIR
  const handleFinish = async () => {
    if (!state.siteId) return;
    setLoading(true);
    try {
      await api.completeOnboarding(state.siteId);
      localStorage.removeItem(STORAGE_KEY);
      toast.success('Hazır! Site dashboard\'una yönlendiriliyorsun…');
      router.push(`/sites/${state.siteId}?onboarding=done`);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  if (!hydrated) {
    return <div className="max-w-2xl mx-auto py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-8">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>Adım {state.step}/6 · {STEPS[state.step - 1]?.label}</span>
          <span>{Math.round((state.step / 6) * 100)}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-all duration-300" style={{ width: `${(state.step / 6) * 100}%` }} />
        </div>
        <div className="flex gap-1 mt-2 text-[10px]">
          {STEPS.map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => goStep(s.num)}
              className={cn(
                'flex-1 py-1 px-1 rounded transition-colors text-center',
                s.num === state.step ? 'bg-brand text-white' :
                s.num < state.step ? 'bg-muted hover:bg-muted/70 cursor-pointer' :
                'text-muted-foreground/50 cursor-not-allowed',
              )}
              disabled={s.num > state.step}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-6 sm:p-8">
          {state.step === 1 && <Step1 state={state} update={update} loading={loading} onContinue={handleStep1Continue} router={router} setLoading={setLoading} />}
          {state.step === 2 && <Step2 state={state} update={update} />}
          {state.step === 3 && <Step3 state={state} />}
          {state.step === 4 && <Step4 state={state} update={update} />}
          {state.step === 5 && <Step5 state={state} update={update} />}
          {state.step === 6 && <Step6 state={state} update={update} />}

          <div className="mt-8 flex justify-between gap-3 pt-4 border-t">
            <Button variant="outline" onClick={goPrev} disabled={state.step === 1 || loading}>
              ← Geri
            </Button>
            {state.step === 1 && (
              <Button onClick={handleStep1Continue} disabled={loading || !state.url.startsWith('http')}>
                {loading ? 'Oluşturuluyor…' : 'Devam →'}
              </Button>
            )}
            {state.step === 2 && (
              <Button onClick={handleStep2Continue} disabled={loading || !state.name || !state.niche}>
                {loading ? 'Kaydediliyor…' : 'Devam →'}
              </Button>
            )}
            {state.step === 3 && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { update({ step: 4 }); }}>
                  Şimdilik atla
                </Button>
                <Button onClick={() => update({ step: 4 })}>
                  Devam →
                </Button>
              </div>
            )}
            {state.step === 4 && (
              <Button
                onClick={() => update({ step: 5 })}
                disabled={state.publishTargetCount === 0}
                title={state.publishTargetCount === 0 ? 'En az 1 yayın hedefi seç' : undefined}
              >
                Devam →
              </Button>
            )}
            {state.step === 5 && (
              <Button onClick={handleStep5Continue} disabled={loading}>
                {loading ? 'Kaydediliyor…' : 'Devam →'}
              </Button>
            )}
            {state.step === 6 && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleFinish} disabled={loading}>
                  Sosyal medyayı sonra ekle
                </Button>
                <Button onClick={handleFinish} disabled={loading}>
                  {loading ? 'Bitiriliyor…' : 'Bitir 🚀'}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* "Sıfırla" — geliştirme/test için */}
      {state.siteId && (
        <p className="text-center mt-4 text-[10px] text-muted-foreground">
          Site ID: {state.siteId} ·{' '}
          <button
            className="underline"
            onClick={() => {
              if (confirm('Onboarding state sıfırlansın mı? (siteyi silmez)')) {
                localStorage.removeItem(STORAGE_KEY);
                window.location.reload();
              }
            }}
          >
            wizard'ı sıfırla
          </button>
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 1 — Site URL
// ──────────────────────────────────────────────────────────────────────
function Step1({ state, update, loading, onContinue, router, setLoading }: any) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Sitenizin URL'i</h2>
      <p className="text-muted-foreground mb-6">Hangi siteyi büyütelim? Tam URL gir.</p>
      <Input
        type="url"
        placeholder="https://siteniz.com"
        value={state.url}
        onChange={(e) => update({ url: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') onContinue(); }}
        autoFocus
      />
      <p className="text-xs text-muted-foreground mt-3">
        URL'i girip Devam'a basınca site oluşturulur ve arka planda tarama başlar.
        Sonraki adımları doldururken tarama biter; 4. adımda sonucu göreceksin.
      </p>

      <div className="mt-6 rounded-lg border border-brand/30 bg-brand/5 p-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">🎁 Önce LuviAI'ı tanımak ister misin?</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Tek tıkla örnek site oluştur — 5 dummy makale + audit + AI snapshot.</p>
        </div>
        <Button size="sm" variant="outline" type="button" onClick={async () => {
          try {
            setLoading(true);
            const r = await api.createDemoSite();
            toast.success('Demo site hazır');
            router.push(`/sites/${r.siteId}`);
          } catch (err: any) { toast.error(err.message); setLoading(false); }
        }} disabled={loading}>
          Demo Aç
        </Button>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 2 — Marka & Niş
// ──────────────────────────────────────────────────────────────────────
function Step2({ state, update }: any) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Marka ve sektör</h2>
      <p className="text-muted-foreground mb-6">AI marka sesini buna göre ayarlar. URL'den tahmin edildi — onaylayabilir veya düzeltebilirsin.</p>

      <label className="block text-sm font-medium mb-1">Marka adı</label>
      <Input
        placeholder="Örn: LuviHost"
        value={state.name}
        onChange={(e) => update({ name: e.target.value })}
        autoFocus
      />

      <div className="mt-5">
        <label className="block text-sm font-medium mb-2">Sektör / Niş</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NICHES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => update({ niche: n })}
              className={cn(
                'px-3 py-2 border rounded-lg text-sm transition-colors',
                state.niche === n
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
        <p className="font-semibold text-brand mb-1">🧠 Brain otomatik üretiliyor</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Site eklendi ve AI şu an markanın tonunu, hedef kitleni ve rakiplerini analiz ediyor. Sen bu adımları tamamlarken brain hazır olur — son adımda göreceksin.
        </p>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 3 — GSC + GA4 (Opsiyonel)
// ──────────────────────────────────────────────────────────────────────
function Step3({ state }: { state: LocalState }) {
  const [gscConnecting, setGscConnecting] = useState(false);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gscConnected, setGscConnected] = useState(false);
  const [gaConnected, setGaConnected] = useState(false);

  // Site bilgisini fetch et — bağlanmış mı bak
  useEffect(() => {
    if (!state.siteId) return;
    (async () => {
      try {
        const site = await api.getSite(state.siteId!);
        setGscConnected(!!site.gscPropertyUrl || !!site.gscRefreshToken);
        setGaConnected(!!site.gaPropertyId || !!site.gaRefreshToken);
      } catch (_e) { /* noop */ }
    })();
  }, [state.siteId]);

  const connectGsc = async () => {
    if (!state.siteId) return;
    setGscConnecting(true);
    try {
      const { url } = await api.getGscAuthUrl(state.siteId);
      window.open(url, '_blank', 'width=600,height=700');
      toast.info('Yeni pencerede GSC\'ye bağlan, sonra bu sekmeye geri dön');
    } catch (err: any) { toast.error(err.message); }
    finally { setGscConnecting(false); }
  };

  const connectGa = async () => {
    if (!state.siteId) return;
    setGaConnecting(true);
    try {
      const { url } = await api.getGaAuthUrl(state.siteId);
      window.open(url, '_blank', 'width=600,height=700');
      toast.info('Yeni pencerede GA\'ya bağlan, sonra bu sekmeye geri dön');
    } catch (err: any) { toast.error(err.message); }
    finally { setGaConnecting(false); }
  };

  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Bağlantılar (opsiyonel)</h2>
      <p className="text-muted-foreground mb-6">
        Bu entegrasyonlar olmadan da çalışır, ama GSC + GA4 verisi içerik kalitesini ciddi artırır.
      </p>

      <div className="space-y-3">
        <div className={cn('rounded-lg border p-4 flex items-center justify-between gap-3', gscConnected && 'border-green-500/50 bg-green-500/5')}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">Google Search Console</p>
              {gscConnected && <span className="text-xs text-green-600">✓ Bağlı</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Hangi sorgulardan trafik geliyor, low-CTR fırsatları bul.</p>
          </div>
          <Button size="sm" variant={gscConnected ? 'outline' : 'default'} onClick={connectGsc} disabled={gscConnecting}>
            {gscConnecting ? '…' : gscConnected ? 'Yeniden bağla' : 'Bağla'}
          </Button>
        </div>

        <div className={cn('rounded-lg border p-4 flex items-center justify-between gap-3', gaConnected && 'border-green-500/50 bg-green-500/5')}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">Google Analytics 4</p>
              {gaConnected && <span className="text-xs text-green-600">✓ Bağlı</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Bounce, conversion, session signal'i — yazıların gerçek performansı.</p>
          </div>
          <Button size="sm" variant={gaConnected ? 'outline' : 'default'} onClick={connectGa} disabled={gaConnecting}>
            {gaConnecting ? '…' : gaConnected ? 'Yeniden bağla' : 'Bağla'}
          </Button>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        💡 Bunları sonra Ayarlar → Entegrasyonlar'dan da bağlayabilirsin.
      </p>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 4 — Yayın Hedefi (ZORUNLU, en az 1)
// ──────────────────────────────────────────────────────────────────────
function Step4({ state, update }: any) {
  const [catalog, setCatalog] = useState<any[] | null>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    if (!state.siteId) return;
    try {
      const list = await api.listPublishTargets(state.siteId);
      setTargets(list ?? []);
      update({ publishTargetCount: (list ?? []).length });
    } catch (_e) { /* noop */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const c = await api.getPublishTargetsCatalog();
        setCatalog(c ?? []);
      } catch (_e) { /* noop */ }
      await refresh();
    })();
  }, [state.siteId]);

  const startAdd = (type: string) => {
    setAdding(type);
    setCreds({});
  };

  const save = async () => {
    if (!state.siteId || !adding) return;
    const def = catalog?.find((c) => c.type === adding);
    if (!def) return;

    // Required field check
    for (const f of def.fields ?? []) {
      if (f.required && !creds[f.key]?.trim()) {
        toast.error(`"${f.label}" zorunlu`); return;
      }
    }

    setSaving(true);
    try {
      await api.createPublishTarget(state.siteId, {
        type: adding,
        name: def.label,
        credentials: creds,
        config: {},
      });
      toast.success(`${def.label} eklendi`);
      setAdding(null);
      setCreds({});
      await refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu yayın hedefi silinsin mi?')) return;
    try {
      await api.deletePublishTarget(id);
      await refresh();
    } catch (err: any) { toast.error(err.message); }
  };

  // Markdown ZIP fallback — adapter olmadan hızlı kayıt
  const useMarkdownZip = async () => {
    if (!state.siteId) return;
    setSaving(true);
    try {
      await api.createPublishTarget(state.siteId, {
        type: 'MARKDOWN_ZIP',
        name: 'Markdown ZIP (manuel indir)',
        credentials: {},
        config: {},
      });
      toast.success('Markdown ZIP eklendi — yazıları sunucu üzerinden ZIP olarak indirebilirsin');
      await refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const addingDef = catalog?.find((c) => c.type === adding);

  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Yayın Hedefi</h2>
      <p className="text-muted-foreground mb-6">
        AI yazıları nereye koysun? En az 1 hedef ekle — entegrasyon istemiyorsan ZIP olarak indirebilirsin.
      </p>

      {/* Mevcut hedefler */}
      {targets.length > 0 && (
        <div className="space-y-2 mb-4">
          {targets.map((t) => (
            <div key={t.id} className="rounded-md border p-3 flex items-center justify-between gap-2 bg-green-500/5 border-green-500/30">
              <div>
                <p className="text-sm font-medium">✓ {t.name ?? t.type}</p>
                <p className="text-[11px] text-muted-foreground">{t.type}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>Kaldır</Button>
            </div>
          ))}
        </div>
      )}

      {!adding && (
        <>
          <p className="text-sm font-medium mb-2">Hedef ekle:</p>
          <div className="grid grid-cols-2 gap-2">
            {(catalog ?? []).filter((c) => c.type !== 'MARKDOWN_ZIP').map((c) => (
              <button
                key={c.type}
                type="button"
                onClick={() => startAdd(c.type)}
                className="rounded-md border p-3 text-left hover:border-brand transition-colors"
              >
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{c.type}</p>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-md border-2 border-dashed p-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">📦 Manuel: Markdown ZIP</p>
              <p className="text-[11px] text-muted-foreground">Entegrasyon yok. Yazılar ZIP olarak hazır olur, manuel indirip yüklersin.</p>
            </div>
            <Button size="sm" variant="outline" onClick={useMarkdownZip} disabled={saving}>
              Bunu seç
            </Button>
          </div>
        </>
      )}

      {adding && addingDef && (
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">{addingDef.label} bilgileri</p>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setAdding(null)}>
              ← Geri
            </button>
          </div>
          {(addingDef.fields ?? []).map((f: any) => (
            <div key={f.key}>
              <label className="block text-xs font-medium mb-1">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              {f.type === 'select' ? (
                <select
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                  value={creds[f.key] ?? f.default ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                >
                  <option value="">Seç…</option>
                  {f.options?.map((o: any) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <Input
                  type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                  placeholder={f.placeholder}
                  value={creds[f.key] ?? f.default ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              )}
              {f.hint && <p className="text-[10px] text-muted-foreground mt-1">{f.hint}</p>}
            </div>
          ))}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet ve Test Et'}
          </Button>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 5 — Otomatik Üretim Takvimi + Onay Modu
// ──────────────────────────────────────────────────────────────────────
function Step5({ state, update }: any) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Otomatik Üretim</h2>
      <p className="text-muted-foreground mb-6">
        AI yazıları hangi sıklıkta ve saatte üretsin? Yayınlamadan önce sana onaylatabilir.
      </p>

      <p className="text-sm font-medium mb-2">Sıklık</p>
      <div className="space-y-2 mb-6">
        {FREQUENCIES.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => update({ autoGenerationFrequency: f.value })}
            className={cn(
              'w-full rounded-lg border-2 p-3 text-left transition-colors',
              state.autoGenerationFrequency === f.value ? 'border-brand bg-brand/5' : 'hover:border-brand/40',
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{f.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{f.hint}</p>
              </div>
              <span className="text-xs text-muted-foreground">~{f.articlesPerMonth} yazı/ay</span>
            </div>
          </button>
        ))}
      </div>

      <p className="text-sm font-medium mb-2">Saat (Türkiye)</p>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="range"
          min={0}
          max={23}
          value={state.autoGenerationHour}
          onChange={(e) => update({ autoGenerationHour: parseInt(e.target.value, 10) })}
          className="flex-1"
        />
        <span className="text-sm font-mono w-16 text-right">
          {String(state.autoGenerationHour).padStart(2, '0')}:00
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-6">
        💡 Önerilen saat: 09:00 (sabah trafiği) veya 14:00 (öğleden sonra)
      </p>

      <div className="border-t pt-4">
        <p className="text-sm font-medium mb-3">Yayın onayı</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => update({ publishApprovalMode: 'manual_approve' })}
            className={cn(
              'w-full rounded-lg border-2 p-3 text-left transition-colors',
              state.publishApprovalMode === 'manual_approve' ? 'border-brand bg-brand/5' : 'hover:border-brand/40',
            )}
          >
            <p className="font-medium text-sm">👁️ Önce göster, sonra yayınla (önerilen)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI yazsın → DRAFT olarak dursun → sen onaylayınca yayınlansın. Email/dashboard'dan haber gelir.
            </p>
          </button>
          <button
            type="button"
            onClick={() => update({ publishApprovalMode: 'auto_publish' })}
            className={cn(
              'w-full rounded-lg border-2 p-3 text-left transition-colors',
              state.publishApprovalMode === 'auto_publish' ? 'border-brand bg-brand/5' : 'hover:border-brand/40',
            )}
          >
            <p className="font-medium text-sm">🚀 Direkt yayınla (tam otomatik)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI yazsın ve otomatik yayınlasın. Hız için ideal — sen sadece haftalık raporu okursun.
            </p>
          </button>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ADIM 6 — Sosyal Medya (Opsiyonel)
// ──────────────────────────────────────────────────────────────────────
function Step6({ state, update }: any) {
  const [catalog, setCatalog] = useState<any[] | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);

  const refresh = async () => {
    if (!state.siteId) return;
    try {
      const list = await api.listSocialChannels(state.siteId);
      setChannels(list ?? []);
      update({ socialChannelCount: (list ?? []).length });
    } catch (_e) { /* noop */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const c = await api.getSocialCatalog();
        setCatalog((c ?? []).filter((s: any) => s.status === 'live'));
      } catch (_e) { /* noop */ }
      await refresh();
    })();
  }, [state.siteId]);

  const connect = async (type: string) => {
    if (!state.siteId) return;
    setConnecting(type);
    try {
      const { url } = await api.startSocialOAuth(state.siteId, type);
      window.open(url, '_blank', 'width=600,height=700');
      toast.info('Yeni pencerede izin ver, sonra bu sekmeye dön ve yenile');
    } catch (err: any) { toast.error(err.message); }
    finally { setConnecting(null); }
  };

  return (
    <>
      <h2 className="text-2xl font-bold mb-2">Sosyal Medya (opsiyonel)</h2>
      <p className="text-muted-foreground mb-6">
        Yazılar yayınlandığında otomatik sosyal post atalım mı? Her hesabı tek tıkla bağla.
      </p>

      {(catalog ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">Sosyal kanal yüklenemedi — sonra Ayarlar'dan bağlayabilirsin.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(catalog ?? []).map((c) => {
          const connected = channels.some((ch: any) => ch.type === c.type && ch.isActive);
          return (
            <div key={c.type} className={cn('rounded-md border p-3 flex items-center justify-between gap-2', connected && 'border-green-500/50 bg-green-500/5')}>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.label}</p>
                {connected && <p className="text-[11px] text-green-600">✓ Bağlı</p>}
              </div>
              <Button size="sm" variant={connected ? 'outline' : 'default'} onClick={() => connect(c.type)} disabled={connecting === c.type}>
                {connecting === c.type ? '…' : connected ? 'Yeniden' : 'Bağla'}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        💡 Sosyal kanalları sonra Ayarlar → Sosyal'dan da bağlayabilirsin. Şimdilik atlayabilirsin.
      </p>
    </>
  );
}

// Next.js 15 — useSearchParams Suspense gerektirir
export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <OnboardingInner />
    </Suspense>
  );
}
