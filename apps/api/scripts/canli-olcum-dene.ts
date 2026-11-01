/**
 * Canli olcum dumani — Grok ve DeepSeek'in olcumde GERCEKTEN web'de aradigini
 * dogrular (CITATION_MATCH_VERSION 5). Yalniz bu iki saglayiciyi, tek soruyla,
 * olcum servisinin kendi koduyla (runPublicProbes) cagirir. DB'ye YAZMAZ
 * (sahte prisma), anahtar YAZDIRMAZ. Maliyet: ~0,15 USD'nin altinda.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/canli-olcum-dene.ts
 *   npx tsx scripts/canli-olcum-dene.ts "Soru metni" ornek.com "Marka"
 *
 * Beklenen: iki saglayici da "olculdu"; Grok'ta kaynak sayisi > 0 (url_citation),
 * DeepSeek ham cevabinda server_tool_use / web_search_tool_result bloklari.
 */
// dotenv once: @luviai/shared sifreleme anahtarini modul yuklenirken okur
import 'dotenv/config';
import { AiCitationService } from '../src/audit/ai-citation.service.js';

const [, , soru = 'Mevduat faizi nasıl hesaplanır?', host = 'kobipratik.com', marka = 'KobiPratik'] = process.argv;

// Yalniz Grok + DeepSeek: digerleri bu calismada "anahtar yok" sayilir
for (const k of ['ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'GROQ_API_KEY']) delete process.env[k];

async function deepseekHamBloklar(): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return 'DEEPSEEK_API_KEY yok';
  const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_CITATION_MODEL ?? 'deepseek-v4-pro',
      max_tokens: 1500,
      messages: [{ role: 'user', content: soru }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return `HTTP ${res.status}`;
  const data: any = await res.json();
  const tipler = (Array.isArray(data?.content) ? data.content : []).map((b: any) => b?.type);
  return tipler.join(', ') || '(bos)';
}

async function main() {
  const prisma = { $executeRawUnsafe: async () => 1 };
  const svc = new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
  const out = await svc.runPublicProbes({ brand: marka, host, queries: [soru] });
  for (const r of out.filter((x) => x.provider === 'xai' || x.provider === 'deepseek')) {
    const p = r.probes[0];
    console.log(`\n== ${r.label}: ${r.available ? 'olculdu' : `OLCULEMEDI (${r.reason})`}`);
    if (!p) continue;
    console.log(`  alinti: ${p.cited ? 'evet' : 'hayir'} · marka anildi: ${p.brandMentioned ? 'evet' : 'hayir'}`);
    console.log(`  kaynak sayisi: ${Array.isArray(p.sources) ? p.sources.length : 'liste yok'}`);
    if (Array.isArray(p.sources)) for (const s of p.sources.slice(0, 5)) console.log(`    - ${s.domain}`);
    console.log(`  cevap: ${(p.excerpt ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  console.log(`\n== DeepSeek ham blok tipleri: ${await deepseekHamBloklar()}`);
}

main().catch((err) => {
  console.error(String(err?.message ?? err).slice(0, 300));
  process.exitCode = 1;
});
