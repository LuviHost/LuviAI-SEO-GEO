import { describe, it, expect } from 'vitest';
import { buildClientReport, kontrolDurumu, ozetMetni, trTarih, trYuzde, AKSIYON_SINIRI } from './client-report-build.js';
import { mukellefGirdisi, bosGirdi, MUKELLEF_PROVIDERS } from './client-report.fixture.js';
import { AI_SKOR_YONTEMI } from './client-report-texts.js';
import { citationCounts } from '../audit/citation-score.js';
import type { MusteriRaporu } from './client-report.types.js';

/**
 * Musteri raporu derleyicisi.
 *
 * NEDEN VAR: rapor musteriye gider. Bu kod tabaninda tekrarlayan hata sinifi
 * "veri yokken sifir yazmak" (site-report.service Olculebilir notu); musteri
 * raporunda bu, olculmemis bir seyi olculmus gibi gostermek demek. Ozet metni
 * de LLM'siz olmali: ayni veri her zaman ayni cumle.
 */
const NOW = new Date('2026-10-22T10:00:00.000Z');

function build(g = mukellefGirdisi(), now = NOW): MusteriRaporu {
  return buildClientReport(g, now);
}

describe('buildClientReport — veri yokken uydurma yok', () => {
  it('hic veri olmayan sitede her bolum "olculemedi" + neden; KPI degerleri null (0 degil)', () => {
    const r = build(bosGirdi());
    expect(r.seo).toEqual({ olculemedi: true, neden: 'Site henüz taranmadı.' });
    expect(r.geo.olculemedi).toBe(true);
    expect(r.ai.olcum).toMatchObject({ olculemedi: true, neden: 'Henüz ölçülmedi' });
    expect(r.ai.anilmaOrani.olculemedi).toBe(true);
    expect(r.ai.sesPayi.olculemedi).toBe(true);
    expect(r.ai.rakipler.sesPayiListesi.olculemedi).toBe(true);
    // Takip kodu yok: "0 ziyaret" bir olcum degil
    expect(r.botlar).toEqual({ olculemedi: true, neden: expect.stringContaining('takip kodu kurulmamış') });
    const deger = Object.fromEntries(r.ozet.kpiler.map((k) => [k.anahtar, k.deger]));
    expect(deger).toEqual({ siteSkoru: null, aiGorunurluk: null, anilmaOrani: null, sesPayi: null, aiBot: null, yayinda: 0 });
    for (const k of r.ozet.kpiler.filter((x) => x.deger === null)) expect(k.sonek).toBeNull();
    expect(r.aksiyonlar).toEqual([]);
    expect(r.kaynaklar.tarama).toBeNull();
    expect(r.kaynaklar.aiOlcum).toBeNull();
    // Ozet de sayi uydurmaz
    expect(r.ozet.metin.join(' ')).not.toMatch(/\d+\/100/);
    expect(r.ozet.metin.length).toBeGreaterThanOrEqual(3);
  });

  it('tarama hic yok ama son deneme engellendiyse neden raporda yazar', () => {
    const r = build({ ...bosGirdi(), erisimEngeli: { reason: 'Cloudflare RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.' } });
    expect(r.seo).toEqual({ olculemedi: true, neden: expect.stringContaining('Cloudflare') });
    expect(r.ozet.metin[0]).toContain('taranamadı');
    expect(r.ozet.metin[0]).toContain('RanksUpBot');
  });

  it('taramadan sonra erisim engellendiyse eski skor GUNCEL diye verilmez', () => {
    const g = mukellefGirdisi();
    g.audit!.accessBlocked = { reason: 'Erişim engellendi (HTTP 403).', hint: 'İzin verin.', at: '2026-10-22T06:00:00Z' };
    const r = build(g);
    expect(r.seo.olculemedi).toBe(false);
    if (r.seo.olculemedi) return;
    expect(r.seo.siteSkoru).toBeNull();
    expect(r.seo.guncelDegil).toContain('22 Ekim 2026');
    expect(r.ozet.kpiler[0]).toMatchObject({ anahtar: 'siteSkoru', deger: null, ipucu: 'Güncel değil' });
    expect(r.ozet.metin[0]).toContain('güncel değil');
  });

  it('taramanin AI adimi atlandiysa (haftalik hak) ve kosum yoksa AI "olculmedi" + taramanin nedeni', () => {
    const g = mukellefGirdisi();
    g.aiKosum = null;
    g.aiManset = null;
    (g.audit!.checks as any).aiCitations = {
      id: 'ai_citations', score: null, providers: [],
      skipped: { code: 'WEEKLY_MEASUREMENT_LIMIT', message: 'Haftalık AI ölçüm hakkı kullanıldığı için bu taramada AI ölçümü yapılmadı.', nextAvailableAt: null },
    };
    const r = build(g);
    expect(r.ai.olcum).toEqual({ olculemedi: true, neden: expect.stringContaining('Haftalık AI ölçüm hakkı') });
    expect(r.ozet.kpiler.find((k) => k.anahtar === 'aiGorunurluk')).toMatchObject({ deger: null, ipucu: 'Henüz ölçülmedi' });
  });

  it('eski taramanin "score: 0, providers: []" kaydi olcum sayilmaz (0/100 gosterilmez)', () => {
    const g = mukellefGirdisi();
    g.aiKosum = null;
    g.aiManset = null;
    (g.audit!.checks as any).aiCitations = { id: 'ai_citations', score: 0, providers: [] };
    const r = build(g);
    expect(r.ai.olcum.olculemedi).toBe(true);
  });

  it('gorsel sayilari yontem v2 oncesi taramada uydurulmaz', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).image_alt.details = { totalImages: 40, withAlt: 10 };
    const r = build(g);
    if (r.seo.olculemedi) throw new Error('seo olculmeli');
    expect(r.seo.gorseller).toEqual({ olculemedi: true, neden: expect.stringContaining('yeniden tarama') });
  });

  it('dogrulanamayan kontrol skora/sayaca "gecti" ya da "yok" diye girmez', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).llms_txt = {
      id: 'llms_txt', name: 'LLMs.txt (AI search)', found: false, valid: false, score: 0, issues: [],
      details: { unverified: true, unverifiedReason: 'llms.txt doğrulanamadı: sunucu 503 döndü.', unverifiedHint: null },
    };
    const r = build(g);
    if (r.seo.olculemedi || r.geo.olculemedi) throw new Error('olculmeli');
    const k = r.seo.kontroller.find((x) => x.id === 'llms_txt')!;
    expect(k).toMatchObject({ durum: 'dogrulanamadi', skor: null, otomatik: false });
    expect(k.bulgu).toContain('503');
    expect(r.seo.sayac.dogrulanamadi).toBe(1);
    expect(r.geo.llmsTxt).toBe('dogrulanamadi');
  });
});

