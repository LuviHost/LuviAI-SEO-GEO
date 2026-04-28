import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AutoFixService } from './auto-fix.service.js';
import { AiCitationService } from './ai-citation.service.js';
import { SnippetGeneratorService } from './snippet-generator.service.js';
import { SnippetApplierService } from './snippet-applier.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';

@Controller('sites/:siteId/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly autoFix: AutoFixService,
    private readonly citation: AiCitationService,
    private readonly snippets: SnippetGeneratorService,
    private readonly applier: SnippetApplierService,
    private readonly staticFixer: StaticHtmlFixerService,
  ) {}

  @Get('latest')
  latest(@Param('siteId') siteId: string) {
    return this.audit.getLatest(siteId);
  }

  @Post('run-now')
  async runNow(@Param('siteId') siteId: string) {
    return this.audit.runAudit(siteId);
  }

  @Post('run')
  run(@Param('siteId') siteId: string) {
    return this.audit.queueAudit(siteId);
  }

  @Post('auto-fix')
  autoFixApply(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.applyFixes(siteId, body.fixes);
  }

  @Post('auto-fix-now')
  async autoFixNow(@Param('siteId') siteId: string, @Body() body: { fixes: string[] }) {
    return this.autoFix.runAutoFix(siteId, body.fixes);
  }

  @Post('citation-test')
  async citationTest(@Param('siteId') siteId: string) {
    const results = await this.citation.runForSite(siteId, 5);
    return { results, runAt: new Date().toISOString() };
  }

  @Get('snippets')
  async getSnippets(@Param('siteId') siteId: string, @Query('pageUrl') pageUrl?: string) {
    if (pageUrl) {
      const snippets = await this.snippets.generateForPage(siteId, pageUrl);
      return { pageUrl, snippets };
    }
    const audit = await this.audit.getLatest(siteId);
    const baseUrl = (audit?.checks as any)?.sitemap_xml?.details?.url
      ? new URL((audit!.checks as any).sitemap_xml.details.url).origin
      : null;
    if (!baseUrl) return { snippets: [], reason: 'Site base URL bulunamadı, önce audit çalıştır.' };
    const [pageSnippets, org] = await Promise.all([
      this.snippets.generateForPage(siteId, baseUrl),
      this.snippets.generateOrganizationJsonLd(siteId),
    ]);
    return { pageUrl: baseUrl, snippets: [org, ...pageSnippets] };
  }

  /** D2 — CMS adapter (WP/Webflow/Shopify) on-page meta yazımı */
  @Post('snippets/apply')
  async applySnippets(@Param('siteId') siteId: string, @Body() body: { snippets: any[] }) {
    return this.applier.applyToTarget(siteId, body.snippets ?? []);
  }

  /** D4 — Statik HTML preview (FTP/SFTP/cPanel için) */
  @Post('snippets/static-preview')
  async staticPreview(
    @Param('siteId') siteId: string,
    @Body() body: { pageUrl: string; snippets: any[] },
  ) {
    return this.staticFixer.preview(siteId, body.pageUrl, body.snippets ?? []);
  }

  /** D4 — Statik HTML write (onaydan sonra) */
  @Post('snippets/static-write')
  async staticWrite(
    @Param('siteId') siteId: string,
    @Body() body: { pageUrl: string; snippets: any[] },
  ) {
    return this.staticFixer.write(siteId, body.pageUrl, body.snippets ?? []);
  }
}
