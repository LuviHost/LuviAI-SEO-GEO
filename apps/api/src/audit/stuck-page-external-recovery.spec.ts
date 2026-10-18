import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../jobs/job-queue.service.js', () => ({ JobQueueService: class {} }));
const published: any[] = [];
vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  class FakeAdapter {
    constructor(public credentials: any, public config: any) {}
    async publish(p: any) { published.push({ ...p, config: this.config }); return { ok: true }; }
  }
  return { ...real, getAdapter: () => FakeAdapter };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
const { StuckPageExternalRecoveryService } = await import('./stuck-page-external-recovery.service.js');

const URL_ = 'https://site.com/yazi/';
/** Dizin bicimli adresin statik dosyasi: /yazi/ → /yazi/index.html */
const FILE_URL = 'https://site.com/yazi/index.html';
const res = (r: Partial<SafeTextResult> & { status: number }): SafeTextResult => ({
  ok: r.status >= 200 && r.status < 300, url: URL_, redirected: false, contentType: 'text/html',
  headers: {}, text: '', truncated: false, binary: false, ...r,
});
const ARTICLE = `<html><head><meta charset="utf-8"><meta name="description" content="Uzun bir paragraf metni."></head><body><article>${'Uzun bir paragraf metni. '.repeat(20)}</article></body></html>`;
const OK_PAGE = (text = ARTICLE) => res({ status: 200, text, headers: { 'content-type': 'text/html; charset=utf-8' } });
/** Statik dosya: ayni govde, dosya tarihi var, cerez yok */
const STATIC_FILE = (text = ARTICLE) => res({ status: 200, url: FILE_URL, text, headers: { 'content-type': 'text/html; charset=utf-8', 'last-modified': 'Tue, 01 Sep 2026 10:00:00 GMT' } });

/** Sayfa ve (varsa) dosya adresi icin yanit */
function serve(page: SafeTextResult, file?: SafeTextResult) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === URL_) return page;
    if (file && url === FILE_URL) return file;
    return res({ status: 404, url });
  });
}

function build(targets: any[] = [], site: Record<string, unknown> = {}, status = 'DETECTED') {
  const updates: any[] = [];
  const recoveries: any[] = [];
  const sp: Record<string, any> = { id: 'sp1', url: URL_, articleId: null, siteId: 's1', title: 'Yazı', topQueries: [], position: 12, impressions: 100, ctr: 0.01, status };
  const prisma = {
    stuckPage: {
      findUnique: vi.fn(async () => ({ ...sp })),
      update: vi.fn(async (a: any) => { updates.push(a); Object.assign(sp, a.data); return {}; }),
      // Kosullu durum gecisi (tek UPDATE ... WHERE status gibi): yalniz eslesirse yazilir
      updateMany: vi.fn(async (a: any) => {
        const want = a.where.status;
        const ok = want === undefined || (typeof want === 'string' ? sp.status === want : (want.in as string[]).includes(sp.status));
        if (a.where.id !== sp.id || !ok) return { count: 0 };
        updates.push(a);
        Object.assign(sp, a.data);
        return { count: 1 };
      }),
    },
    publishTarget: { findMany: vi.fn(async () => targets) },
    stuckPageRecovery: { create: vi.fn(async (a: any) => { recoveries.push(a); return { id: 'rec1' }; }) },
    site: { findUnique: vi.fn(async () => ({ url: 'https://site.com', platform: null, name: 'Site', userId: 'u1', ...site })) },
  };
  const geo = { runAudit: vi.fn(async () => ({ score: 50, methods: [], queries: [] })) };
  const webhook = { notify: vi.fn(async () => null) };
  const jobs = { enqueue: vi.fn(async () => null) };
  const svc = new StuckPageExternalRecoveryService(prisma as any, webhook as any, geo as any, jobs as any);
  // LLM cagrisi yok: sayfada GERCEKTEN bulunan bir cumle icin sabit oneri
  vi.spyOn(svc as any, 'proposeEdits').mockResolvedValue({
    diagnosis: 'test',
    edits: [{ type: 'sentence_replace', before: 'Uzun bir paragraf metni.', after: 'Daha net bir paragraf.', reason: 'netlik' }],
    entitiesAdded: [],
    paragraphAdded: null,
    entityScoreEstimate: 60,
  });
  return { svc, updates, geo, recoveries, webhook, jobs, prisma, sp };
}

