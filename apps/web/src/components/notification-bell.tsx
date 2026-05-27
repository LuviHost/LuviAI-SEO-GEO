'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const [list, count] = await Promise.all([
        api.listNotifications({ limit: 20 }),
        api.notificationsUnreadCount(),
      ]);
      setItems(list ?? []);
      setUnread(count ?? 0);
    } catch { /* ignore — auth/network */ }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const readAll = async () => {
    setLoading(true);
    try {
      await api.markAllNotificationsRead();
      setItems(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteNotification(id);
      setItems(prev => prev.filter(n => n.id !== id));
    } catch { /* ignore */ }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded hover:bg-slate-800 text-slate-200"
        aria-label="Bildirimler"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold grid place-items-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] overflow-hidden bg-background text-foreground rounded-lg shadow-xl border z-50 flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="text-sm font-bold">Bildirimler</div>
            <button onClick={readAll} disabled={loading || unread === 0} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1">
              <CheckCheck className="h-3 w-3" />
              Tümünü okundu işaretle
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Bildirim yok.</div>
            ) : items.map(n => (
              <div key={n.id} className={`px-3 py-2 border-b text-sm group ${n.readAt ? 'opacity-60' : 'bg-brand/5'}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {n.link ? (
                      <Link href={n.link} onClick={() => { markRead(n.id); setOpen(false); }} className="font-medium hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <div className="font-medium">{n.title}</div>
                    )}
                    {n.body && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!n.readAt && (
                      <button onClick={() => markRead(n.id)} className="hover:text-brand" title="Okundu işaretle">
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                    <button onClick={() => remove(n.id)} className="hover:text-rose-600" title="Sil">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
