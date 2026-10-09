'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Yorum yanıtı: AI taslak (isteğe bağlı) → insan düzenler → herkese açık
 * yayın onayı → gönder. Yanıt varsa üstüne yazılır (Apple: overwrite).
 */

const PLACEHOLDER_RE = /\[[^\]\n]{2,40}\]|\{\{[^}\n]{1,40}\}\}|<[^>\n]{2,30}>/g;
const MAX = 5970;

export function AscReviewReply({
  appId,
  review,
  onSent,
}: {
  appId: string;
  review: { id: string; response: { body: string; state: string | null } | null };
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.response?.body ?? '');
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const placeholders = [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
  const len = [...text].length;
  const canSend = confirmed && len >= 5 && len <= MAX && placeholders.length === 0 && !sending;

  const draft = async () => {
    setDrafting(true);
    setReport(null);
    try {
      const d = await api.draftAscReviewReply(appId, review.id, { notes: notes.trim() || undefined });
      if (d.report) {
        setReport(d.reason ?? 'Bu yorum hakaret ya da spam görünüyor');
      } else {
        setText(d.reply);
        setConfirmed(false);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Taslak üretilemedi');
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      await api.replyAscReview(appId, review.id, text.trim());
      toast.success('Yanıt gönderildi — App Store\'da görünmesi biraz sürebilir');
      setOpen(false);
      setConfirmed(false);
      onSent();
    } catch (e: any) {
      toast.error(e?.message ?? 'Gönderilemedi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {review.response && (
        <div className="rounded border-l-2 border-brand/40 bg-background p-2">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-label font-medium">Yanıtımız</span>
            <Badge variant={review.response.state === 'PUBLISHED' ? 'success' : 'secondary'}>
              {review.response.state === 'PUBLISHED' ? 'yayında' : 'yayın bekliyor'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{review.response.body}</p>
        </div>
      )}

      {!open ? (
        <Button size="sm" variant="outline" className="h-7 text-label" onClick={() => setOpen(true)}>
          {review.response ? 'Yanıtı düzenle' : 'Yanıtla'}
        </Button>
      ) : (
        <div className="space-y-2 rounded border bg-background p-2">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Doğrulanmış bilgi (isteğe bağlı): ör. 1.2 sürümünde düzeltildi"
            className="h-8 text-xs"
            aria-label="Geliştirici notu"
          />
          <Button size="sm" variant="outline" className="h-7 text-label" onClick={draft} disabled={drafting}>
            {drafting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />} AI taslak
          </Button>
          {report && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {report}. Yanıtlamak yerine App Store Connect&apos;te yorumun altındaki &quot;Report a Concern&quot; ile bildir.
            </p>
          )}
          <Textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setConfirmed(false); }}
            className="text-xs min-h-[90px]"
            aria-label="Yanıt metni"
          />
          <div className="flex items-center justify-between text-label text-muted-foreground">
            <span>{len}/{MAX}</span>
            {placeholders.length > 0 && <span className="text-rose-600">Doldurulmamış yer tutucu: {placeholders.join(', ')}</span>}
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>
              Bu yanıt App Store&apos;da <strong>herkese açık</strong> yayınlanır
              {review.response ? ' ve önceki yanıtımızın yerine geçer' : ''}. Metni okudum.
            </span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-label" onClick={send} disabled={!canSend}>
              {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />} Gönder
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-label" onClick={() => { setOpen(false); setConfirmed(false); }}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
