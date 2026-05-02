'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import {
  Search,
  ShieldCheck,
  Sparkles,
  Award,
  Network,
  FileText,
  Calendar,
  Film,
  Send,
  BarChart3,
  TrendingUp,
  FileBarChart,
  Zap,
  Plug,
  Settings as SettingsIcon,
  Home,
  Plus,
  CreditCard,
  Users as UsersIcon,
  Globe,
  CornerDownLeft,
  ArrowRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  group: 'site' | 'global' | 'action' | 'navigate';
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  href?: string;
  onSelect?: () => void;
  keywords?: string[];
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Focus after render
      setTimeout(() => inputRef.current?.focus(), 0);
      // Lazy fetch sites
      if (sites.length === 0) {
        api.listSites().then((rows) => setSites(rows)).catch(() => {});
      }
    }
  }, [open]);

  // Site-context commands (only if in site)
  const siteCmds: Cmd[] = useMemo(() => {
    if (!siteId) return [];
    return [
      { id: 'site:overview', label: 'Genel Bakış', group: 'navigate', icon: Home, href: `/sites/${siteId}`, keywords: ['overview', 'dashboard', 'ana'] },
      { id: 'site:audit', label: 'Site Skoru', hint: 'SEO + GEO 14 kontrol', group: 'navigate', icon: ShieldCheck, href: `/sites/${siteId}/audit`, keywords: ['seo', 'audit', 'skor', 'tarama'] },
      { id: 'site:visibility', label: 'AI Görünürlük', hint: 'Citation tracking', group: 'navigate', icon: Sparkles, href: `/sites/${siteId}/visibility`, keywords: ['ai', 'citation', 'görünürlük'] },
      { id: 'site:geo', label: 'GEO Lab', hint: '6 pillar AI search', group: 'navigate', icon: Award, href: `/sites/${siteId}/geo-lab`, keywords: ['geo', 'pillar', 'optimization'] },
      { id: 'site:competitors', label: 'Rakipler', group: 'navigate', icon: Network, href: `/sites/${siteId}/competitors`, keywords: ['competitor', 'rakip'] },
      { id: 'site:snippet', label: 'Snippet Üretici', group: 'navigate', icon: FileText, href: `/sites/${siteId}/snippet`, keywords: ['snippet', 'meta', 'title'] },
      { id: 'site:topics', label: 'Önerilen Konular', hint: 'AI topic engine', group: 'navigate', icon: Sparkles, href: `/sites/${siteId}/topics`, keywords: ['topic', 'konu', 'öneri'] },
      { id: 'site:articles', label: 'Makaleler', group: 'navigate', icon: FileText, href: `/sites/${siteId}/articles`, keywords: ['article', 'makale'] },
      { id: 'site:calendar', label: 'Takvim', group: 'navigate', icon: Calendar, href: `/sites/${siteId}/calendar`, keywords: ['calendar', 'takvim', 'schedule'] },
      { id: 'site:videos', label: 'Video Factory', group: 'navigate', icon: Film, href: `/sites/${siteId}/videos`, keywords: ['video', 'tiktok', 'youtube', 'reels'] },
      { id: 'site:publish-targets', label: 'Yayın Hedefleri', group: 'navigate', icon: Send, href: `/sites/${siteId}/publish-targets`, keywords: ['wordpress', 'ftp', 'wp', 'publish'] },
      { id: 'site:analytics', label: 'Analytics', hint: 'GSC + GA4', group: 'navigate', icon: BarChart3, href: `/sites/${siteId}/analytics`, keywords: ['analytics', 'gsc', 'ga4'] },
      { id: 'site:ads', label: 'Reklam', hint: 'Google + Meta autopilot', group: 'navigate', icon: TrendingUp, href: `/sites/${siteId}/ads`, keywords: ['ads', 'reklam', 'google', 'meta'] },
      { id: 'site:report', label: 'Rapor', group: 'navigate', icon: FileBarChart, href: `/sites/${siteId}/report`, keywords: ['report', 'rapor'] },
      { id: 'site:autopilot', label: 'Otomatik Akış', hint: 'Yarı / tam otomatik', group: 'navigate', icon: Zap, href: `/sites/${siteId}/autopilot`, keywords: ['autopilot', 'otomatik', 'akış'] },
      { id: 'site:connections', label: 'Bağlantılar', hint: 'GSC, GA4, Sosyal, AI keys', group: 'navigate', icon: Plug, href: `/sites/${siteId}/connections`, keywords: ['connection', 'bağlantı', 'gsc', 'ga4', 'social'] },
      { id: 'site:settings', label: 'Ayarlar', group: 'navigate', icon: SettingsIcon, href: `/sites/${siteId}/settings`, keywords: ['settings', 'ayar'] },
    ];
  }, [siteId]);

  const globalCmds: Cmd[] = useMemo(() => [
    { id: 'global:dashboard', label: 'Sitelerim', group: 'global', icon: Home, href: '/dashboard', keywords: ['dashboard', 'sitelerim', 'home'] },
    { id: 'global:onboarding', label: 'Yeni Site Ekle', group: 'global', icon: Plus, href: '/onboarding', keywords: ['new', 'yeni', 'site', 'ekle', 'onboarding'] },
    { id: 'global:billing', label: 'Abonelik', group: 'global', icon: CreditCard, href: '/billing', keywords: ['billing', 'abonelik', 'plan', 'pricing'] },
    { id: 'global:affiliate', label: 'Affiliate', group: 'global', icon: UsersIcon, href: '/affiliate', keywords: ['affiliate', 'referans', 'partner'] },
  ], []);

  // Site switcher commands (jump to same subpath under different site)
  const siteSwitchCmds: Cmd[] = useMemo(() => {
    if (!siteId) return [];
    const subpath = pathname.replace(`/sites/${siteId}`, '');
    return sites
      .filter((s) => s.id !== siteId)
      .map((s) => ({
        id: `switch:${s.id}`,
        label: s.name,
        hint: `→ ${s.url.replace(/^https?:\/\//, '')}`,
        group: 'site' as const,
        icon: Globe,
        href: `/sites/${s.id}${subpath}`,
        keywords: [s.name.toLowerCase(), s.url.toLowerCase()],
      }));
  }, [sites, siteId, pathname]);

  const allCmds = useMemo(() => [
    ...siteCmds,
    ...siteSwitchCmds,
    ...globalCmds,
  ], [siteCmds, siteSwitchCmds, globalCmds]);

  // Fuzzy filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCmds;
    return allCmds.filter((c) => {
      const haystack = [c.label, c.hint ?? '', ...(c.keywords ?? [])].join(' ').toLowerCase();
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [allCmds, query]);

  // Group filtered
  const grouped = useMemo(() => {
    const order: Cmd['group'][] = ['navigate', 'site', 'global', 'action'];
    const labels: Record<Cmd['group'], string> = {
      navigate: 'Bu sitede',
      site: 'Site değiştir',
      global: 'Genel',
      action: 'Aksiyonlar',
    };
    return order
      .map((g) => ({ group: g, label: labels[g], items: filtered.filter((c) => c.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  // Reset active idx when filtered changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
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
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, activeIdx]);

  // Scroll active into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(`[data-cmd-idx="${activeIdx}"]`) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const selectCmd = (cmd: Cmd) => {
    setOpen(false);
    if (cmd.href) {
      router.push(cmd.href as any);
    }
    cmd.onSelect?.();
  };

  if (!open) {
    return (
      // Hint badge at bottom-right (subtle)
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex fixed bottom-5 right-5 z-30 items-center gap-2 px-3 py-1.5 rounded-full bg-card/80 backdrop-blur-sm border border-border shadow-sm hover:border-brand/40 hover:shadow-md transition-all text-xs text-muted-foreground"
        aria-label="Komut paneli aç"
      >
        <Search className="h-3 w-3" />
        <span>Ara</span>
        <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
          <span>⌘</span>K
        </kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm grid place-items-start sm:place-items-center pt-[8vh] sm:pt-0 px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara: sayfa, site, aksiyon..."
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/60"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground/60 border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              "{query}" için sonuç yok.
            </div>
          ) : (
            grouped.map((g, gi) => (
              <div key={g.group} className={cn(gi > 0 && 'border-t')}>
                <div className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {g.label}
                </div>
                <div className="pb-1">
                  {g.items.map((cmd) => {
                    const idx = filtered.findIndex((c) => c.id === cmd.id);
                    const isActive = idx === activeIdx;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        data-cmd-idx={idx}
                        type="button"
                        onClick={() => selectCmd(cmd)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={cn(
                          'w-full text-left px-4 py-2 flex items-center gap-3 transition-colors',
                          isActive ? 'bg-brand/10 text-brand' : 'hover:bg-muted/50',
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-muted-foreground')} />
                        <span className="text-sm font-medium flex-1">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="text-[11px] text-muted-foreground hidden sm:inline">{cmd.hint}</span>
                        )}
                        {isActive && <CornerDownLeft className="h-3 w-3 text-brand/60" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground/70 bg-muted/20">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="border rounded px-1 py-0.5 font-mono">↑↓</kbd> gez
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="border rounded px-1 py-0.5 font-mono">↵</kbd> seç
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="border rounded px-1 py-0.5 font-mono">ESC</kbd> kapat
            </span>
          </div>
          <span className="font-mono">{filtered.length} sonuç</span>
        </div>
      </div>
    </div>
  );
}
