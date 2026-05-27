'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowRight, Calendar, Hash, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';

type Column = 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE';

const COLUMNS: Array<{ id: Column; label: string; color: string; description: string }> = [
  { id: 'UNASSIGNED', label: 'Unassigned', color: 'bg-muted/40',        description: 'Yeni fikirler — henüz kimseye atanmamış' },
  { id: 'TODO',       label: 'To Do',      color: 'bg-blue-500/10',     description: 'Üretime hazır, sırada bekleyenler' },
  { id: 'IN_PROGRESS',label: 'In Progress',color: 'bg-amber-500/10',    description: 'Üzerinde çalışılıyor' },
  { id: 'DONE',       label: 'Done',       color: 'bg-emerald-500/10',  description: 'Tamamlanan veya post\'a dönüştürülen' },
];

interface Idea {
  id: string;
  title: string;
  notes?: string | null;
  hashtags?: string[] | null;
  refUrls?: string[] | null;
  workspaceColumn: Column;
  position: number;
  dueAt?: string | null;
  convertedPostId?: string | null;
  createdAt: string;
}

export default function SocialIdeasPage() {
  const { site } = useSiteContext();
  const [board, setBoard] = useState<Record<Column, Idea[]>>({ UNASSIGNED: [], TODO: [], IN_PROGRESS: [], DONE: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Column | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.ideaBoard(site.id);
      setBoard(res);
    } catch (err: any) {
      toast.error(`Idea board yüklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [site.id]);

  const createIdea = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api.createIdea({ title: newTitle.trim(), siteId: site.id, column: 'UNASSIGNED' });
      setNewTitle('');
      await load();
      toast.success('Fikir eklendi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await api.updateIdea(editingId, { title: editTitle, notes: editNotes });
      setEditingId(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Bu fikri silmek istediğinden emin misin?')) return;
    try {
      await api.deleteIdea(id);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const onDragStart = (ideaId: string) => setDragId(ideaId);
  const onDragOver = (col: Column, ev: React.DragEvent) => {
    ev.preventDefault();
    setDragOverCol(col);
  };
  const onDrop = async (targetCol: Column, ev: React.DragEvent) => {
    ev.preventDefault();
    if (!dragId) return;
    const ideaId = dragId;
    setDragId(null);
    setDragOverCol(null);
    // Sona ekle (max position + 1)
    const colItems = board[targetCol] ?? [];
    const lastPos = colItems.length > 0 ? Math.max(...colItems.map(i => i.position)) : -1;
    const optimisticIdea = Object.values(board).flat().find(i => i.id === ideaId);
    if (!optimisticIdea) return;
    if (optimisticIdea.workspaceColumn === targetCol) return;
    // Optimistic
    setBoard(prev => {
      const next = { ...prev };
      for (const col of Object.keys(next) as Column[]) {
        next[col] = next[col].filter(i => i.id !== ideaId);
      }
      next[targetCol] = [...next[targetCol], { ...optimisticIdea, workspaceColumn: targetCol, position: lastPos + 1 }];
      return next;
    });
    try {
      await api.moveIdea(ideaId, targetCol, lastPos + 1);
    } catch (err: any) {
      toast.error(`Taşıma başarısız: ${err.message}`);
      await load();
    }
  };

  const totalIdeas = useMemo(() => Object.values(board).reduce((s, arr) => s + arr.length, 0), [board]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Idea Board</h1>
          <p className="text-sm text-muted-foreground">
            İçerik fikirlerini kanban panelinde topla — {totalIdeas} fikir, 4 kolon, drag-drop
          </p>
        </div>
      </div>

      {/* Quick-add */}
      <Card className="mb-4">
        <CardContent className="p-3 flex items-center gap-2">
          <Input
            placeholder="Yeni fikir ekle (örn: 'Türkçe SEO için 10 yapay zeka aracı karşılaştırması')"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createIdea()}
            className="flex-1"
          />
          <Button onClick={createIdea} disabled={creating || !newTitle.trim()}>
            <Plus className="h-4 w-4 mr-1" /> {creating ? 'Ekleniyor...' : 'Ekle'}
          </Button>
        </CardContent>
      </Card>

      {/* Kanban */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {COLUMNS.map(c => <Skeleton key={c.id} className="h-[500px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {COLUMNS.map(col => {
            const items = board[col.id] ?? [];
            const isDropTarget = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={e => onDragOver(col.id, e)}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={e => onDrop(col.id, e)}
                className={`rounded-lg border ${col.color} ${isDropTarget ? 'ring-2 ring-brand ring-offset-2' : ''} transition-shadow`}
              >
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{col.label}</h2>
                    <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">{items.length}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{col.description}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[300px]">
                  {items.map(idea => (
                    <div
                      key={idea.id}
                      draggable
                      onDragStart={() => onDragStart(idea.id)}
                      onDragEnd={() => setDragId(null)}
                      className={`bg-background rounded-md border p-3 cursor-grab active:cursor-grabbing hover:border-foreground/30 transition-colors ${dragId === idea.id ? 'opacity-40' : ''}`}
                    >
                      {editingId === idea.id ? (
                        <div className="space-y-2">
                          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Başlık" />
                          <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notlar (opsiyonel)" rows={3} />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEdit}>Kaydet</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>İptal</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-medium mb-1 line-clamp-2">{idea.title}</div>
                          {idea.notes && (
                            <div className="text-xs text-muted-foreground line-clamp-3 mb-2">{idea.notes}</div>
                          )}
                          {idea.hashtags && idea.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {idea.hashtags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{tag}</span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2">
                            <div className="flex items-center gap-2">
                              {idea.dueAt && (
                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(idea.dueAt).toLocaleDateString('tr-TR')}</span>
                              )}
                              {idea.convertedPostId && (
                                <span className="flex items-center gap-1 text-emerald-600"><ArrowRight className="h-3 w-3" /> Post'a dönüşmüş</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setEditingId(idea.id); setEditTitle(idea.title); setEditNotes(idea.notes ?? ''); }}
                                className="hover:text-foreground"
                                title="Düzenle"
                              >
                                <Edit className="h-3 w-3" />
                              </button>
                              <button onClick={() => remove(idea.id)} className="hover:text-rose-600" title="Sil">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="text-center text-[11px] text-muted-foreground py-8 border-2 border-dashed rounded">
                      Sürükle bırak veya yeni fikir ekle
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
