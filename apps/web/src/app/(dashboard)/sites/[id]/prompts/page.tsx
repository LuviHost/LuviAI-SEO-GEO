'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Library, Plus, Search, Trash2, Edit, Copy, ThumbsUp, Sparkles,
  FileText, GitCompare, MapPin, ShoppingCart, Linkedin, Megaphone,
  ListChecks, HelpCircle, X, Globe, Lock, Star,
} from 'lucide-react';

const ICON_MAP: Record<string, any> = {
  FileText, GitCompare, MapPin, ShoppingCart, Linkedin, Megaphone, ListChecks, HelpCircle, Search, Sparkles,
};

const CATEGORIES = [
  { value: 'GENERAL', label: 'Genel' },
  { value: 'TITLE', label: 'Başlık' },
  { value: 'META_DESCRIPTION', label: 'Meta Description' },
  { value: 'OUTLINE', label: 'Outline' },
  { value: 'ARTICLE', label: 'Makale' },
  { value: 'SOCIAL_POST', label: 'Sosyal Medya' },
  { value: 'EMAIL', label: 'E-posta' },
  { value: 'PRODUCT_DESCRIPTION', label: 'Ürün Açıklama' },
  { value: 'COMPARISON', label: 'Karşılaştırma' },
  { value: 'HOWTO', label: 'How-To' },
  { value: 'FAQ', label: 'SSS' },
  { value: 'AD_COPY', label: 'Reklam Metni' },
  { value: 'LANDING_PAGE', label: 'Landing Page' },
];

interface PromptTemplate {
  id: string;
  userId: string;
  siteId: string | null;
  name: string;
  description: string | null;
  category: string;
  body: string;
  variables: Array<{ name: string; label: string; type: string }> | null;
  isPublic: boolean;
  isFeatured: boolean;
  upvotes: number;
  usageCount: number;
  tags: string[] | any;
  language: string;
  icon: string | null;
  createdAt: string;
}

