import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';

/**
 * Eski packages/adapters derlemesi (dist) — kayit fonksiyonlari yok.
 *
 * NEDEN VAR: paket deploy'da ayri derlenir. Adlandirilmis import eski pakette
 * ESM baglantisinda SyntaxError atip API'yi ve worker'i acilista dusururdu.
 * Kayit ad alani importuyla yapilir: servis ayakta kalir, eksik koruma
 * loglanir, cagiran false alir.
 */
vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  return { ...real, setAdapterFetch: undefined, setAdapterHostResolver: undefined };
});

const { registerAdapterEgressGuard } = await import('./adapter-egress.js');
const { PublishTargetsModule } = await import('./publish-targets.module.js');

describe('eski adaptor paketi', () => {
  it('kayit hata atmaz, false doner, eksik koruma loglanir; modul acilisi da dusmez', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(registerAdapterEgressGuard()).toBe(false);
    expect(() => new PublishTargetsModule().onModuleInit()).not.toThrow();
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0][0])).toMatch(/KAYDEDILEMEDI.*pnpm build/);
    error.mockRestore();
  });
});
