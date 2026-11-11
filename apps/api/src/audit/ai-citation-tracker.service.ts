import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { citationCounts } from './citation-score.js';
import { providerTrend, versionedHeadline, type VersionedPoint } from './citation-history-trend.js';
import { assessStability } from './visibility-variance.js';
import { compareCitationRuns, headlineOfProviders, type RunProvider, type RunSummary } from './citation-run-compare.js';
import { AiCitationService } from './ai-citation.service.js';
import { siteMeasurementVersion } from './host-match.js';
import { ownerEngines } from '../billing/plan-engines.js';
import {
  gorunmeAraligi, gorunmeSayaci, olcumBelirsizligi, soruSayisi, tekrarSayisi, wilsonAraligi,
  type GorunmeAraligi, type GorunmeSayaci, type GunKosumu, type OlcumBelirsizligi, type TrendRef,
} from './visibility-interval.js';

/**
 * getHistory'nin olcum belirsizligi blogu (visibility-interval.ts) + "ön sonuç":
 * guncel yontemle (son kosumun surumu) yalniz bir olcum varsa true.
 */
export type HistoryOlcum = OlcumBelirsizligi & { onSonuc: boolean };

const DAY_MS = 86_400_000;
const gunNo = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Kosumun providers JSON'undan gun kosumu (asistan bazinda gorunme sayaci, tekrar, soru sayisi) */
function gunKosumuOf(date: string, runAt: Date, matchVersion: number, providers: unknown): GunKosumu {
  const list = Array.isArray(providers) ? (providers as Array<Partial<RunProvider>>) : [];
  const asistanlar: Record<string, GorunmeSayaci> = {};
  let tekrar = 1;
  const tumProbe: RunProvider['probes'] = [];
  for (const p of list) {
    if (!p || typeof p.provider !== 'string') continue;
    const probes = Array.isArray(p.probes) ? p.probes : [];
    tumProbe.push(...probes);
    asistanlar[p.provider] = gorunmeSayaci(probes);
    tekrar = Math.max(tekrar, typeof p.tekrar === 'number' ? p.tekrar : tekrarSayisi(probes));
  }
  return { date, runAt: runAt.toISOString(), matchVersion, asistanlar, tekrar, soruSayisi: soruSayisi(tumProbe) };
}

/**
 * AI Citation Tracker — gunluk cron, her aktif site icin Claude/Gemini/OpenAI/Perplexity
 * gorunurluk testi yap, sonucu ai_citation_snapshots tablosuna yaz.
 *
 * Frontend'de 30/90/365 gunluk trend grafigi cizilir.
 * Drop tespit edilirse alert gonderilir (ChatGPT 2 hafta once alintililiyordu, artik degil).
 */
/** snapshotSite'in saglayici basina probe sayisi — runForSite(siteId, 5) ile ayni */
const SNAPSHOT_PROBES = 5;

@Injectable()
export class AiCitationTrackerService {
  private readonly log = new Logger(AiCitationTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
  ) {}

