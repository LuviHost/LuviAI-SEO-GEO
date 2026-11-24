import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { visibleQaCount } from './geo-content-signals.js';
import { extractImages } from '../sites/image-extract.js';
import { computeImageAltCheck, LATER_EAGER_MIN } from './image-alt-check.js';
import { assessTrustContact, contactSignals, findContactLink, isYmylNiche, trustContactStatus } from './trust-contact.js';
import { trustContactCheck } from './geo-score-card.service.js';
import { SAYFA_SORUNU_METINLERI, BULGU_METINLERI } from '../client-report/client-report-texts.js';
import { parseOrganicSignal } from './google-ai-surfaces.js';
import { promptRunRows } from './prompt-run-rows.js';
import { buildLatestRun } from './prompt-latest-run.js';

/**
 * geo.new'in kobipratik raporu (24.11.2026) ve kirmizi takim denetimi:
 *  1. SSS sayimi <summary>Soru?</summary><p>Cevap</p> yapisini goremiyordu.
 *  2. Ust gorselin tembel yuklenmesi (LCP) olculmuyordu.
 *  3. Para sitelerinde iletisim / sorumlu kurulus olculmuyordu; Cloudflare
 *     e-posta gizlemesi AI tarayicilarindan adresi sakliyordu.
 */

describe('gorunur SSS sayimi', () => {
  it('<summary> ile cevap arasinda bosluk olmasa da soruyu sayar', () => {
    const $ = cheerio.load('<h2>SSS</h2><details><summary>Ücretsiz mi?</summary><p>Evet.</p></details><details><summary>Hangi bankalar?</summary>Hepsi.</details>');
    expect(visibleQaCount($)).toBe(2);
  });

  it('script icindeki "?\\n" soru sayilmaz', () => {
    const $ = cheerio.load('<p>Metin</p><script>var a = b ?\n c : d;</script><style>a::after{content:"?"}\n</style>');
    expect(visibleQaCount($)).toBe(0);
  });

  it('eski bicim (baslik + satir sonu) yine sayilir', () => {
    const $ = cheerio.load('<h3>Ne kadar sürer?\n</h3><p>a</p><h3>Ücret ne?</h3><p>b</p>');
    expect(visibleQaCount($)).toBe(2);
  });

  it('cumle ortasindaki soru isareti sayilmaz', () => {
    const $ = cheerio.load('<p>Neden? Çünkü böyle.</p>');
    expect(visibleQaCount($)).toBe(0);
  });
});

describe('ust gorselin tembel yuklenmesi', () => {
  const img = (n: number, attrs = '') => `<img src="/g${n}.jpg" alt="g" width="600" height="300" ${attrs}>`;

  it('ilk uc gorselden lazy olanlari sayar, kucuk ikonlari saymaz', () => {
    const html = `<img src="/logo.svg" alt="logo" width="40" height="40" loading="lazy">${img(1, 'loading="lazy"')}${img(2)}${img(3, 'loading="lazy"')}`;
    const s = extractImages(cheerio.load(html), 'https://ornek.com/').stats;
    expect(s.earlyLazy).toBe(1); // logo ikon (40x40), g1 lazy; g3 dorduncu gorsel
    expect(s.laterImages).toBe(1);
    expect(s.laterEager).toBe(0);
  });

  it('kobipratik bicimi: 20 gorselin hicbiri lazy degil → alttakiler bilgisi', () => {
    const html = Array.from({ length: 20 }, (_, i) => img(i)).join('');
    const s = extractImages(cheerio.load(html), 'https://ornek.com/').stats;
    expect(s.earlyLazy).toBe(0);
    expect(s.laterImages).toBe(17);
    expect(s.laterEager).toBe(17);
    const c = computeImageAltCheck([{ url: 'https://ornek.com/', imageAltStats: s }]);
    expect(c.issues.map((i) => i.type)).toContain('image_lazy_missing');
    expect(c.issues.map((i) => i.type)).not.toContain('image_early_lazy');
    expect(c.details?.laterEagerPageCount).toBe(1);
    expect(c.score).toBe(100); // bilgi: alt metni puani degismez
  });

  it('ust gorsel lazy → image_early_lazy bilgisi ve sayfa ornegi', () => {
    const s = extractImages(cheerio.load(img(1, 'loading="lazy"') + img(2)), 'https://ornek.com/a').stats;
    const c = computeImageAltCheck([{ url: 'https://ornek.com/a', imageAltStats: s }]);
    const issue = c.issues.find((i) => i.type === 'image_early_lazy');
    expect(issue?.severity).toBe('info');
    expect(c.details?.earlyLazyPages).toEqual(['https://ornek.com/a']);
  });

  it('alttakilerin bir kismi zaten lazy ise bilgi cikmaz; esigin altinda da cikmaz', () => {
    const cok = Array.from({ length: 3 + LATER_EAGER_MIN }, (_, i) => img(i, i === 5 ? 'loading="lazy"' : '')).join('');
    const az = Array.from({ length: 3 + LATER_EAGER_MIN - 1 }, (_, i) => img(i)).join('');
    for (const html of [cok, az]) {
      const s = extractImages(cheerio.load(html), 'https://ornek.com/').stats;
      expect(computeImageAltCheck([{ url: 'https://ornek.com/', imageAltStats: s }]).issues.map((i) => i.type)).not.toContain('image_lazy_missing');
    }
  });

  it('eski tarama (alan yok): null, bilgi uretilmez', () => {
    const c = computeImageAltCheck([{ url: 'https://ornek.com/', imageAltStats: { total: 1, withAlt: 1, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 } }]);
    expect(c.details?.earlyLazy).toBeNull();
    expect(c.details?.laterEagerPageCount).toBeNull();
  });

  it('musteri raporu metinleri var', () => {
    for (const t of ['image_early_lazy', 'image_lazy_missing']) {
      expect(SAYFA_SORUNU_METINLERI[t as keyof typeof SAYFA_SORUNU_METINLERI]).toBeDefined();
      expect(typeof BULGU_METINLERI[t as keyof typeof BULGU_METINLERI]).toBe('function');
    }
  });
});

