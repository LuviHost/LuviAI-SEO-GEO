import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../../common/safe-fetch.js';

const adapterCalls: any[] = [];
let adapterReply: (p: any) => any = () => ({ ok: true, applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', postId: 9, postType: 'posts', contentAlt: null } });

vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  class FakeAdapter {
    async applyImageAlt(p: any) { adapterCalls.push(p); return adapterReply(p); }
  }
  return { ...real, getAdapter: () => FakeAdapter };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
// Dogrulama okumasi SSRF korumali safeFetchText ile yapilir — global fetch degil
const fetchMock = vi.fn();
vi.mock('../../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { ImageAltApplyService } = await import('./image-alt-apply.service.js');

const ROW = {
  id: 'img1', siteId: 's1', src: 'https://x.com/u/a.jpg', srcRaw: '/u/a.jpg', wpAttachmentId: 5,
  firstPageUrl: 'https://x.com/yazi/', samplePages: ['https://x.com/yazi/'], pageCount: 1,
  status: 'APPROVED', approvedAlt: 'Kırmızı bisiklet', appliedAt: null, suggestionNote: null, applyDetail: null,
};

function build(opts: { targetType?: string; rows?: any[]; credentials?: Record<string, unknown> } = {}) {
  const rows = opts.rows ?? [ROW];
  const updates: any[] = [];
  const prisma = {
    siteImage: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => where.status.in.includes(r.status))),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: vi.fn(async () => ({ count: rows.length })),
      update: vi.fn(async (a: any) => { updates.push(a); return {}; }),
    },
    publishTarget: { findFirst: vi.fn(async () => ({ type: opts.targetType ?? 'WORDPRESS_REST', credentials: opts.credentials ?? {}, config: {} })) },
  };
  const appliedFix = { kaydet: vi.fn(async () => {}) };
  const staticFixer = { writeImageAlts: vi.fn(async (_s: string, _p: string, items: any[]) => ({ ok: true, perImage: Object.fromEntries(items.map((i) => [i.id, { changed: true, oldAlt: null }])) })) };
  const svc = new ImageAltApplyService(prisma as any, appliedFix as any, staticFixer as any);
  return { svc, prisma, appliedFix, staticFixer, updates };
}

const page = (text: string, status = 200, headers: Record<string, string> = {}): SafeTextResult => ({
  status, ok: status >= 200 && status < 300, url: 'https://x.com/yazi/', redirected: false,
  contentType: 'text/html', headers, text, truncated: false, binary: false,
});
const pageWith = (alt: string | null) => page(`<html><body><img src="/u/a.jpg" class="wp-image-5"${alt === null ? '' : ` alt="${alt}"`}></body></html>`);

beforeEach(() => { adapterCalls.length = 0; fetchMock.mockReset(); });

