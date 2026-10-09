import { describe, it, expect, vi } from 'vitest';
import { McpController } from './mcp.controller.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

/**
 * Arac bazinda scope: eskiden TUM mutating araclar herhangi bir :write ile
 * geciyordu (social:write anahtari audit isi baslatabiliyordu).
 */
function build() {
  const tools = {
    list: () => [
      { name: 'suggest_image_alts', mutating: true, scope: 'audit:write' },
      { name: 'list_image_alt_issues', scope: 'audit:read' },
    ],
    listForMcp: () => [],
    call: vi.fn(async () => ({ ok: true })),
  };
  const quota = { enforcePlanFeature: vi.fn(async () => {}) };
  const ctrl = new McpController(tools as any, quota as any, new ApiKeysService(null as any));
  return { ctrl, tools };
}

async function call(ctrl: McpController, name: string, scopes: string[] | null) {
  let payload: any;
  const res: any = { status: () => res, json: (b: any) => { payload = b; return res; }, end: () => res };
  const req: any = { user: { id: 'u1', role: 'USER' }, ...(scopes ? { apiKey: { scopes } } : {}) };
  await ctrl.handle(req, res, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { site_id: 's1' } } } as any);
  return payload.result;
}

describe('MCP arac bazinda scope', () => {
  it('social:write anahtari audit:write gerektiren araci CAGIRAMAZ', async () => {
    const { ctrl, tools } = build();
    const r = await call(ctrl, 'suggest_image_alts', ['social:write']);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/audit:write/);
    expect(tools.call).not.toHaveBeenCalled();
  });

  it('audit:write anahtari cagirabilir; ayni anahtar audit:read aracini da kapsar', async () => {
    const { ctrl, tools } = build();
    expect((await call(ctrl, 'suggest_image_alts', ['audit:write'])).isError).toBe(false);
    expect((await call(ctrl, 'list_image_alt_issues', ['audit:write'])).isError).toBe(false);
    expect(tools.call).toHaveBeenCalledTimes(2);
  });

  it('salt-okuma anahtari okuma aracini cagirir, mutating araci cagiramaz', async () => {
    const { ctrl } = build();
    expect((await call(ctrl, 'list_image_alt_issues', ['audit:read'])).isError).toBe(false);
    expect((await call(ctrl, 'suggest_image_alts', ['audit:read'])).isError).toBe(true);
  });

  it('oturumla (API anahtarisiz) gelen cagri scope denetimine takilmaz', async () => {
    const { ctrl } = build();
    expect((await call(ctrl, 'suggest_image_alts', null)).isError).toBe(false);
  });
});
