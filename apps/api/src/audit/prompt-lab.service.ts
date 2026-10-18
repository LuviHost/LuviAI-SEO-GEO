import { Injectable, Logger, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetchText } from '../common/safe-fetch.js';
import { CITATION_MATCH_VERSION } from './host-match.js';
import { AiCitationService, type CitationProbe, type CitationResult, type Provider } from './ai-citation.service.js';
import { FanoutService } from './fanout.service.js';
import { unbrandedOnly } from './brand-in-query.js';
import { compareAddress, comparePhone, type AddressCheck, type AnswerNapSignal, type PhoneCheck } from './local-nap.js';
import {
  buildLocalPrompts, isLocalPrompt, localTags, parseLocalPromptSpec, readLocalTags,
  LOCAL_PROMPT_SOURCE, type LocalPromptMeta,
} from './local-prompts.js';
import {
  readSiteNap, resolveSiteNap, SITE_NAP_REFRESH_COOLDOWN_MS,
  type SiteNapFetcher, type SiteNapStatus, type StoredSiteNap,
} from './site-nap.js';
import { formatTrPhone } from './tr-phone.js';
import { PROMPT_LOCAL_KEY_PREFIX, promptLocalKey } from './prompt-local-key.js';

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
  /** Yalniz yerel sorularda: marka + NAP dogrulugu (saglayici bazinda) */
  local?: LocalRunSummary | null;
  runAt: string;
}

/** Sitede bulunan NAP — panelde gosterim icin (telefon okunur bicimde) */
export interface SiteNapView {
  status: SiteNapStatus;
  phones: string[];
  addresses: Array<{ street: string | null; district: string | null; city: string | null }>;
  sources: string[];
  businessTypes: string[];
  pages: string[];
  reason: string | null;
  collectedAt: string | null;
  /** Son okuma denemesi basarisizsa (eski kayit gosteriliyorsa) nedeni */
  lastError: string | null;
}

export interface LocalProviderResult {
  provider: string;
  label: string;
  /** Bu saglayici gecerli bir cevap verdi mi (hata/kullanilamaz degil) */
  measured: boolean;
  /** Marka cevapta gecti mi (brandMentioned) */
  mentioned: boolean;
  /** Site baglantisi verildi mi (cited) */
  cited: boolean;
  /** found: okunur bicimde numaralar */
  phone: PhoneCheck;
  address: AddressCheck;
}

export interface LocalRunSummary {
  location: LocalPromptMeta | null;
  /** null = site NAP'i okunamadi (hata) */
  siteNap: SiteNapView | null;
  providers: LocalProviderResult[];
  /** false = bu olcumde cevap metinleri telefon/adres icin incelenemedi */
  napChecked: boolean;
  runAt: string;
}

const MAX_PROMPTS_PER_SITE = 200;
/**
 * Son yerel sonucun kv_store omru — liste ekraninda gosterilir; GeoPromptRun'da
 * NAP kolonu yok (sema degismez). Anahtar bicimi prompt-local-key.ts'te TEK
 * yerde: hesap ve site silme planlari ayni anahtari o dosyadan uretip siler;
 * servis ayri bir onek tutsaydi ikisi sessizce ayrisabilirdi.
 */
const LOCAL_RESULT_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_TEXT_LEN = 500;
const MIN_TEXT_LEN = 5;
/** Tek calistirmada islenecek azami dal — manuel dal eklemede ust sinir yoksa maliyet patlar */
const MAX_BRANCHES_PER_RUN = 12;
const MAX_RUN_ALL = 50;

/**
 * Yerel soru konum etiketleri (local-prompts.ts localTags): 'yerel', 'il:..',
 * 'ilce:..', 'hizmet:..'. audit.dto.ts RESERVED_PROMPT_TAG ile ayni kural
 * (buyuk/kucuk harf duyarsiz).
 */
const RESERVED_LOCAL_TAG = /^(?:yerel$|il:|ilce:|hizmet:)/i;

/**
 * PATCH prompts/:id etiketleri.
 *
 * NEDEN: etiketler TAMAMEN degistiriliyordu. Yerel sorunun il/ilce/hizmet
 * bilgisi de etiketlerde durdugu icin (sema degisikligi yok) etiket
 * guncellemesi konumu siliyor, panel konumu bos gosteriyordu. Kurallar:
 *  - yerel sorunun mevcut konum etiketleri KORUNUR (basta, eski sirasiyla);
 *  - istemciden gelen ayrilmis etiket yok sayilir: DTO zaten reddediyor, bu
 *    dogrudan cagiranlar (MCP, test) icin ikinci kat — elle 'yerel' eklemek
 *    yerel soru dogrulamasini (POST prompts/local) atlatirdi;
 *  - dizi degilse undefined (alan degismez) — eski davranis.
 */
