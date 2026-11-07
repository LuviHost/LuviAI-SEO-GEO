/**
 * Gorunme sikligi icin guven araligi — saf (Nest, Prisma, ag yok).
 *
 * NEDEN (08.11.2026 kanit denetimi, "AI olcumu tek tura dayaniyor"): AI
 * cevaplari cok oynak. Ahrefs: AI Overview icerigi iki gozlem arasinda %70
 * degisiyor; Sistrix: ChatGPT'de alintilanan alan adlarinin %74'u haftadan
 * haftaya degisiyor; SparkToro: tek turun hata payi yaklasik ±5 puan, ayni
 * listenin tekrar gelme olasiligi %1'in altinda. Bu yuzden site olcumu her
 * soruyu her asistana N kez sorar (citation-repeat.ts) ve skorun yanina
 * olcumun belirsizligi yazilir; iki olcum arasindaki fark yalniz araliklar
 * ORTUSMUYORSA "artti/azaldi" diye okunur.
 *
 * GORUNME = markasiz + olculebilen (HATA olmayan) bir cevapta site ya kaynak
 * gosterildi ya da marka anildi. Sayac citation-score.ts citationCounts'tan
 * gelir (cited + yalniz-anilma, payda poolSize) — skorla AYNI havuz, ayni
 * HATA/markali soru kurali; burada ikinci bir tanim yazilmaz.
 *
 * NEDEN WILSON: n kucuk (asistan basina 5-15 cevap) ve oran sik sik 0 ya da
 * 1'e yakin. Normal (Wald) yaklasimi bu durumda sifir genislikli ya da [0,100]
 * disina tasan aralik verir; Wilson araligi [0,100] icinde kalir ve k=0'da
 * bile anlamli bir ust sinir uretir.
 *   merkez = (p + z²/2n) / (1 + z²/n)
 *   yari   = z·sqrt(p(1-p)/n + z²/4n²) / (1 + z²/n)
 *
 * YAKLASIM NOTU: skor bilesik (atif 100, yalniz anilma 50); "±X" gorunme
 * sikliginin araligindan gelir — skorun kendisi icin kesin bir aralik degil,
 * olcumun ne kadar oynayabilecegini gosteren olcekli bir isaret. Saglayicilar
 * arasi birlesik aralik cevaplari bagimsiz sayar (ayni soru farkli asistanlarda
 * iliskili olabilir); bu da araligi biraz DAR gosterir — karar kurali (ortusme)
 * zaten temkinli oldugu icin kabul edilebilir.
 */
import { citationCounts, type ScorableProbe } from './citation-score.js';

/** %95 iki yonlu normal kantil */
export const WILSON_Z_95 = 1.959963984540054;

/** Gorunme sayaci: `gorunen` / `olculen` (markasiz + olculebilen cevap) */
export interface GorunmeSayaci {
  gorunen: number;
  olculen: number;
}

/** Wilson araligi — oran, alt, ust ve yari genislik 0-100 olceginde, 1 ondalik */
export interface GorunmeAraligi extends GorunmeSayaci {
  oran: number;
  alt: number;
  ust: number;
  /** (ust - alt) / 2 — panelde skorun yanindaki "±X" */
  yariGenislik: number;
}

/**
 * Iki olcumun karari. 'artti'/'azaldi' YALNIZ iki aralik ortusmuyorsa;
 * sinirlar degisiyor ya da ortusuyorsa 'anlamli-degil'.
 */
export type AralikKarari = 'artti' | 'azaldi' | 'anlamli-degil';

export interface AralikKarsilastirmasi {
  /** Iki taraftan biri hesaplanamiyorsa null (kiyas yok) */
  karar: AralikKarari | null;
  once: GorunmeAraligi | null;
  sonra: GorunmeAraligi | null;
}

const bir = (x: number) => Math.round(x * 10) / 10;

