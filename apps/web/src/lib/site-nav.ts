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
  ClipboardList,
  CreditCard,
  FileBarChart,
  FileText,
  Home,
  Image as ImageIcon,
  Lightbulb,
  LineChart,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Network,
  Plug,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wrench,
  Zap,
  PenLine,
} from 'lucide-react';
import type { PlanFeature } from '@/lib/entitlements';
import { siteHref, type SiteRoute } from '@/lib/site-routes';

export type SiteNavGroupId = 'main' | 'health' | 'ai' | 'content' | 'growth' | 'mobile' | 'admin';

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
  { route: 'actionPlan', label: 'Aksiyon Planı', icon: ClipboardList, group: 'main', hint: 'Tüm modüllerden iş listesi', keywords: ['aksiyon', 'action', 'plan', 'todo', 'görev', 'yapılacak'] },
  { route: 'chat', label: 'Asistan', icon: MessageSquare, group: 'main', hint: 'Verinin üstünde konuşan asistan', keywords: ['chat', 'asistan', 'skill', 'sor', 'soru'] },

  // ── Saglik ──
  { route: 'audit', label: 'Site Skoru', icon: ShieldCheck, group: 'health', hint: 'SEO + GEO 14 kontrol', keywords: ['seo', 'audit', 'skor', 'tarama', 'denetim'] },
  { route: 'rankTracking', label: 'Sıralama Takibi', icon: LineChart, group: 'health', hint: 'Anahtar kelime pozisyonları', keywords: ['rank', 'tracking', 'sıralama', 'pozisyon', 'anahtar kelime', 'keyword'] },
  { route: 'snippet', label: 'Sayfa SEO İyileştir', icon: PenLine, group: 'health', hint: 'Başlık, meta ve SSS üret + uygula', keywords: ['snippet', 'meta', 'title', 'on-page', 'seo', 'sayfa', 'faq', 'şema'] },
  { route: 'images', label: 'Görsel Alt Metinleri', icon: ImageIcon, group: 'health', hint: 'Eksik alt metne görerek öneri + onay', keywords: ['alt', 'görsel', 'resim', 'image', 'erişilebilirlik', 'google görseller'] },
  { route: 'stuckPages', label: 'Takılı Sayfalar', icon: Wrench, group: 'health', feature: 'stuckPages', hint: 'İlk sayfada olup ilk 3’e giremeyenler', keywords: ['stuck', 'takılı', 'sayfa', 'pozisyon', 'kurtar'] },
  { route: 'competitors', label: 'Rakipler', icon: Network, group: 'health', hint: 'Rakip karşılaştırması', keywords: ['competitor', 'rakip'] },

  // ── AI gorunurluk ──
  { route: 'visibility', label: 'AI Görünürlük', icon: Sparkles, group: 'ai', hint: 'AI asistanlarda atıf takibi', keywords: ['ai', 'citation', 'atıf', 'görünürlük', 'chatgpt', 'gemini'] },
  { route: 'geoLab', label: 'GEO Lab', icon: Award, group: 'ai', hint: '6 sütunlu AI arama optimizasyonu', keywords: ['geo', 'pillar', 'optimization', 'lab'] },
  { route: 'crawler', label: 'Canlı Tarayıcı', icon: Activity, group: 'ai', hint: 'Anlık AI bot ziyaretleri', keywords: ['crawler', 'live', 'canlı', 'bot', 'gptbot', 'cite', 'tarayıcı'] },
  { route: 'agentReadiness', label: 'Ajan Hazırlığı', icon: Bot, group: 'ai', feature: 'agentReadiness', hint: 'Alan adın AI ajanlarına hazır mı', keywords: ['axo', 'agent', 'ajan', 'readiness', 'robots', 'mcp', 'a2a'] },
  { route: 'productRadar', label: 'Ürün Radarı', icon: Radar, group: 'ai', feature: 'productRadar', hint: 'AI asistanlar kategoride kimi öneriyor', keywords: ['radar', 'product', 'ürün', 'öneri', 'rakip'] },

  // ── Icerik ──
  { route: 'opportunities', label: 'İçerik Fırsatları', icon: Lightbulb, group: 'content', feature: 'contentOpportunities', hint: 'Kaybedilen sorgu → içerik → yeniden ölçüm', keywords: ['fırsat', 'opportunity', 'kayıp', 'lost', 'içerik'] },
  { route: 'articles', label: 'İçerikler', icon: FileText, group: 'content', hint: 'Önerilen konular + üretilen yazılar', keywords: ['article', 'makale', 'yazı', 'topic', 'konu', 'takvim', 'içerik'] },
  { route: 'videos', label: 'Videolar', icon: Clapperboard, group: 'content', feature: 'articleVideo', hint: 'RanksUp Video — makale, site ve ürün tanıtım videoları', keywords: ['video', 'reels', 'shorts', 'tiktok', 'dikey', 'yatay', 'ranksup video', 'kısa video', 'tanıtım videosu', 'site tanıtımı', 'ürün tanıtımı'] },
  { route: 'communities', label: 'Topluluk Ajanı', icon: MessagesSquare, group: 'content', hint: 'Reddit/Quora fırsatları + AI taslaklar', keywords: ['reddit', 'quora', 'topluluk', 'community', 'forum'] },
  { route: 'publishTargets', label: 'Yayın Hedefleri', icon: Send, group: 'content', hint: 'WordPress, FTP, SFTP', keywords: ['wordpress', 'ftp', 'sftp', 'wp', 'publish', 'yayın', 'hedef'] },

  // ── Buyume ──
  { route: 'analytics', label: 'Analitik', icon: BarChart3, group: 'growth', hint: 'Search Console + GA4', keywords: ['analytics', 'analitik', 'gsc', 'ga4', 'trafik'] },
  { route: 'ads', label: 'Reklam', icon: TrendingUp, group: 'growth', hint: 'Google + Meta reklam yönetimi', keywords: ['ads', 'reklam', 'google', 'meta', 'roas'] },
  { route: 'googleIsletme', label: 'Google İşletme', icon: MapPin, group: 'growth', hint: 'Haritalar profili denetimi, yorumlar ve gönderiler', keywords: ['google maps', 'harita', 'haritalar', 'yorum', 'işletme profili', 'gbp', 'google business', 'yerel', 'local'] },
  { route: 'adsHealth', label: 'Kampanya Skoru', icon: Target, group: 'growth', hint: 'Reklam hesabı sağlık kontrolü', keywords: ['ads', 'health', 'kampanya', 'skor', 'reklam'] },
  { route: 'report', label: 'Rapor', icon: FileBarChart, group: 'growth', hint: 'Performans özeti ve müşteri raporu', keywords: ['report', 'rapor', 'pdf', 'müşteri raporu', 'site raporu', 'paylaş'] },

  // ── Mobil ──
  { route: 'aso', label: 'ASO', icon: Smartphone, group: 'mobile', hint: 'App Store optimizasyonu', keywords: ['aso', 'app', 'uygulama', 'mobil', 'app store', 'play'] },

  // ── Yonetim ──
  { route: 'autopilot', label: 'Otomatik Akış', icon: Zap, group: 'admin', hint: 'Yarı / tam otomatik yayın', keywords: ['autopilot', 'otomatik', 'akış'] },
  { route: 'connections', label: 'Bağlantılar', icon: Plug, group: 'admin', hint: 'Search Console, GA4, AI anahtarları', keywords: ['connection', 'bağlantı', 'gsc', 'ga4', 'entegrasyon'] },
  { route: 'settings', label: 'Ayarlar', icon: Settings, group: 'admin', hint: 'Site ayarları', keywords: ['settings', 'ayar'] },
];

