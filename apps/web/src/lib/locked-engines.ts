/**
 * Ucretsiz testin SORMADIGI asistanlar — sonuc ekraninda kilitli gosterilir. Saf, test edilir
 * (locked-engines.spec.mts).
 *
 * SAHIP ISTEGI (15.11.2026): "ücretsiz taramada 4 AI var, premiumda 7. Bunu da orada
 * gösterelim ama kilitli gözüksün; sadece o paket için geçerli diye yazsın."
 *
 * DURUSTLUK KURALI: liste ve plan adi SUNUCUDAN gelir (GET /billing/plans → plans[].engines:
 * o planin SU AN olctugu asistanlar; api billing/measured-engines.ts). Web asistan / plan
 * tablosu tutmaz: Meta'nin asistani yalniz anahtari tanimliyken olculur, sabit bir "7" bos vaat
 * olabilirdi. Plan listesi okunamazsa ya da `engines` alani yoksa (eski API) kilitli asistan
 * GOSTERILMEZ; ekran bugunku haline duser.
 *
 * Kilitli asistan bir SONUC degildir: olculmedi. Skora, "x / y" sayisina ve "N motorun K
 * tanesinde anıldın" cumlesine girmez (components/citation/query-card.tsx ayri cizer).
 */

export interface PlanEngines {
  id: string;
  name: string;
  /** Bu planin su an olctugu asistanlar (saglayici kimlikleri); eski API yanitinda yok */
  engines?: readonly string[] | null;
}

export interface LockedEngine {
  /** Saglayici kimligi (openai, xai, deepseek, meta …) */
  provider: string;
  /** Bu asistani olcen EN DUSUK planin adi (sunucunun yerellestirdigi ad) */
  planName: string;
}

/**
 * `asked`: bu testte sorulan asistanlar (hata veren dahil — ona soruldu, kilitli degil).
 * `plans`: sunucunun sirasiyla (dusukten yuksege) plan listesi. Her kilitli asistan, onu
 * olcen ILK (en dusuk) planin adiyla doner; sira planlarin `engines` sirasidir.
 */
export function lockedEnginesFrom(plans: readonly PlanEngines[] | null | undefined, asked: Iterable<string>): LockedEngine[] {
  const askedSet = new Set(asked);
  // Hic asistan sorulmadiysa (bos sonuc) karsilastirilacak bir sey yok
  if (!plans || askedSet.size === 0) return [];
  const seen = new Set<string>();
  const out: LockedEngine[] = [];
  for (const plan of plans) {
    if (!plan || typeof plan.name !== 'string' || !plan.name.trim() || !Array.isArray(plan.engines)) continue;
    for (const provider of plan.engines) {
      if (typeof provider !== 'string' || !provider || askedSet.has(provider) || seen.has(provider)) continue;
      seen.add(provider);
      out.push({ provider, planName: plan.name });
    }
  }
  return out;
}

/** Kilitli asistanlari plan adina gore grupla (ekranda grup basina tek not yazilir) */
export function groupLockedByPlan(locked: readonly LockedEngine[]): Array<{ planName: string; providers: string[] }> {
  const groups: Array<{ planName: string; providers: string[] }> = [];
  for (const e of locked) {
    const g = groups.find((x) => x.planName === e.planName);
    if (g) g.providers.push(e.provider);
    else groups.push({ planName: e.planName, providers: [e.provider] });
  }
  return groups;
}

/**
 * Bir planin su an olctugu asistan sayisi ("Profesyonel ve üstü N AI motorunda ölçer").
 * Plan ya da `engines` yoksa null: cagiran sayiyi uydurmaz.
 */
export function planEngineCount(plans: readonly PlanEngines[] | null | undefined, planId: string): number | null {
  const plan = plans?.find((p) => p?.id === planId);
  return plan && Array.isArray(plan.engines) && plan.engines.length > 0 ? plan.engines.length : null;
}
