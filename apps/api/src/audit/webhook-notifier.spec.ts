import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const requestMock = vi.fn();
/** Modul yuklenirken kurulan her undici Agent'in secenekleri (webhook + safe-fetch ajanlari) */
const agentOptions: any[] = [];
vi.mock('undici', async (orig) => {
  const real: any = await orig();
  class RecordingAgent extends real.Agent {
    constructor(opts: any) { agentOptions.push(opts); super(opts); }
  }
  return { ...real, Agent: RecordingAgent, request: (...a: any[]) => requestMock(...a) };
});

const { WebhookNotifierService } = await import('./webhook-notifier.service.js');
const realUndici: any = await vi.importActual('undici');
const { RANKSUP_BOT_UA } = await import('../common/safe-fetch.js');

function build(url: string) {
  const prisma = { site: { findUnique: vi.fn(async () => ({ id: 's1', name: 'Site', notifyWebhookUrl: url, notifyWebhookKind: null })) } };
  return new WebhookNotifierService(prisma as any);
}
const PAYLOAD = { siteId: 's1', siteName: 'Site', event: 'autopilot_summary' as const, title: 'Test', message: 'Mesaj' };

async function* chunks(...parts: string[]) { for (const p of parts) yield Buffer.from(p); }

beforeEach(() => { requestMock.mockReset(); });

describe('WebhookNotifierService — kullanici adresine POST, ic aga asla', () => {
  it('yazili ozel IP / bulut metadata adresi: istek hic atilmaz', async () => {
    const r = await build('http://169.254.169.254/latest/meta-data/').notify(PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('iç ağa');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('standart disi port ve http(s) disi protokol reddedilir', async () => {
    for (const url of ['http://hooks.example.com:8080/x', 'ftp://hooks.example.com/x', 'http://127.0.0.1:3001/api']) {
      const r = await build(url).notify(PAYLOAD);
      expect(r.ok, url).toBe(false);
    }
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('ic adrese COZULEN alan adi baglanti aninda durdurulur (localhost)', async () => {
    requestMock.mockImplementation((...a: any[]) => realUndici.request(...a));
    const r = await build('http://localhost/hook').notify(PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('güvenlik nedeniyle gönderilmedi');
  });

  it('Slack: JSON POST, yonlendirme izlenmez, korumali baglanti havuzu', async () => {
    const dump = vi.fn(async () => {});
    requestMock.mockResolvedValue({ statusCode: 200, body: { dump } });
    const r = await build('https://hooks.slack.com/services/T0/B0/xyz').notify(PAYLOAD);
    expect(r).toEqual({ ok: true });
    const [target, opts] = requestMock.mock.calls[0];
    expect(String(target)).toBe('https://hooks.slack.com/services/T0/B0/xyz');
    expect(opts).toMatchObject({ method: 'POST', maxRedirections: 0, headers: { 'content-type': 'application/json', 'user-agent': RANKSUP_BOT_UA } });
    expect(opts.dispatcher).toBeDefined();
    expect(() => JSON.parse(opts.body)).not.toThrow();
    expect(dump).toHaveBeenCalled();
  });

  it('hata yaniti: durum + govdenin ilk 100 karakteri; 3xx basari sayilmaz', async () => {
    requestMock.mockResolvedValue({ statusCode: 400, body: chunks('invalid_payload ', 'x'.repeat(5000)) });
    const r = await build('https://hooks.slack.com/services/T0/B0/xyz').notify(PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error?.startsWith('400: invalid_payload')).toBe(true);
    expect(r.error!.length).toBeLessThanOrEqual('400: '.length + 100);

    requestMock.mockResolvedValue({ statusCode: 302, body: chunks('') });
    expect((await build('https://hooks.slack.com/services/T0/B0/xyz').notify(PAYLOAD)).ok).toBe(false);
  });
});

describe('WebhookNotifierService — IPv4 sabitlemesi', () => {
  // Uretimde IPv6 yolu yok; webhook ajani main.ts'in genel dagiticisini
  // kullanmadigi icin family=4'u kendisi vermeli (happy-eyeballs IPv6'ya gecmesin).
  it('webhook ajani (ve ayni modulde kurulan safe-fetch ajanlari) family=4 ve korumali lookup ile kurulur', () => {
    const webhook = agentOptions.find((o) => o?.connect?.timeout === 8_000);
    expect(webhook, 'webhook ajani bulunamadi').toBeDefined();
    expect(webhook.connect.family).toBe(4);
    expect(typeof webhook.connect.lookup).toBe('function');
    expect(agentOptions.length).toBeGreaterThanOrEqual(3);
    for (const o of agentOptions) expect(o.connect.family).toBe(4);
  });
});
