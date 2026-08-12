import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type CitationProbe } from './ai-citation.service.js';
import { NicheDetectorService } from '../sites/niche-detector.service.js';
import type { Audience } from '../llm/model-tier.js';

/**
 * Public AI Citation Check — landing page demo (anonim).
 *
 * Maya-clone pattern:
 *   1. Ziyaretci domain girer (kobipratik.com)
 *   2. HTML fetch + brand + niche tespit
 *   3. Niche'e gore 3 deterministic prompt uretilir
 *   4. 6 LLM provider'a paralel sor (ENV anahtarlari)
 *   5. Per-prompt: hangi motorlar cite/mention etti (✓/✗ ikonu)
 *   6. Aggregate: share of voice (rakip ranking)
 *
 * Abuse kontrolu:
 *   - Sonuc 24h cache (PublicCitationCheck.domain unique)
 *   - IP rate-limit (PublicCitationService.checkRateLimit) → her IP gunde 3 farkli domain
 *   - Cloudflare Turnstile (controller'da, env-gated)
 *   - Bot UA bloklanir (controller)
 */

const TURKISH_NICHE_PROMPTS: Record<string, string[]> = {
  'e-ticaret': [
    'Turkiye\'de {NICHE} icin en iyi e-ticaret platformlari hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi e-ticaret cozumleri var?',
    'KOBI\'ler icin {NICHE} alaninda en iyi yerli e-ticaret platformlari nelerdir?',
  ],
  'SaaS': [
    'Turkiye\'de {NICHE} ihtiyaclari icin en iyi SaaS cozumleri hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi SaaS\'lar onerilir?',
    '{NICHE} otomasyonu icin en iyi yerli SaaS platformlari nelerdir?',
  ],
  'web hosting': [
    'Turkiye\'de en iyi web hosting saglayicilari hangileri?',
    'KOBI\'ler icin hangi hosting firmalari one cikiyor?',
    'WordPress + cPanel icin en uygun fiyatli yerli hosting firmalari nelerdir?',
  ],
  'finans': [
    'Turkiye\'de {NICHE} icin en guvenilir finansal platformlar hangileri?',
    'KOBI kredisi + POS hizmeti icin hangi bankalar/firmalar one cikiyor?',
    '{NICHE} alaninda dijital cozum sunan en iyi firmalar nelerdir?',
  ],
  'eğitim': [
    'Turkiye\'de online {NICHE} icin en iyi platformlar hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi egitim platformlari onerilir?',
    'Sertifikali {NICHE} egitimi sunan en iyi yerli kurumlar nelerdir?',
  ],
  'sağlık': [
    'Turkiye\'de {NICHE} alaninda en guvenilir saglik platformlari hangileri?',
    'Online {NICHE} hizmeti veren en iyi firmalar nelerdir?',
    '{NICHE} icin onerilebilecek dijital saglik cozumleri nelerdir?',
  ],
  'gayrimenkul': [
    'Turkiye\'de en iyi gayrimenkul ilan siteleri hangileri?',
    '{NICHE} alaninda hangi platformlar dijital donusumde one cikiyor?',
    'Konut + ticari gayrimenkul aramada en iyi yerli platformlar nelerdir?',
  ],
  'turizm': [
    'Turkiye\'de {NICHE} icin en iyi online seyahat platformlari hangileri?',
    'Otel rezervasyonu + tur paketleri icin hangi firmalar one cikiyor?',
    '{NICHE} alaninda hangi yerli platformlar uluslararasi seviyede?',
  ],
  'restoran': [
    'Turkiye\'de {NICHE} icin en populer online siparis platformlari hangileri?',
    'Restoran yonetim sistemi (POS + rezervasyon) icin en iyi cozumler nelerdir?',
    '{NICHE} sektorunde dijital donusum saglayan platformlar hangileri?',
  ],
  'ajans': [
    'Turkiye\'de en iyi dijital pazarlama ajanslari hangileri?',
    '{NICHE} alaninda hangi ajanslar one cikiyor?',
    'KOBI\'ler icin uygun fiyatli ajans hizmetleri veren firmalar nelerdir?',
  ],
  'haber/medya': [
    'Turkiye\'de en cok okunan {NICHE} kaynaklari hangileri?',
    '{NICHE} alaninda en guvenilir haber siteleri nelerdir?',
    'Bagimsiz {NICHE} yayini yapan platformlar hangileri?',
  ],
  'teknoloji/yazılım': [
    'Turkiye\'de {NICHE} icin en iyi yazilim cozumleri hangileri?',
    '{BRAND_HINT} alternatifi olarak hangi yerli yazilim firmalari onerilir?',
    '{NICHE} alaninda one cikan Turk teknoloji firmalari nelerdir?',
  ],
  'hukuk': [
    'Turkiye\'de online hukuki danismanlik icin en iyi platformlar hangileri?',
    '{NICHE} alaninda dijital cozum sunan hukuk firmalari nelerdir?',
    'Avukat-muvekkil eslesmesi icin en guvenilir platformlar hangileri?',
  ],
  'danışmanlık': [
    'Turkiye\'de {NICHE} alaninda en iyi danismanlik firmalari hangileri?',
    'KOBI\'ler icin uygun fiyatli {NICHE} danismanlik hizmetleri veren firmalar nelerdir?',
    '{NICHE} dijital donusumu icin one cikan danismanlik markalari hangileri?',
  ],
  'otomotiv': [
    'Turkiye\'de {NICHE} alaninda en iyi online platformlar hangileri?',
    'Ikinci el arac alim-satim icin en guvenilir siteler nelerdir?',
    '{NICHE} sektorunde dijital cozum sunan firmalar hangileri?',
  ],
  'inşaat': [
    'Turkiye\'de {NICHE} alaninda one cikan firmalar hangileri?',
    'Yapi malzemesi + insaat hizmetleri icin en iyi platformlar nelerdir?',
    '{NICHE} sektorunde dijitallesen markalar hangileri?',
  ],
  'spor/fitness': [
    'Turkiye\'de online {NICHE} egitimi/uyelik icin en iyi platformlar hangileri?',
    'Spor salonu zincirleri icinde en cok tercih edilenler nelerdir?',
    'Ev tipi {NICHE} ekipmani satan en iyi firmalar hangileri?',
  ],
  'moda/giyim': [
    'Turkiye\'de {NICHE} alaninda en populer online magazalar hangileri?',
    'Kadin/erkek {NICHE} icin en cok tercih edilen yerli markalar nelerdir?',
    '{NICHE} kategorisinde dijital donusumde one cikan firmalar hangileri?',
  ],
  'üretim/sanayi': [
    'Turkiye\'de {NICHE} alaninda en iyi B2B platformlar hangileri?',
    'Uretici-tedarikci eslesme platformlari icinde en bilinenler nelerdir?',
    '{NICHE} dijital donusumu icin one cikan yerli cozumler hangileri?',
  ],
  'diğer': [
    '{BRAND_HINT} ne yapiyor? Kisaca aciklar misin?',
    'Turkiye\'de {NICHE} alaninda one cikan firmalar/platformlar hangileri?',
    '{NICHE} ihtiyaci olan KOBI\'lere hangi cozumleri onerirsin?',
  ],
};

