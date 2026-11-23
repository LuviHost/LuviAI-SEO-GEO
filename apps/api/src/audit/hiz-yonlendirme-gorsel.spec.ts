import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { redirectVariants, probeRedirect, summarizeRedirectChains, type RedirectProbe } from './redirect-chain.js';
import { pageSpeedField } from './pagespeed-field.js';
import { computeImageAltCheck } from './image-alt-check.js';
import { extractImages } from '../sites/image-extract.js';
import { AuditChecksService } from './audit-checks.service.js';
import { buildClientReport } from '../client-report/client-report-build.js';
import { mukellefGirdisi } from '../client-report/client-report.fixture.js';
import { hizSahaCumlesi } from '../client-report/client-report-texts.js';
import type { SafeTextOptions, SafeTextResult } from '../common/safe-fetch.js';

/**
 * SEOptimer karsilastirmasi (kobipratik.com, 23.11.2026) — RanksUp'in olcmedigi uc sey:
 *  1. PageSpeed SAHA verisi: lab puani 38–41, gercek kullanicilar esikleri geciyordu.
 *  2. Yonlendirme zinciri: http://kobipratik.com → https://kobipratik.com → https://www (2 adim).
 *  3. Boyutsuz gorseller: anasayfadaki 20 gorselin 20'sinde width/height yoktu.
 * Ucu de BILGI: puan degismez.
 */

/** Sahte fetcher: haritadaki zinciri izler, her adimda allowRedirect'i cagirir (safe-fetch gibi) */
function fakeFetcher(map: Record<string, string | number>) {
  return async (url: string, opts: SafeTextOptions = {}): Promise<SafeTextResult> => {
    let cur = url;
    for (let i = 0; i < 6; i++) {
      const v = map[cur];
      if (v === undefined) throw new Error(`baglanti yok: ${cur}`);
      if (typeof v === 'number') {
        return { status: v, ok: v >= 200 && v < 300, url: cur, redirected: i > 0, contentType: 'text/html', headers: {}, text: '', truncated: false, binary: false } as SafeTextResult;
      }
      const next = new URL(v, cur);
      if (opts.allowRedirect && !opts.allowRedirect(next)) throw new Error('izin yok');
      cur = next.toString();
    }
    throw new Error('cok fazla');
  };
}

describe('yonlendirme zinciri', () => {
  it('dort yazilis: http/https × www\'lu/www\'suz; IP ve noktasiz adda www eklenmez', () => {
    expect(redirectVariants('https://www.kobipratik.com')).toEqual([
      'http://kobipratik.com/', 'http://www.kobipratik.com/', 'https://kobipratik.com/', 'https://www.kobipratik.com/',
    ]);
    expect(redirectVariants('http://127.0.0.1:4555')).toEqual(['http://127.0.0.1:4555/', 'https://127.0.0.1:4555/']);
    expect(redirectVariants('http://localhost:3000')).toEqual(['http://localhost:3000/', 'https://localhost:3000/']);
  });

  it('kobipratik: http://kobipratik.com iki adimda son adrese ulasir → bilgi; diger yazilislar tek adim', async () => {
    const f = fakeFetcher({
      'http://kobipratik.com/': 'https://kobipratik.com/',
      'https://kobipratik.com/': 'https://www.kobipratik.com/',
      'http://www.kobipratik.com/': 'https://www.kobipratik.com/',
      'https://www.kobipratik.com/': 200,
    });
    const probes = await Promise.all(redirectVariants('https://www.kobipratik.com').map((v) => probeRedirect(f, v)));
    expect(probes.map((p) => p.hops)).toEqual([2, 1, 1, 0]);
    const s = summarizeRedirectChains(probes);
    expect(s.longChainCount).toBe(1);
    expect(s.maxHops).toBe(2);
    expect(s.longChains).toEqual(['http://kobipratik.com → https://kobipratik.com → https://www.kobipratik.com']);
  });

  it('ulasilamayan yazilis (www DNS yok) ve hata ile biten zincir uzun sayilmaz', async () => {
    const f = fakeFetcher({
      'http://ornek.com/': 'https://ornek.com/',
      'https://ornek.com/': 200,
      'http://www.ornek.com/': 'https://www.ornek.com/x',
      'https://www.ornek.com/x': 'https://www.ornek.com/y',
      'https://www.ornek.com/y': 404,
    });
    const probes = await Promise.all(redirectVariants('https://ornek.com').map((v) => probeRedirect(f, v)));
    const s = summarizeRedirectChains(probes);
    expect(probes.find((p) => p.start === 'https://www.ornek.com/')!.final).toBeNull();
    expect(s.longChainCount).toBe(0);
  });

  it('HTTPS kontrolu: uzun zincir bilgi bulgusu olur, puan 100 ve kontrol gecer', async () => {
    const svc = new AuditChecksService();
    const probe = (start: string, chain: string[], status = 200): RedirectProbe => ({ start, chain: [start, ...chain], final: chain.at(-1) ?? start, status, hops: chain.length });
    const crawl: any = {
      baseUrl: 'https://www.kobipratik.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0,
      redirectProbes: [probe('http://kobipratik.com/', ['https://kobipratik.com/', 'https://www.kobipratik.com/']), probe('https://www.kobipratik.com/', [])],
    };
    const https = (await svc.runAllChecks(crawl)).find((c) => c.id === 'https')!;
    expect(https.score).toBe(100);
    expect(https.valid).toBe(true);
    expect(https.issues.map((i) => [i.type, i.severity])).toEqual([['redirect_chain_long', 'info']]);
    expect(https.details).toMatchObject({ longChainCount: 1, maxRedirectHops: 2, redirectsProbed: 2 });

    // Eski tarama (yoklama yok): bulgu ve alan yok
    const eski = (await svc.runAllChecks({ ...crawl, redirectProbes: undefined })).find((c) => c.id === 'https')!;
    expect(eski.issues).toEqual([]);
    expect(eski.details).not.toHaveProperty('longChainCount');
  });
});

