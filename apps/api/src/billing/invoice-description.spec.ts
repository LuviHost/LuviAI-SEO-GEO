import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { PaytrService } from './paytr.service.js';
import { cycleFromDescription } from './subscription-period.js';
import { INVOICE_DESCRIPTION_MAX, capInvoiceDescription, failedInvoiceDescription } from './invoice-description.js';

/**
 * Invoice.description VARCHAR(191) — hicbir yazim siniri asmamali.
 *
 * NEDEN VAR: markInvoiceFailed aciklamayi 500 karaktere kirpiyordu; uzun bir
 * PayTR hata metni MySQL'de P2000'e, bildirim 500'e donuyordu ve PayTR ayni
 * bildirimi durmadan yeniden gonderiyordu (fatura PENDING kaliyordu).
 */

const codePoints = (s: string) => Array.from(s).length;
const ENV_KEYS = ['PAYTR_MERCHANT_KEY', 'PAYTR_MERCHANT_SALT'] as const;
let envBackup: Record<string, string | undefined> = {};

beforeAll(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PAYTR_MERCHANT_KEY = 'test-merchant-key';
  process.env.PAYTR_MERCHANT_SALT = 'test-merchant-salt';
});
afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('capInvoiceDescription', () => {
  it('kisa metne dokunmaz, siniri tam dolduran metin aynen kalir', () => {
    expect(capInvoiceDescription('RanksUp Pro — annual ($99 @ 41.2)')).toBe('RanksUp Pro — annual ($99 @ 41.2)');
    const tam = 'x'.repeat(INVOICE_DESCRIPTION_MAX);
    expect(capInvoiceDescription(tam)).toBe(tam);
  });

  it('uzun metni karakter sinirina keser', () => {
    expect(codePoints(capInvoiceDescription('a'.repeat(5000)))).toBe(INVOICE_DESCRIPTION_MAX);
  });

  it('cok baytli karakteri ortadan bolmez (MySQL kod noktasi sayar)', () => {
    const out = capInvoiceDescription('ş'.repeat(100) + '😀'.repeat(200));
    expect(codePoints(out)).toBe(INVOICE_DESCRIPTION_MAX);
    // Yarim kalmis vekil cifti (lone surrogate) yok
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
  });

  it('basarisizlik aciklamasi asil aciklamayi basta tutar — donem bilgisi kaybolmaz', () => {
    const out = failedInvoiceDescription('RanksUp Pro — annual ($990 @ 41.2)', '51', 'Kart reddedildi '.repeat(100));
    expect(codePoints(out)).toBe(INVOICE_DESCRIPTION_MAX);
    expect(out.startsWith('RanksUp Pro — annual ($990 @ 41.2) — 51: Kart reddedildi')).toBe(true);
    expect(cycleFromDescription(out)).toBe('annual');
    expect(failedInvoiceDescription(null, undefined, undefined)).toBe(' — ?: ');
  });
});

describe('sinir semayla uyumlu', () => {
  const SCHEMA = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

  it('Invoice.description sutunu sinirdan kisa degil', () => {
    const model = SCHEMA.match(/^model Invoice \{([\s\S]*?)^\}/m)?.[1] ?? '';
    const line = model.split('\n').find((l) => /^\s+description\s/.test(l)) ?? '';
    expect(line, 'Invoice.description semada yok').not.toBe('');
    // @db yoksa Prisma MySQL'de String -> VARCHAR(191)
    const varchar = line.match(/@db\.VarChar\((\d+)\)/);
    const limit = /@db\.(Text|MediumText|LongText)\b/.test(line) ? 65_535 : varchar ? Number(varchar[1]) : 191;
    expect(INVOICE_DESCRIPTION_MAX).toBeLessThanOrEqual(limit);
  });

  it('uretim sutunu migration\'da VARCHAR(191); sonraki migration genisletmedi', () => {
    const dir = new URL('../../prisma/migrations/', import.meta.url);
    const init = readFileSync(new URL('20260427210142_init/migration.sql', dir), 'utf8');
    const table = init.match(/CREATE TABLE `invoices` \(([\s\S]*?)\) DEFAULT CHARACTER SET/)?.[1] ?? '';
    expect(table).toMatch(/`description` VARCHAR\(191\) NULL/);
    const later = readdirSync(dir)
      .filter((d) => d !== '20260427210142_init' && existsSync(new URL(`${d}/migration.sql`, dir)))
      .filter((d) => /ALTER TABLE `invoices`[^;]*`description`/.test(readFileSync(new URL(`${d}/migration.sql`, dir), 'utf8')));
    // Biri sutunu degistirirse INVOICE_DESCRIPTION_MAX yeniden degerlendirilmeli
    expect(later).toEqual([]);
  });
});