export interface PublicCheckResult {
  domain: string;
  brand: string;
  niche: string;
  customNiche?: string;
  queries: Array<{
    query: string;
    providers: Array<{
      provider: string;
      label: string;
      cited: boolean;          // host URL geçti
      brandMentioned: boolean; // brand adı geçti
      excerpt?: string;
    }>;
    citedCount: number;     // kac motor cite etti
    totalProviders: number; // kac motor sorgulandi (= 5-6)
  }>;
  competitorRanking: Array<{
    name: string;
    mentions: number;
    pct: number;
    isBrand?: boolean;
  }>;
  totalLlmCalls: number;
  fromCache: boolean;
  cachedAt?: Date;
}

@Injectable()
export class PublicCitationService {
  private readonly log = new Logger(PublicCitationService.name);
  private readonly CACHE_TTL_HOURS = 24;

  // IP rate limit: IP basina son 24 saatte max N farkli domain
  private readonly IP_DAILY_DOMAIN_LIMIT = parseInt(process.env.PUBLIC_CITATION_IP_DAILY_LIMIT ?? '3', 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiCitationService,
    private readonly niche: NicheDetectorService,
  ) {}

  /**
   * IP basina rate-limit kontrol — son 24h icinde ayni IP'den kac farkli domain
   * istek geldi say. PublicCitationCheck.ip alanindan turetilir.
   */
  async checkRateLimit(ip: string): Promise<{ ok: boolean; remaining: number; resetIn?: string }> {
    if (!ip) return { ok: false, remaining: 0, resetIn: 'IP yok' };
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const distinctDomains = await this.prisma.publicCitationCheck.findMany({
      where: { ip, createdAt: { gte: cutoff } },
      select: { domain: true },
      distinct: ['domain'],
    });
    const used = distinctDomains.length;
    const remaining = Math.max(0, this.IP_DAILY_DOMAIN_LIMIT - used);
    return {
      ok: remaining > 0,
      remaining,
      resetIn: remaining === 0 ? '24 saat icinde sifirlanir' : undefined,
    };
  }