describe('PageSpeed saha verisi (CrUX)', () => {
  const psi = (le: any, ole?: any) => ({ loadingExperience: le, originLoadingExperience: ole });
  const m = (lcp: number, inp: number | null, clsX100: number) => ({
    LARGEST_CONTENTFUL_PAINT_MS: { percentile: lcp, category: 'FAST' },
    ...(inp === null ? {} : { INTERACTION_TO_NEXT_PAINT: { percentile: inp, category: 'FAST' } }),
    CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: clsX100, category: 'FAST' },
    FIRST_CONTENTFUL_PAINT_MS: { percentile: 1500 },
  });

  it('kobipratik: lab dusuk ama saha esikleri geciyor; CLS 100 ile carpilmis gelir', () => {
    const f = pageSpeedField(psi({ metrics: m(2000, 190, 0), overall_category: 'FAST' }))!;
    expect(f).toMatchObject({ kapsam: 'sayfa', genel: 'FAST', lcpMs: 2000, inpMs: 190, cls: 0, gecti: true });
    expect(pageSpeedField(psi({ metrics: m(2400, 150, 25) }))!.cls).toBe(0.25);
  });

  it('esik: LCP 2500, INP 200, CLS 0,1 — biri asilirsa gecmez; INP yoksa LCP + CLS ile', () => {
    expect(pageSpeedField(psi({ metrics: m(2600, 100, 5) }))!.gecti).toBe(false);
    expect(pageSpeedField(psi({ metrics: m(2000, 250, 5) }))!.gecti).toBe(false);
    expect(pageSpeedField(psi({ metrics: m(2000, 100, 11) }))!.gecti).toBe(false);
    expect(pageSpeedField(psi({ metrics: m(2500, null, 10) }))!.gecti).toBe(true);
  });

  it('sayfa verisi yoksa sitenin geneli (origin); hic yoksa null — sayi uydurulmaz', () => {
    expect(pageSpeedField(psi({ metrics: m(2000, 100, 0), origin_fallback: true }))!.kapsam).toBe('site');
    expect(pageSpeedField(psi({}, { metrics: m(3000, 300, 30) }))).toMatchObject({ kapsam: 'site', gecti: false });
    expect(pageSpeedField(psi(undefined, undefined))).toBeNull();
    expect(pageSpeedField({})).toBeNull();
  });

  it('rapor: hiz aksiyonu saha verisini soyler; saha gectiyse etki dusuk', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).pagespeed = { score: 71, field: { kapsam: 'sayfa', lcpMs: 2000, inpMs: 190, cls: 0, gecti: true } };
    // Dusuk etkili madde aksiyon sinirinin disina dusebilir (bu dogru); burada yalniz hiz bulgusu var
    g.audit!.issues = (g.audit!.issues as any[]).filter((i) => String(i.type).startsWith('pagespeed_'));
    const a = buildClientReport(g, new Date('2026-10-22T10:00:00.000Z')).aksiyonlar.find((x) => x.baslik === 'Sayfa hızını iyileştirin')!;
    expect(a.etki).toBe('dusuk');
    expect(a.aciklama).toContain("Gerçek ziyaretçi verisi ise Google'ın hız eşiklerini geçiyor (Chrome kullanıcıları, son 28 gün)");
    expect(a.aciklama).toContain('ana içerik 2,0 saniyede yükleniyor, tıklamalara 190 ms\'de tepki veriyor, sayfa kayması 0');

    // Saha verisi olmayan (eski) tarama: eski cumle, eski etki
    const eski = buildClientReport(mukellefGirdisi(), new Date('2026-10-22T10:00:00.000Z')).aksiyonlar.find((x) => x.baslik === 'Sayfa hızını iyileştirin')!;
    expect(eski.etki).toBe('orta');
    expect(eski.aciklama).not.toContain('Gerçek ziyaretçi');
  });

  it('saha esiklerin altindaysa cumle esikleri yazar; degerlendirilemiyorsa cumle yok', () => {
    expect(hizSahaCumlesi({ kapsam: 'site', lcpMs: 3400, inpMs: null, cls: 0.12, gecti: false }))
      .toBe("Gerçek ziyaretçi verisi de Google'ın hız eşiklerinin altında kalıyor (Chrome kullanıcıları, son 28 gün, sitenin geneli): ana içerik 3,4 saniyede yükleniyor, sayfa kayması 0,12. Eşikler: yüklenme 2,5 saniye, tepki 200 ms, kayma 0,1.");
    expect(hizSahaCumlesi({ lcpMs: 2000, gecti: null })).toBeNull();
    expect(hizSahaCumlesi(null)).toBeNull();
  });
});

