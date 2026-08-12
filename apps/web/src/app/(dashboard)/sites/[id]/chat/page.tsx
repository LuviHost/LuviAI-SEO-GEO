'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Send, Loader2, Sparkles, History, Plus, Trash2,
  Wrench, ChevronDown, Database,
} from 'lucide-react';

/**
 * RanksUp Chat — verinin üstünde konuşan asistan + skill kataloğu.
 * "Bu hafta görünürlüğüm neden düştü?" → asistan tool'larla gerçek
 * sayıları çekip cevaplar; tool çağrıları şeffaf gösterilir.
 */

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; input: any; resultSummary: string }>;
  skill?: string | null;
};

const TAG_CLS: Record<string, string> = {
  AGENT: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  PROMPTS: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  REPORT: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  BRIEFING: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  TREND: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  DIAGNOSTIC: 'bg-red-500/10 text-red-600 border-red-500/30',
  CONTENT: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
  YOUTUBE: 'bg-red-500/10 text-red-600 border-red-500/30',
  LINKEDIN: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  ASO: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
};

export default function ChatPage() {
  const { site } = useSiteContext();
  const [skills, setSkills] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openTools, setOpenTools] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listChatSkills(site.id).then(setSkills).catch(() => {});
    api.listChatConversations(site.id).then(setConversations).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const openConversation = async (id: string) => {
    try {
      const conv = await api.getChatConversation(site.id, id);
      setConversationId(conv.id);
      setMessages(conv.messages.map((m: any) => ({
        id: m.id, role: m.role, content: m.content, toolCalls: m.toolCalls ?? undefined, skill: m.skill,
      })));
      setShowHistory(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
  };

  const removeConversation = async (id: string) => {
    try {
      await api.deleteChatConversation(site.id, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) newConversation();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const send = async (opts: { message?: string; skill?: string }) => {
    const text = opts.message?.trim() ?? '';
    if (!opts.skill && !text) return;
    setSending(true);
    setInput('');
    const skillName = opts.skill ? skills.find((s) => s.key === opts.skill)?.name : null;
    setMessages((prev) => [...prev, {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text || `▶ ${skillName ?? opts.skill}`,
      skill: opts.skill ?? null,
    }]);
    try {
      const res = await api.sendChatMessage(site.id, {
        conversationId: conversationId ?? undefined,
        message: text || undefined,
        skill: opts.skill,
      });
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, {
        id: res.message.id,
        role: 'assistant',
        content: res.message.content,
        toolCalls: res.message.toolCalls,
      }]);
      api.listChatConversations(site.id).then(setConversations).catch(() => {});
    } catch (err: any) {
      toast.error(err.message);
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const emptyState = messages.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Asistan</h2>
            <p className="text-sm text-muted-foreground">
              Verinin üstünde konuşur — citation'lar, prompt sonuçları, skorlar ve ASO verisi sohbetin içinden erişilir.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
            <History className="h-4 w-4 mr-1.5" /> Geçmiş
            {conversations.length > 0 && <Badge variant="outline" className="ml-1.5 text-[10px]">{conversations.length}</Badge>}
          </Button>
          <Button variant="outline" size="sm" onClick={newConversation}>
            <Plus className="h-4 w-4 mr-1.5" /> Yeni
          </Button>
        </div>
      </div>

      {showHistory && (
        <Card>
          <CardContent className="p-3 space-y-1 max-h-64 overflow-y-auto">
            {conversations.length === 0 && (
              <div className="text-xs text-muted-foreground p-2">Henüz konuşma yok</div>
            )}
            {conversations.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-md hover:bg-muted/60 px-2 py-1.5">
                <button type="button" onClick={() => openConversation(c.id)} className="flex-1 text-left min-w-0">
                  <div className="text-sm truncate">{c.title ?? 'Adsız konuşma'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c._count?.messages ?? 0} mesaj · {new Date(c.updatedAt).toLocaleString('tr-TR')}
                  </div>
                </button>
                <Button size="sm" variant="ghost" onClick={() => removeConversation(c.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Mesajlar */}
      {!emptyState && (
        <Card>
          <CardContent className="p-4 space-y-4 max-h-[55vh] overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-xl px-4 py-2.5 text-sm',
                  m.role === 'user'
                    ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white'
                    : 'bg-muted/60',
                )}>
                  {m.role === 'assistant' ? (
                    <>
                      {Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && (
                        <div className="mb-2">
                          <button
                            type="button"
                            onClick={() => setOpenTools(openTools === m.id ? null : m.id)}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Database className="h-3 w-3" />
                            {m.toolCalls.length} veri sorgusu
                            <ChevronDown className={cn('h-3 w-3 transition-transform', openTools === m.id && 'rotate-180')} />
                          </button>
                          {openTools === m.id && (
                            <div className="mt-1.5 space-y-1">
                              {m.toolCalls.map((t, i) => (
                                <div key={i} className="rounded bg-background/60 border px-2 py-1 text-[10px] font-mono">
                                  <span className="font-bold">{t.name}</span>
                                  <span className="text-muted-foreground"> {JSON.stringify(t.input).slice(0, 120)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                        // Asistan cikti akisina tool sonuclari uzerinden DIS metin
                        // (Reddit snippet, magaza yorumu) girer — marked raw HTML'i
                        // aynen gecirir, o yuzden sink'te DOMPurify sart (stored XSS).
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content, { async: false }) as string) }}
                      />
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-muted/60 px-4 py-2.5 text-sm flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Veriler inceleniyor…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </CardContent>
        </Card>
      )}

      {/* Girdi */}
      <Card>
        <CardContent className="p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); send({ message: input }); }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={emptyState ? 'Ne istersen sor… (ör. "Bu hafta görünürlüğüm neden düştü?")' : 'Devam et…'}
              className="flex-1 bg-transparent outline-none text-sm px-2 py-2"
              disabled={sending}
            />
            <Button type="submit" size="sm" disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Skill kataloğu */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> RanksUp Skills
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-2.5">
          {skills.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={sending}
              onClick={() => {
                if (s.needsInput && !input.trim()) {
                  toast.info(s.inputPlaceholder ?? 'Önce yukarıya girdini yaz, sonra tekrar tıkla');
                  return;
                }
                send({ skill: s.key, message: input });
              }}
              className="text-left rounded-lg border bg-card hover:border-brand/50 transition-colors p-3.5 space-y-1 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{s.name}</span>
                <Badge variant="outline" className={cn('text-[9px]', TAG_CLS[s.tag] ?? '')}>{s.tag}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Wrench className="h-3 w-3" /> Erişir: {s.accesses.join(' · ')}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
