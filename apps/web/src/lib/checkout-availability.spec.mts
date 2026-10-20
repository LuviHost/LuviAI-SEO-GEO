/**
 * Satin alma butonlari: PayTR test modunda (API checkout.open=false) kilitli ve
 * API'nin metnini gosterir; yonetici hesabi acik gorur; alan yoksa eski davranis.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PURCHASE_CLOSED_FALLBACK, purchaseState, readCheckout } from './checkout-availability';

const TR = 'Ödeme altyapısı şu an test modunda; satın alma henüz açık değil. Bilgi için bizimle iletişime geç.';
const EN = 'Our payment system is in test mode right now, so purchases are not open yet. Contact us for details.';
const closed = (message: string | null = TR) => ({ open: false, testMode: true, message });
const LIVE = { open: true, testMode: false, message: null };
const ADMIN_IN_TEST = { open: true, testMode: true, message: null };

describe('purchaseState', () => {
  it('canli mod: acik, metin yok', () => {
    expect(purchaseState({ page: LIVE })).toEqual({ open: true, message: null });
    expect(purchaseState({ page: LIVE, account: LIVE })).toEqual({ open: true, message: null });
  });

  it('test modu, anonim ziyaretci (yalniz /plans): kilitli + API metni', () => {
    expect(purchaseState({ page: closed() })).toEqual({ open: false, message: TR });
  });

  it('test modu, musteri oturumu: kilitli', () => {
    expect(purchaseState({ page: closed(), account: closed() })).toEqual({ open: false, message: TR });
  });

  it('test modu, yonetici oturumu: hesap karari sayfa kararini acar', () => {
    expect(purchaseState({ page: closed(), account: ADMIN_IN_TEST })).toEqual({ open: true, message: null });
  });

  it('Ingilizce fiyat sayfasi: hesap kaynagi Turkce olsa da metin sayfanin dilinde', () => {
    expect(purchaseState({ page: closed(EN), account: closed(TR) })).toEqual({ open: false, message: EN });
  });

  it('panel (yalniz /current): hesabin metni', () => {
    expect(purchaseState({ account: closed() })).toEqual({ open: false, message: TR });
  });

  it('kapali ama metin gelmedi: ayni metin yedekten', () => {
    expect(PURCHASE_CLOSED_FALLBACK).toBe(TR);
    expect(purchaseState({ account: closed(null) })).toEqual({ open: false, message: TR });
    expect(purchaseState({ page: closed('   ') })).toEqual({ open: false, message: TR });
  });

  it('alan yok ya da bicim disi (eski API, basarisiz istek, 401 govdesi): eski davranis — acik', () => {
    for (const raw of [undefined, null, 'kapali', 0, {}, { open: 'false' }, { message: 'Token yok', statusCode: 401 }]) {
      expect(purchaseState({ page: raw, account: raw }), JSON.stringify(raw)).toEqual({ open: true, message: null });
    }
  });

  it('hesap verisi bozuksa sayfa karari gecerli', () => {
    expect(purchaseState({ page: closed(), account: { statusCode: 401, message: 'Token yok' } })).toEqual({ open: false, message: TR });
  });
});

describe('readCheckout', () => {
  it('yalniz bilinen alanlari alir', () => {
    expect(readCheckout({ open: false, testMode: true, message: TR, extra: 'x' })).toEqual({ open: false, testMode: true, message: TR });
    expect(readCheckout({ open: true })).toEqual({ open: true, testMode: false, message: null });
    expect(readCheckout({ open: 1 })).toBeNull();
  });
});

// --- Kaynak denetimi: panelin plan yukseltme penceresi de ayni kilidi kullanir ---
// Eskiden pencerenin butonlari test modunda da acikti; tiklayan musteri API'nin 403
// metnini hata bildirimi olarak goruyordu (fiyat sayfasi ve abonelik sayfasi kilitliydi).

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Yorumlar neyin neden kaldirildigini anlatir; yalniz kod taranir */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

describe('kaynak: yükseltme penceresi (upgrade-plan-modal.tsx)', () => {
  const modal = stripComments(read('../components/upgrade-plan-modal.tsx'));

  it('karar purchaseState ile: sayfa kaynağı /plans, hesap kaynağı /current checkout alanı', () => {
    expect(modal).toContain("from '@/lib/checkout-availability'");
    expect(modal).toContain('purchaseState({ page: pageCheckout, account: accountCheckout })');
    expect(modal).toContain('setPageCheckout(r?.checkout ?? null)');
    expect(modal).toContain('/api/billing/users/${sessionUserId}/current');
    expect(modal).toContain('setAccountCheckout(d?.checkout ?? null)');
  });

  it('kilitliyken plan butonları devre dışı, API metni ve iletişim adresi görünür, ödeme isteği gönderilmez', () => {
    expect(modal).toContain('disabled={loadingPlan === p.id || !purchase.open}');
    expect(modal).toMatch(/\{!purchase\.open && \([\s\S]*?\{purchase\.message\}[\s\S]*?PURCHASE_CONTACT_EMAIL/);
    expect(modal).toMatch(/const subscribe = async \(planId: string\) => \{\s*if \(!purchase\.open\) return;/);
  });

  it('yıllık indirim fiyat sayfasıyla aynı (yıllık = 10 ay fiyatı): "-20%" yok', () => {
    expect(modal).not.toMatch(/-20%|%20/);
    expect(modal).toContain('2 ay bedava');
  });
});
