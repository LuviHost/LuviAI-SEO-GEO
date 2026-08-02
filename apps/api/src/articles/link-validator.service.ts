import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteUrlInventoryService, type SitePageRef } from '../sites/site-url-inventory.service.js';

export interface LinkIssue {
  anchor: string;
  original: string;
  action: 'kept' | 'remapped' | 'unlinked';
  replacement?: string;
  reason?: string;
}

export interface LinkValidationReport {
  total: number;
  internal: number;
  external: number;
  remapped: number;
  unlinked: number;
  issues: LinkIssue[];
}

/** Markdown link yakalayici — gorsel (![]()) haric. */
const MD_LINK = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * Makale icindeki linkleri GERCEK site envanterine karsi dogrular.
 *
 * Yazar ajani daha once hicbir dogrulamadan gecmeden URL uretiyordu; makul
 * gorunen ama var olmayan yollar ("/oyunlastirilmis-isg-egitimi-yontemleri")
 * makaleye 404 ic link olarak giriyordu. Bu servis uretim hattinda ve yayin
 * oncesinde iki kez calisir:
 *
 *   - Envanterde eslesen link  → oldugu gibi kalir
 *   - Yakin eslesme bulunan     → gercek URL'e remap edilir
 *   - Eslesme yok               → link kaldirilir, anchor duz metne doner
 *
 * Harici linkler icin (isteyen cagirir) canli HTTP kontrolu yapilir; 404/410
 * donenler duz metne cevrilir. Gecici hatalar (timeout, 5xx) linki BOZMAZ.
 */
@Injectable()
export class LinkValidatorService {
  private readonly log = new Logger(LinkValidatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: SiteUrlInventoryService,
  ) {}

  async validateArticleMarkdown(
    siteId: string,
    bodyMd: string,
    opts: { checkExternal?: boolean } = {},
  ): Promise<{ bodyMd: string; report: LinkValidationReport }> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    const report: LinkValidationReport = {
      total: 0,
      internal: 0,
      external: 0,
      remapped: 0,
      unlinked: 0,
      issues: [],
    };
    if (!site) return { bodyMd, report };

    const baseUrl = site.url;
    const pages = await this.inventory.getInventory(siteId);
    const known = new Set(pages.map((p) => p.path));

    // Envanter bos ise (crawl hic calismamis) hicbir seyi silme — yanlis
    // pozitiflerle saglam linkleri kirmaktansa dokunmamak dogru.
    if (pages.length === 0) {
      this.log.warn(`[${siteId}] URL envanteri bos — link dogrulama atlandi`);
      return { bodyMd, report };
    }

    const externalStatus = opts.checkExternal
      ? await this.checkExternalLinks(bodyMd, baseUrl)
      : new Map<string, number>();

    const out = bodyMd.replace(MD_LINK, (match, bang: string, anchor: string, url: string) => {
      if (bang === '!') return match; // gorsel — dokunma
      report.total++;

      const raw = url.trim();
      // Ankor, mailto, tel, protokol-yok sema → dokunma
      if (/^(#|mailto:|tel:|javascript:)/i.test(raw)) return match;

      if (!this.inventory.isInternal(raw, baseUrl)) {
        report.external++;
        const status = externalStatus.get(raw);
        if (status === 404 || status === 410) {
          report.unlinked++;
          report.issues.push({
            anchor,
            original: raw,
            action: 'unlinked',
            reason: `harici link ${status}`,
          });
          return anchor;
        }
        return match;
      }

      report.internal++;
      const path = this.inventory.normalizePath(raw, baseUrl);
      if (!path) {
        report.unlinked++;
        report.issues.push({ anchor, original: raw, action: 'unlinked', reason: 'URL parse edilemedi' });
        return anchor;
      }

      // Anasayfa her zaman gecerli
      if (path === '/' || known.has(path)) {
        report.issues.push({ anchor, original: raw, action: 'kept' });
        return match;
      }

      const suggestion = this.inventory.suggestReplacement(path, anchor, pages);
      if (suggestion) {
        report.remapped++;
        report.issues.push({
          anchor,
          original: raw,
          action: 'remapped',
          replacement: suggestion.url,
          reason: 'sayfa yok — en yakin gercek sayfaya yonlendirildi',
        });
        return `[${anchor}](${suggestion.url})`;
      }

      report.unlinked++;
      report.issues.push({
        anchor,
        original: raw,
        action: 'unlinked',
        reason: 'sayfa sitede yok, yakin eslesme de bulunamadi',
      });
      return anchor;
    });

    if (report.remapped || report.unlinked) {
      this.log.warn(
        `[${siteId}] link dogrulama: ${report.total} link → ${report.remapped} remap, ${report.unlinked} kaldirildi`,
      );
    } else {
      this.log.log(`[${siteId}] link dogrulama: ${report.total} link, hepsi gecerli`);
    }

    return { bodyMd: out, report };
  }

  /**
   * Harici linkleri canli kontrol et. Sadece KESIN olu olanlari (404/410)
   * isaretler; timeout/5xx/agirlanan bot korumasi linki bozmaz.
   */
  private async checkExternalLinks(bodyMd: string, baseUrl: string): Promise<Map<string, number>> {
    const urls = new Set<string>();
    for (const m of bodyMd.matchAll(MD_LINK)) {
      if (m[1] === '!') continue;
      const raw = m[3].trim();
      if (/^(#|mailto:|tel:|javascript:)/i.test(raw)) continue;
      if (!this.inventory.isInternal(raw, baseUrl)) urls.add(raw);
    }

    const result = new Map<string, number>();
    const list = [...urls].slice(0, 25); // makale basina makul ust sinir
    const BATCH = 5;
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(
        list.slice(i, i + BATCH).map(async (url) => {
          const status = await this.headOrGet(url);
          if (status !== null) result.set(url, status);
        }),
      );
    }
    return result;
  }

  private async headOrGet(url: string): Promise<number | null> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (compatible; RanksUp-LinkCheck/1.0; +https://ranksup.ai)',
    };
    try {
      const head = await fetch(url, {
        method: 'HEAD',
        headers,
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      // Bazi sunucular HEAD'i desteklemez → GET ile teyit et
      if (head.status === 405 || head.status === 501) {
        const get = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(12000),
          redirect: 'follow',
        });
        return get.status;
      }
      return head.status;
    } catch {
      return null; // ag hatasi — link hakkinda hukum verme
    }
  }
}
