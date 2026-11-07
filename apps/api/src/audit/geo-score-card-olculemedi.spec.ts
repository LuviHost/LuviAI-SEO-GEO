import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { GeoScoreCardService, weightedOverall, gradeOf } = await import('./geo-score-card.service.js');

/**
 * GEO skor karti — OLCULEMEYEN sutunlar.
 *
 * NEDEN VAR: Tazelik ve Multi-Modal yalniz RanksUp'in yayinladigi makalelere
 * bakar; Yapisal Veri makale kapsamina ve ana sayfadaki Organization semasina
 * (Agent Readiness taramasi). Blogunu baska yerden yoneten gercek bir site
 * (RanksUp'tan 0 yayin) bu sutunlarda sahte sifir aliyor, kart F'ye dusuyordu.
 * AI Citation da son 9 gunde olcum yokken 0 veriyordu. Olculemeyen sutun artik
 * null + neden; genel skor yalniz olculen sutunlarin agirlikli ortalamasi.
 */

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

type ArticleRow = {
  id: string; siteId: string; status: string; publishedAt: Date | null; publishedTo: unknown;
  schemaMarkup: unknown; heroImageUrl: string | null; frontmatter: unknown;
};

// Tarih kosulu { gte?, lte? } SQL anlamiyla; bilinmeyen suzgec hata verir (sahte gecis olmasin)
const dateOk = (v: Date | null, cond: Record<string, Date>) => Object.entries(cond).every(([op, b]) => {
  if (op !== 'gte' && op !== 'lte') throw new Error(`desteklenmeyen tarih kosulu: ${op}`);
  if (v === null) return false;
  return op === 'gte' ? v.getTime() >= b.getTime() : v.getTime() <= b.getTime();
});
const matches = (r: ArticleRow, where: Record<string, any>) => Object.entries(where).every(([k, c]) => {
  if (k === 'siteId') return r.siteId === c;
  if (k === 'status') return r.status === c;
  if (k === 'publishedAt') return dateOk(r.publishedAt, c);
  throw new Error(`desteklenmeyen suzgec: ${k}`);
});

/** build() icin tam bellek ici prisma: tum sutunlar ayni veriden okur */
function kart(opts: {
  articles?: ArticleRow[];
  snapshots?: Array<{ provider: string; score: number | null; available: boolean }>;
  audit?: any;
  site?: any;
  /** Son Agent Readiness taramasi (Organization semasi) — yoksa null */
  scan?: any;
} = {}) {
  const rows = opts.articles ?? [];
  const prisma = {
    audit: { findFirst: vi.fn(async () => opts.audit ?? null) },
    kvStore: { findUnique: vi.fn(async () => null) },
    site: { findUniqueOrThrow: vi.fn(async () => opts.site ?? { brain: null, llmsFullTxt: null }) },
    aiCitationSnapshot: { findMany: vi.fn(async () => opts.snapshots ?? []) },
    agentReadinessScan: { findFirst: vi.fn(async () => opts.scan ?? null) },
    article: {
      count: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).length),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
    },
  };
  return new GeoScoreCardService(prisma as any);
}

const article = (i: number, over: Partial<ArticleRow> = {}): ArticleRow => ({
  id: `a${i}`, siteId: 's1', status: 'PUBLISHED', publishedAt: ago(5), publishedTo: [],
  schemaMarkup: { types: ['Article', 'FAQPage', 'BreadcrumbList', 'Organization', 'HowTo'] },
  heroImageUrl: 'https://cdn.ornek.com/hero.webp', frontmatter: {}, ...over,
});

// Denetimde robots (kritik botlar acik, yontem v3) + sitemap var, llms.txt yok
const KRITIK = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User'];
const AUDIT = {
  ranAt: ago(1),
  checks: {
    robots_txt: { found: true, score: 100, details: { methodVersion: 3, searchBots: KRITIK.map((name) => ({ name, effective: 'allow' })) } },
    llms_txt: { found: false },
    sitemap_xml: { found: true },
  },
};
// Ana sayfada Organization + 2 sameAs (Agent Readiness 'org-schema')
const SCAN = {
  ranAt: ago(3),
  levels: [{ id: 'groundwork', checks: [{ id: 'org-schema', ok: true, state: 'pass', statusText: 'Organization schema var, 2 sameAs profili', audit: [{ step: 'PARSE', ok: true }] }] }],
};
const SITE = {
  llmsFullTxt: '# ornek.com', llmsFullTxtAt: ago(2),
  brain: { competitors: [{}, {}, {}] }, gscConnectedAt: null, socialProfiles: ['https://x.com/ornek', 'https://linkedin.com/ornek'],
};
const SNAPS = [
  { provider: 'openai', score: 40, available: true },
  { provider: 'gemini', score: 10, available: true },
  { provider: 'anthropic', score: 35, available: true },
];
const MAKALELER = [
  article(1, { publishedAt: ago(3) }),
  article(2, { publishedAt: ago(12), heroImageUrl: null }),
  article(3, { publishedAt: ago(120), schemaMarkup: null }),
];

