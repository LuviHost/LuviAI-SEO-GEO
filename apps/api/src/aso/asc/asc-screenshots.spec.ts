import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { displayTypeForSize, isDisplayType, thumbnailUrl, validateScreenshot } from './asc-screenshots.js';
import { AscScreenshotsService } from './asc-screenshots.service.js';

const png = (w: number, h: number, alpha: number | null) =>
  sharp({ create: { width: w, height: h, channels: alpha === null ? 3 : 4, background: alpha === null ? { r: 10, g: 20, b: 30 } : { r: 10, g: 20, b: 30, alpha } } }).png().toBuffer();
const file = async (w: number, h: number, alpha: number | null = 1, name = 'slot1.png') => {
  const buffer = await png(w, h, alpha);
  return { originalname: name, size: buffer.length, buffer };
};

describe('kurallar (saf)', () => {
  it('kabul edilen boyutlar dikey ve yatay; yanlış türde öneri', () => {
    expect(validateScreenshot({ format: 'png', width: 1320, height: 2868, bytes: 1 }, 'APP_IPHONE_67')).toEqual([]);
    expect(validateScreenshot({ format: 'jpeg', width: 2868, height: 1320, bytes: 1 }, 'APP_IPHONE_67')).toEqual([]);
    const e = validateScreenshot({ format: 'png', width: 2064, height: 2752, bytes: 1 }, 'APP_IPHONE_67');
    expect(e[0]).toMatch(/2064×2752 iPhone 6\.9" için kabul edilmiyor .* bu boyut iPad 13" için uygun/);
    expect(validateScreenshot({ format: 'webp', width: 1242, height: 2688, bytes: 16 * 1048576 }, 'APP_IPHONE_65')).toHaveLength(2);
    expect(displayTypeForSize(1284, 2778)).toBe('APP_IPHONE_65');
  });

  it('isDisplayType miras anahtarlarını reddeder', () => {
    expect(isDisplayType('APP_IPAD_PRO_3GEN_129')).toBe(true);
    expect(isDisplayType('toString')).toBe(false);
    expect(isDisplayType('__proto__')).toBe(false);
  });

  it('küçük resim adresi şablondan', () => {
    expect(thumbnailUrl({ templateUrl: 'https://x/{w}x{h}bb.{f}', width: 1320, height: 2868 }, 100)).toBe('https://x/100x217bb.png');
    expect(thumbnailUrl(null)).toBeNull();
  });
});

function build(opts: { state?: string; existing?: number; failParts?: boolean } = {}) {
  const client = {
    listAppStoreVersions: vi.fn(async () => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: opts.state ?? 'PREPARE_FOR_SUBMISSION' } }] })),
    listVersionLocalizations: vi.fn(async () => ({ data: [{ id: 'loc-tr', attributes: { locale: 'tr' } }] })),
    listScreenshotSets: vi.fn(async () => ({ data: [{ id: 'set1', attributes: { screenshotDisplayType: 'APP_IPHONE_67' } }] })),
    listScreenshots: vi.fn(async () => ({ data: Array.from({ length: opts.existing ?? 2 }, (_, i) => ({ id: `old${i}`, attributes: { fileName: `old${i}.png` } })) })),
    createScreenshotSet: vi.fn(),
    createScreenshot: vi.fn(async (_set: string, fileName: string, size: number) => ({ data: { id: 'new1', attributes: { fileName, uploadOperations: [{ method: 'PUT', url: 'https://up', offset: 0, length: size }] } } })),
    uploadParts: vi.fn(async (_ops: unknown[], _bytes: Buffer) => { if (opts.failParts) throw new Error('ağ hatası'); }),
    commitScreenshot: vi.fn(async () => ({ data: { attributes: { assetDeliveryState: { state: 'COMPLETE' } } } })),
    getScreenshot: vi.fn(),
    deleteScreenshot: vi.fn(async () => undefined),
  };
  const asc = {
    loadApp: vi.fn(async () => ({ id: 'a1', appleAppId: '6800', accountId: 'acc', account: { siteId: 's1' } })),
    getClient: vi.fn(async () => client),
  };
  const appliedFix = { kaydet: vi.fn(async () => undefined) };
  return { svc: new AscScreenshotsService({} as any, asc as any, appliedFix as any), client, appliedFix };
}
const USER = { id: 'u1', role: 'USER' as const };

