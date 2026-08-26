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
  product_radar: 'Product Radar',
  community: 'Topluluk',
  intel: 'İstihbarat',
  manual: 'Manuel',
};

const IMPACT_CLS: Record<string, string> = {
  high: 'bg-red-500/10 text-red-600 border-red-500/30',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  low: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Aksiyon Planı</h2>
            <p className="text-sm text-muted-foreground">
              Audit, GEO, Agent Readiness, ASO ve asistandan gelen işler tek listede — rapor değil, iş yönetimi.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" /> Madde Ekle
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Yapılacak işi yaz…"
              className="flex-1 bg-transparent outline-none text-sm px-2 py-1.5"
              autoFocus
            />
            <Button size="sm" onClick={add} disabled={adding || newTitle.trim().length < 3}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ekle'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}><X className="h-3.5 w-3.5" /></Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const ColIcon = col.icon;
            const colItems = byStatus[col.key] ?? [];
            return (
              <div key={col.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <ColIcon className={cn('h-4 w-4', col.key === 'done' ? 'text-emerald-500' : col.key === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground')} />
                  <span className="text-sm font-semibold">{col.title}</span>
                  <Badge variant="outline" className="text-[10px]">{colItems.length}</Badge>
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
                          <button type="button" onClick={() => remove(item)} className="text-muted-foreground/50 hover:text-red-500 shrink-0">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px]">{SOURCE_LABEL[item.source] ?? item.source}</Badge>
                          <Badge variant="outline" className={cn('text-[9px]', IMPACT_CLS[item.impact])}>{item.impact}</Badge>
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
                              Geri Al
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {colItems.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground/60">
                      Boş
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
