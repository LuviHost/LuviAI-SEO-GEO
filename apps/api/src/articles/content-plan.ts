import {
  contentTypeFromSchemaType,
  normalizeContentType,
  resolveContentType,
  type ContentType,
  type ContentTypeDecision,
  type ContentTypeSource,
} from '@luviai/shared';

/**
 * Yazinin icerik tipi (rehber / karsilastirma / en iyi / alternatifler / fiyat /
 * nasil / liste) nereden gelir ve nerede saklanir.
 *
 * Yeni kolon YOK (migration yok): tip mevcut JSON alanlarinda tasinir.
 *  - Acik secim: Article.agentOutputs.contentPlan = { type, source: 'explicit' }
 *    (panel / API "contentType" verdiyse; yer tutucu kayitta yazilir, hat sonunda
 *    agentOutputs yeniden yazilirken ayni kararla korunur).
 *  - Siralayici: TopicQueue tier listelerindeki konu nesnesinin content_type
 *    (yeni) ya da schema_type (eski) alani. Konu takvime alinirken karar kayda
 *    da yazilir ({ type, source: 'ranker' }): uretim gunune kadar yeni bir kuyruk
 *    eskisinin yerini alsa da ipucu kaybolmaz.
 *  - Baslik siniflandiricisi ve varsayilan 'guide' (@luviai/shared resolveContentType).
 *
 * Oncelik: acik > siralayici > siniflandirici > guide.
 */

export const CONTENT_PLAN_KEY = 'contentPlan';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Kayittaki karar. Yalniz 'explicit' ve 'ranker' kaynakli karar okunur;
 * siniflandirici / varsayilan karari her uretimde yeniden verilir.
 */
export function readStoredContentPlan(agentOutputs: unknown): ContentTypeDecision | null {
  const plan = asRecord(asRecord(agentOutputs)[CONTENT_PLAN_KEY]);
  if (plan.source !== 'explicit' && plan.source !== 'ranker') return null;
  const type = normalizeContentType(plan.type);
  return type ? { type, source: plan.source } : null;
}

/** agentOutputs'a karar eklenmis kopyasi (diger anahtarlar korunur). Karar yoksa girdi aynen doner. */
export function withContentPlan(agentOutputs: unknown, decision: ContentTypeDecision | null): Record<string, unknown> | null {
  const base = agentOutputs == null ? null : asRecord(agentOutputs);
  if (!decision) return base;
  return { ...(base ?? {}), [CONTENT_PLAN_KEY]: { type: decision.type, source: decision.source } };
}

/** Acik secilmis tip (gecersizse null) */
export function explicitContentPlan(type: unknown): ContentTypeDecision | null {
  const t = normalizeContentType(type);
  return t ? { type: t, source: 'explicit' satisfies ContentTypeSource } : null;
}

/** Konu basliklarini karsilastirmak icin: buyuk/kucuk harf ve bosluk farki yok sayilir */
function topicKey(s: unknown): string {
  return typeof s === 'string' ? s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim() : '';
}

export interface RankerTopicHint {
  contentType: ContentType | null;
  schemaType: string | null;
}

interface TopicQueueReader {
  topicQueue?: {
    findFirst: (args: any) => Promise<{ tier1Topics?: unknown; tier2Topics?: unknown; tier3Topics?: unknown } | null>;
  };
}

/**
 * Son konu kuyrugunda ayni basligi tasiyan konu nesnesinin siralayici ipucu.
 * Kuyruk yoksa / konu kuyrukta degilse / okuma hata verirse null: tip baska
 * kaynaktan (siniflandirici, varsayilan) belirlenir, uretim durmaz.
 */
export async function findRankerTopicHint(prisma: TopicQueueReader, siteId: string, topic: string): Promise<RankerTopicHint | null> {
  const key = topicKey(topic);
  if (!key) return null;
  try {
    const queue = await prisma.topicQueue?.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
      select: { tier1Topics: true, tier2Topics: true, tier3Topics: true },
    });
    if (!queue) return null;
    for (const tier of [queue.tier1Topics, queue.tier2Topics, queue.tier3Topics]) {
      if (!Array.isArray(tier)) continue;
      const hit = tier.find((t) => topicKey(asRecord(t).topic) === key);
      if (hit) return rankerHintFromTopic(hit);
    }
    return null;
  } catch {
    return null;
  }
}

/** Konu nesnesinden siralayici ipucu */
export function rankerHintFromTopic(topic: unknown): RankerTopicHint {
  const rec = asRecord(topic);
  // annotateRankedTopics siniflandiricinin tahminini de content_type'a yazar
  // (panel rozeti icin); siralayici karari sayilmasin
  const src = rec.content_type_source;
  const fromRanker = src === undefined || src === 'ranker';
  return {
    contentType: fromRanker ? normalizeContentType(rec.content_type) : null,
    schemaType: typeof rec.schema_type === 'string' ? rec.schema_type : null,
  };
}

/**
 * Takvime alinan konunun kayda yazilacak siralayici karari. Yalniz siralayicinin
 * ayirt edici karari yazilir (content_type ya da Article disi schema_type);
 * yoksa null — tip uretimde siniflandiriciyla verilir.
 */
export function rankerPlanFromTopic(topic: unknown): ContentTypeDecision | null {
  const hint = rankerHintFromTopic(topic);
  if (hint.contentType) return { type: hint.contentType, source: 'ranker' };
  const fromSchema = contentTypeFromSchemaType(hint.schemaType);
  return fromSchema && fromSchema !== 'guide' ? { type: fromSchema, source: 'ranker' } : null;
}

/**
 * Siralayici ciktisindaki her konuya gecerli bir content_type ve kaynagini yazar.
 * Siralayicinin gecerli content_type'i aynen kalir ('ranker'); yoksa / gecersizse
 * schema_type eslemesi ve baslik siniflandiricisiyle karar verilir. Panel rozeti
 * bu alani okur. Dizi degilse bos dizi doner.
 */
export function annotateRankedTopics(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object' && !Array.isArray(t))
    .map((t) => {
      const rec = t as Record<string, unknown>;
      const decision: ContentTypeDecision = resolveContentType({
        rankerContentType: rec.content_type,
        rankerSchemaType: rec.schema_type,
        title: rec.topic,
      });
      return { ...rec, content_type: decision.type, content_type_source: decision.source };
    });
}
