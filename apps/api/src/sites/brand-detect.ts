import { asciiFold, isGenericBrandWord, MAX_BRAND_ALIAS_LEN } from '../audit/brand-in-query.js';
import { registrableDomain } from '../audit/host-match.js';

/**
 * MARKA ADI TESPITI — saf, I/O yok (22.11.2026).
 *
 * NEDEN: site eklenirken ad alan adindan tahmin ediliyor (kaleminc.com → "kaleminc").
 * Olcum bu adla eslesir ve oyle kalmali; ama asistanlar markayi sitede yazdigi adla anar
 * ("Kalem", "Kalem Finansal Teknolojiler"). Bu adlar sitenin kendi ana sayfasinda zaten
 * yazili: og:site_name, schema.org Organization / WebSite adi, sayfa basligi.
 *
 * KURAL (iki kaynak): bir ad ancak
 *  - en az IKI farkli kaynak turu (og:site_name, schema, baslik) ayni adi soyluyorsa, ya da
 *  - tek kaynak soyluyor ve adin bitisik yazimi alan adi kokuyle ortusuyorsa
 *    ("Mavi Liman" ↔ maviliman)
 * kabul edilir. Slogan, "Ana Sayfa" gibi baslik parcalari boylece elenir.
 * Kisa ad: kabul edilen adin ilk kelimesi alan adi kokunun basiysa ("Kalem" ↔ kaleminc).
 *
 * Cikti diger adlara (Site.brandAliases) sitede yazildigi bicimiyle girer: buyuk harfle
 * yazilan ad cevapta da buyuk harf ister (brand-in-query.ts), gundelik "kalem" sayilmaz.
 * Gundelik kelimeden ibaret ad (isGenericBrandWord) eklenmez.
 * Urun markalari (bayi sitesinde satilan marka gibi) BILEREK tespit edilmez: yonetici ekler.
 */

export interface BrandDetectInput {
  title?: string | null;
  ogTags?: Record<string, string> | null;
  jsonLdBlocks?: unknown[] | null;
}

export interface DetectedBrand {
  /** Panel ve raporda gosterilecek ad (kisa ad varsa o) */
  display: string;
  /** Diger adlara eklenecekler (sitede yazildigi bicimiyle, tekil) */
  aliases: string[];
}

type Kaynak = 'og' | 'schema' | 'title';

const ORG_TYPES = new Set([
  'organization', 'corporation', 'localbusiness', 'store', 'onlinestore', 'onlinebusiness', 'brand', 'website',
]);

/** Sondaki sirket ekleri: "Kalem INC." → "Kalem", "Ornek A.Ş." → "Ornek" */
const LEGAL_SUFFIX = /[\s,]+(?:a\.?\s?ş\.?|a\.?\s?s\.?|ltd\.?(?:\s+şti\.?)?|şti\.?|inc\.?|llc|gmbh|corp\.?|co\.?|san\.?(?:\s+ve)?(?:\s+tic\.?)?(?:\s+a\.?ş\.?)?|tic\.?(?:\s+a\.?ş\.?)?)\s*$/i;

const BASLIK_AYRAC = /\s+[|–—\-·:»•]\s+|\s*[|–—·»•]\s*/;

const compact = (s: string) => asciiFold(s).replace(/[^a-z0-9]/g, '');

function temizle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && LEGAL_SUFFIX.test(s); i++) s = s.replace(LEGAL_SUFFIX, '').trim();
  if (s.length < 2 || s.length > MAX_BRAND_ALIAS_LEN) return null;
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(s)) return null;
  return s;
}

/** JSON-LD bloklarindan kurum / site adlari (@graph ve diziler dahil) */
function schemaAdlari(blocks: unknown[]): string[] {
  const out: string[] = [];
  const gez = (n: unknown, derinlik: number) => {
    if (!n || derinlik > 4) return;
    if (Array.isArray(n)) { for (const x of n) gez(x, derinlik + 1); return; }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const tipler = (Array.isArray(o['@type']) ? o['@type'] : [o['@type']]).map((t) => String(t ?? '').toLowerCase());
    if (tipler.some((t) => ORG_TYPES.has(t))) {
      for (const ad of [o.name, ...(Array.isArray(o.alternateName) ? o.alternateName : [o.alternateName])]) {
        const t = temizle(ad);
        if (t) out.push(t);
      }
    }
    if (o['@graph']) gez(o['@graph'], derinlik + 1);
  };
  gez(blocks, 0);
  return out;
}

/**
 * Kisa ad: tam adin ilk kelimesi, alan adi koku o kelimeyle basliyorsa ("Kalem Finansal
 * Teknolojiler" ↔ kaleminc). Kok sonraki kelimeleri de tasiyorsa kisa ad YOK: ad tam haliyle
 * markadir ("Ayşe Demir" ↔ aysedemir, "Güvenli Kasa" ↔ guvenlikasa — "Ayşe",
 * "Güvenli" tek basina baska seyler de demektir).
 */
