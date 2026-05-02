import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { GeneratorsService } from './generators.service.js';
import { decrypt } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';

/**
 * Auto-fix engine — en kritik 3 düzeltmeyi otomatik yapar:
 *  1. sitemap.xml
 *  2. robots.txt
 *  3. llms.txt
 *
 * Her biri:
 *  - String olarak üret
 *  - Site'nin default publish target'ına gönder (FTP/SFTP/WP REST)
 *  - Audit kaydını "fixesApplied" alanına işaretle
 */
@Injectable()
export class AutoFixService {
  private readonly log = new Logger(AutoFixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
    private readonly generators: GeneratorsService,
  ) {}

  async applyFixes(siteId: string, fixes: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'AUTO_FIX',
        payload: { fixes },
      },
    });
  }

  /** Worker'dan çağrılır */
  async runAutoFix(siteId: string, fixes: string[]) {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: {
        publishTargets: { where: { isDefault: true, isActive: true }, take: 1 },
        brain: true,
      },
    });

    const target = site.publishTargets[0];
    if (!target) {
      this.log.warn(`[${siteId}] Default publish target yok, fix uygulanamadı`);
      return { applied: [], skipped: fixes, reason: 'no-publish-target' };
    }

    // Crawl bir kere
    const crawl = await this.crawler.crawl(site.url, 30);

    const applied: string[] = [];
    const errors: Array<{ fix: string; error: string }> = [];
    // Frontend'in indirip görüntüleyebilmesi için üretilen dosya içerikleri
    const files: Array<{ fix: string; filename: string; content: string; externalUrl?: string }> = [];

    for (const fix of fixes) {
      try {
        const content = this.generateContent(fix, site, crawl);
        if (!content) continue;

        const filename = this.fixToFilename(fix);
        const result = await this.uploadToTarget(target, filename, content);

        if (result.ok) {
          applied.push(fix);
          files.push({ fix, filename, content, externalUrl: result.externalUrl });
          this.log.log(`[${siteId}] ✓ ${fix} → ${result.externalUrl}`);
        } else {
          errors.push({ fix, error: result.error ?? 'unknown' });
          this.log.error(`[${siteId}] ✗ ${fix}: ${result.error}`);
        }
      } catch (err: any) {
        errors.push({ fix, error: err.message });
        this.log.error(`[${siteId}] ✗ ${fix}: ${err.message}`);
      }
    }

    // En son audit'i güncelle
    const latestAudit = await this.prisma.audit.findFirst({
      where: { siteId }, orderBy: { ranAt: 'desc' },
    });
    if (latestAudit) {
      await this.prisma.audit.update({
        where: { id: latestAudit.id },
        data: {
          autoFixApplied: applied.length > 0,
          fixesApplied: applied,
        },
      });
    }

    return { applied, errors, files };
  }

  private generateContent(fix: string, site: any, crawl: any): string | null {
    switch (fix) {
      case 'sitemap':
      case 'sitemap_xml':
        return this.generators.generateSitemap(crawl);
      case 'robots':
      case 'robots_txt':
        return this.generators.generateRobotsTxt(site.url, { allowAiCrawlers: true });
      case 'llms':
      case 'llms_txt': {
        const description = site.brain?.brandVoice?.tagline
          ?? `${site.name} — ${site.niche ?? 'web sitesi'}`;
        return this.generators.generateLlmsTxt(crawl, site.name, description);
      }
      default:
        this.log.warn(`Bilinmeyen fix: ${fix}`);
        return null;
    }
  }

  private fixToFilename(fix: string): string {
    const map: Record<string, string> = {
      sitemap: 'sitemap.xml',
      sitemap_xml: 'sitemap.xml',
      robots: 'robots.txt',
      robots_txt: 'robots.txt',
      llms: 'llms.txt',
      llms_txt: 'llms.txt',
    };
    return map[fix] ?? `${fix}.txt`;
  }

  private async uploadToTarget(target: any, filename: string, content: string) {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) {
      return { ok: false, error: `Adapter yok: ${target.type}` };
    }

    // Şifrelenmiş credentials decrypt
    const credentials: Record<string, any> = {};
    for (const [k, v] of Object.entries(target.credentials as Record<string, any>)) {
      credentials[k] = typeof v === 'string' && v.includes(':')
        ? this.tryDecrypt(v)
        : v;
    }

    const adapter = new Adapter(credentials, target.config ?? {});

    // Auto-fix dosyaları root'a yazılmalı (sitemap.xml, robots.txt, llms.txt)
    return adapter.publish({
      slug: filename.replace(/\.[^.]+$/, ''),
      title: filename,
      bodyHtml: content,
      bodyMd: content,
    });
  }

  private tryDecrypt(value: string): string {
    try { return decrypt(value); } catch { return value; }
  }
}
