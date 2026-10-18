import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLOSED_STUCK_STATUSES, IN_PLACE_REPUBLISH_TARGET_TYPES, STUCK_AUTO_RECOVER_PER_SITE, STUCK_AUTO_RECOVER_SCAN, STUCK_FAILED_COOLDOWN_DAYS,
  STUCK_RECOVER_JOB_PRIORITY,
  STUCK_MEASUREMENT_WINDOW_DAYS, STUCK_REPUBLISH_PHASE, autoRecoveryBlock, autoRecoveryBlockText, isStuckRepublishJob, isStuckRepublishPayload,
  liveEntryAddressesUrl, planArticleRepublish, planStuckRepublish, recentStuckLiveWrite, republishBlockText, runStuckPageSweep,
  stuckArticleLiveBlock, stuckPageSweepSiteWhere, stuckRecoveryRoute,
} from './stuck-page-autopilot.js';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import {
  STUCK_ARTICLE_LIVE_COPY_BEHIND, STUCK_ARTICLE_NOT_LIVE, STUCK_ARTICLE_PENDING_VERSION, STUCK_ARTICLE_REWRITING, STUCK_ARTICLE_UNPUBLISHED_CHANGES,
} from './stuck-page-messages.js';
import { articleContentHash } from '../articles/republish-policy.js';
import { pivotRewritePlan } from '../articles/content-pivot.service.js';
import { findPlan } from '../billing/plans.js';

/**
 * Takili sayfa otopilotu: plan kapisi (Profesyonel), Yari otomatikte onaysiz
 * yeniden yayin yok, yalniz yazisi YERINDE guncellenebilen sayfalar otomatik
 * kurtarilir (G4), STUCK_PAGE_RECOVER yonlendirmesi dogrudan kimlikle.
 * I-1: WordPress yazisi yerinde guncellenir (adaptor update()).
 * F-C: yerinde guncellenecek kopya TAKILI ADRESIN KENDISI olmali (eski /yazi-2/
 * kopyasi guncellenip /yazi/ "Düzeltildi" sayiliyordu); onay bekleyen yeniden
 * yazimi olan, son 30 gunde yayinlanan ya da yakin zamanda basarisiz olan
 * sayfa otomatik kurtarilmaz; Markdown ZIP disa aktarimi engel sayilmaz.
 */

type Site = { id: string; userId: string; autopilot: boolean; publishApprovalMode: string; user: { plan: string } };
const site = (id: string, plan: string, publishApprovalMode = 'auto_publish', autopilot = true): Site => ({
  id, userId: `u-${id}`, autopilot, publishApprovalMode, user: { plan },
});

