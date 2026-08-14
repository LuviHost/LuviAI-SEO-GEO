import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { GeoRunnerService } from './geo-runner.service.js';
import { AiCitationService } from './ai-citation.service.js';
import type { CheckResult } from './audit-checks.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Taramayi kim baslatti.
 *
 * 'user'   — kullanici panelden "Yeni tarama" dedi. RAPORDA SAYILAN TEK TUR.
 * 'system' — AUDIT_CRON haftalik otomatik tarama. Gercek bir tarama ama
 *            kullanicinin yaptigi bir is degil; "yapilan is" sayisina
 *            katilirsa cron acildigi gun sayi kendiliginden sisar.
 * 'test'   — uretimde dogrulama kosumu. Bu tur, tam olarak boyle bir kosumun
 *            kullanici taramalarindan ayirt edilemedigi fark edilince eklendi.
 */
export type AuditTrigger = 'user' | 'system' | 'test';

/** Bir taramanin karsilastirmada kullanilan ozet kimligi */
export interface AuditOzet {
  id: string;
  ranAt: Date;
  overallScore: number;
  geoScore: number | null;
}

export type CheckDurum = 'iyilesti' | 'kotulesti' | 'ayni' | 'yeni' | 'kayboldu';

export interface CheckDelta {
  id: string;
  oncekiScore: number | null;
  sonrakiScore: number | null;
  delta: number;
  durum: CheckDurum;
}

export interface AuditIssueKaydi {
  severity?: string;
  type?: string;
  page?: string;
  description?: string;
  fixable?: boolean;
  checkId?: string;
  [k: string]: unknown;
}

export interface AuditKarsilastirma {
  from: AuditOzet | null;
  to: AuditOzet | null;
  scoreDelta: number;
  geoScoreDelta: number;
  checks: CheckDelta[];
  issues: {
    cozulen: AuditIssueKaydi[];
    yeniCikan: AuditIssueKaydi[];
    devamEden: AuditIssueKaydi[];
  };
  ozet: { cozulenSayisi: number; yeniSayisi: number; devamEdenSayisi: number };
  yeterliVeriYok?: boolean;
}

/**
 * Issue eslestirme anahtari.
 *
 * Audit.issues opak bir Json dizisi; kayitlarin KALICI id'si yok, her tarama
 * listeyi sifirdan uretiyor. Iki tarama arasinda "ayni sorun mu" sorusunu
 * cevaplamak icin en kararli bilesim `type + page`: type kontrol uretecinden
 * sabit gelir (meta_title_missing gibi), page ise sorunun hangi URL'de
 * oldugunu ayirir — ayni type farkli sayfalarda ayri sorun sayilmali.
 * Ikisi de yoksa (ornek: PageSpeed/GEO gibi site geneli, type'siz kayitlar)
 * description'in ilk 80 karakterine duseriz; tam metin degil, cunku aciklama
 * icinde degisen sayilar (skor, saniye) var ve bunlar her taramada oynayip
 * ayni sorunu "cozuldu + yeni cikti" olarak ikiye bolerdi.
 */
export function issueKey(issue: AuditIssueKaydi): string {
  const type = typeof issue?.type === 'string' ? issue.type.trim() : '';
  const page = typeof issue?.page === 'string' ? issue.page.trim() : '';
  if (type || page) return `${type}|${page}`;
  const desc = typeof issue?.description === 'string' ? issue.description : '';
  return `desc:${desc.slice(0, 80)}`;
}

/** checks Json'undaki bir girdiden 0-100 skoru cikarir; yoksa null */
function checkScore(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const s = (entry as { score?: unknown }).score;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}

function ozetle(row: any): AuditOzet | null {
  if (!row) return null;
  return {
    id: row.id,
    ranAt: row.ranAt,
    overallScore: row.overallScore,
    geoScore: row.geoScore ?? null,
  };
}

function issueListesi(row: any): AuditIssueKaydi[] {
  const raw = row?.issues;
  return Array.isArray(raw) ? (raw as AuditIssueKaydi[]) : [];
}

/**
 * Iki audit satirini karsilastiran SAF cekirdek — DB'ye dokunmaz, testin
 * hedefi budur. Satirlardan biri (from) null olabilir: ilk tarama durumu.
 */
