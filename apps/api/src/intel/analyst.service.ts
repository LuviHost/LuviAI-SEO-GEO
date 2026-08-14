import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ClaimLedgerService, type ExtractedClaim } from './claim-ledger.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';
import { GRADE_SCORE, type EvidenceGrade, type EvidenceStance } from './evidence-grade.js';
import type { IntelTopic } from './source-registry.js';

/**
 * Analist — triage'i gecen yayini OKUR ve iddia/kanit cikarir.
 *
 * Bu asama pahali oldugundan yalnizca alakali kayitlara uygulanir ve
 * tam metin cekilir; feed ozeti "137 bin site incelendi" gibi kritik
 * metodoloji detaylarini cogu zaman icermez, oysa kanit tartimi tam da
 * o detaya bakar.
 *
 * IDDIA EŞLEME: ayni gercek farkli yazilarda farkli cumlelerle anlatilir.
 * Yeni her yayin icin yeni iddia acarsak defter dagilir ve hicbir iddia
 * yeterli kanit toplayamaz. Bu yuzden modele MEVCUT iddialarin listesi
 * verilir ve once eslestirmesi, ancak hicbiri tutmuyorsa yeni iddia
 * acmasi istenir.
 */

/**
 * Bir turda kac yayin analiz edilir — boru hattinin en pahali ucundaki
 * maliyet freni. Gunde TEK tur calistigi icin bu ayni zamanda gunluk
 * tavandir. INTEL_ANALYZE_LIMIT ile deploy beklemeden degistirilebilir.
 */
const MAX_PER_RUN = Math.max(1, parseInt(process.env.INTEL_ANALYZE_LIMIT ?? '30', 10) || 30);
/** Modele gonderilecek tam metin ust siniri */
const MAX_TEXT_CHARS = 18_000;
/** Esleme icin prompt'a konulacak mevcut iddia sayisi */
const CLAIM_CONTEXT_LIMIT = 60;
const FETCH_TIMEOUT_MS = 20_000;
const FALLBACK_MODEL = 'claude-opus-5';
const UA = 'Mozilla/5.0 (compatible; RanksUpIntel/1.0; +https://ranksup.ai/bot)';

/** RanksUp'in bulgudan etkilenebilecek yuzeyleri */
export const PRODUCT_AREAS = [
  'citation-scoring',    // atif olcumu ve gorunurluk skoru
  'agent-readiness',     // llms.txt, robots.txt, crawler erisimi denetimi
  'prompt-lab',          // sorgu seti ve olcum metodolojisi
  'content-opportunity', // icerik firsati turetme
  'crawler-analytics',   // bot ziyaret analitigi
  'aso-tracker',         // uygulama magazasi takibi
  'schema-generator',    // yapilandirilmis veri uretimi
  'action-plans',        // musteriye verilen eylem onerileri
  'positioning',         // urun konumlandirmasi ve satis soylemi
] as const;

const VALID_GRADES = new Set<EvidenceGrade>(Object.keys(GRADE_SCORE) as EvidenceGrade[]);
const VALID_STANCES = new Set<EvidenceStance>(['supports', 'refutes', 'mixed']);
const VALID_AREAS = new Set<string>(PRODUCT_AREAS);
const VALID_TOPICS = new Set<IntelTopic>([
  'geo', 'seo', 'aso', 'ai-crawler', 'schema', 'measurement', 'agents', 'platform',
]);

