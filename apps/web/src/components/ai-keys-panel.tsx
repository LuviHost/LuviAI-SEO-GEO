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

const PROVIDER_HINTS: Record<string, { url: string; example: string; help: string }> = {
  anthropic:  { url: 'https://console.anthropic.com/settings/keys',           example: 'sk-ant-api03-...',  help: 'console.anthropic.com → API Keys' },
  gemini:     { url: 'https://aistudio.google.com/apikey',                    example: 'AIza...',           help: 'aistudio.google.com → Get API key (ücretsiz)' },
  openai:     { url: 'https://platform.openai.com/api-keys',                  example: 'sk-proj-...',       help: 'platform.openai.com → API keys' },
  xai:        { url: 'https://console.x.ai',                                  example: 'xai-...',           help: 'console.x.ai → API Keys (data-sharing AÇIK ise $150/ay bedava)' },
  deepseek:   { url: 'https://platform.deepseek.com/api_keys',                example: 'sk-...',            help: 'platform.deepseek.com → API keys' },
  perplexity: { url: 'https://www.perplexity.ai/settings/api',                example: 'pplx-...',          help: 'perplexity.ai → Settings → API' },
};

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
    if (!confirm(`${provider.toUpperCase()} anahtarı silinsin mi? Site bu sağlayıcı için artık LuviAI havuzuna düşecek (plana dahilse).`)) return;
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

  const planLabel = ({
    TRIAL: 'Deneme', STARTER: 'Başlangıç', PRO: 'Profesyonel', AGENCY: 'Ajans', ENTERPRISE: 'Kurumsal',
  } as any)[status.plan] ?? status.plan;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold">AI Sağlayıcı Anahtarları (BYOK)</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <strong>{planLabel}</strong> planı: aylık <strong>{status.quota.limit}</strong> AI Citation testi havuzdan ({status.quota.used}/{status.quota.limit} kullanıldı).
            Kendi API anahtarını bağlarsan o sağlayıcı için <strong>sınırsız</strong> kullanabilir, kotanı tüketmezsin.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {status.providers.map((p) => {
          const isEditing = editing === p.provider;
          const hint = PROVIDER_HINTS[p.provider];
          const sourceBadge =
            p.effectiveSource === 'byok'
              ? { text: p.byokVerified ? '🔑 Senin anahtarın' : '⚠️ Senin anahtarın (test başarısız)', cls: p.byokVerified ? 'text-green-500' : 'text-yellow-500' }
              : p.effectiveSource === 'pool'
              ? { text: '🏛️ LuviAI havuzu (plana dahil)', cls: 'text-blue-500' }
              : { text: '🔒 Bu plana dahil değil — anahtarını bağla', cls: 'text-muted-foreground' };

          return (
            <div key={p.provider} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <VendorLogo name={PROVIDER_TO_VENDOR[p.provider] ?? 'openai'} size={24} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.label}</p>
                    <p className={`text-[11px] ${sourceBadge.cls}`}>{sourceBadge.text}</p>
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
                  {p.hasByok ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => startAdd(p.provider)}>
                        Değiştir
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => retest(p.provider)} disabled={retesting === p.provider}>
                        {retesting === p.provider ? 'Test…' : 'Yeniden Test'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(p.provider)} className="text-red-500">
                        Sil
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => startAdd(p.provider)}>
                      + Anahtar Bağla
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-2">
        💡 Anahtar şifreli (AES-256) saklanır, panelde sadece ilk 8 karakteri gösterilir.
        BYOK ile yapılan testler kotaya dahil <strong>değildir</strong> — kullanım faturası kendi sağlayıcı hesabına gider.
      </p>
    </div>
  );
}
