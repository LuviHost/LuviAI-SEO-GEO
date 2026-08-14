import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';
import type { IntelTopic } from './source-registry.js';

/**
 * Triage — ucuz eleme katmani.
 *
 * Toplayici gunde yuzlerce yayin getirir; bunlarin buyuk cogunlugu bizi
 * ilgilendirmez ("10 Instagram Reels fikri", is ilanlari, urun tanitimlari).
 * Hepsini pahali modele okutmak hem maliyet hem gurultudur.
 *
 * Bu asama SADECE baslik + feed ozeti uzerinden calisir (tam metin
 * cekilmez), toplu halde ucuz modele sorar ve iki soruyu cevaplar:
 * "bizi ilgilendiriyor mu?" ve "hangi konuda?". Esigi gecenler analiz
 * asamasina devredilir.
 *
 * TRIAGE NOTU KAYDEDILIR: yanlis eleme sessiz bir korluk yaratir; notu
 * saklayarak admin panelde "neden elendi?" denetlenebilir olur.
 */

/** Bir LLM cagrisinda kac kayit degerlendirilir */
const BATCH_SIZE = 20;
/** Bu puanin altindakiler analiz edilmez */
export const RELEVANCE_THRESHOLD = 55;
/** Tek turda islenecek azami kayit — cron'un suresini sinirlar */
const MAX_PER_RUN = Math.max(1, parseInt(process.env.INTEL_TRIAGE_LIMIT ?? '200', 10) || 200);

const FALLBACK_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `Sen RanksUp adli bir GEO/SEO/ASO platformunun arastirma suzgecisin.

RanksUp'in ilgilendigi konular:
- geo: uretken motorlarda (ChatGPT, Perplexity, Gemini, AI Overviews) marka gorunurlugu, atif alma, olcum
- seo: klasik arama siralamasi, algoritma guncellemeleri, indeksleme
- aso: uygulama magazasi optimizasyonu (App Store, Google Play), magaza algoritmasi, metadata
- ai-crawler: AI botlarinin site erisimi, robots.txt, llms.txt, GPTBot/ClaudeBot davranisi, bot engelleme
- schema: yapilandirilmis veri, JSON-LD, zengin sonuclar
- measurement: gorunurluk/trafik olcum metodolojisi, attribution, GA4, referrer kaybi
- agents: ajan tabanli arama, AI tarayicilar, OpenClaw, MCP, agentic commerce
- platform: Google/OpenAI/Anthropic/Apple/Microsoft urun ve politika degisiklikleri

YUKSEK puan ver (75-100):
- Veri iceren calismalar (orneklem, olcum, test sonucu)
- Platform sahibinin resmi aciklamasi veya dokuman degisikligi
- Yaygin bir inanisi dogrulayan ya da CURUTEN bulgular
- Olcum metodolojisi tartismalari

ORTA puan ver (55-74):
- Somut deneyim aktaran vaka anlatimlari
- Ciddi uzman degerlendirmeleri

DUSUK puan ver (0-54):
- Genel tanitim/pazarlama icerigi, "X icin 10 ipucu" listeleri
- Urun reklamlari, is ilanlari, webinar duyurulari
- Konu disi her sey (sosyal medya pazarlamasi, e-posta pazarlamasi, genel girisimcilik)
- Yeni bilgi tasimayan tekrar icerikler

YALNIZCA JSON dizisi dondur, baska metin yazma:
[{"i": 0, "relevance": 85, "topics": ["geo","measurement"], "note": "tek cumle gerekce"}]

Her girdi icin tam olarak bir nesne dondur. topics yalnizca yukaridaki 8 etiketten secilir.`;

interface TriageVerdict {
  i: number;
  relevance: number;
  topics: string[];
  note: string;
}

const VALID_TOPICS = new Set<IntelTopic>([
  'geo', 'seo', 'aso', 'ai-crawler', 'schema', 'measurement', 'agents', 'platform',
]);

