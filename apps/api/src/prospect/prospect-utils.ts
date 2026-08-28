/**
 * Kurumsal (B2B) aday listesi yardimcilari — SAF (DB/LLM yok).
 *
 * NEDEN: 6.000 e-postalik kurumsal kampanya icin acik kaynaklardan firma +
 * karar verici toplanip e-posta deseni tahmin ediliyor (scripts/prospect/*).
 * Turkce karakter donusumu, alan adi normalizasyonu, desen uretimi ve SMTP
 * sonda karar tablosu burada; script'ler yalniz orkestrasyon yapar.
 *
 * KVKK notu: bu modul veri uretmez; uretilen isimli veriler
 * reklam/pazarlama/prospect/data/ altinda tutulur ve .gitignore'dadir.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const SEKTORLER = ['finans', 'eticaret-perakende-teknoloji', 'turizm-havayolu-telekom-otomotiv'] as const;
export type Sektor = (typeof SEKTORLER)[number];

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/src/prospect (veya dist/prospect) → repo koku: 4 seviye yukari */
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const PROSPECT_DIR = path.join(REPO_ROOT, 'reklam', 'pazarlama', 'prospect');
export const DATA_DIR = path.join(PROSPECT_DIR, 'data');

// ─── Metin ──────────────────────────────────────────────────────────────────

const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', i: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};

/** Turkce → ASCII kucuk harf; harf/rakam/bosluk disindaki her sey silinir */
export function translit(s: string): string {
  let out = '';
  for (const ch of s) out += TR_MAP[ch] ?? ch;
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Ayşe Nur" → "aysenur" (e-posta yerel parcasi icin) */
export function slugName(s: string): string {
  return translit(s).replace(/\s+/g, '');
}

/** "https://www.X.com.tr/yol?x=1" → "x.com.tr"; gecersizse null */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host;
}

/** "Ayşe Nur Kaya" → { ad: "Ayşe Nur", soyad: "Kaya" }; tek kelime → soyad bos */
export function splitName(full: string): { ad: string; soyad: string } {
  const parts = full
    .replace(/\([^)]*\)/g, ' ')          // "(Vekil)", "(CMO)" gibi ekler
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((p) => p && !/^(dr|prof|doç|doc|av|mr|mrs|ms|sn|yrd|uzm|op|dt|ecz|mim|muh)\.?$/i.test(p));
  if (parts.length === 0) return { ad: '', soyad: '' };
  if (parts.length === 1) return { ad: parts[0], soyad: '' };
  return { ad: parts.slice(0, -1).join(' '), soyad: parts[parts.length - 1] };
}

// ─── E-posta deseni ─────────────────────────────────────────────────────────

export const PATTERN_KINDS = ['ad.soyad', 'asoyad', 'ad_soyad', 'ad', 'soyad.ad', 'a.soyad', 'adsoyad', 'ad-soyad'] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];
/** Desen bulunamayinca TR kurumsal varsayilan sirasi */
export const DEFAULT_PATTERNS: PatternKind[] = ['ad.soyad', 'asoyad', 'ad_soyad'];

/** Genel kutular — desen cikariminda ve hedeflemede KULLANILMAZ */
const GENERIC_LOCAL = new Set([
  'info', 'bilgi', 'iletisim', 'contact', 'kurumsal', 'basin', 'press', 'pr', 'ir', 'investor', 'yatirimci',
  'pazarlama', 'marketing', 'satis', 'sales', 'destek', 'support', 'ik', 'hr', 'insankaynaklari', 'kariyer',
  'kvkk', 'noreply', 'no-reply', 'admin', 'webmaster', 'muhasebe', 'finans', 'hukuk', 'legal', 'musteri',
  'musterihizmetleri', 'callcenter', 'rezervasyon', 'reservation', 'sekreterya', 'genelmudurluk',
]);

