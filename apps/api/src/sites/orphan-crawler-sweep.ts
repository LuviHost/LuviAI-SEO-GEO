import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { isCanonicalSiteId } from '../common/site-id.js';

/**
 * SILINMIS SITELERIN BOT KAYITLARI (yetim ai_crawler_hits / crawler_hit_events satirlari).
 *
 * NEDEN: AiCrawlerHit semada Site'a iliskisiz (FK yok, cascade yok). Site silme plani
 * (sites.service.ts siteRemovalSteps) bu iki tabloyu 5d418ac'den beri siteId ile
 * temizliyor; ondan once silinen sitelerin satirlari tabloda kaldi (uretim,
 * 18.10.2026: silinmis sitelere ait 17 ai_crawler_hits satiri). Plan sonrasinda da
 * yetim satir dogabilir: beacon (crawler-tracking.middleware.ts) site varligini
 * onbellekten bilir; onbellek suresi icinde silinen sitenin ziyaretleri yazilabilir.
 * crawler_hit_events'in FK'si migration'da var (ON DELETE CASCADE) ama uretimde bazi
 * tablolarda FK'nin olmadigi goruldu (site-removal.spec.ts) — ikisi de taranir.
 *
 * GUVENLIK: yalniz KANONIK kimlik (common/site-id.ts: kucuk harf ASCII) aday olur.
 * MySQL harmanlamasi harf / sondaki bosluk / yok sayilan karakter farkini yok sayar
 * (site-id.ts: sites tablosu utf8mb4_unicode_ci): `siteId = 'ABC'` silmesi 'abc'
 * sitesinin satirlarini da silerdi. ai_crawler_hits ise migration'da harmanlama
 * belirtilmeden olusturuldu (20260429180000_geo_v6): tablo veritabaninin varsayilanini
 * alir ve bu utf8mb4_unicode_ci olmayabilir; UCA 4.0.0 tabanli _unicode_ci PAD SPACE,
 * UCA 9.0.0 tabanli _0900_ harmanlamalar NO PAD'dir (kaynaklar, 2026-10-18'de okundu:
 * dev.mysql.com/doc/refman/8.4/en/charset-table.html "neither CHARACTER SET nor COLLATE
 * is specified, the database character set and collation are used";
 * dev.mysql.com/doc/refman/8.4/en/charset-unicode-sets.html PAD SPACE / NO PAD). Iki
 * tablonun "ayni kimlik" karari kanonik olmayan bir dizede ayrisabilir; kanonik
 * alfabede ([a-z0-9_-]) ayrismaz. Ayrica silmeden once `site.findFirst({ id })`
 * VERITABANININ kendi harmanlamasiyla sorulur — o kimlige esdeger bir site varsa
 * satirlara dokunulmaz.
 *
 * Sinir: tek turda en fazla ORPHAN_SWEEP_MAX_BATCHES parti x ORPHAN_SWEEP_BATCH satir;
 * kalan ertesi gun. Satirlar kimlikle secilip silinir (uzun satir kilidi, dev IN yok).
 */

/** Tek DELETE'te en fazla bu kadar satir */
export const ORPHAN_SWEEP_BATCH = 1000;
/** Bir turda en fazla bu kadar parti (iki tablo toplami) */
export const ORPHAN_SWEEP_MAX_BATCHES = 50;
/** Tablo basina incelenen en fazla farkli site kimligi (siteler bugun 11; tavan sorguyu sinirlar) */
export const ORPHAN_SWEEP_MAX_SITE_IDS = 10_000;

/** Taranan tablolar (Prisma model erisimcisi) */
export const ORPHAN_SWEEP_TABLES = ['aiCrawlerHit', 'crawlerHitEvent'] as const;
export type OrphanSweepTable = (typeof ORPHAN_SWEEP_TABLES)[number];

