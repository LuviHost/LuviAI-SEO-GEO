import { STANCE_SCORED_BOTS } from './known-ai-bots.js';
import { looksLikeHtml } from './axo-validators.js';

/**
 * robots.txt'e GUVENLI ekleme (saf) — eski auto-fix musterinin dosyasinin
 * UZERINE yaziyordu: elle yazilmis Disallow kurallari, CMS'in sanal
 * robots.txt'si, ozel bot engelleri tek tikla kayboluyordu.
 *
 * Kurallar:
 *  1. Mevcut icerik BYTE BYTE onek olarak korunur; hicbir satir silinmez,
 *     degistirilmez, yer degistirmez. Yalniz sona eklenir.
 *  2. Eklenenler: isimle anilmayan AI botlari icin grup, Content-Signal (dosyada
 *     hic yoksa), Sitemap satiri (dosyada hic yoksa ve canli bir site haritasi
 *     biliniyorsa).
 *  3. Hicbir Disallow kaldirilmaz ya da zayiflatilmaz. RFC 9309 / Google: bir
 *     botun kendi grubu varsa `*` grubunu TAMAMEN yok sayar ("Specific groups
 *     and the * group are never combined"). Bu yuzden yeni bot grubuna `*`
 *     grubunun uye satirlari AYNEN kopyalanir; botun etkin erisimi degismez.
 *     `*` grubuna asla `Allow: /` eklenmez: esit uzunlukta allow/disallow
 *     catismasinda allow kazanir ve "Disallow: /" zayiflardi.
 *  4. Grup siniri: Google'in ayristiricisinda (google/robotstxt robots.cc)
 *     User-agent listesini YALNIZ allow/disallow satiri kapatir; Sitemap ve
 *     bilinmeyen satirlar (Content-Signal, Crawl-delay) grubu kapatmaz. Son grup
 *     kapanmamissa eklenen User-agent satirlari ona karisirdi — anlami
 *     degistirmeyen bos `Disallow:` ile kapatilir.
 *  5. Calisma aninda dogrulama: birlestirmeden once/sonra her bot x ornek yol
 *     icin erisim RFC 9309 eslestiricisiyle karsilastirilir; tek fark bile
 *     varsa sonuc accessUnchanged=false doner ve cagiran YAZMAZ.
 *
 * Kaynaklar: https://www.rfc-editor.org/rfc/rfc9309.html (2.2.1 grup secimi,
 * 2.2.2 en uzun eslesme, esitlikte allow);
 * https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt ;
 * Content-Signal satiri User-agent grubunun icinde durur (Cloudflare managed
 * robots.txt ornegi: User-Agent: * / Content-signal: ... / Allow: /):
 * https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
 */

export interface RobotsLine {
  /** Orijinal satir (satir sonu haric) */
  raw: string;
  /** Yorum atilmis, kucuk harf, typo'lari normalize edilmis anahtar; yorum/bos satirda null */
  key: string | null;
  value: string;
}

export interface RobotsGroup {
  /** User-agent degerleri (yazildigi gibi) */
  agents: string[];
  /** Gruba ait uye satirlari — allow/disallow/crawl-delay/content-signal/diger; sitemap HARIC */
  members: RobotsLine[];
  /** Grupta allow/disallow var mi — grubu yalniz bunlar kapatir */
  closed: boolean;
}

export interface ParsedRobots {
  lines: RobotsLine[];
  groups: RobotsGroup[];
  sitemaps: string[];
  hasContentSignal: boolean;
  /** Son grubun allow/disallow'u yok — sona eklenen User-agent satirlari ona karisir */
  lastGroupOpen: boolean;
}

/** Google ayristiricisinin kabul ettigi sik yazim hatalari (robots.cc kAllowFrequentTypos) */
const KEY_ALIASES: Record<string, string> = {
  'useragent': 'user-agent',
  'user agent': 'user-agent',
  'dissallow': 'disallow',
  'dissalow': 'disallow',
  'disalow': 'disallow',
  'diasllow': 'disallow',
  'disallaw': 'disallow',
  'site-map': 'sitemap',
};

