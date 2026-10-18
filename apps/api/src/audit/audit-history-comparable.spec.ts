import { describe, it, expect, vi } from 'vitest';
import { OVERALL_SCORE_WEIGHTS } from './audit-checks.service.js';
import {
  AuditService, GENEL_SKOR_KONTROL_ADI, compareAuditRows, genelSkorKiyasi, genelSkorKiyasNotu,
} from './audit.service.js';

/**
 * GET /audit/history — her satir bir onceki taramayla genel skoru DOGRUDAN
 * kiyaslanabilir mi soyler; taramanin kaynagi (trigger) da doner.
 *
 * NEDEN VAR: panel (audit-reports-panel DeltaRozeti) ardisik taramalarin genel
 * skor farkini yesil/kirmizi gosteriyordu; gecmis ucu yontem/kapsam bilgisi
 * dondurmedigi icin, arada genel skora giren bir kontrolun olcum yontemi
 * degistiginde (or. image_alt v2) fark "site iyilesti" diye okunuyordu.
 * compareAudits ayni iki tarama icin 'metodoloji_degisti' diyordu: iki uc
 * ayni kurali (genelSkorKiyasi / olcumYontemiDegisti) kullanmali.
 * trigger secilip cevaba konmuyordu.
 */

type Row = { id: string; ranAt: Date; overallScore: number; geoScore: number | null; issues: unknown; durationMs: number | null; trigger: string; checks: unknown };

/** Genel skora giren 14 kontrolun hepsi olculmus, varsayilan yontemle (v1) */
function tamChecks(over: Record<string, unknown> = {}): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const id of Object.keys(OVERALL_SCORE_WEIGHTS)) c[id] = { id, score: 80, details: {} };
  return { ...c, ...over };
}

function row(id: string, gun: string, checks: unknown, over: Partial<Row> = {}): Row {
  return { id, ranAt: new Date(`2026-${gun}T00:00:00Z`), overallScore: 70, geoScore: 40, issues: [], durationMs: 1000, trigger: 'user', checks, ...over };
}

function svc(rows: Row[]) {
  // rows: en yeni ONCE (ranAt desc) sirali
  const findMany = vi.fn(async ({ take }: any = {}) => (typeof take === 'number' ? rows.slice(0, take) : rows));
  const prisma = { audit: { findMany } };
  const s = new AuditService(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never);
  return { s, findMany };
}

