/**
 * AI-Mode sorgu deseni — SEZGISEL sinyal, olcum degil (saf modul).
 *
 * GSC, AI Mode sohbet parcalarini normal sorgu olarak logluyor (defter:
 * gsc-logs-ai-mode-conversation-fragments-as-queries, 2 kaynak) ama hangi
 * sorgunun AI yuzeyinden geldigini SOYLEMIYOR. Bu modul queryDetails
 * satirlarindan "AI Mode/AIO'dan gelmis olabilir" sinyali cikarir:
 *
 *   question        TR/EN soru kalibi (nasil, nedir, neden, hangi, kac,
 *                   mi/mi soneki, how, what, why, can, should...)
 *   long-tail       >= AI_MODE_MIN_WORDS kelime (konusma dili)
 *   zero-click-ranked  iyi siralaniyor (position <= AI_MODE_MAX_POSITION)
 *                   ama tiklanmiyor: SERP icinde cevaplanma suphesi.
 *                   POZISYON SARTI KRITIK — pozisyon 40'taki tiklamasiz sorgu
 *                   sadece kotu siralamadir, AI degil (kirmizi-takim).
 *   comparison      vs / en iyi / alternatif / karsilastirma
 *
 * aiModeLikely = zero-click-ranked || (question && long-tail)
 *
 * SINIR: GSC snapshot'i clicks-desc sirali ilk 100 satir — tikli sorgusu cok
 * olan sitede zero-click satirlar hic gorunmez. Cikti "sezgisel tahmin"
 * etiketiyle LISTE olarak sunulur; otomatik firsat/makale uretimi YOK.
 */

export interface QueryStat {
  query: string;
  impressions: number;
  clicks: number;
  position: number | null;
}

export type AiModeSignal = 'question' | 'long-tail' | 'zero-click-ranked' | 'comparison';

export interface AiModeAssessment extends QueryStat {
  aiModeLikely: boolean;
  signals: AiModeSignal[];
}

export const AI_MODE_MIN_WORDS = 5;
export const AI_MODE_MIN_IMPRESSIONS = 20;
export const AI_MODE_MAX_POSITION = 12;

const QUESTION_WORDS = new Set([
  // TR
  'nasil', 'nedir', 'neden', 'nicin', 'hangi', 'hangisi', 'kac', 'ne', 'nerede', 'nereden', 'kim', 'kimdir',
  'ne zaman', 'olur mu', 'gerekir mi',
  // EN
  'how', 'what', 'why', 'which', 'when', 'where', 'who', 'can', 'should', 'does', 'is', 'are', 'do',
]);
const TR_QUESTION_SUFFIX = /(^|\s)(mi|mi|mu|mu|midir|midir|mudur|mudur|misin|misin)(\s|\?|$)/;
const COMPARISON = /(^|\s)(vs\.?|versus|karsi|alternatif(i|leri)?|en iyi|karsilastir(ma)?|comparison|compare|best|alternative(s)?)(\s|$)/;

function fold(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/i̇/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function assessAiModeQuery(q: QueryStat): AiModeAssessment {
  const text = fold(q.query);
  const words = text.split(' ').filter(Boolean);
  const signals: AiModeSignal[] = [];

  const isQuestion = words.some((w) => QUESTION_WORDS.has(w)) || TR_QUESTION_SUFFIX.test(text) || /\?\s*$/.test(q.query);
  if (isQuestion) signals.push('question');

  const longTail = words.length >= AI_MODE_MIN_WORDS;
  if (longTail) signals.push('long-tail');

  if (
    q.impressions >= AI_MODE_MIN_IMPRESSIONS && q.clicks === 0 && longTail
    && q.position !== null && q.position <= AI_MODE_MAX_POSITION
  ) signals.push('zero-click-ranked');

  if (COMPARISON.test(text)) signals.push('comparison');

  const aiModeLikely = signals.includes('zero-click-ranked') || (isQuestion && longTail);
  return { ...q, aiModeLikely, signals };
}

export function summarizeAiMode(list: AiModeAssessment[]): { total: number; likely: number; sharePct: number } {
  const likely = list.filter((a) => a.aiModeLikely).length;
  return { total: list.length, likely, sharePct: list.length ? Math.round((likely / list.length) * 100) : 0 };
}
