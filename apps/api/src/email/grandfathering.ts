/**
 * Eski fiyat korumasi (grandfathering) e-postalarinin yeni fiyat + ozellik bilgisi — saf.
 *
 * NEDEN (28.10.2026): email.cron.ts "yeni fiyat"i sabit TL tablosundan aliyordu
 * (PRO 4999 TL). Gercek fiyat plans.ts'teki USD x odeme gunu TCMB kuru — e-posta
 * yeni fiyati ~3 kat dusuk gosteriyordu. Ayrica ozellik listesi her plana Profesyonel
 * ozelliklerini (Video, Apple Search Ads) "planina dahil" diye yaziyordu.
 * Artik tek kaynak plans.ts: fiyat USD olarak, ozellikler planHasFeature ile.
 *
 * 11.11.2026 (uc paket): "Daha yüksek aylık makale kotası" her ucretli plana yaziliyordu;
 * Baslangic'ta makale uretimi yok (articlesPerMonth 0) — madde yalniz makale hakki olan plana yazilir.
 * Ayni gun: "Takılan sayfa kurtarma" da her ucretli plana yaziliyordu; ozellik Profesyonel ve
 * ustunde (FEATURE_MIN_PLAN.stuckPages). AI gorunurluk takibi her planda oldugu icin ayri madde.
 */
import { BASE_PLANS, planHasFeature, type PlanId } from '../billing/plans.js';

export interface EskiFiyatBilgisi {
  planId: PlanId;
  planAdi: string;
  yeniFiyatUsd: number;
  ozellikler: string[];
}

/** Ucretli plan degilse (TRIAL/bilinmeyen) null: bu kullaniciya "yeni fiyat" e-postasi gitmez */
export function eskiFiyatBilgisi(plan: string | null | undefined): EskiFiyatBilgisi | null {
  const p = BASE_PLANS.find((x) => x.id === String(plan ?? '').toLowerCase());
  if (!p || p.monthly_usd <= 0) return null;
  const id = p.id as PlanId;
  const ozellikler = [
    ...(p.articlesPerMonth > 0 ? ['Daha yüksek aylık makale kotası'] : []),
    'AI görünürlük takibi',
    ...(planHasFeature(id, 'stuckPages') ? ['Takılan sayfa kurtarma'] : []),
  ];
  if (planHasFeature(id, 'articleVideo')) ozellikler.push('RanksUp Video');
  if (planHasFeature(id, 'asaEnabled')) ozellikler.push('ASO, Apple Search Ads ve App Store Connect entegrasyonu');
  return { planId: id, planAdi: p.name_tr, yeniFiyatUsd: p.monthly_usd, ozellikler };
}
