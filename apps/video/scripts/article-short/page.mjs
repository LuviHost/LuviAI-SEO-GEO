/**
 * Sayfa HTML'i -> site / urun tanitim videosunun KAYNAGI (saf, ag yok, yan etki yok).
 *
 *   kind 'site'    : musterinin anasayfasi — ne yapar (Organization, baslik, H1, aciklama),
 *                    hizmet basliklari (ayni seviyede art arda gelen basliklar = hizmet izgarasi)
 *   kind 'product' : musterinin kendi sitesindeki urun/hizmet sayfasi — ad, aciklama, ozellikler,
 *                    ana gorsel adresi (schema.org Product image > og:image), fiyat (YALNIZ dogrulanmis)
 *
 * Girdi GUVENILMEYEN HTML'dir. Sunucuda worker_thread'de sert sure siniriyla calisir
 * (api videos/brand-sandbox.ts, brand-worker.mjs 'page' islemi). ReDoS kurali html.mjs ile ayni:
 * her desen dogrusal (etiket ici `[^<>]`, sinirli niceleyici), belge MAX_PAGE_HTML_CHARS'ta kirpilir.
 *
 * FIYAT KURALI (iki kaynak): fiyat ancak YAPISAL veride (JSON-LD Offer, product:price meta,
 * itemprop=price) TEK bir deger olarak geciyor VE ayni deger sayfanin gorunur metninde ayni para
 * birimiyle yaziliysa "dogrulanmis" sayilir. Tek kaynakta gecen fiyat (yalniz JSON-LD ya da yalniz
 * metindeki bir tutar — eski fiyat, taksit, kargo olabilir) videoya KONMAZ. Gosterilen metin
 * sayfadaki yazimin kendisidir; sayi korumasi (copy.mjs sourceNumberSet) bu metni de denetler.
 */
import { attr, balancedElement, capHtml, decode, firstInner, jsonLd, meta, removeElements, stripTags, typeOf } from './html.mjs';
import { blocksOf, sectionsOf } from './extract.mjs';
import { canonicalNumber } from './copy.mjs';

/** Tek sayfada ayristirilan en fazla karakter (urun sayfalari 150-600 KB; fazlasi tekrar eden sablon) */
export const MAX_PAGE_HTML_CHARS = 600_000;
/** Gorunur metin tavani: sayi korumasinin kaynak kumesi ve fiyat aramasi bu metinde */
export const MAX_VISIBLE_CHARS = 200_000;
const MAX_LINES = 5_000;
const MAX_PAIRS = 40;
const MAX_IMAGES = 3;
const MAX_OFFERS = 12;

const PRODUCT_TYPES = ['Product', 'Book', 'IndividualProduct', 'ProductModel', 'ProductGroup', 'Vehicle', 'SoftwareApplication', 'MobileApplication', 'Course', 'Service', 'FinancialProduct', 'LoanOrCredit'];
const ORG_TYPE = /(Organization|Corporation|LocalBusiness|Store|OnlineStore|Business|Restaurant|Clinic|Dentist|Physician|Hotel|Agency)$/;

/** Satir kiran etiketler: geri kalan (span, small, b, a ...) bosluksuz silinir — "47,<small>25 TL" tek tutar kalir */
const BLOCK_TAG_RE = /<\/?(?:div|p|li|ul|ol|tr|td|th|dt|dd|dl|h[1-6]|section|article|main|table|tbody|thead|br|hr|blockquote|figcaption|label|button|option|header|footer|nav|aside)\b[^<>]{0,4096}>/gi;

