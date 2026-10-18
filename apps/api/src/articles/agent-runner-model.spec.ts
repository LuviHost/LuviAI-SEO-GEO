import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AgentRunnerService } from './agent-runner.service.js';
import { SETTINGS_BY_KEY, SETTINGS_CATALOG } from '../settings/settings.constants.js';

/**
 * Makale ajanlarinin model secimi YALNIZ ortam degiskeninden.
 *
 * NEDEN VAR: admin ayar katalogu WRITER_MODEL / EDITOR_MODEL / ROUTING_MODEL'i
 * "varsayilan claude-opus-5" diye listeliyordu; ajan onlari hic okumadigi icin
 * panelde gorunen deger kullanilan model degildi ve degistirmek etkisizdi.
 * Anahtarlar katalogdan cikarildi (gerekce settings.constants.ts). Bu test
 * hem env sirasini hem de ayarin OKUNMADIGINI sabitler: biri ajani ayara
 * baglarsa katalogu da bilincli olarak geri eklemeli.
 */

const KEYS = ['WRITER_MODEL', 'EDITOR_MODEL', 'ROUTING_MODEL'] as const;
const saved: Record<string, string | undefined> = {};

const brainContext = {
  siteName: 'Örnek',
  siteUrl: 'https://ornek.com',
  niche: 'hosting',
  language: 'tr',
  today: '2026-10-18',
  brain: {},
} as any;

function runner() {
  const chat = vi.fn(async (req: any) => ({
    model: req.model,
    output: 'tamam',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0,
  }));
  const settings = {
    getBoolean: vi.fn(async () => false),
    // Model icin ayar okunursa test patlar
    getString: vi.fn(async () => { throw new Error('model ayari okunmamali'); }),
    getRaw: vi.fn(async () => { throw new Error('model ayari okunmamali'); }),
  };
  return { svc: new AgentRunnerService(settings as any, { chat } as any), chat, settings };
}

const call = (svc: AgentRunnerService, agentName: any, preferredModel?: string) =>
  svc.run({ agentName, agentSystemSuffix: 'rol', brainContext, input: 'girdi', preferredModel });

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  // Her cagrida maliyet satiri loglanir; test ciktisini kirletmesin
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('agent-runner model secimi', () => {
  it('03-writer WRITER_MODEL, 04-editor EDITOR_MODEL, digerleri ROUTING_MODEL', async () => {
    process.env.WRITER_MODEL = 'model-yazar';
    process.env.EDITOR_MODEL = 'model-editor';
    process.env.ROUTING_MODEL = 'model-routing';
    const { svc, chat, settings } = runner();
    await call(svc, '03-writer');
    await call(svc, '04-editor');
    await call(svc, '01-keyword');
    await call(svc, 'topic-ranker');
    expect(chat.mock.calls.map((c: any[]) => c[0].model)).toEqual(['model-yazar', 'model-editor', 'model-routing', 'model-routing']);
    expect(settings.getString).not.toHaveBeenCalled();
    expect(settings.getRaw).not.toHaveBeenCalled();
  });

  it('env yoksa cagiranin tercihi (kisa ad haritasi), o da yoksa claude-sonnet-5', async () => {
    const { svc, chat } = runner();
    await call(svc, '03-writer');
    await call(svc, '04-editor', 'opus');
    await call(svc, '02-outline', 'haiku');
    expect(chat.mock.calls.map((c: any[]) => c[0].model)).toEqual(['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5']);
  });

  it('EDITOR_MODEL cagiranin tercihini ezer (Kampanya Skoru 04-editor + opus ister)', async () => {
    process.env.EDITOR_MODEL = 'model-editor';
    const { svc, chat } = runner();
    await call(svc, '04-editor', 'opus');
    expect(chat.mock.calls[0][0].model).toBe('model-editor');
  });

  it('admin ayar katalogu bu anahtarlari listelemiyor — etkisiz ayar panelde gosterilmez', () => {
    for (const k of KEYS) expect(SETTINGS_BY_KEY.has(k)).toBe(false);
    // Katalogun geri kalani dokunulmadan duruyor (model kategorisi bos kalmadi)
    expect(SETTINGS_CATALOG.filter((s) => s.category === 'model').map((s) => s.key)).toContain('MODEL_MEMBER');
  });
});
