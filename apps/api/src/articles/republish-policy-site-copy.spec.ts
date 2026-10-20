import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));

const {
  recordedWordPressStatus, selectPublishTargets, siteLiveEntries, statusAfterRetirement, unseenWordPressDraftCopy, wordPressLinkNeedsSighting,
  wordPressNonPublicCopy, wordPressPlainLink,
} = await import('./republish-policy.js');
// Canlilik denetiminin kendi kurallari: paylasilan islevler onlarla birebir ayni karar vermeli
const liveness = await import('./published-liveness.service.js');

/**
 * Iki paylasilan kural (republish-policy.ts):
 *  1. siteLiveEntries — "sitedeki canli kopya": Markdown ZIP disa aktarimi sitede kopya
 *     sayilmaz. Yayinci (cop kutusu / silinmis kopya), "bu kaydi unut" ve canlilik
 *     denetimi ayni kurali kullanir (statusAfterRetirement).
 *  2. unseenWordPressDraftCopy — adresi hic canli gorulmemis ve herkese acik oldugu
 *     bilinmeyen WordPress kopyasi: canlilik denetiminin "once bir kez canli gorulmeli"
 *     kosulu; site haritasi ve llms-full bu adresi ilan etmez. Karar KAYITTAKI yazi
 *     durumundan (remoteStatus: RanksUp'in son yaziminda WordPress'in bildirdigi), hedefin
 *     bugunku ayarindan degil (rv18 F2: hedef Taslak'tan Yayında'ya alininca WordPress'te
 *     taslak kalan eski yazilar emekliye ayriliyordu).
 */

