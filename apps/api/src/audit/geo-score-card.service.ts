import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isHeroPlaceholder } from '../articles/hero-placeholder.js';
import { lastLiveWriteAt } from '../articles/republish-policy.js';
import { isUnverifiedCheck } from './audit-checks.service.js';
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

/** AgentReadinessScan.levels JSON'unda 'org-schema' kontrolu (bicim bozuksa null) */
function orgSchemaCheckOf(levels: unknown): {
  ok?: unknown; statusText?: string; state?: string; blocked?: { reason?: string } | null;
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

export interface GeoScoreCard {
  overallScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  pillars: GeoPillar[];
  recommendations: string[];
  generatedAt: string;
}

export interface GeoPillar {
  id: string;
  name: string;
  weight: number;       // 1-3
  score: number;        // 0-100
  status: 'great' | 'good' | 'warning' | 'critical';
  /**
   * unverified: denetim dosyayi OKUYAMADI (engel / sunucu hatasi) ya da sinyal
   * henuz OLCULMEDI (Otorite: sameAs taranmadi) — "yok" degil, olculemedi.
   * ok=false kalir; otomatik duzeltme onerilmez. Crawler sutununda puana
   * girer (okuma engeli bir erisim sorunudur); Otorite sutununda girmez.
   */
  checks: Array<{ id: string; name: string; ok: boolean; detail: string; unverified?: boolean }>;
}

/**
 * GEO Score Card — sitenin "AI search engine'lerde gorunurluk seviyesi"ni
 * 6 pillar uzerinden olcer. Her birinin agirlikli ortalamasi overall skor.
 *
 *  1. Crawler Erisimi (robots.txt + llms.txt + llms-full.txt + sitemap.xml)
 *  2. Yapısal Veri (schema markup tipleri ve kapsami)
 *  3. AI Citation (olculen tum AI asistanlarinin son 7 gun skorlari)
 *  4. Otorite (ana sayfa Organization sameAs — Agent Readiness taramasindan —, rakip listesi, GSC baglantisi)
 *  5. Tazelik (yayin sikligi, son guncellenme, content pivot durumu)
 *  6. Multi-Modal (hero gorsel kapsami)
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
    const totalWeight = pillars.reduce((a, p) => a + p.weight, 0);
    const overall = Math.round(
      pillars.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight,
    );

    const grade = overall >= 90 ? 'A+' : overall >= 80 ? 'A' : overall >= 70 ? 'B' : overall >= 60 ? 'C' : overall >= 50 ? 'D' : 'F';

    // Recommendations — en zayif pillar'lardan
    const recommendations: string[] = [];
    for (const p of pillars.sort((a, b) => a.score - b.score).slice(0, 3)) {
      const failed = p.checks.filter((c) => !c.ok);
      for (const c of failed.slice(0, 2)) {
        recommendations.push(`[${p.name}] ${c.name}: ${c.detail}`);
      }
    }

    return {
      overallScore: overall,
      grade,
      pillars,
      recommendations,
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

    checks.push(staleByAccess('robots', 'robots.txt', 'robots.txt') ?? unverified('robots', 'robots.txt', ck.robots_txt, 'robots.txt') ?? {
      id: 'robots', name: 'robots.txt',
      ok: ck.robots_txt?.found === true && ck.robots_txt?.score >= 70,
      detail: ck.robots_txt?.found ? `Skor: ${ck.robots_txt?.score}/100` : noAudit ?? 'robots.txt yok — auto-fix uygula',
    });
    checks.push(staleByAccess('llms', 'llms.txt', 'llms.txt') ?? unverified('llms', 'llms.txt', ck.llms_txt, 'llms.txt') ?? {
      id: 'llms', name: 'llms.txt',
      ok: ck.llms_txt?.found === true,
      detail: ck.llms_txt?.found ? 'Mevcut (opsiyonel hijyen)' : noAudit ?? 'llms.txt yok — opsiyonel: hiçbir büyük AI sağlayıcısı taahhüt etmiyor, Google kullanmıyor; düşük maliyetli ama kanıtı zayıf bir adım.',
    });

    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    // Haftalik yeniden olusturma: worker LLMS_FULL_BUILD cron'u (Pazartesi 03:00 UTC)
    // ve llms-full-builder getCached (7 gunden eski kopyayi yeniler)
    const llmsFullAt = site.llmsFullTxtAt ? isoDay(site.llmsFullTxtAt) : null;
    checks.push({
      id: 'llms-full', name: 'llms-full.txt',
      ok: !!site.llmsFullTxt,
      detail: site.llmsFullTxt
        ? `Oluşturuldu${llmsFullAt ? ` (${llmsFullAt})` : ''}; her hafta otomatik yenilenir`
        : 'Henüz oluşturulmadı',
    });
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
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      select: { id: true, schemaMarkup: true } as any,
      take: 50,
    });
    const checks: GeoPillar['checks'] = [];

    const withSchema = articles.filter((a: any) => a.schemaMarkup);
    const totalArticles = articles.length;

    checks.push({
      id: 'schema-coverage', name: 'Schema kapsama',
      ok: totalArticles > 0 && withSchema.length / totalArticles >= 0.8,
      detail: `${withSchema.length}/${totalArticles} makale schema'lı`,
    });

    // Schema types diversity
    const allTypes = new Set<string>();
    for (const a of withSchema as any[]) {
      for (const t of (a.schemaMarkup?.types ?? [])) allTypes.add(t);
    }
    checks.push({
      id: 'schema-diversity', name: 'Schema tip çeşitliliği',
      ok: allTypes.size >= 5,
      detail: `${allTypes.size} farklı schema tipi (${[...allTypes].slice(0, 6).join(', ')})`,
    });

    // Eski metin "Siri/Alexa optimize değil" diyordu. Google'a gore speakable
    // beta bir ozellik ve yalniz Google Asistan kullanir: ABD'de, Ingilizce'ye
    // ayarli Google Home cihazlarinda, guncel haber sorularina cevapta
    // ("works for users in the U.S. that have Google Home devices set to
    // English" — https://developers.google.com/search/docs/appearance/structured-data/speakable,
    // 18.10.2026'da dogrulandi). Siri ya da Alexa'nin okudugu belgelenmis degil.
    checks.push({
      id: 'speakable', name: 'Speakable (Google Asistan)',
      ok: [...allTypes].includes('Speakable'),
      detail: [...allTypes].includes('Speakable')
        ? 'Aktif'
        : 'Yok — Speakable, Google Asistan\'ın beta özelliğidir; yalnız ABD\'de İngilizce haber içeriği için kullanılır',
    });

    checks.push({
      id: 'faq-page', name: 'FAQPage',
      ok: [...allTypes].includes('FAQPage'),
      detail: [...allTypes].includes('FAQPage') ? 'Aktif' : 'FAQ schema eksik',
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'structured-data', name: 'Yapısal Veri', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 3: AI Citation
  // ────────────────────────────────────────────────────────────
  private async checkAiCitation(siteId: string): Promise<GeoPillar> {
    const last7 = new Date(Date.now() - 7 * 86400000);
    const recent = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: last7 } },
      // probes JSON'u (excerpt + alintilanan kaynaklar) burada kullanilmiyor
      select: { provider: true, available: true, score: true },
    });

    const checks: GeoPillar['checks'] = [];
    // Eskiden yalniz 4 saglayici (Claude/Gemini/ChatGPT/Perplexity) puanlaniyordu;
    // olculen 6 asistanin ikisi (Grok, DeepSeek) skora hic girmiyordu.
    const providers = [...new Set([...OLCULEN_ASISTANLAR, ...recent.map((r) => r.provider)])];

    for (const p of providers) {
      const pSnapshots = recent.filter((r) => r.provider === p && r.available);
      // Bu asistandan son 7 gunde olcum ALINAMADIYSA (anahtar/kota/servis
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
        detail: `Son 7 gün ortalaması: ${avg.toFixed(0)}/100`,
      });
    }

    if (checks.length === 0) {
      // Hic olcum yok: puan 0 kalir (sutun agirligi degismez) ama neden acik
      checks.push({
        id: 'cite-none', name: 'AI ölçümü',
        ok: false,
        detail: 'Son 7 günde hiçbir AI asistanından ölçüm alınmadı.',
      });
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
      // Kart okumasi tarama tablosu yuzunden dusmesin: hata = kanit yok
      Promise.resolve()
        .then(() => this.prisma.agentReadinessScan.findFirst({
          where: { siteId, scoreVersion: { gte: ORG_SAMEAS_MIN_SCAN_VERSION } },
          orderBy: { ranAt: 'desc' },
          select: { ranAt: true, levels: true },
        }))
        .catch(() => null),
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
    const last30 = new Date(Date.now() - 30 * 86400000);
    const last7 = new Date(Date.now() - 7 * 86400000);

    const [recentArticles, lastWeek] = await Promise.all([
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: last30 } },
      }),
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: last7 } },
      }),
    ]);

    const checks: GeoPillar['checks'] = [];
    checks.push({
      id: 'recent-30', name: '30 gün yayın',
      ok: recentArticles >= 4,
      detail: `${recentArticles} makale (önerilen: 4+)`,
    });
    checks.push({
      id: 'recent-7', name: '7 gün yayın',
      ok: lastWeek >= 1,
      detail: `${lastWeek} makale`,
    });

    // Eskimis icerik: yazinin sitedeki metnine son yazim 90 gunden eski mi. Son yazim
    // yayin kayitlarinin updatedAt'i (republish-policy lastLiveWriteAt: yerinde guncelleme,
    // ayni yolun uzerine yazma, musterinin "guncelledim" bildirimi); kayit tasimiyorsa ilk
    // yayin tarihi. Icerik pivotunun bekleme suresiyle ayni kural (content-pivot.service:
    // lastLiveWriteAt ?? publishedAt): kart "content pivot çalıştır" dediginde pivot da ayni
    // yazilari eski sayar.
    // NEDEN Article.updatedAt DEGIL: satirin her yazimi onu ilerletir (Prisma @updatedAt);
    // canlilik denetiminin defter yazimlari (liveSeenAt, goneSince), iyimser kilitler ve
    // isaretler de. Gunluk canlilik denetimi dagitimdan sonraki ilk turunda her canli dosya
    // kopyasina liveSeenAt yazar: eski kuralla 5 aydir dokunulmamis yazi 90 gun taze
    // gorunur, kart 'Eskimiş içerik yok' derdi.
    // publishedAt <= 90 gun ON SUZGEC: son canli yazim ilk yayindan eski olamaz, ilk yayini
    // daha yeni yazi zaten taze. Son yazim JSON icinde oldugu icin sorguda suzulemiyor.
    // Kart her sayfa acilisinda hesaplanir: buyuk sitede binlerce publishedTo JSON'unu
    // tek seferde bellege almamak icin 500'luk parcalarla okunur; sayim yine tam.
    const last90 = new Date(Date.now() - 90 * 86400000);
    let stale = 0;
    for (let cursor: string | undefined; ;) {
      const batch = await this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { lte: last90 } },
        select: { id: true, publishedAt: true, publishedTo: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const a of batch) {
        const lastWrite = lastLiveWriteAt(a.publishedTo) ?? a.publishedAt;
        if (lastWrite && lastWrite.getTime() <= last90.getTime()) stale++;
      }
      if (batch.length < 500) break;
      cursor = batch[batch.length - 1].id;
    }
    checks.push({
      id: 'stale-content', name: 'Eskimiş içerik',
      ok: stale < 10,
      detail: stale === 0 ? 'Eskimiş içerik yok' : `${stale} makale 90+ gündür güncellenmedi (content pivot çalıştır)`,
    });

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

    // Image coverage — GERCEK hero sayilir. Eskiden frontmatter.hero_image
    // bakiliyordu; yazar sablonu oraya her makalede "placeholder-hero.webp"
    // yazdigi icin yer tutucu da "hero var" sayiliyordu (sisik olcum).
    // Yayinda uretilen hero heroImageUrl kolonuna yazilir.
    const realHero = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !isHeroPlaceholder(v);
    const withHero = articles.filter((a) => realHero(a.heroImageUrl) || realHero(a.frontmatter?.hero_image)).length;
    checks.push({
      id: 'hero-image', name: 'Hero görsel',
      ok: articles.length === 0 ? false : withHero / articles.length >= 0.7,
      detail: articles.length === 0 ? 'Henüz yayınlanmış makale yok' : `${withHero}/${articles.length} makalede hero görsel`,
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'multi-modal', name: 'Multi-Modal', weight: 1,
      score, status: this.scoreStatus(score), checks,
    };
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
