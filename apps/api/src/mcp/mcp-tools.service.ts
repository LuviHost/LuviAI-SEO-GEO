import { Injectable, Logger } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { GeoScoreCardService } from '../audit/geo-score-card.service.js';
import { AgentReadinessService } from '../audit/agent-readiness.service.js';
import { AiKpisService, isUnmeasuredReadinessStatus, latestReadinessKpi } from '../audit/ai-kpis.service.js';
import { crawlAccessMessage, crawlAccessNewerThanAudit, readCrawlAccess } from '../sites/crawl-access.js';
import { ContentOpportunityService } from '../audit/content-opportunity.service.js';
import { ProductRadarService } from '../audit/product-radar.service.js';
import { PromptLabService } from '../audit/prompt-lab.service.js';
import { annotateAuditFixRoutes } from '../audit/fix-routes.js';
import { ImageAltSuggestService, IMAGE_ALT_JOB_BATCH } from '../audit/image-alt/image-alt-suggest.service.js';
import { ActionPlansService } from '../action-plans/action-plans.service.js';
import { planHasFeature, type PlanFeature, type PlanId } from '../billing/plans.js';
import { MeasurementAllowanceService } from '../billing/measurement-allowance.service.js';
import { SITE_NOT_FOUND_MESSAGE } from '../auth/site-access.guard.js';
import { isCanonicalSiteId } from '../common/site-id.js';
import { withAllowanceCharge } from '../articles/article-scheduler.service.js';
import { settleUnstartedGeneration } from '../articles/allowance-refund.js';
import { providersWithoutSources } from '../audit/citation-sources.js';
import { CitedSourcesService } from '../audit/cited-sources.service.js';
import { compactCitedSources } from '../audit/cited-sources.js';

/**
 * RanksUp Tool Registry — MCP server VE uygulama ici Chat'in ORTAK tool seti.
 *
 * Tek kaynak ilkesi: her tool bir kez tanimlanir; MCP tools/list bunlari
 * JSON Schema ile dis dunyaya acar, ChatService ayni listeyi Anthropic
 * tools parametresine cevirir. Boylece "Claude'daki RanksUp" ile
 * "RanksUp icindeki chat" ayni yetenek yuzeyini paylasir.
 *
 * GUVENLIK: her handler cagrisi kimligi dogrulanmis user ile gelir;
 * site kapsamli tool'lar resolveSite() ile SAHIPLIK dogrular. ADMIN her
 * siteye erisebilir (SiteAccessGuard ile ayni kural).
 *
 * PLAN KAPISI: sahiplik dogrulamasi "bu veri senin mi" sorusunu cevaplar,
 * "bu veriyi gorme hakkin var mi" sorusunu cevaplamaz. AXO, icerik firsatlari
 * ve Product Radar uclari controller'da @RequiresPlan ile kilitliyken ayni
 * veriye dokunan tool'lar KILITSIZDI: Buyume planindaki bir kullanici kilitli
 * uca hic gitmeden chat'e sorarak ayni veriyi alabiliyordu. Artik tool tanimi
 * requiresFeature tasiyor ve iki noktada dayatiliyor — listede gorunmez,
 * yine de cagrilirsa call() reddeder.
 */

export interface ToolUser {
  id: string;
  role: string;
  plan?: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  /** Yan etkisi olan tool'lar (job kuyruklar, veri yazar) */
  mutating?: boolean;
  /**
   * Tool'un dokundugu veri hangi plan ozelligine ait.
   *
   * Bos birakilirsa tool HERKESE ACIKTIR. Emin olunmayan tool acik
   * birakilir — yanlislikla kilitlemek, sizdirmaktan daha gurultulu
   * bir hata (calisan bir yetenek sessizce kaybolur).
   */
  /**
   * Araci bir plan ozelligine baglar.
   *
   * KURAL: kapi REST ucuyla AYNI olmali. Bugun @RequiresPlan yalnizca
   * EYLEM uclarinda (POST run/derive/generate) var; listeleme GET'leri acik.
   * Okuma araclarina kapi koyunca chat, panelden DAHA SIKI davraniyordu:
   * kullanici veriyi ekranda goruyor ama chat'e sorunca "planina dahil degil"
   * cevabi aliyordu. Ayrica haftalik plan cron'u STARTER sitelerde bu yuzden
   * patliyordu (weekly-plan skill'i iki okuma aracina bagli). Okuma araclari
   * REST ile hizalandi; kilit eylem araclarinda kaldi.
   */
  requiresFeature?: PlanFeature;
  /**
   * API anahtariyla cagrilirken gereken kaynak scope'u (orn. 'audit:write').
   * KURAL: REST ikizinin AuthGuard'da istedigi scope'un AYNISI
   * (ApiKeysService.requiredScope(yontem, yol)); McpController okuma araclarinda
   * da hasScopeForRoute ile dayatir (':write' ayni kaynagin ':read'ini kapsar).
   * NEDEN: /api/mcp AuthGuard'in yol bazli scope denetiminden muaf (tek POST
   * hem okuma hem yazma tasir). Araclarin cogunda scope yokken yalniz
   * 'social:read' tasiyan bir anahtar MCP'den makale/denetim/analitik
   * okuyabiliyor, 'social:write' anahtari run_audit, run_prompt ve
   * create_article ile olcum hakki ve makale kotasi harcayabiliyordu; ayni
   * anahtar REST'te 403 aliyordu (inceleme R21).
   * Verilmezse kaba kural: mutating → herhangi bir :write, okuma serbest. Bu
   * YALNIZ REST ikizi bir kaynaga eslesmeyen araclar icindir (aksiyon plani,
   * ASO: requiredScope null doner, AuthGuard da ayni kaba kurali uygular).
   * tool-scope.spec.ts her araci REST ikiziyle karsilastirir. Oturumla
   * (sohbet) gelen cagrilarda uygulanmaz.
   */
  scope?: string;
  /**
   * MCP destructiveHint — yalnizca mutating araclarda anlamli. Verilmezse TRUE
   * sayilir (MCP semasinin varsayilani da true): yeni bir yazma araci
   * eklendiginde "yalnizca ekleme yapar" karari BILINCLI verilsin.
   */
  destructive?: boolean;
  /**
   * MCP openWorldHint — arac RanksUp disina (musteri sitesi, AI saglayicilari,
   * magazalar) dokunuyor mu. Verilmezse mutating araclarda true, okuma
   * araclarinda false (okuma araclari yalnizca kendi veritabanimizi okur).
   */
  openWorld?: boolean;
  handler: (user: ToolUser, args: Record<string, any>) => Promise<any>;
}