beforeEach(() => { fetchMock.mockReset(); published.length = 0; });

describe('StuckPageExternalRecoveryService — sayfanin yerine yazilacak HTML guvenilir olmali', () => {
  it('engel sayfasi kaynak olamaz: FAILED + neden ve izin talimati; LLM/GEO calismaz', async () => {
    fetchMock.mockResolvedValue(res({ status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' }));
    const { svc, updates, geo } = build();
    const r = await svc.recover('sp1', { triggeredBy: 'test' });
    expect(r.success).toBe(false);
    expect(r.reason).toContain('RanksUpBot');
    expect(updates.at(-1).data.status).toBe('FAILED');
    expect(geo.runAudit).not.toHaveBeenCalled();
  });

  it('2 MB tavaninda kesilen govde kaynak olamaz (sayfanin geri kalanini silerdi)', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: ARTICLE, truncated: true }));
    const { svc } = build();
    const r = await svc.recover('sp1', { triggeredBy: 'test' });
    expect(r).toMatchObject({ success: false });
    expect(r.reason).toContain('2 MB');
  });

  it('UTF-8 disi sayfa kaynak olamaz (adaptorler UTF-8 yazar)', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: ARTICLE, headers: { 'content-type': 'text/html; charset=windows-1254' } }));
    const { svc } = build();
    const r = await svc.recover('sp1', { triggeredBy: 'test' });
    expect(r.success).toBe(false);
    expect(r.reason).toContain('windows-1254');
  });
});

/**
 * K24: tam sayfa HTML'i (baslik, menu, alt bilgi, betikler) CMS hedefinde
 * yazinin ICERIGININ yerine gecerdi. CMS'te adaptor.publish HIC cagrilmaz;
 * oneri denetim kaydina yazilir, kullanici elle uygular.
 */
describe('StuckPageExternalRecoveryService — CMS hedefine yazilmaz, oneri kaydedilir', () => {
  it.each(['WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'KOBIPRATIK', 'CUSTOM_PHP'])('%s: adaptor.publish yok, oneri kaydi + "elle uygula"', async (type) => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([{ type, credentials: { siteUrl: 'https://93.184.216.34' }, config: {} }]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'manual' });

    expect(published).toEqual([]);
    expect(r).toMatchObject({ success: false, manual: true, recoveryId: 'rec1', editsCount: 1 });
    expect(r.reason).toContain('otomatik yazılmaz');
    expect(r.reason).toContain('elle uygula');
    // Oneri denetim kaydinda: once/sonra HTML ve cumle degisikligi
    expect(t.recoveries).toHaveLength(1);
    expect(t.recoveries[0].data).toMatchObject({ stuckPageId: 'sp1', bodyHtmlBefore: ARTICLE, appliedBy: 'manual' });
    expect(t.recoveries[0].data.edits).toEqual([expect.objectContaining({ before: 'Uzun bir paragraf metni.', after: 'Daha net bir paragraf.' })]);
    // Uygulanmadi: basarisiz da duzeltildi de sayilmaz; bildirim ve etki olcumu yok
    expect(t.updates.at(-1).data.status).toBe('DETECTED');
    expect(t.webhook.notify).not.toHaveBeenCalled();
    expect(t.jobs.enqueue).not.toHaveBeenCalled();
    // Dosya adresi bile okunmaz (CMS'te dogrulanacak dosya yok)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([URL_]);
  });

  it('hic yayin hedefi yoksa da oneri kaydedilir, yazim yok', async () => {
    serve(OK_PAGE());
    const t = build([]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(published).toEqual([]);
    expect(r).toMatchObject({ success: false, manual: true, recoveryId: 'rec1' });
    expect(r.reason).toContain('FTP, SFTP ya da cPanel');
    expect(t.updates.at(-1).data.status).toBe('DETECTED');
  });

  it('FTP hedefi olsa da sayfa WordPress ise (kok dosyalar icin eklenmis FTP) yazilmaz', async () => {
    const wp = ARTICLE.replace('</head>', '<link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>');
    serve(OK_PAGE(wp), STATIC_FILE(wp));
    const t = build([{ type: 'FTP', credentials: { host: '93.184.216.34' }, config: { remotePath: '/public_html' } }]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'manual' });
    expect(published).toEqual([]);
    expect(r).toMatchObject({ manual: true });
    expect(r.reason).toContain('WordPress tarafından üretiliyor');
  });
});

