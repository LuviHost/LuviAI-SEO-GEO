'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

const PROVIDER_TO_VENDOR: Record<string, VendorName> = {
  anthropic:  'anthropic',
  gemini:     'gemini',
  openai:     'openai',
  perplexity: 'perplexity',
  xai:        'grok',
  deepseek:   'deepseek',
};

type ProviderInfo = {
  provider: 'anthropic' | 'gemini' | 'openai' | 'perplexity' | 'xai' | 'deepseek';
  label: string;
  inPool: boolean;
  poolKeyAvailable: boolean;
  hasByok: boolean;
  byokVerified: boolean;
  byokPrefix?: string;
  byokError?: string;
  effectiveSource: 'pool' | 'byok' | 'none';
};

type Status = {
  plan: string;
  pool: string[];
  quota: { limit: number; used: number; remaining: number };
  providers: ProviderInfo[];
};

// Saglayici ucret/kredi iddiasi yazilmaz. Eski xAI ipucu "data-sharing ACIK
// ise $150/ay bedava" diyordu; xAI'nin faturalama belgelerinde (18.10.2026,
// https://docs.x.ai/console/billing ve https://docs.x.ai/console/faq/billing)
// boyle bir program yok, yalniz on odemeli kredi ve promosyon kodu var.
// Gemini'deki "(ucretsiz)" da kaldirildi: kullanim Google'in kendi katman ve
// faturalama kosullarina bagli, olcumun ucretsiz kalacagini biz bilemeyiz.
const PROVIDER_HINTS: Record<string, { url: string; example: string; help: string }> = {
  anthropic:  { url: 'https://console.anthropic.com/settings/keys',           example: 'sk-ant-api03-...',  help: 'console.anthropic.com → API Keys' },
  gemini:     { url: 'https://aistudio.google.com/apikey',                    example: 'AIza...',           help: 'aistudio.google.com → Get API key' },
  openai:     { url: 'https://platform.openai.com/api-keys',                  example: 'sk-proj-...',       help: 'platform.openai.com → API keys' },
  xai:        { url: 'https://console.x.ai',                                  example: 'xai-...',           help: 'console.x.ai → API Keys' },
  deepseek:   { url: 'https://platform.deepseek.com/api_keys',                example: 'sk-...',            help: 'platform.deepseek.com → API keys' },
  perplexity: { url: 'https://www.perplexity.ai/settings/api',                example: 'pplx-...',          help: 'perplexity.ai → Settings → API' },
};

/**
 * Plan adlari apps/api/src/billing/plans.ts name_tr ile ayni. Eskiden STARTER
 * "Baslangic" yaziyordu; satilan planin adi "Buyume".
 */
const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Ücretsiz Deneme', STARTER: 'Büyüme', PRO: 'Profesyonel', AGENCY: 'Ajans', ENTERPRISE: 'Kurumsal',
};

/**
 * BYOK'un acildigi plan — plans.ts FEATURE_MIN_PLAN.byok (public-docs.spec.ts
 * ikisinin ayni kaldigini denetler). Alt planda POST /sites/:id/ai-keys 403
 * doner (SiteAiKeysService.upsertKey → enforcePlanFeature); "Anahtar Bagla"
 * dugmesi gosterilip hata aldirilmaz.
 */
const BYOK_PLAN = 'ENTERPRISE';

