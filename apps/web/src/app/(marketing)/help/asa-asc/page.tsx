import { Smartphone } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Apple Search Ads + ASC — RanksUp Help' };

export default function Page() {
  return (
    <HelpArticle slug="asa-asc"
      icon={Smartphone}
      badge="Apple Search Ads + App Store Connect"
      title="iOS reklam kampanyası + review takibi"
      intro="Apple Search Ads ile App Store'da paid trafik. App Store Connect API ile review + release takibi. Auto-Pilot ile her hafta otomatik optimizasyon."
      steps={[
        { name: 'Tarayıcıda anahtar üret', text: 'ASA tab → Bağla → "Otomatik Anahtar Üret". Web Crypto API ile ES256 keypair tarayıcında oluşturulur. Private key sadece sende kalır.' },
        { name: 'Apple\'a public key yapıştır', text: 'Apple Search Ads → Account Settings → API → Public Key kutusuna Cmd+V → Save.' },
        { name: 'Apple\'ın verdiği 3 satırı geri yapıştır', text: 'Apple clientId + teamId + keyId verir. 3 satırı kopyala, wizard\'ın smart paste kutusuna yapıştır.' },
        { name: 'Bağla + test et', text: 'Apple\'a JWT auth çağrısı atılır. Başarılıysa hesap aktif olur.' },
        { name: 'AI ile ilk kampanyayı kur', text: 'Yeni Kampanya → "AI ile Doldur" — ASO\'dan keyword + bid + bütçe otomatik gelir, sen onayla.' },
        { name: 'Auto-Pilot\'u aç', text: 'Her hesap altında Auto-Pilot toggle\'ı. Bütçe cap ayarla, AI sen uyurken keyword ekler + düşük performansı pause eder.' },
      ]}
    >
      <h2>Apple Search Ads (ASA)</h2>
      <p>
        App Store'da kullanıcı arama yaptığında üstte gösterilen sponsorlu reklamlar.
        ASO ile organic sıralamanı yükseltmek aylar sürerken, ASA ile <strong>bugün</strong> 1. sıraya geçersin.
        TR pazarında Apple Search Ads CPI'ı Facebook/Google'ın <strong>1/3'ü</strong>.
      </p>

      <h3>ASA bağlantı — 3 adımda</h3>
      <p>Wizard ile <strong>terminal/openssl gerekmez</strong>. Tarayıcıda ES256 keypair üretilir, Apple'a yapıştırırsın, Apple'ın verdiği 3 satırı RanksUp'a yapıştırırsın.</p>

      <Step n={1} title="Anahtar üret (tarayıcıda)">
        ASA tab → <strong>"Bağla"</strong> → Step 1 <strong>"Otomatik Anahtar Üret"</strong>. Web Crypto API ile ES256 keypair tarayıcında üretilir. Private key sadece sende kalır (AES-256-GCM ile şifrelenip saklanır).
      </Step>
      <Step n={2} title="Apple'a public key yapıştır">
        Step 2'de "Apple Search Ads'i aç" butonuyla yeni sekme açılır. <strong>Account Settings → API</strong>'ya git (app açıldıktan sonra URL'de `report` → `settings/apicertificates` değiştir). Public Key kutusuna Cmd+V → Save.
      </Step>
      <Step n={3} title="3 satırı geri yapıştır">
        Apple <strong>clientId</strong>, <strong>teamId</strong>, <strong>keyId</strong> verir. 3 satırı kopyala, wizard'ın smart paste kutusuna yapıştır. Regex otomatik parse eder.
      </Step>
      <Step n={4} title="Bağla + test et">
        Apple'a JWT auth çağrısı atılır. Başarılıysa hesap aktif olur.
      </Step>

      <Tip kind="warn">
        Apple ödeme yöntemi olmadan kampanya oluşturmaya bile izin vermez.
        Apple Search Ads → Account Settings → Billing → Add Payment Method ekledikten sonra kampanya kurabilirsin.
      </Tip>

      <h3>Yeni kampanya — AI ile doldur</h3>
      <p>
        Yeni Kampanya modal'ında üstte <strong>"AI ile Doldur"</strong> butonu var. ASO Keywords'ünden organic ranking düşük (15. sıradan aşağıda) + yüksek trafik keyword'leri otomatik seçer, bid + bütçe önerir, kampanya adı + adamId otomatik gelir.
      </p>

      <h3>Auto-Pilot</h3>
      <p>Her account satırı altında <strong>"Auto-Pilot"</strong> paneli. Açtığında günlük olarak:</p>
      <ul>
        <li>Son 7g'de 20+ tap aldı ama 0 install — keyword <strong>PAUSE</strong></li>
        <li>AI önerisinden mevcut'ta olmayan top 5 keyword <strong>EKLE</strong></li>
        <li>Aylık bütçe cap aşıldıysa <strong>SKIP</strong> (zarar önleme)</li>
      </ul>

      <h2>App Store Connect (ASC) — review + release</h2>
      <p>App Store Connect API ile müşteri yorumları, release tarihçesi, "abandonware" alarmları.</p>

      <Step n={1} title="ASC bağla">
        ASO sayfasında <strong>"🍎 App Store Connect"</strong> sekmesi. <strong>Bağla</strong> → Apple Developer'dan üretilen Issuer ID + Key ID + .p8 dosyası.
      </Step>
      <Step n={2} title="App'leri sync et">
        Bağlantı sonrası <strong>Sync</strong> bas. Apple'daki tüm app'lerin RanksUp'a düşer.
      </Step>
      <Step n={3} title="Yorumları + release'leri çek">
        Her app altında <strong>Yorumlar</strong> butonu → son 50 yorum + ortalama rating. Cron her gece otomatik çeker.
      </Step>
      <Step n={4} title="Alert'leri takip et">
        60+ gündür release yoksa WARN, 120+ gündür yoksa CRITICAL alert. App Store algoritması "abandonware" işareti koymadan önce uyarır.
      </Step>

      <Tip kind="info">
        ASA + ASC birlikte: paid trafik (ASA) + organic sıralama + rating takibi (ASO + ASC). Mobil app sahipleri için tam stack.
      </Tip>
    </HelpArticle>
  );
}
