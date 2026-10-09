import { Injectable, Logger } from '@nestjs/common';
import { decryptCredentials } from '@luviai/shared';
import { getAdapter, findImgTags, readAlt } from '@luviai/adapters';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppliedFixService } from '../applied-fix.service.js';
import { StaticHtmlFixerService } from '../static-html-fixer.service.js';
import { readBodyCapped } from '../../common/fetch-capped.js';

const MAX_PAGES_PER_IMAGE = 5;
const GAP_MS = 300;
const FILE_TARGETS = ['FTP', 'SFTP', 'CPANEL_API'];

type PageResult = { pageUrl: string; applied: string[]; skipped: { field: string; reason: string }[]; previous?: any };

export interface ApplyOutcome {
  id: string;
  status: 'APPLIED' | 'PARTIAL' | 'FAILED' | 'VERIFIED' | 'SNIPPET';
  pages: PageResult[];
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ONAYLANMIS alt metinlerini musteri sitesine yazar.
 *
 * Guvenlik kurallari:
 *  - Yalnizca APPROVED / DECORATIVE kayitlar (kullanici onayi sart). MCP/sohbet
 *    bu servisi CAGIRMAZ.
 *  - Yazim cerrahidir (img-alt-patch), WordPress'te iyimser kilitlidir.
 *  - Onceki degerler applyDetail.previous'ta saklanir → geri alinabilir; geri
 *    alma yalnizca bizim yazdigimiz deger hala duruyorsa calisir.
 *  - Her yazim AppliedFix'e (kind: image_alt) kaydedilir; yazdiktan sonra sayfa
 *    yeniden cekilip dogrulanir (CDN gecikmesinde APPLIED kalir).
 */
@Injectable()
export class ImageAltApplyService {
  private readonly log = new Logger(ImageAltApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appliedFix: AppliedFixService,
    private readonly staticFixer: StaticHtmlFixerService,
  ) {}

