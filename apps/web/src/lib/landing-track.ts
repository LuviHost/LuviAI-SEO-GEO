/**
 * Landing analytics — anonim funnel tracker.
 * Kendi backend'imize gider (PostHog/Plausible yok). KVKK uyumlu, IP yok.
 *
 * Session ID localStorage'ta 30 gün (cookie değil ki banner gerekmesin).
 */

const STORAGE_KEY = 'luvi_lsid';
/** Ilk gorulen UTM oturuma yapisir — kampanya atifi sayfa degisince kaybolmasin */
const UTM_KEY = 'luvi_utm';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = localStorage.getItem(STORAGE_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, sid);
  }
  return sid;
}

/**
 * Kampanya atfi. NEDEN yapistiriyoruz: eskiden her event yalniz O ANKI URL'i okuyordu; ziyaretci
 * `/?utm_source=linkedin` ile girip `/pricing`'e gecince kampanya bilgisi kayboluyor, dolayisiyla
 * "LinkedIn'den gelen kac kisi fiyatlara bakti" sorusu cevapsiz kaliyordu (01.09.2026 tespiti).
 * Ilk gorulen UTM oturum boyunca saklanir; sonradan gelen YENI bir UTM onu gunceller.
 */
function getUtm(): { source?: string; medium?: string; campaign?: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const sp = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  const s = sp.get('utm_source');
  const m = sp.get('utm_medium');
  const c = sp.get('utm_campaign');
  if (s) utm.source = s;
  if (m) utm.medium = m;
  if (c) utm.campaign = c;

  try {
    if (Object.keys(utm).length > 0) {
      localStorage.setItem(UTM_KEY, JSON.stringify(utm));
      return utm;
    }
    const kayitli = localStorage.getItem(UTM_KEY);
    if (kayitli) {
      const parsed = JSON.parse(kayitli) as Record<string, string>;
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
    }
  } catch { /* localStorage kapaliysa URL'deki degerle devam */ }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

/** Asenkron, ateşle-unut event */
export function track(type: string, meta?: Record<string, any>) {
  if (typeof window === 'undefined') return;
  const body = {
    type,
    path: window.location.pathname + window.location.search,
    sessionId: getSessionId(),
    meta,
    referrer: document.referrer || undefined,
    utm: getUtm(),
  };
  // beacon API daha güvenli — sayfa kapansa bile gider
  try {
    const url = `${API_BASE}/api/analytics/landing`;
    const json = JSON.stringify(body);
    if (navigator.sendBeacon) {
      const blob = new Blob([json], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
    }
  } catch { /* sessizce yut, analytics asla user'ı bloklamasın */ }
}

/** Pageview kısayolu */
export function trackPageview() {
  track('pageview');
}

/** CTA tıklama */
export function trackCta(ctaId: string, extra?: Record<string, any>) {
  track('cta_click', { ctaId, ...extra });
}

/** Section görüntülenme (IntersectionObserver ile çağrılır) */
export function trackSectionView(sectionId: string) {
  track('section_view', { sectionId });
}

/** Scroll depth (25/50/75/100%) — sayfa başına 1 kez */
let scrollDepthFired = new Set<number>();
export function setupScrollDepthTracking() {
  if (typeof window === 'undefined') return;
  scrollDepthFired = new Set();
  const onScroll = () => {
    const doc = document.documentElement;
    const total = doc.scrollHeight - doc.clientHeight;
    if (total <= 0) return;
    const pct = Math.round((doc.scrollTop / total) * 100);
    for (const breakpoint of [25, 50, 75, 100]) {
      if (pct >= breakpoint && !scrollDepthFired.has(breakpoint)) {
        scrollDepthFired.add(breakpoint);
        track('scroll_depth', { pct: breakpoint });
      }
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}

/** IntersectionObserver yardımcısı — section'ları otomatik tracker'a bağla */
export function setupSectionTracking(sectionIds: string[]) {
  if (typeof window === 'undefined') return;
  const fired = new Set<string>();
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.target.id && !fired.has(e.target.id)) {
          fired.add(e.target.id);
          trackSectionView(e.target.id);
        }
      }
    },
    { threshold: 0.3 },
  );
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (el) obs.observe(el);
  }
  return () => obs.disconnect();
}
