import { Plug } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'API Keys (BYOK) — RanksUp Help' };

export default function Page() {
  return (
    <HelpArticle slug="api-keys"
      icon={Plug}
      badge="BYOK"
      title="Kendi API key'inle çalış"
      intro="BYOK (Bring Your Own Key) — kendi OpenAI / Anthropic / Google AI key'ini bağlarsan, o provider'ın çağrıları RanksUp kotasından düşmez. Sınırsız kullanım."
    >
      <h2>Hangi provider'lar?</h2>
      <ul>
        <li><strong>OpenAI</strong> — ChatGPT, DALL-E, GPT-4o, GPT-4o-mini, Sora 2</li>
        <li><strong>Anthropic</strong> — Claude Opus, Claude Sonnet, Claude Haiku</li>
        <li><strong>Google AI</strong> — Gemini Pro, Veo 3</li>
        <li><strong>Perplexity</strong> — Perplexity Pro</li>
        <li><strong>xAI</strong> — Grok</li>
        <li><strong>DeepSeek</strong> — DeepSeek V3</li>
        <li><strong>Runway</strong> — Gen-4 video</li>
        <li><strong>HeyGen</strong> — Avatar video</li>
      </ul>

      <h2>Nasıl bağlanır?</h2>
      <Step n={1} title="Settings → API Keys">
        Site dashboard → <strong>Ayarlar → API Keys</strong> sekmesi.
      </Step>
      <Step n={2} title="Provider seç">
        Her provider için bağlama kartı. <strong>"Anahtar ekle"</strong> butonu.
      </Step>
      <Step n={3} title="API key yapıştır">
        Yapıştırdığında otomatik test edilir (ufak ping çağrısı). Başarılıysa yeşil "Doğrulandı" rozeti.
      </Step>
      <Step n={4} title="O provider artık kotasız">
        Sonraki çağrılar otomatik senin key'ini kullanır. RanksUp kotandan düşmez.
      </Step>

      <h2>Güvenlik</h2>
      <ul>
        <li>Key'ler <strong>AES-256-GCM</strong> ile şifrelenip saklanır</li>
        <li>Veritabanına asla plaintext yazılmaz</li>
        <li>Her API çağrısında runtime'da decrypt</li>
        <li>Sadece sen ve admin görür (admin sadece debug için)</li>
      </ul>

      <Tip kind="info">
        Trial planda OpenAI + Anthropic key zorunlu (havuzumuz Trial'a kapalı). Pro+ planlarda havuz açık, BYOK opsiyonel.
      </Tip>

      <h2>API Key'leri nereden alırım?</h2>

      <h3>OpenAI</h3>
      <p><a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a> → "Create new secret key" → kopyala. <strong>sk-proj-...</strong> ile başlar.</p>

      <h3>Anthropic</h3>
      <p><a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com/settings/keys</a> → "Create Key" → <strong>sk-ant-...</strong> ile başlar.</p>

      <h3>Google AI</h3>
      <p><a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> → "Get API key" → <strong>AIza...</strong> ile başlar.</p>

      <h3>Perplexity / xAI / DeepSeek</h3>
      <p>İlgili dashboard'larından API key sekmesi.</p>

      <Tip kind="success">
        BYOK avantajı: ay sonu sürpriz fatura yok. Sen sadece kullandığın kadar provider'a ödersin, RanksUp sabit aylık ücretini alır.
      </Tip>
    </HelpArticle>
  );
}
