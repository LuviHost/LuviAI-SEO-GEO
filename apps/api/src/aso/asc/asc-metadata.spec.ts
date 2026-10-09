import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  detectConflicts,
  groupPatches,
  pickAppInfo,
  pickVersion,
  planChanges,
  type MetadataSnapshot,
} from './asc-metadata.js';

const snap = (over: Partial<MetadataSnapshot> = {}): MetadataSnapshot => ({
  version: { id: 'v2', versionString: '1.1', state: 'PREPARE_FOR_SUBMISSION', editable: true },
  appInfo: { id: 'ai2', state: 'PREPARE_FOR_SUBMISSION', editable: true },
  isFirstVersion: false,
  locales: {
    tr: {
      appInfoLocId: 'ail-tr',
      versionLocId: 'vl-tr',
      values: { name: 'Takvimim', subtitle: 'Günlük plan', description: 'Açıklama', keywords: 'ajanda,takvim', promotionalText: '', whatsNew: 'Hatalar düzeltildi' },
    },
  },
  ...over,
});

describe('pickVersion / pickAppInfo', () => {
  it('en yeni düzenlenebilir sürüm; yoksa en yeni (yalnız promosyon metni)', () => {
    expect(pickVersion([
      { id: 'v3', versionString: '1.2', state: 'WAITING_FOR_REVIEW' },
      { id: 'v2', versionString: '1.1', state: 'METADATA_REJECTED' },
      { id: 'v1', versionString: '1.0', state: 'READY_FOR_DISTRIBUTION' },
    ])).toMatchObject({ id: 'v2', editable: true });
    expect(pickVersion([{ id: 'v1', versionString: '1.0', state: 'READY_FOR_DISTRIBUTION' }])).toMatchObject({ id: 'v1', editable: false });
    expect(pickVersion([])).toBeNull();
  });

  it('app bilgisi: PREPARE_FOR_SUBMISSION > canlı olmayan > ilk', () => {
    expect(pickAppInfo([{ id: 'a', state: 'READY_FOR_DISTRIBUTION' }, { id: 'b', state: 'PREPARE_FOR_SUBMISSION' }])).toMatchObject({ id: 'b', editable: true });
    expect(pickAppInfo([{ id: 'a', state: 'READY_FOR_DISTRIBUTION' }, { id: 'b', state: 'WAITING_FOR_REVIEW' }])).toMatchObject({ id: 'b', editable: false });
    expect(pickAppInfo([{ id: 'a', state: 'READY_FOR_DISTRIBUTION' }])).toMatchObject({ id: 'a', editable: false });
  });
});

describe('planChanges', () => {
  it('yalnız değişen alanlar; sınır, boşluk ve zorunluluk kontrolü', () => {
    const c = planChanges(snap(), {
      tr: { name: 'Takvimim', subtitle: '  Ajanda ve hatırlatıcı  ', keywords: 'x'.repeat(101), description: '', promotionalText: 'Yeni!' },
    });
    expect(c.map((x) => x.field)).toEqual(['subtitle', 'description', 'keywords', 'promotionalText']);
    expect(c.find((x) => x.field === 'subtitle')).toMatchObject({ ok: true, from: 'Günlük plan', to: 'Ajanda ve hatırlatıcı' });
    expect(c.find((x) => x.field === 'keywords')).toMatchObject({ ok: false, reason: '101/100 karakter — sınır aşıldı' });
    expect(c.find((x) => x.field === 'description')).toMatchObject({ ok: false, reason: 'Bu alan boş bırakılamaz' });
  });

  it('canlı sürümde yalnız promosyon metni yazılabilir; ad için app bilgisi düzenlenebilir olmalı', () => {
    const live = snap({
      version: { id: 'v1', versionString: '1.0', state: 'READY_FOR_DISTRIBUTION', editable: false },
      appInfo: { id: 'ai1', state: 'READY_FOR_DISTRIBUTION', editable: false },
    });
    const c = planChanges(live, { tr: { promotionalText: 'Ekim kampanyası', keywords: 'yeni,alan', name: 'Yeni Ad' } });
    expect(c.find((x) => x.field === 'promotionalText')?.ok).toBe(true);
    expect(c.find((x) => x.field === 'keywords')?.reason).toMatch(/Sürüm 1\.0 düzenlenemez \(durum: READY_FOR_DISTRIBUTION\)/);
    expect(c.find((x) => x.field === 'name')?.reason).toMatch(/yeni sürüm hazırlanırken/);
  });

  it("ilk sürümde What's New yok; ASC'de olmayan dil reddedilir; metin olmayan değer reddedilir", () => {
    const c = planChanges(snap({ isFirstVersion: true }), { tr: { whatsNew: 'İlk sürüm' }, en: { subtitle: 'Planner' }, de: { name: 5 as any } });
    expect(c.find((x) => x.field === 'whatsNew')?.reason).toMatch(/ilk sürümde girilemez/);
    expect(c.find((x) => x.locale === 'en')?.reason).toMatch(/"en" dili App Store Connect'te yok/);
    expect(c.find((x) => x.locale === 'de')?.reason).toBe('Değer metin olmalı');
  });
});

describe('detectConflicts / groupPatches', () => {
  const changes = planChanges(snap(), { tr: { subtitle: 'Ajanda', keywords: 'ajanda,plan', promotionalText: 'Yeni' } });

  it('plandan sonra ASC değiştiyse çakışma', () => {
    const now = snap();
    now.locales.tr.values.keywords = 'biri,degistirdi';
    expect(detectConflicts(changes, now)).toEqual([{ locale: 'tr', field: 'keywords', expected: 'ajanda,takvim', actual: 'biri,degistirdi' }]);
    expect(detectConflicts(changes, snap())).toEqual([]);
  });

  it('yerelleştirme başına tek PATCH, eski değerler korunur', () => {
    expect(groupPatches(changes, snap())).toEqual([
      { scope: 'appInfo', locId: 'ail-tr', locale: 'tr', attributes: { subtitle: 'Ajanda' }, from: { subtitle: 'Günlük plan' } },
      { scope: 'version', locId: 'vl-tr', locale: 'tr', attributes: { keywords: 'ajanda,plan', promotionalText: 'Yeni' }, from: { keywords: 'ajanda,takvim', promotionalText: '' } },
    ]);
  });
});

describe('buildSnapshot', () => {
  it('ASC yanıtlarından dil bazlı değerler; tek sürüm = ilk sürüm', () => {
    const s = buildSnapshot({
      versions: [{ id: 'v1' }],
      appInfos: [{ id: 'ai1' }],
      appInfoLocs: [{ id: 'ail', attributes: { locale: 'tr', name: 'Takvimim', subtitle: null } }],
      versionLocs: [{ id: 'vl', attributes: { locale: 'tr', description: 'D', keywords: 'k', promotionalText: null, whatsNew: null } }],
      version: { id: 'v1', versionString: '1.0', state: 'REJECTED', editable: true },
      appInfo: { id: 'ai1', state: 'REJECTED', editable: true },
    });
    expect(s.isFirstVersion).toBe(true);
    expect(s.locales.tr).toEqual({
      appInfoLocId: 'ail',
      versionLocId: 'vl',
      values: { name: 'Takvimim', subtitle: '', description: 'D', keywords: 'k', promotionalText: '', whatsNew: '' },
    });
  });
});