export function kisaAd(tamAd: string, kok: string): string | null {
  const kelimeler = tamAd.split(' ');
  if (kelimeler.length < 2 || !kok) return null;
  const ilk = kelimeler[0];
  const ilkK = compact(ilk);
  if (ilkK.length < 3 || !kok.startsWith(ilkK)) return null;
  const kokKalan = kok.slice(ilkK.length);
  const adKalan = compact(kelimeler.slice(1).join(' '));
  if (kokKalan && adKalan.startsWith(kokKalan.slice(0, 3))) return null;
  return ilk;
}

/** Ana sayfadan marka adi; guvenilir bir ad yoksa null */
export function detectBrandName(page: BrandDetectInput | null | undefined, siteUrl: string): DetectedBrand | null {
  if (!page) return null;
  let kok = '';
  try {
    kok = compact(registrableDomain(new URL(siteUrl).hostname).split('.')[0] ?? '');
  } catch { /* adres bozuksa kok yok */ }

  const adaylar: Array<{ ad: string; kaynak: Kaynak }> = [];
  const og = temizle(page.ogTags?.['og:site_name']);
  if (og) adaylar.push({ ad: og, kaynak: 'og' });
  for (const ad of schemaAdlari(page.jsonLdBlocks ?? [])) adaylar.push({ ad, kaynak: 'schema' });
  for (const baslik of [page.title, page.ogTags?.['og:title']]) {
    for (const parca of String(baslik ?? '').split(BASLIK_AYRAC)) {
      const t = temizle(parca);
      if (t) adaylar.push({ ad: t, kaynak: 'title' });
    }
  }

  // Bitisik yazima gore grupla; kaynak turlerini say
  const gruplar = new Map<string, { ad: string; kaynaklar: Set<Kaynak>; sira: number }>();
  adaylar.forEach(({ ad, kaynak }, sira) => {
    const k = compact(ad);
    if (k.length < 2) return;
    const g = gruplar.get(k);
    if (g) g.kaynaklar.add(kaynak);
    else gruplar.set(k, { ad, kaynaklar: new Set([kaynak]), sira });
  });

  const kokOrtusur = (k: string) => !!kok && (k === kok || (kok.length >= 4 && k.startsWith(kok)) || (k.length >= 4 && kok.startsWith(k)));
  const kabul = [...gruplar.entries()]
    .filter(([k, g]) => g.kaynaklar.size >= 2 || kokOrtusur(k))
    .sort((a, b) => b[1].kaynaklar.size - a[1].kaynaklar.size || a[1].sira - b[1].sira);
  if (kabul.length === 0) return null;

  const [, en] = kabul[0];
  const tamAd = en.ad;
  // Kisadan uzuna: bir adin bastaki kelimeleri zaten listedeyse uzun hal eklenmez
  // ("Paramix Ödeme Kuruluşu" gecen her cevapta "Paramix" de gecer)
  const adlar = [kisaAd(tamAd, kok), ...kabul.slice(0, 3).map(([, g]) => g.ad)]
    .filter((ad): ad is string => !!ad && !isGenericBrandWord(ad))
    .sort((a, b) => a.length - b.length);
  const aliases: string[] = [];
  const kelimeBasi = (uzun: string, kisa: string) => {
    const u = uzun.split(' ').map(compact);
    const k = kisa.split(' ').map(compact);
    return k.length <= u.length && k.every((w, i) => w === u[i]);
  };
  for (const ad of adlar) {
    if (aliases.some((a) => kelimeBasi(ad, a))) continue;
    aliases.push(ad);
  }
  // Gorunen ad gundelik kelimeden ibaret olsa da yazilir ("Güvenli Kasa"): yalniz gosterim,
  // eslesmeye girmez
  return { display: kisaAd(tamAd, kok) ?? tamAd, aliases };
}

/** Taranan sayfalardan ana sayfa: yolu "/" olan (yonlendirme sonrasi dahil), yoksa ilk sayfa */
export function pickHomePage<T extends { url: string; finalUrl?: string }>(pages: T[], siteUrl: string): T | null {
  const kok = (u: string | undefined) => {
    try {
      const x = new URL(u ?? '');
      return x.pathname === '/' || x.pathname === '' ? x.hostname.replace(/^www\./, '') : null;
    } catch { return null; }
  };
  let host = '';
  try { host = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { /* yok */ }
  return pages.find((p) => kok(p.url) === host || kok(p.finalUrl) === host) ?? pages[0] ?? null;
}
