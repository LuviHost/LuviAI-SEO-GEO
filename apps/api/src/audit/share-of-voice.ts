/**
 * Share of Voice — TEK tanim.
 *
 * NEDEN AYRI DOSYA: ayni metrik iki serviste ayri ayri hesaplaniyordu ve
 * ayni site icin FARKLI sayi donuyorlardi.
 *
 *   ai-citation.service.ts (eski) : marka probe basina 1 sayiliyor, ama
 *     yapilandirilmis rakipler ham anilma adediyle toplaniyordu — bir cevapta
 *     5 kez gecen rakip 5 puan aliyordu. Kesfedilen domainler ise yine probe
 *     basina 1'di. Ayni sutunda UC ayri birim vardi ve marka sistematik
 *     olarak dusuk cikiyordu.
 *
 *   ai-kpis.service.ts (eski)     : ikili sayim (var/yok) — birim tutarli.
 *
 * KANONIK BIRIM: "kac cevapta gorundu". Her taraf icin ayni, probe basina en
 * fazla 1. Aciklanabilir bir sey olcuyor ve iki hesap ayrisamaz.
 *
 * DIKKAT — girdi farki formul farki DEGILDIR: ai-kpis GeoPromptRun'dan
 * okudugu icin yalnizca yapilandirilmis rakip listesini gorur; cevaptan
 * kesfedilen domainler o tabloya yazilmiyor (bkz. mentionedDomains, yalnizca
 * AiCitationSnapshot.probes JSON'inda duruyor). Bu yuzden iki servis ayni
 * formulle farkli genislikte bir rakip kumesi uzerinden calisir. Kesfedilen
 * domainlerin kalici hale gelmesi ayri bir is (atif kaynagi zaman serisi).
 */

/** Tek bir cevabin (probe/run satiri) gorunurluk ozeti. */
export interface SovObservation {
  /** Marka bu cevapta gecti mi */
  brandPresent: boolean;
  /** Bu cevapta gorunen rakip/domain adlari. Tekillestirme burada yapilir. */
  rivals: string[];
}

export interface SovEntry {
  name: string;
  /** Kac cevapta gorundu (ham anilma adedi DEGIL) */
  mentions: number;
  pct: number;
  isBrand?: boolean;
}

/** Ham sayimlar — marka ve rakip basina "kac cevapta gorundu". */
function tallyShareOfVoice(observations: SovObservation[]): {
  brand: number;
  rivals: Map<string, number>;
  total: number;
} {
  const rivals = new Map<string, number>();
  let brand = 0;

  for (const o of observations) {
    if (o.brandPresent) brand++;
    // Ayni cevapta ayni ad iki kez sayilmasin — birim "cevap", "anilma" degil.
    // Tekillestirme trim'lenmis ad uzerinden: "a.com" ile "a.com " ayni sey.
    for (const name of new Set(o.rivals.map((n) => String(n ?? '').trim()))) {
      if (!name) continue;
      rivals.set(name, (rivals.get(name) ?? 0) + 1);
    }
  }

  const total = brand + [...rivals.values()].reduce((a, b) => a + b, 0);
  return { brand, rivals, total };
}

/**
 * Markanin payi — tek sayi, bir ondalik. Olculecek hicbir sey yoksa null
 * (sifir degil: "rakip de yok, biz de yokuz" ile "%0 pay" ayni sey degil).
 */
export function brandSharePct(observations: SovObservation[]): number | null {
  const { brand, total } = tallyShareOfVoice(observations);
  if (total <= 0) return null;
  return Math.round((brand / total) * 1000) / 10;
}

/** Siralanmis tam liste — marka basta, rakipler gorunurluge gore. */
export function shareOfVoiceList(observations: SovObservation[], brandName: string): SovEntry[] {
  const { brand, rivals, total } = tallyShareOfVoice(observations);
  if (total <= 0) return [];

  const out: SovEntry[] = [
    { name: brandName, mentions: brand, pct: Math.round((brand / total) * 100), isBrand: true },
  ];
  for (const [name, mentions] of [...rivals.entries()].sort((a, b) => b[1] - a[1])) {
    out.push({ name, mentions, pct: Math.round((mentions / total) * 100) });
  }
  return out;
}

/**
 * "Bu cevapta hangi rakipler gorundu" — yapilandirilmis rakip listesinden.
 * Esik kurali (mentions > 0) iki serviste ayri ayri yaziliyordu; degisirse
 * dashboard SoV'u ile snapshot SoV'u yine ayrisirdi. Tek yer burasi.
 */
export function rivalsFromCompetitors(
  competitors: Array<{ name?: unknown; mentions?: unknown }> | null | undefined,
): string[] {
  return (Array.isArray(competitors) ? competitors : [])
    .filter((c) => Number(c?.mentions ?? 0) > 0)
    .map((c) => String(c?.name ?? ''))
    .filter(Boolean);
}
