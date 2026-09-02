'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Star, Check, X, Trash2, Loader2, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

export default function TestimonialsAdminPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (f: Filter) => {
    setLoading(true);
    try {
      const r = await api.listAdminTestimonials(f);
      setItems(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);

  const moderate = async (id: string, action: 'approve' | 'reject' | 'feature' | 'unfeature') => {
    setBusyId(id);
    try {
      await api.moderateTestimonial(id, action);
      toast.success(
        action === 'approve' ? 'Onaylandı' :
        action === 'reject' ? 'Reddedildi' :
        action === 'feature' ? 'Featured\'a alındı' : 'Featured kaldırıldı'
      );
      load(filter);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Yorumu kalıcı olarak sil?')) return;
    setBusyId(id);
    try {
      await api.deleteTestimonial(id);
      toast.success('Silindi');
      load(filter);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-brand-600" />
          Müşteri Yorumları
        </h2>
        <p className="text-sm text-muted-foreground">Kullanıcı yorumları onayına. Onayladıkların landing'de görünür.</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
          >
            {f === 'pending' ? 'Bekleyen' : f === 'approved' ? 'Onaylı' : f === 'rejected' ? 'Reddedilen' : 'Tümü'}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border bg-card p-8 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Bu filtrede yorum yok.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-3.5 w-3.5 ${n <= t.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString('tr-TR')}</span>
                  </div>
                  <div className="flex gap-1">
                    {t.featured && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-700">⭐ FEATURED</span>}
                    {t.approved && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700">ONAYLI</span>}
                    {t.rejected && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700">RED</span>}
                  </div>
                </div>

                {/* Body */}
                <p className="text-sm leading-relaxed">"{t.body}"</p>

                {/* Metric badge */}
                {t.metric && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-bold">
                    📈 {t.metric}
                  </div>
                )}

                {/* Author */}
                <div className="text-xs text-muted-foreground border-t pt-2">
                  <div><strong className="text-foreground">{t.user?.name ?? t.user?.email ?? 'Kullanıcı'}</strong></div>
                  {(t.role || t.company) && (
                    <div>{[t.role, t.company].filter(Boolean).join(' · ')}</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 flex-wrap">
                  {!t.approved && !t.rejected && (
                    <>
                      <Button size="sm" onClick={() => moderate(t.id, 'approve')} disabled={busyId === t.id} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <Check className="h-3.5 w-3.5 mr-1" /> Onayla
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moderate(t.id, 'reject')} disabled={busyId === t.id} className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10">
                        <X className="h-3.5 w-3.5 mr-1" /> Reddet
                      </Button>
                    </>
                  )}
                  {t.approved && !t.featured && (
                    <Button size="sm" variant="outline" onClick={() => moderate(t.id, 'feature')} disabled={busyId === t.id}>
                      ⭐ Featured'a al
                    </Button>
                  )}
                  {t.featured && (
                    <Button size="sm" variant="outline" onClick={() => moderate(t.id, 'unfeature')} disabled={busyId === t.id}>
                      Featured kaldır
                    </Button>
                  )}
                  {t.rejected && (
                    <Button size="sm" onClick={() => moderate(t.id, 'approve')} disabled={busyId === t.id} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <Check className="h-3.5 w-3.5 mr-1" /> Geri al
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)} disabled={busyId === t.id} className="text-rose-600 ml-auto">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
