import { KNOWN_AI_BOTS, type AiBotCategory, type KnownAiBot } from './known-ai-bots.js';

/**
 * robots.txt icinden bilinen AI botlarinin stance'ini cikarir — saf fonksiyon
 * (agent-readiness.service.ts'ten tasindi; test edilebilir olsun diye).
 *
 * Grup mantigi: "User-agent: X" satirlarini takip eden Allow/Disallow kurallari
 * o gruba aittir. "Disallow: /" = block, aksi halde allow. Ismi gecmeyen bot
 * "unspecified" — `*` grubunun kuralina tabi olur ama biz acik deklarasyonu olceriz.
 */

export interface BotStance {
  name: string;
  category: AiBotCategory;
  /** ACIK deklarasyon: bot isimle anilmis mi (allow/block), yoksa unspecified */
  stance: 'allow' | 'block' | 'unspecified';
  /** RFC 9309 etkin durum: isimle anilmayan bot `*` grubunun kuralina tabi */
  effective: 'allow' | 'block';
}

export interface RobotsAiStance {
  allow: number;
  block: number;
  unspecified: number;
  bots: BotStance[];
  /**
   * Stance SKORUNA giren alt kume (training + search). User-triggered botlar
   * robots.txt'e guvenilir uymadigi icin "bilincli durus" olcumune katilmaz.
   */
  scored: { allow: number; block: number; named: number; total: number };
}

export function parseRobotsAiStance(robotsTxt: string, bots: readonly KnownAiBot[] = KNOWN_AI_BOTS): RobotsAiStance {
  const groups = new Map<string, string[]>(); // lower(bot) -> rules
  let currentAgents: string[] = [];
  let rulesOpen = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      if (rulesOpen) currentAgents = []; // yeni grup basliyor
      rulesOpen = false;
      currentAgents.push(value.toLowerCase());
      for (const a of currentAgents) if (!groups.has(a)) groups.set(a, []);
    } else if (key === 'allow' || key === 'disallow') {
      rulesOpen = true;
      for (const a of currentAgents) groups.get(a)?.push(`${key}:${value}`);
    }
  }

  const stanceOf = (rules: string[] | undefined): 'allow' | 'block' | null => {
    if (!rules || rules.length === 0) return null;
    // Tam kapatma: "disallow:/" (path'siz disallow allow anlamina gelir)
    const fullBlock = rules.some((r) => r === 'disallow:/');
    const hasAllow = rules.some((r) => r.startsWith('allow:'));
    if (fullBlock && !hasAllow) return 'block';
    return 'allow';
  };

  // `*` grubunun durusu — isimle anilmayan botlarin ETKIN durumunu belirler
  // (RFC 9309: ozel grup yoksa wildcard grup gecerlidir).
  const wildcard = stanceOf(groups.get('*'));

  const out: BotStance[] = bots.map((b) => {
    const own = stanceOf(groups.get(b.name.toLowerCase()));
    const stance = own ?? ('unspecified' as const);
    // robots.txt hic kural icermiyorsa varsayilan: erisim serbest
    const effective = own ?? wildcard ?? ('allow' as const);
    return { name: b.name, category: b.category, stance, effective };
  });

  const scoredBots = out.filter((b) => b.category !== 'user-triggered');
  const scoredAllow = scoredBots.filter((b) => b.stance === 'allow').length;
  const scoredBlock = scoredBots.filter((b) => b.stance === 'block').length;

  return {
    allow: out.filter((b) => b.stance === 'allow').length,
    block: out.filter((b) => b.stance === 'block').length,
    unspecified: out.filter((b) => b.stance === 'unspecified').length,
    bots: out,
    scored: { allow: scoredAllow, block: scoredBlock, named: scoredAllow + scoredBlock, total: scoredBots.length },
  };
}
