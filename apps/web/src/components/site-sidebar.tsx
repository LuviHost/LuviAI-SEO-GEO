'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BrandWordmark } from '@/components/brand-logo';
import { Check, ChevronDown, ChevronsUpDown, LayoutGrid, Lock, Plus } from 'lucide-react';
import { SiteFavicon } from '@/components/site-favicon';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { GLOBAL_NAV, isNavActive, siteNavGroups, type ResolvedNavItem } from '@/lib/site-nav';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * SiteSidebar — baglama duyarli navigasyon.
 *
 *   1) /dashboard, /billing, /affiliate, /onboarding → hesap navigasyonu
 *   2) /sites/[id]/... → site degistirici + gruplu site navigasyonu
 *
 * Ogeler lib/site-nav.ts'ten gelir (komut paleti ile ORTAK kaynak).
 *
 * KILITLI OGELER NEDEN GIZLENMIYOR: gizlemek ozelligin VARLIGINI da gizler,
 * musteri yukseltmek icin bir sebep hic gormez ve menu plana gore kisalip
 * uzar. Kilitli gostermek sebebi ve yukseltme yolunu ayni yerde birakir;
 * link acik kalir, sayfa kendi icinde PlanLockedCard basar.
 */

type SiteOption = { id: string; name: string; url: string };

const COLLAPSE_KEY = 'luviai_sidebar_collapsed';

// Vitrin dili (12.11.2026): secili satir turuncu dolgu DEGIL — notr zemin + parlak metin,
// turuncu yalniz ikonda (vitrin seritlerindeki kucuk turuncu kare gibi tek vurgu).
const linkBase =
  'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-filter transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const linkActive = 'bg-sidebar-hover text-sidebar-foreground [&>svg]:text-brand';
const linkIdle = 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground';

