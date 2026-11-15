import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { periodDayLabel, previousPeriodNote, reportIdFromSearch, reportTriggerLabel, urlWithoutReportParam } from './report-link';

/**
 * Aylik rapor e-postasindaki baglanti panelde o raporu acar; otomatik rapor gecmiste "cron"
 * diye degil "otomatik" diye gorunur.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const oku = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

describe('reportIdFromSearch', () => {
  it('?rapor= degerini okur', () => {
    expect(reportIdFromSearch('?rapor=cmh2abc123xyz')).toBe('cmh2abc123xyz');
    expect(reportIdFromSearch('?sekme=donem&rapor=cmh2abc123xyz')).toBe('cmh2abc123xyz');
  });

  it('yoksa, bossa ya da kimlik bicimine uymuyorsa null', () => {
    expect(reportIdFromSearch('')).toBeNull();
    expect(reportIdFromSearch('?rapor=')).toBeNull();
    expect(reportIdFromSearch('?baska=1')).toBeNull();
    expect(reportIdFromSearch('?rapor=../../admin')).toBeNull();
    expect(reportIdFromSearch('?rapor=a%20b')).toBeNull();
    expect(reportIdFromSearch(`?rapor=${'a'.repeat(65)}`)).toBeNull();
  });
});

describe('reportTriggerLabel', () => {
  it('kullanicinin calistirdigi raporda etiket yok', () => {
    expect(reportTriggerLabel('manual')).toBeNull();
    expect(reportTriggerLabel(undefined)).toBeNull();
    expect(reportTriggerLabel(null)).toBeNull();
  });

  it('otomatik rapor "cron" diye degil "otomatik" diye gorunur', () => {
    expect(reportTriggerLabel('cron')).toBe('otomatik');
    expect(reportTriggerLabel('api')).toBe('API');
  });
});

describe('periodDayLabel — ozel donem UTC gunuyle yazilir', () => {
  const secenek = { day: 'numeric', month: 'short', year: 'numeric' } as const;

  it('aylik raporun bitisi (ayin son gununun sonu, UTC) izleyen Turkiye\'deyken de ayin son gunu', () => {
    // 31 Ekim 23:59:59.999 UTC = Turkiye'de 1 Kasim 02:59
    const bitis = '2026-10-31T23:59:59.999Z';
    expect(periodDayLabel(bitis, 'custom', secenek)).toBe(new Date('2026-10-31T12:00:00Z').toLocaleDateString('tr-TR', { ...secenek, timeZone: 'UTC' }));
    expect(periodDayLabel(bitis, 'custom', secenek)).toContain('31');
    expect(periodDayLabel('2026-10-01T00:00:00.000Z', 'custom', secenek)).toMatch(/^1 /);
    // Izleyenin saatinde yazilsaydi (Turkiye): 1 Kasim
    expect(new Date(bitis).toLocaleDateString('tr-TR', { ...secenek, timeZone: 'Europe/Istanbul' })).toMatch(/^1 /);
  });

  it('hazir donem izleyenin saatinde yazilir (UTC zorlanmaz)', () => {
    const an = '2026-11-15T21:30:00.000Z';
    expect(periodDayLabel(an, 'month', secenek)).toBe(new Date(an).toLocaleDateString('tr-TR', secenek));
  });

  it('acik rapor ve gecmis listesi ayni yardimciyi kullanir', () => {
    expect(oku('../components/dondurulmus-rapor.tsx')).toContain('periodDayLabel(rapor.periodEnd, meta.period)');
    expect(oku('../components/rapor-gecmisi-panel.tsx')).toContain("periodDayLabel(iso, 'custom'");
  });
});

describe('urlWithoutReportParam', () => {
  it('yalniz rapor parametresini siler; diger parametreler ve # kalir', () => {
    expect(urlWithoutReportParam('https://ranksup.ai/sites/s1/report?rapor=cmh2abc')).toBe('/sites/s1/report');
    expect(urlWithoutReportParam('https://ranksup.ai/sites/s1/report?sekme=donem&rapor=cmh2abc#ust')).toBe('/sites/s1/report?sekme=donem#ust');
    expect(urlWithoutReportParam('https://ranksup.ai/sites/s1/report?sekme=donem')).toBe('/sites/s1/report?sekme=donem');
  });
});

describe('previousPeriodNote — fark neden yok', () => {
  it('onceki donemde hic olcum yok', () => {
    expect(previousPeriodNote({ oncekiDonemVeriVar: false, oncekiDonemTam: false })).toBe('önceki dönemde ölçüm yok');
  });

  it('veri var ama donem bastan sona olculmemis: sahte buyume yerine nedeni', () => {
    expect(previousPeriodNote({ oncekiDonemVeriVar: true, oncekiDonemTam: false })).toBe('önceki dönem baştan sona ölçülmedi');
  });

  it('iki donem de olculmus: not yok (fark gosterilir)', () => {
    expect(previousPeriodNote({ oncekiDonemVeriVar: true, oncekiDonemTam: true })).toBeNull();
  });

  it('alan olmayan eski dondurulmus rapor eskisi gibi davranir', () => {
    expect(previousPeriodNote({ oncekiDonemVeriVar: true })).toBeNull();
    expect(previousPeriodNote({})).toBeNull();
    expect(previousPeriodNote(undefined)).toBeNull();
  });

  it('canli rapor ve acik (dondurulmus) rapor ayni yardimciyi kullanir', () => {
    expect(oku('../components/site-report-panel.tsx')).toContain('previousPeriodNote(data.search)');
    expect(oku('../components/dondurulmus-rapor.tsx')).toContain('previousPeriodNote(seo.search)');
  });
});

describe('rapor gecmisi paneli baglantiyi ve etiketi kullaniyor', () => {
  const panel = oku('../components/rapor-gecmisi-panel.tsx');

  it('adresteki rapor acilir, gorunur alana kaydirilir, parametre adresten silinir', () => {
    expect(panel).toContain('reportIdFromSearch(window.location.search)');
    expect(panel).toContain('urlWithoutReportParam(window.location.href)');
    expect(panel).toContain('scrollIntoView');
  });

  it('ham tetikleyici degeri basilmaz', () => {
    expect(panel).toContain('reportTriggerLabel(r.trigger)');
    expect(panel).not.toMatch(/>\s*\{r\.trigger\}\s*</);
  });
});
