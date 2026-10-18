import { describe, it, expect } from 'vitest';
import { PublishTargetType } from '@prisma/client';
import { getAdapter } from '@luviai/adapters';
import {
  EXPORT_TARGET_TYPES, OVERWRITE_TARGET_TYPES, UPDATE_TARGET_TYPES, activeLiveWriteBlock, agentOutputsWithLiveWriteBlocked,
  agentOutputsWithoutLiveWriteBlocked, applyEntryObservations, articleContentHash, decideRepublish, entryMissing, entryRetired, entryTrashed,
  lastLiveWriteAt, liveCopyStale, liveEntries, liveEntryFor, liveEntryRef, liveEntrySlug, publishSkipText, publishedEntryFor,
  refreshManualUpdateFlags, republishModeForType, selectPublishTargets,
} from './republish-policy.js';

/**
 * Yeniden yayin kurali (I-1): hangi hedef yayindaki yaziyi guncelleyebilir,
 * hangisi ayni yolun uzerine yazar, hangisinde kopya acilacagi icin yayin
 * yapilmaz. Yayinci ve takili sayfa plani ayni tabloyu kullanir.
 */

describe('karar tablosu adaptorlerle tutarli', () => {
  it('update yalniz gercekten update() tanimlayan adaptorlerde (WordPress REST / XML-RPC)', () => {
    const all = [...Object.values(PublishTargetType), 'SHOPIFY', 'WIX'];
    for (const type of all) {
      const Adapter = getAdapter(type) as any;
      expect(Adapter, type).toBeTruthy();
      expect(typeof Adapter.prototype.update === 'function', type).toBe(UPDATE_TARGET_TYPES.has(type));
    }
    expect([...UPDATE_TARGET_TYPES].sort()).toEqual(['WORDPRESS_REST', 'WORDPRESS_XMLRPC']);
  });

  it('veritabanindaki her hedef tipi bilincli siniflandirilmis; yeni kayit acanlar listesi acik', () => {
    const createOnly = Object.values(PublishTargetType).filter((t) => republishModeForType(t) === 'create_only').sort();
    // Yeni bir tip eklenince burasi kirilir: guncelleme / uzerine yazma davranisi okunup karar verilmeli
    expect(createOnly).toEqual(['CONTENTFUL', 'CUSTOM_PHP', 'GHOST', 'SANITY', 'STRAPI', 'WEBFLOW', 'WHMCS_KB']);
    expect([...OVERWRITE_TARGET_TYPES].sort()).toEqual(['CPANEL_API', 'FTP', 'GITHUB', 'KOBIPRATIK', 'SFTP']);
    expect([...EXPORT_TARGET_TYPES]).toEqual(['MARKDOWN_ZIP']);
    expect(republishModeForType('BILINMEYEN')).toBe('create_only');
  });
});

