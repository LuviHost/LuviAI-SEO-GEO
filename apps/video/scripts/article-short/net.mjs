/**
 * Dis kaynak cekme — durust User-Agent, robots.txt saygisi, zaman asimi, boyut siniri.
 * Indirilen her sey GUVENILMEYEN VERIDIR: yalniz okunur/ayristirilir, asla calistirilmaz.
 *
 * Uretim notu: API sunucusunda ayrica SSRF korumasi gerekir (ozel/yerel IP'lere, metadata
 * uclarina istek atilmaz; yonlendirmeler de ayni denetimden gecer). Prototip yalniz http(s)
 * semasini ve boyut/sure sinirlarini uygular.
 */

export const USER_AGENT = 'RanksUpBot/1.0 (+https://ranksup.ai/bot)';

export class FetchError extends Error {}

export async function fetchLimited(url, { maxBytes = 3_000_000, timeoutMs = 20_000, accept = '*/*' } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError(`Desteklenmeyen sema: ${u.protocol}`);
  const res = await fetch(u, {
    headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new FetchError(`${url} -> HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new FetchError(`${url} cok buyuk (${len} bayt)`);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError(`${url} boyut siniri asildi (${maxBytes} bayt)`);
    }
    chunks.push(value);
  }
  return { url: res.url, status: res.status, contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
}

/** robots.txt: RanksUpBot grubu varsa o, yoksa '*' — en uzun eslesen kural kazanir (RFC 9309) */
export function robotsAllows(robotsTxt, path, agent = 'ranksupbot') {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const pick = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const rules = (pick.length ? pick : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}