const wp = (over: Record<string, unknown> = {}) => ({ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '7', externalUrl: 'https://site.com/yazi/', ...over });
const zip = (over: Record<string, unknown> = {}) => ({ targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi.zip', ...over });
const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/yazi.html' };
const ghost = { targetId: 'ghost', targetType: 'GHOST', ok: true, externalId: 'g1' };

describe('siteLiveEntries — sitedeki canli kopyalar (Markdown ZIP ve emekli kopya haric)', () => {
  it('ZIP disa aktarimi, cop kutusundaki ve silinmis kopya sayilmaz; WordPress, dosya hedefi ve yalniz yeni kayit acan CMS sayilir', () => {
    const list = [wp(), zip(), ftp, ghost, wp({ targetId: 'wp2', trashedAt: '2026-10-01T00:00:00.000Z' }), wp({ targetId: 'wp3', missingAt: '2026-10-02T00:00:00.000Z' })];
    expect(siteLiveEntries(list).map((e) => e.targetId)).toEqual(['wp', 'ftp', 'ghost']);
    expect(siteLiveEntries([zip()])).toEqual([]);
    expect(siteLiveEntries(null)).toEqual([]);
  });

  it('tip once hedef satirindan, yoksa kayittaki targetType\'tan', () => {
    // Kayitta tip yok ama hedef satiri ZIP: disa aktarim
    expect(siteLiveEntries([zip({ targetType: undefined })], (id) => (id === 'zip' ? 'MARKDOWN_ZIP' : undefined))).toEqual([]);
    // Hedef silinmis (typeOf undefined): kayittaki tip gecerli
    expect(siteLiveEntries([zip()], () => undefined)).toEqual([]);
    expect(siteLiveEntries([wp()], () => undefined).map((e) => e.targetId)).toEqual(['wp']);
  });

  it('statusAfterRetirement ayni kurali kullanir: yalniz ZIP kalan PUBLISHED yazi READY_TO_PUBLISH; diger durumlar degismez', () => {
    expect(statusAfterRetirement('PUBLISHED', [zip()])).toBe('READY_TO_PUBLISH');
    expect(statusAfterRetirement('PUBLISHED', [zip(), ghost])).toBe('PUBLISHED');
    expect(statusAfterRetirement('READY_TO_PUBLISH', [zip()])).toBe('READY_TO_PUBLISH');
    expect(statusAfterRetirement('REVIZE_NEEDED', [])).toBe('REVIZE_NEEDED');
  });

  it('hedef secimi degismedi: bos listede yalniz ZIP kaydi olan yazi varsayilan site hedefine gider (S25)', () => {
    const targets = [{ id: 'zip', type: 'MARKDOWN_ZIP', isDefault: false, isActive: true }, { id: 'ftp', type: 'FTP', isDefault: true, isActive: true }];
    expect(selectPublishTargets(targets, [], [zip()]).targets.map((t) => t.id)).toEqual(['ftp']);
    expect(selectPublishTargets(targets, [], [zip(), ftp]).targets.map((t) => t.id)).toEqual(['zip', 'ftp']);
  });
});

describe('WordPress taslak baglantisi — canlilik denetimiyle ayni kural', () => {
  // Hedefin bugunku "Yayın durumu" ayarinin her hali: hicbir karar buna bagli olmamali
  const TARGETS = [undefined, { type: 'WORDPRESS_REST', config: { postStatus: 'draft' } }, { type: 'WORDPRESS_REST', config: {} }, { type: 'WORDPRESS_XMLRPC', config: { postStatus: 'publish' } }, { type: 'WORDPRESS_REST', config: null }];

  it('wordPressPlainLink canlilik servisinin disa aktardigi islevle ayni karari verir', () => {
    for (const url of ['https://s.com/?p=12', 'https://s.com/blog/?p=12&preview=true', 'https://s.com/yazi/', 'https://s.com/?p=abc', 'https://s.com/?page_id=3', 'bozuk adres']) {
      expect(wordPressPlainLink(url), url).toBe(liveness.wordPressPlainLink(url));
    }
  });

  it('recordedWordPressStatus / wordPressNonPublicCopy: kayittaki durum (kucuk harf, bosluksuz); yalniz "publish" herkese acik; yoksa bilinmiyor', () => {
    expect(recordedWordPressStatus(wp({ remoteStatus: 'publish' }))).toBe('publish');
    expect(recordedWordPressStatus(wp({ remoteStatus: ' Draft ' }))).toBe('draft');
    for (const v of [undefined, null, '', '  ', 42, {}]) expect(recordedWordPressStatus(wp({ remoteStatus: v })), String(v)).toBeNull();
    expect(wordPressNonPublicCopy(wp({ remoteStatus: 'publish' }))).toBe(false);
    for (const st of ['draft', 'pending', 'private', 'future', 'ozel-durum']) expect(wordPressNonPublicCopy(wp({ remoteStatus: st })), st).toBe(true);
    // Bilinmeyen durum herkese acik olmayan sayilmaz (bildirim genel metni kullanir)
    expect(wordPressNonPublicCopy(wp())).toBe(false);
  });

  it('wordPressLinkNeedsSighting = canlilik denetiminin WordPress kopyasi icin needsSighting karari; hedefin ayari karari degistirmez', () => {
    const site = new URL('https://isgetkinlikleri.com');
    const durumlar: Array<[unknown, string, boolean]> = [
      // [kayittaki durum, adres, beklenen]
      ['publish', 'https://isgetkinlikleri.com/?p=7', false],
      ['publish', 'https://isgetkinlikleri.com/etkinlik/', false],
      ['draft', 'https://isgetkinlikleri.com/?p=7', true],
      ['private', 'https://isgetkinlikleri.com/etkinlik/', true],
      ['pending', 'https://isgetkinlikleri.com/?p=7', true],
      [undefined, 'https://isgetkinlikleri.com/?p=7', true],
      [undefined, 'https://isgetkinlikleri.com/etkinlik/', false],
    ];
    for (const [remoteStatus, url, beklenen] of durumlar) {
      for (const target of TARGETS) {
        const entry = { targetId: 'wp', targetType: String(target?.type ?? 'WORDPRESS_REST'), ok: true, externalId: '7', externalUrl: url, ...(remoteStatus !== undefined ? { remoteStatus } : {}) };
        const ad = `${String(remoteStatus)} ${url} ${JSON.stringify(target)}`;
        expect(wordPressLinkNeedsSighting(entry, url), ad).toBe(beklenen);
        expect(liveness.livenessCheckTarget(site, 'etkinlik', entry, target)?.needsSighting, ad).toBe(beklenen);
      }
    }
  });

  it('unseenWordPressDraftCopy: herkese acik oldugu bilinmeyen kopya + hic canli gorulmemis — hedef "Yayında" olsa da', () => {
    const duz = wp({ externalUrl: 'https://site.com/?p=41' });
    // Eski kayit (durum yok) duz ?p=: hedefin ayari ne olursa olsun once gorulmeli
    for (const t of TARGETS) expect(unseenWordPressDraftCopy(duz, t?.type), JSON.stringify(t)).toBe(true);
    // RanksUp en son taslak / ozel olarak yazdi: guzel baglanti olsa da
    expect(unseenWordPressDraftCopy(wp({ remoteStatus: 'draft' }), 'WORDPRESS_REST')).toBe(true);
    expect(unseenWordPressDraftCopy({ ...duz, targetType: 'WORDPRESS_XMLRPC', remoteStatus: 'pending' }, 'WORDPRESS_XMLRPC')).toBe(true);
    expect(unseenWordPressDraftCopy(wp({ remoteStatus: 'private' }), undefined)).toBe(true);
    // Eski kayit: adres yalniz url alaninda
    expect(unseenWordPressDraftCopy({ targetId: 'wp', targetType: 'WORDPRESS_REST', url: 'https://site.com/?p=41' }, 'WORDPRESS_REST')).toBe(true);
    // Gecersiz liveSeenAt canli gorulme sayilmaz
    expect(unseenWordPressDraftCopy({ ...duz, liveSeenAt: 'bozuk' }, 'WORDPRESS_REST')).toBe(true);
  });

  it('ilan edilir: yazim aninda herkese acik (publish), canli gorulmus adres, durumu bilinmeyen guzel baglanti; WordPress olmayan hedef', () => {
    const duz = wp({ externalUrl: 'https://site.com/?p=41' });
    expect(unseenWordPressDraftCopy({ ...duz, remoteStatus: 'publish' }, 'WORDPRESS_REST')).toBe(false);
    expect(unseenWordPressDraftCopy({ ...duz, liveSeenAt: '2026-10-19T02:20:00.000Z' }, 'WORDPRESS_REST')).toBe(false);
    expect(unseenWordPressDraftCopy(wp({ remoteStatus: 'draft', liveSeenAt: '2026-10-19T02:20:00.000Z' }), 'WORDPRESS_REST')).toBe(false);
    expect(unseenWordPressDraftCopy(wp(), 'WORDPRESS_REST')).toBe(false);
    // Hedef satiri yoksa kayittaki tip
    expect(unseenWordPressDraftCopy(wp(), undefined)).toBe(false);
    expect(unseenWordPressDraftCopy({ ...ghost, externalUrl: 'https://site.com/?p=41' }, 'GHOST')).toBe(false);
    expect(unseenWordPressDraftCopy(wp({ externalUrl: undefined }), 'WORDPRESS_REST')).toBe(false);
  });
});