const SYSTEM_PROMPT = `Sen RanksUp adli GEO/SEO/ASO platformunun kanit analistisin. Gorevin bir yaziyi okuyup icindeki DOGRULANABILIR IDDIALARI cikarmak ve her birinin arkasindaki kanitin cinsini belirlemek.

Bir iddia; test edilebilir, dogru ya da yanlis olabilecek bir onermedir.
IYI: "llms.txt dosyalari buyuk AI saglayicilarin urun tarafinda okunmuyor."
KOTU: "llms.txt onemlidir." (olculemez)
KOTU: "Yazar llms.txt'yi tartisiyor." (iddia degil, ozet)

Her iddia icin kanit cinsini (grade) belirle:
- official-doc: platform sahibinin (Google/OpenAI/Apple/Microsoft/Anthropic) kendi dokumani veya duyurusu
- large-n-study: buyuk orneklemli (N>=1000) veri calismasi; sampleSize alanini MUTLAKA doldur
- controlled-test: A/B veya oncesi-sonrasi karsilastirmasi, degisken izole edilmis
- case-study: tek vaka, sonuc var ama kontrol grubu yok
- expert-opinion: taninmis birinin veri sunmadan degerlendirmesi
- anecdote: forum/tekil kullanici deneyimi
- speculation: dayanaksiz iddia, cogu zaman satis amacli

Yazinin iddiaya karsi tutumu (stance):
- supports: yazi iddiayi destekliyor
- refutes: yazi iddiayi curutuyor
- mixed: kismen dogruluyor, kosullu

KRITIK KURALLAR:
1. grade'i yazinin KENDI kanit gucune gore ver, yazarin iddia ettigi kesinlige gore degil. Ajans blogu "arastirmalar gosteriyor ki" diyorsa ve veri yoksa bu speculation'dir.
2. large-n-study yalnizca yazi gercek bir orneklem sayisi veriyorsa kullanilir.
3. quote alanina iddiayi dayandiran BIREBIR alintiyi koy (ceviri yapma, orijinal dilde birak). Alinti bulamiyorsan o iddiayi cikarma.
4. Mevcut iddialar listesi verildi: yeni yazi bunlardan birini konu ediyorsa AYNI slug'i kullan. Ayni gercek icin yeni slug acma.
5. Yazida dogrulanabilir iddia yoksa bos dizi dondur.
6. En fazla 4 iddia cikar — yazinin en onemli olanlarini sec.

YALNIZCA JSON dondur:
{"claims":[{"slug":"kisa-kebab-slug","statement":"tek cumlelik kanonik iddia (Turkce)","topics":["geo"],"stance":"refutes","grade":"large-n-study","sampleSize":137000,"quote":"birebir alinti","productAreas":["agent-readiness"]}]}

productAreas su listeden secilir: ${PRODUCT_AREAS.join(', ')}
topics su listeden secilir: geo, seo, aso, ai-crawler, schema, measurement, agents, platform`;

@Injectable()
export class IntelAnalystService {
  private readonly log = new Logger(IntelAnalystService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
    private readonly settings: SettingsService,
    private readonly ledger: ClaimLedgerService,
  ) {}

