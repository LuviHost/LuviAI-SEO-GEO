import { describe, it, expect } from 'vitest';
import {
  MAX_SUGGESTIONS, aggregateCompetitorVisibility, competitorVisibilityDays,
  type VisibilityInput, type VisibilityRun,
} from './competitor-visibility.js';
import { competitorNamesFrom, listedCompetitorsFrom, sourceHostsFrom } from './competitor-visibility.service.js';

/**
 * AI cevaplarinda rakip gorunurlugu (13.11.2026, ICM Turkey: "AI'larda hangi rakiplerimiz
 * gecti, hangileri on planda"). Kaynak: Prompt Lab'in kayitli cevaplari; yeni olcum yok.
 */
const run = (over: Partial<VisibilityRun> & Pick<VisibilityRun, 'promptId' | 'provider' | 'date'>): VisibilityRun => ({
  promptText: `soru ${over.promptId}`,
  brandMentioned: false,
  cited: false,
  competitors: [],
  sourceHosts: [],
  ...over,
});

const girdi = (over: Partial<VisibilityInput> = {}): VisibilityInput => ({
  days: 30,
  since: '2026-10-15',
  brand: 'ICM Turkey',
  ownHost: 'icmturkey.com',
  listed: [],
  runs: [],
  ...over,
});

const satir = (r: ReturnType<typeof aggregateCompetitorVisibility>, ad: string) => r.rows.find((x) => x.name === ad)!;

describe('guncel kume — (soru, asistan) cifti basina en yeni cevap', () => {
  it('eski cevap sayilmaz; ayni gun iki cevap varsa sonra yazilan gecer', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'Creatorden' }],
      runs: [
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-01', competitors: ['Creatorden'] }),
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', competitors: [] }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', createdAt: 1, competitors: [] }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', createdAt: 2, competitors: ['Creatorden'] }),
      ],
    }));
    expect(r.totals).toMatchObject({ answers: 2, questions: 1, providers: ['openai', 'xai'], lastMeasuredAt: '2026-11-11' });
    expect(satir(r, 'Creatorden')).toMatchObject({ answers: 1, questions: 1, providers: ['xai'] });
  });

  it('pencerede olculmemis soru guncel kumeye girmez', () => {
    const r = aggregateCompetitorVisibility(girdi({
      since: '2026-11-01',
      runs: [
        run({ promptId: 'eski', provider: 'openai', date: '2026-09-20', brandMentioned: true }),
        run({ promptId: 'yeni', provider: 'openai', date: '2026-11-05', brandMentioned: false }),
      ],
    }));
    expect(r.totals.answers).toBe(1);
    expect(satir(r, 'ICM Turkey').answers).toBe(0);
  });

  it('veri yokken: yalniz marka satiri, sifirlar, tarih yok', () => {
    const r = aggregateCompetitorVisibility(girdi());
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'ICM Turkey', isBrand: true, answers: 0, questions: 0, change: null });
    expect(r.totals).toMatchObject({ answers: 0, questions: 0, firstMeasuredAt: null, lastMeasuredAt: null, comparablePairs: 0 });
    expect(r.suggestions).toEqual([]);
  });
});

