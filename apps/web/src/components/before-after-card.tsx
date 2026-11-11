'use client';

import { TrendingUp, TrendingDown, Minus, Sparkles, Rocket, Info } from 'lucide-react';
import { geoImpact, formatTrDate } from '@/components/geo-impact';
import { kararAciklamasi, olcumOf } from '@/lib/visibility-interval';

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
      <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 [&_strong]:font-medium [&_strong]:text-foreground">
        <div className="flex items-center gap-2 text-panel-3">
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
      <div className="mb-4 rounded-lg border border-border bg-card p-4 [&_strong]:font-medium [&_strong]:text-foreground">
        <div className="flex items-center gap-2 text-panel-3">
          <Rocket className="h-4 w-4 text-muted-foreground" aria-hidden /> RanksUp Etkisi — Başlangıç ölçümü alındı
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
  // Yön sayıların farkından DEĞİL aralık kararından (geo-impact.ts): görünme
  // aralıkları örtüşüyorsa ya da hesaplanamıyorsa "anlamlı değişim yok" — nötr
  const direction = g.yon;
  const kararIpucu = kararAciklamasi(olcumOf(data)?.etki);
  const toneText = direction === 'up' ? 'text-success'
    : direction === 'down' ? 'text-danger'
    : 'text-muted-foreground';
  const toneBorder = direction === 'up' ? 'border-success/25' : direction === 'down' ? 'border-danger/30' : 'border-border';
  const toneBg = direction === 'up'
    ? 'bg-success/5'
    : direction === 'down' ? 'bg-danger/5'
    : 'bg-muted/40';
  const newEngines = g.newEngines.map((p) => LABELS[p] ?? p);

  return (
    <div className={`mb-4 rounded-lg border ${toneBorder} ${toneBg} p-4 [&_strong]:font-medium`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-panel-3">RanksUp Etkisi</span>
        <span className="v-rail">· {g.spanDays} günlük aralık</span>
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        {/* Büyük değişim % — yalnız aralıklar örtüşmüyorsa; aksi hâlde "anlamlı değişim yok" */}
        <div className="flex items-center gap-2" title={kararIpucu}>
          {direction === 'up' ? <TrendingUp className={`h-7 w-7 ${toneText}`} />
            : direction === 'down' ? <TrendingDown className={`h-7 w-7 ${toneText}`} />
            : <Minus className={`h-7 w-7 ${toneText}`} />}
          <div>
            {direction === 'flat' ? (
              <div className={`text-panel-2 ${toneText}`}>Anlamlı değişim yok</div>
            ) : (
              <div className={`text-metric-lg tabular-nums ${toneText}`}>
                {g.growthPct === null ? `+${lastAvg}` : `${g.growthPct > 0 ? '+' : ''}${g.growthPct}%`}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              {direction === 'flat'
                ? 'Fark AI cevaplarının ölçüm oynaklığı içinde'
                : g.growthPct === null ? 'AI görünürlük (0\'dan başladı)' : 'AI görünürlük değişimi'}
            </div>
          </div>
        </div>

        {/* Mini metrikler — renk yalnız anlamlı değişimde */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <Metric label="Görünür olduğun asistan" before={`${g.enginesStart}`} after={`${g.enginesNow}`} suffix={`/${g.totalEngines}`} tone={direction === 'flat' ? 'flat' : g.enginesNow >= g.enginesStart ? 'up' : 'down'} />
          <Metric label="Ort. skor" before={`${firstAvg}`} after={`${lastAvg}`} tone={direction} />
          <Metric label="Anılma + atıf" before={`${g.mentionsStart}`} after={`${g.mentionsNow}`} tone={direction === 'flat' ? 'flat' : g.mentionsNow >= g.mentionsStart ? 'up' : 'down'} />
        </div>
      </div>

      {direction === 'flat' && (
        <p className="text-label text-muted-foreground mt-2">{kararIpucu}</p>
      )}

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

function Metric({ label, before, after, suffix = '', tone }: { label: string; before: string; after: string; suffix?: string; tone: 'up' | 'down' | 'flat' }) {
  const cls = tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-foreground';
  return (
    <div>
      <div className="v-rail">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">
        <span className="text-muted-foreground">{before}{suffix}</span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className={cls}>{after}{suffix}</span>
      </div>
    </div>
  );
}
