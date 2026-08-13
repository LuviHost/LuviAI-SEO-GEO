import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnalyticsService } from './analytics.service.js';

/**
 * GSC veri gecikmesi regresyon testi.
 *
 * OLAN: captureSnapshot varsayilan olarak DUNU (T-1) sorguluyordu. Google
 * Search Console verisi ~2 gun gecikmeli yayinlanir, yani her gece calisan
 * cron her seferinde henuz hazir olmayan bir tarihi soruyordu. Gelen bos
 * yanit sifir snapshot olarak yaziliyor, upsert oldugu icin veri sonradan
 * yayinlandiginda da DUZELMIYORDU.
 *
 * Sonuc: kobipratik'te 3 ay boyunca 36 snapshot'in hepsi 0 tiklama / 0
 * gosterim kaldi; oysa ayni property (sc-domain:kobipratik.com, siteOwner)
 * canli sorguda son 30 gunde 9.811 tiklama / 705.604 gosterim donuyordu.
 *
 * Bu iki davranis bir daha kaymasin:
 *   1. varsayilan tarih en az 2 gun geride olmali
 *   2. GSC bos donduyse snapshot YAZILMAMALI (sifirla ezmemeli)
 */

function svc(overrides: { pageRows?: unknown[]; queryRows?: unknown[] } = {}) {
  const upsert = vi.fn(async () => ({}));
  const prisma = {
    site: {
      findUniqueOrThrow: async () => ({
        id: 's1',
        gscPropertyUrl: 'sc-domain:example.com',
        gscRefreshToken: 'enc',
      }),
    },
    analyticsSnapshot: { upsert },
  };
  const gscOAuth = { getAuthenticatedClient: async () => ({}) };
  const s = new AnalyticsService(prisma as never, gscOAuth as never);
  return { s, upsert, prisma };
}

describe('GSC veri gecikmesi', () => {
  it('varsayilan snapshot tarihi en az 2 gun geride (T-1 sorgulanmaz)', () => {
    const { s } = svc();
    const d: Date = (s as unknown as { defaultSnapshotDate(): Date }).defaultSnapshotDate();

    const bugun = new Date();
    bugun.setUTCHours(0, 0, 0, 0);
    const gunFarki = Math.round((bugun.getTime() - d.getTime()) / 86_400_000);

    expect(gunFarki, 'GSC ~2 gun gecikmeli — T-1 her zaman bos doner').toBeGreaterThanOrEqual(2);
    // UTC gun basina normalize edilmis olmali
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('GSC_LAG_DAYS sabiti emniyet payi birakiyor', () => {
    const lag = (AnalyticsService as unknown as { GSC_LAG_DAYS: number }).GSC_LAG_DAYS;
    expect(lag, 'gecikme 2 gun; 3 gun 1 gunluk pay birakir').toBeGreaterThanOrEqual(3);
  });
});

describe('snapshot sekil tutarliligi', () => {
  it('create ve update dallari AYNI sekli yaziyor', () => {
    const kaynak = readFileSync(
      new URL('./analytics.service.ts', import.meta.url), 'utf8',
    );
    const upsert = kaynak.slice(
      kaynak.indexOf('analyticsSnapshot.upsert'),
      kaynak.indexOf('updateArticleMetrics'),
    );
    // Iki dal da onceden hesaplanmis esleyici degiskenini kullanmali.
    const createSekli = /create:[\s\S]*?pageDetails: (\w+)/.exec(upsert)?.[1];
    const updateSekli = /update:[\s\S]*?pageDetails: (\w+)/.exec(upsert)?.[1];
    expect(createSekli, 'create dali pageDetails yazmiyor').toBeTruthy();
    expect(updateSekli, 'update dali pageDetails yazmiyor').toBeTruthy();
    expect(
      updateSekli,
      'update dali create ile AYNI degiskeni yazmali — ham GSC satiri (pageRows) yazilirsa ' +
      'ayni tarih ikinci kez islendiginde kayit {keys:[...]} sekline donup okuyan tum yuzeyleri bosaltir',
    ).toBe(createSekli);
    expect(upsert.includes('pageDetails: pageRows')).toBe(false);
    expect(upsert.includes('queryDetails: queryRows')).toBe(false);
  });
});