describe('buildClientReport — musteri paneli bicimindeki site', () => {
  const r = build();
  if (r.seo.olculemedi || r.geo.olculemedi || r.ai.olcum.olculemedi) throw new Error('fikstur tam olmali');
  const seo = r.seo;
  const geo = r.geo;
  const olcum = r.ai.olcum;

  it('KPI seridi panel ile ayni sayilar: 76/100, 15 sorun, AI 17 ilk olcum, anilma/ses payi olculmedi, bot 0, yayinda 0 + 5 takvimde', () => {
    expect(r.ozet.kpiler).toEqual([
      { anahtar: 'siteSkoru', etiket: 'Site skoru', deger: 76, sonek: '/100', ipucu: '15 sorun' },
      { anahtar: 'aiGorunurluk', etiket: 'AI görünürlük', deger: 17, sonek: '/100', ipucu: 'İlk ölçüm' },
      { anahtar: 'anilmaOrani', etiket: 'Anılma oranı (markasız)', deger: null, sonek: null, ipucu: 'Henüz ölçülmedi' },
      { anahtar: 'sesPayi', etiket: 'Ses payı', deger: null, sonek: null, ipucu: 'Henüz ölçülmedi' },
      { anahtar: 'aiBot', etiket: 'AI bot ziyareti', deger: 0, sonek: null, ipucu: 'Son 7 gün' },
      { anahtar: 'yayinda', etiket: 'Yayında', deger: 0, sonek: null, ipucu: '5 içerik takvimde' },
    ]);
  });

  it('kontroller: kritik once, her birinde Turkce ad + neden + oneri; sayac 14 kontrol', () => {
    expect(seo.sayac).toEqual({ gecti: 4, kritik: 2, uyari: 8, dogrulanamadi: 0, toplam: 14 });
    expect(seo.kontroller.slice(0, 2).map((k) => k.id).sort()).toEqual(['h1_uniqueness', 'meta_description']);
    expect(seo.kontroller.at(-1)!.durum).toBe('gecti');
    for (const k of seo.kontroller) {
      expect(k.ad).not.toMatch(/Uniqueness|Image alt text|Internal Linking/);
      expect(k.neden.length).toBeGreaterThan(20);
      expect(k.oneri.length).toBeGreaterThan(10);
    }
    // llms.txt yalniz kok dosya: RanksUp otomatik yazabilir; meta aciklama yazamaz
    expect(seo.kontroller.find((k) => k.id === 'llms_txt')!.otomatik).toBe(true);
    expect(seo.kontroller.find((k) => k.id === 'meta_description')!.otomatik).toBe(false);
    expect(seo.bulgu).toEqual({ toplam: 15, kritik: 2, uyari: 10, bilgi: 3 });
  });

  it('sayfa sorunlari: sayilar taramadan, en fazla 10 ornek; ornek yoksa durust not', () => {
    const byTur = Object.fromEntries(seo.sayfaSorunlari.map((s) => [s.tur, s]));
    expect(byTur.meta_desc_missing).toMatchObject({ sayi: 9, birim: 'sayfa', onem: 'kritik', ornekNotu: null });
    expect(byTur.meta_desc_missing.ornekler).toHaveLength(9);
    expect(byTur.h1_missing).toMatchObject({ sayi: 24, ornekler: [] });
    expect(byTur.h1_missing.ornekNotu).toContain('bir sonraki taramada');
    expect(byTur.image_alt_missing).toMatchObject({ sayi: 772, birim: 'görsel' });
    expect(byTur.image_alt_missing.ornekler).toHaveLength(10);
    // details sayiyi tutmuyor: taramanin kendi aciklamasindaki sayi, 5 ornek
    expect(byTur.orphan_pages).toMatchObject({ sayi: 7 });
    expect(byTur.orphan_pages.ornekler).toHaveLength(5);
    expect(byTur.meta_desc_short.ornekNotu).toContain('adresi kaydetmiyor');
    // Kritikler en ustte
    expect(seo.sayfaSorunlari.slice(0, 2).map((s) => s.onem)).toEqual(['kritik', 'kritik']);
  });

  it('yeni taramada H1 eksik sayfa adresleri ornek olarak gelir (missingH1Pages)', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).h1_uniqueness.details.missingH1Pages = Array.from({ length: 24 }, (_, i) => `https://mukellef.co/s${i}`);
    const r2 = build(g);
    if (r2.seo.olculemedi) throw new Error('seo');
    const h1 = r2.seo.sayfaSorunlari.find((s) => s.tur === 'h1_missing')!;
    expect(h1.ornekler).toHaveLength(10);
    expect(h1.ornekNotu).toBeNull();
  });

  it('gorseller ve GEO sinyalleri taramadan', () => {
    expect(seo.gorseller).toEqual({
      olculemedi: false, icerikGorseli: 1040, altMetniYok: 772, altMetniVar: 241, susGorseli: 27, supheli: 0, sayfaSayisi: 48, duzeltilen: 0,
    });
    expect(geo.llmsTxt).toBe('yok');
    expect(geo.sitemap).toBe('var');
    expect(geo.robots).toMatchObject({ olculemedi: false, dosya: true, sitemapSatiri: true });
    if (!geo.robots.olculemedi) expect(geo.robots.aramaBotlari.every((b) => b.erisim === 'acik')).toBe(true);
    expect(geo.schema).toEqual({ olculemedi: false, sayfa: 12, toplam: 48, oran: 25 });
    expect(geo.sinyaller.find((s) => s.id === 'faq_qa')).toEqual({ id: 'faq_qa', ad: 'SSS / soru-cevap biçimi', skor: 12 });
    expect(geo.ajanHazirligi).toEqual({ olculemedi: true, neden: 'Henüz ölçülmedi' });
  });

  it('AI: yapilandirilmamis asistan listelenmez; markali soru isaretli; sonuclar outcomeOf ile', () => {
    expect(olcum.asistanlar.map((a) => a.saglayici)).toEqual(['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek']);
    expect(olcum.asistanlar[0]).toMatchObject({ skor: 50, sonuc: 'alinti', alintiSayisi: 1, anilmaSayisi: 1, olculenSoru: 3 });
    expect(olcum.asistanlar[1]).toMatchObject({ skor: 50, sonuc: 'anilma', alintiSayisi: 0, anilmaSayisi: 3 });
    expect(olcum.asistanlar[2]).toMatchObject({ skor: 0, sonuc: 'yok' });
    expect(olcum.sorgular).toHaveLength(4);
    const markali = olcum.sorgular.find((q) => q.markali)!;
    expect(markali.soru).toContain('Mükellef');
    expect(olcum.sorgular[0].sonuclar).toEqual(['alinti', 'anilma', 'yok', 'yok', 'yok', 'yok']);
    expect(olcum).toMatchObject({ skor: 17, skorTuru: 'first-run', tarih: '2026-10-21T09:14:00.000Z' });
  });

  it('hata veren asistan "olculemedi" — ham saglayici hatasi rapora yazilmaz', () => {
    const g = mukellefGirdisi();
    g.aiKosum = {
      runAt: '2026-10-21T09:14:00.000Z',
      providers: [
        ...MUKELLEF_PROVIDERS.slice(0, 1),
        { provider: 'anthropic', label: 'Anthropic Claude', available: false, score: null, reason: 'HATA: 429 rate_limit sk-ant-xxx', probes: [{ query: 'x', cited: false, brandMentioned: false, excerpt: 'HATA: 429' }] },
      ],
    };
    const r2 = build(g);
    if (r2.ai.olcum.olculemedi) throw new Error('olculmeli');
    const claude = r2.ai.olcum.asistanlar.find((a) => a.saglayici === 'anthropic')!;
    expect(claude).toMatchObject({ sonuc: 'olculemedi', skor: null });
    expect(JSON.stringify(r2)).not.toContain('sk-ant');
    expect(JSON.stringify(r2)).not.toContain('429');
  });

  it('manset yoksa (30 gunden eski kosum) skor son kosumun asistan ortalamasi: "son-olcum"', () => {
    const g = mukellefGirdisi();
    g.aiManset = null;
    const r2 = build(g);
    if (r2.ai.olcum.olculemedi) throw new Error('olculmeli');
    expect(r2.ai.olcum).toMatchObject({ skor: 17, skorTuru: 'son-olcum' });
  });
});

