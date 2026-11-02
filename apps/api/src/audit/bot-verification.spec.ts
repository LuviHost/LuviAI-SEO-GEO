import { describe, expect, it } from 'vitest';
import {
  BOT_VERIFY_METHODS,
  CidrSet,
  IP_LIST_SOURCES,
  classifyBotHit,
  decideRdns,
  hostnameMatchesSuffix,
  isPrivateIp,
  parseCidr,
  parseIp,
  parseIpList,
  pickClientIp,
  requiredListIds,
  type ClassifyLookup,
  type IpListId,
} from './bot-verification.js';

/**
 * Bot IP dogrulamasi — saf mantik. Vaka (02.11.2026): Claude-User UA'li 13.740
 * istegin yalniz 270'i gercek Anthropic IP'sinden geliyordu; RanksUp hepsini
 * "Claude sayfani okudu" diye sayiyordu.
 */

describe('parseIp / parseCidr', () => {
  it('IPv4 ve IPv6 adresleri, IPv4-eslenmis IPv6 ayni IPv4 sayilir', () => {
    expect(parseIp('1.2.3.4')).toEqual({ family: 4, value: 0x01020304n });
    expect(parseIp('::ffff:1.2.3.4')).toEqual({ family: 4, value: 0x01020304n });
    expect(parseIp('2001:db8::1')).toEqual({ family: 6, value: (0x20010db8n << 96n) | 1n });
    expect(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual(parseIp('2001:db8::1'));
    for (const bad of ['', '1.2.3', '256.1.1.1', '1.2.3.4.5', 'abc', '2001:db8:::1', null, undefined]) {
      expect(parseIp(bad as string)).toBeNull();
    }
  });

  it('CIDR maskelenir; gecersiz onek reddedilir; onek yoksa tek adres', () => {
    expect(parseCidr('10.1.2.3/8')).toEqual({ family: 4, prefix: 8, network: 0x0a000000n });
    expect(parseCidr('1.2.3.4')).toMatchObject({ prefix: 32 });
    expect(parseCidr('2001:db8::/32')).toMatchObject({ family: 6, prefix: 32 });
    expect(parseCidr('1.2.3.0/33')).toBeNull();
    expect(parseCidr('2001:db8::/129')).toBeNull();
    expect(parseCidr('1.2.3.0/x')).toBeNull();
  });
});

describe('CidrSet', () => {
  const set = CidrSet.from(['20.125.66.80/28', '132.196.86.0/24', '2600:1f28:365:8000::/56', '18.97.43.80/32', 'bozuk']);

  it('IPv4 araligi: sinirlar dahil, disi haric', () => {
    expect(set.size).toBe(4);
    expect(set.has('20.125.66.80')).toBe(true);
    expect(set.has('20.125.66.95')).toBe(true);
    expect(set.has('20.125.66.96')).toBe(false);
    expect(set.has('20.125.66.79')).toBe(false);
    expect(set.has('132.196.86.255')).toBe(true);
    expect(set.has('18.97.43.80')).toBe(true);
    expect(set.has('18.97.43.81')).toBe(false);
  });

  it('IPv6 araligi ve IPv4-eslenmis yazim', () => {
    expect(set.has('2600:1f28:365:80ff:ffff::1')).toBe(true);
    expect(set.has('2600:1f28:365:8100::1')).toBe(false);
    expect(set.has('::ffff:132.196.86.7')).toBe(true);
    expect(set.has('gecersiz')).toBe(false);
    expect(set.has(null)).toBe(false);
  });

  it('/0 her seyi kapsar (aile icinde)', () => {
    const all = CidrSet.from(['0.0.0.0/0']);
    expect(all.has('8.8.8.8')).toBe(true);
    expect(all.has('2001:db8::1')).toBe(false);
  });

  it('ozel ag adresleri', () => {
    for (const ip of ['10.0.0.1', '192.168.1.1', '127.0.0.1', '172.16.5.5', '::1', 'fd00::1', '100.64.0.1']) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '2001:4860::1']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('parseIpList — resmi liste bicimleri', () => {
  it('prefixes-json (OpenAI/Google/Bing/Anthropic bicimi)', () => {
    const body = JSON.stringify({ creationTime: '2026-10-20', prefixes: [{ ipv4Prefix: '216.73.216.0/22' }, { ipv6Prefix: '2001:4860:4801:10::/64' }, { ipv4Prefix: 'bozuk' }, {}] });
    expect(parseIpList(body, { format: 'prefixes-json', minEntries: 1 })).toEqual(['216.73.216.0/22', '2001:4860:4801:10::/64']);
  });

  it('cloudflare-json', () => {
    const body = { result: { ipv4_cidrs: ['173.245.48.0/20'], ipv6_cidrs: ['2400:cb00::/32'] } };
    expect(parseIpList(body, { format: 'cloudflare-json', minEntries: 1 })).toEqual(['173.245.48.0/20', '2400:cb00::/32']);
  });

  it('ip-text: HTML sayfadaki IPv4 adresleri (Amazon); surum numarasi gibi dizgeler eslesmez', () => {
    const html = '<td>100.24.134.117</td><td>100.25.103.91</td> v1.2.3 <span>1.2.3.4.5</span> 100.24.134.117';
    expect(parseIpList(html, { format: 'ip-text', minEntries: 2 })).toEqual(['100.24.134.117', '100.25.103.91']);
  });

  it('bicim tutmazsa ya da minEntries altindaysa null (fail-open: unknown)', () => {
    expect(parseIpList('<html>404</html>', { format: 'prefixes-json', minEntries: 1 })).toBeNull();
    expect(parseIpList({ prefixes: [] }, { format: 'prefixes-json', minEntries: 1 })).toBeNull();
    expect(parseIpList('<html>sayfa degisti</html>', { format: 'ip-text', minEntries: 50 })).toBeNull();
  });

  it('kaynak tablosu: dogrulama yontemlerinin listeleri tanimli ve Cloudflare dahil', () => {
    const ids = requiredListIds();
    expect(ids).toContain('cloudflare');
    for (const m of Object.values(BOT_VERIFY_METHODS)) for (const l of m.lists ?? []) expect(IP_LIST_SOURCES[l]).toBeDefined();
    // Google'in tasinmis adresleri (eski /search/apis/ipranges 301 veriyor)
    expect(IP_LIST_SOURCES['google-common'].url).toContain('/static/crawling/ipranges/common-crawlers.json');
  });
});

describe('ters DNS', () => {
  it('son ek eslesmesi alt alan adi ister; benzer ad eslesmez', () => {
    expect(hostnameMatchesSuffix('crawl-66-249-66-1.googlebot.com.', ['googlebot.com'])).toBe(true);
    expect(hostnameMatchesSuffix('googlebot.com', ['googlebot.com'])).toBe(true);
    expect(hostnameMatchesSuffix('evilgooglebot.com', ['googlebot.com'])).toBe(false);
    expect(hostnameMatchesSuffix('googlebot.com.evil.net', ['googlebot.com'])).toBe(false);
  });

  it('ileri dogrulama: ad ayni IP\'ye cozulmeli', () => {
    const ip = parseIp('66.249.66.1')!;
    const fwd = (ips: string[] | null) => () => (ips ? ips.map((x) => parseIp(x)!) : null);
    expect(decideRdns(ip, ['crawl-66-249-66-1.googlebot.com'], fwd(['66.249.66.1']), ['googlebot.com'])).toBe('match');
    // Saldirgan kendi PTR'sine googlebot.com yazabilir ama ileri kayit onun IP'sine donmez
    expect(decideRdns(ip, ['crawl.googlebot.com'], fwd(['1.1.1.1']), ['googlebot.com'])).toBe('nomatch');
    expect(decideRdns(ip, ['host.example.net'], fwd(['66.249.66.1']), ['googlebot.com'])).toBe('nomatch');
    expect(decideRdns(ip, [], fwd([]), ['googlebot.com'])).toBe('nomatch');
    expect(decideRdns(ip, null, fwd([]), ['googlebot.com'])).toBe('unavailable');
    expect(decideRdns(ip, ['crawl.googlebot.com'], fwd(null), ['googlebot.com'])).toBe('unavailable');
  });
});

describe('pickClientIp — proxy arkasi ve taklit baslik', () => {
  const cf = CidrSet.from(['173.245.48.0/20']);
  const isCf = (ip: ReturnType<typeof parseIp>) => cf.has(ip!);

  it('Cloudflare adresinden gelen istekte fwd (CF-Connecting-IP) kullanilir', () => {
    expect(pickClientIp({ ip: '173.245.48.10', fwd: '132.196.86.5' }, isCf).ip).toEqual(parseIp('132.196.86.5'));
  });

  it('Cloudflare arkasinda olmayan sitede ziyaretcinin yazdigi CF-Connecting-IP YOK SAYILIR', () => {
    expect(pickClientIp({ ip: '45.1.2.3', fwd: '132.196.86.5' }, isCf).ip).toEqual(parseIp('45.1.2.3'));
  });

  it('ozel ag / Cloudflare adresi (fwd yok) → proxy-ip; IP yok → no-ip', () => {
    expect(pickClientIp({ ip: '10.0.0.5' }, isCf)).toEqual({ ip: null, reason: 'proxy-ip' });
    expect(pickClientIp({ ip: '173.245.48.10' }, isCf)).toEqual({ ip: null, reason: 'proxy-ip' });
    expect(pickClientIp({ ip: '' }, isCf)).toEqual({ ip: null, reason: 'no-ip' });
    expect(pickClientIp({}, isCf)).toEqual({ ip: null, reason: 'no-ip' });
  });
});

describe('classifyBotHit', () => {
  const sets: Partial<Record<IpListId, CidrSet | null>> = {
    'openai-gptbot': CidrSet.from(['132.196.86.0/24']),
    'openai-chatgpt-user': CidrSet.from(['104.208.184.192/28']),
    'openai-searchbot': CidrSet.from(['104.210.140.128/28']),
    'anthropic': CidrSet.from(['216.73.216.0/22']),
    'perplexity-bot': CidrSet.from(['18.97.9.100/32']),
    'perplexity-user': null, // okunamadi
    'google-common': CidrSet.from(['66.249.64.0/19']),
    'google-special': CidrSet.from(['66.249.90.0/24']),
    'google-user-triggered-google': CidrSet.from(['2001:4860:4801:4004::/64']),
    'cloudflare': CidrSet.from(['173.245.48.0/20']),
  };
  const lookup: ClassifyLookup = { list: (id) => (id in sets ? sets[id] ?? null : null) };

  it('resmi listedeki IP → verified; saglayicinin baska listesindeki IP de ayni saglayici sayilir', () => {
    expect(classifyBotHit({ bot: 'GPTBot', ip: '132.196.86.10' }, lookup)).toEqual({ verdict: 'verified', reason: 'ip-list' });
    expect(classifyBotHit({ bot: 'ChatGPT-User', ip: '104.208.184.200' }, lookup)).toEqual({ verdict: 'verified', reason: 'ip-list' });
    expect(classifyBotHit({ bot: 'ChatGPT-User', ip: '132.196.86.10' }, lookup).verdict).toBe('verified');
    expect(classifyBotHit({ bot: 'Claude-User', ip: '216.73.217.1' }, lookup).verdict).toBe('verified');
  });

  it('vaka: UA degistiren kaziyici (ayni IP) → her "bot" unverified', () => {
    const scraper = '45.140.10.20';
    // (PerplexityBot burada yok: saglayicinin listelerinden biri okunamadi → unknown, asagida)
    for (const bot of ['ChatGPT-User', 'Claude-User', 'ClaudeBot', 'GPTBot', 'OAI-SearchBot']) {
      expect(classifyBotHit({ bot, ip: scraper }, lookup)).toEqual({ verdict: 'unverified', reason: 'ip-not-in-list' });
    }
  });

  it('listelerden biri okunamadiysa eslesmeyen IP unverified DEGIL unknown (fail-open)', () => {
    expect(classifyBotHit({ bot: 'Perplexity-User', ip: '45.140.10.20' }, lookup)).toEqual({ verdict: 'unknown', reason: 'list-unavailable' });
    // Ama okunabilen listede eslesme varsa yine dogrulanir
    expect(classifyBotHit({ bot: 'Perplexity-User', ip: '18.97.9.100' }, lookup).verdict).toBe('verified');
  });

  it('IP yok (eski Worker) → unknown/no-ip; proxy IP → unknown/proxy-ip', () => {
    expect(classifyBotHit({ bot: 'GPTBot' }, lookup)).toEqual({ verdict: 'unknown', reason: 'no-ip' });
    expect(classifyBotHit({ bot: 'GPTBot', ip: '173.245.48.1' }, lookup)).toEqual({ verdict: 'unknown', reason: 'proxy-ip' });
    expect(classifyBotHit({ bot: 'GPTBot', ip: '173.245.48.1', fwd: '132.196.86.10' }, lookup).verdict).toBe('verified');
  });

  it('yontemi olmayan bot → unknown/no-method; Cloudflare dogrulamasi ek olumlu sinyal', () => {
    expect(classifyBotHit({ bot: 'Bytespider', ip: '45.140.10.20' }, lookup)).toEqual({ verdict: 'unknown', reason: 'no-method' });
    expect(classifyBotHit({ bot: 'Bytespider', ip: '45.140.10.20', cfVerified: true }, lookup)).toEqual({ verdict: 'verified', reason: 'cloudflare' });
    // cfVerified false olumsuz karar vermez
    expect(classifyBotHit({ bot: 'Bytespider', ip: '45.140.10.20', cfVerified: false }, lookup).verdict).toBe('unknown');
  });

  it('Googlebot: liste disi IP icin ters DNS sonucu karar verir; senkron yolda (rdns yok) liste karari', () => {
    const withRdns = (r: 'match' | 'nomatch' | 'unavailable'): ClassifyLookup => ({ ...lookup, rdns: () => r });
    expect(classifyBotHit({ bot: 'Googlebot', ip: '66.249.66.1' }, lookup)).toEqual({ verdict: 'verified', reason: 'ip-list' });
    expect(classifyBotHit({ bot: 'Googlebot', ip: '2001:4860:4801:4004::5' }, lookup).verdict).toBe('verified');
    expect(classifyBotHit({ bot: 'Googlebot', ip: '45.1.1.1' }, withRdns('match'))).toEqual({ verdict: 'verified', reason: 'rdns' });
    expect(classifyBotHit({ bot: 'Googlebot', ip: '45.1.1.1' }, withRdns('nomatch'))).toEqual({ verdict: 'unverified', reason: 'ip-not-in-list' });
    expect(classifyBotHit({ bot: 'Googlebot', ip: '45.1.1.1' }, withRdns('unavailable'))).toEqual({ verdict: 'unknown', reason: 'rdns-unavailable' });
    expect(classifyBotHit({ bot: 'Googlebot', ip: '45.1.1.1' }, lookup).verdict).toBe('unverified');
  });

  it('Meta: ASN (yalniz Worker gonderir)', () => {
    expect(classifyBotHit({ bot: 'Meta-ExternalAgent', ip: '57.141.0.1', asn: 32934 }, lookup)).toEqual({ verdict: 'verified', reason: 'asn' });
    expect(classifyBotHit({ bot: 'Meta-ExternalAgent', ip: '45.1.1.1', asn: 9009 }, lookup)).toEqual({ verdict: 'unverified', reason: 'asn-mismatch' });
    expect(classifyBotHit({ bot: 'Meta-ExternalAgent', ip: '45.1.1.1' }, lookup)).toEqual({ verdict: 'unknown', reason: 'no-asn' });
  });
});
