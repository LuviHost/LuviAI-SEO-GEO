import type { RehberArticle } from './types';
import { SRC } from './sources';

/**
 * Her botun adi ve amaci ureticinin kendi belgesinden (24.10.2026). Bytespider icin
 * ByteDance'in resmi bir belgesi bulunamadi; amaci dogrulanamadigi icin tabloya alinmadi.
 */
export const article: RehberArticle = {
  slug: 'yapay-zeka-botlari-robots-txt',
  title: 'Hangi yapay zekâ botunu robots.txt’de engellemeliyim?',
  metaTitle: 'Yapay zekâ botları ve robots.txt rehberi',
  description:
    'GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended: hangisi ne yapar, hangisini engellemeli? Üç hazır robots.txt örneği.',
  topic: 'Teknik',
  answer:
    'Çoğu site için dengeli seçim, eğitim botlarını engelleyip arama botlarına izin vermektir; çünkü OpenAI, Anthropic ve Perplexity bu işleri ayrı botlara vermiş. Karar senin içerik politikana bağlı; aşağıdaki tablo her botun ne yaptığını üreticinin kendi belgesinden özetliyor.',
  quick: [
    'Arama botları (OAI-SearchBot, Claude-SearchBot, PerplexityBot) asistan cevaplarında kaynak gösterilmeni sağlar.',
    'Eğitim botları (GPTBot, ClaudeBot) içeriğinin model eğitiminde kullanılmasıyla ilgilidir.',
    'Google-Extended ve Applebot-Extended sayfa taramaz; yalnız kullanım iznini belirler. Google Arama ve Siri/Spotlight aramasını etkilemez.',
    'Kullanıcı adına sayfa açan ajanlar (ChatGPT-User, Perplexity-User) için üreticiler robots.txt’nin uygulanmayabileceğini söylüyor.',
    'Değişiklikten sonra sunucu loglarında botların davranışını kontrol et.',
  ],
  sections: [
    {
      id: 'hangi-bot-ne-yapiyor',
      h2: 'Hangi bot ne yapıyor?',
      blocks: [
        { t: 'p', text: 'Tablodaki her bilgi üreticinin kendi belgesinden alındı. “Engellersen” sütunu, üreticinin o botu engellemenin sonucu olarak yazdığı şeydir.' },
        {
          t: 'table',
          caption: 'Yapay zekâ botları ve amaçları (üretici belgelerine göre, 24.10.2026)',
          head: ['Bot (robots.txt adı)', 'Şirket', 'Ne için kullanılıyor?', 'Engellersen ne olur?', 'robots.txt’ye uyuyor mu?'],
          rows: [
            ['GPTBot', 'OpenAI', 'Üretken AI temel modellerinin eğitiminde kullanılabilecek içeriği toplamak', 'İçeriğin model eğitiminde kullanılmaması gerektiğini bildirirsin. Diğer OpenAI ayarları bundan bağımsızdır.', 'robots.txt ile yönetilir'],
            ['OAI-SearchBot', 'OpenAI', 'Siteleri ChatGPT arama özelliklerinde göstermek', 'ChatGPT arama cevaplarında gösterilmezsin; gezinme bağlantısı olarak yine görünebilirsin', 'robots.txt ile yönetilir; değişikliğin yansıması yaklaşık 24 saat'],
            ['ChatGPT-User', 'OpenAI', 'ChatGPT ve Custom GPT’lerde kullanıcının başlattığı işlemler', 'Arama görünürlüğünü belirlemek için kullanılmaz', 'OpenAI: kullanıcı başlattığı için robots.txt kuralları uygulanmayabilir'],
            ['ClaudeBot', 'Anthropic', 'Model eğitimine katkı sağlayabilecek web içeriği toplamak', 'Sitenin gelecekteki içeriği eğitim verisinden çıkarılır', 'Evet; Crawl-delay de destekleniyor'],
            ['Claude-User', 'Anthropic', 'Kullanıcı Claude’a soru sorduğunda sayfaya erişmek', 'Kullanıcı isteğiyle yapılan aramalarda görünürlüğün azalabilir', 'Evet'],
            ['Claude-SearchBot', 'Anthropic', 'Arama sonuçlarının kalitesi için içeriği dizinlemek', 'Arama cevaplarında görünürlüğün ve doğruluğun azalabilir', 'Evet'],
            ['PerplexityBot', 'Perplexity', 'Siteleri Perplexity arama sonuçlarında gösterip bağlamak; temel model eğitimi için değil', 'Perplexity cevaplarında kaynak gösterilmeyebilirsin', 'Perplexity izin verilmesini öneriyor; değişiklik 24 saate kadar yansır'],
            ['Perplexity-User', 'Perplexity', 'Kullanıcının sorusunu cevaplamak için sayfa açmak', 'Etkisi sınırlı olabilir', 'Perplexity: genellikle robots.txt kurallarını yok sayar'],
            ['Google-Extended', 'Google', 'Gemini modellerinin eğitimi ve Gemini uygulamaları ile Vertex AI’daki grounding için içerik kullanımı', 'Google Arama’ya dahil olmayı etkilemez, sıralama sinyali değildir', 'Ayrı tarayıcı değil; yalnız robots.txt belirteci'],
            ['Applebot-Extended', 'Apple', 'Applebot’un topladığı verinin Apple’ın üretken AI temel modellerinin eğitiminde kullanılması', 'Sayfaların Spotlight, Siri ve Safari aramasında kalır; Apple’a göre bu kural arama sıralamasında dikkate alınmaz', 'Sayfa taramaz; yalnız kullanım iznini belirler'],
            ['CCBot', 'Common Crawl', 'Açık web tarama arşivi oluşturmak', 'Common Crawl arşivine girmezsin', 'Common Crawl, engellemek isteyenler için robots.txt kuralını veriyor'],
          ],
          kaynak: ['openai-bots', 'anthropic-bots', 'perplexity-bots', 'google-crawlers', 'applebot', 'ccbot'],
        },
        {
          t: 'p',
          text: 'Apple tarafında bir ayrıntı daha var: Siri ve Spotlight’taki genel bilgi cevaplarında içeriğinin ek bağlam olarak kullanılmasını istemiyorsan Apple, sayfayı nosnippet ile işaretlemeni öneriyor; Apple nosnippet işaretli veriyi bu cevaplarda kullanmıyor.',
          kaynak: ['applebot'],
        },
        {
          t: 'callout',
          title: 'Bytespider neden tabloda yok?',
          text: 'ByteDance’e ait olduğu bildirilen Bytespider için üreticinin resmi bir belgesine ulaşamadık. Amacını doğrulayamadığımız için tabloya almadık. Engellemek istersen aynı biçimde bir User-agent kuralı yazabilir, uyup uymadığını sunucu loglarından kontrol edebilirsin.',
        },
      ],
    },
    {
      id: 'hangi-stratejiyi-secmeliyim',
      h2: 'Hangi stratejiyi seçmeliyim?',
      blocks: [
        {
          t: 'table',
          caption: 'Üç yaygın strateji',
          head: ['Strateji', 'Kime uygun?', 'Sonucu'],
          rows: [
            ['1. Hepsine izin ver', 'İçeriği zaten herkese açık olan ve görünürlüğü en çok önemseyen siteler', 'Hem eğitimde hem asistan aramasında yer alabilirsin'],
            ['2. Eğitimi kapat, aramaya izin ver', 'İçeriğinin model eğitiminde kullanılmasını istemeyen ama cevaplarda kaynak olmak isteyenler', 'Arama tabanlı cevaplarda kaynak olabilirsin; eğitim botları dışarıda kalır'],
            ['3. Hepsini kapat', 'Ücretli, lisanslı ya da hassas içerik sahipleri', 'Asistan cevaplarında kaynak gösterilme ihtimali düşer; kullanıcı ajanları yine gelebilir'],
          ],
        },
        {
          t: 'p',
          text: 'Robots Exclusion Protocol standardı (RFC 9309), bir kural grubunun birden çok User-agent satırıyla başlamasına izin verir ve bot adları büyük-küçük harfe duyarlı eşleşmez. Aşağıdaki örnekler bu yüzden aynı kuralları birkaç bota tek grupta uygular.',
          kaynak: ['rfc9309'],
        },
        {
          t: 'code',
          label: 'Strateji 1: Tüm yapay zekâ botlarına izin ver',
          code: `# Disallow yazılmayan her yol zaten izinlidir.
# Bu grup, izni açıkça belgelemek içindir.
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
Allow: /

Sitemap: https://www.ornek.com/sitemap.xml`,
        },
        {
          t: 'code',
          label: 'Strateji 2: Eğitimi kapat, aramaya izin ver',
          code: `# Eğitim ve eğitim izni belirteçleri
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
Disallow: /

# Arama ve kullanıcı adına erişim
User-agent: OAI-SearchBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
Allow: /

Sitemap: https://www.ornek.com/sitemap.xml`,
        },
        {
          t: 'code',
          label: 'Strateji 3: Bilinen yapay zekâ botlarını kapat',
          code: `User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
Disallow: /`,
        },
        {
          t: 'p',
          text: 'Google-Extended’i engellemek Gemini eğitimini ve Gemini uygulamalarındaki grounding kullanımını kapatır; Google Arama’yı etkilemez. Google Arama’daki AI Bakışı için Google, nosnippet, data-nosnippet, max-snippet ya da noindex gibi arama kontrollerini öneriyor ([AI Bakışı rehberi](/rehber/ai-bakisi-gorunurluk)).',
          kaynak: ['google-crawlers', 'google-ai-features'],
        },
      ],
    },
    {
      id: 'engel-ise-yariyor-mu',
      h2: 'Engellemenin işe yarayıp yaramadığını nasıl kontrol ederim?',
      blocks: [
        { t: 'p', text: 'robots.txt bir rica dosyasıdır; uyup uymamak botun kararıdır. Bu yüzden değişiklikten sonra gerçekte ne olduğunu loglardan kontrol et.' },
        {
          t: 'code',
          label: 'Sunucu erişim logunda yapay zekâ botlarını say (Nginx/Apache)',
          code: `grep -ioE "GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|CCBot" access.log | sort | uniq -c | sort -rn`,
        },
        {
          t: 'ul',
          items: [
            'User-agent taklit edilebilir. OpenAI ve Perplexity botlarının IP listelerini yayımlıyor; Anthropic de botlarının kaynak IP listesini veriyor. Şüpheli bir isteğin IP’sini bu listelerle karşılaştır.',
            'Anthropic, yalnız IP engellemenin kalıcı bir çıkış garantisi vermeyebileceğini, robots.txt kullanılmasını öneriyor.',
            'Cloudflare kullanıyorsan AI Crawl Control, hangi yapay zekâ servislerinin içeriğine eriştiğini gösterir; bot bazında izin ya da engel kuralı koymanı ve robots.txt’ye kimin uyduğunu izlemeni sağlar. Cloudflare’e göre tüm planlarda var.',
          ],
          kaynak: ['openai-bots', 'perplexity-bots', 'anthropic-bots', 'cloudflare-acc'],
        },
        {
          t: 'p',
          text: 'RanksUp’ın Agent Readiness (AXO) taraması robots.txt’deki yapay zekâ bot duruşunu denetler; eksik bot gruplarını mevcut kurallarını koruyarak, önizleyip onayladığında ekler (Profesyonel ve üstü). Ajans planındaki Canlı Tarayıcı, yapay zekâ botlarının canlı akışını gösterir. Kendi botumuzun ne okuduğunu [RanksUpBot sayfasında](/bot) anlattık. Planlar [fiyatlandırma sayfasında](/pricing).',
        },
      ],
    },
    {
      id: 'robots-ve-llms-txt',
      h2: 'robots.txt ile llms.txt aynı şey mi?',
      blocks: [
        { t: 'p', text: 'Hayır. robots.txt hangi botun hangi yola erişebileceğini söyler. llms.txt ise erişim kuralı içermez; sitenin önemli sayfalarını yapay zekâ ajanları için özetleyen isteğe bağlı bir dosyadır. Etkisi hakkında bilinenleri [llms.txt rehberinde](/rehber/llms-txt-nedir) topladık.' },
      ],
    },
  ],
  faq: [
    {
      q: 'GPTBot’u engellersem ChatGPT aramasında görünmez miyim?',
      a: 'Görünmeye devam edebilirsin. OpenAI’ye göre her ayar birbirinden bağımsızdır: GPTBot, içeriğin model eğitiminde kullanılmasıyla ilgilidir. ChatGPT aramasında görünmek için OAI-SearchBot’a izin vermen gerekir; robots.txt değişikliğinin yansıması yaklaşık 24 saat sürebilir.',
    },
    {
      q: 'Google-Extended’i engellersem Google sıralamam düşer mi?',
      a: 'Hayır. Google, Google-Extended’in sitenin Google Arama’ya dahil olmasını etkilemediğini ve sıralama sinyali olarak kullanılmadığını söylüyor.',
    },
    {
      q: 'ChatGPT-User robots.txt’ye uyar mı?',
      a: 'Her zaman değil. OpenAI, bu işlemler kullanıcı tarafından başlatıldığı için robots.txt kurallarının uygulanmayabileceğini yazıyor. Perplexity de Perplexity-User’ın genellikle robots.txt kurallarını yok saydığını söylüyor.',
    },
    {
      q: 'Anthropic botları robots.txt’ye uyuyor mu?',
      a: 'Anthropic, ClaudeBot, Claude-User ve Claude-SearchBot’un robots.txt yönergelerine uyduğunu ve standart dışı Crawl-delay uzantısını desteklediğini söylüyor.',
    },
    {
      q: 'robots.txt değişikliği ne zaman etkili olur?',
      a: 'Botun dosyayı yeniden okumasına bağlıdır. OpenAI, OAI-SearchBot için değişikliğin sistemlerine yansımasının yaklaşık 24 saat sürebileceğini, Perplexity de 24 saate kadar sürebileceğini belirtiyor.',
    },
    {
      q: 'Bytespider’ı neden tabloda göremiyorum?',
      a: 'ByteDance’in Bytespider için yayımladığı resmi bir belgeye ulaşamadık. Doğrulayamadığımız bir amacı yazmak yerine tabloya almadık. Engellemek istersen uyup uymadığını sunucu loglarından kontrol et.',
    },
  ],
  sources: [SRC.openaiBots, SRC.anthropicBots, SRC.perplexityBots, SRC.googleCrawlers, SRC.googleAiFeatures, SRC.appleBot, SRC.ccbot, SRC.rfc9309, SRC.cloudflareAcc],
  related: ['llms-txt-nedir', 'chatgpt-markam-gorunuyor-mu', 'ai-bakisi-gorunurluk'],
  published: '2026-10-24',
  schemaType: 'TechArticle',
};
