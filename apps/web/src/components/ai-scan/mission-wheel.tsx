'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Brain, Search, Sparkles, Compass, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './use-reduced-motion';

export type MissionTaskKey = 'brain' | 'audit' | 'topics' | 'platform' | 'schedule';

export type MissionTask = {
  key: MissionTaskKey;
  label: string;
  done: boolean;
};

const ROTATING_MESSAGES = [
  'Bağlantı kuruluyor',
  'Site sayfaları taranıyor',
  'Marka sesi çıkarılıyor',
  'Rakipler haritalanıyor',
  'Hedef kitle tespit ediliyor',
  'Niş ve sektör tahmin ediliyor',
  'SEO + GEO skoru hesaplanıyor',
  'AI içerik konuları üretiliyor',
  'Platform tespit ediliyor',
  'Yayın takvimi planlanıyor',
];

const TASK_ICON: Record<MissionTaskKey, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  brain: Brain,
  audit: Search,
  topics: Sparkles,
  platform: Compass,
  schedule: Calendar,
};

/**
 * Kurulum ilerlemesi.
 *
 * 12.11.2026 (vitrin dili ic sayfalarda): gokkusagi halkali parlak kure, kalin
 * baslik ve renkli adim balonlari kaldirildi. Vitrindeki "kanit rakami" gibi tek
 * buyuk, ince rakam + altinda ince bir cizgi; adimlar gercek bir sira oldugu icin
 * ince cizgili bes hucre (biten adimin cizgisi turuncuya doner). Ilerleme hesabi,
 * donen durum cumleleri ve adim listesi AYNI.
 */
export function MissionWheel({
  tasks,
  startedAt,
  estimatedMs = 90000,
  className,
}: {
  tasks: MissionTask[];
  startedAt: number;
  estimatedMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [msgIdx, setMsgIdx] = useState(0);
  const [, setTick] = useState(0);
  const labelRef = useRef<HTMLDivElement>(null);
  const lastIdxRef = useRef<number>(0);

  // Saniyede bir yeniden ciz: gecen sureden hesaplanan yuzde ilerlesin
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Durum cumlesi 3 saniyede bir doner (yalniz bilgi; adimlara bagli degil)
  useEffect(() => {
    const id = setInterval(() => {
      setMsgIdx((i) => (i + 1) % ROTATING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Cumle degisince kisa gecis
  useEffect(() => {
    if (reduced || !labelRef.current) return;
    if (lastIdxRef.current !== msgIdx) {
      animate(labelRef.current, {
        opacity: [{ to: 0, duration: 200 }, { to: 1, duration: 400 }],
        translateY: [{ to: -6, duration: 200 }, { to: 0, duration: 400, ease: 'outQuad' }],
      });
      lastIdxRef.current = msgIdx;
    }
  }, [msgIdx, reduced]);

  const elapsed = Math.max(0, Date.now() - startedAt);
  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = doneCount === tasks.length;
  // Tahmini sureye gore ilerler, %95'te bekler; butun adimlar bitince 100
  const pct = allDone ? 100 : Math.min(95, (elapsed / estimatedMs) * 100);

  return (
    <div className={cn('relative w-full', className)}>
      {/* Tek buyuk rakam + ince ilerleme cizgisi */}
      <div
        className="pt-6 text-center sm:pt-10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Kurulum ilerlemesi"
      >
        <p className="text-vitrin-0 tabular-nums">
          {Math.round(pct)}
          <span className="text-dim">%</span>
        </p>
        <div className="mx-auto mt-8 h-px w-full max-w-md bg-border">
          <div
            className="h-px bg-brand-vivid transition-[width] duration-1000 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Donen durum cumlesi */}
      <div ref={labelRef} className="mt-8 text-center">
        <p className="text-vitrin-3">
          {allDone ? 'Hazır! Yönlendiriliyorsun…' : ROTATING_MESSAGES[msgIdx]}
          {!allDone && <span className="text-dim motion-safe:animate-pulse">…</span>}
        </p>
      </div>

      {/* Adimlar — gercek bir sira: bes hucre, biten adimin ust cizgisi turuncu */}
      <ol className="mx-auto mt-12 grid max-w-3xl sm:grid-cols-5">
        {tasks.map((t) => {
          const Icon = TASK_ICON[t.key];
          return (
            <li key={t.key} className="relative border-t border-border py-3 sm:pr-3 sm:pt-4">
              <span
                className={cn(
                  'absolute -top-px left-0 h-px bg-brand-vivid transition-[width] duration-700 ease-out motion-reduce:transition-none',
                  t.done ? 'w-full' : 'w-0',
                )}
                aria-hidden
              />
              <span className="flex items-center gap-2 font-mono text-vitrin-rail">
                {t.done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand-vivid" strokeWidth={2.5} aria-hidden />
                ) : (
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:animate-pulse" aria-hidden />
                )}
                <span className={t.done ? 'text-foreground' : 'text-muted-foreground'}>{t.label}</span>
                <span className="sr-only">{t.done ? '(tamamlandı)' : '(sürüyor)'}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Tarayıcıyı kapatabilirsin — işlem arka planda devam eder. Hazır olunca panele yönlendirileceksin.
      </p>
    </div>
  );
}
