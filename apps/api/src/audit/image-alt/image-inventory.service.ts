import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CrawledPage } from '../../sites/site-crawler.service.js';
import { collectCandidates, nextStatus, SITE_IMAGE_CAP } from './image-inventory.js';

const BATCH = 100;

/**
 * Taramadan SiteImage envanterini gunceller (audit.service runAudit sonrasi).
 * Kullanicinin oneri/onay/uygulama durumu korunur; yalnizca gozlem alanlari
 * (alt durumu, sayfa, baglam) tazelenir. Site basina SITE_IMAGE_CAP satir.
 */
@Injectable()
export class ImageInventoryService {
  private readonly log = new Logger(ImageInventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncFromCrawl(
    siteId: string,
    auditId: string,
    pages: Array<Pick<CrawledPage, 'url' | 'lang' | 'images'>>,
  ): Promise<{ created: number; updated: number; verified: number; capped: boolean }> {
    const { candidates, good, capped } = collectCandidates(pages);
    const hashes = [...candidates.map((c) => c.srcHash), ...good.keys()];
    if (hashes.length === 0) return { created: 0, updated: 0, verified: 0, capped };

    const existing = new Map(
      (await this.prisma.siteImage.findMany({
        where: { siteId, srcHash: { in: hashes } },
        select: { id: true, srcHash: true, status: true },
      })).map((r) => [r.srcHash, r]),
    );
    // Tavan: var olanlar her zaman guncellenir; yeni kayit yalnizca bos yer kadar
    let room = Math.max(0, SITE_IMAGE_CAP - (await this.prisma.siteImage.count({ where: { siteId } })));
    const now = new Date();
    const ops: any[] = [];
    let created = 0, updated = 0, verified = 0;

    for (const c of candidates) {
      const observed = {
        src: c.src,
        srcRaw: c.srcRaw,
        firstPageUrl: c.firstPageUrl,
        pageCount: c.pageCount,
        samplePages: c.samplePages,
        altState: c.altState,
        currentAlt: c.currentAlt,
        flags: c.flags,
        linked: c.linked,
        linkHref: c.linkHref,
        width: c.width,
        height: c.height,
        wpAttachmentId: c.wpAttachmentId,
        pageLang: c.pageLang,
        context: c.context as any,
        lastSeenAuditId: auditId,
        lastSeenAt: now,
      };
      const prev = existing.get(c.srcHash);
      if (prev) {
        ops.push(this.prisma.siteImage.update({
          where: { id: prev.id },
          data: { ...observed, status: nextStatus(prev.status, 'candidate') },
        }));
        updated++;
      } else if (room > 0) {
        ops.push(this.prisma.siteImage.create({ data: { siteId, srcHash: c.srcHash, ...observed, status: 'NEW' } }));
        room--;
        created++;
      }
    }

    for (const [srcHash, alt] of good) {
      const prev = existing.get(srcHash);
      if (!prev) continue; // iyi gorseli envantere YENI eklemeyiz
      const status = nextStatus(prev.status, 'good');
      if (status === 'VERIFIED' && prev.status !== 'VERIFIED') verified++;
      ops.push(this.prisma.siteImage.update({
        where: { id: prev.id },
        data: { altState: 'present', currentAlt: alt, flags: [], status, lastSeenAuditId: auditId, lastSeenAt: now },
      }));
    }

    for (let i = 0; i < ops.length; i += BATCH) {
      await this.prisma.$transaction(ops.slice(i, i + BATCH));
    }
    this.log.log(`[${siteId}] gorsel envanteri: +${created} yeni, ${updated} guncel, ${verified} dogrulandi${capped ? ' (aday tavani asildi)' : ''}`);
    return { created, updated, verified, capped };
  }
}
