import { describe, it, expect } from 'vitest';
import {
  LIVENESS_CONFIRM_MS, LIVENESS_MISSING_REASON, applyEntryObservations, applyLivenessObservations, entryMissing, liveEntries,
  livenessEntryKey, statusAfterRetirement, type LivenessObservation,
} from './republish-policy.js';

/**
 * Canlilik denetiminin publishedTo kurallari (published-liveness.service.ts).
 *
 * NEDEN VAR: musterinin sitesinden kaldirdigi yazi RanksUp'ta "yayında" kaliyor, site
 * haritasi ve llms-full olu adresi ilan ediyordu (uretim 18.10.2026: isgetkinlikleri.com,
 * 5 yazi, adresler 404). Kopya YALNIZ dogrulanmis 404/410'da dusurulmeli: en az 20 saat
 * arayla iki basarisiz denetim, arada canli goren denetim sayaci sifirlar; belirsiz yanit
 * (403/429/5xx/zaman asimi) hicbir sey degistirmez.
 */

const T0 = '2026-10-19T02:20:00.000Z';
const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();
const H = 3_600_000;

const ADDR = 'https://isgetkinlikleri.com/yazi/';
const wp = (over: Record<string, unknown> = {}) => ({
  targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '42', externalUrl: 'https://isgetkinlikleri.com/yazi/',
  publishedAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', contentHash: 'h1', ...over,
});
const obs = (outcome: LivenessObservation['outcome'], checkedAt: string, over: Partial<LivenessObservation> = {}): LivenessObservation => ({
  targetId: 'wp', address: 'https://isgetkinlikleri.com/yazi/', outcome, checkedAt, needsSighting: false, ...over,
});

