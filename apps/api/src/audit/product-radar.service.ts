import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type Provider } from './ai-citation.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { siteWhereForFeature } from '../billing/plan-site-filter.js';
import { brandMatcher, resolveSiteBrand, type BrandMatcher } from './brand-in-query.js';

/**
 * Product Radar — AI asistanlar kullanicinin KATEGORISINDE hangi urunleri
 * oneriyor? (Maya Product Radar karsiligi.)
 *
 * "best X tools" tarzi kategori sorgularini gercek saglayicilara sorar,
 * cevaptaki oneri listesini cikarir ve markanin listede olup olmadigini,
 * kacinci sirada oldugunu kaydeder. Rakip kesif + kayip tespiti tek ekranda.
 */

const RADAR_PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'perplexity'];
const MAX_QUERIES = 3;

/**
 * Jenerik kategori/tur adi kaliplari — extractor'in "urun" sanmamasi gereken
 * cogul ifadeler (TR+EN). LLM prompt'una ragmen kacarsa son savunma.
 */
const GENERIC_NAME_RE = /(araçlar[ıi]?|çözümler[i]?|yazılımlar[ıi]?|platformlar[ıi]?|sistemler[i]?|uygulamalar[ıi]?|hizmetler[i]?|kaynaklar[ıi]?|siteler[i]?|cms'?ler[i]?|ajanslar[ıi]?|tools?|solutions?|platforms?|systems?|services)$/i;

@Injectable()
export class ProductRadarService {
  private readonly log = new Logger(ProductRadarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly llm: LLMProviderService,
  ) {}

  // ────────────────────────────────────────────────────────────

  /**
   * @param opts.trigger 'user' (VARSAYILAN) — kullanici "Tara"ya basti; uc
   *   @MeasurementSession ile sarili, haftalik olcum hakki istek basina BIR kez
   *   ayrilir ve 3 sorgu ayni hakki paylasir. 'system' — haftalik cron:
   *   platformun kendi otomasyonu, kullanicinin haftalik hakkini ve aylik
   *   citation kotasini tuketmez (snapshotAllActive ile ayni kural). Havuz
   *   harcamasi yine runProvider'daki saglayici basi gunluk butce sinirina tabi.
   */
  async run(
    siteId: string,
    opts: { trigger?: 'user' | 'system' } = {},
  ): Promise<{ snapshots: number; queries: string[] }> {
    const trigger = opts.trigger ?? 'user';
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const queries = await this.buildQueries(site);
    if (queries.length === 0) {
      throw new BadRequestException('Kategori sorgusu uretilemedi — site nis bilgisi (niche) eksik');
    }

    // Kategori etiketi: spesifik olan ONCE. Kaba `niche` listesi (20 secenek)
    // cogu siteyi yanlis kovaya koyuyor (futbol canli skor → "haber/medya").
    const category = (site.customNiche ?? site.niche ?? 'genel').trim();
    // Olcumle (probe.brandMentioned) AYNI marka ve AYNI eslesme kurali. Eskiden
    // ham site.name ile alt-dize karsilastirmasi vardi: "emlak" markasi
    // "Hepsiemlak" urununu, bos adli urun her markayi "biz" sayiyordu.
    const matcher = brandMatcher(resolveSiteBrand(site.name, site.url), this.hostOf(site.url));
    const today = this.utcToday();
    let saved = 0;

    for (const query of queries) {
      // trigger AKTARILMAZSA runQueries 'user' varsayar: cron'da oturum
      // olmadigi icin ilk sorgu sahibin haftalik hakkini yakiyor, ikinci sorgu
      // 429 alip taramayi kesiyordu (3 sorgudan yalniz 1'i kaydediliyordu).
      const results = await this.citation.runQueries(siteId, [query], { providers: RADAR_PROVIDERS, trigger });

      for (const r of results) {
        if (!r.available || r.probes.length === 0) continue;
        const probe = r.probes[0];
        if (probe.excerpt?.startsWith('HATA:')) continue;

        // Cevabin TAMAMI: excerpt yalniz ilk 220 karakter — listenin alt
        // siralarindaki urunler (cogu zaman rakipler) hic gorunmuyordu. Tam
        // metin yalniz bellekte (answerTextOf); kayda yalniz urun listesi gider.
        const answer = this.citation.answerTextOf(probe) ?? probe.excerpt ?? '';
        const products = await this.extractProducts(siteId, answer, matcher);
        // Bos cikti kaydetme — leaderboard'a gurultu, UI'da bos kart olusturuyordu
        if (products.length === 0 && !probe.brandMentioned) continue;
        const brandEntry = products.find((p) => p.isBrand);

        // Ayni gun + provider + query tekrarinda yeni satir atma, guncelle.
        // TAM siteId ile aranir — kirpik id turetmek capraz-tenant carpismasi
        // riskiydi (cuid'in ilk 8 karakteri timestamp onekidir, benzersiz degil).
        const dupe = await this.prisma.productRadarSnapshot.findFirst({
          where: { siteId, date: today, provider: r.provider, query },
          select: { id: true },
        });
        const payload = {
          products: products as any,
          brandListed: !!brandEntry || probe.brandMentioned,
          brandRank: brandEntry?.rank ?? null,
        };
        if (dupe) {
          await this.prisma.productRadarSnapshot.update({ where: { id: dupe.id }, data: payload });
        } else {
          await this.prisma.productRadarSnapshot.create({
            data: { siteId, date: today, provider: r.provider, category, query, ...payload },
          });
        }
        saved++;
      }
    }

    return { snapshots: saved, queries };
  }

  /** Son taramanin ozeti: urun frekans tablosu + marka durumu */
  async latest(siteId: string) {
    const last = await this.prisma.productRadarSnapshot.findFirst({
      where: { siteId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (!last) return { date: null, snapshots: [], leaderboard: [], brand: null };

    const snapshots = await this.prisma.productRadarSnapshot.findMany({
      where: { siteId, date: last.date },
      orderBy: [{ provider: 'asc' }],
    });

    // Leaderboard: urun → kac saglayici/sorguda onerildi, ortalama sira.
    // Anahtar diyakritik-katlanmis: "Haber Turk" ile "Haber Türk" tek satir.
    const tally = new Map<string, { name: string; count: number; rankSum: number; ranked: number; isBrand: boolean; providers: Set<string> }>();
    for (const s of snapshots) {
      const products: any[] = Array.isArray(s.products) ? (s.products as any[]) : [];
      for (const p of products) {
        const key = this.foldName(String(p.name ?? ''));
        if (!key) continue;
        const cur = tally.get(key) ?? { name: p.name, count: 0, rankSum: 0, ranked: 0, isBrand: !!p.isBrand, providers: new Set<string>() };
        cur.count++;
        cur.providers.add(s.provider);
        if (typeof p.rank === 'number') { cur.rankSum += p.rank; cur.ranked++; }
        if (p.isBrand) cur.isBrand = true;
        tally.set(key, cur);
      }
    }
    const leaderboard = Array.from(tally.values())
      .map((t) => ({
        name: t.name,
        appearances: t.count,
        providers: Array.from(t.providers),
        avgRank: t.ranked > 0 ? Math.round((t.rankSum / t.ranked) * 10) / 10 : null,
        isBrand: t.isBrand,
      }))
      .sort((a, b) => b.appearances - a.appearances || (a.avgRank ?? 99) - (b.avgRank ?? 99))
      .slice(0, 25);

    const brandRow = leaderboard.find((l) => l.isBrand) ?? null;

    return {
      date: last.date.toISOString().slice(0, 10),
      snapshots: snapshots.map((s) => ({
        provider: s.provider,
        query: s.query,
        products: s.products,
        brandListed: s.brandListed,
        brandRank: s.brandRank,
      })),
      leaderboard,
      brand: brandRow,
    };
  }

  /** Haftalik otomatik tarama — Sali 05:30 UTC (citation cron'lariyla cakismasin) */
  @Cron('30 5 * * 2')
  async weeklyRunAll() {
    // API + worker ayni cron'u tetikler — atomik kilit tek proses calistirir
    // (LLM cagrili en pahali cron'lardan; cift calisma cift maliyet olurdu)
    if (!(await acquireCronLock(this.prisma, 'product-radar', 'weekly'))) return;
    const sites = await this.prisma.site.findMany({
      where: {
        status: 'ACTIVE' as any,
        OR: [{ niche: { not: null } }, { customNiche: { not: null } }],
        // Fiyat kartinda Ajans'a ait — cron da plani dayatmali, aksi halde
        // alt plan musterisi veriyi hazir bulur ve kilit anlamsizlasir.
        ...siteWhereForFeature('productRadar'),
      },
      select: { id: true },
      take: 100,
    });
    this.log.log(`Haftalik Product Radar: ${sites.length} site`);
    for (const s of sites) {
      try {
        // Sistem kosumu: musterinin haftalik olcum hakki ve citation kotasi dusmez
        await this.run(s.id, { trigger: 'system' });
      } catch (err: any) {
        this.log.warn(`Product radar fail (${s.id}): ${err.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────

  /**
   * Kategori sorgularini LLM ile uret — sablon sorgu ("X araclari")
   * belirsizdi: haber sitesi icin hem haber MARKALARINI hem medya
   * ARACLARINI (MailChimp, Hootsuite) getiriyordu. LLM, nis + marka
   * baglaminda "bu markanin RAKIPLERININ onerilecegi" sorulari kurar.
   * LLM hatasinda sablona duser.
   */
  private async buildQueries(site: any): Promise<string[]> {
    const niche = (site.niche ?? '').trim();
    const customNiche = (site.customNiche ?? '').trim();
    // Brain rakipleri sitenin GERCEK kategorisinin en guclu kaniti: brain
    // siteyi crawl edip anliyor, `niche` ise 20 secenekli kaba liste.
    const competitors: string[] = Array.isArray(site.brain?.competitors)
      ? site.brain.competitors.map((c: any) => c?.name).filter(Boolean).slice(0, 6)
      : [];
    if (!niche && !customNiche && competitors.length === 0) return [];
    const tr = site.language !== 'en';

    try {
      const pillars: string[] = Array.isArray(site.brain?.seoStrategy?.pillars)
        ? site.brain.seoStrategy.pillars.map((p: any) => p?.name ?? p?.pillar).filter(Boolean).slice(0, 5)
        : [];
      const res = await this.llm.chat({
        context: 'product-radar-queries',
        siteId: site.id,
        model: 'claude-opus-5',
        maxTokens: 400,
        systemPrompt: [
          'Bir markanin AI asistanlarda (ChatGPT/Gemini) rakipleriyle birlikte ONERILIP onerilmedigini olcmek istiyoruz.',
          'Gorevin: siradan bir kullanicinin sorup cevabinda BU MARKANIN VE DOGRUDAN RAKIPLERININ listelenecegi 3 soru uretmek.',
          'ONCELIK SIRASI: (1) Bilinen rakipler — kategoriyi en iyi onlar tarif eder, (2) spesifik kategori, (3) genel nis etiketi.',
          'Genel nis etiketi ("haber/medya" gibi) YANILTICI olabilir; rakipler listesi onunla celisirse RAKIPLERE GUVEN.',
          '(Ornek: rakipler Flashscore/Mackolik ise soru "en iyi canli skor siteleri" olmali, "haber siteleri" DEGIL.)',
          'KRITIK: soru, markanin kendi kategorisindeki SAGLAYICILARI listeletmeli — o kategoriye hizmet eden yan araclari/yazilimlari DEGIL.',
          `Dil: ${tr ? 'Turkce' : 'Ingilizce'}. Marka adini sorularda GECIRME.`,
          'YANIT: yalnizca JSON dizi of string, 3 soru.',
        ].join('\n'),
        messages: [{
          role: 'user',
          content: [
            `Marka: ${site.name} (${site.url})`,
            competitors.length ? `Bilinen rakipler (EN GUCLU SINYAL): ${competitors.join(', ')}` : null,
            customNiche ? `Spesifik kategori: ${customNiche}` : null,
            niche ? `Genel nis etiketi: ${niche}` : null,
            pillars.length ? `Icerik pillar'lari: ${pillars.join(', ')}` : null,
          ].filter(Boolean).join('\n'),
        }],
      });
      const parsed = parseJsonFromLlm<any>(res.output);
      const queries = Array.isArray(parsed)
        ? parsed.filter((q) => typeof q === 'string' && q.trim().length >= 10).slice(0, MAX_QUERIES)
        : [];
      if (queries.length > 0) return queries;
    } catch (err: any) {
      this.log.warn(`Radar sorgu uretimi LLM hatasi (sablona dusuluyor): ${err.message}`);
    }

    // Fallback sablonlar — spesifik kategori varsa onu kullan (kaba nis degil),
    // "araclari" yerine "saglayici/marka" vurgusu
    const label = customNiche || niche;
    if (!label) return [];
    return (tr
      ? [
          `en iyi ${label} markaları/siteleri hangileri?`,
          `${label} için hangisini önerirsin, en güvenilir kaynaklar kimler?`,
          `${label} alanında en popüler isimler`,
        ]
      : [
          `what are the best ${label} brands/sites?`,
          `which ${label} provider would you recommend?`,
          `most popular names in ${label}`,
        ]).slice(0, MAX_QUERIES);
  }

  /**
   * AI cevabindan oneri listesi cikar — ucuz LLM parse, hatada bos liste.
   * `answer` cevabin tam metni (8000 karaktere kadar gonderilir).
   */
  private async extractProducts(siteId: string, answer: string, matcher: BrandMatcher): Promise<Array<{
    name: string;
    rank: number;
    isBrand: boolean;
  }>> {
    if (!answer || answer.length < 40) return [];
    try {
      const res = await this.llm.chat({
        context: 'product-radar-extract',
        siteId,
        model: 'claude-opus-5',
        maxTokens: 800,
        systemPrompt: [
          'Sana bir AI asistan cevabi verilecek. Cevapta ONERILEN somut marka/urun/servis OZEL ADLARINI sirasiyla cikar.',
          'YANIT: yalnizca JSON dizi: [{"name":"Urun Adi","rank":1}] — rank cevaptaki gecis sirasi (1 = ilk).',
          'En fazla 15 madde. SADECE ozel isimler (NTV, Hurriyet, MailChimp gibi).',
          'ALMA: kavramlar ("SEO"), KATEGORI/TUR adlari ("Haber Sitesi CMS\'leri", "Sosyal Medya Yonetim Araclari", "Medya Takip Araclari" gibi cogul jenerik ifadeler).',
          'Cevapta hic somut marka yoksa [] dondur.',
        ].join('\n'),
        messages: [{ role: 'user', content: answer.slice(0, 8000) }],
      });
      const parsed = parseJsonFromLlm<any>(res.output);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        // Jenerik kategori adlari LLM'den kacarsa son savunma (ör. "... Araçları")
        .filter((p) => !GENERIC_NAME_RE.test(p.name.trim()))
        .slice(0, 15)
        .map((p, i) => ({
          name: p.name.trim().slice(0, 120),
          rank: typeof p.rank === 'number' ? p.rank : i + 1,
          isBrand: this.isBrandProduct(p.name, matcher),
        }));
    } catch (err: any) {
      this.log.warn(`Product extract fail: ${err.message}`);
      return [];
    }
  }

  /**
   * Cikarilan urun adi bizim marka mi? Marka urun adinda kelime sinirli gecmeli
   * ("Kobipratik", "Kobipratik.com") ya da adlar bosluksuz esit olmali
   * ("Kobi Pratik"). Ters yon (urun adi markanin icinde: "Kobi") ve bos ad
   * marka SAYILMAZ. Jenerik + alan adindan turetilmis markada yalniz alan adi.
   */
  isBrandProduct(name: string, matcher: BrandMatcher): boolean {
    if (matcher.inText(name)) return true;
    if (matcher.mode === 'domain') return false;
    const compact = (s: string) => this.foldName(s).replace(/ /g, '');
    const n = compact(name);
    return n.length >= 4 && n === compact(matcher.brand);
  }

  private hostOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return ''; }
  }

  /**
   * Karsilastirma icin isim katlama: kucuk harf + diyakritik/aksan temizligi
   * + noktalamasiz. TR ozel: 'ı'→'i'. "Haber Türk" ve "Haber Turk" ayni anahtara duser.
   */
  private foldName(s: string): string {
    return s
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private utcToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}
