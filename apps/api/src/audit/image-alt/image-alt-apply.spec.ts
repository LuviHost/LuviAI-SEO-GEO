import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const adapterCalls: any[] = [];
let adapterReply: (p: any) => any = () => ({ ok: true, applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', postId: 9, postType: 'posts', contentAlt: null } });

vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  class FakeAdapter {
    async applyImageAlt(p: any) { adapterCalls.push(p); return adapterReply(p); }
  }
  return { ...real, getAdapter: () => FakeAdapter };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: () => ({}) }));

const { ImageAltApplyService } = await import('./image-alt-apply.service.js');

const ROW = {
  id: 'img1', siteId: 's1', src: 'https://x.com/u/a.jpg', srcRaw: '/u/a.jpg', wpAttachmentId: 5,
  firstPageUrl: 'https://x.com/yazi/', samplePages: ['https://x.com/yazi/'], pageCount: 1,
  status: 'APPROVED', approvedAlt: 'Kırmızı bisiklet', appliedAt: null, suggestionNote: null, applyDetail: null,
};

function build(opts: { targetType?: string; rows?: any[] } = {}) {
  const rows = opts.rows ?? [ROW];
  const updates: any[] = [];
  const prisma = {
    siteImage: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => where.status.in.includes(r.status))),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: vi.fn(async () => ({ count: rows.length })),
      update: vi.fn(async (a: any) => { updates.push(a); return {}; }),
    },
    publishTarget: { findFirst: vi.fn(async () => ({ type: opts.targetType ?? 'WORDPRESS_REST', credentials: {}, config: {} })) },
  };
  const appliedFix = { kaydet: vi.fn(async () => {}) };
  const staticFixer = { writeImageAlts: vi.fn(async (_s: string, _p: string, items: any[]) => ({ ok: true, perImage: Object.fromEntries(items.map((i) => [i.id, { changed: true, oldAlt: null }])) })) };
  const svc = new ImageAltApplyService(prisma as any, appliedFix as any, staticFixer as any);
  return { svc, prisma, appliedFix, staticFixer, updates };
}

const pageWith = (alt: string | null) => new Response(`<html><body><img src="/u/a.jpg" class="wp-image-5"${alt === null ? '' : ` alt="${alt}"`}></body></html>`, { status: 200 });

beforeEach(() => { adapterCalls.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('ImageAltApplyService.applyMany', () => {
  it('WordPress: medya + icerik yazilir, sayfada dogrulanir → VERIFIED; AppliedFix kaydi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageWith('Kırmızı bisiklet')));
    const { svc, appliedFix, updates } = build();
    const r = await svc.applyMany('s1', ['img1'], 'u1');
    expect(r.outcomes[0].status).toBe('VERIFIED');
    expect(adapterCalls[0]).toMatchObject({ alt: 'Kırmızı bisiklet', updateMedia: true, updateContent: true, pageUrl: 'https://x.com/yazi/' });
    expect(updates.at(-1).data.status).toBe('VERIFIED');
    expect(updates.at(-1).data.applyDetail.pages[0].previous).toMatchObject({ mediaAlt: '', contentAlt: null });
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image_alt', status: 'APPLIED', userId: 'u1' }));
  });

  it('canli sayfada henuz gorunmuyorsa (CDN) APPLIED kalir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pageWith(null)));
    const { svc } = build();
    expect((await svc.applyMany('s1', ['img1'])).outcomes[0].status).toBe('APPLIED');
  });

  it('hicbir yere yazilamadiysa FAILED + neden', async () => {
    adapterReply = () => ({ ok: false, applied: [], skipped: [{ field: 'post_content', reason: 'Gorsel gonderi iceriginde yok' }] });
    vi.stubGlobal('fetch', vi.fn(async () => pageWith(null)));
    const { svc, appliedFix } = build();
    const r = await svc.applyMany('s1', ['img1']);
    expect(r.outcomes[0]).toMatchObject({ status: 'FAILED', note: 'Gorsel gonderi iceriginde yok' });
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    adapterReply = () => ({ ok: true, applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', postId: 9, postType: 'posts', contentAlt: null } });
  });

  it('yazamayan hedef (Ghost) → kopyala-yapistir, siteye dokunulmaz', async () => {
    const { svc, prisma } = build({ targetType: 'GHOST' });
    const r = await svc.applyMany('s1', ['img1']);
    expect(r.outcomes[0].status).toBe('SNIPPET');
    expect(prisma.siteImage.updateMany).not.toHaveBeenCalled();
    expect(adapterCalls).toEqual([]);
  });

  it('onaylanmamis gorsel YAZILMAZ', async () => {
    const { svc } = build({ rows: [{ ...ROW, status: 'SUGGESTED' }] });
    expect((await svc.applyMany('s1', ['img1'])).outcomes).toEqual([]);
    expect(adapterCalls).toEqual([]);
  });

  it('statik site: ayni sayfadaki gorseller TEK yazimda', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<img src="/u/a.jpg"><img src="/u/b.jpg">', { status: 200 })));
    const rows = [ROW, { ...ROW, id: 'img2', src: 'https://x.com/u/b.jpg', srcRaw: '/u/b.jpg', wpAttachmentId: null }];
    const { svc, staticFixer } = build({ targetType: 'SFTP', rows });
    await svc.applyMany('s1', ['img1', 'img2']);
    expect(staticFixer.writeImageAlts).toHaveBeenCalledTimes(1);
    expect((staticFixer.writeImageAlts.mock.calls[0] as any)[2].map((i: any) => i.id)).toEqual(['img1', 'img2']);
  });
});

describe('ImageAltApplyService.revert', () => {
  it('onceki degerler geri yazilir; yalnizca bizim alt duruyorsa (expectCurrentAlt)', async () => {
    const applied = { ...ROW, status: 'VERIFIED', applyDetail: { alt: 'Kırmızı bisiklet', pages: [{ pageUrl: 'https://x.com/yazi/', applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', contentAlt: null } }] } };
    const { svc, appliedFix, updates } = build({ rows: [applied] });
    const r = await svc.revert('s1', 'img1', 'u1');
    expect(r).toMatchObject({ ok: true, status: 'APPROVED' });
    expect(adapterCalls).toEqual([
      expect.objectContaining({ updateMedia: true, updateContent: false, alt: '', expectCurrentAlt: 'Kırmızı bisiklet' }),
      expect.objectContaining({ updateMedia: false, updateContent: true, alt: null, expectCurrentAlt: 'Kırmızı bisiklet' }),
    ]);
    expect(updates.at(-1).data.status).toBe('APPROVED');
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ status: 'REVERTED', fixType: 'image_alt_revert' }));
  });
});
