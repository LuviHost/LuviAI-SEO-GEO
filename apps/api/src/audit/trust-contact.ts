import * as cheerio from 'cheerio';

/**
 * Iletisim ve sorumlu kurulus — ana sayfa ve ana sayfanin bagladigi iletisim /
 * hakkimizda sayfasindan (saf; HTML'i servis ceker).
 *
 * NEDEN (24.11.2026, geo.new raporu + kirmizi takim): Google'in degerlendirici
 * kilavuzu para isleyen siteler icin "Contact information and customer service
 * information are extremely important for websites that handle money" der
 * (Search Quality Rater Guidelines 2.5.3, 11.09.2025); sayfadan kimin sorumlu
 * oldugu anlasilmali. kobipratik.com'da ana sayfada tel:/mailto: yoktu ve
 * "Hakkımızda" sayfasindaki e-posta Cloudflare'in e-posta gizlemesiyle
 * (/cdn-cgi/l/email-protection) saklaniyordu: JavaScript calistirmayan AI
 * tarayicilari adresi "[email protected]" olarak goruyor.
 *
 * Kilavuz siralamayi dogrudan belirlemez ("Search raters have no control over
 * how pages rank"); kontrol guven sinyali olarak sunulur, siralama vaadi yok.
 */

/** Para, saglik ve hukuk nisleri (niche-detector NICHES) — kontrol bunlarda puana girer */
export const YMYL_NICHES: readonly string[] = ['finans', 'sağlık', 'hukuk', 'e-ticaret'];

export function isYmylNiche(niche: string | null | undefined): boolean {
  return !!niche && YMYL_NICHES.includes(niche.trim().toLocaleLowerCase('tr'));
}

