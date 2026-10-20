import { Bot } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Auto-Pilot — RanksUp Help' };

// Metin kodla dogrulandi (Ekim 2026):
//  - ASA Auto-Pilot: asa.cron.ts 04:30 UTC, asa-rules.ts (7 gun, 20+ dokunma,
//    0 indirme → durdur), asa.service.ts (en fazla 5 yeni kelime, butce siniri).
//  - ASC: asc.cron.ts 05:30 UTC uygulama + surum senkronu ve uyarilar; yorumlar
//    cron'la CEKILMEZ (runDailySyncAll yalniz syncApps + syncReleases).
//  - AI gorunurluk: gunluk otomatik olcum KAPALI (AI_CITATION_DAILY_CRON);
//    otomatik akis acikken yalniz site eklenirken bir baslangic olcumu alinir
//    (worker ONBOARDING_CHAIN, trigger 'system'). Eski "her gece snapshot"
//    bolumu yanlisti.
//  - Butce uyarisi quota.service.ts checkAiCostBudget: %80 uyari, %100 sinir.
//  - Site akisi (18.10.2026, api article-scheduler.service.ts):
//    * Ilk takvim: worker ONBOARDING_CHAIN scheduleInitialBatch(count: akis
//      acik 8 / kapali 3) konu motorunun Tier 1 listesinden ALIR; ranker istemi
//      Tier 1'i en fazla 6 konuyla sinirliyor, bu yuzden "en fazla". Ilk yazi
//      hemen kuyruga girer, kalanlar SCHEDULED.
//    * Kalanlari saatlik tarama (PROCESS_SCHEDULED, 60 dk) yalniz akis acikken
//      alir; her yazi uretime alinirken aylik makale hakkindan bir kez duser
//      (chargeArticle, 20.10.2026). Hak doluysa yazi bekler. Deneme hesabi
//      toplam 2 makale uretir, onboarding'in ilk yazisi dahil (ucretli planda
//      ilk yazi ucretsiz); hakki asan takvim yazilari panelde kilitli gorunur
//      (articles/plan-lock.ts lockedByPlan) ve plan yukseltilince uretilir
//      (paytr activateSubscription → scheduled-kick.ts kullanici taramasi).
//      Eski "takvim uretimi hakka sayilmaz" artik yanlis.
//    * Yeniden yazim (icerik pivotu) ve ceviri deneme hesabinda calismaz.
//    * "15 dk once" yalniz gecikmeli iste dogru: scheduleTopic (Takvime ekle)
//      ve rescheduleArticle (tarih ata / tasi) LEAD_TIME_MS ile is kurar.
//      Ilk takvim ve programatik SEO yazilari icin is kurulmaz; tarama esigi
//      simdi + 15 dk oldugundan uretim slottan 15 dk once ile ~45 dk sonra
//      arasinda kuyruga girer.
//  - Yeniden yazim (content-pivot.service.ts, Pzt 02:30 UTC): PUBLISHED ve en az
//    30 gunluk yazi, veri yalniz GSC senkronunun yazdigi performanceMetrics;
//    kurallar gosterim > 500 ve CTR < %2, sira 4-15 ve gosterim > 100, sira > 30
//    ve gosterim > 100. Kuyruga yalniz akis aciksa girer; onaysiz yayin yalniz
//    Tam otomatikte (publish-approval.ts). Eski kosulsuz "30 gun sonra" yanlisti.
//  - Takili sayfa otopilotu (audit/stuck-page-autopilot.ts, Pzt 06:00 UTC):
//    Profesyonel+ (FEATURE_MIN_PLAN.stuckPages), GSC bagli (detector), akis
//    acik + Tam otomatik; yalniz RanksUp makaleleri, site basina en fazla 5
//    (STUCK_AUTO_RECOVER_PER_SITE); tespit sira 4-15, 30 gunde >= 50 gosterim.
export default function Page() {
  return (
    <HelpArticle slug="auto-pilot"
      icon={Bot}
      badge="Otomasyon"
      title="Otomatik akış ve Auto-Pilot"
      intro="Otomatik akış site içeriğini takvime göre üretir ve yayına hazırlar; Apple Search Ads Auto-Pilot her gün düşük performanslı anahtar kelimeleri durdurur ve yenilerini ekler. AI görünürlük ölçümünü ise sen başlatırsın."
    >
      <h2>3 farklı otomasyon</h2>

      <h3>1. ASA Auto-Pilot — Apple Search Ads</h3>
      <p>Profesyonel ve üstü planlarda, her Apple Search Ads hesabının altında &ldquo;Auto-Pilot&rdquo; paneli bulunur. Açtığında her gün 04:30 UTC&apos;de çalışır:</p>
      <ul>
        <li>Son 7 günde 20 ya da daha fazla dokunma alıp hiç indirme getirmeyen anahtar kelime <strong>durdurulur</strong></li>
        <li>AI önerisinden, hesapta henüz olmayan en fazla 5 anahtar kelime <strong>eklenir</strong></li>
        <li>Bu ayki harcama bütçe sınırına ulaştıysa Auto-Pilot o gün <strong>hiçbir işlem yapmaz</strong></li>
      </ul>

      <Step n={1} title="ASA bağlı olmalı">
        Önce Apple Search Ads hesabını bağla (<a href="/help/asa-asc">ASA rehberi</a>).
      </Step>
      <Step n={2} title="Auto-Pilot panelini aç">
        ASA sekmesinde hesap satırının altındaki <strong>Auto-Pilot</strong> bölümünden açıp kapatırsın.
      </Step>
      <Step n={3} title="Aylık bütçe sınırını ayarla">
        Alan aylık 500 (hesap para birimi) değeriyle gelir; değiştirebilirsin. Tutar Apple Ads hesabının para birimindedir: USD hesapta 500 USD, EUR hesapta 500 EUR. Sınıra ulaşılınca Auto-Pilot durur, ancak mevcut kampanyaların Apple&apos;da çalışmaya ve harcamaya devam eder.
      </Step>
      <Step n={4} title="Şimdi çalıştır (test)">
        Elle tetikleme: Auto-Pilot bir kez çalışır, son çalışmanın sonucu kartın altında görünür.
      </Step>

      <h3>2. Site otomatik akışı</h3>
      <p>
        Site menüsündeki <strong>Otomatik Akış</strong> sayfasından açıp durdurursun. Site eklediğinde açık başlar.
      </p>
      <ul>
        <li>Site eklenince konu motorunun öncelikli konuları takvime yerleşir (otomatik akış açıkken en fazla 8, kapalıyken en fazla 3) ve ilk makale hemen üretilir. Bu ilk takvimin diğer makaleleri otomatik akış açıkken zamanı gelince üretilir, akış durdurulmuşsa bekler. Her makale üretime alınırken makale hakkından bir kez düşer; hakkın dolduysa takvimdeki makaleler hakkın yenilenene ya da planını yükseltene kadar bekler. Ücretsiz denemede ilk makale dahil toplam 2 makale yazılır; takvimin geri kalanı panelde kilitli görünür ve planını yükselttiğinde yazılır</li>
        <li>Site eklenirken FTP, SFTP ya da cPanel yayın hedefi tanımlıysa eksik sitemap.xml ve llms.txt oluşturulup yüklenir; hedefi sonradan eklersen düzeltmeyi Site Skoru sayfasından başlatırsın. robots.txt değişikliği yalnızca sen önizleyip onayladığında yazılır</li>
        <li>Akış açıkken takvime kendin eklediğin, tarih atadığın ya da başka güne taşıdığın makaleler planlanan saatten 15 dakika önce üretime alınır; site eklenirken takvime yerleşenleri saatlik tarama alır (planlanan saatin en fazla 15 dakika öncesinden yaklaşık 45 dakika sonrasına kadar). Akış durdurulmuşsa takvim bekler; üretim birkaç dakika sürer</li>
        <li>Ücretli planlarda, otomatik akış açık ve Search Console bağlıysa, yayından en az 30 gün geçmiş ve Search Console verisinde gösterim alıp tıklaması ya da sırası zayıf kalan makaleler haftalık taramada yeniden yazılabilir; Yarı otomatikte yeni hali onayını bekler</li>
        <li>Profesyonel ve üstü planlarda, Search Console bağlı, akış açık ve Tam otomatik moddaysan Google&apos;da 4-15. sırada takılı kalan RanksUp makaleleri her hafta (site başına en fazla 5) iyileştirilip yeniden yayınlanır; Yarı otomatikte bunları Takılı Sayfalar ekranından sen başlatırsın</li>
      </ul>

      <h3>AI görünürlük ölçümü otomatik değil</h3>
      <p>
        Otomatik günlük ölçüm yoktur. Otomatik akış açıkken site eklenirken bir başlangıç ölçümü alınır; sonraki ölçümleri AI Görünürlük
        sayfasındaki <strong>&ldquo;Yeniden Test&rdquo;</strong> ile sen başlatırsın. Hesap başına 7 günde bir AI ölçümü yapılabilir.
        Ayrıntılar: <a href="/help/ai-visibility">AI Görünürlük rehberi</a>.
      </p>

      <h3>3. App Store Connect günlük senkronu</h3>
      <p>Her gün 05:30 UTC&apos;de bağlı tüm App Store Connect hesapları için:</p>
      <ul>
        <li>Uygulamalar senkronlanır</li>
        <li>Sürümler (release) çekilir</li>
        <li>60 günden uzun süredir yeni sürüm yoksa <strong>uyarı</strong>, 120 günü geçtiyse <strong>kritik</strong> uyarı oluşur</li>
        <li>Yorumlar otomatik çekilmez; uygulamanın altındaki <strong>Yorumlar</strong> butonuyla çekersin</li>
      </ul>

      <h2>Auto-Pilot ile elle kullanım farkı</h2>
      <ul>
        <li><strong>Elle</strong>: AI önerir, sen uygularsın. Tam kontrol, daha yavaş.</li>
        <li><strong>Auto-Pilot</strong>: AI önerir ve uygular. Hızlıdır; bütçe sınırı yalnızca Auto-Pilot&apos;un kendi işlemlerini durdurur.</li>
      </ul>

      <Tip kind="warn">
        ASA Auto-Pilot gerçek reklam bütçesi harcatan değişiklikler yapar. <strong>Mutlaka bütçe sınırı ayarla</strong> ve ilk hafta &ldquo;Son çalışma&rdquo; sonuçlarını incele.
      </Tip>

      <h2>Kullanım takibi</h2>
      <p>
        Sitenin <strong>Genel Bakış</strong> sayfasındaki kota kartları:
      </p>
      <ul>
        <li>Bu ayki makale, AI görünürlük çalıştırması ve site kullanımı, limitleriyle birlikte</li>
        <li>Aylık AI bütçenin %80&apos;i geçilince uyarı; %100&apos;e ulaşınca görsel alt metni önerisi ve App Store yorum yanıtı taslağı gibi işlemler durur</li>
      </ul>
    </HelpArticle>
  );
}
