'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  MessagesSquare, RefreshCw, Loader2, ExternalLink, Check, X,
  Copy, Send,
} from 'lucide-react';

/**
 * Topluluk Ajanı — Reddit/Quora'da markanla ilgili cevaplanabilir sorular +
 * AI taslak cevaplar. Otomatik POST YOK: insan onayı esas (spam değil, değer).
 */

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  NEW:      { text: 'Yeni',      cls: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  DRAFTED:  { text: 'Taslak hazır', cls: 'bg-violet-500/10 text-violet-600 border-violet-500/30' },
  APPROVED: { text: 'Onaylandı', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  POSTED:   { text: 'Paylaşıldı', cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40' },
  IGNORED:  { text: 'Yoksayıldı', cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' },
};

export default function CommunitiesPage() {
  const { site } = useSiteContext();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = async () => {
    try {
      setItems(await api.listCommunityOpportunities(site.id));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

  const scan = async () => {
    setScanning(true);
    try {
      const res = await api.scanCommunity(site.id);
      toast.success(`Tarama bitti: ${res.created} yeni fırsat (${res.found} bulundu)`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setScanning(false);
    }
  };

  const setStatus = async (item: any, status: string) => {
    try {
      await api.updateCommunityOpportunity(site.id, item.id, { status });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const saveDraft = async (item: any) => {
    try {
      await api.updateCommunityOpportunity(site.id, item.id, { draftReply: draft });
      setEditing(null);
      toast.success('Taslak kaydedildi');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyDraft = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Taslak kopyalandı — Reddit\'te yapıştırıp paylaşabilirsin'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  const visible = items.filter((i) => i.status !== 'IGNORED');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 grid place-items-center">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Topluluk Ajanı</h2>
            <p className="text-sm text-muted-foreground">
              Reddit/Quora'da nişinle ilgili sorular + markanın sesinde AI taslak cevaplar. Paylaşım her zaman senin onayınla — spam değil, gerçek değer.
            </p>
          </div>
        </div>
        <Button onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {scanning ? 'Taranıyor…' : 'Fırsat Tara'}
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <MessagesSquare className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Henüz fırsat yok — "Fırsat Tara" ile Reddit'te nişinle ilgili soruları bul.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.NEW;
            const isEditing = editing === item.id;
            return (
              <Card key={item.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', badge.cls)}>{badge.text}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{item.platform}</Badge>
                        {item.subreddit && <Badge variant="outline" className="text-[10px]">r/{item.subreddit}</Badge>}
                        <span className="text-[10px] font-mono text-muted-foreground">uyum {item.relevance}/100</span>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-sm hover:underline inline-flex items-center gap-1.5">
                        {item.title} <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                      {item.snippet && <p className="text-xs text-muted-foreground line-clamp-2">{item.snippet}</p>}
                    </div>
                  </div>

                  {/* Taslak cevap */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="text-xs" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveDraft(item)}>Kaydet</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button>
                      </div>
                    </div>
                  ) : item.draftReply ? (
                    <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                      <p className="text-xs whitespace-pre-wrap">{item.draftReply}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => copyDraft(item.draftReply)}>
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Kopyala
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditing(item.id); setDraft(item.draftReply); }}>
                          Düzenle
                        </Button>
                        {item.status !== 'POSTED' && (
                          <Button size="sm" onClick={() => setStatus(item, 'POSTED')}>
                            <Send className="h-3.5 w-3.5 mr-1.5" /> Paylaştım olarak işaretle
                          </Button>
                        )}
                        {item.status === 'DRAFTED' && (
                          <Button size="sm" variant="outline" onClick={() => setStatus(item, 'APPROVED')}>
                            <Check className="h-3.5 w-3.5 mr-1.5" /> Onayla
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setStatus(item, 'IGNORED')}>
                          <X className="h-3.5 w-3.5 mr-1" /> Yoksay
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(item.id); setDraft(''); }}>
                        Taslak yaz
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(item, 'IGNORED')}>
                        <X className="h-3.5 w-3.5 mr-1" /> Yoksay
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
