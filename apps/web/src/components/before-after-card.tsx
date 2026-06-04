'use client';

import { TrendingUp, TrendingDown, Sparkles, Rocket } from 'lucide-react';

const LABELS: Record<string, string> = {
  anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT',
  perplexity: 'Perplexity', xai: 'Grok', grok: 'Grok', deepseek: 'DeepSeek', meta: 'Meta AI',
};

/**
 * "RanksUp Etkisi" before-after değer kartı.
 * İlk ölçüm (baseline) ile son ölçüm arasındaki AI görünürlük büyümesini
 * pazarlama/değer-kanıtı diliyle gösterir. Veri citation-history (trends + byProvider).
 */
export function BeforeAfterCard({ data }: { data: any }) {
  const trends: any[] = data?.trends ?? [];
  const byProvider: Record<string, any[]> = data?.byProvider ?? {};
  if (!trends.length) return null;

  // Tarih aralığı + mention (cited+mentioned) ilk vs son
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let mentionsStart = 0;
  let mentionsNow = 0;
  for (const series of Object.values(byProvider)) {
    if (!series?.length) continue;
    const f = series[0];
    const l = series[series.length - 1];
    mentionsStart += (f.cited ?? 0) + (f.mentioned ?? 0);
    mentionsNow += (l.cited ?? 0) + (l.mentioned ?? 0);
    if (!firstDate || f.date < firstDate) firstDate = f.date;
    if (!lastDate || l.date > lastDate) lastDate = l.date;
  }
  const spanDays = firstDate && lastDate
    ? Math.round((+new Date(lastDate) - +new Date(firstDate)) / 86400000)
    : 0;

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const firstAvg = avg(trends.map((t) => t.first).filter((v) => typeof v === 'number'));
  const lastAvg = avg(trends.map((t) => t.last).filter((v) => typeof v === 'number'));

  const enginesStart = trends.filter((t) => (t.first ?? 0) > 0).length;
  const enginesNow = trends.filter((t) => (t.last ?? 0) > 0).length;
  const totalEngines = trends.length;

  const growthPct = firstAvg > 0 ? Math.round(((lastAvg - firstAvg) / firstAvg) * 100) : null;
  const newEngines = trends
    .filter((t) => (t.last ?? 0) > 0 && (t.first ?? 0) <= 0)
    .map((t) => LABELS[t.provider] ?? t.provider);

  // Henüz yeterli zaman geçmemiş (tek snapshot / ilk gün) → baseline durumu
  const tooEarly = spanDays < 2 || (firstAvg === lastAvg && mentionsStart === mentionsNow && enginesStart === enginesNow);

  if (tooEarly) {
    return (
      <div className="mb-4 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-500/[0.07] to-purple-500/[0.04] p-4">
        <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300 font-semibold text-sm">
          <Rocket className="h-4 w-4" /> RanksUp Etkisi — Başlangıç ölçümü alındı
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">
          Şu an <strong>{enginesNow}/{totalEngines}</strong> motor markanı tanıyor (ort. skor <strong>{lastAvg}</strong>).
          Bu senin <strong>başlangıç noktan</strong>. Her gün otomatik ölçüyoruz; birkaç gün/hafta içinde
          <strong> büyümeyi</strong> burada göreceksin.
        </p>
      </div>
    );
  }

  const grew = lastAvg >= firstAvg;
  const tone = grew ? 'emerald' : 'red';
  const toneText = grew ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
  const toneBorder = grew ? 'border-emerald-500/30' : 'border-red-500/30';
  const toneBg = grew
    ? 'from-emerald-500/[0.08] to-orange-500/[0.04]'
    : 'from-red-500/[0.08] to-orange-500/[0.04]';

  return (
    <div className={`mb-4 rounded-xl border ${toneBorder} bg-gradient-to-br ${toneBg} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-orange-500" />
        <span className="font-semibold text-sm">RanksUp Etkisi</span>
        <span className="text-xs text-muted-foreground">· son {spanDays} gün</span>
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        {/* Büyük büyüme % */}
        <div className="flex items-center gap-2">
          {grew ? <TrendingUp className={`h-7 w-7 ${toneText}`} /> : <TrendingDown className={`h-7 w-7 ${toneText}`} />}
          <div>
            <div className={`text-4xl font-extrabold leading-none ${toneText}`}>
              {growthPct === null ? `+${lastAvg}` : `${growthPct >= 0 ? '+' : ''}${growthPct}%`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {growthPct === null ? 'AI görünürlük (0\'dan başladı)' : 'AI görünürlük değişimi'}
            </div>
          </div>
        </div>

        {/* Mini metrikler */}
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <Metric label="Tanıyan motor" before={`${enginesStart}`} after={`${enginesNow}`} suffix={`/${totalEngines}`} up={enginesNow >= enginesStart} />
          <Metric label="Ort. skor" before={`${firstAvg}`} after={`${lastAvg}`} up={lastAvg >= firstAvg} />
          <Metric label="Mention" before={`${mentionsStart}`} after={`${mentionsNow}`} up={mentionsNow >= mentionsStart} />
        </div>
      </div>

      {newEngines.length > 0 && (
        <p className={`text-sm mt-3 ${toneText}`}>
          🎉 <strong>{newEngines.join(', ')}</strong> artık markanı tanıyor — başlangıçta tanımıyordu.
        </p>
      )}
    </div>
  );
}

function Metric({ label, before, after, suffix = '', up }: { label: string; before: string; after: string; suffix?: string; up: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">
        <span className="text-muted-foreground">{before}{suffix}</span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{after}{suffix}</span>
      </div>
    </div>
  );
}
