'use client';

import { useSyncExternalStore } from 'react';

export type Locale = 'tr' | 'en';

// Tek source-of-truth: dictionary
const dictionary = {
  tr: {
    // Nav
    'nav.home': 'Ana Sayfa',
    'nav.pricing': 'Fiyatlar',
    'nav.dashboard': 'Panel',
    'nav.login': 'Giriş Yap',
    // "Erken Erisim" bayatti: kayit acik (Google ile giris), plan satiliyor
    'nav.signup': 'Ücretsiz başla',
    'nav.faq': 'SSS',
    'nav.compare': 'Karşılaştır',
    'nav.guides': 'Rehber',
    'nav.use_cases': 'Kullanım Senaryoları',

    // Eski landing v1 anahtarlari (hero.*, value.*, features.*, social.*, how.*,
    // geo.*, ads.*, compare.*, final.*) silindi (18.10.2026): hicbir bilesen
    // okumuyordu ve kaldirilan ozellikleri (sosyal paylasim, TTS ses, gunluk
    // otomatik olcum, reklam gorseli uretimi) ile yanlis iddialari ("6 ajan
    // zinciri", "1800-2500 kelime", "ayda 1.5-7.5k TL tasarruf") tasiyordu.

    // Footer
    'footer.product': 'Ürün',
    'footer.product.how': 'Nasıl çalışır',
    'footer.product.features': 'Özellikler',
    'footer.product.pricing': 'Fiyatlar',
    'footer.product.faq': 'SSS',
    'footer.legal': 'Hukuk',
    'footer.legal.terms': 'Kullanım koşulları',
    'footer.legal.privacy': 'Gizlilik politikası',
    'footer.legal.kvkk': 'KVKK',
    'footer.contact': 'İletişim',
    'footer.contact.support': 'Destek',
    'footer.tagline': 'Türkiye merkezli GEO · SEO · ASO · ASA otopilotu.',
    'footer.copyright': '© 2026 RanksUp. Tüm hakları saklıdır.',

    // Pricing
    'pricing.title': 'Plan Seçenekleri',
    'pricing.subtitle': '14 gün ücretsiz dene: markan AI cevaplarında nerede duruyor, ölç. Kart gerekmez, dilediğin zaman iptal.',
    'pricing.monthly': 'Aylık',
    'pricing.annual': 'Yıllık',
    'pricing.save': 'kazan',
    'pricing.cta': 'Planı seç',
    'pricing.cta_contact': 'Bizimle iletişime geç',
    'pricing.popular': 'EN ÇOK TERCİH EDİLEN',
    // Kart maddeleri burada TUTULMAZ — tek kaynak apps/api/src/billing/plans.ts
    // (features_tr / features_en). API locale'e gore secip yolluyor.
    // Emojiler kaldirildi (koyu vitrin, 11.11.2026); kelimeler ayni
    'pricing.security_note': 'PayTR güvenli ödeme · İstediğin zaman iptal · KDV dahil',
    'pricing.annual_save_badge': '-%17',
    'pricing.contact_sales': 'Bizimle iletişime geç',
    'pricing.free_start': 'Ücretsiz başla',
    'pricing.note_free_trial': '14 gün ücretsiz · Kredi kartı yok',

    // ─── Landing — Nav ──────────────────────────────────────────
    'land.nav.solution': 'Çözüm',
    'land.nav.how': 'Nasıl çalışır',
    'land.nav.results': 'Sonuçlar',
    'land.nav.pricing': 'Fiyat',
    'land.nav.faq': 'SSS',
    'land.nav.login': 'Giriş',
    'land.nav.signup': 'Ücretsiz başla',

    // land.hero.* (video etiketi disinda) ve land.pain.* silindi: kullanilmiyordu,
    // dogrulanmamis rozetler ("Apple Search Ads Open API Partner", "%99.9 SLA
    // uptime") ve kaynaksiz TL maliyet iddialari tasiyordu.

    // ─── Landing — Pricing section ──────────────────────────────
    'land.pricing.eyebrow': 'Şeffaf fiyat',
    'land.pricing.billing_period': 'Faturalama dönemi',
    'land.pricing.subtitle': '14 gün ücretsiz · İstediğin zaman iptal · Gizli ücret yok',
    'land.pricing.most_popular': 'Önerilen',
    'land.pricing.per_month': '/ay',
    'land.pricing.per_year': '/yıl',
    'land.pricing.annual_billing': 'Yıllık faturalandırılır',
    'land.pricing.monthly_billing': 'Aylık faturalandırılır',
    'land.pricing.contact_us': 'Bizimle iletişime geç',
    'land.pricing.start_free': 'Ücretsiz başla',
    // land.pricing.support_* silindi (30.10.2026): kullanilmiyordu ve kodda karsiligi
    // olmayan yanit suresi / Slack / SLA / hesap yoneticisi vaadi tasiyordu.
    // Olcum sikligi her planda ayni: hesap basina 7 gunde 1 (billing/measurement-allowance.ts).
    // 11.11.2026 paket yapisi (api plans.ts): asistan sayisi plana bagli (Baslangic 4, Profesyonel
    // ve ustu 6); makale uretimi ve yayin hedefleri Profesyonel ve ustunde. Eski not "her planda
    // 6 AI asistaninda" ve "ucretli her planda 13 yayin hedefi" diyordu.
    'land.pricing.footer_note': 'Her planda haftada 1 AI görünürlük ölçümü; hangi asistanların ölçüldüğü kartlarda · makale üretimi Profesyonel ve üstünde: 13 yayın hedefi, Türkçe ve İngilizce makale',

    // ─── Landing — FAQ ──────────────────────────────────────────
    'land.faq.eyebrow': 'Sıkça sorulanlar',
    'land.faq.title': 'Akla gelen ilk sorular',
    'land.faq.cta': 'Daha fazla soru? Tam SSS\'ye git →',
    'land.faq.q1': 'Hangi sitelerde çalışıyor?',
    // Shopify/Wix yayin hedefi yok (PublishTargetType); denetim ve olcum her sitede calisir
    'land.faq.a1': 'Herhangi bir web sitesinde: denetim ve AI görünürlük ölçümü için adresi yapıştırman yeterli. Yayın için WordPress, Webflow, Ghost, FTP/SFTP, cPanel ya da GitHub gibi 13 yayın hedefinden birini bağlarsın. Mobil uygulaman için App Store ya da Google Play kaydını eklersin.',
    'land.faq.q2': 'Kredi kartı vermem gerekiyor mu?',
    // Sahip karari 21.10.2026: deneme 14 gun (kayitta trialEndsAt); bitince hesap salt okunur
    // (api billing/trial-policy.ts, trial-expiry.guard.ts) — yalniz satin alma acikken. Hesap
    // kapanmaz, veri silinmez. Denemede makaleyi kullanici baslatir (yayin hedefi sarti), toplam 2.
    // 11.11.2026: makale uretimi yalniz Profesyonel ve ustunde — kilitli konular "plan yukseltince"
    // degil Profesyonel'de yazilir (Baslangic makale uretmez).
    'land.faq.a2': 'Hayır. Ücretsiz deneme için kart istenmez; deneme 14 gün sürer ve 2 makale hakkın var (makaleleri sitene yayın hedefi bağladıktan sonra sen başlatırsın; takvimin geri kalanı panelde kilitli görünür ve Profesyonel plana geçtiğinde yazılır). Devam etmek istersen plan seçip ödemeyi o zaman yaparsın. Plan seçmezsen hesabın kapanmaz ve verilerin silinmez; 14 gün dolunca hesabın salt okunur olur, verilerini görür ve indirirsin.',
    'land.faq.q3': 'AI sektörümü gerçekten anlayabilir mi?',
    // "%95+ dogruluk" olculmus bir oran degildi; sektor site ayarlarindan degisir
    'land.faq.a3': 'Onboarding sırasında siteni tarayıp sektörünü tahmin eder; marka sesini ve rakiplerini çıkarır. Tahmin yanlışsa site ayarlarından düzeltebilirsin; sonraki içerikler buna göre üretilir.',
    // Sihirbaz akisi help/asa-asc ile ayni (clientId/teamId/keyId); ASA Profesyonel+ (plans.ts asaEnabled)
    'land.faq.q4': 'Apple Search Ads’i bağlamak için ne gerekiyor?',
    'land.faq.a4': 'Bir Apple Search Ads hesabı. Sihirbaz anahtar çiftini tarayıcında üretir, terminal ya da openssl gerekmez: public key’i Apple Search Ads API ayarlarına yapıştırırsın, Apple’ın verdiği clientId, teamId ve keyId bilgilerini RanksUp’a geri yapıştırırsın. Apple Search Ads yönetimi Profesyonel ve üstü planlarda.',
    'land.faq.q5': 'Üretilen içerikler benim mi?',
    'land.faq.a5': 'Evet, %100 senin. RanksUp ürettiği makale, görsel ve metin için telif iddia etmez. Sınırsız kullanabilirsin (planındaki kota dahilinde).',
    'land.faq.q6': 'İstediğim zaman iptal edebilir miyim?',
    // Kullanim Sartlari md. 3-4 (terms/page.tsx) ile ayni; "7 gun kosulsuz iade" hicbir metne dayanmiyordu
    'land.faq.a6': 'Evet. Aylık plan istediğin zaman iptal edilir; ödenen dönemin sonuna kadar erişimin sürer. Kullanım Şartları’na göre yıllık planda ilk 30 gün tam iade, sonrasında kalan ay başına orantılı iade yapılır.',
    'land.faq.q7': 'AI asistanlar aramaya markaları kendileri mi ekliyor?',
    'land.faq.a7': 'Evet. Ölçümlerde ChatGPT, kullanıcı yazmadan da arama sorgusuna marka adları ekliyor — kimin aranacağı sorgu daha yazılmadan belirleniyor. Bu yüzden RanksUp markanızın adının geçtiği soruları skordan ayırır (o tanınırlık) ve adınızın geçmediği sorularda anılıp anılmadığınızı ölçer (o görünürlük).',

    // land.stats.* ("SLA uptime") ve land.sol.* ("App Store'da 1. siraya",
    // "50+ keyword takibi") kullanilmiyordu; silindi.

    // ─── Landing — How it works (3 step) ────────────────────────
    'land.how.eyebrow': '3 ADIM',
    'land.how.title': '5 dakikada yayında.',
    'land.how.subtitle': "Teknik bilgi gerekmez. Onboarding sırasında AI senin sektörünü tahmin eder, ilk içerikleri üretir.",
    // Adimlar kodla ayni: marka beyni 3-5 anahtar kelime + soru listesi uretir
    // (brain-generator.service.ts; "ilk 50 keyword" degil); onboarding denetim +
    // baslangic olcumu + 8 konuluk takvim (faq/page.tsx otopilot cevabi); sonraki
    // olcumler kullanici tetikli, haftada bir (billing/measurement-allowance.ts).
    'land.how.s1.title': 'Siteni bağla',
    'land.how.s1.body': "URL'i yapıştır. RanksUp siteyi tarar, sektörünü belirler; marka sesini, rakiplerini ve hedef sorularını çıkarır.",
    'land.how.s2.title': 'AI analiz',
    'land.how.s2.body': 'Site denetimi yapılır, ilk AI görünürlük ölçümü alınır ve konu takvimi hazırlanır.',
    'land.how.s3.title': 'Yayında',
    'land.how.s3.body': 'Profesyonel ve üstü planlarda ilk makale hemen üretilir, takvimdeki konular makale hakkın yettikçe sırayla hazırlanır. Ücretsiz denemede makaleleri (toplam 2) yayın hedefini bağladıktan sonra sen başlatırsın. Sonraki AI görünürlük ölçümlerini haftada bir sen başlatırsın.',

    // ─── Landing — Results (3 KPI) ──────────────────────────────
    'land.res.eyebrow': 'Sonuçlar',
    'land.res.title': 'Sayılarla RanksUp etkisi.',
    'land.res.r1.title': 'organik trafik',
    'land.res.r1.sub': 'KobiPratik · 3 ayda günde 52’den 340’a',
    'land.res.r2.title': 'aylık arama gösterimi',
    'land.res.r2.sub': 'Search Console, son 30 gün',
    'land.res.r3.title': 'App Store ortalama sırası',
    'land.res.r3.sub': '3 ayda 4.8’den — 1.264 ölçüm',

    // ─── Landing — Compare (table) ──────────────────────────────
    // Rakip seti /compare ile ayni (Surfer, Jasper, Ahrefs, Frase); hucreler ve
    // fiyatlar app/page.tsx COMPARE yorumundaki ureticisi sayfalarindan, 18.10.2026.
    // Eski baslik "5 SaaS yerine 1" ve "%80 tasarruf" olculmus degildi; tablo
    // RanksUp'in artik sunmadigi sosyal yayin icin Hootsuite'i de sayiyordu.
    'land.cmp.eyebrow': 'Karşılaştırma',
    'land.cmp.title': 'Popüler SEO araçlarıyla yan yana.',
    'land.cmp.subtitle': 'Web SEO ve AI görünürlüğünün yanında App Store, Google Play ve Apple Search Ads da aynı panelde.',
    'land.cmp.col_feature': 'Özellik',
    'land.cmp.row1': 'Web SEO + keyword takibi',
    'land.cmp.row2': 'AI görünürlük takibi',
    'land.cmp.row3': 'App Store + Play Store ASO',
    'land.cmp.row4': 'Apple Search Ads yönetimi',
    'land.cmp.row5': 'Agent Readiness (AXO) taraması',
    'land.cmp.row6': 'Rakip AI payı (share of voice)',
    'land.cmp.row7': 'AI makale üretimi',
    'land.cmp.row8': 'Auto-Pilot otomasyon',
    'land.cmp.row_price': 'En düşük ücretli plan (aylık)',
    'land.cmp.note': '* Rakip bilgileri üreticilerin fiyat ve ürün sayfalarından 18 Ekim 2026’da derlendi; değişmiş olabilir. Fiyat satırı her aracın en düşük ücretli planıdır: Surfer Discovery (yıllık faturalı; sayfada aylık faturalı fiyat yok), Jasper Pro (aylık, kullanıcı başına), Ahrefs Starter, Frase Starter (aylık) ve RanksUp Başlangıç (aylık). ✓ işaretli bazı özellikler (RanksUp dahil) yalnız üst planlarda bulunur ya da ücretli eklentidir; RanksUp’ta AI makale üretimi, Apple Search Ads yönetimi ve Agent Readiness (AXO) taraması Profesyonel ve üstü planlardadır. — : doğrulanmadı.',
    'land.cmp.unknown': 'Doğrulanmadı',

    // land.uc.* silindi: kullanilmiyordu ve olculmemis "once/sonra" sonuclari
    // ("6 ay sonra ayda 4.200", "60 gun sonra ayda 1.800") gercek vaka gibi yaziyordu.

    // ─── Landing — Testimonials ─────────────────────────────────
    'land.test.eyebrow': 'Kullanıcı yorumları',
    'land.test.title': 'Ekipler ne diyor?',
    'land.test.empty': 'İlk müşteri yorumları toplanıyor — sen de ilk kullananlardan ol, deneyimini paylaş.',

    // ─── Landing — Pricing extras ───────────────────────────────
    'land.pric.eyebrow': 'Şeffaf Fiyat',
    'land.pric.subtitle': '14 gün ücretsiz · İstediğin zaman iptal · Gizli ücret yok',
    'land.pric.monthly': 'Aylık',
    'land.pric.annual': 'Yıllık',
    'land.pric.discount_badge': '%17 indirim',
    'land.pric.per_month': '/ay',
    'land.pric.annual_billed_prefix': 'Yıllık',
    'land.pric.annual_billed_suffix': 'faturalandırılır',
    'land.pric.monthly_billed': 'Aylık faturalandırılır',
    // Madde metinleri plans.ts'ten geliyor — buraya ikinci bir kopya yazmayin.
    'land.pric.cta_free': 'Planı seç',
    'land.pric.cta_contact': 'Bizimle iletişime geç',
    // Ayni sayfada "5 dakikada kurulum" (land.cta.subtitle, land2.how.title) varken burada
    // "kurulum 10 dakika" yaziyordu; olculmus bir sure degil, celiski kaldirildi.
    // Kartlardaki "ayda en fazla N calistirma" bir tavan; olcum sikligi her planda haftada 1.
    // 11.11.2026 paket yapisi: asistan sayisi plana bagli (Baslangic 4, Profesyonel ve ustu 6),
    // makale ve yayin hedefleri Profesyonel ve ustunde. Calistirma birimi artik kart maddesinde
    // yazmiyor; kartlarin altindaki bu not tanimlar (public-docs.spec.ts denetler).
    'land.pric.footer_note': 'Her planda haftada 1 AI görünürlük ölçümü; hangi asistanların ölçüldüğü kartlarda · çalıştırma birimi: AI testi 1, Prompt Lab’de her soru ve her dal 1 çalıştırma · makale üretimi Profesyonel ve üstünde: 13 yayın hedefi (denemede WordPress), Türkçe ve İngilizce makale',
    // Plan adlari burada TUTULMAZ — tek kaynak apps/api/src/billing/plans.ts.
    'land.pric.enterprise_label': 'Özel',

    // ─── Landing — Final CTA ────────────────────────────────────
    'land.cta.title': 'AI çağının pazarlamasına başla',
    'land.cta.subtitle': '14 gün ücretsiz deneme, kart gerekmez. 5 dakikada kurulum.',
    'land.cta.button': 'Ücretsiz başla',
    'land.cta.secondary': 'Önce videoyu izle',

    // ─── Footer ─────────────────────────────────────────────────
    'land.footer.product': 'Ürün',
    'land.footer.resources': 'Kaynaklar',
    'land.footer.company': 'Şirket',
    'land.footer.legal': 'Yasal',
    'land.footer.tagline': 'AI çağının pazarlama platformu — Türkiye',
    'land.footer.rights': 'Tüm hakları saklıdır',
    'land.footer.use_cases': 'Kullanım senaryoları',
    'land.footer.compare': 'Karşılaştır',
    'land.footer.ai_visibility': 'Yapay zekâ görünürlüğü nedir?',
    'land.footer.chatgpt_guide': 'ChatGPT’de markam görünüyor mu?',
    'land.footer.gbp': 'Google İşletme Karnesi',
    'land.footer.about': 'Hakkımızda',
    'land.footer.help': 'Yardım',
    'land.footer.privacy': 'Gizlilik',
    'land.footer.terms': 'Kullanım koşulları',
    'land.footer.kvkk': 'KVKK',
    'land.cmp.yes': 'Var',
    'land.cmp.no': 'Yok',
    'land.footer.made_in': "Türkiye'de geliştirildi",

    // ─── Faz 6: tek hero + kanit seridi + video ───────────────────
    'land.hero.video_label': 'RanksUp panelinin kısa tanıtım videosu: KobiPratik örneğinde trafik, AI görünürlük ve App Store sıralaması',
    'land.proof.label': 'Gerçek vaka · KobiPratik',
    'land.proof.details': 'Vakanın ayrıntıları',
    'land.how.video_cta': 'Videoyu izle (70 sn)',
    'land.how.video_title': 'RanksUp nasıl çalışır?',
    'land.how.video_desc': 'Siteni bağla, AI analiz etsin, yayına alsın ve ölçsün — 3 adımda.',
    'land.how.video_fallback': 'Tarayıcın bu videoyu oynatamıyor.',
    'land.res.case_title': 'KobiPratik: 3 ayda ne değişti?',
    'land.res.col_metric': 'Ölçüm',
    'land.res.col_before': 'Başlangıç',
    'land.res.col_after': '3 ay sonra',
    'land.res.d1': 'Günlük ortalama tıklama',
    'land.res.d2': '30 günlük toplam tıklama',
    'land.res.d3': '30 günlük arama gösterimi',
    'land.res.d4': 'App Store ortalama sırası',
    'land.res.source': 'Kaynak: Google Search Console (kobipratik.com) ve App Store sıralama ölçümleri (16 Mayıs – 13 Ağustos, 1.264 ölçüm). KobiPratik, RanksUp’ı geliştiren LuviHost grubunun kendi sitesidir.',
    'land.uc.link': 'Senin iş modeline nasıl uyar? Kullanım senaryolarına bak',
    'land.test.from_reviews': 'yorumdan',
    'land.preview.live': 'ÖRNEK',
    'land.preview.activity': 'Örnek aktivite akışı',
    'land.preview.sample': 'Örnek ekran',

    // Dashboard
    'dashboard.title': 'Panel',
    'dashboard.new_site': 'Yeni site',
    'dashboard.sites': 'Sitelerim',
    'dashboard.empty': 'Site adresini gir; AI markanı, rakiplerini ve SEO + GEO durumunu yaklaşık bir dakikada çıkarsın.',
    'dashboard.add_first': 'İlk siteni ekle',

    // Common
    'common.loading': 'Yükleniyor…',
    'common.error': 'Bir hata oluştu',
    'common.cancel': 'İptal',
    'common.save': 'Kaydet',
    'common.continue': 'Devam',
    'common.back': 'Geri',
    'common.finish': 'Bitir',
    'common.try_again': 'Tekrar dene',
    'common.learn_more': 'Daha fazla',
    // ─── Landing v2 (yeniden tasarim, Ekim 2026) ─────────────────
    'land2.hero.title': 'Yapay zekâ seni tavsiye ediyor mu?',
    'land2.hero.sub': "Müşterilerin artık Google'ın yanında ChatGPT, Gemini ve Claude'a da soruyor. RanksUp bu cevaplarda adının geçip geçmediğini ölçer, eksik kaldığın sorular için içerik hazırlar; Google ve App Store sıralamanı da aynı panelden büyütür.",
    'land2.hero.checker': 'Alan adını yaz, 6 AI asistanında test edelim; genelde bir dakikadan kısa sürer. Üyelik gerekmez.',
    'land2.hero.signup': 'Ücretsiz hesap aç',
    'land2.hero.watch': 'Nasıl çalıştığını izle',
    'land2.sheet.label': 'Örnek cevap',
    'land2.sheet.query': 'Küçük bir işletme için hangi ön muhasebe programını önerirsin?',
    'land2.sheet.a1': 'Küçük işletmeler için en sık önerilen seçenek ',
    'land2.sheet.a2': '. E-fatura ve stok takibini tek ekranda topluyor, kurulumu birkaç dakika sürüyor.',
    'land2.sheet.a3': ' Hesapçık ve Defterbir de sık anılan alternatifler.',
    'land2.sheet.brand': 'markan.com',
    'land2.sheet.source2': 'hesapcik.example',
    'land2.sheet.sources': 'Kaynaklar',
    'land2.sheet.note': 'Turuncu işaret, markanın cevapta anıldığı yer. Kendi sonucunu görmek için alan adını test et.',
    'land2.sheet.engines': 'Asistan',
    'land2.surf.title': 'Müşterin seni üç yerde arıyor.',
    'land2.surf.sub': "Google'da, yapay zekâ asistanlarında ve uygulama mağazalarında. RanksUp üçünü tek panelden ölçer ve büyütür.",
    'land2.surf.seo.title': 'Google',
    'land2.surf.seo.body': 'Sıralamanı takip eder, takılan sayfaları bulur, başlık ve açıklamaları senin onayınla düzeltir.',
    'land2.surf.seo.mock_title': 'Küçük işletmeler için ön muhasebe rehberi',
    'land2.surf.seo.mock_meta': '9. sıradan 3. sıraya',
    'land2.surf.geo.title': 'Yapay zekâ asistanları',
    // Eski metin "ChatGPT, Gemini, Claude ve dort asistanda" = 7 asistan diyordu;
    // olculen 6 (plans.ts). Ad ad yazilir, public-docs.spec.ts sayiyi denetler.
    'land2.surf.geo.body': 'ChatGPT, Gemini, Claude, Perplexity, Grok ve DeepSeek’te adının hangi sorularda geçtiğini ölçer; eksik kaldığın konular için makale yazar.',
    'land2.surf.geo.mock': 'önerilenler arasında',
    'land2.surf.aso.title': 'App Store ve Google Play',
    'land2.surf.aso.body': "Anahtar kelime sıralarını izler, metin önerir ve onayınla App Store Connect'e yazar.",
    'land2.surf.aso.mock_kw': 'ön muhasebe',
    'land2.surf.mock_note': 'Görünümler örnektir.',
    'land2.how.title': 'Kurulum beş dakika. Gerisini RanksUp yürütür.',
    'land2.how.caption': 'Panelden kısa bir kesit',
    'land2.proof.kicker': 'KobiPratik, 3 ayda',
    'land2.proof.unit': 'günlük organik tıklama',
    'land2.proof.more': 'Tüm ölçümler',
    'land2.cta.title': 'Bir sonraki cevapta adın geçsin.',
    'land2.cta.test': 'Alan adını test et',
    // Vitrin (11.11.2026): iki tonlu basliklar — a = parlak satir, b = sonuk satir.
    // Hero'da a + b birlesince land2.hero.title ile ayni cumle olur (H1 metni degismedi).
    'land3.hero.a': 'Yapay zekâ seni',
    'land3.hero.b': 'tavsiye ediyor mu?',
    // {n}: API'nin "su an olculuyor" dedigi asistan sayisi (6, Muse aciksa 7) — ai-checker-hero.tsx
    'land3.hero.checker': 'Alan adını yaz, {n} AI asistanında test edelim; genelde bir dakikadan kısa sürer. Üyelik gerekmez.',
    'land3.engines': '{n} asistanda ölçülür',
    'land3.surf.rail': 'Üç arama yüzeyi',
    'land3.surf.meta': 'Tek panel',
    'land3.surf.a': 'Müşterin seni',
    'land3.surf.b': 'üç yerde arıyor.',
    'land3.how.meta': '3 adım',
    'land3.how.a': 'Kurulum beş dakika.',
    'land3.how.b': 'Gerisini RanksUp yürütür.',
    'land3.proof.rail': 'Ölçülmüş sonuç',
    'land3.proof.meta': 'Search Console verisi',
    'land3.cmp.meta': 'Ayrıntılı karşılaştırma',
    'land3.cmp.a': 'Popüler SEO araçlarıyla',
    'land3.cmp.b': 'yan yana.',
    'land3.pricing.meta': 'Tüm plan ayrıntıları',
    'land3.pricing.a': 'Önce dene,',
    'land3.pricing.b': 'sonra karar ver.',
    'land3.faq.rail': 'Sık sorulan sorular',
    'land3.faq.meta': 'Tüm sorular',
    'land3.faq.a': 'Akla gelen',
    'land3.faq.b': 'ilk sorular.',
    'land3.cta.a': 'Bir sonraki cevapta',
    'land3.cta.b': 'adın geçsin.',
    // Vitrin ust menusu ve alt bilgisi (components/vitrin). Her satir var olan bir sayfaya gider.
    'vnav.menu': 'Menü',
    'vnav.product': 'Ürün',
    'vnav.resources': 'Kaynaklar',
    'vnav.about': 'Hakkımızda',
    'vnav.p.overview': 'Genel bakış',
    'vnav.p.ai': 'AI görünürlük ölçümü',
    'vnav.p.aso': 'ASO: App Store ve Google Play',
    'vnav.p.asa': 'Apple Search Ads ve App Store Connect',
    'vnav.p.autopilot': 'Otomatik akış',
    'vnav.p.video': 'RanksUp Video',
    'vnav.p.byok': 'Kendi API anahtarınla ölçüm',
    'vnav.r.test': 'Ücretsiz AI görünürlük testi',
    'vnav.r.glossary': 'Sözlük',
    'vnav.r.start': 'Hızlı başlangıç',
    'vnav.r.help': 'Yardım merkezi',
    'vnav.r.bot': 'RanksUpBot',
    'vfoot.contact': 'İletişim',
    'vfoot.cookies': 'Çerez tercihleri',
  },
  en: {
    // Nav
    'nav.home': 'Home',
    'nav.pricing': 'Pricing',
    'nav.dashboard': 'Dashboard',
    'nav.login': 'Sign In',
    'nav.signup': 'Start free',
    'nav.faq': 'FAQ',
    'nav.compare': 'Compare',
    'nav.guides': 'Guides',
    'nav.use_cases': 'Use Cases',

    // Eski landing v1 anahtarlari silindi (TR blogundaki nota bakin).

    // Footer
    'footer.product': 'Product',
    'footer.product.how': 'How it works',
    'footer.product.features': 'Features',
    'footer.product.pricing': 'Pricing',
    'footer.product.faq': 'FAQ',
    'footer.legal': 'Legal',
    'footer.legal.terms': 'Terms of service',
    'footer.legal.privacy': 'Privacy policy',
    'footer.legal.kvkk': 'KVKK (TR)',
    'footer.contact': 'Contact',
    'footer.contact.support': 'Support',
    'footer.tagline': 'Turkey-based GEO · SEO · ASO · ASA autopilot.',
    'footer.copyright': '© 2026 RanksUp. All rights reserved.',

    // Pricing
    'pricing.title': 'Plans & Pricing',
    'pricing.subtitle': 'Try it free for 14 days: measure where your brand stands in AI answers. No card required, cancel anytime.',
    'pricing.monthly': 'Monthly',
    'pricing.annual': 'Annual',
    'pricing.save': 'save',
    'pricing.cta': 'Choose plan',
    'pricing.cta_contact': 'Contact us',
    'pricing.popular': 'MOST POPULAR',
    // Card bullets are NOT kept here — single source is apps/api/src/billing/plans.ts
    // (features_tr / features_en). The API picks by locale.
    'pricing.security_note': 'PayTR secure payment · Cancel anytime · VAT included',
    'pricing.annual_save_badge': '-17%',
    'pricing.contact_sales': 'Contact sales',
    'pricing.free_start': 'Start free',
    'pricing.note_free_trial': '14 days free · No credit card',

    // ─── Landing — Nav ──────────────────────────────────────────
    'land.nav.solution': 'Solution',
    'land.nav.how': 'How it works',
    'land.nav.results': 'Results',
    'land.nav.pricing': 'Pricing',
    'land.nav.faq': 'FAQ',
    'land.nav.login': 'Sign in',
    'land.nav.signup': 'Start free',

    // ─── Landing — Pricing section ──────────────────────────────
    'land.pricing.eyebrow': 'Transparent pricing',
    'land.pricing.billing_period': 'Billing period',
    'land.pricing.subtitle': '14 days free · Cancel anytime · No hidden fees',
    'land.pricing.most_popular': 'Recommended',
    'land.pricing.per_month': '/mo',
    'land.pricing.per_year': '/yr',
    'land.pricing.annual_billing': 'Billed annually',
    'land.pricing.monthly_billing': 'Billed monthly',
    'land.pricing.contact_us': 'Contact us',
    'land.pricing.start_free': 'Start free',
    'land.pricing.footer_note': 'On every plan: 1 AI visibility measurement per week; the cards show which assistants each plan measures · article generation on Professional and up: 13 publishing targets, articles in Turkish and English',

    // ─── Landing — FAQ ──────────────────────────────────────────
    'land.faq.eyebrow': 'Frequently asked',
    'land.faq.title': 'First questions that come to mind',
    'land.faq.cta': 'More questions? Go to full FAQ →',
    'land.faq.q1': 'Which websites does it work on?',
    'land.faq.a1': 'Any website: paste the address to run the audit and the AI visibility measurement. To publish, you connect one of 13 publishing targets such as WordPress, Webflow, Ghost, FTP/SFTP, cPanel or GitHub. For a mobile app you add its App Store or Google Play listing.',
    'land.faq.q2': 'Do I need to enter a credit card?',
    'land.faq.a2': 'No. No card is needed for the free trial; it lasts 14 days and includes 2 articles (you start them yourself after connecting a publish target to your site; the rest of the calendar appears locked in the dashboard and is written when you move to the Professional plan). If you want to continue, you choose a plan and pay at that point. If you don’t, your account is not closed and your data is not deleted; after 14 days it becomes read-only, so you can still view and download your data.',
    'land.faq.q3': 'Can AI really understand my industry?',
    'land.faq.a3': 'During onboarding it scans your site, predicts your industry and maps your brand voice and competitors. If the guess is wrong you can fix it in site settings, and subsequent content follows it.',
    'land.faq.q4': 'What do I need to connect Apple Search Ads?',
    'land.faq.a4': 'An Apple Search Ads account. The wizard generates the key pair in your browser, so no terminal or openssl is needed: you paste the public key into the Apple Search Ads API settings, then paste the clientId, teamId and keyId Apple gives you back into RanksUp. Apple Search Ads management is on the Professional plan and up.',
    'land.faq.q5': 'Do I own the generated content?',
    'land.faq.a5': 'Yes, 100% yours. RanksUp claims no copyright on the articles, images and text it generates. Unlimited use (within your plan quota).',
    'land.faq.q6': 'Can I cancel anytime?',
    'land.faq.a6': 'Yes. Monthly plans can be cancelled anytime and your access continues until the end of the paid period. Under the Terms of Service, yearly plans get a full refund in the first 30 days and a pro-rata refund per remaining month after that.',
    'land.faq.q7': 'Do AI assistants add brands to the search themselves?',
    'land.faq.a7': 'Yes. In our measurements ChatGPT injects brand names into its search query even when the user never typed them — who gets looked up is decided before the query exists. That is why RanksUp keeps questions that already contain your brand out of the score (that is recognition) and measures whether you are mentioned in questions that do not (that is visibility).',

    // ─── Landing — How it works (3 step) ────────────────────────
    'land.how.eyebrow': '3 STEPS',
    'land.how.title': 'Live in 5 minutes.',
    'land.how.subtitle': 'No technical knowledge needed. During onboarding, AI predicts your industry and generates the first content.',
    'land.how.s1.title': 'Connect your site',
    'land.how.s1.body': 'Paste the URL. RanksUp scans the site, detects your industry and maps your brand voice, competitors and target questions.',
    'land.how.s2.title': 'AI analysis',
    'land.how.s2.body': 'A site audit runs, a first AI visibility measurement is taken and a topic calendar is prepared.',
    'land.how.s3.title': 'Live',
    'land.how.s3.body': 'On the Professional plan and up your first article is generated right away and scheduled topics follow in order as your article allowance permits. On the free trial you start your articles (2 in total) yourself after connecting a publish target. You start later AI visibility measurements once a week.',

    // ─── Landing — Results (3 KPI) ──────────────────────────────
    'land.res.eyebrow': 'Results',
    'land.res.title': 'RanksUp impact in numbers.',
    'land.res.r1.title': 'organic traffic',
    'land.res.r1.sub': 'KobiPratik · 3 months, 52/day to 340/day',
    'land.res.r2.title': 'monthly search impressions',
    'land.res.r2.sub': 'Search Console, last 30 days',
    'land.res.r3.title': 'average App Store rank',
    'land.res.r3.sub': 'from 4.8 in 3 months — 1,264 measurements',

    // ─── Landing — Compare (table) ──────────────────────────────
    'land.cmp.eyebrow': 'Comparison',
    'land.cmp.title': 'Side by side with popular SEO tools.',
    'land.cmp.subtitle': 'Alongside web SEO and AI visibility, App Store, Google Play and Apple Search Ads live in the same panel.',
    'land.cmp.col_feature': 'Feature',
    'land.cmp.row1': 'Web SEO + keyword tracking',
    'land.cmp.row2': 'AI visibility tracking',
    'land.cmp.row3': 'App Store + Play Store ASO',
    'land.cmp.row4': 'Apple Search Ads management',
    'land.cmp.row5': 'Agent Readiness (AXO) scan',
    'land.cmp.row6': 'Competitor AI share of voice',
    'land.cmp.row7': 'AI article generation',
    'land.cmp.row8': 'Auto-Pilot automation',
    'land.cmp.row_price': 'Lowest paid plan (per month)',
    'land.cmp.note': '* Competitor details were compiled from the vendors’ pricing and product pages on October 18, 2026 and may have changed. The price row is each tool’s lowest paid plan: Surfer Discovery (billed yearly; no monthly price shown), Jasper Pro (monthly, per seat), Ahrefs Starter, Frase Starter (monthly) and RanksUp Starter (monthly). Some ✓ features (RanksUp’s included) are only on higher plans or are paid add-ons; in RanksUp, AI article generation, Apple Search Ads management and Agent Readiness (AXO) scan are on the Professional plan and up. — : not verified.',
    'land.cmp.unknown': 'Not verified',

    // ─── Landing — Testimonials ─────────────────────────────────
    'land.test.eyebrow': 'Customer reviews',
    'land.test.title': 'What teams say',
    'land.test.empty': 'First customer reviews are being collected — be one of the first to share your experience.',

    // ─── Landing — Pricing extras ───────────────────────────────
    'land.pric.eyebrow': 'Transparent Pricing',
    'land.pric.subtitle': '14 days free · Cancel anytime · No hidden fees',
    'land.pric.monthly': 'Monthly',
    'land.pric.annual': 'Annual',
    'land.pric.discount_badge': '17% off',
    'land.pric.per_month': '/mo',
    'land.pric.annual_billed_prefix': 'Billed',
    'land.pric.annual_billed_suffix': 'annually',
    'land.pric.monthly_billed': 'Billed monthly',
    // Bullet text comes from plans.ts — do not keep a second copy here.
    'land.pric.cta_free': 'Choose plan',
    'land.pric.cta_contact': 'Contact us',
    'land.pric.footer_note': 'On every plan: 1 AI visibility measurement per week; the cards show which assistants each plan measures · run unit: an AI test is 1 run, each Prompt Lab question or branch is 1 · article generation on Professional and up: 13 publishing targets (trial: WordPress), articles in Turkish and English',
    // Plan names are NOT kept here — single source is apps/api/src/billing/plans.ts.
    'land.pric.enterprise_label': 'Custom',

    // ─── Landing — Final CTA ────────────────────────────────────
    'land.cta.title': 'Start your AI-era marketing',
    'land.cta.subtitle': '14-day free trial, no card required. Setup in 5 minutes.',
    'land.cta.button': 'Start free',
    'land.cta.secondary': 'Watch the video first',

    // ─── Footer ─────────────────────────────────────────────────
    'land.footer.product': 'Product',
    'land.footer.resources': 'Resources',
    'land.footer.company': 'Company',
    'land.footer.legal': 'Legal',
    'land.footer.tagline': 'AI-era marketing platform — Türkiye',
    'land.footer.rights': 'All rights reserved',
    'land.footer.use_cases': 'Use cases',
    'land.footer.compare': 'Compare',
    'land.footer.ai_visibility': 'What is AI visibility?',
    'land.footer.chatgpt_guide': 'Is my brand visible on ChatGPT?',
    'land.footer.gbp': 'Google Business Profile check',
    'land.footer.about': 'About',
    'land.footer.help': 'Help',
    'land.footer.privacy': 'Privacy',
    'land.footer.terms': 'Terms',
    'land.footer.kvkk': 'KVKK (TR data law)',
    'land.cmp.yes': 'Yes',
    'land.cmp.no': 'No',
    'land.footer.made_in': 'Made in Türkiye',

    // ─── Phase 6: single hero + proof strip + video ───────────────
    'land.hero.video_label': 'Short RanksUp dashboard video: traffic, AI visibility and App Store ranking for the KobiPratik case',
    'land.proof.label': 'Real case · KobiPratik',
    'land.proof.details': 'Case details',
    'land.how.video_cta': 'Watch the video (70 sec)',
    'land.how.video_title': 'How does RanksUp work?',
    'land.how.video_desc': 'Connect your site, let AI analyze it, publish and measure — in 3 steps.',
    'land.how.video_fallback': 'Your browser cannot play this video.',
    'land.res.case_title': 'KobiPratik: what changed in 3 months?',
    'land.res.col_metric': 'Metric',
    'land.res.col_before': 'Start',
    'land.res.col_after': 'After 3 months',
    'land.res.d1': 'Average daily clicks',
    'land.res.d2': 'Total clicks (30 days)',
    'land.res.d3': 'Search impressions (30 days)',
    'land.res.d4': 'Average App Store rank',
    'land.res.source': 'Source: Google Search Console (kobipratik.com) and App Store ranking measurements (May 16 – Aug 13, 1,264 measurements). KobiPratik is a site owned by the LuviHost group, which builds RanksUp.',
    'land.uc.link': 'How does it fit your business? See use cases',
    'land.test.from_reviews': 'reviews',
    'land.preview.live': 'SAMPLE',
    'land.preview.activity': 'Sample activity feed',
    'land.preview.sample': 'Sample screen',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.new_site': 'New site',
    'dashboard.sites': 'My Sites',
    'dashboard.empty': 'Enter your site address and AI maps your brand, competitors and SEO + GEO status in about a minute.',
    'dashboard.add_first': 'Add your first site',

    // Common
    'common.loading': 'Loading…',
    'common.error': 'An error occurred',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'common.finish': 'Finish',
    'common.try_again': 'Try again',
    'common.learn_more': 'Learn more',
    // ─── Landing v2 ──────────────────────────────────────────────
    'land2.hero.title': 'Does AI recommend you?',
    'land2.hero.sub': 'Your customers now ask ChatGPT, Gemini and Claude as well as Google. RanksUp measures whether your name appears in those answers, prepares content for the questions you miss, and grows your Google and App Store rankings from the same panel.',
    'land2.hero.checker': 'Enter your domain and we’ll test it across 6 AI assistants — it usually takes under a minute. No sign-up needed.',
    'land2.hero.signup': 'Create a free account',
    'land2.hero.watch': 'Watch how it works',
    'land2.sheet.label': 'Sample answer',
    'land2.sheet.query': 'Which bookkeeping app would you recommend for a small business?',
    'land2.sheet.a1': 'For small businesses the most recommended option is ',
    'land2.sheet.a2': '. It handles invoicing and inventory in one place and takes minutes to set up.',
    'land2.sheet.a3': ' Ledgerpine and Countwell are other commonly mentioned alternatives.',
    'land2.sheet.brand': 'yourbrand.com',
    'land2.sheet.source2': 'ledgerpine.example',
    'land2.sheet.sources': 'Sources',
    'land2.sheet.note': 'The orange mark is where your brand is mentioned. Test your domain to see your real result.',
    'land2.sheet.engines': 'Assistant',
    'land2.surf.title': 'Your customers look for you in three places.',
    'land2.surf.sub': 'On Google, in AI assistants and in app stores. RanksUp measures and grows all three from one panel.',
    'land2.surf.seo.title': 'Google',
    'land2.surf.seo.body': 'Tracks your rankings, finds stuck pages and fixes titles and descriptions with your approval.',
    'land2.surf.seo.mock_title': 'A bookkeeping guide for small businesses',
    'land2.surf.seo.mock_meta': 'From position 9 to 3',
    'land2.surf.geo.title': 'AI assistants',
    'land2.surf.geo.body': 'Measures which questions mention you in ChatGPT, Gemini, Claude, Perplexity, Grok and DeepSeek, and writes articles for the topics you miss.',
    'land2.surf.geo.mock': 'among the recommendations',
    'land2.surf.aso.title': 'App Store and Google Play',
    'land2.surf.aso.body': 'Tracks keyword rankings, suggests copy and writes it to App Store Connect with your approval.',
    'land2.surf.aso.mock_kw': 'bookkeeping',
    'land2.surf.mock_note': 'Views are illustrative.',
    'land2.how.title': 'Five minutes to set up. RanksUp runs the rest.',
    'land2.how.caption': 'A short clip from the panel',
    'land2.proof.kicker': 'KobiPratik, in 3 months',
    'land2.proof.unit': 'daily organic clicks',
    'land2.proof.more': 'All measurements',
    'land2.cta.title': 'Get named in the next answer.',
    'land2.cta.test': 'Test your domain',
    'land3.hero.a': 'Does AI',
    'land3.hero.b': 'recommend you?',
    'land3.hero.checker': 'Enter your domain and we’ll test it across {n} AI assistants — it usually takes under a minute. No sign-up needed.',
    'land3.engines': 'Measured across {n} assistants',
    'land3.surf.rail': 'Three search surfaces',
    'land3.surf.meta': 'One panel',
    'land3.surf.a': 'Your customers look for you',
    'land3.surf.b': 'in three places.',
    'land3.how.meta': '3 steps',
    'land3.how.a': 'Five minutes to set up.',
    'land3.how.b': 'RanksUp runs the rest.',
    'land3.proof.rail': 'Measured result',
    'land3.proof.meta': 'Search Console data',
    'land3.cmp.meta': 'Detailed comparison',
    'land3.cmp.a': 'Side by side with',
    'land3.cmp.b': 'popular SEO tools.',
    'land3.pricing.meta': 'All plan details',
    'land3.pricing.a': 'Try it first,',
    'land3.pricing.b': 'decide later.',
    'land3.faq.rail': 'Frequently asked questions',
    'land3.faq.meta': 'All questions',
    'land3.faq.a': 'First questions',
    'land3.faq.b': 'that come to mind.',
    'land3.cta.a': 'Get named',
    'land3.cta.b': 'in the next answer.',
    'vnav.menu': 'Menu',
    'vnav.product': 'Product',
    'vnav.resources': 'Resources',
    'vnav.about': 'About',
    'vnav.p.overview': 'Product overview',
    'vnav.p.ai': 'AI visibility measurement',
    'vnav.p.aso': 'ASO: App Store and Google Play',
    'vnav.p.asa': 'Apple Search Ads and App Store Connect',
    'vnav.p.autopilot': 'Automation',
    'vnav.p.video': 'RanksUp Video',
    'vnav.p.byok': 'Measure with your own API keys',
    'vnav.r.test': 'Free AI visibility test',
    'vnav.r.glossary': 'Glossary',
    'vnav.r.start': 'Quick start',
    'vnav.r.help': 'Help center',
    'vnav.r.bot': 'RanksUpBot',
    'vfoot.contact': 'Contact',
    'vfoot.cookies': 'Cookie preferences',
  },
} as const;

export type Key = keyof typeof dictionary['tr'];

const LOCALE_KEY = 'luviai_locale';
const LOCALE_EVENT = 'luviai:locale-change';

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'tr';
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved === 'en' || saved === 'tr') return saved;
  return navigator.language.startsWith('tr') ? 'tr' : 'en';
}

export function getLocale(): Locale {
  return readLocale();
}

export function setLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  // Hem custom event (ayni tab) hem storage event (diger tablar) tetiklenir
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }));
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LOCALE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(LOCALE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

const getServerSnapshot = (): Locale => 'tr';

export function useT() {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, getServerSnapshot);

  const t = (key: Key) => dictionary[locale][key] ?? key;

  return { t, locale, setLocale };
}
