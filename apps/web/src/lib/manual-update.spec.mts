/**
 * "Eski surum yayinda, elle guncelle" akisi: bekleyen kayit yalniz acik isaretle,
 * kopyalanan metin GUNCEL govde (bodyMd), unut onayi kopya riskini soyler.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideRepublish, liveCopyNeedsManualUpdate, liveEntryRef } from '../../../api/src/articles/republish-policy';
import { wordPressEntryAddressable as adaptorAdreslenebilir } from '../../../../packages/adapters/src/wordpress-post-ref';
import {
  LIVENESS_MISSING_REASON, MANUAL_UPDATE_NOTE, OVERWRITE_TARGET_TYPES, SELF_HEALING_TARGET_TYPES, UPDATE_TARGET_TYPES, canForgetEntry,
  currentArticleMarkdown, fileEntrySlugChanged, forgetEntryConfirm, isManualUpdatePending, manualUpdateBadge, manualUpdateNote,
  manualUpdateReason, missingByLivenessCheck, missingCopyNote, pendingManualUpdateCount, wordPressEntryAddressable, type ManualUpdateReason,
} from './manual-update';
import { LIVENESS_MISSING_REASON as API_LIVENESS_MISSING_REASON, applyLivenessObservations } from '../../../api/src/articles/republish-policy';
import { publishedEntryView } from './publish-result';

/** API'deki tip kumesi (kaynak metinden) */
function apiTypes(name: string): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../../api/src/articles/republish-policy.ts', import.meta.url)), 'utf8');
  const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`));
  expect(m, `${name} bulunamadi`).toBeTruthy();
  return [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

/** API'deki yerinde guncelleme / uzerine yazma / disa aktarma tip kumeleri (kaynak metinden) */
function apiSelfHealingTypes(): string[] {
  return ['UPDATE_TARGET_TYPES', 'OVERWRITE_TARGET_TYPES', 'EXPORT_TARGET_TYPES'].flatMap(apiTypes);
}

const bekleyen = { targetId: 't1', targetType: 'GHOST', ok: true, externalUrl: 'https://blog.ornek.com/yazi/', manualUpdatePending: true, manualUpdatePendingSince: '2026-10-18T08:00:00.000Z' };
const guncel = { targetId: 't2', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com/yazi/' };

describe('isManualUpdatePending / pendingManualUpdateCount', () => {
  it('yalniz acik true sayilir; eski kayit, bicim disi deger ve bozuk liste sayilmaz', () => {
    expect(isManualUpdatePending(bekleyen)).toBe(true);
    expect(isManualUpdatePending(guncel)).toBe(false);
    expect(isManualUpdatePending({ ...guncel, manualUpdatePending: 'true' })).toBe(false);
    expect(isManualUpdatePending(null)).toBe(false);
    expect(pendingManualUpdateCount([bekleyen, guncel, null, 'x'])).toBe(1);
    expect(pendingManualUpdateCount(null)).toBe(0);
    expect(pendingManualUpdateCount({ targetId: 't1' })).toBe(0);
  });

  it('cop kutusundaki (C3) ya da hedefte artik bulunmayan (D3) kopya "elle guncelleme bekliyor" sayilmaz', () => {
    expect(pendingManualUpdateCount([{ ...bekleyen, trashedAt: '2026-10-18T09:00:00.000Z' }])).toBe(0);
    expect(pendingManualUpdateCount([{ ...bekleyen, missingAt: '2026-10-18T09:00:00.000Z' }, bekleyen])).toBe(1);
    expect(manualUpdateBadge([{ ...bekleyen, missingAt: '2026-10-18T09:00:00.000Z' }])).toBeNull();
  });
});

describe('manualUpdateBadge', () => {
  it('bekleyen kayit varsa rozet ve nerede yapilacagini soyleyen aciklama', () => {
    expect(manualUpdateBadge([guncel])).toBeNull();
    const b = manualUpdateBadge([bekleyen, guncel]);
    expect(b?.label).toBe('Elle güncelleme bekliyor');
    expect(b?.title).toContain('bir yayın hedefinde yayında');
    expect(b?.title).toContain('Yayın Geçmişi');
    expect(manualUpdateBadge([bekleyen, { ...bekleyen, targetId: 't3' }])?.title).toContain('2 yayın hedefinde');
  });

  it('R25: tablo nedeni bilmez — "yerinde guncelleyemiyor" iddiasi yok (pasif WordPress icin yanlisti)', () => {
    expect(manualUpdateBadge([{ ...guncel, manualUpdatePending: true }])?.title).not.toContain('yerinde güncelleyemiyor');
  });
});

describe('manualUpdateReason / manualUpdateNote — R25 notu gercek nedene gore', () => {
  const wpKayit = { targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://site.example/yazi/', manualUpdatePending: true };
  const bilinen = { targetsKnown: true, articleSlug: 'yazi' };

  it('pasif WordPress hedefi: "pasif" der, "yerinde guncelleyemiyor" demez, etkinlestirip yeniden yayin onerir', () => {
    const r = manualUpdateReason(wpKayit, { type: 'WORDPRESS_REST', isActive: false }, bilinen);
    expect(r).toBe('target_inactive');
    const not = manualUpdateNote(r, 'WORDPRESS_REST');
    expect(not).toContain('pasif');
    expect(not).toContain('etkinleştirip');
    expect(not).not.toContain('yerinde güncelleyemiyor');
  });

  it('silinmis hedef: yeniden ekleyip yayinlamayi onermez (yeni hedefe yayin kopya acar); hedef listesi okunamadiysa "silinmis" denmez', () => {
    const r = manualUpdateReason(wpKayit, undefined, bilinen);
    expect(r).toBe('target_missing');
    const not = manualUpdateNote(r, 'WORDPRESS_REST');
    expect(not).toContain('silinmiş');
    expect(not).not.toMatch(/ekle|etkinleştir/i);
    expect(manualUpdateReason(wpKayit, undefined, { targetsKnown: false })).toBe('unknown');
  });

  it('yalniz yeni kayit acan hedef: urun notu (hedef listesi okunamasa da kaydin tipinden)', () => {
    const ghost = { targetId: 'g', targetType: 'GHOST', ok: true, manualUpdatePending: true };
    expect(manualUpdateReason(ghost, { type: 'GHOST', isActive: true }, bilinen)).toBe('create_only');
    expect(manualUpdateReason(ghost, undefined, { targetsKnown: false })).toBe('create_only');
    expect(manualUpdateNote('create_only')).toBe(MANUAL_UPDATE_NOTE);
  });

  it('aktif WordPress, kayit adreslenebilir: yeniden yayin onerilir; WordPress duzenlemesi onaysiz ezilmez denir', () => {
    const r = manualUpdateReason(wpKayit, { type: 'WORDPRESS_REST', isActive: true }, bilinen);
    expect(r).toBe('republishable');
    const not = manualUpdateNote(r, 'WORDPRESS_REST');
    expect(not).toContain('yeniden yayınlayın');
    expect(not).toContain('onayınız olmadan ezmez');
    expect(not).not.toContain('yerinde güncelleyemiyor');
  });

  it('D1: isaretin bir nedeni de son yayinda hedefin secilmemesi — not bunu da sayar (WordPress ve dosya hedefi)', () => {
    expect(manualUpdateNote('republishable', 'WORDPRESS_REST')).toContain('son yayında bu hedef seçilmedi');
    const dosya = manualUpdateNote('republishable', 'FTP');
    expect(dosya).toContain('son yayında bu hedef seçilmedi');
    expect(dosya).toContain('bu hedefe yeniden yayınlayın');
  });

  it('pasif + adreslenemeyen WordPress kaydi "unaddressable" (etkinlestirmek cozmez); slug degisen dosya "slug_changed"', () => {
    const adressiz = { targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, manualUpdatePending: true };
    expect(manualUpdateReason(adressiz, { type: 'WORDPRESS_REST', isActive: false }, bilinen)).toBe('unaddressable');
    const ftp = { targetId: 'f', targetType: 'FTP', ok: true, externalUrl: 'ftp://93.184.216.34/rehber/eski-yazi.html', manualUpdatePending: true };
    expect(manualUpdateReason(ftp, { type: 'FTP', isActive: false }, bilinen)).toBe('slug_changed');
    expect(manualUpdateReason(ftp, { type: 'FTP', isActive: true }, { targetsKnown: true, articleSlug: 'eski-yazi' })).toBe('republishable');
  });

  it('Markdown ZIP ve tipi bilinmeyen kayitta iddia yok', () => {
    expect(manualUpdateReason({ targetId: 'z', targetType: 'MARKDOWN_ZIP' }, { type: 'MARKDOWN_ZIP', isActive: false }, bilinen)).toBe('unknown');
    expect(manualUpdateReason({ targetId: 'x' }, { type: null, isActive: true }, bilinen)).toBe('unknown');
  });

  it('her nedenin notu "eski surum yayinda" ile baslar; yalniz create_only "yerinde guncelleyemiyor" der', () => {
    const nedenler: ManualUpdateReason[] = ['create_only', 'target_missing', 'target_inactive', 'unaddressable', 'slug_changed', 'republishable', 'unknown'];
    for (const r of nedenler) {
      const not = manualUpdateNote(r, 'WORDPRESS_REST');
      expect(not, r).toMatch(/^Bu hedefte eski sürüm yayında/);
      expect(not.includes('yerinde güncelleyemiyor'), r).toBe(r === 'create_only');
    }
  });
});

describe('panel kurali API kuraliyla ayni (republish-policy.ts liveCopyNeedsManualUpdate)', () => {
  // Panel "RanksUp yazabilir" (republishable) diyorsa API o kopyayi isaretlemez ve yazar;
  // elle yapilacak bir neden gosteriyorsa API de "yazamam" der. Kayarsa test kirilir.
  const kayitlar = [
    { targetId: 't', ok: true, externalId: '41', externalUrl: 'https://site.example/yazi/' },
    { targetId: 't', ok: true, externalUrl: 'https://site.example/?p=12' },
    { targetId: 't', ok: true, externalUrl: 'https://site.example/' },
    { targetId: 't', ok: true, url: 'https://site.example/eski-yazi/' },
    { targetId: 't', ok: true },
    { targetId: 't', ok: true, externalUrl: 'ftp://93.184.216.34/rehber/yazi.html' },
    { targetId: 't', ok: true, externalUrl: 'ftp://93.184.216.34/rehber/baska.html' },
    { targetId: 't', ok: true, externalUrl: 'rehber/YAZI.md' },
  ];
  const tipler = ['WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'KOBIPRATIK', 'GHOST', 'WEBFLOW', 'CUSTOM_PHP'];
  const elle = new Set<ManualUpdateReason>(['create_only', 'target_missing', 'target_inactive', 'unaddressable', 'slug_changed']);

  it('her kayit / tip / hedef durumu icin ayni karar', () => {
    let n = 0;
    for (const k of kayitlar) {
      for (const type of tipler) {
        for (const target of [{ id: 't', type, isActive: true }, { id: 't', type, isActive: false }, undefined]) {
          const entry = { ...k, targetType: type };
          const panel = manualUpdateReason(entry, target, { targetsKnown: true, articleSlug: 'yazi' });
          const api = liveCopyNeedsManualUpdate(entry, target, 'yazi');
          expect(elle.has(panel), `${type} ${JSON.stringify(k)} aktif=${target?.isActive}`).toBe(api);
          expect(panel === 'republishable', `${type} ${JSON.stringify(k)}`).toBe(!api);
          n++;
        }
      }
    }
    expect(n).toBe(kayitlar.length * tipler.length * 3);
  });

  it('WordPress adreslenebilirligi adaptorun kuraliyla ayni (kayit → liveEntryRef → wordPressEntryAddressable)', () => {
    const ornekler: Record<string, unknown>[] = [
      { externalId: '41' }, { externalId: 41 }, { externalId: ' 41 ' }, { externalId: '0' }, { externalId: '-3' }, { externalId: 'abc' },
      { externalId: '1234567890123456' }, { externalUrl: 'https://site.example/yazi/' }, { externalUrl: 'https://site.example/?p=12' },
      { externalUrl: 'https://site.example/' }, { externalUrl: 'https://site.example/index.php' }, { url: 'https://site.example/eski-yazi/' },
      { externalUrl: 'adres degil' }, { externalUrl: '', url: 'https://site.example/a/b/' }, {}, { externalUrl: 'https://site.example/%E0%A4%A/' },
      { externalId: null, externalUrl: 'https://site.example/?p=abc' },
    ];
    for (const o of ornekler) {
      const entry = { targetId: 't', ...o };
      expect(wordPressEntryAddressable(entry), JSON.stringify(o)).toBe(adaptorAdreslenebilir(liveEntryRef(entry)));
    }
  });

  it('dosya hedefinde slug degisimi API decideRepublish ile ayni', () => {
    const adresler = [
      'ftp://93.184.216.34/rehber/yazi.html', 'ftp://93.184.216.34/rehber/yeni.html', 'rehber/yazi.html', 'https://site.example/rehber/Yazi',
      'https://github.com/o/r/blob/main/rehber/yazi.md', 'https://site.example/onek/%C3%A7ay', 'https://site.example/', undefined,
    ];
    for (const externalUrl of adresler) {
      for (const slug of ['yazi', 'çay', '', null]) {
        const entry = { targetId: 't', ok: true, ...(externalUrl ? { externalUrl } : {}) };
        const api = decideRepublish({ entry, targetType: 'FTP', articleSlug: slug }).kind === 'blocked';
        expect(fileEntrySlugChanged(entry, slug), `${externalUrl} / ${slug}`).toBe(api);
      }
    }
  });

  it('yerinde guncelleme ve uzerine yazma tip kumeleri API ile ayni', () => {
    expect([...UPDATE_TARGET_TYPES].sort()).toEqual(apiTypes('UPDATE_TARGET_TYPES').sort());
    expect([...OVERWRITE_TARGET_TYPES].sort()).toEqual(apiTypes('OVERWRITE_TARGET_TYPES').sort());
  });
});

describe('publishedEntryView — elle guncelleme alanlari', () => {
  it('bekleyen kayit ve basladigi an gorunume tasinir; eski kayitta false/null', () => {
    const v = publishedEntryView(bekleyen, () => 'Şirket blogu');
    expect(v).toMatchObject({ targetId: 't1', name: 'Şirket blogu', manualUpdatePending: true, manualUpdatePendingSince: '2026-10-18T08:00:00.000Z' });
    expect(publishedEntryView(guncel, () => undefined)).toMatchObject({ targetId: 't2', manualUpdatePending: false, manualUpdatePendingSince: null });
  });
});

describe('canForgetEntry', () => {
  const ghost = { type: 'GHOST' };
  const wp = { type: 'WORDPRESS_REST' };

  it('bekleyen kayit her hedefte unutulabilir', () => {
    expect(canForgetEntry(bekleyen, wp)).toBe(true);
  });

  it('isaretsiz kayit: yalniz yeni kayit acan hedefte (silinen yaziyi RanksUp goremez)', () => {
    const kayit = { targetId: 't1', targetType: 'GHOST', ok: true };
    expect(canForgetEntry(kayit, ghost)).toBe(true);
    // Hedef satiri yoksa kaydin tipi: Ghost evet, WordPress hayir ("bulunamadi = silinmis" denmez)
    expect(canForgetEntry(kayit, undefined)).toBe(true);
    expect(canForgetEntry(guncel, undefined)).toBe(false);
    expect(canForgetEntry({ targetId: 'eski' }, undefined)).toBe(false);
  });

  it('WordPress, dosya hedefleri ve Markdown ZIP isaretsizken unut sunulmaz (kendiliginden duzelir, yalniz kopya riski)', () => {
    expect(canForgetEntry(guncel, wp)).toBe(false);
    for (const type of ['FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'KOBIPRATIK', 'MARKDOWN_ZIP', 'WORDPRESS_XMLRPC']) {
      expect(canForgetEntry({ targetId: 'x', targetType: type, ok: true }, { type }), type).toBe(false);
    }
    expect(canForgetEntry(null, wp)).toBe(false);
  });

  it('tip listesi API republish-policy.ts ile ayni (kayarsa test kirilir)', () => {
    expect([...SELF_HEALING_TARGET_TYPES].sort()).toEqual(apiSelfHealingTypes().sort());
  });
});

describe('forgetEntryConfirm', () => {
  it('sonraki yayinin yeni yazi acacagini ve yalniz silindiyse kullanilacagini soyler', () => {
    const c = forgetEntryConfirm('Ghost');
    expect(c.title).toBe('Bu hedefteki kayıt unutulsun mu?');
    expect(c.description).toContain('bu hedefe bir sonraki yayın yeni bir yazı açar');
    expect(c.description).toContain('iki kez yayında olur');
    expect(c.description).toContain('yalnız eski yazıyı Ghost panelinden sildiysen kullan');
    expect(c.confirmLabel).toBe('Kaydı unut');
  });
});

describe('currentArticleMarkdown', () => {
  it('frontmatter ve kapak yer tutucusu cikar, govde kalir', () => {
    const md = '---\ntitle: "Yeni başlık"\n---\n\n![Hero](placeholder-hero.webp)\n\n## Giriş\n\nGüncel metin. ![k](placeholder-hero.webp)\n';
    expect(currentArticleMarkdown(md)).toBe('## Giriş\n\nGüncel metin.');
  });

  it('metin yoksa bos', () => {
    expect(currentArticleMarkdown(undefined)).toBe('');
    expect(currentArticleMarkdown(null)).toBe('');
  });
});

describe('missingCopyNote — hedefte artik bulunmayan kopya (D3)', () => {
  const when = '20.10.2026 05:20:00';
  const wpKopya = { targetId: 't2', targetType: 'WORDPRESS_REST', ok: true, externalId: '7', externalUrl: 'https://ornek.com/yazi/' };

  it('neden degeri API ile ayni; API\'nin canlilik denetimiyle emekliye ayirdigi kayit panelde oyle taninir', () => {
    expect(LIVENESS_MISSING_REASON).toBe(API_LIVENESS_MISSING_REASON);
    // API kuraliyla uretilmis gercek kayit: iki 404, 20+ saat arayla
    const ilk = applyLivenessObservations([wpKopya], [{ targetId: 't2', address: wpKopya.externalUrl, outcome: 'gone', checkedAt: '2026-10-19T02:20:00.000Z', needsSighting: false }]);
    const ikinci = applyLivenessObservations(ilk.publishedTo, [{ targetId: 't2', address: wpKopya.externalUrl, outcome: 'gone', checkedAt: '2026-10-20T02:20:00.000Z', needsSighting: false }]);
    expect(missingByLivenessCheck(ilk.publishedTo[0])).toBe(false);
    expect(missingByLivenessCheck(ikinci.publishedTo[0])).toBe(true);
  });

  it('canlilik denetimi: iki kontrolde 404 ve WordPress\'te taslak / cop kutusu ihtimali soylenir', () => {
    const kayit = { ...wpKopya, missingAt: '2026-10-20T02:20:00.000Z', missingReason: LIVENESS_MISSING_REASON };
    expect(missingCopyNote(kayit, { when, targetType: 'WORDPRESS_REST' })).toBe(
      'Bu kopyanın adresi yaklaşık bir gün arayla yapılan iki kontrolde de 404 verdi (sitenin ana sayfası açılırken); sayfa sitenden kaldırılmış görünüyor. '
      + `RanksUp bu kopyayı ${when} tarihinden beri yayında saymıyor ve kendiliğinden yeniden oluşturmaz. Yazıyı orada yeniden yayınlamak istersen bu hedefi seçip yayınla. `
      + 'Yazıyı WordPress’te taslağa aldıysan ya da çöp kutusuna taşıdıysan önce orada yayına al ya da geri yükle: RanksUp WordPress’teki yazıyı yerinde günceller, durumunu değiştirmez.',
    );
    // Dosya hedefi: WordPress cumlesi yok
    const ftp = missingCopyNote({ targetId: 'f', targetType: 'FTP', missingAt: '2026-10-20T02:20:00.000Z', missingReason: LIVENESS_MISSING_REASON }, { when, targetType: 'FTP' });
    expect(ftp).toContain('iki kontrolde de 404 verdi');
    expect(ftp).not.toContain('WordPress');
  });

  it('yayincinin gozlemi (neden yok) ya da cop kutusu: eski genel metin', () => {
    const genel = `Bu kopya ${when} tarihinde yayın hedefinde bulunamadı (silinmiş olabilir); RanksUp onu yayında saymıyor ve kendiliğinden yeniden oluşturmaz. Yazıyı orada yeniden yayınlamak istersen bu hedefi seçip yayınla.`;
    expect(missingCopyNote({ ...wpKopya, missingAt: '2026-10-20T02:20:00.000Z' }, { when, targetType: 'WORDPRESS_REST' })).toBe(genel);
    expect(missingByLivenessCheck({ ...wpKopya, missingAt: '2026-10-20T02:20:00.000Z', missingReason: LIVENESS_MISSING_REASON, trashedAt: '2026-10-21T00:00:00.000Z' })).toBe(false);
    expect(missingByLivenessCheck({ ...wpKopya, missingReason: LIVENESS_MISSING_REASON })).toBe(false);
    expect(missingByLivenessCheck(null)).toBe(false);
  });
});

describe('MANUAL_UPDATE_NOTE', () => {
  it('urun metniyle birebir (yalniz yeni kayit acan hedefin notu)', () => {
    expect(MANUAL_UPDATE_NOTE).toBe('Bu hedefte eski sürüm yayında; RanksUp bu hedefi yerinde güncelleyemiyor. Güncel metni kopyalayıp hedef panelinize yapıştırın.');
  });
});
