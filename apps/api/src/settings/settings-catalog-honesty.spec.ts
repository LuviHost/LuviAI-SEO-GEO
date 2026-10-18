import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_BY_KEY, SETTINGS_CATALOG } from './settings.constants.js';
import { SettingsService } from './settings.service.js';

/**
 * Admin ayar katalogu durust mu: panelde gorunen her ayar GERCEKTEN bir yere
 * bagli olmali.
 *
 * NEDEN VAR: katalog PAYTR_TEST_MODE, FEATURE_*, PLAN_*, SPEND_CAP_*, DEBUG,
 * LOG_LEVEL gibi anahtarlari duzenlenebilir listeliyordu ama hicbiri ayardan
 * okunmuyordu. En tehlikelisi PAYTR_TEST_MODE: paytr.service degeri yalniz
 * process.env'den okuyor; admin panelden "test modu" acip canli odeme
 * alindigini bilmeyebilirdi. Bu dosya (1) olu anahtarlarin geri gelmesini,
 * (2) okunmayan yeni bir anahtarin eklenmesini, (3) env'den okunan anahtarin
 * panelde yanlis degerle gosterilmesini engeller.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_SRC = path.resolve(HERE, '..');
const WORKER_SRC = path.resolve(HERE, '../../../worker/src');

/** Uretim kaynaklari — settings/ klasoru ve spec dosyalari haric (katalogun kendisi sayilmaz) */
function productionSources(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        if (p === HERE) continue;
        walk(p);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !e.name.endsWith('.d.ts')) {
        out.push({ file: path.relative(API_SRC, p), src: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(API_SRC);
  walk(WORKER_SRC);
  return out;
}

const SOURCES = productionSources();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 2026-10'da katalogdan cikarilan, hicbir kodun ayardan okumadigi anahtarlar */
const RETIRED = [
  'FEATURE_PAYMENT_REQUIRED', 'FEATURE_AUTO_FIRST_ARTICLE', 'FEATURE_WHITE_LABEL',
  'FEATURE_PUBLIC_API', 'FEATURE_MULTI_LANG', 'GEO_OPTIMIZER_ENABLED', 'DEBUG', 'LOG_LEVEL',
  'PLAN_TRIAL_DAYS',
  'PLAN_STARTER_PRICE', 'PLAN_STARTER_ARTICLES', 'PLAN_STARTER_SITES',
  'PLAN_PRO_PRICE', 'PLAN_PRO_ARTICLES', 'PLAN_PRO_SITES',
  'PLAN_AGENCY_PRICE', 'PLAN_AGENCY_ARTICLES', 'PLAN_AGENCY_SITES',
  'SPEND_CAP_TRIAL_USD', 'SPEND_CAP_STARTER_USD', 'SPEND_CAP_PRO_USD',
  'SPEND_CAP_AGENCY_USD', 'SPEND_CAP_ENTERPRISE_USD', 'SPEND_CAP_ENABLED',
];

const ENV_ONLY_KEYS = ['PAYTR_TEST_MODE', 'IMAGE_PROVIDER', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX'];

describe('admin ayar katalogu — yalniz gercekten okunan anahtarlar', () => {
  it('olu anahtarlar katalogda yok', () => {
    for (const k of RETIRED) expect(SETTINGS_BY_KEY.has(k), `${k} geri gelmis`).toBe(false);
  });

  it('cikarilan anahtarlarin hicbiri uretim kodunda ayardan okunmuyor (cikarmak davranis degistirmez)', () => {
    for (const k of RETIRED) {
      const re = new RegExp(`['"\`]${escape(k)}['"\`]`);
      const hit = SOURCES.find((s) => re.test(s.src));
      expect(hit?.file, `${k} hala okunuyor`).toBeUndefined();
    }
  });

  it('DB\'den okunan her anahtar uretim kodunda adiyla okunuyor', () => {
    for (const m of SETTINGS_CATALOG.filter((x) => !x.envOnly)) {
      const re = new RegExp(`['"\`]${escape(m.key)}['"\`]`);
      expect(SOURCES.some((s) => re.test(s.src)), `${m.key} katalogda ama hicbir kod okumuyor`).toBe(true);
    }
  });

  it('kodun ayardan okudugu her anahtar katalogda (yoksa getRaw hata atar, cagri yeri yutar, deger hic okunmaz)', () => {
    // Eski hata sinifi: MODEL_INTEL_* ve INTEL_DIGEST_TO settings.getString ile
    // okunuyordu ama katalogda yoktu — `.catch(() => null)` hatayi yutuyor,
    // panelden yazilan deger sessizce yok sayiliyordu.
    const read = new Set<string>();
    for (const s of SOURCES) {
      for (const call of s.src.matchAll(/settings\.get(?:Boolean|Int|String|Raw)\(([^)]*)\)/g)) {
        for (const lit of call[1].matchAll(/['"`]([A-Z][A-Z0-9_]+)['"`]/g)) read.add(lit[1]);
      }
      for (const m of s.src.matchAll(/appSetting\s*\.findUnique\(\s*\{\s*where:\s*\{\s*key:\s*['"`]([A-Z][A-Z0-9_]+)['"`]/g)) read.add(m[1]);
    }
    expect(read.size).toBeGreaterThan(3);
    for (const k of read) {
      expect(SETTINGS_BY_KEY.has(k), `${k} kodda ayardan okunuyor ama katalogda yok`).toBe(true);
      expect(SETTINGS_BY_KEY.get(k)!.envOnly ?? false, `${k} ayardan okunuyor; envOnly olamaz`).toBe(false);
    }
  });

  it('yalniz-.env anahtarlari: kod process.env\'den okuyor, varsayilan kodunkiyle ayni, ayardan okunmuyor', () => {
    expect(SETTINGS_CATALOG.filter((m) => m.envOnly).map((m) => m.key).sort()).toEqual([...ENV_ONLY_KEYS].sort());
    for (const k of ENV_ONLY_KEYS) {
      const meta = SETTINGS_BY_KEY.get(k)!;
      const reads = SOURCES.flatMap((s) =>
        [...s.src.matchAll(new RegExp(`process\\.env\\.${escape(k)}\\s*\\?\\?\\s*'([^']*)'`, 'g'))].map((m) => m[1]),
      );
      expect(reads.length, `${k} icin process.env okumasi bulunamadi`).toBeGreaterThan(0);
      // Panel env tanimsizken bu varsayilani gosterir — kodunkiyle ayni olmali
      for (const d of reads) expect(d, `${k} kod varsayilani`).toBe(meta.default);
      const viaSettings = new RegExp(`settings\\.get\\w*\\(\\s*['"\`]${escape(k)}['"\`]`);
      expect(SOURCES.find((s) => viaSettings.test(s.src))?.file, `${k} ayardan okunuyorsa envOnly yanlis`).toBeUndefined();
    }
  });

  it('kategori ile salt-okunurluk tutarli; Plan / Rate Limit / Loglama bolumu kalmadi', () => {
    for (const m of SETTINGS_CATALOG) {
      expect(['toggle', 'model', 'env'], m.key).toContain(m.category);
      expect(m.category === 'env', `${m.key}: env kategorisi yalniz envOnly icin`).toBe(m.envOnly === true);
    }
  });

  it('IMAGE_PROVIDER aciklamasi image-generator\'in tanidigi saglayicilari listeliyor', () => {
    const gen = fs.readFileSync(path.join(API_SRC, 'articles/image-generator.service.ts'), 'utf8');
    const block = gen.slice(gen.indexOf('private async dispatchProvider'));
    const known = [...block.slice(0, block.indexOf('throw new Error')).matchAll(/provider === '([\w-]+)'/g)].map((m) => m[1]);
    expect(known.length).toBeGreaterThan(0);
    const desc = SETTINGS_BY_KEY.get('IMAGE_PROVIDER')!.description;
    for (const p of known) expect(desc, p).toContain(p);
  });
});

// ─── SettingsService: envOnly davranisi ─────────────────────────────

function fakePrisma(rows: Array<{ key: string; value: string }> = []) {
  return {
    appSetting: {
      findMany: vi.fn(async () => rows.map((r) => ({ ...r, updatedAt: new Date('2026-01-01'), updatedBy: 'eski-admin' }))),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null),
      create: vi.fn(async () => ({})),
      upsert: vi.fn(),
    },
    settingAuditLog: { create: vi.fn() },
    $transaction: vi.fn(async () => []),
  };
}

const ENV_SNAPSHOT: Record<string, string | undefined> = {};
const TOUCHED = [...ENV_ONLY_KEYS, 'AI_GLOBAL_DISABLED', 'SATIS_RANDEVU_URL', 'INTEL_DIGEST_TO'];

describe('SettingsService — yalniz .env anahtarlari salt okunur', () => {
  beforeEach(() => {
    for (const k of TOUCHED) { ENV_SNAPSHOT[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of TOUCHED) {
      if (ENV_SNAPSHOT[k] === undefined) delete process.env[k];
      else process.env[k] = ENV_SNAPSHOT[k];
    }
  });

  it('listAll: envOnly deger env\'den gelir, eski DB satiri yok sayilir', async () => {
    process.env.PAYTR_TEST_MODE = '0';
    // Ilk acilista tohumlanmis eski satir "test acik" diyor — panel bunu GOSTERMEMELI
    const svc = new SettingsService(fakePrisma([{ key: 'PAYTR_TEST_MODE', value: '1' }]) as never);
    const row = (await svc.listAll()).find((r) => r.key === 'PAYTR_TEST_MODE')!;
    expect(row).toMatchObject({ value: '0', source: 'env', envOnly: true, updatedAt: null, updatedBy: null });
  });

  it('listAll: env tanimsizken kodun varsayilani ve kaynak "default"', async () => {
    const svc = new SettingsService(fakePrisma() as never);
    const rows = await svc.listAll();
    expect(rows.find((r) => r.key === 'PAYTR_TEST_MODE')).toMatchObject({ value: '1', source: 'default' });
    expect(rows.find((r) => r.key === 'IMAGE_PROVIDER')).toMatchObject({ value: 'gemini-flash', source: 'default' });
    expect(rows.find((r) => r.key === 'RATE_LIMIT_MAX')).toMatchObject({ value: '60', source: 'default' });
  });

  it('listAll: DB anahtarlarinda kaynak db > env > default', async () => {
    process.env.SATIS_RANDEVU_URL = 'https://cal.com/env';
    const svc = new SettingsService(fakePrisma([{ key: 'AI_GLOBAL_DISABLED', value: '1' }]) as never);
    const rows = await svc.listAll();
    expect(rows.find((r) => r.key === 'AI_GLOBAL_DISABLED')).toMatchObject({ value: '1', source: 'db' });
    expect(rows.find((r) => r.key === 'SATIS_RANDEVU_URL')).toMatchObject({ value: 'https://cal.com/env', source: 'env' });
    expect(rows.find((r) => r.key === 'MODEL_ANON')).toMatchObject({ value: 'claude-haiku-4-5', source: 'default' });
  });

  it('set: envOnly anahtar 400 alir ve hicbir sey yazilmaz', async () => {
    const prisma = fakePrisma();
    const svc = new SettingsService(prisma as never);
    const err = await svc.set('PAYTR_TEST_MODE', '1', 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('.env');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });

  it('set: DB anahtari eskisi gibi yazilir', async () => {
    const prisma = fakePrisma();
    const svc = new SettingsService(prisma as never);
    await expect(svc.set('ARTICLE_GENERATION_DISABLED', 'true', 'admin-1')).resolves.toMatchObject({ value: '1', unchanged: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('getRaw: envOnly anahtar DB\'ye gitmeden env\'i okur', async () => {
    process.env.IMAGE_PROVIDER = 'flux-pro';
    const prisma = fakePrisma([{ key: 'IMAGE_PROVIDER', value: 'gemini' }]);
    const svc = new SettingsService(prisma as never);
    await expect(svc.getRaw('IMAGE_PROVIDER')).resolves.toBe('flux-pro');
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('INTEL_DIGEST_TO: artik okunabiliyor; bos satir env\'e duser (bugunku env davranisi korunur)', async () => {
    process.env.INTEL_DIGEST_TO = 'ekip@ornek.com';
    const svc = new SettingsService(fakePrisma() as never);
    // envFallback false: tohumlama env'i DB'ye kopyalamaz, bos deger doner …
    await expect(svc.getRaw('INTEL_DIGEST_TO')).resolves.toBe('');
    // … ve digest.service bos degerde env'e duser
    const digest = fs.readFileSync(path.join(API_SRC, 'intel/digest.service.ts'), 'utf8');
    expect(digest).toMatch(/getString\('INTEL_DIGEST_TO'\)[\s\S]{0,120}\|\|\s*process\.env\.INTEL_DIGEST_TO/);
    // Panelden yazilan deger env'in onune gecer
    const withRow = new SettingsService(fakePrisma([{ key: 'INTEL_DIGEST_TO', value: 'panel@ornek.com' }]) as never);
    await expect(withRow.getRaw('INTEL_DIGEST_TO')).resolves.toBe('panel@ornek.com');
  });

  it('acilis tohumlamasi envOnly anahtarlara satir acmaz', async () => {
    const prisma = fakePrisma();
    const svc = new SettingsService(prisma as never);
    await svc.onModuleInit();
    const created = prisma.appSetting.create.mock.calls.map((c: any[]) => c[0].data.key);
    expect(created.length).toBe(SETTINGS_CATALOG.filter((m) => !m.envOnly).length);
    for (const k of ENV_ONLY_KEYS) expect(created).not.toContain(k);
  });
});