/** Para birimleri: gorunur yazim -> ISO kodu */
const CURRENCY_OF = { '₺': 'TRY', tl: 'TRY', try: 'TRY', $: 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP' };
const CUR = '(?:₺|TL|TRY|USD|EUR|GBP|\\$|€|£)';
/** Binlik ayiracli ya da duz tutar; ondalik en cok 2 hane. Her deneme sinirli -> dogrusal */
const NUMP = '\\d{1,3}(?:[.,]\\d{3}){1,3}(?:[.,]\\d{1,2})?|\\d{1,7}(?:[.,]\\d{1,2})?';
const PRICE_RE = new RegExp(`(?<![\\d.,])(?:(${CUR})\\s?(${NUMP})|(${NUMP})\\s?(${CUR})(?![\\p{L}]))`, 'giu');

/**
 * Teknik / ticari etiketler: urun ozelligi olarak videoya konmaz. Fiyat, indirim, taksit, puan
 * gibi tutarlar ozellik satirindan videoya SIZMASIN — fiyat yalniz dogrulanmis fiyat etiketiyle.
 */
const BORING_LABEL = /(isbn|barkod|barcode|sku|gtin|ean|mpn|stok|kod|code|\bid\b|kategori|category|marka|brand|fiyat|price|kdv|kargo|teslim|puan|kazan|indirim|taksit|birlikte|sepet|yorum|değerlendirme|rating)/iu;
const MONEY_IN_VALUE = /[₺$€£]|(?<![\p{L}])(?:TL|TRY|USD|EUR|GBP)(?![\p{L}])/iu;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const strOf = (v) => (typeof v === 'string' ? clean(stripTags(v)) : typeof v === 'number' ? String(v) : '');

/**
 * Gorunur metin satirlari: blok etiketleri satir sonuna, satir ici etiketler bosluksuz silinir.
 * Dogrusal: her iki desen de bir sonraki '<' ya da '>'da durur.
 */
export function visibleLines(html) {
  // Kaynaktaki satir sonlari anlamsizdir (girinti); satiri yalniz blok etiketleri boler
  const t = html.replace(/[\r\n\t\f]+/g, ' ').replace(BLOCK_TAG_RE, '\n').replace(/<[^<>]*>/g, '');
  const out = [];
  let total = 0;
  for (const raw of t.split('\n')) {
    const line = decode(raw).replace(/\s+/g, ' ').trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue;
    out.push(line);
    total += line.length + 1;
    if (out.length >= MAX_LINES || total >= MAX_VISIBLE_CHARS) break;
  }
  return out;
}

/** "Etiket: deger" satirlari (urun ozellik tablosu / ozellik listesi). Etiket 2-28, deger 1-60 karakter. */
export function labelPairs(lines) {
  const out = [];
  for (const line of lines) {
    if (out.length >= MAX_PAIRS) break;
    if (line.length > 100) continue;
    const i = line.indexOf(':');
    if (i < 2 || i > 28) continue;
    const label = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (!value || value.length > 60 || !/^[\p{L}][\p{L} .()/-]*$/u.test(label)) continue;
    if (/^https?$/i.test(label) || /^\/\//.test(value)) continue;
    out.push({ label, value, raw: line, boring: BORING_LABEL.test(label) || MONEY_IN_VALUE.test(value) });
  }
  return out;
}

/** Yapisal fiyat degeri -> sayi (ya da null). "1299.90", 1299.9, "1.299,90" */
export function structuredPriceValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1e9 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s₺$€£]|TL|TRY|USD|EUR|GBP/gi, '');
  if (!/^\d{1,9}(?:[.,]\d{1,3}){0,3}$/.test(s)) return null;
  const n = Number(canonicalNumber(s).canon);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function currencyOf(sym) {
  return CURRENCY_OF[String(sym ?? '').toLowerCase()] ?? null;
}

/** Gorunur metindeki tutarlar: [{ raw, value, currency, display }] (en fazla 200) */
export function visiblePrices(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(PRICE_RE)) {
    const sym = m[1] ?? m[4];
    const num = m[2] ?? m[3];
    const value = Number(canonicalNumber(num).canon);
    if (!Number.isFinite(value) || value <= 0) continue;
    const prefix = Boolean(m[1]);
    // Ekranda sayfadaki yazim: rakamlar birebir, para birimi sayfadaki gibi (onde sembol / sonda kod)
    const display = prefix ? `${sym}${num}` : `${num} ${sym}`;
    out.push({ raw: m[0], value, currency: currencyOf(sym), display });
    if (out.length >= 200) break;
  }
  return out;
}

function offersOf(node) {
  const list = [].concat(node?.offers ?? []).slice(0, MAX_OFFERS);
  const vals = [];
  let currency = null;
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const t = typeOf(o);
    let v = structuredPriceValue(o.price ?? o.priceSpecification?.price);
    // AggregateOffer: yalniz tek fiyatli ise (en dusuk = en yuksek)
    if (v === null && t.includes('AggregateOffer')) {
      const lo = structuredPriceValue(o.lowPrice);
      const hi = structuredPriceValue(o.highPrice);
      if (lo !== null && (hi === null || hi === lo)) v = lo;
    }
    if (v !== null) vals.push(v);
    const c = String(o.priceCurrency ?? o.priceSpecification?.priceCurrency ?? '').toUpperCase();
    if (/^[A-Z]{3}$/.test(c)) currency = currency ?? c;
  }
  return { vals, currency };
}

