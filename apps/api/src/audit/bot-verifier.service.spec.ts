import { describe, expect, it, vi } from 'vitest';
import { BotVerifier, ipText, type BotVerifierDeps } from './bot-verifier.service.js';
import { IP_LIST_SOURCES, parseIp } from './bot-verification.js';

/**
 * Dogrulayici: liste onbellegi (24 sa), fail-open, ters DNS — ag ENJEKTE edilir.
 */

const URL_OF = Object.fromEntries(Object.entries(IP_LIST_SOURCES).map(([id, s]) => [s.url, id]));

function fakeDeps(over: Partial<BotVerifierDeps> & { lists?: Record<string, string[] | 'fail'>; clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: Date.UTC(2026, 10, 2, 12) };
  const lists = over.lists ?? {
    'openai-gptbot': ['132.196.86.0/24'],
    'anthropic': ['216.73.216.0/22'],
    'cloudflare': ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17'],
    'google-common': Array.from({ length: 12 }, (_, i) => `66.249.${64 + i}.0/24`),
    'google-special': Array.from({ length: 12 }, (_, i) => `66.249.${90 + i}.0/24`),
    'google-user-triggered-google': Array.from({ length: 12 }, (_, i) => `74.125.${i}.0/24`),
  };
  const fetchText = vi.fn(async (url: string) => {
    const id = URL_OF[url];
    const l = lists[id];
    if (!l || l === 'fail') throw new Error('HTTP 503');
    if (id === 'cloudflare') return JSON.stringify({ result: { ipv4_cidrs: l, ipv6_cidrs: [] } });
    return JSON.stringify({ prefixes: l.map((p) => ({ ipv4Prefix: p })) });
  });
  const deps: BotVerifierDeps = {
    fetchText,
    reverse: over.reverse ?? vi.fn(async () => []),
    resolve: over.resolve ?? vi.fn(async () => []),
    now: () => clock.t,
  };
  return { deps, fetchText, clock };
}

describe('BotVerifier — liste onbellegi', () => {
  it('listeler bir kez cekilir, 24 saat taze sayilir, sonra tazelenir', async () => {
    const { deps, fetchText, clock } = fakeDeps();
    const v = new BotVerifier(deps);
    await v.classifyMany([{ bot: 'GPTBot', ip: '132.196.86.1' }]);
    const first = fetchText.mock.calls.length;
    expect(first).toBeGreaterThan(5);
    // Basarili listeler tekrar cekilmez; basarisizlar 15 dk dolmadan denenmez
    await v.classifyMany([{ bot: 'GPTBot', ip: '132.196.86.1' }]);
    expect(fetchText.mock.calls.length).toBe(first);
    clock.t += 25 * 3_600_000;
    await v.classifyMany([{ bot: 'GPTBot', ip: '132.196.86.1' }]);
    expect(fetchText.mock.calls.length).toBeGreaterThan(first);
  });

  it('dogrulanmis / taklit / eski Worker ayrimi', async () => {
    const v = new BotVerifier(fakeDeps().deps);
    const r = await v.classifyMany([
      { bot: 'Claude-User', ip: '216.73.216.9' },
      { bot: 'Claude-User', ip: '45.140.10.20' },
      { bot: 'Claude-User' },
      { bot: 'Claude-User', ip: '173.245.48.3', fwd: '216.73.216.9' },
    ]);
    expect(r.map((x) => x.verdict)).toEqual(['verified', 'unverified', 'unknown', 'verified']);
  });

  it('liste okunamazsa (404/503) asla unverified demez — unknown; eski kopya 7 gune kadar kullanilir', async () => {
    const lists: Record<string, string[] | 'fail'> = { 'anthropic': ['216.73.216.0/22'] };
    const clock = { t: Date.UTC(2026, 10, 2, 12) };
    const { deps } = fakeDeps({ lists, clock });
    const v = new BotVerifier(deps);
    expect((await v.classifyMany([{ bot: 'GPTBot', ip: '45.1.1.1' }]))[0]).toMatchObject({ verdict: 'unknown', reason: 'list-unavailable' });
    expect((await v.classifyMany([{ bot: 'ClaudeBot', ip: '45.1.1.1' }]))[0].verdict).toBe('unverified');
    // Liste sonradan bozulur: eski kopya 7 gun gecerli
    lists['anthropic'] = 'fail';
    clock.t += 2 * 86_400_000;
    expect((await v.classifyMany([{ bot: 'ClaudeBot', ip: '45.1.1.1' }]))[0].verdict).toBe('unverified');
    clock.t += 6 * 86_400_000;
    expect((await v.classifyMany([{ bot: 'ClaudeBot', ip: '45.1.1.1' }]))[0].verdict).toBe('unknown');
  });

  it('cekici firlatsa / yavas olsa da classifyMany hata firlatmaz', async () => {
    const deps: BotVerifierDeps = {
      fetchText: async () => { throw new Error('ag yok'); },
      reverse: async () => { throw new Error('dns yok'); },
      resolve: async () => { throw new Error('dns yok'); },
      now: () => Date.now(),
    };
    const r = await new BotVerifier(deps).classifyMany([{ bot: 'Googlebot', ip: '66.249.66.1' }, { bot: 'GPTBot', ip: 'bozuk' }]);
    expect(r.map((x) => x.verdict)).toEqual(['unknown', 'unknown']);
  });

  it('classifySync ag beklemez; listeler yuklenince dogrular', async () => {
    const v = new BotVerifier(fakeDeps().deps);
    expect(v.classifySync({ bot: 'GPTBot', ip: '132.196.86.1' }).verdict).toBe('unknown');
    await v.ensureFresh();
    expect(v.classifySync({ bot: 'GPTBot', ip: '132.196.86.1' }).verdict).toBe('verified');
    expect(v.classifySync({ bot: 'ClaudeBot', ip: '45.1.1.1' }).verdict).toBe('unverified');
    // OpenAI'nin diger iki listesi bu sahte ortamda okunamiyor → eslesmeyen IP unknown (fail-open)
    expect(v.classifySync({ bot: 'GPTBot', ip: '45.1.1.1' }).verdict).toBe('unknown');
  });
});