describe('decideRepublish', () => {
  const wp = (over: Record<string, unknown> = {}) => ({ targetId: 'wp', ok: true, ...over });

  it('canli kayit yoksa ilk yayin (publish_new) — tip ne olursa olsun', () => {
    for (const type of ['WORDPRESS_REST', 'GHOST', 'FTP', 'MARKDOWN_ZIP']) {
      expect(decideRepublish({ entry: null, targetType: type, articleSlug: 'yazi' }), type).toEqual({ kind: 'publish_new' });
    }
  });

  it('WordPress: kimlik, ?p= ya da adresteki slug ile update; adres yoksa unaddressable', () => {
    expect(decideRepublish({ entry: wp({ externalId: '41', externalUrl: 'https://s.com/yazi/' }), targetType: 'WORDPRESS_REST' }))
      .toEqual({ kind: 'update', ref: { externalId: '41', externalUrl: 'https://s.com/yazi/' } });
    expect(decideRepublish({ entry: wp({ externalUrl: 'https://s.com/?p=9' }), targetType: 'WORDPRESS_XMLRPC' }))
      .toEqual({ kind: 'update', ref: { externalUrl: 'https://s.com/?p=9' } });
    // Eski kayitlarda adres `url` alaninda
    expect(decideRepublish({ entry: wp({ url: 'https://s.com/yazi/' }), targetType: 'WORDPRESS_REST' }))
      .toEqual({ kind: 'update', ref: { externalUrl: 'https://s.com/yazi/' } });
    for (const entry of [wp(), wp({ externalUrl: 'https://s.com/' }), wp({ externalId: 'abc' }), wp({ externalUrl: 'yazi' })]) {
      expect(decideRepublish({ entry, targetType: 'WORDPRESS_REST' }), JSON.stringify(entry)).toEqual({ kind: 'blocked', reason: 'unaddressable' });
    }
  });

  it('WordPress update slug gondermez: yazinin slug\'i degismis olsa da update', () => {
    expect(decideRepublish({ entry: wp({ externalId: '41', externalUrl: 'https://s.com/eski/' }), targetType: 'WORDPRESS_REST', articleSlug: 'yeni' }).kind).toBe('update');
  });

  it('yol tabanli hedefler: ayni slug → overwrite, farkli slug → slug_changed (her adaptorun adres bicimi)', () => {
    const cases: Array<[string, string]> = [
      ['FTP', 'ftp://h.example/public_html/blog/yazi.html'],
      ['SFTP', '/home/u/public_html/blog/yazi.html'],
      ['CPANEL_API', 'https://site.example/blog/yazi'],
      ['GITHUB', 'https://github.com/o/r/blob/main/content/posts/yazi.md'],
      ['KOBIPRATIK', 'https://www.kobipratik.com/pratik-kobi-rehberi/yazi'],
    ];
    for (const [type, url] of cases) {
      const entry = { targetId: 't', ok: true, externalUrl: url };
      expect(liveEntrySlug(entry), type).toBe('yazi');
      expect(decideRepublish({ entry, targetType: type, articleSlug: 'yazi' }), type).toEqual({ kind: 'overwrite' });
      expect(decideRepublish({ entry, targetType: type, articleSlug: 'YAZI' }), `${type} buyuk harf`).toEqual({ kind: 'overwrite' });
      expect(decideRepublish({ entry, targetType: type, articleSlug: 'yeni-yazi' }), type).toEqual({ kind: 'blocked', reason: 'slug_changed', liveSlug: 'yazi' });
    }
    // Adres yoksa ya da slug bilinmiyorsa eski davranis (uzerine yaz)
    expect(decideRepublish({ entry: { targetId: 't', ok: true }, targetType: 'FTP', articleSlug: 'yazi' })).toEqual({ kind: 'overwrite' });
    expect(decideRepublish({ entry: { targetId: 't', ok: true, externalUrl: 'ftp://h/b/x.html' }, targetType: 'FTP' })).toEqual({ kind: 'overwrite' });
  });

  it('Markdown ZIP export; digerleri create_only', () => {
    expect(decideRepublish({ entry: { targetId: 'z', ok: true }, targetType: 'MARKDOWN_ZIP' })).toEqual({ kind: 'export' });
    for (const type of ['GHOST', 'STRAPI', 'WEBFLOW', 'SANITY', 'CONTENTFUL', 'WHMCS_KB', 'CUSTOM_PHP', 'SHOPIFY', 'WIX']) {
      expect(decideRepublish({ entry: { targetId: 'x', ok: true, externalId: '1' }, targetType: type }), type).toEqual({ kind: 'blocked', reason: 'create_only' });
    }
  });
});

describe('publishedTo okuma', () => {
  it('canli kayit: nesne, hedef kimligi var, ok:false degil', () => {
    const list = [{ targetId: 'a', ok: true }, { targetId: 'b', ok: false }, { targetId: '' }, null, 'bozuk', { ok: true }, { targetId: 'c' }];
    expect(liveEntries(list).map((e) => e.targetId)).toEqual(['a', 'c']);
    expect(liveEntries(null)).toEqual([]);
    expect(liveEntryFor(list, 'b')).toBeNull();
    expect(liveEntryFor(list, 'c')).toEqual({ targetId: 'c' });
    expect(liveEntryRef({ targetId: 'x', externalId: 12 as unknown as string })).toEqual({ externalId: '12' });
  });

  it('lastLiveWriteAt: kayitlarin en yeni updatedAt\'i (yoksa null)', () => {
    expect(lastLiveWriteAt([{ targetId: 'a', updatedAt: '2026-03-01T00:00:00.000Z' }, { targetId: 'b', updatedAt: '2026-05-01T00:00:00.000Z' }, { targetId: 'c', ok: false, updatedAt: '2027-01-01T00:00:00.000Z' }]))
      .toEqual(new Date('2026-05-01T00:00:00.000Z'));
    expect(lastLiveWriteAt([{ targetId: 'a' }])).toBeNull();
    expect(lastLiveWriteAt(undefined)).toBeNull();
  });
});

