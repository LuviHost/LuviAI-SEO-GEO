#!/usr/bin/env tsx
/**
 * linkedin-tick — LinkedIn outreach servisini sunucu kabugundan tek sefer kosar.
 *
 * NEDEN: ilk kuru denemeler worker bayragi (OPENCLAW_LINKEDIN_OUTREACH_ENABLED)
 * ACILMADAN yapilmali; bayrak acilirsa worker 30 dk'da bir GERCEK tick atar.
 * Bu script bayragi yalniz kendi surecinde acar, servisi dogrudan cagirir.
 *
 * Kullanim (sunucuda, apps/api icinde):
 *   npx tsx scripts/linkedin-tick.ts --dry-run --force --research "Papara,Getir"   # arastirma + kuru profil acma
 *   npx tsx scripts/linkedin-tick.ts --dry-run --force                             # kuyruktakilere kuru tick
 *   npx tsx scripts/linkedin-tick.ts --overview                                    # sayaclar + son kayitlar (isim yok)
 *   npx tsx scripts/linkedin-tick.ts --real --yes                                  # GERCEK tick (gonderir!) — onay bayragi sart
 *
 * Cikti: islem listesi (type/ok/note) + ekran goruntusu yollari. Isim basilmaz.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { LinkedinOutreachService } from '../src/intel/linkedin-outreach.service.js';
import { parseArgs } from '../src/prospect/prospect-utils.js';

const args = parseArgs(process.argv.slice(2));
const DRY = args.real !== true;
if (!DRY && args.yes !== true) {
  console.error('GERCEK tick icin --real --yes gerekli (LinkedIn\'de gercekten istek/mesaj gonderir).');
  process.exit(2);
}
// NEDEN: servis enabled kontrolu bu bayraga bakar; worker'i acmadan yalniz bu surec icin aciyoruz
process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED = '1';
if (!process.env.OPENCLAW_ENABLED) process.env.OPENCLAW_ENABLED = '1';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const svc = app.get(LinkedinOutreachService);
  const log = new Logger('linkedin-tick');
  try {
    if (args.overview === true) {
      const o: any = await svc.overview();
      const { recent, ...rest } = o;
      console.log(JSON.stringify({ ...rest, recentCount: recent?.length ?? 0, recentStatuses: (recent ?? []).map((r: any) => r.status) }, null, 2));
      return;
    }
    const research = typeof args.research === 'string' ? String(args.research).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    log.log(`tick: ${DRY ? 'KURU (gonderim yok)' : 'GERCEK'} · force=${args.force === true} · research=${research?.length ?? 0} firma`);
    const r: any = await svc.tick({ dryRun: DRY, force: args.force === true, research, jitter: false } as any);
    const actions = (r.actions ?? []).map((a: any) => ({ type: a.type, ok: a.ok, note: a.note ?? '', prospectId: a.prospectId ?? '' }));
    console.log(JSON.stringify({ paused: r.paused ?? false, reason: r.reason ?? '', actions }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
