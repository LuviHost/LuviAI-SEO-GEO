import { Clapperboard } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'RanksUp Video — RanksUp Help' };

// Kodla dogrulandi (21.10.2026):
//  - Plan: FEATURE_MIN_PLAN.articleVideo = 'pro' (api billing/plans.ts); aylik hak
//    VIDEOS_PER_MONTH (sayi burada yazilmaz, fiyat sayfasi tek yer). Hak kosullu UPDATE ile
//    duser, basarisiz videoda iade (video-render.service markFailed), kuyruktaki video
//    silinince iade (videos.service remove), takvim ayi basinda sifirlanir. Uc tur (makale, site,
//    urun) AYNI hakki kullanir; her video (her bicim) bir hak.
//  - Makale: yalniz PUBLISHED makale (videos.service request). Metin DB'deki makaleden; Claude
//    Haiku 5.5 + koruyucu (sayi birebir, yenilik orani), olmazsa makalenin kendi cumleleri.
//  - Site tanitimi: anasayfa + DB marka profili (Brain); sablon SiteIntro (dikey) /
//    SiteIntroWide (yatay). Urun tanitimi: yalniz sitenin kayitli alan adindaki sayfa
//    (promo-video-source.ts assertOwnSitePageUrl; yonlendirme de alan adinin disina cikamaz),
//    gorsel safe-fetch + sharp, fiyat yalniz iki kaynakla (JSON-LD/meta + gorunur metin)
//    dogrulanmissa (apps/video page.mjs verifyPrice); ProductShort / ProductWide.
//  - Tempo (videos.dto tempo, varsayilan normal): hizli = eski sabit 15 sn (yatay site 24 sn);
//    normal / yavas sure metinden (apps/video src/tempo/plan.mjs), her metin
//    max(2 sn; 0,3 sn x kelime + 1 sn) ekranda, en fazla 60 sn (check-video-readability.mjs).
//    Araliklar panelle ayni tablodan: web lib/article-video.ts VIDEO_TEMPO_SECONDS.
//  - Marka: sitenin anasayfasi (ad, logo, tema rengi), SSRF korumali indirme; diyalogda renk,
//    logo ve ad duzeltilir. Logo yoksa bas harf.
//  - Cikti: H.264 + AAC, -14 LUFS, "ranksup.ai ile uretildi" ibaresi; nginx /videos/ altinda
//    tahmin edilmesi guc adres. RanksUp hicbir platformda yayin yapmaz.
export default function Page() {
  return (
    <HelpArticle slug="video"
      icon={Clapperboard}
      badge="RanksUp Video"
      title="Makale, site ve ürün tanıtım videoları"
      intro="RanksUp Video, yayındaki makalenden, sitenin ana sayfasından ya da sitendeki bir ürün/hizmet sayfasından sitenin adı, logosu ve rengiyle kısa video üretir. Dikey videolar Reels, Shorts ve TikTok için; yatay videolar web sitesi ve YouTube için hazır biçimdedir."
      steps={[
        { name: 'Video türünü seç', text: 'Videolar sayfasında Yeni video kartından Makaleden, Site tanıtımı ya da Ürün tanıtımı seç. Makale videosunu makale sayfasındaki Video üret düğmesiyle de başlatabilirsin.' },
        { name: 'Kaynağı ve biçimi belirle', text: 'Makaleyi seç, ürün tanıtımında sitendeki sayfanın adresini yapıştır; site ve ürün tanıtımında dikey ya da yatay biçimi seç.' },
        { name: 'Tempoyu seç, markayı kontrol et, üret ve indir', text: 'Tempoyu (Hızlı, Normal ya da Yavaş) seç, sitenden okunan adı, logoyu ve rengi kontrol et, Video üret’e bas. Video hazır olunca Videolar sayfasında izleyip MP4 olarak indirirsin.' },
      ]}
    >
      <h2>Ne üretir?</h2>
      <ul>
        <li><strong>Makaleden:</strong> 1080×1920 dikey. Makalenin başlığından bir kanca, makalenin üç ana bölümünden üç madde ve sitenin alan adıyla &ldquo;Tamamını oku&rdquo; kapanışı.</li>
        <li><strong>Site tanıtımı:</strong> 1080×1920 dikey ya da 1920×1080 yatay. Logon ve adınla açılır; işletmenin ne yaptığı, sitendeki üç hizmet ya da değer ve alan adınla kapanış. Kaynak sitenin ana sayfası ve RanksUp’taki marka profilin.</li>
        <li><strong>Ürün tanıtımı:</strong> 1080×1920 dikey ya da 1920×1080 yatay. Ürünün görseli yavaşça yakınlaşarak öne çıkar; ürün adı, sayfadaki ana fayda, üç özellik ve sayfanın kısa adresiyle kapanış.</li>
        <li><strong>Tempo:</strong> <strong>Normal</strong> (varsayılan) her metni okunacak kadar ekranda tutar; süre metnin uzunluğuna göre yaklaşık 15–50 saniyedir. <strong>Yavaş</strong> daha sakin geçişler ve daha uzun okuma süresi verir (yaklaşık 25–60 saniye). <strong>Hızlı</strong> 15 saniyedir (yatay site tanıtımında 24 saniye) ve kısa metinler içindir; uzun cümleler hızlı geçer. Video hiçbir tempoda 60 saniyeyi geçmez; her tempo bir video hakkı kullanır.</li>
        <li><strong>Marka:</strong> sitenin adı, logosu ve tema rengi. Yazı renkleri okunurluğa göre otomatik ayarlanır; renk bulunamazsa RanksUp turuncusu, logo bulunamazsa marka adının baş harfi, ürün görseli bulunamazsa logolu bir marka kartı kullanılır.</li>
        <li>Müzikli (ses -14 LUFS’a dengelenir), MP4. Videoda küçük bir &ldquo;ranksup.ai ile üretildi&rdquo; ibaresi bulunur.</li>
      </ul>

      <h2>Metin nereden geliyor?</h2>
      <p>
        Makale videosunun metni makalenin <strong>kendi</strong> başlık, cümle ve sayılarından oluşur. Metin Claude ile kısaltıldığında çıktı bir
        denetimden geçer: makalede birebir geçmeyen bir sayı ya da makalede olmayan kelimelerin oranı yüksekse metin reddedilir ve yerine makalenin
        kendi cümleleri kullanılır. Site ve ürün tanıtımında aynı denetim sitenin kendi sayfasına uygulanır: videodaki her sayı sayfada birebir
        geçmelidir. Marka profilin yalnızca bağlam olarak kullanılır; profilde geçen bir sayı videoya giremez. Videoya sitende olmayan bir bilgi
        eklenmez. Yine de videoyu yayınlamadan önce izleyip kontrol etmeni öneririz.
      </p>

      <h2>Ürün tanıtımında kurallar</h2>
      <ul>
        <li>Sayfa yalnızca <strong>sitenin kendi alan adında</strong> olabilir (alt alan adları dahil). Başka bir sitenin adresi, IP adresi ya da başka bir alan adına yönlendiren sayfa kabul edilmez.</li>
        <li>Ürün görseli sayfanın ürün bilgisinden (ya da paylaşım görselinden) alınır, boyutu sınırlanır ve videoya uygun biçime çevrilir.</li>
        <li><strong>Fiyat</strong> yalnızca sayfanın ürün bilgisinde ve sayfada görünen metinde aynı tutar olarak geçiyorsa gösterilir. Varyantlı, indirimli ya da yalnız bir yerde geçen fiyat videoya konmaz.</li>
      </ul>

      <h2>Adım adım</h2>
      <Step n={1} title="Türü seç">
        <strong>Videolar</strong> sayfasındaki <strong>Yeni video</strong> kartında <strong>Makaleden</strong>, <strong>Site tanıtımı</strong> ya da
        <strong> Ürün tanıtımı</strong> seç. Makale videosu yalnızca <strong>yayındaki</strong> makaleden üretilir; İçerikler sayfasında ve makale
        sayfasında da <strong>Video üret</strong> düğmesi vardır.
      </Step>
      <Step n={2} title="Kaynak ve biçim">
        Ürün tanıtımında sitendeki ürün ya da hizmet sayfasının adresini yapıştır; adres sitenin alan adında değilse alan hemen uyarır. Site ve
        ürün tanıtımında dikey (Reels, Shorts, TikTok) ya da yatay (web sitesi, YouTube) biçimi seç.
      </Step>
      <Step n={3} title="Tempoyu seç, markayı kontrol et">
        Açılan pencerede tempoyu seç: Hızlı, Normal ya da Yavaş; her seçeneğin yanında bu türün yaklaşık süresi yazar. Aynı pencerede sitenin
        herkese açık sayfasından okunan ad, logo ve renk görünür. Rengi değiştirebilir, RanksUp turuncusunu seçebilir,
        logoyu kaldırabilir ve marka adını düzeltebilirsin.
      </Step>
      <Step n={4} title="Üret, izle, indir">
        <strong>Video üret</strong> dediğinde video sıraya girer; durumu Videolar sayfasında &ldquo;Sırada&rdquo;, &ldquo;Hazırlanıyor&rdquo; ve
        &ldquo;Hazır&rdquo; olarak görürsün. Hazır olunca panel bildirimi gelir; videoyu izleyip <strong>İndir</strong> ile MP4 olarak alırsın.
      </Step>

      <h2>Plan ve video hakkı</h2>
      <p>
        RanksUp Video <strong>Profesyonel ve üstü</strong> planlarda açıktır. Aylık video hakkı plana göre değişir; güncel sayılar{' '}
        <a href="/pricing">fiyatlandırma sayfasında</a>. Hak her takvim ayının başında yenilenir.
      </p>
      <ul>
        <li>Makale, site ve ürün videoları aynı aylık haktan düşer; her video (aynı kaynağın dikey ve yatay biçimi ayrı ayrı) istendiği anda bir kez düşer.</li>
        <li>Video üretilemezse hakkın otomatik olarak iade edilir ve nedeni Videolar sayfasında yazar.</li>
        <li>Sırada bekleyen bir videoyu silersen hakkın iade edilir; hazır bir videoyu silmek hakkı geri vermez.</li>
        <li>Deneme ve Büyüme planlarında düğme kilitli bir önizleme açar; video üretilmez.</li>
      </ul>

      <Tip kind="info">
        RanksUp videoyu senin adına hiçbir platformda yayınlamaz. Videoyu nerede yayınlayacağına sen karar verirsin; yayınlanan videonun, logonun
        ve ürün görsellerinin kullanımından sen sorumlusun (<a href="/terms">Kullanım Şartları</a> 8. madde).
      </Tip>

      <h2>Gizlilik</h2>
      <p>
        Video metni için yalnızca makalenin metni ya da sitenin kendi sayfasının metni (site tanıtımında marka profilinin özetiyle birlikte)
        Anthropic Claude’a gönderilir; logon, ürün görsellerin ve marka rengin yapay zekâ sağlayıcısına gönderilmez, video sunucularımızda
        üretilir. Video dosyaları tahmin edilmesi güç bir bağlantıyla saklanır; bağlantıyı bilen herkes videoyu açabilir. Videoyu ya da siteyi
        sildiğinde dosyalar da silinir (<a href="/privacy">Gizlilik Politikası</a>).
      </p>
    </HelpArticle>
  );
}
