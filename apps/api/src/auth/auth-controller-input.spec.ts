import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuthController, bodyText } from './auth.controller.js';

/**
 * Herkese acik mobil giris ve welcome-hook govdeleri satir ici tiplidir
 * (ValidationPipe denetlemez). Dize olmayan alan `.trim()` TypeError'iyla
 * 500 donuyordu; artik "eksik alan" 400'u — kimlik dogrulama mantigi aynen.
 */
function controller() {
  const prisma = { user: { findUnique: vi.fn() }, emailLog: { findFirst: vi.fn() } };
  const email = { send: vi.fn() };
  const ctl = new AuthController({} as any, {} as any, {} as any, email as any, prisma as any, {} as any);
  return { ctl, prisma, email };
}

afterEach(() => { delete process.env.INTERNAL_API_KEY; });

describe('bodyText', () => {
  it('yalniz dize kirpilir; diger her sey bos dize', () => {
    expect(bodyText('  abc ')).toBe('abc');
    expect(bodyText(123)).toBe('');
    expect(bodyText({ trim: 'x' })).toBe('');
    expect(bodyText(['a'])).toBe('');
    expect(bodyText(undefined)).toBe('');
  });
});

describe('AuthController govde tipleri', () => {
  it('mobile/google: sayi ya da nesne idToken 400 (TypeError/500 degil)', async () => {
    const { ctl } = controller();
    for (const idToken of [123, { a: 1 }, ['x'], null]) {
      const err = await ctl.mobileGoogle({ idToken } as any).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('idToken gerekli');
    }
  });

  it('mobile/apple: dize olmayan identityToken 400', async () => {
    const { ctl } = controller();
    const err = await ctl.mobileApple({ identityToken: 42 } as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('identityToken gerekli');
  });

  it('welcome-hook: anahtar dogru, email dize degil → 400, DB sorgusu yok', async () => {
    process.env.INTERNAL_API_KEY = 'k';
    const { ctl, prisma } = controller();
    const err = await ctl.welcomeHook('k', { email: { $ne: null } } as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('email gerekli');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('welcome-hook: gecerli dize e-posta kucuk harfe cevrilip aranir', async () => {
    process.env.INTERNAL_API_KEY = 'k';
    const { ctl, prisma } = controller();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(ctl.welcomeHook('k', { email: '  Ali@Ornek.COM ' })).rejects.toThrow('Kullanici bulunamadi');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ali@ornek.com' } });
  });
});
