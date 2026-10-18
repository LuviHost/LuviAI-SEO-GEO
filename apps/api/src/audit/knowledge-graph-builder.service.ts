import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { ORG_SAMEAS_MIN_SCAN_VERSION, sameAsCheck } from './geo-score-card.service.js';

export interface WikidataDraft {
  format: 'wikibase-json';
  // Manuel onay sonrasi kullanici Wikidata create-item formuna yapistirir
  labels: { tr: { language: 'tr'; value: string }; en: { language: 'en'; value: string } };
  /**
   * Yalniz Turkce aciklama. 'en' aciklamasi KALDIRILDI: translateBrief()
   * ceviri yapmiyordu, Turkce metni 250 karakterde kesip descriptions.en'e
   * yaziyordu — taslaktaki "Ingilizce aciklama" Turkce metindi. Gercek ceviri
   * bir model cagrisi ister; bu uc model cagirmaz (KNOWLEDGE_DRAFT_THROTTLE).
   * Wikidata'da her dilin aciklamasi ayri ve istege baglidir.
   */
  descriptions: { tr: { language: 'tr'; value: string }; en?: { language: 'en'; value: string } };
  aliases: Array<{ language: string; value: string }>;
  claims: Array<{
    property: string;       // P17, P31, P856 vs.
    propertyLabel: string;  // 'instance of', 'official website'
    value: string;
    valueType: 'string' | 'item' | 'url' | 'monolingualtext';
    note?: string;
  }>;
  sitelinks?: Array<{ site: string; title: string }>;
  /**
   * RanksUp on kontrol puani (0..notabilityMax): yalniz RanksUp'in gorebildigi
   * sinyaller. Wikidata'nin kayda degerlik olcutunu OLCMEZ (checkNotability).
   */
  notabilityScore: number;
  /** Puanin ulasabilecegi en yuksek deger (NOTABILITY_MAX) — panel "35/50" gosterir */
  notabilityMax: number;
  notabilityNotes: string[];
  createUrl: string; // Wikidata yeni item olusturma URL'i
}

export interface WikipediaDraft {
  format: 'wikitext';
  title: string;
  content: string;        // Wikipedia wikitext format
  references: Array<{ title: string; url: string; date?: string }>;
  category: string[];
  notabilityScore: number;
  notabilityMax: number;
  notabilityNotes: string[];
  /** Turkce Vikipedi madde sihirbazi (taslak Turkce wikitext) — WIKIPEDIA_ARTICLE_WIZARD_URL */
  submitUrl: string;
}

/**
 * Turkce Vikipedi "Madde sihirbazi" (yeni madde olusturma rehberi). Eski
 * deger 'Vikipedi:Hızlı_silmeye_aday_göster' idi: adi "hizli silmeye aday
 * goster" (hizli silme ADAYLIGI) anlamina gelen ve trwiki'de VAR OLMAYAN bir
 * sayfa (18.10.2026'da HTTP 404). Sihirbaz sayfasi var; "Devam" adimi
 * Vikipedi:Madde_sihirbazı/Kaynaklandırma ("Bir maddenin konusu, konudan
 * bağımsız olan güvenilir kaynaklarda işlenmiş olmalıdır.") ile ilerler
 * (18.10.2026'da dogrulandi). Taslak Turkce wikitext oldugu icin trwiki.
 */
export const WIKIPEDIA_ARTICLE_WIZARD_URL = 'https://tr.wikipedia.org/wiki/Vikipedi:Madde_sihirbaz%C4%B1';

/**
 * On kontrol puaninin tavani: site 10 + 3+ rakip 15 + SEO stratejisi 10 +
 * kimlik baglantilari (sameAs) 15. Eskiden "site yasi" (aslinda RanksUp'a eklenme
 * tarihi) 20 puan daha veriyordu ve olcek 100'du; o sinyal kaldirildi
 * (checkNotability). Puan 100'e olceklenmez: kalan kisim (bagimsiz
 * kaynaklar) RanksUp'in olcemedigi ve elle dogrulanmasi gereken kisimdir.
 */
export const NOTABILITY_MAX = 50;

/**
 * Knowledge Graph Builder — markanizin Wikidata + Wikipedia taslaklarini hazirlar.
 *
 * Wikidata acik bir bilgi tabanidir; bilgi grafiklerinin kaynaklarindan
 * yalnizca biridir. Wikipedia, egitim karisimini yayimlayan bazi modellerde
 * birkac yuzdelik paydir (GPT-3 %3, LLaMA %4,5 — kaynaklar geo-lab-panel.tsx
 * WikipediaTab yorumunda); eski "%30+" orani kaynaksizdi.
 *
 * Gonderim kullaniciya birakilir (RanksUp kimseye adina gondermez —
 * knowledge-submitter.service.ts).
 */