export function mergePromptTags(
  prompt: { source?: string | null; tags?: unknown },
  next: unknown,
): string[] | undefined {
  if (!Array.isArray(next)) return undefined;
  const kept = isLocalPrompt(prompt) && Array.isArray(prompt.tags)
    ? prompt.tags.filter((t): t is string => typeof t === 'string' && RESERVED_LOCAL_TAG.test(t))
    : [];
  const user = next.filter((t): t is string => typeof t === 'string' && !RESERVED_LOCAL_TAG.test(t));
  return [...new Set([...kept, ...user])];
}

@Injectable()
export class PromptLabService {
  private readonly log = new Logger(PromptLabService.name);

  /**
   * Site NAP okumasinda kullanilan istemci. Yapici parametresi DEGIL: DI
   * imzasi degismesin; testler yerel sunucuya baglanan fetcher'i buradan verir.
   */
  siteNapFetcher: SiteNapFetcher = safeFetchText;

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
    // Yerel sorularin son NAP sonucu — TEK sorguda (soru basina ayri okuma yok)
    const localIds = prompts.filter((p) => isLocalPrompt(p)).map((p) => p.id);
    const lastLocal = await this.readLocalResults(localIds);
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
      /** Yerel soru: il / ilce / hizmet (yerel degilse null) */
      local: isLocalPrompt(p) ? (readLocalTags(p.tags) ?? { il: null, ilce: null, hizmet: null }) : null,
      /** Yerel sorunun son olcumundeki marka + NAP sonucu */
      lastLocal: lastLocal.get(p.id) ?? null,
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
    const prompt = await this.requirePrompt(siteId, promptId);

    const data: any = {};
    // create() ile AYNI dogrulama — eskiden update ust siniri uygulamiyordu,
    // create'in reddettigi 10 KB'lik metin PATCH ile iceri giriyordu.
    if (input.text !== undefined) data.text = this.validateText(input.text);
    if (input.intent !== undefined) data.intent = String(input.intent).slice(0, 40);
    if (input.tags !== undefined) data.tags = mergePromptTags(prompt, input.tags);
    if (input.isActive !== undefined) data.isActive = !!input.isActive;

