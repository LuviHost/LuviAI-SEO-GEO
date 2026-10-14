'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Trash2, Plus, AlertTriangle, KeyRound, Terminal } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { FilterChip } from '@/components/ui/filter-chip';
import { AsyncState } from '@/components/ui/async-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/empty-state';

const ALL_SCOPES = [
  'articles:read', 'articles:write',
  'sites:read', 'sites:write',
  'audit:read', 'audit:write',
  'ads:read', 'ads:write',
  'analytics:read',
  'social:read', 'social:write',
];

// Varsayilan secim API'deki DEFAULT_SCOPES ile AYNI olmali: tum okuma.
// Ikisi ayri durdugunda UI'dan uretilen anahtar, servis varsayilanindan
// dar kaliyor ve kaynak bazli scope denetimi devreye girince entegrasyon
// sessizce 403 aliyordu.
const DEFAULT_SCOPES = ALL_SCOPES.filter((s) => s.endsWith(':read'));

/** Yetki kaynaklari — cipler kaynak basina okuma/yazma ciftleri halinde gruplanir */
const RESOURCE_LABEL: Record<string, string> = {
  articles: 'İçerikler',
  sites: 'Siteler',
  audit: 'Site denetimi',
  ads: 'Reklam',
  analytics: 'Analitik',
  social: 'Sosyal',
};
const RESOURCES = Array.from(new Set(ALL_SCOPES.map((s) => s.split(':')[0])));

// NOT: @luviai/sdk npm'de yayinda degil (registry 404) — eski "npm install"
// ornegi kullaniciyi hataya goturuyordu. Ornek gercek REST ucunu gosterir.
const CURL_EXAMPLE = `curl https://ranksup.ai/api/sites \\
  -H "Authorization: Bearer luvi_..."`;

export default function ApiKeysPage() {
  const confirm = useConfirm();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', scopes: DEFAULT_SCOPES });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setKeys(await api.listApiKeys());
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name.trim()) { toast.error('Anahtara bir ad ver'); return; }
    setCreating(true);
    try {
      const r = await api.createApiKey({ name: form.name.trim(), scopes: form.scopes });
      setNewToken(r.token);
      setForm({ name: '', scopes: DEFAULT_SCOPES });
      load();
    } catch (err: any) { toast.error(err.message); }
    finally { setCreating(false); }
  };

  const revoke = async (k: any) => {
    const ok = await confirm({
      title: `"${k.name}" anahtarı iptal edilsin mi?`,
      description: 'Bu anahtarı kullanan entegrasyonlar hemen çalışmayı durdurur. Geri alınamaz.',
      confirmLabel: 'Anahtarı iptal et',
      danger: true,
    });
    if (!ok) return;
    try { await api.revokeApiKey(k.id); toast.success('Anahtar iptal edildi'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  const toggleScope = (scope: string) => {
    setForm({ ...form, scopes: form.scopes.includes(scope) ? form.scopes.filter((s) => s !== scope) : [...form.scopes, scope] });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Kopyalandı'); }
    catch { toast.error('Kopyalanamadı — elle seç'); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="API anahtarları" description="RanksUp verilerine kendi yazılımından REST API ile eriş." />

      {/* Yeni anahtar — yalniz bir kez gosterilir */}
      {newToken && (
        <Card className="border-warning/40 bg-warning/5 p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Anahtar yalnız şimdi gösteriliyor
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Bu kutuyu kapattıktan sonra tekrar göremezsin. Kopyalayıp güvenli bir yere kaydet.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input value={newToken} readOnly className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} aria-label="Yeni API anahtarı" />
            <Button onClick={() => copy(newToken)} className="shrink-0"><Copy className="h-4 w-4" aria-hidden /> Kopyala</Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNewToken(null)}>Kaydettim, kapat</Button>
        </Card>
      )}

      {/* Yeni anahtar formu */}
      <Card className="p-5">
        <SectionHeader as="h3" icon={KeyRound} title="Yeni anahtar" description="Yalnız ihtiyacın olan yetkileri seç. Varsayılan: her şeyi okuyabilir, hiçbir şeyi değiştiremez." />
        <div className="mt-4 space-y-4">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anahtar adı — örn. Muhasebe entegrasyonu" aria-label="Anahtar adı" />
          <div className="space-y-2">
            {RESOURCES.map((res) => (
              <div key={res} className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{RESOURCE_LABEL[res] ?? res}</span>
                {ALL_SCOPES.filter((s) => s.startsWith(`${res}:`)).map((s) => (
                  <FilterChip key={s} selected={form.scopes.includes(s)} onClick={() => toggleScope(s)}>
                    {s.endsWith(':read') ? 'Okuma' : 'Yazma'}
                  </FilterChip>
                ))}
              </div>
            ))}
          </div>
          <Button onClick={create} disabled={creating}>
            <Plus className="h-4 w-4" aria-hidden /> {creating ? 'Oluşturuluyor…' : 'Anahtar oluştur'}
          </Button>
        </div>
      </Card>

      {/* Mevcut anahtarlar */}
      <section className="space-y-3">
        <SectionHeader title="Anahtarların" description={keys.length ? `${keys.length} aktif anahtar` : undefined} />
        <AsyncState
          loading={loading}
          error={error}
          onRetry={load}
          empty={keys.length === 0}
          emptyView={<EmptyState icon={KeyRound} title="Henüz anahtar yok" description="Yukarıdan ilk anahtarını oluştur; entegrasyonun bu anahtarla RanksUp verilerine erişir." />}
        >
          <div className="space-y-2">
            {keys.map((k) => (
              <Card key={k.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{k.name}</p>
                    <p className="font-mono text-label text-muted-foreground">{k.prefix}…</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(k.scopes ?? []).map((s: string) => (
                        <Badge key={s} variant={s.endsWith(':write') ? 'warning' : 'secondary'}>
                          {RESOURCE_LABEL[s.split(':')[0]] ?? s.split(':')[0]} · {s.endsWith(':write') ? 'yazma' : 'okuma'}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-label text-muted-foreground">
                      {k.lastUsedAt ? `Son kullanım ${new Date(k.lastUsedAt).toLocaleString('tr-TR')}` : 'Henüz kullanılmadı'}
                      {k.expiresAt ? ` · ${new Date(k.expiresAt).toLocaleDateString('tr-TR')} tarihinde sona erer` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => revoke(k)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> İptal et
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </AsyncState>
      </section>

      {/* Kullanim ornegi */}
      <Card className="p-5">
        <SectionHeader
          as="h3"
          icon={Terminal}
          title="Nasıl kullanılır"
          description="Anahtarı her isteğin Authorization başlığında gönder."
          actions={<Button size="sm" variant="outline" onClick={() => copy(CURL_EXAMPLE)}><Copy className="h-4 w-4" aria-hidden /> Kopyala</Button>}
        />
        <pre className="mt-4 overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed">{CURL_EXAMPLE}</pre>
      </Card>
    </div>
  );
}
