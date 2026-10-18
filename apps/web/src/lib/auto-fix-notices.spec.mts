/**
 * Site Skoru adiminin kok dosya bildirimi: sitede dogrulanamayan yazim "uygulandi"
 * basarisi olarak gosterilmez.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { autoFixMessages, type AutoFixNowResult } from './api';
import { autoFixNotices } from './auto-fix-notices';

const AD: Record<string, string> = { sitemap: 'Sitemap', llms: 'llms.txt' };
const ad = (f: string) => AD[f] ?? f;

describe('autoFixNotices', () => {
  it('dogrulanan basari, dogrulanamayan API nedeniyle uyari; basari metni dogrulanmayani saymaz', () => {
    const neden = 'llms.txt yüklendi ama https://ornek.com/llms.txt adresinde henüz görünmüyor; önbellek (CDN) olabilir.';
    const r: AutoFixNowResult = {
      applied: ['sitemap', 'llms'],
      files: [
        { fix: 'sitemap', filename: 'sitemap.xml', content: '<urlset/>', verified: true, action: 'create' },
        { fix: 'llms', filename: 'llms.txt', content: '# ornek', verified: false, action: 'create' },
      ],
      unverified: [{ fix: 'llms', filename: 'llms.txt', url: 'https://ornek.com/llms.txt', reason: neden }],
    };
    const n = autoFixNotices(autoFixMessages(r, ad), ad);
    const success = n.filter((x) => x.tone === 'success');
    expect(success).toEqual([{ tone: 'success', title: '1 düzeltme uygulandı ve sitede doğrulandı: Sitemap' }]);
    expect(success.some((x) => x.title.includes('llms.txt'))).toBe(false);
    expect(n).toContainEqual({ tone: 'warning', title: 'llms.txt yazıldı ama sitede doğrulanamadı', description: neden });
  });

  it('dogrulama kaniti hic yoksa (files yok) basari bildirimi yok', () => {
    const n = autoFixNotices(autoFixMessages({ applied: ['sitemap'] }, ad), ad);
    expect(n.some((x) => x.tone === 'success')).toBe(false);
    expect(n).toEqual([{ tone: 'warning', title: 'Sitemap yazıldı ama sitede doğrulanamadı', description: 'Sitemap yüklendi ama sitede görünüp görünmediği doğrulanamadı.' }]);
  });

  it('hata, degisiklik gerekmedi ve desteklenmeyen ayri; hic sonuc yoksa bilgi', () => {
    const n = autoFixNotices(autoFixMessages({
      applied: [],
      errors: [{ fix: 'sitemap', code: 'wrong_root', error: 'Klasör siteyi sunmuyor.' }],
      unchanged: [{ fix: 'llms', reason: 'Dosya zaten güncel.' }],
      unsupported: ['schema'],
    }, ad), ad);
    expect(n).toEqual([
      { tone: 'error', title: 'Düzeltme uygulanmadı', description: 'Sitemap: Klasör siteyi sunmuyor.' },
      { tone: 'info', title: 'Değişiklik gerekmedi', description: 'llms.txt: Dosya zaten güncel.' },
      { tone: 'warning', title: '1 madde otomatik düzeltilemez (schema); snippet aracında düzelt' },
    ]);
    expect(autoFixNotices(autoFixMessages({ applied: [] }))).toEqual([{ tone: 'info', title: 'Uygulanacak otomatik düzeltme bulunmadı' }]);
  });
});