describe('applyLivenessObservations — iki denetimle dogrulanmis 404', () => {
  it('ilk 404: goneSince yazilir, kopya canli kalir; ikinci 404 (>= 20 saat) emekliye ayirir', () => {
    const first = applyLivenessObservations([wp()], [obs('gone', T0)]);
    expect(first.changed).toBe(true);
    expect(first.marked).toHaveLength(1);
    expect(first.retired).toEqual([]);
    expect(first.publishedTo).toEqual([wp({ goneSince: T0, goneUrl: ADDR })]);
    expect(liveEntries(first.publishedTo)).toHaveLength(1);

    const second = applyLivenessObservations(first.publishedTo, [obs('gone', at(24 * H))]);
    expect(second.retired).toHaveLength(1);
    const e = second.publishedTo[0] as Record<string, unknown>;
    // D3 kaydi: missingAt (onaylayan denetimin ani) + neden; bekleyen isaret kalkar; kimlik/adres korunur
    expect(e).toEqual({ ...wp(), missingAt: at(24 * H), missingReason: LIVENESS_MISSING_REASON });
    expect(entryMissing(e)).toBe(true);
    expect(liveEntries(second.publishedTo)).toEqual([]);
  });

  it('ikinci 404 20 saatten erkense hicbir sey degismez (tur iki kez kossa da kopya dusmez)', () => {
    const marked = [wp({ goneSince: T0, goneUrl: ADDR })];
    const r = applyLivenessObservations(marked, [obs('gone', at(LIVENESS_CONFIRM_MS - 1))]);
    expect(r.changed).toBe(false);
    expect(r.publishedTo[0]).toBe(marked[0]);
    expect(applyLivenessObservations(marked, [obs('gone', at(LIVENESS_CONFIRM_MS))]).retired).toHaveLength(1);
  });

  it('arada canli goren denetim sayaci sifirlar; belirsiz yanit (unknown) sifirlamaz, emekliye de ayirmaz', () => {
    const cleared = applyLivenessObservations([wp({ goneSince: T0, goneUrl: ADDR })], [obs('live', at(12 * H))]);
    expect(cleared.cleared).toBe(1);
    expect(cleared.publishedTo).toEqual([wp()]);
    // Sifirlandiktan sonraki ilk 404 yeniden ilk sayilir
    expect(applyLivenessObservations(cleared.publishedTo, [obs('gone', at(30 * H))]).marked).toHaveLength(1);

    const marked = [wp({ goneSince: T0, goneUrl: ADDR })];
    const unknown = applyLivenessObservations(marked, [obs('unknown', at(48 * H))]);
    expect(unknown.changed).toBe(false);
    expect(unknown.publishedTo[0]).toBe(marked[0]);
  });

  it('elle guncelleme isareti emekliye ayirmada kalkar (silinmis kopyaya yapistirilacak bir sey yok)', () => {
    const r = applyLivenessObservations([wp({ goneSince: T0, goneUrl: ADDR, manualUpdatePending: true, manualUpdatePendingSince: T0 })], [obs('gone', at(25 * H))]);
    expect(r.retired).toHaveLength(1);
    expect(r.publishedTo[0]).not.toHaveProperty('manualUpdatePending');
    expect(r.publishedTo[0]).not.toHaveProperty('manualUpdatePendingSince');
  });

  it('adresi kanit sayilmayan kopya (needsSighting): canli gorulmeden 404 hicbir sey yazmaz; goruldukten sonra normal kural', () => {
    const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/blog/yazi.html' };
    const o = (outcome: LivenessObservation['outcome'], t: string) => obs(outcome, t, { targetId: 'ftp', address: ftp.externalUrl, needsSighting: true });
    expect(applyLivenessObservations([ftp], [o('gone', T0)]).changed).toBe(false);
    const seen = applyLivenessObservations([ftp], [o('live', T0)]);
    expect(seen.seen).toBe(1);
    // Gorulme goruldugu adresle (gozlemde url yok: kayitli adres)
    expect(seen.publishedTo).toEqual([{ ...ftp, liveSeenAt: T0, liveSeenUrl: ftp.externalUrl }]);
    // Ikinci canli gorulme ilk ani degistirmez (gereksiz yazim yok)
    expect(applyLivenessObservations(seen.publishedTo, [o('live', at(24 * H))]).changed).toBe(false);
    const m = applyLivenessObservations(seen.publishedTo, [o('gone', at(24 * H))]);
    expect(m.marked).toHaveLength(1);
    expect(applyLivenessObservations(m.publishedTo, [o('gone', at(48 * H))]).retired).toHaveLength(1);
  });

  it('denetimden SONRA kopyaya yazildiysa (yeniden yayin, "guncelledim") 404 islenmez', () => {
    const rewritten = [wp({ updatedAt: at(1000) })];
    expect(applyLivenessObservations(rewritten, [obs('gone', T0)]).changed).toBe(false);
    expect(applyLivenessObservations([wp({ goneSince: at(-30 * H), updatedAt: at(1000) })], [obs('gone', T0)]).changed).toBe(false);
  });

  it('ilk 404ten sonra kopyaya yazildiysa sayim yeniden baslar (eski 404 bugunku sayfayi kanitlamaz)', () => {
    // 30 saat once ilk 404; 6 saat once musteri "Elle güncelledim" dedi (updatedAt ilerledi)
    const r = applyLivenessObservations([wp({ goneSince: at(-30 * H), goneUrl: ADDR, updatedAt: at(-6 * H) })], [obs('gone', T0)]);
    expect(r.retired).toEqual([]);
    expect(r.marked).toHaveLength(1);
    expect(r.publishedTo[0]).toMatchObject({ goneSince: T0 });
    expect(applyLivenessObservations(r.publishedTo, [obs('gone', at(24 * H))]).retired).toHaveLength(1);
  });

  it('gozlem yalniz ayni hedef + ayni kayitli adresli canli kayda islenir; emekli / ok:false kayda dokunulmaz', () => {
    const other = wp({ externalUrl: 'https://isgetkinlikleri.com/baska/' });
    const trashed = wp({ trashedAt: T0 });
    const failed = { ...wp(), ok: false };
    const input = [other, trashed, failed, null];
    const r = applyLivenessObservations(input, [obs('gone', T0)]);
    expect(r.changed).toBe(false);
    expect(r.publishedTo).toEqual(input);
    expect(livenessEntryKey(wp() as any)).toBe('wp\nhttps://isgetkinlikleri.com/yazi/');
    // Eski kayit: adres `url` alaninda
    expect(livenessEntryKey({ targetId: 'wp', url: 'https://x/y' } as any)).toBe('wp\nhttps://x/y');
  });

  it('girdi degismez', () => {
    const input = [wp({ goneSince: T0, goneUrl: ADDR })];
    const snapshot = JSON.stringify(input);
    applyLivenessObservations(input, [obs('gone', at(30 * H))]);
    applyLivenessObservations(input, [obs('live', at(30 * H))]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('statusAfterRetirement — yayincinin cop kutusu / silinmis kopya kurali', () => {
  const zip = { targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/x.zip' };
  const gone = wp({ missingAt: T0 });
  it('sitede canli kopyasi kalmayan PUBLISHED yazi READY_TO_PUBLISH olur; yalniz Markdown ZIP kalmasi sayilmaz', () => {
    expect(statusAfterRetirement('PUBLISHED', [gone])).toBe('READY_TO_PUBLISH');
    expect(statusAfterRetirement('PUBLISHED', [gone, zip])).toBe('READY_TO_PUBLISH');
    // Hedef satirindaki tip kaydin tipinden once gelir
    expect(statusAfterRetirement('PUBLISHED', [gone, { ...zip, targetType: undefined }], (id) => (id === 'zip' ? 'MARKDOWN_ZIP' : undefined))).toBe('READY_TO_PUBLISH');
  });
  it('baska sitede canli kopya kaliyorsa PUBLISHED kalir; diger durumlar (onay bekleyen yeniden yazim) degismez', () => {
    const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/x.html' };
    expect(statusAfterRetirement('PUBLISHED', [gone, ftp])).toBe('PUBLISHED');
    expect(statusAfterRetirement('READY_TO_PUBLISH', [gone])).toBe('READY_TO_PUBLISH');
    expect(statusAfterRetirement('REVIZE_NEEDED', [gone])).toBe('REVIZE_NEEDED');
  });
});

describe('applyEntryObservations — canlilik isaretleri yayinci gozlemleriyle tutarli', () => {
  const now = '2026-10-20T00:00:00.000Z';
  it('kopya geri gelince (present) missingAt ile nedeni ve bekleyen goneSince birlikte kalkar', () => {
    // Emekli kayitta kalmis bekleyen isaret (savunma: geri gelen kopyada kalsaydi tek bir 404 onu
    // iki denetim beklemeden dusururdu)
    const retired = wp({ missingAt: T0, missingReason: LIVENESS_MISSING_REASON, liveSeenAt: T0, goneSince: T0 });
    // liveSeenAt adresle ilgili gecmis bilgidir, kalir
    expect(applyEntryObservations([retired], { present: new Set(['wp']), now })).toEqual([wp({ liveSeenAt: T0 })]);
  });
  it('cop kutusunda gorulen kopya: canlilik nedeni ve bekleyen isaret kalkar', () => {
    expect(applyEntryObservations([wp({ goneSince: T0 })], { trashed: new Set(['wp']), now })).toEqual([wp({ trashedAt: now })]);
    expect(applyEntryObservations([wp({ missingAt: T0, missingReason: LIVENESS_MISSING_REASON })], { trashed: new Set(['wp']), now }))
      .toEqual([wp({ trashedAt: now })]);
  });
  it('yayincinin yeni silinmis gozlemi bekleyen isareti siler; canlilik emekliligi zaten varsa kayit aynen kalir', () => {
    expect(applyEntryObservations([wp({ goneSince: T0 })], { missing: new Set(['wp']), now })).toEqual([wp({ missingAt: now })]);
    const retired = wp({ missingAt: T0, missingReason: LIVENESS_MISSING_REASON });
    const out = applyEntryObservations([retired], { missing: new Set(['wp']), now });
    expect(out[0]).toBe(retired);
  });
  it('isaretsiz kayitlarda davranis degismez (eski cagiranlar)', () => {
    const live = wp();
    expect(applyEntryObservations([live], { present: new Set(['wp']), now })[0]).toBe(live);
  });
  // canli-oncesi-21 madde 1: kimlikle gorulmek (live_entry_edited) yazinin herkese acik oldugunu
  // kanitlamaz; WordPress'te taslaga alinan yazinin emekli kopyasi canli sayiliyordu (emeklilik dongusu)
  it('yalniz kimligiyle gorulen emekli kopya (presentStatus): yalniz WordPress "publish" diyorsa geri gelir, durum kayda gecer', () => {
    const retired = wp({ remoteStatus: 'publish', missingAt: T0, missingReason: LIVENESS_MISSING_REASON, liveSeenAt: T0 });
    const present = new Set(['wp']);
    for (const status of ['draft', 'private', 'pending', 'future']) {
      expect(applyEntryObservations([retired], { present, presentStatus: new Map([['wp', status]]), now })[0]).toBe(retired);
    }
    // Durum bilinmiyor: canlilik emekliligi (adres iki kez 404) kalir
    expect(applyEntryObservations([retired], { present, presentStatus: new Map([['wp', null]]), now })[0]).toBe(retired);
    // Herkese acik: geri gelir; WordPress'in bugunku durumu (buyuk harf / bosluk normallesir) kayda yazilir
    const draftRecorded = wp({ remoteStatus: 'draft', missingAt: T0, missingReason: LIVENESS_MISSING_REASON, liveSeenAt: T0 });
    expect(applyEntryObservations([draftRecorded], { present, presentStatus: new Map([['wp', ' Publish ']]), now }))
      .toEqual([wp({ remoteStatus: 'publish', liveSeenAt: T0 })]);
  });
  it('yayincinin emekliye ayirdigi kopya (neden yok): durum bilinmiyorsa eskisi gibi geri gelir, bilinen herkese acik olmayan durumda gelmez', () => {
    const trashed = wp({ trashedAt: T0 });
    const present = new Set(['wp']);
    expect(applyEntryObservations([trashed], { present, presentStatus: new Map([['wp', null]]), now })).toEqual([wp()]);
    expect(applyEntryObservations([trashed], { present, presentStatus: new Map([['wp', 'draft']]), now })[0]).toBe(trashed);
  });
  it('adresi canli goren gozlem (live_entry_unresolvable: presentStatus\'ta yok) canlilik emekliligini de kaldirir', () => {
    const retired = wp({ remoteStatus: 'publish', missingAt: T0, missingReason: LIVENESS_MISSING_REASON });
    expect(applyEntryObservations([retired], { present: new Set(['wp']), presentStatus: new Map(), now })).toEqual([wp({ remoteStatus: 'publish' })]);
  });
});

describe('applyLivenessObservations — kanit yoklanan adrese bagli (rv18 F1)', () => {
  // Dosya hedefi: yoklanan adres kayitli dosya yolundan kurulur; kanit o adrese baglanir
  const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/blog/yazi.html' };
  const ESKI = 'https://isgetkinlikleri.com/blog/yazi.html';
  const YENI = 'https://isgetkinlikleri.com/makaleler/yazi.html';
  const o = (outcome: LivenessObservation['outcome'], t: string, url: string) =>
    obs(outcome, t, { targetId: 'ftp', address: ftp.externalUrl, needsSighting: true, url });

  it('canli gorulme goruldugu adresle yazilir; baska bir adresin 404u kanit sayilmaz, hicbir sey degismez', () => {
    const seen = applyLivenessObservations([ftp], [o('live', T0, ESKI)]);
    expect(seen.publishedTo).toEqual([{ ...ftp, liveSeenAt: T0, liveSeenUrl: ESKI }]);
    // Ayni adresin ikinci canli gorulmesi yazim gerektirmez
    expect(applyLivenessObservations(seen.publishedTo, [o('live', at(24 * H), ESKI)]).changed).toBe(false);
    // Yeni adres hic canli gorulmedi: 404'u ne ilk basarisizlik ne emeklilik
    const r = applyLivenessObservations(seen.publishedTo, [o('gone', at(24 * H), YENI)]);
    expect(r.changed).toBe(false);
    expect(r.publishedTo[0]).toBe(seen.publishedTo[0]);
    // Ayni adresin 404'u normal kural
    expect(applyLivenessObservations(seen.publishedTo, [o('gone', at(24 * H), ESKI)]).marked).toHaveLength(1);
  });

  it('yeni adres canli gorulunce gorulme o adrese tasinir; ondan sonra yeni adresin iki 404u gerekir', () => {
    const seenOld = [{ ...ftp, liveSeenAt: T0, liveSeenUrl: ESKI }];
    const moved = applyLivenessObservations(seenOld, [o('live', at(24 * H), YENI)]);
    expect(moved.seen).toBe(1);
    expect(moved.publishedTo).toEqual([{ ...ftp, liveSeenAt: at(24 * H), liveSeenUrl: YENI }]);
    const m = applyLivenessObservations(moved.publishedTo, [o('gone', at(48 * H), YENI)]);
    expect(m.publishedTo[0]).toMatchObject({ goneSince: at(48 * H), goneUrl: YENI });
    expect(applyLivenessObservations(m.publishedTo, [o('gone', at(72 * H), YENI)]).retired).toHaveLength(1);
  });

  it('adresi kayitli olmayan eski canli gorulme (liveSeenAt, liveSeenUrl yok) kanit degildir; canli gorulunce adresle yeniden yazilir', () => {
    const legacy = [{ ...ftp, liveSeenAt: T0 }];
    expect(applyLivenessObservations(legacy, [o('gone', at(24 * H), ESKI)]).changed).toBe(false);
    const again = applyLivenessObservations(legacy, [o('live', at(24 * H), ESKI)]);
    expect(again.seen).toBe(1);
    expect(again.publishedTo).toEqual([{ ...ftp, liveSeenAt: at(24 * H), liveSeenUrl: ESKI }]);
  });

  it('ilk basarisizlik baska adres icinse ya da adressizse (eski kayit) 20 saat gecse de emekliye ayirmaz: sayim bu adresle yeniden baslar', () => {
    const baskaAdres = applyLivenessObservations([wp({ goneSince: T0, goneUrl: 'https://isgetkinlikleri.com/eski/' })], [obs('gone', at(30 * H))]);
    expect(baskaAdres.retired).toEqual([]);
    expect(baskaAdres.marked).toHaveLength(1);
    expect(baskaAdres.publishedTo).toEqual([wp({ goneSince: at(30 * H), goneUrl: ADDR })]);
    const adressiz = applyLivenessObservations([wp({ goneSince: T0 })], [obs('gone', at(30 * H))]);
    expect(adressiz.retired).toEqual([]);
    expect(adressiz.publishedTo).toEqual([wp({ goneSince: at(30 * H), goneUrl: ADDR })]);
    // Yeniden baslayan sayim ayni adresin ikinci 404'uyle (>= 20 saat) onaylanir
    expect(applyLivenessObservations(adressiz.publishedTo, [obs('gone', at(54 * H))]).retired).toHaveLength(1);
  });

  it('gozlemde url verilirse kanit kayitli adrese degil yoklanan adrese baglanir (WordPress: sitenin kendi host bicimi)', () => {
    const yoklanan = 'https://isgetkinlikleri.com/yazi/?ref=x';
    const first = applyLivenessObservations([wp()], [obs('gone', T0, { url: yoklanan })]);
    expect(first.publishedTo).toEqual([wp({ goneSince: T0, goneUrl: yoklanan })]);
    // Ayni kayit, baska bir yoklanan adres: ilk basarisizlik sayilmaz
    expect(applyLivenessObservations(first.publishedTo, [obs('gone', at(24 * H))]).retired).toEqual([]);
    expect(applyLivenessObservations(first.publishedTo, [obs('gone', at(24 * H), { url: yoklanan })]).retired).toHaveLength(1);
  });
});

describe('applyEntryObservations — bekleyen ilk basarisizlik adresiyle birlikte kalkar', () => {
  const now = '2026-10-20T00:00:00.000Z';
  it('cop kutusu / silinmis / geri gelen kopyada goneSince ile goneUrl birlikte silinir; gorulme gecmisi (liveSeenAt / liveSeenUrl) kalir', () => {
    const pending = wp({ goneSince: T0, goneUrl: ADDR, liveSeenAt: T0, liveSeenUrl: ADDR });
    expect(applyEntryObservations([pending], { trashed: new Set(['wp']), now })).toEqual([wp({ trashedAt: now, liveSeenAt: T0, liveSeenUrl: ADDR })]);
    expect(applyEntryObservations([pending], { missing: new Set(['wp']), now })).toEqual([wp({ missingAt: now, liveSeenAt: T0, liveSeenUrl: ADDR })]);
    const retired = wp({ missingAt: T0, missingReason: LIVENESS_MISSING_REASON, goneUrl: ADDR, liveSeenAt: T0, liveSeenUrl: ADDR });
    expect(applyEntryObservations([retired], { present: new Set(['wp']), now })).toEqual([wp({ liveSeenAt: T0, liveSeenUrl: ADDR })]);
    // Yalniz goneUrl kalmis emekli kayit da yeniden yazilir (isaret temizlenir)
    const stale = wp({ missingAt: T0, goneUrl: ADDR });
    expect(applyEntryObservations([stale], { missing: new Set(['wp']), now })).toEqual([wp({ missingAt: T0 })]);
  });
});
