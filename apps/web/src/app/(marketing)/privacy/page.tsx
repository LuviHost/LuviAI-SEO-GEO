'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import {
  CONSENT_CHANGE_EVENT,
  browserConsentStorage,
  openCookiePreferences,
  readConsent,
  type ConsentState,
} from '@/lib/consent';

/**
 * Cerez bolumu (4) NEDEN yeniden yazildi: eski metin "Analytics icin Plausible
 * (cookie-free) tercih edilir" diyordu; sitede Plausible yok. Gercekte Google
 * Tag Manager (GA4, Google Ads donusum + yeniden pazarlama) ve Microsoft
 * Clarity kullaniliyor ve artik yalniz onayla yukleniyor (lib/consent.ts).
 * Liste koddan dogrulandi: Auth.js cerezleri (@auth/core defaultCookies,
 * auth.ts maxAge 30 gun), luviai_admin_unlocked (lib/admin-unlock.ts, 24 saat),
 * luvi_ref (ref-tracker.tsx, middleware.ts: 60 gun), luvi_lsid / luvi_utm
 * (lib/landing-track.ts: suresiz localStorage; yalniz ana sayfa bilesenleri ve
 * onboarding'deki signup_complete cagirir; landing_events'te IP yok, ua,
 * yol, referrer, utm var), AI tarayici sayaci (tracker.controller.ts: cerezsiz,
 * IP yazilmaz). Arac cerezleri: GA4 _ga/_ga_<id> 2 yil
 * (https://support.google.com/analytics/answer/11397207), Google Ads _gcl_*
 * 90 gun (https://business.safety.google/adscookies/), Clarity _clck 1 yil ve
 * _clsk 1 gun (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies
 * ile clarity-js types/data.d.ts Setting.Expire=365, SessionExpire=1), Cloudflare
 * guvenlik cerezleri zorunlu (https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/,
 * KVKK cerez rehberi 5.10). KVKK rehberi 9: aydinlatmada cerezin adi, amaci,
 * suresi ve birinci/ucuncu taraf oldugu bilgisine yer verilmesi tavsiye edilir;
 * 7.3: riza geri alinabilir olmali.
 * Yeni bir arac ya da GTM etiketi eklenirse bu liste ve bant metni ayni committe
 * guncellenmeli.
 */

