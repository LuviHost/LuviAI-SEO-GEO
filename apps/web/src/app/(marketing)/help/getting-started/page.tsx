import { Rocket } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Hızlı Başlangıç — LuviAI Help' };

export default function Page() {
  return (
    <HelpArticle slug="getting-started"
      icon={Rocket}
      badge="Başlangıç"
      title="5 dakikada başla"
      intro="LuviAI'da hesap aç, ilk siteni bağla, ilk AI çıktısını gör — toplam 5 dakika."
      steps={[
        { name: 'Hesap aç', text: 'Landing\'de "Ücretsiz başla" butonu ile mail/Google ile kayıt. Hesabın otomatik açılır, kart istenmez. İlk 2 makale ücretsiz.' },
        { name: 'Site URL\'sini yapıştır', text: 'Dashboard üst köşedeki "Site Ekle" → URL gir. AI sektörünü ve dilini tespit eder.' },
        { name: 'AI bulgularını gör (60sn)', text: 'Onboarding sırasında platform tespit, hedef persona, 3 rakip, site skoru, ilk yazılacak içerik sırasıyla görünür.' },
        { name: 'AI Visibility test çalıştır', text: 'Sol menü → AI Görünürlük → Test Çalıştır. ChatGPT/Claude/Gemini/Perplexity sana 5 soru sorulur, 30-60 saniyede sonuç.' },
        { name: 'GEO Roadmap önerisi al', text: 'Citation altında "AI Önerisi Al" → 5 actionable adım (FAQ schema, Wikipedia kaydı vb).' },
        { name: 'İlk makaleni üret', text: 'İçerikler → Yeni Makale → AI önerilen topic\'ten birini seç → 2-3 dakikada uzun-form makale hazır.' },
      ]}
    >
      <h2>Adım 1: Hesap aç</h2>
      <Step n={1} title="Ücretsiz başla butonuna bas">
        Landing'de turuncu <strong>"Ücretsiz başla — kart gerekmez"</strong> butonu ile başlarsın. Kayıt formunda mail + şifre veya Google ile tek tık.
      </Step>
      <Step n={2} title="Ücretsiz deneme otomatik açılır">
        Kart bilgisi istenmez. Trial'da <strong>2 ücretsiz makale</strong> + 5 sosyal post + 1 site hakkın var, tüm modüller görünür.
      </Step>

      <h2>Adım 2: İlk siteni bağla</h2>
      <Step n={1} title="Site URL'sini yapıştır">
        Dashboard üst köşedeki <strong>"Site Ekle"</strong> butonuna bas. Sadece URL yapıştır: <code>https://siten.com</code>.
      </Step>
      <Step n={2} title="AI sektörünü ve dilini tespit eder">
        Onboarding wizard URL'i tarar, sektörünü tahmin eder (KOBİ, e-ticaret, mobil app, finans, sağlık vs). Yanlış tahminse manuel düzeltebilirsin.
      </Step>
      <Step n={3} title="60 saniyede AI bulguları görünür">
        Onboarding'de "Mission" ekranında her aşama bittikçe sol panelde bulgular gösterilir: platform tespit, hedef persona, 3 rakip, site skoru, ilk yazılacak içerik.
      </Step>

      <Tip kind="info">
        Onboarding 60 saniye almazsa endişelenme — backend 5 paralel iş yürütüyor. 90 saniyeyi aşarsa dashboard'a yönlendir, eksikleri orada görürsün.
      </Tip>

      <h2>Adım 3: İlk AI çıktısını al</h2>
      <Step n={1} title="AI Görünürlük → 'Test Çalıştır'">
        Sol menüde <strong>AI Görünürlük</strong> sekmesine git. <strong>Test Çalıştır</strong> bas — ChatGPT/Claude/Gemini/Perplexity'ye 5 soru sorulur, marka tanınırlığın ölçülür. 30-60 saniye sürer.
      </Step>
      <Step n={2} title="GEO Roadmap → AI önerisi al">
        Aynı sayfanın altındaki <strong>GEO Roadmap</strong> bölümünde <strong>"AI Önerisi Al"</strong> bas. 5 actionable öneri çıkar (örn. "FAQ schema markup ekle", "Wikipedia'da marka kaydı aç").
      </Step>
      <Step n={3} title="İlk makaleni üret">
        İçerikler sekmesine git → <strong>"Yeni Makale"</strong> → AI önerilen topic listesinden seç → tek tık üretim başlar. 2-3 dakikada hazır.
      </Step>

      <Tip kind="success">
        Bu noktada zaten ürünün gücünü gördün: AI senin siteni tarayıp eksikleri buldu, çözüm önerdi, ilk içeriği yazdı.
        İlk 2 ücretsiz makale boyunca tüm modüllere erişimin var.
      </Tip>

      <h2>Sonraki adımlar</h2>
      <ul>
        <li><a href="/help/ai-visibility">AI Görünürlük rehberi</a> — sentiment, share of voice, position tracking</li>
        <li><a href="/help/aso">ASO rehberi</a> — App Store + Play Store keyword takibi</li>
        <li><a href="/help/asa-asc">Apple Search Ads</a> — iOS reklam kurulumu</li>
        <li><a href="/help/studio">AI Studio</a> — görsel + video + metin üretimi</li>
        <li><a href="/help/auto-pilot">Auto-Pilot</a> — sen uyurken çalışır</li>
      </ul>
    </HelpArticle>
  );
}