const NOW = new Date('2026-10-19T06:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** Takili adres: sitenin /blog/<slug>.html sayfasi */
const pageUrl = (siteId: string, slug: string) => `https://${siteId}.com/blog/${slug}.html`;
/** Her sitenin FTP hedefi var (remotePath /public_html/blog); yazilar orada yayinda — yerinde guncellenebilir */
const ftpTarget = (siteId: string) => ({ id: `ftp-${siteId}`, type: 'FTP', isActive: true });
const ftpEntry = (siteId: string, slug: string, over: Record<string, unknown> = {}) => ({
  targetId: `ftp-${siteId}`, targetType: 'FTP', ok: true, externalUrl: `ftp://h/public_html/blog/${slug}.html`, ...over,
});
/** Yayinda, kayit metni canlida (izsiz eski kayit + PUBLISHED), 60 gun once yazilmis */
const liveArticle = (siteId: string, slug: string, over: Record<string, unknown> = {}) => ({
  status: 'PUBLISHED', slug, title: slug, bodyMd: `# ${slug}\n\nMetin.`, publishedAt: daysAgo(90),
  publishedTo: [ftpEntry(siteId, slug, { updatedAt: daysAgo(60).toISOString() })],
  ...over,
});

/** Kapali (ya da baska durumdaki) eski takili sayfa satiri — findFirst bunlarda arar */
type OldRow = { siteId: string; url: string; status: string; updatedAt?: Date };
type Cand = { id: string; url?: string; article?: Record<string, unknown> | null };

function deps(
  sites: Site[],
  found: Record<string, number | Error>,
  stuck: Record<string, Cand[]> = {},
  targets: Record<string, Array<{ id: string; type: string; isActive: boolean }>> = {},
  oldRows: OldRow[] = [],
) {
  const prisma = {
    site: { findMany: vi.fn<(args: any) => Promise<any[]>>(async () => sites) },
    stuckPage: {
      findMany: vi.fn(async ({ where }: any) => (stuck[where.siteId] ?? []).map((sp) => ({
        url: pageUrl(where.siteId, sp.id), article: liveArticle(where.siteId, sp.id), ...sp,
      }))),
      // Dedektorun closedExisting sorgusu gibi: siteId + url birebir + status (in ya da tek) + updatedAt alt siniri
      findFirst: vi.fn(async ({ where }: any) => {
        const allowed: string[] = typeof where.status === 'string' ? [where.status] : where.status?.in ?? [];
        const since: Date | undefined = where.updatedAt?.gte;
        return oldRows.find((r) => r.siteId === where.siteId && r.url === where.url && allowed.includes(r.status)
          && (!since || (r.updatedAt !== undefined && r.updatedAt >= since))) ?? null;
      }),
    },
    publishTarget: { findMany: vi.fn(async ({ where }: any) => targets[where.siteId] ?? [ftpTarget(where.siteId)]) },
  };
  const detector = {
    detect: vi.fn(async (siteId: string) => {
      const f = found[siteId] ?? 0;
      if (f instanceof Error) throw f;
      return { found: f };
    }),
  };
  const jobs = { enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j', bullJobId: 'b' })) };
  const log = { log: vi.fn(), warn: vi.fn() };
  return { prisma, detector, jobs, log, now: () => NOW };
}

const queuedIds = (d: ReturnType<typeof deps>) => d.jobs.enqueue.mock.calls.map((c: any[]) => c[0].payload.stuckPageId);

describe('stuckPageSweepSiteWhere — haftalik tarama plan kapisi', () => {
  it('yalniz aktif siteler ve Takili Sayfalar\'i kapsayan planlar (Profesyonel ve ustu)', () => {
    const w = stuckPageSweepSiteWhere();
    expect(w.status).toEqual({ in: ['ACTIVE', 'AUDIT_COMPLETE'] });
    expect((w.user.plan.in as string[]).slice().sort()).toEqual(['AGENCY', 'ENTERPRISE', 'PRO']);
  });
});

describe('autoRecoveryBlock — otopilot yeniden yazip YAYINLAYABILIR mi', () => {
  it('Profesyonel + akis acik + Tam otomatik: serbest', () => {
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) expect(autoRecoveryBlock(site('s', plan)), plan).toBeNull();
  });

  it('alt plan / bilinmeyen plan: plan kapisi', () => {
    for (const plan of ['TRIAL', 'STARTER', 'GOLD', '']) expect(autoRecoveryBlock(site('s', plan)), plan).toBe('plan');
    expect(autoRecoveryBlock({ autopilot: true, publishApprovalMode: 'auto_publish', user: null })).toBe('plan');
  });

  it('akis kapali ya da Yari otomatik: onaysiz yayin yok', () => {
    expect(autoRecoveryBlock(site('s', 'PRO', 'auto_publish', false))).toBe('paused');
    expect(autoRecoveryBlock(site('s', 'PRO', 'manual_approve'))).toBe('manual_approve');
  });

  it('nedenler Turkce; plan adi plans.ts\'ten', () => {
    expect(autoRecoveryBlockText('plan')).toContain(`${findPlan('pro')!.name_tr} planına dahildir`);
    expect(autoRecoveryBlockText('manual_approve')).toContain('Yarı otomatik');
    expect(autoRecoveryBlockText('manual_approve')).toContain('AI Düzelt');
    expect(autoRecoveryBlockText('paused')).toContain('Otomatik akış');
  });
});

describe('runStuckPageSweep — STUCK_PAGE_DETECT_ALL', () => {
  it('site sorgusu plan suzgecini ve otopilot alanlarini kullanir', async () => {
    const d = deps([], {});
    await runStuckPageSweep(d);
    const args = d.prisma.site.findMany.mock.calls[0][0] as any;
    expect(args.where).toEqual(stuckPageSweepSiteWhere());
    expect(args.select).toMatchObject({ autopilot: true, publishApprovalMode: true, user: { select: { plan: true } } });
  });

  it('yalniz Tam otomatik sitede RanksUp makaleleri otomatik kurtarmaya girer', async () => {
    const d = deps(
      [site('auto', 'PRO'), site('manual', 'PRO', 'manual_approve'), site('paused', 'AGENCY', 'auto_publish', false)],
      { auto: 3, manual: 2, paused: 4 },
      { auto: [{ id: 'sp1' }, { id: 'sp2' }], manual: [{ id: 'spx' }], paused: [{ id: 'spy' }] },
    );
    const summary = await runStuckPageSweep(d);
    expect(summary).toEqual({
      totalSites: 3, totalDetected: 9, autoRecoveryQueued: 2, awaitingApprovalSites: 1, notUpdatablePages: 0, closedDuplicatePages: 0,
      pendingRewritePages: 0, recentlyPublishedPages: 0, recentFailurePages: 0, alreadyQueuedPages: 0, staleClaimsReleased: 0,
    });
    // Tespit her plan-uygun sitede calisir
    expect(d.detector.detect.mock.calls.map((c) => c[0])).toEqual(['auto', 'manual', 'paused']);
    // Bekleyen sayfa sorgusu yalniz kurtarilabilir sitede; yalniz makaleli sayfalar
    expect(d.prisma.stuckPage.findMany).toHaveBeenCalledTimes(1);
    expect(d.prisma.stuckPage.findMany).toHaveBeenCalledWith({
      where: { siteId: 'auto', status: 'DETECTED', articleId: { not: null } },
      // Sayfa sayfa okunur: stuckScore azalan, esitlikte id (sonraki sayfanin imleci)
      orderBy: [{ stuckScore: 'desc' }, { id: 'asc' }],
      take: STUCK_AUTO_RECOVER_SCAN,
      // url: takili adres (kapali kayit, adres eslemesi); yazinin durumu + metni:
      // kayit metni canlida mi; son yazim; yayin kayitlari + slug (plan); stuckScore: imlec
      select: {
        id: true, url: true, stuckScore: true,
        article: { select: { status: true, slug: true, title: true, metaTitle: true, metaDescription: true, bodyMd: true, publishedTo: true, publishedAt: true } },
      },
    });
    expect(d.prisma.publishTarget.findMany).toHaveBeenCalledWith({ where: { siteId: 'auto' }, select: { id: true, type: true, isActive: true } });
    // Dusuk oncelik (STUCK_RECOVER_JOB_PRIORITY: onceliksiz yayin / uretim ve 5-10 oncelikli
    // kurulum / denetim isleri once) + istek zamani (is kosmadan sayfa islenirse ikinci tur yok)
    expect(STUCK_RECOVER_JOB_PRIORITY).toBeGreaterThan(10);
    expect(d.jobs.enqueue.mock.calls.map((c: any[]) => c[0])).toEqual([
      { type: 'STUCK_PAGE_RECOVER', userId: 'u-auto', siteId: 'auto', payload: { stuckPageId: 'sp1', triggeredBy: 'autopilot', requestedAt: NOW.toISOString() }, priority: STUCK_RECOVER_JOB_PRIORITY },
      { type: 'STUCK_PAGE_RECOVER', userId: 'u-auto', siteId: 'auto', payload: { stuckPageId: 'sp2', triggeredBy: 'autopilot', requestedAt: NOW.toISOString() }, priority: STUCK_RECOVER_JOB_PRIORITY },
    ]);
  });

  it('bulgu yoksa bekleyen sayfa sorgulanmaz; kuyruga alinamayan is sayilmaz; bir sitenin hatasi digerlerini durdurmaz', async () => {
    const d = deps(
      [site('none', 'PRO'), site('boom', 'PRO'), site('ok', 'PRO')],
      { none: 0, boom: new Error('GSC 500'), ok: 1 },
      { ok: [{ id: 'sp1' }, { id: 'sp2' }] },
    );
    d.jobs.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ totalSites: 3, totalDetected: 1, autoRecoveryQueued: 1 });
    expect(d.prisma.stuckPage.findMany).toHaveBeenCalledTimes(1);
    expect(d.log.warn).toHaveBeenCalledWith(expect.stringContaining('[boom] stuck detect hata: GSC 500'));
    expect(d.log.warn).toHaveBeenCalledWith(expect.stringContaining('kuyruga alinamadi'));
  });

  it('G4: yazisi yalniz yeni kayit acan hedefte (Ghost) yayinda olan ya da hedefi bilinmeyen sayfa GIRMEZ; siradaki uygun sayfa girer', async () => {
    const ghost = { id: 'gh-auto', type: 'GHOST', isActive: true };
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 3 },
      {
        auto: [
          { id: 'sp-ghost', article: liveArticle('auto', 'sp-ghost', { publishedTo: [{ targetId: 'gh-auto', targetType: 'GHOST', ok: true, externalId: '64f0' }] }) },
          { id: 'sp-legacy', article: liveArticle('auto', 'sp-legacy', { publishedTo: null }) },
          { id: 'sp-ftp' },
        ],
      },
      { auto: [ftpTarget('auto'), ghost] },
    );
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, notUpdatablePages: 2 });
    expect(queuedIds(d)).toEqual(['sp-ftp']);
  });

  it('I-1 + F-C: WordPress\'te takili adresi kayitli yazi GIRER; yalniz ?p= adresi (taslak bicimi) ya da adresi olmayan kayit GIRMEZ', async () => {
    const wp = { id: 'wp1', type: 'WORDPRESS_REST', isActive: true };
    const wpArticle = (slug: string, entry: Record<string, unknown>) => liveArticle('wpsite', slug, { publishedTo: [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, ...entry }] });
    const d = deps(
      [site('wpsite', 'AGENCY')],
      { wpsite: 3 },
      {
        wpsite: [
          { id: 'a', url: 'https://www.s.com/a/', article: wpArticle('a', { externalId: '41', externalUrl: 'https://s.com/a/' }) },
          // ?p= adresi kalici baglantili takili adresle karsilastirilamaz: eski yayincinin taslak kopyasi da boyle kayitli
          { id: 'b', url: 'https://s.com/b/', article: wpArticle('b', { externalUrl: 'https://s.com/?p=42' }) },
          { id: 'c', url: 'https://s.com/c/', article: wpArticle('c', {}) },
        ],
      },
      { wpsite: [wp] },
    );
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, notUpdatablePages: 2 });
    expect(queuedIds(d)).toEqual(['a']);
  });

  it('G4: yalniz Ghost hedefi olan sitede hicbir sayfa kuyruga girmez', async () => {
    const ghostOnly = (slug: string, externalId: string) => liveArticle('ghsite', slug, { publishedTo: [{ targetId: 'g1', ok: true, externalId }] });
    const d = deps(
      [site('ghsite', 'AGENCY')],
      { ghsite: 2 },
      { ghsite: [{ id: 'a', article: ghostOnly('a', 'x') }, { id: 'b', article: ghostOnly('b', 'y') }] },
      { ghsite: [{ id: 'g1', type: 'GHOST', isActive: true }] },
    );
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ autoRecoveryQueued: 0, notUpdatablePages: 2 });
    expect(d.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('I-1: yol tabanli hedefte slug degismis yazi kuyruga girmez (yeniden yayin yeni sayfa acardi)', async () => {
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 2 },
      {
        auto: [
          { id: 'drift', url: pageUrl('auto', 'eski-adres'), article: liveArticle('auto', 'yeni-adres', { publishedTo: [ftpEntry('auto', 'eski-adres')] }) },
          { id: 'same', url: pageUrl('auto', 'ayni'), article: liveArticle('auto', 'ayni') },
        ],
      },
    );
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, notUpdatablePages: 1 });
    expect(queuedIds(d)).toEqual(['same']);
  });

  it('uygun sayfa cok olsa da site basina en fazla STUCK_AUTO_RECOVER_PER_SITE kuyruga girer', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `sp${i}` }));
    const d = deps([site('auto', 'PRO')], { auto: 9 }, { auto: many });
    const summary = await runStuckPageSweep(d);
    expect(summary.autoRecoveryQueued).toBe(STUCK_AUTO_RECOVER_PER_SITE);
  });
});