  /** Domain'i normalize et — protocol yoksa https ekle, www. striple */
  private normalizeDomain(input: string): { url: string; host: string } {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) throw new BadRequestException('Domain girilmedi');
    // En basit form: protokol yoksa https ekle
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let host = '';
    try {
      const u = new URL(withProto);
      host = u.hostname.replace(/^www\./, '');
    } catch {
      throw new BadRequestException('Gecersiz domain');
    }
    if (!host || !host.includes('.')) throw new BadRequestException('Gecersiz domain (TLD eksik)');
    if (host.length > 200) throw new BadRequestException('Domain cok uzun');
    return { url: withProto, host };
  }

  /** HTML fetch + brand extract (NicheDetector pattern). */
  private async extractBrandFromHtml(url: string, host: string): Promise<{ brand: string; title: string; description: string }> {
    let html = '';
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'RanksUp-PublicCitation/1.0 (+https://ranksup.ai)' },
      });
      clearTimeout(t);
      if (res.ok) {
        html = (await res.text()).slice(0, 100_000);
      }
    } catch (err: any) {
      this.log.warn(`Public HTML fetch fail (${url}): ${err.message}`);
    }

    const title = (html.match(/<title[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    const description = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1]
      ?? '').trim().slice(0, 300);
    const ogSiteName = (html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();
    const ogTitle = (html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();
    const appName = (html.match(/<meta\s+name=["']application-name["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim();

    // Hostname-based brand candidate (kobipratik.com -> "kobipratik")
    const hostRoot = (() => {
      const parts = host.split('.');
      if (parts.length === 0) return host;
      // 2-level TLD case (com.tr): "x.com.tr" -> "x"; otherwise "a.b.c" -> "b"
      if (parts.length >= 3 && /^(com|net|org|gov|edu)$/.test(parts[parts.length - 2])) {
        return parts[parts.length - 3];
      }
      return parts.length >= 2 ? parts[parts.length - 2] : host;
    })();
    const hostBrandPretty = hostRoot.charAt(0).toUpperCase() + hostRoot.slice(1);

    // Brand priority:
    //   1. og:site_name (the most authoritative)
    //   2. application-name
    //   3. title segment containing hostRoot (kesin marka match)
    //   4. hostname root (capitalised) — pazarlama basliklari brand degildir; site og:site_name koymadiysa
    //      title'in en kisa segmentini almak yerine hostname'i kullan (cunku "KOBI Nakit Ihtiyaci" gibi
    //      bir CTA brand olmaz)
    let brand = '';
    if (ogSiteName && ogSiteName.length >= 3 && ogSiteName.length <= 80) brand = ogSiteName;
    else if (appName && appName.length >= 3 && appName.length <= 80) brand = appName;
    else {
      const candidate = ogTitle || title;
      const segments = candidate.split(/\s*[|–—\-·:»]\s*/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60);
      const hostMatch = segments.find((s) => s.toLowerCase().includes(hostRoot.toLowerCase()));
      if (hostMatch) brand = hostMatch;
    }
    if (!brand || brand.length < 3) brand = hostBrandPretty;

    return { brand: brand.slice(0, 80), title, description };
  }

  /** Niche'e gore 3 deterministic prompt uret. */
  private buildQueries(niche: string, customNiche: string | undefined, brand: string): string[] {
    const template = TURKISH_NICHE_PROMPTS[niche] ?? TURKISH_NICHE_PROMPTS['diğer'];
    const nicheLabel = customNiche || niche;
    return template.map((t) =>
      t.replace(/\{NICHE\}/g, nicheLabel).replace(/\{BRAND_HINT\}/g, brand)
    );
  }

  /** Main entry — controller'in cagirdigi fonksiyon. */
  /**
   * Kesfedilen share-of-voice listesini IS MODELI FILTRESINDEN gecirir.
   * Marka her zaman korunur; adaylardan yalnizca gercek rakipler tutulur;
   * yuzdeler kalan set uzerinden yeniden hesaplanir.
   */
  private async filterCompetitors(
    shareOfVoice: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>,
    ctx: { brand: string; host: string; niche?: string; customNiche?: string; audience: Audience },
  ): Promise<Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>> {
    if (!shareOfVoice.length) return [];

    const brandRow = shareOfVoice.find((s) => s.isBrand);
    const candidates = shareOfVoice.filter((s) => !s.isBrand);
    if (candidates.length === 0) return shareOfVoice;

    const keep = await this.ai.classifyRealCompetitors({
      brand: ctx.brand,
      host: ctx.host,
      niche: ctx.niche,
      customNiche: ctx.customNiche,
      candidates: candidates.map((c) => c.name),
      audience: ctx.audience,
    });

    const realComps = candidates.filter((c) => keep.has(c.name.toLowerCase().replace(/^www\./, '')));

    // Yuzdeleri yeniden hesapla: marka + gercek rakip mention'lari toplamiuzerinden
    const total = (brandRow?.mentions ?? 0) + realComps.reduce((a, c) => a + c.mentions, 0);
    const pct = (m: number) => (total > 0 ? Math.round((m / total) * 100) : 0);

    const out: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }> = [];
    if (brandRow) out.push({ ...brandRow, pct: pct(brandRow.mentions) });
    for (const c of realComps.sort((a, b) => b.mentions - a.mentions)) {
      out.push({ name: c.name, mentions: c.mentions, pct: pct(c.mentions) });
    }
    return out;
  }

  async check(domain: string, ip: string, source: 'manual' | 'retest_cron' | 'signup_baseline' = 'manual'): Promise<PublicCheckResult> {
    const { url, host } = this.normalizeDomain(domain);

    // Model kademesi: landing'den gelen anonim istek ve email abonesinin cron
    // retest'i 'anon' (ucuz model); kayit sonrasi baseline uyeye ait → 'member'.
    // Probe modeli bu ayrimdan ETKILENMEZ (olcum cetveli sabit, bkz. model-tier.ts).
    const audience: Audience = source === 'signup_baseline' ? 'member' : 'anon';

    // 1) Cache kontrol — sadece manual istekte 24h taze snapshot varsa direkt don
    //    (retest_cron + signup_baseline her zaman taze test ister)
    if (source === 'manual') {
      const cutoff = new Date(Date.now() - this.CACHE_TTL_HOURS * 60 * 60 * 1000);
      const cached = await this.prisma.publicCitationCheck.findFirst({
        where: { domain: host, createdAt: { gt: cutoff } },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) {
        const res = cached.result as any;
        return { ...res, fromCache: true, cachedAt: cached.createdAt };
      }
    }

    // 2) Rate limit (cache miss durumunda manuel istekler icin)
    if (source === 'manual') {
      const rl = await this.checkRateLimit(ip);
      if (!rl.ok) {
        throw new BadRequestException(`Gunluk hakkiniz doldu (${this.IP_DAILY_DOMAIN_LIMIT}/24h). ${rl.resetIn ?? ''}`);
      }
    }

    // 3) HTML fetch + brand
    const meta = await this.extractBrandFromHtml(url, host);

    // 4) Niche detect — model kademesi cagiran kitleye gore
    const detection = await this.niche.detectFromUrl(url, audience);

    // 5) Sorular — niche-detector AI gerçek müşteri sorularını ürettiyse onları kullan
    //    (yerel + hizmet-spesifik = alakalı). Üretemediyse niche template'ine düş.
    const aiQueries = (detection.queries ?? [])
      .map((q) => q.trim())
      .filter((q) => q.length >= 8 && q.length <= 160);
    const queries = aiQueries.length >= 3
      ? aiQueries.slice(0, 3)
      : this.buildQueries(detection.niche, detection.customNiche, meta.brand);

    // 6) Probe 7 providers (paralel)
    const providerResults = await this.ai.runPublicProbes({
      brand: meta.brand,
      host,
      queries,
      competitors: [],
    });

    // 7) Per-query aggregate + share-of-voice
    const allProbes: CitationProbe[] = [];
    const perQuery: PublicCheckResult['queries'] = queries.map((q) => {
      const providers = providerResults.map((pr) => {
        const probe = pr.probes.find((p) => p.query === q);
        return {
          provider: pr.provider,
          label: pr.label,
          cited: !!probe?.cited,
          brandMentioned: !!probe?.brandMentioned,
          excerpt: probe?.excerpt,
        };
      });
      const citedCount = providers.filter((p) => p.cited || p.brandMentioned).length;
      return {
        query: q,
        providers,
        citedCount,
        totalProviders: providers.length,
      };
    });
    for (const pr of providerResults) allProbes.push(...pr.probes);
    const agg = this.ai.publicAggregate(allProbes, meta.brand);

    // IS MODELI FILTRESI — bkz. ai-citation.classifyRealCompetitors.
    // Kesfedilen adaylar arasindan SADECE gercek rakipleri (ayni is modeli)
    // tut; saglayicilari/kaynaklari ele. Ornek: kredi karsilastirma platformu
    // icin bankalar saglayicidir, rakip degil. Filtreleme sonrasi yuzdeler
    // kalan set uzerinden yeniden hesaplanir.
    const competitorRanking = await this.filterCompetitors(
      agg.shareOfVoice ?? [],
      { brand: meta.brand, host, niche: detection.niche, customNiche: detection.customNiche, audience },
    );

    const result: PublicCheckResult = {
      domain: host,
      brand: meta.brand,
      niche: detection.niche,
      customNiche: detection.customNiche,
      queries: perQuery,
      competitorRanking,
      totalLlmCalls: providerResults.filter((p) => p.available).length * queries.length,
      fromCache: false,
    };

    // 8) Snapshot yaz — her test ayri row (history korunur)
    const costUsd = providerResults.reduce((a, pr: any) => a + (pr.cost ?? 0), 0);
    try {
      const created = await this.prisma.publicCitationCheck.create({
        data: {
          domain: host,
          brand: meta.brand,
          niche: detection.niche,
          customNiche: detection.customNiche,
          result: result as any,
          totalCalls: result.totalLlmCalls,
          costUsd,
          ip: this.hashIp(ip),
          source,
        },
      });
      (result as any).checkId = created.id;
    } catch (err: any) {
      this.log.warn(`Snapshot write fail for ${host}: ${err.message}`);
    }

    return result;
  }

  /** Domain icin son N snapshot'i don (eskiden yeniye). */
  async getHistory(domain: string, limit = 12): Promise<Array<{
    id: string;
    createdAt: Date;
    source: string;
    totalCitedScore: number;
    queriesCount: number;
    totalProviders: number;
  }>> {
    const { host } = this.normalizeDomain(domain);
    const rows = await this.prisma.publicCitationCheck.findMany({
      where: { domain: host },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, createdAt: true, source: true, result: true },
    });
    return rows.map((r) => {
      const res = r.result as any;
      const totalCited = (res?.queries ?? []).reduce((a: number, q: any) => a + (q.citedCount ?? 0), 0);
      const totalProviders = (res?.queries?.[0]?.totalProviders ?? 0);
      return {
        id: r.id,
        createdAt: r.createdAt,
        source: r.source,
        totalCitedScore: totalCited,
        queriesCount: res?.queries?.length ?? 0,
        totalProviders,
      };
    });
  }

  /** Su anki sonucu ile N gun once arasinda delta uret (email/dashboard'da kullanilir). */
  async compareWithPast(domain: string, daysAgo: number): Promise<{
    current?: { totalCited: number; total: number; createdAt: Date };
    past?: { totalCited: number; total: number; createdAt: Date };
    delta: number;          // +1 = motor sayisi artti
    deltaPct: number;       // delta / past.total * 100
  }> {
    const history = await this.getHistory(domain, 50);
    if (history.length === 0) return { delta: 0, deltaPct: 0 };
    const current = history[0];
    const targetTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    // En yakin onceki snapshot (>= targetTime'dan eski)
    const past = history.slice(1).find((h) => h.createdAt.getTime() <= targetTime) || history[history.length - 1];
    const totalProviders = current.totalProviders || 7;
    const delta = current.totalCitedScore - past.totalCitedScore;
    const deltaPct = past.totalCitedScore > 0 ? Math.round((delta / past.totalCitedScore) * 100) : 0;
    return {
      current: { totalCited: current.totalCitedScore, total: totalProviders, createdAt: current.createdAt },
      past: { totalCited: past.totalCitedScore, total: totalProviders, createdAt: past.createdAt },
      delta,
      deltaPct,
    };
  }

  /** IP'yi audit/rate-limit icin saklarken privacy icin hash'le. */
  private hashIp(ip: string): string {
    if (!ip) return '';
    const salt = process.env.IP_HASH_SALT ?? 'luviai-public-citation';
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
  }
}