describe('StuckPageExternalRecoveryService — statik dosya hedefi', () => {
  const FTP = (host = '93.184.216.34') => ({ type: 'FTP', credentials: { host }, config: { remotePath: '/public_html' } });

  it('sayfayi sunan dosya dogrulaninca o dosyanin yerine yazilir (klasor ve ad adresten)', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP()]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'test' });
    expect(r).toMatchObject({ success: true, recoveryId: 'rec1', editsCount: 1 });
    expect(r.manual).toBeUndefined();
    expect(published).toHaveLength(1);
    // /yazi/ → public_html/yazi/index.html (eskiden "yazi.html" yaziliyordu)
    expect(published[0]).toMatchObject({ slug: 'index', config: { remotePath: '/public_html/yazi' } });
    // Duzenleme govdede; <head>'deki ayni cumle (meta aciklama) degismez
    expect(published[0].bodyHtml).toContain('<article>Daha net bir paragraf.');
    expect(published[0].bodyHtml).toContain('<meta name="description" content="Uzun bir paragraf metni.">');
    expect(t.updates.at(-1).data.status).toBe('RECOVERED');
    expect(t.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'STUCK_PAGE_PERFORMANCE_CHECK' }));
  });

  it('dosya adresi sayfayla ayni icerigi vermiyorsa (dinamik ya da arada degisti) yazilmaz', async () => {
    serve(OK_PAGE(), STATIC_FILE(ARTICLE.replace('</article>', '<p>yeni</p></article>')));
    const t = build([FTP()]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'test' });
    expect(published).toEqual([]);
    expect(r).toMatchObject({ success: false, manual: true, recoveryId: 'rec1' });
    expect(r.reason).toContain('aynı değil');
    expect(t.updates.at(-1).data.status).toBe('DETECTED');
  });

  it('dosya adresi yoksa (404) ya da oturum cerezi veriyorsa yazilmaz', async () => {
    serve(OK_PAGE());
    const a = build([FTP()]);
    expect((await a.svc.recover('sp1', { triggeredBy: 'test' })).reason).toContain('HTTP 404');

    serve(OK_PAGE(), res({ ...STATIC_FILE(), headers: { 'last-modified': 'x', 'set-cookie': 'PHPSESSID=1; path=/' } }));
    const b = build([FTP()]);
    expect((await b.svc.recover('sp1', { triggeredBy: 'test' })).reason).toContain('PHPSESSID');
    expect(published).toEqual([]);
  });

  it('ic aga cevrilmis hedefe yazilmaz: FAILED + Turkce neden, adaptor istegi yok', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP('192.168.1.10')]);
    const r = await t.svc.recover('sp1', { triggeredBy: 'test' });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('Yayın hedefine bağlanılmadı — Host: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(t.updates.at(-1).data.status).toBe('FAILED');
    expect(published).toEqual([]);
    expect(t.recoveries).toEqual([]);
  });

  it('yeni metin kacislanir ve "$&" gibi kaliplar acilmaz', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP()]);
    vi.spyOn(t.svc as any, 'proposeEdits').mockResolvedValue({
      diagnosis: 'x',
      edits: [{ type: 'sentence_replace', before: 'Uzun bir paragraf metni.', after: 'Fiyat <b>$&</b> & "indirim"', reason: 'r' }],
      entitiesAdded: [], paragraphAdded: null, entityScoreEstimate: 50,
    });
    await t.svc.recover('sp1', { triggeredBy: 'test' });
    expect(published[0].bodyHtml).toContain('<article>Fiyat &lt;b&gt;$&amp;&lt;/b&gt; &amp; &quot;indirim&quot;');
  });
});

