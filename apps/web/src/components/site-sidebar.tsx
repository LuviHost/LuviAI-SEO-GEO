'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Home,
  Plus,
  CreditCard,
  Users as UsersIcon,
  ChevronDown,
  Globe,
  ShieldCheck,
  Sparkles,
  Network,
  TrendingUp,
  Award,
  FileText,
  Calendar,
  Film,
  Send,
  BarChart3,
  Zap,
  FileBarChart,
  Settings as SettingsIcon,
  Plug,
  Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { UserMenu } from '@/components/user-menu';
import { cn } from '@/lib/utils';

/**
 * SiteSidebar — context-aware navigation.
 *
 * 3 mod:
 *   1) /dashboard, /billing, /affiliate, /onboarding → global nav
 *   2) /sites/[id]/... → site switcher (top) + 3 product groups (sidebar)
 *
 * 3 ürün grubu (Cloudflare/Shopify pattern):
 *   - SEO HEALTH (audit, AI görünürlük, GEO, rakipler, snippet)
 *   - CONTENT STUDIO (konular, makaleler, takvim, video, yayın hedefleri)
 *   - GROWTH (analytics, ads, raporlar)
 *   - + Ayarlar / Otomatik Akış / Bağlantılar
 */

type SiteOption = { id: string; name: string; url: string };

const GLOBAL_NAV = [
  { href: '/dashboard', label: 'Sitelerim', icon: Home },
  { href: '/onboarding', label: 'Yeni Site', icon: Plus },
  { href: '/billing', label: 'Abonelik', icon: CreditCard },
  { href: '/affiliate', label: 'Affiliate', icon: UsersIcon },
];

const SITE_GROUPS = (siteId: string) => [
  {
    id: 'overview',
    items: [
      { href: `/sites/${siteId}`, label: 'Genel Bakış', icon: Home, exact: true },
    ],
  },
  {
    id: 'seo',
    label: 'SEO HEALTH',
    items: [
      { href: `/sites/${siteId}/audit`, label: 'Site Skoru', icon: ShieldCheck },
      { href: `/sites/${siteId}/visibility`, label: 'AI Görünürlük', icon: Sparkles },
      { href: `/sites/${siteId}/geo-lab`, label: 'GEO Lab', icon: Award },
      { href: `/sites/${siteId}/competitors`, label: 'Rakipler', icon: Network },
      { href: `/sites/${siteId}/snippet`, label: 'Snippet Üretici', icon: FileText },
    ],
  },
  {
    id: 'content',
    label: 'CONTENT STUDIO',
    items: [
      { href: `/sites/${siteId}/topics`, label: 'Önerilen Konular', icon: Sparkles },
      { href: `/sites/${siteId}/articles`, label: 'Makaleler', icon: FileText },
      { href: `/sites/${siteId}/calendar`, label: 'Takvim', icon: Calendar },
      { href: `/sites/${siteId}/videos`, label: 'Video Factory', icon: Film },
      { href: `/sites/${siteId}/publish-targets`, label: 'Yayın Hedefleri', icon: Send },
    ],
  },
  {
    id: 'growth',
    label: 'GROWTH',
    items: [
      { href: `/sites/${siteId}/analytics`, label: 'Analytics', icon: BarChart3 },
      { href: `/sites/${siteId}/ads`, label: 'Reklam', icon: TrendingUp },
      { href: `/sites/${siteId}/report`, label: 'Rapor', icon: FileBarChart },
    ],
  },
  {
    id: 'config',
    label: 'YÖNETİM',
    items: [
      { href: `/sites/${siteId}/autopilot`, label: 'Otomatik Akış', icon: Zap },
      { href: `/sites/${siteId}/connections`, label: 'Bağlantılar', icon: Plug },
      { href: `/sites/${siteId}/settings`, label: 'Ayarlar', icon: SettingsIcon },
    ],
  },
];

