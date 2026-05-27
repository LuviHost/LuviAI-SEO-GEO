import { Sparkles } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'AI Görünürlük — LuviAI Help' };

export default function Page() {
  return (
    <HelpArticle slug="ai-visibility"
      icon={Sparkles}
      badge="AI Görünürlük"
      title="ChatGPT, Claude, Gemini'de markanı izle"
      intro="Kullanıcılar artık Google yerine AI'lara soruyor. LuviAI hangi AI sorularında çıkıp çıkmadığını ölçer, sentiment, share of voice ve eylem önerisi verir."
      steps={[
        { name: 'AI Görünürlük sekmesine git', text: 'Sol menü → AI Görünürlük. Citation History Chart üstte gözükür.' },
        { name: 'İlk testi çalıştır', text: '"Test Çalıştır" butonu. 6 AI\'ya (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) paralel 5 soru sorulur, 30-60 saniye sürer.' },
        { name: 'Sonuçları analiz et', text: 'Her AI için ayrı kart: skor, sentiment (pozitif/nötr/negatif), share of voice (rakipler), position (cevapta kaçıncı sırada geçtin).' },
        { name: 'GEO Roadmap al', text: 'Alttaki "AI Önerisi Al" butonu — AI mevcut sonuçları okur, 5 actionable adım üretir (FAQ schema, Wikipedia kaydı, vs).' },
        { name: 'Auto-Pilot ile günlük takip', text: 'Auto-Pilot açıksa günlük snapshot otomatik alınır, grafiği günden güne karşılaştırırsın.' },
      ]}
    >
      <h2>Nasıl çalışır?</h2>
      <p>
        LuviAI senin sektörüne uygun 5 soruyu (örn. <em>"en iyi KOBİ muhasebe yazılımı nedir?"</em>)
        <strong> 6 AI'ya birden</strong> sorar: ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek.
        Cevapta marka adın geçti mi, URL alıntılandı mı, hangi sırada geçti — hepsi ölçülür.
      </p>

      <h2>Skor sistemi</h2>
      <ul>
        <li><strong>Cited (URL alıntı)</strong> = 100 puan — AI cevapta direkt site URL'ini vermiş</li>
        <li><strong>Mentioned (marka mention)</strong> = 50 puan — sadece marka adı geçmiş</li>
        <li><strong>Absent</strong> = 0 puan — hiç geçmemiş</li>
      </ul>

      <h2>4 metrik — Maya'dan üstün özellikler</h2>

      <h3>1. Sentiment Analysis</h3>
      <p>Her mention'ın pozitif/nötr/negatif tonu ölçülür. AI cevabında "en iyi", "tavsiye" gibi keyword'ler pozitif; "kötü", "tavsiye etmem" negatif sayılır.</p>

      <h3>2. Position Tracking</h3>
      <p>Cevapta marka kaçıncı sırada geçmiş? 1. olmak ile 5. olmak çok farklı — LuviAI ortalamayı `#3.2` gibi gösterir.</p>

      <h3>3. Share of Voice</h3>
      <p>Senin marka %X, rakipler %Y, %Z. AI cevaplarında ne kadar yer kaplıyorsun, rakiplere göre nerede duruyorsun.</p>

      <h3>4. GEO Roadmap</h3>
      <p>Skora bakıp <strong>5 actionable öneri</strong> üretir (örn. "Wikipedia'da marka kaydı aç", "FAQ schema markup ekle"). Tek tık ile AI önerisi alabilirsin.</p>

      <h2>Nasıl kullanırım?</h2>
      <Step n={1} title="AI Görünürlük sekmesine git">
        Sol menü → <strong>AI Görünürlük</strong>. Citation History Chart üstte gözükür.
      </Step>
      <Step n={2} title="İlk testi çalıştır">
        <strong>Test Çalıştır</strong> butonu. 6 AI'ya paralel 5 soru sorulur, 30-60 saniye sürer. Sonuçta her AI için ayrı kart (skor + probe detayları).
      </Step>
      <Step n={3} title="Roadmap'i al">
        Alttaki <strong>GEO Roadmap</strong> kartında <strong>"AI Önerisi Al"</strong>. AI mevcut sonuçları okur + 5 actionable adım üretir.
      </Step>
      <Step n={4} title="Her gün takip et (Auto-Pilot)">
        Auto-Pilot açıksa günlük snapshot otomatik alınır. Grafiği günden güne karşılaştırırsın.
      </Step>

      <Tip kind="info">
        İlk testten önce <strong>Brain regenerate</strong> et — Brain içinde AEO/GEO sorgular varsa daha hedefli test yapılır.
      </Tip>

      <h2>BYOK — Kendi API key'inle çalış</h2>
      <p>
        Pro plan ve üstü için BYOK (Bring Your Own Key) opsiyonu var.
        Kendi OpenAI/Anthropic key'ini bağlarsan o provider'ın testleri <strong>kotandan düşmez</strong> — sınırsız test atabilirsin.
      </p>
      <p><a href="/help/api-keys">API Keys rehberini oku</a></p>

      <Tip kind="success">
        AI Görünürlük + Auto-Pilot + Roadmap kombinasyonu — Maya AI'nın yaptığının tamamı + 4 ek modül.
        Tek farkı: bizimki TR'de %50 daha ucuz.
      </Tip>
    </HelpArticle>
  );
}
