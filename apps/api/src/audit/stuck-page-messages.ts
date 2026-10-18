/**
 * Takili sayfa uclarinin kullaniciya giden metinleri — tek yerde.
 *
 * NEDEN: tekil uc (GET / recover), toplu onarim satiri, dedektor (ignore) ve
 * kurtarma servisi ayni durum icin 'Stuck page bulunamadi' diyordu: yarisi
 * Ingilizce, Turkce karaktersiz. Toplu sonuc satirindaki `error` panelde ve
 * API anahtarli istemcide aynen gorunur. Metin burada sabit; uclar ve specler
 * bu sabiti kullanir ki biri degisip digeri eski kalmasin. Panel atlanan
 * kurtarmanin ve reddedilen geri almanin nedenini OLDUGU GIBI gosterir
 * (paylasilan sozlesme C5): metinler duzgun Turkce, kullaniciya ne oldugunu
 * ve ne yapabilecegini soyler.
 */
export const STUCK_PAGE_NOT_FOUND = 'Takılı sayfa bulunamadı.';

/** Geri alma (revert) icin istenen duzeltme kaydi bu sitede yok */
export const STUCK_RECOVERY_NOT_FOUND = 'Düzeltme kaydı bulunamadı.';

/** Makale akisina RanksUp disi sayfa geldi (dis sayfa servisi kullanilmali) */
export const STUCK_EXTERNAL_PAGE_IN_ARTICLE_FLOW = 'Bu sayfa RanksUp dışında yazılmış (makale kaydı yok); makale düzeltmesi uygulanamaz.';

/** Sunucuda yapay zeka anahtari tanimli degil — tekrar denemek sonucu degistirmez */
export const STUCK_AI_UNAVAILABLE = 'Yapay zekâ servisi yapılandırılmamış; düzeltme yapılamadı.';

/**
 * Yonetici yapay zeka islemlerini gecici olarak kapatti (AppSetting
 * AI_GLOBAL_DISABLED). Toplu onarim bunu kuyruga almadan once, worker ve
 * tekil "AI Düzelt" is kosarken soyler; panel nedeni aynen gosterir.
 */
export const STUCK_AI_DISABLED = 'RanksUp\'ta yapay zekâ işlemleri şu an geçici olarak kapalı; düzeltme yapılmadı. Daha sonra tekrar dene.';

/**
 * Toplu onarim: sayfa icin bekleyen ya da islenen bir duzeltme isi zaten var.
 * Ikinci is ayni yapay zeka ve GEO taramasini bosuna tekrarlardi.
 */
export const STUCK_ALREADY_QUEUED = 'Bu sayfa için bir düzeltme zaten sırada; ikinci kez kuyruğa alınmadı. Sonuç hazır olunca listede görünür.';

/**
 * Kuyruktaki is calismadan once sayfa zaten islendi (ornegin musteri arada
 * tekil "AI Düzelt"e bastı ve öneri kaydedildi ya da deneme başarısız oldu):
 * ayni duzeltme ikinci kez calistirilmaz.
 */
export const STUCK_PROCESSED_SINCE_REQUEST = 'Bu sayfa, düzeltme sıraya alındıktan sonra zaten işlendi; aynı düzeltme ikinci kez çalıştırılmadı.';

/** Worker: RanksUp disi sayfayi otopilot duzeltmez (yalniz kullanici baslatir) */
export const STUCK_EXTERNAL_AUTOPILOT_SKIP = 'Bu sayfa RanksUp dışında yazılmış; otopilot bu sayfaları otomatik düzeltmez. Takılı Sayfalar ekranındaki "AI Düzelt" ile düzeltebilirsin.';

/** Yazinin govdesi bos: duzeltilecek metin yok */
export const STUCK_ARTICLE_EMPTY = 'Yazının metni boş; düzeltilecek içerik yok.';

/** Kayitli makale silinmis (takili sayfa satiri eski) */
export const STUCK_ARTICLE_NOT_FOUND = 'Yazı bulunamadı; düzeltme yapılmadı.';

/**
 * Kayittaki metin canlida degil cunku GERCEKTEN bekleyen bir surum var: icerik
 * pivotu ya da kapali dongu yayindaki yazinin kaydini yeniden yazimla ezdi
 * (READY_TO_PUBLISH / REVIZE_NEEDED; canli metin yalniz liveSnapshot'ta).
 * Kurtarma o metni duzenleyip yayinlarsa onaylanmamis surum onaysiz canliya
 * cikar. NEDEN "reddedin" yok: yeniden yazimi reddedip canli metne donduren bir
 * eylem yok (liveSnapshot'i kayda geri yazan uc bulunmuyor); musteri ancak yeni
 * surumu gozden gecirip yayinlayabilir.
 */
export const STUCK_ARTICLE_PENDING_VERSION = 'Yazının henüz yayınlanmamış yeni bir sürümü var (yayına hazır ya da revize bekliyor). Takılı sayfa düzeltmesi yalnız yayındaki metin üzerinden yapılır: önce yazının sayfasından yeni sürümü gözden geçirip yayınla, sonra takılı sayfayı yeniden dene.';