/**
 * Fiyat dogrulamasi (iki kaynak). structured: yapisal kaynaklardan gelen degerler; visible:
 * visiblePrices() ciktisi. Donus: { verified, display?, value?, currency?, sources, reason? }
 */
export function verifyPrice(structured, visible) {
  const distinct = [...new Set(structured.values.map((v) => Math.round(v * 100)))];
  if (distinct.length === 0) return { verified: false, sources: [], reason: 'yapisal fiyat yok' };
  if (distinct.length > 1) return { verified: false, sources: structured.via, reason: 'birden fazla yapisal fiyat (varyant/indirim) — gosterilmez' };
  const cents = distinct[0];
  const want = structured.currency;
  const hit = visible.find((p) => Math.round(p.value * 100) === cents && (!want || !p.currency || p.currency === want));
  if (!hit) return { verified: false, sources: structured.via, reason: 'yapisal fiyat sayfanin gorunur metninde yok — gosterilmez' };
  return { verified: true, display: hit.display, value: cents / 100, currency: want ?? hit.currency, sources: [...structured.via, 'gorunur-metin'] };
}

function imageUrlOf(v) {
  for (const x of [].concat(v ?? []).slice(0, 5)) {
    if (typeof x === 'string' && x) return x;
    if (x && typeof x === 'object') {
      const u = x.contentUrl ?? x.url;
      if (typeof u === 'string' && u) return u;
    }
  }
  return null;
}

/** Baslik parcalari: "Urun Adi | Marka" -> ["Urun Adi", "Marka"] */
export function titleSegments(title) {
  return String(title ?? '').split(/\s[|–—·-]\s|\s?\|\s?/).map(clean).filter(Boolean).slice(0, 6);
}

function pickBody(html) {
  // Sayfa iskeleti (menu, alt bilgi, cerez bandi formlari) videoya madde olarak sizmasin
  const cleanHtml = removeElements(html, 'script|style|noscript|template|svg|header|footer|nav|aside|form|iframe|select');
  for (const tag of ['main', 'body']) {
    const i = cleanHtml.search(new RegExp(`<${tag}\\b`, 'i'));
    if (i >= 0) return { el: balancedElement(cleanHtml, i), via: tag };
  }
  return { el: cleanHtml, via: 'document' };
}

/**
 * @param {string} rawHtml
 * @param {string} pageUrl  son adres (yonlendirmeler izlendikten sonra)
 * @param {{ kind?: 'site' | 'product' }} [opts]
 */