describe('AI skor yontemi notu — citation-score formuluyle ayni', () => {
  it('URL alintisi 100, yalniz marka adi 50, hicbiri 0; markali ve hatali soru disarida', () => {
    const c = citationCounts([
      { cited: true, brandMentioned: true },
      { cited: false, brandMentioned: true },
      { cited: false, brandMentioned: false },
      { cited: true, brandMentioned: true, brandInQuery: true },
      { cited: false, brandMentioned: false, excerpt: 'HATA: 500' },
    ]);
    expect(c.score).toBe(50); // (100 + 50 + 0) / 3
    expect(AI_SKOR_YONTEMI).toContain('kaynak olarak gösterilirse 100');
    expect(AI_SKOR_YONTEMI).toContain('yalnız marka adı geçerse 50');
    expect(AI_SKOR_YONTEMI).toContain('0 puan');
    expect(AI_SKOR_YONTEMI).toContain('Marka adını içeren sorular ve hata veren');
  });
});

describe('ozet metni — deterministik sablon', () => {
  it('ayni veri ayni metin; rapor saati metni degistirmez', () => {
    const a = build(mukellefGirdisi(), NOW).ozet.metin;
    const b = build(mukellefGirdisi(), new Date('2027-03-01T00:00:00Z')).ozet.metin;
    expect(b).toEqual(a);
  });

  it('beklenen cumleler (3-5 cumle, olculmeyen "olculmedi" diye)', () => {
    expect(build().ozet.metin).toEqual([
      'Mükellef için 21 Ekim 2026 tarihli taramada site skoru 76/100 (geliştirilmeye açık). 14 kontrolün 4 tanesi geçti; 2 kontrolde kritik, 8 kontrolde uyarı düzeyinde sorun var.',
      'Öne çıkan sayfa sorunları: 24 sayfada H1 başlığı yok, 9 sayfada meta açıklama yok, 772 görselde alt metni yok.',
      'AI hazırlığı: llms.txt yok; robots.txt AI arama botlarına açık; yapısal veri kapsamı %25.',
      'AI görünürlük skoru 17/100 (ilk ölçüm): 21 Ekim 2026 ölçümünde 6 AI asistanının 2 tanesinde site kaynak gösterildi ya da marka adı geçti. Anılma oranı ve ses payı henüz ölçülmedi.',
      'Öncelikli ilk adım: Eksik meta açıklamaları yazın.',
    ]);
  });

  it('robots AI arama botunu engelliyorsa bot adlariyla soyler', () => {
    const g = mukellefGirdisi();
    (g.audit!.checks as any).robots_txt.details.searchBots = [{ name: 'OAI-SearchBot', effective: 'block' }, { name: 'PerplexityBot', effective: 'allow' }];
    expect(build(g).ozet.metin[2]).toContain('şu AI arama botlarını engelliyor: OAI-SearchBot');
  });

  it('ozetMetni yalniz govdeden okur (saf)', () => {
    const r = build();
    const govde: Omit<MusteriRaporu, 'ozet'> & { ozet?: unknown } = { ...r };
    delete govde.ozet;
    expect(ozetMetni(govde)).toEqual(r.ozet.metin);
  });
});

