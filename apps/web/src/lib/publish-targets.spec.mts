/**
 * Panelin yayin hedefi secimi — panelin istegi API'nin GERCEK secim kuraliyla
 * (republish-policy.ts selectPublishTargets) denenir.
 *  - D1 (S5/S11): acik liste AYNEN uygulanir; makale sayfasi canli kopyayi disarida
 *    birakan secimi yayindan once soyler (eski metin kalir, RanksUp isaretler).
 *  - R10/R17: yayindaki yazinin yeniden yayini varsayilan hedefte KOPYA acmaz.
 *  - S25: yalniz Markdown ZIP disa aktarimi olan yazi sitede yayinda sayilmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  articleContentHash as apiIcerikIzi, decideRepublish, liveCopyStale, liveEntries, publishSkipText, publishedEntryFor, selectPublishTargets,
} from '../../../api/src/articles/republish-policy';
import {
  REWRITTEN_SINCE_LIVE_STATUSES, articleContentHash, initialPublishSelection, isLivePublishedEntry, leftOutLiveConfirm,
  leftOutLiveCopies, liveCopyStaleness, livePublishedEntries, liveSiteEntries, publishSelectionWarnings, tablePublishDescription,
  tablePublishPlan, targetDisplayName, targetTypeLabel, type PublishTargetLike,
} from './publish-targets';

// Yazi L'de (WordPress) yayinda; musteri sonradan D'yi (baska bir WordPress baglantisi
// ya da FTP) varsayilan yapti — inceleme senaryosu
const L: PublishTargetLike = { id: 'L', name: 'Blog', type: 'WORDPRESS_REST', isActive: true, isDefault: false };
const D: PublishTargetLike = { id: 'D', name: 'Yeni blog', type: 'WORDPRESS_REST', isActive: true, isDefault: true };
const F: PublishTargetLike = { id: 'F', name: 'Sunucu', type: 'FTP', isActive: true, isDefault: false };
const Z: PublishTargetLike = { id: 'Z', name: 'Dışa aktarım', type: 'MARKDOWN_ZIP', isActive: true, isDefault: false };
const canli = [{ targetId: 'L', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://site.example/yazi/' }];

/** Yazinin guncel metni ve L'ye en son giden (eski) metnin izi */
const YAZI = { title: 'Başlık', metaTitle: 'Meta başlık', metaDescription: 'Açıklama', bodyMd: '## Giriş\n\nYeni metin.' };
const GUNCEL_IZ = apiIcerikIzi(YAZI);
const ESKI_IZ = apiIcerikIzi({ ...YAZI, bodyMd: '## Giriş\n\nEski metin.' });
const canliEski = [{ ...canli[0], contentHash: ESKI_IZ }];
const canliGuncel = [{ ...canli[0], contentHash: GUNCEL_IZ }];

/** API'nin bu istekle sececegi hedefler */
const apiSecimi = (targets: PublishTargetLike[], targetIds: string[], publishedTo: unknown) =>
  selectPublishTargets(targets.map((t) => ({ ...t, id: t.id })), targetIds, publishedTo).targets.map((t) => t.id);
/** API'nin bu istekte yazmayip 'live_target_not_selected' ile raporlayacagi canli kopyalar */
const apiSecilmeyen = (targets: PublishTargetLike[], targetIds: string[], publishedTo: unknown) => {
  const sel = selectPublishTargets(targets.map((t) => ({ ...t, id: t.id })), targetIds, publishedTo) as { notSelectedLive?: Array<{ targetId: string }> };
  expect(sel.notSelectedLive, 'selectPublishTargets notSelectedLive donmeli (sozlesme D1)').toBeDefined();
  return sel.notSelectedLive!.map((e) => e.targetId).sort();
};