describe('runStuckPageSweep — F-C: takili adres ve yazinin durumu (R4, R5/R7, R20, R24)', () => {
  it('R4: kayit eski /yazi-2/ kopyasini gosteriyor, takili sayfa asil /yazi/ adresi: otomatik kurtarilmaz', async () => {
    const wp = { id: 'wp1', type: 'WORDPRESS_REST', isActive: true };
    // Eski yayinci her yeniden yayinda yeni yazi acip kaydi yalniz o kopyayla eziyordu
    const legacy = liveArticle('s', 'yazi', { publishedTo: [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: '99', externalUrl: 'https://site.com/yazi-2/' }] });
    const d = deps([site('s', 'PRO')], { s: 1 }, { s: [{ id: 'sp1', url: 'https://site.com/yazi/', article: legacy }] }, { s: [wp] });
    const summary = await runStuckPageSweep(d);
    expect(d.jobs.enqueue).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ autoRecoveryQueued: 0, notUpdatablePages: 1 });
  });

  it('R5/R7: onay bekleyen yeniden yazim (READY_TO_PUBLISH / REVIZE_NEEDED / izi tutmayan PUBLISHED) ve uretimdeki yazi kuyruga girmez', async () => {
    const pending = (slug: string, over: Record<string, unknown>) => liveArticle('auto', slug, over);
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 5 },
      {
        auto: [
          { id: 'ready', article: pending('ready', { status: 'READY_TO_PUBLISH' }) },
          { id: 'revize', article: pending('revize', { status: 'REVIZE_NEEDED' }) },
          // Kayit metninin izi canli kopyanin iziyle tutmuyor: yeni metin henuz yayinlanmamis
          { id: 'izsiz', article: pending('izsiz', { publishedTo: [ftpEntry('auto', 'izsiz', { contentHash: 'canlidaki-baska-metin', updatedAt: daysAgo(60).toISOString() })] }) },
          { id: 'uretimde', article: pending('uretimde', { status: 'GENERATING' }) },
          { id: 'temiz' },
        ],
      },
    );
    const summary = await runStuckPageSweep(d);
    expect(queuedIds(d)).toEqual(['temiz']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, pendingRewritePages: 4, notUpdatablePages: 0 });
  });

  it('kayit metninin izi canli kopyanin iziyle ayniysa (yeni yayinci kaydi) kuyruga girer', async () => {
    const base = liveArticle('auto', 'izli');
    const hash = articleContentHash(base as any);
    const d = deps([site('auto', 'PRO')], { auto: 1 }, {
      auto: [{ id: 'izli', article: { ...base, publishedTo: [ftpEntry('auto', 'izli', { contentHash: hash, updatedAt: daysAgo(45).toISOString() })] } }],
    });
    expect(await runStuckPageSweep(d)).toMatchObject({ autoRecoveryQueued: 1, pendingRewritePages: 0 });
  });

  it('olcum penceresi: son 30 gunde yayinlanan / guncellenen yazi kuyruga girmez (bayat GSC verisiyle ikinci duzenleme yok)', async () => {
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 4 },
      {
        auto: [
          // Pivot ayni sabah yerinde guncelledi
          { id: 'bugun', article: liveArticle('auto', 'bugun', { publishedTo: [ftpEntry('auto', 'bugun', { updatedAt: daysAgo(0).toISOString() })] }) },
          { id: 'yirmi-dokuz', article: liveArticle('auto', 'yirmi-dokuz', { publishedTo: [ftpEntry('auto', 'yirmi-dokuz', { updatedAt: daysAgo(29).toISOString() })] }) },
          // Izi olmayan eski kayit: ilk yayin tarihi sayilir (icerik pivotuyla ayni kural)
          { id: 'eski-kayit', article: liveArticle('auto', 'eski-kayit', { publishedAt: daysAgo(10), publishedTo: [ftpEntry('auto', 'eski-kayit')] }) },
          { id: 'otuz-bir', article: liveArticle('auto', 'otuz-bir', { publishedTo: [ftpEntry('auto', 'otuz-bir', { updatedAt: daysAgo(31).toISOString() })] }) },
        ],
      },
    );
    const summary = await runStuckPageSweep(d);
    expect(queuedIds(d)).toEqual(['otuz-bir']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, recentlyPublishedPages: 3 });
    expect(STUCK_MEASUREMENT_WINDOW_DAYS).toBe(30);
  });

  it('R20: ayni adresin son 30 gunde basarisiz denemesi varsa yeniden denenmez; daha eskisi engel degil', async () => {
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 3 },
      { auto: [{ id: 'yeni-basarisiz' }, { id: 'eski-basarisiz' }, { id: 'temiz' }] },
      {},
      [
        { siteId: 'auto', url: pageUrl('auto', 'yeni-basarisiz'), status: 'FAILED', updatedAt: daysAgo(7) },
        { siteId: 'auto', url: pageUrl('auto', 'eski-basarisiz'), status: 'FAILED', updatedAt: daysAgo(STUCK_FAILED_COOLDOWN_DAYS + 1) },
      ],
    );
    const summary = await runStuckPageSweep(d);
    expect(queuedIds(d)).toEqual(['eski-basarisiz', 'temiz']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 2, recentFailurePages: 1 });
    // Sorgu: ayni site + ayni adres + FAILED + bekleme suresi icinde guncellenmis
    expect(d.prisma.stuckPage.findFirst).toHaveBeenCalledWith({
      where: { siteId: 'auto', url: pageUrl('auto', 'yeni-basarisiz'), status: 'FAILED', updatedAt: { gte: daysAgo(STUCK_FAILED_COOLDOWN_DAYS) } },
      select: { id: true },
    });
  });

  it('R24: WordPress + Markdown ZIP yazisi kuyruga girer (ZIP canli sayfa degil); yalniz ZIP kaydi olan girmez', async () => {
    const wp = { id: 'wp1', type: 'WORDPRESS_REST', isActive: true };
    const zip = { id: 'zip1', type: 'MARKDOWN_ZIP', isActive: true };
    const WP = { targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: '123', externalUrl: 'https://ornek.com/kira-artisi/', updatedAt: daysAgo(40).toISOString() };
    const ZIP = { targetId: 'zip1', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/kira-artisi-1756684800000.zip', updatedAt: daysAgo(40).toISOString() };
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 2 },
      {
        auto: [
          { id: 'wp-zip', url: 'https://ornek.com/kira-artisi/', article: liveArticle('auto', 'kira-artisi', { publishedTo: [ZIP, WP] }) },
          { id: 'zip-only', url: 'https://ornek.com/yalniz-zip/', article: liveArticle('auto', 'yalniz-zip', { publishedTo: [{ ...ZIP, externalUrl: '/tmp/yalniz-zip.zip' }] }) },
        ],
      },
      { auto: [wp, zip] },
    );
    const summary = await runStuckPageSweep(d);
    expect(queuedIds(d)).toEqual(['wp-zip']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, notUpdatablePages: 1 });
  });
});

