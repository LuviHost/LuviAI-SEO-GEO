'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/*
 * Cevaplar kodla dogrulandi (18.10.2026). Kaynaklar:
 *  - Uretim hatti 5 ajan: apps/api/src/articles/pipeline.service.ts
 *    (keyword, outline, writer, editor, visuals). Yayin bir ajan degil.
 *  - Uzunluk sabit degil: yazar istemi "konuyu kapsayacak kadar, dolgu yok"
 *    (packages/shared/src/prompts/agents) → "1800-2500 kelime" kaldirildi.
 *  - Modeller: makale ajanlari Anthropic Claude (agent-runner.service.ts,
 *    WRITER_MODEL / EDITOR_MODEL / ROUTING_MODEL), gorsel varsayilan
 *    gemini-2.5-flash-image (image-generator.service.ts). Musteri basina
 *    "Opus opt-in" yok.
 *  - GEO analizi uygulama ici 8 sinyal (geo-runner.service.ts); "Auriti GEO
 *    Optimizer 47 metrik" ve "tek tikla duzeltir" dogru degildi.
 *  - Ortaklik: %30 (Affiliate.commissionPct), kayittan sonra 90 gun
 *    (affiliate.service commissionUntil), davet cerezi 60 gun (ref-tracker.tsx),
 *    yalniz dogrudan davetliler; otomatik odeme altyapisi YOK.
 *  - Otopilot varsayilan acik (schema.prisma Site.autopilot @default(true));
 *    gunluk AI olcumu yok, haftada bir kullanici tetikli
 *    (billing/measurement-allowance.ts).
 *  - Olcum hakki hesap basina (kv ai-olcum:<userId>, tum siteler ortak), kayan
 *    7 gun: ayda en fazla 5. "Calistirma" ayri aylik tavan (QuotaService
 *    citationTests): runForSite 1, runQueries (Prompt Lab sorusu / dali) 1.
 *    Kurulum taramasi ve baslangic olcumu worker'da trigger 'system': hakka
 *    sayilmaz. Plan sayilari SSS'de yazilmaz, fiyat sayfasina yonlendirilir.
 *  - Madde (2)-(3) takvim (article-scheduler.service.ts): ilk takvim Tier 1
 *    listesinden en fazla 8 konu (worker ONBOARDING_CHAIN count 8; ranker
 *    istemi Tier 1'i 6 konuyla sinirlar). "15 dk once" (LEAD_TIME_MS) yalniz
 *    gecikmeli iste: scheduleTopic ve rescheduleArticle. Ilk takvim ve
 *    programatik SEO yazilarini saatlik tarama (PROCESS_SCHEDULED, 60 dk,
 *    esik simdi + 15 dk) alir: slottan 15 dk once ile ~45 dk sonra arasi.
 *  - "Makale kotami asarsam" (20.10.2026): eski cevap "Sistem makale uretmeyi
 *    durdurur" diyordu; kodda durmayan uretim var (takvime elle eklenen yazinin
 *    gecikmeli isi dispatchScheduledArticle hakka bakmaz, onboarding'in ilk
 *    makalesi hak kontrolsuz). Hak dolunca gercekte: kullanicinin baslattigi
 *    uretim (QuotaService.enforceArticleQuota: deneme "plan sec", ucretli "plan
 *    yukselt") ve takvime yeni konu ekleme (scheduleTopic) 403; saatlik tarama
 *    (processDueArticles, checkArticleQuota) ilk takvimin yazilarini bekletir.
 *    Cevap yalniz bunlari soyler, "tum uretim durur" demez.
 *  - Madde (6) takili sayfa otopilotu (audit/stuck-page-autopilot.ts):
 *    Profesyonel+ (FEATURE_MIN_PLAN.stuckPages), GSC bagli, akis acik + Tam
 *    otomatik, yalniz RanksUp makaleleri, site basina en fazla 5, haftalik
 *    (Pzt 06:00 UTC); tespit sira 4-15 ve 30 gunde >= 50 gosterim.
 *  - Madde (5) yeniden yazim: content-pivot.service haftalik (Pzt 02:30 UTC),
 *    yalniz PUBLISHED ve en az 30 gunluk makale; veri Article.performanceMetrics,
 *    onu yalniz gunluk GSC senkronu yazar (analytics.service
 *    updateArticleMetrics) — Search Console bagli olmali. Kurallar: gosterim
 *    > 500 ve CTR < %2, sira 4-15 ve gosterim > 100, sira > 30 ve gosterim > 100.
 *    Kuyruga yalniz otopilot aciksa girer; onaysiz yayin yalniz Tam otomatikte
 *    (publish-approval.ts). AI atif kurali 7 olculen gun ister, haftalik olcumle
 *    tetiklenmez — metinde yok.
 *  - Reklam: resmi Google Ads / Meta Marketing API (ads.module.ts); Ryze AI
 *    MCP kaldirildi; reklam otopilotu Site.adsAutopilot @default(false).
 *  - Demo: 2 yayinda, 1 uretiliyor, 2 takvimde (demo-seeder.service.ts).
 *  - Google'in AI icerik tutumu:
 *    https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
 *    AI ozellikleri icin ozel dosya gerekmez:
 *    https://developers.google.com/search/docs/appearance/ai-features
 *    llms.txt bir oneri: https://llmstxt.org/ (Jeremy Howard, 3 Eylul 2024)
 *  - AB AI Act md. 50 (2 Agustos 2026'dan itibaren):
 *    https://artificialintelligenceact.eu/article/50/
 *  - GEO Skor Karti: apps/api/src/audit/geo-score-card.service.ts — 6 sutun,
 *    agirlik 3/3/3/2/2/1, sutun puani = gecen kontrol orani; AI Citation olculen
 *    6 asistanin (OLCULEN_ASISTANLAR) son 7 gunu, asistan basina ortalama >= 30
 *    gecer, 7 gunde olcumu olmayan asistan sayilmaz; Otorite sameAs (>= 2 profil)
 *    + rakip (>= 3) + GSC; Tazelik 30 gunde >= 4, 7 gunde >= 1, 90+ gunluk
 *    guncellenmemis < 10; Multi-Modal yalniz hero gorsel (>= %70). TTS ses ve
 *    podcast RSS urunden cikti (0db5a1c), skora girmez. public-docs.spec.ts
 *    asistan adlarini servisle karsilastirir.
 */
const FAQS_TR = [
  {
    q: 'RanksUp nasıl çalışır?',
    a: 'Sitenin adresini eklersin. AI önce siteni tarayıp "marka beyni" oluşturur (ton, persona, rakipler). Sonra Search Console verisi (bağladıysan) ve AI analiziyle Tier 1/2/3 konu listesi çıkarır. Her makale 5 ajanlı üretim hattından geçer (anahtar kelime → taslak → yazar → editör → görsel), yayın öncesi kalite kapısından sonra seçtiğin hedefe (WordPress, FTP, GitHub vb.) yayınlanır.',
  },
  {
    q: 'Hangi dilleri destekliyor?',
    a: 'Arayüz Türkçe ve İngilizce. Makalelerin dili site ayarlarından seçilir: Türkçe ya da İngilizce.',
  },
  {
    q: 'Ücretsiz olarak ne kadar kullanabilirim?',
    a: 'Kayıt olunca 2 makale ücretsiz üretilir (süre sınırı yok, kart bilgisi gerekmez); ayrıca 3 AI görünürlük çalıştırması (haftada en fazla 1 ölçüm) ve 1 site hakkın olur. Denemede makaleleri Markdown ZIP olarak indirebilir ya da WordPress (REST) sitene gönderebilirsin. Ücretli bir plan seçince FTP/SFTP, cPanel, GitHub gibi diğer yayın hedefleri de açılır.',
  },
  {
    q: 'AI içeriği Google\'da cezalandırılır mı?',
    a: 'AI ile üretildiği için cezalandırılmaz: Google, AI\'ın ya da otomasyonun uygun kullanımının yönergelerine aykırı olmadığını söylüyor. Ancak asıl amacı arama sıralamasını manipüle etmek olan otomatik içerik Google\'ın spam politikalarına aykırıdır; ölçüt yöntem değil kalitedir. RanksUp\'ta her makale editör ajanından ve yayın öncesi kalite kapısından geçer (kaynaksız sayı, uydurma iç bağlantı ve yapı kontrolleri). Yine de yayından önce içeriği gözden geçirmen gerekir.',
  },
  {
    q: 'GEO (AI search) optimizasyonu nedir?',
    a: 'ChatGPT, Perplexity, Claude gibi AI asistanlarının cevaplarında anılmak ve kaynak gösterilmek için yapılan optimizasyon. Google\'ın AI özellikleri için resmî rehber, özel bir "AI dosyası" gerekmediğini söylüyor; temel olan teknik SEO, benzersiz bakış açısı ve güvenilir içeriktir. RanksUp sitenin GEO analizini 8 sinyale göre yapar (llms.txt, JSON-LD şema, SSS / soru-cevap, tanım yoğunluğu, başlık hiyerarşisi, OG / canonical, tazelik ve alıntı biçimi; anasayfa ve en fazla 5 iç sayfa örneklenir) ve asıl sonucu 6 AI asistanında ölçer. robots.txt, sitemap.xml ve llms.txt için önizlemeli düzeltme sunar.',
  },
  {
    q: 'Kendi WordPress\'ime nasıl bağlarım?',
    a: 'WordPress yönetim panelinde Kullanıcılar → Profil altındaki "Application Passwords" bölümünden bir uygulama parolası oluşturursun. RanksUp\'ta site menüsü → Yayın Hedefleri → WordPress (REST API) seçip site adresini, kendi WordPress kullanıcı adını ve uygulama parolasını girersin. Yayın durumunu "Taslak" seçersen makaleler WordPress\'e taslak olarak gider, sen inceleyip yayınlarsın; "Yayında" seçersen doğrudan yayına çıkar.',
  },
  {
    q: 'Aboneliğimi istediğim zaman iptal edebilir miyim?',
    a: 'Evet. Abonelik sayfasında "Aboneliği iptal et". Ödenen dönemin sonuna kadar erişimin sürer. Kullanım Şartları\'na göre yıllık planda ilk 30 gün tam iade, sonrasında kalan ay başına orantılı iade yapılır; iade talebi için destek@luvihost.com.',
  },
  {
    q: 'Verilerim güvende mi?',
    a: 'Tüm bağlantı bilgileri (FTP/SFTP/WordPress/cPanel parolaları, Search Console OAuth token\'ları) AES-256-GCM ile şifrelenir. Sunucular LuviHost İstanbul veri merkezinde. Hesabını silersen erişim hemen kapanır, verilerin 30 gün sonra geri dönüşsüz silinir; fatura ve ödeme kayıtları mevzuat gereği kişisel bağlantısı kaldırılarak saklanır.',
  },
  {
    q: 'AB Yapay Zekâ Yasası (AI Act) RanksUp içeriğini etkiler mi?',
    a: 'AI Act Madde 50 (2 Ağustos 2026\'dan itibaren uygulanır), üretken AI çıktılarının makine-okunur biçimde işaretlenmesini AI sistemi sağlayıcılarına (Anthropic, Google, OpenAI gibi) yükler. Ayrıca kamuoyunu kamu yararını ilgilendiren konularda bilgilendirmek için yayımlanan AI metinlerinde, yayımlayanın bunu açıklaması gerekir; metin insan tarafından gözden geçirildiyse ve yayın sorumluluğunu bir kişi ya da kurum üstleniyorsa bu açıklama gerekmez. RanksUp makaleleri yayından önce gözden geçirmeni ister (Kullanım Şartları) ve yazar bilgisini şemada (Person + author) tutar. Kendi durumun için hukuki danışmanlık almanı öneririz.',
  },
  {
    q: 'AI hangi modeli kullanıyor?',
    a: 'Makale ajanları (anahtar kelime, taslak, yazar, editör, görsel istemi) Anthropic\'in Claude modelleriyle çalışır; hangi Claude sürümünün kullanılacağı platform genelinde yönetilir, müşteri başına seçilmez. Görseller varsayılan olarak Google\'ın Gemini görsel modeliyle (gemini-2.5-flash-image) üretilir. AI görünürlük ölçümü ise ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek\'in kendi modellerine sorularak yapılır.',
  },
  {
    q: 'Aylık makale kotamı aşarsam ne olur?',
    a: 'Kendi başlattığın yeni makale üretimleri durur, takvime yeni konu eklenemez ve plan yükseltmen önerilir; site eklenirken takvime yerleşen makaleler de hakkın yenilenene ya da planını yükseltene kadar bekler. Sayaç her takvim ayının başında sıfırlanır (deneme hesabındaki 2 ücretsiz makale hakkı sıfırlanmaz). Büyüme, Profesyonel ve Ajans planlarını panelden satın alırsın; Kurumsal plan satış ekibiyle, sözleşmeli kurulur.',
  },
  {
    q: 'Ayda kaç AI görünürlük ölçümü yapabilirim?',
    a: 'Her planda hesap başına 7 günde 1 AI görünürlük ölçümü yapılır, yani ayda en fazla 5; tüm sitelerin aynı hakkı paylaşır. AI testi ("Yeniden Test"), "AI önerisi al", Prompt Lab, panelden başlattığın site taramasındaki AI testi ve diğer ölçümler bu hakka sayılır; sonuç vermeyen ölçüm hakkı yakmaz. Site kurulumundaki ilk tarama ve otomatik akışın başlangıç ölçümü bu hakka sayılmaz. Planlar ölçüm sıklığında değil, aylık görünürlük çalıştırması tavanında ayrışır (güncel sayılar fiyatlandırma sayfasında): AI testi 1, Prompt Lab\'de her soru ve her dal 1 çalıştırma sayılır; bu yüzden tek bir haftalık ölçüm, örneğin Prompt Lab\'de tüm soruları çalıştırmak, birden çok çalıştırma kullanır. Çalıştırma sayacı her takvim ayının başında sıfırlanır.',
  },
  {
    q: 'Ortaklık (affiliate) programı nasıl çalışır?',
    a: 'Panelde Ortaklık Programı sayfasından ücretsiz katılırsın; sana özel bir davet linki oluşur. Link 60 gün geçerlidir: bu sürede kayıt olan kişi senin davetlin sayılır. Davetlinin kayıttan sonraki 3 ay (90 gün) içinde yaptığı ödemelerin %30\'u hesabına komisyon olarak yazılır. Komisyon yalnızca doğrudan davetlilerinin ödemelerinden gelir. Otomatik ödeme aktarımı şu an yok; biriken tutarı panelde "Ödenmeyi bekleyen" olarak görürsün.',
  },
  {
    q: 'Kendi geliştirici takımım API kullanabilir mi?',
    a: 'Kurumsal planda evet: REST API (kapsamı sınırlandırılabilen API anahtarlarıyla) ve MCP sunucusu (Claude Code, Cursor gibi ajanlardan bağlantı) açıktır. Diğer planlarda ürün panelden kullanılır. Hazır npm/pip SDK ve Zapier/Make/n8n entegrasyonu şu an yok.',
  },
  {
    q: 'Reklam (Google Ads + Meta) yönetimi nasıl çalışıyor?',
    a: 'Google Ads ve Meta Ads hesabını resmî API\'leri üzerinden bağlarsın. Kampanya Skoru, reklam hesabını kurallara göre denetleyip öneri çıkarır. Reklam otopilotunu açarsan (varsayılan kapalı, site otopilotundan ayrı) RanksUp\'ta kayıtlı etkin kampanyalar 6 saatte bir değerlendirilir ve hesabında şu değişiklikler yapılabilir: getirisi (ROAS) düşük ve harcaması yüksek kampanya durdurulur; tıklama oranı ve ROAS\'ı yüksek kampanyanın günlük bütçesi %20 artırılır; aynı reklam grubunda ya da reklam setinde, yeterli gösterim almış reklamlardan tıklama oranı kazanandan istatistiksel olarak belirgin biçimde düşük olan ve daha iyi dönüşüm getirmeyenler durdurulur (bir grubun son reklamı hiçbir zaman durdurulmaz); Google Ads arama terimlerinden alakasız olanlar negatif anahtar kelime olarak eklenir; iki platform arasında ROAS farkı büyükse zayıf kampanyanın günlük bütçesinin %20\'si güçlü olana kaydırılır (iki reklam hesabı aynı para birimindeyse). Bütçe artışının emniyet sınırı var: aynı kampanyada 24 saatte en fazla bir, 7 günde en fazla iki artış yapılır ve bütçe, otopilotun o kampanyada ilk değişiklik yaptığı andaki bütçenin 2 katını geçmez. RanksUp\'ın Facebook sayfanda paylaştığı bir gönderi son 7 günde ortalamanın iki katı etkileşim alırsa günlük 50 bütçeyle (reklam hesabının para birimiyle: TL hesapta 50 TL, USD hesapta 50 USD) 7 gün öne çıkarılır; RanksUp şu an sosyal medyada paylaşım yapmadığı için bu adımda aday gönderi oluşmuyor. Bu işlemler reklam hesabından harcama yapar.',
  },
  {
    q: 'AI Citation testi tam olarak ne ölçüyor?',
    a: 'Marka beynindeki sorulardan en fazla 5\'ini 6 AI asistanına sorar: ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek. Ölçümü siz başlatırsınız ("Yeniden Test"); hesap başına haftada bir AI ölçümü yapılabilir. Her test kalıcı kaydedilir, iki testi yan yana karşılaştırabilirsiniz. Marka adınızın geçtiği sorular skora girmez (o tanınırlık, görünürlük değil). Cevapta site URL\'iniz alıntılanırsa 100, sadece marka adı geçerse 50, hiç geçmezse 0 puan; manşet 7 günlük ortalama. Son 7 günün ortalaması önceki 7 güne göre %30 ya da daha fazla düşerse otomatik e-posta gelir.',
  },
  {
    q: 'GEO Score nedir, nasıl hesaplanır?',
    a: '6 başlığın ağırlıklı ortalamasıdır; her başlığın puanı geçilen kontrollerin oranıdır. (1) AI tarayıcı erişimi — robots.txt, llms.txt, sitemap.xml ve RanksUp\'ın ürettiği llms-full.txt; (2) Yapısal veri — RanksUp ile yayınlanan makalelerde şema kapsamı (en az %80), en az 5 farklı şema tipi, Speakable ve FAQPage; (3) AI atıfları — ölçülen AI asistanlarının (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) son 7 gün ortalaması: ortalaması 30 ve üstü olan asistan geçer, son 7 günde ölçüm alınamayan asistan hesaba katılmaz; (4) Otorite — sosyal profil (sameAs) bağlantıları, en az 3 tanımlı rakip ve Search Console bağlantısı; (5) Tazelik — son 30 günde en az 4, son 7 günde en az 1 yayın ve 90 günden uzun süredir güncellenmeyen makalenin 10\'dan az olması; (6) Çoklu ortam — yayınlanan makalelerin en az %70\'inde kapak görseli. İlk üç başlığın ağırlığı en yüksektir. Sonuç A+ ile F arasında bir harf notudur.',
  },
  {
    q: 'Otopilot tam olarak ne yapıyor?',
    a: 'Site eklediğinde otomatik akış (otopilot) açık başlar; Otomatik Akış sayfasından durdurabilirsin. Açıkken: (1) Site eklenirken FTP/SFTP/cPanel yayın hedefi tanımlıysa eksik sitemap.xml ve llms.txt oluşturulup yüklenir; robots.txt değişikliği yalnızca sen önizleyip onayladığında yazılır, (2) konu motorunun öncelikli konularından en fazla 8\'i takvime yerleşir ve ilk makale hemen üretilir, (3) takvime kendin eklediğin ya da tarihini değiştirdiğin makaleler planlanan saatten 15 dakika önce, site eklenirken takvime yerleşenler saatlik taramayla (planlanan saatin en fazla 15 dakika öncesinden yaklaşık 45 dakika sonrasına kadar) üretime alınır, (4) bir başlangıç AI görünürlük ölçümü alınır; sonraki ölçümleri "Yeniden Test" ile sen başlatırsın (hesap başına haftada bir), (5) Search Console bağlıysa, yayından en az 30 gün geçmiş makaleler haftalık taramada Search Console verisine göre değerlendirilir; gösterim alıp tıklaması ya da sırası zayıf kalan makale yeniden yazılabilir, Yarı otomatikte yeni hali onayını bekler, (6) Profesyonel ve üstü planlarda, Search Console bağlıysa ve Tam otomatik moddaysan Google\'da 4-15. sırada takılı kalan RanksUp makaleleri her hafta (site başına en fazla 5) iyileştirilip yeniden yayınlanır; Yarı otomatikte bunları Takılı Sayfalar ekranından sen başlatırsın. Reklam otopilotu ayrı bir ayardır ve varsayılan olarak kapalıdır.',
  },
  {
    q: 'Bir SEO uzmanıyla çalışmak yerine RanksUp kullanmak mantıklı mı?',
    a: 'RanksUp bir uzmanın yerini tümüyle tutmaz; tekrarlayan işleri otomatikleştirir: site denetimi, içerik üretimi ve yayın, AI görünürlük ölçümü ve ASO tek panelde. Profesyonel plan aylık $349 (TL tutarı ödeme günündeki TCMB kuruyla hesaplanır). Bir uzmanla ya da ajansla çalışıyorsan RanksUp ona ölçüm verisi ve zaman kazandırır.',
  },
  {
    q: 'Google llms.txt\'i kullanıyor mu? Bu dosya gerçekten gerekli mi?',
    a: 'Google\'ın AI özellikleri rehberi, bu özelliklerde görünmek için yeni makine-okunur dosyalar, AI metin dosyaları ya da işaretleme oluşturmanın gerekmediğini söylüyor; yani Google için llms.txt zorunlu değil. llms.txt, sitenin yapay zekâ araçlarına yönelik özetini sunmak için önerilmiş bir standart taslağıdır (llmstxt.org, 2024). Hangi AI asistanının bu dosyayı okuduğu resmî olarak açıklanmış değil; RanksUp dosyayı düşük maliyetli bir ek olarak üretir. Google\'da asıl odak benzersiz bakış açısı, ilk elden deneyim, güvenilirlik ve klasik teknik SEO\'dur (indekslenebilirlik ve snippet uygunluğu).',
  },
  {
    q: 'Demo görmek istiyorum, nasıl?',
    a: 'Site ekleme ekranında "Demo siteyi aç" butonuna tıkla. Örnek verilerle dolu bir demo site açılır: 5 makale (2 yayında, 1 üretiliyor, 2 takvimde), site taraması ve 14 günlük örnek AI görünürlük verisi. Demo verileri gerçek ölçüm değildir; RanksUp\'ı kendi siteni bağlamadan keşfetmen içindir.',
  },
];

const FAQS_EN = [
  {
    q: 'How does RanksUp work?',
    a: 'You add your site address. The AI first crawls your site and builds a "brand brain" (tone, persona, competitors). It then uses Search Console data (if connected) and AI analysis to produce a Tier 1/2/3 topic list. Every article flows through a 5-agent pipeline (keyword → outline → writer → editor → visuals) and, after a pre-publish quality gate, is published to your chosen target (WordPress, FTP, GitHub, etc.).',
  },
  {
    q: 'Which languages are supported?',
    a: 'The interface is in Turkish and English. Article language is set in site settings: Turkish or English.',
  },
  {
    q: 'How much can I use for free?',
    a: 'On signup you get 2 free articles (no time limit, no credit card), plus 3 AI visibility runs (at most 1 measurement per week) and 1 site. On the trial you can download articles as a Markdown ZIP or send them to your WordPress (REST) site. A paid plan unlocks the other publish targets such as FTP/SFTP, cPanel and GitHub.',
  },
  {
    q: 'Will Google penalize AI content?',
    a: 'Not for being AI-generated: Google says appropriate use of AI or automation is not against its guidelines. Automation used primarily to manipulate search rankings does violate Google\'s spam policies, so the bar is quality, not method. In RanksUp every article goes through an editor agent and a pre-publish quality gate (unsourced numbers, made-up internal links, structure checks). You should still review content before it goes live.',
  },
  {
    q: 'What is GEO (AI search) optimization?',
    a: 'Optimization to be mentioned and cited in answers from AI assistants like ChatGPT, Perplexity and Claude. Google\'s official guide for its AI features says no special "AI file" is required; the basics are technical SEO, a unique perspective and trustworthy content. RanksUp runs a GEO analysis of your site on 8 signals (llms.txt, JSON-LD schema, FAQ / Q&A, definition density, heading hierarchy, OG / canonical, freshness and citation format; the homepage and up to 5 inner pages are sampled) and measures the actual outcome on 6 AI assistants. It offers previewed fixes for robots.txt, sitemap.xml and llms.txt.',
  },
  {
    q: 'How do I connect my own WordPress?',
    a: 'In the WordPress admin under Users → Profile, create an application password in the "Application Passwords" section. In RanksUp go to the site menu → "Yayın Hedefleri" (publish targets) → WordPress (REST API) and enter your site address, your own WordPress username and the application password. If you set the publish status to "Taslak" (draft), articles arrive in WordPress as drafts for you to review; "Yayında" (published) sends them live directly.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. On the Subscription (Abonelik) page, click "Aboneliği iptal et" (cancel subscription). Your access continues until the end of the paid period. Under the Terms of Service, yearly plans get a full refund in the first 30 days and a pro-rata refund per remaining month after that; email destek@luvihost.com to request a refund.',
  },
  {
    q: 'Is my data safe?',
    a: 'All connection credentials (FTP/SFTP/WordPress/cPanel passwords, Search Console OAuth tokens) are AES-256-GCM encrypted. Servers are in the LuviHost Istanbul data center. If you delete your account, access ends immediately and your data is permanently deleted after 30 days; invoices and payment records are kept with the personal link removed, as the law requires.',
  },
  {
    q: 'Does the EU AI Act affect content made with RanksUp?',
    a: 'Article 50 of the AI Act (applicable from 2 August 2026) requires providers of AI systems (such as Anthropic, Google and OpenAI) to mark generative output in a machine-readable way. In addition, whoever publishes AI-generated text to inform the public on matters of public interest must disclose it, unless the text has undergone human review and a person or organization holds editorial responsibility for it. RanksUp asks you to review articles before publishing (Terms of Service) and keeps author information in schema (Person + author). We recommend getting legal advice for your own case.',
  },
  {
    q: 'Which AI model do you use?',
    a: 'The article agents (keyword, outline, writer, editor, image prompt) run on Anthropic\'s Claude models; the Claude version is managed platform-wide, not chosen per customer. Images are generated by default with Google\'s Gemini image model (gemini-2.5-flash-image). AI visibility measurement asks ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek through their own models.',
  },
  {
    q: 'What happens if I exceed my monthly article quota?',
    a: 'New article generations you start yourself stop, you cannot add new topics to the calendar and you are offered a plan upgrade; the articles scheduled when your site was added also wait until your allowance renews or you upgrade. The counter resets at the start of each calendar month (the 2 free trial articles do not reset). You buy the Growth, Professional and Agency plans from the dashboard; the Enterprise plan is set up under contract with our sales team.',
  },
  {
    q: 'How many AI visibility measurements can I run per month?',
    a: 'Every plan includes 1 AI visibility measurement every 7 days per account, so at most 5 a month, shared by all your sites. The AI test ("Yeniden Test", re-test), "AI önerisi al" (get AI recommendations), Prompt Lab, the AI test inside a site scan you start from the dashboard and the other measurements count against it; a measurement that returns no result does not use it up. The first scan during site setup and the automation\'s baseline measurement do not count. Plans differ not in how often you can measure but in their monthly visibility run cap (current numbers on the pricing page): an AI test counts as 1 run and each Prompt Lab question or branch as 1, so a single weekly measurement, such as running all Prompt Lab questions, uses several runs. The run counter resets at the start of each calendar month.',
  },
  {
    q: 'How does the affiliate program work?',
    a: 'Join for free from the "Ortaklık Programı" (affiliate program) page in the dashboard; you get a unique invite link. The link is valid for 60 days: anyone who signs up within that time counts as your referral. You earn 30% of the payments your referral makes within 3 months (90 days) of signing up. Commission comes only from your direct referrals\' payments. There is no automatic payout yet; the accrued amount shows in the dashboard as "Ödenmeyi bekleyen" (pending payout).',
  },
  {
    q: 'Can my developer team use the API?',
    a: 'Yes, on the Enterprise plan: a REST API (with scoped API keys) and an MCP server (connect from agents such as Claude Code or Cursor). On other plans you use the product through the dashboard. There is no ready-made npm/pip SDK or Zapier/Make/n8n integration at the moment.',
  },
  {
    q: 'How does ad management (Google Ads + Meta) work?',
    a: 'You connect your Google Ads and Meta Ads accounts through their official APIs. Campaign Score (Kampanya Skoru) audits the ad account against a rule set and suggests fixes. If you turn on the ads autopilot (off by default, separate from the site autopilot), active campaigns registered in RanksUp are reviewed every 6 hours and these changes can be made in your account: a campaign with low return on ad spend (ROAS) and high spend is paused; a campaign with high click-through rate and ROAS gets a 20% daily budget increase; the winning ad variant is kept and the others are paused; irrelevant Google Ads search terms are added as negative keywords; when ROAS differs widely between the two platforms, 20% of the weaker campaign\'s daily budget moves to the stronger one (only if both ad accounts use the same currency). Budget increases have a safety limit: at most one increase per campaign in 24 hours and two in 7 days, and the budget never exceeds twice what it was when the autopilot first changed that campaign. If a post that RanksUp shared on your Facebook Page gets twice the average engagement in the last 7 days, it is boosted for 7 days with a daily budget of 50 in your ad account\'s currency (50 TRY on a TRY account, 50 USD on a USD account); RanksUp currently does not share posts on social media, so no post qualifies for this step. These actions spend money from your ad accounts.',
  },
  {
    q: 'What exactly does the AI Citation test measure?',
    a: 'It asks up to 5 questions from your brand brain to 6 AI assistants: ChatGPT · Claude · Gemini · Perplexity · Grok · DeepSeek. You trigger the measurement ("Yeniden Test", re-test); one AI measurement per account per week. Every measurement is stored permanently and any two measurements can be compared side by side. Questions that already contain your brand are excluded from the score (that is recognition, not visibility). URL cited = 100, brand name only = 50, absent = 0; the headline is a 7-day rolling average. If the last 7 days\' average drops 30% or more against the previous 7 days, you get an automatic email.',
  },
  {
    q: 'What is GEO Score, how is it calculated?',
    a: 'A weighted average of 6 pillars; each pillar scores the share of its checks that pass. (1) AI crawler access — robots.txt, llms.txt, sitemap.xml and the llms-full.txt RanksUp generates; (2) Structured data — on articles published through RanksUp: schema coverage (at least 80%), at least 5 distinct schema types, Speakable and FAQPage; (3) AI citations — the 7-day average of each measured AI assistant (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek): an assistant passes at 30 or above, and an assistant with no measurement in the last 7 days is left out; (4) Authority — social profile (sameAs) links, at least 3 defined competitors and a Search Console connection; (5) Freshness — at least 4 articles in the last 30 days, at least 1 in the last 7 days, and fewer than 10 articles left without an update for over 90 days; (6) Multi-modal — a cover image on at least 70% of published articles. The first three pillars carry the highest weight. The result is a letter grade from A+ to F.',
  },
  {
    q: 'What exactly does Autopilot do?',
    a: 'Automation (autopilot) is on by default when you add a site; you can pause it on the "Otomatik Akış" (automation) page. When on: (1) when the site is added, if an FTP/SFTP/cPanel publish target exists, missing sitemap.xml and llms.txt are created and uploaded; a robots.txt change is written only after you preview and confirm it, (2) up to 8 of the topic engine\'s priority topics are scheduled and the first article is generated immediately, (3) articles you add to the calendar or reschedule yourself enter generation 15 minutes before their scheduled time, while those scheduled when the site was added are picked up by an hourly scan (from up to 15 minutes before to about 45 minutes after their scheduled time), (4) a baseline AI visibility measurement is taken; you start later measurements with "Yeniden Test" (re-test; one per account per week), (5) if Search Console is connected, articles published at least 30 days ago are checked against Search Console data in a weekly scan; an article that gets impressions but has a weak click-through rate or position can be rewritten, and in "Yarı otomatik" (semi-auto) mode the new version waits for your approval, (6) on Professional and higher plans, if Search Console is connected and you use "Tam otomatik" (full auto) mode, RanksUp articles stuck at positions 4-15 on Google are improved and republished every week (up to 5 per site); in "Yarı otomatik" you start these yourself from the "Takılı Sayfalar" (stuck pages) screen. The ads autopilot is a separate setting and is off by default.',
  },
  {
    q: 'Does RanksUp make sense instead of working with an SEO specialist?',
    a: 'RanksUp does not fully replace a specialist; it automates the repetitive work: site audit, content generation and publishing, AI visibility measurement and ASO in one dashboard. The Professional plan is $349/mo (the TRY amount is calculated at the CBRT rate on the payment date). If you work with a specialist or an agency, RanksUp gives them measurement data and saves them time.',
  },
  {
    q: 'Does Google use llms.txt? Is this file actually needed?',
    a: 'Google\'s guide for its AI features says you don\'t need to create new machine-readable files, AI text files or markup to appear in those features, so llms.txt is not required for Google. llms.txt is a proposed standard for offering an AI-friendly summary of a site (llmstxt.org, 2024). Which AI assistants read the file has not been officially disclosed; RanksUp produces it as a low-cost extra. For Google, the real focus is a unique perspective, first-hand experience, trustworthiness and classic technical SEO (indexability and snippet eligibility).',
  },
  {
    q: 'I want a demo, how?',
    a: 'On the add-site screen, click "Demo siteyi aç" (open demo site). A demo site filled with sample data opens: 5 articles (2 published, 1 generating, 2 scheduled), a site audit and 14 days of sample AI visibility data. Demo data is not a real measurement; it lets you explore RanksUp without connecting your own site.',
  },
];

const COPY = {
  tr: {
    eyebrow: '❓ SSS',
    titleA: 'Sıkça',
    titleB: 'sorulan',
    titleC: 'sorular',
    helpA: 'Cevabını bulamadığın bir soru varsa ',
    helpEmail: 'destek@luvihost.com',
    ctaTitle: 'Sorunu çözemedik mi?',
    ctaSub: 'Hemen dene, sonra karar ver. İlk 2 makale ücretsiz.',
    ctaBtn: '2 Makale Ücretsiz Dene →',
    breadcrumbHome: 'Ana Sayfa',
    breadcrumbFaq: 'Sıkça Sorulan Sorular',
  },
  en: {
    eyebrow: '❓ FAQ',
    titleA: 'Frequently',
    titleB: 'asked',
    titleC: 'questions',
    helpA: 'Can\'t find your answer? ',
    helpEmail: 'destek@luvihost.com',
    ctaTitle: 'Still have questions?',
    ctaSub: 'Try it now, decide later. First 2 articles free.',
    ctaBtn: 'Try 2 Articles Free →',
    breadcrumbHome: 'Home',
    breadcrumbFaq: 'Frequently Asked Questions',
  },
} as const;

function buildJsonLd(items: { q: string; a: string }[], breadcrumbHome: string, breadcrumbFaq: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': 'https://ranksup.ai/faq#faqpage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['.faq-question', '.faq-answer'],
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: breadcrumbHome, item: 'https://ranksup.ai/' },
          { '@type': 'ListItem', position: 2, name: breadcrumbFaq, item: 'https://ranksup.ai/faq' },
        ],
      },
    ],
  };
}

