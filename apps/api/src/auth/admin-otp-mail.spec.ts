import { describe, expect, it } from 'vitest';
import { ADMIN_OTP_KONU, adminOtpHtml, gecerliOtpKodu } from './admin-otp-mail.js';

describe('admin OTP e-postasi', () => {
  it('yalniz 6 haneli sayisal kod gecerli', () => {
    expect(gecerliOtpKodu('123456')).toBe(true);
    expect(gecerliOtpKodu('12345')).toBe(false);
    expect(gecerliOtpKodu('12345a')).toBe(false);
    expect(gecerliOtpKodu('<b>1</b>')).toBe(false);
    expect(gecerliOtpKodu(123456)).toBe(false);
  });
  it('kod govdede, konu satirinda kod yok', () => {
    expect(adminOtpHtml('482913')).toContain('482913');
    expect(ADMIN_OTP_KONU).not.toMatch(/\d/);
  });
  it('gecersiz kodla govde uretilmez (HTML enjeksiyonu yok)', () => {
    expect(() => adminOtpHtml('<script>')).toThrow();
  });
});