export function AiKeysPanel({ siteId }: { siteId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // provider
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [retesting, setRetesting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.getAiKeysStatus(siteId);
      setStatus(s);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);

  const startAdd = (provider: string) => {
    setEditing(provider);
    setKeyInput('');
  };

  const save = async () => {
    if (!editing || !keyInput.trim()) return;
    setSaving(true);
    try {
      await api.upsertAiKey(siteId, editing, keyInput.trim());
      toast.success('Anahtar doğrulandı ve kaydedildi');
      setEditing(null);
      setKeyInput('');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (provider: string) => {
    // Silince ne olacagi durum ucunun poolKeyAvailable alanindan (sunucuda
    // RanksUp anahtari tanimli mi) okunur; olcum motoru (ai-citation resolveKey)
    // ayni kurali uygular. Eski metin "plana dahilse" diyordu: 6 asistan her
    // planda dahil, belirleyici olan anahtarin tanimli olmasi. Havuz anahtariyla
    // olcum aylik calistirma hakkindan duser; hak dolunca yalniz kendi anahtari
    // olan saglayicilar olculur (runForSite).
    const info = status?.providers.find((x) => x.provider === provider);
    const sonrasi = info?.poolKeyAvailable
      ? 'Ölçüm RanksUp anahtarıyla sürer; aylık çalıştırma hakkın dolunca bu sağlayıcı ölçülmez.'
      : 'RanksUp anahtarı tanımlı olmadığı için bu sağlayıcı artık ölçülmez.';
    if (!confirm(`${info?.label ?? provider} anahtarı silinsin mi? ${sonrasi}`)) return;
    try {
      await api.deleteAiKey(siteId, provider);
      toast.success('Anahtar silindi');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const retest = async (provider: string) => {
    setRetesting(provider);
    try {
      const r = await api.retestAiKey(siteId, provider);
      if (r.ok) toast.success('Anahtar hâlâ çalışıyor');
      else toast.error(`Anahtar çalışmıyor: ${r.error}`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRetesting(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">AI sağlayıcı durumu yükleniyor…</p>
      </div>
    );
  }

  if (!status) return null;

  const planLabel = PLAN_LABELS[status.plan] ?? status.plan;
  const byokAllowed = status.plan === BYOK_PLAN;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-brand text-sm font-semibold">AI sağlayıcı anahtarları</p>
          {/* Kota calistirma basina duser (ai-citation.service runForSite: havuz
              anahtarli bir saglayici olctuyse +1). Kota dolunca yalniz kendi
              anahtari olan saglayicilar kosar; haftalik olcum hakki ise BYOK'ta
              da gecerli (billing/measurement-allowance.ts). */}
          <p className="text-xs text-muted-foreground mt-0.5">
            <strong>{planLabel}</strong> planında ayda <strong>{status.quota.limit}</strong> AI görünürlük çalıştırması var; bu ay {status.quota.used} tanesini kullandın.{' '}
            {byokAllowed
              ? 'Bir sağlayıcıya kendi API anahtarını bağlarsan, havuz kotası dolduğunda o sağlayıcı kendi anahtarınla ölçülmeye devam eder; haftalık ölçüm hakkı yine geçerlidir.'
              : `Kendi API anahtarını bağlama (BYOK) ${PLAN_LABELS[BYOK_PLAN]} planına dahildir.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {status.providers.map((p) => {
          const isEditing = editing === p.provider;
          const hint = PROVIDER_HINTS[p.provider];
          // effectiveSource olcum motoruyla ayni kural (SiteAiKeysService.getStatus =
          // ai-citation resolveKey): BYOK > RanksUp env anahtari > yok. 'none' bu
          // saglayicinin olculmedigi demek: ne musterinin anahtari ne RanksUp'in
          // anahtari var (olcum sonucundaki neden de ayni sozu soyler).
          const sourceBadge =
            p.effectiveSource === 'byok'
              ? { text: p.byokVerified ? 'Senin anahtarınla çalışıyor' : 'Senin anahtarın — test başarısız', cls: p.byokVerified ? 'text-success' : 'text-warning' }
              : p.effectiveSource === 'pool'
              ? { text: 'Planına dahil · RanksUp anahtarıyla ölçülür', cls: 'text-muted-foreground' }
              : { text: 'Ölçülmüyor — RanksUp anahtarı tanımlı değil', cls: 'text-muted-foreground' };

          return (
            <div key={p.provider} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <VendorLogo name={PROVIDER_TO_VENDOR[p.provider] ?? 'openai'} size={24} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.label}</p>
                    <p className={`text-label ${sourceBadge.cls}`}>{sourceBadge.text}</p>
                  </div>
                </div>
                {p.hasByok && (
                  <span className="text-[10px] font-mono text-muted-foreground">{p.byokPrefix}***</span>
                )}
              </div>

              {p.byokError && !p.byokVerified && (
                <p className="text-[10px] text-red-500 leading-snug">Hata: {p.byokError}</p>
              )}

              {isEditing ? (
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder={hint?.example ?? 'sk-...'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    autoFocus
                    className="text-xs"
                  />
                  {hint && (
                    <p className="text-[10px] text-muted-foreground">
                      Anahtar nereden alınır:{' '}
                      <a href={hint.url} target="_blank" rel="noreferrer" className="underline">
                        {hint.help}
                      </a>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={save} disabled={saving || keyInput.trim().length < 10}>
                      {saving ? 'Test ediliyor…' : 'Kaydet ve Test Et'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setKeyInput(''); }}>
                      Vazgeç
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {/* Eski (plan dusmeden kalmis) anahtar test edilip silinebilir;
                      yeni anahtar kaydi yalniz BYOK planinda (upsertKey kapisi). */}
                  {p.hasByok ? (
                    <>
                      {byokAllowed && (
                        <Button size="sm" variant="outline" onClick={() => startAdd(p.provider)}>
                          Değiştir
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => retest(p.provider)} disabled={retesting === p.provider}>
                        {retesting === p.provider ? 'Test…' : 'Yeniden Test'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(p.provider)} className="text-red-500">
                        Sil
                      </Button>
                    </>
                  ) : byokAllowed ? (
                    <Button size="sm" variant="outline" onClick={() => startAdd(p.provider)}>
                      + Anahtar Bağla
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-label text-muted-foreground border-t pt-2">
        Anahtarın şifreli saklanır; panelde yalnız ilk 8 karakteri görünür.
        Kendi anahtarınla yapılan sorguların ücreti kendi sağlayıcı hesabına yansır.
      </p>
    </div>
  );
}
