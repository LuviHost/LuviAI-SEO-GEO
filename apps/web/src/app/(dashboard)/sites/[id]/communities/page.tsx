'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import {
  MessagesSquare, RefreshCw, Loader2, ExternalLink, Check, X,
  Copy, Send,
} from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * Topluluk Ajanı — Reddit'te (Quora taramasi yok) markanla ilgili cevaplanabilir sorular +
 * AI taslak cevaplar. Otomatik POST YOK: insan onayı esas (spam değil, değer).
 */

// Durum tonlari ui/badge varyantlarindan (token); "Taslak hazır" notr — sus rengi yok
const STATUS_BADGE: Record<string, { text: string; variant: 'info' | 'secondary' | 'success' | 'outline' }> = {
  NEW:      { text: 'Yeni',      variant: 'info' },
  DRAFTED:  { text: 'Taslak hazır', variant: 'secondary' },
  APPROVED: { text: 'Onaylandı', variant: 'success' },
  POSTED:   { text: 'Paylaşıldı', variant: 'success' },
  IGNORED:  { text: 'Yoksayıldı', variant: 'outline' },
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
      <SectionHeader
        icon={MessagesSquare}
        title="Topluluk Ajanı"
        description="Reddit'te sektörünle ilgili sorular ve markanın sesiyle hazırlanmış taslak cevaplar. Hiçbir şey senin onayın olmadan paylaşılmaz."
        actions={
          <Button size="sm" onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />}
            {scanning ? 'Taranıyor…' : 'Fırsat Tara'}
          </Button>
        }
      />

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : visible.length === 0 ? (
        // components/empty-state ile ayni gorunum (kesikli cerceve + notr ikon karosu)
        <div className="rounded-lg border border-dashed border-border p-8 text-center sm:p-12">
          <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-md border text-foreground/70">
            <MessagesSquare className="h-6 w-6" aria-hidden />
          </div>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">Henüz fırsat yok — "Fırsat Tara" ile Reddit'te nişinle ilgili soruları bul.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.NEW;
            const isEditing = editing === item.id;
            return (
              <Card key={item.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={badge.variant}>{badge.text}</Badge>
                        <Badge variant="outline" className="capitalize">{item.platform}</Badge>
                        {item.subreddit && <Badge variant="outline">r/{item.subreddit}</Badge>}
                        <span className="v-rail">uyum {item.relevance}/100</span>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-panel-3 underline-offset-4 hover:underline">
                        {item.title} <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                      {item.snippet && <p className="line-clamp-2 text-sm text-muted-foreground">{item.snippet}</p>}
                    </div>
                  </div>

                  {/* Taslak cevap */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveDraft(item)}>Kaydet</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button>
                      </div>
                    </div>
                  ) : item.draftReply ? (
                    <div className="space-y-3 rounded-md border p-3">
                      <p className="whitespace-pre-wrap text-sm">{item.draftReply}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => copyDraft(item.draftReply)}>
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Kopyala
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditing(item.id); setDraft(item.draftReply); }}>
                          Düzenle
                        </Button>
                        {item.status !== 'POSTED' && (
                          <Button size="sm" variant="secondary" onClick={() => setStatus(item, 'POSTED')}>
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
