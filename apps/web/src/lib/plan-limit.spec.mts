/**
 * Plan siniri: duvara carpan dugmenin ne diyecegi (sahip istegi 15.11.2026).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 *
 * Sabitlenen kural: satis yalniz SUNUCUNUN "bu plan kaldirir" dedigi yerde onerilir; web
 * yolu uydurmaz. Paket almanin kaldirmadigi sinirda ('wait', haftalik olcum hakki) satis
 * dugmesi ve plan penceresi cikmaz; satin alma kapaliyken "…'e geç" denmez.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// API'nin tek kaynagi dogrudan okunur (plan-lock.spec.mts ile ayni yol)
import { publicPlans } from '../../../api/src/billing/plans';
import { PLAN_LIMIT_CODE as API_CODE, upgradeOfferFor } from '../../../api/src/billing/plan-limit';
import { generationLock, GENERATION_LOCK_COPY } from './article-allowance';
import {
  LIMIT_COPY, PLAN_LIMIT_CODE, dativeOf, planLimitRequest, readUpgradeOffer, requirementOffer, upgradeAction, upgradeLabel, upgradeOfferOfError,
} from './plan-limit';

const buy = { kind: 'buy', planId: 'pro', planName: 'Profesyonel' } as const;
const quote = { kind: 'quote', planId: 'enterprise', planName: 'Kurumsal' } as const;
const wait = { kind: 'wait', planId: null, planName: null } as const;
const body = (upgrade: unknown, extra: Record<string, unknown> = {}) => ({ statusCode: 403, code: PLAN_LIMIT_CODE, message: 'Plan sınırı.', upgrade, ...extra });

describe('sunucu ile ayni sozlesme', () => {
  it('makine kodu API ile ayni', () => {
    expect(PLAN_LIMIT_CODE).toBe(API_CODE);
  });

  it('sunucunun urettigi her yukseltme yolu web tarafinda okunur', () => {
    for (const from of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      const offer = upgradeOfferFor(from, (p) => p.articlesPerMonth > 0 && p.sites > 1);
      expect(readUpgradeOffer(JSON.parse(JSON.stringify(offer))), from).toEqual(offer);
    }
  });
});

describe('readUpgradeOffer — yol uydurulmaz', () => {
  it('bicim disi ya da eksik alan null', () => {
    for (const raw of [null, undefined, 'buy', 42, {}, { kind: 'satin-al', planName: 'Profesyonel' }, { kind: 'buy' }, { kind: 'quote', planName: '  ' }]) {
      expect(readUpgradeOffer(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('"wait" plan adi tasimaz', () => {
    expect(readUpgradeOffer({ kind: 'wait', planId: 'pro', planName: 'Profesyonel' })).toEqual({ kind: 'wait', planId: 'pro', planName: null });
    expect(readUpgradeOffer(wait)).toEqual(wait);
  });

  it('hata govdesinden okunur (kod ne olursa olsun: AI butcesi ve Asistan notu da tasir)', () => {
    expect(upgradeOfferOfError({ code: 'CHAT_MESSAGE_LIMIT', upgrade: buy })).toEqual(buy);
    expect(upgradeOfferOfError({ code: 'CHAT_MESSAGE_LIMIT' })).toBeNull();
    expect(upgradeOfferOfError('Forbidden')).toBeNull();
  });
});

describe('planLimitRequest — plan penceresi ne zaman acilir', () => {
  it('degistiren istekte 403 + PLAN_LIMIT + satis yolu: acilir, sunucunun cumlesi neden olur', () => {
    expect(planLimitRequest(403, 'POST', body(buy))).toEqual({ offer: buy, reason: 'Plan sınırı.', fromError: true });
    expect(planLimitRequest(403, 'put', body(quote))?.offer).toEqual(quote);
    expect(planLimitRequest(403, 'DELETE', body(buy))?.offer).toEqual(buy);
  });

  it('okuma isteginde ACILMAZ: sayfaya giren musterinin onune satis penceresi firlamaz', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS', undefined, null, '']) {
      expect(planLimitRequest(403, method, body(buy)), String(method)).toBeNull();
    }
  });

  it('"wait" pencere acmaz: satilacak bir sey yok', () => {
    expect(planLimitRequest(403, 'POST', body(wait))).toBeNull();
  });

  it('baska durum kodu, baska makine kodu ya da yolsuz govde acmaz', () => {
    expect(planLimitRequest(429, 'POST', body(buy))).toBeNull();
    expect(planLimitRequest(403, 'POST', body(buy, { code: 'TRIAL_EXPIRED' }))).toBeNull();
    expect(planLimitRequest(403, 'POST', body(buy, { code: 'WEEKLY_MEASUREMENT_LIMIT' }))).toBeNull();
    expect(planLimitRequest(403, 'POST', { code: PLAN_LIMIT_CODE, message: 'x' })).toBeNull();
    expect(planLimitRequest(403, 'POST', 'Forbidden')).toBeNull();
    expect(planLimitRequest(403, 'POST', null)).toBeNull();
  });
});

describe('upgradeLabel — dugmenin etiketi', () => {
  it('kartla alinan plan: "…\'e geç"', () => {
    expect(upgradeLabel(buy, true)).toBe("Profesyonel'e geç");
    expect(upgradeLabel({ kind: 'buy', planId: 'starter', planName: 'Başlangıç' }, true)).toBe("Başlangıç'a geç");
  });

  it('satin alma KAPALIYKEN "geç" denmez: "Bize yaz"', () => {
    expect(upgradeLabel(buy, false)).toBe(LIMIT_COPY.contact);
  });

  it('satin alma durumu BILINMIYORKEN "geç" denmez (yukleniyor / okunamadi): notr etiket', () => {
    // Test modunda her musteri ilk cizimde bos vaat gorurdu; durum gelince etiket kesinlesir
    expect(upgradeLabel(buy, null)).toBe(LIMIT_COPY.plans);
    expect(upgradeLabel(buy, null)).not.toMatch(/geç/);
  });

  it('teklifle satilan plan: satin alma durumundan bagimsiz "Teklif al"', () => {
    expect(upgradeLabel(quote, true)).toBe(LIMIT_COPY.quote);
    expect(upgradeLabel(quote, false)).toBe(LIMIT_COPY.quote);
  });

  it('yol yoksa / bilinmiyorsa satis vaat edilmez: "Planları gör"', () => {
    expect(upgradeLabel(null, true)).toBe(LIMIT_COPY.plans);
    expect(upgradeLabel(undefined, false)).toBe(LIMIT_COPY.plans);
    expect(upgradeLabel(wait, true)).toBe(LIMIT_COPY.plans);
  });
});

describe('upgradeAction — kilitli dugme ne yapar', () => {
  it('"wait": satis penceresi ACILMAZ, dugme pasif', () => {
    // En ust plandaki musteriye altindaki planlar "Bu plana geç" diye sunulmaz
    for (const open of [true, false, null]) {
      expect(upgradeAction(wait, open)).toEqual({ mode: 'none', label: LIMIT_COPY.atLimit });
    }
  });

  it('bilinen yol: pencere o yolla acilir, etiket satin alma durumuna gore', () => {
    expect(upgradeAction(buy, true)).toEqual({ mode: 'window', label: "Profesyonel'e geç", offer: buy });
    expect(upgradeAction(buy, false)).toEqual({ mode: 'window', label: LIMIT_COPY.contact, offer: buy });
    expect(upgradeAction(quote, false)).toEqual({ mode: 'window', label: LIMIT_COPY.quote, offer: quote });
  });

  it('yol yok (eski API): pencere ISARETSIZ acilir, etiket satis vaat etmez', () => {
    for (const offer of [null, undefined]) {
      const a = upgradeAction(offer, true);
      expect(a).toEqual({ mode: 'window', label: LIMIT_COPY.plans, offer: { kind: 'buy', planId: null, planName: null } });
    }
  });
});

describe('dativeOf — plan adina yonelme eki', () => {
  it('satistaki her plan adi icin dogru ek', () => {
    const beklenen: Record<string, string> = { 'Başlangıç': "Başlangıç'a", Profesyonel: "Profesyonel'e", Kurumsal: "Kurumsal'a" };
    for (const p of publicPlans().filter((x) => x.id !== 'trial')) {
      expect(beklenen[p.name_tr], `yeni plan adi "${p.name_tr}" icin beklenen ek teste eklenmeli`).toBeDefined();
      expect(dativeOf(p.name_tr)).toBe(beklenen[p.name_tr]);
    }
  });

  it('unlu uyumu ve kaynastirma', () => {
    expect(dativeOf('Ajans')).toBe("Ajans'a");
    expect(dativeOf('Büyüme')).toBe("Büyüme'ye");
    expect(dativeOf('Pro')).toBe("Pro'ya");
    expect(dativeOf('Ekip')).toBe("Ekip'e");
    expect(dativeOf(' Kurumsal ')).toBe("Kurumsal'a");
  });
});

describe('requirementOffer — kilitli ozelligin yolu /me haklarindan', () => {
  it('offer alani yolu belirler', () => {
    expect(requirementOffer({ plan: 'pro', planName: 'Profesyonel', label: 'Ajan Hazırlığı', offer: 'buy' })).toEqual(buy);
    expect(requirementOffer({ plan: 'enterprise', planName: 'Kurumsal', label: 'Ürün Radarı', offer: 'quote' })).toEqual(quote);
  });

  it('eski API (offer yok) ya da kayit yok: null — dugme "Planları gör" der', () => {
    expect(requirementOffer({ plan: 'pro', planName: 'Profesyonel', label: 'x' })).toBeNull();
    expect(requirementOffer(null)).toBeNull();
    expect(upgradeLabel(requirementOffer(null), true)).toBe(LIMIT_COPY.plans);
  });
});

describe('makale dugmesi — yol sunucudan, eski musteriye dogru hitap', () => {
  const bitti = { limit: 2, remaining: 0, used: 2 };

  it('kilit yukseltme yolunu tasir; yol yoksa null (satis uydurulmaz)', () => {
    expect(generationLock(bitti, 'TRIAL', undefined, { upgrade: buy }).offer).toEqual(buy);
    expect(generationLock({ limit: 40, remaining: 0, used: 40 }, 'PRO', undefined, { upgrade: quote }).offer).toEqual(quote);
    expect(generationLock({ limit: 0, remaining: 0, used: 0 }, 'STARTER', undefined, { upgrade: buy }).offer).toEqual(buy);
    expect(generationLock(bitti, 'TRIAL').offer).toBeNull();
    expect(generationLock(bitti, 'TRIAL', undefined, { upgrade: { kind: 'bedava' } }).offer).toBeNull();
  });

  it('plani biten eski musteriye "ücretsiz deneme" denmez', () => {
    const lapsed = generationLock({ limit: 2, remaining: 0, used: 9 }, { id: 'trial' }, undefined, { upgrade: buy, phase: 'lapsed' });
    expect(lapsed.locked).toBe(true);
    expect(lapsed.hint).toBe(GENERATION_LOCK_COPY.lapsed);
    expect(lapsed.hint).not.toMatch(/ücretsiz deneme/i);
    expect(lapsed.hint).toContain('Planın sona erdi');
    // Gercek deneme hesabi eski metni gorur
    expect(generationLock(bitti, 'TRIAL', undefined, { upgrade: buy, phase: 'expired' }).hint).toBe(GENERATION_LOCK_COPY.trial(2));
    expect(generationLock(bitti, 'TRIAL', undefined, { upgrade: buy, phase: 'trial' }).hint).toBe(GENERATION_LOCK_COPY.trial(2));
  });

  it('yol kilit durumundan BAGIMSIZ tasinir: takvimde plana kilitli yazilar hak bitmeden de vardir', () => {
    // Denemenin ilk gunu: uretim dugmesi acik, ama takvimdeki kilitli satirlarin dugmesi yolu buradan okur
    const acik = generationLock({ limit: 2, remaining: 2, used: 0 }, 'TRIAL', undefined, { upgrade: buy });
    expect(acik.locked).toBe(false);
    expect(acik.offer).toEqual(buy);
    // Yayin hedefi bekleniyor: dugme yayin hedeflerine gider, yol yine tasinir
    const kaynak = generationLock({ limit: 2, remaining: 2, used: 0 }, 'TRIAL', {
      readiness: { requiresSource: true, ready: false, message: null }, publishTargetsHref: '/sites/s1/publish-targets',
    }, { upgrade: buy });
    expect(kaynak.reason).toBe('source_required');
    expect(kaynak.href).toBe('/sites/s1/publish-targets');
    expect(kaynak.offer).toEqual(buy);
    // Kota okunamadi: kilit yok, yol tasinir
    expect(generationLock(null, 'TRIAL', undefined, { upgrade: buy }).offer).toEqual(buy);
  });

  it('aylik hak bitti: metin yola gore — teklifle satilan planda "planını yükselt" denmez', () => {
    const q = { limit: 40, remaining: 0, used: 40 };
    expect(generationLock(q, 'PRO', undefined, { upgrade: buy }).hint).toBe(GENERATION_LOCK_COPY.monthly(40));
    const teklif = generationLock(q, 'PRO', undefined, { upgrade: quote });
    expect(teklif.hint).toBe(GENERATION_LOCK_COPY.monthlyQuote(40, 'Kurumsal'));
    expect(teklif.hint).not.toMatch(/planını yükselt/);
    expect(teklif.hint).toContain('teklifle');
    const bekle = generationLock({ limit: 350, remaining: 0, used: 350 }, 'ENTERPRISE', undefined, { upgrade: wait });
    expect(bekle.hint).toBe(GENERATION_LOCK_COPY.monthlyWait(350));
    expect(bekle.hint).not.toMatch(/yükselt|teklif/);
    expect(upgradeAction(bekle.offer, true).mode).toBe('none');
  });
});

describe('panel baglantilari', () => {
  const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('plan penceresi panel duzenine bagli ve API istemcisi plan sinirini duyuruyor', () => {
    expect(src('../app/(dashboard)/layout.tsx')).toContain('<UpgradeGate />');
    const api = src('./api.ts');
    expect(api).toContain('announcePlanLimit(res.status, method, body)');
    // Cok parcali yukleme de bir tiklamanin cevabi: yontem POST olarak gecer
    expect(api).toContain("parseResponse<T>(res, path, 'POST')");
  });

  it('haftalik olcum hakki: dugme tarihi soyler, satis dugmesi yok', () => {
    const page = src('../app/(dashboard)/sites/[id]/visibility/page.tsx');
    expect(page).toContain('<MeasurementWaitLabel />');
    expect(page).toContain('LIMIT_COPY.measurementUsed');
    expect(page).not.toContain('UpgradeButton');
    expect(LIMIT_COPY.measurementUsed('22 Kasım 14:05')).toContain('sonraki ölçüm 22 Kasım 14:05 itibarıyla açılır');
    expect(LIMIT_COPY.nextMeasurement('22 Kasım 14:05')).toBe('Sonraki ölçüm 22 Kasım 14:05');
  });

  it('plan penceresi ortak diyalog altyapisinda: baska bir diyalogun icinden acilinca arkada kalmaz', () => {
    const modal = src('../components/upgrade-plan-modal.tsx');
    expect(modal).toContain("from '@/components/ui/dialog'");
    expect(modal).toContain('<DialogContent');
    // El yapimi tam ekran katman yok (acik bir Radix diyalogu onu tiklanamaz birakiyordu)
    expect(modal).not.toContain('className="fixed inset-0');
    // Musterinin planinin altindaki plan "yukseltme" diye satilmaz
    expect(modal).toContain('disabled={loadingPlan === p.id || !purchase.open || notUpgrade}');
  });

  it('App Store sayfalari: plan yetmese de sekme gorunur (bagli hesap kaldirilabilmeli)', () => {
    for (const [path, tab] of [['../app/(dashboard)/sites/[id]/aso/connect/page.tsx', '<AscTab siteId={site.id} />'], ['../app/(dashboard)/sites/[id]/aso/ads/page.tsx', '<AdsBody siteId={site.id} />']] as const) {
      const page = src(path);
      expect(page, path).toContain(tab);
      expect(page, path).toContain('<UpgradeButton');
      expect(page, path).not.toContain('PlanLockedCard');
    }
  });

  it('odeme tamamlaninca sayfa yenilenir: kilitler eski hakla kalmaz', () => {
    expect(src('../components/upgrade-gate.tsx')).toContain('window.location.reload()');
  });

  it('kilit karti musteriyi panelden cikarmiyor (fiyat sayfasi baglantisi yok)', () => {
    const card = src('../components/plan-locked-card.tsx');
    expect(card).toContain('<UpgradeButton');
    expect(card).not.toContain('/pricing');
  });
});
