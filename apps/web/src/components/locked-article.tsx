'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PLAN_LOCK_COPY, UPGRADE_HREF, placeholderParagraphs } from '@/lib/plan-lock';
import type { GenerationLock } from '@/lib/article-allowance';
import { cn } from '@/lib/utils';

/*
 * Plana kilitli takvim yazisi (deneme hesabi toplam 2 makale; kural lib/plan-lock.ts).
 * Gercek konu basligi gorunur; govde yerinde tarayicida uretilen, bulaniklastirilmis
 * yer tutucu metin durur (model cagrisi yok, kayit yok) ve ustunde kilit + yukseltme
 * baglantisi. Ekran okuyucuya yer tutucu okunmaz; yalniz durust aciklama okunur.
 */

/** "Kilitli" rozeti — tablo, ozet ve yazi sayfasi ayni rozeti kullanir */
export function PlanLockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-label font-semibold text-muted-foreground',
        className,
      )}
    >
      <Lock className="h-3 w-3" aria-hidden />
      {PLAN_LOCK_COPY.badge}
    </span>
  );
}

/** Yukseltme baglantisi (fiyatlandirma) */
export function PlanUpgradeButton({ size = 'sm', className }: { size?: 'sm' | 'default'; className?: string }) {
  return (
    <Button asChild size={size} className={className}>
      <Link href={UPGRADE_HREF}>
        <Lock className="h-3.5 w-3.5 mr-1.5" aria-hidden />
        {PLAN_LOCK_COPY.cta}
      </Link>
    </Button>
  );
}

/**
 * Makale hakki bitince uretim dugmesinin yerine gecen kilitli dugme (karar:
 * lib/article-allowance.ts generationLock). Ozgun dugmenin boyutu ve turu korunur,
 * satir/kart duzeni kaymaz. Tiklaninca istek atilmaz (eskiden 403 donuyordu),
 * fiyatlandirmaya gider. Neden kilitli oldugu title'da ve ekran okuyucuda.
 */
export function LockedGenerateButton({
  lock,
  size = 'sm',
  variant,
  className,
}: {
  lock: Pick<GenerationLock, 'label' | 'href' | 'hint'>;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
  className?: string;
}) {
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={lock.href} title={lock.hint ?? undefined}>
        <Lock className="h-3.5 w-3.5 mr-1.5" aria-hidden />
        {lock.label}
        {lock.hint && <span className="sr-only"> — {lock.hint}</span>}
      </Link>
    </Button>
  );
}

/** Tablo satiri icin tek satirlik bulanik onizleme + "yukseltince yazilir" notu */
export function LockedRowPreview({ seed }: { seed: string }) {
  const line = useMemo(() => placeholderParagraphs(seed, { paragraphs: 1, sentences: 1 })[0], [seed]);
  return (
    <div className="mt-1 space-y-0.5">
      <p aria-hidden className="select-none truncate text-label text-muted-foreground blur-sm">{line}</p>
      <p className="inline-flex items-center gap-1 text-label text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden /> {PLAN_LOCK_COPY.rowHint}
      </p>
    </div>
  );
}

/** Yazi sayfasinin govdesi: bulanik yer tutucu + kilit karti */
export function LockedArticleBody({ seed }: { seed: string }) {
  const paragraphs = useMemo(() => placeholderParagraphs(seed, { paragraphs: 5 }), [seed]);
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="min-h-[26rem] p-4 sm:p-8">
        <div aria-hidden className="pointer-events-none select-none space-y-4 blur-sm">
          <div className="h-5 w-2/3 rounded bg-muted" />
          {paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
        </div>
        <div className="absolute inset-0 grid place-items-center bg-background/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-5 text-center shadow-sm">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-brand">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="font-semibold">{PLAN_LOCK_COPY.title}</h3>
            <p className="text-sm text-muted-foreground">{PLAN_LOCK_COPY.body}</p>
            <p className="text-label text-muted-foreground">{PLAN_LOCK_COPY.placeholderNote}</p>
            <PlanUpgradeButton size="default" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
