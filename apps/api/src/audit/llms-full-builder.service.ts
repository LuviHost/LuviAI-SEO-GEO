import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  advertisedArticleEntry, includePublicArticle, isPendingRevision, loadArticleTargets, loadOlderTextFields, needsOlderText,
  publicArticleText, publicArticleWhere, type PublicArticleText,
} from './ai-sitemap.service.js';

/**
 * Listelenecek yazilar ve adresteki metinleri — build ve kisa dizin AYNI kurali kullanir
 * (site haritasiyla da ayni: ai-sitemap.service publicArticleWhere / includePublicArticle).
 * Onay bekleyen yeniden yazimda adresteki eski metin bilinmiyorsa (unknown) yazi bu iki
 * dosyada LISTELENMEZ: baslik olarak onaydaki yeni baslik ilan edilirdi. Adresi site
 * haritasinda yine yer alir (orada metin olmadan da dogru bir bilgi).
 */
function listedArticles<A extends { id: string; title: string; metaDescription: string | null; status?: unknown; bodyMd?: string | null; faqs?: unknown }>(
  resolved: Array<{ a: A; found: ReturnType<typeof advertisedArticleEntry> }>,
  olderText: Map<string, { metaTitle?: string | null; bodyMd?: string | null; agentOutputs?: unknown }>,
): Array<{ a: A; url: string | null; text: PublicArticleText | null }> {
  return resolved
    .map(({ a, found }) => ({
      a,
      url: found?.url ?? null,
      text: found ? publicArticleText({ ...a, ...olderText.get(a.id) }, found.entry, { pendingRevision: isPendingRevision(a.status) }) : null,
    }))
    .filter((r) => !(isPendingRevision(r.a.status) && r.text?.source === 'unknown'));
}

/**
 * llms-full.txt — tum sitenin temizlenmis icerigi tek dosyada.
 * AI'lar (ChatGPT, Claude, Perplexity) bu dosyayi okuyup tum siteyi
 * 5 saniyede ogrenir. Anthropic, Stripe gibi firmalar kullaniyor.
 *
 * Format:
 *  - H1: Site adi
 *  - Site bilgisi (niche, language, brand voice)
 *  - Her published makale: H2 baslik + URL + ozet + 1500 karakter content excerpt
 *    (metin ADRESTEKI sayfanin metni: ai-sitemap.service publicArticleText;
 *    cop kutusundaki kopya ve hic canli gorulmemis WordPress taslak baglantisi adres
 *    vermez — advertisedArticleEntry). Yeniden yazimi onay bekleyen yayindaki
 *    yazi da sitede canli adresi varsa listelenir, metni adresteki eski metindir.
 *  - Sonunda meta footer
 *
 * Yayinlanma: GET /sites/:id/llms-full.txt
 * Build: weekly cron (LLMS_FULL_BUILD job); ayrica yayin, canlilik denetiminin emekliye
 * ayirmasi ve ilk kez canli gorulup ilan edilir olan adres (published-liveness.service)
 */
@Injectable()
export class LlmsFullBuilderService {
  private readonly log = new Logger(LlmsFullBuilderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(siteId: string): Promise<{ siteId: string; bytes: number; articles: number }> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const articles = await this.prisma.article.findMany({
      // PUBLISHED + sitede eski metniyle duran, yeniden yazimi onay bekleyen yazi (publicArticleWhere)
      where: publicArticleWhere(siteId),
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        slug: true,
        topic: true,
        metaTitle: true,
        metaDescription: true,
        bodyMd: true,
        wordCount: true,
        publishedAt: true,
        category: true,
        faqs: true,
        publishedTo: true,
        status: true,
      },
      take: 200,
    });