function parseLine(raw: string): RobotsLine {
  const body = raw.replace(/#.*$/, '').trim();
  if (!body) return { raw, key: null, value: '' };
  let key: string;
  let value: string;
  const colon = body.indexOf(':');
  if (colon >= 0) {
    key = body.slice(0, colon).trim().toLowerCase();
    value = body.slice(colon + 1).trim();
  } else {
    // Google: iki nekta unutulmussa TAM IKI parcali satirda bosluk ayirici sayilir
    const parts = body.split(/[ \t]+/);
    if (parts.length !== 2) return { raw, key: null, value: '' };
    key = parts[0].toLowerCase();
    value = parts[1];
  }
  return { raw, key: KEY_ALIASES[key] ?? key, value };
}

/**
 * RFC 9309 2.2: NL = %x0D / %x0A / %x0D.0A — yalniz CR de satir sonudur
 * (google/robotstxt robots.cc da tek 0x0D'de satiri bitirir). Eskiden yalniz
 * /\r?\n/ ile bolunuyordu: klasik Mac (CR) dosyasi tek satira cokuyor, `*`
 * grubu kuralsiz gorunuyor ve birlestirme 21 AI botuna "Allow: /" ekleyip
 * "Disallow: /" engelini zayiflatiyordu.
 */
export const ROBOTS_EOL = /\r\n|\r|\n/;

export function parseRobots(text: string): ParsedRobots {
  const lines = text.replace(/^\uFEFF/, '').split(ROBOTS_EOL).map(parseLine);
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let hasContentSignal = false;
  let current: RobotsGroup | null = null;

  for (const line of lines) {
    if (!line.key) continue;
    if (line.key === 'content-signal') hasContentSignal = true;
    if (line.key === 'user-agent') {
      if (!current || current.closed) {
        current = { agents: [], members: [], closed: false };
        groups.push(current);
      }
      current.agents.push(line.value);
    } else if (line.key === 'sitemap') {
      // Sitemap grup uyesi degil, dosya geneli kayittir
      if (line.value) sitemaps.push(line.value);
    } else if (current) {
      // Herhangi bir User-agent'tan once gelen kurallar yok sayilir (Google ile ayni)
      current.members.push(line);
      if (line.key === 'allow' || line.key === 'disallow') current.closed = true;
    }
  }
  const last = groups[groups.length - 1];
  return { lines, groups, sitemaps, hasContentSignal, lastGroupOpen: !!last && !last.closed };
}

/**
 * User-agent degerinden urun belirteci: "GPTBot/1.0" → "gptbot", "*" → "*".
 * RFC 9309 belirteci harf/alt cizgi/tireyle sinirlar; AI2Bot gibi rakamli bot
 * adlari icin rakam da kabul edilir.
 */
export function agentToken(value: string): string | null {
  if (/^\*(\s|$)/.test(value)) return '*';
  const m = /^[A-Za-z0-9_-]+/.exec(value);
  return m ? m[0].toLowerCase() : null;
}

function groupsFor(parsed: ParsedRobots, agent: string): RobotsGroup[] {
  const token = agent.toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.some((a) => agentToken(a) === token));
  if (specific.length > 0) return specific;
  return parsed.groups.filter((g) => g.agents.some((a) => agentToken(a) === '*'));
}

interface CompiledRule { allow: boolean; length: number; re: RegExp }

function compileRules(groups: RobotsGroup[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const g of groups) {
    for (const m of g.members) {
      if (m.key !== 'allow' && m.key !== 'disallow') continue;
      const pattern = m.value;
      // Bos yol kural eklemez (RFC 9309 / Google: yol yoksa kural yok sayilir)
      if (!pattern) continue;
      const anchored = pattern.endsWith('$');
      const body = anchored ? pattern.slice(0, -1) : pattern;
      const src = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      out.push({ allow: m.key === 'allow', length: pattern.length, re: new RegExp(`^${src}${anchored ? '$' : ''}`) });
    }
  }
  return out;
}

/**
 * RFC 9309 eslestirici: bota ozel grup(lar) varsa yalniz onlar (kural icermese
 * bile — Google da bos ozel gruptan `*`'a dusmez), yoksa `*` grup(lar)i;
 * en uzun eslesen kural kazanir, esitlikte allow. Eslesme yoksa izin var.
 */
export function robotsAllows(parsed: ParsedRobots, agent: string, path: string): boolean {
  return allowsCompiled(compileRules(groupsFor(parsed, agent)), path);
}

