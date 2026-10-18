/**
 * "Bağlantıyı test et" sonucunun kullaniciya gosterilen metni.
 *
 * NEDEN AYRI: PublishTargetsService.testConnection eskiden adaptorde hic
 * olmayan testConnection() metodunu ariyordu; hicbir adaptor onu tanimlamadigi
 * icin dugme istek atmadan "Bu adapter test fonksiyonu sunmuyor" diyordu.
 * Artik her adaptorun ortak test() metodu (packages/adapters/src/base.ts)
 * cagrilir — ama basarili bir test() her tipte AYNI seyi kanitlamaz. Buradaki
 * metinler adaptorlerin test() govdelerine gore yazildi; bir adaptorun test()
 * davranisi degisirse bu tablo da guncellenmeli.
 */

/**
 * Basarili test() NEYI kanitliyor. Mesaj kanitlanandan fazlasini soylemez:
 * "test gecti" gorup ilk yayinda 401 alan musteri yaniltilmis olur.
 */
const TEST_PROVES: Readonly<Record<string, string>> = {
  // GET /wp-json/wp/v2/users/me, Basic auth — 200 + kullanici kaydi; oturum yoksa 401
  // (wordpress-rest.ts test()). Yazi olusturma yetkisi (rol) okunmaz.
  WORDPRESS_REST: 'WordPress kullanıcı adı ve uygulama şifresi doğrulandı. Yazı oluşturma yetkisi ilk yayında denenir.',
  // POST xmlrpc.php wp.getUsersBlogs — giris yapar, yanlis kimlikte <fault> 403 (wordpress-xmlrpc.ts test())
  WORDPRESS_XMLRPC: 'XML-RPC ile kullanıcı adı ve şifre doğrulandı. Yazı oluşturma yetkisi ilk yayında denenir.',
  // client.access / sftp.connect — sunucuya giris yapilir, dosya yazilmaz
  FTP: 'Sunucuya bağlanıldı ve giriş yapıldı. Klasöre yazma izni ilk yayında denenir.',
  SFTP: 'Sunucuya bağlanıldı ve giriş yapıldı. Klasöre yazma izni ilk yayında denenir.',
  // GET /execute/Variables/get_user_information, token basligiyla
  CPANEL_API: "cPanel API'ye token ile erişildi.",
  // octokit.repos.get — okuma; yazma izni denenmez
  GITHUB: 'Depoya token ile erişildi. Yazma izni ilk yayında denenir.',
  WEBFLOW: "Webflow API'ye token ile erişildi.",
  SANITY: 'Sanity projesine ve veri kümesine erişildi.',
  CONTENTFUL: 'Contentful alanına (space) erişildi.',
  // GET /ghost/api/admin/posts/ — kimlik ister (ghost.ts test())
  GHOST: 'Ghost Admin API anahtarı doğrulandı.',
  // GET /api/{koleksiyon} — okuma; kayit ekleme izni denenmez (strapi.ts test())
  STRAPI: 'Token koleksiyonu okuyabiliyor. Kayıt ekleme izni ilk yayında denenir.',
  // GetActivityLog — kimlik + IP/erisim anahtari dogrulanir (whmcs-kb.ts test())
  WHMCS_KB: 'WHMCS API kimlik bilgileri doğrulandı.',
  // OPTIONS, 500 alti her yanit (custom-php.ts test())
  CUSTOM_PHP: 'Uç nokta yanıt verdi. HMAC imzası bu testte denenmez; ilk yayında doğrulanır.',
  KOBIPRATIK: "KobiPratik API'ye anahtar ile erişildi.",
};

/**
 * Bu tiplerde test() anlamsiz ya da GUVENILMEZ: istek atilmaz, "test yok" denir
 * (yanit tested:false; panel notr gosterir). Yanlis "bağlanılamadı" calisan
 * hedefi bozuk gosterip musteriyi yaniltir.
 *
 *  - MARKDOWN_ZIP: uzak sunucu yok; test() kosulsuz true doner.
 *
 * WORDPRESS_XMLRPC eskiden buradaydi: adaptor xmlrpc.php'ye GET atiyordu ve
 * WordPress POST disindaki istege 405 doner (class-IXR-server.php serve()).
 * Test artik POST wp.getUsersBlogs ile kimligi dogruluyor.
 */