@Injectable()
export class KnowledgeGraphBuilderService {
  private readonly log = new Logger(KnowledgeGraphBuilderService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async buildWikidata(siteId: string): Promise<WikidataDraft> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const brand = site.name;
    const url = site.url.replace(/\/+$/, '');
    const niche = site.niche ?? 'company';
    const brandVoice: any = site.brain?.brandVoice ?? {};
    // Yedek aciklama eskiden `${brand} bir ${niche} sirketidir.` idi: nis yoksa
    // "X bir company sirketidir." (Ingilizce + Turkce karisik) cikiyordu ve her
    // markayi "sirket" ilan ediyordu. Wikidata aciklamasi kisa bir ifadedir.
    const description: string = brandVoice.summary ?? brandVoice.description
      ?? (site.niche ? `${site.niche} alanında faaliyet gösteren kuruluş` : '');

    // RanksUp on kontrolu (Wikidata kayda degerlik olcutu DEGIL — checkNotability)
    const notability = this.checkNotability(site, await this.sameAsEvidence(siteId, site.socialProfiles));

    const claims: WikidataDraft['claims'] = [
      // P31 instance of
      { property: 'P31', propertyLabel: 'instance of', value: this.nicheToInstanceOf(niche), valueType: 'item', note: 'Sirket tipi' },
      // P856 official website
      { property: 'P856', propertyLabel: 'official website', value: url, valueType: 'url' },
      // P17 country (Turkiye varsayilan)
      { property: 'P17', propertyLabel: 'country', value: 'Q43 (Turkey)', valueType: 'item' },
      // P407 language of work
      { property: 'P407', propertyLabel: 'language of work', value: site.language === 'en' ? 'Q1860 (English)' : 'Q256 (Turkish)', valueType: 'item' },
    ];

    // Sosyal profilleri sameAs olarak ekle
    const socialProfiles: string[] = Array.isArray((site as any).socialProfiles)
      ? ((site as any).socialProfiles as string[])
      : [];
    for (const social of socialProfiles) {
      const lower = social.toLowerCase();
      if (lower.includes('twitter.com') || lower.includes('x.com')) {
        const handle = social.split('/').filter(Boolean).pop();
        claims.push({ property: 'P2002', propertyLabel: 'X username', value: handle ?? '', valueType: 'string' });
      } else if (lower.includes('linkedin.com')) {
        claims.push({ property: 'P4264', propertyLabel: 'LinkedIn company ID', value: social, valueType: 'url' });
      } else if (lower.includes('facebook.com')) {
        const handle = social.split('/').filter(Boolean).pop();
        claims.push({ property: 'P2013', propertyLabel: 'Facebook ID', value: handle ?? '', valueType: 'string' });
      } else if (lower.includes('instagram.com')) {
        const handle = social.split('/').filter(Boolean).pop();
        claims.push({ property: 'P2003', propertyLabel: 'Instagram username', value: handle ?? '', valueType: 'string' });
      }
    }

    return {
      format: 'wikibase-json',
      labels: {
        tr: { language: 'tr', value: brand },
        en: { language: 'en', value: brand },
      },
      descriptions: {
        tr: { language: 'tr', value: description.slice(0, 250) },
      },
      aliases: [],
      claims,
      notabilityScore: notability.score,
      notabilityMax: NOTABILITY_MAX,
      notabilityNotes: notability.notes,
      createUrl: 'https://www.wikidata.org/wiki/Special:NewItem',
    };
  }

  async buildWikipedia(siteId: string): Promise<WikipediaDraft> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const brand = site.name;
    const url = site.url.replace(/\/+$/, '');
    const niche = site.niche ?? 'sirket';
    const brandVoice: any = site.brain?.brandVoice ?? {};

    let content = '';

