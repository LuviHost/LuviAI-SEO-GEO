/**
 * Site basina OTOMATIK uretim tavani (08.11.2026 kanit denetimi).
 *
 * NEDEN: takvim haftada 2 yazi koyuyordu ama site basina ust sinir yoktu; ayni gune yigilan takvim,
 * Kurumsal'in ayda 350 yazisi ya da toplu planlama bir siteye gunde onlarca yapay zeka yazisi
 * cikarabilirdi. Google: "a high quantity of pages doesn't make a website higher quality" ve yapay
 * zekayla deger katmadan cok sayfa uretmek olcekli icerik kotuye kullanimi (spam politikasi). Sayiyla
 * vakasi (gunde 9'a varan yayin, bir gunde 370 → 3 gosterim) ayni riski gosteriyor.
 *
 * Kapsam: yalniz otomasyonun takvimden aldigi yazilar (saatlik tarama + gecikmeli takvim isi). Kullanicinin
 * elle baslattigi uretim (Uret, Simdi uret, MCP) ve mevcut yazinin yeniden yazimi sayilmaz. Tavan doluysa
 * yazi SCHEDULED kalir; ertesi gun ya da hafta acilinca uretilir (hak dusmez).
 *
 * Sayac kv_store'da gun anahtariyla tutulur (TR gunu): uretimi biten yazinin agentOutputs isareti
 * silindigi icin makale tablosundan geriye donuk sayilamiyor.
 */

/** Site basina TR gununde en cok otomatik uretim */
export const SITE_GUNLUK_OTO_TAVAN = 1;
/** Site basina son 7 TR gununde en cok otomatik uretim */
export const SITE_HAFTALIK_OTO_TAVAN = 5;

const TR_OFFSET_MS = 3 * 3_600_000;

/** TR takvim gunu (YYYY-MM-DD) */
export function trGunAnahtari(d: Date): string {
  return new Date(d.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);
}

export function sayacAnahtari(siteId: string, gun: string): string {
  return `oto-uretim:${siteId}:${gun}`;
}

/** Bugun dahil son 7 TR gununun anahtarlari (bugun ilk) */
export function son7GunAnahtarlari(siteId: string, simdi: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => sayacAnahtari(siteId, trGunAnahtari(new Date(simdi.getTime() - i * 86_400_000))));
}

/** Okunan sayaclardan karar: { bugun, hafta } → tavan acik mi */
export function tavanAcikMi(o: { bugun: number; hafta: number }): boolean {
  return o.bugun < SITE_GUNLUK_OTO_TAVAN && o.hafta < SITE_HAFTALIK_OTO_TAVAN;
}