describe('PaytrService — her aciklama yazimi sinirli', () => {
  it('paytr.service.ts icindeki her description yazimi yardimcidan gecer', () => {
    const src = readFileSync(new URL('./paytr.service.ts', import.meta.url), 'utf8');
    const writes = src.split('\n').filter((l) => /^\s*description:\s*(?!true\b)/.test(l));
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const l of writes) {
      expect(l, l.trim()).toMatch(/(capInvoiceDescription|failedInvoiceDescription)\(/);
    }
  });

  /** MySQL strict mod gibi davranan sahte fatura tablosu: sinir asilirsa P2000 */
  function makeService() {
    const invoices: Record<string, any> = {
      inv1: {
        id: 'inv1', userId: 'u1', status: 'PENDING', amount: 1499, isRenewal: false, storeCard: false,
        paytrTransactionId: 'LUVIabcdefghPRO1700000000000', description: 'RanksUp Pro — annual ($990 @ 41.2)',
      },
    };
    const tooLong = (data: any) => typeof data.description === 'string' && codePoints(data.description) > INVOICE_DESCRIPTION_MAX;
    const prisma: any = {
      invoice: {
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (tooLong(data)) throw Object.assign(new Error('The provided value for the column is too long for the column\'s type. Column: description'), { code: 'P2000' });
          const inv = invoices[where.id];
          if (!inv || inv.status !== where.status) return { count: 0 };
          Object.assign(inv, data);
          return { count: 1 };
        }),
        findUnique: vi.fn(async ({ where }: any) =>
          invoices[where.id] ?? Object.values(invoices).find((i: any) => i.paytrTransactionId === where.paytrTransactionId) ?? null),
      },
      user: {
        findUnique: vi.fn(async () => ({ id: 'u1', email: 'a@b.co', name: 'Ayşe', deletionRequestedAt: null })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const email: any = { send: vi.fn(async () => ({ ok: true })) };
    const svc = new PaytrService(prisma, {} as any, email, {} as any);
    return { svc, prisma, email, invoices };
  }

  it('uzun PayTR mesajiyla basarisiz odeme kaydedilir (P2000 yok), aciklama sinirda', async () => {
    const t = makeService();
    await expect(t.svc.markInvoiceFailed('inv1', 'BANK_DECLINE', 'İşlem bankanız tarafından reddedildi. '.repeat(60))).resolves.toBe(true);
    expect(t.invoices.inv1.status).toBe('FAILED');
    expect(codePoints(t.invoices.inv1.description)).toBeLessThanOrEqual(INVOICE_DESCRIPTION_MAX);
    expect(t.invoices.inv1.description.startsWith('RanksUp Pro — annual ($990 @ 41.2) — BANK_DECLINE:')).toBe(true);
  });

  it('bildirim ucu uzun hata metninde "OK" doner — PayTR ayni bildirimi yeniden gondermez', async () => {
    const t = makeService();
    const payload: Record<string, string> = {
      merchant_oid: 'LUVIabcdefghPRO1700000000000',
      status: 'failed',
      total_amount: '149900',
      failed_reason_code: '0',
      failed_reason_msg: 'Ödeme sırasında hata oluştu; kart sahibinin bankası işlemi onaylamadı. '.repeat(40),
    };
    payload.hash = createHmac('sha256', 'test-merchant-key')
      .update(`${payload.merchant_oid}test-merchant-salt${payload.status}${payload.total_amount}`)
      .digest('base64');
    await expect(t.svc.handleWebhook(payload)).resolves.toBe('OK');
    expect(t.invoices.inv1.status).toBe('FAILED');
    expect(codePoints(t.invoices.inv1.description)).toBeLessThanOrEqual(INVOICE_DESCRIPTION_MAX);
  });
});
