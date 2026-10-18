import { Plug } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Kendi sağlayıcı anahtarın (BYOK) — RanksUp Help' };

// Kodla dogrulandi (Ekim 2026):
//  - BYOK yalniz Kurumsal (plans.ts FEATURE_MIN_PLAN.byok;
//    site-ai-keys.service.ts upsertKey → enforcePlanFeature('byok')).
//  - Gecerli saglayicilar: anthropic, gemini, openai, perplexity, xai, deepseek
//    (site-ai-keys.service.ts VALID_PROVIDERS). Eski listedeki DALL-E, Sora,
//    Veo, Runway ve HeyGen urunde yok.
//  - Anahtar SITE basina, yalniz AI gorunurluk olcumunde kullanilir
//    (ai-citation.service.ts); makale uretimi bu anahtarla yapilmaz.
//  - Haftalik olcum hakki BYOK'ta da gecerli → "sinirsiz" degil.
//  - Bu sayfa RanksUp API anahtarlarini (luvi_, MCP/REST) ANLATMAZ.
export default function Page() {
  return (
    <HelpArticle slug="api-keys"
      icon={Plug}
      badge="BYOK"
      title="Kendi sağlayıcı anahtarınla ölç"
      intro="BYOK (Bring Your Own Key) Kurumsal planına dahildir. Kendi OpenAI, Anthropic, Google Gemini, Perplexity, xAI ya da DeepSeek anahtarını bağlarsan o sağlayıcının AI görünürlük ölçümleri senin anahtarınla yapılır; aylık çalıştırma kotan dolsa bile o sağlayıcıyla ölçüm sürer."
    >
      <Tip kind="info">
        Bu sayfa yapay zekâ sağlayıcılarının anahtarlarını anlatır. MCP sunucusu ve REST API için kullanılan RanksUp API anahtarları
        (<code>luvi_...</code>) panelindeki <strong>API Anahtarları</strong> sayfasında üretilir; kurulum için{' '}
        <a href="/agent-setup.txt">ajan kurulum rehberine</a> bak.
      </Tip>

      <h2>Hangi sağlayıcılar?</h2>
      <ul>
        <li><strong>OpenAI</strong> — ChatGPT ölçümü</li>
        <li><strong>Anthropic</strong> — Claude ölçümü</li>
        <li><strong>Google Gemini</strong> — Gemini ölçümü</li>
        <li><strong>Perplexity</strong> — Perplexity ölçümü</li>
        <li><strong>xAI</strong> — Grok ölçümü</li>
        <li><strong>DeepSeek</strong> — DeepSeek ölçümü</li>
      </ul>

      <h2>Nasıl bağlanır?</h2>
      <Step n={1} title="Bağlantılar sayfası">
        Site menüsü → <strong>Bağlantılar</strong> → <strong>AI sağlayıcı anahtarları</strong> bölümü. Anahtarlar site başına bağlanır.
      </Step>
      <Step n={2} title="Sağlayıcıyı seç">
        Her sağlayıcının kendi satırı vardır; anahtar ekleme alanını aç.
      </Step>
      <Step n={3} title="Anahtarı yapıştır">
        Kaydederken anahtar sağlayıcıya küçük bir deneme çağrısıyla doğrulanır. Doğrulanırsa &ldquo;Senin anahtarınla çalışıyor&rdquo; görünür;
        doğrulanamazsa hata mesajıyla birlikte kaydedilir ve yeniden deneyebilirsin.
      </Step>
      <Step n={4} title="Ölçümler senin anahtarınla yapılır">
        Sonraki AI görünürlük ölçümlerinde o sağlayıcı için senin anahtarın kullanılır. Aylık görünürlük çalıştırması kotan dolsa bile
        anahtar bağlı sağlayıcılarla ölçüm sürer. Hesap başına haftada bir AI ölçümü kuralı BYOK&apos;ta da geçerlidir.
      </Step>

      <h2>Güvenlik</h2>
      <ul>
        <li>Anahtarlar <strong>AES-256-GCM</strong> ile şifrelenip saklanır</li>
        <li>Veritabanına açık metin olarak yazılmaz; yalnızca çağrı anında çözülür</li>
        <li>Panelde anahtarın yalnızca ilk karakterleri gösterilir</li>
      </ul>

      <h2>Anahtarı nereden alırım?</h2>

      <h3>OpenAI</h3>
      <p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a> → &ldquo;Create new secret key&rdquo;. Genellikle <strong>sk-proj-...</strong> ile başlar.</p>

      <h3>Anthropic</h3>
      <p><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com/settings/keys</a> → &ldquo;Create Key&rdquo;. <strong>sk-ant-...</strong> ile başlar.</p>

      <h3>Google Gemini</h3>
      <p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a> → &ldquo;Get API key&rdquo;. <strong>AIza...</strong> ile başlar.</p>

      <h3>Perplexity / xAI / DeepSeek</h3>
      <p>Sağlayıcının kendi panelindeki API anahtarı sayfasından. Bağlantılar sayfasında her sağlayıcının yanında doğru adres gösterilir.</p>

      <Tip kind="success">
        BYOK ile o sağlayıcının çağrı ücretini doğrudan sağlayıcıya ödersin; RanksUp aboneliğin aynı kalır.
      </Tip>
    </HelpArticle>
  );
}