export function SiteSidebar({ onClose }: { onClose?: () => void }) {
  const path = usePathname();
  const params = useParams();

  const siteId = (params?.id as string) || null;
  const inSiteContext = !!siteId && path.startsWith('/sites/');

  if (!inSiteContext) {
    return (
      <>
        <div className="p-5">
          <Link href="/dashboard" className="inline-flex items-center" aria-label="RanksUp — Sitelerim">
            <span className="dark:hidden"><BrandWordmark size={22} accent="hsl(var(--brand-vivid))" /></span>
            <span className="hidden dark:inline"><BrandWordmark size={22} reversed accent="hsl(var(--brand-vivid))" /></span>
          </Link>
        </div>
        <nav aria-label="Hesap" className="space-y-0.5 px-3">
          {GLOBAL_NAV.map((item) => {
            const active = isNavActive(path, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as any}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={cn(linkBase, 'py-2 text-sm', active ? linkActive : linkIdle)}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/onboarding?new=1"
            onClick={onClose}
            className={cn(linkBase, 'py-2 text-sm', isNavActive(path, '/onboarding') ? linkActive : linkIdle)}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            Yeni site ekle
          </Link>
        </nav>
      </>
    );
  }

  return <SiteNav siteId={siteId!} path={path} onClose={onClose} />;
}

function SiteNav({ siteId, path, onClose }: { siteId: string; path: string; onClose?: () => void }) {
  const { can } = useEntitlements();
  const groups = useMemo(() => siteNavGroups(siteId), [siteId]);

  // Daraltilabilir gruplar — tercih localStorage'da kalir
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_KEY);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch { /* noop */ }
  }, []);
  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <>
      <div className="space-y-3 p-4">
        <Link href="/dashboard" className="inline-flex items-center" aria-label="RanksUp — Sitelerim">
          <span className="dark:hidden"><BrandWordmark size={19} accent="hsl(var(--brand-vivid))" /></span>
          <span className="hidden dark:inline"><BrandWordmark size={19} reversed accent="hsl(var(--brand-vivid))" /></span>
        </Link>
        <SiteSwitcher siteId={siteId} path={path} onClose={onClose} />
      </div>

      <nav aria-label="Site menüsü" className="space-y-5 px-3 pb-6">
        {groups.map((group) => {
          const hasActive = group.items.some((item) => isNavActive(path, item.href, item.exact));
          // Aktif sayfa bu gruptaysa grup daraltilmis olsa bile acik kalir
          const expanded = !group.label || !collapsed[group.id] || hasActive;
          const listId = `nav-group-${group.id}`;
          return (
            <div key={group.id}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={expanded}
                  aria-controls={listId}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-1 font-mono text-vitrin-rail text-sidebar-muted transition-colors duration-200 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')}
                    aria-hidden
                  />
                </button>
              )}
              <ul id={listId} hidden={!expanded} className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} path={path} locked={!!item.feature && can(item.feature) === false} onClose={onClose} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}

function NavLink({
  item, path, locked, onClose,
}: {
  item: ResolvedNavItem;
  path: string;
  /** Yalniz KESIN kapaliysa kilitle — haklar yuklenmediyse can() null doner, flicker olmaz */
  locked: boolean;
  onClose?: () => void;
}) {
  const active = isNavActive(path, item.href, item.exact);
  const Icon = item.icon;
  return (
    <Link
      href={item.href as any}
      onClick={onClose}
      aria-current={active ? 'page' : undefined}
      title={locked ? `${item.label} — planını yükselt` : undefined}
      className={cn(
        linkBase,
        active ? linkActive : locked ? 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground/80' : linkIdle,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
      {locked && (
        <>
          <Lock className="ml-auto h-3 w-3 shrink-0 opacity-70" aria-hidden />
          <span className="sr-only">(planını yükselt)</span>
        </>
      )}
    </Link>
  );
}

function SiteSwitcher({ siteId, path, onClose }: { siteId: string; path: string; onClose?: () => void }) {
  const router = useRouter();
  const [sites, setSites] = useState<SiteOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listSites()
      .then((rows) => { if (!cancelled) setSites(rows.map((s: any) => ({ id: s.id, name: s.name, url: s.url }))); })
      .catch(() => { if (!cancelled) setSites([]); });
    return () => { cancelled = true; };
  }, []);

  const currentSite = sites?.find((s) => s.id === siteId) ?? null;
  const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md border border-sidebar-border px-3 py-2.5 text-left transition-colors duration-200 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-foreground/50"
        aria-label={currentSite ? `Site değiştir — şu an ${currentSite.name}` : 'Site değiştir'}
      >
        <SiteFavicon url={currentSite?.url} name={currentSite?.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-sidebar-foreground">
            {currentSite?.name ?? 'Yükleniyor…'}
          </span>
          {currentSite?.url && (
            <span className="block truncate font-mono text-vitrin-rail text-sidebar-muted">{host(currentSite.url)}</span>
          )}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-[14rem]">
        <div className="max-h-64 overflow-y-auto">
          {sites === null && <p className="px-2 py-1.5 text-label text-muted-foreground">Yükleniyor…</p>}
          {sites?.length === 0 && <p className="px-2 py-1.5 text-label text-muted-foreground">Başka site yok</p>}
          {sites?.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                // Ayni alt sayfayi yeni sitede ac (/sites/eski/audit → /sites/yeni/audit)
                const subpath = path.replace(`/sites/${siteId}`, '');
                onClose?.();
                router.push(`/sites/${s.id}${subpath}` as any);
              }}
            >
              <SiteFavicon url={s.url} name={s.name} size="sm" className="h-6 w-6 rounded" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-label text-muted-foreground">{host(s.url)}</span>
              </span>
              {s.id === siteId && <Check className="shrink-0 text-brand" aria-label="Seçili" />}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard" onClick={onClose}>
            <LayoutGrid aria-hidden /> Tüm sitelerim
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1" onClick={onClose} className="text-brand">
            <Plus aria-hidden /> Yeni site ekle
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
