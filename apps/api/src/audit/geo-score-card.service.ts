import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isHeroPlaceholder } from '../articles/hero-placeholder.js';
import { lastLiveWriteAt } from '../articles/republish-policy.js';
import { isUnverifiedCheck } from './audit-checks.service.js';
import { CRITICAL_SEARCH_BOTS } from './robots-check.js';
import { crawlAccessMessage, crawlAccessNewerThanAudit, readCrawlAccess } from '../sites/crawl-access.js';

/**
 * Kural artik sites/crawl-access.ts'te TEK yerde (audit getLatest, MCP ve
 * raporlar da oradan okur). Bu dosyadan ice aktaran eski cagiranlar
 * kirilmasin diye yeniden disa aktarilir.
 */
export { crawlAccessNewerThanAudit };

/**
 * Olculen AI asistanlari (ai-citation.service.ts runForSite). Llama ('meta')
 * yalniz GROQ_LLAMA_MODEL tanimliyken olculur; snapshot'ta gorunurse o da
 * sayilir (checkAiCitation).
 */
const OLCULEN_ASISTANLAR = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];

/**
 * AI Citation sutununun saydigi olcumlerin tazelik penceresi (gun).
 *
 * NEDEN 9, 7 DEGIL: olcum hakki son olcumden tam 7x24 saat sonra acilir
 * (billing/measurement-allowance.ts MEASUREMENT_WINDOW_MS), ama snapshot tarihi
 * UTC gece yarisina yuvarlanir (ai-citation-tracker.service.ts). 7 gunluk pencere
 * yuvarlanmis tarihi olcum saatinden once eskitiyordu: haftada bir olcen kullanici
 * yeniden olcum yapamadan saatlerce sutunu 0 goruyordu. 7 gun hak + 1 gun tarih
 * yuvarlamasi + 1 gun pay. SSS metni ("son 9 gunde") bu sayiyla ayni kalmali.
 */
export const AI_CITATION_FRESH_DAYS = 9;

const isoDay = (d: Date | string): string => {
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : String(d);
};

/**
 * Organization sameAs kaniti olarak okunan en eski Agent Readiness (AXO) tarama
 * surumu. v3 oncesi 'org-schema' kontrolu Organization alt turlerini
 * (HairSalon, Dentist...) ve @graph icindeki dugumu goremiyor, ana sayfa
 * engellendiginde de "schema yok" diyordu — o kayit kanit sayilmaz. Sabit 3:
 * AXO baska bir nedenle surum artirsa da v3 kayitlari gecerli kalir.
 */
export const ORG_SAMEAS_MIN_SCAN_VERSION = 3;

const SAME_AS_CHECK = { id: 'social-sameAs', name: 'Kimlik grafiği (Organization sameAs)' } as const;

/**
 * Otorite sutununun sameAs kontrolu.
 *
 * NEDEN DEGISTI: kontrol Site.socialProfiles'i okuyordu, ama bu alani API'de
 * ya da panelde YAZAN hicbir yol yok (UpdateSiteDto'da yok) — yalniz eski veriyle
 * gecilebiliyordu; her yeni sitede "0 sosyal profil bağlı" ile puan kaybettiriyordu.
 * sameAs'in asil yeri sitenin kendi ana sayfasindaki Organization JSON-LD'si.
 * Denetim (audit) JSON-LD'yi KALICI saklamiyor (yalniz schema kapsam sayilari);
 * ana sayfa JSON-LD'sinden Organization + sameAs sayisini kalici yazan tek
 * kayit Agent Readiness taramasinin 'org-schema' kontrolu (AgentReadinessScan.levels,
 * agent-readiness-checks.ts: findOrganizationNode, en az 2 sameAs = gecti).
 *
 * Oncelik: (1) son v3+ AXO taramasinin 'org-schema' sonucu; (2) eski
 * socialProfiles verisi; (3) ikisi de yoksa "henüz ölçülmedi" — unverified,
 * puana girmez (checkAuthority). Ana sayfa engellendiyse de unverified.
 */
