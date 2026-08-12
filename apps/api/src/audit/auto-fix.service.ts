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
        publishTargets: { where: { isActive: true } },
        brain: true,
      },
    });

    if (site.publishTargets.length === 0) {
      this.log.warn(`[${siteId}] Aktif publish target yok, fix uygulanamadı`);
      return { applied: [], skipped: fixes, reason: 'no-publish-target' };
    }

    // Kök dosyalar (robots.txt / llms.txt / sitemap.xml) yalnızca dosya-tabanlı
    // adapter'larla (SFTP / FTP / cPanel) yazılabilir. WordPress REST adapter'ı
    // kök dosya yazamaz — publish() çağrılsaydı "robots.txt" başlıklı çöp bir
    // blog postu oluştururdu. Bu yüzden default'u tercih edip, değilse ilk
    // dosya-yazabilen aktif target'ı seçiyoruz.
    const target = this.pickRootFileTarget(site.publishTargets);
    if (!target) {
      this.log.warn(`[${siteId}] Kök dosya yazabilen target yok (SFTP/FTP/cPanel gerekli)`);
      return {
        applied: [],
        skipped: fixes,
        reason: 'no-file-target',
        errors: fixes.map((fix) => ({
          fix,
          error: 'robots.txt / llms.txt / sitemap.xml için dosya yazabilen bir publish target gerekli (SFTP / FTP / cPanel). WordPress REST API kök dosya yazamaz — Yayın Hedefleri\'nden bir SFTP target ekleyin.',
        })),
      };
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
      // Agent Readiness (AXO) fix'leri
      case 'agent_json': {
        const description = site.brain?.brandVoice?.tagline
          ?? `${site.name} — ${site.niche ?? 'web sitesi'}`;
        const pillars = Array.isArray(site.brain?.seoStrategy?.pillars)
          ? site.brain.seoStrategy.pillars.map((p: any) => ({ name: p?.name ?? p?.pillar, url: p?.url }))
          : [];
        return this.generators.generateAgentJson({
          siteUrl: site.url,
          brandName: site.name,
          description,
          pillars,
        });
      }
      case 'auth_md':
        return this.generators.generateAuthMd({ siteUrl: site.url, brandName: site.name });
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
      // AXO kok dosyalari — .well-known dizini adapter'da yoksa hata gorunur
      // sekilde kullaniciya doner (sessiz yutulmaz).
      agent_json: '.well-known/agent.json',
      auth_md: 'auth.md',
    };
    return map[fix] ?? `${fix}.txt`;
  }

  private async uploadToTarget(target: any, filename: string, content: string) {
    const Adapter = getAdapter(target.type) as any;
    if (!Adapter) {
      return { ok: false, error: `Adapter yok: ${target.type}` };
    }

    const adapter = new Adapter(this.decryptCreds(target.credentials as Record<string, any>), target.config ?? {});

    // Kök dosya yazımı — slug.html DEĞİL, dosya adı birebir web root'a.
    const contentType = filename.endsWith('.xml')
      ? 'application/xml; charset=utf-8'
      : filename.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : filename.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'text/plain; charset=utf-8';
    return adapter.putRootFile(filename, content, contentType);
  }

  /** Aktif target'lar arasından kök dosya yazabilen (SFTP/FTP/cPanel) ilkini seç; default'u tercih et. */
  private pickRootFileTarget(targets: any[]): any | null {
    const capable = targets.filter((t) => {
      const Adapter = getAdapter(t.type) as any;
      if (!Adapter) return false;
      try {
        // Yetenek kontrolü creds gerektirmez — boş constructor yeterli.
        return new Adapter({}, {}).supportsRootFiles === true;
      } catch {
        return false;
      }
    });
    if (capable.length === 0) return null;
    return capable.find((t) => t.isDefault) ?? capable[0];
  }

  /** credentials decrypt — hem yeni {enc} formatı hem eski per-field formatı. */
  private decryptCreds(creds: Record<string, any>): Record<string, any> {
    if (!creds || typeof creds !== 'object') return {};
    if (typeof creds.enc === 'string' && creds.enc.includes(':')) {
      try {
        const parsed = JSON.parse(decrypt(creds.enc));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch { /* per-field'e düş */ }
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      out[k] = typeof v === 'string' && v.includes(':') ? this.tryDecrypt(v) : v;
    }
    return out;
  }

  private tryDecrypt(value: string): string {
    try { return decrypt(value); } catch { return value; }
  }
}
