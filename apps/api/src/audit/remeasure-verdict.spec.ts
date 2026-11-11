import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { remeasureVerdict, afterWindowStart, sameMethodForBeforeAfter, REMEASURE_MIN_ROWS } from './remeasure-verdict.js';
import { CITATION_MATCH_VERSION, STANDARD_TIER_VERSION_OFFSET, citationMatchVersion } from './host-match.js';

const T = { weak: 0.4, lost: 0.01 };
const row = (date: string, provider: string, cited: boolean) => ({ date, provider, cited });
const day = (date: string, citedCount: number, total = 7) =>
  Array.from({ length: total }, (_, i) => row(date, `p${i}`, i < citedCount));

describe('remeasureVerdict — hukum birimi gun + satir', () => {
  it('tek tik (tek gun, 7 satir, %57 atif) -> ON SONUC, kesin hukum yok', () => {
    // Eski kod burada WON diyordu.
    const v = remeasureVerdict(day('2026-08-21', 4), T);
    expect(v.verdict).toBe('PRELIMINARY');
    expect(v.total).toBe(7); expect(v.dayCount).toBe(1);
    expect(v.rate).toBeCloseTo(4 / 7);
  });

  it('2 farkli gun + >=6 satir, oran >= %40 -> WON', () => {
    const v = remeasureVerdict([...day('2026-08-21', 3), ...day('2026-08-22', 3)], T);
    expect(v.verdict).toBe('WON');
    expect(v.dayCount).toBe(2);
  });

  it('2 gun ama toplam satir 6\'nin altinda -> hala ON SONUC', () => {
    const v = remeasureVerdict([...day('2026-08-21', 2, 3), ...day('2026-08-22', 1, 2)], T);
    expect(v.total).toBeLessThan(REMEASURE_MIN_ROWS);
    expect(v.verdict).toBe('PRELIMINARY');
  });

  it('kesin hukum: oran %1-%40 -> WEAK, <=%1 -> LOST', () => {
    expect(remeasureVerdict([...day('2026-08-21', 1), ...day('2026-08-22', 1)], T).verdict).toBe('WEAK');
    expect(remeasureVerdict([...day('2026-08-21', 0), ...day('2026-08-22', 0)], T).verdict).toBe('LOST');
  });

  it('wonProviders atif alan saglayicilarin benzersiz listesi', () => {
    const v = remeasureVerdict([row('2026-08-21', 'openai', true), row('2026-08-22', 'openai', true), row('2026-08-22', 'gemini', false)], T);
    expect(v.wonProviders).toEqual(['openai']);
  });

  it('bos satir -> ON SONUC, oran 0', () => {
    const v = remeasureVerdict([], T);
    expect(v.verdict).toBe('PRELIMINARY'); expect(v.rate).toBe(0);
  });
});

