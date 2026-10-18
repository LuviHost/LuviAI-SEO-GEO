/**
 * Tarama karsilastirmasi (GET /sites/:id/audit/compare) notlari — saf, test
 * edilir (compare-notes.spec.mts). Kurallar api audit/audit.service.ts
 * compareAuditRows'tan.
 */

/**
 * Genel skora GIREN kontroller = api audit/audit-checks.service.ts OVERALL_SCORE_WEIGHTS
 * anahtarlari. runAudit overallScore'u yalniz bu 14 kontrolden hesaplar
 * (computeOverallScore); PageSpeed, GEO ve AI gorunurluk ayri tutulur, crawlCoverage
 * yalniz kapsam kaydidir.
 *
 * NEDEN IZIN LISTESI: eskiden "girmeyenler" listesi tutuluyordu; o listede olmayan her
 * anahtar (eski taramalardaki ya da yeni eklenen skor disi bir olcum) genel skoru
 * etkiliyor sayilip "genel skor farkinin bir kismi yontemden" notu ve notr rozet
 * uretiyordu. CSV raporu (api analytics/reports.service.ts olcumYontemiNotu) ve
 * karsilastirmanin skorKapsamiFarkli listesi ayni OVERALL_SCORE_WEIGHTS kuralini
 * kullanir; panel de ayni seyi soylesin. compare-notes.spec.mts listeyi API
 * kaynagindaki tabloyla karsilastirir (kayarsa test kirilir).
 */
export const GENEL_SKOR_KONTROLLERI: ReadonlySet<string> = new Set([
  'sitemap_xml', 'robots_txt', 'llms_txt', 'schema_markup', 'meta_title', 'meta_description', 'open_graph',
  'twitter_card', 'canonical', 'https', 'h1_uniqueness', 'image_alt', 'internal_linking', 'hreflang',
]);

/** Kontrol genel skora giriyor mu (OVERALL_SCORE_WEIGHTS) */
export function feedsOverallScore(id: string): boolean {
  return GENEL_SKOR_KONTROLLERI.has(id);
}

/**
 * Genel skor farki "iyilesti / kotulesti" diye okunabilir mi?
 *
 * NEDEN: ust rozet farki yesil/kirmizi oklarla hukum gibi gosteriyordu. Genel
 * skora giren bir kontrolun olcum yontemi degistiyse (metodolojiDegisen) ya da
 * kontrol iki taramadan yalniz birinde olculebildiyse (kismi.skorKapsamiFarkli)
 * farkin bir kismi sitenin degil olcunun degisimidir; sayi gosterilir, hukum
 * verilmez. Yalniz GEO / AI gorunurluk yontemi degistiyse genel skor etkilenmez.
 */
export function overallDeltaComparable(cmp: {
  metodolojiDegisen?: string[] | null;
  kismi?: { skorKapsamiFarkli?: string[] | null } | null;
}): boolean {
  const yontem = (cmp.metodolojiDegisen ?? []).some(feedsOverallScore);
  const kapsam = (cmp.kismi?.skorKapsamiFarkli ?? []).length > 0;
  return !yontem && !kapsam;
}

/**
 * Olcum yontemi degisen kontroller notu.
 *
 * NEDEN: eski not her durumda "genel skor farkinin bir kismi yontemden
 * kaynaklaniyor" diyordu; yalniz AI gorunurluk (v3 → v4) ya da GEO yontemi
 * degistiginde genel skor hic etkilenmez ve not yanlis olurdu. API bu
 * kontrollerde fark hesaplamaz (durum 'metodoloji_degisti', delta 0; GEO'da
 * geoScoreDelta 0) ve sorunlarini cozulen / yeni saymaz.
 */
export function methodChangeNote(ids: string[], name: (id: string) => string = (id) => id): string {
  const parts = [`Ölçüm yöntemi güncellendi: ${ids.map(name).join(', ')}.`];
  if (ids.some(feedsOverallScore)) {
    parts.push('Genel skor farkının bir kısmı sitedeki bir değişiklikten değil yöntemden kaynaklanıyor olabilir.');
  }
  if (ids.includes('geo')) parts.push('GEO skor farkı bu yüzden hesaplanmadı.');
  if (ids.includes('aiCitations')) parts.push('AI görünürlük ölçümü iki taramada farklı yöntemle yapıldı; farkı hesaplanmadı.');
  parts.push(ids.length === 1 ? 'Bu kontrolün sorunları çözülen ya da yeni sayılmadı.' : 'Bu kontrollerin sorunları çözülen ya da yeni sayılmadı.');
  return parts.join(' ');
}

/** audit compare aiSaglayiciKapsami — iki taramada olculen asistan kumesi farkli */
export interface AiSaglayiciKapsami {
  ortak: string[];
  yalnizOnceki: string[];
  yalnizSonraki: string[];
}

/**
 * Asistan kapsami notu. API iki taramada olculen asistan kumesi farkliysa (biri
 * 429 / kota / anahtar yuzunden olculemediyse) AI gorunurluk farkini yalniz
 * ortak asistanlarin ortalamasiyla hesaplar; ortak yoksa satir uretmez. Iki
 * durumda da ai_citation sorunlari cozulen / yeni sayilmaz (devam edende kalir).
 */
export function aiProviderScopeNote(k: AiSaglayiciKapsami, providerName: (p: string) => string = (p) => p): string {
  const list = (xs: string[]) => xs.map(providerName).join(', ');
  const farklar: string[] = [];
  if (k.yalnizOnceki.length > 0) farklar.push(`${list(k.yalnizOnceki)} yalnız önceki taramada`);
  if (k.yalnizSonraki.length > 0) farklar.push(`${list(k.yalnizSonraki)} yalnız son taramada`);
  const giris = farklar.length > 0
    ? `AI görünürlük ölçümünde iki taramada ölçülen asistanlar farklı: ${farklar.join(', ')} ölçüldü.`
    : 'AI görünürlük ölçümünde iki taramada ölçülen asistanlar farklı.';
  const sonuc = k.ortak.length > 0
    ? `AI görünürlük farkı yalnız iki taramada da ölçülen asistanlar (${list(k.ortak)}) üzerinden hesaplandı; bu ölçümün sorunları çözülen ya da yeni sayılmadı.`
    : 'İki taramada da ölçülen ortak asistan olmadığı için AI görünürlük karşılaştırılmadı; bu ölçümün sorunları çözülen ya da yeni sayılmadı.';
  return `${giris} ${sonuc}`;
}
