import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SitesController } from './sites.controller.js';
import { SITE_SECRET_FIELDS } from './sites.service.js';

/**
 * sites.controller'in kendi yaptigi site guncellemeleri (autopilot, webhook)
 * sir listesini sites.service'ten ALIR — kopya tutmaz.
 *
 * NEDEN VAR: controller'da SITE_RESPONSE_OMIT adinda elle tutulan bir kopya
 * vardi. Site'a yeni bir sir kolonu eklenip yalniz SITE_SECRET_FIELDS
 * guncellenseydi bu iki cevap o siri sizdirirdi.
 */

function setup() {
  const update = vi.fn(async (args: any) => ({ id: 's1', ...args.data }));
  const sites = { findOne: vi.fn(async () => ({ id: 's1', userId: 'u1', url: 'https://ornek.com' })) };
  const ctl = new SitesController(sites as any, {} as any, {} as any, {} as any, {} as any, {} as any, { site: { update } } as any);
  return { ctl, update, req: { user: { id: 'u1', role: 'USER' } } as any };
}

describe('sites.controller sir listesi tek kaynaktan', () => {
  it('autopilot ve webhook cevabi SITE_SECRET_FIELDS nesnesinin kendisiyle omit eder', async () => {
    const { ctl, update, req } = setup();
    await ctl.setAutopilot(req, 's1', { enabled: true });
    await ctl.setWebhook(req, 's1', { url: '' });
    expect(update.mock.calls[0][0].omit).toBe(SITE_SECRET_FIELDS);
    expect(update.mock.calls[1][0].omit).toBe(SITE_SECRET_FIELDS);
  });

  it('controller\'da yerel kopya yok', () => {
    const src = readFileSync(new URL('./sites.controller.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/const\s+SITE_RESPONSE_OMIT/);
    expect(src).not.toMatch(/SiteOmit\s*=\s*\{/);
    expect(src).not.toMatch(/ingestSecret:\s*true/);
  });
});