const CONTACT_PATH = /(?:^|\/)(?:iletisim|iletişim|contact(?:-us)?|bize-ulasin|bize-ulaşın)(?:[/.?#]|$)/iu;
const ABOUT_PATH = /(?:^|\/)(?:hakkimizda|hakkımızda|about(?:-us)?|kunye|künye|biz-kimiz)(?:[/.?#]|$)/iu;
const CONTACT_TEXT = /^(?:iletişim|iletisim|bize ulaşın|bize ulasin|contact(?: us)?)$/iu;
const ABOUT_TEXT = /^(?:hakkımızda|hakkimizda|about(?: us)?|künye|kunye|biz kimiz)$/iu;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Turkiye telefonu: +90 / 0 ile 10 hane ya da 444 x xxx; bosluk, nokta, tire, parantez serbest */
const PHONE_RE = /(?:\+90|\b0)[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b|\b444[\s.-]?\d[\s.-]?\d{3}\b/g;

export interface ContactSignals {
  tel: number;
  mailto: number;
  /** Gorunur metinde duz e-posta adresi */
  emailText: number;
  /** Gorunur metinde telefon numarasi */
  phoneText: number;
  /** Cloudflare e-posta gizlemesi: botlar adresi goremez */
  cfHiddenEmail: number;
  /** JSON-LD'de telephone / email / contactPoint */
  schemaContact: boolean;
}

export interface ContactLink {
  url: string;
  kind: 'contact' | 'about';
  text: string;
}

function sameSite(a: string, b: string): boolean {
  try {
    const h = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    return h(a) === h(b);
  } catch { return false; }
}

/** Ana sayfadan iletisim (oncelikli) ya da hakkimizda sayfasina giden ilk ic link */
export function findContactLink(homeHtml: string, baseUrl: string): ContactLink | null {
  const $ = cheerio.load(homeHtml);
  let about: ContactLink | null = null;
  for (const el of $('a[href]').toArray()) {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || /^(?:mailto|tel|javascript):|^#/i.test(href)) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!sameSite(abs, baseUrl)) continue;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    let path = '';
    try { path = decodeURIComponent(new URL(abs).pathname); } catch { path = new URL(abs).pathname; }
    if (CONTACT_PATH.test(path) || CONTACT_TEXT.test(text)) return { url: abs, kind: 'contact', text };
    if (!about && (ABOUT_PATH.test(path) || ABOUT_TEXT.test(text))) about = { url: abs, kind: 'about', text };
  }
  return about;
}

function jsonLdHasContact(raw: string): boolean {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return false; }
  const stack: unknown[] = [data];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    if (['telephone', 'email', 'contactPoint'].some((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')) return true;
    if (o['@graph']) stack.push(o['@graph']);
  }
  return false;
}

export function contactSignals(html: string): ContactSignals {
  const $ = cheerio.load(html);
  const schemaContact = $('script[type="application/ld+json"]').toArray()
    .some((el) => jsonLdHasContact($(el).html() ?? ''));
  const cfHiddenEmail = $('a[href*="/cdn-cgi/l/email-protection"], [data-cfemail]').length;
  const body = $('body').first().clone();
  body.find('script, style, noscript, template, svg').remove();
  // Parcalar arasina bosluk: "Telefon0850..." gibi yapismalar numarayi bozmasin
  const text = body.find('*').addBack().contents().toArray()
    .filter((n) => n.type === 'text')
    .map((n) => (n as unknown as { data: string }).data)
    .join(' ');
  return {
    tel: $('a[href^="tel:" i]').length,
    mailto: $('a[href^="mailto:" i]').length,
    emailText: (text.match(EMAIL_RE) ?? []).length,
    phoneText: (text.match(PHONE_RE) ?? []).length,
    cfHiddenEmail,
    schemaContact,
  };
}

export interface TrustContactResult {
  ok: boolean;
  link: ContactLink | null;
  /** Bagli sayfa okundu mu (link yoksa null) */
  pageRead: boolean | null;
  home: ContactSignals;
  page: ContactSignals | null;
  /** Ulasilabilir iletisim yolu (tel, e-posta, telefon metni ya da sema) var mi */
  reachable: boolean;
  /** E-posta yalniz Cloudflare gizlemesiyle var: botlar goremez */
  hiddenEmailOnly: boolean;
}

export function assessTrustContact(
  homeHtml: string,
  baseUrl: string,
  page: { url: string; html: string | null } | null,
): TrustContactResult {
  const link = findContactLink(homeHtml, baseUrl);
  const home = contactSignals(homeHtml);
  const pageSig = page?.html ? contactSignals(page.html) : null;
  const sum = (k: keyof Omit<ContactSignals, 'schemaContact'>) => home[k] + (pageSig?.[k] ?? 0);
  const visibleEmail = sum('mailto') + sum('emailText');
  const reachable = sum('tel') + sum('phoneText') + visibleEmail > 0 || home.schemaContact || !!pageSig?.schemaContact;
  return {
    ok: reachable && !!link,
    link,
    pageRead: link ? !!page?.html : null,
    home,
    page: pageSig,
    reachable,
    hiddenEmailOnly: sum('cfHiddenEmail') > 0 && visibleEmail === 0,
  };
}

/** Panel cumlesi — ne bulundu, ne eksik */
export function trustContactStatus(r: TrustContactResult): string {
  const parcalar: string[] = [];
  const s = (k: keyof Omit<ContactSignals, 'schemaContact'>) => r.home[k] + (r.page?.[k] ?? 0);
  if (s('tel') + s('phoneText') > 0) parcalar.push('telefon');
  if (s('mailto') + s('emailText') > 0) parcalar.push('e-posta');
  if (r.home.schemaContact || r.page?.schemaContact) parcalar.push('şemada iletişim');
  const sayfa = r.link
    ? `Ana sayfa "${r.link.text || r.link.url}" sayfasına bağlanıyor (${r.link.kind === 'contact' ? 'iletişim' : 'hakkımızda'})`
    : 'Ana sayfada iletişim ya da hakkımızda sayfasına bağlantı yok';
  const bulunan = parcalar.length ? `bulunan: ${parcalar.join(', ')}` : 'görünür telefon ya da e-posta yok';
  const gizli = r.hiddenEmailOnly ? '; e-posta Cloudflare e-posta gizlemesiyle saklanıyor, AI tarayıcıları adresi göremiyor' : '';
  return `${sayfa}; ${bulunan}${gizli}`;
}