describe('selectPublishTargets (paylasilan sozlesme D1)', () => {
  const t = (id: string, isDefault: boolean, isActive = true, type = 'FTP') => ({ id, type, isDefault, isActive });
  const all = [t('ftp', true), t('wp', false, true, 'WORDPRESS_REST'), t('pasif', true, false)];

  it('hedef verildiyse YALNIZ onlar (pasif dahil — kullanici secti); secilmeyen aktif canli kopya yazilmaz, notSelectedLive\'da doner (S5/S11)', () => {
    // Yazi FTP'de yayinda; kullanici FTP'yi bilerek secmedi: FTP'ye yazilmaz
    // (11. turda addedLive onu kendiliginden ekliyordu)
    expect(selectPublishTargets(all, ['wp', 'pasif', 'yok'], [{ targetId: 'ftp', ok: true }]))
      .toEqual({ targets: [all[1], all[2]], unavailableLive: [], notSelectedLive: [{ targetId: 'ftp', ok: true }] });
    // Secilen zaten canli hedefse secilmeyen yok
    expect(selectPublishTargets(all, ['ftp'], [{ targetId: 'ftp', ok: true }]))
      .toEqual({ targets: [all[0]], unavailableLive: [], notSelectedLive: [] });
  });

  it('acik secimde "secilmedi" sayilmayanlar: pasif canli hedef, cop kutusundaki / silinmis kopya, Markdown ZIP disa aktarimi (canli kopya degil)', () => {
    const withZip = [...all, t('zip', false, true, 'MARKDOWN_ZIP'), t('wp2', false, true, 'WORDPRESS_REST'), t('wp3', false, true, 'WORDPRESS_REST')];
    const r = selectPublishTargets(withZip, ['ftp'], [
      { targetId: 'pasif', ok: true },
      { targetId: 'zip', ok: true },
      { targetId: 'wp2', ok: true, trashedAt: '2026-10-01T00:00:00.000Z' },
      { targetId: 'wp3', ok: true, missingAt: '2026-10-02T00:00:00.000Z' },
      { targetId: 'wp', ok: false },
    ]);
    expect(r).toEqual({ targets: [withZip[0]], unavailableLive: [], notSelectedLive: [] });
  });

  it('ayni hedefin birden fazla canli kaydi tek "secilmedi" kaydi uretir; yalniz yeni kayit acan hedef de raporlanir', () => {
    const ghost = t('g', false, true, 'GHOST');
    const r = selectPublishTargets([...all, ghost], ['ftp'], [{ targetId: 'wp', ok: true, externalId: '1' }, { targetId: 'wp', ok: true, externalId: '2' }, { targetId: 'g', ok: true }]);
    expect(r.targets).toEqual([all[0]]);
    expect(r.notSelectedLive).toEqual([{ targetId: 'wp', ok: true, externalId: '1' }, { targetId: 'g', ok: true }]);
  });

  it('otomasyon + yazi yayinda: yayinda oldugu AKTIF hedefler; pasif / silinmis olanlar raporlanir', () => {
    const r = selectPublishTargets(all, [], [{ targetId: 'wp', ok: true }, { targetId: 'pasif', ok: true }, { targetId: 'silinmis', ok: true }, { targetId: 'wp', ok: true }]);
    expect(r.targets).toEqual([all[1]]);
    expect(r.unavailableLive.map((e) => e.targetId)).toEqual(['pasif', 'silinmis']);
    expect(r.notSelectedLive).toEqual([]);
  });

  it('otomasyon + yazi hic yayinlanmamis (ya da tek kopyasi cop kutusunda / silinmis): varsayilan + aktif hedefler', () => {
    const none = { targets: [all[0]], unavailableLive: [], notSelectedLive: [] };
    expect(selectPublishTargets(all, [], null)).toEqual(none);
    expect(selectPublishTargets(all, [], [{ targetId: 'wp', ok: false }])).toEqual(none);
    expect(selectPublishTargets(all, [], [{ targetId: 'wp', ok: true, trashedAt: '2026-10-01T00:00:00.000Z' }])).toEqual(none);
    expect(selectPublishTargets(all, [], [{ targetId: 'wp', ok: true, missingAt: '2026-10-01T00:00:00.000Z' }])).toEqual(none);
  });

  it('S25: bos liste + yazinin YALNIZ Markdown ZIP disa aktarimi var: sitede canli kopya yok sayilir, varsayilan site hedefi secilir (ZIP yeniden uretilmez)', () => {
    const wpDef = t('wp', true, true, 'WORDPRESS_REST');
    const zip = t('zip', false, true, 'MARKDOWN_ZIP');
    const zipOnly = [{ targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, action: 'exported', externalUrl: '/tmp/yazi.zip' }];
    expect(selectPublishTargets([wpDef, zip], [], zipOnly)).toEqual({ targets: [wpDef], unavailableLive: [], notSelectedLive: [] });
    // ZIP hedefi silinmis olsa da (kayitta yalniz tip): canli kopya degil, "hedef pasif" raporlanmaz
    expect(selectPublishTargets([wpDef], [], zipOnly)).toEqual({ targets: [wpDef], unavailableLive: [], notSelectedLive: [] });
    // WordPress'te de yayindaysa (canli kopya + ZIP) eskisi gibi canli hedefler; ZIP yeniden uretilir
    const both = [{ targetId: 'wp', ok: true, externalId: '41' }, ...zipOnly];
    expect(selectPublishTargets([wpDef, zip], [], both).targets).toEqual([wpDef, zip]);
    // ...ve silinmis ZIP hedefi canli kopya olmadigi icin unavailableLive'a girmez
    expect(selectPublishTargets([wpDef], [], both)).toEqual({ targets: [wpDef], unavailableLive: [], notSelectedLive: [] });
  });
});