const BEKLENEN_NEDEN = "RanksUp'tan yayınlanmış makale yok — bu sütun yalnız RanksUp'ın yayınladığı yazılara bakar";
const YAPISAL_NEDEN = "RanksUp'tan yayınlanmış makale yok ve ana sayfadaki Organization şeması henüz ölçülmedi (Agent Readiness taraması)";

describe('GeoScoreCard — makale varken tum sutunlar olculur (08.11.2026 olcutleri)', () => {
  it('sutun puanlari, genel skor ve not', async () => {
    const c = await kart({ articles: MAKALELER, snapshots: SNAPS, audit: AUDIT, site: SITE, scan: SCAN }).build('s1');
    const puan = Object.fromEntries(c.pillars.map((p) => [p.id, p.score]));
    expect(puan).toEqual({
      // Crawler: kritik botlar + sitemap (llms.txt / llms-full.txt yok) → 2/2
      'crawler-access': 100,
      // Yapisal: kapsama 2/3 (< %80) gecmez, Organization var → 1/2
      'structured-data': 50,
      'ai-citation': 67,
      authority: 67,
      // Tazelik: 3/3 makale son 12 ayda → 1/1 (yayin sikligi esigi yok)
      freshness: 100,
      'multi-modal': 0,
    });
    // (100*3 + 50*3 + 67*3 + 67*2 + 100*2 + 0*1) / 14 = 985/14 = 70.4 → 70
    expect(c.overallScore).toBe(70);
    expect(c.grade).toBe('B');
    expect(c.pillars.every((p) => p.unmeasuredReason === undefined)).toBe(true);
    expect(c.measuredWeight).toBe(14);
    expect(c.totalWeight).toBe(14);
  });
});

describe('GeoScoreCard — RanksUp makalesi yoksa makale sutunlari olculemedi', () => {
  it('Yapisal Veri (tarama da yoksa), Tazelik, Multi-Modal null + neden; ortalamaya girmez', async () => {
    const c = await kart({ articles: [], snapshots: SNAPS, audit: AUDIT, site: SITE }).build('s1');
    for (const id of ['freshness', 'multi-modal']) {
      const p = c.pillars.find((x) => x.id === id)!;
      expect(p, id).toMatchObject({ score: null, status: 'unmeasured', unmeasuredReason: BEKLENEN_NEDEN, checks: [] });
    }
    expect(c.pillars.find((x) => x.id === 'structured-data')).toMatchObject({ score: null, status: 'unmeasured', unmeasuredReason: YAPISAL_NEDEN, checks: [] });
    // Olculen: crawler 100 (w3), AI 67 (w3), otorite 67 (w2) → (300+201+134)/8 = 79.4 → 79
    expect(c.overallScore).toBe(79);
    expect(c.grade).toBe('B');
    expect(c.measuredWeight).toBe(8);
    expect(c.totalWeight).toBe(14);
    // Sutun sirasi sabit
    expect(c.pillars.map((p) => p.id)).toEqual(['crawler-access', 'structured-data', 'ai-citation', 'authority', 'freshness', 'multi-modal']);
  });

  it('olculemeyen sutun icin "0/0 makale" tavsiyesi yok; en fazla bir notr not', async () => {
    const c = await kart({ articles: [], snapshots: SNAPS, audit: AUDIT, site: SITE }).build('s1');
    expect(c.recommendations.join('\n')).not.toMatch(/0\/0|Henüz yayınlanmış makale yok|Yapısal Veri\]|Tazelik\]|Multi-Modal\]/);
    const notlar = c.recommendations.filter((r) => r.includes('ölçülmedi'));
    expect(notlar).toHaveLength(1);
    expect(notlar[0]).toContain('Yapısal Veri, Tazelik, Multi-Modal');
  });

  it('baska sitenin ya da yayinda olmayan makalesi sayilmaz', async () => {
    const c = await kart({
      articles: [article(1, { siteId: 's2' }), article(2, { status: 'READY_TO_PUBLISH' })],
      snapshots: SNAPS, audit: AUDIT, site: SITE,
    }).build('s1');
    expect(c.pillars.filter((p) => p.score === null).map((p) => p.id)).toEqual(['structured-data', 'freshness', 'multi-modal']);
  });

  it('tek yayinda makale yeterli: sutunlar yine olculur', async () => {
    const c = await kart({ articles: [article(1, { publishedAt: ago(200) })], snapshots: SNAPS, audit: AUDIT, site: SITE }).build('s1');
    expect(c.pillars.every((p) => p.score !== null)).toBe(true);
    // Tazelik: 200 gunluk yazi 12 ay icinde → 100 (eskiden 30/7 gun esikleri yuzunden 33)
    expect(c.pillars.find((p) => p.id === 'freshness')!.score).toBe(100);
    // 13 aylik yazi taze degil
    const eski = await kart({ articles: [article(1, { publishedAt: ago(400) })], snapshots: SNAPS, audit: AUDIT, site: SITE }).build('s1');
    expect(eski.pillars.find((p) => p.id === 'freshness')!.score).toBe(0);
  });

  it('makale yok ama Organization olculdu: Yapisal Veri yalniz o satirla olculur', async () => {
    const c = await kart({ articles: [], snapshots: SNAPS, audit: AUDIT, site: SITE, scan: SCAN }).build('s1');
    const p = c.pillars.find((x) => x.id === 'structured-data')!;
    expect(p.score).toBe(100);
    expect(p.checks.find((x) => x.id === 'schema-coverage')).toMatchObject({ unverified: true, detail: BEKLENEN_NEDEN });
  });
});