/**
 * %95 Wilson araligi. olculen <= 0 (ya da gecersiz sayi) → null: "aralik 0"
 * ile "olculecek cevap yok" ayni sey degildir.
 */
export function wilsonAraligi(gorunen: number, olculen: number, z = WILSON_Z_95): GorunmeAraligi | null {
  if (!Number.isFinite(gorunen) || !Number.isFinite(olculen) || olculen <= 0) return null;
  const n = Math.floor(olculen);
  const k = Math.min(Math.max(Math.floor(gorunen), 0), n);
  const p = k / n;
  const z2 = z * z;
  const payda = 1 + z2 / n;
  const merkez = (p + z2 / (2 * n)) / payda;
  const yari = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / payda;
  const alt = Math.max(0, merkez - yari);
  const ust = Math.min(1, merkez + yari);
  return {
    gorunen: k,
    olculen: n,
    oran: bir(p * 100),
    alt: bir(alt * 100),
    ust: bir(ust * 100),
    yariGenislik: bir(((ust - alt) / 2) * 100),
  };
}

/** Probe'lardan gorunme sayaci — skorla ayni havuz (citationCounts) */
export function gorunmeSayaci(probes: ScorableProbe[]): GorunmeSayaci {
  const c = citationCounts(probes);
  return { gorunen: c.cited + c.mentioned, olculen: c.poolSize };
}

/** Probe'lardan Wilson araligi; sayilacak cevap yoksa null */
export function gorunmeAraligi(probes: ScorableProbe[]): GorunmeAraligi | null {
  const s = gorunmeSayaci(probes);
  return wilsonAraligi(s.gorunen, s.olculen);
}

/** Sayaclari toplar (birlesik aralik icin) */
export function sayacTopla(sayaclar: Array<GorunmeSayaci | null | undefined>): GorunmeSayaci {
  let gorunen = 0;
  let olculen = 0;
  for (const s of sayaclar) {
    if (!s || !(s.olculen > 0)) continue;
    gorunen += s.gorunen;
    olculen += s.olculen;
  }
  return { gorunen, olculen };
}

/**
 * Iki aralik ortusuyor mu → karar. Ortusme kapali aralikla: sinirlar
 * degisiyorsa da "anlamli degil" (temkinli taraf).
 */
export function aralikKarari(once: GorunmeAraligi | null | undefined, sonra: GorunmeAraligi | null | undefined): AralikKarari | null {
  if (!once || !sonra) return null;
  if (sonra.alt > once.ust) return 'artti';
  if (sonra.ust < once.alt) return 'azaldi';
  return 'anlamli-degil';
}

export function karsilastir(once: GorunmeSayaci | null | undefined, sonra: GorunmeSayaci | null | undefined): AralikKarsilastirmasi {
  const a = once ? wilsonAraligi(once.gorunen, once.olculen) : null;
  const b = sonra ? wilsonAraligi(sonra.gorunen, sonra.olculen) : null;
  return { karar: aralikKarari(a, b), once: a, sonra: b };
}

/** Bir sonuctaki tekrar sayisi: probe.tekrar'in en buyugu; alan yoksa (eski kayit / tek tur) 1 */
export function tekrarSayisi(probes: Array<{ tekrar?: unknown }>): number {
  let max = 1;
  for (const p of probes) {
    const t = typeof p?.tekrar === 'number' && Number.isFinite(p.tekrar) ? Math.floor(p.tekrar) : 1;
    if (t > max) max = t;
  }
  return max;
}

/** Sorulan farkli soru sayisi (markali dahil; bosluk/harf farki tek soru) */
export function soruSayisi(probes: Array<{ query?: unknown }>): number {
  const set = new Set<string>();
  for (const p of probes) {
    if (typeof p?.query !== 'string') continue;
    const k = p.query.trim().toLowerCase();
    if (k) set.add(k);
  }
  return set.size;
}

