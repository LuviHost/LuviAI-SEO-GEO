'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Brain, Search, Sparkles, Compass, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FuturisticGauge } from './futuristic-gauge';
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

// Gauge fazlarının pastel tonları — sırasıyla mavi · mor · kırmızı · sarı · yeşil
// soft = gauge arc rengi (300), mid = label/ring için biraz koyu (400) okunaklılık için
const TASK_COLOR: Record<MissionTaskKey, { soft: string; mid: string }> = {
  brain: { soft: '#7dd3fc', mid: '#38bdf8' }, // sky-300 / sky-400
  audit: { soft: '#c4b5fd', mid: '#a78bfa' }, // violet-300 / violet-400
  topics: { soft: '#fda4af', mid: '#fb7185' }, // rose-300 / rose-400
  platform: { soft: '#fcd34d', mid: '#fbbf24' }, // amber-300 / amber-400
  schedule: { soft: '#86efac', mid: '#4ade80' }, // green-300 / green-400
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
      {/* center wheel — futuristic HUD gauge */}
      <div className="relative grid place-items-center py-2 sm:py-4">
        <FuturisticGauge progressPercent={pct} done={allDone} />
      </div>

      {/* dynamic status */}
      <div ref={labelRef} className="text-center mt-6 mb-1">
        <div className="text-2xl sm:text-3xl font-bold tracking-tight mt-1.5">
          {allDone ? 'Hazır! Yönlendiriliyorsun…' : ROTATING_MESSAGES[msgIdx]}
          <span className="inline-block w-3 text-brand animate-pulse ml-0.5">…</span>
        </div>
      </div>

      {/* task pipeline — 5 düğüm, gauge fazlarıyla aynı 5 renk */}
      <div className="mt-12 max-w-2xl mx-auto px-2 sm:px-6">
        <div className="relative">
          {/* Track — arka plan: pastel renklerin yatay geçişi (low opacity) */}
          <div
            className="absolute top-5 left-[10%] right-[10%] h-[2px] rounded-full"
            style={{
              background: `linear-gradient(to right, ${TASK_COLOR.brain.soft}40, ${TASK_COLOR.audit.soft}40, ${TASK_COLOR.topics.soft}40, ${TASK_COLOR.platform.soft}40, ${TASK_COLOR.schedule.soft}40)`,
            }}
          />
          {/* Track — dolu kısım: pastel-soft gradient (gauge ile aynı ton) */}
          <div
            className="absolute top-5 left-[10%] h-[2px] rounded-full transition-all duration-1000 ease-out"
            style={{
              width: tasks.length > 1
                ? `${(doneCount / (tasks.length - 1)) * 80}%`
                : '0%',
              maxWidth: '80%',
              background: `linear-gradient(to right, ${TASK_COLOR.brain.soft}, ${TASK_COLOR.audit.soft}, ${TASK_COLOR.topics.soft}, ${TASK_COLOR.platform.soft}, ${TASK_COLOR.schedule.soft})`,
              boxShadow: `0 0 6px ${TASK_COLOR.audit.soft}88`,
            }}
          />

          {/* Nodes */}
          <div className="relative flex justify-between items-start">
            {tasks.map((t) => {
              const Icon = TASK_ICON[t.key];
              const c = TASK_COLOR[t.key];
              return (
                <div key={t.key} className="flex flex-col items-center gap-2.5 text-center w-1/5">
                  <div className="relative">
                    {/* Pulse ring (sadece pending) — task'in pastel rengi */}
                    {!t.done && (
                      <span
                        className="absolute inset-0 rounded-full border-2 animate-ping"
                        style={{ borderColor: `${c.soft}88` }}
                      />
                    )}
                    <div
                      className={cn(
                        'relative h-10 w-10 rounded-full grid place-items-center transition-all duration-500',
                        t.done ? 'scale-105' : '',
                      )}
                      style={
                        t.done
                          ? {
                              background: `linear-gradient(135deg, ${c.soft} 0%, ${c.mid} 100%)`,
                              boxShadow: `0 4px 16px ${c.soft}88`,
                            }
                          : {
                              backgroundColor: 'white',
                              border: `1.5px solid ${c.soft}aa`,
                              boxShadow: `0 2px 10px ${c.soft}33`,
                            }
                      }
                    >
                      {t.done ? (
                        <Check className="h-5 w-5 text-white" strokeWidth={3} />
                      ) : (
                        <Icon className="h-[18px] w-[18px]" style={{ color: c.mid }} />
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-mono uppercase tracking-[0.12em] leading-tight max-w-[80px] transition-colors duration-500',
                      t.done ? 'font-semibold' : 'text-muted-foreground',
                    )}
                    style={t.done ? { color: c.mid } : undefined}
                  >
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* footer note */}
      <p className="mt-8 text-center text-xs text-muted-foreground font-mono">
        Tarayıcıyı kapatabilirsin — işlem arka planda devam eder. Hazır olunca dashboard'a yönlendirileceksin.
      </p>
    </div>
  );
}