describe('StuckPageExternalRecoveryService — R13: atomik sahiplenme, karar ezilmez', () => {
  const FTP = { type: 'FTP', credentials: { host: '93.184.216.34' }, config: { remotePath: '/public_html' } };

  it('gozardi edilmis, duzeltilmis ya da islemdeki sayfa: sayfa indirilmez, yapay zeka cagrilmaz, durum degismez', async () => {
    for (const status of ['IGNORED', 'RECOVERED', 'RECOVERING', 'REVERTED']) {
      serve(OK_PAGE(), STATIC_FILE());
      const t = build([FTP], {}, status);
      const r = await t.svc.recover('sp1', { triggeredBy: 'user-7' });
      expect(r, status).toMatchObject({ success: false, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(t.updates).toEqual([]);
      expect(t.sp.status).toBe(status);
      expect(published).toEqual([]);
    }
  });

  it('"Basarisiz" sayfa elle yeniden denenebilir; sahiplenme kosullu (okunan durum → RECOVERING, updatedAt = sahiplenme ani)', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP], {}, 'FAILED');
    expect(await t.svc.recover('sp1', { triggeredBy: 'user-7' })).toMatchObject({ success: true });
    expect(t.prisma.stuckPage.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'sp1', status: 'FAILED' }, data: { status: 'RECOVERING', updatedAt: expect.any(Date) } });
    expect(t.sp.status).toBe('RECOVERED');
  });

  it('ayni anda iki istek: yalniz biri sahiplenir; digeri hicbir sey yapmaz', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP]);
    const [a, b] = await Promise.all([t.svc.recover('sp1', { triggeredBy: 'u1' }), t.svc.recover('sp1', { triggeredBy: 'u1' })]);
    expect([a.success, b.success].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.success)).toMatchObject({ skipped: true, reason: 'Bu sayfanın düzeltmesi zaten sürüyor; hiçbir şey değiştirilmedi.' });
    expect(published).toHaveLength(1);
  });

  it('yapay zeka cagrisi surerken sayfa gozardi edildiyse dosya yazilmaz, karar korunur', async () => {
    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP]);
    (t.svc as any).proposeEdits.mockImplementationOnce(async () => {
      t.sp.status = 'IGNORED';
      return { diagnosis: 'x', edits: [{ type: 'sentence_replace', before: 'Uzun bir paragraf metni.', after: 'Daha net bir paragraf.', reason: 'r' }], entitiesAdded: [], paragraphAdded: null, entityScoreEstimate: 60 };
    });
    const r = await t.svc.recover('sp1', { triggeredBy: 'u1' });
    expect(r).toMatchObject({ success: false, skipped: true });
    expect(published).toEqual([]);
    expect(t.sp.status).toBe('IGNORED');
    expect(t.webhook.notify).not.toHaveBeenCalled();
  });

  it('basarisizlikta updatedAt acikca yazilir (haftalik tarama bekleme suresini buradan sayar); bildirim metni Turkce', async () => {
    fetchMock.mockResolvedValue(res({ status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' }));
    const f = build();
    await f.svc.recover('sp1', { triggeredBy: 'u1' });
    expect(f.updates.at(-1)).toEqual({ where: { id: 'sp1', status: 'RECOVERING' }, data: { status: 'FAILED', updatedAt: expect.any(Date) } });

    serve(OK_PAGE(), STATIC_FILE());
    const t = build([FTP]);
    await t.svc.recover('sp1', { triggeredBy: 'u1' });
    expect(t.webhook.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Takılı sayfa düzeltildi: Yazı',
      message: '1 cümle iyileştirildi, 0 kavram eklendi ve sayfanın dosyası FTP üzerinden güncellendi. Etkisi 30 gün sonra otomatik ölçülür.',
    }));
  });
});
