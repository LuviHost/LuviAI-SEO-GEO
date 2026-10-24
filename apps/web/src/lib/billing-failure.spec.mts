/**
 * /billing/failure (PayTR merchant_fail_url): PayTR test modunda yonetici disi hesap
 * odeme baslatamaz; sayfa yine de herkese "Tekrar Dene" (-> /pricing) gosteriyor ve
 * nedeni soylemiyordu. Simdi satin alma kapaliyken fiyat sayfasinin kilit metni +
 * iletisim adresi gosterilir, tekrar deneme baglantisi gosterilmez. Karar fiyat
 * sayfasiyla ayni yardimcidan (purchaseState) ve ayni iki kaynaktan gelir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PURCHASE_CLOSED_FALLBACK, purchaseState } from './checkout-availability';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Yorumlar neyin neden degistigini anlatir; yalniz kod taranir */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

const page = stripComments(read('../app/(marketing)/billing/failure/page.tsx'));
const pricing = stripComments(read('../app/(marketing)/pricing/pricing-view.tsx'));

/** Sunucunun 403 ve checkout.message metni (api billing/paytr.service.ts) */
const API_MESSAGE = (() => {
  const m = read('../../../api/src/billing/paytr.service.ts').match(/export const CHECKOUT_TEST_MODE_MESSAGE =\s*'([^']+)';/);
  if (!m) throw new Error('CHECKOUT_TEST_MODE_MESSAGE bulunamadi');
  return m[1];
})();

/** Fiyat sayfasindaki kilit kalibi: API metni + bosluk + destek adresi baglantisi */
const LOCK_MARKUP = /\{purchase\.message\}\{' '\}\s*<a href=\{`mailto:\$\{PURCHASE_CONTACT_EMAIL\}`\}[^>]*>\s*\{PURCHASE_CONTACT_EMAIL\}\s*<\/a>/;

describe('/billing/failure — PayTR test modunda tekrar deneme yerine kilit metni', () => {
  it('karar fiyat sayfasıyla aynı yardımcı ve aynı kaynaklardan: /billing/plans + /billing/users/:id/current checkout alanı', () => {
    expect(page.trimStart().startsWith("'use client';")).toBe(true);
    expect(page).toContain("import { PURCHASE_CONTACT_EMAIL, purchaseState, readCheckout } from '@/lib/checkout-availability';");
    expect(page).toContain('setPageCheckout(res.checkout ?? null)');
    // Fiyat sayfasi /billing/plans yanitini sunucudan (page.tsx) alir, istemcide tazeler;
    // checkout alani ayni yanittan okunur
    expect(pricing).toContain('const pageCheckout: unknown = data?.checkout ?? null');
    expect(pricing).toContain('api.getPlans(locale)');
    for (const src of [page, pricing]) {
      expect(src).toContain('purchaseState({ page: pageCheckout, account: accountCheckout })');
      expect(src).toContain('/api/billing/users/${');
      expect(src).toContain('setAccountCheckout(d?.checkout ?? null)');
    }
    // Sayfa Turkce: metin Turkce istenir
    expect(page).toContain("api.getPlans('tr')");
  });

  it('satın alma kapalıyken "Tekrar Dene" yok; fiyat sayfasının metni ve iletişim adresi var', () => {
    expect(pricing).toMatch(LOCK_MARKUP);
    expect(page).toMatch(LOCK_MARKUP);
    // "Tekrar Dene" (/pricing) yalniz purchase.open dalinda; kapali dalda kilit metni
    expect(page).toMatch(/purchase\.open \? \([\s\S]*?href="\/pricing"[\s\S]*?Tekrar Dene[\s\S]*?\) : \([\s\S]*?\{purchase\.message\}/);
    expect(page.split('Tekrar Dene').length - 1).toBe(1);
    expect(page.split('href="/pricing"').length - 1).toBe(1);
  });

  it('karar gelmeden metin ve bağlantı çizilmez; API yanıt vermezse eski davranışa döner', () => {
    expect(page).toContain('{!decided ? null : purchase.open ? (');
    expect(page).toContain('const decided = waitOver || (pageCheckout !== undefined && accountCheckout !== undefined);');
    expect(page).toContain('useState<unknown>(undefined)');
    expect(page).toMatch(/setTimeout\(\(\) => setWaitOver\(true\), CHECKOUT_WAIT_MS\)/);
    // Okuma hatasi "karar verildi" sayilir (null), sayfa beklemede kalmaz
    expect(page).toContain('.catch(() => { if (!stopped) setPageCheckout(null); })');
    expect(page).toContain('.catch(() => { if (!stopped) setAccountCheckout(null); })');
    expect(page).toMatch(/if \(!userId\) \{ setAccountCheckout\(null\); return; \}/);
  });

  it('yöneticinin test ödemesi (açık + test modu): bağlantı kalır, not success sayfasıyla aynı cümle', () => {
    const note = 'Ödeme altyapısı test modunda; test ödemeleri gerçek tahsilat değildir.';
    expect(stripComments(read('../app/(marketing)/billing/success/page.tsx'))).toContain(note);
    expect(page).toContain('const testMode = (readCheckout(accountCheckout) ?? readCheckout(pageCheckout))?.testMode === true;');
    expect(page).toMatch(new RegExp(`\\{testMode && \\([\\s\\S]*?${note.replace(/[.;]/g, '\\$&')}`));
  });

  it('gösterilen metin: test modunda müşteri (anonim ya da oturumlu) sunucunun metnini görür; yönetici açık görür', () => {
    const closed = { open: false, testMode: true, message: API_MESSAGE };
    expect(API_MESSAGE).toBe(PURCHASE_CLOSED_FALLBACK);
    expect(purchaseState({ page: closed, account: null })).toEqual({ open: false, message: API_MESSAGE });
    expect(purchaseState({ page: closed, account: closed })).toEqual({ open: false, message: API_MESSAGE });
    expect(purchaseState({ page: closed, account: { open: true, testMode: true, message: null } })).toEqual({ open: true, message: null });
    // Canli mod ya da okunamayan durum: eski davranis (Tekrar Dene)
    expect(purchaseState({ page: { open: true, testMode: false, message: null }, account: null }).open).toBe(true);
    expect(purchaseState({ page: null, account: null }).open).toBe(true);
  });
});