@Injectable()
export class IntelTriageService {
  private readonly log = new Logger(IntelTriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
    private readonly settings: SettingsService,
  ) {}

  /** Bekleyen kayitlari toplu halde eler. */
  async runPending(): Promise<{ processed: number; relevant: number }> {
    const pending = await this.prisma.intelItem.findMany({
      where: { status: 'PENDING' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: MAX_PER_RUN,
      select: { id: true, title: true, summary: true, source: { select: { name: true, tier: true } } },
    });

    if (pending.length === 0) return { processed: 0, relevant: 0 };

    // Hatayi SESSIZCE yutma: anahtar katalogda kayitli degilse getRaw firlatir
    // ve fallback'e duseriz. Bu tam olarak yasandi — MODEL_INTEL_TRIAGE
    // katalogda yoktu, app_settings'e yazilan Opus 5 hicbir zaman okunmadi ve
    // triage aylarca Haiku'da kaldi. Log olmadan fark edilmesi imkansizdi.
    const model = (await this.settings.getString('MODEL_INTEL_TRIAGE').catch((err) => {
      this.log.warn(`MODEL_INTEL_TRIAGE okunamadi (${err.message}) — ${FALLBACK_MODEL} kullanilacak`);
      return null;
    }))?.trim() || FALLBACK_MODEL;
    let relevant = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      try {
        relevant += await this.triageBatch(batch, model);
      } catch (err: any) {
        this.log.warn(`Triage partisi basarisiz: ${err.message}`);
        // Parti hatasi kayitlari PENDING birakir — sonraki turda yeniden
        // denenir. FAILED isaretlemiyoruz: gecici LLM hatasi yuzunden
        // yayini kalici olarak kaybetmek, gec islemekten kotudur.
      }
    }

    return { processed: pending.length, relevant };
  }

  private async triageBatch(
    batch: Array<{ id: string; title: string; summary: string | null; source: { name: string; tier: string } }>,
    model: string,
  ): Promise<number> {
    const payload = batch.map((it, idx) => ({
      i: idx,
      source: it.source.name,
      tier: it.source.tier,
      title: it.title,
      summary: (it.summary ?? '').slice(0, 600),
    }));

    const res = await this.llm.chat({
      context: 'intel-triage',
      model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }],
      maxTokens: 3000,
      effort: 'low',
    });

    const verdicts = parseJsonFromLlm<TriageVerdict[]>(res.output);
    if (!Array.isArray(verdicts)) throw new Error('Triage yaniti dizi degil');

    // Indeks → hukum. Model bazi kayitlari atlarsa onlar asagida
    // varsayilan hukumle isaretlenir; PENDING'de asili kalmasinlar.
    const byIndex = new Map<number, TriageVerdict>();
    for (const v of verdicts) {
      if (typeof v?.i === 'number') byIndex.set(v.i, v);
    }

    let relevant = 0;

    for (let idx = 0; idx < batch.length; idx++) {
      const item = batch[idx];
      const v = byIndex.get(idx);

      if (!v) {
        // Model bu kaydi atladi — sessizce elemek yerine insanin
        // gorebilecegi bir not dusuyoruz.
        await this.prisma.intelItem.update({
          where: { id: item.id },
          data: { status: 'IRRELEVANT', relevance: 0, triageNote: 'Triage yanitinda karsiligi yok' },
        });
        continue;
      }

      const relevance = clamp(Math.round(Number(v.relevance) || 0), 0, 100);
      const topics = (Array.isArray(v.topics) ? v.topics : [])
        .filter((t): t is IntelTopic => VALID_TOPICS.has(t as IntelTopic));
      const isRelevant = relevance >= RELEVANCE_THRESHOLD && topics.length > 0;

      await this.prisma.intelItem.update({
        where: { id: item.id },
        data: {
          status: isRelevant ? 'RELEVANT' : 'IRRELEVANT',
          relevance,
          topics: topics as any,
          triageNote: String(v.note ?? '').slice(0, 500),
        },
      });

      if (isRelevant) relevant++;
    }

    return relevant;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
