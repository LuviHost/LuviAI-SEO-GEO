'use client';

import { useEffect, useState } from 'react';
import { PipelineGauge } from '@/components/pipeline-gauge';
import { Sparkles, CheckCircle2 } from 'lucide-react';

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
 *
 * `startedAt` verilirse elapsed = Date.now() - startedAt — sayfa yenilense
 * bile doğru pozisyondan devam eder (F5/route change resistant).
 * Verilmezse component mount'ından itibaren sayar (eski davranış).
 *
 * "running" prop'u kapatılınca otomatik gizlenir.
 */
export function PipelineProgress({
  steps,
  running,
  title,
  className,
  startedAt,
}: {
  steps: PipelineStep[];
  running: boolean;
  title?: string;
  className?: string;
  /** Pipeline başlangıç timestamp'i (ms veya ISO string). Verilirse remount-resistant. */
  startedAt?: number | string | Date;
}) {
  const totalMs = steps.reduce((s, x) => s + x.durationMs, 0);

  // startedAt verilmişse onu ms'e çevir
  const startedAtMs = startedAt
    ? (typeof startedAt === 'number' ? startedAt
        : typeof startedAt === 'string' ? new Date(startedAt).getTime()
        : startedAt.getTime())
    : null;

  const [elapsed, setElapsed] = useState<number>(() =>
    startedAtMs ? Math.max(0, Date.now() - startedAtMs) : 0
  );

  useEffect(() => {
    if (!running) {
      // running=false → state'i sıfırla (gizleme animasyonu için)
      if (!startedAtMs) setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      // startedAtMs varsa wall-clock üzerinden hesapla (component remount sonrası bile doğru)
      // yoksa 250ms increment (eski davranış)
      if (startedAtMs) {
        setElapsed(Math.max(0, Date.now() - startedAtMs));
      } else {
        setElapsed((e) => e + 250);
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, startedAtMs]);

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
  const percent = totalMs > 0 ? Math.min(99, (elapsed / totalMs) * 100) : 0;
  const totalSec = Math.max(1, Math.ceil((totalMs - elapsed) / 1000));
  const safeIdx = Math.min(currentIdx, steps.length - 1);

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br from-violet-50/40 via-white to-fuchsia-50/30 dark:from-violet-950/20 dark:via-card dark:to-fuchsia-950/10 p-5 ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand animate-pulse" />
          <p className="text-sm font-semibold">{title ?? 'Pipeline çalışıyor'}</p>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          ~{totalSec}sn
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] items-center gap-6 py-2">
        <PipelineGauge
          activeIdx={safeIdx}
          totalSteps={steps.length}
          percent={percent}
        />

        <div className="space-y-2">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-brand/70 mb-1">
              Adım {Math.min(currentIdx + 1, steps.length)} / {steps.length}
            </p>
            <p className="text-base sm:text-lg font-semibold leading-snug">
              {steps[safeIdx]?.label}
            </p>
            {steps[safeIdx]?.sublabel && (
              <p className="text-xs text-muted-foreground mt-1">
                {steps[safeIdx].sublabel}
              </p>
            )}
          </div>

          <ul className="space-y-1 mt-3">
            {steps.map((s, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <li
                  key={s.label}
                  className={`flex items-center gap-2 text-xs ${
                    done ? 'text-emerald-600 dark:text-emerald-400' : active ? 'text-foreground' : 'text-muted-foreground/60'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse shrink-0 ml-1" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0 ml-1" />
                  )}
                  <span className={done ? 'line-through opacity-70' : ''}>{s.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
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