describe('aksiyonlar', () => {
  it('plan maddeleri (todo/in_progress) + taramadan turetilen; planda olan bulgu tekrar turetilmez; en fazla 10', () => {
    const g = mukellefGirdisi();
    g.aksiyonPlani = [
      { title: 'Meta açıklamaları yazılacak (ajans)', description: null, impact: 'high', effort: 'easy', status: 'in_progress', source: 'audit', sourceRef: 'meta_description' },
      { title: 'Bitti', description: null, impact: 'high', effort: 'easy', status: 'done', source: 'manual', sourceRef: null },
      { title: 'Reddedildi', description: null, impact: 'high', effort: 'easy', status: 'dismissed', source: 'manual', sourceRef: null },
    ];
    const r = build(g);
    expect(r.aksiyonlar.length).toBeLessThanOrEqual(AKSIYON_SINIRI);
    expect(r.aksiyonlar[0]).toMatchObject({ baslik: 'Meta açıklamaları yazılacak (ajans)', etki: 'yuksek', efor: 'kolay', kaynak: 'plan', durum: 'in_progress' });
    expect(r.aksiyonlar.map((a) => a.baslik)).not.toContain('Eksik meta açıklamaları yazın');
    expect(r.aksiyonlar.map((a) => a.baslik)).not.toContain('Bitti');
    expect(r.aksiyonlar.map((a) => a.baslik)).not.toContain('Reddedildi');
  });

  it('turetilen aksiyonlar: kritik bulgu yuksek etki; bilgi duzeyi bulgu aksiyon olmaz; pagespeed tek madde', () => {
    const r = build();
    const t = r.aksiyonlar.filter((a) => a.kaynak === 'tarama');
    expect(t.slice(0, 2).every((a) => a.etki === 'yuksek')).toBe(true);
    expect(t.map((a) => a.baslik)).not.toContain('Şablona X (Twitter) kartı etiketini ekleyin'); // yalniz info
    expect(t.filter((a) => a.baslik === 'Sayfa hızını iyileştirin')).toHaveLength(1);
    // Siralama: etki, sonra efor (kolay once)
    const orta = t.filter((a) => a.etki === 'orta');
    expect(orta[0].efor).toBe('kolay');
  });
});