/** Noktali/tireli genel kutular: her parcasi genel bir kelimeyse (investor.relations, kurumsal.iletisim) */
const GENERIC_TOKENS = new Set([
  'info', 'investor', 'relations', 'yatirimci', 'iliskileri', 'iliskiler', 'kurumsal', 'iletisim', 'insan', 'kaynaklari',
  'musteri', 'hizmetleri', 'basin', 'press', 'media', 'medya', 'halkla', 'customer', 'service', 'services', 'support',
  'sales', 'marketing', 'pazarlama', 'corporate', 'communications', 'satis', 'destek', 'bilgi', 'contact', 'ir', 'pr',
  'hr', 'ik', 'kariyer', 'career', 'careers', 'jobs', 'is', 'basvuru', 'reklam', 'ads', 'sponsorluk', 'kvkk', 'gdpr',
  'noreply', 'no', 'reply', 'newsletter', 'bulten', 'genel', 'mudurluk', 'sekreterya', 'rezervasyon', 'reservation',
  'booking', 'help', 'yardim', 'office', 'ofis', 'admin', 'webmaster', 'hello', 'merhaba', 'team', 'ekip',
  'edinme', 'sosyal', 'etik', 'veri', 'sorumlusu', 'sorumlu', 'hat', 'hatti', 'e', 'ticaret', 'eticaret', 'online', 'web',
  'iletisimi', 'basvurulari', 'talep', 'talepleri', 'sikayet', 'oneri', 'bayi', 'bayilik', 'tedarik', 'tedarikci', 'satinalma',
  'insankaynaklari', 'kalite', 'uyum', 'compliance', 'denetim', 'audit', 'guvenlik', 'security', 'bilgiislem', 'it', 'teknik',
]);

export function isGenericLocalPart(local: string): boolean {
  const raw = local.toLowerCase();
  const l = raw.replace(/[^a-z]/g, '');
  if (GENERIC_LOCAL.has(l) || GENERIC_LOCAL.has(raw)) return true;
  const tokens = translit(raw.replace(/[._-]+/g, ' ')).split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => GENERIC_TOKENS.has(t));
}

export function localPart(kind: PatternKind, ad: string, soyad: string): string {
  const a = slugName(ad);
  const s = slugName(soyad);
  switch (kind) {
    case 'ad.soyad': return `${a}.${s}`;
    case 'asoyad': return `${a.charAt(0)}${s}`;
    case 'ad_soyad': return `${a}_${s}`;
    case 'ad': return a;
    case 'soyad.ad': return `${s}.${a}`;
    case 'a.soyad': return `${a.charAt(0)}.${s}`;
    case 'adsoyad': return `${a}${s}`;
    case 'ad-soyad': return `${a}-${s}`;
  }
}

/** Bilinen bir adres + isimden hangi desenin uretildigini bul */
export function detectPattern(email: string, ad: string, soyad: string): PatternKind | null {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (!local || !ad) return null;
  for (const k of PATTERN_KINDS) {
    if (localPart(k, ad, soyad) === local) return k;
  }
  return null;
}

/**
 * Ornek adreslerden desen cikar. Isimli ornek varsa kesin (detectPattern);
 * isimsiz orneklerde yalniz ayirici karakterden cikarim (ad.soyad / a.soyad /
 * ad_soyad / ad-soyad) — asoyad ile ad ayirt edilemez, null doner.
 */
export function inferPattern(
  samples: Array<{ email: string; name?: string }>,
): { kind: PatternKind; confidence: number; evidence: string[] } | null {
  // NEDEN AGIRLIK: isimli ornek (ad+adres birlikte) kesin kanit, agirlik 2;
  // isimsiz ornek yalniz ayirici karakterden tahmin, agirlik 1. Tek isimsiz
  // ornek ("bilgi.edinme@") desen sayilmaz — iki-kaynak kurali: isimsizlerde
  // en az 2 FARKLI adres gerekir.
  const votes = new Map<PatternKind, { weight: number; evidence: string[]; named: number; nameless: number }>();
  const seen = new Set<string>();
  const vote = (k: PatternKind, ev: string, named: boolean) => {
    const cur = votes.get(k) ?? { weight: 0, evidence: [], named: 0, nameless: 0 };
    cur.weight += named ? 2 : 1;
    cur.evidence.push(ev);
    if (named) cur.named++; else cur.nameless++;
    votes.set(k, cur);
  };

  for (const s of samples) {
    const email = s.email.toLowerCase().trim();
    const local = email.split('@')[0] ?? '';
    if (!local || isGenericLocalPart(local) || seen.has(email)) continue;
    seen.add(email);
    if (s.name) {
      const { ad, soyad } = splitName(s.name);
      const k = detectPattern(email, ad, soyad);
      if (k) { vote(k, email, true); continue; }
    }
    const dot = local.split('.');
    if (dot.length === 2 && dot[0].length === 1 && dot[1].length >= 2) vote('a.soyad', email, false);
    else if (dot.length === 2 && dot[0].length >= 2 && dot[1].length >= 2) vote('ad.soyad', email, false);
    else if (local.includes('_') && local.split('_').length === 2) vote('ad_soyad', email, false);
    else if (local.includes('-') && local.split('-').length === 2) vote('ad-soyad', email, false);
  }
  if (votes.size === 0) return null;
  const total = [...votes.values()].reduce((n, v) => n + v.weight, 0);
  const [kind, best] = [...votes.entries()].sort((x, y) => y[1].weight - x[1].weight)[0];
  if (best.named === 0 && best.nameless < 2) return null; // tek isimsiz ornek yetmez
  const share = best.weight / total;
  const sufficiency = Math.min(1, best.weight / 2);
  return { kind, confidence: Math.round(share * sufficiency * 100) / 100, evidence: best.evidence };
}