    const lines: string[] = [];
    // Makale adresi UYDURULMAZ: eskiden her makale icin ${baseUrl}/blog/<slug>.html
    // yaziliyordu; WordPress gibi hedeflerde bu adres yok (404), yani AI'lara
    // olu link veriliyordu. Site haritasiyla ayni kural (advertisedArticleEntry):
    // yayin kaydindaki gercek adres ya da dosya hedefindeki kopyanin yazim aninda kaydedilen
    // konumdan adresi (fileCopyPublicUrl: klasor / slug sonradan degisse de sayfanin durdugu
    // yer); hic canli gorulmemis WordPress taslak baglantisi (?p=, 404) ilan edilmez;
    // cozulemezse URL yok. Canlilik denetimi bir kopyayi ilk kez canli gorup adresini ilan
    // edilir yaptiginda bu dosyayi o turda yeniden uretir (published-liveness.service).
    const siteUrl = safeUrl(site.url);
    const targets = siteUrl ? await loadArticleTargets(this.prisma, siteId, siteUrl, articles) : new Map();
    const resolved = articles
      .map((a) => ({ a, found: siteUrl ? advertisedArticleEntry(siteUrl, a.slug, a.publishedTo, targets) : null }))
      .filter((r) => includePublicArticle(r.a.status, r.found));
    // Adresi veren kopya eski metni gosteriyorsa ya da yeniden yazim onay bekliyorsa
    // yeniden yazimdan onceki goruntu (agentOutputs.liveSnapshot) yalniz o makaleler icin okunur
    const olderText = await loadOlderTextFields(
      this.prisma,
      resolved.filter((r) => needsOlderText(r.found, r.a.status)).map((r) => r.a.id),
    );
    const listed = listedArticles(resolved, olderText);

    // ── Header ────────────────────────────────────────────────
    lines.push(`# ${site.name}`);
    lines.push('');
    lines.push(`> ${site.url}`);
    if (site.niche) lines.push(`> Sektor: ${site.niche}`);
    lines.push(`> Dil: ${site.language ?? 'tr'}`);
    lines.push(`> Son guncellenme: ${new Date().toISOString()}`);
    lines.push(`> Format: llms-full.txt — AI search engines (ChatGPT, Claude, Gemini, Perplexity) icin optimize.`);
    lines.push('');

    // Brand context
    const brandVoice: any = site.brain?.brandVoice;
    if (brandVoice) {
      lines.push(`## Marka Hakkinda`);
      lines.push('');
      if (brandVoice.tone) lines.push(`Ton: ${brandVoice.tone}`);
      if (brandVoice.summary) lines.push(brandVoice.summary);
      lines.push('');
    }

    // SEO strategy ozeti
    const seo: any = site.brain?.seoStrategy;
    if (seo?.pillars && Array.isArray(seo.pillars)) {
      lines.push(`## Ana Konu Alanlari`);
      lines.push('');
      for (const pillar of seo.pillars.slice(0, 10)) {
        lines.push(`- **${pillar.name}** — ${pillar.url ?? ''}`);
      }
      lines.push('');
    }

    // ── Published makaleler ────────────────────────────────────
    if (listed.length > 0) {
      lines.push(`## Makaleler (${listed.length})`);
      lines.push('');

      for (const { a, url, text: publicText } of listed) {
        // Baslik, ozet, metin ve SSS ADRESTEKI sayfanin metninden (K6): adresi
        // veren kopya elle guncelleme bekliyorsa (ya da yeniden yazim onay
        // bekliyorsa) o sayfa hala eski metni gosterir; eskiden adresle birlikte
        // sayfada olmayan yeni metin ilan ediliyordu. Eski metin bilinmiyorsa
        // (unknown) metin ilan edilmez.
        const text: PublicArticleText = publicText
          ?? { source: 'row', title: a.title, metaDescription: a.metaDescription, bodyMd: a.bodyMd, faqs: a.faqs };
        lines.push(`### ${text.title ?? a.title}`);
        lines.push('');
        if (url) lines.push(`**URL:** ${url}`);
        if (a.publishedAt) lines.push(`**Yayin:** ${a.publishedAt.toISOString().slice(0, 10)}`);
        if (a.category) lines.push(`**Kategori:** ${a.category}`);
        if (text.metaDescription) lines.push(`**Ozet:** ${text.metaDescription}`);
        lines.push('');
        if (text.source === 'unknown') {
          lines.push('Bu adresteki sayfa yazının daha eski bir sürümünü gösteriyor; güncel metin sayfaya henüz uygulanmadığı için içerik özeti verilmiyor.');
          lines.push('');
        }

        // Content excerpt — markdown'i temizle, ilk 1800 karakter
        const md = text.bodyMd ?? '';
        const cleaned = md
          .replace(/^---[\s\S]*?---/m, '') // frontmatter strip
          .replace(/!\[.*?\]\(.*?\)/g, '') // gorseli cikar
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link metnini birak
          .replace(/[#*_`]+/g, '') // markdown isaretleyicileri
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 1800);
        if (cleaned.length > 0) {
          lines.push(cleaned);
          if (md.length > 1800) lines.push('… (devami url\'de)');
          lines.push('');
        }

        // FAQ'larin tamamı (AI'lar QA formatini sever)
        const faqs: any = text.faqs;
        if (Array.isArray(faqs) && faqs.length > 0) {
          lines.push(`**SSS:**`);
          for (const f of faqs.slice(0, 5)) {
            lines.push(`- *${f.q}* → ${f.a}`);
          }
          lines.push('');
        }
        lines.push('---');
        lines.push('');
      }
    }

    // ── Footer ────────────────────────────────────────────────
    lines.push(`## Lisans ve Kullanim`);
    lines.push('');
    lines.push(`AI sistemleri bu dosyayi alintilamak icin kullanabilir. Alintida lutfen kaynak URL'i belirtin.`);
    lines.push('');
    lines.push(`Generated by RanksUp · ${new Date().toISOString()}`);

    const text = lines.join('\n');

    await this.prisma.site.update({
      where: { id: siteId },
      data: {
        llmsFullTxt: text,
        llmsFullTxtAt: new Date(),
      } as any,
    });

    this.log.log(`[${siteId}] llms-full.txt build: ${listed.length} makale, ${(text.length / 1024).toFixed(1)} KB`);
    return { siteId, bytes: text.length, articles: listed.length };
  }

