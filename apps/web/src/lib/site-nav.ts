/**
 * Site ici navigasyonun TEK kaynagi — kenar cubugu (site-sidebar) ve komut
 * paleti (command-palette) ikisi de buradan uretilir.
 *
 * NEDEN: palet kendi kopyasini tutuyordu ve kaymisti (Siralama Takibi, ASO,
 * Kampanya Skoru, Takili Sayfalar palette yoktu; etiketler yari Ingilizceydi).
 * Yeni sayfa eklerken YALNIZ buraya ekle; rota `SITE_ROUTES`'tan gelir.
 *
 * Gruplar en fazla 6 oge — 12 ogelik "SEO HEALTH" gibi duvarlar tarama
 * yapilamiyordu.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Award,
  BarChart3,
  Bot,
  Clapperboard,
  Code2,
  CreditCard,
  FileBarChart,
  FileText,
  Home,
  Image as ImageIcon,
  Lightbulb,
  LineChart,
  MessageSquare,
  MessagesSquare,
  Network,
  Plug,
  Radar,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Type,
  Users,
  Wrench,
  PenLine,
  Zap,
} from 'lucide-react';
import type { PlanFeature } from '@/lib/entitlements';
// Goreli yol: lib testleri (site-nav.spec.mts) '@/' takma adini cozmez
import { siteHref, type SiteRoute } from './site-routes';

export type SiteNavGroupId = 'main' | 'health' | 'ai' | 'content' | 'growth' | 'mobile' | 'admin';

export type SiteRoofId = 'pageSeo' | 'bots' | 'content' | 'settings';

export type SiteRoofTab = {
  route: SiteRoute;
  /** Sayfanin ustundeki sekme kartinda gorunen ad */
  label: string;
  /** Sekme kartinin ikonu */
  icon: LucideIcon;
  /** Sekme kartinda adin altindaki tek satir: sayfa ne ise yarar (kisa tut, kart dar) */
  desc: string;
  /** Komut paletindeki ad: sekme kenar cubugunda gorunmedigi icin aramada kendi adiyla bulunur */
  paletteLabel: string;
  hint?: string;
  keywords?: string[];
};

/**
 * "Cati" — ayni isin sayfalari TEK menu ogesi altinda (13.11.2026, sahip: "tek menude
 * birlestirelim, farkli yerlerde kalmis gibi oldu"). Kenar cubugunda yalniz catinin ILK
 * rotasi gorunur; uyeler sayfanin ustunde sekme seridi olur (components/site-subnav.tsx,
 * sites/[id]/layout.tsx). Rotalar DEGISMEDI: eski baglantilar ve bildirimler calisir.
 */
