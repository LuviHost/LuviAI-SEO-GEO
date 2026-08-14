import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { GeoScoreCardService } from '../audit/geo-score-card.service.js';
import { AgentReadinessService } from '../audit/agent-readiness.service.js';
import { AiKpisService } from '../audit/ai-kpis.service.js';
import { ContentOpportunityService } from '../audit/content-opportunity.service.js';
import { ProductRadarService } from '../audit/product-radar.service.js';
import { PromptLabService } from '../audit/prompt-lab.service.js';
import { ActionPlansService } from '../action-plans/action-plans.service.js';
import { planHasFeature, type PlanFeature, type PlanId } from '../billing/plans.js';

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
  handler: (user: ToolUser, args: Record<string, any>) => Promise<any>;
}

const SITE_ID_PROP = {
  site_id: {
    type: 'string',
    description: 'RanksUp site ID (list_sites ile bulunur)',
  },
};

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

  private async resolveSite(user: ToolUser, siteId: unknown) {
    if (typeof siteId !== 'string' || !siteId) throw new Error('site_id zorunlu');
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new Error('Site bulunamadi');
    if (user.role !== 'ADMIN' && site.userId !== user.id) throw new Error('Bu site sana ait degil');
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
        title: 'Site genel bakis',
        description: 'Bir sitenin ozet durumu: son audit skoru, GEO skoru, agent readiness, yayinlanan makale sayisi, izlenen prompt sayisi.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const [audit, readiness, articleCount, promptCount, appCount] = await Promise.all([
            this.prisma.audit.findFirst({ where: { siteId: site.id }, orderBy: { ranAt: 'desc' }, select: { overallScore: true, geoScore: true, ranAt: true } }),
            this.prisma.agentReadinessScan.findFirst({ where: { siteId: site.id }, orderBy: { ranAt: 'desc' }, select: { overallScore: true, status: true } }),
            this.prisma.article.count({ where: { siteId: site.id, status: 'PUBLISHED' as any } }),
            this.prisma.geoPrompt.count({ where: { siteId: site.id, isActive: true } }),
            this.prisma.trackedApp.count({ where: { siteId: site.id, isActive: true } }),
          ]);
          return {
            site: { id: site.id, name: site.name, url: site.url, niche: site.niche, status: site.status },
            auditScore: audit?.overallScore ?? null,
            geoScore: audit?.geoScore ?? null,
            lastAuditAt: audit?.ranAt ?? null,
            agentReadiness: readiness ?? null,
            publishedArticles: articleCount,
            trackedPrompts: promptCount,
            trackedApps: appCount,
          };
        },
      },

      // ── AUDIT + SKORLAR ──────────────────────────────────
      {
        name: 'get_audit',
        title: 'Site audit raporu',
        description: 'Son site saglik taramasinin detayi: 14 teknik kontrol, sorun listesi ve otomatik duzeltilebilir maddeler.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const audit = await this.prisma.audit.findFirst({ where: { siteId: site.id }, orderBy: { ranAt: 'desc' } });
          if (!audit) return { message: 'Henuz audit kosulmamis. run_audit ile baslatabilirsin.' };
          return {
            overallScore: audit.overallScore,
            geoScore: audit.geoScore,
            checks: audit.checks,
            issues: audit.issues,
            ranAt: audit.ranAt,
          };
        },
      },
      {
        name: 'run_audit',
        title: 'Audit baslat',
        description: 'Site saglik taramasini kuyruğa alir (asenkron — sonuc birkac dakika icinde get_audit ile okunur).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
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
        name: 'get_geo_score_card',
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
        title: 'Agent Readiness (AXO) skoru',
        description: 'Domain\'in AI AJANLARINA hazirligi: robots AI stance, agent card, auth.md, API katalogu, markdown negotiation... 4 seviye + kacinilan ajan sayisi.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        // audit.controller GET /agent-readiness ile ayni kapi
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const latest = await this.agentReadiness.getLatest(site.id);
          return latest ?? { message: 'Henuz tarama yok. run_agent_readiness_scan ile baslat.' };
        },
      },
      {
        name: 'run_agent_readiness_scan',
        title: 'Agent Readiness taramasi kos',
        description: 'AXO taramasini senkron calistirir ve guncel skoru dondurur (~15 sn).',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
        requiresFeature: 'agentReadiness',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.agentReadiness.scan(site.id);
        },
      },
      {
        name: 'get_ai_kpis',
        title: 'AI KPI ozeti',
        description: 'Mention rate, citation rate, sentiment, share of voice, AI crawler ziyaretleri — 7 gunluk degerler ve deltalar.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.aiKpis.getKpis(site.id);
        },
      },

      // ── PROMPT LAB + FIRSATLAR ───────────────────────────
      {
        name: 'list_prompts',
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
        title: 'Prompt olcumu kos',
        description: 'Tek bir izlenen soruyu gercek AI saglayicilarda test eder: marka gecti mi, site kaynak gosterildi mi, rakipler kimler. MALIYETLI islem — kullanici istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          prompt_id: { type: 'string', description: 'list_prompts\'tan gelen prompt id' },
        }, ['site_id', 'prompt_id']),
        mutating: true,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.promptLab.runPrompt(site.id, String(args.prompt_id), {});
        },
      },
      {
        name: 'get_prompt_coverage',
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
        title: 'Icerik firsatlari',
        description: 'Kaybedilen AI sorgularindan turetilen icerik firsatlari (LOST/WEAK etiketli, kanit baglantili). Kapali dongunun giris noktasi.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', description: 'OPEN | PLANNED | GENERATED | PUBLISHED | REMEASURED | DISMISSED (opsiyonel)' },
        }, ['site_id']),
        // audit.controller GET /opportunities ile ayni kapi
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return { opportunities: await this.opportunities.list(site.id, { status: args.status }) };
        },
      },
      {
        name: 'derive_content_opportunities',
        title: 'Firsat taramasi',
        description: 'Son 14 gunun prompt olcumlerinden yeni icerik firsatlari cikarir.',
        inputSchema: this.schema(SITE_ID_PROP, ['site_id']),
        mutating: true,
        requiresFeature: 'contentOpportunities',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.opportunities.derive(site.id);
        },
      },
      {
        name: 'generate_article_from_opportunity',
        title: 'Firsattan makale uret',
        description: 'Bir icerik firsatindan 6-ajan pipeline ile makale uretimini baslatir (kota tuketir). Kullanici acikca istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          opportunity_id: { type: 'string' },
        }, ['site_id', 'opportunity_id']),
        mutating: true,
        requiresFeature: 'contentOpportunities',
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.opportunities.generateArticle(site.id, String(args.opportunity_id));
        },
      },

      // ── MAKALELER ────────────────────────────────────────
      {
        name: 'list_articles',
        title: 'Makaleleri listele',
        description: 'Sitenin makaleleri: baslik, durum (DRAFT/GENERATING/READY_TO_PUBLISH/PUBLISHED...), QA durumu, yayin tarihi.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          status: { type: 'string', description: 'Durum filtresi (opsiyonel)' },
          limit: { type: 'number', description: 'Varsayilan 20, max 50' },
        }, ['site_id']),
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const articles = await this.prisma.article.findMany({
            where: { siteId: site.id, ...(args.status ? { status: args.status as any } : {}) },
            select: {
              id: true, title: true, slug: true, status: true, qaStatus: true,
              editorScore: true, wordCount: true, publishedAt: true, createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(args.limit) || 20, 50),
          });
          return { articles };
        },
      },
      {
        name: 'get_article',
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
        title: 'Makale uret',
        description: 'Verilen konu icin 6-ajan pipeline ile makale uretimini kuyruğa alir (kota tuketir). Kullanici acikca istemeden cagirma.',
        inputSchema: this.schema({
          ...SITE_ID_PROP,
          topic: { type: 'string', description: 'Makale konusu / basligi' },
        }, ['site_id', 'topic']),
        mutating: true,
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          const topic = String(args.topic ?? '').trim();
          if (topic.length < 5) throw new Error('Konu en az 5 karakter olmali');
          await this.quota.enforceArticleQuota(site.userId);
          const article = await this.prisma.article.create({
            data: {
              siteId: site.id,
              topic,
              slug: `generating-${Date.now().toString(36)}`,
              title: topic,
              status: 'GENERATING' as any,
              language: site.language ?? 'tr',
            },
          });
          const job = await this.jobQueue.enqueue({
            type: 'GENERATE_ARTICLE',
            userId: site.userId,
            siteId: site.id,
            payload: { siteId: site.id, topic, articleId: article.id },
          });
          await this.quota.incrementArticleUsage(site.userId);
          return { queued: true, articleId: article.id, jobId: job.dbJobId };
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
        handler: async (user, args) => {
          const site = await this.resolveSite(user, args.site_id);
          return this.actionPlans.update(site.id, String(args.item_id), { status: String(args.status) });
        },
      },

      // ── PRODUCT RADAR + COMMUNITY ────────────────────────
      {
        name: 'get_product_radar',
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
        description: 'Izlenen uygulamanin keyword\'leri: guncel sira, onceki sira, en iyi sira, populerlik/zorluk skorlari.',
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
