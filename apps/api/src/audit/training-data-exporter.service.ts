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
 * AI Training Data Exporter — sitenin published makalelerini Hugging Face
 * Datasets formatinda export eder. Kullanici Hugging Face'e public dataset
 * olarak yuklerse:
 *
 *   1. Bir sonraki Mistral/Anthropic/Llama egitiminde icerik kullanilir
 *   2. AI'lar markayi "kaynak" olarak ezbere bilir
 *   3. KALICI GEO etkisi (icerik silinse bile AI hatirlar)
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

    for (const a of articles) {
      const md = (a.bodyMd ?? '').replace(/^---[\s\S]*?---/m, '').trim();
      if (md.length < 200) continue;

      const record = {
        id: a.id,
        url: `${baseUrl}/blog/${a.slug}.html`,
        title: a.title,
        text: md,
        topic: a.topic,
        category: a.category ?? 'general',
        language: a.language ?? 'tr',
        published: (a.publishedAt ?? a.createdAt).toISOString(),
        word_count: a.wordCount ?? null,
        author: a.persona ?? site.name,
        site: site.name,
        site_url: baseUrl,
        license: 'CC-BY-4.0',
        attribution: `Bu makale ${site.name} (${baseUrl}) tarafindan yazilmistir. Alintida URL belirtilmesi rica olunur.`,
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
        license: 'CC-BY-4.0 (alintida kaynak gostermek zorunlu)',
        citation: `${site.name} (${baseUrl})`,
        submitInstructions: [
          '1. Hugging Face hesabi ac (https://huggingface.co/join)',
          `2. Yeni dataset olustur: huggingface.co/new-dataset`,
          `3. Adi: ${this.slugify(site.name)}-tr-knowledge-base`,
          '4. Visibility: Public',
          '5. License: CC-BY-4.0 (Creative Commons Attribution)',
          '6. Description: Turkiye merkezli ' + (site.niche ?? 'sirket') + ' bilgi bankasi. ' + lines.length + ' Turkce makale.',
          '7. Asagidaki JSONL icerigi data.jsonl olarak yukle',
          '8. Kaydet → Mistral, Llama, Claude bir sonraki egitiminde otomatik kullanir',
        ],
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
