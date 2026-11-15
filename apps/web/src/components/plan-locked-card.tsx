'use client';

import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { UpgradeButton } from '@/components/upgrade-gate';
import type { FeatureRequirement } from '@/lib/entitlements';
import { requirementOffer } from '@/lib/plan-limit';

/**
 * Kilitli ozellik karti — plan yetmedigi icin acilamayan sayfanin yerine.
 *
 * Metindeki plan adi ve ozellik etiketi SABIT YAZILMAZ; ikisi de
 * entitlements.required'dan yani sunucudan gelir. Plan yeniden adlandirilinca
 * (Baslangic -> Buyume ornegindeki gibi) bu kart kendiliginden duzelir.
 *
 * Dugme (15.11.2026): eskiden her ozellikte "Planları gör" yazip musteriyi panelden
 * cikarip fiyat sayfasina atiyordu — teklifle satilan Kurumsal ozelliklerinde (Ürün Radarı,
 * Canlı Tarayıcı) bile. Artik yol sunucudan (requirement.offer): kartla alinan planda
 * "Profesyonel'e geç" (panel ici plan penceresi), teklifle satilan planda "Teklif al".
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
  const sentence = planName
    ? `${label}, ${planName} planına dahildir.`
    : 'Bu özellik mevcut planında bulunmuyor.';

  return (
    <div className="flex justify-center py-10">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="h-11 w-11 mx-auto rounded-md border border-border text-muted-foreground grid place-items-center">
            <Lock className="h-5 w-5" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-panel-2">{label}</h2>
            <p className="text-sm text-muted-foreground">{sentence}</p>
          </div>

          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}

          {/* Kartin tek eylemi: birincil (turuncu) dugme */}
          <UpgradeButton offer={requirementOffer(requirement)} reason={sentence} size="default" variant="default" className="w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
