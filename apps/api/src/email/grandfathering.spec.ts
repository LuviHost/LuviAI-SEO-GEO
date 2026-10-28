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

  it('ozellikler plana gore: Buyume planina Video/Apple Search Ads yazilmaz', () => {
    expect(eskiFiyatBilgisi('STARTER')!.ozellikler.join(' ')).not.toMatch(/Video|Apple Search Ads/);
    expect(eskiFiyatBilgisi('PRO')!.ozellikler.join(' ')).toMatch(/Video/);
    expect(eskiFiyatBilgisi('PRO')!.ozellikler.join(' ')).toMatch(/Apple Search Ads/);
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
    const { html } = render('grandfathering_expired', { name: 'Ada', legacyPriceTry: 2999, newPriceUsd: 149, planName: 'Büyüme' });
    expect(html).toContain('$149');
    expect(html).toContain('TCMB');
  });
});
