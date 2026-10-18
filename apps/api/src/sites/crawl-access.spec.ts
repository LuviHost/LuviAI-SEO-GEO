import { describe, it, expect, vi } from 'vitest';
import { accessFromFetchError, crawlAccessNewerThanAudit, type CrawlAccessRecord } from './crawl-access.js';
import { SafeFetchError } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

/**
 * K14 — "erisim kaydi denetimden yeni mi" kurali TEK yerde.
 *
 * NEDEN VAR: ayni kural audit getLatest, GEO Score Card, MCP araclari ve
 * (hic uygulanmadigi) raporlarda ayri ayri yaziliyordu. Raporlar uygulamadigi
 * icin panel "Erisim engellendi" derken aylik rapor eski skoru guncel diye
 * gosteriyordu (F25). Tum cagiranlar artik bu fonksiyonu kullanir.
 */
const kayit = (at: string): CrawlAccessRecord => ({
  state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
  reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.',
  at, source: 'audit',
});

describe('crawlAccessNewerThanAudit', () => {
  it('yalniz denetimden YENI kayit gecerli; denetim yoksa kayit gecerli', () => {
    const r = kayit('2026-10-15T09:00:00.000Z');
    expect(crawlAccessNewerThanAudit(r, new Date('2026-10-14T00:00:00Z'))).toBe(r);
    expect(crawlAccessNewerThanAudit(r, '2026-10-16T00:00:00Z')).toBeNull();
    expect(crawlAccessNewerThanAudit(r, null)).toBe(r);
    expect(crawlAccessNewerThanAudit(null, new Date())).toBeNull();
  });

  it('bozuk tarihte guvenli taraf: kayit tarihi bozuksa null, denetim tarihi bozuksa kayit', () => {
    expect(crawlAccessNewerThanAudit(kayit('bozuk'), '2026-10-14T00:00:00Z')).toBeNull();
    const r = kayit('2026-10-15T09:00:00.000Z');
    expect(crawlAccessNewerThanAudit(r, 'bozuk')).toBe(r);
  });

  it('GEO Score Card eski ice aktarma yolunu korur (ayni fonksiyon)', async () => {
    const kart = await import('../audit/geo-score-card.service.js');
    expect(kart.crawlAccessNewerThanAudit).toBe(crawlAccessNewerThanAudit);
  });
});

/**
 * F15 — sikistirmasi cozulemeyen 2xx yanit (safe-fetch 'content_encoding').
 * Eskiden genel "Siteye bağlantı kurulamadı" metnine dusuyordu: site ayakta,
 * sorun sunucunun sikistirma ayarinda; site sahibi yanlis yere bakardi.
 */
describe('accessFromFetchError', () => {
  it("content_encoding: dogru neden ve sikistirma ipucu (baglanti hatasi denmez)", () => {
    const a = accessFromFetchError('https://site.com/', new SafeFetchError('content_encoding', 'Desteklenmeyen icerik kodlamasi: zstd'));
    expect(a).toEqual({
      state: 'unreachable', kind: 'network', url: 'https://site.com/', status: null, vendor: null,
      reason: 'Site yanıtı çözülemedi: sunucu desteklenmeyen ya da bozuk bir sıkıştırmayla (Content-Encoding) yanıt verdi.',
      hint: 'Sunucunun yalnızca gzip, br veya deflate sıkıştırması kullandığını ve sıkıştırılmış dosyaların bozuk olmadığını kontrol edin.',
    });
    expect(a.reason).not.toContain('bağlantı kurulamadı');
  });

  it('bilinmeyen hata genel baglanti metnine duser (degismedi)', () => {
    expect(accessFromFetchError('https://site.com/', new Error('x')).reason).toBe('Siteye bağlantı kurulamadı.');
  });
});