export const SITE_ROOFS: Record<SiteRoofId, { label: string; tabs: SiteRoofTab[] }> = {
  // 13.11.2026, sahip: "gorsel alt metinleri icin ek bir sayfaya ihtiyacimiz var mi?" — ikisi de
  // sayfadaki eksigi AI onerisiyle duzeltir. Teshis Site Skoru'nda kalir ("Alt metinlerini duzelt").
  pageSeo: {
    label: 'Sayfa SEO sayfaları',
    tabs: [
      { route: 'snippet', label: 'Başlık ve açıklama', icon: Type, desc: 'Başlık, açıklama ve şema eksikleri', paletteLabel: 'Sayfa SEO İyileştir', hint: 'Başlık, meta ve SSS üret + uygula', keywords: ['snippet', 'meta', 'title', 'on-page', 'seo', 'sayfa', 'faq', 'şema'] },
      { route: 'images', label: 'Görsel alt metinleri', icon: ImageIcon, desc: 'Eksik alt metnine öneri ve onay', paletteLabel: 'Görsel Alt Metinleri', hint: 'Eksik alt metne görerek öneri + onay', keywords: ['alt', 'görsel', 'resim', 'image', 'erişilebilirlik', 'google görseller'] },
    ],
  },
  bots: {
    label: 'Bot takibi sayfaları',
    tabs: [
      { route: 'botTakibi', label: 'Tek satır kod', icon: Code2, desc: 'AI’dan gelen ziyaretçiler ve botlar', paletteLabel: 'Bot Takibi', hint: 'AI’dan gelen ziyaretçiler ve kodu indiren botlar', keywords: ['bot', 'takip', 'tracker', 'izleme kodu', 'ziyaretçi', 'referrer', 'chatgpt'] },
      { route: 'crawler', label: 'Canlı tarayıcı', icon: Radio, desc: 'Sunucudan anlık AI bot ziyaretleri', paletteLabel: 'Canlı Tarayıcı', hint: 'Anlık AI bot ziyaretleri', keywords: ['crawler', 'live', 'canlı', 'bot', 'gptbot', 'cite', 'tarayıcı'] },
    ],
  },
  content: {
    label: 'İçerik sayfaları',
    tabs: [
      { route: 'articles', label: 'İçerikler', icon: FileText, desc: 'Önerilen konular ve yazılar', paletteLabel: 'İçerikler', hint: 'Önerilen konular + üretilen yazılar', keywords: ['article', 'makale', 'yazı', 'topic', 'konu', 'takvim', 'içerik'] },
      { route: 'opportunities', label: 'Fırsatlar', icon: Lightbulb, desc: 'Kaybedilen sorgulardan içerik fikri', paletteLabel: 'İçerik Fırsatları', hint: 'Kaybedilen sorgu → içerik → yeniden ölçüm', keywords: ['fırsat', 'opportunity', 'kayıp', 'lost', 'içerik'] },
    ],
  },
  settings: {
    label: 'Ayar sayfaları',
    tabs: [
      { route: 'settings', label: 'Site ayarları', icon: Settings, desc: 'Site adı, sektör ve dil', paletteLabel: 'Ayarlar', hint: 'Site ayarları', keywords: ['settings', 'ayar'] },
      { route: 'connections', label: 'Bağlantılar', icon: Plug, desc: 'Search Console, Analytics, AI anahtarları', paletteLabel: 'Bağlantılar', hint: 'Search Console, GA4, AI anahtarları', keywords: ['connection', 'bağlantı', 'gsc', 'ga4', 'entegrasyon'] },
      { route: 'autopilot', label: 'Otomatik akış', icon: Zap, desc: 'Yarı ya da tam otomatik yayın', paletteLabel: 'Otomatik Akış', hint: 'Yarı / tam otomatik yayın', keywords: ['autopilot', 'otomatik', 'akış'] },
    ],
  },
};

export type SiteNavItem = {
  route: SiteRoute;
  label: string;
  icon: LucideIcon;
  group: SiteNavGroupId;
  /** Komut paletinde etiketin yaninda gorunen kisa aciklama */
  hint?: string;
  /** Palet aramasi icin es anlamlilar (TR + EN) */
  keywords?: string[];
  /**
   * Plan kapisi — verilirse menude KILITLI gosterilir (gizlenmez; ayrinti
   * site-sidebar.tsx'te). Sunucudaki @RequiresPlan karsiligi dogrulanmadan
   * yazilmaz.
   */
  feature?: PlanFeature;
  /** Yalniz tam eslesmede aktif (Genel Bakis alt rotalarda yanmasin) */
  exact?: boolean;
  /** Bu oge bir catinin (SITE_ROOFS) kenar cubugundaki TEK girisi: catinin butun sayfalarinda aktif gorunur */
  roof?: SiteRoofId;
};

export const SITE_NAV_GROUPS: Array<{ id: SiteNavGroupId; label?: string }> = [
  { id: 'main' },
  { id: 'health', label: 'Sağlık' },
  { id: 'ai', label: 'AI Görünürlük' },
  { id: 'content', label: 'İçerik' },
  { id: 'growth', label: 'Büyüme' },
  { id: 'mobile', label: 'Mobil Uygulama' },
  { id: 'admin', label: 'Yönetim' },
];