export function SiteSidebar({ onClose }: { onClose?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const params = useParams();

  const siteId = (params?.id as string) || null;
  const inSiteContext = !!siteId && path.startsWith('/sites/');

  // Site list for switcher (only fetched when in site context)
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inSiteContext || sites !== null) return;
    api.listSites()
      .then((rows) => setSites(rows.map((s: any) => ({ id: s.id, name: s.name, url: s.url }))))
      .catch(() => setSites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSiteContext]);

  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [switcherOpen]);

  const currentSite = useMemo(
    () => sites?.find((s) => s.id === siteId) ?? null,
    [sites, siteId],
  );

  if (!inSiteContext) {
    return (
      <>
        <div className="p-6">
          <Link href="/" className="text-2xl font-bold text-white">LuviAI</Link>
          <div className="text-xs text-slate-500 mt-1">v0.7 Faz 2 Beta</div>
        </div>
        <nav className="px-3 space-y-1">
          {GLOBAL_NAV.map((item) => {
            const active = path === item.href || path.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as any}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </>
    );
  }

  // Site context — switcher + grouped nav
  const groups = SITE_GROUPS(siteId!);

  return (
    <>
      <div className="p-4">
        <Link href="/dashboard" className="text-base font-bold text-white inline-flex items-center gap-2 mb-3">
          <span>LuviAI</span>
          <span className="text-[9px] uppercase tracking-widest text-slate-500 font-mono">Site</span>
        </Link>

        {/* Site Switcher */}
        <div ref={switcherRef} className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className={cn(
              'w-full text-left rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 transition-colors px-3 py-2.5 flex items-center gap-2',
              switcherOpen && 'ring-2 ring-brand/40',
            )}
          >
            <Globe className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-100 truncate">
                {currentSite?.name ?? 'Yükleniyor…'}
              </div>
              {currentSite?.url && (
                <div className="text-[10px] text-slate-500 truncate">
                  {currentSite.url.replace(/^https?:\/\//, '')}
                </div>
              )}
            </div>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-slate-500 transition-transform',
                switcherOpen && 'rotate-180',
              )}
            />
          </button>

          {switcherOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-lg border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
              <div className="p-2 max-h-64 overflow-y-auto">
                {sites === null && (
                  <div className="text-xs text-slate-500 px-3 py-2">Yükleniyor…</div>
                )}
                {sites?.length === 0 && (
                  <div className="text-xs text-slate-500 px-3 py-2">Site yok</div>
                )}
                {sites?.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      // Aynı subpath'i yeni site'a uygula (e.g. /sites/old/audit → /sites/new/audit)
                      const subpath = path.replace(`/sites/${siteId}`, '');
                      router.push(`/sites/${s.id}${subpath}` as any);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md hover:bg-slate-800 transition-colors flex items-center gap-2',
                      s.id === siteId && 'bg-slate-800',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {s.url.replace(/^https?:\/\//, '')}
                      </div>
                    </div>
                    {s.id === siteId && <Check className="h-3.5 w-3.5 text-brand shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-800 p-2 space-y-1">
                <Link
                  href="/dashboard"
                  onClick={() => setSwitcherOpen(false)}
                  className="block w-full text-center text-xs text-slate-300 hover:text-white px-3 py-2 rounded-md hover:bg-slate-800 transition-colors"
                >
                  Tüm sitelerim →
                </Link>
                <Link
                  href="/onboarding"
                  onClick={() => setSwitcherOpen(false)}
                  className="block w-full text-center text-xs text-brand hover:text-white px-3 py-2 rounded-md hover:bg-brand/30 transition-colors font-semibold"
                >
                  + Yeni Site Ekle
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grouped nav */}
      <nav className="px-3 pb-6 space-y-4">
        {groups.map((group) => (
          <div key={group.id}>
            {group.label && (
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item: any) => {
                const active = item.exact
                  ? path === item.href
                  : path === item.href || path.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href as any}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors',
                      active
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