export function compareAuditRows(fromRow: any, toRow: any): AuditKarsilastirma {
  const from = ozetle(fromRow);
  const to = ozetle(toRow);

  const bos: AuditKarsilastirma = {
    from,
    to,
    scoreDelta: 0,
    geoScoreDelta: 0,
    checks: [],
    issues: { cozulen: [], yeniCikan: [], devamEden: [] },
    ozet: { cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0 },
  };

  // Tek tarama (veya hic tarama) — karsilastiracak referans yok.
  if (!from || !to) return { ...bos, yeterliVeriYok: true };

  // ── Skor deltalari ────────────────────────────────────────────
  const scoreDelta = (to.overallScore ?? 0) - (from.overallScore ?? 0);
  const geoScoreDelta =
    typeof to.geoScore === 'number' && typeof from.geoScore === 'number'
      ? to.geoScore - from.geoScore
      : 0;

  // ── Per-check delta ───────────────────────────────────────────
  // checks her taramada AYNI anahtarlarla yazilir (runAudit'teki create),
  // yani anahtar bazli eslesme guvenli. Yine de eski taramalar yeni eklenen
  // kontrolleri icermeyebilir; o yuzden iki tarafin anahtar birlesimi gezilir.
  const fromChecks = (fromRow?.checks ?? {}) as Record<string, unknown>;
  const toChecks = (toRow?.checks ?? {}) as Record<string, unknown>;
  const checkIds = Array.from(
    new Set([...Object.keys(fromChecks), ...Object.keys(toChecks)]),
  );

  const checks: CheckDelta[] = [];
  for (const id of checkIds) {
    const oncekiScore = checkScore(fromChecks[id]);
    const sonrakiScore = checkScore(toChecks[id]);
    // Iki tarafta da skor yoksa (ornek: pagespeed null dondu) satir uretme —
    // kullaniciya "0 -> 0, ayni" gurultusu gosterilmemeli.
    if (oncekiScore === null && sonrakiScore === null) continue;

    let durum: CheckDurum;
    let delta = 0;
    if (oncekiScore === null) {
      durum = 'yeni';
    } else if (sonrakiScore === null) {
      durum = 'kayboldu';
    } else {
      // delta yalnizca iki uc da olculebildiginde anlamli; yeni/kayboldu
      // durumlarinda 0 birakilir ki "+87 puan" gibi sahte sicramalar cikmasin.
      delta = sonrakiScore - oncekiScore;
      durum = delta > 0 ? 'iyilesti' : delta < 0 ? 'kotulesti' : 'ayni';
    }

    checks.push({ id, oncekiScore, sonrakiScore, delta, durum });
  }
  // Once en cok degisenler (mutlak delta), sonra alfabetik — kullanici paneli
  // acinca once "ne degisti" gorsun.
  checks.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id));

  // ── Issue eslestirme ──────────────────────────────────────────
  const oncekiIssues = issueListesi(fromRow);
  const sonrakiIssues = issueListesi(toRow);

  const oncekiMap = new Map<string, AuditIssueKaydi>();
  for (const i of oncekiIssues) if (!oncekiMap.has(issueKey(i))) oncekiMap.set(issueKey(i), i);
  const sonrakiMap = new Map<string, AuditIssueKaydi>();
  for (const i of sonrakiIssues) if (!sonrakiMap.has(issueKey(i))) sonrakiMap.set(issueKey(i), i);

  const cozulen: AuditIssueKaydi[] = [];
  const devamEden: AuditIssueKaydi[] = [];
  for (const [key, issue] of oncekiMap) {
    if (sonrakiMap.has(key)) devamEden.push(sonrakiMap.get(key)!);
    else cozulen.push(issue);
  }
  const yeniCikan: AuditIssueKaydi[] = [];
  for (const [key, issue] of sonrakiMap) {
    if (!oncekiMap.has(key)) yeniCikan.push(issue);
  }

  return {
    from,
    to,
    scoreDelta,
    geoScoreDelta,
    checks,
    issues: { cozulen, yeniCikan, devamEden },
    ozet: {
      cozulenSayisi: cozulen.length,
      yeniSayisi: yeniCikan.length,
      devamEdenSayisi: devamEden.length,
    },
  };
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
    private readonly checks: AuditChecksService,
    private readonly pagespeed: PageSpeedService,
    private readonly geo: GeoRunnerService,
    private readonly aiCitation: AiCitationService,
    private readonly jobQueue: JobQueueService,
  ) {}

  async getLatest(siteId: string) {
    return this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
  }

  /**
   * Tarama gecmisi — en yeni once.
   *
   * checks Json'u BILEREK cekilmiyor: 14 kontrolun tam ciktisi tarama basina
   * yuzlerce KB tutabiliyor ve liste ucunda hicbir ise yaramiyor. issues ise
   * yalnizca sayisini uretmek icin okunur, cevaba konmaz.
   */
  async getHistory(siteId: string, limit = 20) {
    const guvenliLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const rows = await this.prisma.audit.findMany({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
      take: guvenliLimit,
      select: {
        id: true,
        ranAt: true,
        overallScore: true,
        geoScore: true,
        issues: true,
        durationMs: true,
        // Gecmis listesi taramanin kaynagini GOSTERIR ama gizlemez: tarama
        // gercekten calisti, kaydi durmali. Rapor "yapilan is" sayarken
        // yalnizca 'user' olanlari sayar; arayuz digerlerini rozetle ayirir.
        trigger: true,
      },
    });

    return rows.map((a) => ({
      id: a.id,
      ranAt: a.ranAt,
      overallScore: a.overallScore,
      geoScore: a.geoScore,
      issueCount: Array.isArray(a.issues) ? a.issues.length : 0,
      durationMs: a.durationMs,
    }));
  }

  /**
   * Iki tarama arasindaki farki cikarir. fromId/toId verilmezse son IKI tarama
   * karsilastirilir (from = bir onceki, to = en son).
   *
   * Tek tarama varsa HATA ATMAZ: yeterliVeriYok:true ile bos ama anlamli bir
   * sonuc doner — cagiran yuzey "en az iki tarama gerekli" durumunu bu bayrakla
   * gosterir, 404/500 ile karsilasmaz.
   */
  async compareAudits(
    siteId: string,
    opts: { fromId?: string; toId?: string } = {},
  ): Promise<AuditKarsilastirma> {
    let fromRow: any = null;
    let toRow: any = null;

    if (opts.fromId || opts.toId) {
      // siteId filtresi zorunlu: id'ler govdeden/query'den gelir, baska bir
      // musterinin audit id'si gecirilirse eslesme olmamalidir.
      const [f, t] = await Promise.all([
        opts.fromId
          ? this.prisma.audit.findFirst({ where: { id: opts.fromId, siteId } })
          : Promise.resolve(null),
        opts.toId
          ? this.prisma.audit.findFirst({ where: { id: opts.toId, siteId } })
          : Promise.resolve(null),
      ]);
      fromRow = f;
      toRow = t;
      // Yalnizca biri verilmisse eksik tarafi son taramayla tamamla
      if (!toRow) toRow = await this.getLatest(siteId);
      if (!fromRow && toRow) {
        fromRow = await this.prisma.audit.findFirst({
          where: { siteId, ranAt: { lt: toRow.ranAt } },
          orderBy: { ranAt: 'desc' },
        });
      }
    } else {
      const sonIki = await this.prisma.audit.findMany({
        where: { siteId },
        orderBy: { ranAt: 'desc' },
        take: 2,
      });
      toRow = sonIki[0] ?? null;
      fromRow = sonIki[1] ?? null;
    }

    return compareAuditRows(fromRow, toRow);
  }

  /**
   * Taramayi KUYRUGA atar ve is kaydini doner.
   *
   * ONCEDEN prisma.job.create ile yalnizca DB satiri yaziyordu — BullMQ'ya
   * hicbir sey eklenmiyordu. Worker BullMQ tuketicisi oldugu icin o is
   * sonsuza kadar QUEUED kaliyor, hicbir zaman calismiyordu. Yani bu uc
   * sessizce ise yaramiyordu. JobQueueService.enqueue hem DB satirini hem
   * BullMQ kaydini olusturur ve bullJobId'yi geri yazar.
   *
   * DONUS SEKLI BILEREK YENIDEN ADLANDIRILIYOR: enqueue `{ dbJobId, bullJobId }`
   * doner, ama bu ucun tuketicisi `{ id }` bekliyor — cunku bir sonraki adim
   * GET /jobs/:id yoklamasi. Ham sekli oldugu gibi gecirince istemci
   * `job.id` okuyup `undefined` aliyor ve yoklama ilk istekte patliyor.
   * (Tam olarak bu yasandi; tsc yakalamadi cunku web kendi donus tipini
   * bagimsiz beyan ediyor.) Uc, is kimligini HER ZAMAN `id` adiyla verir.
   */
  async queueAudit(siteId: string): Promise<{ id: string; status: 'QUEUED'; bullJobId: string }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const { dbJobId, bullJobId } = await this.jobQueue.enqueue({
      type: 'SITE_AUDIT',
      userId: site.userId,
      siteId,
      payload: { siteId, url: site.url },
      priority: 5,
    });
    return { id: dbJobId, status: 'QUEUED', bullJobId: String(bullJobId) };
  }

  /**
   * Worker'dan çağrılan asıl iş — 14 kontrol + PageSpeed + GEO.
   */
  /**
   * @param opts.trigger 'user' (varsayilan) kullanicinin baslattigi tarama —
   *   citation kotasi dayatilir. 'system' zamanlanmis periyodik tarama —
   *   kotayi TUKETMEZ. Aksi halde haftalik otomatik tarama, kullanicinin
   *   kendi olcumleri icin ayirdigi hakki sessizce yer ve "kotam neden bitti"
   *   sorusu dogar.
   */
  async runAudit(siteId: string, opts: { trigger?: AuditTrigger } = {}) {
    const t0 = Date.now();
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    this.log.log(`[${siteId}] Audit başlıyor: ${site.url}`);

    // 1) Site crawl — orphan/internal-linking analizinin doğru olması için tüm
    // siteyi tara (30 ile yarım kalıyordu → link grafiği eksik → yanlış orphan).
    const crawl = await this.crawler.crawl(site.url, 100);
    this.log.log(`[${siteId}] ${crawl.pages.length} sayfa crawl edildi`);

    // 2) 14 kontrol noktası
    const checkResults = await this.checks.runAllChecks(crawl);
    const overallScore = this.checks.computeOverallScore(checkResults);

    // 3) PageSpeed (asenkron — başarısızsa null)
    const pagespeedResult = await this.pagespeed.runAudit(site.url, 'mobile');

    // 4) Auriti GEO + AI Citation (Claude/Gemini/OpenAI/Perplexity) — paralel
    const [geoResult, citationResults] = await Promise.all([
      this.geo.runAudit(site.url),
      // KULLANICI tetikli (varsayilan) — audit'i kullanici baslatir, citation
      // kotasi gercekten dayatilir. Kota doluysa runForSite artik firlatir;
      // asagidaki catch audit'in geri kalanini ayakta tutar, yalnizca citation
      // bolumu bos doner.
      // Kota acisindan yalnizca GERCEK kullanici taramasi hak tuketir.
      // 'test' de 'system' gibi davranir: dogrulama kosumu musterinin aylik
      // gorunurluk hakkini yiyemez.
      this.aiCitation.runForSite(siteId, 5, {
        trigger: (opts.trigger ?? 'user') === 'user' ? 'user' : 'system',
      }).catch((err) => {
        this.log.warn(`[${siteId}] AI Citation testi basarisiz: ${err.message}`);
        return [] as Awaited<ReturnType<AiCitationService['runForSite']>>;
      }),
    ]);

    // AI Citation ortalama skoru (sadece available + skor olanlar)
    const validCitationScores = citationResults
      .filter((r) => r.available && typeof r.score === 'number')
      .map((r) => r.score as number);
    const aiCitationAvg = validCitationScores.length > 0
      ? Math.round(validCitationScores.reduce((a, b) => a + b, 0) / validCitationScores.length)
      : null;

    // 5) Issues consolidate
    const allIssues = checkResults.flatMap(r => r.issues.map(i => ({
      ...i,
      checkId: r.id,
    })));

    // AI Citation skor 0/dusuk ise issue olarak ekle
    if (aiCitationAvg !== null && aiCitationAvg < 30) {
      allIssues.push({
        severity: 'warning' as const,
        type: 'ai_citation_low',
        description: `AI arama görünürlüğü düşük (${aiCitationAvg}/100) — ChatGPT/Claude/Gemini sorgularinda site URL'in nadiren geçiyor. llms.txt + schema markup + GEO içerik üretimi öner.`,
        fixable: true,
        checkId: 'ai_citation',
      } as any);
    }

    // GEO metod skorları düşükse fixable issue olarak çıkar — snippet generator'a yol açar
    const geoIssueMap: Record<string, { type: string; checkId: string; desc: string }> = {
      faq_qa: {
        type: 'faq_missing',
        checkId: 'geo_faq',
        desc: 'FAQ schema ve soru-cevap formatı eksik (GEO ağırlığı 12) — jsonld_faq snippet üretici hazır.',
      },
      definition: {
        type: 'definition_missing',
        checkId: 'geo_definition',
        desc: 'Tanım yoğunluğu düşük ("X nedir?" tarzı içerik yok) — jsonld_defined_term snippet üretici hazır.',
      },
      citation_format: {
        type: 'citation_format_missing',
        checkId: 'geo_citation_format',
        desc: 'Liste/tablo formatı eksik — AI motorları madde işaretli özetleri atıf olarak tercih eder.',
      },
      freshness: {
        type: 'freshness_missing',
        checkId: 'geo_freshness',
        desc: 'datePublished / dateModified sinyali eksik — Article schema basıldığında otomatik çözülür.',
      },
    };
    for (const m of geoResult.methods ?? []) {
      const map = geoIssueMap[m.id];
      if (!map) continue;
      if (typeof m.score === 'number' && m.score < 30) {
        allIssues.push({
          severity: 'warning' as const,
          type: map.type,
          description: `${map.desc} (mevcut skor ${m.score}/100)`,
          fixable: true,
          checkId: map.checkId,
        } as any);
      }
    }

    // PageSpeed opportunities → issue
    if (pagespeedResult?.opportunities) {
      for (const opp of pagespeedResult.opportunities) {
        allIssues.push({
          severity: 'warning' as const,
          type: `pagespeed_${opp.id}`,
          description: `${opp.title} — ${(opp.savings / 1000).toFixed(1)}s tasarruf`,
          fixable: false,
          checkId: 'pagespeed',
        });
      }
    }

    // 6) DB'ye yaz
    const audit = await this.prisma.audit.create({
      data: {
        siteId,
        overallScore,
        geoScore: geoResult.score ?? null,
        checks: {
          ...Object.fromEntries(checkResults.map(r => [r.id, r])),
          pagespeed: pagespeedResult,
          geo: geoResult as any,
          aiCitations: {
            id: 'ai_citations',
            name: 'AI arama gorunurlugu (Claude · Gemini · ChatGPT · Perplexity)',
            score: aiCitationAvg ?? 0,
            providers: citationResults,
            ranAt: new Date().toISOString(),
          } as any,
        },
        issues: allIssues,
        durationMs: Date.now() - t0,
        // Taramayi kimin baslattigi KALICI olarak yaziliyor. Onceden bu deger
        // yalnizca kota kararinda kullanilip atiliyordu; sonuc olarak gecmiste
        // bir taramanin kullaniciya mi, cron'a mi, yoksa bir dogrulama
        // kosumuna mi ait oldugu anlasilamiyordu. Rapor "yapilan is" sayarken
        // yalnizca 'user' taramalarini sayacak.
        trigger: opts.trigger ?? 'user',
      },
    });

    // 7) Site status güncelle
    await this.prisma.site.update({
      where: { id: siteId },
      data: { status: 'AUDIT_COMPLETE' },
    });

    this.log.log(`[${siteId}] Audit bitti — skor: ${overallScore}/100, GEO: ${geoResult.score ?? '-'}/100, AI citation: ${aiCitationAvg ?? '-'}/100, ${allIssues.length} issue, ${(Date.now() - t0) / 1000}s`);

    return audit;
  }
}
