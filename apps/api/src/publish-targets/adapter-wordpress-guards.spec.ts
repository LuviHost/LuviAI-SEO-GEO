import { describe, it, expect } from 'vitest';
import {
  expectedWordPressSlugs, normalizeWordPressSlug, wordPressDateLabel, wordPressEditedSince, wordPressEditedText, wordPressGmtToIso,
  wordPressIdentityProblem, wordPressSlugMatches, WP_CLOCK_SKEW_TOLERANCE_MS,
} from '@luviai/adapters';

/**
 * Yerinde guncellemeden once kimlik ve cakisma denetiminin saf kurallari
 * (packages/adapters/src/wordpress-post-ref.ts) — REST ve XML-RPC ayni kurali
 * kullanir. Bicimler WordPress kaynagindaki gibi:
 *  - REST modified_gmt: mysql_to_rfc3339 → "Y-m-d\TH:i:s" (saat dilimi YOK, GMT)
 *  - XML-RPC post_modified_gmt: IXR_Date getIso → "Ymd\TH:i:s"
 *  - slug: sanitize_title → remove_accents (Turkce harfler ASCII), "-2" eki
 *    (wp_unique_post_slug), cop kutusu "__trashed" eki.
 */

describe('wordPressGmtToIso', () => {
  it('REST ve XML-RPC damgalari GMT kabul edilir (yerel saat SANILMAZ); sifir tarih ve bozuk deger null', () => {
    expect(wordPressGmtToIso('2026-09-14T10:00:00')).toBe('2026-09-14T10:00:00.000Z');
    expect(wordPressGmtToIso('20260914T10:00:00')).toBe('2026-09-14T10:00:00.000Z');
    expect(wordPressGmtToIso('2026-09-14T10:00:00.000Z')).toBe('2026-09-14T10:00:00.000Z');
    expect(wordPressGmtToIso('2026-09-14T13:00:00+03:00')).toBe('2026-09-14T10:00:00.000Z');
    expect(wordPressGmtToIso('00000000T00:00:00Z')).toBeNull();
    expect(wordPressGmtToIso('0000-00-00T00:00:00')).toBeNull();
    for (const bad of [null, undefined, '', 'dun', 42, '2026-13-45T99:99:99']) expect(wordPressGmtToIso(bad), String(bad)).toBeNull();
  });
});

