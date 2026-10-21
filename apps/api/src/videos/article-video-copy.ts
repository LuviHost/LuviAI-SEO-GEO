import type { ChatRequest, ChatResponse } from '../llm/llm.types.js';
import { VIDEO_COPY_CONTEXT, VIDEO_COPY_MODEL } from './article-video.config.js';
import type { CopyKit, ScriptCheck, ShortArticle, ShortScript } from './article-short-kit.js';

/**
 * RanksUp Video — video metni (kanca, 3 madde, CTA).
 *
 * Sira (sahip karari 21.10.2026):
 *  1) Claude Haiku 5.5, yapisal cikti: SCRIPT_JSON_SCHEMA (CLI prototipiyle ayni sema, apps/video
 *     copy.mjs). Kullanicinin aylik AI butcesi dolmussa model HIC cagrilmaz.
 *  2) ZORUNLU koruyucu: validateScript(strict) — metindeki her sayi makalede birebir gecmeli,
 *     uzunluk sinirlari, makalede gecmeyen kelime orani (MAX_NOVEL_RATIO) asilirsa RET.
 *  3) Herhangi bir hata (AI kapali, ret, bozuk JSON, koruyucu reddi) -> cikarimsal yol: makalenin
 *     kendi baslik ve cumleleri secilir; kelime eklenmez, sayi uretilmez. O da koruyucudan
 *     gecmezse video uretilmez (acik Turkce hata, hak iadesi cagiranin isi).
 * Olgu uydurulmaz: model yalniz makale metnini gorur ve CTA adresi modelden alinmaz.
 */

export class VideoCopyError extends Error {
  constructor(public readonly userMessage: string, detail?: string) {
    super(detail ?? userMessage);
  }
}

export interface CopyContext { userId: string; siteId: string; videoId: string }
export interface CopyDeps {
  kit: CopyKit;
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  /** Kullanicinin aylik AI butcesi dolu mu (QuotaService.checkAiCostBudget hardBlock) */
  budgetBlocked?: () => Promise<boolean>;
}
export interface CopyResult {
  script: ShortScript;
  check: ScriptCheck;
  strategy: 'llm' | 'extractive';
  /** LLM yolu neden kullanilmadi / reddedildi (panelde degil, kayitta) */
  llmRejected?: string;
  costUsd: number;
  usage?: ChatResponse['usage'];
}

/** LLM ciktisini al, sablona oturt, kati koruyucudan gecir. Hata -> nedenli Error */
async function llmScript(article: ShortArticle, ctx: CopyContext, deps: CopyDeps): Promise<{ script: ShortScript; check: ScriptCheck; res: ChatResponse }> {
  const res = await deps.chat({
    context: VIDEO_COPY_CONTEXT,
    userId: ctx.userId,
    siteId: ctx.siteId,
    conversationId: ctx.videoId,
    model: VIDEO_COPY_MODEL,
    systemPrompt: deps.kit.SYSTEM_PROMPT,
    messages: [{ role: 'user', content: deps.kit.llmUserContent(article) }],
    // Kisa yapisal cikti; thinking-varsayilan modellerde LLMProviderService tabani yukseltir
    maxTokens: 2048,
    effort: 'low',
    outputSchema: deps.kit.apiSchema(deps.kit.SCRIPT_JSON_SCHEMA),
  });
  if (res.stopReason === 'refusal') throw Object.assign(new Error('model reddetti (refusal)'), { res });
  if (res.stopReason === 'max_tokens') throw Object.assign(new Error('cikti kesildi (max_tokens)'), { res });
  // Yapisal cikti gecerli JSON garantisi verir; onarim (jsonrepair) bilerek YOK — kesik ya da
  // bozuk cikti "onarilip" yarim metinle videoya girmesin, cikarimsal yola dusulsun
  let raw: unknown = null;
  try {
    raw = JSON.parse(res.output);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('JSON cozulemedi'), { res });
  const script = deps.kit.normalizeLlmScript(raw, article);
  const check = deps.kit.validateScript(script, article, { strict: true });
  if (!check.ok) throw Object.assign(new Error(`koruyucu reddetti: ${check.errors.join('; ')}`), { res });
  return { script, check, res };
}

export async function buildVideoCopy(article: ShortArticle, ctx: CopyContext, deps: CopyDeps): Promise<CopyResult> {
  let llmRejected: string | undefined;
  let costUsd = 0;
  let usage: ChatResponse['usage'] | undefined;
  const blocked = deps.budgetBlocked ? await deps.budgetBlocked().catch(() => false) : false;
  if (blocked) {
    llmRejected = 'aylik AI butcesi dolu — model cagrilmadi';
  } else {
    try {
      const r = await llmScript(article, ctx, deps);
      return { script: r.script, check: r.check, strategy: 'llm', costUsd: r.res.costUsd ?? 0, usage: r.res.usage };
    } catch (err: any) {
      // Reddedilen cagri da faturalanir: maliyet kayda gecsin
      costUsd = Number(err?.res?.costUsd ?? 0) || 0;
      usage = err?.res?.usage;
      llmRejected = String(err?.message ?? err).slice(0, 500);
    }
  }
  const script = deps.kit.extractiveScript(article);
  const check = deps.kit.validateScript(script, article);
  if (!check.ok) {
    throw new VideoCopyError(
      'Makaleden video metni çıkarılamadı: yazıda en az üç alt başlık ya da kısa, kendi başına anlaşılır cümle bulunamadı.',
      `cikarimsal koruyucu: ${check.errors.join('; ')}${llmRejected ? ` · LLM: ${llmRejected}` : ''}`,
    );
  }
  return { script, check, strategy: 'extractive', llmRejected, costUsd, usage };
}
