/**
 * Makale hakki bitince uretim dugmeleri kilitli: karar saf, sayilar API'nin
 * articleQuota alanindan; okunamayan / tutarsiz sayi kilit DEGIL (asil kapi sunucuda).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { GENERATION_LOCK_COPY, generationLock } from './article-allowance';
import { PLAN_LOCK_COPY, UPGRADE_HREF } from './plan-lock';

describe('generationLock — hak bitti, dugme kilitli', () => {
  it('deneme hakki bitti (/me/dashboard plan enum): deneme metni, yukseltme baglantisi', () => {
    const l = generationLock({ limit: 2, remaining: 0, used: 2 }, 'TRIAL');
    expect(l).toEqual({
      locked: true,
      reason: 'trial_used',
      label: 'Planını yükselt',
      href: '/pricing',
      hint: 'Ücretsiz denemedeki 2 makale hakkını kullandın. Yeni makale üretmek için planını yükselt.',
    });
    // Ayni kaynak: kilitli takvim yazisinin dugmesiyle ayni etiket ve hedef
    expect(l.label).toBe(PLAN_LOCK_COPY.cta);
    expect(l.href).toBe(UPGRADE_HREF);
  });

  it('deneme: /billing/users/:id/current plan TANIMI ({ id: "trial" }) da deneme sayilir', () => {
    const l = generationLock({ limit: 2, remaining: 0, used: 2 }, { id: 'trial', name: 'Deneme' });
    expect(l.locked).toBe(true);
    expect(l.reason).toBe('trial_used');
  });

  it('denemede "ay basinda yenilenir" denmez (deneme hakki omur boyu)', () => {
    const l = generationLock({ limit: 2, remaining: 0, used: 2 }, 'TRIAL');
    expect(l.hint).not.toMatch(/yenilenir|ayın başında/);
  });

  it('ucretli planin aylik hakki bitti: aylik metin, ay basinda yenilenir + yukselt', () => {
    const l = generationLock({ limit: 15, remaining: 0, used: 15 }, 'STARTER');
    expect(l.locked).toBe(true);
    expect(l.reason).toBe('monthly_used');
    expect(l.hint).toBe(GENERATION_LOCK_COPY.monthly(15));
    expect(l.hint).toContain('Bu ayki 15 makale hakkını kullandın');
    expect(l.hint).toContain('gelecek ayın başında yenilenir');
    expect(l.label).toBe('Planını yükselt');
    expect(l.href).toBe('/pricing');
    // Plan tanimi bicimi de ayni sonucu verir
    expect(generationLock({ limit: 40, remaining: 0, used: 40 }, { id: 'pro' }).reason).toBe('monthly_used');
  });

  it('plan okunamadi ama hak bitti: kilitli, yenilenme iddiasi olmayan genel metin', () => {
    for (const plan of [null, undefined, '', {}]) {
      const l = generationLock({ limit: 2, remaining: 0, used: 2 }, plan);
      expect(l.locked, String(plan)).toBe(true);
      expect(l.reason).toBe('allowance_used');
      expect(l.hint).not.toMatch(/yenilenir/);
    }
  });

  it('kullanilan limiti asmis (sayac ust sinirda degil): yine kilitli', () => {
    expect(generationLock({ limit: 2, remaining: 0, used: 3 }, 'TRIAL').locked).toBe(true);
  });
});

describe('generationLock — acik kalir', () => {
  it('kalan hak varsa acik (son hak dahil)', () => {
    for (const q of [{ limit: 2, remaining: 1, used: 1 }, { limit: 2, remaining: 2, used: 0 }, { limit: 15, remaining: 1, used: 14 }]) {
      const l = generationLock(q, 'TRIAL');
      expect(l.locked, JSON.stringify(q)).toBe(false);
      expect(l.reason).toBeNull();
      expect(l.hint).toBeNull();
    }
    expect(generationLock({ limit: 15, remaining: 3, used: 12 }, 'STARTER').locked).toBe(false);
  });

  it('kota yok / okunamadi (eski API, sunucu null, ag hatasi): acik — fail open', () => {
    for (const q of [null, undefined, {}, 'x', 0, []]) {
      expect(generationLock(q, 'TRIAL').locked, JSON.stringify(q)).toBe(false);
    }
  });

  it('bicim disi sayi: acik', () => {
    for (const q of [
      { limit: '2', remaining: 0, used: 2 },
      { limit: 2, remaining: '0', used: 2 },
      { limit: 2, remaining: 0 },
      { limit: 2, remaining: -1, used: 3 },
      { limit: 2, remaining: NaN, used: 2 },
      { limit: Infinity, remaining: 0, used: 2 },
    ]) {
      expect(generationLock(q, 'TRIAL').locked, JSON.stringify(q)).toBe(false);
    }
  });

  it('limit 0 (sunucuda boyle plan yok, bilinmeyen plan): kilit yok', () => {
    expect(generationLock({ limit: 0, remaining: 0, used: 0 }, 'TRIAL').locked).toBe(false);
    expect(generationLock({ limit: 0, remaining: 0, used: 0 }, null).locked).toBe(false);
    expect(generationLock({ limit: 0, remaining: 0, used: 5 }, 'MYSTERY').locked).toBe(false);
  });

  it('tutarsiz sayilar (kalan 0 ama kullanilan limitin altinda): kilit yok, karar sunucunun', () => {
    expect(generationLock({ limit: 15, remaining: 0, used: 3 }, 'STARTER').locked).toBe(false);
  });

  it('acik durumda da etiket ve hedef tanimli (cagiran kosulsuz okuyabilir)', () => {
    const l = generationLock(null, null);
    expect(l).toEqual({ locked: false, reason: null, label: 'Planını yükselt', href: '/pricing', hint: null });
  });
});