describe('GeoScoreCard — AI Citation olcumu yoksa olculemedi', () => {
  it('pencerede snapshot yok → null + neden; puana girmez', async () => {
    const c = await kart({ articles: MAKALELER, snapshots: [], audit: AUDIT, site: SITE, scan: SCAN }).build('s1');
    const p = c.pillars.find((x) => x.id === 'ai-citation')!;
    expect(p).toMatchObject({
      score: null, status: 'unmeasured',
      unmeasuredReason: "Son 9 günde AI ölçümü yok — AI Görünürlük'te Yeniden Test ile ölçülür",
    });
    // (100*3 + 50*3 + 67*2 + 100*2 + 0*1) / 11 = 784/11 = 71.3 → 71
    expect(c.overallScore).toBe(71);
    expect(c.measuredWeight).toBe(11);
  });

  it('yalniz olcum alinamayan (available=false) snapshot da olcum sayilmaz', async () => {
    const c = await kart({ articles: MAKALELER, snapshots: [{ provider: 'meta', score: null, available: false }], audit: AUDIT, site: SITE }).build('s1');
    expect(c.pillars.find((x) => x.id === 'ai-citation')!.score).toBeNull();
  });
});

describe('GeoScoreCard — agirlik yeniden dagitimi', () => {
  it('weightedOverall: null sutun paydadan cikar; tumu olculuyse eski formul', () => {
    expect(weightedOverall([{ weight: 3, score: 100 }, { weight: 1, score: 0 }])).toEqual({ overallScore: 75, measuredWeight: 4, totalWeight: 4 });
    expect(weightedOverall([{ weight: 3, score: 100 }, { weight: 1, score: null }])).toEqual({ overallScore: 100, measuredWeight: 3, totalWeight: 4 });
    // (80*2 + 40*1) / 3 = 66.7 → 67; 3 agirlikli null sutun 0 sayilsa 200/6 = 33 olurdu
    expect(weightedOverall([{ weight: 2, score: 80 }, { weight: 1, score: 40 }, { weight: 3, score: null }]).overallScore).toBe(67);
    expect(weightedOverall([{ weight: 2, score: null }, { weight: 1, score: null }])).toEqual({ overallScore: null, measuredWeight: 0, totalWeight: 3 });
    expect(gradeOf(90)).toBe('A+');
    expect(gradeOf(49)).toBe('F');
  });

  it('genel skor yalniz olculen sutunlarin agirlikli ortalamasi', async () => {
    // Makale yok + AI olcumu yok: yalniz crawler (w3) + otorite (w2)
    const c = await kart({ articles: [], snapshots: [], audit: AUDIT, site: SITE }).build('s1');
    expect(c.pillars.filter((p) => p.score !== null).map((p) => p.id)).toEqual(['crawler-access', 'authority']);
    // (100*3 + 67*2) / 5 = 434/5 = 86.8 → 87
    expect(c.overallScore).toBe(87);
    expect(c.grade).toBe('A');
    expect(c.measuredWeight).toBe(5);
  });

  it('tum sutunlar olculemezse genel skor ve not null (0 degil)', async () => {
    const svc = kart() as any;
    const bos = (id: string, weight: number) => ({
      id, name: id, weight, score: null, status: 'unmeasured', unmeasuredReason: 'test', checks: [],
    });
    for (const [m, id, w] of [
      ['checkCrawlerAccess', 'crawler-access', 3], ['checkStructuredData', 'structured-data', 3],
      ['checkAiCitation', 'ai-citation', 3], ['checkAuthority', 'authority', 2],
      ['checkFreshness', 'freshness', 2], ['checkMultiModal', 'multi-modal', 1],
    ] as const) svc[m] = vi.fn(async () => bos(id, w));
    const c = await svc.build('s1');
    expect(c.overallScore).toBeNull();
    expect(c.grade).toBeNull();
    expect(c.measuredWeight).toBe(0);
    expect(c.recommendations.filter((r: string) => r.includes('ölçülmedi'))).toHaveLength(1);
  });
});
