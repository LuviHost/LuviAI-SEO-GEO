'use client';

import Link from 'next/link';
import { Lock, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { FeatureRequirement } from '@/lib/entitlements';

/**
 * Kilitli ozellik karti — plan yetmedigi icin acilamayan sayfanin yerine.
 *
 * Metindeki plan adi ve ozellik etiketi SABIT YAZILMAZ; ikisi de
 * entitlements.required'dan yani sunucudan gelir. Plan yeniden adlandirilinca
 * (Baslangic -> Buyume ornegindeki gibi) bu kart kendiliginden duzelir.
 */
export function PlanLockedCard({
  requirement,
  description,
}: {
  requirement: FeatureRequirement | null;
  /** Ozelligin ne ise yaradigi — musteri neye para verecegini gorsun */
  description?: string;
}) {
  // requirement yoksa (beklenmedik) ozellik adini soylemeden genel metne dus
  const label = requirement?.label ?? 'Bu özellik';
  const planName = requirement?.planName;

  return (
    <div className="flex justify-center py-10">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="h-12 w-12 mx-auto rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 grid place-items-center">
            <Lock className="h-5 w-5" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{label}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {planName
                ? `${label}, ${planName} planına dahildir.`
                : 'Bu özellik mevcut planında bulunmuyor.'}
            </p>
          </div>

          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}

          <Button asChild className="w-full">
            <Link href="/pricing">
              Planları gör
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
