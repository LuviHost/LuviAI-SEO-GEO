import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GaService.fetchKeyEventSetup — Data API + Admin API kablolamasi.
 * googleapis sahtelenir; gercek Google'a istek atilmaz.
 */
const runReport = vi.fn();
const keyEventsList = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    analyticsdata: () => ({ properties: { runReport } }),
    analyticsadmin: () => ({ properties: { keyEvents: { list: keyEventsList } } }),
  },
}));

const { GaService } = await import('./ga.service.js');

function svc(site: Record<string, unknown> | null) {
  const prisma = { site: { findUnique: vi.fn(async () => site) } };
  const gaOAuth = { getAuthenticatedClient: vi.fn(async () => ({})) };
  return new GaService(prisma as any, gaOAuth as any);
}

const CONNECTED = { id: 's1', gaPropertyId: '123', gaRefreshToken: 'enc' };

describe('GaService.fetchKeyEventSetup', () => {
  beforeEach(() => { runReport.mockReset(); keyEventsList.mockReset(); });

  it('GA bagli degilse istek atilmaz', async () => {
    expect(await svc({ id: 's1', gaPropertyId: null, gaRefreshToken: null }).fetchKeyEventSetup('s1')).toEqual({ status: 'not_connected' });
    expect(runReport).not.toHaveBeenCalled();
  });

  it('olay raporu + tanimli onemli etkinlikler → kontrol listesi', async () => {
    runReport.mockResolvedValue({
      data: {
        rows: [
          { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '500' }, { value: '0' }] },
          { dimensionValues: [{ value: 'form_submit' }], metricValues: [{ value: '12' }, { value: '0' }] },
        ],
      },
    });
    keyEventsList.mockResolvedValue({ data: { keyEvents: [{ eventName: 'purchase' }, { eventName: 'tel_click' }] } });
    const out = await svc(CONNECTED).fetchKeyEventSetup('s1', 28);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const req = runReport.mock.calls[0][0];
    expect(req.property).toBe('properties/123');
    expect(req.requestBody.dimensions).toEqual([{ name: 'eventName' }]);
    expect(req.requestBody.metrics).toEqual([{ name: 'eventCount' }, { name: 'keyEvents' }]);
    expect(req.requestBody.dateRanges).toEqual([{ startDate: '28daysAgo', endDate: 'today' }]);
    expect(keyEventsList.mock.calls[0][0]).toMatchObject({ parent: 'properties/123' });
    expect(out.checks.map((c) => [c.kind, c.status])).toEqual([['phone', 'tetiklenmedi'], ['form', 'anahtar_degil']]);
    expect(out.keyEventsSource).toBe('admin');
    expect(out.keyEvents).toEqual(['purchase', 'tel_click']);
    expect(out.adminNote).toBeNull();
  });

  it('Admin API kapaliysa rapora duser ve not dusulur', async () => {
    runReport.mockResolvedValue({ data: { rows: [{ dimensionValues: [{ value: 'phone_click' }], metricValues: [{ value: '4' }, { value: '4' }] }] } });
    keyEventsList.mockRejectedValue(new Error('Google Analytics Admin API has not been used in project 1 before or it is disabled'));
    const out = await svc(CONNECTED).fetchKeyEventSetup('s1');
    expect(out).toMatchObject({ status: 'ok', keyEventsSource: 'report', keyEvents: ['phone_click'] });
    if (out.status === 'ok') {
      expect(out.adminNote).toContain('Admin API');
      expect(out.checks[0].status).toBe('tamam');
    }
  });

  it('Data API yetki hatasi kullaniciya Turkce mesaj olur', async () => {
    runReport.mockRejectedValue(Object.assign(new Error('User does not have sufficient permissions'), { code: 403 }));
    const out = await svc(CONNECTED).fetchKeyEventSetup('s1');
    expect(out).toMatchObject({ status: 'error' });
    if (out.status === 'error') expect(out.message).toContain('yetkisi');
  });
});