export function sameAsCheck(
  scan: { ranAt: Date | string; levels: unknown } | null | undefined,
  socialProfiles: unknown,
): GeoPillar['checks'][number] {
  const org = orgSchemaCheckOf(scan?.levels);
  if (scan && org) {
    const tarih = isoDay(scan.ranAt);
    if (org.state === 'blocked' || org.blocked) {
      const neden = org.blocked?.reason ?? org.statusText ?? 'ana sayfa okunamadı';
      return {
        ...SAME_AS_CHECK, ok: false, unverified: true,
        detail: `${tarih} tarihli Agent Readiness taraması ana sayfayı okuyamadı: ${neden}`,
      };
    }
    const ok = org.ok === true;
    const durum = org.statusText ?? (ok ? 'yeterli' : 'eksik');
    // Oneri yalniz schema durumu raporlandiysa; "Ana sayfa okunamadı (HTTP 500)"
    // gibi bir sonucun yanina sameAs tavsiyesi yazmak yaniltirdi
    const oneri = !ok && /schema/i.test(durum) ? ' — en az 2 sameAs profili önerilir' : '';
    return {
      ...SAME_AS_CHECK, ok,
      detail: `Ana sayfa (${tarih} Agent Readiness taraması): ${durum}${oneri}`,
    };
  }
  const profiles = Array.isArray(socialProfiles)
    ? socialProfiles.filter((p) => typeof p === 'string' && p.trim() !== '')
    : [];
  if (profiles.length > 0) {
    return { ...SAME_AS_CHECK, ok: profiles.length >= 2, detail: `${profiles.length} sosyal profil kayıtlı` };
  }
  return {
    ...SAME_AS_CHECK, ok: false, unverified: true,
    detail: 'Ana sayfadaki Organization sameAs bağlantıları henüz ölçülmedi — Agent Readiness taraması çalıştığında ölçülür; o zamana kadar puana girmez.',
  };
}

const ORG_SCHEMA_CHECK = { id: 'org-schema', name: 'Organization / LocalBusiness şeması (site)' } as const;

/**
 * Yapisal Veri sutununun site kontrolu: ana sayfada Organization ya da bir alt
 * turu (LocalBusiness, HairSalon, Dentist...) JSON-LD'si VAR MI. sameAs sayisi
 * burada aranmaz (o Otorite sutununda). Kaynak son v3+ Agent Readiness
 * taramasinin 'org-schema' kontrolu: PARSE adimi "Organization ailesi bulundu"
 * sonucunu tasir (agent-readiness-checks.ts). Tarama yoksa ya da ana sayfa
 * okunamadiysa unverified — puana girmez.
 */
export function orgSchemaPresenceCheck(
  scan: { ranAt: Date | string; levels: unknown } | null | undefined,
): GeoPillar['checks'][number] {
  const org = scan ? orgSchemaCheckOf(scan.levels) : null;
  if (!scan || !org) {
    return {
      ...ORG_SCHEMA_CHECK, ok: false, unverified: true,
      detail: 'Ana sayfadaki Organization şeması henüz ölçülmedi — Agent Readiness taraması çalıştığında ölçülür; o zamana kadar puana girmez.',
    };
  }
  const tarih = isoDay(scan.ranAt);
  const durum = org.statusText ?? '';
  if (org.state === 'blocked' || org.blocked || /^Ana sayfa okunamad/i.test(durum)) {
    const neden = org.blocked?.reason ?? (durum || 'ana sayfa okunamadı');
    return {
      ...ORG_SCHEMA_CHECK, ok: false, unverified: true,
      detail: `${tarih} tarihli Agent Readiness taraması ana sayfayı okuyamadı: ${neden}`,
    };
  }
  const parse = Array.isArray(org.audit)
    ? (org.audit as Array<{ step?: unknown; ok?: unknown }>).find((a) => a?.step === 'PARSE')
    : undefined;
  const var_ = parse ? parse.ok === true : /schema var/i.test(durum);
  return {
    ...ORG_SCHEMA_CHECK, ok: var_,
    detail: var_
      ? `Ana sayfa (${tarih} Agent Readiness taraması): ${durum || 'Organization şeması var'}`
      : `Ana sayfada Organization ya da LocalBusiness şeması yok (${tarih} Agent Readiness taraması)`,
  };
}

const ROBOTS_CHECK = { id: 'robots', name: 'Kritik arama botları (robots.txt)' } as const;
const CRITICAL_BOT_NAMES = CRITICAL_SEARCH_BOTS.map((b) => b.name);

/**
 * Crawler sutununun robots satiri: gorunurlugu kesen alti botun (Googlebot,
 * Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot, Claude-User)
 * robots.txt'te ETKIN olarak engelli olup olmadigi — denetimin robots_txt
 * kontrolunun details.searchBots alanindan (robots-check.ts, yontem v3).
 * robots.txt yoksa kural da yoktur: botlar serbest (RFC 9309), satir gecer.
 * v2 kaydi yalniz uc AI arama botunu tasir; eksik botlar yeni taramada olculur.
 */
