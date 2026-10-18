import type { MetadataRoute } from 'next';

const SITE_URL = 'https://ranksup.ai';

/**
 * AI crawler'lara açıkça izin veriyoruz — biz bir AI search optimization
 * şirketiyiz, ChatGPT/Claude/Gemini/Perplexity'in sitemizi taraması ve
 * cevaplarında alıntılaması faydalı.
 *
 * /api, /admin, /onboarding gibi backend yolları indekslenmesin.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // api.ranksup.ai'de kok yollar bu Next uygulamasina gelir (next.config.ts), yani
        // ayni robots.txt orada da sunulur. /api/ yasagi MCP sunucu kartini kayit
        // tarayicilarindan sakliyordu; RFC 9309'da en uzun eslesen kural kazanir, bu
        // Allow /api/ yasagini yalniz bu adres icin acar.
        allow: ['/', '/api/mcp/server-card'],
        disallow: [
          '/api/',
          '/admin/',
          '/admin-unlock',
          '/onboarding',
          '/sites/',
          '/dashboard',
          '/billing',
          '/affiliate',
          '/api-keys',
          '/agency',
        ],
      },
      // AI search crawler'lar — açıkça izin
      { userAgent: 'GPTBot',          allow: '/' },
      { userAgent: 'OAI-SearchBot',   allow: '/' },
      { userAgent: 'ChatGPT-User',    allow: '/' },
      { userAgent: 'ClaudeBot',       allow: '/' },
      { userAgent: 'Claude-Web',      allow: '/' },
      { userAgent: 'PerplexityBot',   allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'Bytespider',      allow: '/' },
      { userAgent: 'Amazonbot',       allow: '/' },
      { userAgent: 'CCBot',           allow: '/' },
      { userAgent: 'YouBot',          allow: '/' },
      { userAgent: 'cohere-ai',       allow: '/' },
      { userAgent: 'DuckAssistBot',   allow: '/' },
      { userAgent: 'Meta-ExternalAgent', allow: '/' },
      { userAgent: 'Mistral',         allow: '/' },
      { userAgent: 'DeepSeek',        allow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
