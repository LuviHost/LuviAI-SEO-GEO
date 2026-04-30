'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { CheckCircle2, Brain, Search, Sparkles, Compass, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScanOrb } from './scan-orb';
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

const TASK_ICON: Record<MissionTaskKey, React.ComponentType<{ className?: string }>> = {
  brain: Brain,
  audit: Search,
  topics: Sparkles,
  platform: Compass,
  schedule: Calendar,
};

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
  const [tick, setTick] = useState(0);
  const labelRef = useRef<HTMLDivElement>(null);
  const lastIdxRef = useRef<number>(0);

  // ticking clock (1s) for elapsed
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // rotate status message every 3s (skip done/active filter — pure flavor)
  useEffect(() => {
    const id = setInterval(() => {
      setMsgIdx((i) => (i + 1) % ROTATING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // crossfade label on change
  useEffect(() => {
    if (reduced || !labelRef.current) return;
    if (lastIdxRef.current !== msgIdx) {
      animate(labelRef.current, {
        opacity: [{ to: 0, duration: 200 }, { to: 1, duration: 400 }],
        translateY: [{ to: -8, duration: 200 }, { to: 0, duration: 400, ease: 'outQuad' }],
      });
      lastIdxRef.current = msgIdx;
    }
  }, [msgIdx, reduced]);

  const elapsed = Math.max(0, Date.now() - startedAt);
  const elapsedSec = Math.floor(elapsed / 1000);
  const pct = Math.min(95, (elapsed / estimatedMs) * 100);
  const remainingSec = Math.max(1, Math.ceil((estimatedMs - elapsed) / 1000));

  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = doneCount === tasks.length;

  return (
    <div className={cn('relative w-full', className)}>
      {/* center wheel */}
      <div className="relative grid place-items-center py-6">
        <div className="text-brand">
          <ScanOrb
            size="xl"
            state={allDone ? 'done' : 'scanning'}
            percent={pct}
          >
            <Sparkles className="h-7 w-7 text-brand mb-1" />
          </ScanOrb>
        </div>
      </div>

      {/* dynamic status */}
      <div ref={labelRef} className="text-center mt-2 mb-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand/80">
          &gt;&gt; AI ÇALIŞIYOR
        </div>
        <div className="text-2xl sm:text-3xl font-bold tracking-tight mt-1.5">
          {allDone ? 'Hazır! Yönlendiriliyorsun…' : ROTATING_MESSAGES[msgIdx]}
          <span className="inline-block w-3 text-brand animate-pulse ml-0.5">…</span>
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-2">
          <span className="text-brand">%{Math.round(pct)}</span>
          <span className="opacity-30 mx-2">·</span>
          <span>{elapsedSec}sn geçti</span>
          <span className="opacity-30 mx-2">·</span>
          <span>~{remainingSec}sn kaldı</span>
        </div>
      </div>

      {/* task bullets */}
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-3xl mx-auto">
        {tasks.map((t) => {
          const Icon = TASK_ICON[t.key];
          return (
            <div
              key={t.key}
              className={cn(
                'rounded-xl border p-3 flex flex-col items-center gap-2 text-center transition-all duration-500',
                t.done
                  ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_0_1px_rgb(16_185_129/0.15)]'
                  : 'border-brand/20 bg-card/60 backdrop-blur-sm',
              )}
            >
              <div className="relative">
                {t.done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                ) : (
                  <Icon className="h-6 w-6 text-brand/70 animate-pulse" />
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-mono uppercase tracking-widest leading-tight',
                  t.done ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-foreground/70',
                )}
              >
                {t.label}
              </span>
              <span className={cn('text-[9px] font-mono', t.done ? 'text-emerald-500/80' : 'text-brand/70 animate-pulse')}>
                {t.done ? '✓ TAMAM' : '... işleniyor'}
              </span>
            </div>
          );
        })}
      </div>

      {/* footer note */}
      <p className="mt-8 text-center text-xs text-muted-foreground font-mono">
        Tarayıcıyı kapatabilirsin — işlem arka planda devam eder. Hazır olunca dashboard'a yönlendirileceksin.
      </p>
    </div>
  );
}
