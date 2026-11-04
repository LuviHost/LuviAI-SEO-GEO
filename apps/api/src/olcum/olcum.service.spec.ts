import { describe, expect, it } from 'vitest';
import type { SafeTextOptions, SafeTextResult } from '../common/safe-fetch.js';
import { OlcumService, rakipHedefleri } from './olcum.service.js';

function yanit(url: string, text: string, status = 200, contentType = 'text/html'): SafeTextResult {
  return { status, ok: status >= 200 && status < 300, url, redirected: false, contentType, headers: { 'content-type': contentType }, text, truncated: false, binary: false };
}

const GTM = `var data = {"resource": ${JSON.stringify({
  macros: [{ function: '__e' }],
  tags: [{ function: '__googtag', vtp_tagId: 'G-ABCDEF1234' }, { function: '__gaawe', vtp_eventName: 'generate_lead' }],
  predicates: [{ function: '_eq', arg0: ['macro', 0], arg1: 'form_submit' }],
  rules: [[['if', 0], ['add', 1]]],
})}};`;

describe('rakipHedefleri', () => {
  it('kendi alan adini, tekrari, gecersiz/ic adresi atlar; sinir uygular; ad yoksa alan adi', () => {
    const r = rakipHedefleri([
      { name: 'Kendisi', url: 'https://www.ornek.com' },
      { name: 'Rakip A', url: 'rakipa.com.tr' },
      { name: 'Rakip A tekrar', url: 'https://www.rakipa.com.tr/hakkimizda' },
      { name: 'Ic', url: 'http://127.0.0.1' },
      { url: 'https://rakipb.com' },
      { name: 'C', url: 'https://c.com' },
      'bozuk',
    ], 'https://ornek.com', 2);
    expect(r).toEqual([
      { ad: 'Rakip A', url: 'https://rakipa.com.tr/', rakip: true },
      { ad: 'rakipb.com', url: 'https://rakipb.com/', rakip: true },
    ]);
    expect(rakipHedefleri(null, 'https://ornek.com')).toEqual([]);
  });
});

describe('OlcumService.hedefiTara', () => {
  const svc = new OlcumService({} as never);

  it('ana sayfa → ayni kokenli JS → gtm.js; ucuncu taraf script indirilmez; musteri icin bulgu uretilir', async () => {
    const istekler: string[] = [];
    const fetcher = async (url: string, _o?: SafeTextOptions) => {
      istekler.push(url);
      if (url === 'https://ornek.com/') {
        return yanit(url, `<script src="/app.js"></script><script src="https://cdn.disari.com/x.js"></script>`);
      }
      if (url === 'https://ornek.com/app.js') return yanit(url, `j.src='https://www.googletagmanager.com/gtm.js?id='+i})(window,document,'script','dataLayer','GTM-ABC1234');`, 200, 'application/javascript');
      if (url.startsWith('https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234')) return yanit(url, GTM, 200, 'application/javascript');
      return yanit(url, '', 404);
    };
    const r = await svc.hedefiTara({ ad: 'Örnek', url: 'https://ornek.com/', rakip: false }, Date.now() + 60_000, fetcher);
    expect(istekler).toEqual(['https://ornek.com/', 'https://ornek.com/app.js', 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234']);
    expect(r.durum).toBe('tamam');
    expect(r.rapor?.platformlar.map((p) => p.kod)).toEqual(['gtm', 'ga4']);
    expect(r.rapor?.olaylar).toEqual([{ ad: 'generate_lead', platform: 'ga4', tetikleyici: 'form_submit', kaynak: 'gtm' }]);
    expect(r.bulgular?.map((b) => b.kod)).toEqual(['ai-kanal-grubu']);
    expect(r.taranan).toEqual({ script: 1, gtm: 1, kesildi: false });
  });

  it('rakip icin bulgu yazilmaz; engellenen ana sayfa olculemedi olur (yok denmez)', async () => {
    const engel = async (url: string) => yanit(url, '<title>Just a moment...</title><div id="cf-chl-widget"></div>', 403);
    const r = await svc.hedefiTara({ ad: 'Rakip', url: 'https://rakip.com/', rakip: true }, Date.now() + 60_000, engel);
    expect(r.durum).toBe('olculemedi');
    expect(r.neden).toBeTruthy();
    expect(r.rapor).toBeUndefined();
    const ok = await svc.hedefiTara({ ad: 'Rakip', url: 'https://rakip.com/', rakip: true }, Date.now() + 60_000, async (u) => yanit(u, '<html></html>'));
    expect(ok.bulgular).toBeUndefined();
  });

  it('sure dolduysa yan istekler atilmaz, kesildi isaretlenir', async () => {
    const istekler: string[] = [];
    const r = await svc.hedefiTara({ ad: 'Ö', url: 'https://ornek.com/', rakip: false }, Date.now() - 1, async (u) => {
      istekler.push(u);
      return yanit(u, `<script src="/a.js"></script>`);
    });
    expect(istekler).toEqual(['https://ornek.com/']);
    expect(r.taranan?.kesildi).toBe(true);
  });
});