describe('satirlar — marka ve rakipler ayni tabloda', () => {
  const runs = [
    run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', competitors: ['Creatorden', 'Share'] }),
    run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', brandMentioned: true, cited: true, competitors: ['Creatorden'] }),
    run({ promptId: 'p2', provider: 'openai', date: '2026-11-11', competitors: ['Creatorden'] }),
    run({ promptId: 'p2', provider: 'xai', date: '2026-11-11', competitors: [] }),
  ];

  it('cevap sayisina gore siralanir; marka kendi sirasinda ve isaretli', () => {
    const r = aggregateCompetitorVisibility(girdi({ listed: [{ name: 'Creatorden' }, { name: 'Share' }, { name: 'Viralif' }], runs }));
    expect(r.rows.map((x) => [x.name, x.answers])).toEqual([['Creatorden', 3], ['ICM Turkey', 1], ['Share', 1], ['Viralif', 0]]);
    expect(satir(r, 'ICM Turkey').isBrand).toBe(true);
    expect(satir(r, 'Creatorden')).toMatchObject({ questions: 2, providers: ['openai', 'xai'], listed: true });
    expect(satir(r, 'Creatorden').byQuestion).toEqual([
      { promptId: 'p1', text: 'soru p1', providers: ['openai', 'xai'] },
      { promptId: 'p2', text: 'soru p2', providers: ['openai'] },
    ]);
  });

  it('listeye SONRADAN eklenen rakip gecmis olcumde sayilmaz (cevap metni saklanmiyor, uydurulmaz)', () => {
    const r = aggregateCompetitorVisibility(girdi({ listed: [{ name: 'TipEffect' }], runs }));
    expect(satir(r, 'TipEffect')).toMatchObject({ answers: 0, questions: 0, listed: true });
  });

  it('gecmiste anilmis ama listeden cikarilmis ad tabloda kalir (listed: false); marka adiyla ayni olan atlanir', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'icm turkey' }],
      runs: [run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', competitors: ['Creatorden', 'ICM Turkey'] })],
    }));
    expect(r.rows.map((x) => x.name).sort()).toEqual(['Creatorden', 'ICM Turkey']);
    expect(satir(r, 'Creatorden').listed).toBe(false);
  });

  it('buyuk / kucuk harf ve İ farki ayni rakibi iki satira bolmez', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'İddaa' }],
      runs: [
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', competitors: ['iddaa'] }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', competitors: ['İDDAA'] }),
      ],
    }));
    expect(r.rows.filter((x) => !x.isBrand)).toHaveLength(1);
    expect(satir(r, 'İddaa').answers).toBe(2);
  });
});

describe('kaynak gosterilme — adres tanimliysa gecmise donuk de sayilir', () => {
  const runs = [
    run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', cited: true, sourceHosts: ['blog.creatorden.com', 'reddit.com'] }),
    run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', sourceHosts: ['creatorden.com'] }),
    run({ promptId: 'p2', provider: 'openai', date: '2026-11-11', sourceHosts: ['notcreatorden.com'] }),
  ];

  it('rakibin alan adi ve alt alan adi sayilir; benzer alan adi sayilmaz; marka icin `cited`', () => {
    const r = aggregateCompetitorVisibility(girdi({ listed: [{ name: 'Creatorden', url: 'https://www.creatorden.com/tr' }], runs }));
    expect(satir(r, 'Creatorden').citedAnswers).toBe(2);
    expect(satir(r, 'ICM Turkey').citedAnswers).toBe(1);
  });

  it('adresi olmayan ya da adresi bir platformda olan rakipte kaynak sayisi yok (null)', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'Adressiz' }, { name: 'Platformda', url: 'https://www.instagram.com/platformda' }],
      runs,
    }));
    expect(satir(r, 'Adressiz').citedAnswers).toBeNull();
    expect(satir(r, 'Platformda').citedAnswers).toBeNull();
  });
});

describe('onceki olcume gore degisim — yalniz karsilastirilabilir cevaplar', () => {
  it('onceki cevabi olan ciftlerde once / simdi; yeni eklenen soru artis sayilmaz', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'Creatorden' }],
      runs: [
        // p1/openai: once anmadi, simdi andi
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-04', brandMentioned: false, competitors: ['Creatorden'] }),
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', brandMentioned: true, competitors: ['Creatorden'] }),
        // p1/xai: once andi, simdi anmadi
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-04', brandMentioned: true }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', brandMentioned: false }),
        // p9: yeni soru, onceki olcumu yok
        run({ promptId: 'p9', provider: 'openai', date: '2026-11-11', brandMentioned: true }),
      ],
    }));
    expect(r.totals.comparablePairs).toBe(2);
    expect(satir(r, 'ICM Turkey')).toMatchObject({ answers: 2, change: { pairs: 2, before: 1, now: 1 } });
    expect(satir(r, 'Creatorden').change).toEqual({ pairs: 2, before: 1, now: 1 });
  });

  it('ayni gunun ikinci cevabi "onceki olcum" sayilmaz; karsilastirma yoksa change null', () => {
    const r = aggregateCompetitorVisibility(girdi({
      runs: [
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', createdAt: 1, brandMentioned: false }),
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', createdAt: 2, brandMentioned: true }),
      ],
    }));
    expect(satir(r, 'ICM Turkey').change).toBeNull();
    expect(r.totals.comparablePairs).toBe(0);
  });
});

