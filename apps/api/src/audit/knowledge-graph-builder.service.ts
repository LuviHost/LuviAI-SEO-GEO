import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface WikidataDraft {
  format: 'wikibase-json';
  // Manuel onay sonrasi kullanici Wikidata create-item formuna yapistirir
  labels: { tr: { language: 'tr'; value: string }; en: { language: 'en'; value: string } };
  descriptions: { tr: { language: 'tr'; value: string }; en: { language: 'en'; value: string } };
  aliases: Array<{ language: string; value: string }>;
  claims: Array<{
    property: string;       // P17, P31, P856 vs.
    propertyLabel: string;  // 'instance of', 'official website'
    value: string;
    valueType: 'string' | 'item' | 'url' | 'monolingualtext';
    note?: string;
  }>;
  sitelinks?: Array<{ site: string; title: string }>;
  notabilityScore: number; // 0-100, Wikidata'nin "notable" kriterlerine uygun mu
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
  notabilityNotes: string[];
  submitUrl: string;
}

/**
 * Knowledge Graph Builder — markanizin Wikidata + Wikipedia stub'larini hazirlar.
 *
 * Wikidata = Google Knowledge Graph'in birincil kaynagi.
 * Wikipedia = AI'larin egitim verisi (LLM'lerin %30+'inin training data'si).
 *
 * Submit kullaniciya birakilir (Wikipedia/Wikidata manuel review'lu).
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
    const description = brandVoice.summary ?? brandVoice.description ?? `${brand} bir ${niche} sirketidir.`;

    // Notability check (Wikidata kriterleri)
    const notability = this.checkNotability(site);

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
        en: { language: 'en', value: this.translateBrief(description, 'en') },
      },
      aliases: [],
      claims,
      notabilityScore: notability.score,
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
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: 'Sen Wikipedia editörüsün. Verilen marka için Wikipedia wikitext formatinda Türkçe makale taslagi yazarsin. Tarafsız (NPOV), 3.parti kaynaklarla doğrulanabilir, reklam içermemeli.',
          messages: [{
            role: 'user',
            content: `Marka: ${brand}\nURL: ${url}\nSektor: ${niche}\nDil: ${site.language ?? 'tr'}\nMarka aciklamasi: ${brandVoice.summary ?? ''}\n\nWikipedia Türkçe makale taslagi olustur. Format:\n\n'''${brand}'''  ([URL])\n\n[Giris paragrafi — kim, ne, ne zaman, nerede, neden notable]\n\n== Tarihce ==\n[Kuruluş, ana kilometre taşları]\n\n== Hizmetler/Ürünler ==\n[Ne sunuyor]\n\n== Kaynaklar ==\n<references/>\n\n[[Kategori:${this.nicheToCategory(niche)}]]\n[[Kategori:Türkiye'nin internet şirketleri]]\n\nDikkat: Reklam ifadelerini kullanma. "lider", "en iyi", "öncü" gibi kelimeler YASAK.`
          }],
        });
        content = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      } catch (err: any) {
        this.log.warn(`Wikipedia draft AI fail: ${err.message}`);
      }
    }

    if (!content) {
      content = this.fallbackWikipediaTemplate(brand, url, niche, brandVoice.summary ?? '');
    }

    const notability = this.checkNotability(site);

    return {
      format: 'wikitext',
      title: brand,
      content,
      references: [
        { title: `${brand} Resmi Web Sitesi`, url, date: new Date().toISOString().slice(0, 10) },
      ],
      category: [this.nicheToCategory(niche), 'Türkiye\'nin internet şirketleri'],
      notabilityScore: notability.score,
      notabilityNotes: notability.notes,
      submitUrl: 'https://tr.wikipedia.org/wiki/Vikipedi:Hızlı_silmeye_aday_göster',
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Yardimcilar
  // ────────────────────────────────────────────────────────────
  private checkNotability(site: any): { score: number; notes: string[] } {
    const notes: string[] = [];
    let score = 0;

    if (site.url) { score += 10; notes.push('✓ Resmi web sitesi mevcut'); }
    if (site.brain?.competitors && (site.brain.competitors as any[]).length >= 3) {
      score += 15; notes.push('✓ Sektorde rekabet eden 3+ rakip tespit edildi (notability sinyali)');
    } else {
      notes.push('⚠ Sektorde rakip bilgisi az — notability zayif');
    }
    if (site.brain?.seoStrategy && Object.keys(site.brain.seoStrategy).length > 0) {
      score += 10; notes.push('✓ SEO stratejisi tanimli');
    }
    const socialProfiles: string[] = Array.isArray(site.socialProfiles) ? site.socialProfiles : [];
    if (socialProfiles.length >= 2) {
      score += 15; notes.push(`✓ ${socialProfiles.length} sosyal profil bagli (sameAs link\'leri olur)`);
    } else {
      notes.push('⚠ Sosyal profil eksik — Twitter/LinkedIn/Facebook ekle, sameAs ile dogrulanabilir');
    }
    // Yas
    const ageDays = (Date.now() - new Date(site.createdAt).getTime()) / 86400000;
    if (ageDays > 365) { score += 20; notes.push('✓ Site 1+ yıldır aktif'); }
    else if (ageDays > 30) { score += 10; notes.push('✓ Site 30+ gündür aktif'); }
    else { notes.push('⚠ Site çok yeni — Wikidata "notability" eşiği zor'); }

    // 3.parti referans (manuel kontrol)
    notes.push('⚠ MANUEL KONTROL: 3.parti basın haberleri (Webrazzi, Hürriyet vb.) gerekli — en az 2 bağımsız kaynak');

    return { score: Math.min(100, score), notes };
  }

  private nicheToInstanceOf(niche: string): string {
    const map: Record<string, string> = {
      'web hosting': 'Q4830453 (web hosting service)',
      'hosting': 'Q4830453 (web hosting service)',
      'e-ticaret': 'Q484847 (online shop)',
      'saas': 'Q1142307 (software as a service)',
      'ajans': 'Q791298 (advertising agency)',
      'eğitim': 'Q3914 (school)',
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

  private translateBrief(text: string, target: 'en'): string {
    // MVP: ASCII versiyonu — gercek translation ileride AI ile
    return text.slice(0, 250);
  }

  private fallbackWikipediaTemplate(brand: string, url: string, niche: string, summary: string): string {
    return `'''${brand}''' ([${url} resmi web sitesi]), Türkiye merkezli bir ${niche} şirketidir.

${summary || `${brand}, ${niche} alanında hizmet vermektedir.`}

== Tarihçe ==
{{Kaynak gerekli|date=${new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}}}
${brand}, [tarih] yılında kurulmuştur.

== Hizmetler ==
${brand}, ${niche} alanında çeşitli hizmetler sunmaktadır.

== Ayrıca bakınız ==
* [Sektör/ilgili konular]

== Kaynaklar ==
<references/>

== Dış bağlantılar ==
* [${url} ${brand} Resmi Web Sitesi]

[[Kategori:${this.nicheToCategory(niche)}]]
[[Kategori:Türkiye'deki şirketler]]
`;
  }
}
