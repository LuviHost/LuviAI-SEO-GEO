import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AsoController } from './aso.controller.js';

/**
 * Govdedeki trackedAppId / siteId, yoldan gelen ve AsoResourceGuard'in
 * sahipligini denetledigi kimligi EZMEMELI.
 */
describe('ASO — govde, denetlenmis kimligi ezemez', () => {
  it('trackedAppId ve siteId her zaman yoldan gelir', async () => {
    const aso = {
      connectApp: vi.fn(async (x: any) => x), linkStore: vi.fn(async (x: any) => x),
      aiKeywordResearch: vi.fn(async (x: any) => x), optimizeMetadata: vi.fn(async (x: any) => x),
    };
    const shots = {
      generateBackground: vi.fn(async (x: any) => x), generateCaptions: vi.fn(async (x: any) => x),
      generateHandPhotoWithScreenshot: vi.fn(async (x: any) => x),
    };
    const ctrl: any = Object.create(AsoController.prototype);
    ctrl.aso = aso; ctrl.screenshots = shots;
    const evil = { trackedAppId: 'BASKASININ-APP', siteId: 'BASKASININ-SITE' } as any;
    expect((await ctrl.connectApp('benim-site', { ...evil, appStoreId: '1' })).siteId).toBe('benim-site');
    expect((await ctrl.linkStore('benim-app', { ...evil, appStoreId: '1' })).trackedAppId).toBe('benim-app');
    for (const m of ['aiKeywordResearch', 'optimizeMetadata']) {
      const fn = Object.getOwnPropertyNames(AsoController.prototype).includes(m) ? ctrl[m].bind(ctrl) : null;
      if (fn) expect((await fn('benim-app', evil)).trackedAppId).toBe('benim-app');
    }
    for (const m of ['generateBackground', 'generateCaptions', 'generateHandPhotoWithScreenshot']) {
      const fn = Object.getOwnPropertyNames(AsoController.prototype).includes(m) ? ctrl[m].bind(ctrl) : null;
      if (fn) expect((await fn('benim-app', evil)).trackedAppId).toBe('benim-app');
    }
  });

  it('kaynakta guvenilir kimligi ezilebilir sirada yazan yayilim kalmadi', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const f of ['aso.controller.ts', 'asc/asc.controller.ts', 'asa/asa.controller.ts']) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\{\s*(siteId|trackedAppId)(\s*:\s*\w+)?\s*,\s*\.\.\.body\s*\}/);
    }
  });

  it('kullanilmayan ve yol gecisine acik screenshots/save ucu kaldirildi', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(path.join(dir, 'aso.controller.ts'), 'utf8')).not.toContain("screenshots/save");
    expect(readFileSync(path.join(dir, 'screenshot.service.ts'), 'utf8')).not.toContain('saveScreenshot(');
  });
});
