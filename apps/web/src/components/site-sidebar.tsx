'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BrandWordmark } from '@/components/brand-logo';
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
  Send,
  BarChart3,
  Zap,
  FileBarChart,
  Settings as SettingsIcon,
  Plug,
  Check,
  Target,
  LineChart,
  Library,
  Smartphone,
  Lightbulb,
  Mail,
  Wrench,
  Bot,
  Radar as RadarIcon,
  MessageSquare,
  MessagesSquare,
  ClipboardList,
  Activity,
  Lock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useEntitlements, type PlanFeature } from '@/lib/entitlements';
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

/**
 * Menu ogesi — `feature` verilirse plan kapisina tabidir.
 *
 * NEDEN GIZLEMIYORUZ DA KILITLIYORUZ: gizlemek ozelligin VARLIGINI da gizler,
 * yani musteri yukseltmek icin bir sebep hic gormez ve menu plana gore
 * kisalip uzadigi icin urun eksik gorunur. Kilitli gostermek hem sebebi hem
 * de yukseltme yolunu ayni yerde birakiyor. Link acik kaliyor; sayfa kendi
 * icinde PlanLockedCard basiyor, yani tiklamanin sonu bos ekran degil teklif.
 *
 * Bir ogeye `feature` YAZMADAN once sunucudaki karsiligi dogrulandi
 * (@RequiresPlan / siteWhereForFeature). Emin olunmayan yuzeye dokunulmadi:
 * yanlis kilitlemek, kilitlememekten kotu.
 */
type NavItem = {
  href: string;
  label: string;
  icon: any;
  exact?: boolean;
  feature?: PlanFeature;
};

const GLOBAL_NAV = [
  { href: '/dashboard', label: 'Sitelerim', icon: Home },
  { href: '/billing', label: 'Abonelik', icon: CreditCard },
  { href: '/affiliate', label: 'Affiliate', icon: UsersIcon },
];