describe('iletisim ve sorumlu kurulus', () => {
  const base = 'https://www.kobipratik.com/';
  const kobiHome = '<header><a href="/kobipratik-nedir">Hakkımızda</a></header><main><h1>KOBİ</h1></main><footer><a href="/kvkk">KVKK</a></footer>';
  const kobiHakkinda = '<h2>İletişim</h2><p>E-posta: <a href="/cdn-cgi/l/email-protection#4d24">[email&#160;protected]</a></p>';

  it('"Hakkımızda" metinli linki bulur; iletisim linki varsa onu tercih eder', () => {
    expect(findContactLink(kobiHome, base)).toEqual({ url: 'https://www.kobipratik.com/kobipratik-nedir', kind: 'about', text: 'Hakkımızda' });
    const ikisi = '<a href="/hakkimizda">Biz</a><a href="https://kobipratik.com/iletisim">Yaz</a>';
    expect(findContactLink(ikisi, base)?.kind).toBe('contact');
    expect(findContactLink('<a href="https://baska.com/iletisim">İletişim</a>', base)).toBeNull();
  });

  it('kobipratik: e-posta yalniz Cloudflare gizlemesiyle → gecmez, neden yazilir', () => {
    const r = assessTrustContact(kobiHome, base, { url: base + 'kobipratik-nedir', html: kobiHakkinda });
    expect(r.ok).toBe(false);
    expect(r.hiddenEmailOnly).toBe(true);
    expect(r.pageRead).toBe(true);
    expect(trustContactStatus(r)).toMatch(/Cloudflare/);
  });

  it('bagli sayfada telefon ve mailto varsa gecer', () => {
    const r = assessTrustContact(kobiHome, base, { url: base + 'kobipratik-nedir', html: '<p>Tel: <a href="tel:+908501234567">0850 123 45 67</a></p><a href="mailto:info@ornek.com">info@ornek.com</a>' });
    expect(r.ok).toBe(true);
    expect(r.hiddenEmailOnly).toBe(false);
  });

  it('semada iletisim ve duz metin telefon sayilir', () => {
    const s = contactSignals('<script type="application/ld+json">{"@graph":[{"@type":"Organization","contactPoint":{"telephone":"+90"}}]}</script><p>Bize ulaşın 0212 555 12 34</p>');
    expect(s.schemaContact).toBe(true);
    expect(s.phoneText).toBe(1);
  });

  it('link yoksa iletisim olsa da gecmez (sorumlu kurulus sayfasi yok)', () => {
    const r = assessTrustContact('<a href="tel:+905551112233">Ara</a>', base, null);
    expect(r.reachable).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.pageRead).toBeNull();
  });

  it('YMYL nisleri', () => {
    expect(isYmylNiche('finans')).toBe(true);
    expect(isYmylNiche('e-ticaret')).toBe(true);
    expect(isYmylNiche('turizm')).toBe(false);
    expect(isYmylNiche(null)).toBe(false);
  });
});

