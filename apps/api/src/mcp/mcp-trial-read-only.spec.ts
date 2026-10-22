import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { McpController } from './mcp.controller.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { TRIAL_EXPIRED_READ_ONLY_MESSAGE } from '../billing/trial-policy.js';

/**
 * Deneme suresi dolmus (salt okunur) hesap MCP'de (inceleme):
 * eskiden TrialExpiryGuard POST /mcp'yi toptan kesiyordu — initialize ve okuma araclari
 * da. Artik tasima ucu acik; yalniz kota/maliyet tuketen ya da icerik yazan (mutating)
 * arac reddedilir. Karar REST kapisiyla ayni (trialReadOnlyNow).
 */
const EXPIRED = { id: 'u1', role: 'USER', plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: new Date(Date.now() - 86_400_000) };

function build(opts: { open?: boolean; everPaid?: boolean } = {}) {
  const tools = {
    list: () => [
      { name: 'create_article', mutating: true },
      { name: 'list_articles' },
    ],
    listForMcp: vi.fn(() => [{ name: 'list_articles' }]),
    call: vi.fn(async () => ({ ok: true })),
  };
  const quota = { enforcePlanFeature: vi.fn(async () => {}) };
  const paytr = {
    checkoutStatus: vi.fn(async () => ({ open: opts.open ?? true })),
    hasEverPaid: vi.fn(async () => opts.everPaid ?? false),
  };
  const ctrl = new McpController(tools as any, quota as any, new ApiKeysService(null as any), paytr as any);
  return { ctrl, tools, paytr };
}

async function rpc(ctrl: McpController, user: unknown, method: string, params?: unknown) {
  let payload: any;
  const res: any = { status: () => res, json: (b: any) => { payload = b; return res; }, end: () => res };
  await ctrl.handle({ user } as any, res, { jsonrpc: '2.0', id: 1, method, params } as any);
  return payload;
}

describe('MCP — suresi dolmus deneme', () => {
  it('initialize, tools/list ve okuma araci calisir', async () => {
    const { ctrl, tools } = build();
    expect((await rpc(ctrl, EXPIRED, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo).toBeTruthy();
    expect((await rpc(ctrl, EXPIRED, 'tools/list')).result.tools).toEqual([{ name: 'list_articles' }]);
    const read = await rpc(ctrl, EXPIRED, 'tools/call', { name: 'list_articles', arguments: {} });
    expect(read.result.isError).toBe(false);
    expect(tools.call).toHaveBeenCalledWith(EXPIRED, 'list_articles', {});
  });

  it('kota/maliyet tuketen arac reddedilir; metin REST ile ayni', async () => {
    const { ctrl, tools } = build();
    const r = await rpc(ctrl, EXPIRED, 'tools/call', { name: 'create_article', arguments: { site_id: 's1', topic: 'Konu basligi' } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe(`Hata: ${TRIAL_EXPIRED_READ_ONLY_MESSAGE}`);
    expect(tools.call).not.toHaveBeenCalled();
  });

  it('satin alma kapali (test modu) ya da plani biten eski musteri: kilit yok', async () => {
    for (const opts of [{ open: false }, { everPaid: true }]) {
      const { ctrl, tools } = build(opts);
      const r = await rpc(ctrl, EXPIRED, 'tools/call', { name: 'create_article', arguments: {} });
      expect(r.result.isError, JSON.stringify(opts)).toBe(false);
      expect(tools.call).toHaveBeenCalledTimes(1);
    }
  });

  it('deneme suruyor / ucretli plan: satin alma ve odeme gecmisi hic sorulmaz', async () => {
    const { ctrl, paytr } = build();
    await rpc(ctrl, { ...EXPIRED, subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 86_400_000) }, 'tools/call', { name: 'create_article', arguments: {} });
    await rpc(ctrl, { ...EXPIRED, plan: 'ENTERPRISE', subscriptionStatus: 'ACTIVE' }, 'tools/call', { name: 'create_article', arguments: {} });
    expect(paytr.checkoutStatus).not.toHaveBeenCalled();
    expect(paytr.hasEverPaid).not.toHaveBeenCalled();
  });
});
