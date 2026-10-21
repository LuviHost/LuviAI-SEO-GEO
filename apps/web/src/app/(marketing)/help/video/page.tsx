import { Clapperboard } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'RanksUp Video — RanksUp Help' };

// Kodla dogrulandi (21.10.2026):
//  - Plan: FEATURE_MIN_PLAN.articleVideo = 'pro' (api billing/plans.ts); aylik hak
//    VIDEOS_PER_MONTH (sayi burada yazilmaz, fiyat sayfasi tek yer). Hak kosullu UPDATE ile
//    duser, basarisiz videoda iade (video-render.service markFailed), kuyruktaki video
//    silinince iade (videos.service remove), takvim ayi basinda sifirlanir.
//  - Yalniz PUBLISHED makale (videos.service request). Metin DB'deki makaleden; Claude Haiku
//    5.5 + koruyucu (sayi birebir, yenilik orani), olmazsa makalenin kendi cumleleri.
//  - Marka: sitenin anasayfasi (ad, logo, tema rengi), SSRF korumali indirme; diyalogda renk,
//    logo ve ad duzeltilir. Logo yoksa bas harf.
//  - Cikti: 1080x1920, 15 sn, H.264 + AAC, -14 LUFS, "ranksup.ai ile uretildi" ibaresi;
//    nginx /videos/ altinda tahmin edilmesi guc adres. RanksUp hicbir platformda yayin yapmaz.
export default function Page() {
  return (
    <HelpArticle slug="video"
      icon={Clapperboard}
      badge="RanksUp Video"
      title="Makaleden 15 saniyelik dikey video"
      intro="RanksUp Video, yayındaki makalenden sitenin adı, logosu ve rengiyle 15 saniyelik dikey video üretir. Reels, Shorts ve TikTok için hazır biçimdedir."
      steps={[
        { name: 'Yayındaki makaleyi aç', text: 'İçerikler sayfasında yayındaki makalenin satırındaki Video düğmesine ya da makale sayfasındaki Video üret düğmesine bas.' },
        { name: 'Markayı kontrol et', text: 'Sitenden okunan adı, logoyu ve rengi kontrol et; istersen rengi değiştir, logoyu kaldır ya da adı düzelt.' },
        { name: 'Videoyu üret ve indir', text: 'Video üret’e bas. Video hazır olunca Videolar sayfasında izleyip MP4 olarak indirirsin.' },
      ]}
    >
      <h2>Ne üretir?</h2>
      <ul>
        <li><strong>Biçim:</strong> 1080×1920 dikey, 15 saniye, müzikli (ses -14 LUFS’a dengelenir), MP4.</li>
        <li><strong>Akış:</strong> makalenin başlığından bir kanca, makalenin üç ana bölümünden üç madde ve sitenin alan adıyla &ldquo;Tamamını oku&rdquo; kapanışı.</li>
        <li><strong>Marka:</strong> sitenin adı, logosu ve tema rengi. Yazı renkleri okunurluğa göre otomatik ayarlanır; renk bulunamazsa RanksUp turuncusu, logo bulunamazsa marka adının baş harfi kullanılır.</li>
        <li>Videoda küçük bir &ldquo;ranksup.ai ile üretildi&rdquo; ibaresi bulunur.</li>
      </ul>

      <h2>Metin nereden geliyor?</h2>
      <p>
        Video metni makalenin <strong>kendi</strong> başlık, cümle ve sayılarından oluşur. Metin Claude ile kısaltıldığında çıktı bir denetimden
        geçer: makalede birebir geçmeyen bir sayı ya da makalede olmayan kelimelerin oranı yüksekse metin reddedilir ve yerine makalenin kendi
        cümleleri kullanılır. Videoya makalede olmayan bir bilgi eklenmez. Yine de videoyu yayınlamadan önce izleyip kontrol etmeni öneririz.
      </p>

      <h2>Adım adım</h2>
      <Step n={1} title="Yayındaki makaleyi seç">
        Video yalnızca <strong>yayındaki</strong> makaleden üretilir. İçerikler sayfasında yayındaki makalenin satırında <strong>Video</strong>,
        makale sayfasında <strong>Video üret</strong> düğmesi vardır. Videolar sayfasından da makale seçerek başlatabilirsin.
      </Step>
      <Step n={2} title="Markayı kontrol et">
        Açılan pencerede sitenin herkese açık sayfasından okunan ad, logo ve renk görünür. Rengi değiştirebilir, RanksUp turuncusunu seçebilir,
        logoyu kaldırabilir ve marka adını düzeltebilirsin.
      </Step>
      <Step n={3} title="Üret, izle, indir">
        <strong>Video üret</strong> dediğinde video sıraya girer; durumu Videolar sayfasında &ldquo;Sırada&rdquo;, &ldquo;Hazırlanıyor&rdquo; ve
        &ldquo;Hazır&rdquo; olarak görürsün. Hazır olunca panel bildirimi gelir; videoyu izleyip <strong>İndir</strong> ile MP4 olarak alırsın.
      </Step>

      <h2>Plan ve video hakkı</h2>
      <p>
        RanksUp Video <strong>Profesyonel ve üstü</strong> planlarda açıktır. Aylık video hakkı plana göre değişir; güncel sayılar{' '}
        <a href="/pricing">fiyatlandırma sayfasında</a>. Hak her takvim ayının başında yenilenir.
      </p>
      <ul>
        <li>Her video istendiği anda hakkından bir kez düşer.</li>
        <li>Video üretilemezse hakkın otomatik olarak iade edilir ve nedeni Videolar sayfasında yazar.</li>
        <li>Sırada bekleyen bir videoyu silersen hakkın iade edilir; hazır bir videoyu silmek hakkı geri vermez.</li>
        <li>Deneme ve Büyüme planlarında düğme kilitli bir önizleme açar; video üretilmez.</li>
      </ul>

      <Tip kind="info">
        RanksUp videoyu senin adına hiçbir platformda yayınlamaz. Videoyu nerede yayınlayacağına sen karar verirsin; yayınlanan videonun ve
        logonun kullanımından sen sorumlusun (<a href="/terms">Kullanım Şartları</a> 8. madde).
      </Tip>

      <h2>Gizlilik</h2>
      <p>
        Video metni için yalnızca makalenin metni Anthropic Claude’a gönderilir; logon ve marka rengin yapay zekâ sağlayıcısına gönderilmez,
        video sunucularımızda üretilir. Video dosyaları tahmin edilmesi güç bir bağlantıyla saklanır; bağlantıyı bilen herkes videoyu açabilir.
        Videoyu ya da siteyi sildiğinde dosyalar da silinir (<a href="/privacy">Gizlilik Politikası</a>).
      </p>
    </HelpArticle>
  );
}
