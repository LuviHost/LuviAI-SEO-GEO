import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Anonim ucretsiz AI gorunurluk kontrolu — SSRF.
 *
 * NEDEN VAR: kimlik dogrulamasiz uc IP adresi, standart disi port ve kimlik
 * bilgili adres kabul ediyor, sayfayi redirect:'follow' ile cekiyor (ic adrese
 * yonlendirme serbest) ve sayfadan cikan basligi anonim cevapta geri
 * donduruyordu. Ince sayfada headless Chrome da aciliyordu.
 */

const getirici = vi.hoisted(() => ({ cagri: [] as string[], cevap: null as null | ((url: string) => SafeTextResult) }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string) => {
      getirici.cagri.push(url);
      if (!getirici.cevap) throw new Error('cevap tanimli degil');
      return getirici.cevap(url);
    }),
  };
});

import { PublicCitationService } from './public-citation.service.js';
import { NicheDetectorService } from '../sites/niche-detector.service.js';
import { SafeFetchError } from '../common/safe-fetch.js';
import { PUBLIC_DOMAIN_MESSAGES } from '../sites/site-url-policy.js';

function yanit(over: Partial<SafeTextResult>): SafeTextResult {
  return {
    status: 200, ok: true, url: 'https://ornek.com/', redirected: false,
    contentType: 'text/html', headers: { 'content-type': 'text/html' },
    text: '', truncated: false, binary: false, ...over,
  };
}

function prismaSahte() {
  return {
    publicCitationCheck: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'kontrol-1' })),
    },
  };
}

function aiSahte() {
  return {
    runPublicProbes: vi.fn(async () => []),
    publicAggregate: vi.fn(() => ({ shareOfVoice: [] })),
    classifyRealCompetitors: vi.fn(async () => new Set<string>()),
  };
}

const ORJ_ANAHTAR = process.env.ANTHROPIC_API_KEY;
afterAll(() => {
  if (ORJ_ANAHTAR === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORJ_ANAHTAR;
});

beforeEach(() => {
  getirici.cagri = [];
  getirici.cevap = null;
});

describe('ucretsiz kontrol — alan adi girdisi', () => {
  const niche = { detectFromUrl: vi.fn() };
  const svc = new PublicCitationService(prismaSahte() as never, aiSahte() as never, niche as never);
  svc.urlResolver = async () => undefined;

  it.each([
    ['127.0.0.1', PUBLIC_DOMAIN_MESSAGES.blocked_address],
    ['http://169.254.169.254/latest/meta-data/', PUBLIC_DOMAIN_MESSAGES.blocked_address],
    ['10.0.0.5', PUBLIC_DOMAIN_MESSAGES.blocked_address],
    ['[::1]', PUBLIC_DOMAIN_MESSAGES.blocked_address],
    ['2130706433', PUBLIC_DOMAIN_MESSAGES.blocked_address],
    ['93.184.216.34', PUBLIC_DOMAIN_MESSAGES.ip_literal],
    ['ornek.com:6379', PUBLIC_DOMAIN_MESSAGES.port],
    ['https://ornek.com:8443/', PUBLIC_DOMAIN_MESSAGES.port],
    ['admin:sifre@ornek.com', PUBLIC_DOMAIN_MESSAGES.credentials],
    ['localhost', PUBLIC_DOMAIN_MESSAGES.single_label],
    ['redis', PUBLIC_DOMAIN_MESSAGES.single_label],
    ['file:///etc/passwd', PUBLIC_DOMAIN_MESSAGES.protocol],
  ])('%s reddedilir, hicbir ag istegi atilmaz', async (input, mesaj) => {
    await expect(svc.check(input, '1.2.3.4')).rejects.toMatchObject({ message: mesaj });
    expect(getirici.cagri).toHaveLength(0);
    expect(niche.detectFromUrl).not.toHaveBeenCalled();
  });

  it('gecmis ucu da ayni normalizasyondan gecer (DNS sorulmadan)', async () => {
    await expect(svc.getHistory('127.0.0.1')).rejects.toMatchObject({ message: PUBLIC_DOMAIN_MESSAGES.blocked_address });
  });
});

describe('ucretsiz kontrol — DNS denetimi ilk istekten once', () => {
  it('ic aga cozulen alan adi: Turkce 400, sayfa cekilmez, nis tespiti calismaz', async () => {
    const niche = { detectFromUrl: vi.fn() };
    const svc = new PublicCitationService(prismaSahte() as never, aiSahte() as never, niche as never);
    svc.urlResolver = async () => { throw new SafeFetchError('blocked_address', 'x'); };
    await expect(svc.check('ic.ornek.com', '1.2.3.4')).rejects.toMatchObject({ message: PUBLIC_DOMAIN_MESSAGES.blocked_address, status: 400 });
    expect(getirici.cagri).toHaveLength(0);
    expect(niche.detectFromUrl).not.toHaveBeenCalled();
  });
});

describe('ucretsiz kontrol — anonim akis', () => {
  it('anasayfa safeFetchText ile cekilir; nis tespiti "anon" kitlesiyle, headless Chrome HIC acilmaz', async () => {
    process.env.ANTHROPIC_API_KEY = ORJ_ANAHTAR || 'test-anahtari';
    const renderer = { renderHtml: vi.fn(async () => '<html></html>'), isAvailable: vi.fn(() => true) };
    const realNiche = new NicheDetectorService(renderer as never, undefined as never);
    (realNiche as any).anthropic = { messages: { create: vi.fn() } };
    const detect = vi.spyOn(realNiche, 'detectFromUrl');

    // Ince SPA kabugu: uye akisinda render denenirdi
    getirici.cevap = (url) => yanit({ url, text: '<html><head><title>Uygulama</title></head><body><div id="root"></div></body></html>' });

    const prisma = prismaSahte();
    const svc = new PublicCitationService(prisma as never, aiSahte() as never, realNiche);
    svc.urlResolver = async () => undefined;
    const r = await svc.check('https://www.Ornek.com/blog?x=1', '1.2.3.4');

    expect(detect).toHaveBeenCalledWith('https://www.ornek.com/', 'anon');
    expect(renderer.renderHtml, 'anonim akista headless Chrome acildi').not.toHaveBeenCalled();
    // Yol/sorgu atildi: yalnizca anasayfa cekildi (marka + nis)
    expect(getirici.cagri.every((u) => u === 'https://www.ornek.com/')).toBe(true);
    expect(r.domain).toBe('ornek.com');
    expect(r.access.tier).toBe('anon');
  });

  it('engel sayfasinin basligi marka olarak donmez', async () => {
    const niche = { detectFromUrl: vi.fn(async () => ({ niche: 'diğer', confidence: 0, reasoning: '', alternatives: [] })) };
    getirici.cevap = (url) => yanit({
      url, status: 200,
      headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      text: '<html><head><title>Just a moment...</title><meta property="og:site_name" content="Just a moment"></head></html>',
    });
    const svc = new PublicCitationService(prismaSahte() as never, aiSahte() as never, niche as never);
    svc.urlResolver = async () => undefined;
    const r = await svc.check('kobipratik.com', '1.2.3.4');
    expect(r.brand).toBe('Kobipratik');
  });
});