  /**
   * Tek bir site icin snapshot al ve DB'ye yaz.
   *
   * @param opts.trigger 'user' (VARSAYILAN) kullanicinin acikca istedigi
   *   snapshot — aylik citation kotasi dayatilir ve tuketilir.
   *   'system' platformun kendi otomatik izlemesi (gunluk cron, onboarding
   *   baseline) — kota ne kontrol edilir ne de tuketilir; aksi halde kullanici
   *   hicbir sey yapmadan kotasi bitiyordu (bkz. ai-citation.service.ts).
   */
  async snapshotSite(
    siteId: string,
    opts: { trigger?: 'user' | 'system' } = {},
  ): Promise<{
    saved: number; results: any[]; runAt: string; runId: string | null;
    /** Her soru her asistana kac kez soruldu (en buyuk) ve kac farkli soru */
    tekrar: number; soruSayisi: number;
    /** Tum asistanlar ve tekrarlar uzerinden gorunme sikliginin %95 Wilson araligi */
    gorunme: GorunmeAraligi | null;
  }> {
    // Tekrar sayisi (N) runForSite'ta plana gore cozulur (citation-repeat.ts)
    const results = await this.citation.runForSite(siteId, SNAPSHOT_PROBES, { trigger: opts.trigger ?? 'user' });
    const runAt = new Date().toISOString();
    // UTC midnight — server timezone'a bagli kalmamak icin (TR'de setHours(0,0,0,0) bir onceki UTC gunune kayar)
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Yontem surumu olcumun yapildigi model kademesinden (host-match siteMeasurementVersion):
    // Baslangic / deneme (hizli model, dort asistan) ayri numara tasir — paket degistiren
    // hesabin iki olcumu "yontem degisti" diye ayrilir, model farki gorunurluk farki okunmaz.
    const surum = siteMeasurementVersion(results.find((r) => r.modelTier)?.modelTier);

    let saved = 0;
    for (const r of results) {
      try {
        const probes = r.probes ?? [];
        // Sayaclar markasiz sorgulardan, skorla AYNI fonksiyondan
        // (citationCounts) — sayac tanimi baska yerde tekrarlanmaz. probes
        // JSON'una TUM probe'lar (brandInQuery damgasiyla) yazilir: veri
        // kaybolmaz ve eski/yeni yontem kayittan ayirt edilebilir.
        const { cited, mentioned } = citationCounts(probes as any[]);

        await this.prisma.aiCitationSnapshot.upsert({
          where: { siteId_date_provider: { siteId, date: today, provider: r.provider } },
          // Site olcumu surumu (host-match.ts SITE_MEASUREMENT_VERSION): tekrarli
          // olcum v6; v5 tek turlu olcumle kiyaslanmaz. probes JSON'u tum
          // tekrarlari `tekrar` damgasiyla tasir.
          update: {
            available: r.available,
            score: r.score,
            probes: probes as any,
            citedCount: cited,
            mentionedCount: mentioned,
            matchVersion: surum,
          },
          create: {
            siteId,
            date: today,
            provider: r.provider,
            available: r.available,
            score: r.score,
            probes: probes as any,
            citedCount: cited,
            mentionedCount: mentioned,
            matchVersion: surum,
          },
        });
        saved++;
      } catch (err: any) {
        this.log.warn(`[${siteId}] Snapshot kaydedilemedi (${r.provider}): ${err.message}`);
      }
    }

    // HER KOSUM KALICI: ayni gun ikinci "Yeniden Test" gunluk snapshot'i
    // (siteId+date+provider unique) uzerine yazar; musteri onceki sonucu
    // kaybetmesin ve iki testi kiyaslayabilsin diye kosumlar AiCitationRun'a
    // append-only yazilir (excerpt kirpilmis). Basarisizlik olcumu bozmaz.
    const providersJson: RunProvider[] = results.map((r) => ({
      provider: r.provider,
      label: r.label,
      available: r.available,
      score: r.score,
      reason: r.reason ?? null,
      // Olcum belirsizligi (visibility-interval.ts) — JSON'da: migration yok.
      // Eski kosumda alanlar yok; okuyan probe'lardan yeniden hesaplar.
      tekrar: typeof r.tekrar === 'number' ? r.tekrar : tekrarSayisi(r.probes ?? []),
      gorunme: r.gorunme !== undefined ? r.gorunme : gorunmeAraligi(r.probes ?? []),
      probes: (r.probes ?? []).map((pr) => ({
        query: pr.query,
        cited: !!pr.cited,
        brandMentioned: !!pr.brandMentioned,
        brandInQuery: pr.brandInQuery ?? false,
        position: pr.position ?? null,
        sentiment: pr.sentiment ?? null,
        excerpt: pr.excerpt?.slice(0, 400) ?? null,
        ...(pr.citedPages?.length ? { citedPages: pr.citedPages } : {}),
        ...(typeof pr.tekrar === 'number' ? { tekrar: pr.tekrar } : {}),
        // Alintilanan kaynaklar (GEO Faz 2) kosuma BILEREK yazilmaz: kaynak
        // raporu gunluk snapshot (yukarida, probes JSON'u) + GeoPromptRun'u
        // okur; listRuns 100 kosumun providers JSON'unu tamamen okudugu icin
        // kaynaklar her listeyi MB'larca buyuturdu (citation-sources.ts).
      })),
    }));
    const tumProbe = results.flatMap((r) => r.probes ?? []);
    const counts = citationCounts(tumProbe as any[]);
    let runId: string | null = null;
    try {
      const run = await this.prisma.aiCitationRun.create({
        data: {
          siteId,
          runAt: new Date(runAt),
          trigger: opts.trigger ?? 'user',
          headlineScore: headlineOfProviders(providersJson),
          citedCount: counts.cited,
          mentionedCount: counts.mentioned,
          poolSize: counts.poolSize,
          providers: providersJson as any,
          matchVersion: surum,
        },
        select: { id: true },
      });
      runId = run.id;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Kosum kaydi yazilamadi: ${err.message}`);
    }

    // Genel aralik: kosumun citedCount + mentionedCount / poolSize'i ile AYNI havuz
    return {
      saved, results, runAt, runId,
      tekrar: Math.max(1, ...providersJson.map((p) => p.tekrar ?? 1)),
      soruSayisi: soruSayisi(tumProbe),
      gorunme: wilsonAraligi(counts.cited + counts.mentioned, counts.poolSize),
    };
  }

  /**
   * Tum aktif siteler icin snapshot — gunluk cron tarafindan cagrilir.
   * Platformun kendi izlemesi oldugu icin SISTEM modunda kosar: kullanicinin
   * citation kotasini ne kontrol eder ne de tuketir.
   */
  async snapshotAllActive(): Promise<{ sites: number; snapshots: number }> {
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      select: { id: true, name: true },
    });

    let totalSnapshots = 0;
    for (const site of sites) {
      try {
        const r = await this.snapshotSite(site.id, { trigger: 'system' });
        totalSnapshots += r.saved;
      } catch (err: any) {
        this.log.warn(`[${site.id}] AI citation daily fail: ${err.message}`);
      }
    }
    this.log.log(`AI Citation daily: ${sites.length} site, ${totalSnapshots} snapshot kaydedildi`);
    return { sites: sites.length, snapshots: totalSnapshots };
  }

  // ── Test gecmisi (append-only kosumlar) ──────────────────────

  async listRuns(siteId: string, limit = 30) {
    const runs = await this.prisma.aiCitationRun.findMany({
      where: { siteId },
      orderBy: { runAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, runAt: true, trigger: true, headlineScore: true, citedCount: true, mentionedCount: true, poolSize: true, providers: true },
    });
    return runs.map((r) => {
      const providers = Array.isArray(r.providers) ? (r.providers as any[]) : [];
      return {
        id: r.id,
        runAt: r.runAt.toISOString(),
        trigger: r.trigger,
        headlineScore: r.headlineScore,
        citedCount: r.citedCount,
        mentionedCount: r.mentionedCount,
        poolSize: r.poolSize,
        // Olcum belirsizligi: kosum sutunlarindan (skorla ayni havuz) — eski kosumlarda da hesaplanir
        gorunme: wilsonAraligi(r.citedCount + r.mentionedCount, r.poolSize),
        tekrar: Math.max(1, ...providers.map((p) => (typeof p?.tekrar === 'number' ? p.tekrar : tekrarSayisi(Array.isArray(p?.probes) ? p.probes : [])))),
        // Liste hafif kalsin: saglayici skorlari, probe'lar yok
        providers: providers.map((p) => ({ provider: p.provider, label: p.label, available: p.available, score: p.score })),
      };
    });
  }

  async getRun(siteId: string, id: string): Promise<RunSummary | null> {
    const r = await this.prisma.aiCitationRun.findFirst({ where: { id, siteId } });
    if (!r) return null;
    return { id: r.id, runAt: r.runAt.toISOString(), trigger: r.trigger, headlineScore: r.headlineScore, providers: (r.providers as any[]) ?? [], matchVersion: r.matchVersion };
  }

  /** a = onceki, b = sonraki (siralama gonderen tarafa bagli degil; runAt'e gore duzeltilir) */
  async compareRuns(siteId: string, aId: string, bId: string) {
    const [ra, rb] = await Promise.all([this.getRun(siteId, aId), this.getRun(siteId, bId)]);
    if (!ra || !rb) return null;
    const [first, second] = ra.runAt <= rb.runAt ? [ra, rb] : [rb, ra];
    return compareCitationRuns(first, second);
  }

  /**
   * Frontend icin: bir site icin son N gun trend.
   *
   * YONTEM SURUMU: fark, baslangic ve manset yalniz her saglayicinin GUNCEL
   * olcum yontemi (matchVersion) kesitinden hesaplanir (citation-history-trend.ts).
   * Pencerede eski yontemli olcum varsa trends[].methodChanged /
   * headline.methodChanged true doner ve kesit disina tasan kiyas yapilmaz;
   * byProvider noktalari matchVersion tasir (grafik kirilma gununu isaretler).
   *
   * @param headlineOnly true ise probe JSON'lari cekilmez ve byProvider /
   *   latestResults donmez — overview kartlari gibi yalnizca manset sayiya
   *   ihtiyac duyan yuzeyler icin (30 gun x 7 saglayici x 5 probe excerpt
   *   megabaytlara varabiliyor).
   *
   * Probe JSON'u yalniz saglayici basina SON snapshot icin cekilir (yalniz o
   * donuyor). Eskiden penceredeki tum satirlarin probe'lari okunup atiliyordu;
   * probe'lar alintilanan kaynaklari da tasidigindan beri (GEO Faz 2, satir
   * basina ~5-10 KB ek) 365 gunluk pencerede bu onlarca MB demekti.
   */
  async getHistory(siteId: string, days = 30, headlineOnly = false) {
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const tumSnapshotlar = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: {
        provider: true, date: true, score: true, citedCount: true, mentionedCount: true,
        available: true, createdAt: true, matchVersion: true, id: true,
      },
    });
    // PLAN KAPSAMI (11.11.2026): gecmis, hesabin BUGUN olctugu asistanlarla okunur. Paketi
    // daralan hesabin (Profesyonel → Baslangic / deneme; deploy gununde mevcut deneme
    // hesaplari) eski Grok / DeepSeek / Muse satirlari pencereden cikana kadar grafikte,
    // trendde ve "son sonuc" listesinde duruyor, olcmedigimiz asistani olculuyor gosteriyordu.
    const kapsam = await this.sahipKapsami(siteId);
    const snapshots = kapsam ? tumSnapshotlar.filter((s) => kapsam.has(s.provider)) : tumSnapshotlar;

    // Group by provider
    const byProvider: Record<string, VersionedPoint[]> = {};
    for (const s of snapshots) {
      const key = s.provider;
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push({
        date: s.date.toISOString().slice(0, 10),
        score: s.score,
        cited: s.citedCount,
        mentioned: s.mentionedCount,
        matchVersion: s.matchVersion ?? 1,
      });
    }

    // Trend: ilk vs son (drop tespit) + 7g ortalama — yalniz guncel yontem kesitinden
    const trends = Object.entries(byProvider).map(([provider, series]) => providerTrend(provider, series));
    // Manset: chart, overview ve analytics-row AYNI sayiyi soylemeli — tek kaynak burasi.
    const { headline, segments } = versionedHeadline(byProvider);

    // "Son test" zamani: snapshot upsert'in update dali createdAt'e dokunmadigi
    // icin ayni gun ikinci testten sonra hala ilk kosumu gosteriyordu. Kosum
    // kaydi (AiCitationRun) daha dogru; yoksa snapshot'a dusulur.
    const lastRun = await this.prisma.aiCitationRun.findFirst({ where: { siteId }, orderBy: { runAt: 'desc' }, select: { runAt: true, matchVersion: true } });

    // Olcum belirsizligi: skorun yanindaki ±X, "N tekrar × M soru", ön sonuç ve
    // "artti/azaldi yalniz araliklar ortusmuyorsa" kararlari (visibility-interval.ts).
    const stabilityDays = headline.daily.slice(-14);
    const { olcum, gunTekrar } = await this.olcumOku(siteId, since, trends, stabilityDays.map((d) => d.date), lastRun);

    // Oynaklik: gunluk saglayicilar-arasi ortalama + o gun skora giren probe
    // sayisi (saglayici x SNAPSHOT_PROBES x o gunun tekrar sayisi). Beklenen
    // orneklem gurultusune oranlanir — bkz. visibility-variance.ts. Son 14
    // gunle sinirli: daha uzun pencere gercek trendi "oynaklik" diye okur.
    // Mansetle ayni (guncel yontem) kesitler: yontem degisimi oynaklik diye okunmasin.
    const providersByDay = new Map<string, number>();
    for (const series of Object.values(segments)) {
      for (const pt of series) {
        if (typeof pt.score !== 'number') continue;
        providersByDay.set(pt.date, (providersByDay.get(pt.date) ?? 0) + 1);
      }
    }
    const stability = assessStability(
      stabilityDays.map((d) => ({ score: d.score, n: (providersByDay.get(d.date) ?? 0) * SNAPSHOT_PROBES * (gunTekrar.get(d.date) ?? 1) })),
    );

    // Son snapshot detaylarini da don — F5 sonrasi detay panelinin yeniden hidrate olabilmesi icin
    const latestByProvider = new Map<string, typeof snapshots[number]>();
    for (const s of snapshots) {
      const cur = latestByProvider.get(s.provider);
      if (!cur || s.date.getTime() > cur.date.getTime()) latestByProvider.set(s.provider, s);
    }
    const latestSnapshotAt = snapshots.length > 0
      ? snapshots.reduce((a, b) => (a.createdAt.getTime() > b.createdAt.getTime() ? a : b)).createdAt
      : null;
    const latestRunAt = (lastRun && (!latestSnapshotAt || lastRun.runAt > latestSnapshotAt) ? lastRun.runAt : latestSnapshotAt)?.toISOString() ?? null;

    if (headlineOnly) {
      return { days, since: since.toISOString(), trends, headline, stability, latestRunAt, olcum };
    }

    // available/score/probes AYNI okumadan gelir: iki okuma arasinda ayni gun
    // "Yeniden Test" satiri ezerse (upsert, id ayni) skor ile probe'lar
    // farkli kosumlardan karismasin. Arada silinen satir ilk okumadan doner.
    const latest = Array.from(latestByProvider.values());
    const detailRows = latest.length > 0
      ? await this.prisma.aiCitationSnapshot.findMany({
        where: { id: { in: latest.map((s) => s.id) } },
        select: { id: true, available: true, score: true, probes: true },
      })
      : [];
    const detailById = new Map(detailRows.map((r) => [r.id, r]));
    const latestResults = latest.map((s) => {
      const d = detailById.get(s.id);
      return {
        provider: s.provider,
        available: d ? d.available : s.available,
        score: d ? d.score : s.score,
        probes: d?.probes ?? [],
      };
    });

    return {
      days,
      since: since.toISOString(),
      byProvider,
      trends,
      headline,
      stability,
      latestResults,
      latestRunAt,
      olcum,
    };
  }

  /**
   * Site sahibinin planindaki asistanlar (billing/plan-engines ownerEngines; ADMIN muaf).
   * Site ya da sahip okunamazsa null: suzme yapilmaz (gecmis dusmez).
   */
  private async sahipKapsami(siteId: string): Promise<Set<string> | null> {
    try {
      const site = await (this.prisma as any).site?.findUnique?.({
        where: { id: siteId },
        select: { user: { select: { plan: true, role: true } } },
      });
      if (!site?.user) return null;
      return new Set<string>(ownerEngines(site.user));
    } catch {
      return null;
    }
  }

  /**
   * Gecmisin olcum belirsizligi blogu — kosumlardan (AiCitationRun).
   *
   * NEDEN KOSUM, SNAPSHOT DEGIL: araligin paydasi (markasiz + olculebilen cevap
   * sayisi) snapshot satirinda yok; kosum sutunlarinda (poolSize) ve providers
   * JSON'unun probe'larinda var — migration gerekmez, eski kosumlar da hesaplanir.
   * Gun = gunluk snapshot'in karsiligi: o UTC gununun SON kosumu (snapshot da
   * gunun son kosumunu tutar), boylece trendin ilk/son gunu ayni olcume denk gelir.
   *
   * MALIYET: once yalniz sutunlar (id, runAt, matchVersion); providers JSON'u
   * yalniz gereken gunler icin okunur — son 14 gun (manset + onceki pencere),
   * trendlerin ilk/son gunu ve oynaklik gunleri. Haftalik olcum hakkiyla
   * tipik olarak 2-3 satir.
   *
   * Okuma hatasi gecmisi dusurmez: blok bos doner (kararlar null → panel
   * "anlamlı değişim yok" der, ±X gostermez).
   */
  private async olcumOku(
    siteId: string,
    since: Date,
    trends: TrendRef[],
    ekGunler: string[],
    lastRun: { runAt: Date; matchVersion: number | null } | null,
  ): Promise<{ olcum: HistoryOlcum; gunTekrar: Map<string, number> }> {
    const bos = { olcum: { ...olcumBelirsizligi([], []), onSonuc: false }, gunTekrar: new Map<string, number>() };
    try {
      const runs = await this.prisma.aiCitationRun.findMany({
        where: { siteId, runAt: { gte: since } },
        orderBy: { runAt: 'asc' },
        select: { id: true, runAt: true, matchVersion: true },
      });
      const gunSon = new Map<string, { id: string; runAt: Date; matchVersion: number }>();
      for (const r of runs ?? []) gunSon.set(r.runAt.toISOString().slice(0, 10), { id: r.id, runAt: r.runAt, matchVersion: r.matchVersion ?? 1 });
      if (gunSon.size === 0) return bos;

      const gunler = [...gunSon.keys()].sort();
      const anchor = gunNo(gunler[gunler.length - 1]);
      const gerekli = new Set(gunler.filter((g) => gunNo(g) >= anchor - 13));
      for (const t of trends) {
        if (t.firstDate) gerekli.add(t.firstDate);
        if (t.lastDate) gerekli.add(t.lastDate);
      }
      for (const g of ekGunler) gerekli.add(g);
      const secilen = [...gerekli]
        .map((g) => ({ date: g, run: gunSon.get(g) }))
        .filter((x): x is { date: string; run: { id: string; runAt: Date; matchVersion: number } } => !!x.run);
      const rows = await this.prisma.aiCitationRun.findMany({
        where: { id: { in: secilen.map((x) => x.run.id) } },
        select: { id: true, providers: true },
      });
      const providersById = new Map((rows ?? []).map((r) => [r.id, r.providers]));
      const gunKosumlari = secilen
        .filter((x) => providersById.has(x.run.id))
        .map((x) => gunKosumuOf(x.date, x.run.runAt, x.run.matchVersion, providersById.get(x.run.id)));

      // Ön sonuç: guncel yontemle (son kosumun surumu) sitede tek olcum var
      const surum = lastRun?.matchVersion ?? null;
      const ayniSurum = surum === null ? 0 : await this.prisma.aiCitationRun.count({ where: { siteId, matchVersion: surum } });

      return {
        olcum: { ...olcumBelirsizligi(gunKosumlari, trends), onSonuc: ayniSurum === 1 },
        gunTekrar: new Map(gunKosumlari.map((g) => [g.date, g.tekrar])),
      };
    } catch (err: any) {
      this.log.warn(`[${siteId}] Olcum belirsizligi okunamadi: ${err?.message ?? err}`);
      return bos;
    }
  }
}
