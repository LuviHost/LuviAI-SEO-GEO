'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Edit2, CheckCircle2, XCircle, Star, Power, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type CatalogField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea';
  required?: boolean;
  default?: string | number;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
};

type CatalogItem = {
  type: string;
  label: string;
  icon: string;
  description: string;
  fields: CatalogField[];
  configFields: CatalogField[];
};

type Target = {
  id: string;
  type: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  config?: Record<string, unknown>;
  lastUsedAt?: string | null;
};

export function SettingsTab({ siteId }: { siteId: string }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Target | null>(null);
  const [adding, setAdding] = useState<CatalogItem | null>(null);

  const refresh = async () => {
    try {
      const [c, t] = await Promise.all([
        api.getPublishTargetsCatalog(),
        api.listPublishTargets(siteId),
      ]);
      setCatalog(c);
      setTargets(t);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [siteId]);

  const remove = async (id: string, name: string) => {
    if (!confirm(`"${name}" yayın hedefini silmek istediğine emin misin?`)) return;
    try {
      await api.deletePublishTarget(id);
      toast.success('Yayın hedefi silindi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await api.updatePublishTarget(id, { isDefault: true });
      toast.success('Varsayılan hedef güncellendi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (target: Target) => {
    try {
      await api.updatePublishTarget(target.id, { isActive: !target.isActive });
      toast.success(target.isActive ? 'Pasifleştirildi' : 'Aktifleştirildi');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const test = async (target: Target) => {
    toast.message(`"${target.name}" bağlantısı test ediliyor…`);
    try {
      const res = await api.testPublishTarget(target.id);
      if (res.ok) toast.success(res.message ?? 'Bağlantı başarılı ✓');
      else toast.error(res.message ?? 'Bağlantı başarısız');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const catalogByType = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    catalog.forEach((c) => m.set(c.type, c));
    return m;
  }, [catalog]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Yayın Hedefleri</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Üretilen makaleler buraya yayınlanır. Birden fazla hedef ekleyebilir,
                bir tanesini varsayılan yapabilirsin.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : targets.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground mb-4 text-sm">
                Henüz yayın hedefi yok. Aşağıdan birini seçip kurabilirsin.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {targets.map((t) => {
                const meta = catalogByType.get(t.type);
                return (
                  <li
                    key={t.id}
                    className="p-4 flex items-center justify-between gap-3 flex-wrap hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl">{meta?.icon ?? '📤'}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{t.name}</span>
                          {t.isDefault && (
                            <Badge className="text-[10px]">VARSAYILAN</Badge>
                          )}
                          {!t.isActive && (
                            <Badge variant="outline" className="text-[10px]">PASİF</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {meta?.label ?? t.type}
                          {t.lastUsedAt && ` · son kullanım ${new Date(t.lastUsedAt).toLocaleDateString('tr-TR')}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => test(t)}>
                        Test Et
                      </Button>
                      {!t.isDefault && (
                        <Button size="sm" variant="outline" onClick={() => setDefault(t.id)} title="Varsayılan yap">
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => toggleActive(t)} title={t.isActive ? 'Pasifleştir' : 'Aktifleştir'}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(t)} title="Düzenle">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(t.id, t.name)}
                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Sil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-semibold">Yeni Hedef Ekle</h3>
          <p className="text-xs text-muted-foreground">14 farklı yayın hedefi destekleniyor</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {catalog.map((c) => (
              <button
                key={c.type}
                onClick={() => setAdding(c)}
                className="text-left p-3 border rounded-lg hover:border-brand hover:bg-brand/5 transition-colors flex items-start gap-3"
              >
                <span className="text-2xl shrink-0">{c.icon}</span>
                <div className="min-w-0">
                  <div className="font-medium text-sm">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                    {c.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {(adding || editing) && (
        <TargetForm
          siteId={siteId}
          catalog={
            adding ?? catalogByType.get(editing!.type) ?? null
          }
          existing={editing}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(null);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function TargetForm({
  siteId,
  catalog,
  existing,
  onClose,
  onSaved,
}: {
  siteId: string;
  catalog: CatalogItem | null;
  existing: Target | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? catalog?.label ?? '');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (existing?.config) {
      Object.entries(existing.config).forEach(([k, v]) => {
        initial[k] = v == null ? '' : String(v);
      });
    } else if (catalog) {
      catalog.configFields.forEach((f) => {
        if (f.default !== undefined) initial[f.key] = String(f.default);
      });
    }
    return initial;
  });
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [saving, setSaving] = useState(false);

  if (!catalog) return null;

  const updateField = (key: string, value: string) =>
    setCredentials((p) => ({ ...p, [key]: value }));
  const updateConfig = (key: string, value: string) =>
    setConfig((p) => ({ ...p, [key]: value }));

  const save = async () => {
    if (!name.trim()) {
      toast.error('İsim zorunlu');
      return;
    }
    // Required field check (yeni eklemede; düzenlemede credentials boşsa pas geç)
    if (!existing) {
      const missing = catalog.fields
        .filter((f) => f.required && !credentials[f.key])
        .map((f) => f.label);
      if (missing.length > 0) {
        toast.error(`Eksik alan: ${missing.join(', ')}`);
        return;
      }
    }
    const missingConfig = catalog.configFields
      .filter((f) => f.required && !config[f.key])
      .map((f) => f.label);
    if (missingConfig.length > 0) {
      toast.error(`Eksik ayar: ${missingConfig.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      // Boş credentials field'larını gönderme (edit modda)
      const credsToSend: Record<string, string> = {};
      Object.entries(credentials).forEach(([k, v]) => {
        if (v) credsToSend[k] = v;
      });

      if (existing) {
        await api.updatePublishTarget(existing.id, {
          name: name.trim(),
          credentials: Object.keys(credsToSend).length > 0 ? credsToSend : undefined,
          config,
          isDefault,
        });
        toast.success('Yayın hedefi güncellendi');
      } else {
        await api.createPublishTarget(siteId, {
          type: catalog.type,
          name: name.trim(),
          credentials: credsToSend,
          config,
          isDefault,
        });
        toast.success('Yayın hedefi eklendi');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-xl my-8">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-3xl">{catalog.icon}</span>
              <div>
                <h3 className="font-bold">
                  {existing ? `${catalog.label} — Düzenle` : `${catalog.label} ekle`}
                </h3>
                <p className="text-xs text-muted-foreground">{catalog.description}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Hedef adı *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production WordPress"
            />
          </div>

          {catalog.fields.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Bağlantı Bilgileri
              </h4>
              {existing && (
                <p className="text-[11px] text-muted-foreground mb-2">
                  💡 Mevcut credential'ları değiştirmek istemiyorsan boş bırak.
                </p>
              )}
              <div className="space-y-3">
                {catalog.fields.map((f) => (
                  <FormField
                    key={f.key}
                    field={f}
                    value={credentials[f.key] ?? ''}
                    onChange={(v) => updateField(f.key, v)}
                    placeholder={existing ? '••••••••• (değişmeyecek)' : f.placeholder}
                  />
                ))}
              </div>
            </div>
          )}

          {catalog.configFields.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Yayın Ayarları
              </h4>
              <div className="space-y-3">
                {catalog.configFields.map((f) => (
                  <FormField
                    key={f.key}
                    field={f}
                    value={config[f.key] ?? ''}
                    onChange={(v) => updateConfig(f.key, v)}
                  />
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer pt-2 border-t">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Varsayılan yayın hedefi yap</span>
            <CheckCircle2
              className={`h-4 w-4 ml-auto ${isDefault ? 'text-green-500' : 'text-muted-foreground/30'}`}
            />
          </label>
        </CardContent>
        <div className="px-6 pb-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            İptal
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {saving ? 'Kaydediliyor…' : existing ? 'Güncelle' : 'Ekle'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  placeholder,
}: {
  field: CatalogField;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>
      {field.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 px-3 rounded-md border bg-card text-sm"
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? field.placeholder}
          rows={4}
          className="w-full px-3 py-2 rounded-md border bg-card text-sm font-mono"
        />
      ) : (
        <Input
          type={field.type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? field.placeholder}
        />
      )}
      {field.hint && (
        <p className="text-[11px] text-muted-foreground mt-1">{field.hint}</p>
      )}
    </div>
  );
}