function allowsCompiled(rules: CompiledRule[], path: string): boolean {
  let best: CompiledRule | null = null;
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

export type RobotsBodyState = 'ok' | 'empty' | 'html' | 'invalid' | 'encoding';

const DIRECTIVES = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'content-signal']);

/**
 * Metin diye cozulmus ikili govde izi: NUL ya da cozulemeyen bayt (U+FFFD).
 * Kok dosyalar artik Content-Type'tan bagimsiz okunur (auto-fix.service.ts ROOT_FILE): metin
 * disi turle sunulan gercek bir ikili govde "bos" degil 'invalid' sayilir —
 * bos sayilsaydi ustune yeni gruplar birlestirilirdi.
 */
const hasBinaryNoise = (text: string) => text.includes('\u0000') || text.includes('\uFFFD');

/**
 * Canli govde gercek bir robots.txt mi? 'encoding' = yonergeler var ama metin
 * UTF-8 olarak cozulemeyen karakter (U+FFFD) iceriyor: okunabilir, ama uzerine
 * yazmak o karakterleri kalici bozar — birlestirme reddedilir.
 */
export function assessRobotsBody(text: string): RobotsBodyState {
  if (looksLikeHtml(text)) return 'html';
  const parsed = parseRobots(text);
  const directives = parsed.lines.some((l) => l.key !== null && DIRECTIVES.has(l.key));
  if (directives) return text.includes('\uFFFD') ? 'encoding' : 'ok';
  if (parsed.lines.every((l) => l.key === null)) return hasBinaryNoise(text) ? 'invalid' : 'empty';
  return 'invalid';
}