  private async defaultTarget(siteId: string) {
    return this.prisma.publishTarget.findFirst({
      where: { siteId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  private pagesOf(row: { firstPageUrl: string; samplePages: unknown }): string[] {
    const sample = Array.isArray(row.samplePages) ? (row.samplePages as unknown[]).filter((p): p is string => typeof p === 'string') : [];
    return [...new Set([row.firstPageUrl, ...sample])].slice(0, MAX_PAGES_PER_IMAGE);
  }

  async applyMany(siteId: string, imageIds: string[], userId?: string): Promise<{ outcomes: ApplyOutcome[] }> {
    const rows = await this.prisma.siteImage.findMany({
      where: { siteId, id: { in: imageIds }, status: { in: ['APPROVED', 'DECORATIVE'] } },
    });
    if (rows.length === 0) return { outcomes: [] };
    const target = await this.defaultTarget(siteId);
    const type = String(target?.type ?? '');
    const capability = type === 'WORDPRESS_REST' ? 'wordpress' : FILE_TARGETS.includes(type) ? 'static' : 'snippet';
    if (!target || capability === 'snippet') {
      return { outcomes: rows.map((r) => ({ id: r.id, status: 'SNIPPET' as const, pages: [], note: 'Bu yayin hedefi alt metni yazamiyor — kopyala-yapistir ile uygula' })) };
    }

    await this.prisma.siteImage.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'APPLYING' } });
    const outcomes: ApplyOutcome[] = [];

    try {
      if (capability === 'wordpress') {
        const Adapter = getAdapter(type) as any;
        const adapter = new Adapter(decryptCredentials(target.credentials as Record<string, any>), target.config ?? {});
        for (const row of rows) {
          const alt = row.approvedAlt ?? '';
          const pages: PageResult[] = [];
          for (const [i, pageUrl] of this.pagesOf(row).entries()) {
            const r = await adapter.applyImageAlt({
              pageUrl, srcRaw: row.srcRaw, src: row.src, wpAttachmentId: row.wpAttachmentId, alt,
              updateMedia: i === 0, updateContent: true,
            }).catch((e: any) => ({ ok: false, applied: [], skipped: [{ field: 'all', reason: String(e?.message ?? e).slice(0, 200) }] }));
            pages.push({ pageUrl, applied: r.applied, skipped: r.skipped, previous: r.previous });
            await sleep(GAP_MS);
          }
          outcomes.push(await this.finish(siteId, row, alt, pages, type, userId));
        }
      } else {
        // Statik: sayfa basina TEK yazim, o sayfadaki tum gorseller birlikte
        const byPage = new Map<string, typeof rows>();
        for (const row of rows) for (const p of this.pagesOf(row)) byPage.set(p, [...(byPage.get(p) ?? []), row]);
        const perRow = new Map<string, PageResult[]>();
        for (const [pageUrl, pageRows] of byPage) {
          const res = await this.staticFixer.writeImageAlts(siteId, pageUrl, pageRows.map((r) => ({
            id: r.id, srcRaw: r.srcRaw, src: r.src, wpAttachmentId: r.wpAttachmentId, alt: r.approvedAlt ?? '',
          })));
          for (const r of pageRows) {
            const pr = res.perImage[r.id];
            perRow.set(r.id, [...(perRow.get(r.id) ?? []), {
              pageUrl,
              applied: pr?.changed ? ['page_html'] : [],
              skipped: pr?.changed ? [] : [{ field: 'page_html', reason: res.error ?? pr?.reason ?? 'not_found' }],
              previous: pr ? { contentAlt: pr.oldAlt } : undefined,
            }]);
          }
          await sleep(GAP_MS);
        }
        for (const row of rows) outcomes.push(await this.finish(siteId, row, row.approvedAlt ?? '', perRow.get(row.id) ?? [], type, userId));
      }
    } catch (err: any) {
      // Beklenmeyen hata: APPLYING'de kalmasin
      const done = new Set(outcomes.map((o) => o.id));
      await this.prisma.siteImage.updateMany({
        where: { id: { in: rows.filter((r) => !done.has(r.id)).map((r) => r.id) }, status: 'APPLYING' },
        data: { status: 'FAILED', suggestionNote: `Yazim hatasi: ${String(err?.message ?? err).slice(0, 200)}` },
      });
      throw err;
    }
    return { outcomes };
  }

  /** Sonucu kaydet, sayfada dogrula, durumu yaz */
  private async finish(siteId: string, row: any, alt: string, pages: PageResult[], adapter: string, userId?: string): Promise<ApplyOutcome> {
    const anyWrite = pages.some((p) => p.applied.length > 0);
    const allPagesWritten = pages.length > 0 && pages.every((p) => p.applied.some((a) => a !== 'media_library'));
    let status: ApplyOutcome['status'] = !anyWrite ? 'FAILED' : allPagesWritten && row.pageCount <= pages.length ? 'APPLIED' : 'PARTIAL';

    if (anyWrite && (await this.verifyOnPage(row.firstPageUrl, row, alt))) status = 'VERIFIED';

    const note = !anyWrite
      ? pages.flatMap((p) => p.skipped.map((s) => s.reason))[0] ?? 'Yazilamadi'
      : row.pageCount > pages.length ? `Gorsel ${row.pageCount} sayfada; ilk ${pages.length} sayfa guncellendi` : undefined;

    await this.prisma.siteImage.update({
      where: { id: row.id },
      data: {
        status,
        appliedAt: anyWrite ? new Date() : row.appliedAt,
        suggestionNote: note ? note.slice(0, 255) : row.suggestionNote,
        applyDetail: { at: new Date().toISOString(), adapter, alt, pages } as any,
      },
    });
    await this.appliedFix.kaydet({
      siteId,
      userId: userId ?? null,
      kind: 'image_alt',
      fixType: 'image_alt',
      target: row.src,
      status: anyWrite ? 'APPLIED' : 'FAILED',
      error: anyWrite ? null : note ?? null,
      adapter,
      detail: { imageId: row.id, alt, pages: pages.map((p) => ({ pageUrl: p.pageUrl, applied: p.applied, previous: p.previous })) },
    });
    return { id: row.id, status, pages, note };
  }

  /** Yazimdan sonra canli sayfada alt'i gor (CDN onbellegi geciktirebilir — o zaman APPLIED kalir) */
  private async verifyOnPage(pageUrl: string, row: any, alt: string): Promise<boolean> {
    try {
      const res = await fetch(pageUrl + (pageUrl.includes('?') ? '&' : '?') + '_rc=' + Date.now(), {
        headers: { 'User-Agent': 'RanksUp-Crawler/1.0 (+https://ranksup.ai)', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return false; }
      const body = await readBodyCapped(res, 2 * 1024 * 1024);
      if (!body) return false;
      const { hits } = findImgTags(body.text, { srcRaw: row.srcRaw, src: row.src, wpAttachmentId: row.wpAttachmentId });
      return hits.length > 0 && hits.every((h) => readAlt(h.tag) === alt);
    } catch {
      return false;
    }
  }

  /**
   * Geri al: onceki degerleri, YALNIZCA bizim yazdigimiz alt hala duruyorsa
   * geri yazar (kullanici o arada degistirdiyse dokunmaz).
   */
  async revert(siteId: string, id: string, userId?: string): Promise<{ ok: boolean; status: string; note?: string }> {
    const row = await this.prisma.siteImage.findFirst({ where: { id, siteId } });
    if (!row) return { ok: false, status: 'NOT_FOUND' };
    const detail: any = row.applyDetail;
    if (!detail?.pages?.length || !['APPLIED', 'PARTIAL', 'VERIFIED'].includes(row.status)) {
      return { ok: false, status: row.status, note: 'Geri alinacak bir yazim yok' };
    }
    const target = await this.defaultTarget(siteId);
    const type = String(target?.type ?? '');
    const applied = String(detail.alt ?? '');
    let reverted = 0;

    if (type === 'WORDPRESS_REST' && target) {
      const Adapter = getAdapter(type) as any;
      const adapter = new Adapter(decryptCredentials(target.credentials as Record<string, any>), target.config ?? {});
      for (const p of detail.pages as PageResult[]) {
        const prev = p.previous ?? {};
        if (p.applied.includes('media_library')) {
          const r = await adapter.applyImageAlt({ pageUrl: p.pageUrl, srcRaw: row.srcRaw, src: row.src, wpAttachmentId: prev.mediaId ?? row.wpAttachmentId, alt: prev.mediaAlt ?? '', updateMedia: true, updateContent: false, expectCurrentAlt: applied });
          reverted += r.applied.length;
        }
        if (p.applied.includes('post_content')) {
          const r = await adapter.applyImageAlt({ pageUrl: p.pageUrl, srcRaw: row.srcRaw, src: row.src, wpAttachmentId: row.wpAttachmentId, alt: prev.contentAlt ?? null, updateMedia: false, updateContent: true, expectCurrentAlt: applied });
          reverted += r.applied.length;
        }
        await sleep(GAP_MS);
      }
    } else if (FILE_TARGETS.includes(type)) {
      for (const p of detail.pages as PageResult[]) {
        if (!p.applied.length) continue;
        const r = await this.staticFixer.writeImageAlts(siteId, p.pageUrl, [{
          id: row.id, srcRaw: row.srcRaw, src: row.src, wpAttachmentId: row.wpAttachmentId,
          alt: p.previous?.contentAlt ?? null, expectCurrentAlt: applied,
        }]);
        if (r.perImage[row.id]?.changed) reverted++;
      }
    } else {
      return { ok: false, status: row.status, note: 'Yayin hedefi degisti — geri alma bu hedefte yapilamiyor' };
    }

    const status = reverted > 0 ? 'APPROVED' : row.status;
    await this.prisma.siteImage.update({
      where: { id: row.id },
      data: {
        status,
        suggestionNote: reverted > 0 ? 'Geri alindi — onay duruyor, istersen tekrar uygula' : 'Geri alinamadi: alt o arada degismis olabilir',
      },
    });
    await this.appliedFix.kaydet({
      siteId, userId: userId ?? null, kind: 'image_alt', fixType: 'image_alt_revert', target: row.src,
      status: reverted > 0 ? 'REVERTED' : 'FAILED', adapter: type, detail: { imageId: row.id, reverted },
    });
    return { ok: reverted > 0, status };
  }
}
