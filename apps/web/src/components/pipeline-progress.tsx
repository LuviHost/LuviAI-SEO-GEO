'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type PipelineStep = {
  label: string;
  sublabel?: string;
  durationMs: number;
};

/**
 * Uzun süren backend pipeline'lar için animasyonlu ilerleme göstergesi.
 *
 * Backend'in gerçek progress bilgisi yok (synchronous API call),
 * bu yüzden tahmin sürelerine göre simüle ediyoruz.
 * "running" prop'u kapatılınca otomatik gizlenir.
 */
export function PipelineProgress({
  steps,
  running,
  title,
  className,
}: {
  steps: PipelineStep[];
  running: boolean;
  title?: string;
  className?: string;
}) {
  const totalMs = steps.reduce((s, x) => s + x.durationMs, 0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 250), 250);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;

  let acc = 0;
  let currentIdx = steps.length - 1;
  for (let i = 0; i < steps.length; i++) {
    if (elapsed < acc + steps[i].durationMs) {
      currentIdx = i;
      break;
    }
    acc += steps[i].durationMs;
    currentIdx = i + 1;
  }
  const safeIdx = Math.min(currentIdx, steps.length - 1);
  const current = steps[safeIdx];
  const pct = Math.min(98, (elapsed / totalMs) * 100);
  const remainingSec = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));

  return (
    <div
      className={cn(
        'space-y-4 p-6 rounded-xl border bg-card shadow-sm',
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2 pb-2 border-b">
          <Spinner />
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Adım {Math.min(safeIdx + 1, steps.length)} / {steps.length}
            </span>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              ~{remainingSec}sn kaldı
            </span>
          </div>
          <div className="text-base font-semibold mt-1">{current.label}</div>
          {current.sublabel && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {current.sublabel}
            </div>
          )}
        </div>

        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand to-brand-light transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute inset-y-0 w-20 -translate-x-full opacity-60 bg-white/50 dark:bg-white/10 blur-sm animate-[shimmer_1.6s_ease-in-out_infinite]"
            style={{
              left: `${pct}%`,
            }}
          />
        </div>

        <ol className="space-y-1.5 mt-4">
          {steps.map((step, i) => {
            const done = i < safeIdx;
            const active = i === safeIdx;
            return (
              <li
                key={i}
                className={cn(
                  'flex items-center gap-2 text-xs transition-colors',
                  done && 'text-foreground/70',
                  active && 'text-foreground font-medium',
                  !done && !active && 'text-muted-foreground/50',
                )}
              >
                <StepIcon done={done} active={active} />
                <span className="truncate">{step.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-brand shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="4"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StepIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <svg className="h-3.5 w-3.5 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (active) {
    return (
      <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
        <span className="relative h-2 w-2 rounded-full bg-brand" />
      </span>
    );
  }
  return <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />;
}

// Önceden tanımlı pipeline step şablonları
export const PIPELINE_STEPS = {
  audit: [
    { label: 'Site sayfaları taranıyor', sublabel: 'Anasayfa + iç sayfalar fetch edilir', durationMs: 8000 },
    { label: '14 SEO kontrol noktası', sublabel: 'HTTPS, meta, OG, schema, sitemap, robots…', durationMs: 6000 },
    { label: 'PageSpeed Insights', sublabel: 'Core Web Vitals (LCP, CLS, INP)', durationMs: 10000 },
    { label: 'Auto-fix önerileri', sublabel: 'Düzeltilebilir sorunları belirleme', durationMs: 4000 },
  ] as PipelineStep[],

  topicEngine: [
    { label: 'Brain analizi', sublabel: 'Site nişi + persona + brand voice', durationMs: 4000 },
    { label: 'Plan konuları', sublabel: 'Brain SEO stratejisinden konu çıkarımı', durationMs: 6000 },
    { label: 'Google Search Console fırsatları', sublabel: 'Düşük CTR + yüksek impression sorgular', durationMs: 12000 },
    { label: 'AI search (GEO) gap analizi', sublabel: 'ChatGPT/Perplexity/Claude alıntı boşlukları', durationMs: 15000 },
    { label: 'Rakip içerik haritası', sublabel: 'Top 6 rakibin son 30 gün makaleleri', durationMs: 10000 },
    { label: 'AI ranker — skorlama ve tier ayırma', sublabel: 'Tier 1/2/3 önceliklendirme', durationMs: 8000 },
  ] as PipelineStep[],

  article: [
    { label: 'Outline oluşturuluyor', sublabel: 'H2/H3 yapısı + AEO soruları', durationMs: 12000 },
    { label: 'Yazar AI (Claude Sonnet 4.5)', sublabel: '1800-2500 kelime tam makale', durationMs: 50000 },
    { label: 'Editör kalite kontrolü', sublabel: 'AI klişeleri, fact-check, marka sesi', durationMs: 30000 },
    { label: 'Görsel üretimi (Gemini)', sublabel: 'Hero + iç görseller', durationMs: 25000 },
    { label: 'Schema markup + SEO meta', sublabel: 'JSON-LD, OG, canonical', durationMs: 8000 },
    { label: 'Yayına hazırlanıyor', sublabel: 'Markdown → HTML, dosyaya kaydet', durationMs: 12000 },
  ] as PipelineStep[],

  brain: [
    { label: 'Site sayfaları crawl ediliyor', sublabel: 'Anasayfa + 24 alt sayfa', durationMs: 10000 },
    { label: 'İçerik özeti çıkarılıyor', sublabel: 'Niş, sektör, ürün/hizmet tespiti', durationMs: 5000 },
    { label: 'Anthropic Claude analizi', sublabel: 'Persona + rakip + SEO stratejisi + brand voice', durationMs: 30000 },
    { label: 'Brain DB\'ye kaydediliyor', sublabel: 'Site context tüm AI ajanlarına hazır', durationMs: 3000 },
  ] as PipelineStep[],

  autoFix: [
    { label: 'Eksik dosyalar oluşturuluyor', sublabel: 'sitemap.xml, robots.txt, llms.txt', durationMs: 8000 },
    { label: 'Yayın hedefine yükleniyor', sublabel: 'WordPress / FTP / GitHub vs.', durationMs: 12000 },
    { label: 'Doğrulama', sublabel: 'Yüklenen dosyalar erişilebilir mi', durationMs: 5000 },
  ] as PipelineStep[],
};
