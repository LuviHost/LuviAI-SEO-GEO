/**
 * Site ici rotalarin TEK kaynagi.
 *
 * NEDEN: eski `/sites/:id?tab=X#hash` baglantilari once genel bakisi
 * render edip sonra yonlendiriyordu; hash dusuyordu ve harita eskidigi icin
 * bazilari yanlis sayfaya gidiyordu ("Yayin hedefi ekle" → Baglantilar,
 * "AI testini calistir" → Site Skoru). Yeni baglanti eklerken buradan al.
 */
export const SITE_ROUTES = {
  overview: '',
  chat: '/chat',
  actionPlan: '/action-plan',
  audit: '/audit',
  rankTracking: '/rank-tracking',
  aso: '/aso',
  visibility: '/visibility',
  crawler: '/crawler-live',
  geoLab: '/geo-lab',
  agentReadiness: '/agent-readiness',
  productRadar: '/product-radar',
  competitors: '/competitors',
  snippet: '/snippet',
  images: '/images',
  stuckPages: '/stuck-pages',
  opportunities: '/opportunities',
  articles: '/articles',
  communities: '/communities',
  publishTargets: '/publish-targets',
  analytics: '/analytics',
  ads: '/ads',
  adsHealth: '/ads-health',
  report: '/report',
  autopilot: '/autopilot',
  connections: '/connections',
  settings: '/settings',
} as const;

export type SiteRoute = keyof typeof SITE_ROUTES;

export function siteHref(siteId: string, route: SiteRoute, hash?: string): string {
  return `/sites/${siteId}${SITE_ROUTES[route]}${hash ? `#${hash}` : ''}`;
}
