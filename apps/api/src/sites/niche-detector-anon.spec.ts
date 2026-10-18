import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Nis tespiti: anonim akista headless Chrome YOK, engel sayfasi icerik degil.
 *
 * NEDEN VAR: landing'deki ucretsiz kontrol (kimlik dogrulamasiz) nis tespitine
 * gidiyordu; ince (SPA) sayfada --no-sandbox ile headless Chrome aciliyor ve
 * saldirganin sectigi sayfa sunucumuzda calisiyordu. Ayrica WAF/dogrulama
 * sayfasi icerik sanilip nis "Just a moment..." basligindan uyduruluyordu.
 */

const getirici = vi.hoisted(() => ({ cevap: null as null | ((url: string) => SafeTextResult) }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string) => {
      if (!getirici.cevap) throw new Error('cevap tanimli degil');
      return getirici.cevap(url);
    }),
  };
});

import { NicheDetectorService, NICHES } from './niche-detector.service.js';

function yanit(over: Partial<SafeTextResult>): SafeTextResult {
  return {
    status: 200, ok: true, url: 'https://ornek.com/', redirected: false,
    contentType: 'text/html', headers: { 'content-type': 'text/html' },
    text: '', truncated: false, binary: false, ...over,
  };
}

const SPA = '<html><head><title>Uygulama</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const DOLU = '<html><head><title>Bodrum Kuaför</title><meta name="description" content="Bodrum\'da saç kesimi, boya, manikür ve cilt bakımı hizmeti veren güzellik salonu."></head><body><h1>Saç ve güzellik</h1><p>Randevu alın.</p></body></html>';

// Servis anahtar yoksa erken doner; testte sahte istemci takilir. Ortam
// degiskeni ayni sureci paylasan diger test dosyalarina sizmasin diye geri alinir.
const ORJ_ANAHTAR = process.env.ANTHROPIC_API_KEY;
afterAll(() => {
  if (ORJ_ANAHTAR === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORJ_ANAHTAR;
});

function kur() {
  process.env.ANTHROPIC_API_KEY = ORJ_ANAHTAR || 'test-anahtari';
  const renderer = { renderHtml: vi.fn(async () => null), isAvailable: vi.fn(() => true) };
  const svc = new NicheDetectorService(renderer as never, undefined as never);
  const create = vi.fn(async () => ({
    content: [{ type: 'text', text: '{"niche":"güzellik/bakım","customNiche":"kuaför","confidence":0.9,"reasoning":"x","alternatives":[],"queries":[]}' }],
  }));
  (svc as any).anthropic = { messages: { create } };
  return { svc, renderer, create };
}

beforeEach(() => { getirici.cevap = null; });

describe('NicheDetector — anonim akista tarayici calismaz', () => {
  it('ince (SPA) sayfa + anon: renderHtml HIC cagrilmaz, durust "okunamadi" doner', async () => {
    const { svc, renderer } = kur();
    getirici.cevap = () => yanit({ text: SPA });
    const r = await svc.detectFromUrl('https://ornek.com/', 'anon');
    expect(renderer.renderHtml).not.toHaveBeenCalled();
    expect(r.contentReadable).toBe(false);
    expect(r.renderUsed).toBe(false);
    expect(r.reasoning).toContain('ücretsiz kontrolde');
  });

  it('ayni sayfa + member: render denenir (yonlendirme sonrasi adresle)', async () => {
    const { svc, renderer } = kur();
    getirici.cevap = () => yanit({ text: SPA, url: 'https://www.ornek.com/', redirected: true });
    await svc.detectFromUrl('https://ornek.com/', 'member');
    expect(renderer.renderHtml).toHaveBeenCalledTimes(1);
    expect(renderer.renderHtml).toHaveBeenCalledWith('https://www.ornek.com/');
  });

  it('varsayilan kitle member (onboarding akisi degismedi)', async () => {
    const { svc, renderer } = kur();
    getirici.cevap = () => yanit({ text: SPA });
    await svc.detectFromUrl('https://ornek.com/');
    expect(renderer.renderHtml).toHaveBeenCalledTimes(1);
  });
});

describe('NicheDetector — engel sayfasi icerik degildir', () => {
  it('Cloudflare 403: model cagrilmaz, neden doner', async () => {
    const { svc, create, renderer } = kur();
    getirici.cevap = () => yanit({
      status: 403, ok: false,
      headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': '1' },
      text: '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>',
    });
    const r = await svc.detectFromUrl('https://ornek.com/', 'member');
    expect(create).not.toHaveBeenCalled();
    expect(renderer.renderHtml).not.toHaveBeenCalled();
    expect(r.contentReadable).toBe(false);
    expect(r.reasoning).toContain('engelledi');
  });

  it('200 donen "Just a moment..." de engeldir', async () => {
    const { svc, create } = kur();
    getirici.cevap = () => yanit({ headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, text: '<title>Just a moment...</title>' });
    const r = await svc.detectFromUrl('https://ornek.com/', 'anon');
    expect(create).not.toHaveBeenCalled();
    expect(r.niche).toBe('diğer');
  });

  it('SSRF reddi (ic adres) ic IP\'yi mesaja sizdirmaz', async () => {
    const { svc } = kur();
    const { SafeFetchError } = await import('../common/safe-fetch.js');
    getirici.cevap = () => { throw new SafeFetchError('blocked_address', 'Ozel/ayrilmis adrese cozuldu: 10.0.0.7'); };
    const r = await svc.detectFromUrl('https://ic.ornek.com/', 'anon');
    expect(r.reasoning).toBe('Site okunamadı (blocked_address)');
    expect(r.reasoning).not.toContain('10.0.0.7');
  });
});

describe('NicheDetector — yeni nisler', () => {
  it('güzellik/bakım ve yerel hizmetler listede, model ciktisi olarak kabul edilir', async () => {
    expect(NICHES).toContain('güzellik/bakım');
    expect(NICHES).toContain('yerel hizmetler');
    expect(NICHES[NICHES.length - 1]).toBe('diğer');

    const { svc, create } = kur();
    getirici.cevap = () => yanit({ text: DOLU });
    const r = await svc.detectFromUrl('https://ornek.com/', 'anon');
    expect(r.niche).toBe('güzellik/bakım');
    expect(r.customNiche).toBe('kuaför');
    // Modele kapsam aciklamasi gidiyor (kuafor/berber/nail/spa; tesisatci...)
    const prompt = (create.mock.calls[0] as any)[0].messages[0].content as string;
    expect(prompt).toContain('güzellik/bakım: kuaför, berber, güzellik salonu, tırnak (nail) stüdyosu, spa');
    expect(prompt).toContain('yerel hizmetler: belirli bir bölgede yerinde hizmet veren');
  });
});