export const SITE_NAV_ITEMS: SiteNavItem[] = [
  // ── Ust: her gun acilanlar ──
  { route: 'overview', label: 'Genel Bakış', icon: Home, group: 'main', exact: true, hint: 'Sıradaki adım ve özet', keywords: ['overview', 'dashboard', 'ana', 'özet'] },
  { route: 'chat', label: 'Asistan', icon: MessageSquare, group: 'main', hint: 'Verinin üstünde konuşan asistan', keywords: ['chat', 'asistan', 'skill', 'sor', 'soru'] },

  // ── Saglik ──
  { route: 'audit', label: 'Site Skoru', icon: ShieldCheck, group: 'health', hint: 'SEO + GEO 14 kontrol', keywords: ['seo', 'audit', 'skor', 'tarama', 'denetim'] },
  { route: 'rankTracking', label: 'Sıralama Takibi', icon: LineChart, group: 'health', hint: 'Anahtar kelime pozisyonları', keywords: ['rank', 'tracking', 'sıralama', 'pozisyon', 'anahtar kelime', 'keyword'] },
  { route: 'snippet', label: 'Sayfa SEO İyileştir', icon: PenLine, group: 'health', roof: 'pageSeo', hint: 'Başlık, meta, SSS ve görsel alt metinleri', keywords: ['snippet', 'meta', 'title', 'on-page', 'seo', 'sayfa', 'faq', 'şema'] },
  { route: 'stuckPages', label: 'Takılı Sayfalar', icon: Wrench, group: 'health', feature: 'stuckPages', hint: 'İlk sayfada olup ilk 3’e giremeyenler', keywords: ['stuck', 'takılı', 'sayfa', 'pozisyon', 'kurtar'] },
  { route: 'competitors', label: 'Rakipler', icon: Network, group: 'health', hint: 'Rakip karşılaştırması', keywords: ['competitor', 'rakip'] },

  // ── AI gorunurluk ──
  { route: 'visibility', label: 'AI Görünürlük', icon: Sparkles, group: 'ai', hint: 'AI asistanlarda atıf takibi', keywords: ['ai', 'citation', 'atıf', 'görünürlük', 'chatgpt', 'gemini'] },
  { route: 'geoLab', label: 'GEO Lab', icon: Award, group: 'ai', hint: '6 sütunlu AI arama optimizasyonu', keywords: ['geo', 'pillar', 'optimization', 'lab'] },
  { route: 'botTakibi', label: 'Bot Takibi', icon: Activity, group: 'ai', roof: 'bots', hint: 'AI botları ve AI’dan gelen ziyaretçiler', keywords: ['bot', 'takip', 'tracker', 'izleme kodu', 'ziyaretçi', 'referrer', 'chatgpt'] },
  { route: 'agentReadiness', label: 'Ajan Hazırlığı', icon: Bot, group: 'ai', feature: 'agentReadiness', hint: 'Alan adın AI ajanlarına hazır mı', keywords: ['axo', 'agent', 'ajan', 'readiness', 'robots', 'mcp', 'a2a'] },
  { route: 'productRadar', label: 'Ürün Radarı', icon: Radar, group: 'ai', feature: 'productRadar', hint: 'AI asistanlar kategoride kimi öneriyor', keywords: ['radar', 'product', 'ürün', 'öneri', 'rakip'] },

  // ── Icerik ──
  { route: 'articles', label: 'İçerikler', icon: FileText, group: 'content', roof: 'content', hint: 'Önerilen konular + üretilen yazılar', keywords: ['article', 'makale', 'yazı', 'topic', 'konu', 'takvim', 'içerik'] },
  { route: 'videos', label: 'Videolar', icon: Clapperboard, group: 'content', feature: 'articleVideo', hint: 'RanksUp Video — makale, site ve ürün tanıtım videoları', keywords: ['video', 'reels', 'shorts', 'tiktok', 'dikey', 'yatay', 'ranksup video', 'kısa video', 'tanıtım videosu', 'site tanıtımı', 'ürün tanıtımı'] },
  { route: 'communities', label: 'Topluluk Ajanı', icon: MessagesSquare, group: 'content', hint: 'Reddit fırsatları + AI taslaklar', keywords: ['reddit', 'quora', 'topluluk', 'community', 'forum'] },
  { route: 'publishTargets', label: 'Yayın Hedefleri', icon: Send, group: 'content', hint: 'WordPress, FTP, SFTP', keywords: ['wordpress', 'ftp', 'sftp', 'wp', 'publish', 'yayın', 'hedef'] },

  // ── Buyume ──
  { route: 'analytics', label: 'Analitik', icon: BarChart3, group: 'growth', hint: 'Search Console + GA4', keywords: ['analytics', 'analitik', 'gsc', 'ga4', 'trafik'] },
  { route: 'ads', label: 'Reklam', icon: TrendingUp, group: 'growth', hint: 'Google + Meta reklam yönetimi', keywords: ['ads', 'reklam', 'google', 'meta', 'roas'] },
  { route: 'adsHealth', label: 'Kampanya Skoru', icon: Target, group: 'growth', hint: 'Reklam hesabı sağlık kontrolü', keywords: ['ads', 'health', 'kampanya', 'skor', 'reklam'] },
  { route: 'report', label: 'Rapor', icon: FileBarChart, group: 'growth', hint: 'Performans özeti ve müşteri raporu', keywords: ['report', 'rapor', 'pdf', 'müşteri raporu', 'site raporu', 'paylaş'] },

  // ── Mobil ──
  { route: 'aso', label: 'ASO', icon: Smartphone, group: 'mobile', hint: 'App Store optimizasyonu', keywords: ['aso', 'app', 'uygulama', 'mobil', 'app store', 'play'] },

  // ── Yonetim ──
  { route: 'settings', label: 'Ayarlar', icon: Settings, group: 'admin', roof: 'settings', hint: 'Site ayarları, bağlantılar ve otomatik akış', keywords: ['settings', 'ayar'] },
];