describe('D1 — acik hedef listesi aynen uygulanir; secilmeyen canli kopya yayindan once soylenir (S5/S11)', () => {
  it('makale sayfasi yazinin yayinda oldugu AKTIF hedefleri onsecer (varsayilan degil); API ayni hedefi secer', () => {
    const sel = initialPublishSelection(canli, [L, D]);
    expect(sel).toEqual(['L']);
    expect(apiSecimi([L, D], sel, canli)).toEqual(['L']);
  });

  it('canli hedef kaldirilip baska hedef secilirse API kaldirilan hedefe YAZMAZ; panel eski metnin kalacagini ve isaretlenecegini soyler, onay ister', () => {
    // Inceleme S11: onay bekleyen yeniden yazim once test sitesinde (D) gorulmek isteniyor
    expect(apiSecimi([L, D], ['D'], canliEski)).toEqual(['D']);
    expect(apiSecilmeyen([L, D], ['D'], canliEski)).toEqual(['L']);
    const opts = { contentHash: GUNCEL_IZ, articleStatus: 'READY_TO_PUBLISH' };
    expect(leftOutLiveCopies(['D'], canliEski, [L, D], opts)).toEqual([{ targetId: 'L', name: 'Blog', stale: 'yes' }]);
    const w = publishSelectionWarnings(['D'], canliEski, [L, D], { targetsKnown: true, ...opts }).join(' ');
    expect(w).toContain('Yazı Blog hedefinde yayında ama bu hedef seçili değil: bu yayın oraya yazmaz.');
    expect(w).toContain('Oradaki kopya eski metinle kalır');
    expect(w).toContain('“Eski sürüm yayında” diye işaretler');
    const c = leftOutLiveConfirm(leftOutLiveCopies(['D'], canliEski, [L, D], opts));
    expect(c?.title).toBe('Yayındaki bir kopya güncellenmeyecek');
    expect(c?.description).toContain('Yazı Blog hedefinde yayında ama bu hedef seçili değil.');
    expect(c?.confirmLabel).toBe('Yalnız seçili hedeflere yayınla');
  });

  it('S5: yalniz Markdown ZIP secilen yayinda canli WordPress yazilmaz (11. tur ekliyordu); uyari yayindan once', () => {
    const z = { ...Z, id: 't-zip' };
    const wp = { ...L, id: 't-wp', isDefault: true };
    const kayit = [{ ...canliEski[0], targetId: 't-wp' }];
    expect(apiSecimi([wp, z], ['t-zip'], kayit)).toEqual(['t-zip']);
    expect(apiSecilmeyen([wp, z], ['t-zip'], kayit)).toEqual(['t-wp']);
    const w = publishSelectionWarnings(['t-zip'], kayit, [wp, z], { targetsKnown: true, contentHash: GUNCEL_IZ });
    expect(w.join(' ')).toContain('Blog hedefinde yayında ama bu hedef seçili değil');
  });

  it('ayni metni gosteren kopya icin "eski metin kalir" denmez ve onay istenmez; izsiz eski kayitta yalniz "guncellenmez"', () => {
    const guncel = { targetsKnown: true, contentHash: GUNCEL_IZ, articleStatus: 'PUBLISHED' };
    expect(publishSelectionWarnings(['D'], canliGuncel, [L, D], guncel).join(' ')).not.toContain('seçili değil');
    expect(leftOutLiveConfirm(leftOutLiveCopies(['D'], canliGuncel, [L, D], guncel))).toBeNull();
    // Izsiz eski kayit, yazi yayinda (PUBLISHED): metnin eski olup olmadigi bilinmiyor — iddia yok
    const izsiz = publishSelectionWarnings(['D'], canli, [L, D], guncel).join(' ');
    expect(izsiz).toContain('Blog hedefinde yayında ama bu hedef seçili değil: bu yayın oraya yazmaz, oradaki kopya güncellenmez.');
    expect(izsiz).not.toContain('eski metinle');
    expect(leftOutLiveConfirm(leftOutLiveCopies(['D'], canli, [L, D], guncel))).toBeNull();
    // Izsiz kayit ama yazi yeniden yazilmis (READY_TO_PUBLISH): API eski sayar — panel de
    expect(leftOutLiveCopies(['D'], canli, [L, D], { contentHash: GUNCEL_IZ, articleStatus: 'READY_TO_PUBLISH' })[0].stale).toBe('yes');
    // Guncel iz henuz hesaplanmadi: iddia yok
    expect(leftOutLiveCopies(['D'], canliEski, [L, D], { contentHash: null })[0].stale).toBe('unknown');
  });

  it('panelin "secilmedi" dedigi kopyalar API\'nin raporlayacagi kopyalarla ayni (pasif / disa aktarim / silinmis hedef dahil)', () => {
    const pasifF = { ...F, isActive: false };
    const hedefler = [L, D, pasifF, Z];
    const kayitlar = [
      { targetId: 'L', targetType: 'WORDPRESS_REST', ok: true, externalId: '41' },
      { targetId: 'F', targetType: 'FTP', ok: true, externalUrl: 'ftp://93.184.216.34/yazi.html' },
      { targetId: 'Z', targetType: 'MARKDOWN_ZIP', ok: true },
      { targetId: 'X', targetType: 'WORDPRESS_REST', ok: true, externalId: '7' },
      { targetId: 'D', targetType: 'WORDPRESS_REST', ok: true, externalId: '9', trashedAt: '2026-10-18T09:00:00.000Z' },
    ];
    for (const secim of [['D'], ['Z'], ['L'], ['F'], ['D', 'Z'], ['L', 'D', 'Z']]) {
      const panel = leftOutLiveCopies(secim, kayitlar, hedefler).map((c) => c.targetId).sort();
      expect(panel, secim.join(',')).toEqual(apiSecilmeyen(hedefler, secim, kayitlar));
    }
  });

  it('kopyanin metni eski mi: API liveCopyStale ile ayni karar (izli / izsiz kayit, isaret, yazi durumu)', () => {
    const kayitlar: Record<string, unknown>[] = [
      { targetId: 'L', contentHash: ESKI_IZ }, { targetId: 'L', contentHash: GUNCEL_IZ }, { targetId: 'L' },
      { targetId: 'L', manualUpdatePending: true }, { targetId: 'L', contentHash: GUNCEL_IZ, manualUpdatePending: true },
      { targetId: 'L', contentHash: '' },
    ];
    for (const k of kayitlar) {
      for (const status of ['PUBLISHED', 'READY_TO_PUBLISH', 'REVIZE_NEEDED', 'DRAFT', undefined]) {
        const api = liveCopyStale(k as never, { contentHash: GUNCEL_IZ, legacyContentChanged: REWRITTEN_SINCE_LIVE_STATUSES.has(String(status ?? '')) });
        expect(liveCopyStaleness(k, { contentHash: GUNCEL_IZ, articleStatus: status }) === 'yes', `${JSON.stringify(k)} ${status}`).toBe(api);
      }
    }
  });

  it('yazinin icerik izi API articleContentHash ile ayni (Turkce, emoji, eksik ve metin olmayan alanlar)', async () => {
    const ornekler: Record<string, unknown>[] = [
      YAZI, {}, { title: 'Şirket ığdır çay 🚀', bodyMd: '"tırnak" \\ ters bölü\n satır' }, { title: null, metaTitle: 5, bodyMd: undefined },
      { title: 'a', metaTitle: 'b', metaDescription: 'c', bodyMd: 'd'.repeat(5000) },
    ];
    for (const o of ornekler) expect(await articleContentHash(o), JSON.stringify(o).slice(0, 60)).toBe(apiIcerikIzi(o));
  });

  it('metni degismis sayilan durumlar API publisher.service.ts REWRITTEN_SINCE_LIVE_STATUSES ile ayni', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../api/src/articles/publisher.service.ts', import.meta.url)), 'utf8');
    const m = src.match(/REWRITTEN_SINCE_LIVE_STATUSES[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m, 'REWRITTEN_SINCE_LIVE_STATUSES bulunamadi').toBeTruthy();
    expect([...REWRITTEN_SINCE_LIVE_STATUSES].sort()).toEqual([...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort());
  });
});

describe('R10/R17 + S25 — icerik tablosu "Yayinla"', () => {
  it('sitede yayindaki yazida bos liste gonderir; API canli hedefi (L) secer, varsayilani (D) degil', () => {
    const plan = tablePublishPlan(canli, [L, D]);
    expect(plan).toMatchObject({ kind: 'publish', targetIds: [], live: true, targetNames: ['Blog'] });
    if (plan.kind !== 'publish') throw new Error('plan');
    expect(apiSecimi([L, D], plan.targetIds, canli)).toEqual(['L']);
    // [def.id] gonderilseydi D'de ikinci bir kopya acilirdi, L yazilmazdi (D1) — panel bunu gondermemeli
    expect(apiSecimi([L, D], ['D'], canli)).toEqual(['D']);
  });

  it('S25: yalniz Markdown ZIP disa aktarimi olan yazi sitede yayinda sayilmaz; tablo varsayilan WordPress hedefini ACIKCA gonderir', () => {
    const wp = { id: 't-wp', name: 'Blog', type: 'WORDPRESS_REST', isDefault: true, isActive: true };
    const zip = { id: 't-zip', name: 'ZIP', type: 'MARKDOWN_ZIP', isDefault: false, isActive: true };
    const zipOnly = [{ targetId: 't-zip', targetType: 'MARKDOWN_ZIP', ok: true, action: 'exported', externalUrl: '/var/luviai/exports/yazi.zip' }];
    const plan = tablePublishPlan(zipOnly, [wp, zip]);
    expect(plan).toEqual({ kind: 'publish', targetIds: ['t-wp'], live: false, targetNames: ['Blog'] });
    if (plan.kind !== 'publish') throw new Error('plan');
    expect(apiSecimi([wp, zip], plan.targetIds, zipOnly)).toEqual(['t-wp']);
    expect(tablePublishDescription(plan)).toBe('Blog hedefine gönderiliyor; sonucu burada göstereceğiz.');
    // ZIP hedefi de silinmisse yine varsayilan (11. turda hicbir sey yazilmiyordu)
    expect(tablePublishPlan(zipOnly, [wp])).toMatchObject({ targetIds: ['t-wp'], live: false });
    // Makale sayfasi da varsayilani onsecer, WordPress secimi icin "iki kez yayinda" demez
    expect(initialPublishSelection(zipOnly, [wp, zip])).toEqual(['t-wp']);
    expect(publishSelectionWarnings(['t-wp'], zipOnly, [wp, zip], { targetsKnown: true })).toEqual([]);
  });

  it('varsayilan FTP olsa da canli WordPress kopyasi secilir; silinip yeniden eklenen hedefte kopya acilmaz', () => {
    const ftpDefault = { ...F, isDefault: true };
    const plan = tablePublishPlan(canli, [L, ftpDefault]);
    if (plan.kind !== 'publish') throw new Error('plan');
    expect(apiSecimi([L, ftpDefault], plan.targetIds, canli)).toEqual(['L']);
    // L silindi, yerine D eklendi: bos liste API'de hicbir hedefi secmez (live_target_inactive raporlanir)
    const yeniden = tablePublishPlan(canli, [D]);
    if (yeniden.kind !== 'publish') throw new Error('plan');
    expect(yeniden.targetIds).toEqual([]);
    expect(apiSecimi([D], yeniden.targetIds, canli)).toEqual([]);
    expect(tablePublishDescription(yeniden)).toContain('kopya açılmaz');
  });

  it('hic yayinlanmamis yazida etkin varsayilan ACIKCA gonderilir (11. turdan onceki gibi); varsayilan yoksa istek atilmaz', () => {
    const plan = tablePublishPlan([], [L, D]);
    expect(plan).toEqual({ kind: 'publish', targetIds: ['D'], live: false, targetNames: ['Yeni blog'] });
    if (plan.kind !== 'publish') throw new Error('plan');
    expect(apiSecimi([L, D], plan.targetIds, [])).toEqual(['D']);
    expect(tablePublishDescription(plan)).toBe('Yeni blog hedefine gönderiliyor; sonucu burada göstereceğiz.');
    expect(tablePublishPlan([], [L, { ...D, isActive: false }])).toMatchObject({ kind: 'no_target' });
  });

  it('cop kutusundaki ya da hedefte artik bulunmayan kopya sitede yayinda sayilmaz: varsayilan acikca gonderilir', () => {
    for (const emekli of [{ trashedAt: '2026-10-18T09:00:00.000Z' }, { missingAt: '2026-10-18T09:00:00.000Z' }]) {
      const kayit = [{ ...canli[0], ...emekli }];
      expect(tablePublishPlan(kayit, [L, D]), JSON.stringify(emekli)).toMatchObject({ targetIds: ['D'], live: false });
    }
  });
});

describe('makale sayfasi onsecimi', () => {
  it('pasif varsayilan hic onsecilmez (dugmesi devre disi, kullanici kaldiramazdi)', () => {
    expect(initialPublishSelection([], [L, { ...D, isActive: false }])).toEqual([]);
    expect(initialPublishSelection([], [L, D])).toEqual(['D']);
  });

  it('canli hedef pasifse onsecim bos: kullanici bilerek secer, uyari nedenini soyler', () => {
    const pasifL = { ...L, isActive: false };
    expect(initialPublishSelection(canli, [pasifL, D])).toEqual([]);
    const w = publishSelectionWarnings([], canli, [pasifL, D], { targetsKnown: true });
    expect(w.join(' ')).toContain('Blog hedefinde yayında ama hedef pasif');
    // Pasif hedef secilemez: "secili degil" uyarisi verilmez (yalniz pasif ipucu)
    expect(w.join(' ')).not.toContain('seçili değil');
  });

  it('yazi sitede yayindaysa onsecim API\'nin bos listedeki secimiyle ayni (disa aktarim kaydi dahil)', () => {
    const kayit = [...canli, { targetId: 'Z', targetType: 'MARKDOWN_ZIP', ok: true }];
    expect(initialPublishSelection(kayit, [L, D, Z]).sort()).toEqual(apiSecimi([L, D, Z], [], kayit).sort());
  });
});

describe('publishSelectionWarnings', () => {
  it('yeni kopya acacak secim soylenir', () => {
    const w = publishSelectionWarnings(['L', 'D'], canli, [L, D], { targetsKnown: true });
    expect(w).toEqual(['Yazı Yeni blog hedefinde henüz yok; bu yayın orada yeni bir yazı açar. Hedef aynı siteye bağlıysa sitende aynı içerik iki kez yayında olur.']);
  });

  it('Markdown ZIP disa aktarimdir: "yeni yazi acar" denmez', () => {
    expect(publishSelectionWarnings(['L', 'Z'], canli, [L, Z], { targetsKnown: true })).toEqual([]);
  });

  it('pasif hedef: yerinde yazan tipte etkinlestirme onerilir, yalniz yeni kayit acan tipte onerilmez', () => {
    const pasifL = { ...L, isActive: false };
    expect(publishSelectionWarnings([], canli, [pasifL], { targetsKnown: true })[0]).toContain('etkinleştirip yeniden yayınlarsan');
    const ghost = { id: 'G', name: 'Ghost blog', type: 'GHOST', isActive: false };
    const gCanli = [{ targetId: 'G', targetType: 'GHOST', ok: true }];
    const w = publishSelectionWarnings([], gCanli, [ghost], { targetsKnown: true });
    expect(w).toEqual(['Yazı Ghost blog hedefinde yayında ama hedef pasif; RanksUp pasif hedefe yazmaz.']);
  });

  it('dogru secimde ve hic yayinlanmamis yazida uyari yok', () => {
    expect(publishSelectionWarnings(['L'], canli, [L, D], { targetsKnown: true })).toEqual([]);
    expect(publishSelectionWarnings(['D'], [], [L, D], { targetsKnown: true })).toEqual([]);
  });

  it('silinmis hedef yalniz hedef listesi okunabildiyse soylenir; silinmis ZIP hedefi "kopya" sayilmaz', () => {
    expect(publishSelectionWarnings([], canli, [D], { targetsKnown: true }).join(' ')).toContain('silinmiş');
    expect(publishSelectionWarnings([], canli, [], { targetsKnown: false })).toEqual([]);
    const zipVe = [...canli, { targetId: 'Z-silindi', targetType: 'MARKDOWN_ZIP', ok: true }];
    expect(publishSelectionWarnings(['L'], zipVe, [L], { targetsKnown: true })).toEqual([]);
  });

  it('secilen hedefteki kopya cop kutusunda goruldiyse iki ihtimal de soylenir, hedefte yoksa yeniden olusturacagi soylenir', () => {
    const copte = [{ ...canli[0], trashedAt: '2026-10-18T09:00:00.000Z' }];
    expect(publishSelectionWarnings(['L'], copte, [L, D], { targetsKnown: true })).toEqual([
      'Yazı Blog hedefinde çöp kutusunda görülmüştü. Hâlâ oradaysa bu yayın oraya yazmaz (RanksUp kaldırılan yazıyı geri getirmez); yazıyı orada yeniden görmek istiyorsan önce çöp kutusundan geri yükle. '
        + 'Çöp kutusu boşaltıldıysa (WordPress bunu varsayılan olarak 30 gün sonra yapar) ya da yazı kalıcı olarak silindiyse bu yayın yazıyı orada yeniden oluşturur.',
    ]);
    const kayip = [{ ...canli[0], missingAt: '2026-10-18T09:00:00.000Z' }];
    expect(publishSelectionWarnings(['L'], kayip, [L, D], { targetsKnown: true })).toEqual([
      'Yazı Blog hedefinde artık bulunamıyor (silinmiş olabilir); bu yayın yazıyı orada yeniden oluşturur.',
    ]);
    // Baska hedefte yayindaki yazida emekli kopyanin hedefi "henuz yok / yeni yazi acar" denmez
    const karisik = [{ targetId: 'F', targetType: 'FTP', ok: true, externalUrl: 'ftp://93.184.216.34/yazi.html' }, ...copte];
    expect(publishSelectionWarnings(['F', 'L'], karisik, [L, F], { targetsKnown: true }).join(' ')).not.toContain('henüz yok');
  });

  it('S11 yan etkisi: cop kutusu bosaltildiktan sonra yayin yaziyi yeniden olusturur — uyari "oraya yazmaz" diye kesin konusmaz', () => {
    // rv15 s11-trash-warning senaryosu: kayit 40 gun once cop kutusunda goruldu, WordPress
    // cop kutusunu bosaltti (EMPTY_TRASH_DAYS=30); yazi FTP'de yayinda, kullanici WP'yi de secti
    const wp = { ...L, id: 't-wp' };
    const ftp = { ...F, id: 't-ftp' };
    const kayitlar = [
      { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://site.example/?p=41', trashedAt: '2026-09-08T00:00:00.000Z' },
      { targetId: 't-ftp', targetType: 'FTP', ok: true, externalUrl: 'https://site.example/yazi.html', contentHash: ESKI_IZ },
    ];
    // API: secilen hedeflere yazar; cop kutusu kaydi "canli degil" ama yayinci onu YINE yerinde
    // guncelleme yolundan dener (kayit yok sayilsa yeni kopya acilirdi) — sonuc WordPress'e bagli
    expect(apiSecimi([wp, ftp], ['t-ftp', 't-wp'], kayitlar).sort()).toEqual(['t-ftp', 't-wp']);
    expect(decideRepublish({ entry: publishedEntryFor(kayitlar, 't-wp'), targetType: 'WORDPRESS_REST' }).kind).toBe('update');
    // Hala cop kutusundaysa API metni: yazilmadi
    expect(publishSkipText('live_entry_trashed', 'WORDPRESS_REST')).toContain('çöp kutusunda olduğu için yeniden yayınlanmadı');
    const uyari = publishSelectionWarnings(['t-ftp', 't-wp'], kayitlar, [wp, ftp], { targetsKnown: true, contentHash: GUNCEL_IZ }).join(' ');
    // Eski metin kosulsuz "bu yayın oraya yazmaz" diyordu; bosaltilmis cop kutusunda yayin yaziyi yeniden aciyordu
    expect(uyari).not.toMatch(/çöp kutusunda; RanksUp kaldırılan yazıyı geri getirmez, bu yayın oraya yazmaz/);
    expect(uyari).toContain('Hâlâ oradaysa bu yayın oraya yazmaz');
    expect(uyari).toContain('Çöp kutusu boşaltıldıysa');
    expect(uyari).toContain('bu yayın yazıyı orada yeniden oluşturur');
    // Iki hedefte birden: tek uyari, cogul hedef adi
    const iki = publishSelectionWarnings(['t-wp', 'D'], [kayitlar[0], { ...kayitlar[0], targetId: 'D' }], [wp, D], { targetsKnown: true });
    expect(iki).toHaveLength(1);
    expect(iki[0]).toMatch(/^Yazı Blog, Yeni blog hedeflerinde çöp kutusunda görülmüştü\./);
  });
});

describe('isLivePublishedEntry — API liveEntries ile ayni kural (cop kutusu C3, hedefte yok D3)', () => {
  const ornekler: unknown[] = [
    { targetId: 'a', ok: true }, { targetId: 'a' }, { targetId: 'a', ok: false }, { targetId: '' }, { targetId: 5 },
    null, 'x', { ok: true }, { targetId: 'b', ok: true, manualUpdatePending: true },
    { targetId: 'c', ok: true, trashedAt: '2026-10-18T09:00:00.000Z' }, { targetId: 'c', trashedAt: '' },
    { targetId: 'c', trashedAt: '   ' }, { targetId: 'c', trashedAt: null }, { targetId: 'c', trashedAt: 5 },
    { targetId: 'd', ok: true, missingAt: '2026-10-18T09:00:00.000Z' }, { targetId: 'd', missingAt: '' },
    { targetId: 'd', missingAt: null }, { targetId: 'd', missingAt: 7 }, { targetId: 'd', missingAt: '2026-10-18', trashedAt: '' },
  ];

  it('her girdide API ile ayni karar', () => {
    for (const e of ornekler) {
      expect(isLivePublishedEntry(e), JSON.stringify(e)).toBe(liveEntries([e]).length === 1);
    }
  });

  it('cop kutusunda bulunan ya da hedefte artik olmayan kopya canli sayilmaz; onsecilmez', () => {
    for (const emekli of [{ trashedAt: '2026-10-18T09:00:00.000Z' }, { missingAt: '2026-10-18T09:00:00.000Z' }]) {
      const kayit = [{ ...canli[0], ...emekli }];
      expect(isLivePublishedEntry(kayit[0])).toBe(false);
      expect(livePublishedEntries(kayit)).toEqual([]);
      expect(liveSiteEntries(kayit, [L, D])).toEqual([]);
      expect(initialPublishSelection(kayit, [L, D])).toEqual(['D']);
    }
    expect(isLivePublishedEntry({ ...canli[0], trashedAt: '' })).toBe(true);
  });
});

describe('hedef adlari', () => {
  it('sonuc satiri hedef listesindeki adla; yoksa tipin Turkce adiyla (ham tip gosterilmez)', () => {
    expect(targetDisplayName([L, D], 'L')).toBe('Blog');
    expect(targetDisplayName([L], 'X', 'WORDPRESS_XMLRPC')).toBe('WordPress');
    expect(targetDisplayName([], null, 'CUSTOM_PHP')).toBe('özel PHP uç noktası');
    expect(targetTypeLabel(undefined)).toBe('Yayın hedefi');
  });

  it('tip adlari API republish-policy.ts TARGET_LABELS ile ayni (kayarsa test kirilir)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../api/src/articles/republish-policy.ts', import.meta.url)), 'utf8');
    const blok = src.match(/const TARGET_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
    expect(blok, 'TARGET_LABELS bulunamadi').toBeTruthy();
    const ciftler = [...blok![1].matchAll(/([A-Z_]+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]] as const);
    expect(ciftler.length).toBeGreaterThan(10);
    for (const [tip, ad] of ciftler) expect(targetTypeLabel(tip), tip).toBe(ad);
  });
});
