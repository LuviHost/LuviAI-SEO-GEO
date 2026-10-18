'use client';

import { TrendingUp, TrendingDown, Minus, Sparkles, Rocket, Info } from 'lucide-react';
import { geoImpact, formatTrDate } from '@/components/geo-impact';

const LABELS: Record<string, string> = {
  anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT',
  perplexity: 'Perplexity', xai: 'Grok', grok: 'Grok', deepseek: 'DeepSeek', meta: 'Meta AI',
};

/**
 * "RanksUp Etkisi" before-after değer kartı.
 * İlk ölçüm (baseline) ile son ölçüm arasındaki AI görünürlük değişimini gösterir.
 * Veri citation-history (trends + byProvider). Kıyas yalnız GÜNCEL ölçüm
 * yöntemiyle yapılan ölçümler arasında (geo-impact.ts): yöntem değiştiyse eski
 * yöntemle yeni yöntem kıyaslanmaz, "kıyas yok" gösterilir.
 */
export function BeforeAfterCard({ data }: { data: any }) {
  const g = geoImpact(data);
  if (g.state === 'none') return null;

  // Yöntem değişti ve yeni yöntemle henüz ikinci ölçüm yok → nötr durum (kırmızı/yeşil yok)
  if (g.state === 'method-changed') {
    return (
      <div className="mb-4 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden /> RanksUp Etkisi · Ölçüm yöntemi güncellendi — kıyas yok
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">
          AI görünürlük ölçüm yöntemi{g.methodChangedAt ? <> <strong>{formatTrDate(g.methodChangedAt)}</strong> tarihinde</> : null} güncellendi; önceki ölçümler yeni yöntemle kıyaslanmaz.
          Şu an <strong>{g.enginesNow}/{g.totalEngines}</strong> AI asistanının cevabında görünüyorsun (markan anılıyor ya da sitene atıf var)
          {g.lastAvg !== null && <>, ort. skor <strong>{g.lastAvg}</strong></>}. Yeni yöntemle ikinci ölçümünden sonra değişim burada görünür.
        </p>
      </div>
    );
  }

  // Kıyas için ikinci ölçüm yok → başlangıç noktası
  if (g.state === 'baseline') {
    return (
      <div className="mb-4 rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.07] to-purple-500/[0.04] p-4">
        <div className="flex items-center gap-2 text-brand-700 dark:text-brand-300 font-semibold text-sm">
          <Rocket className="h-4 w-4" /> RanksUp Etkisi — Başlangıç ölçümü alındı
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">
          Şu an <strong>{g.enginesNow}/{g.totalEngines}</strong> AI asistanının cevabında görünüyorsun (markan anılıyor ya da sitene atıf var)
          {g.lastAvg !== null && <>, ort. skor <strong>{g.lastAvg}</strong></>}. Bu senin <strong>başlangıç noktan</strong>.
          Yeni ölçüm yaptıkça (her hesap 7 günde 1 AI ölçümü yapabilir) değişimi burada göreceksin.
        </p>
      </div>
    );
  }

  const firstAvg = g.firstAvg ?? 0;
  const lastAvg = g.lastAvg ?? 0;
  const direction = lastAvg > firstAvg ? 'up' : lastAvg < firstAvg ? 'down' : 'flat';
  const toneText = direction === 'up' ? 'text-emerald-700 dark:text-emerald-300'
    : direction === 'down' ? 'text-red-700 dark:text-red-300'
    : 'text-muted-foreground';
  const toneBorder = direction === 'up' ? 'border-emerald-500/30' : direction === 'down' ? 'border-red-500/30' : 'border-border';
  const toneBg = direction === 'up'
    ? 'from-emerald-500/[0.08] to-brand-500/[0.04]'
    : direction === 'down' ? 'from-red-500/[0.08] to-brand-500/[0.04]'
    : 'from-muted/40 to-muted/10';
  const newEngines = g.newEngines.map((p) => LABELS[p] ?? p);

  return (
    <div className={`mb-4 rounded-xl border ${toneBorder} bg-gradient-to-br ${toneBg} p-4`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold text-sm">RanksUp Etkisi</span>
        <span className="text-xs text-muted-foreground">· {g.spanDays} günlük aralık</span>
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        {/* Büyük değişim % */}
        <div className="flex items-center gap-2">
          {direction === 'up' ? <TrendingUp className={`h-7 w-7 ${toneText}`} />
            : direction === 'down' ? <TrendingDown className={`h-7 w-7 ${toneText}`} />
            : <Minus className={`h-7 w-7 ${toneText}`} />}
          <div>
            <div className={`text-4xl font-extrabold leading-none ${toneText}`}>
              {g.growthPct === null ? `+${lastAvg}` : `${g.growthPct > 0 ? '+' : ''}${g.growthPct}%`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {g.growthPct === null ? 'AI görünürlük (0\'dan başladı)' : 'AI görünürlük değişimi'}
            </div>
          </div>
        </div>

        {/* Mini metrikler */}
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <Metric label="Görünür olduğun asistan" before={`${g.enginesStart}`} after={`${g.enginesNow}`} suffix={`/${g.totalEngines}`} up={g.enginesNow >= g.enginesStart} />
          <Metric label="Ort. skor" before={`${firstAvg}`} after={`${lastAvg}`} up={lastAvg >= firstAvg} />
          <Metric label="Anılma + atıf" before={`${g.mentionsStart}`} after={`${g.mentionsNow}`} up={g.mentionsNow >= g.mentionsStart} />
        </div>
      </div>

      {newEngines.length > 0 && (
        <p className={`text-sm mt-3 ${toneText}`}>
          <strong>{newEngines.join(', ')}</strong> cevaplarında artık görünüyorsun — başlangıç ölçümünde görünmüyordun.
        </p>
      )}
      {g.methodChanged && g.methodChangedAt && (
        <p className="text-label text-muted-foreground mt-2">
          Ölçüm yöntemi {formatTrDate(g.methodChangedAt)} tarihinde güncellendi; kıyas yalnız bu tarihten sonraki ölçümler arasında yapılır.
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
