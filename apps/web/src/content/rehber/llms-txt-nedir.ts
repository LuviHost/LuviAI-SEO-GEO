import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Urun bilgisi kodla dogrulandi (24.10.2026): llms_txt site denetiminin 14 genel skor
 * kontrolunden biri (api audit-checks.service.ts OVERALL_SCORE_WEIGHTS; web lib/compare-notes.ts).
 */
export const article: RehberArticle = {
  slug: 'llms-txt-nedir',
  title: 'llms.txt gerçekte ne işe yarar?',
  metaTitle: 'llms.txt nedir, gerçekten işe yarar mı?',
  description:
    'llms.txt nedir, kim önerdi, Google ve yapay zekâ asistanları kullanıyor mu? Kanıtlar, ne zaman işe yarayabileceği, nasıl yazılacağı ve önceliği.',
  topic: 'Teknik',
  answer:
    'llms.txt, sitenin özetini yapay zekâ ajanlarına Markdown biçiminde veren isteğe bağlı bir dosyadır; arama görünürlüğüne etkisi bugün kanıtlanmış değildir. Google, Arama’nın bu dosyayı yok saydığını açıkça söylüyor; bu yüzden önceliği düşük.',
  quick: [
    'Jeremy Howard 3 Eylül 2024’te önerdi. Bir öneridir; robots.txt gibi bir standart değildir.',
    'Google: Arama bu dosyaları yok sayar; AI özelliklerinde görünmek için gerekmez, zararı da yoktur.',
    'OpenAI ve Anthropic’in bot belgelerinde botların llms.txt okuduğuna dair bir açıklama yok.',
    'SE Ranking’in yaklaşık 300 bin alan adı analizinde llms.txt ile alıntılanma arasında ölçülebilir ilişki çıkmadı.',
    'Öncelik: düşük. Önce bot erişimi, dizine eklenme ve soruya cevap veren içerik.',
  ],
  sections: [
    {
      id: 'llms-txt-nedir-kim-onerdi',
      h2: 'llms.txt nedir, kim önerdi?',
      blocks: [
        {
          t: 'p',
          text: 'llms.txt’yi Jeremy Howard 3 Eylül 2024’te önerdi. Amaç, yapay zekâ ajanlarının bir siteyi kullanmasına yardım edecek bilgiyi tek bir dosyada toplamaktır. Dosya sitenin kökünde (/llms.txt) ya da bir alt yolda (örneğin /docs/llms.txt) durabilir.',
          kaynak: ['llmstxt'],
        },
        { t: 'p', text: 'robots.txt’den farkı şudur: robots.txt erişim kuralı koyar, llms.txt ise yalnızca önemli sayfaların kısa bir haritasını verir. Hiçbir bota “gir” ya da “girme” demez.' },
      ],
    },
    {
      id: 'google-kullaniyor-mu',
      h2: 'Google llms.txt kullanıyor mu?',
      blocks: [
        {
          t: 'p',
          text: 'Hayır. Google’ın 10 Temmuz 2026’da güncellenen AI optimizasyon rehberine göre Google Arama’da görünmek için yeni makine-okunur dosyalar, AI metin dosyaları, işaretleme ya da Markdown oluşturmak gerekmiyor. Rehber, llms.txt dosyası oluşturmanın sorun olmadığını ama Arama’da görünürlüğe ve sıralamaya ne yardım ne zarar edeceğini, çünkü Google Arama’nın bu dosyaları yok saydığını söylüyor.',
          kaynak: ['google-ai-guide'],
        },
        {
          t: 'p',
          text: 'Google’ın AI özellikleri sayfası da aynı yönde: AI Bakışı ya da AI Modu’nda görünmek için ek bir şart ya da özel optimizasyon yok.',
          kaynak: ['google-ai-features'],
        },
        {
          t: 'h3',
          text: 'Peki Lighthouse neden llms.txt’yi kontrol ediyor?',
        },
        {
          t: 'p',
          text: 'Chrome’un Lighthouse aracında “agentic browsing” denetimleri arasında bir llms.txt kontrolü var. Bu kontrol, dosya istenirken sunucu hatası oluşursa uyarı verir. Dosya yoksa (404) sonuç “uygulanamaz” sayılır, çünkü dosya şimdilik isteğe bağlıdır. Lighthouse bir sayfa denetim aracıdır; bu denetimin belgesinde Google sıralamasıyla ilgili bir ifade yok.',
          kaynak: ['lighthouse-llms'],
        },
      ],
    },
    {
      id: 'openai-anthropic-okuyor-mu',
      h2: 'OpenAI ve Anthropic llms.txt okuyor mu?',
      blocks: [
        {
          t: 'p',
          text: 'Birincil bir açıklama bulamadık. OpenAI’nin bot belgesi botların llms.txt okuyup okumadığından söz etmiyor. Anthropic’in tarayıcı sayfasında llms.txt hiç geçmiyor. “Destekliyorlar” iddiaları üçüncü taraf sayfalarda; üreticinin kendisinden doğrulanmış değil.',
          kaynak: ['openai-bots', 'anthropic-bots'],
        },
        {
          t: 'p',
          text: 'İlginç bir ayrıntı: OpenAI’nin geliştirici belgeleri kendi belge dizini için bir llms.txt yayımlıyor. Bu, dosyanın belge siteleri için kullanışlı bir dizin olarak görüldüğünü gösterir; botların arama ya da alıntı için kullandığı anlamına gelmez.',
          kaynak: ['openai-bots'],
        },
      ],
    },
    {
      id: 'etkisi-olculdu-mu',
      h2: 'llms.txt’nin etkisi ölçüldü mü?',
      blocks: [
        {
          t: 'p',
          text: 'SE Ranking yaklaşık 300 bin alan adını inceledi. Search Engine Journal’ın 20 Kasım 2025 tarihli haberine göre llms.txt ile alan adının büyük dil modeli cevaplarında ne sıklıkla kaynak gösterildiği arasında ölçülebilir bir ilişki bulunmadı. İncelenen alan adlarının %10,13’ünde llms.txt vardı.',
          kaynak: ['sej-llms'],
        },
        { t: 'p', text: 'Bu bir ilişki (korelasyon) analizidir ve bir yıl öncesine aittir. Asistanlar dosyayı ileride kullanmaya başlarsa sonuç değişebilir.' },
      ],
    },
    {
      id: 'ne-zaman-ise-yarar',
      h2: 'llms.txt ne zaman yine de işe yarayabilir?',
      blocks: [
        {
          t: 'ul',
          items: [
            '**Belge ve API siteleri:** Kod asistanları ve ajanlar doğru belge sayfasını daha hızlı bulabilir.',
            '**Ajan ziyaretleri:** Siteni ziyaret eden bir ajan, hangi sayfaların önemli olduğunu tek yerde görür.',
            '**Maliyeti düşük:** Tek bir metin dosyasıdır ve Google’a göre Arama’ya zararı yoktur.',
          ],
        },
        {
          t: 'p',
          text: 'Biz de [ranksup.ai/llms.txt](https://ranksup.ai/llms.txt) dosyasını yayımlıyoruz; ürünü ajanlara doğru anlatmak için. Ama bunu bir sıralama aracı olarak görmüyoruz. RanksUp’ın site denetimindeki 14 kontrolden biri llms.txt’dir; dosya yoksa bunu bir eksik olarak gösterir.',
        },
      ],
    },
    {
      id: 'nasil-yazilir',
      h2: 'llms.txt nasıl yazılır?',
      blocks: [
        {
          t: 'p',
          text: 'Öneriye göre dosya Markdown’dır ve bölümler şu sırayla gelir: sitenin adını taşıyan bir H1 başlığı (tek zorunlu bölüm), kısa bir özet alıntısı (blockquote), isteğe bağlı açıklama paragrafları, bağlantı listeleri içeren H2 bölümleri ve gerektiğinde atlanabilecek bağlantılar için “Optional” başlıklı bir bölüm.',
          kaynak: ['llmstxt'],
        },
        {
          t: 'code',
          label: 'Örnek llms.txt',
          code: `# Örnek Muhasebe

> Örnek Muhasebe, KOBİ’ler için bulut muhasebe yazılımıdır. Fatura, stok ve e-defter tek panelde.

## Ürün
- [Özellikler](https://www.ornek.com/ozellikler): Fatura, stok, e-defter
- [Fiyatlar](https://www.ornek.com/fiyatlar): Planlar ve deneme koşulları

## Yardım
- [Kurulum rehberi](https://www.ornek.com/yardim/kurulum)

## Optional
- [Blog](https://www.ornek.com/blog)`,
        },
        { t: 'p', text: 'Dosyayı güncel tut. Eski fiyat ya da kaldırılmış bir özellik taşıyan bir özet, hiç olmamasından daha çok kafa karıştırabilir.' },
      ],
    },
    {
      id: 'onerimiz',
      h2: 'llms.txt’ye ne kadar zaman ayırmalıyım?',
      blocks: [
        {
          t: 'table',
          caption: 'Öncelik sırası önerimiz',
          head: ['İş', 'Öncelik', 'Neden?'],
          rows: [
            ['Yapay zekâ arama botlarına erişim izni', 'Yüksek', 'Erişemeyen bot sayfanı kaynak gösteremez ([botlar rehberi](/rehber/yapay-zeka-botlari-robots-txt))'],
            ['Dizine eklenme ve snippet uygunluğu', 'Yüksek', 'Google AI özellikleri için tek şart'],
            ['Soruya doğrudan cevap veren sayfalar', 'Yüksek', 'Asistanlar cevabı bu sayfalardan derler'],
            ['Düzenli ölçüm', 'Orta', 'Neyin işe yaradığını ancak ölçerek görürsün ([test yöntemi](/rehber/chatgpt-markam-gorunuyor-mu))'],
            ['llms.txt', 'Düşük', 'Zararsız ve ucuz; etkisi kanıtlanmamış'],
          ],
          kaynak: ['google-ai-features'],
        },
      ],
    },
  ],
  faq: [
    {
      q: 'llms.txt olmazsa yapay zekâ sitemi okuyamaz mı?',
      a: 'Okuyabilir. Botlar sayfaları normal HTML olarak tarar. Google, AI özelliklerinde görünmek için böyle bir dosyanın gerekmediğini açıkça söylüyor.',
    },
    {
      q: 'llms.txt robots.txt’nin yerine geçer mi?',
      a: 'Hayır. robots.txt hangi botun neye erişebileceğini söyler. llms.txt erişim kuralı içermez; yalnızca önemli sayfaların özetini ve bağlantılarını verir.',
    },
    {
      q: 'llms.txt eklemek zarar verir mi?',
      a: 'Google’a göre Arama’daki görünürlüğü artırmaz ya da azaltmaz. Dosya istenirken sunucu hatası oluşuyorsa Lighthouse bunu bir sorun olarak işaretler; dosyayı ya düzgün yayınla ya hiç yayınlama.',
    },
    {
      q: 'llms-full.txt nedir?',
      a: 'Bazı sitelerin llms.txt’nin yanında yayımladığı, içeriği tek ve uzun bir Markdown dosyasında toplayan dosyadır. Etkisi hakkında bağımsız bir ölçüm görmedik.',
    },
    {
      q: 'ChatGPT llms.txt dosyamı okuyor mu?',
      a: 'OpenAI’nin bu konuda birincil bir açıklaması yok; bot belgesi botların llms.txt okuyup okumadığından söz etmiyor. Sunucu loglarında /llms.txt isteklerine bakarak dosyayı hangi botların istediğini görebilirsin.',
    },
    {
      q: 'llms.txt’yi ne sıklıkla güncellemeliyim?',
      a: 'Önemli sayfalar, fiyatlar ya da ürün bilgisi her değiştiğinde. Eski bilgi taşıyan bir özet, hiç olmamasından daha çok kafa karıştırabilir.',
    },
  ],
  sources: [SRC.llmstxt, SRC.googleAiGuide, SRC.googleAiFeatures, SRC.lighthouseLlms, SRC.sejLlms, SRC.openaiBots, SRC.anthropicBots],
  related: ['yapay-zeka-botlari-robots-txt', 'geo-nedir', 'ai-bakisi-gorunurluk'],
  published: '2026-10-24',
  schemaType: 'TechArticle',
};