export type ResolvedNavItem = SiteNavItem & {
  href: string;
  /** Ayni catidaki diger sayfalar: oge bu yollarda da aktif gorunur */
  alsoHrefs: string[];
};

/** Kenar cubugu icin: gruplar sirasinda, href'leri cozulmus */
export function siteNavGroups(siteId: string): Array<{ id: SiteNavGroupId; label?: string; items: ResolvedNavItem[] }> {
  return SITE_NAV_GROUPS.map((g) => ({
    ...g,
    items: SITE_NAV_ITEMS.filter((i) => i.group === g.id).map((i) => ({
      ...i,
      href: siteHref(siteId, i.route),
      alsoHrefs: i.roof
        ? SITE_ROOFS[i.roof].tabs.filter((t) => t.route !== i.route).map((t) => siteHref(siteId, t.route))
        : [],
    })),
  }));
}

/** Bir oge gecerli yolda aktif mi (exact: yalniz tam esleme) */
export function isNavActive(path: string, href: string, exact?: boolean): boolean {
  return exact ? path === href : path === href || path.startsWith(href + '/');
}

/** Kenar cubugu ogesi aktif mi: kendi yolu ya da catisindaki bir sayfa */
export function isItemActive(path: string, item: Pick<ResolvedNavItem, 'href' | 'alsoHrefs' | 'exact'>): boolean {
  return isNavActive(path, item.href, item.exact) || item.alsoHrefs.some((h) => isNavActive(path, h));
}

/**
 * Gecerli yol bir catinin sayfasiysa o catinin sekmeleri; degilse null. Yalniz TAM eslesme:
 * alt sayfalarda (makale ayrintisi gibi) sekme seridi cikmaz.
 */
export function roofTabsForPath(
  path: string,
  siteId: string,
): { label: string; tabs: Array<{ href: string; label: string; icon: LucideIcon; desc: string; active: boolean }> } | null {
  for (const roof of Object.values(SITE_ROOFS)) {
    const tabs = roof.tabs.map((t) => ({ href: siteHref(siteId, t.route), label: t.label, icon: t.icon, desc: t.desc }));
    if (!tabs.some((t) => t.href === path)) continue;
    return { label: roof.label, tabs: tabs.map((t) => ({ ...t, active: t.href === path })) };
  }
  return null;
}

export type SitePaletteItem = Pick<SiteNavItem, 'route' | 'label' | 'icon' | 'group' | 'hint' | 'keywords'>;

/** Komut paleti girisleri: menu ogeleri + catilarin kenar cubugunda gorunmeyen sayfalari */
export function sitePaletteItems(): SitePaletteItem[] {
  const out: SitePaletteItem[] = [];
  for (const item of SITE_NAV_ITEMS) {
    if (!item.roof) {
      out.push(item);
      continue;
    }
    for (const tab of SITE_ROOFS[item.roof].tabs) {
      out.push({ route: tab.route, label: tab.paletteLabel, icon: item.icon, group: item.group, hint: tab.hint, keywords: tab.keywords });
    }
  }
  return out;
}

/** Site disi (hesap) navigasyonu */
export const GLOBAL_NAV: Array<{ href: string; label: string; icon: LucideIcon; keywords?: string[] }> = [
  { href: '/dashboard', label: 'Sitelerim', icon: Home, keywords: ['dashboard', 'sitelerim', 'home', 'panel'] },
  { href: '/billing', label: 'Abonelik', icon: CreditCard, keywords: ['billing', 'abonelik', 'plan', 'pricing', 'fatura'] },
  { href: '/affiliate', label: 'Ortaklık Programı', icon: Users, keywords: ['affiliate', 'referans', 'partner', 'ortaklık'] },
];
