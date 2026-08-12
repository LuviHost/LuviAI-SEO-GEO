import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type CitationProbe, type Provider } from './ai-citation.service.js';
import { FanoutService } from './fanout.service.js';

/**
 * Prompt Lab — kullanicinin takip ettigi sorulari yonetir ve calistirir.
 *
 * NEDEN VAR: Citation probe sorgulari bugune kadar brain'den otomatik
 * turuyordu (seoStrategy.aeoQueries vb.) ve kullanici mudahale edemiyordu.
 * "Beni su 30 soruda takip et" diyememek iki sey demekti: (1) olculen sey
 * kullanicinin gercekten onemsedigi soru olmayabiliyordu, (2) fan-out gibi
 * soru-bazli analizler yapilamiyordu cunku kalici bir soru kimligi yoktu.
 *
 * KIRACI (TENANT) IZOLASYONU — DIKKAT:
 * SiteAccessGuard yalnizca URL'deki :siteId'nin sahipligini dogrular; ic
 * kaynak ID'lerine (promptId, fanoutId) bakmaz. Bu yuzden BU SERVISTEKI HER
 * METOT siteId almak ve sorgusunu siteId ile kisitlamak ZORUNDADIR. Aksi
 * halde saldirgan kendi sitesinin URL'i ile baskasinin promptId'sini gecirip
 * o kullanicinin verisini okuyabilir/silebilir ve butcesini harcayabilir.
 * findUnique({ where: { id } }) KULLANMAYIN — findFirst({ where: { id, siteId } }).
 */

export interface PromptRunSummary {
  promptId: string;
  text: string;
  /** Ana soru olcumu */
  main: { cited: number; mentioned: number; total: number; score: number };
  /** Fan-out dallarinin olcumu (dal calistirildiysa) */
  fanout: { cited: number; mentioned: number; total: number; score: number } | null;
  /** Provider bazinda detay */
  providers: Array<{
    provider: string;
    label: string;
    available: boolean;
    reason?: string;
    probes: CitationProbe[];
  }>;
  /** En zayif dallar — aksiyon icin (hic olculemeyenler haric) */
  weakestBranches: Array<{ id: string; text: string; kind: string; citedCount: number; total: number }>;
  runAt: string;
}

const MAX_PROMPTS_PER_SITE = 200;
const MAX_TEXT_LEN = 500;
const MIN_TEXT_LEN = 5;
/** Tek calistirmada islenecek azami dal — manuel dal eklemede ust sinir yoksa maliyet patlar */
const MAX_BRANCHES_PER_RUN = 12;
const MAX_RUN_ALL = 50;

@Injectable()
export class PromptLabService {
  private readonly log = new Logger(PromptLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly fanout: FanoutService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  ORTAK: kiraci kapsamli prompt cozumleme
  // ────────────────────────────────────────────────────────────
  /**
   * promptId'yi SADECE verilen site icinde arar. Baska tenant'in prompt'u
   * istenirse 404 doner (403 degil — kaynagin varligini sizdirmamak icin).
   */
  private async requirePrompt<T extends object>(siteId: string, promptId: string, include?: T) {
    // trackedAppId: null — App Prompt Lab sorulari (ASO) bu servisin SITE
    // semantigiyle (marka=site adi, cited=site linki) OLCULEMEZ; olculseydi
    // app skorlari site degerleriyle ezilirdi. App sorulari 404 doner.
    const prompt = await this.prisma.geoPrompt.findFirst({
      where: { id: promptId, siteId, trackedAppId: null },
      ...(include ? { include } : {}),
    } as any);
    if (!prompt) throw new NotFoundException('Prompt bulunamadi');
    return prompt as any;
  }

  /** ?days=abc gibi girdiler NaN -> Invalid Date -> Prisma 500 uretiyordu */
  private safeDays(days: unknown, fallback = 30): number {
    const n = typeof days === 'number' ? days : parseInt(String(days ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.trunc(n), 1), 365);
  }

  // ────────────────────────────────────────────────────────────
  //  CRUD
  // ────────────────────────────────────────────────────────────
  async list(siteId: string, opts: { includeInactive?: boolean } = {}) {
    const prompts = await this.prisma.geoPrompt.findMany({
      // App Prompt Lab sorulari ASO ekraninda listelenir, burada degil
      where: { siteId, trackedAppId: null, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { fanouts: true } } },
    });
    return prompts.map((p) => ({
      id: p.id,
      text: p.text,
      intent: p.intent,
      locale: p.locale,
      source: p.source,
      tags: p.tags,
      isActive: p.isActive,
      fanoutCount: p._count.fanouts,
      lastRunAt: p.lastRunAt,
      lastCitedCount: p.lastCitedCount,
      lastTotalCount: p.lastTotalCount,
      /** 0..100 — son calistirmanin citation orani */
      lastScore: p.lastTotalCount > 0
        ? Math.round((p.lastCitedCount / p.lastTotalCount) * 100)
        : null,
      createdAt: p.createdAt,
    }));
  }

