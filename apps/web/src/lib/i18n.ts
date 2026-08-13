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
    'nav.signup': 'Erken Erişim',
    'nav.faq': 'SSS',
    'nav.compare': 'Karşılaştır',
    'nav.use_cases': 'Kullanım Senaryoları',

    // Hero
    'hero.title': 'Siteni ve sosyal medyanı, AI ile birlikte yönet',
    'hero.subtitle': "SEO ve GEO uyumlu içerikler otomatik üretilir, takvimden saatini seçersin, sitene ve sosyal kanallarına (X, LinkedIn) otomatik yayınlanır.",
    'hero.cta_primary': 'Erken Erişime Katıl',
    'hero.cta_secondary': 'Demo İzle',
    'hero.beta_note': 'Beta — şu anda davet üzeri kayıt',

    // Value cards (4 sütun)
    'value.title': 'Her şeyi tek panelden yönet',
    'value.subtitle': "Site analizinden makale üretimine, sosyal takvimden otomatik yayına — 4 işi tek dashboard'dan otomatikleştirir.",
    'value.v1.title': 'Siteni AI denetler',
    'value.v1.desc': "Sitenin SEO + AI görünürlük sağlığını dakikalar içinde tarar. Sorunları gösterir, çoğunu tek tıkla düzeltir. Google'da büyümeni takip eder.",
    'value.v2.title': 'Senin yerine yazar',
    'value.v2.desc': 'Marka sesinde, kapsamlı, 1800-2500 kelime makaleler. AI önce konu önerir, sen onaylarsın; içerik kalite kontrolünden geçer ve görsellerle birlikte hazır gelir.',
    'value.v3.title': 'Takvimden planla',
    'value.v3.desc': "Haftalık post takviminden gün ve saati sürükle-bırak seç, X ve LinkedIn'e otomatik gönderilir. Sen sadece onaylarsın.",
    'value.v4.title': 'Otomatik yayınla',
    'value.v4.desc': "WordPress, Webflow, Shopify, Ghost ve daha fazlası — kullandığın platforma direkt gönderir. Manuel kopyala-yapıştır yok.",

    // Features section
    'features.eyebrow': 'Tek panelde 6 büyük iş',
    'features.title': 'Saatlerce uğraşmana gerek yok',
    'features.subtitle': 'Site eklediğin an şunlar otomatik başlar — hepsi tek panelden yönetilir.',
    'features.f1.title': 'AI içerik üretimi',
    'features.f1.desc': 'SEO + GEO uyumlu, marka sesinde 1800-2500 kelimelik makaleler. 6 ajan zinciri (anahtar kelime → outline → yazar → editör → görsel → yayıncı).',
    'features.f2.title': 'Çok kanallı yayın',
    'features.f2.desc': 'WordPress, FTP, SFTP, GitHub Pages, custom webhook ve daha fazlası. Yayın zamanını takvimden sürükle-bırak ile belirle.',
    'features.f3.title': 'Sosyal medya otomatik',
    'features.f3.desc': 'X (Twitter) ve LinkedIn için marka sesinde post draft\'ları. Plana göre ayda 8-30 post otomatik takvime alınır.',
    'features.f4.title': 'AI Search (GEO)',
    'features.f4.desc': 'ChatGPT, Claude, Gemini, Perplexity\'de görünürlük takibi. llms.txt, schema markup, FAQ otomatik optimize edilir.',
    'features.f5.title': 'Reklam autopilot',
    'features.f5.desc': 'Google Ads + Meta Ads kampanya optimizasyonu. ROAS\'a göre 6 saatte bir bütçe ayarı yapılır.',
    'features.f6.title': 'Detaylı analitik',
    'features.f6.desc': 'GSC + GA4 + AI Citation entegrasyonu. Performans düşen makaleler 30 gün sonra otomatik revize edilir.',

    // Social schedule strip
    'social.eyebrow': 'Sosyal Medya Takvimi',
    'social.title': 'X ve LinkedIn için haftalık post takvimi',
    'social.desc': "Makale yayınlandığında otomatik post taslağı oluşturulur. Beğen, düzenle ya da olduğu gibi onayla — kanallarına otomatik gider.",
    'social.b1': 'Aboneliğine göre aylık otomatik post sayısı',
    'social.b2': 'Hangi gün hangi saatte gideceğini takvimden tek tıkla seç',
    'social.b3': 'Hashtag, etiket ve linkler otomatik vurgulanır',
    'social.b4': "X için karakter sayacı, görsel önizleme — yayından önce nasıl görüneceğini gör",
    'social.b5': "İçerik yetmediği gün slot atlanır, hazır olunca otomatik gönderilir",

    // How it works
    'how.eyebrow': 'Akış',
    'how.title': 'Site eklediğinden dakikalar sonra ilk makalen hazır',
    'how.s1.title': '1. Site adresini gir',
    'how.s1.desc': 'Sadece domain yaz. AI sitenin sektörünü, marka sesini ve eksiklerini otomatik analiz eder.',
    'how.s2.title': '2. AI sana konular önerir',
    'how.s2.desc': "Sektörün, rekabetin ve Google'da aranan sorularına göre yüksek potansiyelli konuları sıralar. Sen onaylarsın.",
    'how.s3.title': '3. Üretir ve yayınlar',
    'how.s3.desc': 'Saatini söyle, AI yazsın, kontrol etsin, görselleri eklesin ve sitenle sosyal medyana otomatik göndersin.',

    // GEO section
    'geo.eyebrow': 'AI Search optimizasyonu',
    'geo.title': 'ChatGPT, Claude, Gemini\'de seni alıntılasınlar',
    'geo.subtitle': 'GEO (Generative Engine Optimization) — geleneksel SEO\'nun ötesinde. Citation skoru günlük takip edilir.',
    'geo.b1': 'llms.txt + llms-full.txt otomatik üretilir',
    'geo.b2': 'Schema markup (Article + FAQPage + HowTo) eklenir',
    'geo.b3': 'AI crawler izinleri (GPTBot, ClaudeBot vb.) açılır',
    'geo.b4': 'Speakable content + multi-modal media (TTS audio) entegre',
    'geo.b5': 'Günlük citation snapshot — düşüş varsa email alarmı',

    // Ads section
    'ads.eyebrow': 'Reklam autopilot',
    'ads.title': 'Google Ads + Meta Ads ROAS\'a göre otomatik optimize edilir',
    'ads.subtitle': 'Reklam uzmanı tutmaya gerek yok. AI 6 saatte bir kampanyaları analiz edip bütçeyi en iyi performansa kaydırır.',
    'ads.b1': 'Auto-bid + auto-pause düşük performanslı reklamlar',
    'ads.b2': 'AI ile reklam görseli (Gemini) + metin draft\'ı',
    'ads.b3': 'Multi-platform tek panel (Google + Meta + GA4 conversion)',
    'ads.b4': 'A/B test sürekli — kazanan creative\'i otomatik scale',
    'ads.impact': '<strong class="text-orange-500">Etki:</strong> Ortalama bir KOBİ Google + Meta\'ya ayda 5-15k ₺ harcıyor. Kötü yönetilirse %30-50\'si israf olur. <strong>RanksUp bunu otomatik kapatır → ayda 1.5-7.5k ₺ tasarruf.</strong>',

    // Comparison table
    'compare.title': 'RanksUp vs klasik kadro',
    'compare.subtitle': 'Tek bir panel, 6 farklı uzmanın yaptığı işi yapıyor.',
    'compare.col_need': 'İhtiyaç',
    'compare.col_classic': 'Klasik',
    'compare.col_luviai': 'RanksUp',
    'compare.row_seo': 'SEO uzmanı',
    'compare.row_writer': 'Makale yazarı',
    'compare.row_social': 'Sosyal medya yöneticisi',
    'compare.row_ads': 'Reklam uzmanı (Google + Meta)',
    'compare.row_ab': 'A/B test analist',
    'compare.row_ga': 'GA4 expert',
    'compare.row_ai': 'AI Search optimizasyonu',
    'compare.row_total': 'TOPLAM',
    'compare.classic_total': '78-140k ₺/ay',
    'compare.luviai_total_label': 'RanksUp ile',
    'compare.luviai_total_subtext': 'aylık başlangıç (Pro plan)',

    // Final CTA
    'final.title': 'Saatlerce uğraşmaktan kurtul. Bugün başla.',
    'final.subtitle': 'İlk makalen ücretsiz dene. PayTR güvenli ödeme. Aylık iptal, taahhüt yok.',
    'final.cta_primary': 'Ücretsiz Dene',
    'final.cta_secondary': 'Plan ve fiyatları gör',

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
    'footer.contact.status': 'Sistem durumu',
    'footer.tagline': 'Türkiye merkezli GEO · SEO · ASO · ASA otopilotu.',
    'footer.copyright': '© 2026 RanksUp. Tüm hakları saklıdır.',

    // Pricing
    'pricing.title': 'Plan Seçenekleri',
    'pricing.subtitle': '2 makale ücretsiz, kart gerekmez, dilediğin zaman iptal.',
    'pricing.monthly': 'Aylık',
    'pricing.annual': 'Yıllık',
    'pricing.save': 'kazan',
    'pricing.cta': '2 Makale Ücretsiz Dene',
    'pricing.popular': 'EN ÇOK TERCİH EDİLEN',
    'pricing.articles_per_month': 'SEO makale/ay',
    'pricing.social_posts_per_month': 'AI görünürlük testi/ay (7 motor)',
    'pricing.sites': 'site',
    'pricing.all_publish_targets': 'Tüm yayın hedefleri',
    'pricing.markdown_only': 'Sadece Markdown ZIP',
    'pricing.security_note': '💳 PayTR güvenli ödeme · ✅ İstediğin zaman iptal · 🇹🇷 KDV dahil',
    'pricing.grandfathering_banner': 'Eski fiyatınızla devam ediyorsunuz — {date} tarihine kadar geçerli.',
    'pricing.annual_save_badge': '-%17',
    'pricing.contact_sales': 'Bizimle iletişime geç',
    'pricing.free_start': 'Ücretsiz başla',
    'pricing.note_free_trial': '2 makale ücretsiz · Kredi kartı yok',

    // ─── Landing — Nav ──────────────────────────────────────────
    'land.nav.solution': 'Çözüm',
    'land.nav.how': 'Nasıl çalışır',
    'land.nav.results': 'Sonuçlar',
    'land.nav.pricing': 'Fiyat',
    'land.nav.faq': 'SSS',
    'land.nav.login': 'Giriş',
    'land.nav.signup': 'Ücretsiz başla',

    // ─── Landing — Hero ─────────────────────────────────────────
    'land.hero.badge': 'GEO · SEO · ASO · ASA — hepsi tek panelde',
    'land.hero.title_pre': 'Senin yerine pazarlama yapan',
    'land.hero.title_brand': 'AI',
    'land.hero.title_dot': '.',
    'land.hero.subtitle': 'Siten ve mobil uygulaman — tek panelden. RanksUp AI cevaplarındaki görünürlüğünü ölçer, eksik kaldığın soruları bulur, GEO uyumlu içeriği üretir, App Store sıralamanı ve Apple Search Ads kampanyanı optimize eder.',
    'land.hero.cta_primary': 'Ücretsiz başla — kart gerekmez',
    'land.hero.cta_secondary': 'Nasıl çalışır (2dk)',
    'land.hero.tag_no_card': 'Kart istenmez',
    'land.hero.tag_free_articles': '2 makale ücretsiz',
    'land.hero.tag_cancel': 'İstediğin zaman iptal',
    'land.hero.tag_setup': '5 dakikada kurulum',
    'land.hero.authority_apple': 'Apple Search Ads Open API Partner',
    'land.hero.authority_ai': 'OpenAI · Anthropic · Google Cloud',
    'land.hero.authority_security': 'AES-256 · TLS 1.3',
    'land.hero.authority_kvkk': 'KVKK uyumlu · TR sunucu',
    'land.hero.authority_uptime': '%99.9 SLA uptime',
    'land.hero.ai_bar': 'Markanı her major AI platformunda izle',
    'land.hero.integration_bar': 'Ayrıca entegre çalıştığımız platformlar',

    // ─── Landing — Pain (PAS) ───────────────────────────────────
    'land.pain.eyebrow': 'Tanıdık geldi mi?',
    'land.pain.title': 'Pazarlama bütçen patlıyor, sonuç gelmiyor.',
    'land.pain.c1_cost': '₺15.000/ay',
    'land.pain.c1_title': 'SEO ajansı',
    'land.pain.c1_body': 'Aylar süren raporlar, belirsiz sonuç. Hangi keyword\'de gerçekten ön plandasın bilmiyorsun.',
    'land.pain.c2_cost': '₺25.000/ay',
    'land.pain.c2_title': 'ASO + ASA uzmanı',
    'land.pain.c2_body': 'App Store keyword takibi + Apple Search Ads ayrı uzmanlar. Aylık raporlar tablolarla dolu, eylem yok.',
    'land.pain.c3_cost': '₺8.000/ay',
    'land.pain.c3_title': 'Freelance içerik yazarı',
    'land.pain.c3_body': 'GEO bilmeyen yazar, AI cevaplarında hiç çıkmayan içerik üretir. Üstüne her seferinde 2 hafta gecikme.',
    'land.pain.total': 'Aylık toplam: ₺48.000+ · RanksUp: ₺1.499\'dan başlar',

    // ─── Landing — Pricing section ──────────────────────────────
    'land.pricing.eyebrow': 'Şeffaf fiyat',
    'land.pricing.title': 'Bugün başla, kart sonra.',
    'land.pricing.subtitle': '2 makale ücretsiz · İstediğin zaman iptal · Gizli ücret yok',
    'land.pricing.most_popular': '⭐ En Çok Tercih Edilen',
    'land.pricing.per_month': '/ay',
    'land.pricing.per_year': '/yıl',
    'land.pricing.annual_billing': 'Yıllık faturalandırılır',
    'land.pricing.monthly_billing': 'Aylık faturalandırılır',
    'land.pricing.contact_us': 'Bizimle iletişime geç',
    'land.pricing.start_free': 'Ücretsiz başla',
    'land.pricing.support_em24': 'Destek: e-posta 24 saat',
    'land.pricing.support_em4': 'Destek: e-posta 4 saat',
    'land.pricing.support_priority': 'Destek: öncelikli + Slack',
    'land.pricing.support_dedicated': 'Destek: özel hesap yöneticisi + SLA',
    'land.pricing.footer_note': 'Hepsinde: tüm AI modüller · Apple Search Ads · 10+ yayın hedefi · API erişimi',

    // ─── Landing — FAQ ──────────────────────────────────────────
    'land.faq.eyebrow': 'Sıkça sorulanlar',
    'land.faq.title': 'Akla gelen ilk sorular',
    'land.faq.cta': 'Daha fazla soru? Tam SSS\'ye git →',
    'land.faq.q1': 'Hangi sitelerde çalışıyor?',
    'land.faq.a1': 'Herhangi bir web sitesi (WordPress, Shopify, Webflow, custom). Mobil app entegrasyonu için iOS App Store ID (adamId) yeterli. Bağlamak için sadece URL yapıştır.',
    'land.faq.q2': 'Kredi kartı vermem gerekiyor mu?',
    'land.faq.a2': 'Hayır. Ücretsiz deneme için kart istenmez. 2 ücretsiz makale hakkını kullandıktan sonra devam etmek istersen plan seçer ve kart eklersin, istemezsen hesap pasif kalır.',
    'land.faq.q3': 'AI sektörümü gerçekten anlayabilir mi?',
    'land.faq.a3': 'Evet. Onboarding sırasında siteni tarayıp sektörünü %95+ doğrulukla belirler. Yanlış tahmin ederse manuel düzeltebilirsin, sonraki içerikler ona göre üretilir.',
    'land.faq.q4': 'Apple Search Ads için Apple Developer hesabım gerekli mi?',
    'land.faq.a4': 'Evet, ASA için Apple\'ın istediği credentials sende olmalı (Org ID + Key ID + Public Key). RanksUp senin yerine wizard ile kurar — terminal/openssl gerekmez. 3 adım.',
    'land.faq.q5': 'Üretilen içerikler benim mi?',
    'land.faq.a5': 'Evet, %100 senin. RanksUp ürettiği makale, görsel ve metin için telif iddia etmez. Sınırsız kullanabilirsin (planındaki kota dahilinde).',
    'land.faq.q6': 'İstediğim zaman iptal edebilir miyim?',
    'land.faq.a6': 'Evet. Tek tıkla iptal, ay sonuna kadar kullanmaya devam edersin. İade politikası: ilk 7 gün içinde koşulsuz para iadesi.',

    // ─── Landing — Stats ────────────────────────────────────────
    'land.stats.setup': 'Ortalama kurulum',
    'land.stats.integrations': 'Entegrasyon',
    'land.stats.team': 'Aktif ekip',
    'land.stats.uptime': 'SLA uptime',

    // ─── Landing — Solution (4 card) ────────────────────────────
    'land.sol.eyebrow': 'Çözüm',
    'land.sol.title_a': '4 ayrı uzmana ihtiyacın yok.',
    'land.sol.title_b': 'Hepsi tek AI panel.',
    'land.sol.c1.tag': 'SEO + AEO',
    'land.sol.c1.title': "AI'lara görünür ol",
    'land.sol.c1.body': "ChatGPT, Claude ve Gemini'de senin adının geçtiği yerleri gösterir. Hangi sorularda çıkmıyorsun, AI önerir, makaleyi otomatik yazar.",
    'land.sol.c1.b1': '50+ keyword takibi',
    'land.sol.c1.b2': 'AI Citation Tracker',
    'land.sol.c1.b3': 'Otomatik makale üretimi',
    'land.sol.c1.b4': 'Çoklu yayın hedefi',
    'land.sol.c2.tag': 'ASO + APPLE SEARCH ADS',
    'land.sol.c2.title': "App Store'da 1. sıraya",
    'land.sol.c2.body': 'Mobil uygulamandaki rakip analizi, keyword sıralaması, Apple Search Ads kampanya yönetimi. Auto-Pilot, düşük performansı pause edip yenisini ekler.',
    'land.sol.c2.b1': 'App Store + Play Store skoru',
    'land.sol.c2.b2': 'AI keyword araştırması',
    'land.sol.c2.b3': 'ASA kampanya + bid otomasyonu',
    'land.sol.c2.b4': 'Auto-Pilot: kendiliğinden optimize',
    'land.sol.c3.tag': 'GEO İÇERİK',
    'land.sol.c3.title': 'AI cevaplarına giren içerik üret',
    'land.sol.c3.body': 'Hangi soruda görünmediğini bulur, o soruyu hedefleyen makaleyi marka sesinde yazar, şema işaretlemesiyle yayınlar.',
    'land.sol.c3.b1': 'Eksik soru tespiti (fırsat radarı)',
    'land.sol.c3.b2': 'Marka sesinde makale + görsel',
    'land.sol.c3.b3': 'Schema.org + AEO işaretleme',
    'land.sol.c3.b4': 'Yayın öncesi QA kapısı',
    'land.sol.c4.tag': 'OTOMASYON',
    'land.sol.c4.title': 'Auto-Pilot — sen uyurken çalışır',
    'land.sol.c4.body': "Haftalık AI rapor, ranking düştüğünde alarm, fırsat keyword'ler için ASA otomatik açar. Sen sadece kararı ver.",
    'land.sol.c4.b1': 'Günlük rank check',
    'land.sol.c4.b2': 'Anomaly alert',
    'land.sol.c4.b3': "Cron'lu rapor & öneri",
    'land.sol.c4.b4': "Bütçe cap'lı auto-pilot",

    // ─── Landing — How it works (3 step) ────────────────────────
    'land.how.eyebrow': '3 ADIM',
    'land.how.title': '5 dakikada yayında.',
    'land.how.subtitle': "Teknik bilgi gerekmez. Onboarding sırasında AI senin sektörünü tahmin eder, ilk içerikleri üretir.",
    'land.how.s1.title': 'Siteni bağla',
    'land.how.s1.body': "URL'i yapıştır. RanksUp siteyi tarar, sektörünü belirler, ilk 50 keyword'ü çıkarır.",
    'land.how.s2.title': 'AI analiz',
    'land.how.s2.body': "Rakiplerin metadata'sı, sıralamalar, eksik keyword'ler, AI Citation skorun — hepsi 2 dakikada.",
    'land.how.s3.title': 'Yayında',
    'land.how.s3.body': "İlk makale, ilk AI görünürlük raporu, ilk ASA önerisi hazır. Auto-Pilot açarsan sen hiçbir şey yapmazsın.",

    // ─── Landing — Results (3 KPI) ──────────────────────────────
    'land.res.eyebrow': 'Sonuçlar',
    'land.res.title': 'Sayılarla RanksUp etkisi.',
    'land.res.r1.title': 'ortalama organic trafik artışı',
    'land.res.r1.sub': 'ilk 30 günde',
    'land.res.r2.title': 'App Store Ads CPI düşüşü',
    'land.res.r2.sub': 'Auto-Pilot 60 gün sonrası',
    'land.res.r3.title': 'içerik üretim hızı',
    'land.res.r3.sub': 'manuel sürece kıyasla',

    // ─── Landing — Compare (table) ──────────────────────────────
    'land.cmp.eyebrow': 'Karşılaştırma',
    'land.cmp.title': '5 SaaS yerine 1 RanksUp.',
    'land.cmp.subtitle': "Şu an birden fazla araç için ödüyorsan büyük ihtimalle %80 tasarruf edersin.",
    'land.cmp.col_feature': 'Özellik',
    'land.cmp.row1': 'Web SEO + keyword takibi',
    'land.cmp.row2': 'AI Görünürlük (ChatGPT/Claude/Gemini)',
    'land.cmp.row3': 'App Store + Play Store ASO',
    'land.cmp.row4': 'Apple Search Ads yönetimi',
    'land.cmp.row5': 'Agent Readiness (AXO) taraması',
    'land.cmp.row6': 'Rakip AI payı (share of voice)',
    'land.cmp.row7': 'AI makale üretimi',
    'land.cmp.row8': 'Auto-Pilot otomasyon',
    'land.cmp.row_price': 'Aylık fiyat (yaklaşık)',
    'land.cmp.note': "* Karşılaştırma resmi web sitelerinin Pro/Team paket fiyatlarına göre. Mayıs 2026 itibarıyla.",

    // ─── Landing — Use Cases (3 card) ───────────────────────────
    'land.uc.eyebrow': 'Kimler kullanıyor',
    'land.uc.title': 'Senin iş modelin için biçildi mi?',
    'land.uc.c1.tag': 'KOBİ + HİZMET',
    'land.uc.c1.title': 'Muhasebe / hukuk / danışmanlık',
    'land.uc.c1.body': "Hedef müşteri Google ve ChatGPT'de seni arıyor. RanksUp haftalık 3 makale yazar, Linkedin'de paylaşır, organic trafik gelir.",
    'land.uc.c1.before': 'Ayda 200 organic ziyaret',
    'land.uc.c1.after': '6 ay sonra ayda 4.200',
    'land.uc.c2.tag': 'MOBİL APP SAHİBİ',
    'land.uc.c2.title': 'iOS / Android uygulama',
    'land.uc.c2.body': "App Store'da rakiplerin 'en iyi X uygulaması' aramasında 1. sırada — sen 47. Auto-Pilot ASA açar, sıralaman yükselir.",
    'land.uc.c2.before': 'Aylık 50 organic install',
    'land.uc.c2.after': '60 gün sonra ayda 1.800',
    'land.uc.c3.tag': 'E-TİCARET',
    'land.uc.c3.title': 'Marka odaklı online satış',
    'land.uc.c3.body': 'Müşterin artık Google yerine ChatGPT\'ye soruyor. RanksUp hangi ürün sorularında görünmediğini bulur ve o soruları hedefleyen içeriği üretir.',
    'land.uc.c3.before': 'AI cevaplarında 0 görünürlük',
    'land.uc.c3.after': '90 gün sonra 7 motorun 4\'ünde',
    'land.uc.before_label': 'ÖNCE',
    'land.uc.after_label': 'SONRA',

    // ─── Landing — Testimonials ─────────────────────────────────
    'land.test.eyebrow': 'Kullanıcı yorumları',
    'land.test.title': 'Ekipler ne diyor?',
    'land.test.empty': 'İlk müşteri yorumları toplanıyor — sen de ilk kullananlardan ol, deneyimini paylaş.',

    // ─── Landing — Pricing extras ───────────────────────────────
    'land.pric.eyebrow': 'Şeffaf Fiyat',
    'land.pric.title': 'Bugün başla, kart sonra.',
    'land.pric.subtitle': '2 makale ücretsiz · İstediğin zaman iptal · Gizli ücret yok',
    'land.pric.monthly': 'Aylık',
    'land.pric.annual': 'Yıllık',
    'land.pric.discount_badge': '%17 indirim',
    'land.pric.per_month': '/ay',
    'land.pric.annual_billed_prefix': 'Yıllık',
    'land.pric.annual_billed_suffix': 'faturalandırılır',
    'land.pric.monthly_billed': 'Aylık faturalandırılır',
    'land.pric.bullet_articles': 'AI makale / ay',
    'land.pric.bullet_posts': 'AI görünürlük testi / ay',
    'land.pric.bullet_site': 'site',
    'land.pric.bullet_sites': 'site',
    'land.pric.bullet_support': 'Destek:',
    'land.pric.cta_free': 'Planı seç',
    'land.pric.cta_contact': 'Bizimle iletişime geç',
    'land.pric.footer_note': 'Hepsinde: tüm AI modüller · Apple Search Ads · 10+ yayın hedefi · API erişimi',
    'land.pric.plan_starter': 'Başlangıç',
    'land.pric.plan_pro': 'Profesyonel',
    'land.pric.plan_agency': 'Ajans',
    'land.pric.plan_enterprise': 'Kurumsal',
    'land.pric.enterprise_label': 'Özel',

    // ─── Landing — Final CTA ────────────────────────────────────
    'land.cta.title': 'AI çağının pazarlamasına başla',
    'land.cta.subtitle': 'İlk 2 makale ücretsiz, kart gerekmez. 5 dakikada kurulum.',
    'land.cta.button': 'Ücretsiz başla',
    'land.cta.secondary': 'Önce demoyu izle',

    // ─── Footer ─────────────────────────────────────────────────
    'land.footer.product': 'Ürün',
    'land.footer.resources': 'Kaynaklar',
    'land.footer.company': 'Şirket',
    'land.footer.legal': 'Yasal',
    'land.footer.tagline': 'AI çağının pazarlama platformu — Türkiye',
    'land.footer.rights': 'Tüm hakları saklıdır',

    // Dashboard
    'dashboard.title': 'Panel',
    'dashboard.new_site': '+ Yeni Site',
    'dashboard.sites': 'Sitelerim',
    'dashboard.empty': 'Henüz site eklenmemiş.',
    'dashboard.add_first': 'İlk siteni ekle →',

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
  },
  en: {
    // Nav
    'nav.home': 'Home',
    'nav.pricing': 'Pricing',
    'nav.dashboard': 'Dashboard',
    'nav.login': 'Sign In',
    'nav.signup': 'Early Access',
    'nav.faq': 'FAQ',
    'nav.compare': 'Compare',
    'nav.use_cases': 'Use Cases',

    // Hero
    'hero.title': 'Manage your website and social with AI, on autopilot',
    'hero.subtitle': 'SEO + GEO ready content gets generated automatically, you pick the time on the calendar, and it publishes to your site and social channels (X, LinkedIn).',
    'hero.cta_primary': 'Join Early Access',
    'hero.cta_secondary': 'Watch Demo',
    'hero.beta_note': 'Beta — invite only',

    // Value cards (4 sütun)
    'value.title': 'Manage everything from a single panel',
    'value.subtitle': 'From site audits to article generation, social calendar to auto-publishing — 4 jobs automated from one dashboard.',
    'value.v1.title': 'AI audits your site',
    'value.v1.desc': "Scans your SEO + AI-search health in minutes. Shows the issues, fixes most of them with one click. Tracks your growth on Google.",
    'value.v2.title': 'Writes for you',
    'value.v2.desc': "Comprehensive 1800-2500 word articles in your brand voice. AI suggests topics first, you approve; content goes through quality control and arrives ready with images.",
    'value.v3.title': 'Plan from the calendar',
    'value.v3.desc': "Pick the day and time from a weekly post calendar — it auto-publishes to X and LinkedIn. You only approve.",
    'value.v4.title': 'Auto-publish',
    'value.v4.desc': "WordPress, Webflow, Shopify, Ghost and more — sends straight to the platform you use. No manual copy-paste.",

    // Features section
    'features.eyebrow': 'One panel, six big jobs',
    'features.title': 'You don\'t have to spend hours on it',
    'features.subtitle': 'The moment you add a site, the following kick in automatically — all controlled from a single panel.',
    'features.f1.title': 'AI content generation',
    'features.f1.desc': 'SEO + GEO ready, brand-voice articles of 1800-2500 words. A 6-agent chain (keyword → outline → writer → editor → visuals → publisher).',
    'features.f2.title': 'Multi-channel publishing',
    'features.f2.desc': 'WordPress, FTP, SFTP, GitHub Pages, custom webhook and more. Pick the publish time on a drag-and-drop calendar.',
    'features.f3.title': 'Social media automation',
    'features.f3.desc': 'Brand-voice post drafts for X (Twitter) and LinkedIn. 8-30 posts/month auto-scheduled depending on plan.',
    'features.f4.title': 'AI Search (GEO)',
    'features.f4.desc': 'Track visibility on ChatGPT, Claude, Gemini, Perplexity. Auto-optimized llms.txt, schema markup, FAQ.',
    'features.f5.title': 'Ads autopilot',
    'features.f5.desc': 'Google Ads + Meta Ads campaign optimization. Budget rebalanced based on ROAS every 6 hours.',
    'features.f6.title': 'Detailed analytics',
    'features.f6.desc': 'GSC + GA4 + AI Citation integration. Underperforming articles get auto-revised after 30 days.',

    // Social schedule strip
    'social.eyebrow': 'Social Media Calendar',
    'social.title': 'Weekly post calendar for X and LinkedIn',
    'social.desc': 'When an article publishes, a draft post is created automatically. You just like, edit or approve.',
    'social.b1': 'Auto monthly post count based on your plan',
    'social.b2': 'Pick day and time from the calendar with one click',
    'social.b3': 'Hashtags, mentions and links highlighted automatically',
    'social.b4': "Character counter and visual preview for X — see how it'll look before posting",
    'social.b5': "Slots skipped on days when content isn't ready, sent automatically when it is",

    // How it works
    'how.eyebrow': 'Flow',
    'how.title': 'Your first article is ready minutes after adding your site',
    'how.s1.title': '1. Enter your site URL',
    'how.s1.desc': "Just type your domain. AI automatically analyzes your industry, brand voice and what's missing.",
    'how.s2.title': '2. AI suggests topics',
    'how.s2.desc': 'High-potential topics ranked by your industry, competition and Google search demand. You approve them.',
    'how.s3.title': '3. Generate and publish',
    'how.s3.desc': 'Tell it the time — AI writes, reviews, adds visuals and ships to your site and social channels automatically.',

    // GEO
    'geo.eyebrow': 'AI Search optimization',
    'geo.title': 'Get cited by ChatGPT, Claude, Gemini',
    'geo.subtitle': 'GEO (Generative Engine Optimization) — beyond traditional SEO. Daily citation score tracking.',
    'geo.b1': 'Auto-generated llms.txt + llms-full.txt',
    'geo.b2': 'Schema markup (Article + FAQPage + HowTo) injected',
    'geo.b3': 'AI crawler permissions (GPTBot, ClaudeBot, etc.) opened',
    'geo.b4': 'Speakable content + multi-modal media (TTS audio) integrated',
    'geo.b5': 'Daily citation snapshot — email alarm on drop',

    // Ads
    'ads.eyebrow': 'Ads autopilot',
    'ads.title': 'Google Ads + Meta Ads optimized automatically by ROAS',
    'ads.subtitle': 'No need to hire an ads expert. AI analyzes campaigns every 6 hours and shifts budget to the best performers.',
    'ads.b1': 'Auto-bid + auto-pause underperforming ads',
    'ads.b2': 'AI ad creative (Gemini) + copy drafts',
    'ads.b3': 'Multi-platform single panel (Google + Meta + GA4 conversion)',
    'ads.b4': 'Continuous A/B test — auto-scale winning creatives',
    'ads.impact': '<strong class="text-orange-500">Impact:</strong> An average SMB spends 5-15k ₺/month on Google + Meta. Without good management, 30-50% gets wasted. <strong>RanksUp plugs the leak — saving 1.5-7.5k ₺/month.</strong>',

    // Comparison
    'compare.title': 'RanksUp vs the classic team',
    'compare.subtitle': 'A single panel does the work of 6 different specialists.',
    'compare.col_need': 'Need',
    'compare.col_classic': 'Classic',
    'compare.col_luviai': 'RanksUp',
    'compare.row_seo': 'SEO specialist',
    'compare.row_writer': 'Article writer',
    'compare.row_social': 'Social media manager',
    'compare.row_ads': 'Ads specialist (Google + Meta)',
    'compare.row_ab': 'A/B test analyst',
    'compare.row_ga': 'GA4 expert',
    'compare.row_ai': 'AI Search optimization',
    'compare.row_total': 'TOTAL',
    'compare.classic_total': '78-140k ₺/month',
    'compare.luviai_total_label': 'With RanksUp',
    'compare.luviai_total_subtext': 'monthly starting (Pro plan)',

    // Final CTA
    'final.title': 'Stop spending hours on it. Start today.',
    'final.subtitle': "Try your first article free. Secure PayTR payment. Monthly cancel, no commitment.",
    'final.cta_primary': 'Try Free',
    'final.cta_secondary': 'See plans & pricing',

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
    'footer.contact.status': 'System status',
    'footer.tagline': 'Turkey-based GEO · SEO · ASO · ASA autopilot.',
    'footer.copyright': '© 2026 RanksUp. All rights reserved.',

    // Pricing
    'pricing.title': 'Plans & Pricing',
    'pricing.subtitle': '2 free articles, no card required, cancel anytime.',
    'pricing.monthly': 'Monthly',
    'pricing.annual': 'Annual',
    'pricing.save': 'save',
    'pricing.cta': 'Try 2 Articles Free',
    'pricing.popular': 'MOST POPULAR',
    'pricing.articles_per_month': 'SEO articles/mo',
    'pricing.social_posts_per_month': 'AI visibility tests/mo (7 engines)',
    'pricing.sites': 'sites',
    'pricing.all_publish_targets': 'All publish targets',
    'pricing.markdown_only': 'Markdown ZIP only',
    'pricing.security_note': '💳 PayTR secure payment · ✅ Cancel anytime · 🇹🇷 VAT included',
    'pricing.grandfathering_banner': 'You are continuing on your old price — valid until {date}.',
    'pricing.annual_save_badge': '-17%',
    'pricing.contact_sales': 'Contact sales',
    'pricing.free_start': 'Start free',
    'pricing.note_free_trial': '2 free articles · No credit card',

    // ─── Landing — Nav ──────────────────────────────────────────
    'land.nav.solution': 'Solution',
    'land.nav.how': 'How it works',
    'land.nav.results': 'Results',
    'land.nav.pricing': 'Pricing',
    'land.nav.faq': 'FAQ',
    'land.nav.login': 'Sign in',
    'land.nav.signup': 'Start free',

    // ─── Landing — Hero ─────────────────────────────────────────
    'land.hero.badge': 'GEO · SEO · ASO · ASA — all in one panel',
    'land.hero.title_pre': 'AI that does marketing',
    'land.hero.title_brand': 'for you',
    'land.hero.title_dot': '.',
    'land.hero.subtitle': 'Your website and mobile app — from one panel. RanksUp measures your visibility in AI answers, finds the questions you are missing, generates GEO-ready content, and optimizes your App Store ranking and Apple Search Ads.',
    'land.hero.cta_primary': 'Start free — no card required',
    'land.hero.cta_secondary': 'How it works (2 min)',
    'land.hero.tag_no_card': 'No card needed',
    'land.hero.tag_free_articles': '2 free articles',
    'land.hero.tag_cancel': 'Cancel anytime',
    'land.hero.tag_setup': '5-minute setup',
    'land.hero.authority_apple': 'Apple Search Ads Open API Partner',
    'land.hero.authority_ai': 'OpenAI · Anthropic · Google Cloud',
    'land.hero.authority_security': 'AES-256 · TLS 1.3',
    'land.hero.authority_kvkk': 'KVKK compliant · TR servers',
    'land.hero.authority_uptime': '99.9% SLA uptime',
    'land.hero.ai_bar': 'Track your brand on every major AI platform',
    'land.hero.integration_bar': 'Other platforms we integrate with',

    // ─── Landing — Pain (PAS) ───────────────────────────────────
    'land.pain.eyebrow': 'Sound familiar?',
    'land.pain.title': 'Your marketing budget is exploding, results aren\'t.',
    'land.pain.c1_cost': '₺15,000/mo',
    'land.pain.c1_title': 'SEO agency',
    'land.pain.c1_body': 'Months of reports, unclear results. You don\'t know which keyword you actually rank for.',
    'land.pain.c2_cost': '₺25,000/mo',
    'land.pain.c2_title': 'ASO + ASA specialist',
    'land.pain.c2_body': 'App Store keyword tracking + Apple Search Ads need separate experts. Monthly reports full of tables, zero action.',
    'land.pain.c3_cost': '₺8,000/mo',
    'land.pain.c3_title': 'Freelance content writer',
    'land.pain.c3_body': 'A writer who does not know GEO produces content that never shows up in AI answers. Always 2 weeks behind schedule.',
    'land.pain.total': 'Monthly total: ₺48,000+ · RanksUp: starts from ₺1,499',

    // ─── Landing — Pricing section ──────────────────────────────
    'land.pricing.eyebrow': 'Transparent pricing',
    'land.pricing.title': 'Start today, pay later.',
    'land.pricing.subtitle': '2 free articles · Cancel anytime · No hidden fees',
    'land.pricing.most_popular': '⭐ Most Popular',
    'land.pricing.per_month': '/mo',
    'land.pricing.per_year': '/yr',
    'land.pricing.annual_billing': 'Billed annually',
    'land.pricing.monthly_billing': 'Billed monthly',
    'land.pricing.contact_us': 'Contact us',
    'land.pricing.start_free': 'Start free',
    'land.pricing.support_em24': 'Support: email 24h',
    'land.pricing.support_em4': 'Support: email 4h',
    'land.pricing.support_priority': 'Support: priority + Slack',
    'land.pricing.support_dedicated': 'Support: dedicated account manager + SLA',
    'land.pricing.footer_note': 'In all plans: all AI modules · Apple Search Ads · 10+ publish targets · API access',

    // ─── Landing — FAQ ──────────────────────────────────────────
    'land.faq.eyebrow': 'Frequently asked',
    'land.faq.title': 'First questions that come to mind',
    'land.faq.cta': 'More questions? Go to full FAQ →',
    'land.faq.q1': 'Which websites does it work on?',
    'land.faq.a1': 'Any website (WordPress, Shopify, Webflow, custom). For mobile app integration, just iOS App Store ID (adamId) is enough. Just paste the URL to connect.',
    'land.faq.q2': 'Do I need to enter a credit card?',
    'land.faq.a2': 'No. No card needed for the free trial. After you use your 2 free article quota, if you want to continue you choose a plan and add a card; otherwise your account stays passive.',
    'land.faq.q3': 'Can AI really understand my industry?',
    'land.faq.a3': 'Yes. During onboarding, it scans your site and determines your industry with 95%+ accuracy. If it predicts wrong you can fix it manually, and subsequent content adapts accordingly.',
    'land.faq.q4': 'Do I need an Apple Developer account for Apple Search Ads?',
    'land.faq.a4': 'Yes, you need Apple\'s required credentials (Org ID + Key ID + Public Key). RanksUp sets it up with a wizard — no terminal/openssl needed. 3 steps.',
    'land.faq.q5': 'Do I own the generated content?',
    'land.faq.a5': 'Yes, 100% yours. RanksUp claims no copyright on the articles, images and text it generates. Unlimited use (within your plan quota).',
    'land.faq.q6': 'Can I cancel anytime?',
    'land.faq.a6': 'Yes. One-click cancel, continue using until end of billing period. Refund policy: full refund within first 7 days, no questions asked.',

    // ─── Landing — Stats ────────────────────────────────────────
    'land.stats.setup': 'Avg. setup time',
    'land.stats.integrations': 'Integrations',
    'land.stats.team': 'Active team',
    'land.stats.uptime': 'SLA uptime',

    // ─── Landing — Solution (4 card) ────────────────────────────
    'land.sol.eyebrow': 'Solution',
    'land.sol.title_a': "You don't need 4 separate specialists.",
    'land.sol.title_b': 'All in one AI panel.',
    'land.sol.c1.tag': 'SEO + AEO',
    'land.sol.c1.title': 'Be visible on AIs',
    'land.sol.c1.body': 'See where your name appears in ChatGPT, Claude, and Gemini. Which queries you\'re missing — AI suggests, writes the article automatically.',
    'land.sol.c1.b1': '50+ keyword tracking',
    'land.sol.c1.b2': 'AI Citation Tracker',
    'land.sol.c1.b3': 'Automated article generation',
    'land.sol.c1.b4': 'Multi-channel publishing',
    'land.sol.c2.tag': 'ASO + APPLE SEARCH ADS',
    'land.sol.c2.title': 'Get to #1 on App Store',
    'land.sol.c2.body': 'Competitor analysis, keyword ranking, Apple Search Ads campaign management for your mobile app. Auto-Pilot pauses low performers and adds new ones.',
    'land.sol.c2.b1': 'App Store + Play Store score',
    'land.sol.c2.b2': 'AI keyword research',
    'land.sol.c2.b3': 'ASA campaign + bid automation',
    'land.sol.c2.b4': 'Auto-Pilot: self-optimizing',
    'land.sol.c3.tag': 'GEO CONTENT',
    'land.sol.c3.title': 'Content that lands in AI answers',
    'land.sol.c3.body': 'Finds the questions you are missing, writes the article targeting them in your brand voice, publishes it with schema markup.',
    'land.sol.c3.b1': 'Gap detection (opportunity radar)',
    'land.sol.c3.b2': 'Brand-voice article + image',
    'land.sol.c3.b3': 'Schema.org + AEO markup',
    'land.sol.c3.b4': 'Pre-publish QA gate',
    'land.sol.c4.tag': 'AUTOMATION',
    'land.sol.c4.title': 'Auto-Pilot — works while you sleep',
    'land.sol.c4.body': 'Weekly AI report, alert when ranking drops, opens ASA automatically for opportunity keywords. You just make the decision.',
    'land.sol.c4.b1': 'Daily rank check',
    'land.sol.c4.b2': 'Anomaly alert',
    'land.sol.c4.b3': 'Scheduled reports & recommendations',
    'land.sol.c4.b4': 'Budget-capped auto-pilot',

    // ─── Landing — How it works (3 step) ────────────────────────
    'land.how.eyebrow': '3 STEPS',
    'land.how.title': 'Live in 5 minutes.',
    'land.how.subtitle': 'No technical knowledge needed. During onboarding, AI predicts your industry and generates the first content.',
    'land.how.s1.title': 'Connect your site',
    'land.how.s1.body': 'Paste the URL. RanksUp scans the site, detects your industry, extracts the first 50 keywords.',
    'land.how.s2.title': 'AI analysis',
    'land.how.s2.body': 'Competitor metadata, rankings, missing keywords, your AI Citation score — all in 2 minutes.',
    'land.how.s3.title': 'Live',
    'land.how.s3.body': 'First article, first AI visibility report, first ASA suggestion ready. Turn on Auto-Pilot and you do nothing.',

    // ─── Landing — Results (3 KPI) ──────────────────────────────
    'land.res.eyebrow': 'Results',
    'land.res.title': 'RanksUp impact in numbers.',
    'land.res.r1.title': 'average organic traffic increase',
    'land.res.r1.sub': 'in first 30 days',
    'land.res.r2.title': 'App Store Ads CPI decrease',
    'land.res.r2.sub': 'after 60 days on Auto-Pilot',
    'land.res.r3.title': 'content production speed',
    'land.res.r3.sub': 'compared to manual process',

    // ─── Landing — Compare (table) ──────────────────────────────
    'land.cmp.eyebrow': 'Comparison',
    'land.cmp.title': '1 RanksUp instead of 5 SaaS.',
    'land.cmp.subtitle': "If you're paying for multiple tools right now, you'll likely save 80%.",
    'land.cmp.col_feature': 'Feature',
    'land.cmp.row1': 'Web SEO + keyword tracking',
    'land.cmp.row2': 'AI Visibility (ChatGPT/Claude/Gemini)',
    'land.cmp.row3': 'App Store + Play Store ASO',
    'land.cmp.row4': 'Apple Search Ads management',
    'land.cmp.row5': 'Agent Readiness (AXO) scan',
    'land.cmp.row6': 'Competitor AI share of voice',
    'land.cmp.row7': 'AI article generation',
    'land.cmp.row8': 'Auto-Pilot automation',
    'land.cmp.row_price': 'Monthly price (approx.)',
    'land.cmp.note': '* Comparison based on official Pro/Team package pricing from competitor websites. As of May 2026.',

    // ─── Landing — Use Cases (3 card) ───────────────────────────
    'land.uc.eyebrow': 'Who uses it',
    'land.uc.title': 'Built for your business model?',
    'land.uc.c1.tag': 'SMB + SERVICE',
    'land.uc.c1.title': 'Accounting / legal / consulting',
    'land.uc.c1.body': 'Target customers search for you on Google and ChatGPT. RanksUp writes 3 articles per week, shares on LinkedIn, organic traffic flows in.',
    'land.uc.c1.before': '200 organic visits/month',
    'land.uc.c1.after': '4,200/month after 6 months',
    'land.uc.c2.tag': 'MOBILE APP OWNER',
    'land.uc.c2.title': 'iOS / Android app',
    'land.uc.c2.body': "Competitors rank #1 for 'best X app' searches on App Store — you're 47th. Auto-Pilot ASA boosts your ranking.",
    'land.uc.c2.before': '50 organic installs/month',
    'land.uc.c2.after': '1,800/month after 60 days',
    'land.uc.c3.tag': 'E-COMMERCE',
    'land.uc.c3.title': 'Brand-focused online sales',
    'land.uc.c3.body': 'Your customers now ask ChatGPT instead of Google. RanksUp finds which product questions you are missing and generates content targeting them.',
    'land.uc.c3.before': '0 visibility in AI answers',
    'land.uc.c3.after': 'In 4 of 7 engines after 90 days',
    'land.uc.before_label': 'BEFORE',
    'land.uc.after_label': 'AFTER',

    // ─── Landing — Testimonials ─────────────────────────────────
    'land.test.eyebrow': 'Customer reviews',
    'land.test.title': 'What teams say',
    'land.test.empty': 'First customer reviews are being collected — be one of the first to share your experience.',

    // ─── Landing — Pricing extras ───────────────────────────────
    'land.pric.eyebrow': 'Transparent Pricing',
    'land.pric.title': 'Start today, pay later.',
    'land.pric.subtitle': '2 free articles · Cancel anytime · No hidden fees',
    'land.pric.monthly': 'Monthly',
    'land.pric.annual': 'Annual',
    'land.pric.discount_badge': '17% off',
    'land.pric.per_month': '/mo',
    'land.pric.annual_billed_prefix': 'Billed',
    'land.pric.annual_billed_suffix': 'annually',
    'land.pric.monthly_billed': 'Billed monthly',
    'land.pric.bullet_articles': 'AI articles / mo',
    'land.pric.bullet_posts': 'AI visibility tests / mo',
    'land.pric.bullet_site': 'site',
    'land.pric.bullet_sites': 'sites',
    'land.pric.bullet_support': 'Support:',
    'land.pric.cta_free': 'Choose plan',
    'land.pric.cta_contact': 'Contact us',
    'land.pric.footer_note': 'In all plans: all AI modules · Apple Search Ads · 10+ publish targets · API access',
    'land.pric.plan_starter': 'Starter',
    'land.pric.plan_pro': 'Professional',
    'land.pric.plan_agency': 'Agency',
    'land.pric.plan_enterprise': 'Enterprise',
    'land.pric.enterprise_label': 'Custom',

    // ─── Landing — Final CTA ────────────────────────────────────
    'land.cta.title': 'Start your AI-era marketing',
    'land.cta.subtitle': 'First 2 articles free, no card required. Setup in 5 minutes.',
    'land.cta.button': 'Start free',
    'land.cta.secondary': 'Watch demo first',

    // ─── Footer ─────────────────────────────────────────────────
    'land.footer.product': 'Product',
    'land.footer.resources': 'Resources',
    'land.footer.company': 'Company',
    'land.footer.legal': 'Legal',
    'land.footer.tagline': 'AI-era marketing platform — Türkiye',
    'land.footer.rights': 'All rights reserved',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.new_site': '+ New Site',
    'dashboard.sites': 'My Sites',
    'dashboard.empty': 'No sites yet.',
    'dashboard.add_first': 'Add your first site →',

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
  },
} as const;

type Key = keyof typeof dictionary['tr'];

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