describe('runStuckPageSweep — ayni adreste kapali kaydi olan eski cift satir otomatik kurtarilmaz', () => {
  const U = (slug: string) => `https://auto.com/blog/${slug}.html`;
  // Yazilar FTP'de ayni slug'la yayinda: yerinde guncellenebilir, tek engel kapali kayit olabilir
  const cand = (id: string, slug: string) => ({
    id, url: U(slug), article: liveArticle('auto', slug, { publishedTo: [{ targetId: 'ftp-auto', ok: true, externalUrl: `ftp://h/blog/${slug}.html` }] }),
  });

  it('REVERTED / RECOVERED / IGNORED kaydi olan adres kuyruga girmez; FAILED kapali sayilmaz; siradaki uygun sayfa girer', async () => {
    const d = deps(
      [site('auto', 'PRO')],
      { auto: 5 },
      { auto: [cand('dup-rev', 'geri-alinan'), cand('dup-rec', 'duzeltilen'), cand('dup-ign', 'yok-sayilan'), cand('re-failed', 'basarisiz'), cand('temiz', 'temiz')] },
      {},
      [
        { siteId: 'auto', url: U('geri-alinan'), status: 'REVERTED' },
        { siteId: 'auto', url: U('duzeltilen'), status: 'RECOVERED' },
        { siteId: 'auto', url: U('yok-sayilan'), status: 'IGNORED' },
        // Dedektor FAILED sayfayi bilerek yeniden tespit eder (kapali degil); bekleme suresini asmis
        { siteId: 'auto', url: U('basarisiz'), status: 'FAILED', updatedAt: daysAgo(60) },
      ],
    );
    const summary = await runStuckPageSweep(d);
    expect(queuedIds(d)).toEqual(['re-failed', 'temiz']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 2, closedDuplicatePages: 3, notUpdatablePages: 0 });
  });

  it('sorgu dedektorun closedExisting sorgusuyla ayni bicimde: siteId + url birebir + kapali uc durum', async () => {
    const d = deps([site('auto', 'PRO')], { auto: 1 }, { auto: [cand('a', 'yazi')] });
    await runStuckPageSweep(d);
    expect(d.prisma.stuckPage.findFirst).toHaveBeenCalledWith({
      where: { siteId: 'auto', url: U('yazi'), status: { in: ['RECOVERED', 'REVERTED', 'IGNORED'] } },
      select: { id: true },
    });
  });

  it('baska sitenin ayni adresli kapali kaydi etkilemez', async () => {
    const d = deps([site('auto', 'PRO')], { auto: 1 }, { auto: [cand('a', 'yazi')] }, {}, [{ siteId: 'baska', url: U('yazi'), status: 'REVERTED' }]);
    const summary = await runStuckPageSweep(d);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, closedDuplicatePages: 0 });
  });

  it('adresi olmayan satir: kapali kayit sorgusu atilmaz (Prisma url: undefined suzgeci kaldirirdi) ve takili adres dogrulanamadigi icin otomatik kurtarilmaz', async () => {
    const d = deps([site('auto', 'PRO')], { auto: 1 }, { auto: [{ id: 'adressiz', url: undefined }] }, {}, [{ siteId: 'auto', url: U('x'), status: 'REVERTED' }]);
    const summary = await runStuckPageSweep(d);
    expect(d.prisma.stuckPage.findFirst).not.toHaveBeenCalled();
    expect(d.jobs.enqueue).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ autoRecoveryQueued: 0, closedDuplicatePages: 0, notUpdatablePages: 1 });
  });

  it('kapali durum listesi gercek dedektorun closedExisting sorgusuyla ayni', async () => {
    const url = U('yazi');
    const findFirst = vi.fn(async () => null);
    const prisma = {
      article: { findMany: vi.fn(async () => []) },
      stuckPage: { findFirst, create: vi.fn(async ({ data }: any) => data), update: vi.fn() },
    };
    const detector = new StuckPageDetectorService(prisma as never, {} as never);
    // Konum 8, 500 gosterim, CTR %0,4 → takili; GSC cagrisi yok
    (detector as any).fetchPagePerformance = vi.fn(async () => [{ url, impressions: 500, clicks: 2, ctr: 0.004, position: 8 }]);
    (detector as any).fetchTopQueriesByUrl = vi.fn(async () => new Map());
    await detector.detect('s1');
    const closedCall = findFirst.mock.calls
      .map((c: any[]) => c[0].where)
      .find((w: any) => (w.status.in as string[]).includes('REVERTED'));
    expect(closedCall).toMatchObject({ siteId: 's1', url });
    expect([...closedCall.status.in].sort()).toEqual([...CLOSED_STUCK_STATUSES].sort());
  });

  it('gercek dedektor + tarama: duzeltmeden once geri alinan adrese acilmis eski DETECTED satiri otopilotla yeniden yazilmaz', async () => {
    const url = U('kuafor-fiyatlari');
    // Eski dedektor REVERTED'i kapali saymiyordu: geri alinan adrese yeni DETECTED satiri acti
    const store = [
      { id: 'geri-alinan', siteId: 's1', url, status: 'REVERTED', articleId: 'a1', detectedAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'eski-cift', siteId: 's1', url, status: 'DETECTED', articleId: 'a1', detectedAt: new Date('2026-09-01T00:00:00Z') },
    ];
    const publishedTo = [{ targetId: 'ftp1', targetType: 'FTP', ok: true, externalUrl: url }];
    const prisma = {
      site: { findMany: vi.fn(async () => [{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }]) },
      article: { findMany: vi.fn(async () => [{ id: 'a1', slug: 'kuafor-fiyatlari', title: 'Kuaför fiyatları', publishedTo }]) },
      publishTarget: { findMany: vi.fn(async () => [{ id: 'ftp1', type: 'FTP', isActive: true }]) },
      stuckPage: {
        findFirst: vi.fn(async ({ where }: any) => {
          const allowed: string[] = typeof where.status === 'string' ? [where.status] : where.status?.in ?? [];
          return store.find((r) => r.siteId === where.siteId && r.url === where.url && allowed.includes(r.status)) ?? null;
        }),
        findMany: vi.fn(async ({ where }: any) => store
          .filter((r) => r.siteId === where.siteId && r.status === where.status && r.articleId !== null)
          .map((r) => ({ id: r.id, url: r.url, article: { status: 'PUBLISHED', slug: 'kuafor-fiyatlari', publishedTo } }))),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const detector = new StuckPageDetectorService(prisma as never, {} as never);
    (detector as any).fetchPagePerformance = vi.fn(async () => [{ url, impressions: 500, clicks: 2, ctr: 0.004, position: 8 }]);
    (detector as any).fetchTopQueriesByUrl = vi.fn(async () => new Map());
    const jobs = { enqueue: vi.fn(async () => ({ dbJobId: 'j' })) };

    const summary = await runStuckPageSweep({ prisma, detector, jobs } as never);
    // Dedektor kapali kayit yuzunden atladi (satir acmadi, eski satiri guncellemedi)
    expect(prisma.stuckPage.create).not.toHaveBeenCalled();
    expect(prisma.stuckPage.update).not.toHaveBeenCalled();
    // ... ve tarama eski DETECTED satirini da secmedi
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ totalDetected: 1, autoRecoveryQueued: 0, closedDuplicatePages: 1 });
  });
});