const TEST_NOT_AVAILABLE: Readonly<Record<string, string>> = {
  MARKDOWN_ZIP: 'Markdown ZIP uzak bir sunucuya bağlanmaz; bağlantı testi gerekmez.',
};

/** Basarisiz testte "Kontrol et: ..." listesine eklenen, kaynagi dogrulanmis ipuclari */
const FAILURE_HINTS: Readonly<Record<string, string>> = {
  // https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/ — Basic auth
  // uygulama sifresiyle (WordPress 5.6+), sifre kullanici duzenleme ekraninda uretilir
  WORDPRESS_REST: "App Password alanına WordPress giriş şifren değil, WP-Admin'de Profil ekranının Application Passwords bölümünde oluşturduğun uygulama şifresi girilmeli.",
  // class-wp-xmlrpc-server.php: varsayilan acik, xmlrpc_enabled filtresiyle kapanir (set_is_enabled);
  // kapaliyken login() 405 "XML-RPC services are disabled on this site." doner. Uygulama sifresi 5.6+
  // (make.wordpress.org/core/2020/11/05/application-passwords-integration-guide)
  WORDPRESS_XMLRPC: 'Sitede XML-RPC bir eklentiyle kapatılmış olabilir (WordPress\'te varsayılan olarak açıktır). WordPress 5.6 ve sonrası için WordPress (REST API) hedefini uygulama şifresiyle kullanabilirsin.',
  // https://docs.ghost.org/admin-api — "id and secret, separated by a colon"
  GHOST: "Admin API Key, Ghost Admin → Integrations ekranındaki Custom Integration anahtarı olmalı ('id:secret' biçiminde).",
  STRAPI: "Koleksiyon adı çoğul API kimliği olmalı (ör. articles) ve token'ın bu koleksiyonu okuma izni bulunmalı.",
  // https://developers.whmcs.com/api/access-control/ — "Access to the API by default is restricted by IP"
  WHMCS_KB: 'WHMCS API varsayılan olarak IP ile kısıtlıdır: IP izni vermediysen Erişim anahtarı alanına configuration.php içindeki $api_access_key değerini gir.',
};

export interface TestOutcome {
  ok: boolean;
  message: string;
  /** false: istek atilmadi (bkz. TEST_NOT_AVAILABLE) — ok:true ise panel notr gosterir (settings-tab.tsx) */
  tested: boolean;
}

/** Test atlanacaksa kullaniciya gosterilecek metin, yoksa null */
export function testNotAvailableMessage(type: string): string | null {
  return TEST_NOT_AVAILABLE[type] ?? null;
}

export function testSuccessMessage(type: string, label: string): string {
  const proves = TEST_PROVES[type];
  return proves ? `Bağlantı başarılı: ${proves}` : `${label} bağlantı testi başarılı.`;
}

/**
 * @param requiredFieldLabels katalogdaki zorunlu kimlik alanlarinin etiketleri
 *   (formda gordugu adlarla — "API URL", "Admin API Key"...)
 */
export function testFailureMessage(type: string, label: string, requiredFieldLabels: string[]): string {
  // Neden ayrimi yok: test() yalniz true/false doner (bicimsiz anahtar, 401,
  // ulasilamayan sunucu ayni sonuc) — metin bilinmeyen nedeni uydurmaz
  const parts = [`${label} bağlantı testi başarısız.`];
  if (requiredFieldLabels.length > 0) parts.push(`Kontrol et: ${requiredFieldLabels.join(', ')}.`);
  const hint = FAILURE_HINTS[type];
  if (hint) parts.push(hint);
  return parts.join(' ');
}

export const TEST_TIMED_OUT = Symbol('publish-target-test-timeout');

/**
 * test() en fazla `ms` beklenir. NEDEN: korumali baglanti 10 sn'de kurulur
 * ama kurulan baglantida yanit vermeyen sunucu undici varsayilaniyla
 * dakikalarca bekletir; panel "test ediliyor" diye asili kalir ya da ters
 * vekilin zaman asimi genel bir hata gosterir. Adaptorun istegi iptal
 * edilmez (FTP/SFTP/HTTP kendi zaman asimlariyla kapanir); yalniz beklemeyi
 * birakip anlasilir bir mesaj doneriz.
 */
export function withTestTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TEST_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TEST_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TEST_TIMED_OUT), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