describe('Turkce nedenler', () => {
  it('yeni kayit acan hedef: ne oldugu ve ne yapilacagi; "yayınlandı" demez', () => {
    const text = publishSkipText('already_live_create_only', 'GHOST');
    expect(text).toBe('Bu yazı Ghost üzerinde zaten yayında. Bu yayın hedefi mevcut yazıyı yerinde güncelleyemediği için kopya açılmadı; güncel metni Ghost panelinden elle güncelleyin.');
    expect(publishSkipText('already_live_create_only', 'CUSTOM_PHP')).toContain('kendi sisteminizden elle güncelleyin');
    expect(publishSkipText('slug_changed', 'FTP', { liveSlug: 'eski', slug: 'yeni' })).toContain('(yayındaki: eski, şimdiki: yeni)');
    expect(publishSkipText('live_entry_trashed', 'WORDPRESS_REST')).toContain('WordPress panelinden çöp kutusundan geri yükleyin');
    expect(publishSkipText('live_target_inactive', 'WORDPRESS_XMLRPC')).toContain('Yazının yayında olduğu hedef (WordPress) silinmiş ya da pasif');
    for (const skip of ['already_live_create_only', 'live_entry_unaddressable', 'slug_changed', 'live_entry_trashed', 'live_target_inactive'] as const) {
      expect(publishSkipText(skip, 'GHOST')).not.toMatch(/yayınlandı\b/);
    }
  });
});

