import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PaytrService } from './paytr.service.js';

/**
 * PayTR bildirim ucunun BELGELENEN yolu gercek yoluyla ayni olmali.
 *
 * NEDEN: paytr.service.ts sinif aciklamasi '4. PayTR → POST /webhooks/paytr/notification'
 * diyordu; bu yol hic var olmadi (uc ilk committen beri billing denetleyicisinde
 * 'webhooks/paytr'). PayTR bildirim adresini istekten degil Magaza Paneli'ndeki Bildirim
 * URL ayarindan alir (dev.paytr.com iframe-api-1-adim token parametrelerinde adres yok,
 * iframe-api-2-adim panel yolunu verir; bagimsiz ikinci kaynak docs.wisecp.com paytr-module);
 * panele belgedeki yol girilirse bildirim isleyiciye hic ulasmaz, odenen abonelikler
 * acilmazdi. Kodda hic okunmayan notifyUrl alani (PAYTR_NOTIFICATION_URL) adres ayari gibi
 * duruyordu; alan kaldirildi, .env.example ve docs/CALISMA-MANTIGI.md de degiskeni artik
 * kullaniliyor gibi gostermez. docs ayrica dev-confirm'i herkese acik anlatiyordu.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const service = read('./paytr.service.ts');
const controller = read('./billing.controller.ts');
const main = read('../main.ts');
const docs = read('../../../../docs/CALISMA-MANTIGI.md');
const envExample = read('../../../../.env.example');

/** PaytrService sinifinin hemen ustundeki JSDoc */
function classDoc(src: string): string {
  const at = src.indexOf('@Injectable()\nexport class PaytrService');
  expect(at, 'PaytrService sinif bildirimi bulunamadi').toBeGreaterThan(0);
  const start = src.lastIndexOf('/**', at);
  return src.slice(start, at);
}

const WEBHOOK_URL = 'https://api.ranksup.ai/api/billing/webhooks/paytr';
/** Degisken hala tanimli olsa bile istege girmedigini gormek icin */
const SENTINEL = 'https://bildirim.ornek.test/paytr-gonderilmemeli';

/**
 * Bir PayTR istek alanlari kumesinde bildirim adresi var mi: adi bildirim/geri cagirma
 * gibi duran bir alan ya da degeri bildirim ucunu / PAYTR_NOTIFICATION_URL'i iceren bir alan.
 */
function notificationFields(fields: Record<string, string>): string[] {
  return Object.entries(fields)
    .filter(([k, v]) => /notif|notify|callback|webhook|bildirim/i.test(k) || v.includes('webhooks/paytr') || v.includes(SENTINEL))
    .map(([k]) => k);
}

function liveService() {
  vi.stubEnv('PAYTR_MERCHANT_ID', 'test-merchant-id');
  vi.stubEnv('PAYTR_MERCHANT_KEY', 'test-merchant-key');
  vi.stubEnv('PAYTR_MERCHANT_SALT', 'test-merchant-salt');
  // Canli mod: test modu kapisi (yalniz yonetici) istegi kesmesin
  vi.stubEnv('PAYTR_TEST_MODE', '0');
  vi.stubEnv('PAYTR_NOTIFICATION_URL', SENTINEL);
  const prisma: any = {
    user: { findUnique: vi.fn(async () => ({ paytrUtoken: null, grandfatheredUntil: null, legacyMonthlyPriceTry: null })) },
    invoice: { create: vi.fn(async ({ data }: any) => ({ id: 'inv1', ...data })) },
  };
  const fx = { getRate: vi.fn(async () => ({ rate: 40, source: 'TCMB', stale: false, fetchedAt: new Date().toISOString() })) };
  return new PaytrService(prisma, { recordCommission: vi.fn() } as any, { send: vi.fn() } as any, fx as any);
}

