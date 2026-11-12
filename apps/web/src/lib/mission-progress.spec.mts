/**
 * Kurulum ekrani ilerlemesi: yuzde ve durum cumlesi GERCEK adimlardan.
 * NEDEN VAR: yuzde yalniz gecen sureye gore artiyordu; bes adimdan ikisi
 * bitmisken ekran dakikalarca "95% · Yayın takvimi planlanıyor" yaziyor,
 * kurulum takilmis gibi gorunuyordu (12.11.2026).
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeMessages, activeTaskKeys, missionPercent, type MissionTask, type MissionTaskKey } from './mission-progress';

const SIRA: MissionTaskKey[] = ['brain', 'audit', 'topics', 'platform', 'schedule'];
const adimlar = (...biten: MissionTaskKey[]): MissionTask[] => SIRA.map((key) => ({ key, label: key, done: biten.includes(key) }));

describe('missionPercent — biten adimlardan', () => {
  it('iki adim bitmisken dakikalar gecse de %95 yazmaz; bir sonraki adimin sinirina varmaz', () => {
    expect(missionPercent(2, 5, 0)).toBe(40);
    const dokuzDakika = missionPercent(2, 5, 9 * 60_000);
    expect(dokuzDakika).toBeGreaterThan(40);
    expect(dokuzDakika).toBeLessThan(60);
    // Sonsuza kadar beklese de ucuncu adimin dilimine giremez
    expect(missionPercent(2, 5, 24 * 3600_000)).toBeLessThan(60);
  });

  it('zamanla artar (ekran donmus gorunmez), adim bitince ziplar', () => {
    const a = missionPercent(2, 5, 10_000);
    const b = missionPercent(2, 5, 60_000);
    expect(b).toBeGreaterThan(a);
    expect(missionPercent(3, 5, 0)).toBe(60);
    expect(missionPercent(3, 5, 0)).toBeGreaterThan(missionPercent(2, 5, 3600_000));
  });

  it('100 yalniz butun adimlar bitince; bitmeden en fazla 99', () => {
    expect(missionPercent(5, 5, 0)).toBe(100);
    expect(missionPercent(4, 5, 3600_000)).toBeLessThanOrEqual(99);
    expect(missionPercent(4, 5, 3600_000)).toBeGreaterThanOrEqual(80);
    expect(missionPercent(0, 5, 0)).toBe(0);
    expect(missionPercent(0, 0, 0)).toBe(0);
  });
});

describe('activeTaskKeys / activeMessages — yalniz gercekten suren adim', () => {
  it('baslangic: marka beyni, site taramasi ve platform birlikte; konular ve takvim sirasini bekler', () => {
    expect(activeTaskKeys(adimlar())).toEqual(['brain', 'audit', 'platform']);
    const m = activeMessages(adimlar()).join(' | ');
    expect(m).toContain('Site sayfaları taranıyor');
    expect(m).not.toContain('Yayın takvimi');
    expect(m).not.toContain('İçerik konuları');
    // AI olcumu marka beyni bitmeden baslamaz
    expect(m).not.toContain('AI asistanlarına');
  });

  it('ekran goruntusundeki durum (beyin + platform bitti, tarama suruyor): cumle taramayi ve AI sorularini soyler', () => {
    const t = adimlar('brain', 'platform');
    expect(activeTaskKeys(t)).toEqual(['audit']);
    expect(activeMessages(t)).toEqual(['Site sayfaları taranıyor', 'AI asistanlarına sorular soruluyor']);
  });

  it('tarama bitince konular; konular bitince takvim', () => {
    expect(activeTaskKeys(adimlar('brain', 'audit', 'platform'))).toEqual(['topics']);
    expect(activeMessages(adimlar('brain', 'audit', 'platform'))).toEqual(['İçerik konuları üretiliyor']);
    expect(activeTaskKeys(adimlar('brain', 'audit', 'platform', 'topics'))).toEqual(['schedule']);
    expect(activeMessages(adimlar('brain', 'audit', 'platform', 'topics'))).toEqual(['Yayın takvimi planlanıyor']);
  });

  it('platform tespit edilemese de zincir konulara gecer (platform zinciri bekletmez)', () => {
    expect(activeTaskKeys(adimlar('brain', 'audit'))).toEqual(['topics']);
  });

  it('hepsi bittiyse bos cumle listesi donmez', () => {
    expect(activeTaskKeys(adimlar(...SIRA))).toEqual([]);
    expect(activeMessages(adimlar(...SIRA))).toEqual(['Kurulum tamamlanıyor']);
  });
});

describe('kurulum ekrani: sure esikleri API ile tutarli', () => {
  const sayfa = readFileSync(new URL('../app/(dashboard)/onboarding/page.tsx', import.meta.url), 'utf8');
  const servis = readFileSync(new URL('../../../api/src/sites/sites.service.ts', import.meta.url), 'utf8');
  const dakika = (kaynak: string, ad: string) => Number(new RegExp(`${ad} = (\\d+) \\* 60`).exec(kaynak)?.[1]);

  it('"yeniden baslat" cikis yolu, API hala "calisiyor" saydigi surede gosterilir (ikinci zincir kuyruga girmez)', () => {
    const ekran = dakika(sayfa, 'STUCK_AFTER_MS');
    const api = dakika(servis, 'ONBOARDING_RUNNING_WINDOW_MS');
    expect(ekran).toBe(12);
    expect(api).toBe(15);
    expect(api).toBeGreaterThan(ekran);
  });

  it('ekran sureye dayali yuzde tahmini kullanmaz; "1-3 dakikada biter" demez', () => {
    expect(sayfa).not.toContain('ESTIMATED_TOTAL_MS');
    expect(sayfa).not.toContain('estimatedMs');
    expect(sayfa).not.toContain('1-3 dakikada');
    expect(sayfa).not.toContain('(1-2 dk)');
  });
});