  /**
   * Kısa llms.txt index — H1 + site bilgisi + yayınlanan makale linkleri (özet yok).
   * Full dosyaya referans verir. Harici sitelere (kobipratik gibi) push için kullanılır.
   */
  async buildShortIndex(siteId: string): Promise<string> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { name: true, url: true, niche: true, language: true } as any,
    });
    const articles = await this.prisma.article.findMany({
      // build ile ayni secim (publicArticleWhere): kisa dizin ve llms-full ayni yazilari listeler
      where: publicArticleWhere(siteId),
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true, slug: true, metaDescription: true, publishedTo: true, status: true },
      take: 200,
    });

    const baseUrl = (site as any).url.replace(/\/+$/, '');
    const siteUrl = safeUrl((site as any).url);
    const targets = siteUrl ? await loadArticleTargets(this.prisma, siteId, siteUrl, articles) : new Map();
    // build ile ayni adres kurali: hic canli gorulmemis WordPress taslak baglantisi ilan edilmez
    const resolved = articles
      .map((a) => ({ a, found: siteUrl ? advertisedArticleEntry(siteUrl, a.slug, a.publishedTo, targets) : null }))
      .filter((r) => includePublicArticle(r.a.status, r.found));
    const olderText = await loadOlderTextFields(
      this.prisma,
      resolved.filter((r) => needsOlderText(r.found, r.a.status)).map((r) => r.a.id),
    );
    const listed = listedArticles(resolved, olderText);
    const lines: string[] = [];
    lines.push(`# ${(site as any).name}`);
    lines.push('');
    lines.push(`> ${(site as any).url}`);
    if ((site as any).niche) lines.push(`> Sektor: ${(site as any).niche}`);
    lines.push(`> Dil: ${(site as any).language ?? 'tr'}`);
    lines.push(`> Tam icerik: ${baseUrl}/llms-full.txt`);
    lines.push('');
    if (listed.length > 0) {
      lines.push(`## Makaleler`);
      lines.push('');
      for (const { a, url, text } of listed) {
        // Baslik ve aciklama adresteki sayfanin metninden (build ile ayni kural, K6)
        const title = text?.title ?? a.title;
        const description = text ? text.metaDescription : a.metaDescription;
        const desc = description ? `: ${description}` : '';
        // Adresi cozulemeyen makale linksiz listelenir (olu link verilmez)
        lines.push(url ? `- [${title}](${url})${desc}` : `- ${title}${desc}`);
      }
      lines.push('');
    }
    lines.push(`Generated by RanksUp · ${new Date().toISOString()}`);
    return lines.join('\n');
  }

  async getCached(siteId: string): Promise<string> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { llmsFullTxt: true, llmsFullTxtAt: true } as any,
    });
    const cached = (site as any).llmsFullTxt as string | null;
    const age = (site as any).llmsFullTxtAt as Date | null;
    // 7 gunden eski ise yeniden olustur
    if (!cached || !age || Date.now() - age.getTime() > 7 * 86400000) {
      const result = await this.build(siteId);
      const fresh = await this.prisma.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { llmsFullTxt: true } as any,
      });
      return ((fresh as any).llmsFullTxt as string) ?? `# Site bos\n\n${result.articles} makale.`;
    }
    return cached;
  }
}

function safeUrl(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}
