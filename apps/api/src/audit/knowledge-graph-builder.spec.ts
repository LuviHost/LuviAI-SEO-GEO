import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { KnowledgeGraphBuilderService, WIKIPEDIA_ARTICLE_WIZARD_URL, NOTABILITY_MAX } = await import('./knowledge-graph-builder.service.js');

/**
 * Wikidata / Vikipedi taslaklari — musteriye gosterilen her alan dogru olmali.
 *
 * NEDEN VAR: (1) submitUrl, trwiki'de var olmayan "Vikipedi:Hızlı_silmeye_aday_göster"
 * (hizli silme adayligi) sayfasini gosteriyordu; (2) on kontrol "Site 1+ yıldır
 * aktif" diyordu ama site.createdAt sitenin RanksUp'a eklendigi tarih;
 * (3) descriptions.en ceviri degil, Turkce metnin kesilmis haliydi.
 */

const DAY = 86_400_000;

function site(over: Record<string, unknown> = {}) {
  return {
    id: 's1', name: 'Lavanta Kuaför', url: 'https://lavantakuafor.com/', niche: 'kuaför', language: 'tr',
    createdAt: new Date(Date.now() - 3 * 365 * DAY), socialProfiles: null,
    brain: {
      brandVoice: { summary: 'Lavanta Kuaför, Kadıköy\'de saç kesimi ve boya hizmeti veren bir salondur.' },
      competitors: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      seoStrategy: { pillars: [{ name: 'saç' }] },
    },
    ...over,
  };
}

function svc(s = site(), scan: unknown = null) {
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => s) },
    agentReadinessScan: { findFirst: vi.fn(async () => scan) },
  };
  return new KnowledgeGraphBuilderService(prisma as any);
}

/** Agent Readiness taramasi: yalniz 'org-schema' kontrolu (geo-score-card sameAsCheck okur) */
const tarama = (org: Record<string, unknown>) => ({
  ranAt: new Date('2026-10-13T04:15:00Z'),
  levels: [{ checks: [{ id: 'org-schema', ...org }] }],
});