export function criticalBotsCheck(entry: any, noAudit: string | null): GeoPillar['checks'][number] {
  if (noAudit) return { ...ROBOTS_CHECK, ok: false, detail: noAudit };
  if (entry?.found !== true) {
    return { ...ROBOTS_CHECK, ok: true, detail: 'robots.txt yok — kural olmadığı için arama botları serbest' };
  }
  const bots: Array<{ name?: unknown; effective?: unknown }> = Array.isArray(entry.details?.searchBots) ? entry.details.searchBots : [];
  if (bots.length === 0) {
    // v1 kaydi: bot ayrintisi yok — yalniz eski skor bilinir
    const ok = typeof entry.score === 'number' && entry.score >= 70;
    return { ...ROBOTS_CHECK, ok, detail: `Skor: ${entry.score ?? '?'}/100 (eski tarama — yeniden tarayınca kritik botlar ölçülür)` };
  }
  const olculen = bots.filter((b) => typeof b?.name === 'string').map((b) => ({ name: b.name as string, block: b.effective === 'block' }));
  const engelli = olculen.filter((b) => b.block).map((b) => b.name);
  const eksik = CRITICAL_BOT_NAMES.filter((n) => !olculen.some((b) => b.name === n));
  const not = eksik.length > 0 ? ` (${eksik.join(', ')} bir sonraki taramada ölçülür)` : '';
  return {
    ...ROBOTS_CHECK,
    ok: engelli.length === 0,
    detail: engelli.length === 0
      ? `Engelli kritik bot yok${not}`
      : `Engelli: ${engelli.join(', ')} — robots.txt'teki engeli kaldırmazsan bu botlar siteyi göremez${not}`,
  };
}

/** AgentReadinessScan.levels JSON'unda 'org-schema' kontrolu (bicim bozuksa null) */
function orgSchemaCheckOf(levels: unknown): {
  ok?: unknown; statusText?: string; state?: string; blocked?: { reason?: string } | null; audit?: unknown;
} | null {
  if (!Array.isArray(levels)) return null;
  for (const level of levels) {
    const checks = (level as { checks?: unknown } | null)?.checks;
    if (!Array.isArray(checks)) continue;
    const c = checks.find((x) => (x as { id?: unknown } | null)?.id === 'org-schema');
    if (c && typeof c === 'object') return c as any;
  }
  return null;
}

/**
 * Makale sutunlarinin (Tazelik, Multi-Modal; Yapisal Veri'nin kapsama satiri)
 * "olculemedi" nedeni. Bunlar YALNIZ RanksUp'in yayinladigi yazilara (Article,
 * PUBLISHED) bakar, musterinin kendi sitesindeki sayfalara degil. RanksUp'tan
 * yayin yoksa olculecek bir sey yok: 0 vermek, kendi blogunu baska yerden
 * yoneten siteyi sebepsiz F'ye dusuruyordu (uc sahte sifir).
 */
export const NO_RANKSUP_ARTICLES_REASON =
  "RanksUp'tan yayınlanmış makale yok — bu sütun yalnız RanksUp'ın yayınladığı yazılara bakar";

/** Yapisal Veri sutunu hic olculemedi: RanksUp makalesi de, ana sayfa Organization olcumu de yok */
export const NO_STRUCTURED_DATA_REASON =
  "RanksUp'tan yayınlanmış makale yok ve ana sayfadaki Organization şeması henüz ölçülmedi (Agent Readiness taraması)";

/** Tazelik penceresi: yayindaki makalenin son icerik yazimi bu kadar gun icindeyse taze */
export const FRESHNESS_WINDOW_DAYS = 365;

/** Tazelik sutununun gecme esigi: makalelerin en az bu orani pencere icinde */
export const FRESHNESS_MIN_SHARE = 0.7;

/** AI Citation sutununun "olculemedi" nedeni: tazelik penceresinde hic olcum yok */
export const NO_FRESH_CITATION_REASON =
  `Son ${AI_CITATION_FRESH_DAYS} günde AI ölçümü yok — AI Görünürlük'te Yeniden Test ile ölçülür`;

export type GeoGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface GeoScoreCard {
  /** null: hicbir sutun olculemedi — 0 degil, olcum yok */
  overallScore: number | null;
  /** Yalniz olculen sutunlardan; genel skor null ise null */
  grade: GeoGrade | null;
  pillars: GeoPillar[];
  recommendations: string[];
  /** Genel skora giren (olculen) sutunlarin agirlik toplami */
  measuredWeight: number;
  /** Tum sutunlarin agirlik toplami */
  totalWeight: number;
  generatedAt: string;
}

