'use client';

import { useEffect, useState } from 'react';
import { ScanOverlay } from '@/components/ai-scan';

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
 *
 * Görsel: linear bar yerine "AI Scan" HUD radar (ScanOverlay).
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
  return (
    <ScanOverlay
      steps={steps}
      elapsed={elapsed}
      totalMs={totalMs}
      currentIdx={currentIdx}
      title={title}
      className={className}
    />
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
