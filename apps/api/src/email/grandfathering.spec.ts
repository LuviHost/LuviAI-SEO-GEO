import { describe, it, expect } from 'vitest';
import { eskiFiyatBilgisi } from './grandfathering.js';
import { BASE_PLANS } from '../billing/plans.js';
import { EmailService } from './email.service.js';

/**
 * 28.10.2026: e-posta "yeni fiyat"i sabit TL tablosundan aliyordu (PRO 4999 TL ≈ gercegin 1/3'u)
 * ve her plana Profesyonel ozelliklerini yaziyordu. Kaynak artik plans.ts.
 */
describe('eskiFiyatBilgisi', () => {
  it('yeni fiyat plans.ts USD fiyatidir', () => {
    for (const id of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE']) {
      expect(eskiFiyatBilgisi(id)!.yeniFiyatUsd).toBe(BASE_PLANS.find((p) => p.id === id.toLowerCase())!.monthly_usd);
    }
  });

  it('ozellikler plana gore: Baslangic planina Video/Apple Search Ads yazilmaz', () => {
    expect(eskiFiyatBilgisi('STARTER')!.ozellikler.join(' ')).not.toMatch(/Video|Apple Search Ads/);
    expect(eskiFiyatBilgisi('PRO')!.ozellikler.join(' ')).toMatch(/Video/);
    expect(eskiFiyatBilgisi('PRO')!.ozellikler.join(' ')).toMatch(/Apple Search Ads/);
  });

  // 11.11.2026 (uc paket): Baslangic'ta makale uretimi yok — "daha yuksek makale kotasi" yazilamaz
  it('makale kotasi maddesi yalniz makale hakki olan plana yazilir (Baslangic: yok)', () => {
    for (const p of BASE_PLANS) {
      if (p.monthly_usd <= 0) continue;
      const metin = eskiFiyatBilgisi(p.id.toUpperCase())!.ozellikler.join(' ');
      if (p.articlesPerMonth > 0) expect(metin, p.id).toContain('Daha yüksek aylık makale kotası');
      else expect(metin, p.id).not.toMatch(/makale/i);
    }
    expect(BASE_PLANS.find((p) => p.id === 'starter')!.articlesPerMonth).toBe(0);
    expect(eskiFiyatBilgisi('STARTER')!.ozellikler.join(' ')).not.toMatch(/makale/i);
    expect(eskiFiyatBilgisi('STARTER')!.planAdi).toBe('Başlangıç');
  });

  // "Takılan sayfa kurtarma" eskiden her ucretli plana yaziliyordu; ozellik Profesyonel ve ustunde
  it('takilan sayfa kurtarma yalniz ozelligi olan plana yazilir; AI gorunurluk takibi her ucretli planda', async () => {
    const { BASE_PLANS, planHasFeature } = await import('../billing/plans.js');
    for (const p of BASE_PLANS.filter((x) => x.monthly_usd > 0)) {
      const metin = eskiFiyatBilgisi(p.id.toUpperCase())!.ozellikler.join(' | ');
      expect(metin, p.id).toContain('AI görünürlük takibi');
      expect(/Takılan sayfa/.test(metin), p.id).toBe(planHasFeature(p.id, 'stuckPages'));
    }
    expect(eskiFiyatBilgisi('STARTER')!.ozellikler.join(' ')).not.toContain('Takılan sayfa');
  });

  it('ucretli plan degilse null (e-posta gitmez)', () => {
    expect(eskiFiyatBilgisi('TRIAL')).toBeNull();
    expect(eskiFiyatBilgisi('BILINMEYEN')).toBeNull();
    expect(eskiFiyatBilgisi(null)).toBeNull();
  });
});

describe('grandfathering sablonlari', () => {
  const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
  const render = (t: string, d: Record<string, any>) => (svc as any).renderTemplate(t, d) as { subject: string; html: string };

  it('uyari: USD yeni fiyat, kur notu, plana ozel ozellikler; eski TL sabiti yok', () => {
    const b = eskiFiyatBilgisi('PRO')!;
    const { html } = render('grandfathering_expiring', {
      name: 'Ada', expiryDateText: '28 Kasım 2026', legacyPriceTry: 2999,
      newPriceUsd: b.yeniFiyatUsd, planName: b.planAdi, features: b.ozellikler,
    });
    expect(html).toContain('$349');
    expect(html).toContain('TCMB');
    expect(html).toContain('RanksUp Video');
    expect(html).not.toContain('4.999');
  });

  it('gecti: USD yeni fiyat ve kur notu', () => {
    // Plan adi ve fiyat plans.ts'ten (11.11.2026: Büyüme $149 → Başlangıç $99)
    const b = eskiFiyatBilgisi('STARTER')!;
    expect(b).toMatchObject({ planAdi: 'Başlangıç', yeniFiyatUsd: 99 });
    const { html } = render('grandfathering_expired', { name: 'Ada', legacyPriceTry: 2999, newPriceUsd: b.yeniFiyatUsd, planName: b.planAdi });
    expect(html).toContain('$99');
    expect(html).not.toContain('$149');
    expect(html).toContain('TCMB');
  });
});
