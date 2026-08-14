'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Plan kapisi — WEB TARAFI SADECE OKUR.
 *
 * NEDEN BU DOSYADA MIN-PLAN TABLOSU YOK: hangi ozelligin hangi planda
 * oldugu bilgisi yalnizca apps/api/src/billing/plans.ts'te (FEATURE_MIN_PLAN)
 * yasar ve /api/me ile hazir gelir. Ayni tabloyu buraya kopyalamak, bu projede
 * defalarca yasanmis "iki tablo birbirinden kaydi" hatasinin ta kendisi
 * (fiyat kartlari, SEO metadata, /compare, /terms hepsi boyle bozulmustu).
 * Burada yalnizca OZELLIK ISIMLERI var — isim listesi kaymaz, cunku yanlis
 * isim derleme hatasi verir; yanlis min-plan ise sessizce yanlis ekran uretir.
 */
export type PlanFeature =
  | 'asaEnabled' | 'ascEnabled' | 'appPromptLab' | 'screenshotStudio'
  | 'agentReadiness' | 'stuckPages' | 'contentOpportunities'
  | 'programmaticSeo' | 'productRadar' | 'geoHeatmap' | 'liveCrawler'
  | 'costAnalytics' | 'mcpAccess' | 'apiAccess' | 'byok';

/** Kapali ozellik icin kullaniciya gosterilecek metnin kaynagi — sunucudan gelir. */
export type FeatureRequirement = {
  plan: string;
  /** "Ajans" gibi plan adi — plan yeniden adlandirilinca arayuz kendiliginden duzelir */
  planName: string;
  /** "Product Radar" gibi ozellik adi */
  label: string;
};

export type Entitlements = {
  plan: string;
  features: Record<PlanFeature, boolean>;
  required: Record<PlanFeature, FeatureRequirement>;
};

/**
 * Ozellik durumu ucu deger:
 *   true  -> acik
 *   false -> KESIN kapali (kilit gosterilebilir)
 *   null  -> henuz bilinmiyor (yukleniyor) — kilit GOSTERME, veri de CEKME
 */
export type FeatureState = boolean | null;

type Status = 'loading' | 'ready' | 'error';

/**
 * Modul-ici cache.
 *
 * NEDEN CONTEXT DEGIL: /me tum oturum boyunca degismeyen bir cevap ve kilit
 * kontrolu birbirinden uzak yerlerde (sidebar + her sayfa) lazim. Context
 * secseydik app'i saran yeni bir provider ve her tuketiciyi provider agacina
 * baglama zorunlulugu gelirdi. Tek bir paylasilan promise, provider'siz olarak
 * ayni iki garantiyi veriyor: (1) oturumda TEK istek — es zamanli cagiran
 * bilesenler ayni promise'i bekler, (2) sonradan mount olan bilesen cozulmus
 * promise'ten aninda deger alir, yani yeniden istek ve flicker olmaz.
 */
let cache: Promise<Entitlements | null> | null = null;

function load(): Promise<Entitlements | null> {
  if (!cache) {
    cache = api
      .getMe()
      .then((me: any) => (me?.entitlements as Entitlements) ?? null)
      // Hata yutuluyor ve null donuyor: asagida "izin verici" moda dusuyoruz.
      .catch(() => null);
  }
  return cache;
}

/** Plan degisince (yukseltme sonrasi) haklari tazelemek icin. */
export function invalidateEntitlements() {
  cache = null;
}

export type UseEntitlements = {
  entitlements: Entitlements | null;
  status: Status;
  /** Ozellik acik mi — bilinmiyorsa null (bkz. FeatureState) */
  can: (feature: PlanFeature) => FeatureState;
  /** Kapali ozellik icin plan adi/etiket; bilinmiyorsa null */
  requirementFor: (feature: PlanFeature) => FeatureRequirement | null;
};

export function useEntitlements(): UseEntitlements {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    load().then((ent) => {
      if (!alive) return;
      setEntitlements(ent);
      setStatus(ent ? 'ready' : 'error');
    });
    return () => { alive = false; };
  }, []);

  const can = (feature: PlanFeature): FeatureState => {
    // Yuklenirken "bilinmiyor": menude hicbir sey oynamaz (flicker yok),
    // sayfa da kilit karti basmaz — ikisi de yanlis bilgi vermektense bekler.
    if (status === 'loading') return null;
    // /me alinamadiysa IZIN VERICI davran. Gercek kapi sunucuda (RequiresPlan
    // guard'i); web'deki kapi sadece deneyim icin. Gecici bir ag hatasi
    // yuzunden odenmis ozelligi kilitlemek, kilitliyi acik gostermekten
    // cok daha kotu.
    if (status === 'error' || !entitlements) return true;
    return entitlements.features[feature] ?? true;
  };

  const requirementFor = (feature: PlanFeature): FeatureRequirement | null =>
    entitlements?.required?.[feature] ?? null;

  return { entitlements, status, can, requirementFor };
}
