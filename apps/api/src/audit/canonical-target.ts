/**
 * CANONICAL HEDEFI ACILIYOR MU — saf secim + siniflandirma (istekleri tarayici atar).
 *
 * Kaynak (25.11.2026'da okundu): Google Search Central, "5 common mistakes with
 * rel=canonical" (developers.google.com/search/blog/2013/04/5-common-mistakes-with-relcanonical):
 * "Double-check that your rel=canonical target exists (it's not an error or
 * soft 404)". Google canonical belgesi (consolidate-duplicate-urls) canonical'in
 * gercek, dizine girebilecek bir adresi gostermesini ister.
 *
 * Kapsam: yalniz AYNI sitenin adresi (baska alan adina canonical mesru bir
 * secimdir ve oradaki sunucuyu yoklamak bizim isimiz degil). Sayfanin kendisini
 * gosteren canonical yoklanmaz (sayfa zaten acildi). Taramada acilan sayfalar
 * bilinir; taramada 404 / 5xx donen adresler istek atmadan sorunlu sayilir.
 * Kalanlar icin en fazla `max` istek. Yumusak 404 (200 donen "bulunamadi"
 * sayfasi) BU KONTROLDE YOK: govdeden guvenilir ayirt edilemiyor.
 */

export interface CanonicalTargetProblem {
  /** Canonical etiketini tasiyan sayfa */
  page: string;
  /** Etiketin gosterdigi adres (cozumlenmis) */
  target: string;
  status: number;
  kind: 'not_found' | 'server_error';
}

/** Karsilastirma anahtari: www / http(s) / sondaki "/" / #parca farki ayni adres */
export function urlKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${host}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** 404 / 410 → yok; 5xx → sunucu hatasi; digerleri (401/403/429 ...) hukum yok */
export function classifyCanonicalTarget(status: number | null): CanonicalTargetProblem['kind'] | null {
  if (status === 404 || status === 410) return 'not_found';
  if (status !== null && status >= 500 && status < 600) return 'server_error';
  return null;
}

export interface CanonicalPlan {
  /** Taramada zaten 404 / 5xx gordugumuz hedefler — istek gerekmez */
  problems: CanonicalTargetProblem[];
  /** Yoklanacak hedefler (tekil, en fazla `max`) ve onlari gosteren ilk sayfa */
  toProbe: Array<{ page: string; target: string }>;
  /** Hukmu verilen (bilinen + yoklanacak) farkli hedef sayisi */
  checked: number;
}

export function canonicalProbeTargets(
  pages: ReadonlyArray<{ url: string; finalUrl?: string; canonical: string | null }>,
  sameSite: (u: URL) => boolean,
  broken: ReadonlyArray<{ url: string; status: number }>,
  max = 10,
): CanonicalPlan {
  const known = new Set<string>();
  for (const p of pages) {
    for (const u of [p.url, p.finalUrl]) {
      const k = u ? urlKey(u) : null;
      if (k) known.add(k);
    }
  }
  const brokenByKey = new Map<string, number>();
  for (const b of broken) {
    const k = urlKey(b.url);
    if (k) brokenByKey.set(k, b.status);
  }

  const problems: CanonicalTargetProblem[] = [];
  const toProbe: Array<{ page: string; target: string }> = [];
  const seen = new Set<string>();
  let checked = 0;
  for (const p of pages) {
    if (!p.canonical) continue;
    let target: URL;
    try {
      target = new URL(p.canonical.trim(), p.finalUrl ?? p.url);
    } catch {
      continue;
    }
    if (!sameSite(target)) continue;
    target.hash = '';
    const k = urlKey(target.href);
    if (!k) continue;
    const own = [p.url, p.finalUrl].some((u) => u && urlKey(u) === k);
    if (own) continue;
    const st = brokenByKey.get(k);
    if (st !== undefined) {
      const kind = classifyCanonicalTarget(st);
      // Ayni hedefi gosteren HER sayfa sorunludur; hedef basina tek satir yeter
      if (kind && !seen.has(k)) problems.push({ page: p.url, target: target.href, status: st, kind });
      if (!seen.has(k)) { seen.add(k); checked++; }
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    if (known.has(k)) { checked++; continue; }
    if (toProbe.length >= max) continue;
    toProbe.push({ page: p.url, target: target.href });
    checked++;
  }
  return { problems, toProbe, checked };
}