describe('afterWindowStart — yayin gunu alt siniri, gun basina yuvarlama', () => {
  const now = new Date('2026-08-21T16:00:00Z');

  it('yayin tarihi yoksa son 7 gunun basi (UTC gun)', () => {
    expect(afterWindowStart(now, null).toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('yayin pencereden sonraysa yayin GUNU (saat degil) alt sinir olur', () => {
    // 14:00'te yayin, 16:00'da kosum: satir date=00:00 -> yuvarlama olmadan dislanirdi
    expect(afterWindowStart(now, new Date('2026-08-21T14:00:00Z')).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });

  it('yayin pencereden onceyse pencere basi kalir', () => {
    expect(afterWindowStart(now, new Date('2026-07-01T10:00:00Z')).toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });
});

// 11.11.2026 (bagimsiz inceleme): firsat karti "oncesi → sonrasi"ni yontem surumune bakmadan
// basiyordu. Model atamasi degisince (ChatGPT ve Gemini) iki Profesyonel hesabin acik
// firsatlari, dagitimdan once olculmus "once" ile sonra olculmus "sonra"yi yan yana gosterecekti.
describe('sameMethodForBeforeAfter — oncesi / sonrasi yalniz ayni yontemle kiyaslanir', () => {
  it('ayni surum: kiyaslanir; sonrasi bos ya da oncesi bilinmiyor: kural karar vermez (true)', () => {
    expect(sameMethodForBeforeAfter(7, [7, 7, 7])).toBe(true);
    expect(sameMethodForBeforeAfter(7, [])).toBe(true);
    expect(sameMethodForBeforeAfter(null, [5, 7])).toBe(true);
    expect(sameMethodForBeforeAfter(undefined, [7])).toBe(true);
  });

  it('model degisti (5 → 7): kiyaslanmaz; sonrasi havuzu karisiksa da kiyaslanmaz', () => {
    expect(sameMethodForBeforeAfter(5, [7, 7])).toBe(false);
    expect(sameMethodForBeforeAfter(5, [5, 7])).toBe(false);
    expect(sameMethodForBeforeAfter(7, [5])).toBe(false);
  });

  it('kademe degisti (hizli model 107 → ust model 7): kiyaslanmaz; damgasiz eski satir surum 1 sayilir', () => {
    expect(citationMatchVersion('standard')).toBe(CITATION_MATCH_VERSION + STANDARD_TIER_VERSION_OFFSET);
    expect(citationMatchVersion('premium')).toBe(CITATION_MATCH_VERSION);
    expect(citationMatchVersion(undefined)).toBe(CITATION_MATCH_VERSION);
    expect(sameMethodForBeforeAfter(citationMatchVersion('standard'), [citationMatchVersion('premium')])).toBe(false);
    expect(sameMethodForBeforeAfter(citationMatchVersion('standard'), [citationMatchVersion('standard')])).toBe(true);
    expect(sameMethodForBeforeAfter(1, [null, undefined])).toBe(true);
    expect(sameMethodForBeforeAfter(2, [null])).toBe(false);
  });

  it('kablolama: firsat servisi kurali uygular; Prompt Lab satiri kademeli surumle damgalanir; olcum motoru kademeyi sonuca yazar', () => {
    const firsat = readFileSync(new URL('./content-opportunity.service.ts', import.meta.url), 'utf8');
    expect(firsat).toContain('const ayniYontem = sameMethodForBeforeAfter(oncekiSatir?.matchVersion, rows.map((r) => r.matchVersion));');
    expect(firsat).toContain("const comparable = (item.meta as any)?.method === 'main-unbranded' && before.total > 0 && ayniYontem;");
    expect(firsat).toContain("beforeMethod: comparable ? 'main-unbranded' : ayniYontem ? 'legacy-mixed' : 'method-changed',");
    // Panel "before" yokken farki degil notu basar
    const sayfa = readFileSync(new URL('../../../web/src/app/(dashboard)/sites/[id]/opportunities/page.tsx', import.meta.url), 'utf8');
    expect(sayfa).toContain('(öncesiyle kıyaslanamaz — ölçüm yöntemi değişti)');
    const lab = readFileSync(new URL('./prompt-lab.service.ts', import.meta.url), 'utf8');
    expect(lab).toContain('matchVersion: citationMatchVersion(tier),');
    expect(lab).toContain('await this.persistRuns(siteId, promptId, null, today, mainProbeRows, mainResults[0]?.modelTier);');
    expect(lab).toContain('await this.persistRuns(siteId, promptId, branch.id, today, rows, res[0]?.modelTier);');
    expect(lab).not.toContain('matchVersion: CITATION_MATCH_VERSION');
    const motor = readFileSync(new URL('./ai-citation.service.ts', import.meta.url), 'utf8');
    const kosum = motor.slice(motor.indexOf('async runQueries('), motor.indexOf('async runForSite('));
    expect(kosum).toContain('return results.map((r) => ({ ...r, modelTier }));');
  });
});
