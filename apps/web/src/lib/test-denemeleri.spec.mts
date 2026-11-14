/**
 * Ücretsiz test denemeleri — yönetim paneli metinleri (14.11.2026).
 * Çalıştırma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bugunMu, denemeAciklamasi, denemeEtiketi, denemeTonu, denemeZamani, uyeMetni } from './test-denemeleri';

describe('sonuc adlari', () => {
  it('bes sonucun da etiketi, aciklamasi ve tonu var; bilinmeyen ad oldugu gibi gosterilir', () => {
    for (const o of ['measured', 'cached', 'rate_limited', 'budget', 'failed']) {
      expect(denemeEtiketi(o), o).not.toBe(o);
      expect(denemeAciklamasi(o), o).not.toBe('');
      expect(denemeTonu(o), o).toMatch(/^text-/);
    }
    expect(denemeEtiketi('yeni_bir_sonuc')).toBe('yeni_bir_sonuc');
    expect(denemeAciklamasi('yeni_bir_sonuc')).toBe('');
    expect(denemeTonu('yeni_bir_sonuc')).toBe('text-muted-foreground');
  });

  it('sunucudaki sonuc adlari ve etiketleriyle ayni (apps/api public-check-attempt.ts)', () => {
    const api = readFileSync(fileURLToPath(new URL('../../../api/src/audit/public-check-attempt.ts', import.meta.url)), 'utf8');
    expect(api).toContain("export const ATTEMPT_OUTCOMES = ['measured', 'cached', 'rate_limited', 'budget', 'failed'] as const;");
    for (const o of ['measured', 'cached', 'rate_limited', 'budget', 'failed']) {
      expect(api, o).toContain(`${o}: '${denemeEtiketi(o)}',`);
    }
  });
});

describe('uye oldu — test edilen alan adini sitesi olarak ekleyen uye', () => {
  const uye = { name: 'Batuhan Kartal', email: 'k@ornek.com', plan: 'TRIAL', status: 'TRIAL', siteAddedAt: '2026-11-14T15:44:22Z' };

  it('ad · e-posta · durum; ad yoksa e-posta ile baslar; uye yoksa bos', () => {
    expect(uyeMetni(uye)).toBe('Batuhan Kartal · k@ornek.com · deneme');
    expect(uyeMetni({ ...uye, name: null, status: 'ACTIVE' })).toBe('k@ornek.com · ödeyen');
    expect(uyeMetni({ ...uye, status: 'CANCELED' })).toBe('Batuhan Kartal · k@ornek.com · iptal etmiş');
    expect(uyeMetni({ ...uye, status: 'YENI_DURUM' })).toBe('Batuhan Kartal · k@ornek.com · yeni_durum');
    expect(uyeMetni({ ...uye, status: null })).toBe('Batuhan Kartal · k@ornek.com');
    expect(uyeMetni(null)).toBe('');
    expect(uyeMetni(undefined)).toBe('');
  });

  it('durum adlari semadaki abonelik durumlarini kapsar (apps/api prisma SubscriptionStatus)', () => {
    const sema = readFileSync(fileURLToPath(new URL('../../../api/prisma/schema.prisma', import.meta.url)), 'utf8');
    const blok = /enum SubscriptionStatus \{([^}]+)\}/.exec(sema)![1];
    const durumlar = blok.split('\n').map((s) => s.trim()).filter((s) => /^[A-Z_]+$/.test(s));
    expect(durumlar.length).toBeGreaterThanOrEqual(4);
    for (const d of durumlar) expect(uyeMetni({ ...uye, name: null, email: null, status: d }), d).not.toBe(d.toLowerCase());
  });
});

describe('gizlilik metniyle uyum', () => {
  it('deneme listesi ziyaretciyi IP ozetine gore gruplamaz (ozet yalniz kotuye kullanim ve sinir icin)', () => {
    const oku = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    // Dayanak: gizlilik metnindeki cumle yerinde
    expect(oku('../app/(marketing)/privacy/page.tsx')).toContain('IP özeti yalnız kötüye kullanımı önlemek ve test hakkını sınırlamak içindir');
    // Sayfa deneme satirinda IP ozetini okumaz / gostermez
    const sayfa = oku('../app/(admin)/admin/leads/page.tsx');
    expect(sayfa).not.toMatch(/d\.ip\b/);
    expect(sayfa).not.toContain('aynı ziyaretçi');
    // Sunucu deneme listesine IP ozetini vermez; uye eslesmesi alan adiyladir
    const admin = oku('../../../api/src/admin/admin.service.ts');
    expect(admin).toContain("select: { id: true, domain: true, outcome: true, checkId: true, detail: true, notifiedAt: true, createdAt: true },");
    expect(admin).toContain('members.get(hostKey(domain))');
  });

  it('sinir metni "ziyaretci baska site test etmisti" demez (sinir IP basinadir)', () => {
    expect(denemeAciklamasi('rate_limited')).toContain('Aynı IP adresinden');
    expect(denemeAciklamasi('rate_limited')).not.toContain('Ziyaretçi');
  });
});

describe('zaman — Turkiye saatiyle', () => {
  it('bugun mu: Turkiye gunu (UTC 21:00 sonrasi TR\'de ertesi gun)', () => {
    const simdi = new Date('2026-11-14T16:00:00Z'); // TR 19:00
    expect(bugunMu('2026-11-14T15:15:00Z', simdi)).toBe(true);
    expect(bugunMu('2026-11-13T21:30:00Z', simdi)).toBe(true); // TR 14.11 00:30
    expect(bugunMu('2026-11-13T20:30:00Z', simdi)).toBe(false); // TR 13.11 23:30
    expect(bugunMu('bozuk', simdi)).toBe(false);
  });

  it('tarih ve saat tarayicinin saat diliminden bagimsiz', () => {
    expect(denemeZamani('2026-11-14T15:15:00Z')).toBe('14.11.2026 18:15');
    expect(denemeZamani('bozuk')).toBe('bozuk');
  });
});
