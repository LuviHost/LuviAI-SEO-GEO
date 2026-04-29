'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Key, Copy, Trash2, Plus, AlertTriangle, Code } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ALL_SCOPES = [
  'articles:read', 'articles:write',
  'sites:read', 'sites:write',
  'audit:read', 'audit:write',
  'ads:read', 'ads:write',
  'analytics:read',
  'social:read', 'social:write',
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', scopes: ['articles:read', 'sites:read', 'audit:read'] });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listApiKeys();
      setKeys(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) { toast.error('Key adı gerekli'); return; }
    setCreating(true);
    try {
      const r = await api.createApiKey({ name: form.name, scopes: form.scopes });
      setNewToken(r.token);
      setForm({ name: '', scopes: ['articles:read', 'sites:read', 'audit:read'] });
      load();
    } catch (err: any) { toast.error(err.message); }
    finally { setCreating(false); }
  };

  const revoke = async (id: string) => {
    if (!confirm('Bu key\'i iptal etmek istediğinden emin misin?')) return;
    try { await api.revokeApiKey(id); toast.success('Key iptal edildi'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  const toggleScope = (scope: string) => {
    setForm({ ...form, scopes: form.scopes.includes(scope) ? form.scopes.filter((s) => s !== scope) : [...form.scopes, scope] });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Key className="h-7 w-7 text-brand" /> API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">LuviAI Public REST API + SDK ile programatik erişim</p>
      </div>

      {/* SDK quick start */}
      <Card><CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <p className="text-sm font-semibold inline-flex items-center gap-2"><Code className="h-4 w-4 text-brand" /> Node.js SDK</p>
          <code className="text-xs bg-muted px-2 py-1 rounded">npm install @luviai/sdk</code>
        </div>
        <pre className="text-[11px] bg-muted/30 p-3 rounded font-mono overflow-x-auto">
{`import { LuviAI } from '@luviai/sdk';

const luvi = new LuviAI({ apiKey: process.env.LUVIAI_API_KEY });

const article = await luvi.articles.generate({
  siteId: 'site_123',
  topic: 'WordPress hosting nasıl seçilir',
});`}
        </pre>
      </CardContent></Card>

      {/* Yeni token uyari */}
      {newToken && (
        <Card><CardContent className="p-4 border-2 border-yellow-500/40 bg-yellow-500/5 rounded">
          <p className="text-sm font-semibold flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" /> Token sadece BIR DEFA gösterilir
          </p>
          <p className="text-xs text-muted-foreground mb-3">Bu pencere kapandığında token tekrar gösterilemez. Hemen kopyalayıp güvenli bir yere kaydedin.</p>
          <div className="flex items-center gap-2">
            <input value={newToken} readOnly className="flex-1 px-3 py-2 border rounded text-xs font-mono bg-background" onClick={(e) => (e.target as HTMLInputElement).select()} />
            <Button size="sm" onClick={() => { navigator.clipboard.writeText(newToken); toast.success('Kopyalandı'); }}>
              <Copy className="h-3 w-3 mr-1" /> Kopyala
            </Button>
          </div>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setNewToken(null)}>Anladım, kapat</Button>
        </CardContent></Card>
      )}

      {/* Yeni key form */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">+ Yeni API Key</p>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn: Production server" className="w-full px-3 py-2 border rounded text-sm bg-background" />
        <div>
          <p className="text-xs font-medium mb-2">Scopes (yetki):</p>
          <div className="flex flex-wrap gap-1">
            {ALL_SCOPES.map((s) => (
              <button key={s} type="button" onClick={() => toggleScope(s)} className={`text-[11px] px-2 py-1 rounded border ${form.scopes.includes(s) ? 'bg-brand text-white border-brand' : 'bg-card text-muted-foreground'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={create} disabled={creating}><Plus className="h-3 w-3 mr-1" /> {creating ? 'Üretiliyor…' : 'Key Üret'}</Button>
      </CardContent></Card>

      {/* Mevcut key'ler */}
      {loading ? <p className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</p> :
        keys.length === 0 ? <p className="text-sm text-muted-foreground p-6 text-center">Henüz key yok.</p> :
        <div className="space-y-2">
          {keys.map((k) => (
            <Card key={k.id}><CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{k.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{k.prefix}…</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(k.scopes ?? []).map((s: string) => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {k.lastUsedAt ? `Son kullanım: ${new Date(k.lastUsedAt).toLocaleString('tr-TR')}` : 'Henüz kullanılmadı'}
                    {k.expiresAt ? ` · Son tarih: ${new Date(k.expiresAt).toLocaleDateString('tr-TR')}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => revoke(k.id)}><Trash2 className="h-3 w-3 mr-1" /> İptal</Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      }
    </div>
  );
}