/**
 * Yazi PUBLISHED ama son metni sitendeki bir kopyaya yazilamadi: kopya "elle
 * guncelleme bekliyor" (manualUpdatePending; yayinci yazamadigi ya da
 * secilmeyen canli kopyayi isaretler). Onay bekleyen bir surum YOK; musteri
 * kopyayi Yayin Gecmisi'nden gunceller (yeniden yayin ya da metni yapistirip
 * "Elle güncelledim").
 */
export const STUCK_ARTICLE_LIVE_COPY_BEHIND = 'Yazının son metni sitendeki kopyaya henüz yazılmadı; kopya güncellenmeyi bekliyor. Takılı sayfa düzeltmesi yalnız yayındaki metin üzerinden yapılır: önce yazının sayfasındaki Yayın Geçmişi\'nden kopyayı güncelle, sonra takılı sayfayı yeniden dene.';

/**
 * Yazi PUBLISHED, hicbir kopya isaretli degil ama kayittaki metin hedefe en
 * son giden metin degil: yayinlanmadan uygulanan bir degisiklik (capraz
 * baglanti, snippet onerisi kayda yazilir, yayinlanmaz) ya da nedeni kayitli
 * olmayan bir fark. Kesin neden bilinmedigi icin metin "ornegin" der.
 */
export const STUCK_ARTICLE_UNPUBLISHED_CHANGES = 'Yazının kayıttaki metni sitende yayında olan metinle aynı değil (örneğin uygulanan bir çapraz bağlantı ya da snippet henüz yayınlanmadı). Takılı sayfa düzeltmesi yalnız yayındaki metin üzerinden yapılır: önce yazıyı kendi sayfasından yeniden yayınla, sonra takılı sayfayı yeniden dene.';

/** Yazi su an yeniden uretiliyor (GENERATING / EDITING) */
export const STUCK_ARTICLE_REWRITING = 'Yazı şu an yeniden yazılıyor; yeni sürüm hazır olunca yazının sayfasından gözden geçirip yayınla, sonra takılı sayfayı yeniden dene.';

/** Yazi yayinda degil (taslak, arsiv, basarisiz uretim...) */
export const STUCK_ARTICLE_NOT_LIVE = 'Yazı şu an yayında değil; takılı sayfa düzeltmesi yalnız yayındaki yazıda yapılır.';

/** Duzeltme hazirlanirken (yapay zeka cagrisi surerken) yazinin metni degisti */
export const STUCK_ARTICLE_CHANGED_DURING_RECOVERY = 'Yazı düzeltme hazırlanırken değişti; düzeltme uygulanmadı. Sayfayı yenileyip tekrar dene.';

/** Geri alma: duzeltme zaten geri alinmis */
export const STUCK_REVERT_ALREADY_DONE = 'Bu düzeltme zaten geri alındı.';

/** Geri alma: RanksUp disi sayfanin duzeltmesi (sunucudaki dosya) otomatik geri alinmaz */
export const STUCK_REVERT_EXTERNAL = 'Bu düzeltme RanksUp dışı bir sayfaya ait; otomatik geri alınamaz. Önceki metni düzeltme kaydında görüp sayfana elle geri yükleyebilirsin.';

/**
 * Geri alma: yazinin metni bu duzeltmeden sonra degisti (onaylanan yeniden
 * yazim, capraz link, snippet uygulamasi...). Eski metni yazmak sonraki
 * degisiklikleri hem kayittan hem canli sayfadan silerdi.
 */
export const STUCK_REVERT_ARTICLE_CHANGED = 'Yazı bu düzeltmeden sonra değişti; geri almak sonraki değişiklikleri de silerdi. Geri alma yapılmadı; önceki metni düzeltme kaydında görüp gerekirse elle uygulayabilirsin.';

/** Geri alma: sayfanin durumu tiklama ile yazim arasinda degisti */
export const STUCK_REVERT_STATE_CHANGED = 'Sayfanın durumu bu arada değişti; geri alma yapılmadı. Sayfayı yenileyip tekrar dene.';

/**
 * Sayfa bu durumdayken kurtarma baslamaz (ne yazi degisir ne yapay zeka
 * cagrilir). Otopilot yalniz "Tespit edildi" sayfayi, kullanici "Basarisiz"
 * sayfayi da duzeltebilir (panel canRecover ile ayni).
 */
export function stuckStatusSkipText(status: unknown, autopilot: boolean): string {
  switch (String(status ?? '')) {
    case 'RECOVERING':
      return 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.';
    case 'RECOVERED':
      return 'Sayfa zaten düzeltildi; ikinci bir düzeltme uygulanmadı.';
    case 'REVERTED':
      return 'Bu sayfanın düzeltmesi geri alınmış; sayfa otomatik yeniden düzeltilmez.';
    case 'IGNORED':
      return 'Sayfa yok sayılmış (Gözardı); hiçbir şey değiştirilmedi.';
    case 'FAILED':
      return autopilot
        ? 'Önceki düzeltme denemesi başarısız oldu; otopilot sayfayı yeniden denemez. "AI Düzelt" ile elle deneyebilirsin.'
        : 'Sayfa düzeltmeye uygun değil; hiçbir şey değiştirilmedi.';
    default:
      return 'Sayfa düzeltmeye uygun değil; hiçbir şey değiştirilmedi.';
  }
}
