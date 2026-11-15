'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { notificationPanelPlacement, samePlacement, triggerHidden, unreadBadge, type PanelPlacement } from '@/lib/notification-panel';

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

/**
 * Kenar cubugunun altindaki bildirim zili.
 *
 * Liste sayfa govdesine (portal) cizilir ve zilin USTUNDE acilir (lib/notification-panel.ts):
 * zil ekranin en altinda oldugu icin eski "zilin altina ac" hali listeyi ekran disina atiyordu.
 * Zile dusenler: makale hazir, rapor, deneme ve odeme olaylari (api email/panel-notification.ts),
 * haftalik plan, video, AI gorunurluk degisikligi, tarayici uyarilari.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [yer, setYer] = useState<PanelPlacement | null>(null);
  const dugmeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        api.listNotifications({ limit: 20 }),
        api.notificationsUnreadCount(),
      ]);
      setItems(list ?? []);
      setUnread(count ?? 0);
    } catch { /* ignore — auth/network */ }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * Listeyi zile gore yerlestirir. Zil GORUNMUYORSA (telefonda cekmece kapandi, pencere
   * daralinca kenar cubugu gizlendi) liste kapanir: tetikleyicisi olmayan bir liste ekranda
   * asili kalmaz.
   */
  const yerlestir = useCallback(() => {
    const d = dugmeRef.current;
    if (!d) return;
    const r = d.getBoundingClientRect();
    const pencere = { width: window.innerWidth, height: window.innerHeight };
    if (d.closest('[inert]') || triggerHidden(r, pencere)) { setOpen(false); return; }
    const yeni = notificationPanelPlacement({ left: r.left, right: r.right, top: r.top }, pencere);
    // Ayni yer: durum degismez (her kaydirma olayinda yirmi satiri yeniden cizmemek icin)
    setYer((onceki) => (samePlacement(onceki, yeni) ? onceki : yeni));
  }, []);

  const kapat = useCallback((odakla = false) => {
    setOpen(false);
    if (odakla) dugmeRef.current?.focus();
  }, []);

  const ac = () => {
    if (open) { kapat(); return; }
    yerlestir();
    setOpen(true);
    // Acilirken tazele: dakikalik yoklamayi beklemeden guncel liste
    void refresh();
  };

  // Sayfa degisince kapanir (klavyeyle gezinirken disari tiklama olayi olusmaz)
  useEffect(() => { setOpen(false); }, [pathname]);

  // Acilinca odak listeye gecer: liste govdenin sonuna cizildigi icin Tab ile ulasmak butun
  // sayfayi dolasmayi gerektirirdi. Escape odagi zile geri verir.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Disari basma, Escape ve pencere / kenar cubugu hareketi. Liste portalda oldugu icin
  // "disarisi" hem dugmenin hem listenin disidir. `pointerdown`: dokunmatik ekranda `mousedown`
  // tiklanamayan alana dokununca olusmayabilir.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (dugmeRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      kapat();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') kapat(true); };
    // Listenin KENDI kaydirmasi zilin yerini degistirmez
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) yerlestir(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', yerlestir);
    // Kenar cubugu kayarsa zil yer degistirir (yakalama asamasi: ic kaydirmalari da duyar)
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', yerlestir);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, kapat, yerlestir]);

  const markRead = async (id: string) => {
    // Zaten okunmus satirda istek de sayac da degismez (rozet oldugundan az gorunmesin)
    const hedef = items.find(n => n.id === id);
    if (!hedef || hedef.readAt) return;
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
    const silinen = items.find(n => n.id === id);
    try {
      await api.deleteNotification(id);
      setItems(prev => prev.filter(n => n.id !== id));
      // Okunmamis bir bildirim silindiyse rozet de azalir
      if (silinen && !silinen.readAt) setUnread(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const rozet = unreadBadge(unread);

  return (
    <>
      <button
        ref={dugmeRef}
        type="button"
        onClick={ac}
        className="relative grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-sidebar-hover hover:text-foreground"
        aria-label={rozet ? `Bildirimler, ${rozet} okunmamış` : 'Bildirimler'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {rozet && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-brand text-black text-[10px] font-medium grid place-items-center">
            {rozet}
          </span>
        )}
      </button>

      {open && yer && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Bildirimler"
          tabIndex={-1}
          style={{ left: yer.left, bottom: yer.bottom, width: yer.width, maxHeight: yer.maxHeight }}
          className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground focus:outline-none"
        >
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-medium">Bildirimler</div>
            <button
              type="button"
              onClick={readAll}
              disabled={loading || unread === 0}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <CheckCheck className="h-3 w-3" aria-hidden />
              Tümünü okundu işaretle
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Henüz bildirim yok. Makalen hazır olduğunda, raporun çıktığında ya da aboneliğinle ilgili bir gelişme olduğunda burada görürsün.
              </div>
            ) : items.map(n => (
              <div key={n.id} className={`group border-b px-3 py-2 text-sm last:border-b-0 ${n.readAt ? 'opacity-60' : 'bg-foreground/[0.04]'}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {n.link ? (
                      <Link href={n.link} onClick={() => { void markRead(n.id); kapat(); }} className="font-medium hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <div className="font-medium">{n.title}</div>
                    )}
                    {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {/* Dokunmatik ekranda uzerine gelme yok: dugmeler odakla da gorunur */}
                  <div className="flex flex-col gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {!n.readAt && (
                      <button type="button" onClick={() => markRead(n.id)} className="hover:text-brand" title="Okundu işaretle" aria-label="Okundu işaretle">
                        <Check className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                    <button type="button" onClick={() => remove(n.id)} className="hover:text-danger" title="Sil" aria-label="Bildirimi sil">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