const checkout = {
  userId: 'cust00001', planId: 'pro' as const, cycle: 'monthly' as const, userIp: '203.0.113.7',
  userEmail: 'musteri@ranksup.test', userName: 'Müşteri',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('PayTR bildirim ucu — belge ile denetleyici ayni yolu soyler', () => {
  it('gercek uc: @Controller(billing) + @Post(webhooks/paytr), uygulama oneki api → POST /api/billing/webhooks/paytr', () => {
    expect(controller).toMatch(/@Controller\('billing'\)/);
    // Yol bildirim isleyicisine baglanir (aradaki dekoratorlerin sirasi onemsiz)
    expect(controller).toMatch(/@Post\('webhooks\/paytr'\)[^;{}]{0,200}?\bwebhook\(@Body\(\)/);
    expect(controller).toMatch(/this\.paytr\.handleWebhook\(body\)/);
    expect(main).toMatch(/setGlobalPrefix\('api'/);
  });

  it('sinif aciklamasi gercek yolu yazar, var olmayan eski yolu yazmaz', () => {
    const doc = classDoc(service);
    expect(doc).toContain('POST /api/billing/webhooks/paytr');
    expect(doc).not.toMatch(/POST \/webhooks\/paytr\/notification/);
  });

  it('iFrame jeton istegi bildirim adresi gondermez — PAYTR_NOTIFICATION_URL tanimli olsa bile', async () => {
    const fetchMock = vi.fn<(...args: any[]) => Promise<{ json: () => Promise<unknown> }>>(async () => ({ json: async () => ({ status: 'success', token: 'tok-1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PAYTR_RECURRING_ENABLED', '0');
    const r: any = await liveService().createPaymentToken(checkout);
    expect(r.mode).toBe('iframe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe('https://www.paytr.com/odeme/api/get-token');
    const fields = Object.fromEntries(new URLSearchParams(init.body));
    // Istekte yalniz musterinin donecegi sayfalar var; bildirim adresi PayTR panelinden gelir
    expect(fields.merchant_ok_url).toBe('https://ranksup.ai/billing/success');
    expect(fields.merchant_fail_url).toBe('https://ranksup.ai/billing/failure');
    expect(notificationFields(fields)).toEqual([]);
  });

  it('Direkt API formu (otomatik yenileme acik) da bildirim adresi tasimaz', async () => {
    vi.stubEnv('PAYTR_RECURRING_ENABLED', '1');
    const svc = liveService();
    vi.spyOn(svc as any, 'getPlanPriceForUser').mockResolvedValue({ name: 'Profesyonel', price: 13960, priceUsd: 349, fxRate: 40 });
    const r: any = await svc.createPaymentToken(checkout);
    expect(r.mode).toBe('direct');
    expect(notificationFields(r.fields)).toEqual([]);
  });

  it('kodda olu adres alani yok: notifyUrl ve PAYTR_NOTIFICATION_URL okunmaz; aciklama adresin panelden geldigini soyler', () => {
    // Yorumlar ayiklanir (aciklama kaldirilan alanin adini anar); "https://" satir yorumu sayilmaz
    const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/notifyUrl/);
    expect(code).not.toMatch(/PAYTR_NOTIFICATION_URL/);
    const doc = classDoc(service);
    expect(doc).toContain('Bildirim URL Ayarlari');
    expect(doc).toContain(WEBHOOK_URL);
    expect(doc).toMatch(/hicbir PayTR istegine\s*\*?\s*koymaz/);
  });

  it('.env.example: PAYTR_NOTIFICATION_URL degisken olarak yok; yorum panel yolunu ve adresi verir', () => {
    expect(envExample).not.toMatch(/^PAYTR_NOTIFICATION_URL=/m);
    const block = envExample.slice(envExample.indexOf('PAYTR (TR ÖDEME)'), envExample.indexOf('PAYTR_FAIL_URL'));
    expect(block).toContain('Magaza Paneli > Destek & Kurulum > Ayarlar > Bildirim URL');
    expect(block).toMatch(new RegExp(`^# ${WEBHOOK_URL.replace(/[.]/g, '\\.')}$`, 'm'));
    // pm2 satir ici yorumu silmez: bu dosyadaki aciklamalar ayri satirda (dosya basi)
    for (const line of block.split('\n').filter((l) => /^PAYTR_[A-Z_]+=/.test(l))) {
      expect(line, line).not.toContain('#');
    }
  });

  it('docs/CALISMA-MANTIGI.md: gercek uc yolu ve dev-confirm yalniz test modundaki yoneticiye', () => {
    const billing = docs.slice(docs.indexOf('## 9. Billing'), docs.indexOf('### Plan Quota'));
    expect(billing).toContain('POST /api/billing/webhooks/paytr');
    expect(billing).toContain('satın alma ve dev-confirm yalnız yöneticiye açık');
    expect(billing).not.toMatch(/webhooks\/paytr\/notification/);
  });

  it('docs/CALISMA-MANTIGI.md: adim 2 gercek metodu (createPaymentToken) yazar; ortam tablosu PAYTR_NOTIFICATION_URL\'i kullaniliyor gostermez', () => {
    const billing = docs.slice(docs.indexOf('## 9. Billing'), docs.indexOf('### Plan Quota'));
    expect(billing).toContain('PaytrService.createPaymentToken');
    expect(billing).not.toContain('PaytrService.subscribe');
    // Belgede adi gecen metot serviste gercekten var
    expect(service).toMatch(/async createPaymentToken\(/);
    expect(docs).not.toContain('PAYTR_NOTIFICATION_URL');
    const envRow = docs.split('\n').find((l) => l.startsWith('| **PayTR** |'));
    expect(envRow).toBeDefined();
    expect(envRow).toContain('Bildirim URL Ayarları');
    expect(envRow).toContain(WEBHOOK_URL);
  });
});