export type ResolvedNavItem = SiteNavItem & { href: string };

/** Kenar cubugu icin: gruplar sirasinda, href'leri cozulmus */
export function siteNavGroups(siteId: string): Array<{ id: SiteNavGroupId; label?: string; items: ResolvedNavItem[] }> {
  return SITE_NAV_GROUPS.map((g) => ({
    ...g,
    items: SITE_NAV_ITEMS.filter((i) => i.group === g.id).map((i) => ({ ...i, href: siteHref(siteId, i.route) })),
  }));
}

/** Bir oge gecerli yolda aktif mi (exact: yalniz tam esleme) */
export function isNavActive(path: string, href: string, exact?: boolean): boolean {
  return exact ? path === href : path === href || path.startsWith(href + '/');
}

/** Site disi (hesap) navigasyonu */
export const GLOBAL_NAV: Array<{ href: string; label: string; icon: LucideIcon; keywords?: string[] }> = [
  { href: '/dashboard', label: 'Sitelerim', icon: Home, keywords: ['dashboard', 'sitelerim', 'home', 'panel'] },
  { href: '/billing', label: 'Abonelik', icon: CreditCard, keywords: ['billing', 'abonelik', 'plan', 'pricing', 'fatura'] },
  { href: '/affiliate', label: 'Ortaklık Programı', icon: Users, keywords: ['affiliate', 'referans', 'partner', 'ortaklık'] },
];