export default function PromptsPage() {
  const { site } = useSiteContext();
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<string>('');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [using, setUsing] = useState<PromptTemplate | null>(null);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (view === 'mine') params.set('mine', '1');
      const data = await api.request<PromptTemplate[]>(`/prompts?${params}`);
      setItems(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [category, view]);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const f = filter.toLowerCase();
    return items.filter(i =>
      i.name.toLowerCase().includes(f) ||
      (i.description ?? '').toLowerCase().includes(f) ||
      (Array.isArray(i.tags) && i.tags.some((t: string) => t.toLowerCase().includes(f)))
    );
  }, [items, filter]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await api.request<{ ok: boolean; seeded?: number; skipped?: boolean }>('/prompts/seed-defaults', { method: 'POST' });
      if (res.skipped) {
        toast.info('Zaten promptların var.');
      } else {
        toast.success(`${res.seeded ?? 0} hazır şablon eklendi.`);
      }
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSeeding(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu promptı silmek istediğine emin misin?')) return;
    try {
      await api.request(`/prompts/${id}`, { method: 'DELETE' });
      toast.success('Silindi.');
      setItems(items.filter(i => i.id !== id));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const clone = async (id: string) => {
    try {
      const res = await api.request<PromptTemplate>(`/prompts/${id}/clone`, { method: 'POST' });
      toast.success('Kendi koleksiyonuna kopyalandı.');
      setItems([res, ...items]);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const upvote = async (id: string) => {
    try {
      const res = await api.request<PromptTemplate>(`/prompts/${id}/upvote`, { method: 'POST' });
      setItems(items.map(i => i.id === id ? res : i));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 grid place-items-center">
            <Library className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Prompt Kütüphanesi</h2>
            <p className="text-sm text-muted-foreground">
              Hazır AI prompt şablonları + kendi koleksiyonun. Değişkenleri doldur, sonucu makale veya social post olarak kullan.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {items.length === 0 && !loading && (
            <Button size="sm" variant="outline" onClick={seedDefaults} disabled={seeding}>
              <Sparkles className="h-4 w-4 mr-2" />
              Hazır şablonları yükle
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Yeni Prompt
          </Button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Prompt, etiket veya açıklama ara..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="h-9 px-3 rounded-md border border-input text-sm bg-background"
        >
          <option value="">Tüm kategoriler</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <div className="flex border rounded-md overflow-hidden">
          <button
            onClick={() => setView('all')}
            className={`text-xs px-3 h-9 ${view === 'all' ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
          >
            Tümü
          </button>
          <button
            onClick={() => setView('mine')}
            className={`text-xs px-3 h-9 ${view === 'mine' ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
          >
            Sadece benimkiler
          </button>
        </div>
      </div>

      {/* EMPTY STATE — no prompts at all */}
      {!loading && items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Library className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <h3 className="font-semibold mb-2">Henüz promptın yok</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
              8 hazır şablonu yükleyebilir veya kendi promptını oluşturabilirsin. Hazır şablonlar
              SEO makale, sosyal medya, reklam metni gibi kategorilerde başlangıç sağlar.
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={seedDefaults} disabled={seeding}>
                <Sparkles className="h-4 w-4 mr-2" />
                {seeding ? 'Yükleniyor...' : '8 hazır şablon yükle'}
              </Button>
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Sıfırdan oluştur
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LOADING */}
      {loading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      )}

      {/* PROMPT GRID */}
      {!loading && filtered.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => {
            const Icon = p.icon && ICON_MAP[p.icon] ? ICON_MAP[p.icon] : FileText;
            const isMine = view === 'mine' || p.userId; // simplification — userId comparison TODO
            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow flex flex-col">
                <CardContent className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="h-9 w-9 rounded-lg bg-brand/10 text-brand grid place-items-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-1">
                      {p.isFeatured && (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px]">
                          <Star className="h-2.5 w-2.5 mr-1" />
                          Öne çıkan
                        </Badge>
                      )}
                      {p.isPublic ? (
                        <Badge variant="outline" className="text-[10px]"><Globe className="h-2.5 w-2.5 mr-1" />Public</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]"><Lock className="h-2.5 w-2.5 mr-1" />Özel</Badge>
                      )}
                    </div>
                  </div>
                  <h3 className="font-semibold text-sm mb-1 line-clamp-2">{p.name}</h3>
                  {p.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mb-3 mt-auto">
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORIES.find(c => c.value === p.category)?.label ?? p.category}
                    </Badge>
                    {Array.isArray(p.tags) && p.tags.slice(0, 2).map((t: string) => (
                      <Badge key={t} variant="outline" className="text-[10px] bg-muted/50">{t}</Badge>
                    ))}
                    {p.variables && p.variables.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {p.variables.length} değişken
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                    <span>{p.usageCount} kullanım</span>
                    {p.upvotes > 0 && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <ThumbsUp className="h-3 w-3" /> {p.upvotes}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1.5 pt-2 border-t border-border/40">
                    <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => setUsing(p)}>
                      Kullan
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setEditing(p)} title="Düzenle">
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => clone(p.id)} title="Kopyala">
                      <Copy className="h-3 w-3" />
                    </Button>
                    {p.isPublic && (
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => upvote(p.id)} title="Beğen">
                        <ThumbsUp className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-8 px-2 text-rose-600 hover:bg-rose-500/10" onClick={() => remove(p.id)} title="Sil">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* USE MODAL */}
      {using && <UseModal prompt={using} onClose={() => setUsing(null)} />}

      {/* CREATE / EDIT MODAL */}
      {(creating || editing) && (
        <EditModal
          prompt={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(p) => {
            if (editing) {
              setItems(items.map(i => i.id === p.id ? p : i));
            } else {
              setItems([p, ...items]);
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function UseModal({ prompt, onClose }: { prompt: PromptTemplate; onClose: () => void }) {
  const [vars, setVars] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (Array.isArray(prompt.variables)) {
      for (const v of prompt.variables) init[v.name] = '';
    }
    return init;
  });
  const [rendered, setRendered] = useState('');
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.request<{ rendered: string }>(`/prompts/${prompt.id}/use`, {
        method: 'POST',
        body: JSON.stringify({ variables: vars }),
      });
      setRendered(res.rendered);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(rendered);
    toast.success('Panoya kopyalandı.');
  };

  const variables = Array.isArray(prompt.variables) ? prompt.variables : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border rounded-lg max-w-2xl w-full my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold">{prompt.name}</h3>
            {prompt.description && (
              <p className="text-xs text-muted-foreground mt-1">{prompt.description}</p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          {variables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu promptın değişkeni yok — direkt kullanabilirsin.</p>
          ) : (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Değişkenleri doldur</h4>
              {variables.map(v => (
                <div key={v.name}>
                  <label className="text-xs font-medium mb-1 block">{v.label}</label>
                  {v.type === 'textarea' ? (
                    <textarea
                      value={vars[v.name] ?? ''}
                      onChange={e => setVars({ ...vars, [v.name]: e.target.value })}
                      className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background min-h-[80px]"
                      placeholder={`{{${v.name}}}`}
                    />
                  ) : (
                    <Input
                      value={vars[v.name] ?? ''}
                      onChange={e => setVars({ ...vars, [v.name]: e.target.value })}
                      placeholder={`{{${v.name}}}`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {rendered && (
            <div>
              <h4 className="text-sm font-medium mb-2">Hazır prompt</h4>
              <div className="bg-muted/50 rounded-md p-3 text-sm font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {rendered}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-2 bg-muted/20">
          <span className="text-xs text-muted-foreground">{rendered ? `${rendered.length} karakter` : ''}</span>
          <div className="flex gap-2">
            {rendered ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setRendered('')}>Yeniden</Button>
                <Button size="sm" onClick={copy}>Panoya kopyala</Button>
              </>
            ) : (
              <Button size="sm" onClick={run} disabled={running}>
                {running ? 'Hazırlanıyor...' : 'Promptu hazırla'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({ prompt, onClose, onSaved }: {
  prompt: PromptTemplate | null;
  onClose: () => void;
  onSaved: (p: PromptTemplate) => void;
}) {
  const [name, setName] = useState(prompt?.name ?? '');
  const [description, setDescription] = useState(prompt?.description ?? '');
  const [body, setBody] = useState(prompt?.body ?? '');
  const [category, setCategory] = useState(prompt?.category ?? 'GENERAL');
  const [isPublic, setIsPublic] = useState(prompt?.isPublic ?? false);
  const [tagsText, setTagsText] = useState(Array.isArray(prompt?.tags) ? prompt!.tags.join(', ') : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !body.trim()) {
      toast.error('İsim ve prompt body zorunlu');
      return;
    }
    setSaving(true);
    try {
      const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
      const dto = { name, description, body, category: category as any, isPublic, tags };
      const res = prompt
        ? await api.request<PromptTemplate>(`/prompts/${prompt.id}`, { method: 'PATCH', body: JSON.stringify(dto) })
        : await api.request<PromptTemplate>('/prompts', { method: 'POST', body: JSON.stringify(dto) });
      onSaved(res);
      toast.success(prompt ? 'Güncellendi.' : 'Oluşturuldu.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border rounded-lg max-w-2xl w-full my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-bold">{prompt ? 'Promptu düzenle' : 'Yeni Prompt'}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block">İsim *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: SEO Makale - Hosting Karşılaştırma" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Kısa açıklama</label>
            <Input value={description ?? ''} onChange={e => setDescription(e.target.value)} placeholder="Bu prompt ne işe yarıyor?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Kategori</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="w-full h-9 px-2 rounded-md border border-input text-sm bg-background">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Etiketler (virgül ile)</label>
              <Input value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="seo, hosting, blog" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Prompt body *</label>
            <p className="text-xs text-muted-foreground mb-2">
              Değişkenler için <code className="bg-muted px-1 rounded">{'{{degisken_adi}}'}</code> formatını kullan.
              Örnek: <code className="bg-muted px-1 rounded">{'{{topic}}'}</code> hakkında 1500 kelimelik makale yaz.
            </p>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background min-h-[200px] font-mono"
              placeholder="{{topic}} hakkında..."
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            <span>Public (diğer kullanıcılar da görsün)</span>
          </label>
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2 bg-muted/20">
          <Button size="sm" variant="outline" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Kaydediliyor...' : (prompt ? 'Güncelle' : 'Oluştur')}
          </Button>
        </div>
      </div>
    </div>
  );
}
