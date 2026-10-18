/**
 * Ads otopilot gecmisi (AdCampaign.autopilotActions) A/B kayitlarinin metni —
 * saf, test edilir (ads-history.spec.mts).
 *
 * Kayit bicimi api ads/ab-test-manager.service.ts pickWinners (her reklam grubu
 * / reklam seti icin ayri kayit):
 *  - 'ab-test-winner' { groupId, groupName?, pausedCount, failedCount,
 *    uncertainCount?, pausedAdIds?, reason? }: pausedCount YALNIZ platformun
 *    onayladigi duraklatmalar; basarisiz olan varsa failedCount ve platformun
 *    nedeni (reason) ayri; uncertainCount sonucu bilinmeyen istekler
 *    (duraklatilmis da olabilir, olmayabilir de).
 *  - 'ab-test-pause-failed' { groupId, failedCount, reason? }: hicbir reklam
 *    duraklatilamadi (platform reddetti).
 *
 * groupId'siz kayitlar S10 duzeltmesinden ONCEKI surumden: reklam grubu
 * gozetilmeden tum kampanya karsilastiriliyordu; grup adi bu yuzden yazilmaz.
 * Istisna: bir turun gecmise sigmayan gruplari tek OZET kayitta birlesir
 * (api abSummaryEntry: groupId yok, groupCount birlesen grup sayisi, sayilar
 * toplam) — metin "N reklam grubunun toplamı" der.
 * pausedAdIds kesilmis olabilir (grup kaydinda 10, ozette 100 kimlik):
 * pausedAdIdsTotal (ya da pausedAdIdsTruncated) varsa metin "ilk N" der.
 *
 * ESKI KAYITLAR: onceki surum sonuclara bakmadan pausedCount = kaybeden varyant
 * sayisi yaziyordu (platform reddetse de). failedCount'suz bir kayit eski de
 * olabilir, hepsi onaylanmis yeni bir kayit da; ikisi ayirt edilemez. Bu yuzden
 * failedCount yoksa "duraklatildi" denmez, yalniz duraklatma icin secildigi
 * soylenir (ikisi icin de dogru). failedCount varsa (0 dahil) sayi onaylidir.
 */
const sayi = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

const grupKimligi = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Kaydin ait oldugu grup: "Reklam grubu “Marka”" (Google) / "Reklam seti
 * “Trafik”" (Meta); ad yoksa kimlik. Ozet kayitta (groupId yok, groupCount var)
 * "N reklam grubunun toplamı" / "N reklam setinin toplamı": sayilar tek grubun
 * degil, birlesen gruplarin toplamidir. Eski kayitta (ikisi de yok) null.
 */
export function abTestGroupLabel(a: { groupId?: unknown; groupName?: unknown; groupCount?: unknown }, platform?: unknown): string | null {
  const id = grupKimligi(a.groupId);
  if (!id) {
    const adet = sayi(a.groupCount);
    if (adet === null || adet < 1 || !Number.isInteger(adet)) return null;
    return `${adet} ${platform === 'meta_ads' ? 'reklam setinin' : 'reklam grubunun'} toplamı`;
  }
  const tur = platform === 'meta_ads' ? 'Reklam seti' : 'Reklam grubu';
  const ad = typeof a.groupName === 'string' && a.groupName.trim() ? a.groupName.trim() : null;
  return ad ? `${tur} “${ad}”` : `${tur} ${id}`;
}