describe('planArticleRepublish — duzenlenen yazi yerinde yeniden yayinlanabilir mi (G4)', () => {
  const t = (id: string, type: string, isActive = true) => ({ id, type, isActive });
  const e = (targetId: string, over: Record<string, unknown> = {}) => ({ targetId, ok: true, ...over });

  it('yerinde guncelleyen hedefler: WordPress (REST / XML-RPC, kaydi adreslenebilirse) + FTP, SFTP, cPanel, GitHub, KobiPratik', () => {
    expect([...IN_PLACE_REPUBLISH_TARGET_TYPES].sort()).toEqual(['CPANEL_API', 'FTP', 'GITHUB', 'KOBIPRATIK', 'SFTP', 'WORDPRESS_REST', 'WORDPRESS_XMLRPC']);
    for (const type of IN_PLACE_REPUBLISH_TARGET_TYPES) {
      // WordPress kaydi yazi kimligiyle bulunur (her iki adaptor de yayinda doner)
      expect(planArticleRepublish({ publishedTo: [e('x', { externalId: '12' })], targets: [t('x', type)] }), type)
        .toEqual({ kind: 'republish', targetIds: ['x'], targetTypes: [type] });
    }
  });

  it('I-1: WordPress kaydi kimlik, ?p= ya da adresteki slug ile adreslenir; hicbiri yoksa oneri: unaddressable', () => {
    for (const type of ['WORDPRESS_REST', 'WORDPRESS_XMLRPC']) {
      for (const over of [{ externalId: '12' }, { externalUrl: 'https://s.com/?p=12' }, { externalUrl: 'https://s.com/2026/10/yazi/' }, { url: 'https://s.com/yazi/' }]) {
        expect(planArticleRepublish({ publishedTo: [e('wp', over)], targets: [t('wp', type)] }), `${type} ${JSON.stringify(over)}`)
          .toMatchObject({ kind: 'republish', targetIds: ['wp'] });
      }
      for (const over of [{}, { externalUrl: 'https://s.com/' }, { externalId: 'abc' }]) {
        expect(planArticleRepublish({ publishedTo: [e('wp', over)], targets: [t('wp', type)] }), `${type} ${JSON.stringify(over)}`)
          .toMatchObject({ kind: 'proposal', block: 'unaddressable', labels: ['WordPress'] });
      }
    }
  });

  it('yalniz yeni kayit acan / canliya dokunmayan hedefler oneri: create_only (takili plan ZIP\'i once ayirir: planStuckRepublish)', () => {
    for (const type of ['GHOST', 'STRAPI', 'WEBFLOW', 'SHOPIFY', 'SANITY', 'CONTENTFUL', 'WHMCS_KB', 'CUSTOM_PHP', 'MARKDOWN_ZIP', 'WIX']) {
      const plan = planArticleRepublish({ publishedTo: [e('x', { externalId: '12', externalUrl: 'https://s.com/yazi' })], targets: [t('x', type)] });
      expect(plan, type).toMatchObject({ kind: 'proposal', block: 'create_only' });
    }
  });

  it('kaynak yazinin YAYINDA oldugu hedefler, varsayilan hedef degil', () => {
    // Yazi FTP'de yayinda, site sonradan WordPress'i de eklemis: yalniz FTP yeniden yazilir
    expect(planArticleRepublish({ publishedTo: [e('ftp')], targets: [t('wp', 'WORDPRESS_REST'), t('ftp', 'FTP')] }))
      .toEqual({ kind: 'republish', targetIds: ['ftp'], targetTypes: ['FTP'] });
    // Yazi WordPress'te yayinda, varsayilan sonradan FTP olmus: yalniz WordPress yazisi guncellenir
    expect(planArticleRepublish({ publishedTo: [e('wp', { externalId: '7' })], targets: [t('ftp', 'FTP'), t('wp', 'WORDPRESS_REST')] }))
      .toEqual({ kind: 'republish', targetIds: ['wp'], targetTypes: ['WORDPRESS_REST'] });
    // Yazi Ghost'ta yayinda, varsayilan sonradan FTP olmus: FTP'ye yayin yeni sayfa acardi → oneri
    expect(planArticleRepublish({ publishedTo: [e('gh')], targets: [t('ftp', 'FTP'), t('gh', 'GHOST')] }))
      .toMatchObject({ kind: 'proposal', block: 'create_only', labels: ['Ghost'] });
  });

  it('karisik: bir kopya bile guncellenemiyorsa oneri', () => {
    expect(planArticleRepublish({ publishedTo: [e('ftp'), e('gh')], targets: [t('ftp', 'FTP'), t('gh', 'GHOST')] }))
      .toMatchObject({ kind: 'proposal', block: 'create_only' });
    expect(planArticleRepublish({ publishedTo: [e('ftp'), e('wp')], targets: [t('ftp', 'FTP'), t('wp', 'WORDPRESS_REST')] }))
      .toMatchObject({ kind: 'proposal', block: 'unaddressable' });
    expect(planArticleRepublish({ publishedTo: [e('ftp'), e('wp', { externalId: '3' })], targets: [t('ftp', 'FTP'), t('wp', 'WORDPRESS_REST')] }))
      .toEqual({ kind: 'republish', targetIds: ['ftp', 'wp'], targetTypes: ['FTP', 'WORDPRESS_REST'] });
  });

  it('I-1: yol tabanli hedefte slug degistiyse oneri: slug_changed; WordPress adresi slug\'a bagli degil', () => {
    const ftpE = e('ftp', { externalUrl: 'ftp://h/public_html/blog/eski-adres.html' });
    expect(planArticleRepublish({ publishedTo: [ftpE], targets: [t('ftp', 'FTP')], slug: 'yeni-adres' }))
      .toMatchObject({ kind: 'proposal', block: 'slug_changed', labels: ['FTP'] });
    expect(planArticleRepublish({ publishedTo: [ftpE], targets: [t('ftp', 'FTP')], slug: 'eski-adres' }))
      .toEqual({ kind: 'republish', targetIds: ['ftp'], targetTypes: ['FTP'] });
    // slug verilmezse denetlenmez (eski cagiranlar)
    expect(planArticleRepublish({ publishedTo: [ftpE], targets: [t('ftp', 'FTP')] })).toMatchObject({ kind: 'republish' });
    // WordPress guncellemesi slug gondermez: adres ayni kalir
    expect(planArticleRepublish({ publishedTo: [e('wp', { externalId: '5', externalUrl: 'https://s.com/eski-adres/' })], targets: [t('wp', 'WORDPRESS_REST')], slug: 'yeni-adres' }))
      .toMatchObject({ kind: 'republish', targetIds: ['wp'] });
  });

  it('kayit yok / hedef kimligi yok: unknown_location; silinmis / pasif hedef: target_missing; basarisiz kayit sayilmaz', () => {
    expect(planArticleRepublish({ publishedTo: null, targets: [t('ftp', 'FTP')] })).toMatchObject({ kind: 'proposal', block: 'unknown_location' });
    expect(planArticleRepublish({ publishedTo: [{ url: 'https://s.com/a', externalId: '9' }], targets: [t('ftp', 'FTP')] })).toMatchObject({ kind: 'proposal', block: 'unknown_location' });
    expect(planArticleRepublish({ publishedTo: [e('gone', { targetType: 'SFTP' })], targets: [t('ftp', 'FTP')] })).toMatchObject({ kind: 'proposal', block: 'target_missing', labels: ['SFTP'] });
    expect(planArticleRepublish({ publishedTo: [e('ftp')], targets: [t('ftp', 'FTP', false)] })).toMatchObject({ kind: 'proposal', block: 'target_missing' });
    expect(planArticleRepublish({ publishedTo: [e('ftp'), e('wp', { ok: false })], targets: [t('ftp', 'FTP'), t('wp', 'WORDPRESS_REST')] }))
      .toEqual({ kind: 'republish', targetIds: ['ftp'], targetTypes: ['FTP'] });
  });

  it('nedenler Turkce ve baglama gore dogru (oneri kaydedildi / otopilot / geri alma)', () => {
    const plan = { block: 'create_only' as const, labels: ['Ghost'] };
    expect(republishBlockText(plan, 'proposal')).toMatch(/Ghost.*ikinci bir kopyasını.*Öneriler kaydedildi, yazı değiştirilmedi/);
    expect(republishBlockText(plan, 'autopilot')).toContain('Otopilot bu sayfayı otomatik düzeltmez');
    expect(republishBlockText(plan, 'autopilot')).not.toContain('kaydedildi');
    expect(republishBlockText(plan, 'revert')).toContain('otomatik geri alınmadı');
    expect(republishBlockText(plan, 'republish')).toContain('önceki haline döndürüldü');
    expect(republishBlockText(plan, 'skip')).toMatch(/ikinci bir kopyasını.*Hiçbir şey değiştirilmedi\.$/);
    expect(republishBlockText({ block: 'unaddressable', labels: ['WordPress'] }, 'proposal'))
      .toMatch(/WordPress.*kimliği ya da adresi kayıtlı değil.*Öneriler kaydedildi/);
    expect(republishBlockText({ block: 'slug_changed', labels: ['FTP'] }, 'autopilot'))
      .toMatch(/adresi ilk yayından sonra değişti; FTP hedefine yeniden yayın yeni bir sayfa açardı.*Otopilot/);
  });

  it('ikinci asama verisi dogrulamasi', () => {
    const ok = { phase: STUCK_REPUBLISH_PHASE, stuckPageId: 'sp', recoveryId: 'r', articleId: 'a', mode: 'recover' };
    expect(isStuckRepublishPayload(ok)).toBe(true);
    expect(isStuckRepublishPayload({ ...ok, mode: 'revert' })).toBe(true);
    expect(isStuckRepublishPayload({ ...ok, expectedContentHash: 'abc' })).toBe(true);
    expect(isStuckRepublishPayload({ ...ok, mode: 'x' })).toBe(false);
    expect(isStuckRepublishPayload({ ...ok, recoveryId: '' })).toBe(false);
    expect(isStuckRepublishJob({ phase: STUCK_REPUBLISH_PHASE })).toBe(true);
    expect(isStuckRepublishJob({ stuckPageId: 'sp', triggeredBy: 'autopilot' })).toBe(false);
    expect(isStuckRepublishJob(null)).toBe(false);
  });
});