/**
 * MCP arac ipuclari (ToolAnnotations) — tools/list'te her araca eklenir.
 *
 * NEDEN: Anthropic baglayici incelemesi her aractan title + readOnlyHint /
 * destructiveHint ister; Claude salt-okuma araclarini onaysiz, destructive
 * araclari her cagrida onayla calistirir
 * (https://claude.com/docs/connectors/building/review-criteria). Alan adlari ve
 * varsayilanlar MCP semasindan (2025-06-18, 2026-07-28'de degismedi):
 * readOnlyHint=false, destructiveHint=true, idempotentHint=false, openWorldHint=true
 * (https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations).
 *
 * Ipuclari `mutating` bayragindan TURETILIR; turetmenin yanlis olacagi araclar
 * tanimda `destructive` / `openWorld` ile acikca isaretlenir.
 */
export function toolAnnotations(t: Pick<ToolDef, 'title' | 'mutating' | 'destructive' | 'openWorld'>) {
  const readOnly = !t.mutating;
  return {
    title: t.title,
    readOnlyHint: readOnly,
    // Salt-okumada spesifikasyona gore anlamsiz; yine de acik false yazilir ki
    // istemci "belirtilmemis = true" varsayimina dusmesin.
    destructiveHint: readOnly ? false : (t.destructive ?? true),
    // Yazma araclarimizin hicbiri ayni argumanla ikinci cagrida etkisiz degil:
    // yeni is kuyruga girer, kota/olcum hakki duser ya da zaman damgasi degisir.
    idempotentHint: readOnly,
    openWorldHint: t.openWorld ?? !readOnly,
  };
}

const SITE_ID_PROP = {
  site_id: {
    type: 'string',
    description: 'RanksUp site ID (list_sites ile bulunur)',
  },
};

const isoDay = (d: Date | string): string => {
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : String(d);
};

/** content-opportunity durumlari (schema.prisma ContentOpportunity.status yorumu) */
const OPPORTUNITY_STATUSES = ['OPEN', 'PLANNED', 'GENERATED', 'PUBLISHED', 'REMEASURED', 'DISMISSED'] as const;
const ARTICLE_STATUSES = Object.values(ArticleStatus) as string[];

/**
 * MCP argumanindan Prisma where'a giden durum suzgeci. Arguman JSON'dur:
 * { "status": { "not": "PUBLISHED" } } gibi bir nesne eskiden dogrudan
 * where'a yayiliyor ve Prisma filtresi olarak yorumlaniyordu; enum disi dize
 * de Prisma dogrulama hatasi veriyordu. Yalniz izin listesindeki dize gecer;
 * bos/verilmemis → suzgec yok, gecersiz → okunur hata (ajan duzeltebilsin).
 */
function statusFilter(value: unknown, allowed: readonly string[]): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!allowed.includes(v)) throw new Error(`Geçersiz status. Şunlardan biri olmalı: ${allowed.join(', ')}`);
  return v;
}

/**
 * AXO sonucu ajana: blocked/unreachable taramada overallScore yalniz olculebilen
 * kontrolleri yansitir — skor diye sunulmasin diye null; neden `access` alaninda.
 */
function readinessForAgent<T extends { overallScore?: number | null; status?: string | null }>(
  r: T,
): Omit<T, 'overallScore'> & { overallScore: number | null; measured: boolean } {
  const unmeasured = isUnmeasuredReadinessStatus(r.status);
  return { ...r, overallScore: unmeasured ? null : r.overallScore ?? null, measured: !unmeasured };
}

@Injectable()
export class McpToolsService {
  private readonly log = new Logger(McpToolsService.name);
  private tools: ToolDef[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
    private readonly geoScoreCard: GeoScoreCardService,
    private readonly agentReadiness: AgentReadinessService,
    private readonly aiKpis: AiKpisService,
    private readonly opportunities: ContentOpportunityService,
    private readonly productRadar: ProductRadarService,
    private readonly promptLab: PromptLabService,
    private readonly actionPlans: ActionPlansService,
    private readonly imageAltSuggest: ImageAltSuggestService,
    private readonly measurement: MeasurementAllowanceService,
    private readonly citedSources: CitedSourcesService,
  ) {}

  list(): ToolDef[] {
    if (this.tools) return this.tools;
    this.tools = this.build();
    return this.tools;
  }