describe('ImageAltApplyService.applyMany', () => {
  it('WordPress: medya + icerik yazilir, sayfada dogrulanir → VERIFIED; AppliedFix kaydi', async () => {
    fetchMock.mockResolvedValue(pageWith('Kırmızı bisiklet'));
    const { svc, appliedFix, updates } = build();
    const r = await svc.applyMany('s1', ['img1'], 'u1');
    expect(r.outcomes[0].status).toBe('VERIFIED');
    expect(adapterCalls[0]).toMatchObject({ alt: 'Kırmızı bisiklet', updateMedia: true, updateContent: true, pageUrl: 'https://x.com/yazi/' });
    expect(updates.at(-1).data.status).toBe('VERIFIED');
    expect(updates.at(-1).data.applyDetail.pages[0].previous).toMatchObject({ mediaAlt: '', contentAlt: null });
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image_alt', status: 'APPLIED', userId: 'u1' }));
  });

  it('canli sayfada henuz gorunmuyorsa (CDN) APPLIED kalir', async () => {
    fetchMock.mockResolvedValue(pageWith(null));
    const { svc } = build();
    expect((await svc.applyMany('s1', ['img1'])).outcomes[0].status).toBe('APPLIED');
  });

  it('hicbir yere yazilamadiysa FAILED + neden', async () => {
    adapterReply = () => ({ ok: false, applied: [], skipped: [{ field: 'post_content', reason: 'Gorsel gonderi iceriginde yok' }] });
    fetchMock.mockResolvedValue(pageWith(null));
    const { svc, appliedFix } = build();
    const r = await svc.applyMany('s1', ['img1']);
    expect(r.outcomes[0]).toMatchObject({ status: 'FAILED', note: 'Gorsel gonderi iceriginde yok' });
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    adapterReply = () => ({ ok: true, applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', postId: 9, postType: 'posts', contentAlt: null } });
  });

  it('dogrulama istegi onbellegi atlatir (_rc + no-cache), durust bot kimligiyle gider', async () => {
    fetchMock.mockResolvedValue(pageWith('Kırmızı bisiklet'));
    const { svc } = build();
    await svc.applyMany('s1', ['img1']);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get('_rc')).toMatch(/^\d+$/);
    expect(new URL(url).pathname).toBe('/yazi/');
    expect(opts.headers).toMatchObject({ 'cache-control': 'no-cache' });
    expect(opts.userAgent).toBeUndefined();
  });

  it('bot dogrulama ekrani (200) dogrulama sayilmaz → APPLIED kalir', async () => {
    fetchMock.mockResolvedValue(page('<html><head><title>Just a moment...</title></head><body><img src="/u/a.jpg" alt="Kırmızı bisiklet"></body></html>'));
    const { svc } = build();
    expect((await svc.applyMany('s1', ['img1'])).outcomes[0].status).toBe('APPLIED');
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
    fetchMock.mockResolvedValue(page('<img src="/u/a.jpg"><img src="/u/b.jpg">'));
    const rows = [ROW, { ...ROW, id: 'img2', src: 'https://x.com/u/b.jpg', srcRaw: '/u/b.jpg', wpAttachmentId: null }];
    const { svc, staticFixer } = build({ targetType: 'SFTP', rows });
    await svc.applyMany('s1', ['img1', 'img2']);
    expect(staticFixer.writeImageAlts).toHaveBeenCalledTimes(1);
    expect((staticFixer.writeImageAlts.mock.calls[0] as any)[2].map((i: any) => i.id)).toEqual(['img1', 'img2']);
  });
});

describe('ImageAltApplyService — yayin hedefi adres denetimi', () => {
  const APPLIED_ROW = { ...ROW, status: 'VERIFIED', applyDetail: { alt: 'Kırmızı bisiklet', pages: [{ pageUrl: 'https://x.com/yazi/', applied: ['media_library', 'post_content'], skipped: [], previous: { mediaId: 5, mediaAlt: '', contentAlt: null } }] } };

  it('ic ag adresli WordPress hedefine yazilmaz; gorsel durumu DEGISMEZ (onay korunur), neden listede gorunur', async () => {
    const { svc, prisma, appliedFix } = build({ credentials: { siteUrl: 'http://169.254.169.254' } });
    const r = await svc.applyMany('s1', ['img1']);
    const reason = 'Yayın hedefine bağlanılmadı — Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.';
    expect(r.outcomes).toEqual([{ id: 'img1', status: 'FAILED', pages: [], note: reason }]);
    expect(adapterCalls).toEqual([]);
    // Yalniz not yazilir — status (APPLYING/FAILED) degismez
    expect(prisma.siteImage.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.siteImage.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['img1'] } }, data: { suggestionNote: reason } });
    expect(prisma.siteImage.update).not.toHaveBeenCalled();
    expect(appliedFix.kaydet).not.toHaveBeenCalled();
  });

  it('statik hedef de once denetlenir: sayfa okunmaz, yazim denenmez', async () => {
    const { svc, staticFixer } = build({ targetType: 'SFTP', credentials: { host: '192.168.0.10' } });
    const r = await svc.applyMany('s1', ['img1']);
    expect(r.outcomes[0]).toMatchObject({ status: 'FAILED' });
    expect(r.outcomes[0].note).toContain('Host');
    expect(staticFixer.writeImageAlts).not.toHaveBeenCalled();
  });

  it('geri alma: ic ag adresli hedefe istek yok; not gercek nedeni soyler ("alt degismis" degil)', async () => {
    const { svc, updates, appliedFix } = build({ rows: [APPLIED_ROW], credentials: { siteUrl: 'http://10.0.0.1' } });
    const r = await svc.revert('s1', 'img1', 'u1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('VERIFIED');
    expect(r.note).toBe('Geri alinamadi: Yayın hedefine bağlanılmadı — Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(adapterCalls).toEqual([]);
    expect(updates.at(-1).data.status).toBe('VERIFIED');
    expect(appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', fixType: 'image_alt_revert', error: expect.stringContaining('Yayın hedefine bağlanılmadı') }));
  });

  it('statik geri alma yazilamadiysa not yazim hatasini tasir', async () => {
    const { svc, staticFixer, updates } = build({ targetType: 'SFTP', rows: [APPLIED_ROW] });
    staticFixer.writeImageAlts.mockResolvedValueOnce({ ok: false, error: 'Sayfa 2 MB okuma sinirini asiyor (https://x.com/yazi/) — yazilmadi', perImage: {} } as any);
    const r = await svc.revert('s1', 'img1');
    expect(r).toMatchObject({ ok: false, status: 'VERIFIED' });
    expect(r.note).toContain('2 MB');
    expect(updates.at(-1).data.suggestionNote).toContain('2 MB');
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