export function extractPage(rawHtml, pageUrl, { kind = 'site' } = {}) {
  const url = new URL(pageUrl);
  const html = capHtml(rawHtml, MAX_PAGE_HTML_CHARS);
  const ld = jsonLd(html);
  const orgNode = ld.find((n) => typeOf(n).some((t) => ORG_TYPE.test(t)));
  const siteNode = ld.find((n) => typeOf(n).includes('WebSite'));
  const productNode = ld.find((n) => typeOf(n).some((t) => PRODUCT_TYPES.includes(t)));
  const crumbs = ld.find((n) => typeOf(n).includes('BreadcrumbList'));

  const titleInner = firstInner(html, 'title');
  const title = titleInner !== null ? stripTags(titleInner) : '';
  const h1Inner = firstInner(html, 'h1');
  const h1 = h1Inner !== null ? stripTags(h1Inner) : null;
  const ogTitle = clean(meta(html, 'og:title'));
  const description = clean(meta(html, 'description') ?? meta(html, 'og:description') ?? '');
  const siteName = clean(meta(html, 'og:site_name')) || strOf(orgNode?.name) || strOf(siteNode?.name) || null;

  const items = Array.isArray(crumbs?.itemListElement) ? crumbs.itemListElement.slice(0, 20) : [];
  const parentCrumb = items.length >= 3 ? strOf(items[items.length - 2]?.name) || null : null;

  const body = pickBody(html);
  // Hizmet kartlari cogu sitede <button>/<a> icinde: blocksOf butonlari atar (makalede gurultu),
  // burada kart basliklari asil icerik — buton etiketi blok olarak acilir
  const blocks = blocksOf(body.el.replace(/<(\/?)button\b[^<>]{0,4096}>/gi, '<$1div>'));
  const lines = visibleLines(body.el);
  const visibleText = lines.join('\n');

  /* urun / hizmet */
  let product = null;
  if (kind === 'product') {
    const brandName = strOf(productNode?.brand?.name ?? productNode?.brand ?? productNode?.manufacturer?.name ?? productNode?.provider?.name);
    const segs = titleSegments(ogTitle || title);
    const name = strOf(productNode?.name) || segs[0] || h1 || '';
    product = {
      name: name.slice(0, 200),
      description: strOf(productNode?.description).slice(0, 2000),
      brand: brandName && brandName.length <= 60 ? brandName : null,
      category: parentCrumb,
      structured: Boolean(productNode),
      type: productNode ? typeOf(productNode)[0] ?? null : null,
    };
  }

  /* gorseller (yalniz adres; indirme ve donusturme sunucuda safe-fetch + sharp) */
  const images = [];
  const seen = new Set();
  for (const raw of [kind === 'product' ? imageUrlOf(productNode?.image) : null, meta(html, 'og:image'), meta(html, 'og:image:secure_url'), meta(html, 'twitter:image')]) {
    if (!raw || images.length >= MAX_IMAGES) continue;
    try {
      const abs = new URL(raw, url).href;
      if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
      seen.add(abs);
      images.push(abs);
    } catch {
      /* gecersiz adres atlanir */
    }
  }

  /* fiyat — yalniz urun sayfasinda; iki kaynak kurali */
  let price = { verified: false, sources: [], reason: 'urun sayfasi degil' };
  if (kind === 'product') {
    const structured = { values: [], currency: null, via: [] };
    const fromLd = offersOf(productNode);
    if (fromLd.vals.length) {
      structured.values.push(...fromLd.vals);
      structured.via.push('json-ld');
    }
    structured.currency = fromLd.currency;
    const metaPrice = structuredPriceValue(meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount'));
    if (metaPrice !== null) {
      structured.values.push(metaPrice);
      structured.via.push('meta');
      structured.currency = structured.currency ?? (String(meta(html, 'product:price:currency') ?? meta(html, 'og:price:currency') ?? '').toUpperCase() || null);
    }
    // itemprop="price" content="..." (mikroveri). Yalniz 'itemprop' geciren etiketlere attr() uygulanir
    let micro = 0;
    for (const m of html.matchAll(/<[a-z][a-z0-9]*\b[^<>]{0,4096}>/gi)) {
      if (!m[0].includes('itemprop')) continue;
      if (String(attr(m[0], 'itemprop') ?? '').toLowerCase() !== 'price') continue;
      const v = structuredPriceValue(attr(m[0], 'content'));
      if (v !== null) {
        structured.values.push(v);
        if (!structured.via.includes('itemprop')) structured.via.push('itemprop');
      }
      if (++micro >= MAX_OFFERS) break;
    }
    if (structured.currency && !/^[A-Z]{3}$/.test(structured.currency)) structured.currency = null;
    price = verifyPrice(structured, visiblePrices(visibleText));
  }

  const org = orgNode
    ? { name: strOf(orgNode.name).slice(0, 120) || null, description: strOf(orgNode.description).slice(0, 600) || null, slogan: strOf(orgNode.slogan).slice(0, 200) || null }
    : null;

  const sourceText = [
    title, ogTitle, description, h1 ?? '', siteName ?? '',
    org?.description ?? '', org?.slogan ?? '',
    product?.name ?? '', product?.description ?? '', product?.brand ?? '', parentCrumb ?? '',
    visibleText,
  ].filter(Boolean).join('\n').slice(0, MAX_VISIBLE_CHARS + 20_000);

  return {
    kind,
    url: url.href,
    domain: url.hostname.replace(/^www\./, ''),
    // Yapisal verideki dil once: bazi siteler <html lang="en"> sablonunu Turkce icerikle birakiyor
    lang: (strOf(siteNode?.inLanguage ?? orgNode?.knowsLanguage ?? productNode?.inLanguage).slice(0, 2).toLowerCase() || (/<html\b[^<>]{0,4096}?lang\s*=\s*["']?([a-z]{2,3})/i.exec(html) || [])[1]?.toLowerCase()) ?? null,
    title,
    ogTitle: ogTitle || null,
    h1,
    description,
    siteName,
    organization: org,
    product,
    breadcrumb: parentCrumb,
    images,
    price,
    bodyVia: body.via,
    blocks,
    sections: sectionsOf(blocks),
    pairs: labelPairs(lines),
    /** sayi/olgu koruyucusu icin: YALNIZ sayfanin kendi metni (yapisal veri aciklamalari dahil, fiyat alanlari haric) */
    sourceText,
    truncated: typeof rawHtml === 'string' && rawHtml.length > html.length,
  };
}
