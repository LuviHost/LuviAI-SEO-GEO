/**
 * ranksup.ai/robots.txt icerigi (app/robots.txt/route.ts sunar). Next'in
 * MetadataRoute.Robots'u yerine duz metin, cunku `Content-Signal:` gibi ozel
 * direktifleri desteklemiyor ve bizim AXO taramamiz (agent-readiness-checks.ts →
 * content-signals) bunu istiyor. Next importu yok ki API testleri
 * (apps/api/src/audit/ranksup-own-robots.spec.ts) bu dosyayi dogrudan calistirip
 * kendi robots denetimimizden gecirebilsin.
 *
 * AI crawler'lara acikca izin veriyoruz — biz bir AI search optimization sirketiyiz,
 * ChatGPT/Claude/Gemini/Perplexity'in sitemizi taramasi ve cevaplarinda alintilamasi
 * faydali. Eskiden her bot kendi grubunda yalniz `Allow: /` aliyordu; RFC 9309'da
 * isimli grup "*" grubunu MIRAS ALMAZ, yani GPTBot/ClaudeBot /api/, /admin/,
 * /dashboard yasaklarini atliyordu. Simdi AI botlari tek grupta, ayni kurallarla.
 */

const SITE_URL = 'https://ranksup.ai';

/**
 * apps/api/src/audit/known-ai-bots.ts KNOWN_AI_BOTS ile AYNI liste (ayni sira:
 * egitim, AI arama, kullanici-tetikli). Web o pakete bagli degil; sapma
 * ranksup-own-robots.spec.ts'te yakalanir. Eski listedeki 'Claude-Web', 'Mistral',
 * 'DeepSeek' gercek UA degildi.
 */
export const AI_BOTS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot',
  'cohere-ai', 'cohere-training-data-crawler', 'Bytespider', 'Meta-ExternalAgent', 'AI2Bot',
  'Timpibot', 'Omgilibot',
  'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'GoogleOther', 'DuckAssistBot', 'YouBot',
  'Amazonbot', 'Diffbot',
  'ChatGPT-User', 'Claude-User', 'Perplexity-User', 'MistralAI-User', 'Meta-ExternalFetcher',
  'Gemini-Deep-Research',
] as const;

// api.ranksup.ai'de kok yollar bu Next uygulamasina gelir (next.config.ts), yani ayni
// robots.txt orada da sunulur. /api/ yasagi MCP sunucu kartini kayit tarayicilarindan
// sakliyordu; RFC 9309'da en uzun eslesen kural kazanir, bu Allow /api/ yasagini yalniz
// bu adres icin acar.
const ALLOW = ['/', '/api/mcp/server-card'];
const DISALLOW = [
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
];

export function buildRobotsTxt(): string {
  const rules = [...ALLOW.map((p) => `Allow: ${p}`), ...DISALLOW.map((p) => `Disallow: ${p}`)].join('\n');
  return `User-agent: *
${rules}

# AI botlari: egitim, AI arama, kullanici-tetikli. Content-Signal yalniz isimli grupta.
${AI_BOTS.map((name) => `User-agent: ${name}`).join('\n')}
Content-Signal: search=yes, ai-input=yes, ai-train=yes
${rules}

Host: ${SITE_URL}
Sitemap: ${SITE_URL}/sitemap.xml
`;
}
