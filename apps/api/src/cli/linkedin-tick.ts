#!/usr/bin/env tsx
/**
 * linkedin-tick — LinkedIn outreach servisini sunucu kabugundan tek sefer kosar.
 *
 * NEDEN: ilk kuru denemeler worker bayragi (OPENCLAW_LINKEDIN_OUTREACH_ENABLED)
 * ACILMADAN yapilmali; bayrak acilirsa worker 30 dk'da bir GERCEK tick atar.
 * Bu script bayragi yalniz kendi surecinde acar, servisi dogrudan cagirir.
 *
 * NEDEN src/cli altinda: Nest DI decorator metadata ister; tsx/esbuild bunu uretmez
 * (createApplicationContext'te prisma undefined kalir). nest build ile derlenip
 * `node dist/cli/linkedin-tick.js` olarak kosulur.
 *
 * Kullanim (sunucuda, apps/api icinde, once `pnpm build`):
 *   node dist/cli/linkedin-tick.js --dry-run --force --research "Papara,Getir"   # arastirma + kuru profil acma
 *   node dist/cli/linkedin-tick.js --dry-run --force                             # kuyruktakilere kuru tick
 *   node dist/cli/linkedin-tick.js --overview                                    # sayaclar + son kayitlar (isim yok)
 *   node dist/cli/linkedin-tick.js --research-only --research "Papara,Getir"   # kuyrugu doldur (yazar), istek/mesaj YOK, pencere disi da calisir
 *   node dist/cli/linkedin-tick.js --real --yes                                  # GERCEK tick (gonderir!) — onay bayragi sart
 *
 * Cikti: islem listesi (type/ok/note) + ekran goruntusu yollari. Isim basilmaz.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { LinkedinOutreachService } from '../intel/linkedin-outreach.service.js';
import { readFileSync } from 'node:fs';
import { parseArgs } from '../prospect/prospect-utils.js';
import { parseSearchUrls } from '../intel/linkedin-outreach-rules.js';

const args = parseArgs(process.argv.slice(2));
const RESEARCH_ONLY = args['research-only'] === true;
// NEDEN bos deger de URL modu sayilir: `--real --urls "$BOS"` kabugu, --yes onayini atlayip GERCEK
// gonderim tick'i kosuyordu (30.08 denetimi). Bayrak verildiyse mod URL modudur; bos ise hata verip cikar.
const URL_MODE = args.urls !== undefined || args['urls-file'] !== undefined;
const DRY = args.real !== true && !RESEARCH_ONLY;
// NEDEN --urls muaf: link taramasi yalniz kuyruga yazar, LinkedIn'e istek/mesaj GONDERMEZ
if (!DRY && !RESEARCH_ONLY && !URL_MODE && args.yes !== true) {
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
    // --urls "<link1> <link2>" ya da --urls-file <yol>: kullanicinin LinkedIn arama linkleri
    const urlGirdi = typeof args.urls === 'string'
      ? String(args.urls)
      : typeof args['urls-file'] === 'string'
        ? readFileSync(String(args['urls-file']), 'utf8')
        : '';
    if (URL_MODE && !urlGirdi.trim()) {
      console.error('--urls/--urls-file verildi ama BOŞ. Gerçek tick\'e düşmemek için çıkılıyor.');
      process.exitCode = 2;
      return;
    }
    if (urlGirdi.trim()) {
      const { urls, gecersiz } = parseSearchUrls(urlGirdi);
      log.log(`link taramasi: ${urls.length} gecerli link${gecersiz.length ? `, ${gecersiz.length} gecersiz satir` : ''} · kampanya=${args.kampanya ?? 'MUSTERI'} · sayfa=${args.sayfa ?? 'varsayilan (5)'}`);
      if (urls.length === 0) { console.log(JSON.stringify({ ok: false, reason: 'Gecerli LinkedIn kisi arama linki yok', gecersiz }, null, 2)); return; }
      const r = await svc.researchUrls(urls, {
        kampanya: typeof args.kampanya === 'string' ? args.kampanya : undefined,
        sektor: typeof args.sektor === 'string' ? args.sektor : null,
        dryRun: args.real !== true,
        sayfa: Number(args.sayfa) || undefined,
      });
      console.log(JSON.stringify({ ...r, gecersiz }, null, 2));
      return;
    }
    const research = typeof args.research === 'string' ? String(args.research).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    log.log(`tick: ${DRY ? 'KURU (gonderim yok)' : RESEARCH_ONLY ? 'YALNIZ ARASTIRMA (kuyruga yazar, gonderim yok)' : 'GERCEK'} · force=${args.force === true} · research=${research?.length ?? 0} firma`);
    const r: any = await svc.tick({ dryRun: DRY, force: args.force === true, research, jitter: false, researchOnly: RESEARCH_ONLY } as any);
    const actions = (r.actions ?? []).map((a: any) => ({ type: a.type, ok: a.ok, note: a.note ?? '', prospectId: a.prospectId ?? '' }));
    console.log(JSON.stringify({ paused: r.paused ?? false, reason: r.reason ?? '', actions }, null, 2));
  } finally {
    await app.close();
    // NEDEN: app.close() sonrasi acik tutamaclar (Redis/BullMQ zamanlayicilari) sureci canli tutuyor; tick
    // bitince 10 saat asili kalan surec goruldu (30.08). Cikti yazildi, temiz cikis.
    setTimeout(() => process.exit(0), 500).unref();
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