describe('boyutsuz gorseller', () => {
  it('width ve height birlikte yoksa sayilir; olcu disi (1x1 piksel, kucuk data URI) sayilmaz', () => {
    const $ = cheerio.load(`
      <img src="/a.jpg" alt="a">
      <img src="/b.jpg" alt="b" width="100" height="50">
      <img src="/c.jpg" alt="" width="100">
      <img src="/pixel.gif" width="1" height="1">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">`);
    expect(extractImages($, 'https://ornek.com/').stats.noDimensions).toBe(2);
  });

  it('kontrol: bilgi bulgusu, puan degismez; eski tarama (alan yok) olculmedi sayilir', () => {
    const sayfa = (url: string, noDimensions?: number) => ({
      url, imageAltStats: { total: 3, withAlt: 3, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0, ...(noDimensions === undefined ? {} : { noDimensions }) },
    });
    const c = computeImageAltCheck([sayfa('https://ornek.com/', 3), sayfa('https://ornek.com/x', 0)]);
    expect(c.score).toBe(100);
    expect(c.issues.map((i) => [i.type, i.severity])).toEqual([['image_dimensions_missing', 'info']]);
    expect(c.details).toMatchObject({ noDimensions: 3, noDimensionsPages: ['https://ornek.com/'] });

    const eski = computeImageAltCheck([sayfa('https://ornek.com/')]);
    expect(eski.issues).toEqual([]);
    expect(eski.details!.noDimensions).toBeNull();
  });

  it('rapor: iki yeni bilgi satiri sayfa duzeyindeki sorunlarda, sayisi ve ornekleriyle', () => {
    const g = mukellefGirdisi();
    const checks = g.audit!.checks as any;
    checks.image_alt.details = { ...checks.image_alt.details, noDimensions: 20, noDimensionsPages: ['https://www.ornek.com/'] };
    checks.https = { id: 'https', name: 'HTTPS', found: true, valid: true, score: 100, issues: [], details: { longChainCount: 1, maxRedirectHops: 2, longChains: ['http://ornek.com → https://ornek.com → https://www.ornek.com'] } };
    (g.audit!.issues as any[]).push(
      { severity: 'info', type: 'image_dimensions_missing', checkId: 'image_alt', description: '20 görselin HTML\'de genişlik ve yüksekliği yok' },
      { severity: 'info', type: 'redirect_chain_long', checkId: 'https', description: 'Alan adının 1 yazılışı siteye 2 yönlendirmeyle ulaşıyor' },
    );
    const r = buildClientReport(g, new Date('2026-10-22T10:00:00.000Z'));
    const seo = r.seo as any;
    const boyut = seo.sayfaSorunlari.find((s: any) => s.tur === 'image_dimensions_missing');
    expect(boyut).toMatchObject({ onem: 'bilgi', sayi: 20, birim: 'görsel', ornekler: ['https://www.ornek.com/'] });
    expect(boyut.aciklama).toContain('20 görselin genişlik ve yüksekliği sayfa kodunda yazmıyor');
    const yon = seo.sayfaSorunlari.find((s: any) => s.tur === 'redirect_chain_long');
    expect(yon).toMatchObject({ onem: 'bilgi', sayi: 1, birim: 'adres', ornekler: ['http://ornek.com → https://ornek.com → https://www.ornek.com'] });
    expect(yon.aciklama).toContain('2 yönlendirmeyle ulaşıyor');
    // Bilgi duzeyi: kontrol gecer, aksiyona donusmez
    expect(seo.kontroller.find((k: any) => k.id === 'https').durum).toBe('gecti');
    expect(r.aksiyonlar.some((a) => /yönlendir|genişlik/i.test(a.baslik))).toBe(false);
  });
});
