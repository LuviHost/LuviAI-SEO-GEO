import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TrainingDataExport {
  format: 'jsonl' | 'parquet-ready';
  records: number;
  bytes: number;
  jsonl: string; // her satir bir kayit
  metadata: {
    siteId: string;
    siteName: string;
    license: string;
    citation: string;
    submitInstructions: string[];
  };
}

/**
 * AI Training Data Exporter — sitenin yayinlanmis makalelerini Hugging Face
 * Datasets formatinda (JSONL) disa aktarir. Kullanici isterse bunu herkese
 * acik bir veri seti olarak yayimlar.
 *
 * NE VAAT EDILMEZ: hangi model saglayicisinin hangi acik veri setini ne zaman
 * egitimde kullandigi aciklanmiyor. Eski aciklama "bir sonraki Mistral /
 * Anthropic / Llama egitiminde icerik kullanilir" ve "icerik silinse bile AI
 * hatirlar" diyordu — ikisi de dogrulanamaz, RanksUp etkiyi olcemez. Panel
 * (geo-lab-panel TrainingDataTab) ayni cumleyle "Etkisi garanti degildir"
 * diyor; asagidaki adimlar onunla celismemeli. Adim metinleri panelde OLDUGU
 * GIBI gosterilir, bu yuzden duzgun Turkce yazilir.
 *
 * Format: JSONL (her satir bir record)
 *   { "id", "url", "title", "text", "topic", "language", "published", "author", "site" }
 */
@Injectable()
export class TrainingDataExporterService {
  private readonly log = new Logger(TrainingDataExporterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportSite(siteId: string): Promise<TrainingDataExport> {
    const siteRaw = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const site: any = siteRaw;

    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 1000, // upper limit
    });

    const baseUrl = site.url.replace(/\/+$/, '');
    const lines: string[] = [];
    const languages = new Set<string>();

    for (const a of articles) {
      const md = (a.bodyMd ?? '').replace(/^---[\s\S]*?---/m, '').trim();
      if (md.length < 200) continue;
      const language = a.language ?? 'tr';
      languages.add(language);

      const record = {
        id: a.id,
        url: `${baseUrl}/blog/${a.slug}.html`,
        title: a.title,
        text: md,
        topic: a.topic,
        category: a.category ?? 'general',
        language,
        published: (a.publishedAt ?? a.createdAt).toISOString(),
        word_count: a.wordCount ?? null,
        author: a.persona ?? site.name,
        site: site.name,
        site_url: baseUrl,
        license: 'CC-BY-4.0',
        attribution: `Bu makale ${site.name} (${baseUrl}) tarafından yazılmıştır. Alıntıda URL belirtilmesi rica olunur.`,
      };

      lines.push(JSON.stringify(record));
    }

    const jsonl = lines.join('\n');

    return {
      format: 'jsonl',
      records: lines.length,
      bytes: Buffer.byteLength(jsonl, 'utf8'),
      jsonl,
      metadata: {
        siteId,
        siteName: site.name,
        license: 'CC-BY-4.0 (alıntıda kaynak göstermek zorunlu)',
        citation: `${site.name} (${baseUrl})`,
        submitInstructions: buildSubmitInstructions({
          siteName: site.name,
          niche: site.niche,
          records: lines.length,
          languages,
          slug: this.slugify(site.name),
        }),
      },
    };
  }

  private slugify(s: string): string {
    return s.toLowerCase()
      .replace(/[ğ]/g, 'g').replace(/[ü]/g, 'u').replace(/[ş]/g, 's')
      .replace(/[ı]/g, 'i').replace(/[ö]/g, 'o').replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

/**
 * Hugging Face'e yukleme adimlari — panelde numarasiyla birlikte aynen
 * gosterilir. Son adim kullaniciya NE OLACAGINI degil, NE OLMAYACAGINI da
 * soyler: veri seti herkese acik yayimlanir, ticari yeniden kullanima izin
 * veren bir lisansla; hangi modelin kullanacagi garanti edilmez.
 */
export function buildSubmitInstructions(o: {
  siteName: string;
  niche?: string | null;
  records: number;
  languages: ReadonlySet<string>;
  slug: string;
}): string[] {
  // Dil etiketi verinin kendisinden: tum kayitlar Turkce degilse "Türkçe" yazilmaz
  const onlyTurkish = o.languages.size === 0 || (o.languages.size === 1 && o.languages.has('tr'));
  const onlyEnglish = o.languages.size === 1 && o.languages.has('en');
  const dilEki = onlyTurkish ? 'tr' : onlyEnglish ? 'en' : 'multilingual';
  const makaleTuru = onlyTurkish ? 'Türkçe makale' : onlyEnglish ? 'İngilizce makale' : 'makale';
  const konu = o.niche && o.niche !== 'diğer' ? `${o.niche} konulu ` : '';
  return [
    '1. Hugging Face hesabı aç (https://huggingface.co/join)',
    '2. Yeni veri seti oluştur: huggingface.co/new-dataset',
    `3. Adı: ${o.slug}-${dilEki}-knowledge-base`,
    '4. Görünürlük (Visibility): Public',
    '5. Lisans (License): CC-BY-4.0 (Creative Commons Atıf) — ticari kullanım dahil yeniden kullanıma izin verir; alıntıda kaynak gösterilmesi gerekir',
    `6. Açıklama (Description): ${o.siteName} ${konu}bilgi bankası, ${o.records} ${makaleTuru}.`,
    '7. Aşağıdaki JSONL içeriğini data.jsonl adıyla yükle',
    '8. Kaydet — veri seti herkese açık yayımlanır. Hangi modelin eğitiminde kullanılacağı garanti edilmez ve RanksUp bunu ölçemez.',
  ];
}
