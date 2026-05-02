'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { History, Save, Settings2, Sliders, CreditCard, Brain, Gauge, FileText } from 'lucide-react';

type Setting = {
  key: string;
  type: 'boolean' | 'int' | 'string' | 'enum';
  category: 'toggle' | 'plan' | 'model' | 'limit' | 'log';
  default: string;
  description: string;
  envFallback: boolean;
  enumValues?: string[];
  hot?: boolean;
  value: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type AuditEntry = {
  id: string;
  key: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const CATEGORY_META: Record<Setting['category'], { label: string; icon: any; help: string; order: number }> = {
  toggle: { label: 'Operasyonel Toggle', icon: Sliders, help: 'Feature flag ve test guard\'ları. Anlık etki — restart gerekmez.', order: 1 },
  log: { label: 'Loglama', icon: FileText, help: 'Worker / API log seviyesi.', order: 2 },
  plan: { label: 'Plan & Limit', icon: CreditCard, help: 'Plan fiyatları, makale kotaları, site limitleri.', order: 3 },
  limit: { label: 'Rate Limit', icon: Gauge, help: 'API rate limit penceresi ve max istek.', order: 4 },
  model: { label: 'AI Model Seçimi', icon: Brain, help: 'Yazar / editör / routing modelleri.', order: 5 },
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [audits, setAudits] = useState<AuditEntry[] | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.getAdminSettings();
      setSettings(data as Setting[]);
      setDrafts({});
    } catch (err: any) {
      toast.error(err.message || 'Ayarlar yüklenemedi');
    }
  };

  useEffect(() => { refresh(); }, []);

  const loadAudits = async () => {
    setAuditOpen(true);
    try {
      const data = await api.getAdminSettingsAudit(50);
      setAudits(data as AuditEntry[]);
    } catch (err: any) {
      toast.error(err.message || 'Audit yüklenemedi');
    }
  };

  const setDraft = (key: string, val: string) => setDrafts((d) => ({ ...d, [key]: val }));

  const save = async (s: Setting) => {
    const draftVal = drafts[s.key];
    if (draftVal === undefined) return;
    setSaving(s.key);
    try {
      const r = await api.updateAdminSetting(s.key, draftVal);
      if (r.unchanged) {
        toast.info(`${s.key} zaten ${draftVal}`);
      } else {
        toast.success(`${s.key}: ${r.oldValue ?? '(yok)'} → ${r.value}`);
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Kaydedilemedi');
    } finally {
      setSaving(null);
    }
  };

  const toggleBoolean = async (s: Setting) => {
    const next = isTruthy(s.value) ? '0' : '1';
    setSaving(s.key);
    try {
      const r = await api.updateAdminSetting(s.key, next);
      toast.success(`${s.key} → ${next === '1' ? 'AÇIK' : 'KAPALI'}`);
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Kaydedilemedi');
    } finally {
      setSaving(null);
    }
  };

  if (!settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Kategori grupla, sırala.
  const grouped = settings.reduce<Record<string, Setting[]>>((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});
  const orderedCategories = Object.keys(grouped).sort(
    (a, b) => (CATEGORY_META[a as Setting['category']]?.order ?? 99) - (CATEGORY_META[b as Setting['category']]?.order ?? 99),
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings2 className="h-7 w-7" /> Sistem Ayarları
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Runtime'da değiştirilebilen operasyonel toggle, plan & limit ve model ayarları.
            Değişiklikler ~30 saniyede tüm process'lere yansır (cache TTL).
          </p>
        </div>
        <Button variant="outline" onClick={loadAudits} className="gap-2">
          <History className="h-4 w-4" /> Audit Log
        </Button>
      </div>

      {auditOpen && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h2 className="font-semibold">Son 50 Değişiklik</h2>
            <Button variant="ghost" size="sm" onClick={() => setAuditOpen(false)}>Kapat</Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Zaman</th>
                    <th className="text-left px-4 py-2">Anahtar</th>
                    <th className="text-left px-4 py-2">Eski</th>
                    <th className="text-left px-4 py-2">Yeni</th>
                    <th className="text-left px-4 py-2">Kim</th>
                    <th className="text-left px-4 py-2">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {audits === null && (
                    <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>
                  )}
                  {audits?.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Henüz değişiklik yok.</td></tr>
                  )}
                  {audits?.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-4 py-2 whitespace-nowrap">{new Date(a.changedAt).toLocaleString('tr-TR')}</td>
                      <td className="px-4 py-2 font-mono text-xs">{a.key}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.oldValue ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{a.newValue}</td>
                      <td className="px-4 py-2 text-xs">{a.changedBy}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{a.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {orderedCategories.map((cat) => {
        const meta = CATEGORY_META[cat as Setting['category']];
        const Icon = meta?.icon ?? Settings2;
        return (
          <section key={cat}>
            <div className="mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Icon className="h-5 w-5 text-brand" /> {meta?.label ?? cat}
              </h2>
              {meta?.help && <p className="text-xs text-muted-foreground mt-0.5">{meta.help}</p>}
            </div>
            <Card>
              <CardContent className="p-0 divide-y">
                {grouped[cat].map((s) => (
                  <SettingRow
                    key={s.key}
                    s={s}
                    draft={drafts[s.key]}
                    setDraft={(v) => setDraft(s.key, v)}
                    saving={saving === s.key}
                    onSave={() => save(s)}
                    onToggle={() => toggleBoolean(s)}
                  />
                ))}
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function isTruthy(v: string) {
  const x = v.trim().toLowerCase();
  return x === '1' || x === 'true' || x === 'yes' || x === 'on';
}

function SettingRow({
  s, draft, setDraft, saving, onSave, onToggle,
}: {
  s: Setting;
  draft: string | undefined;
  setDraft: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onToggle: () => void;
}) {
  const dirty = draft !== undefined && draft !== s.value;

  return (
    <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-sm font-mono font-semibold">{s.key}</code>
          <Badge variant="outline" className="text-[10px]">{s.type}</Badge>
          {s.hot && <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">hot</Badge>}
          {s.envFallback && <Badge variant="outline" className="text-[10px]">env-fallback</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.description}</p>
        {s.updatedAt && (
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            Son güncelleme: {new Date(s.updatedAt).toLocaleString('tr-TR')}
            {s.updatedBy ? ` · ${s.updatedBy}` : ''}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {s.type === 'boolean' ? (() => {
          const on = isTruthy(s.value);
          return (
            <>
              <span className={`text-[10px] font-mono uppercase tracking-widest font-semibold transition-colors ${on ? 'text-brand' : 'text-muted-foreground/60'}`}>
                {saving ? '…' : on ? 'açık' : 'kapalı'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={s.key}
                onClick={onToggle}
                disabled={saving}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 ${
                  saving ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                } ${on ? 'bg-brand shadow-[0_0_0_1px_rgb(124_58_237/0.3),0_4px_12px_rgb(124_58_237/0.35)]' : 'bg-muted-foreground/25 hover:bg-muted-foreground/35'}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                    on ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </>
          );
        })() : s.type === 'enum' ? (
          <select
            value={draft ?? s.value}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="rounded-md border px-2 py-1.5 text-sm bg-background min-w-[220px]"
          >
            {s.enumValues?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <Input
            value={draft ?? s.value}
            onChange={(e) => setDraft(e.target.value)}
            type={s.type === 'int' ? 'number' : 'text'}
            disabled={saving}
            className="w-40"
          />
        )}

        {s.type !== 'boolean' && (
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || saving}
            className="gap-1"
            variant={dirty ? 'default' : 'outline'}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '…' : 'Kaydet'}
          </Button>
        )}
      </div>
    </div>
  );
}
