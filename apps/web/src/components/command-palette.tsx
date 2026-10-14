'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { CornerDownLeft, Globe, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GLOBAL_NAV, SITE_NAV_GROUPS, SITE_NAV_ITEMS } from '@/lib/site-nav';
import { siteHref } from '@/lib/site-routes';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  group: 'navigate' | 'site' | 'global';
  /** Bu sitede: menudeki grup adi (Saglik, Icerik…) — sonuc satirinda gosterilir */
  section?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords?: string[];
};

const OPEN_EVENT = 'ranksup:command-palette';

/** Ust cubuktaki mobil arama dugmesi gibi paletin disindaki tetikleyiciler icin */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const GROUP_LABEL: Record<Cmd['group'], string> = {
  navigate: 'Bu sitede',
  site: 'Site değiştir',
  global: 'Hesap',
};

export function CommandPalette() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const siteId = (params?.id as string) || null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [sites, setSites] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Cmd+K / Ctrl+K + dis tetikleyici olayi
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Acilista sifirla + siteleri tembel yukle
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    if (sites.length === 0) {
      api.listSites().then((rows) => setSites(rows)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Site ici komutlar — kenar cubuguyla AYNI kaynak (lib/site-nav)
  const siteCmds: Cmd[] = useMemo(() => {
    if (!siteId) return [];
    const sectionOf = Object.fromEntries(SITE_NAV_GROUPS.map((g) => [g.id, g.label]));
    return SITE_NAV_ITEMS.map((item) => ({
      id: `site:${item.route}`,
      label: item.label,
      hint: item.hint,
      section: sectionOf[item.group],
      group: 'navigate' as const,
      icon: item.icon,
      href: siteHref(siteId, item.route),
      keywords: [...(item.keywords ?? []), sectionOf[item.group] ?? ''],
    }));
  }, [siteId]);

  const globalCmds: Cmd[] = useMemo(() => [
    ...GLOBAL_NAV.map((g) => ({
      id: `global:${g.href}`,
      label: g.label,
      group: 'global' as const,
      icon: g.icon,
      href: g.href,
      keywords: g.keywords,
    })),
    { id: 'global:onboarding', label: 'Yeni site ekle', group: 'global', icon: Plus, href: '/onboarding?new=1', keywords: ['new', 'yeni', 'site', 'ekle', 'onboarding'] },
  ], []);

  // Site degistir: ayni alt sayfayi baska sitede ac
  const siteSwitchCmds: Cmd[] = useMemo(() => {
    if (!siteId) return [];
    const subpath = pathname.replace(`/sites/${siteId}`, '');
    return sites
      .filter((s) => s.id !== siteId)
      .map((s) => ({
        id: `switch:${s.id}`,
        label: s.name,
        hint: s.url.replace(/^https?:\/\//, ''),
        group: 'site' as const,
        icon: Globe,
        href: `/sites/${s.id}${subpath}`,
        keywords: [s.name.toLowerCase(), s.url.toLowerCase()],
      }));
  }, [sites, siteId, pathname]);

  const allCmds = useMemo(() => [...siteCmds, ...siteSwitchCmds, ...globalCmds], [siteCmds, siteSwitchCmds, globalCmds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return allCmds;
    return allCmds.filter((c) => {
      const haystack = [c.label, c.hint ?? '', ...(c.keywords ?? [])].join(' ').toLocaleLowerCase('tr-TR');
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [allCmds, query]);

  const grouped = useMemo(() => {
    const order: Cmd['group'][] = ['navigate', 'site', 'global'];
    return order
      .map((g) => ({ group: g, label: GROUP_LABEL[g], items: filtered.filter((c) => c.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-cmd-idx="${activeIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const selectCmd = (cmd: Cmd) => {
    setOpen(false);
    router.push(cmd.href as any);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) selectCmd(cmd);
    }
  };

  const activeId = filtered[activeIdx] ? `${listId}-opt-${activeIdx}` : undefined;

  return (
    <>
      {/* Masaustu ipucu dugmesi — telefonda ust cubuktaki arama dugmesi kullanilir */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 hidden items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-label text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-brand/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:flex"
          aria-label="Komut paletini aç (⌘K)"
        >
          <Search className="h-3 w-3" aria-hidden />
          <span>Ara</span>
          <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-label">⌘K</kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="lg"
          hideClose
          className="top-[10vh] translate-y-0 overflow-hidden p-0 data-[state=open]:slide-in-from-top-2"
          onOpenAutoFocus={(e) => {
            // Radix varsayilani ilk odaklanabiliri secer; arama kutusuna odaklan
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector('input')?.focus();
          }}
        >
          <DialogTitle className="sr-only">Komut paleti</DialogTitle>
          <DialogDescription className="sr-only">
            Sayfa ya da site ara. Ok tuşlarıyla gez, Enter ile aç, Esc ile kapat.
          </DialogDescription>

          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Sayfa ya da site ara…"
              aria-label="Sayfa ya da site ara"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              className="flex-1 border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-label text-muted-foreground">Esc</kbd>
          </div>

          <div ref={listRef} id={listId} role="listbox" aria-label="Sonuçlar" className="max-h-[60vh] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                “{query}” için sonuç yok.
              </p>
            ) : (
              grouped.map((g, gi) => (
                <div key={g.group} role="group" aria-label={g.label} className={cn(gi > 0 && 'mt-1 border-t pt-1')}>
                  <div className="px-4 pb-1 pt-2 text-label text-muted-foreground">{g.label}</div>
                  {g.items.map((cmd) => {
                    const idx = filtered.indexOf(cmd);
                    const isActive = idx === activeIdx;
                    const Icon = cmd.icon;
                    return (
                      <div
                        key={cmd.id}
                        id={`${listId}-opt-${idx}`}
                        role="option"
                        aria-selected={isActive}
                        data-cmd-idx={idx}
                        onClick={() => selectCmd(cmd)}
                        onMouseMove={() => { if (!isActive) setActiveIdx(idx); }}
                        className={cn(
                          'mx-1 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors',
                          isActive ? 'bg-brand/10 text-brand-700 dark:text-brand-300' : 'text-foreground',
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-muted-foreground')} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="hidden max-w-[45%] truncate text-label text-muted-foreground sm:inline">{cmd.hint}</span>
                        )}
                        {cmd.section && (
                          <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-label text-muted-foreground md:inline">
                            {cmd.section}
                          </span>
                        )}
                        {isActive && <CornerDownLeft className="h-3 w-3 shrink-0 text-brand/60" aria-hidden />}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-label text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><kbd className="rounded border px-1 font-mono">↑↓</kbd> gez</span>
              <span className="inline-flex items-center gap-1"><kbd className="rounded border px-1 font-mono">↵</kbd> aç</span>
              <span className="inline-flex items-center gap-1"><kbd className="rounded border px-1 font-mono">Esc</kbd> kapat</span>
            </div>
            <span className="tabular-nums" aria-live="polite">{filtered.length} sonuç</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