    if (this.anthropic) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-sonnet-5',
          max_tokens: 6000,
          system: 'Sen Wikipedia editörüsün. Verilen marka için Wikipedia wikitext formatinda Türkçe makale taslagi yazarsin. Tarafsız (NPOV), 3.parti kaynaklarla doğrulanabilir, reklam içermemeli.',
          messages: [{
            role: 'user',
            content: `Marka: ${brand}\nURL: ${url}\nSektor: ${niche}\nDil: ${site.language ?? 'tr'}\nMarka aciklamasi: ${brandVoice.summary ?? ''}\n\nWikipedia Türkçe makale taslagi olustur. Format:\n\n'''${brand}'''  ([URL])\n\n[Giris paragrafi — kim, ne, ne zaman, nerede, neden notable]\n\n== Tarihce ==\n[Kuruluş, ana kilometre taşları]\n\n== Hizmetler/Ürünler ==\n[Ne sunuyor]\n\n== Kaynaklar ==\n<references/>\n\n[[Kategori:${this.nicheToCategory(niche)}]]\n\nDikkat: Reklam ifadelerini kullanma. "lider", "en iyi", "öncü" gibi kelimeler YASAK.`
          }],
        });
        content = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      } catch (err: any) {
        this.log.warn(`Wikipedia draft AI fail: ${err.message}`);
      }
    }

    if (!content) {
      content = this.fallbackWikipediaTemplate(brand, url, site.niche ?? null, brandVoice.summary ?? '');
    }

    const notability = this.checkNotability(site, await this.sameAsEvidence(siteId, site.socialProfiles));

    return {
      format: 'wikitext',
      title: brand,
      content,
      references: [
        { title: `${brand} Resmi Web Sitesi`, url, date: new Date().toISOString().slice(0, 10) },
      ],
      // "Türkiye'nin internet şirketleri" kategorisi HER markaya ekleniyordu (bir
      // kuafor ya da dis klinigi internet sirketi degil); yalniz sektor kategorisi.
      category: [this.nicheToCategory(niche)],
      notabilityScore: notability.score,
      notabilityMax: NOTABILITY_MAX,
      notabilityNotes: notability.notes,
      submitUrl: WIKIPEDIA_ARTICLE_WIZARD_URL,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Yardimcilar
  // ────────────────────────────────────────────────────────────
  /**
   * Kimlik (sameAs) kaniti — GEO kartinin Otorite kontrolu ile AYNI kaynak ve
   * kural (geo-score-card.service.ts sameAsCheck): son v3+ Agent Readiness
   * taramasinin ana sayfa Organization sameAs sonucu; yoksa eski
   * socialProfiles verisi; ikisi de yoksa "henüz ölçülmedi". Tarama tablosu
   * hatasi taslagi dusurmez (kanit yok sayilir).
   */
  private async sameAsEvidence(siteId: string, socialProfiles: unknown) {
    const scan = await Promise.resolve()
      .then(() => this.prisma.agentReadinessScan.findFirst({
        where: { siteId, scoreVersion: { gte: ORG_SAMEAS_MIN_SCAN_VERSION } },
        orderBy: { ranAt: 'desc' },
        select: { ranAt: true, levels: true },
      }))
      .catch(() => null);
    return sameAsCheck(scan, socialProfiles);
  }

  /**
   * RanksUp on kontrol puani — yalniz RanksUp'in gorebildigi sinyaller; Wikidata
   * ya da Vikipedi kayda degerlik olcutu DEGIL (panel bunu boyle anlatir).
   * Notlardaki "notability sinyali / notability zayıf" ifadeleri kaldirildi:
   * rakip sayisi ya da SEO stratejisi kayda degerligin gostergesi degildir.
   */
  private checkNotability(
    site: any,
    sameAs: { ok: boolean; detail: string },
  ): { score: number; notes: string[] } {
    const notes: string[] = [];
    let score = 0;

    if (site.url) { score += 10; notes.push('✓ Resmî web sitesi mevcut'); }
    if (site.brain?.competitors && (site.brain.competitors as any[]).length >= 3) {
      score += 15; notes.push('✓ RanksUp\'ta 3 veya daha fazla rakip tanımlı');
    } else {
      notes.push('⚠ RanksUp\'ta 3\'ten az rakip tanımlı');
    }
    if (site.brain?.seoStrategy && Object.keys(site.brain.seoStrategy).length > 0) {
      score += 10; notes.push('✓ SEO stratejisi tanımlı');
    }
    // Kimlik baglantilari: eskiden yalniz Site.socialProfiles okunuyordu; bu
    // alani API'de ya da panelde YAZAN hicbir yol yok — yeni her sitede
    // "Sosyal profil eksik — Twitter/LinkedIn/Facebook ekle" diye RanksUp'ta
    // uygulanamayan bir oneri cikiyordu. Kanit artik sitenin ana sayfasi.
    if (sameAs.ok) { score += 15; notes.push(`✓ Kimlik bağlantıları (sameAs): ${sameAs.detail}`); }
    else notes.push(`⚠ Kimlik bağlantıları (sameAs): ${sameAs.detail}`);
    // "Site 1+ yıldır aktif / 30+ gündür aktif / çok yeni" satiri KALDIRILDI:
    // site.createdAt sitenin RanksUp'a EKLENDIGI tarih, sitenin ya da markanin
    // yasi degil — 10 yillik bir marka ilk ay "çok yeni" gorunuyordu. RanksUp
    // gercek yasi (alan adi kaydi, kurulus yili) olcmuyor; kayda degerlik
    // olcutleri de yasa bakmaz: Wikidata "serious and publicly available
    // references" ile tanimlanabilirlik (https://www.wikidata.org/wiki/Wikidata:Notability),
    // Vikipedi bagimsiz, guvenilir ikincil kaynaklar ister (18.10.2026'da
    // dogrulandi). Puan bu yuzden en fazla NOTABILITY_MAX (50).

    // 3.parti referans (manuel kontrol)
    notes.push('⚠ MANUEL KONTROL: 3.parti basın haberleri (Webrazzi, Hürriyet vb.) gerekli — en az 2 bağımsız kaynak');

    return { score: Math.min(NOTABILITY_MAX, score), notes };
  }

  /**
   * P31 (instance of) onerisi. Eski tablodaki kimliklerin cogu YANLISTI —
   * Wikidata API'den (wbgetentities, 18.10.2026) okunan gercek etiketler:
   * Q1142307 "cryptopine" (bir kimyasal; "software as a service" yazilmisti),
   * Q791298 "Avon Wilderness Park" ("advertising agency" yazilmisti), Q484847
   * "e-commerce" (bir faaliyet; "online shop" yazilmisti), Q4830453 "business"
   * (hosting icin "web hosting service" yazilmisti). Musteri bu iddiayi
   * Wikidata'ya kopyaliyor. Simdiki kimlikler ayni API ile dogrulandi:
   * Q4830453 business, Q4382945 online shop, Q1058914 software company,
   * Q216931 advertising agency, Q5341295 educational organization,
   * Q4287745 medical organization.
   */
  private nicheToInstanceOf(niche: string): string {
    const map: Record<string, string> = {
      'web hosting': 'Q4830453 (business)',
      'hosting': 'Q4830453 (business)',
      'e-ticaret': 'Q4382945 (online shop)',
      'saas': 'Q1058914 (software company)',
      'ajans': 'Q216931 (advertising agency)',
      'eğitim': 'Q5341295 (educational organization)',
      'sağlık': 'Q4287745 (medical organization)',
    };
    return map[niche.toLowerCase()] ?? 'Q4830453 (business)';
  }

  private nicheToCategory(niche: string): string {
    const map: Record<string, string> = {
      'web hosting': 'Web hosting şirketleri',
      'hosting': 'Web hosting şirketleri',
      'e-ticaret': 'Türkiye\'deki e-ticaret şirketleri',
      'saas': 'Yazılım şirketleri',
      'ajans': 'Reklam ajansları',
      'eğitim': 'Eğitim teknolojisi şirketleri',
    };
    return map[niche.toLowerCase()] ?? 'Türkiye\'deki şirketler';
  }

  /**
   * Model cagrisi yoksa / basarisizsa sablon. Eskiden ilk cumle her markayi
   * "Türkiye merkezli bir <nis> şirketidir." diye tanimliyordu (nis yoksa
   * "bir sirket şirketidir"): dogrulanmamis konum ve tur iddiasi. Bilinmeyen
   * bilgi, sablonun geri kalani gibi [koseli parantez] yer tutucusu olur.
   */
  private fallbackWikipediaTemplate(brand: string, url: string, niche: string | null, summary: string): string {
    const alan = niche ? `${niche} alanında faaliyet gösteren` : '[alan] alanında faaliyet gösteren';
    return `'''${brand}''' ([${url} resmî web sitesi]), [şehir] merkezli, ${alan} bir kuruluştur.

${summary || `${brand}, ${niche ?? '[alan]'} alanında hizmet vermektedir.`}

== Tarihçe ==
{{Kaynak gerekli|date=${new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}}}
${brand}, [tarih] yılında kurulmuştur.

== Hizmetler ==
${brand}, ${niche ?? '[alan]'} alanında çeşitli hizmetler sunmaktadır.

== Ayrıca bakınız ==
* [Sektör/ilgili konular]

== Kaynaklar ==
<references/>

== Dış bağlantılar ==
* [${url} ${brand} Resmî Web Sitesi]

[[Kategori:${this.nicheToCategory(niche ?? '')}]]
`;
  }
}