// ────────────────────────────────────────────────────────────
//  GECMIS (getHistory) — gun kosumlarindan belirsizlik ozeti
// ────────────────────────────────────────────────────────────

/**
 * Bir olcum gununun kosumu — gunluk snapshot'in (siteId+date+provider) karsiligi:
 * ayni gun birden fazla kosum varsa SON kosum (snapshot da onu tutar).
 */
export interface GunKosumu {
  /** YYYY-MM-DD (UTC) */
  date: string;
  runAt: string;
  matchVersion: number;
  /** saglayici → gorunme sayaci (o saglayicinin markasiz + olculebilen cevaplari) */
  asistanlar: Record<string, GorunmeSayaci>;
  tekrar: number;
  soruSayisi: number;
}

/** Trend satirinin bu hesaba giren alanlari (citation-history-trend.ts ProviderTrend) */
export interface TrendRef {
  provider: string;
  first: number | null;
  last: number | null;
  firstDate: string | null;
  lastDate: string | null;
}

export interface OlcumBelirsizligi {
  /** Son olcum: tekrar x soru ve gorunme araligi (genel + asistan bazinda) */
  son: {
    date: string;
    runAt: string;
    tekrar: number;
    soruSayisi: number;
    gorunme: GorunmeAraligi | null;
    asistanlar: Record<string, GorunmeAraligi | null>;
  } | null;
  /**
   * Manset penceresi (son olcum gunu dahil son `windowDays` gun, guncel yontem)
   * olcumlerinin birlesik araligi — skorun yanindaki "±X".
   */
  manset: { gorunme: GorunmeAraligi | null; olcumSayisi: number };
  /** Manset penceresi vs onceki pencere (genel bakis kutusundaki fark) — yalniz iki pencerede de olculen asistanlar */
  haftalik: AralikKarsilastirmasi;
  /** "RanksUp Etkisi": kiyaslanabilir asistanlarin baslangic olcumu vs son olcumu */
  etki: AralikKarsilastirmasi;
  /** Asistan bazinda trend (ilk → son) karari */
  asistanlar: Record<string, AralikKarsilastirmasi>;
}

const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Pencerelerde iki tarafta da olculen asistanlar uzerinden birlesik sayac (AYNI KAPSAM) */
function ortakKapsam(once: GunKosumu[], sonra: GunKosumu[]): { once: GorunmeSayaci; sonra: GorunmeSayaci } | null {
  const birlesik = (gunler: GunKosumu[]) => {
    const m = new Map<string, GorunmeSayaci>();
    for (const g of gunler) {
      for (const [p, s] of Object.entries(g.asistanlar)) {
        if (!(s.olculen > 0)) continue;
        m.set(p, sayacTopla([m.get(p), s]));
      }
    }
    return m;
  };
  const a = birlesik(once);
  const b = birlesik(sonra);
  const ortak = [...a.keys()].filter((p) => b.has(p));
  if (ortak.length === 0) return null;
  return { once: sayacTopla(ortak.map((p) => a.get(p))), sonra: sayacTopla(ortak.map((p) => b.get(p))) };
}

const BOS: AralikKarsilastirmasi = { karar: null, once: null, sonra: null };

/**
 * getHistory'nin belirsizlik blogu. `gunler` tarih sirali olmak zorunda degil.
 * Manset ve haftalik kiyas yalniz SON olcumun yontem surumunden; etki ve
 * asistan trendleri trend satirlarinin (zaten guncel yontem kesitinden gelen)
 * ilk/son gunlerinden kurulur — ayni gunlerin kosumu yoksa karar null.
 */
