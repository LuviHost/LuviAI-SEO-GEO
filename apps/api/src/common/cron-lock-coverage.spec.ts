import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmailCron } from '../email/email.cron.js';
import { AnalyticsCron } from '../analytics/analytics.cron.js';

/**
 * Her @Cron kilitli olmali (cron-lock.ts).
 *
 * NEDEN VAR: API ve worker ayni AppModule'u bootstrap ediyor; @nestjs/schedule
 * her @Cron'u iki proseste birden tetikliyor. EmailCron ve AnalyticsCron
 * kilitsizdi: her kullanici hos geldin / deneme bitis / haftalik rapor
 * e-postasini iki kez aliyor, GSC sorgulari iki kez atiliyordu. Yeni bir cron
 * kilitsiz eklenirse bu test duser.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Bilincli olarak kilitsiz cron'lar — neden'i ile.
 *  - fx.service dailyRefresh: TCMB'den ucretsiz okuma + ayni degeri yazan
 *    upsert; ustelik her proses KENDI bellek onbellegini tazeler. Kilit,
 *    kaybeden prosesin kurunu bayat birakirdi.
 */
const KILITSIZ_IZINLI = new Set(['billing/fx.service.ts#dailyRefresh']);

function tsDosyalari(dir: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dir)) {
    const yol = join(dir, ad);
    if (statSync(yol).isDirectory()) out.push(...tsDosyalari(yol));
    else if (ad.endsWith('.ts') && !ad.endsWith('.spec.ts')) out.push(yol);
  }
  return out;
}

/** Her @Cron icin: dosya#metot ve metot govdesi (bir sonraki @Cron'a ya da 80 satira kadar). */
function cronlar(): Array<{ id: string; govde: string }> {
  const sonuc: Array<{ id: string; govde: string }> = [];
  for (const dosya of tsDosyalari(SRC)) {
    const src = readFileSync(dosya, 'utf8');
    if (!src.includes('@Cron(')) continue;
    const satirlar = src.split('\n');
    satirlar.forEach((satir, i) => {
      if (!/^\s*@Cron\(/.test(satir)) return;
      const sonraki = satirlar.slice(i + 1, i + 81);
      const bitis = sonraki.findIndex((s) => /^\s*@Cron\(/.test(s));
      const govde = (bitis === -1 ? sonraki : sonraki.slice(0, bitis)).join('\n');
      const metot = govde.match(/async\s+(\w+)\s*\(/)?.[1] ?? '?';
      sonuc.push({ id: `${dosya.slice(SRC.length).replace(/\\/g, '/')}#${metot}`, govde });
    });
  }
  return sonuc;
}

describe('cron kilidi kapsami', () => {
  it('kaynakta @Cron bulunuyor (tarayici bozulmadi)', () => {
    expect(cronlar().length).toBeGreaterThan(20);
  });

  it('izinli liste disindaki her @Cron acquireCronLock alir', () => {
    const kilitsiz = cronlar()
      .filter((c) => !KILITSIZ_IZINLI.has(c.id))
      .filter((c) => !c.govde.includes('acquireCronLock'))
      .map((c) => c.id);
    expect(kilitsiz, 'kilitsiz cron: API + worker ikisi de calistirir').toEqual([]);
  });
});

/** Iki prosesin paylastigi kv_store: ayni anahtar ikinci kez yazilamaz. */
function paylasilanKv() {
  const keys = new Set<string>();
  return {
    create: vi.fn(async ({ data }: any) => {
      if (keys.has(data.key)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      keys.add(data.key);
      return data;
    }),
  };
}

describe('EmailCron / AnalyticsCron — iki proses, tek calisma', () => {
  it('dailyEmails: API + worker ayni anda → e-posta bir kez', async () => {
    const kvStore = paylasilanKv();
    const now = Date.now();
    const users = [{ id: 'u1', email: 'a@ornek.com', name: 'A', role: 'USER', createdAt: new Date(now - 1 * 86_400_000 - 1000), trialEndsAt: null }];
    const email = { send: vi.fn(async () => ({ ok: true })) };
    const prisma = { kvStore, user: { findMany: vi.fn(async () => users) } } as any;
    await Promise.all([new EmailCron(prisma, email as any).dailyEmails(), new EmailCron(prisma, email as any).dailyEmails()]);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('weeklyReports ve grandfathering: kaybeden proses sorgu bile atmaz', async () => {
    const kvStore = paylasilanKv();
    const findMany = vi.fn(async () => []);
    const prisma = { kvStore, user: { findMany } } as any;
    const email = { send: vi.fn() };
    await Promise.all([new EmailCron(prisma, email as any).weeklyReports(), new EmailCron(prisma, email as any).weeklyReports()]);
    expect(findMany).toHaveBeenCalledTimes(1);
    findMany.mockClear();
    // grandfathering iki sorgu atar (30 gun uyarisi + bugun bitenler) — tek proseste
    await Promise.all([new EmailCron(prisma, email as any).grandfatheringNotifications(), new EmailCron(prisma, email as any).grandfatheringNotifications()]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('dailySnapshot: GSC kaydi bir kez', async () => {
    const kvStore = paylasilanKv();
    const findMany = vi.fn(async () => []);
    const prisma = { kvStore, site: { findMany } } as any;
    const analytics = { captureSnapshot: vi.fn() };
    await Promise.all([new AnalyticsCron(prisma, analytics as any).dailySnapshot(), new AnalyticsCron(prisma, analytics as any).dailySnapshot()]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