/** robots.txt'de bildirilen mutlak http(s) Sitemap adresleri (en fazla 10) */
export function robotsSitemapUrls(text: string): string[] {
  const out: string[] = [];
  for (const s of parseRobots(text).sitemaps) {
    if (/^https?:\/\/\S+$/i.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

export interface RobotsMergeOptions {
  /** Isimle anilmasi istenen botlar — varsayilan: stance skoruna giren 21 AI botu */
  bots?: readonly string[];
  /** ör. 'search=yes, ai-input=yes, ai-train=yes'; null → Content-Signal eklenmez */
  contentSignal?: string | null;
  /** Dosyada hic Sitemap yoksa eklenecek CANLI site haritasi adresi */
  sitemapUrl?: string | null;
}

export interface RobotsMergeResult {
  content: string;
  changed: boolean;
  addedBots: string[];
  addedContentSignal: boolean;
  addedSitemap: boolean;
  /** Yeni bot grubuna kopyalanan `*` uye satirlari */
  copiedRules: string[];
  closedOpenGroup: boolean;
  accessUnchanged: boolean;
  accessChange?: { agent: string; path: string };
  /** Onizlemede gosterilecek Turkce notlar */
  notes: string[];
}

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * Gruplarin uye satirlari, yazildigi gibi. `*` grubundan kopyalarken
 * Content-Signal DAHIL edilir: bot onu daha once `*` uzerinden aliyordu ve
 * isimle anildiktan sonra da almali.
 */
function memberLines(groups: RobotsGroup[], includeSignal: boolean): string[] {
  return uniq(groups.flatMap((g) => g.members.filter((m) => includeSignal || m.key !== 'content-signal').map((m) => m.raw.trim())));
}

/** Gruplarda allow/disallow satiri var mi (anahtara gore — iki noktasiz Google yazimi dahil) */
const hasAccessRule = (groups: RobotsGroup[]) => groups.some((g) => g.members.some((m) => m.key === 'allow' || m.key === 'disallow'));

/** Dogrulamada denenecek somut yollar: kok + mevcut kural kaliplarindan turetilenler */
function samplePaths(...parsedList: ParsedRobots[]): string[] {
  const out = new Set<string>(['/', '/index.html', '/robots.txt']);
  for (const p of parsedList) {
    for (const g of p.groups) {
      for (const m of g.members) {
        if ((m.key !== 'allow' && m.key !== 'disallow') || !m.value) continue;
        let path = m.value.replace(/\$$/, '').replace(/\*/g, 'x');
        if (!path.startsWith('/')) path = `/${path}`;
        out.add(path);
        out.add(`${path}x`);
        out.add(`${path}/x`);
        if (out.size >= 150) return [...out];
      }
    }
  }
  return [...out];
}

/** Tum satir sonlarini LF'ye cevirir (CRLF ve tek CR) */
const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n');

/**
 * Savunma agi ayristiricinin satir bolme kararina guvenmez: once/sonra
 * metinleri LF'ye normalize edilip yeniden ayristirilir. Eskiden ayni
 * ayristiricinin ciktisini karsilastiriyordu; CR satir sonunu goremeyen
 * ayristirici iki tarafta da ayni hatayi yapinca "erisim degismedi" diyordu.
 */
function findAccessChange(beforeText: string, afterText: string, agents: string[]): { agent: string; path: string } | null {
  const before = parseRobots(normalizeEol(beforeText));
  const after = parseRobots(normalizeEol(afterText));
  const paths = samplePaths(before, after);
  for (const agent of agents) {
    const rb = compileRules(groupsFor(before, agent));
    const ra = compileRules(groupsFor(after, agent));
    for (const path of paths) {
      if (allowsCompiled(rb, path) !== allowsCompiled(ra, path)) return { agent, path };
    }
  }
  return null;
}

/**
 * Eklenen satirlar dosyanin kendi satir sonunu kullanir: CRLF varsa CRLF,
 * LF varsa LF, yalniz CR varsa CR. Karisik bir dosyada da her uc bicim RFC
 * 9309'a gore satir sonudur; ama yalniz-CR dosyaya LF eklemek onu karisik
 * hale getirirdi.
 */
function detectEol(text: string): '\r\n' | '\n' | '\r' {
  if (text.includes('\r\n')) return '\r\n';
  if (text.includes('\n')) return '\n';
  if (text.includes('\r')) return '\r';
  return '\n';
}

/**
 * Mevcut robots.txt'ye eksik olanlari GUVENLE ekler (bkz. dosya basi).
 * existing=null → dosya yok; ayni kurallar bos taban uzerinde uygulanir.
 * Idempotent: kendi ciktisina tekrar uygulandiginda degisiklik uretmez.
 */
export function mergeRobotsTxt(existing: string | null, opts: RobotsMergeOptions = {}): RobotsMergeResult {
  const base = existing ?? '';
  const eol = detectEol(base);
  const before = parseRobots(base);
  const wanted = uniq([...(opts.bots ?? STANCE_SCORED_BOTS.map((b) => b.name))]);
  const named = new Set(before.groups.flatMap((g) => g.agents.map(agentToken)).filter((t): t is string => !!t));
  const missing = wanted.filter((b) => !named.has(b.toLowerCase()));
  const alreadyNamed = wanted.filter((b) => named.has(b.toLowerCase()));
  const signal = opts.contentSignal?.trim() || null;
  const addSignal = !before.hasContentSignal && !!signal;
  const addSitemap = before.sitemaps.length === 0 && !!opts.sitemapUrl;

  const wildcardGroups = before.groups.filter((g) => g.agents.some((a) => agentToken(a) === '*'));
  const copied = memberLines(wildcardGroups, true);
  const groupLines: string[] = [];

  if (missing.length > 0) {
    groupLines.push(
      copied.length > 0
        ? '# RanksUp: AI botlari isimle anildi; erisimleri DEGISMEDI ("User-agent: *" kurallari aynen kopyalandi).'
        : '# RanksUp: AI botlari isimle anildi; zaten tam erisimleri vardi, "Allow: /" bunu acikca yazar.',
    );
    for (const b of missing) groupLines.push(`User-agent: ${b}`);
    if (addSignal) groupLines.push(`Content-Signal: ${signal}`);
    groupLines.push(...copied);
    // `*` grubunda allow/disallow yoksa bu botlar tam serbestti; Allow: / ayni anlam
    if (!hasAccessRule(wildcardGroups)) groupLines.push('Allow: /');
    groupLines.push('');
  }

  if (addSignal && alreadyNamed.length > 0) {
    // Isimle anilan botlar `*` grubunu okumaz: sinyal kendi gruplarina gitmeli.
    // Ikinci grup ilkiyle BIRLESIR (RFC 9309 2.2.1); kurallari aynen tekrarlanir
    // ki "son grup kazanir" diye okuyan uyumsuz ayristiricilarda da erisim degismesin.
    const bySet = new Map<string, string[]>();
    for (const b of alreadyNamed) {
      const token = b.toLowerCase();
      const own = before.groups.filter((g) => g.agents.some((a) => agentToken(a) === token));
      const rules = memberLines(own, false);
      if (!hasAccessRule(own)) rules.push('Allow: /');
      const k = rules.join('\n');
      bySet.set(k, [...(bySet.get(k) ?? []), b]);
    }
    groupLines.push('# RanksUp: mevcut AI bot gruplarina Content-Signal; kurallari aynen tekrarlandi (erisim degismez).');
    for (const [rulesKey, bots] of bySet) {
      for (const b of bots) groupLines.push(`User-agent: ${b}`);
      groupLines.push(`Content-Signal: ${signal}`);
      groupLines.push(...rulesKey.split('\n'));
      groupLines.push('');
    }
  }

  const appendsAgents = groupLines.length > 0;
  const closeOpen = appendsAgents && before.lastGroupOpen;

  if (!appendsAgents && !addSitemap) {
    return {
      content: base, changed: false, addedBots: [], addedContentSignal: false, addedSitemap: false,
      copiedRules: [], closedOpenGroup: false, accessUnchanged: true, notes: [],
    };
  }

  let out = base;
  // Son satir zaten herhangi bir satir sonuyla (LF / CR) bitiyorsa yenisi
  // eklenmez: yalniz-CR dosyada fazladan CR bos satir olurdu ve 1994 tarzi
  // ayristiricilar bos satiri kayit sonu sayar (asagidaki "Disallow:" notu).
  if (out.length > 0 && !/[\r\n]$/.test(out)) out += eol;
  if (closeOpen) {
    // Bos satir YOK: 1994 tarzi ayristiricilar bos satiri kayit sonu sayar
    out += ['# RanksUp: bos Disallow kural eklemez; yalniz yukaridaki grubu kapatir.', 'Disallow:'].join(eol) + eol;
  }
  if (out.trim().length > 0) out += eol;
  if (appendsAgents) out += groupLines.join(eol);
  // groupLines bos satirla biter; Sitemap'ten once bir bos satir daha okunurluk icin
  if (addSitemap) out += `${appendsAgents ? eol : ''}Sitemap: ${opts.sitemapUrl}${eol}`;

  const agents = uniq([
    ...wanted,
    ...[...named].filter((t) => t !== '*').slice(0, 40),
    // Isimsiz bir bot `*` grubuna duser — onun erisimi de degismemeli
    'ranksup-unnamed-probe',
  ]);
  const change = findAccessChange(base, out, agents);

  const notes: string[] = ['Mevcut hiçbir satır silinmedi ya da değiştirilmedi; yalnız dosyanın sonuna ekleme yapıldı.'];
  if (missing.length > 0) {
    notes.push(
      copied.length > 0
        ? `${missing.length} AI botu isimle eklendi; erişimleri değişmedi: "User-agent: *" grubundaki kurallar bu botların grubuna aynen kopyalandı.`
        : `${missing.length} AI botu isimle eklendi; zaten tam erişimleri vardı, "Allow: /" bunu açıkça yazar.`,
    );
    notes.push('Bundan sonra "User-agent: *" grubuna eklediğin kurallar isimle anılan botlara otomatik uygulanmaz; onları bu gruba da eklemelisin.');
  }
  if (missing.length === 0) notes.push('Önerilen AI botlarının hepsi dosyada zaten isimle anılıyor.');
  if (addSignal) notes.push(`Content-Signal eklendi (${signal}) — yalnız isimle anılan AI bot gruplarına; "User-agent: *" grubuna dokunulmadı.`);
  if (addSitemap) notes.push(`Sitemap satırı eklendi: ${opts.sitemapUrl}`);
  if (closeOpen) notes.push('Dosyanın son grubunda Allow/Disallow satırı yoktu; eklenen grupların ona karışmaması için anlamı değiştirmeyen boş bir "Disallow:" satırı eklendi.');
  if (before.groups.some((g) => g.members.some((m) => m.key === 'disallow' && m.value === '/'))) {
    notes.push('Dosyadaki "Disallow: /" engelleri olduğu gibi kaldı; bir botun engelini kaldırmak senin kararın.');
  }

  return {
    content: out,
    changed: true,
    addedBots: missing,
    addedContentSignal: addSignal,
    addedSitemap: addSitemap,
    copiedRules: missing.length > 0 ? copied : [],
    closedOpenGroup: closeOpen,
    accessUnchanged: change === null,
    ...(change ? { accessChange: change } : {}),
    notes,
  };
}