const CONTENT = {
  tr: {
    backHome: '← Ana sayfa',
    titleA: 'Gizlilik',
    titleB: 'Politikası',
    effective: 'Yürürlük: 27 Nisan 2026',
    // Icerik degisti (cerez bolumu; KVKK silme yollari + silme sonrasi fatura saklama; bolum 5
    // kaldirilan sosyal medya baglantilari, bolum 6 kullanilmayan saglayicilar; bolum 2 artik
    // "pazarlama amacli paylasilmaz" demiyor, pazarlama paylasiminin yalniz onayla yuklenen Google
    // reklam etiketleriyle oldugunu soyluyor). Yururluk tarihi korunur; okuyan metnin degistigini
    // gorsun diye son guncelleme ve not ayrica yazilir. Bolum 2 duzeltmesi de notta: okuyan,
    // onceki metnin tersini soyledigi bir iddianin degistigini gormeli. luvi_ref maddesine eklenen
    // ortaklik paneli cumlesi de notta: ortaga hangi verinin gittigi yeni bir bilgi.
    // 21 Ekim 2026: RanksUp Video (bolum 1 maddesi + bolum 6 cumlesi) eklendi, notun sonunda.
    // Tarih bu icerigin yayin gunu (21 Ekim 2026); KVKK sayfasindaki tarih de ayni gun.
    updated: 'Son güncelleme: 21 Ekim 2026',
    changeNote: 'Değişiklik: çerezler bölümü yeniden yazıldı (kullanılan araçlar, amaçları, süreleri ve onayın nasıl geri alınacağı); hesap silme yolları (mobil uygulama ve web paneli) ile silme sonrası fatura ve ödeme kayıtlarının saklanması eklendi; kaldırılan sosyal medya bağlantıları bölümü güncellendi ve artık kullanılmayan yapay zekâ sağlayıcıları (HeyGen, Runway, ElevenLabs) listeden çıkarıldı; veri kullanımı bölümü (2), pazarlama amaçlı veri paylaşımının yalnız onayınızla yüklenen Google reklam etiketleriyle (dönüşüm ölçümü ve yeniden pazarlama) yapıldığını belirtecek şekilde düzeltildi; çerezler bölümündeki ortaklık bağlantısı (luvi_ref) maddesine, sizi davet eden iş ortağının ortaklık panelinde hakkınızda neleri gördüğü eklendi; RanksUp Video için sitenizden okunan marka bilgileri ve üretilen video dosyaları (1. bölüm) ile video metni için yapay zekâ kullanımı (6. bölüm) eklendi; aynı gün site ve ürün tanıtım videoları için okunan sayfa metni ve ürün görseli de bu iki bölüme eklendi.',
    s1: '1. Toplanan Veriler',
    s1items: [
      'Hesap bilgileri: email, ad, varsa profil fotoğrafı',
      'Site bilgileri: URL, marka adı, niş',
      'GSC OAuth tokens (AES-256-GCM şifreli)',
      'Publish hedefi credentials (FTP/SFTP/WP, AES-256-GCM şifreli)',
      "Ödeme bilgileri PayTR'de saklanır, biz kart numarası tutmayız",
      // RanksUp Video (api videos/): marka sitenin herkese acik sayfasindan okunur, dosyalar
      // apps/api/public/videos/<siteId>/ altinda (nginx /videos/); video silinince, site silinince
      // ve hesap kalici silinince dosyalar da silinir (videos.service remove, sites.service remove,
      // account-purge.service). Davranis degisirse bu madde (TR + EN) ayni committe.
      'RanksUp Video: video istediğinizde sitenizin herkese açık sayfalarından okunan ad, logo ve tema rengi; site ya da ürün tanıtım videosu istediğinizde ayrıca sitenizin ana sayfasının ya da belirttiğiniz ürün/hizmet sayfasının metni ve ürün görseli; üretilen video dosyası ve kapak görseli. Video dosyaları tahmin edilmesi güç bir bağlantıyla sunucularımızda saklanır, bağlantıyı bilen herkes açabilir; videoyu ya da siteyi sildiğinizde ve hesabınız kalıcı olarak silindiğinde dosyalar da silinir',
    ],
    s2: '2. Veri Kullanımı',
    // Bolum 2 NEDEN degisti: eski metin "sadece hizmet sunumu" ve "pazarlama amacli
    // paylasilmaz" diyordu; oysa onay veren ziyaretcide Google Ads donusum olcumu ve
    // yeniden pazarlama etiketleri (bant: cookie-consent.tsx, bolum 4) ziyaret verisini
    // reklam icin Google'a gonderir. Dogrusu: satis yok; pazarlama paylasimi yalniz bu
    // onayli Google etiketleriyle. GTM container'ina baska bir pazarlama etiketi (Meta
    // Pixel, LinkedIn vb.) eklenirse bu paragraf, bolum 4 ve bant ayni committe guncellenmeli.
    s2p: 'Hesap, site, bağlantı ve ödeme bilgileriniz (1. bölüm) hizmeti sunmak için kullanılır: AI içerik üretimi, SEO denetimi, GSC analizi ve yayın otomasyonu. Verileriniz üçüncü taraflara satılmaz. Pazarlama ve yeniden pazarlama için veri paylaşımı yalnız çerez bandında “Kabul et” derseniz yüklenen Google etiketleriyle olur: Google Ads dönüşüm ölçümü ve yeniden pazarlama, reklamlarımızın kayıt ve satın almaya dönüşüp dönüşmediğini ölçer ve sitemizi ziyaret edenlere Google’da reklamlarımızın gösterilmesini sağlar. Analitik araçlar (Google Analytics 4, Microsoft Clarity) da yalnız bu onayla yüklenir; kabul etmezseniz hiçbiri yüklenmez. Araçların listesi, çerezleri ve onayınızı nasıl geri alacağınız 4. bölümdedir.',
    s3: '3. Veri İşleme Konumu',
    s3p: "Sunucularımız LuviHost İstanbul veri merkezinde bulunur. Yedeklemeler S3-compatible storage'da Frankfurt bölgesinde tutulur. AI çağrıları Anthropic (US) ve Google (multi-region) servislerine gider.",
    s4: '4. Çerezler ve Benzeri Teknolojiler',
    s4intro: 'Bu sitede kullanılan çerezler ve tarayıcı depolama kayıtları amaçları, süreleri ve kimin yerleştirdiğiyle birlikte aşağıdadır. Analitik ve pazarlama araçları (Google ve Microsoft) yalnız çerez bandında “Kabul et” derseniz yüklenir. “Reddet” derseniz ya da seçim yapmazsanız hiç yüklenmez ve bu araçların ranksup.ai üzerinde daha önce bıraktığı çerezler silinir.',
    s4groups: [
      {
        title: 'Zorunlu (her zaman açık, onay gerektirmez)',
        items: [
          'Oturum ve giriş güvenliği: __Secure-authjs.session-token (30 gün, siteyi kullandıkça yenilenir), __Host-authjs.csrf-token ve __Secure-authjs.callback-url (tarayıcı kapanınca silinir), Google ile girişte __Secure-authjs.state ve __Secure-authjs.pkce.code_verifier (15 dakika). Birinci taraf; yalnız sunucumuz okuyabilir.',
          'Yönetici güvenliği: luviai_admin_unlocked (24 saat, birinci taraf). Yalnız RanksUp yöneticilerinde oluşur.',
          'Çerez tercihiniz: luviai-cookie-consent (tarayıcı depolaması, 12 ay geçerli). Seçiminizi hatırlar; süre dolunca yeniden sorarız.',
          'Altyapı güvenliği: altyapı sağlayıcımız Cloudflare, siteyi bot ve saldırılara karşı korurken gerektiğinde kendi güvenlik çerezlerini (ör. cf_clearance, __cf_bm) yerleştirebilir.',
        ],
      },
      {
        title: 'Kendi ölçümümüz ve arayüz tercihleri (reklam veya analiz şirketleriyle paylaşılmaz)',
        items: [
          // Ortaklik paneli cumlesi NEDEN: davet kaydi ortaga kisisel veri gosterir; okuyan neyin
          // gittigini bilmeli. Alanlar affiliate.service getStats'in ortaga (revealContacts yok)
          // dondurdugu acik alan listesi: 1. seviye etiket, status, clickedAt (kayitta yazilir),
          // signedUpAt, firstPaidAt, commissionUntil, totalCommissionEarned; 2. seviye ayni ama
          // komisyon alanlari yok. Etiket kurali referral-label.ts (14 / 12, alan adi yok). API
          // alan listesi ya da etiket kurali degisirse bu cumle (TR + EN) ve KVKK sayfasi ayni committe.
          'Ortaklık bağlantısı: luvi_ref (60 gün, birinci taraf). Yalnız bir iş ortağının ?ref= bağlantısıyla gelirseniz oluşur; kaydolursanız sizi yönlendiren ortağı komisyon hesabı için belirler. Bu durumda sizi davet eden ortak, ortaklık panelinde adınızı (14 karakterden uzunsa yalnız ilk 12 karakterini; adınız kayıtlı değilse e-posta adresinizin @ işaretinden önceki kısmını aynı kuralla), kayıt ve ilk ödeme tarihinizi, ödeme durumunuzu, komisyon süresinin bitiş tarihini ve ödemelerinizden kazandığı komisyon tutarını görür; e-posta adresinizi görmez. Sizi davet eden kişi de bir ortağın davetlisiyse, o ortak adınızı aynı kuralla, kayıt ve ilk ödeme tarihinizi ve ödeme durumunuzu görür; bu ikinci seviye davetten komisyon ödenmez.',
          'Ana sayfa ölçümü: luvi_lsid ve luvi_utm (tarayıcı depolaması). Ana sayfadaki sayfa görüntüleme, kaydırma derinliği, bölüm görüntüleme ve buton tıklamaları ile kaydın tamamlandığı an kendi sunucumuza kaydedilir. Tarayıcınızda rastgele bir ziyaret kimliği ve kampanya bağlantısıyla geldiyseniz kampanya etiketleri (utm) saklanır; siz tarayıcı verilerini silene kadar kalır. Kayıtlarda IP adresi tutulmaz; sayfa yolu, geldiğiniz adres ve tarayıcı bilgisi (user agent) tutulur.',
          'AI tarayıcı sayacı (ranksup.ai/api/tracker.js): çerez kullanmaz, tarayıcınıza bir şey yazmaz. Yalnız ziyaretçi bir yapay zekâ botuysa ya da ChatGPT, Perplexity, Claude, Gemini veya Copilot gibi bir yapay zekâ asistanından gelmişse açılan sayfanın adresini sunucumuza bildirir. Günlük toplamlar olarak saklanır (asistandan gelen ziyaretlerde en çok açılan 10 sayfa adresiyle birlikte); IP adresi saklanmaz.',
          'Arayüz tercihleri: dil ve tema seçiminiz, panelde açık bıraktığınız sekme, kapattığınız bildirimler ve ödeme adımı yarıda kalmasın diye geçici sipariş bilgisi (kart bilgisi değil) yalnız tarayıcınızda tutulur.',
        ],
      },
      {
        title: 'Analitik ve pazarlama (yalnız onayınızla)',
        items: [
          'Google Tag Manager ve Google Analytics 4 (Google): ziyaret istatistikleri, yani hangi sayfaların görüntülendiği ve ziyaretlerin nereden geldiği. Çerezler: _ga ve _ga_<kimlik> (2 yıl, ranksup.ai üzerinde).',
          'Google Ads dönüşüm ölçümü ve yeniden pazarlama (Google): reklamlarımızın kayıt ve satın almaya dönüşüp dönüşmediğini ölçmek ve sitemizi ziyaret edenlere Google’da reklam gösterebilmek. Çerezler: _gcl_au ve diğer _gcl_ çerezleri (90 gün, ranksup.ai üzerinde); Google kendi alan adlarında da çerez kullanabilir.',
          'Microsoft Clarity (Microsoft): sayfaların nasıl kullanıldığını anlamak için oturum kaydı (tıklama, kaydırma ve fare hareketleri) ve ısı haritası. Çerezler: _clck (1 yıl) ve _clsk (1 gün) ranksup.ai üzerinde; Microsoft kendi alan adlarında MUID ve CLID gibi çerezler kullanır.',
          'Bu araçların topladığı veriler yurt dışında yerleşik Google ve Microsoft’a aktarılır.',
        ],
      },
    ],
    s4manageTitle: 'Tercihinizi değiştirme ve onayı geri alma',
    // Geri alma NEDEN diger sekmeleri anlatiyor: lib/consent.ts planConsent + createConsentController
    // (bilesen: cookie-consent.tsx storage olayi, 'sync') etiketleri yuklemis diger acik sekmeleri
    // de yeniler; consent "denied" yuklu Google container'ini durdurmaz, yenilenmeyen sekme
    // cerezsiz olcum gonderirdi. O sekmenin sayfasinda bir form alanina yazildiysa yenileme bir
    // sonraki sayfa gecisine kalir (beforeunload korumasi yok, yarim metin silinmesin). Metin bu
    // ertelemeyi de soyler; "her sekme hemen yenilenir" demez. Kod degisirse metin ayni committe.
    s4manageP: 'Onayınızı istediğiniz zaman aşağıdaki düğmeyle geri alabilir ya da yeniden verebilirsiniz. Geri aldığınızda Google ve Clarity’nin ranksup.ai üzerinde bıraktığı çerezler silinir, sayfa yenilenir ve bu araçlar bir daha yüklenmez. Aynı tarayıcıda bu araçların yüklendiği diğer açık sekmeler de yenilenir; böyle bir sekmede bir form alanına yazdıysanız, yazdıklarınız kaybolmasın diye o sekme bir sonraki sayfa geçişinde yenilenir. Google ve Microsoft’un kendi alan adlarındaki çerezleri tarayıcı ayarlarınızdan silebilirsiniz.',
    s4button: 'Çerez tercihlerini değiştir',
    s4status: {
      unset: 'Bu tarayıcıda kayıtlı bir çerez tercihi yok.',
      granted: 'Bu tarayıcıdaki tercihiniz: kabul edildi.',
      denied: 'Bu tarayıcıdaki tercihiniz: reddedildi.',
    },
    s5: '5. Sosyal Medya Bağlantıları',
    s5p1: 'RanksUp’ın sosyal medya paylaşım özelliği (LinkedIn, X, Bluesky, TikTok, YouTube, Facebook, Instagram, Threads ve Pinterest hesaplarını bağlayıp gönderi yayımlama) kaldırıldı; RanksUp artık bu hesaplarda paylaşım yapmıyor. Özellik kaldırılmadan önce bir hesap bağladıysanız o bağlantıdan aşağıdaki kayıtlar kalmış olabilir. Bu bağlantıların erişim bilgileri artık hiçbir işlemde kullanılmaz.',
    s5items: [
      'Şifreli erişim bilgileri (OAuth access_token ve refresh_token, AES-256-GCM ile şifreli)',
      'Bağlı hesabın adı ve profil görselinin adresi',
      'Hazırlanan ve paylaşılan gönderilerin metni ve medya bağlantıları; paylaşılanların bağlantısı ve platformdaki kimliği',
    ],
    s5p2: 'Bu kayıtlar ilgili siteyi sildiğinizde hemen silinir. Hesabınızı sildiğinizde erişim bilgileri, hesap adı ve profil görseli hemen silinir; kalan kayıtlar 30 gün sonra kalıcı olarak silinir. Daha erken silinmesini isterseniz kvkk@luvihost.com adresine yazabilirsiniz. Bağlantıyı ilgili platformun hesap ayarlarındaki bağlı uygulamalar bölümünden de kaldırabilirsiniz. Reklam yönetimi için bağlanan Google Ads ve Meta (Facebook) reklam hesabı bağlantıları ayrı bir özelliktir; bu bölüm onları kapsamaz.',
    s6: '6. Yapay Zeka Üretim Sistemleri',
    s6p: 'İçerik üretimi için Anthropic Claude, Google Gemini ve OpenAI ile iletişim kurulur. Kullanıcı içeriği yalnızca o üretim için gönderilir, model eğitiminde kullanılmaz (her sağlayıcının "no-train" politikalarına uygun çağrı yapılır). RanksUp Video’da yalnızca makalenizin metni, video metnini çıkarmak için Anthropic Claude’a gönderilir; site ve ürün tanıtım videolarında bunun yerine sitenizin kendi sayfasının metni (ve site tanıtımında RanksUp’taki marka profilinizin özeti) gönderilir. Logonuz, ürün görselleriniz ve marka renginiz yapay zekâ sağlayıcısına gönderilmez, videonun kendisi sunucularımızda üretilir.',
    s7: '7. Haklarınız (KVKK)',
    s7items: [
      'Verilerinize erişim talep etme',
      'Düzeltme talep etme',
      'Silme talep etme: hesabınızı mobil uygulamada “Hesabı sil”, web panelinde “Hesabım & Abonelik” sayfasından silebilirsiniz. Erişim hemen kapanır, aboneliğiniz iptal edilir; verileriniz 30 gün sonra geri dönüşsüz silinir. Fatura ve ödeme kayıtları, vergi ve ticaret mevzuatı gereği saklanması zorunlu olduğundan kişisel bağlantısı kaldırılarak saklanır.',
      'Veri taşınabilirliği (JSON export)',
    ],
    s8: '8. İletişim',
    s8label: 'Veri sorumlu: LuviHost. Email: ',
  },
  en: {
    backHome: '← Back to home',
    titleA: 'Privacy',
    titleB: 'Policy',
    effective: 'Effective: April 27, 2026',
    updated: 'Last updated: October 21, 2026',
    changeNote: 'Change: rewrote the cookie section (the tools we use, their purposes and durations, and how to withdraw consent); added the account deletion paths (mobile app and web dashboard) and how invoices and payment records are kept after deletion; updated the section on the removed social media connections and removed AI providers we no longer use (HeyGen, Runway, ElevenLabs) from the list; corrected the data use section (2) to state that data is shared for marketing only through the Google ad tags that load with your consent (conversion measurement and remarketing); added to the partner link (luvi_ref) item in the cookie section what the partner who invited you sees about you in their partner dashboard; added the brand details read from your site and the video files produced for RanksUp Video (section 1) and the use of AI for the video text (section 6); on the same day the page text and product image read for site and product promo videos were added to these two sections.',
    s1: '1. Data Collected',
    s1items: [
      'Account info: email, name, profile photo if any',
      'Site info: URL, brand name, niche',
      'GSC OAuth tokens (AES-256-GCM encrypted)',
      'Publish target credentials (FTP/SFTP/WP, AES-256-GCM encrypted)',
      'Payment data is stored at PayTR; we do not hold card numbers',
      'RanksUp Video: when you request a video, the name, logo and theme colour read from the public pages of your site; for a site or product promo video also the text of your home page or of the product/service page you name and the product image; plus the produced video file and cover image. Video files are stored on our servers under a hard-to-guess link that anyone with the link can open; they are deleted when you delete the video or the site, and when your account is permanently deleted',
    ],
    s2: '2. Data Use',
    s2p: 'Your account, site, connection and payment details (section 1) are used to provide the service: AI content generation, SEO audits, GSC analysis and publish automation. Your data is not sold to third parties. Data is shared for marketing and remarketing only through the Google tags that load if you click “Accept” in the cookie banner: Google Ads conversion measurement and remarketing measure whether our ads lead to sign-ups and purchases and let Google show our ads to people who visited our site. The analytics tools (Google Analytics 4, Microsoft Clarity) also load only with this consent; if you do not accept, none of them load. Section 4 lists these tools, their cookies and how to withdraw your consent.',
    s3: '3. Data Processing Location',
    s3p: 'Our servers are in the LuviHost Istanbul data center. Backups are kept on S3-compatible storage in the Frankfurt region. AI calls go to Anthropic (US) and Google (multi-region) services.',
    s4: '4. Cookies and Similar Technologies',
    s4intro: 'Below are the cookies and browser storage entries this site uses, with their purpose, duration and who sets them. Analytics and marketing tools (Google and Microsoft) are loaded only if you click “Accept” in the cookie banner. If you click “Decline” or make no choice, they are never loaded, and the cookies they previously left on ranksup.ai are deleted.',
    s4groups: [
      {
        title: 'Strictly necessary (always on, no consent needed)',
        items: [
          'Session and sign-in security: __Secure-authjs.session-token (30 days, renewed as you use the site), __Host-authjs.csrf-token and __Secure-authjs.callback-url (deleted when you close the browser), and during Google sign-in __Secure-authjs.state and __Secure-authjs.pkce.code_verifier (15 minutes). First-party; only our server can read them.',
          'Admin security: luviai_admin_unlocked (24 hours, first-party). Set only for RanksUp administrators.',
          'Your cookie choice: luviai-cookie-consent (browser storage, valid for 12 months). Remembers your choice; we ask again when it expires.',
          'Infrastructure security: our infrastructure provider Cloudflare may set its own security cookies (e.g. cf_clearance, __cf_bm) when protecting the site against bots and attacks.',
        ],
      },
      {
        title: 'Our own measurement and interface preferences (not shared with advertising or analytics companies)',
        items: [
          'Partner link: luvi_ref (60 days, first-party). Set only if you arrive through a partner’s ?ref= link; if you sign up, it identifies the referring partner for their commission. In that case, the partner who invited you sees in their partner dashboard your name (only its first 12 characters if it is longer than 14; if no name is saved, the part of your e-mail address before the @ sign, under the same rule), your sign-up and first payment dates, your payment status, the end date of their commission period and the commission they earned from your payments; they do not see your e-mail address. If the person who invited you was themselves invited by a partner, that partner sees your name under the same rule, your sign-up and first payment dates and your payment status; no commission is paid on this second-level referral.',
          'Home page measurement: luvi_lsid and luvi_utm (browser storage). Page views, scroll depth, section views and button clicks on the home page, and the moment sign-up completes, are recorded on our own server. A random visit ID and, if you arrived through a campaign link, the campaign tags (utm) are kept in your browser until you clear your browser data. The records do not contain your IP address; they contain the page path, the address you came from and your browser’s user agent.',
          'AI crawler counter (ranksup.ai/api/tracker.js): uses no cookies and stores nothing in your browser. Only if the visitor is an AI bot, or arrived from an AI assistant such as ChatGPT, Perplexity, Claude, Gemini or Copilot, it reports the address of the opened page to our server. It is stored as daily totals (with the 10 most opened page addresses for visits from assistants); IP addresses are not stored.',
          'Interface preferences: your language and theme, the tab you left open in the dashboard, notices you dismissed and, so that checkout is not interrupted, temporary order details (not card details) are kept only in your browser.',
        ],
      },
      {
        title: 'Analytics and marketing (only with your consent)',
        items: [
          'Google Tag Manager and Google Analytics 4 (Google): visit statistics, i.e. which pages are viewed and where visits come from. Cookies: _ga and _ga_<id> (2 years, on ranksup.ai).',
          'Google Ads conversion measurement and remarketing (Google): to measure whether our ads lead to sign-ups and purchases, and to be able to show ads on Google to people who visited our site. Cookies: _gcl_au and other _gcl_ cookies (90 days, on ranksup.ai); Google may also use cookies on its own domains.',
          'Microsoft Clarity (Microsoft): session recordings (clicks, scrolling and mouse movements) and heatmaps to understand how pages are used. Cookies: _clck (1 year) and _clsk (1 day) on ranksup.ai; Microsoft uses cookies such as MUID and CLID on its own domains.',
          'Data collected by these tools is transferred to Google and Microsoft, which are based outside Turkey.',
        ],
      },
    ],
    s4manageTitle: 'Changing your choice and withdrawing consent',
    s4manageP: 'You can withdraw or give your consent again at any time with the button below. When you withdraw, the cookies Google and Clarity left on ranksup.ai are deleted, the page reloads and these tools are not loaded again. Other open tabs in the same browser that loaded these tools also reload; if you typed into a form field in such a tab, that tab reloads at its next page change so that what you typed is not lost. Cookies on Google’s and Microsoft’s own domains can be deleted in your browser settings.',
    s4button: 'Change cookie preferences',
    s4status: {
      unset: 'No cookie choice is saved in this browser.',
      granted: 'Your choice in this browser: accepted.',
      denied: 'Your choice in this browser: declined.',
    },
    s5: '5. Social Media Connections',
    s5p1: 'RanksUp’s social media posting feature (connecting LinkedIn, X, Bluesky, TikTok, YouTube, Facebook, Instagram, Threads and Pinterest accounts to publish posts) has been removed; RanksUp no longer posts to these accounts. If you connected an account before the feature was removed, the records below may remain from that connection. The access credentials of these connections are no longer used for anything.',
    s5items: [
      'Encrypted access credentials (OAuth access_token and refresh_token, AES-256-GCM encrypted)',
      'The connected account’s name and the address of its profile image',
      'The text and media links of drafted and shared posts; for shared posts, their link and ID on the platform',
    ],
    s5p2: 'These records are deleted immediately when you delete the related site. When you delete your account, the access credentials, account name and profile image are deleted immediately, and the remaining records are permanently deleted 30 days later. To have them deleted sooner, write to kvkk@luvihost.com. You can also remove the connection in the connected apps section of the platform’s account settings. Google Ads and Meta (Facebook) ad account connections made for ad management are a separate feature and are not covered by this section.',
    s6: '6. AI Generation Systems',
    s6p: 'Content generation uses Anthropic Claude, Google Gemini and OpenAI. User content is sent only for that generation request and is not used for model training (each provider is called following its "no-train" policy). For RanksUp Video only your article text is sent to Anthropic Claude to extract the video text; for site and product promo videos the text of your own site’s page (and, for a site promo, the summary of your brand profile in RanksUp) is sent instead. Your logo, product images and brand colour are not sent to any AI provider, and the video itself is produced on our servers.',
    s7: '7. Your Rights (GDPR/KVKK)',
    s7items: [
      'Request access to your data',
      'Request correction',
      'Request deletion: delete your account in the mobile app (“Delete account”) or on the dashboard’s account & subscription page. Access ends immediately and your subscription is canceled; your data is permanently removed 30 days later. Invoices and payment records are retained with the personal link removed, as tax and commercial law require.',
      'Data portability (JSON export)',
    ],
    s8: '8. Contact',
    s8label: 'Data controller: LuviHost. Email: ',
  },
} as const;