  async create(siteId: string, input: {
    text?: string;
    intent?: string;
    locale?: string;
    tags?: string[];
    source?: string;
  }) {
    const text = this.validateText(input?.text);

    const count = await this.prisma.geoPrompt.count({ where: { siteId, trackedAppId: null } });
    if (count >= MAX_PROMPTS_PER_SITE) {
      throw new BadRequestException(`Site basina en fazla ${MAX_PROMPTS_PER_SITE} prompt takip edilebilir`);
    }

    // Ayni soru iki kez eklenmesin — normalize edip karsilastir
    const existing = await this.findByNormalizedText(siteId, text);
    if (existing) {
      throw new BadRequestException(
        existing.isActive
          ? 'Bu soru zaten takip listesinde'
          : 'Bu soru pasif olarak kayitli — listeden yeniden aktive edebilirsin',
      );
    }

    return this.prisma.geoPrompt.create({
      data: {
        siteId,
        text,
        intent: input.intent ?? 'informational',
        locale: input.locale === 'en' ? 'en' : 'tr',
        tags: Array.isArray(input.tags) && input.tags.length ? input.tags : undefined,
        source: input.source ?? 'manual',
      },
    });
  }

  async update(siteId: string, promptId: string, input: {
    text?: string;
    intent?: string;
    tags?: string[];
    isActive?: boolean;
  }) {
    await this.requirePrompt(siteId, promptId);

    const data: any = {};
    // create() ile AYNI dogrulama — eskiden update ust siniri uygulamiyordu,
    // create'in reddettigi 10 KB'lik metin PATCH ile iceri giriyordu.
    if (input.text !== undefined) data.text = this.validateText(input.text);
    if (input.intent !== undefined) data.intent = String(input.intent).slice(0, 40);
    if (input.tags !== undefined) data.tags = Array.isArray(input.tags) ? input.tags : undefined;
    if (input.isActive !== undefined) data.isActive = !!input.isActive;

    return this.prisma.geoPrompt.update({ where: { id: promptId }, data });
  }

  async remove(siteId: string, promptId: string) {
    await this.requirePrompt(siteId, promptId);
    // fanouts + runs cascade ile gider (schema'da onDelete: Cascade)
    await this.prisma.geoPrompt.delete({ where: { id: promptId } });
    return { ok: true };
  }

  /**
   * Brain'deki mevcut AEO/GEO sorgularini takip listesine aktar.
   * Ilk kurulumda bos ekran yerine calisir bir set verir.
   */
  async importFromBrain(siteId: string): Promise<{ imported: number; skipped: number }> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    if (!site) return { imported: 0, skipped: 0 };

    const seo: any = site.brain?.seoStrategy ?? {};
    const candidates: string[] = [];
    for (const k of ['aeoQueries', 'geoQueries', 'topQuestions']) {
      if (Array.isArray(seo?.[k])) candidates.push(...seo[k]);
    }