describe('AscScreenshotsService', () => {
  it('check: opak alfa kaldırılacak, saydam beyaza düzleşir; Apple çağrısı yok', async () => {
    const t = build();
    const opaque = await t.svc.check('s1', 'a1', USER, await file(1290, 2796, 1), 'APP_IPHONE_67');
    expect(opaque).toMatchObject({ ok: true, alpha: 'opaque', note: 'Alfa kanalı kaldırılacak (görüntü değişmez)' });
    const clear = await t.svc.check('s1', 'a1', USER, await file(1290, 2796, 0.5), 'APP_IPHONE_67');
    expect(clear.alpha).toBe('transparent');
    const wrong = await t.svc.check('s1', 'a1', USER, await file(1080, 1920, null), 'APP_IPHONE_67');
    expect(wrong.ok).toBe(false);
    expect(t.client.createScreenshot).not.toHaveBeenCalled();
  });

  it('upload: alfasız PNG + md5 ile işlenir, kayıt düşülür', async () => {
    const t = build();
    const r = await t.svc.upload('s1', 'a1', USER, await file(1320, 2868, 1, 'App slot 1.png'), { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: 'true' });
    expect(r).toMatchObject({ screenshotId: 'new1', state: 'COMPLETE', flattened: true, fileName: 'App-slot-1.png' });
    const sent: Buffer = t.client.uploadParts.mock.calls[0][1];
    expect((await sharp(sent).metadata()).hasAlpha).toBe(false);
    expect(t.client.commitScreenshot).toHaveBeenCalledWith('new1', createHash('md5').update(sent).digest('hex'));
    expect(t.appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'asc_screenshot', fixType: 'asc_screenshot_upload', status: 'APPLIED' }));
  });

  it('upload: onaysız, yanlış boyut, düzenlenemez sürüm, dolu set → Apple\'a yazmadan red', async () => {
    const ok = await file(1320, 2868);
    await expect(build().svc.upload('s1', 'a1', USER, ok, { locale: 'tr', displayType: 'APP_IPHONE_67' })).rejects.toThrow(/açık onay/);
    await expect(build().svc.upload('s1', 'a1', USER, await file(1080, 1920), { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: 'true' })).rejects.toThrow(/kabul edilmiyor/);
    const live = build({ state: 'READY_FOR_DISTRIBUTION' });
    await expect(live.svc.upload('s1', 'a1', USER, ok, { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: 'true' })).rejects.toThrow(/ekran görüntüsü kabul etmiyor/);
    const full = build({ existing: 10 });
    await expect(full.svc.upload('s1', 'a1', USER, ok, { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: 'true' })).rejects.toThrow(/seti dolu \(10\)/);
    expect(live.client.createScreenshot).not.toHaveBeenCalled();
    expect(full.client.createScreenshot).not.toHaveBeenCalled();
  });

  it('upload: parça yüklemesi düşerse rezerve kayıt silinir', async () => {
    const t = build({ failParts: true });
    await expect(t.svc.upload('s1', 'a1', USER, await file(1320, 2868), { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: 'true' })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.deleteScreenshot).toHaveBeenCalledWith('new1');
  });

  it('clear: onay şart; setteki tümü silinir ve kaydedilir', async () => {
    const t = build({ existing: 3 });
    await expect(t.svc.clear('s1', 'a1', USER, { locale: 'tr', displayType: 'APP_IPHONE_67' })).rejects.toThrow(/açık onay/);
    expect(await t.svc.clear('s1', 'a1', USER, { locale: 'tr', displayType: 'APP_IPHONE_67', confirm: true })).toEqual({ deleted: 3 });
    expect(t.client.deleteScreenshot).toHaveBeenCalledTimes(3);
  });

  it('remove: yalnız bu uygulamanın setindeki görüntü silinir', async () => {
    const t = build();
    expect(await t.svc.remove('s1', 'a1', USER, 'old1', { confirm: true })).toEqual({ deleted: 1 });
    await expect(t.svc.remove('s1', 'a1', USER, 'yabanci', { confirm: true })).rejects.toThrow(/düzenlenebilir sürümünde yok/);
  });
});