const SITE_GROUPS = (siteId: string): Array<{ id: string; label?: string; items: NavItem[] }> => [
  {
    id: 'overview',
    items: [
      { href: `/sites/${siteId}`, label: 'Genel Bakış', icon: Home, exact: true },
      { href: `/sites/${siteId}/chat`, label: 'Asistan', icon: MessageSquare },
    ],
  },
  {
    id: 'seo',
    label: 'SEO HEALTH',
    items: [
      { href: `/sites/${siteId}/audit`, label: 'Site Skoru', icon: ShieldCheck },
      { href: `/sites/${siteId}/rank-tracking`, label: 'Sıralama Takibi', icon: LineChart },
      { href: `/sites/${siteId}/aso`, label: 'ASO (Mobil App)', icon: Smartphone },
      { href: `/sites/${siteId}/visibility`, label: 'AI Görünürlük', icon: Sparkles },
      { href: `/sites/${siteId}/crawler-live`, label: 'Live Crawler', icon: Activity },
      { href: `/sites/${siteId}/geo-lab`, label: 'GEO Lab', icon: Award },
      { href: `/sites/${siteId}/agent-readiness`, label: 'Agent Readiness', icon: Bot, feature: 'agentReadiness' },
      { href: `/sites/${siteId}/product-radar`, label: 'Product Radar', icon: RadarIcon, feature: 'productRadar' },
      { href: `/sites/${siteId}/competitors`, label: 'Rakipler', icon: Network },
      { href: `/sites/${siteId}/snippet`, label: 'Sayfa SEO İyileştir', icon: FileText },
      { href: `/sites/${siteId}/stuck-pages`, label: 'Stuck Pages', icon: Wrench, feature: 'stuckPages' },
    ],
  },
  {
    id: 'content',
    label: 'CONTENT STUDIO',
    items: [
      { href: `/sites/${siteId}/opportunities`, label: 'İçerik Fırsatları', icon: Lightbulb, feature: 'contentOpportunities' },
      { href: `/sites/${siteId}/articles`, label: 'İçerikler', icon: FileText },
      { href: `/sites/${siteId}/communities`, label: 'Topluluk Ajanı', icon: MessagesSquare },
      { href: `/sites/${siteId}/publish-targets`, label: 'Yayın Hedefleri', icon: Send },
    ],
  },
  {
    id: 'growth',
    label: 'GROWTH',
    items: [
      { href: `/sites/${siteId}/action-plan`, label: 'Aksiyon Planı', icon: ClipboardList },
      { href: `/sites/${siteId}/analytics`, label: 'Analytics', icon: BarChart3 },
      { href: `/sites/${siteId}/ads`, label: 'Reklam', icon: TrendingUp },
      { href: `/sites/${siteId}/ads-health`, label: 'Kampanya Skoru', icon: Target },
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
  const { can } = useEntitlements();

  // Site list for switcher (only fetched when in site context)
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  // Collapsible groups (mobile + persistence in localStorage)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('luviai_sidebar_collapsed');
      if (saved) setCollapsed(JSON.parse(saved));
    } catch {/* noop */}
  }, []);
  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { window.localStorage.setItem('luviai_sidebar_collapsed', JSON.stringify(next)); } catch {/* noop */}
      return next;
    });
  };

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
          <Link href="/" className="inline-flex items-center">
            <span className="dark:hidden"><BrandWordmark size={26} /></span><span className="hidden dark:inline"><BrandWordmark size={26} reversed /></span>
          </Link>
          <div className="text-xs text-sidebar-muted mt-2">v0.7 Faz 2 Beta</div>
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
                    ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-md'
                    : 'text-sidebar-foreground/75 hover:bg-sidebar-hover hover:text-sidebar-foreground',
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
        <Link href="/dashboard" className="inline-flex items-center gap-2 mb-3">
          <span className="dark:hidden"><BrandWordmark size={19} /></span><span className="hidden dark:inline"><BrandWordmark size={19} reversed /></span>
          <span className="text-[9px] uppercase tracking-widest text-sidebar-muted font-mono ml-1">Site</span>
        </Link>

        {/* Site Switcher */}
        <div ref={switcherRef} className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            className={cn(
              'w-full text-left rounded-lg border border-sidebar-border bg-sidebar-hover/60 hover:bg-sidebar-hover transition-colors px-3 py-2.5 flex items-center gap-2',
              switcherOpen && 'ring-2 ring-brand/40',
            )}
          >
            <Globe className="h-4 w-4 text-sidebar-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-sidebar-foreground truncate">
                {currentSite?.name ?? 'Yükleniyor…'}
              </div>
              {currentSite?.url && (
                <div className="text-[10px] text-sidebar-muted truncate">
                  {currentSite.url.replace(/^https?:\/\//, '')}
                </div>
              )}
            </div>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-sidebar-muted transition-transform',
                switcherOpen && 'rotate-180',
              )}
            />
          </button>

          {switcherOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-lg border border-sidebar-border bg-sidebar shadow-apple-md overflow-hidden">
              <div className="p-2 max-h-64 overflow-y-auto">
                {sites === null && (
                  <div className="text-xs text-sidebar-muted px-3 py-2">Yükleniyor…</div>
                )}
                {sites?.length === 0 && (
                  <div className="text-xs text-sidebar-muted px-3 py-2">Site yok</div>
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
                      'w-full text-left px-3 py-2 rounded-md hover:bg-sidebar-hover transition-colors flex items-center gap-2',
                      s.id === siteId && 'bg-sidebar-hover',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-sidebar-foreground truncate">{s.name}</div>
                      <div className="text-[10px] text-sidebar-muted truncate">
                        {s.url.replace(/^https?:\/\//, '')}
                      </div>
                    </div>
                    {s.id === siteId && <Check className="h-3.5 w-3.5 text-brand shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-sidebar-border p-2 space-y-1">
                <Link
                  href="/dashboard"
                  onClick={() => setSwitcherOpen(false)}
                  className="block w-full text-center text-xs text-sidebar-foreground/75 hover:text-sidebar-foreground px-3 py-2 rounded-md hover:bg-sidebar-hover transition-colors"
                >
                  Tüm sitelerim →
                </Link>
                <Link
                  href="/onboarding?new=1"
                  onClick={() => setSwitcherOpen(false)}
                  className="block w-full text-center text-xs text-brand px-3 py-2 rounded-md hover:bg-brand/15 transition-colors font-semibold"
                >
                  + Yeni Site Ekle
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grouped nav — collapsible (label tıklanınca açılır/kapanır) */}
      <nav className="px-3 pb-6 space-y-3">
        {groups.map((group) => {
          const isCollapsed = group.label ? collapsed[group.id] : false;
          // Eğer aktif route bu group içindeyse otomatik aç
          const hasActive = group.items.some((item: any) =>
            item.exact ? path === item.href : path === item.href || path.startsWith(item.href + '/'),
          );
          const expanded = group.label ? !isCollapsed || hasActive : true;
          return (
            <div key={group.id}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full px-3 mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-sidebar-muted hover:text-sidebar-foreground/80 transition-colors"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 transition-transform',
                      !expanded && '-rotate-90',
                    )}
                  />
                </button>
              )}
              {expanded && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = item.exact
                      ? path === item.href
                      : path === item.href || path.startsWith(item.href + '/');
                    const Icon = item.icon;
                    // Yalnizca KESIN kapaliysa kilitle. Haklar henuz yuklenmediyse
                    // can() null doner ve menu oldugu gibi kalir — flicker olmaz.
                    const locked = !!item.feature && can(item.feature) === false;
                    return (
                      <Link
                        key={item.href}
                        href={item.href as any}
                        onClick={onClose}
                        title={locked ? `${item.label} — planını yükselt` : undefined}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors',
                          active
                            ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm'
                            : locked
                              ? 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground/80'
                              : 'text-sidebar-foreground/75 hover:bg-sidebar-hover hover:text-sidebar-foreground',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {locked && <Lock className="h-3 w-3 shrink-0 ml-auto opacity-70" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}