export default function FaqPage() {
  const { locale } = useT();
  const [open, setOpen] = useState<number | null>(0);
  const FAQS = locale === 'en' ? FAQS_EN : FAQS_TR;
  const c = COPY[locale];
  const faqJsonLd = buildJsonLd(FAQS, c.breadcrumbHome, c.breadcrumbFaq);

  return (
    <div className="relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {/* gradient blob */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            {c.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>{' '}
            {c.titleC}
          </h1>
          <p className="text-lg text-muted-foreground">
            {c.helpA}
            <a href={`mailto:${c.helpEmail}`} className="text-brand-600 hover:underline">
              {c.helpEmail}
            </a>
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <div
              key={i}
              className={`rounded-2xl border bg-background transition-all ${
                open === i ? 'border-brand-500/30 shadow-md' : 'hover:border-brand-500/20'
              }`}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left p-5 flex items-center justify-between gap-4"
              >
                <span className="font-semibold faq-question">{item.q}</span>
                <ChevronDown className={cn('h-5 w-5 transition-transform shrink-0 text-muted-foreground', open === i && 'rotate-180 text-brand-600')} />
              </button>
              {open === i && (
                <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed faq-answer">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-500 via-brand-600 to-red-600 text-white p-10 text-center mt-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">{c.ctaTitle}</h2>
          <p className="text-white/90 mb-6">{c.ctaSub}</p>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 bg-white text-brand-600 hover:bg-white/90 px-8 py-3 rounded-lg font-bold shadow-xl"
          >
            {c.ctaBtn}
          </Link>
        </div>
      </main>
    </div>
  );
}
