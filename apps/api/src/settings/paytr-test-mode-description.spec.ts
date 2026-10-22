import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_BY_KEY } from './settings.constants.js';

/**
 * Admin panelindeki PAYTR_TEST_MODE aciklamasi test modunun MUSTERIYE etkisini soyluyor mu.
 *
 * NEDEN VAR: aciklama yalniz PayTR'ye giden test_mode degerini anlatiyordu. Oysa test modu
 * acikken (0 disindaki her deger) satin almayi yalniz yonetici hesaplari baslatabiliyor ve
 * test odemesi yonetici olmayan hicbir hesapta plan acmiyor (paytr.service.ts). Admin panelde
 * "test modu acik" goren biri musterilerin satin alamadigini bilmeliydi. Metin asagidaki kod
 * kosullarina bagli: kod degisirse bu spec kirilir ve aciklama yeni davranisa gore yazilir.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const paytr = fs.readFileSync(path.resolve(HERE, '../billing/paytr.service.ts'), 'utf8');
const desc = SETTINGS_BY_KEY.get('PAYTR_TEST_MODE')!.description;

/** paytr.service.ts icindeki bir yontemin govdesi (bir sonraki yonteme kadar) */
function method(name: string): string {
  const at = paytr.indexOf(`async ${name}(`) >= 0 ? paytr.indexOf(`async ${name}(`) : paytr.indexOf(`${name}(`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  return paytr.slice(at, at + 2500);
}

describe('PAYTR_TEST_MODE aciklamasi — test modunda kimin satin alabildigini soyler', () => {
  it('test modu acikken yalniz yonetici satin alir, test odemesi baskasina plan acmaz, yenileme denenmez', () => {
    expect(desc).toContain('Test modu açıkken (0 dışındaki her değer) yalnız yönetici hesapları satın alma başlatabilir');
    expect(desc).toContain('test ödemeleri yönetici olmayan hiçbir hesapta plan açmaz (fatura başarısız sayılır)');
    expect(desc).toContain('kayıtlı karttan otomatik yenileme denenmez');
    expect(desc).toContain('PayTR bildirimi işlemi test olarak işaretlerse');
    expect(desc).toContain('dev-confirm');
    // Eski bilgi korunur: PayTR'ye giden deger ve varsayilan
    expect(desc).toContain('1 = test işlemi');
    expect(desc).toContain(".env'de yoksa 1");
  });

  it('dayanak kod kosullari paytr.service.ts\'te duruyor', () => {
    // '0' disindaki her deger test modu (kapali basarisizlik)
    // Kural tek yerde (billing/checkout-mode.ts; deneme bitis e-postasi da ayni kurali okur)
    expect(paytr).toMatch(/get testModeOn\(\): boolean \{\s*return checkoutTestModeOn\(this\.testMode\);/);
    expect(fs.readFileSync(path.resolve(HERE, '../billing/checkout-mode.ts'), 'utf8')).toContain("return (raw ?? '1').trim() !== '0';");
    // Test modunda yalniz ADMIN acik
    expect(paytr).toContain("return u?.role === 'ADMIN';");
    expect(method('checkoutStatus')).toMatch(/if \(!this\.testModeOn\) return \{ open: true[\s\S]*?if \(await this\.isAdminUser\(userId\)\) return \{ open: true/);
    // Odeme baslatma (iFrame ve Direkt API ayni kapi) ve test onayi kapidan gecer
    expect(method('createPaymentToken')).toContain('await this.assertCheckoutOpen(opts.userId);');
    expect(method('devConfirmPayment')).toMatch(/if \(this\.testMode !== '1'\)[\s\S]*?await this\.assertCheckoutOpen\(userId\);/);
    // Basarili bildirimde ve markInvoicePaid'de test odemesi yonetici olmayan hesapta FAILED (plan acilmaz);
    // PayTR'nin kendi test_mode=1 isareti de sayilir
    expect(paytr).toMatch(/const providerTestMode = String\(payload\.test_mode \?\? ''\)\.trim\(\) === '1';\s*if \(status === 'success' && await this\.isRefusedTestPayment\(invoice, providerTestMode\)\) \{\s*await this\.failTestPayment\(invoice\);/);
    expect(method('markInvoicePaid')).toMatch(/isRefusedTestPayment\(pending, providerTestMode\)\) \{\s*await this\.failTestPayment\(pending\);\s*return false;/);
    expect(method('isRefusedTestPayment')).toContain('return !(await this.isAdminUser(invoice.userId));');
    // Kayitli karttan yenileme test modunda denenmez
    expect(method('chargeStoredCard')).toMatch(/if \(this\.testModeOn\) \{[\s\S]*?return \{ result: 'skipped'/);
  });
});
