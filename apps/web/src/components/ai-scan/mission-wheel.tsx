'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Brain, Search, Sparkles, Compass, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './use-reduced-motion';
import {
  LONG_STEP_NOTE_AFTER_MS, activeMessages, activeTaskKeys, missionPercent, type MissionTask, type MissionTaskKey,
} from '@/lib/mission-progress';

export type { MissionTask, MissionTaskKey };

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
 * ince cizgili bes hucre (biten adimin cizgisi turuncuya doner).
 *
 * 12.11.2026 (ikinci duzeltme) — YUZDE VE CUMLELER GERCEK ADIMLARDAN: yuzde
 * eskiden yalniz gecen sureye gore artiyor (60 sn tahmin), bir dakikada %95'e
 * gelip orada bekliyordu; cumleler de adimlardan bagimsiz donuyordu. Site
 * taramasi AI olcumunu de bekler (her asistana 5 soru, tekrarli) ve birkac
 * dakika surer: iki adim bitmisken ekran dakikalarca "95% · Yayın takvimi
 * planlanıyor" yaziyor, kurulum takilmis gibi gorunuyordu. Artik yuzde biten
 * adimlardan hesaplanir (missionPercent), cumle yalniz suren adimi soyler ve
 * uzun adimda bunun normal oldugu yazilir.
 *
 * `halted`: kurulum ilerleyemiyor (tarayicimiz siteyi okuyamadi). Yuzde ve cumle
 * gosterilmez; ne oldugu soylenir.
 * `complete`: sayfa panele yonlendirmeye karar verdi (konular hazir; takvim arka
 * planda surebilir) — %100 ve "Hazır".
 */
export function MissionWheel({
  tasks,
  startedAt,
  halted,
  complete = false,
  ready = true,
  className,
}: {
  tasks: MissionTask[];
  startedAt: number;
  /**
   * Adimlarin gercek durumu sunucudan geldi mi? Gelmeden once `tasks` yer tutucudur
   * (hepsi bitmemis). Ilk gercek durum bir "adim bitti" olayi DEGILDIR: sayfa
   * kurulumun ortasinda yenilendiyse adim ici pay kurulumun baslangicindan sayilir,
   * sifirdan baslamaz.
   */
  ready?: boolean;
  /** Kurulum durduysa baslik + kisa aciklama; ilerleme gostergesi yerine bu cikar */
  halted?: { title: string; detail: string } | null;
  /** Yonlendirme basladi: adimlarin hepsi bitmemis olsa da %100 gosterilir */
  complete?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [msgIdx, setMsgIdx] = useState(0);
  const [, setTick] = useState(0);
  const labelRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<string>('');

  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = complete || doneCount === tasks.length;

  // Suren adimin ne zaman basladigi: biten adim sayisi degisince sifirlanir. Gercek
  // durum gelene kadar (ready) sayac kurulmaz; ilk gercek durumda baslangic kurulumun
  // baslangicidir (yenilenen sayfada suren adimin ne zaman basladigi bilinmez).
  const stepRef = useRef<{ count: number; at: number; seeded: boolean }>({ count: doneCount, at: startedAt, seeded: false });
  if (ready && !stepRef.current.seeded) stepRef.current = { count: doneCount, at: startedAt, seeded: true };
  else if (stepRef.current.seeded && stepRef.current.count !== doneCount) stepRef.current = { count: doneCount, at: Date.now(), seeded: true };

  // Saniyede bir yeniden ciz: adim ici pay ilerlesin
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Suren adimin birden cok cumlesi varsa 4 saniyede bir doner
  useEffect(() => {
    const id = setInterval(() => setMsgIdx((i) => i + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const messages = activeMessages(tasks);
  const message = messages[msgIdx % messages.length];

  // Cumle degisince kisa gecis
  useEffect(() => {
    if (reduced || !labelRef.current) return;
    if (lastMsgRef.current && lastMsgRef.current !== message) {
      animate(labelRef.current, {
        opacity: [{ to: 0, duration: 200 }, { to: 1, duration: 400 }],
        translateY: [{ to: -6, duration: 200 }, { to: 0, duration: 400, ease: 'outQuad' }],
      });
    }
    lastMsgRef.current = message;
  }, [message, reduced]);

  const sinceStepMs = Date.now() - stepRef.current.at;
  const pct = allDone ? 100 : missionPercent(doneCount, tasks.length, sinceStepMs);
  const active = activeTaskKeys(tasks);
  // En uzun adim: site taramasi AI olcumunu de bekler
  const longStep = !allDone && active.includes('audit') && !active.includes('brain') && sinceStepMs > LONG_STEP_NOTE_AFTER_MS;

  return (
    <div className={cn('relative w-full', className)}>
      {halted ? (
        /* Kurulum durdu: yuzde ve cumle yok, ne oldugu yazar */
        <div className="pt-6 text-center sm:pt-10" role="status">
          <p className="text-vitrin-1">{halted.title}</p>
          <p className="mx-auto mt-6 max-w-md text-vitrin-3 text-muted-foreground">{halted.detail}</p>
        </div>
      ) : (
        <>
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
            <p className="v-rail mt-4">
              {tasks.length} adımdan {doneCount} tanesi tamamlandı
            </p>
          </div>

          {/* Suren adimin durum cumlesi */}
          <div ref={labelRef} className="mt-6 text-center">
            <p className="text-vitrin-3">
              {allDone ? 'Hazır! Yönlendiriliyorsun…' : message}
              {!allDone && <span className="text-dim motion-safe:animate-pulse">…</span>}
            </p>
          </div>
          {longStep && (
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
              En uzun adım bu: site taranırken AI asistanlarına sorular sorulur. Birkaç dakika sürebilir; kurulum ilerliyor.
            </p>
          )}
        </>
      )}

      {/* Adimlar — gercek bir sira: bes hucre, biten adimin ust cizgisi turuncu */}
      <ol className="mx-auto mt-12 grid max-w-3xl sm:grid-cols-5">
        {tasks.map((t) => {
          const Icon = TASK_ICON[t.key];
          const running = !t.done && !halted && !allDone && active.includes(t.key);
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
                  // Sirasi gelmis adimin ikonu atar; sirasini bekleyen adim durur
                  <Icon className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', running && 'motion-safe:animate-pulse')} aria-hidden />
                )}
                <span className={t.done || running ? 'text-foreground' : 'text-muted-foreground'}>{t.label}</span>
                <span className="sr-only">{t.done ? '(tamamlandı)' : running ? '(sürüyor)' : '(bekliyor)'}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {!halted && (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Tarayıcıyı kapatabilirsin — işlem arka planda devam eder. Hazır olunca panele yönlendirileceksin.
        </p>
      )}
    </div>
  );
}