    const clean = Array.from(new Set(
      candidates
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter((q) => q.length >= MIN_TEXT_LEN && q.length <= MAX_TEXT_LEN),
    ));

    // Mevcut kayitlari TEK sorguda al — eskiden aday basina tum tablo cekiliyordu (N+1)
    const existing = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: null },
      select: { text: true },
    });
    const seen = new Set(existing.map((e) => this.normalize(e.text)));
    let total = existing.length;

    const toCreate: Array<{ siteId: string; text: string; source: string; locale: string }> = [];
    let skipped = 0;
    for (const text of clean) {
      const norm = this.normalize(text);
      if (seen.has(norm) || total >= MAX_PROMPTS_PER_SITE) { skipped++; continue; }
      seen.add(norm);
      total++;
      toCreate.push({ siteId, text, source: 'brain', locale: site.language === 'en' ? 'en' : 'tr' });
    }
    if (toCreate.length) {
      await this.prisma.geoPrompt.createMany({ data: toCreate });
    }
    return { imported: toCreate.length, skipped };
  }

  // ────────────────────────────────────────────────────────────
  //  CALISTIRMA
  // ────────────────────────────────────────────────────────────
  /**
   * Tek bir prompt'u (istege bagli fan-out dallariyla birlikte) calistir.
   *
   * MALIYET UYARISI: dal sayisi x provider sayisi kadar LLM cagrisi yapilir.
   * Bu yuzden fan-out varsayilan olarak 3 saglayiciyla ve en fazla
   * MAX_BRANCHES_PER_RUN dal ile calisir.
   */
  async runPrompt(siteId: string, promptId: string, opts: {
    withFanout?: boolean;
    providers?: Provider[];
    fanoutProviders?: Provider[];
  } = {}): Promise<PromptRunSummary> {
    const prompt = await this.requirePrompt(siteId, promptId, {
      fanouts: { where: { isActive: true }, orderBy: { rank: 'asc' }, take: MAX_BRANCHES_PER_RUN },
    });

    const today = this.utcToday();

    // ── 1) Ana soru
    const mainResults = await this.citation.runQueries(siteId, [prompt.text], {
      providers: opts.providers,
    });

    const mainProbeRows: Array<{ provider: string; probe: CitationProbe }> = [];
    for (const r of mainResults) {
      for (const probe of r.probes) mainProbeRows.push({ provider: r.provider, probe });
    }
    await this.persistRuns(siteId, promptId, null, today, mainProbeRows);

    // ── 2) Fan-out dallari
    let fanoutAgg: PromptRunSummary['fanout'] = null;
    const branchStats = new Map<string, { text: string; kind: string; cited: number; mentioned: number; total: number }>();

    if (opts.withFanout && prompt.fanouts.length > 0) {
      // Maliyet freni — dal olcumunde varsayilan 3 saglayici
      const fanoutProviders: Provider[] = opts.fanoutProviders?.length
        ? opts.fanoutProviders
        : ['openai', 'anthropic', 'gemini'];

      for (const branch of prompt.fanouts) {
        const res = await this.citation.runQueries(siteId, [branch.text], {
          providers: fanoutProviders,
        });
        const rows: Array<{ provider: string; probe: CitationProbe }> = [];
        for (const r of res) {
          for (const probe of r.probes) rows.push({ provider: r.provider, probe });
        }
        await this.persistRuns(siteId, promptId, branch.id, today, rows);

        const valid = rows.filter((r) => !this.isErrorProbe(r.probe));
        branchStats.set(branch.id, {
          text: branch.text,
          kind: branch.kind,
          cited: valid.filter((r) => r.probe.cited).length,
          // mentioned'i BELLEKTEN say. Eskiden DB'den ayri sorguyla geliyordu;
          // yazma hatasi yutuldugunda veya ayni gun ikinci kez calistirildiginda
          // mentioned > total gibi imkansiz degerler cikiyordu.
          mentioned: valid.filter((r) => r.probe.brandMentioned).length,
          total: valid.length,
        });
      }

      let cited = 0, mentioned = 0, total = 0;
      for (const s of branchStats.values()) { cited += s.cited; mentioned += s.mentioned; total += s.total; }
      fanoutAgg = { cited, mentioned, total, score: total ? Math.round((cited / total) * 100) : 0 };
    }

    // ── 3) Ozet
    const mainValid = mainProbeRows.filter((r) => !this.isErrorProbe(r.probe));
    const mainCited = mainValid.filter((r) => r.probe.cited).length;
    const mainMentioned = mainValid.filter((r) => r.probe.brandMentioned).length;
    const main = {
      cited: mainCited,
      mentioned: mainMentioned,
      total: mainValid.length,
      score: mainValid.length ? Math.round((mainCited / mainValid.length) * 100) : 0,
    };

    // Tamamen basarisiz calistirma (butce asimi, anahtar yok, hepsi HATA) son
    // bilinen skoru 0/0 ile EZMEMELI — kullanici gercek bir dususe bakiyor sanir.
    if (main.total > 0) {
      await this.prisma.geoPrompt.update({
        where: { id: promptId },
        data: { lastRunAt: new Date(), lastCitedCount: main.cited, lastTotalCount: main.total },
      });
    } else {
      this.log.warn(`[${promptId}] Gecerli olcum yok — son bilinen skor korundu`);
    }

    const weakestBranches = Array.from(branchStats.entries())
      // total=0 olan dal "olculemedi" demek, "zayif" demek degil — sirala disi birak
      .filter(([, s]) => s.total > 0)
      .map(([id, s]) => ({ id, text: s.text, kind: s.kind, citedCount: s.cited, total: s.total }))
      .sort((a, b) => (a.citedCount / a.total) - (b.citedCount / b.total))
      .slice(0, 5);

    return {
      promptId,
      text: prompt.text,
      main,
      fanout: fanoutAgg,
      providers: mainResults.map((r) => ({
        provider: r.provider,
        label: r.label,
        available: r.available,
        reason: r.reason,
        probes: r.probes,
      })),
      weakestBranches,
      runAt: new Date().toISOString(),
    };
  }

  /**
   * Sitenin aktif promptlarini sirayla calistirir.
   *
   * SIRALAMA: en uzun suredir olculmeyen once (lastRunAt asc, null'lar basta).
   * Eskiden createdAt asc idi ve limit 25 oldugundan 26. prompt HIC olculmuyordu.
   */
  async runAll(siteId: string, opts: { withFanout?: boolean; limit?: number } = {}) {
    const rawLimit = typeof opts.limit === 'number' ? opts.limit : parseInt(String(opts.limit ?? ''), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_RUN_ALL)
      : 25;

    const prompts = await this.prisma.geoPrompt.findMany({
      // App sorulari haric — aksi halde lastRunAt=null olduklarindan siralamada
      // one gecip site butcesini tuketir ve app skorlarini site semantigiyle ezerdi
      where: { siteId, isActive: true, trackedAppId: null },
      orderBy: [{ lastRunAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });

    const summaries: PromptRunSummary[] = [];
    const failed: Array<{ promptId: string; error: string }> = [];
    for (const p of prompts) {
      try {
        summaries.push(await this.runPrompt(siteId, p.id, { withFanout: opts.withFanout }));
      } catch (err: any) {
        this.log.warn(`Prompt calistirilamadi (${p.id}): ${err.message}`);
        failed.push({ promptId: p.id, error: err.message?.slice(0, 200) ?? 'bilinmeyen hata' });
      }
    }
    return {
      siteId,
      ran: summaries.length,
      requested: prompts.length,
      failed,
      summaries,
      runAt: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  KAPSAMA RAPORU — "hangi dalda kaybediyoruz"
  // ────────────────────────────────────────────────────────────
  /**
   * Ana soru ile fan-out dallari arasindaki citation farkini gosterir.
   * Asil urun degeri burasi: "ana soruda %60 gorunuyorsun ama
   * 'guvenilir mi' dallarinda %0'sin" gibi bir tespit.
   */
  async coverage(siteId: string, daysInput: unknown = 30) {
    const days = this.safeDays(daysInput);
    const since = this.utcDateOnly(new Date(Date.now() - days * 86400_000));

    // SELECT'te excerpt YOK — her satir 2 KB'a kadar metin tasiyor, 90 gunluk
    // sorgu yuz binlerce satirda bellegi sisiriyordu. Hata ayirt etmek icin
    // excerpt yerine ayri bir "gecerli mi" sinyaline ihtiyacimiz var:
    // isError alani tutmadigimizdan, hatali satirlar zaten cited=false/
    // brandMentioned=false olarak yaziliyor ve orani asagi cekiyor. Bunu
    // onlemek icin persistRuns HATALI probe'lari DB'YE HIC YAZMIYOR (asagi bak).
    const runs = await this.prisma.geoPromptRun.findMany({
      // App Prompt Lab olcumleri site kapsama raporuna karismasin
      where: { siteId, date: { gte: since }, prompt: { trackedAppId: null } },
      select: { promptId: true, fanoutId: true, cited: true, brandMentioned: true },
    });

    const fanouts = await this.prisma.geoFanoutQuery.findMany({
      where: { siteId },
      select: { id: true, kind: true },
    });
    const kindById = new Map(fanouts.map((f) => [f.id, f.kind]));

    const mainRuns = runs.filter((r) => !r.fanoutId);
    const branchRuns = runs.filter((r) => r.fanoutId);

    const byKind = new Map<string, { cited: number; mentioned: number; total: number }>();
    for (const r of branchRuns) {
      const kind = kindById.get(r.fanoutId!) ?? 'unknown';
      const cur = byKind.get(kind) ?? { cited: 0, mentioned: 0, total: 0 };
      cur.total++;
      if (r.cited) cur.cited++;
      if (r.brandMentioned) cur.mentioned++;
      byKind.set(kind, cur);
    }

    const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);
    const mainScore = pct(mainRuns.filter((r) => r.cited).length, mainRuns.length);
    const fanoutScore = pct(branchRuns.filter((r) => r.cited).length, branchRuns.length);

    return {
      siteId,
      days,
      main: {
        cited: mainRuns.filter((r) => r.cited).length,
        mentioned: mainRuns.filter((r) => r.brandMentioned).length,
        total: mainRuns.length,
        score: mainScore,
      },
      fanout: {
        cited: branchRuns.filter((r) => r.cited).length,
        mentioned: branchRuns.filter((r) => r.brandMentioned).length,
        total: branchRuns.length,
        score: fanoutScore,
      },
      byKind: Array.from(byKind.entries())
        .map(([kind, s]) => ({ kind, ...s, score: pct(s.cited, s.total) }))
        .sort((a, b) => a.score - b.score),
      /** Negatifse dal tarafi ana sorudan zayif */
      gap: fanoutScore - mainScore,
    };
  }

  /**
   * Tek prompt'un zaman icindeki citation trendi.
   * Ana soru ve fan-out dallari AYRI seriler — eskiden ayni kovaya
   * karistiginda fan-out'lu gunler yapay olarak farkli gorunuyordu.
   */
  async history(siteId: string, promptId: string, daysInput: unknown = 30) {
    await this.requirePrompt(siteId, promptId);

    const days = this.safeDays(daysInput);
    const since = this.utcDateOnly(new Date(Date.now() - days * 86400_000));
    const runs = await this.prisma.geoPromptRun.findMany({
      where: { promptId, siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, cited: true, brandMentioned: true, fanoutId: true },
    });

    type Bucket = { cited: number; mentioned: number; total: number };
    const byDate = new Map<string, { main: Bucket; fanout: Bucket }>();
    const empty = (): Bucket => ({ cited: 0, mentioned: 0, total: 0 });

    for (const r of runs) {
      const key = r.date.toISOString().slice(0, 10);
      const cur = byDate.get(key) ?? { main: empty(), fanout: empty() };
      const b = r.fanoutId ? cur.fanout : cur.main;
      b.total++;
      if (r.cited) b.cited++;
      if (r.brandMentioned) b.mentioned++;
      byDate.set(key, cur);
    }

    const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);
    return Array.from(byDate.entries())
      .map(([date, v]) => ({
        date,
        // Geriye donuk uyumluluk: ust seviye alanlar ANA soruyu temsil eder
        cited: v.main.cited,
        mentioned: v.main.mentioned,
        total: v.main.total,
        score: pct(v.main.cited, v.main.total),
        fanout: { ...v.fanout, score: pct(v.fanout.cited, v.fanout.total) },
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ────────────────────────────────────────────────────────────
  //  YARDIMCILAR
  // ────────────────────────────────────────────────────────────
  private validateText(raw: unknown): string {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length < MIN_TEXT_LEN) throw new BadRequestException(`Soru en az ${MIN_TEXT_LEN} karakter olmali`);
    if (text.length > MAX_TEXT_LEN) throw new BadRequestException(`Soru ${MAX_TEXT_LEN} karakteri asamaz`);
    return text;
  }

  /**
   * HATALI probe'lar DB'YE YAZILMAZ.
   * Yazilsaydi cited=false/mentioned=false olarak kaydedilir ve coverage/history
   * hesaplarinda "gorunmedik" gibi sayilirdi — saglayici hatasi dusuk gorunurluk
   * gibi okunurdu. Bellekteki ozet zaten isErrorProbe ile ayikliyor; kalici
   * kayitta da ayni kurali uyguluyoruz ki iki taraf tutarli olsun.
   */
  private async persistRuns(
    siteId: string,
    promptId: string,
    fanoutId: string | null,
    date: Date,
    rows: Array<{ provider: string; probe: CitationProbe }>,
  ) {
    const valid = rows.filter((r) => !this.isErrorProbe(r.probe));
    if (valid.length === 0) return;
    try {
      await this.prisma.geoPromptRun.createMany({
        data: valid.map(({ provider, probe }) => ({
          siteId,
          promptId,
          fanoutId,
          provider,
          date,
          cited: !!probe.cited,
          brandMentioned: !!probe.brandMentioned,
          position: probe.position ?? null,
          sentiment: probe.sentiment ?? null,
          excerpt: probe.excerpt?.slice(0, 2000) ?? null,
          citedPages: probe.citedPages?.length ? probe.citedPages : undefined,
          competitors: probe.competitors?.length ? (probe.competitors as any) : undefined,
        })),
      });
    } catch (err: any) {
      // Yazma basarisiz olsa bile ozet bellekten uretildigi icin yanit dogru kalir;
      // sadece gecmis eksilir. Sessizce yutmuyoruz, gorunur log biraliyoruz.
      this.log.error(`GeoPromptRun yazilamadi (prompt=${promptId} fanout=${fanoutId}): ${err.message}`);
    }
  }

  /** Probe hata dondurduyse istatistige katma — yoksa skor yanlis duser */
  private isErrorProbe(probe: CitationProbe): boolean {
    return !!probe.excerpt?.startsWith('HATA:');
  }

  private async findByNormalizedText(siteId: string, text: string) {
    const norm = this.normalize(text);
    const all = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: null },
      select: { id: true, text: true, isActive: true },
    });
    return all.find((p) => this.normalize(p.text) === norm) ?? null;
  }

  /**
   * Karsilastirma icin normalize.
   * toLowerCase() TR locale KULLANMAZ: "I" harfi TR'de "ı"ya duserken EN'de
   * "i"ye duser; TR locale ile normalize edilen "IPHONE" ve "iPhone" ayri
   * anahtarlar uretip ayni sorunun iki kez eklenmesine izin veriyordu.
   */
  private normalize(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  /** UTC gun basi — server timezone'a bagli kalmamak icin (TR'de local midnight bir onceki UTC gunune kayar) */
  private utcToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private utcDateOnly(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