/**
 * NEDEN: taramanin "AI arama gorunurlugu dusuk (20/100)" bulgusu taramanin
 * kendi AI adiminin skorunu tasir. Taramadan sonra daha yeni AI olcumu varsa
 * manset baska sayi (17/100) yazar ve ayni belgede iki AI skoru celisir
 * (mukellef.co uretim raporu, 22.10.2026). Aksiyon sayisi mansetten gelmeli.
 */
describe('aksiyonlar — AI gorunurluk sayisi mansetle celismez', () => {
  const aiBulgusu = (skor: number) => ({
    severity: 'warning', type: 'ai_citation_low', checkId: 'ai_citation', fixable: true,
    description: `AI arama görünürlüğü düşük (${skor}/100): AI asistanlarının marka adı geçmeyen sorulara verdiği yanıtlarda siten nadiren kaynak gösteriliyor ya da anılıyor.`,
  });
  const aiAksiyonu = (r: MusteriRaporu) => r.aksiyonlar.find((a) => a.baslik === 'AI asistanlarının alıntılayacağı soru-cevap içerikleri yayınlayın');
  const girdi = (bulguSkoru: number) => {
    const g = mukellefGirdisi();
    // Aksiyon siniri (10) AI maddesini kesmesin: yalniz kritikler + AI bulgusu
    g.audit!.issues = [...(g.audit!.issues as Array<{ severity: string }>).filter((i) => i.severity === 'critical'), aiBulgusu(bulguSkoru)];
    return g;
  };

  it('tarama bulgusu 20/100, daha yeni olcum (manset) 17/100 → aksiyon 17 der, 20 demez', () => {
    const r = build(girdi(20));
    expect(r.ai.olcum).toMatchObject({ olculemedi: false, skor: 17 });
    const a = aiAksiyonu(r);
    expect(a).toBeDefined();
    expect(a!.aciklama).toContain('17/100');
    expect(a!.aciklama).not.toContain('20/100');
    // Belgenin hicbir yerinde mansetten farkli bir AI skoru gecmez
    expect(JSON.stringify(r)).not.toContain('20/100');
  });

  it('manset artik dusuk degilse (>= 30) eskimis "dusuk" aksiyonu cikmaz', () => {
    const g = girdi(20);
    g.aiManset = { score: 45, method: 'rolling' };
    expect(aiAksiyonu(build(g))).toBeUndefined();
  });

  it('AI olcumu yoksa aksiyon sayi yazmaz', () => {
    const g = girdi(20);
    g.aiManset = null;
    g.aiKosum = null;
    delete (g.audit!.checks as Record<string, unknown>).aiCitations;
    const r = build(g);
    expect(r.ai.olcum.olculemedi).toBe(true);
    const a = aiAksiyonu(r);
    expect(a).toBeDefined();
    expect(a!.aciklama).not.toMatch(/\d+\/100/);
  });
});

describe('kucuk yardimcilar', () => {
  it('trTarih Istanbul saatine gore (UTC 22:30 → ertesi gun)', () => {
    expect(trTarih('2026-10-21T22:30:00Z')).toBe('22 Ekim 2026');
    expect(trTarih('2026-02-01T08:00:00Z')).toBe('1 Şubat 2026');
  });
  it('trYuzde Turkce bicim', () => {
    expect(trYuzde(33.333)).toBe('%33,3');
    expect(trYuzde(25)).toBe('%25');
  });
  it('kontrolDurumu: found+valid gecti; kritik sorun kritik; yalniz bilgi sorunlu basarisiz kontrol uyari', () => {
    expect(kontrolDurumu({ found: true, valid: true, issues: [] })).toBe('gecti');
    expect(kontrolDurumu({ found: false, valid: false, issues: [{ severity: 'critical' }] })).toBe('kritik');
    expect(kontrolDurumu({ found: false, valid: false, issues: [{ severity: 'info' }] })).toBe('uyari');
  });
});