/** Sweep'in kullandigi Prisma yuzeyi — testte sahtelenebilir */
interface CrawlerTableDb {
  groupBy(args: { by: ['siteId']; orderBy: { siteId: 'asc' }; take: number }): Promise<Array<{ siteId: string }>>;
  findMany(args: { where: { siteId: string }; select: { id: true }; take: number }): Promise<Array<{ id: string }>>;
  deleteMany(args: { where: { id: { in: string[] }; siteId: string } }): Promise<{ count: number }>;
}
export interface OrphanCrawlerSweepDb {
  aiCrawlerHit: CrawlerTableDb;
  crawlerHitEvent: CrawlerTableDb;
  site: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>>;
    findFirst(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
}

export interface OrphanSweepResult {
  /** Satirlari silinen (ya da silinmeye baslanan) yetim site kimlikleri */
  orphanSiteIds: string[];
  deleted: Record<OrphanSweepTable, number>;
  batches: number;
  /** Parti tavanina ulasildi; kalanlar ertesi gun */
  more: boolean;
}

/**
 * Var olmayan sitelere ait bot satirlarini partiler halinde siler. Var olan sitenin
 * satirina dokunmaz; kanonik olmayan kimlikleri (mevcut yazicilar uretmez) silmez.
 */
export async function sweepOrphanCrawlerRows(
  db: OrphanCrawlerSweepDb,
  opts: { batch?: number; maxBatches?: number; maxSiteIds?: number } = {},
): Promise<OrphanSweepResult> {
  const batch = opts.batch ?? ORPHAN_SWEEP_BATCH;
  const maxBatches = opts.maxBatches ?? ORPHAN_SWEEP_MAX_BATCHES;
  const maxSiteIds = opts.maxSiteIds ?? ORPHAN_SWEEP_MAX_SITE_IDS;
  const result: OrphanSweepResult = { orphanSiteIds: [], deleted: { aiCrawlerHit: 0, crawlerHitEvent: 0 }, batches: 0, more: false };

  // Tablolardaki farkli site kimlikleri: groupBy kayitlari alan degerine gore gruplar.
  // findMany({ distinct }) DEGIL: Prisma'nin distinct'i MySQL'de satirlari okuyup bellekte
  // ayiklar (Prisma v6 belgesi "distinct under the hood"; 5.7.0 surum notu: yerel
  // DISTINCT yalniz PostgreSQL / CockroachDB, nativeDistinct onizlemesi) — 60 gunluk ham
  // ziyaret tablosunda her gun tum satirlar okunurdu. take icin orderBy zorunlu (Prisma v6
  // "Aggregation, grouping, and summarizing": skip/take ile groupBy orderBy ister).
  const idsByTable = new Map<OrphanSweepTable, Set<string>>();
  for (const table of ORPHAN_SWEEP_TABLES) {
    const groups = await db[table].groupBy({ by: ['siteId'], orderBy: { siteId: 'asc' }, take: maxSiteIds });
    idsByTable.set(table, new Set(groups.map((g) => g.siteId).filter(isCanonicalSiteId)));
  }
  const all = [...new Set([...idsByTable.values()].flatMap((s) => [...s]))];
  if (all.length === 0) return result;

  // Birebir var olanlar tek sorguda; kalanlar adaydir
  const existing = new Set((await db.site.findMany({ where: { id: { in: all } }, select: { id: true } })).map((s) => s.id));
  for (const siteId of all.filter((id) => !existing.has(id)).sort()) {
    // Ikinci kapi: harmanlamada esdeger bir site var mi (veritabaninin kendi kuraliyla)
    if (await db.site.findFirst({ where: { id: siteId }, select: { id: true } })) continue;
    let touched = false;
    for (const table of ORPHAN_SWEEP_TABLES) {
      if (!idsByTable.get(table)?.has(siteId)) continue;
      for (;;) {
        if (result.batches >= maxBatches) {
          result.more = true;
          if (touched) result.orphanSiteIds.push(siteId);
          return result;
        }
        const rows = await db[table].findMany({ where: { siteId }, select: { id: true }, take: batch });
        if (rows.length === 0) break;
        const res = await db[table].deleteMany({ where: { id: { in: rows.map((r) => r.id) }, siteId } });
        result.batches += 1;
        result.deleted[table] += res.count;
        touched = true;
        if (rows.length < batch) break;
      }
    }
    if (touched) result.orphanSiteIds.push(siteId);
  }
  return result;
}

/**
 * Yetim bot satiri temizligi — her gun 05:05 (Istanbul), cift-calisma kilidiyle.
 * API ve worker ayni AppModule'u yukledigi icin @Cron iki proseste tetiklenir; gunluk
 * kilit (common/cron-lock.ts) yalniz birinin calismasina izin verir.
 */
@Injectable()
export class OrphanCrawlerSweepCron {
  private readonly log = new Logger(OrphanCrawlerSweepCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('5 5 * * *', { timeZone: 'Europe/Istanbul' })
  async run(): Promise<void> {
    if (!(await acquireCronLock(this.prisma, 'orphan-crawler-sweep', 'daily'))) return;
    try {
      // Prisma'nin genel (generic) groupBy imzasi dar sahte arayuze dogrudan atanamiyor;
      // kullanilan yuzey OrphanCrawlerSweepDb'de tanimli
      const r = await sweepOrphanCrawlerRows(this.prisma as unknown as OrphanCrawlerSweepDb);
      const total = r.deleted.aiCrawlerHit + r.deleted.crawlerHitEvent;
      if (total > 0 || r.more) {
        this.log.log(
          `Silinmiş sitelerin bot kayıtları temizlendi: ${r.deleted.aiCrawlerHit} ai_crawler_hits, ${r.deleted.crawlerHitEvent} crawler_hit_events `
          + `(${r.orphanSiteIds.length} site, ${r.batches} parti)${r.more ? ' — kalanlar ertesi gün' : ''}`,
        );
      }
    } catch (err: any) {
      this.log.error(`Yetim bot kaydı temizliği başarısız: ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
}
