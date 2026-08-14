import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

/**
 * Taramanin KAYNAGI kalici olarak yazilmali.
 *
 * NEDEN VAR: runAudit() bastan beri `trigger: 'user' | 'system'` parametresi
 * aliyordu, ama bu deger yalnizca kota kararinda kullanilip ATILIYORDU —
 * Audit satirina hicbir sey yazilmiyordu. Sonuc: gecmiste bir taramanin
 * kullanici tarafindan mi, AUDIT_CRON tarafindan mi, yoksa bir dogrulama
 * kosumu tarafindan mi baslatildigi anlasilamiyordu.
 *
 * Somut zarar iki yerde:
 *  1. "Ne kadar is yapildi" raporu — AUDIT_CRON acildigi anda her haftalik
 *     otomatik tarama gecmise duser ve musteriye gosterilen sayi kendiliginden
 *     sisar. Rapor yalanci olur.
 *  2. Uretimde dogrulama icin calistirilan taramalar kullanici taramalarindan
 *     ayirt edilemez (bu dosya tam olarak boyle bir durumda yazildi: kuyruk
 *     duzeltmesi dogrulanirken uretime 3 tarama eklendi ve hangisinin
 *     musteriye ait oldugu sorusu cevapsiz kaldi).
 *
 * Parametrenin VARLIGI yetmiyordu; bu testler DB'ye YAZILDIGINI sabitler.
 */

const KAYNAK = new URL('./audit.service.ts', import.meta.url);

describe('Audit.trigger — sema', () => {
  const alanlar = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Audit')!.fields;

  it('trigger kolonu Audit modelinde var', () => {
    const f = alanlar.find((x) => x.name === 'trigger');
    expect(f, 'trigger kolonu yok — kaynak bilgisi yine kayboluyor').toBeDefined();
    expect(f!.type).toBe('String');
  });

  it('varsayilan "user" — mevcut satirlar elle baslatilmis gercek taramalar', () => {
    const f = alanlar.find((x) => x.name === 'trigger')!;
    expect(f.hasDefaultValue).toBe(true);
    expect(f.default).toBe('user');
  });
});

describe('Audit.trigger — yazma', () => {
  const src = readFileSync(KAYNAK, 'utf8');
  const createBloku = src.slice(
    src.indexOf('this.prisma.audit.create('),
    src.indexOf('// 7) Site status'),
  );

  it('audit.create trigger alanini GERCEKTEN yaziyor', () => {
    expect(
      createBloku,
      'trigger create bloguna girmemis — parametre yine sessizce kayboluyor',
    ).toMatch(/trigger:\s*opts\.trigger\s*\?\?\s*'user'/);
  });

  it('runAudit imzasi ucuncu bir kaynagi ("test") kabul ediyor', () => {
    expect(src).toContain("export type AuditTrigger = 'user' | 'system' | 'test'");
    expect(src).toMatch(/async runAudit\(siteId: string, opts: \{ trigger\?: AuditTrigger \}/);
  });

  it('kota yalnizca GERCEK kullanici taramasinda tuketiliyor', () => {
    // 'test' ve 'system' musterinin aylik gorunurluk hakkini yiyemez.
    expect(src).toMatch(/\(opts\.trigger \?\? 'user'\) === 'user' \? 'user' : 'system'/);
  });

  it('haftalik cron kendini "system" olarak isaretliyor', () => {
    const cron = readFileSync(new URL('./audit.cron.ts', import.meta.url), 'utf8');
    expect(cron).toContain("trigger: 'system'");
  });
});

describe('Audit.trigger — okuma', () => {
  const src = readFileSync(KAYNAK, 'utf8');

  it('getHistory trigger alanini donuyor — arayuz kaynagi gosterebilsin', () => {
    const gecmis = src.slice(src.indexOf('async getHistory('), src.indexOf('async queueAudit('));
    expect(gecmis).toMatch(/trigger:\s*true/);
  });

  it('gecmis kaynaga gore SUZULMUYOR — calisan tarama kaydi silinmez/gizlenmez', () => {
    // Bilincli karar: sistem/test taramasi da gerceklesti, gecmiste gorunmeli.
    // Ayirma isi rapordaki SAYIMDA yapilir, listeden gizlemekle degil.
    const gecmis = src.slice(src.indexOf('async getHistory('), src.indexOf('async queueAudit('));
    expect(gecmis).not.toMatch(/where:\s*\{\s*siteId,\s*trigger:/);
  });
});