/**
 * Aday adresler. Cok kelimeli ad ("Elif Yilmaz" + "Kaya" — cift soyad yaygin)
 * icin her desen once birlesik ("elifyilmaz.kaya"), sonra yalniz ilk ad
 * ("elif.kaya") ile uretilir; sira = deneme sirasi.
 */
export function candidateEmails(ad: string, soyad: string, domain: string, kinds: PatternKind[] = DEFAULT_PATTERNS): string[] {
  if (!slugName(ad) || !slugName(soyad)) return [];
  const out = new Set<string>();
  const ilkAd = ad.trim().split(/\s+/)[0];
  for (const k of kinds) {
    out.add(`${localPart(k, ad, soyad)}@${domain}`);
    if (ilkAd && slugName(ilkAd) !== slugName(ad)) out.add(`${localPart(k, ilkAd, soyad)}@${domain}`);
  }
  return [...out];
}

/** "MEHMET ALİ ÖZ" → "Mehmet Ali Öz" (Turkce I/İ farkina dikkat); zaten karisik harfliyse dokunmaz */
export function titleCaseTr(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  const allCaps = t === t.toLocaleUpperCase('tr-TR') && /[A-ZÇĞİÖŞÜ]/.test(t);
  const allLower = t === t.toLocaleLowerCase('tr-TR');
  if (!allCaps && !allLower) return t;
  return t
    .toLocaleLowerCase('tr-TR')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w))
    .join(' ');
}

// ─── SMTP sonda karar tablosu (REZERV: 04-dogrula SMTP sondasi kullanmiyor; tablo
//     ileride Jetmail/servis dogrulama sonucunu eslemek icin duruyor) ──────────

export type VerifyStatus = 'valid' | 'catch_all' | 'invalid' | 'unknown';

/**
 * rcptCode: hedef adres icin RCPT TO cevabi; randomCode: ayni alanda uydurma
 * adres icin RCPT TO cevabi (catch-all tespiti). null = sonda yapilamadi.
 *   - uydurma adres kabul (2xx) → catch_all (hedef cevabi anlamsiz)
 *   - hedef 2xx + uydurma 5xx → valid
 *   - hedef 550/551/553 → invalid
 *   - gerisi (4xx, baglanti yok, uydurma test yok) → unknown
 */
export function decideStatus(input: { rcptCode: number | null; randomCode: number | null }): VerifyStatus {
  const { rcptCode, randomCode } = input;
  if (randomCode !== null && randomCode >= 200 && randomCode < 300) return 'catch_all';
  if (rcptCode === null) return 'unknown';
  if (rcptCode >= 200 && rcptCode < 300) {
    return randomCode !== null && randomCode >= 500 ? 'valid' : 'unknown';
  }
  if (rcptCode === 550 || rcptCode === 551 || rcptCode === 553) return 'invalid';
  return 'unknown';
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      cur.push(field); field = ''; rows.push(cur); cur = [];
    } else field += c;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export function readCsv(file: string): Record<string, string>[] {
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

export function writeCsv(file: string, rows: Array<Record<string, unknown>>, columns: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCsv(rows, columns), 'utf8');
}

// ─── Ag / yardimci ──────────────────────────────────────────────────────────

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string } = {},
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      signal: ctrl.signal,
      headers: {
        'user-agent': DESKTOP_UA,
        'accept-language': 'tr-TR,tr;q=0.9,en;q=0.7',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...(opts.headers ?? {}),
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export function dedupeBy<T>(rows: T[], keyFn: (r: T) => string | null | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) { out.push(r); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const jitter = (minMs: number, maxMs: number) => minMs + Math.floor(Math.random() * (maxMs - minMs + 1));

/** `--anahtar deger` ve `--bayrak` bicimli argumanlar */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}
