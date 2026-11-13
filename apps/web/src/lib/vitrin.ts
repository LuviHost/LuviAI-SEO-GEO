/**
 * Koyu vitrin: ziyaretcinin temasindan bagimsiz, notr siyah sahnede cizilen
 * herkese acik sayfalar (token'lar globals.css `.vitrin`).
 *
 * Bu liste TEK kaynaktir; iki yer okur:
 *  - theme-provider.tsx: bu yollarda koyu temayi zorlar
 *  - components/vitrin/marketing-shell.tsx: (marketing) duzeninde bu yollara
 *    koyu ust menu + kapanis + alt bilgi, digerlerine eski SiteHeader/SiteFooter
 *
 * Sayfa dosyalari (marketing) altinda KALIR: page-updated.spec, article-claims.spec
 * ve public-docs.spec dosya yoluyla okuyor; rota grubuna tasimak onlari bozar.
 *
 * BILINCLI OLARAK DISARIDA: /billing/* (odeme adimlari — PayTR cercevesi acik
 * zeminli ve akis ayri testlerle korunuyor), panel ve yonetim sayfalari.
 */
const EXACT: ReadonlySet<string> = new Set([
  '/',
  '/faq',
  '/about',
  '/pricing',
  '/compare',
  '/use-cases',
  '/bot',
  '/privacy',
  '/terms',
  '/kvkk',
  '/signin',
]);

/** Alt sayfalariyla birlikte vitrinde olan bolumler */
const PREFIXES: readonly string[] = ['/rehber', '/help'];

export function isVitrinPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (EXACT.has(pathname)) return true;
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Vitrin icerik genisligi + yan bosluk — ust menu, bolumler ve alt bilgi ayni dikey hizada */
export const VITRIN_WRAP = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';
