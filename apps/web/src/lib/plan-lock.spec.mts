/**
 * Plana kilitli takvim yazisi (deneme hesabi toplam 2 makale): kilit sunucudan okunur,
 * panel tahmin etmez; yer tutucu metin tarayicida, tohumlu ve bir sey iddia etmez.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_LOCK_COPY, UPGRADE_HREF, isPlanLocked, placeholderParagraphs, scheduledCounts, splitScheduled } from './plan-lock';

describe('isPlanLocked — karar sunucunun lockedByPlan alanindan', () => {
  it('yalniz takvimdeki (SCHEDULED) ve sunucunun kilitli dedigi yazi kilitli', () => {
    expect(isPlanLocked({ status: 'SCHEDULED', lockedByPlan: true })).toBe(true);
    expect(isPlanLocked({ status: 'SCHEDULED', lockedByPlan: false })).toBe(false);
    // Eski API alani gondermez: tahmin edilmez, kilitli sayilmaz
    expect(isPlanLocked({ status: 'SCHEDULED' })).toBe(false);
    // Bicim disi deger kilit sayilmaz
    expect(isPlanLocked({ status: 'SCHEDULED', lockedByPlan: 'true' })).toBe(false);
    for (const status of ['GENERATING', 'EDITING', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED']) {
      expect(isPlanLocked({ status, lockedByPlan: true }), status).toBe(false);
    }
    expect(isPlanLocked(null)).toBe(false);
  });
});

describe('takvim ozeti — panel sayaclari ve "siradaki yazi"', () => {
  const rows = [
    { id: 'g', status: 'GENERATING' },
    { id: 'c', status: 'SCHEDULED', lockedByPlan: true, scheduledAt: '2026-11-05T10:00:00.000Z' },
    { id: 'a', status: 'SCHEDULED', lockedByPlan: false, scheduledAt: '2026-11-09T10:00:00.000Z' },
    { id: 'b', status: 'SCHEDULED', lockedByPlan: true, scheduledAt: '2026-11-02T10:00:00.000Z' },
    { id: 'p', status: 'PUBLISHED' },
  ];

  it('takvimdeki ve kilitli sayisi', () => {
    expect(scheduledCounts(rows)).toEqual({ scheduled: 3, locked: 2 });
    expect(scheduledCounts([])).toEqual({ scheduled: 0, locked: 0 });
    expect(scheduledCounts(undefined)).toEqual({ scheduled: 0, locked: 0 });
  });

  it('siradaki yazi kilitli olamaz: acik ve kilitli ayri, ikisi de vade sirasiyla', () => {
    const { open, locked } = splitScheduled(rows);
    expect(open.map((r) => r.id)).toEqual(['a']);
    expect(locked.map((r) => r.id)).toEqual(['b', 'c']);
  });
});

describe('yer tutucu metin — model yok, kayit yok, iddia yok', () => {
  it('ayni tohum ayni metni verir (yenilemede titremez); farkli yazi farkli metin', () => {
    const a1 = placeholderParagraphs('art-1');
    expect(placeholderParagraphs('art-1')).toEqual(a1);
    expect(placeholderParagraphs('art-2')).not.toEqual(a1);
    expect(a1).toHaveLength(4);
    for (const p of a1) expect(p.length).toBeGreaterThan(40);
  });

  it('paragraf ve cumle sayisi sinirli; bos tohum da calisir', () => {
    expect(placeholderParagraphs('x', { paragraphs: 99 })).toHaveLength(8);
    expect(placeholderParagraphs('x', { paragraphs: 0 })).toHaveLength(1);
    expect(placeholderParagraphs('')).toHaveLength(4);
  });

  it('kaynak dosya hicbir ag / model cagrisi icermez (yalniz tarayicida uretilir)', () => {
    const src = readFileSync(new URL('./plan-lock.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|from ['"]@\/lib\/api['"]|anthropic|openai|localStorage/i);
  });
});

describe('kilitli kart metinleri — durust', () => {
  const all = Object.values(PLAN_LOCK_COPY).join('\n');

  it('yukseltme baglantisi fiyatlandirma sayfasi', () => {
    expect(UPGRADE_HREF).toBe('/pricing');
    expect(PLAN_LOCK_COPY.cta).toBe('Planını yükselt');
  });

  it('yazinin YUKSELTINCE yazilacagini soyler, yazildigini iddia etmez', () => {
    expect(PLAN_LOCK_COPY.title).toBe('Bu makale planını yükselttiğinde yazılır');
    expect(PLAN_LOCK_COPY.body).toContain('makale henüz yazılmadı');
    expect(PLAN_LOCK_COPY.body).toContain('toplam 2 makale');
    expect(PLAN_LOCK_COPY.placeholderNote).toContain('yer tutucudur');
    expect(all).not.toMatch(/makalen hazır|yazıldı\b|hazırlandı|kilidini aç ve oku/i);
  });
});