/** Durum satiri: bant bu sekmede karar verince (CONSENT_CHANGE_EVENT) ya da baska sekmede (storage) yeniden okunur */
function subscribeConsent(callback: () => void) {
  window.addEventListener(CONSENT_CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
const consentSnapshot = (): ConsentState => readConsent(browserConsentStorage, Date.now());
// Sunucuda tercih bilinmez: durum satiri yalniz istemcide cizilir
const consentServerSnapshot = (): ConsentState | null => null;

export default function PrivacyPage() {
  const { locale } = useT();
  const d = CONTENT[locale];
  const consent = useSyncExternalStore<ConsentState | null>(subscribeConsent, consentSnapshot, consentServerSnapshot);

  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 prose dark:prose-invert">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand-600 transition-colors">{d.backHome}</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
            {d.titleA}
          </span>{' '}
          {d.titleB}
        </h1>
        <p className="text-sm text-muted-foreground mb-1">{d.effective}</p>
        <p className="text-sm text-muted-foreground mb-1">{d.updated}</p>
        <p className="text-sm text-muted-foreground mb-8">{d.changeNote}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s1}</h2>
        <ul className="space-y-1 text-sm">
          {d.s1items.map((it) => <li key={it}>• {it}</li>)}
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s2}</h2>
        <p className="text-sm text-muted-foreground">{d.s2p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s3}</h2>
        <p className="text-sm text-muted-foreground">{d.s3p}</p>

        {/* id="cerezler": cerez bandindaki baglanti buraya iner (cookie-consent.tsx) */}
        <h2 id="cerezler" className="text-xl font-bold mt-8 mb-3 scroll-mt-24">{d.s4}</h2>
        <p className="text-sm text-muted-foreground">{d.s4intro}</p>
        {d.s4groups.map((g) => (
          <div key={g.title}>
            <h3 className="text-base font-semibold mt-6 mb-2">{g.title}</h3>
            <ul className="space-y-1 text-sm">
              {g.items.map((it) => <li key={it}>• {it}</li>)}
            </ul>
          </div>
        ))}
        <h3 className="text-base font-semibold mt-6 mb-2">{d.s4manageTitle}</h3>
        <p className="text-sm text-muted-foreground">{d.s4manageP}</p>
        <div className="not-prose mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => openCookiePreferences()}>
            {d.s4button}
          </Button>
          {consent && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {d.s4status[consent]}
            </span>
          )}
        </div>

        {/* Bolum 5 NEDEN boyle: sosyal medya modulu (OAuth baglantilari, TikTok yayini,
            "Sosyal Kanallar" ayari) 0db5a1c'de kaldirildi; eski metin hala baglanildigini ve
            panelden baglanti kesilebildigini soyluyordu. "Sosyal medya hesabina hic baglanmaz"
            DENMEZ: Meta Ads baglantisi Facebook Login ile Sayfa izni ister (oauth/meta-permissions.ts);
            o reklam ozelligi suruyor, bolum onu kapsamaz. social_channels / social_posts
            tablolari silinmedi (migration ayri karar): kayitlari kalmis olabilecek kullaniciya
            ne kaldigi ve nasil silindigi yazilir. Kod: kimlik bilgisini okuyan yer yok;
            site silme (sites.service siteRemovalSteps) kanallari ve gonderileri siler; hesap
            silme (me/account-deletion.service freezeAccountData) erisim bilgisini, hesap adini
            ve gorselini hemen bosaltir, account-purge.plan 30 gun sonra satirlari siler.
            Bolum 6: HeyGen, Runway ve ElevenLabs (video/ses) ayni committe kaldirildi; kodda
            cagrisi yok. */}
        <h2 className="text-xl font-bold mt-8 mb-3">{d.s5}</h2>
        <p className="text-sm text-muted-foreground">{d.s5p1}</p>
        <ul className="space-y-1 text-sm mt-2">
          {d.s5items.map((it) => <li key={it}>• {it}</li>)}
        </ul>
        <p className="text-sm text-muted-foreground mt-2">{d.s5p2}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s6}</h2>
        <p className="text-sm text-muted-foreground">{d.s6p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s7}</h2>
        <ul className="space-y-1 text-sm">
          {d.s7items.map((it) => <li key={it}>• {it}</li>)}
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s8}</h2>
        <p className="text-sm text-muted-foreground">
          {d.s8label}<a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>
        </p>
      </div>
    </main>
  );
}