describe('cop kutusundaki kopya (trashedAt, sozlesme C3 — R19)', () => {
  const live = { targetId: 'wp', ok: true, externalId: '41', updatedAt: '2026-09-01T00:00:00.000Z' };
  const trashed = { targetId: 'wp2', ok: true, externalId: '42', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: '2026-10-05T00:00:00.000Z' };

  it('canli sayilmaz (liveEntries, liveEntryFor, lastLiveWriteAt); yayincinin kayit aramasi (publishedEntryFor) yine bulur', () => {
    expect(entryTrashed(trashed)).toBe(true);
    expect(entryTrashed(live)).toBe(false);
    expect(entryTrashed({ ...live, trashedAt: '' })).toBe(false);
    expect(liveEntries([live, trashed]).map((e) => e.targetId)).toEqual(['wp']);
    expect(liveEntryFor([live, trashed], 'wp2')).toBeNull();
    expect(publishedEntryFor([live, trashed], 'wp2')).toEqual(trashed);
    expect(publishedEntryFor([{ ...trashed, ok: false }], 'wp2')).toBeNull();
    // Son canli yazim cop kutusundaki kopyanin tarihi DEGIL
    expect(lastLiveWriteAt([live, trashed])).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('gozlemler: cop kutusu trashedAt yazar (ilk an korunur, elle guncelleme isareti kalkar); geri yuklenen kopyadan trashedAt kalkar; girdi degismez', () => {
    const flagged = { ...live, manualUpdatePending: true, manualUpdatePendingSince: '2026-09-02T00:00:00.000Z' };
    const input = [flagged, trashed, null, { targetId: 'g', ok: false }];
    const snapshot = JSON.stringify(input);
    const out = applyEntryObservations(input, { trashed: new Set(['wp', 'wp2']), now: '2026-10-18T00:00:00.000Z' });
    expect(out[0]).toEqual({ ...live, trashedAt: '2026-10-18T00:00:00.000Z' });
    expect(out[1]).toBe(trashed);
    expect(out.slice(2)).toEqual([null, { targetId: 'g', ok: false }]);
    const restored = applyEntryObservations([trashed], { present: new Set(['wp2']), now: '2026-10-18T00:00:00.000Z' });
    expect(restored).toEqual([{ targetId: 'wp2', ok: true, externalId: '42', updatedAt: '2026-10-01T00:00:00.000Z' }]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('cakisma denetiminin dayanaklari (liveEntryRef)', () => {
  it('kayittaki WordPress damgasi ve RanksUp\'in son yazimi (updatedAt, yoksa publishedAt) adaptore gider; bozuk tarih gitmez', () => {
    expect(liveEntryRef({ targetId: 'wp', externalId: '41', remoteModifiedAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:05.000Z', publishedAt: '2026-08-01T00:00:00.000Z' }))
      .toEqual({ externalId: '41', remoteModifiedAt: '2026-09-01T10:00:00.000Z', lastWriteAt: '2026-09-01T10:00:05.000Z' });
    expect(liveEntryRef({ targetId: 'wp', externalId: '41', publishedAt: '2026-08-01T00:00:00.000Z' }))
      .toEqual({ externalId: '41', lastWriteAt: '2026-08-01T00:00:00.000Z' });
    expect(liveEntryRef({ targetId: 'wp', externalId: '41', remoteModifiedAt: 'dun', updatedAt: 7 })).toEqual({ externalId: '41' });
  });
});

describe('WordPress\'te degismis / kimligi tutmayan kopya: elle guncelleme isareti (C2)', () => {
  const NOW = '2026-10-18T09:00:00.000Z';
  const HASH = articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı' });
  const TARGETS = [{ id: 't-wp', type: 'WORDPRESS_REST', isActive: true }];
  const wp = (over: Record<string, unknown> = {}) => ({ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', ...over });
  const refresh = (entry: Record<string, unknown>, unwritable?: Set<string>) => refreshManualUpdateFlags({
    publishedTo: [entry], targets: TARGETS, articleSlug: 'yazi', contentHash: HASH, legacyContentChanged: false, unwritableTargetIds: unwritable, now: NOW,
  });

  it('normalde guncellenebilen WordPress kopyasi, yazilamadiysa ve metin farkliysa isaretlenir; ayni metinde isaret yok', () => {
    expect(refresh(wp({ contentHash: 'eski' })).changed).toBe(false);
    expect(refresh(wp({ contentHash: 'eski' }), new Set(['t-wp'])).publishedTo[0]).toMatchObject({ manualUpdatePending: true, manualUpdatePendingSince: NOW });
    expect(refresh(wp({ contentHash: HASH }), new Set(['t-wp'])).changed).toBe(false);
  });
});

describe('Turkce nedenler — WordPress\'te degismis ve kimligi tutmayan kopya (C2)', () => {
  it('live_entry_edited: ne oldugu, neden yazilmadigi ve iki secenek; tarih Turkiye saatiyle', () => {
    expect(publishSkipText('live_entry_edited', 'WORDPRESS_REST', { remoteModifiedAt: '2026-09-05T08:30:00.000Z' })).toBe(
      "Bu yazı WordPress üzerinde, RanksUp'ın son yazımından sonra değiştirilmiş (son değişiklik: 05.09.2026 11:30): orada düzenlenmiş, taslaktan yayına alınmış, çöp kutusundan geri yüklenmiş ya da yazıya bir SEO düzeltmesi (meta, görsel alt metni) uygulanmış olabilir. Yapılan değişikliklerin üzerine yazılmadı ve kopya açılmadı. Güncel metni WordPress panelinden elle uygulayabilir ya da WordPress'teki değişikliklerin üzerine yazılmasını açıkça onaylayarak yeniden yayınlayabilirsiniz.",
    );
    expect(publishSkipText('live_entry_edited', 'WORDPRESS_XMLRPC')).toContain('değiştirilmiş: orada düzenlenmiş');
  });

  it('live_entry_mismatch: kimlik, iki adres ve olasi nedenler; hedeften gelen slug temizlenir', () => {
    const text = publishSkipText('live_entry_mismatch', 'WORDPRESS_REST', { postId: '123', remoteSlug: 'hakkimizda', slug: 'kdv-beyani-rehberi' });
    expect(text).toBe(
      "WordPress üzerinde kayıtlı yazı kimliği (#123) artık bu yazıya ait görünmüyor. O kimlikteki yazının adresi: hakkimizda; bu yazınınki: kdv-beyani-rehberi. Site taşındıysa, yedekten geri dönüldüyse ya da yayın hedefi başka bir siteye bağlandıysa kimlikler değişmiş olabilir; yazının adresi WordPress'te değiştirilmiş de olabilir. Başka bir yazının üzerine yazmamak için güncellenmedi ve kopya açılmadı. Yazının WordPress'teki yerini kontrol edip güncel metni doğru yazıya elle uygulayabilirsiniz.",
    );
    const odd = publishSkipText('live_entry_mismatch', 'WORDPRESS_REST', { postId: 'abc', remoteSlug: '<script>x</script>' });
    expect(odd).not.toContain('<script>');
    expect(odd).not.toContain('#abc');
    for (const skip of ['live_entry_edited', 'live_entry_mismatch'] as const) expect(publishSkipText(skip, 'WORDPRESS_REST')).not.toMatch(/yayınlandı\b/);
  });
});

describe('silinmis kopya (missingAt, sozlesme D3 — S18)', () => {
  const live = { targetId: 'wp', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', updatedAt: '2026-09-01T00:00:00.000Z' };
  const missing = { targetId: 'wp2', ok: true, externalId: '42', externalUrl: 'https://s.example/eski/', updatedAt: '2026-10-01T00:00:00.000Z', missingAt: '2026-10-05T00:00:00.000Z' };

  it('canli sayilmaz (liveEntries, liveEntryFor, lastLiveWriteAt); yayincinin kayit aramasi (publishedEntryFor) yine bulur; tek kural entryRetired', () => {
    expect(entryMissing(missing)).toBe(true);
    expect(entryMissing({ ...missing, missingAt: '' })).toBe(false);
    expect(entryMissing(live)).toBe(false);
    for (const e of [missing, { ...live, trashedAt: '2026-10-05T00:00:00.000Z' }]) expect(entryRetired(e), JSON.stringify(e)).toBe(true);
    expect(entryRetired(live)).toBe(false);
    expect(entryRetired(null)).toBe(false);
    expect(liveEntries([live, missing]).map((e) => e.targetId)).toEqual(['wp']);
    expect(liveEntryFor([live, missing], 'wp2')).toBeNull();
    expect(publishedEntryFor([live, missing], 'wp2')).toEqual(missing);
    // Son canli yazim silinmis kopyanin tarihi DEGIL
    expect(lastLiveWriteAt([live, missing])).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('gozlem: missing → missingAt (ilk an korunur), elle guncelleme isareti kalkar, kimlik / adres / trashedAt kalir; girdi degismez', () => {
    const flagged = { ...live, manualUpdatePending: true, manualUpdatePendingSince: '2026-09-02T00:00:00.000Z', trashedAt: '2026-09-20T00:00:00.000Z' };
    const input = [flagged, missing];
    const snapshot = JSON.stringify(input);
    const out = applyEntryObservations(input, { missing: new Set(['wp', 'wp2']), now: '2026-10-18T00:00:00.000Z' });
    expect(out[0]).toEqual({ ...live, trashedAt: '2026-09-20T00:00:00.000Z', missingAt: '2026-10-18T00:00:00.000Z' });
    // Zaten isaretli, elle guncelleme isareti olmayan kayit aynen doner (gereksiz yazim yok)
    expect(out[1]).toBe(missing);
    expect(JSON.stringify(input)).toBe(snapshot);
    // Isaretli kayitta elle guncelleme isareti temizlenir ama ilk gorulen an korunur
    const flaggedMissing = { ...missing, manualUpdatePending: true, manualUpdatePendingSince: '2026-10-06T00:00:00.000Z' };
    expect(applyEntryObservations([flaggedMissing], { missing: new Set(['wp2']), now: '2026-10-18T00:00:00.000Z' })).toEqual([missing]);
  });

  it('gozlem: yazi yeniden goruldu (present / cop kutusunda) → missingAt kalkar', () => {
    expect(applyEntryObservations([missing], { present: new Set(['wp2']), now: '2026-10-18T00:00:00.000Z' }))
      .toEqual([{ targetId: 'wp2', ok: true, externalId: '42', externalUrl: 'https://s.example/eski/', updatedAt: '2026-10-01T00:00:00.000Z' }]);
    expect(applyEntryObservations([missing], { trashed: new Set(['wp2']), now: '2026-10-18T00:00:00.000Z' }))
      .toEqual([{ targetId: 'wp2', ok: true, externalId: '42', externalUrl: 'https://s.example/eski/', updatedAt: '2026-10-01T00:00:00.000Z', trashedAt: '2026-10-18T00:00:00.000Z' }]);
  });

  it('silinmis kopya "elle guncelleme bekliyor" diye isaretlenmez (yapistirilacak sayfa yok)', () => {
    const r = refreshManualUpdateFlags({
      publishedTo: [{ ...missing, contentHash: 'eski' }], targets: [{ id: 'wp2', type: 'WORDPRESS_REST', isActive: true }],
      articleSlug: 'yazi', contentHash: 'yeni', legacyContentChanged: true, unwritableTargetIds: new Set(['wp2']), now: '2026-10-18T00:00:00.000Z',
    });
    expect(r.changed).toBe(false);
    expect(r.pendingTargetIds).toEqual([]);
  });

  it('live_entry_missing metni: yeniden olusturmanin TEK yolunu (hedefi secerek yayin) ve kaydin artik yayinda sayilmadigini soyler', () => {
    const text = publishSkipText('live_entry_missing', 'WORDPRESS_REST');
    expect(text).toContain('WordPress üzerinde artık bulunamadı');
    expect(text).toContain('yeniden oluşturulmadı');
    expect(text).toContain('RanksUp bu kopyayı artık yayında saymıyor');
    expect(text).toContain('yazının sayfasında WordPress hedefini seçerek yeniden yayınlayın');
    expect(text).not.toMatch(/yayınlandı\b/);
  });

  it('S18: kimlik cozulmuyor ama adres aciliyor — kopya yayinda sayilir, yeniden olusturma ONERILMEZ (ayni adreste ikinci kopya olurdu)', () => {
    const text = publishSkipText('live_entry_unresolvable', 'WORDPRESS_REST', { postId: '123' });
    expect(text).toContain('kayıtlı kimliğiyle (#123) bulunamadı, ancak yazının adresi hâlâ açılıyor');
    expect(text).toContain('RanksUp bu kopyayı yayında saymaya devam ediyor');
    expect(text).toContain('WordPress panelinden bu adresteki yazıya elle uygulayabilirsiniz');
    expect(text).not.toMatch(/yeniden yayınla|yeniden oluşturur|yayınlandı\b/);
    // Hedeften gelmeyen ama dogrulanmayan kimlik metne girmez
    expect(publishSkipText('live_entry_unresolvable', 'WORDPRESS_REST', { postId: '<b>1</b>' })).toContain('kayıtlı kimliğiyle bulunamadı');
  });

  it('S18: kaldirildigi dogrulanamadi — kopya yayinda sayilir; yeniden olusturma yolu yalniz "sildiyseniz" kosuluyla soylenir', () => {
    const text = publishSkipText('live_entry_unverified', 'WORDPRESS_XMLRPC', { postId: '123' });
    expect(text).toContain('kayıtlı kimliğiyle (#123) bulunamadı. Yazının kaldırıldığı, adresi kontrol edilerek de doğrulanamadı');
    expect(text).toContain('RanksUp bu kopyayı yayında saymaya devam ediyor; hiçbir şey yazılmadı ve kopya açılmadı');
    expect(text).toContain('Yazıyı WordPress üzerinden sildiyseniz yazının sayfasında WordPress hedefini seçerek yeniden yayınlayabilirsiniz');
    expect(text).not.toMatch(/yayınlandı\b/);
  });
});

describe('secilmeyen canli kopya (live_target_not_selected, sozlesme D1)', () => {
  it('metin kopyanin durumuna gore dogru: eski metin + yerinde guncellenebilir / yalniz elle / guncel metin', () => {
    const stale = publishSkipText('live_target_not_selected', 'WORDPRESS_REST', { stale: true, inPlace: true });
    expect(stale).toBe("Bu yazı WordPress üzerinde de yayında, ancak bu yayında WordPress seçilmediği için oraya yazılmadı ve oradaki kopyaya dokunulmadı. Oradaki kopya eski metni gösteriyor ve elle güncelleme bekliyor diye işaretlendi. Güncel metni oraya da yazmak için yazının sayfasında WordPress hedefini de seçerek yeniden yayınlayabilirsiniz.");
    // Yalniz yeni kayit acan hedefte "secip yeniden yayinlayin" yanlis bir vaat olurdu
    const ghost = publishSkipText('live_target_not_selected', 'GHOST', { stale: true, inPlace: false });
    expect(ghost).toContain('RanksUp bu kopyayı yerinde güncelleyemiyor; güncel metni Ghost panelinden elle uygulayın.');
    expect(ghost).not.toContain('seçerek yeniden yayınlayabilirsiniz');
    // Kopya zaten guncel metni tasiyorsa "eski metin" denmez
    const same = publishSkipText('live_target_not_selected', 'FTP', { stale: false, inPlace: true });
    expect(same).toContain("RanksUp'ın oraya son yazdığı metin güncel metinle aynı; yapılacak bir şey yok.");
    expect(same).not.toContain('eski metni');
    // Izsiz eski kayit: "ayni" de "eski" de denmez, bilinmedigi soylenir
    const unknownFtp = publishSkipText('live_target_not_selected', 'FTP', { stale: false, inPlace: true, verified: false });
    expect(unknownFtp).toContain('metin izi taşımadığı için oradaki kopyanın güncel metni gösterip göstermediği bilinmiyor');
    expect(unknownFtp).toContain('FTP hedefini de seçerek yeniden yayınlayabilirsiniz');
    expect(unknownFtp).not.toContain('yapılacak bir şey yok');
    const unknownGhost = publishSkipText('live_target_not_selected', 'GHOST', { stale: false, inPlace: false, verified: false });
    expect(unknownGhost).toContain('Ghost panelinden elle kontrol edip uygulayın');
    expect(unknownGhost).not.toContain('seçerek yeniden yayınlayabilirsiniz');
    for (const text of [stale, ghost, same, unknownFtp, unknownGhost]) expect(text).not.toMatch(/yayınlandı\b/);
  });

  it('liveCopyStale: refreshManualUpdateFlags ile ayni karar (izli: iz farki; izsiz: yeniden yazildi ya da zaten isaretli)', () => {
    const current = { contentHash: 'yeni', legacyContentChanged: false };
    const wp = { targetId: 'wp', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/' };
    expect(liveCopyStale({ ...wp, contentHash: 'eski' }, current)).toBe(true);
    expect(liveCopyStale({ ...wp, contentHash: 'yeni' }, current)).toBe(false);
    // Izli kayitta ayni metin: onceki isaret kalkar (refresh), "eski metin" denmez
    expect(liveCopyStale({ ...wp, contentHash: 'yeni', manualUpdatePending: true }, current)).toBe(false);
    expect(liveCopyStale(wp, current)).toBe(false);
    expect(liveCopyStale(wp, { ...current, legacyContentChanged: true })).toBe(true);
    expect(liveCopyStale({ ...wp, manualUpdatePending: true }, current)).toBe(true);
    // Ayni girdilerle refreshManualUpdateFlags'in karari
    for (const entry of [{ ...wp, contentHash: 'eski' }, { ...wp, contentHash: 'yeni', manualUpdatePending: true, manualUpdatePendingSince: 'x' }, wp, { ...wp, manualUpdatePending: true, manualUpdatePendingSince: 'x' }]) {
      const r = refreshManualUpdateFlags({
        publishedTo: [entry], targets: [{ id: 'wp', type: 'WORDPRESS_REST', isActive: true }], articleSlug: 'yazi',
        ...current, unwritableTargetIds: new Set(['wp']), now: '2026-10-18T00:00:00.000Z',
      });
      expect(r.pendingTargetIds.includes('wp'), JSON.stringify(entry)).toBe(liveCopyStale(entry, current));
    }
  });
});

describe('otomatik yazim engeli (agentOutputs.liveWriteBlocked — S4)', () => {
  const blocked = { at: '2026-10-10T00:00:00.000Z', reasons: [{ targetId: 't-wp', targetType: 'WORDPRESS_REST', skipped: 'live_entry_edited' }] };
  const entry = (updatedAt: string) => [{ targetId: 't-wp', ok: true, externalId: '41', updatedAt }];

  it('kayit eklenir / kaldirilir; diger ajan ciktilari aynen kalir, girdi degismez', () => {
    const outputs = { writer: { output: 'metin' }, rejectedRewrite: { at: '2026-09-01T00:00:00.000Z' } };
    const withBlock = agentOutputsWithLiveWriteBlocked(outputs, blocked);
    expect(withBlock).toEqual({ ...outputs, liveWriteBlocked: blocked });
    expect(outputs).not.toHaveProperty('liveWriteBlocked');
    expect(agentOutputsWithoutLiveWriteBlocked(withBlock)).toEqual(outputs);
    expect(withBlock).toHaveProperty('liveWriteBlocked');
    // Kayit yoksa yazilacak bir sey yok
    expect(agentOutputsWithoutLiveWriteBlocked(outputs)).toBeNull();
    expect(agentOutputsWithoutLiveWriteBlocked(null)).toBeNull();
    expect(agentOutputsWithLiveWriteBlocked(null, blocked)).toEqual({ liveWriteBlocked: blocked });
  });

  it('gecerli engel: o andan sonra canli kopyaya yazilmadiysa; sonraki yazim (yayin ya da "Elle güncelledim") onu gecersiz kilar', () => {
    expect(activeLiveWriteBlock({ liveWriteBlocked: blocked }, entry('2026-08-01T00:00:00.000Z'))).toEqual({ at: new Date(blocked.at), reasons: blocked.reasons });
    expect(activeLiveWriteBlock({ liveWriteBlocked: blocked }, entry('2026-10-12T00:00:00.000Z'))).toBeNull();
    expect(activeLiveWriteBlock({ liveWriteBlocked: blocked }, [])).toMatchObject({ at: new Date(blocked.at) });
    for (const bad of [null, {}, { liveWriteBlocked: null }, { liveWriteBlocked: { at: 'dun' } }, { liveWriteBlocked: 'x' }]) {
      expect(activeLiveWriteBlock(bad, entry('2026-08-01T00:00:00.000Z')), JSON.stringify(bad)).toBeNull();
    }
    // Bozuk nedenler atilir, tarih yine gecerli
    expect(activeLiveWriteBlock({ liveWriteBlocked: { at: blocked.at, reasons: [null, 'x', { targetId: 't', targetType: 'GHOST', skipped: 'already_live_create_only' }] } }, null))
      .toEqual({ at: new Date(blocked.at), reasons: [{ targetId: 't', targetType: 'GHOST', skipped: 'already_live_create_only' }] });
  });
});