export interface GeoPillar {
  id: string;
  name: string;
  weight: number;       // 1-3
  /**
   * 0-100; null = sutun OLCULEMEDI (unmeasuredReason): genel skora girmez,
   * agirligi olculen sutunlara dagilir. 0 ile karistirilmamali.
   */
  score: number | null;
  status: 'great' | 'good' | 'warning' | 'critical' | 'unmeasured';
  /** score null ise nedeni (Turkce, kullaniciya gosterilir) */
  unmeasuredReason?: string;
  /**
   * unverified: denetim dosyayi OKUYAMADI (engel / sunucu hatasi) ya da sinyal
   * henuz OLCULMEDI (Otorite: sameAs taranmadi) — "yok" degil, olculemedi.
   * ok=false kalir; otomatik duzeltme onerilmez. Crawler sutununda puana
   * girer (okuma engeli bir erisim sorunudur); Otorite sutununda girmez.
   */
  checks: Array<{ id: string; name: string; ok: boolean; detail: string; unverified?: boolean }>;
}

/** Olculemeyen sutun: puan null, kontrol satiri yok, neden acik */
function unmeasuredPillar(id: string, name: string, weight: number, reason: string): GeoPillar {
  return { id, name, weight, score: null, status: 'unmeasured', unmeasuredReason: reason, checks: [] };
}

/**
 * Genel skor = YALNIZ olculen sutunlarin agirlikli ortalamasi (agirliklar olculen
 * sutunlar uzerinden yeniden normalize edilir). Hicbir sutun olculemediyse null.
 * Tum sutunlar olculuyse eski formulun aynisi.
 */
export function weightedOverall(pillars: Array<Pick<GeoPillar, 'weight' | 'score'>>): {
  overallScore: number | null; measuredWeight: number; totalWeight: number;
} {
  const totalWeight = pillars.reduce((a, p) => a + p.weight, 0);
  let measuredWeight = 0;
  let sum = 0;
  for (const p of pillars) {
    if (p.score === null) continue;
    measuredWeight += p.weight;
    sum += p.score * p.weight;
  }
  return {
    overallScore: measuredWeight === 0 ? null : Math.round(sum / measuredWeight),
    measuredWeight,
    totalWeight,
  };
}

export function gradeOf(overall: number): GeoGrade {
  return overall >= 90 ? 'A+' : overall >= 80 ? 'A' : overall >= 70 ? 'B' : overall >= 60 ? 'C' : overall >= 50 ? 'D' : 'F';
}

/**
 * GEO Score Card — sitenin "AI search engine'lerde gorunurluk seviyesi"ni
 * 6 pillar uzerinden olcer. Her birinin agirlikli ortalamasi overall skor.
 *
 *  1. Crawler Erisimi (alti kritik arama botunun robots.txt erisimi + sitemap.xml)
 *  2. Yapısal Veri (RanksUp makalelerinin schema kapsami + ana sayfada
 *     Organization/LocalBusiness — Agent Readiness taramasindan)
 *  3. AI Citation (olculen tum AI asistanlarinin son 9 gun skorlari, AI_CITATION_FRESH_DAYS)
 *  4. Otorite (ana sayfa Organization sameAs — Agent Readiness taramasindan —, rakip listesi, GSC baglantisi)
 *  5. Tazelik (makalelerin en az %70'i son 12 ayda yayinlanmis ya da guncellenmis)
 *  6. Multi-Modal (hero gorsel kapsami)
 *
 * 08.11.2026 kanit denetimi: llms.txt / llms-full.txt (Google yok sayiyor,
 * olcumlerde etkisi yok), "en az 5 schema tipi", Speakable ve FAQPage odulleri
 * (Ahrefs'in kontrollu testinde schema'nin AI alintisina etkisi cikmadi; FAQ
 * zengin sonucu Mayis 2026'da kalkti) ve yayin sikligi esikleri (Google: taze
 * gorunmek icin cok icerik eklemek ise yaramaz) puandan cikti.
 *
 * OLCULEMEYEN SUTUN (score null, unmeasuredReason): 5 ve 6 yalniz RanksUp'in
 * yayinladigi makalelere bakar — RanksUp'tan yayin yoksa olculemez. 2, makale
 * de Organization olcumu de yoksa olculemez. 3, tazelik penceresinde
 * (AI_CITATION_FRESH_DAYS) olcum yoksa olculemez. Olculemeyen sutun genel skora
 * girmez; agirliklar olculen sutunlar uzerinden yeniden dagitilir
 * (weightedOverall). Hicbiri olculemezse genel skor ve harf notu null.
 *
 * Urunden kaldirilan modullere (sosyal yayin, TTS ses, podcast RSS — commit
 * 0db5a1c) bagli kontroller puandan cikarildi: hicbir musteri artik onlari
 * gecemez, kalsalar her sitenin skorunu sebepsiz dusururlerdi ve olmayan bir
 * ozelligi ("podcast feed aktif") vaat ederlerdi.
 */