/** A/B kaydinin ayrinti metni; A/B kaydi degilse null */
export function abTestDetail(
  a: { action?: unknown; pausedCount?: unknown; failedCount?: unknown; uncertainCount?: unknown; groupId?: unknown; groupName?: unknown; groupCount?: unknown },
  platform?: unknown,
): string | null {
  const failed = sayi(a.failedCount);
  const grup = abTestGroupLabel(a, platform);
  const onEk = grup ? `${grup}: ` : '';
  if (a.action === 'ab-test-pause-failed') {
    return onEk + (failed && failed > 0 ? `${failed} varyant duraklatılamadı` : 'Diğer varyantlar duraklatılamadı');
  }
  if (a.action !== 'ab-test-winner') return null;
  const paused = sayi(a.pausedCount);
  if (failed === null) {
    return paused && paused > 0 ? `${onEk}${paused} varyant duraklatılmak üzere seçildi` : null;
  }
  const uncertain = sayi(a.uncertainCount);
  const parts: string[] = [];
  if (paused && paused > 0) parts.push(`${paused} varyant duraklatıldı`);
  if (failed > 0) parts.push(`${failed} varyant duraklatılamadı`);
  // Istek gitti ama sonucu bilinmiyor: "duraklatılamadı" yanlis olabilirdi
  if (uncertain && uncertain > 0) parts.push(`${uncertain} varyantın duraklatılıp duraklatılmadığı doğrulanamadı, reklam hesabında kontrol et`);
  return parts.length > 0 ? onEk + parts.join(', ') : null;
}

/**
 * Kazananin oran etiketi. Yeni Meta kayitlari baglanti tiklama oranini
 * (inline_link_clicks / gosterim) tasir; eski Meta kayitlari ve Google tum
 * tiklamalarin oranini.
 */
export function abWinnerRateLabel(a: { groupId?: unknown }, platform?: unknown): string {
  return platform === 'meta_ads' && grupKimligi(a.groupId) ? 'Kazanan bağlantı tıklama oranı' : 'Kazanan tıklama oranı';
}

/**
 * Duraklatilan reklamlarin kimlikleri: musteri reklam hesabinda bulup isterse
 * yeniden acabilsin (yeniden actigi reklami otopilot bir daha duraklatmaz).
 * Kayit listeyi kesmis olabilir (api ab-test-manager.service.ts pausedIdsFields):
 * pausedAdIdsTotal listedekinden buyukse ya da pausedAdIdsTruncated true ise
 * "ilk N kimliği" denir. NEDEN: metin "kimlikleri" deyip kesilmis listeyi tam liste
 * gibi gosteriyordu; listede olmayan reklamlar hic duraklatilmamis sanilirdi (S10
 * yan etkisi). Iki alan da yoksa (eski kayit, kesilmemis liste) liste tamdir.
 */
export function abPausedAdsText(a: { pausedAdIds?: unknown; pausedAdIdsTotal?: unknown; pausedAdIdsTruncated?: unknown }): string | null {
  if (!Array.isArray(a.pausedAdIds)) return null;
  const ids = a.pausedAdIds.filter((x): x is string => typeof x === 'string' && /^\d{1,32}$/.test(x));
  if (ids.length === 0) return null;
  const toplam = sayi(a.pausedAdIdsTotal);
  if (toplam !== null && toplam > ids.length) return `Duraklatılan ${toplam} reklamın ilk ${ids.length} kimliği: ${ids.join(', ')}`;
  if (a.pausedAdIdsTruncated === true) return `Duraklatılan reklamların ilk ${ids.length} kimliği: ${ids.join(', ')}`;
  return `${ids.length === 1 ? 'Duraklatılan reklamın kimliği' : 'Duraklatılan reklamların kimlikleri'}: ${ids.join(', ')}`;
}

/**
 * Kayittaki reason'in ne oldugu: A/B kayitlarinda duraklatmanin NEDEN
 * basarisiz oldugu (reklam istemcisinin / platformun hata metni,
 * google-ads-client setAdStatus); negatif anahtar kelimede AI'in gerekcesi.
 * Etiketsiz tirnak icinde gosterilince hata metni otopilotun gerekcesi gibi
 * okunuyordu.
 */
export function historyReasonLabel(action: unknown): string | null {
  return action === 'ab-test-winner' || action === 'ab-test-pause-failed' ? 'Duraklatma hatası' : null;
}
