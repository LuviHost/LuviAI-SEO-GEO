import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GscAiCsvImportDto, LandingEventDto } from './analytics-body.dto.js';
import { LandingAnalyticsController } from './landing-analytics.controller.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('landing olay govdesi (herkese acik)', () => {
  it('web izleyicisinin govdesi gecer', async () => {
    await expect(pipe.transform({
      type: 'cta_click', path: '/fiyatlar?utm_source=linkedin', sessionId: '2c5e4f9a-1b2c-4d5e-8f90-123456789abc',
      meta: { ctaId: 'hero-start' }, referrer: 'https://www.linkedin.com/', utm: { source: 'linkedin' },
    }, asBody(LandingEventDto))).resolves.toBeDefined();
    await expect(pipe.transform({ type: 'pageview', path: '/', sessionId: 'ssr' }, asBody(LandingEventDto))).resolves.toBeDefined();
  });

  it('dize olmayan tip/oturum ve bilinmeyen alan 400', async () => {
    await expect(pipe.transform({ type: ['pageview'], sessionId: 's' }, asBody(LandingEventDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ type: 'pageview', sessionId: { a: 1 } }, asBody(LandingEventDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ type: 'pageview', sessionId: 's', ua: 'sahte' }, asBody(LandingEventDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ csv: 'a,b', fileName: { x: 1 } }, asBody(GscAiCsvImportDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('controller: ua yalniz basliktan, utm yalniz bilinen uc dize alan, buyuk meta dusurulur', async () => {
    const record = vi.fn(async () => ({ ok: true }));
    const ctl = new LandingAnalyticsController({ record } as any);
    const req = { headers: { 'user-agent': 'Mozilla/5.0' } } as any;
    await ctl.record(req, {
      type: 'pageview', sessionId: 's1', ua: 'sahte', meta: { blob: 'x'.repeat(5000) },
      utm: { source: 'linkedin', medium: { $gt: '' }, evil: 'x' },
    } as any);
    const arg = (record.mock.calls[0] as any)[0];
    expect(arg.ua).toBe('Mozilla/5.0');
    expect(arg.utm).toEqual({ source: 'linkedin' });
    expect(arg.meta).toBeUndefined();
    expect(Object.keys(arg).sort()).toEqual(['meta', 'path', 'referrer', 'sessionId', 'type', 'ua', 'utm']);
  });
});

describe('landing olay yolu — VARCHAR(191)', () => {
  it('uzun sorgu dizeli yol (fbclid/utm) kesilir; olay kaybolmaz', async () => {
    const record = vi.fn(async () => ({ ok: true }));
    const ctl = new LandingAnalyticsController({ record } as any);
    const longPath = `/fiyatlar?utm_source=facebook&utm_medium=paid&fbclid=${'x'.repeat(300)}`;
    await ctl.record({ headers: {} } as any, { type: 'pageview', sessionId: 's1', path: longPath } as any);
    const arg = (record.mock.calls[0] as any)[0];
    expect(arg.path.length).toBe(191);
    expect(arg.path.startsWith('/fiyatlar?utm_source=facebook')).toBe(true);
  });
});
