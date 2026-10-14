'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ClipboardList, Plus, Loader2, Circle, CircleDot, CheckCircle2,
  Trash2, X,
} from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { siteHref } from '@/lib/site-routes';

/**
 * Aksiyon Planı — tüm modüllerden toplanan iş listesi.
 * Audit, GEO, AXO, ASO, Ads bulguları "Aksiyon Planına Ekle" ile buraya düşer.
 */

const SOURCE_LABEL: Record<string, string> = {
  audit: 'Site Skoru',
  geo: 'GEO',
  agent_readiness: 'Agent Readiness',
  citation: 'AI Görünürlük',
  prompt_lab: 'Prompt Lab',
  aso: 'ASO',
  ads: 'Reklam',
  qa: 'QA',
  chat: 'Asistan',
  product_radar: 'Ürün Radarı',
  community: 'Topluluk',
  intel: 'İstihbarat',
  manual: 'Manuel',
};

/** Etki → rozet tonu + Turkce ad (eskiden ham "high/medium/low" gorunuyordu) */
const IMPACT: Record<string, { label: string; tone: 'danger' | 'warning' | 'secondary' }> = {
  high: { label: 'Yüksek etki', tone: 'danger' },
  medium: { label: 'Orta etki', tone: 'warning' },
  low: { label: 'Düşük etki', tone: 'secondary' },
};

const COLUMNS: Array<{ key: string; title: string; icon: any }> = [
  { key: 'todo', title: 'Yapılacak', icon: Circle },
  { key: 'in_progress', title: 'Sürüyor', icon: CircleDot },
  { key: 'done', title: 'Bitti', icon: CheckCircle2 },
];

export default function ActionPlanPage() {
  const { site } = useSiteContext();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      setItems(await api.listActionPlan(site.id));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

  const add = async () => {
    if (newTitle.trim().length < 3) return;
    setAdding(true);
    try {
      await api.addActionPlanItem(site.id, { title: newTitle.trim(), source: 'manual' });
      setNewTitle('');
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const setStatus = async (item: any, status: string) => {
    try {
      await api.updateActionPlanItem(site.id, item.id, { status });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (item: any) => {
    try {
      await api.deleteActionPlanItem(site.id, item.id);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = { todo: [], in_progress: [], done: [] };
    for (const i of items) if (map[i.status]) map[i.status].push(i);
    return map;
  }, [items]);

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={ClipboardList}
        title="Aksiyon Planı"
        description="Site denetimi, GEO, ajan hazırlığı, ASO ve asistandan gelen işler tek listede."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4 mr-1.5" /> İş ekle
          </Button>
        }
      />

      {showForm && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Yapılacak işi yaz…"
              aria-label="Yeni iş"
              className="flex-1"
              autoFocus
            />
            <Button size="sm" onClick={add} disabled={adding || newTitle.trim().length < 3}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ekle'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} aria-label="Vazgeç"><X className="h-3.5 w-3.5" /></Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Yükleniyor">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : items.length === 0 && !showForm ? (
        <EmptyState
          icon={ClipboardList}
          title="Henüz iş yok"
          description="Site Skoru, GEO Lab ve diğer ekranlarda “Aksiyon planına ekle” dediğin işler burada toplanır. Kendi işini de ekleyebilirsin."
          primary={{ label: 'İlk işi ekle', onClick: () => setShowForm(true) }}
          secondary={{ label: 'Site Skoru’na git', href: siteHref(site.id, 'audit') }}
        />
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const ColIcon = col.icon;
            const colItems = byStatus[col.key] ?? [];
            return (
              <div key={col.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <ColIcon className={cn('h-4 w-4', col.key === 'done' ? 'text-success' : col.key === 'in_progress' ? 'text-info' : 'text-muted-foreground')} />
                  <span className="text-sm font-semibold">{col.title}</span>
                  <span className="text-label tabular-nums text-muted-foreground">{colItems.length}</span>
                </div>
                <div className="space-y-2 min-h-[80px]">
                  {colItems.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className={cn('text-sm font-medium leading-snug', item.status === 'done' && 'line-through text-muted-foreground')}>
                              {item.title}
                            </div>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                            )}
                          </div>
                          <button type="button" onClick={() => remove(item)} className="shrink-0 rounded text-muted-foreground/60 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50" aria-label={`${item.title} işini sil`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary">{SOURCE_LABEL[item.source] ?? item.source}</Badge>
                          {IMPACT[item.impact] && <Badge variant={IMPACT[item.impact].tone}>{IMPACT[item.impact].label}</Badge>}
                          <div className="flex-1" />
                          {item.status === 'todo' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setStatus(item, 'in_progress')}>
                              Başla
                            </Button>
                          )}
                          {item.status !== 'done' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setStatus(item, 'done')}>
                              Bitir
                            </Button>
                          )}
                          {item.status === 'done' && (
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setStatus(item, 'todo')}>
                              Geri al
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {colItems.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-label text-muted-foreground">
                      {col.key === 'todo' ? 'Bekleyen iş yok' : col.key === 'in_progress' ? 'Üzerinde çalışılan iş yok' : 'Henüz biten iş yok'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