  async runRelevant(): Promise<{ analyzed: number; claims: number; failed: number }> {
    const items = await this.prisma.intelItem.findMany({
      where: { status: 'RELEVANT' },
      // Yuksek alaka once — butce biterse en degerliler islenmis olur
      orderBy: [{ relevance: 'desc' }, { publishedAt: 'desc' }],
      take: MAX_PER_RUN,
      select: {
        id: true, url: true, title: true, summary: true, publishedAt: true, topics: true,
        fullText: true,
        source: { select: { name: true, tier: true, weight: true } },
      },
    });

    if (items.length === 0) return { analyzed: 0, claims: 0, failed: 0 };

    // Bkz. triage.service.ts — ayni sessiz yutma kalibi orada model secimini
    // aylarca yanlis tutmustu. Fallback kalsin ama gorunur olsun.
    const model = (await this.settings.getString('MODEL_INTEL_ANALYST').catch((err) => {
      this.log.warn(`MODEL_INTEL_ANALYST okunamadi (${err.message}) — ${FALLBACK_MODEL} kullanilacak`);
      return null;
    }))?.trim() || FALLBACK_MODEL;
    let analyzed = 0;
    let claims = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const n = await this.analyzeItem(item, model);
        claims += n;
        analyzed++;
      } catch (err: any) {
        failed++;
        this.log.warn(`Analiz hatasi (${item.url}): ${err.message}`);
        await this.prisma.intelItem.update({
          where: { id: item.id },
          data: { status: 'FAILED', triageNote: String(err.message).slice(0, 500) },
        });
      }
    }

    return { analyzed, claims, failed };
  }

  private async analyzeItem(
    item: {
      id: string; url: string; title: string; summary: string | null;
      publishedAt: Date | null; topics: any; fullText: string | null;
      source: { name: string; tier: string; weight: number };
    },
    model: string,
  ): Promise<number> {
    // TOPLAMA ANINDA METIN VARSA ONU KULLAN, yeniden cekme.
    //
    // OpenClaw postu ve yanitlarini tarayicida zaten okuyor. x.com'u
    // oturumsuz yeniden cekmek bos JS kabugu donduruyor (olculdu: 0
    // karakter) — sonra ozete dusuyor, 200 karakter esigini gecemeyince
    // kayit FAILED oluyordu. Yani X postlari analize hic giremiyordu.
    //
    // Diger kaynaklarda (rss/github/hn/reddit) bu alan bos gelir ve
    // eski davranis aynen surer.
    // Kisa olsa bile yeniden CEKMIYORUZ: toplayici icerigi zaten okuduysa
    // ikinci istek yeni bilgi getirmez (x.com'da hic getirmiyor). Kisa metin
    // asagidaki esikte elenir — bu dogru sonuc, cunku 150 karakterlik bir
    // postan dogrulanabilir iddia cikmaz.
    const stored = item.fullText?.trim();
    const fullText = stored
      ? stored
      : (await this.fetchArticleText(item.url).catch(() => null)) ?? item.summary ?? '';
    if (fullText.trim().length < 200) {
      await this.prisma.intelItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          triageNote: stored
            ? `Icerik cok kisa (${stored.length} karakter) — iddia cikarilamaz`
            : 'Metin cekilemedi veya cok kisa',
        },
      });
      return 0;
    }

    const topics = Array.isArray(item.topics) ? (item.topics as string[]) : [];
    const existing = await this.ledger.claimContext(topics, CLAIM_CONTEXT_LIMIT);

    const userContent = [
      `KAYNAK: ${item.source.name} (katman: ${item.source.tier})`,
      `BASLIK: ${item.title}`,
      `URL: ${item.url}`,
      `YAYIN TARIHI: ${item.publishedAt?.toISOString().slice(0, 10) ?? 'bilinmiyor'}`,
      '',
      existing.length > 0
        ? `MEVCUT IDDIALAR (eslesme varsa ayni slug'i kullan):\n${existing.map((c) => `- ${c.slug}: ${c.statement}`).join('\n')}`
        : 'MEVCUT IDDIALAR: (defter bos)',
      '',
      'METIN:',
      fullText.slice(0, MAX_TEXT_CHARS),
    ].join('\n');

    const res = await this.llm.chat({
      context: 'intel-analyst',
      conversationId: item.id,
      model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4000,
      effort: 'medium',
      cacheSystemPrompt: true,
    });

    const parsed = parseJsonFromLlm<{ claims?: any[] }>(res.output);
    const rawClaims = Array.isArray(parsed?.claims) ? parsed.claims : [];
    const valid = rawClaims.map(sanitizeClaim).filter((c): c is ExtractedClaim => c !== null);

    await this.prisma.intelItem.update({
      where: { id: item.id },
      data: { status: 'ANALYZED', fullText: fullText.slice(0, 60_000) },
    });

    if (valid.length === 0) return 0;

    await this.ledger.record(item.id, valid, {
      sourceWeight: item.source.weight,
      publishedAt: item.publishedAt,
    });

    return valid.length;
  }

  /**
   * Sayfanin okunabilir govdesini cikarir. Tam bir readability portu
   * degil: navigasyon/script/yorum blogunu atip <article>/<main>
   * tercih eden pratik bir sadelestirme — LLM'e temiz metin gitmesi
   * icin yeterli.
   */
  private async fetchArticleText(url: string): Promise<string | null> {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('html')) return null;

    const html = await res.text();
    const $ = load(html);
    $('script, style, nav, header, footer, aside, form, noscript, iframe, .comments, #comments').remove();

    const root = $('article').first().length
      ? $('article').first()
      : $('main').first().length
        ? $('main').first()
        : $('body');

    return root.text().replace(/\s+/g, ' ').trim() || null;
  }
}

/**
 * Model ciktisini dogrula. Gecersiz grade/stance ile gelen bir kanit
 * skorlamayi sessizce bozar (bilinmeyen grade puani 0 sayilir ve iddia
 * hep EMERGING kalir), o yuzden burada eleniyor.
 */
function sanitizeClaim(raw: any): ExtractedClaim | null {
  const slug = slugify(String(raw?.slug ?? ''));
  const statement = String(raw?.statement ?? '').trim();
  const grade = String(raw?.grade ?? '') as EvidenceGrade;
  const stance = String(raw?.stance ?? '') as EvidenceStance;
  const quote = String(raw?.quote ?? '').trim();

  if (!slug || statement.length < 10) return null;
  if (!VALID_GRADES.has(grade) || !VALID_STANCES.has(stance)) return null;
  // Alinti sarti: kanit zincirinin denetlenebilir olmasi icin
  if (quote.length < 10) return null;

  const topics = (Array.isArray(raw?.topics) ? raw.topics : [])
    .filter((t: any): t is IntelTopic => VALID_TOPICS.has(t));
  const productAreas = (Array.isArray(raw?.productAreas) ? raw.productAreas : [])
    .filter((a: any) => typeof a === 'string' && VALID_AREAS.has(a));

  const n = Number(raw?.sampleSize);
  const sampleSize = Number.isFinite(n) && n > 0 ? Math.round(n) : null;

  return {
    slug,
    statement: statement.slice(0, 500),
    topics,
    productAreas,
    grade,
    stance,
    quote: quote.slice(0, 1500),
    sampleSize,
  };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