describe('oneri — listede olmayan, sik kaynak gosterilen siteler', () => {
  it('kendi site, listedeki rakip ve platformlar haric; en az 2 cevap; cevap sayisina gore', () => {
    const r = aggregateCompetitorVisibility(girdi({
      listed: [{ name: 'Creatorden', url: 'https://creatorden.com' }],
      runs: [
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', sourceHosts: ['influencerman.com', 'creatorden.com', 'icmturkey.com', 'reddit.com', 'tekcevap.com'] }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', sourceHosts: ['influencerman.com', 'youtube.com', 'viralif.com'] }),
        run({ promptId: 'p2', provider: 'openai', date: '2026-11-11', sourceHosts: ['influencerman.com', 'viralif.com', 'reddit.com'] }),
      ],
    }));
    expect(r.suggestions).toEqual([
      { domain: 'influencerman.com', answers: 3, questions: 2, providers: ['openai', 'xai'] },
      { domain: 'viralif.com', answers: 2, questions: 2, providers: ['openai', 'xai'] },
    ]);
  });

  it(`en cok ${MAX_SUGGESTIONS} oneri`, () => {
    const hosts = Array.from({ length: 12 }, (_, i) => `site${i}.com`);
    const r = aggregateCompetitorVisibility(girdi({
      runs: [
        run({ promptId: 'p1', provider: 'openai', date: '2026-11-11', sourceHosts: hosts }),
        run({ promptId: 'p1', provider: 'xai', date: '2026-11-11', sourceHosts: hosts }),
      ],
    }));
    expect(r.suggestions).toHaveLength(MAX_SUGGESTIONS);
  });
});

describe('girdi okuyuculari', () => {
  it('days yalniz 30 ya da 90', () => {
    expect(competitorVisibilityDays('90')).toBe(90);
    expect(competitorVisibilityDays(30)).toBe(30);
    expect(competitorVisibilityDays('7')).toBe(30);
    expect(competitorVisibilityDays(['90'])).toBe(30);
    expect(competitorVisibilityDays(undefined)).toBe(30);
  });

  it('rakip listesi: dize ya da { name, url }; bos ve bozuk kayit atlanir', () => {
    expect(listedCompetitorsFrom(['Share', { name: ' Creatorden ', url: 'https://creatorden.com' }, { url: 'https://adsiz.com' }, '', null, 5]))
      .toEqual([{ name: 'Share' }, { name: 'Creatorden', url: 'https://creatorden.com' }]);
    expect(listedCompetitorsFrom(null)).toEqual([]);
  });

  it('kayitli rakip anmalari ve kaynaklar', () => {
    expect(competitorNamesFrom([{ name: 'Creatorden', mentions: 2, positionFirst: 10 }, 'Share', { mentions: 1 }, null])).toEqual(['Creatorden', 'Share']);
    expect(competitorNamesFrom(undefined)).toEqual([]);
    expect(sourceHostsFrom([
      { url: 'https://www.creatorden.com/blog/x', domain: 'creatorden.com' },
      { domain: 'creatorden.com' },
      { url: 'https://share.com.tr/a' },
      {},
      null,
    ]).sort()).toEqual(['creatorden.com', 'share.com.tr']);
    expect(sourceHostsFrom('x')).toEqual([]);
  });
});
