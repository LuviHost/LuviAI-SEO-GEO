'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Mail, AtSign, MessageSquare, Reply, Archive, Check, CircleSlash, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';

type InboxStatus = 'UNREAD' | 'READ' | 'REPLIED' | 'ARCHIVED' | 'RESOLVED';
type InboxType = 'DM' | 'MENTION' | 'COMMENT' | 'REPLY';

interface InboxMessage {
  id: string;
  channelId: string;
  type: InboxType;
  status: InboxStatus;
  senderName?: string | null;
  senderHandle?: string | null;
  senderAvatar?: string | null;
  text?: string | null;
  postId?: string | null;
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
  aiTags?: string[] | null;
  reply?: string | null;
  replyAt?: string | null;
  receivedAt: string;
}

const TYPE_ICON: Record<InboxType, React.ComponentType<any>> = {
  DM: Mail,
  MENTION: AtSign,
  COMMENT: MessageSquare,
  REPLY: Reply,
};

const STATUS_COLORS: Record<InboxStatus, string> = {
  UNREAD:   'bg-blue-500',
  READ:     'bg-muted-foreground/30',
  REPLIED:  'bg-emerald-500',
  ARCHIVED: 'bg-muted-foreground/20',
  RESOLVED: 'bg-purple-500',
};

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  NEUTRAL:  'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
  NEGATIVE: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30',
};

export default function SocialInboxPage() {
  const { site } = useSiteContext();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InboxStatus | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<InboxType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [activeMsg, setActiveMsg] = useState<InboxMessage | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (typeFilter !== 'ALL') params.type = typeFilter;
      const rows = await api.listInbox(site.id, params);
      setMessages(rows ?? []);
    } catch (err: any) {
      toast.error(`Inbox yüklenemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [site.id, statusFilter, typeFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(m =>
      (m.text ?? '').toLowerCase().includes(q) ||
      (m.senderName ?? '').toLowerCase().includes(q) ||
      (m.senderHandle ?? '').toLowerCase().includes(q),
    );
  }, [messages, search]);

  const openMessage = async (msg: InboxMessage) => {
    setActiveMsg(msg);
    setReplyText('');
    if (msg.status === 'UNREAD') {
      try {
        await api.inboxMarkRead(msg.id);
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'READ' as const } : m));
      } catch { /* ignore */ }
    }
  };

  const sendReply = async () => {
    if (!activeMsg || !replyText.trim()) return;
    setSending(true);
    try {
      await api.inboxReply(activeMsg.id, replyText.trim());
      setMessages(prev => prev.map(m => m.id === activeMsg.id ? { ...m, status: 'REPLIED' as const, reply: replyText.trim(), replyAt: new Date().toISOString() } : m));
      setActiveMsg(prev => prev ? { ...prev, status: 'REPLIED', reply: replyText.trim() } : null);
      setReplyText('');
      toast.success('Cevap gönderildi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const archive = async (id: string) => {
    try {
      await api.inboxArchive(id);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, status: 'ARCHIVED' as const } : m));
      if (activeMsg?.id === id) setActiveMsg(null);
    } catch (err: any) { toast.error(err.message); }
  };

  const resolve = async (id: string) => {
    try {
      await api.inboxResolve(id);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, status: 'RESOLVED' as const } : m));
      if (activeMsg?.id === id) setActiveMsg(null);
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="p-6 max-w-[1500px] mx-auto h-[calc(100vh-72px)] flex flex-col">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Social Inbox</h1>
          <p className="text-sm text-muted-foreground">DM, mention ve yorumları tek panelde yönet</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="h-9 px-2 rounded-md border border-input text-sm bg-background"
          >
            <option value="ALL">Tüm statüler</option>
            <option value="UNREAD">Okunmamış</option>
            <option value="READ">Okundu</option>
            <option value="REPLIED">Cevaplandı</option>
            <option value="ARCHIVED">Arşiv</option>
            <option value="RESOLVED">Çözüldü</option>
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
            className="h-9 px-2 rounded-md border border-input text-sm bg-background"
          >
            <option value="ALL">Tüm tipler</option>
            <option value="DM">DM</option>
            <option value="MENTION">Mention</option>
            <option value="COMMENT">Yorum</option>
            <option value="REPLY">Reply</option>
          </select>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 overflow-hidden">
        {/* Liste */}
        <Card className="overflow-hidden flex flex-col">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Mesajlarda ara..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-2 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Mesaj yok.</div>
            ) : filtered.map(msg => {
              const Icon = TYPE_ICON[msg.type];
              return (
                <button
                  key={msg.id}
                  onClick={() => openMessage(msg)}
                  className={`w-full text-left px-3 py-2 border-b hover:bg-muted/40 transition-colors flex items-start gap-2 ${activeMsg?.id === msg.id ? 'bg-muted/60' : ''}`}
                >
                  <span className={`w-2 h-2 rounded-full mt-2 shrink-0 ${STATUS_COLORS[msg.status]}`} />
                  <Icon className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{msg.senderName ?? msg.senderHandle ?? 'Anonim'}</div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(msg.receivedAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{msg.text ?? '—'}</div>
                    {msg.sentiment && (
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 ${SENTIMENT_COLORS[msg.sentiment]}`}>
                        {msg.sentiment}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Detay */}
        <Card className="overflow-hidden flex flex-col">
          {activeMsg ? (
            <>
              <div className="p-4 border-b flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{activeMsg.senderName ?? activeMsg.senderHandle ?? 'Anonim'}</div>
                  {activeMsg.senderHandle && <div className="text-xs text-muted-foreground">@{activeMsg.senderHandle}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {activeMsg.type} · {new Date(activeMsg.receivedAt).toLocaleString('tr-TR')}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => resolve(activeMsg.id)}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Çöz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => archive(activeMsg.id)}>
                    <Archive className="h-3.5 w-3.5 mr-1" /> Arşivle
                  </Button>
                </div>
              </div>
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="bg-muted/40 rounded-lg p-3 text-sm">{activeMsg.text ?? '(boş mesaj)'}</div>
                {activeMsg.aiTags && activeMsg.aiTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {activeMsg.aiTags.map((tag, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand">{tag}</span>
                    ))}
                  </div>
                )}
                {activeMsg.reply && (
                  <div className="bg-brand/5 border-l-2 border-brand rounded-r p-3 text-sm">
                    <div className="text-[10px] text-muted-foreground mb-1">Cevabın · {activeMsg.replyAt && new Date(activeMsg.replyAt).toLocaleString('tr-TR')}</div>
                    {activeMsg.reply}
                  </div>
                )}
              </CardContent>
              <div className="p-3 border-t space-y-2">
                <Textarea
                  placeholder="Cevap yaz..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button onClick={sendReply} disabled={!replyText.trim() || sending}>
                    <Reply className="h-4 w-4 mr-1" />
                    {sending ? 'Gönderiliyor...' : 'Cevap gönder'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              <div className="text-center">
                <CircleSlash className="h-10 w-10 mx-auto mb-2 opacity-30" />
                Sol panelden bir mesaj seç
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