describe('getHistory — skor kiyaslanabilirligi ve trigger', () => {
  it('genel skora giren kontrolun yontemi degisince (image_alt v1 → v2) yeni satir kiyaslanamaz; en eski satir null', async () => {
    const { s } = svc([
      row('c', '03-01', tamChecks({ image_alt: { id: 'image_alt', score: 100, details: { methodVersion: 2 } } }), { overallScore: 78, trigger: 'system' }),
      row('b', '02-01', tamChecks(), { overallScore: 70 }),
      row('a', '01-01', tamChecks(), { overallScore: 69, trigger: 'test' }),
    ]);
    const h = await s.getHistory('s1');
    expect(h.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(h.map((x) => x.trigger)).toEqual(['system', 'user', 'test']);

    expect(h[0].scoreComparableWithPrevious).toBe(false);
    expect(h[0].scoreMethodNote).toBe(
      'Bu tarama ile bir önceki tarama, genel skora giren şu kontrolleri farklı ölçüm yöntemleriyle ölçtü: Görsel alt metni. Skor farkının bir kısmı siteden değil yöntem değişikliğinden kaynaklanabilir.',
    );
    expect(h[1]).toMatchObject({ scoreComparableWithPrevious: true, scoreMethodNote: null });
    // Listenin en eski satirinin onceki taramasi listede yok
    expect(h[2]).toMatchObject({ scoreComparableWithPrevious: null, scoreMethodNote: null });
  });

  it('limit kesince de en eski DONEN satir null (listede olmayan taramayla kiyas yapilmaz)', async () => {
    const { s } = svc([row('c', '03-01', tamChecks()), row('b', '02-01', tamChecks()), row('a', '01-01', tamChecks({ image_alt: { score: 1, details: { methodVersion: 9 } } }))]);
    const h = await s.getHistory('s1', 2);
    expect(h.map((x) => [x.id, x.scoreComparableWithPrevious])).toEqual([['c', true], ['b', null]]);
  });

  it('checks okunur ama cevaba konmaz; eski alanlar ayni (geriye uyumlu, eklemeli)', async () => {
    const { s, findMany } = svc([row('b', '02-01', tamChecks(), { issues: [{ type: 'x' }, { type: 'y' }] }), row('a', '01-01', tamChecks())]);
    const h = await s.getHistory('s1');
    expect(findMany.mock.calls[0][0].select).toMatchObject({ trigger: true, checks: true, issues: true });
    expect(Object.keys(h[0]).sort()).toEqual(
      ['durationMs', 'geoScore', 'id', 'issueCount', 'overallScore', 'ranAt', 'scoreComparableWithPrevious', 'scoreMethodNote', 'trigger'],
    );
    expect(h[0].issueCount).toBe(2);
  });

  it('genel skora GIRMEYEN olcumlerin yontemi degisince (GEO, AI gorunurluk, PageSpeed) genel skor kiyaslanabilir kalir', async () => {
    const { s } = svc([
      row('b', '02-01', tamChecks({
        geo: { score: 50, details: { methodVersion: 3 } },
        aiCitations: { score: 40, details: { methodVersion: 4 } },
        pagespeed: { performanceScore: 90, details: { methodVersion: 2 } },
      })),
      row('a', '01-01', tamChecks({ geo: { score: 30, details: {} }, aiCitations: { score: 20, details: {} }, pagespeed: { performanceScore: 70 } })),
    ]);
    const h = await s.getHistory('s1');
    expect(h[0]).toMatchObject({ scoreComparableWithPrevious: true, scoreMethodNote: null });
  });

  it('genel skora giren kontrol yalniz bir taramada olculebildiyse (robots.txt dogrulanamadi) kiyaslanamaz; neden yazilir', async () => {
    const { s } = svc([
      row('b', '02-01', tamChecks({ robots_txt: { id: 'robots_txt', score: 0, details: { unverified: true } } })),
      row('a', '01-01', tamChecks()),
    ]);
    const h = await s.getHistory('s1');
    expect(h[0].scoreComparableWithPrevious).toBe(false);
    expect(h[0].scoreMethodNote).toBe(
      'Genel skora giren şu kontroller iki taramadan yalnız birinde ölçülebildi: robots.txt. İki skor aynı kontrollerden hesaplanmadığı için fark doğrudan kıyaslanamaz.',
    );
  });

  it('iki neden birlikte: iki cumle de yazilir', async () => {
    const { s } = svc([
      row('b', '02-01', tamChecks({ image_alt: { score: 90, details: { methodVersion: 2 } }, llms_txt: { score: 0, details: { unverified: true } } })),
      row('a', '01-01', tamChecks()),
    ]);
    const [yeni] = await s.getHistory('s1');
    expect(yeni.scoreComparableWithPrevious).toBe(false);
    expect(yeni.scoreMethodNote).toMatch(/farklı ölçüm yöntemleriyle ölçtü: Görsel alt metni\..*yalnız birinde ölçülebildi: llms\.txt\./);
  });

  it('tek tarama: iki alan null; checks bozuk/eksik satir patlatmaz', async () => {
    expect((await svc([row('a', '01-01', tamChecks())]).s.getHistory('s1'))[0]).toMatchObject({ scoreComparableWithPrevious: null, scoreMethodNote: null });
    const h = await svc([row('b', '02-01', null), row('a', '01-01', 'bozuk')]).s.getHistory('s1');
    expect(h[0]).toMatchObject({ scoreComparableWithPrevious: true, scoreMethodNote: null });
  });
});

describe('genelSkorKiyasi — compareAuditRows ile AYNI kural', () => {
  // Kontrol girdisi cesitleri: olculmus v1 / v2, alan yok, dogrulanamadi, skor yok, null
  const girdiler: Record<string, unknown> = {
    v1: { score: 70, details: {} },
    v1acik: { score: 60, details: { methodVersion: 1 } },
    v2: { score: 90, details: { methodVersion: 2 } },
    yok: undefined,
    dogrulanamadi: { score: 0, details: { unverified: true, methodVersion: 2 } },
    skorsuz: { details: { methodVersion: 2 } },
    bos: null,
  };
  const ids = ['image_alt', 'robots_txt'];

  it('her girdi ciftinde compareAudits metodolojiDegisen (genel skor kismi) ve skorKapsamiFarkli ile birebir ayni', () => {
    let denenen = 0;
    for (const [an, a] of Object.entries(girdiler)) {
      for (const [bn, b] of Object.entries(girdiler)) {
        const from = { id: 'f', ranAt: new Date('2026-01-01'), overallScore: 60, geoScore: null, issues: [], checks: tamChecks({ image_alt: a, robots_txt: b }) };
        const to = { id: 't', ranAt: new Date('2026-02-01'), overallScore: 70, geoScore: null, issues: [], checks: tamChecks({ image_alt: b, robots_txt: a }) };
        const cmp = compareAuditRows(from, to);
        const k = genelSkorKiyasi(from.checks, to.checks);
        const label = `${an} → ${bn}`;
        expect(k.yontemiDegisen, label).toEqual((cmp.metodolojiDegisen ?? []).filter((id) => Object.hasOwn(OVERALL_SCORE_WEIGHTS, id)));
        expect(k.kapsamiFarkli, label).toEqual(cmp.kismi?.skorKapsamiFarkli ?? []);
        for (const id of ids) {
          const durum = cmp.checks.find((c) => c.id === id)?.durum;
          expect(k.yontemiDegisen.includes(id), `${label} ${id}`).toBe(durum === 'metodoloji_degisti');
        }
        denenen++;
      }
    }
    expect(denenen).toBe(49);
  });

  it('gecmisteki hukum, ayni iki tarama icin compareAudits sonucuyla ayni', async () => {
    const yeni = row('b', '02-01', tamChecks({ image_alt: { score: 100, details: { methodVersion: 2 } }, hreflang: undefined }));
    const eski = row('a', '01-01', tamChecks());
    const [h] = await svc([yeni, eski]).s.getHistory('s1');
    const cmp = compareAuditRows(eski, yeni);
    expect(cmp.metodolojiDegisen).toEqual(['image_alt']);
    expect(cmp.kismi?.skorKapsamiFarkli).toEqual(['hreflang']);
    expect(h.scoreComparableWithPrevious).toBe(false);
    expect(h.scoreMethodNote).toContain('Görsel alt metni');
    expect(h.scoreMethodNote).toContain('Hreflang');
  });

  it('her genel skor kontrolunun Turkce adi var; not ham kimlik yazmaz', () => {
    for (const id of Object.keys(OVERALL_SCORE_WEIGHTS)) expect(GENEL_SKOR_KONTROL_ADI[id], id).toBeTruthy();
    const not = genelSkorKiyasNotu({ yontemiDegisen: Object.keys(OVERALL_SCORE_WEIGHTS).sort(), kapsamiFarkli: [] })!;
    for (const id of Object.keys(OVERALL_SCORE_WEIGHTS)) {
      if (GENEL_SKOR_KONTROL_ADI[id] !== id) expect(not, id).not.toContain(id);
    }
    expect(genelSkorKiyasNotu({ yontemiDegisen: [], kapsamiFarkli: [] })).toBeNull();
  });
});
