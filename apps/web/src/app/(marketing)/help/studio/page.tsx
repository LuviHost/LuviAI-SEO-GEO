import { Wand2 } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'AI Studio — LuviAI Help' };

export default function Page() {
  return (
    <HelpArticle slug="studio"
      icon={Wand2}
      badge="AI Studio"
      title="Görsel, video, metin — hepsi tek panel"
      intro="Sosyal medyaya postlanacak görseller (DALL-E 3, GPT Image), kısa videolar (Sora 2, Veo 3, Runway), uzun metinler (GPT-4o, Claude Sonnet) — hepsi LuviAI Studio'da."
      steps={[
        { name: 'Site dashboard → Studio', text: 'Sol menü → Sosyal Medya Studio. Üst tab\'larda Görsel / Video / Metin / Sosyal Yayın.' },
        { name: 'Provider seç', text: 'Solda provider listesi (DALL-E 3, Sora 2, Veo 3, GPT-4o vs) fiyat + kalite ile. Birini seç.' },
        { name: 'Prompt yaz + üret', text: 'Sağda prompt + parametreler (boyut, ton, süre). "Üret" butonu — görsel anında, video 1-8 dakika.' },
        { name: 'Kütüphaneye düşer', text: 'Üretilenler sağdaki Kütüphane\'ye kalıcı kaydedilir. Star ile favoriye alabilir, sonra tekrar kullanabilirsin.' },
        { name: 'Sosyal Yayın tab\'ından paylaş', text: 'Studio kütüphanesinden asset seç → metin yaz veya AI ile üret → 5 kanala paylaş (LinkedIn, X, Instagram, TikTok, Facebook).' },
      ]}
    >
      <h2>3 sekme</h2>

      <h3>Görsel — DALL-E 3 / GPT Image</h3>
      <ul>
        <li><strong>DALL-E 3 standard</strong>: $0.04/görsel — günlük post, banner</li>
        <li><strong>DALL-E 3 HD</strong>: $0.08/görsel — ana görseller, marka kartları</li>
        <li><strong>GPT Image</strong>: $0.10/görsel — kompozisyonlu, çoklu element</li>
      </ul>

      <h3>Video — Sora 2 / Veo 3 / Runway / HeyGen / Slideshow</h3>
      <ul>
        <li><strong>SLIDESHOW</strong>: ücretsiz — stok görsel + TTS ses + ffmpeg compose. Hızlı, kalitesi orta.</li>
        <li><strong>Veo 3</strong>: $0.50/8sn — Google'ın yeni nesil video AI'sı, sesli</li>
        <li><strong>Runway Gen-4</strong>: $0.15/saniye — kısa stilize klipler</li>
        <li><strong>HeyGen</strong>: $0.30/dk — avatar konuşan video</li>
        <li><strong>Sora 2</strong>: $0.50-1.00/klip — uzun, foto-gerçekçi (Tier 5 erişim)</li>
      </ul>

      <h3>Metin — GPT-4o / Claude Sonnet 4.6</h3>
      <p>Sosyal post, e-posta, ürün açıklama, başlık önerisi. Ton seçimi (profesyonel, samimi, esprili).</p>

      <h2>Kullanım</h2>
      <Step n={1} title="Site dashboard → Studio">
        Sol menü → <strong>Sosyal Medya Studio</strong>. Üst tab'larda Görsel / Video / Metin / Sosyal Yayın.
      </Step>
      <Step n={2} title="Provider seç + prompt yaz">
        Solda provider listesi (fiyat + kalite ile). Bir tane seç, sağda prompt + parametreler.
      </Step>
      <Step n={3} title="Üret butonu">
        Görsel anında, video 1-8 dakika. Sonuç sağdaki <strong>Kütüphane</strong>'ye düşer (kalıcı saklanır).
      </Step>
      <Step n={4} title="Sosyal Yayın tab'ından yayınla">
        Studio kütüphanesinden asset seç → metin yaz veya seç → 5 kanala paylaş (LinkedIn, X, Instagram, TikTok, Facebook).
      </Step>

      <Tip kind="warn">
        Video üretimi <strong>pahalı</strong> ve plan'a göre kotalı:
        <ul>
          <li>Trial: 0 video</li>
          <li>Başlangıç: 2 video/ay</li>
          <li>Pro: 8 video/ay</li>
          <li>Ajans: 25 video/ay</li>
          <li>Kurumsal: 80 video/ay</li>
        </ul>
        <strong>SLIDESHOW</strong> ücretsiz, hiçbir plan kotasından düşmez.
      </Tip>

      <h2>BYOK — kendi key'inle çalış</h2>
      <p>
        OpenAI key'in varsa GPT Image + DALL-E ücretsiz (sınırsız, sadece OpenAI'ye ödersin).
        Anthropic key'in varsa Claude Sonnet metinler kotandan düşmez.
        <a href="/help/api-keys">API Keys rehberini oku</a>.
      </p>

      <Tip kind="success">
        Studio kütüphanesi <strong>kalıcı</strong> — ürettiğin her asset DB'de kalır. Star ile favoriye al, sonra tekrar kullan.
      </Tip>
    </HelpArticle>
  );
}