  /**
   * Kullanicinin planinda ACIK olan tool'lar.
   *
   * Listeleme kapisi tek basina guvenlik degil (eski konusmalar ve dogrudan
   * MCP tools/call listeyi atlar) ama modelin olmayan bir yetenegi cagirmaya
   * calismasini ve kullaniciya "hata" olarak donmesini engeller.
   */
  listForUser(user: ToolUser): ToolDef[] {
    return this.list().filter((t) => this.canUseTool(user, t));
  }

  /** Senkron kapi kontrolu — user.plan elde oldugu icin DB'ye gitmez. */
  canUseTool(user: ToolUser, tool: ToolDef): boolean {
    if (!tool.requiresFeature) return true;
    // ADMIN muaf — PlanFeatureGuard ile ayni kural (destek/hata ayiklama).
    if (user.role === 'ADMIN') return true;
    // Plan bilinmiyorsa listeyi daraltmiyoruz; asil dayatma call() tarafinda
    // taze plan ile yapiliyor (PlanFeatureGuard de ayni sekilde davranir).
    if (!user.plan) return true;
    return planHasFeature(user.plan.toLowerCase() as PlanId, tool.requiresFeature);
  }

  /** MCP tools/list icin dis format */
  listForMcp(user: ToolUser) {
    return this.listForUser(user).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: toolAnnotations(t),
    }));
  }

  /** Anthropic Messages API tools parametresi icin format */
  listForAnthropic(user: ToolUser) {
    return this.listForUser(user).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  async call(user: ToolUser, name: string, args: Record<string, any>): Promise<any> {
    const tool = this.list().find((t) => t.name === name);
    if (!tool) throw new Error(`Bilinmeyen tool: ${name}`);
    await this.assertToolAllowed(user, tool);
    return tool.handler(user, args ?? {});
  }

  /**
   * Cagri anindaki plan kapisi — ASIL dayatma noktasi.
   *
   * Listeden gizlemek yetmez: eski bir konusmanin gecmisinde duran tool_use
   * blogu veya elle atilmis bir MCP tools/call istegi listeyi hic gormez.
   * Plan DB'den taze okunur (kullanici plan dusurmusse ayni istek icinde
   * gecerli olsun diye) ve hata modele ciplak 403 yerine okunabilir bir
   * cumle olarak doner — model bunu kullaniciya "su plan gerekiyor" diye
   * aktarabilsin.
   */
  async assertToolAllowed(user: ToolUser, tool: ToolDef): Promise<void> {
    if (!tool.requiresFeature) return;
    if (user.role === 'ADMIN') return;
    try {
      await this.quota.enforcePlanFeature(user.id, tool.requiresFeature);
    } catch (err: any) {
      throw new Error(`"${tool.title}" aracı mevcut planında kapalı. ${err?.message ?? ''}`.trim());
    }
  }

  // ────────────────────────────────────────────────────────────

  /**
   * KANONIK KIMLIK (common/site-id.ts): sites tablosunun harmanlamasi
   * 'CMSQ..' ya da sonu bosluklu yazimi ayni satira esler. Eskiden varyant
   * kabul ediliyordu; ajan/sohbet ayni siteyi farkli yazimlarla cagirabiliyor,
   * kimlige gore kurulan anahtarlar ve `===` karsilastirmalari tutmuyordu.
   * SiteAccessGuard ile ayni iki kapi ve ayni metin: kurala uymayan kimlik
   * DB'ye gitmeden, bulunan satir birebir ayni kimlikte degilse de "bulunamadi".
   */
  private async resolveSite(user: ToolUser, siteId: unknown) {
    if (typeof siteId !== 'string' || !siteId) throw new Error('site_id zorunlu');
    if (!isCanonicalSiteId(siteId)) throw new Error(SITE_NOT_FOUND_MESSAGE);
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.id !== siteId) throw new Error(SITE_NOT_FOUND_MESSAGE);
    if (user.role !== 'ADMIN' && site.userId !== user.id) throw new Error('Bu site sana ait değil');
    return site;
  }

  private async resolveApp(user: ToolUser, appId: unknown) {
    if (typeof appId !== 'string' || !appId) throw new Error('app_id zorunlu');
    const app = await this.prisma.trackedApp.findUnique({
      where: { id: appId },
      include: { site: { select: { userId: true } } },
    });
    if (!app) throw new Error('Uygulama bulunamadi');
    if (user.role !== 'ADMIN' && app.site.userId !== user.id) throw new Error('Bu uygulama sana ait degil');
    return app;
  }

  private schema(props: Record<string, any>, required: string[] = []): Record<string, any> {
    return { type: 'object', properties: props, required, additionalProperties: false };
  }

  // ────────────────────────────────────────────────────────────
  //  TOOL TANIMLARI
  // ────────────────────────────────────────────────────────────

  private build(): ToolDef[] {
    return [
      // ── SITELER ──────────────────────────────────────────
      {
        name: 'list_sites',
        scope: 'sites:read',
        title: 'Sitelerimi listele',
        description: 'Kullanicinin RanksUp\'taki tum sitelerini id, isim, url ve durumla listeler. Diger tool\'lar icin site_id buradan alinir.',
        inputSchema: this.schema({}),
        handler: async (user) => {
          const sites = await this.prisma.site.findMany({
            where: user.role === 'ADMIN' ? {} : { userId: user.id },
            select: { id: true, name: true, url: true, niche: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          return { sites };
        },
      },
      {
        name: 'get_site_overview',
        scope: 'sites:read',
        title: 'Site genel bakis',
        description: 'Bir sitenin ozet durumu: son audit skoru, GEO skoru, agent readiness, yayinlanan makale sayisi, izlenen prompt sayisi. auditAccess doluysa son tarama denemesi siteye erişemedi: auditScore/geoScore null döner (eldeki skor eski ve güncel değil; lastAuditAt son başarılı denetim). agentReadiness.measured false ise AXO skoru ölçülemedi (overallScore null, nedeni reason alanında).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const [audit, readiness, articleCount, promptCount, appCount, access] = await Promise.all([
            this.prisma.audit.findFirst({ where: { siteId: site.id }, orderBy: { ranAt: 'desc' }, select: { overallScore: true, geoScore: true, ranAt: true } }),
            latestReadinessKpi(this.prisma, site.id),
            this.prisma.article.count({ where: { siteId: site.id, status: 'PUBLISHED' as any } }),
            this.prisma.geoPrompt.count({ where: { siteId: site.id, isActive: true } }),
            this.prisma.trackedApp.count({ where: { siteId: site.id, isActive: true } }),
            readCrawlAccess(this.prisma, site.id),
          ]);
          // Son deneme siteye erisemediyse eldeki skor bayat — panel gibi gosterilmez.
          // Kural tek yerde (crawl-access.ts): audit getLatest, GEO Score Card ve raporlarla ayni.
          const blocked = crawlAccessNewerThanAudit(access, audit?.ranAt);
          return {
            site: { id: site.id, name: site.name, url: site.url, niche: site.niche, status: site.status },
            auditScore: blocked ? null : audit?.overallScore ?? null,
            geoScore: blocked ? null : audit?.geoScore ?? null,
            lastAuditAt: audit?.ranAt ?? null,
            auditAccess: blocked ? { ...blocked, message: crawlAccessMessage(blocked) } : null,
            // Eski alanlar (overallScore, status) korunur; olculemeyen taramada skor null
            agentReadiness: readiness
              ? { overallScore: readiness.score, status: readiness.status, measured: readiness.measured, reason: readiness.reason }
              : null,
            publishedArticles: articleCount,
            trackedPrompts: promptCount,
            trackedApps: appCount,
          };
        },
      },

      // ── AUDIT + SKORLAR ──────────────────────────────────
      {
        name: 'get_audit',
        scope: 'audit:read',
        title: 'Site audit raporu',
        description: 'Son site saglik taramasinin detayi: 14 teknik kontrol, sorun listesi ve otomatik duzeltilebilir maddeler. current false ise bu denetimden sonraki tarama denemesi siteye erişemedi: skor ve sorunlar ranAt tarihli eski denetime ait, güncel skor diye sunma (neden ve çözüm accessBlocked alanında). checks.aiCitations.score null ise AI ölçümü yapılmadı (neden skipped alanında); bunu 0 puan diye sunma.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const [audit, access] = await Promise.all([
            this.prisma.audit.findFirst({ where: { siteId: site.id }, orderBy: { ranAt: 'desc' } }),
            readCrawlAccess(this.prisma, site.id),
          ]);
          const blocked = crawlAccessNewerThanAudit(access, audit?.ranAt);
          if (!audit) {
            // Anasayfa okunamayan tarama puan URETMEZ (Audit satiri yok): "hic kosulmamis" demek yanlis olur
            return blocked
              ? { message: `Puanlanmış bir denetim yok: son tarama denemesi siteye erişemedi. ${crawlAccessMessage(blocked)}`, accessBlocked: blocked }
              : { message: 'Henuz audit kosulmamis. run_audit ile baslatabilirsin.' };
          }
          // fixRoute: auto_fix | snippet | manual — ajan "otomatik duzeltilir"
          // dedigi seyin gercekten auto-fix'te uretildigini bilsin.
          const annotated = annotateAuditFixRoutes(audit);
          return {
            overallScore: audit.overallScore,
            geoScore: audit.geoScore,
            checks: audit.checks,
            issues: annotated.issues,
            ranAt: audit.ranAt,
            // Eklenen alanlar: bu denetimden SONRAKI deneme siteye erisemediyse skor guncel degil
            current: !blocked,
            accessBlocked: blocked,
            ...(blocked
              ? { note: `Bu skor güncel değil: ${isoDay(blocked.at)} tarihli tarama denemesi siteye erişemedi. ${crawlAccessMessage(blocked)} Skor ve sorunlar ${isoDay(audit.ranAt)} tarihli son başarılı denetime ait.` }
              : {}),
          };
        },
      },
      {
        name: 'run_audit',
        scope: 'audit:write',
        title: 'Audit baslat',
        description: 'Site saglik taramasini kuyruğa alir (asenkron — sonuc birkac dakika icinde get_audit ile okunur).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
        // Yeni bir Audit satiri ekler; onceki denetimler gecmiste kalir
        destructive: false,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const job = await this.jobQueue.enqueue({
            type: 'SITE_AUDIT',
            userId: site.userId,
            siteId: site.id,
            payload: { siteId: site.id },
          });
          return { queued: true, jobId: job.dbJobId };
        },
      },
      {
        name: 'list_image_alt_issues',
        title: 'Gorsel alt metni sorunlari',
        description: 'Alt metni olmayan ya da supheli (dosya adi, "resim" gibi) gorseller: durum sayilari + en cok sayfada gecen 20 gorsel (sayfa, durum, varsa oneri). Salt-okuma.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        scope: 'audit:read',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const [byStatus, top] = await Promise.all([
            this.prisma.siteImage.groupBy({ by: ['status'], where: { siteId: site.id }, _count: { _all: true } }),
            this.prisma.siteImage.findMany({
              where: { siteId: site.id, status: { notIn: ['DISMISSED', 'VERIFIED'] } },
              orderBy: [{ pageCount: 'desc' }, { lastSeenAt: 'desc' }],
              take: 20,
              select: { id: true, src: true, firstPageUrl: true, pageCount: true, altState: true, currentAlt: true, status: true, suggestedAlt: true, approvedAlt: true },
            }),
          ]);
          return {
            byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
            images: top,
            panel: `/sites/${site.id}/images`,
            note: 'Alt metinleri siteye yazmak yalnizca panelde kullanici onayiyla yapilir.',
          };
        },
      },
      {
        name: 'suggest_image_alts',
        title: 'Gorsel alt metni oner',
        description: 'Alt metni olmayan gorseller icin gorseli GOREREK alt metni onerisi uretir (kuyruk, asenkron; maliyetli — site basina gunluk tavan var). Siteye HICBIR SEY yazmaz: oneriler panelde kullanicinin onayini bekler. Kullanici acikca istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          max: { type: 'number', description: 'En fazla kac gorsel (1-25, varsayilan 10)' },
        }, ['site_id']),
        mutating: true,
        // Yalnizca SiteImage.suggestedAlt doldurur; siteye yazma panelde onayla
        destructive: false,
        scope: 'audit:write',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const max = Math.min(IMAGE_ALT_JOB_BATCH, Math.max(1, Number(args.max) || 10));
          const room = await this.imageAltSuggest.remainingToday(site.id);
          if (room <= 0) return { queued: 0, note: 'Bugunku oneri tavani doldu.' };
          const rows = await this.prisma.siteImage.findMany({
            where: { siteId: site.id, status: 'NEW' },
            orderBy: [{ pageCount: 'desc' }],
            take: Math.min(max, room),
            select: { id: true },
          });
          if (rows.length === 0) return { queued: 0, note: 'Oneri bekleyen gorsel yok.' };
          const job = await this.jobQueue.enqueue({
            type: 'IMAGE_ALT_SUGGEST',
            userId: site.userId,
            siteId: site.id,
            payload: { siteId: site.id, userId: user.id, imageIds: rows.map((r) => r.id) },
            priority: 10,
          });
          return {
            queued: rows.length,
            jobId: job.dbJobId,
            note: 'Oneriler hazirlaninca panelde onay bekler; siteye yazma yalnizca panelden yapilir.',
            panel: `/sites/${site.id}/images`,
          };
        },
      },
      {
        name: 'get_geo_score_card',
        scope: 'audit:read',
        title: 'GEO Score Card',
        description: 'AI arama motorlarinda gorunurluk skoru — 6 pillar (crawler erisimi, yapisal veri, AI citation, otorite, tazelik, multi-modal) + harf notu + oneriler.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.geoScoreCard.build(site.id);
        },
      },
      {
        name: 'get_agent_readiness',
        scope: 'audit:read',
        requiresFeature: 'agentReadiness',
        title: 'Agent Readiness (AXO) skoru',
        // agentsAllowed: robots.txt'in ETKIN olarak izin verdigi bilinen AI ajani sayisi (agent-readiness.service)
        description: 'Domain\'in AI AJANLARINA hazırlığı: robots.txt AI tutumu, agent card, auth.md, API kataloğu, markdown negotiation... 4 seviye + robots.txt\'in izin verdiği AI ajanı sayısı (agentsAllowed / agentsTotal). status \'blocked\' ya da \'unreachable\' ise tarama siteye erişemedi: skor ölçülemedi — overallScore null döner (measured false), neden ve çözüm access alanında; skor varmış gibi sunma.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        // audit.controller GET /agent-readiness ile ayni kapi
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const latest = await this.agentReadiness.getLatest(site.id);
          return latest ? readinessForAgent(latest) : { message: 'Henuz tarama yok. run_agent_readiness_scan ile baslat.' };
        },
      },
      {
        name: 'run_agent_readiness_scan',
        scope: 'audit:write',
        title: 'Agent Readiness taramasi kos',
        // Sure: agent-readiness.service FETCH_TIMEOUT_MS=10 sn, CONCURRENCY=4; ilk
        // dalga 15-16 istek (4 tur), ardindan site haritasi adaylari SIRAYLA
        // (en az 2) — yanit vermeyen sitede 40 + 20 sn'den fazla
        description: 'AXO taramasını senkron çalıştırır ve sonucu döndürür. Süre sitenin yanıt hızına bağlı: istek başına en fazla 10 sn, aynı anda en fazla 4 istek; yavaş ya da yanıt vermeyen sitede 1 dakikayı geçebilir. status \'blocked\' ya da \'unreachable\' ise siteye erişilemedi: skor ölçülemedi (overallScore null, measured false; neden ve çözüm access alanında).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
        // Yeni tarama kaydi ekler; siteye bir sey yazmaz (oto-duzeltme ayri akis)
        destructive: false,
        requiresFeature: 'agentReadiness',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return readinessForAgent(await this.agentReadiness.scan(site.id));
        },
      },
      {
        name: 'get_ai_kpis',
        scope: 'audit:read',
        title: 'AI KPI ozeti',
        description: 'Mention rate, citation rate, sentiment, share of voice, AI crawler ziyaretleri — 7 gunluk degerler ve deltalar. deltaPct null ise kıyas yapılamadı (önceki dönem verisi yok ya da comparability alanındaki gibi ölçülen sorular/ölçüm yöntemi değişti) — "değişim yok" anlamına gelmez. agentReadiness.measured false ise AXO skoru ölçülemedi (neden reason alanında).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.aiKpis.getKpis(site.id);
        },
      },

      // ── PROMPT LAB + FIRSATLAR ───────────────────────────
      {
        name: 'list_prompts',
        scope: 'audit:read',
        title: 'Izlenen prompt\'lar',
        description: 'Prompt Lab\'de takip edilen sorular ve son citation skorlari. Dusuk skorlu prompt = icerik firsati.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return { prompts: await this.promptLab.list(site.id) };
        },
      },
      {
        name: 'run_prompt',
        scope: 'audit:write',
        title: 'Prompt olcumu kos',
        description: 'Tek bir izlenen soruyu gercek AI saglayicilarda test eder: marka gecti mi, site kaynak gosterildi mi, rakipler kimler. MALIYETLI islem — kullanici istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          prompt_id: { type: 'string', description: 'list_prompts\'tan gelen prompt id' },
        }, ['site_id', 'prompt_id']),
        mutating: true,
        // Yeni olcum satirlari ekler (haftalik olcum hakki ve maliyet tuketir)
        destructive: false,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          // Haftalik AI olcum hakki — panel uclariyla ayni kural (measurement-allowance.ts)
          const out = await this.measurement.run(user, () => this.promptLab.runPrompt(site.id, String(args.prompt_id), {}));
          // Alintilanan kaynak listeleri ajan baglamina girmez (citation-sources.ts providersWithoutSources)
          return { ...out, providers: providersWithoutSources(out.providers) };
        },
      },
      {
        name: 'get_cited_sources',
        scope: 'audit:read',
        title: 'Alintilanan dis kaynaklar',
        description: 'AI cevaplarinin kaynak olarak gosterdigi alan adlari (son 30 ya da 90 gun): kac cevapta alintilandi, hangi asistanlar, en cok hangi sorularda, tur (own/competitor/forum/review/social/video/encyclopedia/news/marketplace/docs/other — sezgisel etiket) ve "nerede yer almalisin" eylemleri. Yalniz markasiz sorular sayilir (brandedAnswersExcluded). coverage.firstRecordedAt = bu PENCEREDE kaynak kayitli ilk olcumun gunu; legacyAnswers = kaynak kaydi tutulmadan once olculen cevaplar; answersWithoutSearch = kaynak listesi dondurmeyen (aramasiz) asistan cevaplari.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          days: { type: 'integer', enum: [30, 90], description: 'Pencere (gun) — varsayilan 30' },
        }, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          // Kompakt: alan basina en fazla 3 adres, eski metin-alanlari ozeti yok
          return compactCitedSources(await this.citedSources.get(site.id, args.days));
        },
      },
      {
        name: 'get_prompt_coverage',
        scope: 'audit:read',
        title: 'Kapsama raporu',
        description: '"Hangi soru dallarinda kaybediyoruz" analizi — ana soru vs fan-out dallari citation karsilastirmasi (son 30 gun).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.promptLab.coverage(site.id, 30);
        },
      },
      {
        name: 'list_content_opportunities',
        scope: 'audit:read',
        requiresFeature: 'contentOpportunities',
        title: 'Icerik firsatlari',
        description: 'Kaybedilen AI sorgularindan turetilen icerik firsatlari (LOST/WEAK etiketli, kanit baglantili). Kapali dongunun giris noktasi.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', enum: [...OPPORTUNITY_STATUSES], description: 'OPEN | PLANNED | GENERATED | PUBLISHED | REMEASURED | DISMISSED (opsiyonel)' },
        }, ['site_id']),
        // audit.controller GET /opportunities ile ayni kapi
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const status = statusFilter(args.status, OPPORTUNITY_STATUSES);
          return { opportunities: await this.opportunities.list(site.id, { status }) };
        },
      },
      {
        name: 'derive_content_opportunities',
        scope: 'audit:write',
        title: 'Firsat taramasi',
        description: 'Son 14 gunun prompt olcumlerinden yeni icerik firsatlari cikarir, acik firsatlarin skorunu tazeler.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
        // Yalnizca turetilmis alanlari tazeler; kullanicinin karari (PLANNED,
        // DISMISSED, GENERATED) korunur. Kaynak kendi olcumlerimiz — dis dunya yok.
        destructive: false,
        openWorld: false,
        requiresFeature: 'contentOpportunities',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.opportunities.derive(site.id);
        },
      },
      {
        name: 'generate_article_from_opportunity',
        scope: 'audit:write',
        title: 'Firsattan makale uret',
        // "5 ajan": pipeline.service.ts akisi keyword → outline → writer → editor → visuals
        description: 'Bir icerik firsatindan 5 ajanli uretim hattiyla makale uretimini baslatir (kota tuketir). Bu soruyu zaten cevaplayan yayimlanmis bir makale varsa yeni makale acmaz, o makalenin metnini yeniden yazar. Kullanici acikca istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          opportunity_id: { type: 'string' },
        }, ['site_id', 'opportunity_id']),
        mutating: true,
        // Eslesen yayimlanmis makale varsa onun govdesi yeniden yazilir
        // (content-opportunity.service generateArticle, mode: 'update') — ustune yazma.
        destructive: true,
        requiresFeature: 'contentOpportunities',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.opportunities.generateArticle(site.id, String(args.opportunity_id));
        },
      },

      // ── MAKALELER ────────────────────────────────────────
      {
        name: 'list_articles',
        scope: 'articles:read',
        title: 'Makaleleri listele',
        description: 'Sitenin makaleleri: baslik, durum (DRAFT/GENERATING/READY_TO_PUBLISH/PUBLISHED...), QA durumu, yayin tarihi.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', enum: ARTICLE_STATUSES, description: 'Durum filtresi (opsiyonel)' },
          limit: { type: 'number', description: 'Varsayilan 20, max 50' },
        }, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const status = statusFilter(args.status, ARTICLE_STATUSES) as ArticleStatus | undefined;
          const articles = await this.prisma.article.findMany({
            where: { siteId: site.id, ...(status ? { status } : {}) },
            select: {
              id: true, title: true, slug: true, status: true, qaStatus: true,
              editorScore: true, wordCount: true, publishedAt: true, createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            // Negatif take Prisma'da listeyi tersten okur; 1-50 araligi
            take: Math.min(Math.max(Math.trunc(Number(args.limit)) || 20, 1), 50),
          });
          return { articles };
        },
      },
      {
        name: 'get_article',
        scope: 'articles:read',
        title: 'Makale detayi',
        description: 'Tek makalenin metadata + QA raporu + govde ozeti (ilk 2000 karakter).',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          article_id: { type: 'string' },
        }, ['site_id', 'article_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const article = await this.prisma.article.findFirst({
            where: { id: String(args.article_id), siteId: site.id },
          });
          if (!article) throw new Error('Makale bulunamadi');
          return {
            id: article.id,
            title: article.title,
            slug: article.slug,
            status: article.status,
            qaStatus: article.qaStatus,
            qaReport: article.qaReport,
            editorScore: article.editorScore,
            wordCount: article.wordCount,
            metaTitle: article.metaTitle,
            metaDescription: article.metaDescription,
            publishedAt: article.publishedAt,
            publishedTo: article.publishedTo,
            bodyPreview: (article.bodyMd ?? '').slice(0, 2000),
          };
        },
      },
      {
        name: 'create_article',
        scope: 'articles:write',
        title: 'Makale uret',
        description: 'Verilen konu icin 5 ajanli uretim hattiyla yeni bir makale uretimini kuyruğa alir (makale hakkindan bir kez duser; uretim makale cikmadan basarisiz olursa hak geri verilir). Kullanici acikca istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          topic: { type: 'string', description: 'Makale konusu / basligi' },
        }, ['site_id', 'topic']),
        mutating: true,
        // Yeni makale kaydi acar, var olani degistirmez (job payload'inda autoPublish yok)
        destructive: false,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const topic = String(args.topic ?? '').trim();
          if (topic.length < 5) throw new Error('Konu en az 5 karakter olmali');
          // Hak uretim baslamadan tek kosullu UPDATE ile duser; baslatilamazsa geri
          // verilir (QuotaService consumeArticleAllowance — ArticlesService ile ayni)
          await this.quota.consumeArticleAllowance(site.userId, site.id);
          let placeholderId: string | null = null;
          try {
            const article = await this.prisma.article.create({
              data: {
                siteId: site.id,
                topic,
                slug: `generating-${Date.now().toString(36)}`,
                title: topic,
                status: 'GENERATING' as any,
                language: site.language ?? 'tr',
                // Hak isareti: uretim makale cikmadan biterse hak bir kez iade edilir
                // (articles/allowance-refund.ts; panelin "Uret"i ile ayni kural)
                agentOutputs: withAllowanceCharge(null, 'user_start', new Date()) as any,
              },
            });
            placeholderId = article.id;
            const job = await this.jobQueue.enqueue({
              type: 'GENERATE_ARTICLE',
              userId: site.userId,
              siteId: site.id,
              payload: { siteId: site.id, topic, articleId: article.id },
            });
            return { queued: true, articleId: article.id, jobId: job.dbJobId };
          } catch (err) {
            // Yer tutucu acildiysa iade onun isaretiyle (supurucu ikinci kez iade etmesin)
            await settleUnstartedGeneration(this.prisma, this.quota, { userId: site.userId, articleId: placeholderId });
            throw err;
          }
        },
      },

      // ── ACTION PLAN ──────────────────────────────────────
      {
        name: 'get_action_plan',
        title: 'Aksiyon plani',
        description: 'Sitenin aksiyon plani: yapilacak / surmekte / bitti maddeleri, kaynak ve etki etiketleriyle.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', description: 'todo | in_progress | done | dismissed (opsiyonel)' },
        }, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return { items: await this.actionPlans.list(site.id, { status: args.status }) };
        },
      },
      {
        name: 'add_action_plan_item',
        title: 'Aksiyon planina ekle',
        description: 'Aksiyon planina yeni madde ekler (baslik + opsiyonel aciklama/etki/efor).',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          title: { type: 'string' },
          description: { type: 'string' },
          impact: { type: 'string', description: 'high | medium | low' },
          effort: { type: 'string', description: 'easy | medium | hard' },
        }, ['site_id', 'title']),
        mutating: true,
        // Yalnizca yeni madde ekler; yalnizca kendi veritabanimiz
        destructive: false,
        openWorld: false,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.actionPlans.create(site.id, {
            title: args.title,
            description: args.description,
            impact: args.impact,
            effort: args.effort,
            source: 'chat',
          });
        },
      },
      {
        name: 'update_action_plan_item',
        title: 'Aksiyon durumu guncelle',
        description: 'Aksiyon maddesinin durumunu degistirir (todo/in_progress/done/dismissed).',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          item_id: { type: 'string' },
          status: { type: 'string', description: 'todo | in_progress | done | dismissed' },
        }, ['site_id', 'item_id', 'status']),
        mutating: true,
        // Mevcut maddenin durumunu (ve doneAt'i) ustune yazar — ekleme degil
        destructive: true,
        openWorld: false,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.actionPlans.update(site.id, String(args.item_id), { status: String(args.status) });
        },
      },

      // ── PRODUCT RADAR + COMMUNITY ────────────────────────
      {
        name: 'get_product_radar',
        scope: 'audit:read',
        requiresFeature: 'productRadar',
        title: 'Product Radar',
        description: 'AI asistanlar kullanicinin kategorisinde hangi urunleri oneriyor — son tarama: urun siralamasi + markanin listede olup olmadigi.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        // audit.controller GET /product-radar ile ayni kapi
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.productRadar.latest(site.id);
        },
      },
      {
        name: 'get_community_opportunities',
        scope: 'audit:read',
        title: 'Topluluk firsatlari',
        description: 'Reddit/Quora\'da markayla ilgili cevaplanabilir sorular + AI taslak cevaplar (insan onayi bekler).',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', description: 'NEW | DRAFTED | APPROVED | POSTED | IGNORED (opsiyonel)' },
        }, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const items = await this.prisma.communityOpportunity.findMany({
            where: { siteId: site.id, ...(args.status ? { status: String(args.status) } : {}) },
            orderBy: [{ relevance: 'desc' }, { createdAt: 'desc' }],
            take: 50,
          });
          return { opportunities: items };
        },
      },

      // ── ANALYTICS ────────────────────────────────────────
      {
        name: 'get_analytics_summary',
        scope: 'analytics:read',
        title: 'GSC analytics ozeti',
        description: 'Son GSC gunluk snapshot\'lari: tiklama, gosterim, CTR, pozisyon (son 14 gun).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const snapshots = await this.prisma.analyticsSnapshot.findMany({
            where: { siteId: site.id },
            orderBy: { date: 'desc' },
            take: 14,
            select: { date: true, totalClicks: true, totalImpressions: true, avgCtr: true, avgPosition: true, trendingQueries: true },
          });
          return { snapshots: snapshots.reverse() };
        },
      },

      // ── ASO (rakipte olmayan yuzey) ──────────────────────
      {
        name: 'list_tracked_apps',
        title: 'Izlenen mobil uygulamalar',
        description: 'Sitenin ASO modulunde izlenen App Store / Play Store uygulamalari — rating, review sayisi, keyword sayisi.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const apps = await this.prisma.trackedApp.findMany({
            where: { siteId: site.id, isActive: true },
            select: {
              id: true, name: true, appStoreId: true, playStoreId: true, country: true,
              iosRating: true, iosReviewCount: true, androidRating: true, androidReviewCount: true,
              _count: { select: { keywords: true, reviews: true } },
            },
          });
          return { apps };
        },
      },
      {
        name: 'get_app_keywords',
        title: 'App keyword siralamalari',
        // Skorlarin kaynagi aso/keyword.service.ts scoreKeyword (aso-v2): popularity =
        // traffic.installs.score, difficulty = difficulty.score; 1-10 -> x10.
        description: 'Izlenen uygulamanin keyword\'leri: guncel, onceki ve en iyi magaza sirasi. popularity Apple/Google arama hacmi veya populerligi DEGILDIR: RanksUp talep tahminidir — magaza aramasinda bu terimle ilk 10\'da cikan uygulamalarin ortalama buyuklugu (Google Play\'de yukleme, App Store\'da degerlendirme sayisi), 10-100 olcegi. difficulty: ayni ilk 10 uzerinden baslik eslesmesi, terimi hedefleyen rakip sayisi, uygulama buyuklugu, puan ve guncelligin agirlikli skoru (10-100). null ya da 0 = olculemedi.',
        inputSchema: this.schema({
          app_id: { type: 'string', description: 'list_tracked_apps\'tan gelen app id' },
        }, ['app_id']),
        handler: async (user, args) => {
          const app = await this.resolveApp(user, args.app_id);
          const keywords = await this.prisma.trackedAppKeyword.findMany({
            where: { trackedAppId: app.id, isActive: true },
            select: {
              id: true, keyword: true, store: true, currentRank: true, previousRank: true,
              bestRank: true, popularity: true, difficulty: true, source: true, lastCheckedAt: true,
            },
            orderBy: [{ currentRank: { sort: 'asc', nulls: 'last' } }],
            take: 100,
          });
          return { app: app.name, keywords };
        },
      },
      {
        name: 'get_app_reviews_summary',
        title: 'App yorum analizi',
        description: 'Uygulama yorumlarinin sentiment dagilimi + son negatif yorum temalari (icerik/What\'s New firsatlari icin).',
        inputSchema: this.schema({
          app_id: { type: 'string' },
        }, ['app_id']),
        handler: async (user, args) => {
          const app = await this.resolveApp(user, args.app_id);
          const [positive, neutral, negative, recentNegative] = await Promise.all([
            this.prisma.appReview.count({ where: { trackedAppId: app.id, sentiment: 'POSITIVE' } }),
            this.prisma.appReview.count({ where: { trackedAppId: app.id, sentiment: 'NEUTRAL' } }),
            this.prisma.appReview.count({ where: { trackedAppId: app.id, sentiment: 'NEGATIVE' } }),
            this.prisma.appReview.findMany({
              where: { trackedAppId: app.id, sentiment: 'NEGATIVE' },
              orderBy: { reviewDate: 'desc' },
              take: 10,
              select: { rating: true, title: true, text: true, topics: true, reviewDate: true },
            }),
          ]);
          return {
            app: app.name,
            sentiment: { positive, neutral, negative },
            recentNegative: recentNegative.map((r) => ({
              rating: r.rating,
              title: r.title,
              excerpt: r.text.slice(0, 300),
              topics: r.topics,
              date: r.reviewDate,
            })),
          };
        },
      },
    ];
  }
}