describe('liveEntryAddressesUrl — kayit takili sayfanin adresi mi (R4)', () => {
  it('WordPress / KobiPratik: sema, www, sondaki bolu, buyuk harf ve kacislanmis yol farki ayni adres sayilir', () => {
    const wp = { externalUrl: 'https://ornek.com/kdv-beyani/' };
    for (const page of ['https://ornek.com/kdv-beyani/', 'http://www.ornek.com/kdv-beyani', 'https://ORNEK.com/KDV-Beyani/', 'https://ornek.com/kdv-beyani.html']) {
      expect(liveEntryAddressesUrl(wp, 'WORDPRESS_REST', page), page).toBe(true);
    }
    expect(liveEntryAddressesUrl({ externalUrl: 'https://ornek.com/kdv-beyan%C4%B1/' }, 'WORDPRESS_XMLRPC', 'https://ornek.com/kdv-beyanı/')).toBe(true);
    // Eski kayitlarda adres `url` alaninda
    expect(liveEntryAddressesUrl({ url: 'https://ornek.com/kdv-beyani/' }, 'WORDPRESS_REST', 'https://ornek.com/kdv-beyani/')).toBe(true);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://kobipratik.com/rehber/kdv' }, 'KOBIPRATIK', 'https://www.kobipratik.com/rehber/kdv/')).toBe(true);
  });

  it('WordPress: baska yazi (-2 kopyasi), baska alan adi, ana sayfa ve ?p= adresi eslesmez', () => {
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/yazi-2/' }, 'WORDPRESS_REST', 'https://site.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://baska.com/yazi/' }, 'WORDPRESS_REST', 'https://site.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/?p=42' }, 'WORDPRESS_REST', 'https://site.com/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/?p=42' }, 'WORDPRESS_REST', 'https://site.com/yazi/')).toBe(false);
    // Duz kalici baglantili sitede GSC de ?p= adresini raporlar: ayni yazi
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/?p=42' }, 'WORDPRESS_REST', 'https://site.com/?p=42')).toBe(true);
    expect(liveEntryAddressesUrl({ externalId: '42' }, 'WORDPRESS_REST', 'https://site.com/yazi/')).toBe(false);
  });

  it('FTP / SFTP: klasor + slug; sunucu kok dizini (public_html, /var/www/html) adreste yok', () => {
    const page = 'https://site.com/blog/yazi.html';
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/blog/yazi.html' }, 'FTP', page)).toBe(true);
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/blog/yazi.html' }, 'FTP', 'https://site.com/blog/yazi')).toBe(true);
    expect(liveEntryAddressesUrl({ externalUrl: '/var/www/html/blog/yazi.html' }, 'SFTP', page)).toBe(true);
    expect(liveEntryAddressesUrl({ externalUrl: '/home/u/public_html/blog/yazi.html' }, 'SFTP', page)).toBe(true);
    // FTP kullanicisinin dizini site koku: yol klasorle baslar
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/blog/yazi.html' }, 'FTP', page)).toBe(true);
    // Baska klasor, baska slug, kokteki dosya ve ana sayfa eslesmez
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/yazi.html' }, 'FTP', page)).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/blog/yazi-2.html' }, 'FTP', page)).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/blog/yazi.html' }, 'FTP', 'https://site.com/yazi.html')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'ftp://h/public_html/index.html' }, 'FTP', 'https://site.com/')).toBe(false);
  });

  it('GitHub: depodaki klasorun sonu adresin klasoru, slug ayni; cPanel: yazilan dosyanin yolu (alan adi cPanel sunucusundan tahmin edilebilir)', () => {
    const gh = { externalUrl: 'https://github.com/firma/site/blob/main/content/blog/yazi.md' };
    expect(liveEntryAddressesUrl(gh, 'GITHUB', 'https://firma.com/blog/yazi/')).toBe(true);
    expect(liveEntryAddressesUrl(gh, 'GITHUB', 'https://firma.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://server12.hosting.com/blog/yazi' }, 'CPANEL_API', 'https://site.com/blog/yazi.html')).toBe(true);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/blog/yazi' }, 'CPANEL_API', 'https://site.com/blog/baska.html')).toBe(false);
  });

  it('yeni kayit acan hedefler, disa aktarim, adressiz kayit ve gecersiz takili adres hicbir zaman eslesmez', () => {
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/yazi/' }, 'GHOST', 'https://site.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: '/tmp/yazi.zip' }, 'MARKDOWN_ZIP', 'https://site.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({}, 'WORDPRESS_REST', 'https://site.com/yazi/')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/yazi/' }, 'WORDPRESS_REST', '')).toBe(false);
    expect(liveEntryAddressesUrl({ externalUrl: 'https://site.com/yazi/' }, 'WORDPRESS_REST', undefined)).toBe(false);
  });
});