describe('Otorite sutunu: iletisim kontrolu', () => {
  const scan = (check: Record<string, unknown> | null) => ({
    ranAt: '2026-11-24T10:00:00Z',
    levels: [{ id: 'l1', checks: check ? [check] : [] }],
  });

  it('YMYL disinda satir yok', () => {
    expect(trustContactCheck(scan({ id: 'trust-contact', ok: true }), 'turizm')).toBeNull();
  });

  it('olculmediyse puana girmez (unverified)', () => {
    expect(trustContactCheck(null, 'finans')?.unverified).toBe(true);
    expect(trustContactCheck(scan(null), 'finans')?.unverified).toBe(true);
  });

  it('tarama sonucunu okur', () => {
    const c = trustContactCheck(scan({ id: 'trust-contact', ok: false, statusText: 'e-posta gizli' }), 'finans');
    expect(c).toMatchObject({ id: 'trust-contact', ok: false });
    expect(c?.unverified).toBeUndefined();
    expect(c?.detail).toContain('e-posta gizli');
  });
});

describe('Google organik sira ve bilgi paneli (AI Bakisi istegiyle ayni yanit)', () => {
  const yanit = (items: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] });

  it('sitenin en iyi organik sirasini ve bilgi panelini okur', () => {
    const s = parseOrganicSignal(yanit([
      { type: 'ai_overview', markdown: 'x' },
      { type: 'organic', rank_group: 1, url: 'https://www.instagram.com/kobipratik/' },
      { type: 'knowledge_graph', title: 'KobiPratik' },
      { type: 'organic', rank_group: 4, url: 'https://www.kobipratik.com/pos' },
      { type: 'organic', rank_group: 2, url: 'https://kobipratik.com/' },
    ]), 'kobipratik.com');
    expect(s).toEqual({ rank: 2, knowledgePanel: 'KobiPratik' });
  });

  it('site sonuclarda yoksa rank null; benzer alan adi eslesmez', () => {
    const s = parseOrganicSignal(yanit([{ type: 'organic', rank_group: 1, url: 'https://kobipratik.com.evil.net/' }]), 'kobipratik.com');
    expect(s).toEqual({ rank: null, knowledgePanel: null });
  });

  it('hata yaniti → null (satira yazilmaz)', () => {
    expect(parseOrganicSignal({ status_code: 40200, tasks: [] }, 'x.com')).toBeNull();
    expect(parseOrganicSignal(yanit([]), 'x.com')).toBeNull();
  });

  it('satira yazilir ve son olcum gorunumune tasinir', () => {
    const rows = promptRunRows('s', 'p', null, new Date('2026-11-24'), [{
      provider: 'google_ai_overview',
      probe: { query: 'q', cited: false, brandMentioned: false, excerpt: 'AI Bakışı cevabı', googleOrganic: { rank: 3, knowledgePanel: null } },
    }]);
    expect(rows[0].googleOrganic).toEqual({ rank: 3, knowledgePanel: null });
    // Bilinen sinir: AI Bakisi cikmayan arama ('YOK:') satir olmaz, organik sira da yazilmaz
    expect(promptRunRows('s', 'p', null, new Date('2026-11-24'), [{
      provider: 'google_ai_overview',
      probe: { query: 'q', cited: false, brandMentioned: false, excerpt: 'YOK: Google bu aramada AI Bakışı göstermedi.', surfaceAbsent: true, googleOrganic: { rank: 3, knowledgePanel: null } },
    }])).toHaveLength(0);
    const v = buildLatestRun([{
      provider: 'google_ai_overview', date: new Date('2026-11-24'), createdAt: new Date(), cited: false, brandMentioned: false,
      brandInQuery: true, position: null, sentiment: null, excerpt: null, competitors: null, sources: null, sourcesVersion: null,
      googleOrganic: { rank: null, knowledgePanel: 'KobiPratik' },
    }, {
      provider: 'openai', date: new Date('2026-11-24'), createdAt: new Date(), cited: false, brandMentioned: false,
      brandInQuery: false, position: null, sentiment: null, excerpt: null, competitors: null, sources: null, sourcesVersion: null,
    }], { ownHost: 'kobipratik.com', competitors: [] }, {});
    expect(v.providers.find((p) => p.provider === 'google_ai_overview')?.googleOrganic).toEqual({ rank: null, knowledgePanel: 'KobiPratik' });
    expect(v.providers.find((p) => p.provider === 'openai')?.googleOrganic).toBeNull();
  });
});