describe('KnowledgeGraphBuilderService', () => {
  const backup = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => {
    if (backup === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = backup;
  });

  it('Wikidata: yalniz Turkce aciklama; Turkce metin "Ingilizce aciklama" diye konmaz', async () => {
    const d = await svc().buildWikidata('s1');
    expect(d.descriptions.tr.value).toContain('Kadıköy');
    expect(d.descriptions.en).toBeUndefined();
    expect(Object.keys(d.descriptions)).toEqual(['tr']);
    // Marka adi dilden bagimsiz: etiketler iki dilde de kalir
    expect(d.labels).toEqual({ tr: { language: 'tr', value: 'Lavanta Kuaför' }, en: { language: 'en', value: 'Lavanta Kuaför' } });
  });

  it('P31 (instance of): Wikidata\'da dogrulanmis kimlikler; eski yanlis kimlikler (cryptopine, park) yok', async () => {
    const p31 = async (niche: string | null) => (await svc(site({ niche })).buildWikidata('s1')).claims.find((c) => c.property === 'P31')!.value;
    expect(await p31('saas')).toBe('Q1058914 (software company)');
    expect(await p31('ajans')).toBe('Q216931 (advertising agency)');
    expect(await p31('e-ticaret')).toBe('Q4382945 (online shop)');
    expect(await p31('eğitim')).toBe('Q5341295 (educational organization)');
    expect(await p31('hosting')).toBe('Q4830453 (business)');
    expect(await p31('kuaför')).toBe('Q4830453 (business)');
    expect(await p31(null)).toBe('Q4830453 (business)');
    for (const n of ['saas', 'ajans', 'e-ticaret', 'hosting']) {
      expect(await p31(n)).not.toMatch(/Q1142307|Q791298|Q484847|web hosting service/);
    }
  });

  it('Wikidata yedek aciklamasi: "X bir company sirketidir." degil, kisa Turkce ifade', async () => {
    const brainsiz = { competitors: [], seoStrategy: {}, brandVoice: {} };
    const nisli = await svc(site({ brain: brainsiz })).buildWikidata('s1');
    expect(nisli.descriptions.tr.value).toBe('kuaför alanında faaliyet gösteren kuruluş');
    const nissiz = await svc(site({ brain: brainsiz, niche: null })).buildWikidata('s1');
    expect(nissiz.descriptions.tr.value).toBe('');
    expect(JSON.stringify(nissiz)).not.toMatch(/company|sirketidir/);
  });

  it('on kontrol: RanksUp\'a eklenme tarihi "site yasi" diye puanlanmaz', async () => {
    const eski = await svc(site({ createdAt: new Date(Date.now() - 3 * 365 * DAY) })).buildWikidata('s1');
    const yeni = await svc(site({ createdAt: new Date() })).buildWikidata('s1');
    expect(eski.notabilityScore).toBe(yeni.notabilityScore);
    for (const d of [eski, yeni]) {
      expect(d.notabilityNotes.join('\n')).not.toMatch(/yıldır aktif|gündür aktif|çok yeni/);
    }
    // site 10 + 3 rakip 15 + SEO stratejisi 10 (sosyal profil yok)
    expect(eski.notabilityScore).toBe(35);
    expect(eski.notabilityNotes.some((n) => n.includes('MANUEL KONTROL'))).toBe(true);
  });

  it('on kontrol en fazla 50: RanksUp\'in olcebildigi sinyallerin hepsi gecse de', async () => {
    const d = await svc(site({ socialProfiles: ['https://x.com/lavanta', 'https://instagram.com/lavanta'] })).buildWikidata('s1');
    expect(NOTABILITY_MAX).toBe(50);
    expect(d.notabilityScore).toBe(NOTABILITY_MAX);
    // Panel "puan/tavan" gosterir: tavan cevapta (iki taslakta da)
    expect(d.notabilityMax).toBe(NOTABILITY_MAX);
    expect((await svc().buildWikipedia('s1')).notabilityMax).toBe(NOTABILITY_MAX);
  });

  it('kimlik baglantilari GEO kartiyla ayni kanittan: ana sayfa Organization sameAs (Agent Readiness)', async () => {
    const gecti = await svc(site(), tarama({ ok: true, state: 'pass', statusText: 'HairSalon schema var, 3 sameAs profili' })).buildWikidata('s1');
    expect(gecti.notabilityScore).toBe(50);
    expect(gecti.notabilityNotes).toContain('✓ Kimlik bağlantıları (sameAs): Ana sayfa (2026-10-13 Agent Readiness taraması): HairSalon schema var, 3 sameAs profili');

    const eksik = await svc(site(), tarama({ ok: false, state: 'fail', statusText: 'Ana sayfada Organization (ya da alt türü, ör. LocalBusiness) schema yok' })).buildWikidata('s1');
    expect(eksik.notabilityScore).toBe(35);
    expect(eksik.notabilityNotes.find((n) => n.includes('sameAs'))).toMatch(/^⚠ .*en az 2 sameAs profili önerilir$/);

    // Tarama yok, eski veri yok: "henüz ölçülmedi" — RanksUp'ta uygulanamayan "Twitter/LinkedIn/Facebook ekle" onerisi yok
    const yok = await svc().buildWikidata('s1');
    const not = yok.notabilityNotes.find((n) => n.includes('sameAs'))!;
    expect(not).toMatch(/^⚠ .*henüz ölçülmedi/);
    expect(yok.notabilityNotes.join('\n')).not.toMatch(/Twitter\/LinkedIn\/Facebook ekle|notability/i);
  });

  it('tarama tablosu hatasi taslagi dusurmez', async () => {
    const prisma = {
      site: { findUniqueOrThrow: vi.fn(async () => site()) },
      agentReadinessScan: { findFirst: vi.fn(async () => { throw new Error('tablo yok'); }) },
    };
    const d = await new KnowledgeGraphBuilderService(prisma as any).buildWikidata('s1');
    expect(d.notabilityScore).toBe(35);
  });

  it('Vikipedi: kategori yalniz sektor — her markaya "internet şirketleri" eklenmez', async () => {
    const d = await svc().buildWikipedia('s1');
    expect(d.category).toEqual(["Türkiye'deki şirketler"]);
    expect(JSON.stringify(d)).not.toMatch(/internet şirketleri/);
  });

  it('Vikipedi: submitUrl Turkce madde sihirbazi; hizli silme sayfasi degil', async () => {
    const d = await svc().buildWikipedia('s1');
    expect(d.submitUrl).toBe(WIKIPEDIA_ARTICLE_WIZARD_URL);
    expect(decodeURIComponent(d.submitUrl)).toBe('https://tr.wikipedia.org/wiki/Vikipedi:Madde_sihirbazı');
    expect(decodeURIComponent(d.submitUrl)).not.toMatch(/silme/i);
    expect(d.notabilityNotes.join('\n')).not.toMatch(/yıldır aktif|gündür aktif|çok yeni/);
    // Anahtar yok: model cagrisi yok, sablon metin — dogrulanmamis "Türkiye merkezli ... şirketidir" yok
    expect(d.content).toContain("'''Lavanta Kuaför''' ([https://lavantakuafor.com resmî web sitesi]), [şehir] merkezli, kuaför alanında faaliyet gösteren bir kuruluştur.");
    expect(d.content).not.toMatch(/Türkiye merkezli|şirketidir/);
    const nissiz = await svc(site({ niche: null })).buildWikipedia('s1');
    expect(nissiz.content).not.toMatch(/sirket şirketidir|null|undefined/);
    expect(nissiz.content).toContain('[alan] alanında faaliyet gösteren');
  });
});