export function olcumBelirsizligi(gunler: GunKosumu[], trends: TrendRef[], windowDays = 7): OlcumBelirsizligi {
  const sirali = [...gunler].sort((a, b) => a.date.localeCompare(b.date) || a.runAt.localeCompare(b.runAt));
  const sonGun = sirali.length > 0 ? sirali[sirali.length - 1] : null;
  const gunHaritasi = new Map(sirali.map((g) => [g.date, g]));

  const son: OlcumBelirsizligi['son'] = sonGun
    ? {
      date: sonGun.date,
      runAt: sonGun.runAt,
      tekrar: sonGun.tekrar,
      soruSayisi: sonGun.soruSayisi,
      gorunme: (() => {
        const s = sayacTopla(Object.values(sonGun.asistanlar));
        return wilsonAraligi(s.gorunen, s.olculen);
      })(),
      asistanlar: Object.fromEntries(
        Object.entries(sonGun.asistanlar).map(([p, s]) => [p, wilsonAraligi(s.gorunen, s.olculen)]),
      ),
    }
    : null;

  // Manset ve haftalik: son olcumun yontemiyle, son olcum gunune gore pencereler
  let manset: OlcumBelirsizligi['manset'] = { gorunme: null, olcumSayisi: 0 };
  let haftalik: AralikKarsilastirmasi = BOS;
  if (sonGun) {
    const surum = sonGun.matchVersion;
    const anchor = dayIndex(sonGun.date);
    const ayni = sirali.filter((g) => g.matchVersion === surum);
    const pencere = (from: number, to: number) => ayni.filter((g) => {
      const d = dayIndex(g.date);
      return d >= from && d <= to;
    });
    const cur = pencere(anchor - windowDays + 1, anchor);
    const prev = pencere(anchor - 2 * windowDays + 1, anchor - windowDays);
    const curToplam = sayacTopla(cur.flatMap((g) => Object.values(g.asistanlar)));
    manset = { gorunme: wilsonAraligi(curToplam.gorunen, curToplam.olculen), olcumSayisi: cur.length };
    // Onceki pencerede eski yontemli olcum varsa kiyas yok (versionedHeadline ile ayni kural)
    const eskiYontem = sirali.some((g) => g.matchVersion !== surum && dayIndex(g.date) >= anchor - 2 * windowDays + 1);
    if (!eskiYontem && prev.length > 0) {
      const k = ortakKapsam(prev, cur);
      haftalik = k ? karsilastir(k.once, k.sonra) : BOS;
    }
  }

  // Asistan trendleri ve etki: trend satirinin ilk/son gunu. Kiyaslanabilir
  // satir kurali web geo-impact.ts ile ayni (ilk ve son sayisal, farkli gun).
  const asistanlar: Record<string, AralikKarsilastirmasi> = {};
  const etkiOnce: GorunmeSayaci[] = [];
  const etkiSonra: GorunmeSayaci[] = [];
  let etkiEksik = false;
  for (const t of trends) {
    if (!t.firstDate || !t.lastDate || t.firstDate === t.lastDate) continue;
    if (typeof t.first !== 'number' || typeof t.last !== 'number') continue;
    const a = gunHaritasi.get(t.firstDate)?.asistanlar[t.provider];
    const b = gunHaritasi.get(t.lastDate)?.asistanlar[t.provider];
    if (!a || !b || !(a.olculen > 0) || !(b.olculen > 0)) {
      // Kosum kaydi yok (eski veri) ya da sayilacak cevap yok: bu asistanin
      // farki ve kartin toplam farki aralikla dogrulanamaz
      asistanlar[t.provider] = BOS;
      etkiEksik = true;
      continue;
    }
    asistanlar[t.provider] = karsilastir(a, b);
    etkiOnce.push(a);
    etkiSonra.push(b);
  }
  // Kartin ortalamasi kiyaslanabilir asistanlarin HEPSINDEN; biri eksikse
  // kalanlarla verilen karar baska bir kapsami anlatirdi → kiyas yok
  const etki = etkiOnce.length > 0 && !etkiEksik ? karsilastir(sayacTopla(etkiOnce), sayacTopla(etkiSonra)) : BOS;

  return { son, manset, haftalik, etki, asistanlar };
}