    return this.prisma.geoPrompt.update({ where: { id: promptId }, data });
  }

  async remove(siteId: string, promptId: string) {
    await this.requirePrompt(siteId, promptId);
    // fanouts + runs cascade ile gider (schema'da onDelete: Cascade)
    await this.prisma.geoPrompt.delete({ where: { id: promptId } });
    // Yerel sonuc kv_store'da — cascade disinda kaldigi icin elle silinir
    await this.prisma.kvStore.deleteMany({ where: { key: promptLocalKey(promptId) } }).catch(() => undefined);
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
  //  YEREL MOD — il/ilce + hizmet sorulari (local-prompts.ts)
  // ────────────────────────────────────────────────────────────
  /**
   * Taslaklari dondurur; KAYIT YAPMAZ ve AI cagirmaz (sablonlar sabit).
   * Zaten takipte olanlar `exists` ile isaretlenir.
   */
  async previewLocal(siteId: string, body: unknown) {
    const parsed = parseLocalPromptSpec(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const drafts = buildLocalPrompts(parsed.spec);
    const existing = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: null },
      select: { text: true },
    });
    const seen = new Set(existing.map((e) => this.normalize(e.text)));
    return {
      spec: parsed.spec,
      drafts: drafts.map((d) => ({ ...d, exists: seen.has(this.normalize(d.text)) })),
    };
  }

  /**
   * Secilen taslaklari yerel soru olarak kaydeder. Metinler istemciden
   * ALINMAZ: girdi yeniden dogrulanir, taslaklar sunucuda yeniden uretilir ve
   * `texts` yalniz secim icin kullanilir — etiketler (il/ilce/hizmet) her
   * zaman metinle tutarli kalir.
   *
   * Isaret: source='local' + tags ['yerel', 'il:..', 'ilce:..', 'hizmet:..'].
   * intent 'commercial': "X'te kuafor" sorusu ticari arastirmadir.
   */
  async createLocal(siteId: string, body: unknown): Promise<{ created: number; skipped: number; limitReached: boolean }> {
    const parsed = parseLocalPromptSpec(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const rawTexts = (body as { texts?: unknown } | null)?.texts;
    const wanted = Array.isArray(rawTexts)
      ? new Set(rawTexts.filter((t): t is string => typeof t === 'string').map((t) => this.normalize(t)))
      : null;
    const drafts = buildLocalPrompts(parsed.spec).filter((d) => !wanted || wanted.has(this.normalize(d.text)));
    if (!drafts.length) throw new BadRequestException('Kaydedilecek soru seçilmedi.');

    const existing = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: null },
      select: { text: true },
    });
    const seen = new Set(existing.map((e) => this.normalize(e.text)));
    let capacity = MAX_PROMPTS_PER_SITE - existing.length;
    const toCreate: Array<{ siteId: string; text: string; intent: string; locale: string; source: string; tags: string[] }> = [];
    let limitReached = false;
    for (const d of drafts) {
      const norm = this.normalize(d.text);
      if (seen.has(norm)) continue;
      if (capacity <= 0) { limitReached = true; break; }
      seen.add(norm);
      capacity--;
      toCreate.push({ siteId, text: d.text, intent: 'commercial', locale: 'tr', source: LOCAL_PROMPT_SOURCE, tags: localTags(d) });
    }
    if (toCreate.length) await this.prisma.geoPrompt.createMany({ data: toCreate });
    if (!toCreate.length && limitReached) {
      throw new BadRequestException(`Site başına en fazla ${MAX_PROMPTS_PER_SITE} soru takip edilebilir`);
    }
    return { created: toCreate.length, skipped: drafts.length - toCreate.length, limitReached };
  }

  /** Kayitli site NAP'i — siteye istek ATMAZ (yalniz kv_store). null = henuz okunmadi */
  async siteNapStatus(siteId: string): Promise<SiteNapView | null> {
    const nap = await readSiteNap(this.prisma, siteId);
    return nap ? this.siteNapView(nap) : null;
  }

  /**
   * Kullanici "yeniden oku" dedi: sitenin anasayfasi (gerekirse iletisim
   * sayfasi) okunur. Siteye yuk olmasin diye iki okuma arasi en az 10 dk.
   */
  async refreshSiteNap(siteId: string): Promise<SiteNapView> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, url: true } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    const cached = await readSiteNap(this.prisma, siteId);
    if (cached) {
      const since = Date.now() - Date.parse(cached.attemptedAt || cached.collectedAt);
      if (since >= 0 && since < SITE_NAP_REFRESH_COOLDOWN_MS) {
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Site bilgisi az önce okundu. Birkaç dakika sonra tekrar deneyin.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const nap = await resolveSiteNap(this.prisma, site, { fetcher: this.siteNapFetcher, force: true });
    return this.siteNapView(nap);
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
    /** 'system' = platform otomasyonu (remeasure takip kosumu) — kota tuketmez */
    trigger?: 'user' | 'system';
  } = {}): Promise<PromptRunSummary> {
    const prompt = await this.requirePrompt(siteId, promptId, {
      fanouts: { where: { isActive: true }, orderBy: { rank: 'asc' }, take: MAX_BRANCHES_PER_RUN },
    });

    const today = this.utcToday();

    // ── 1) Ana soru
    const mainResults = await this.citation.runQueries(siteId, [prompt.text], {
      providers: opts.providers,
      trigger: opts.trigger,
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

    // ── 4) Yerel soru: ayni cevaplardan marka + NAP dogrulugu. Ek AI cagrisi
    // YOK — olcum yolu ve haftalik hak aynen gecerli; yalnizca elde olan
    // cevaplar sitenin kendi telefon/adresiyle karsilastirilir. Hata olcumu
    // dusurmez.
    let local: LocalRunSummary | null = null;
    if (isLocalPrompt(prompt)) {
      local = await this.buildLocalSummary(siteId, prompt, mainResults).catch((err: any) => {
        this.log.warn(`[${promptId}] Yerel NAP ozeti uretilemedi: ${err?.message ?? err}`);
        return null;
      });
    }

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
      local,
      runAt: new Date().toISOString(),
    };
  }

  /**
   * Sitenin aktif promptlarini sirayla calistirir.
   *
   * SIRALAMA: en uzun suredir olculmeyen once (lastRunAt asc, null'lar basta).
   * Eskiden createdAt asc idi ve limit 25 oldugundan 26. prompt HIC olculmuyordu.
   */
  async runAll(siteId: string, opts: { withFanout?: boolean; limit?: number; scope?: string } = {}) {
    const rawLimit = typeof opts.limit === 'number' ? opts.limit : parseInt(String(opts.limit ?? ''), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_RUN_ALL)
      : 25;

    const prompts = await this.prisma.geoPrompt.findMany({
      // App sorulari haric — aksi halde lastRunAt=null olduklarindan siralamada
      // one gecip site butcesini tuketir ve app skorlarini site semantigiyle ezerdi.
      // scope 'local': yalniz yerel sorular (ayni olcum yolu, ayni haftalik hak)
      where: { siteId, isActive: true, trackedAppId: null, ...(opts.scope === 'local' ? { source: LOCAL_PROMPT_SOURCE } : {}) },
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
      select: { promptId: true, fanoutId: true, cited: true, brandMentioned: true, brandInQuery: true },
    });

    const fanouts = await this.prisma.geoFanoutQuery.findMany({
      where: { siteId },
      select: { id: true, kind: true },
    });
    const kindById = new Map(fanouts.map((f) => [f.id, f.kind]));

    // Kapsama skorlari MARKASIZ satirlardan: sablondan uretilen dallarin
    // tamami markali oldugu icin karisik havuz "Fan-out dallari %85" gibi
    // gercek disi bir kapsama gosteriyor, byKind siralamasinda da markali
    // dallar her tur icin tepeyi doldurup zayif turleri gizliyordu. Markali
    // satir sayisi bilgi olarak ayrica donuluyor (brandedTotal) — UI "su
    // kadar olcum taninirlik olctugu icin haric" diyebilsin.
    const unbranded = unbrandedOnly(runs);
    const mainRuns = unbranded.filter((r) => !r.fanoutId);
    const branchRuns = unbranded.filter((r) => r.fanoutId);

    const byKind = new Map<string, { cited: number; mentioned: number; total: number }>();
    for (const r of branchRuns) {
      const kind = kindById.get(r.fanoutId!) ?? 'unknown';
      const cur = byKind.get(kind) ?? { cited: 0, mentioned: 0, total: 0 };
      cur.total++;
      if (r.cited) cur.cited++;
      if (r.brandMentioned) cur.mentioned++;
      byKind.set(kind, cur);
    }

    // null = "olculecek markasiz satir yok" — %0 kapsama ile ayni sey DEGIL.
    // Tum promptlari markali bir sitede eski davranis "Kapsama %0" basiyor ve
    // gercek bir gorunurluk kaybindan ayirt edilemiyordu.
    const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : null);
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
        .map(([kind, s]) => ({ kind, ...s, score: pct(s.cited, s.total) ?? 0 }))
        .sort((a, b) => a.score - b.score),
      /** Negatifse dal tarafi ana sorudan zayif; taraflardan biri olculemediyse null */
      gap: mainScore !== null && fanoutScore !== null ? fanoutScore - mainScore : null,
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
      // coverage() ile AYNI suzgec — ayni panelde "Kapsama %12" yaninda
      // markali dallarla sisik %70'lik trend cizmek, duzeltmenin kendisini
      // yalanci cikarir.
      where: { promptId, siteId, date: { gte: since }, brandInQuery: false },
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
  //  YEREL SONUC — NAP karsilastirmasi
  // ────────────────────────────────────────────────────────────
  /**
   * Saglayici cevaplarini sitenin kendi NAP'iyle karsilastirir.
   *
   * Cevap tarafi probe.nap'ten gelir (buildProbe cevabin TAMAMINI inceler;
   * probe.excerpt yalniz ilk 220 karakter oldugundan yetmez). Alan hic yoksa
   * cevap NAP icin incelenmemistir → "olculmedi"; null ise incelendi, bulunmadi.
   */
  private async buildLocalSummary(siteId: string, prompt: { id: string; tags?: unknown }, results: CitationResult[]): Promise<LocalRunSummary> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, url: true } });
    let nap: StoredSiteNap | null = null;
    if (site) {
      nap = await resolveSiteNap(this.prisma, site, { fetcher: this.siteNapFetcher }).catch((err: any) => {
        this.log.warn(`[${siteId}] Site NAP okunamadi: ${err?.message ?? err}`);
        return null;
      });
    }
    // Okunamayan site: karsilastirma "bilinmiyor"a duser (bos liste)
    const sitePhones = nap?.status === 'ok' ? nap.phones : [];
    const siteAddresses = nap?.status === 'ok' ? nap.addresses : [];

    let napChecked = false;
    const providers = results.map((r): LocalProviderResult => {
      const probe = r.probes[0];
      if (!r.available || !probe || this.isErrorProbe(probe)) {
        return {
          provider: r.provider, label: r.label, measured: false, mentioned: false, cited: false,
          phone: { status: 'olculmedi', found: [] }, address: { status: 'olculmedi', snippet: null, matched: [], otherCity: null },
        };
      }
      const inspected = Object.prototype.hasOwnProperty.call(probe, 'nap');
      if (inspected) napChecked = true;
      const signal = inspected ? ((probe as CitationProbe & { nap?: AnswerNapSignal | null }).nap ?? null) : null;
      const phone: PhoneCheck = inspected ? comparePhone(sitePhones, signal) : { status: 'olculmedi', found: [] };
      const address: AddressCheck = inspected ? compareAddress(siteAddresses, signal) : { status: 'olculmedi', snippet: null, matched: [], otherCity: null };
      return {
        provider: r.provider,
        label: r.label,
        measured: true,
        mentioned: !!probe.brandMentioned,
        cited: !!probe.cited,
        phone: { ...phone, found: phone.found.map(formatTrPhone) },
        address,
      };
    });

    const summary: LocalRunSummary = {
      location: readLocalTags(prompt.tags),
      siteNap: nap ? this.siteNapView(nap) : null,
      providers,
      napChecked,
      runAt: new Date().toISOString(),
    };
    // Hic gecerli cevap yoksa son bilinen sonuc EZILMEZ (skordaki 0/0 kuraliyla ayni)
    if (providers.some((p) => p.measured)) await this.saveLocalResult(prompt.id, summary);
    return summary;
  }

  private siteNapView(nap: StoredSiteNap): SiteNapView {
    return {
      status: nap.status,
      phones: nap.phones.map(formatTrPhone),
      addresses: nap.addresses.map((a) => ({ street: a.street, district: a.district, city: a.city })),
      sources: nap.sources,
      businessTypes: nap.businessTypes ?? [],
      pages: nap.pages,
      reason: nap.reason,
      collectedAt: nap.status === 'unavailable' ? null : nap.collectedAt,
      lastError: nap.status !== 'unavailable' ? nap.attemptError : null,
    };
  }

  private async saveLocalResult(promptId: string, summary: LocalRunSummary): Promise<void> {
    const key = promptLocalKey(promptId);
    const value = JSON.stringify(summary);
    const expiresAt = new Date(Date.now() + LOCAL_RESULT_TTL_MS);
    try {
      await this.prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
    } catch (err: any) {
      // Yanit bellekten dondugu icin dogru kalir; yalniz listedeki "son sonuc" eksik olur
      this.log.warn(`Yerel sonuc yazilamadi (${promptId}): ${err?.message ?? err}`);
    }
  }

  private async readLocalResults(promptIds: string[]): Promise<Map<string, LocalRunSummary>> {
    const out = new Map<string, LocalRunSummary>();
    if (!promptIds.length) return out;
    try {
      const rows = await this.prisma.kvStore.findMany({
        where: { key: { in: promptIds.map(promptLocalKey) } },
        select: { key: true, value: true },
      });
      for (const row of rows) {
        try { out.set(row.key.slice(PROMPT_LOCAL_KEY_PREFIX.length), JSON.parse(row.value)); } catch { /* bozuk kayit atlanir */ }
      }
    } catch (err: any) {
      this.log.warn(`Yerel sonuclar okunamadi: ${err?.message ?? err}`);
    }
    return out;
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
          // Sorunun KENDISINDE marka geciyorsa bu satir manset gorunurluk
          // metriklerine girmez. Deger buildProbe'un damgasindan gelir —
          // burada yeniden hesaplamak ayni kurali iki kod yolunda yasatmakti:
          // ikisi ayrisirsa ayni kosum snapshot'ta bir turlu, KPI'da baska
          // turlu suzulurdu ve hicbir sey gurultuyle patlamazdi.
          brandInQuery: probe.brandInQuery ?? false,
          position: probe.position ?? null,
          sentiment: probe.sentiment ?? null,
          excerpt: probe.excerpt?.slice(0, 2000) ?? null,
          citedPages: probe.citedPages?.length ? probe.citedPages : undefined,
          competitors: probe.competitors?.length ? (probe.competitors as any) : undefined,
          matchVersion: CITATION_MATCH_VERSION,
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