describe('planStuckRepublish — takili sayfanin yerinde yeniden yayin plani (R4, R24, C2/C3)', () => {
  const WP = { id: 'wp', type: 'WORDPRESS_REST', isActive: true };
  const ZIP = { id: 'zip', type: 'MARKDOWN_ZIP', isActive: true };
  const FTP = { id: 'ftp', type: 'FTP', isActive: true };
  const wpE = (over: Record<string, unknown> = {}) => ({ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '50', externalUrl: 'https://site.com/yazi/', ...over });
  const zipE = { targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi-1.zip' };
  const URL_ = 'https://site.com/yazi/';

  it('takili adresin kopyasi yerinde guncellenebiliyorsa republish', () => {
    expect(planStuckRepublish({ publishedTo: [wpE()], targets: [WP], slug: 'yazi', url: URL_ }))
      .toEqual({ kind: 'republish', targetIds: ['wp'], targetTypes: ['WORDPRESS_REST'] });
  });

  it('R4: guncellenebilen tek kopya eski /yazi-2/ kopyasi: url_mismatch, nedeni kayitli adresi soyler ve "ikinci kopya" demez', () => {
    const plan = planStuckRepublish({ publishedTo: [wpE({ externalId: '99', externalUrl: 'https://site.com/yazi-2/' })], targets: [WP], slug: 'yazi', url: URL_ });
    expect(plan).toEqual({ kind: 'proposal', block: 'url_mismatch', labels: ['https://site.com/yazi-2/'] });
    const text = republishBlockText(plan as any, 'proposal');
    expect(text).toContain('Takılı adres, RanksUp\'ın kayıtlı yayın adresiyle eşleşmiyor (kayıtlı: https://site.com/yazi-2/)');
    expect(text).toContain('Öneriler kaydedildi');
    expect(text).not.toContain('ikinci bir kopyasını');
    // Takili adres bilinmiyorsa eslesme kurulamaz: emin olmadan yazilmaz
    expect(planStuckRepublish({ publishedTo: [wpE()], targets: [WP], slug: 'yazi', url: undefined })).toMatchObject({ kind: 'proposal', block: 'url_mismatch' });
  });

  it('R4: yazi iki hedefte yayindaysa kopyalardan biri takili adres olmali; yeni metin ikisine de gider', () => {
    const ftpE = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/yazi.html' };
    expect(planStuckRepublish({ publishedTo: [wpE(), ftpE], targets: [WP, FTP], slug: 'yazi', url: URL_ }))
      .toEqual({ kind: 'republish', targetIds: ['wp', 'ftp'], targetTypes: ['WORDPRESS_REST', 'FTP'] });
  });

  it('yapisal engeller (yeni kayit acan hedef, slug degisimi...) takili adres denetiminden once gelir', () => {
    expect(planStuckRepublish({ publishedTo: [{ targetId: 'gh', ok: true, externalId: 'x' }], targets: [{ id: 'gh', type: 'GHOST', isActive: true }], url: URL_ }))
      .toMatchObject({ kind: 'proposal', block: 'create_only', labels: ['Ghost'] });
  });

  it('R24: WordPress + ZIP: ZIP yok sayilir, WordPress guncellenir (icerik pivotuyla ayni karar, iki sirada da)', () => {
    for (const publishedTo of [[zipE, wpE()], [wpE(), zipE]]) {
      const stuck = planStuckRepublish({ publishedTo, targets: [WP, ZIP], slug: 'yazi', url: URL_ });
      expect(stuck).toEqual({ kind: 'republish', targetIds: ['wp'], targetTypes: ['WORDPRESS_REST'] });
      expect(pivotRewritePlan({ publishedTo, targets: [WP, ZIP], slug: 'yazi' })).toEqual(stuck);
    }
  });

  it('R24: yalniz ZIP kaydi: export_only; metin dogru, "ikinci kopya" iddiasi yok', () => {
    const plan = planStuckRepublish({ publishedTo: [zipE], targets: [ZIP], slug: 'yazi', url: URL_ });
    expect(plan).toEqual({ kind: 'proposal', block: 'export_only', labels: ['Markdown ZIP'] });
    const text = republishBlockText(plan as any, 'proposal');
    expect(text).toContain('Yazı yalnız Markdown ZIP olarak dışa aktarıldı');
    expect(text).not.toContain('kopya');
  });

  it('C3: cop kutusundaki kopya canli degil: takili adresinki ya da tek kopya cop kutusundaysa live_copy_trashed', () => {
    const trashed = wpE({ trashedAt: '2026-10-01T00:00:00.000Z' });
    expect(planStuckRepublish({ publishedTo: [trashed], targets: [WP], slug: 'yazi', url: URL_ }))
      .toEqual({ kind: 'proposal', block: 'live_copy_trashed', labels: ['WordPress'] });
    // ZIP de olsa takili adresteki kopya cop kutusunda
    expect(planStuckRepublish({ publishedTo: [trashed, zipE], targets: [WP, ZIP], slug: 'yazi', url: URL_ })).toMatchObject({ block: 'live_copy_trashed' });
    expect(republishBlockText({ block: 'live_copy_trashed', labels: ['WordPress'] }, 'skip')).toContain('çöp kutusunda; RanksUp kaldırılan yazıyı düzenleyip yeniden yayınlamaz');
  });

  it('C2: kopya onceki takili sayfa yayininda sitede degismis bulundu (remoteEditSkip): live_copy_edited — musterinin metni ezilmez', () => {
    const plan = planStuckRepublish({ publishedTo: [wpE({ remoteEditSkip: 'live_entry_edited', remoteEditSeenAt: '2026-10-01T00:00:00.000Z' })], targets: [WP], slug: 'yazi', url: URL_ });
    expect(plan).toEqual({ kind: 'proposal', block: 'live_copy_edited', labels: ['WordPress'] });
    // "elle" denmez: RanksUp'in kendi alt metni / meta yazimi da degisiklik zamanini ilerletir
    expect(republishBlockText(plan as any, 'autopilot')).toContain('sitende değiştirilmiş; RanksUp sitedeki değişikliklerin üzerine kendiliğinden yazmaz');
    const mismatch = planStuckRepublish({ publishedTo: [wpE({ remoteEditSkip: 'live_entry_mismatch' })], targets: [WP], slug: 'yazi', url: URL_ });
    expect(mismatch).toEqual({ kind: 'proposal', block: 'live_copy_mismatch', labels: ['WordPress'] });
    expect(republishBlockText(mismatch as any, 'skip')).toContain('başka bir yazıyı gösteriyor');
  });

  it('"elle guncelleme bekliyor" kopya (manualUpdatePending — son metin yazilmadi ya da secilmedi): live_copy_stale; "degistirilmis" iddiasi yok', () => {
    const plan = planStuckRepublish({ publishedTo: [wpE({ manualUpdatePending: true })], targets: [WP], slug: 'yazi', url: URL_ });
    expect(plan).toEqual({ kind: 'proposal', block: 'live_copy_stale', labels: ['WordPress'] });
    const text = republishBlockText(plan as any, 'autopilot');
    expect(text).toContain('Yazının sitendeki kopyasına (WordPress) son metin yazılmadı');
    expect(text).not.toContain('değiştirilmiş');
  });
});

describe('stuckArticleLiveBlock / recentStuckLiveWrite — duzeltme yalniz canlidaki metin uzerinden (R5/R7)', () => {
  const row = (over: Record<string, unknown> = {}) => ({ status: 'PUBLISHED', slug: 'yazi', title: 'Yazı', bodyMd: 'metin', publishedTo: [{ targetId: 't', ok: true }], ...over });

  it('PUBLISHED + kayit metni canlida: engel yok', () => {
    expect(stuckArticleLiveBlock(row())).toBeNull();
    const r = row();
    expect(stuckArticleLiveBlock(row({ publishedTo: [{ targetId: 't', ok: true, contentHash: articleContentHash(r) }] }))).toBeNull();
  });

  it('S8: neden NEDENE gore — gercek bekleyen surum / kopyaya yazilamamis son metin / yayinlanmamis degisiklik; uretimdeki ve yayinda olmayan yazi', () => {
    // Gercekten bekleyen surum (pivot / kapali dongu)
    expect(stuckArticleLiveBlock(row({ status: 'READY_TO_PUBLISH' }))).toBe(STUCK_ARTICLE_PENDING_VERSION);
    expect(stuckArticleLiveBlock(row({ status: 'REVIZE_NEEDED' }))).toBe(STUCK_ARTICLE_PENDING_VERSION);
    // PUBLISHED, isaretsiz, iz tutmuyor: capraz baglanti / snippet kaydi degistirdi, yayinlanmadi
    expect(stuckArticleLiveBlock(row({ publishedTo: [{ targetId: 't', ok: true, contentHash: 'baska' }] }))).toBe(STUCK_ARTICLE_UNPUBLISHED_CHANGES);
    // PUBLISHED, kopya "elle guncelleme bekliyor": onaylanacak bir sey YOK, kopya guncellenmeli
    expect(stuckArticleLiveBlock(row({ publishedTo: [{ targetId: 't', ok: true, manualUpdatePending: true }] }))).toBe(STUCK_ARTICLE_LIVE_COPY_BEHIND);
    expect(stuckArticleLiveBlock(row({ publishedTo: [{ targetId: 't', ok: true, contentHash: 'baska', manualUpdatePending: true }] }))).toBe(STUCK_ARTICLE_LIVE_COPY_BEHIND);
    expect(stuckArticleLiveBlock(row({ status: 'GENERATING' }))).toBe(STUCK_ARTICLE_REWRITING);
    expect(stuckArticleLiveBlock(row({ status: 'ARCHIVED' }))).toBe(STUCK_ARTICLE_NOT_LIVE);
    // Reddetme eylemi yok; "onaylayin ya da reddedin" hicbir metinde kalmadi
    for (const text of [STUCK_ARTICLE_PENDING_VERSION, STUCK_ARTICLE_REWRITING, STUCK_ARTICLE_LIVE_COPY_BEHIND, STUCK_ARTICLE_UNPUBLISHED_CHANGES]) {
      expect(text).not.toMatch(/reddedin|onaylayın/);
    }
    expect(STUCK_ARTICLE_PENDING_VERSION).toContain('yazının sayfasından yeni sürümü gözden geçirip yayınla');
    expect(STUCK_ARTICLE_LIVE_COPY_BEHIND).toContain('Yayın Geçmişi');
    expect(STUCK_ARTICLE_UNPUBLISHED_CHANGES).toContain('yeniden yayınla');
  });

  it('olcum penceresi: son yazim (updatedAt) ya da izi yoksa ilk yayin; 30 gun', () => {
    expect(recentStuckLiveWrite({ publishedTo: [{ targetId: 't', ok: true, updatedAt: daysAgo(3).toISOString() }] }, NOW)).toEqual(daysAgo(3));
    expect(recentStuckLiveWrite({ publishedTo: [{ targetId: 't', ok: true, updatedAt: daysAgo(31).toISOString() }], publishedAt: daysAgo(1) }, NOW)).toBeNull();
    expect(recentStuckLiveWrite({ publishedTo: [{ targetId: 't', ok: true }], publishedAt: daysAgo(5) }, NOW)).toEqual(daysAgo(5));
    expect(recentStuckLiveWrite({ publishedTo: [], publishedAt: null }, NOW)).toBeNull();
  });
});

describe('stuckRecoveryRoute — STUCK_PAGE_RECOVER yonlendirmesi', () => {
  const reader = (row: { articleId: string | null } | null) => {
    const findUnique = vi.fn(async () => row);
    return { prisma: { stuckPage: { findUnique } }, findUnique };
  };

  it('dogrudan kimlikle okur: makaleli sayfa → article, makalesiz → external', async () => {
    const a = reader({ articleId: 'a1' });
    expect(await stuckRecoveryRoute(a.prisma, 'sp1')).toBe('article');
    expect(a.findUnique).toHaveBeenCalledWith({ where: { id: 'sp1' }, select: { articleId: true } });
    expect(await stuckRecoveryRoute(reader({ articleId: null }).prisma, 'sp1')).toBe('external');
  });

  it('kayit yoksa ya da kimlik gecersizse missing (DB okunmadan)', async () => {
    expect(await stuckRecoveryRoute(reader(null).prisma, 'sp1')).toBe('missing');
    const r = reader({ articleId: 'a1' });
    expect(await stuckRecoveryRoute(r.prisma, undefined)).toBe('missing');
    expect(await stuckRecoveryRoute(r.prisma, '')).toBe('missing');
    expect(r.findUnique).not.toHaveBeenCalled();
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts)', () => {
  // Worker'in test kosucusu yok; kurallar bu modulden gelmeli.
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const between = (a: string, b: string) => src.slice(src.indexOf(a), src.indexOf(b));

  it('STUCK_PAGE_DETECT_ALL plan/mod kurallarini runStuckPageSweep\'ten alir; log atlanan her kovayi yazar (closedDuplicatePages dahil)', () => {
    const h = between('STUCK_PAGE_DETECT_ALL: async', 'STUCK_PAGE_RECOVER: async');
    expect(h).toContain('runStuckPageSweep(');
    expect(h).not.toContain('site.findMany');
    for (const key of ['notUpdatablePages', 'closedDuplicatePages', 'pendingRewritePages', 'recentlyPublishedPages', 'recentFailurePages', 'alreadyQueuedPages', 'staleClaimsReleased']) {
      expect(h, key).toContain(`summary.${key}`);
    }
  });

  it('STUCK_PAGE_RECOVER getDetail\'i tek argumanla cagirmaz; dis sayfaya otopilot dokunmaz', () => {
    const h = between('STUCK_PAGE_RECOVER: async', 'STUCK_PAGE_PERFORMANCE_CHECK: async');
    // getDetail(siteId, id) imzasi tek argumanla her zaman null donuyordu
    expect(h).not.toContain('stuckDetector.getDetail(');
    expect(h).toContain('stuckRecoveryRoute(services.prisma, stuckPageId)');
    expect(h).toMatch(/if \(by === 'autopilot'\) return stuckRecoverSkip\('EXTERNAL_PAGE_MANUAL_ONLY'\)/);
    // Atlama sonucu is kaydinda Turkce neden tasir (D4); ham kod yalniz code alaninda
    expect(h).not.toMatch(/reason: '(AI_GLOBAL_DISABLED|STUCK_PAGE_NOT_FOUND|EXTERNAL_PAGE_MANUAL_ONLY)'/);
    // Is kimligi ve istek zamani servise gider: yeniden teslim sahiplenmeyi devralir, bayat is atlar
    expect(h).toContain('jobId: String(job.id)');
    expect(h).toContain('requestedAt');
    expect(h).toContain('services.stuckRecovery.recover(stuckPageId, recoverOpts)');
    expect(h).toContain('services.stuckExternal.recover(stuckPageId, recoverOpts)');
  });

  it('G4: ikinci asama (yerinde yeniden yayin) servise gider, yayinciyi alir; AI anahtarindan ve LLM yolundan ONCE', () => {
    const h = between('STUCK_PAGE_RECOVER: async', 'STUCK_PAGE_PERFORMANCE_CHECK: async');
    expect(src).toMatch(/import \{[^}]*isStuckRepublishJob[^}]*\} from '\.\.\/\.\.\/api\/dist\/audit\/stuck-page-autopilot\.js'/);
    const phase = h.indexOf('isStuckRepublishJob(data)');
    expect(phase).toBeGreaterThan(-1);
    expect(phase).toBeLessThan(h.indexOf("getBoolean('AI_GLOBAL_DISABLED')"));
    expect(phase).toBeLessThan(h.indexOf('stuckRecoveryRoute('));
    expect(h).toContain('services.stuckRecovery.republish(');
    // Takili sayfa akisi musterinin WordPress duzenlemesini ezme secenegini HIC vermez (C1)
    // Servisin verdigi secenek ({ recreateMissing: false }) yayinciya ulasmali:
    // iki parametreli lambda derlenir ama secenegi sessizce dusururdu.
    expect(h).toContain('services.publisher.publishArticle(articleId, targetIds, opts)');
    expect(h).toMatch(/\(articleId: string, targetIds: string\[\], opts\?: \{ recreateMissing\?: boolean; initiator\?: 'user' \| 'automation' \}\) =>/);
    expect(h).not.toContain('overwriteRemoteEdits');
    // Son deneme karari BullMQ deneme sayisindan (yeniden denemede durum degismez)
    expect(h).toMatch(/finalAttempt = !job \|\| job\.attemptsMade \+ 1 >= \(job\.opts\?\.attempts \?\? 1\)/);
    // Eski yol: duzenleme sonrasi varsayilan hedefe PUBLISH_ARTICLE yok
    const svc = readFileSync(new URL('./stuck-page-recovery.service.ts', import.meta.url), 'utf8');
    expect(svc).not.toContain("type: 'PUBLISH_ARTICLE'");
  });

  it('C1: PUBLISH_ARTICLE is verisindeki overwriteRemoteEdits\'i yayinciya YALNIZ acik true ise gecirir', () => {
    const h = between('PUBLISH_ARTICLE: async', 'IMPROVE_PAGE: async');
    expect(h).toMatch(/PUBLISH_ARTICLE: async \(\{ articleId, targetIds, overrideQa, overwriteRemoteEdits \}\)/);
    expect(h).toContain('overwriteRemoteEdits: overwriteRemoteEdits === true');
    expect(h).toContain('overrideQa: !!overrideQa');
  });

  it('ONBOARDING_CHAIN denetimi sistem taramasi (haftalik olcum hakki dusmez)', () => {
    const h = between('ONBOARDING_CHAIN: async', 'PROCESS_SCHEDULED: async');
    expect(h).toContain("services.audit.runAudit(siteId, { trigger: 'system' })");
    expect(h).not.toMatch(/runAudit\(siteId\)/);
  });
});