describe('slug eslesmesi', () => {
  it('normalize: URL kodu cozulur, Turkce harfler ve aksanlar ASCII, kucuk harf', () => {
    expect(normalizeWordPressSlug('KDV-Beyanı-Şubat-Ğ-İç-Ölçü-Ü')).toBe('kdv-beyani-subat-g-ic-olcu-u');
    expect(normalizeWordPressSlug('%c3%a7ay')).toBe('cay');
    expect(normalizeWordPressSlug('crème-brûlée')).toBe('creme-brulee');
    expect(normalizeWordPressSlug(null)).toBe('');
  });

  it('ayni yazi: birebir, "-N" (1-999) eki, "__trashed" eki; baska yazi: farkli slug, yil tasiyan slug, bos slug', () => {
    expect(wordPressSlugMatches('yazi', ['yazi'])).toBe(true);
    expect(wordPressSlugMatches('yazi-2', ['yazi'])).toBe(true);
    expect(wordPressSlugMatches('yazi-999', ['yazi'])).toBe(true);
    expect(wordPressSlugMatches('yazi__trashed', ['yazi'])).toBe(true);
    expect(wordPressSlugMatches('yazi-2__trashed', ['yazi'])).toBe(true);
    expect(wordPressSlugMatches('kdv-beyani', ['kdv-beyanı'])).toBe(true);
    expect(wordPressSlugMatches('yazi', ['baska', 'yazi'])).toBe(true);
    expect(wordPressSlugMatches('yazi-2026', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('yazi-0', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('yazi-rehberi', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('hakkimizda', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('__trashed', ['yazi'])).toBe(false);
    expect(wordPressSlugMatches('yazi', [])).toBe(false);
    expect(wordPressSlugMatches('yazi', ['', null])).toBe(false);
  });

  it('beklenenler: kayitli kalici baglantinin slug\'i (sayisal ve ?p= degil) + yazinin slug\'i, tekrarsiz', () => {
    expect(expectedWordPressSlugs({ externalUrl: 'https://s.example/2026/05/kdv/' }, 'kdv-yeni')).toEqual(['kdv', 'kdv-yeni']);
    expect(expectedWordPressSlugs({ externalUrl: 'https://s.example/kdv/' }, 'kdv')).toEqual(['kdv']);
    expect(expectedWordPressSlugs({ externalUrl: 'https://s.example/?p=41' }, 'kdv')).toEqual(['kdv']);
    expect(expectedWordPressSlugs({ externalUrl: 'https://s.example/arsiv/41' }, 'kdv')).toEqual(['kdv']);
    expect(expectedWordPressSlugs(null, '  ')).toEqual([]);
  });

  it('kimlik sorunu: tur post degilse ya da slug tutmuyorsa Turkce neden; ayni yaziysa null', () => {
    const ref = { externalUrl: 'https://s.example/kdv/' };
    expect(wordPressIdentityProblem({ id: 41, type: 'post', slug: 'kdv-2', ref, articleSlug: 'kdv' })).toBeNull();
    // Tur alani gelmeyen eski sunucu: yalniz slug'a bakilir
    expect(wordPressIdentityProblem({ id: 41, slug: 'kdv', ref, articleSlug: 'kdv' })).toBeNull();
    const page = wordPressIdentityProblem({ id: 41, type: 'page', slug: 'kdv', ref, articleSlug: 'kdv' });
    expect(page?.error).toBe("WordPress'teki #41 numaralı kayıt bir yazı değil (tür: page, adres: kdv); bu yazının kaydı olamaz. Başka bir içeriğin üzerine yazmamak için güncellenmedi, kopya da açılmadı.");
    const other = wordPressIdentityProblem({ id: 41, type: 'post', slug: 'hakkimizda', ref, articleSlug: 'kdv' });
    expect(other).toEqual({
      remoteSlug: 'hakkimizda',
      error: "WordPress'teki #41 numaralı yazı bu yazıyla eşleşmiyor (o yazının adresi: hakkimizda, beklenen: kdv). Başka bir yazının üzerine yazmamak için güncellenmedi, kopya da açılmadı.",
    });
    expect(wordPressIdentityProblem({ id: 41, type: 'post', slug: 'kdv', ref: null, articleSlug: '' })?.error).toContain('doğrulanamadı');
    // Hedeften gelen slug temizlenir (HTML / uzunluk)
    const odd = wordPressIdentityProblem({ id: 41, type: 'post', slug: `<b>x</b>${'a'.repeat(200)}`, ref, articleSlug: 'kdv' });
    expect(odd?.error).not.toContain('<b>');
    expect(odd!.error.length).toBeLessThan(400);
  });
});

describe('wordPressEditedSince — RanksUp\'in son yaziminden sonra degisti mi', () => {
  it('kayitli WordPress damgasi: ayni saniye degismemis; farkli (ileri ya da geri) degismis', () => {
    const ref = { remoteModifiedAt: '2026-09-01T10:00:00.000Z' };
    expect(wordPressEditedSince('2026-09-01T10:00:00.000Z', ref)).toBe(false);
    expect(wordPressEditedSince('2026-09-01T10:00:00.900Z', ref)).toBe(false);
    expect(wordPressEditedSince('2026-09-01T10:00:01.000Z', ref)).toBe(true);
    expect(wordPressEditedSince('2026-08-31T10:00:00.000Z', ref)).toBe(true);
    // Damga varken RanksUp'in saatine bakilmaz (WordPress saati kaymis olabilir)
    expect(wordPressEditedSince('2026-09-01T10:00:00.000Z', { ...ref, lastWriteAt: '2026-08-01T00:00:00.000Z' })).toBe(false);
  });

  it('damgasiz eski kayit: son yazim + saat payi; pay asilirsa degismis', () => {
    const ref = { lastWriteAt: '2026-09-01T10:00:00.000Z' };
    expect(WP_CLOCK_SKEW_TOLERANCE_MS).toBe(120_000);
    expect(wordPressEditedSince('2026-09-01T09:59:00.000Z', ref)).toBe(false);
    expect(wordPressEditedSince('2026-09-01T10:02:00.000Z', ref)).toBe(false);
    expect(wordPressEditedSince('2026-09-01T10:02:01.000Z', ref)).toBe(true);
  });

  it('dayanak yok, damga okunamadi ya da bozuk: degismis sayilir (emin olmadan yazilmaz)', () => {
    expect(wordPressEditedSince('2026-09-01T10:00:00.000Z', {})).toBe(true);
    expect(wordPressEditedSince('2026-09-01T10:00:00.000Z', null)).toBe(true);
    expect(wordPressEditedSince(null, { remoteModifiedAt: '2026-09-01T10:00:00.000Z' })).toBe(true);
    expect(wordPressEditedSince('2026-09-01T10:00:00.000Z', { lastWriteAt: 'dun' })).toBe(true);
  });

  it('kullanici metni: Turkiye saatiyle tarih; tarih yoksa tarihsiz', () => {
    expect(wordPressDateLabel('2026-09-05T08:30:00.000Z')).toBe('05.09.2026 11:30');
    expect(wordPressDateLabel('bozuk')).toBeNull();
    expect(wordPressEditedText('2026-09-05T08:30:00.000Z')).toBe("WordPress yazısı RanksUp'ın son yazımından sonra değiştirilmiş (son değişiklik: 05.09.2026 11:30); değişikliklerin üzerine yazılmadı.");
    expect(wordPressEditedText(null)).toBe("WordPress yazısı RanksUp'ın son yazımından sonra değiştirilmiş; değişikliklerin üzerine yazılmadı.");
  });
});