@Injectable()
export class GeoScoreCardService {
  private readonly log = new Logger(GeoScoreCardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(siteId: string): Promise<GeoScoreCard> {
    const [crawler, structured, citation, authority, freshness, multiModal] = await Promise.all([
      this.checkCrawlerAccess(siteId),
      this.checkStructuredData(siteId),
      this.checkAiCitation(siteId),
      this.checkAuthority(siteId),
      this.checkFreshness(siteId),
      this.checkMultiModal(siteId),
    ]);

    const pillars = [crawler, structured, citation, authority, freshness, multiModal];
    const { overallScore, measuredWeight, totalWeight } = weightedOverall(pillars);
    const grade = overallScore === null ? null : gradeOf(overallScore);

    // Tavsiyeler — olculen en zayif sutunlardan. Olculemeyen sutun icin
    // "0/0 makale" gibi bir tavsiye yazilmaz; en fazla bir notr not.
    // Siralama kopyada: donen sutun sirasi sabit kalir (eskiden yerinde
    // siralanip puana gore donuyordu).
    const recommendations: string[] = [];
    const measured = pillars.filter((p): p is GeoPillar & { score: number } => p.score !== null);
    for (const p of [...measured].sort((a, b) => a.score - b.score).slice(0, 3)) {
      const failed = p.checks.filter((c) => !c.ok);
      for (const c of failed.slice(0, 2)) {
        recommendations.push(`[${p.name}] ${c.name}: ${c.detail}`);
      }
    }
    const unmeasured = pillars.filter((p) => p.score === null);
    if (unmeasured.length > 0) {
      recommendations.push(
        `Puana katılmadı (ölçülmedi): ${unmeasured.map((p) => p.name).join(', ')} — nedeni sütun ayrıntısında.`,
      );
    }

    return {
      overallScore,
      grade,
      pillars,
      recommendations,
      measuredWeight,
      totalWeight,
      generatedAt: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 1: Crawler Erisimi
  // ────────────────────────────────────────────────────────────
  private async checkCrawlerAccess(siteId: string): Promise<GeoPillar> {
    // readCrawlAccess hata ATMAZ (kv sorunu karti dusurmez)
    const [audit, access] = await Promise.all([
      this.prisma.audit.findFirst({
        where: { siteId },
        orderBy: { ranAt: 'desc' },
      }),
      readCrawlAccess(this.prisma, siteId),
    ]);
    const checks: GeoPillar['checks'] = [];
    const ck: any = audit?.checks ?? {};

    /**
     * Denetimden SONRAKI tarama denemesi siteye erisemediyse (site artik bizi
     * engelliyor / ulasilamiyor) denetimdeki dosya durumu BAYAT: "mevcut" ya da
     * "yok" denmez — dogrulanamadi + erisim nedeni ve cozumu. Oncelik bu
     * kayitta; sonra denetimin kendi "okuyamadim" isareti.
     */
    const blocked = crawlAccessNewerThanAudit(access, audit?.ranAt);
    const staleByAccess = (id: string, name: string, label: string): GeoPillar['checks'][number] | null =>
      blocked
        ? {
            id, name, ok: false, unverified: true,
            detail: `${label} doğrulanamadı: ${isoDay(blocked.at)} tarihli tarama denemesi siteye erişemedi. ${crawlAccessMessage(blocked)}`,
          }
        : null;

    /**
     * Denetim dosyayi okuyamadiysa (details.unverified) "yok — auto-fix uygula"
     * YALAN olur: dosya var olabilir, biz goremedik; okuyamadigimiz dosyanin
     * yerine uretilmis dosya yazmak da musterinin dosyasini silmek olurdu.
     * Neden (unverifiedReason) gosterilir, otomatik duzeltme onerilmez. Puan
     * formulu degismez (ok=false): bu sutun tarayici ERISIMINI olcer ve okuma
     * engeli bir erisim sorunudur — ama "eksik dosya" diye sunulmaz.
     */
    const unverified = (id: string, name: string, entry: any, label: string): GeoPillar['checks'][number] | null =>
      isUnverifiedCheck(entry)
        ? { id, name, ok: false, unverified: true, detail: String(entry.details?.unverifiedReason ?? `${label} doğrulanamadı.`) }
        : null;
    // Hic denetim yoksa dosyalarin durumu BILINMIYOR — "yok" denmez
    const noAudit = !audit ? 'Henüz site denetimi yapılmadı — durum bilinmiyor.' : null;

    // 08.11.2026: llms.txt ve llms-full.txt satirlari puandan cikti —
    // Google Arama llms.txt'i yok sayiyor, Sistrix ve SE Ranking olcumlerinde
    // etkisi gorulmedi. Sutun yalniz gorunurlugu GERCEKTEN kesen iki seye bakar:
    // kritik arama botlarinin erisimi ve site haritasi.
    checks.push(
      staleByAccess(ROBOTS_CHECK.id, ROBOTS_CHECK.name, 'robots.txt')
        ?? unverified(ROBOTS_CHECK.id, ROBOTS_CHECK.name, ck.robots_txt, 'robots.txt')
        ?? criticalBotsCheck(ck.robots_txt, noAudit),
    );
    checks.push(staleByAccess('sitemap', 'sitemap.xml', 'sitemap.xml') ?? unverified('sitemap', 'sitemap.xml', ck.sitemap_xml, 'sitemap.xml') ?? {
      id: 'sitemap', name: 'sitemap.xml',
      ok: ck.sitemap_xml?.found === true,
      detail: ck.sitemap_xml?.found ? 'Mevcut' : noAudit ?? 'sitemap.xml yok',
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'crawler-access', name: 'Crawler Erişimi', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 2: Yapısal Veri (Schema)
  // ────────────────────────────────────────────────────────────
  private async checkStructuredData(siteId: string): Promise<GeoPillar> {
    const [articles, scan] = await Promise.all([
      this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any },
        select: { id: true, schemaMarkup: true } as any,
        take: 50,
      }),
      this.latestOrgScan(siteId),
    ]);
    const checks: GeoPillar['checks'] = [];

    // "En az 5 farklı tip", Speakable ve FAQPage odulleri kaldirildi (08.11.2026):
    // Ahrefs'in kontrollu testinde schema eklemenin AI alintisina etkisi
    // cikmadi, Google FAQ zengin sonucunu Mayis 2026'da kaldirdi; Speakable
    // yalniz ABD'de Ingilizce haber icin beta. Kalan: makalelerde schema
    // KAPSAMI ve sitede kimlik (Organization/LocalBusiness) isaretlemesi.
    if (articles.length > 0) {
      const withSchema = articles.filter((a: any) => a.schemaMarkup);
      checks.push({
        id: 'schema-coverage', name: 'Schema kapsama',
        ok: withSchema.length / articles.length >= 0.8,
        detail: `${withSchema.length}/${articles.length} makale schema'lı (önerilen: en az %80)`,
      });
    } else {
      checks.push({ id: 'schema-coverage', name: 'Schema kapsama', ok: false, unverified: true, detail: NO_RANKSUP_ARTICLES_REASON });
    }
    checks.push(orgSchemaPresenceCheck(scan));

    // Olculemeyen satir puana girmez; hicbiri olculemezse sutun olculmedi
    const scored = checks.filter((c) => !c.unverified);
    if (scored.length === 0) {
      return unmeasuredPillar('structured-data', 'Yapısal Veri', 3, NO_STRUCTURED_DATA_REASON);
    }
    const score = Math.round((scored.filter(c => c.ok).length / scored.length) * 100);
    return {
      id: 'structured-data', name: 'Yapısal Veri', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 3: AI Citation
  // ────────────────────────────────────────────────────────────
  private async checkAiCitation(siteId: string): Promise<GeoPillar> {
    const since = new Date(Date.now() - AI_CITATION_FRESH_DAYS * 86400000);
    const recent = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      // probes JSON'u (excerpt + alintilanan kaynaklar) burada kullanilmiyor
      select: { provider: true, available: true, score: true },
    });

    const checks: GeoPillar['checks'] = [];
    // Eskiden yalniz 4 saglayici (Claude/Gemini/ChatGPT/Perplexity) puanlaniyordu;
    // olculen 6 asistanin ikisi (Grok, DeepSeek) skora hic girmiyordu.
    const providers = [...new Set([...OLCULEN_ASISTANLAR, ...recent.map((r) => r.provider)])];

    for (const p of providers) {
      const pSnapshots = recent.filter((r) => r.provider === p && r.available);
      // Bu asistandan pencerede (AI_CITATION_FRESH_DAYS) olcum ALINAMADIYSA (anahtar/kota/servis
      // hatasi, Llama'nin yapilandirilmamasi) sitenin gorunurlugu hakkinda bir
      // sey soylemez: satir ve payda disinda kalir. "Saglayici aktif degil"
      // demek de yanlis olurdu — olcum sadece bu pencerede yok.
      if (pSnapshots.length === 0) continue;
      // null skor = "markasiz sorgu olculemedi" — 0 sayip ortalamayi cokertme.
      // Aksi halde tum brain sorgulari markali olan site, hicbir sey
      // degismedigi halde "AI gorunurluk 0/100 cokmus" uyarisi goruyordu.
      const scored = pSnapshots.filter((s) => s.score !== null);
      if (scored.length === 0) {
        checks.push({
          id: `cite-${p}`, name: this.providerLabel(p),
          ok: false,
          detail: 'Markasız sorgu ölçümü yok — skor hesaplanamadı (Prompt Lab\'e markasız soru ekleyin)',
        });
        continue;
      }
      const avg = scored.reduce((a, s) => a + (s.score as number), 0) / scored.length;
      checks.push({
        id: `cite-${p}`, name: this.providerLabel(p),
        ok: avg >= 30,
        detail: `Son ${AI_CITATION_FRESH_DAYS} gün ortalaması: ${avg.toFixed(0)}/100`,
      });
    }

    if (checks.length === 0) {
      // Pencerede hic olcum yok: gorunurluk 0 degil, OLCULMEDI. Sutun genel
      // skora girmez (agirligi olculen sutunlara dagilir); neden kullaniciya acik.
      return unmeasuredPillar('ai-citation', 'AI Citation', 3, NO_FRESH_CITATION_REASON);
    }

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      // Ad sabit; hangi asistanlarin sayildigi checks satirlarinda
      id: 'ai-citation', name: 'AI Citation', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 4: Otorite (sameAs, rakip listesi, GSC)
  // ────────────────────────────────────────────────────────────
  private async checkAuthority(siteId: string): Promise<GeoPillar> {
    const [site, scan] = await Promise.all([
      this.prisma.site.findUniqueOrThrow({
        where: { id: siteId },
        include: { brain: true },
      }) as Promise<any>,
      this.latestOrgScan(siteId),
    ]);
    const checks: GeoPillar['checks'] = [];

    checks.push(sameAsCheck(scan, site.socialProfiles));

    const competitors: any[] = Array.isArray(site.brain?.competitors) ? site.brain.competitors : [];
    checks.push({
      id: 'competitive-landscape', name: 'Rekabet manzarası',
      ok: competitors.length >= 3,
      detail: `${competitors.length} rakip tanımlı`,
    });

    // 'social-active' (aktif sosyal kanal) kontrolu kaldirildi: sosyal yayin
    // modulu urunden cikti, kanal baglanamiyor — kontrol hicbir sitede gecemezdi.

    checks.push({
      id: 'gsc', name: 'GSC bağlı',
      ok: !!site.gscConnectedAt,
      detail: site.gscConnectedAt ? 'Bağlı' : 'Otorite sinyali için bağlamanız önerilir',
    });

    // Olculemeyen kontrol (unverified: sameAs henuz taranmadi / ana sayfa
    // okunamadi) puana GIRMEZ: RanksUp'in olcmedigi bir sinyal yuzunden site
    // puan kaybetmez. Kontrol satiri notr "doğrulanamadı" olarak gorunur.
    const scored = checks.filter((c) => !c.unverified);
    const score = scored.length === 0 ? 0 : Math.round((scored.filter(c => c.ok).length / scored.length) * 100);
    return {
      id: 'authority', name: 'Otorite Sinyalleri', weight: 2,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 5: Tazelik
  // ────────────────────────────────────────────────────────────
  private async checkFreshness(siteId: string): Promise<GeoPillar> {
    // 08.11.2026: "son 30 günde 4+ yayın", "son 7 günde 1+ yayın" ve "90 günden
    // eski <10 makale" kaldirildi. Google: taze gorunmek icin cok icerik eklemek
    // ise yaramaz; yayin SIKLIGI bir kalite sinyali degil. Kalan tek olcut:
    // yayindaki makalelerin en az %70'i son 12 ayda yayinlanmis ya da
    // guncellenmis (icerigi bayatlamamis).
    const totalPublished = await this.prisma.article.count({
      where: { siteId, status: 'PUBLISHED' as any },
    });

    // RanksUp'tan hic yayin yoksa olculemez (bos kumede oran anlamsiz)
    if (totalPublished === 0) {
      return unmeasuredPillar('freshness', 'Tazelik', 2, NO_RANKSUP_ARTICLES_REASON);
    }

    // Guncelleme = yazinin sitedeki metnine son ICERIK yazimi: yayin kayitlarinin
    // updatedAt'i (republish-policy lastLiveWriteAt: yerinde guncelleme, ayni
    // yolun uzerine yazma, musterinin "guncelledim" bildirimi); kayit
    // tasimiyorsa ilk yayin tarihi. Icerik pivotunun bekleme suresiyle ayni kural.
    // NEDEN Article.updatedAt DEGIL: satirin her yazimi onu ilerletir (Prisma
    // @updatedAt); canlilik denetiminin defter yazimlari (liveSeenAt, goneSince),
    // iyimser kilitler ve isaretler de. Gunluk canlilik denetimi her canli
    // kopyaya liveSeenAt yazar: aylardir dokunulmamis yazi taze gorunurdu.
    // Pencere icinde ilk kez yayinlanan yazi zaten taze (sayimla); daha eskiler
    // icin son yazim publishedTo JSON'unda oldugundan 500'luk parcalarla okunur.
    const since = new Date(Date.now() - FRESHNESS_WINDOW_DAYS * 86400000);
    let fresh = await this.prisma.article.count({
      where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: since } },
    });
    for (let cursor: string | undefined; ;) {
      const batch = await this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { lte: since } },
        select: { id: true, publishedAt: true, publishedTo: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const a of batch) {
        // Sinirdaki (tam since anindaki) yazi sayimda zaten sayildi
        if (a.publishedAt && a.publishedAt.getTime() >= since.getTime()) continue;
        const lastWrite = lastLiveWriteAt(a.publishedTo);
        if (lastWrite && lastWrite.getTime() >= since.getTime()) fresh++;
      }
      if (batch.length < 500) break;
      cursor = batch[batch.length - 1].id;
    }

    const yuzde = Math.round((fresh / totalPublished) * 100);
    const checks: GeoPillar['checks'] = [{
      id: 'updated-12m', name: 'Son 12 ayda yayınlanan / güncellenen',
      ok: fresh / totalPublished >= FRESHNESS_MIN_SHARE,
      detail: `${fresh}/${totalPublished} makale (%${yuzde}) son 12 ayda yayınlandı ya da güncellendi (önerilen: en az %${Math.round(FRESHNESS_MIN_SHARE * 100)})`,
    }];

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'freshness', name: 'Tazelik', weight: 2,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 6: Multi-Modal
  // ────────────────────────────────────────────────────────────
  private async checkMultiModal(siteId: string): Promise<GeoPillar> {
    const checks: GeoPillar['checks'] = [];

    // 'tts-audio' ve 'podcast-rss' kontrolleri kaldirildi: TTS ses uretimi ve
    // podcast RSS akisi urunden cikarildi (commit 0db5a1c, media-generator).
    // Hicbir yeni makale ses almaz; "3+ olunca podcast feed aktif" ise artik
    // var olmayan bir ozelligi vaat ediyordu.
    const articles: any[] = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      select: { frontmatter: true, heroImageUrl: true } as any,
      take: 50,
    });

    if (articles.length === 0) {
      return unmeasuredPillar('multi-modal', 'Multi-Modal', 1, NO_RANKSUP_ARTICLES_REASON);
    }

    // Image coverage — GERCEK hero sayilir. Eskiden frontmatter.hero_image
    // bakiliyordu; yazar sablonu oraya her makalede "placeholder-hero.webp"
    // yazdigi icin yer tutucu da "hero var" sayiliyordu (sisik olcum).
    // Yayinda uretilen hero heroImageUrl kolonuna yazilir.
    const realHero = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !isHeroPlaceholder(v);
    const withHero = articles.filter((a) => realHero(a.heroImageUrl) || realHero(a.frontmatter?.hero_image)).length;
    checks.push({
      id: 'hero-image', name: 'Hero görsel',
      ok: withHero / articles.length >= 0.7,
      detail: `${withHero}/${articles.length} makalede hero görsel`,
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'multi-modal', name: 'Multi-Modal', weight: 1,
      score, status: this.scoreStatus(score), checks,
    };
  }

  /**
   * Son v3+ Agent Readiness taramasi (Organization sameAs ve varlik kaniti).
   * Kart okumasi tarama tablosu yuzunden dusmesin: hata = kanit yok.
   */
  private latestOrgScan(siteId: string): Promise<{ ranAt: Date; levels: unknown } | null> {
    return Promise.resolve()
      .then(() => this.prisma.agentReadinessScan.findFirst({
        where: { siteId, scoreVersion: { gte: ORG_SAMEAS_MIN_SCAN_VERSION } },
        orderBy: { ranAt: 'desc' },
        select: { ranAt: true, levels: true },
      }))
      .then((r: any) => r ?? null)
      .catch(() => null);
  }

  // ────────────────────────────────────────────────────────────
  private scoreStatus(score: number): 'great' | 'good' | 'warning' | 'critical' {
    if (score >= 80) return 'great';
    if (score >= 60) return 'good';
    if (score >= 40) return 'warning';
    return 'critical';
  }

  private providerLabel(p: string): string {
    // web lib/chart-colors.ts PROVIDER_LABELS ile ayni adlar
    const labels: Record<string, string> = {
      anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT', perplexity: 'Perplexity',
      xai: 'Grok (xAI)', deepseek: 'DeepSeek', meta: 'Meta AI',
    };
    return labels[p] ?? p;
  }
}