describe('BotVerifier — ters DNS + ileri dogrulama', () => {
  it('liste disi Googlebot IP\'si googlebot.com adina ve geri ayni IP\'ye cozulurse verified; sonuc onbellekte', async () => {
    const reverse = vi.fn(async (ip: string) => (ip === '35.1.2.3' ? ['crawl-35-1-2-3.googlebot.com'] : ['ec2-1.amazonaws.com']));
    const resolve = vi.fn(async (host: string) => (host === 'crawl-35-1-2-3.googlebot.com' ? ['35.1.2.3'] : ['9.9.9.9']));
    const v = new BotVerifier(fakeDeps({ reverse, resolve }).deps);
    const r = await v.classifyMany([
      { bot: 'Googlebot', ip: '35.1.2.3' },
      { bot: 'Googlebot', ip: '35.1.2.3' },
      { bot: 'Googlebot', ip: '45.9.9.9' },
      { bot: 'Googlebot', ip: '66.249.66.1' }, // listede: ters DNS sorulmaz
    ]);
    expect(r.map((x) => [x.verdict, x.reason])).toEqual([
      ['verified', 'rdns'], ['verified', 'rdns'], ['unverified', 'ip-not-in-list'], ['verified', 'ip-list'],
    ]);
    expect(reverse).toHaveBeenCalledTimes(2);
    await v.classifyMany([{ bot: 'Googlebot', ip: '35.1.2.3' }]);
    expect(reverse).toHaveBeenCalledTimes(2);
  });

  it('ters DNS hatasi → unknown (rdns-unavailable)', async () => {
    const v = new BotVerifier(fakeDeps({ reverse: async () => { throw new Error('SERVFAIL'); } }).deps);
    expect((await v.classifyMany([{ bot: 'Googlebot', ip: '45.9.9.9' }]))[0]).toMatchObject({ verdict: 'unknown', reason: 'rdns-unavailable' });
  });
});

describe('ipText', () => {
  it('IPv4/IPv6 metne geri doner', () => {
    expect(ipText(parseIp('66.249.66.1')!)).toBe('66.249.66.1');
    expect(ipText(parseIp('2001:db8::1')!)).toBe('2001:db8:0:0:0:0:0:1');
  });
});
