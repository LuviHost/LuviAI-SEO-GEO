import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { RawItem } from './collector.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  classifyHref, urlsInText, canonicalizeUrl, sourceKeyForUrl, parseCurationTarget,
  splitThread, renderThread, type ThreadRow,
} from './x-curation-links.js';

/**
 * X kurasyonu — kisisel "kaynak kutusu"nu OpenClaw tarayicisiyla okur.
 *
 * NE: Kullanici SEO/GEO ile ilgili gonderileri X'te YER ISARETLERINE ekler
 * (x.com/i/bookmarks — Premium'da klasor URL'si de olur). Bu servis o sayfayi
 * OpenClaw'in yonettigi, oturumu acik Chrome'da acar, gonderileri ve
 * icindeki linkleri toplar.
 *
 * NEDEN DM DEGIL: 2026-08-27'de denendi — X'in yeni XChat'i uctan uca sifreli;
 * cerez senkronuyla acilan oturumda sohbet "Disconnected / mesajlar
 * yuklenemedi" kaliyor, anahtarlar kullanicinin cihazinda. Yer isaretleri
 * sayfasi sifresiz, ayni oturumla ilk denemede okundu.
 *
 * MALIYET: SIFIR LLM. `openclaw agent` KULLANILMAZ; yalniz `openclaw browser
 * open/evaluate/close` — deterministik DOM okuma. X API'ye gerek yok.
 * Tek bagimlilik: sunucudaki yonetilen profilde canli X oturumu
 * (docs/OPENCLAW-KURULUM.md §8, `node scripts/x-oturum-aktar.mjs`).
 *
 * ATIF: gonderi KAYNAK degil, KESIF KANALI. Isaret ettigi makale kendi
 * yayincisina (meta.attributeTo) yazilir — iki-kaynak kurali bozulmaz.
 * Yayinci katalogda yoksa x-curated (community, dusuk agirlik).
 *
 * KABUL EDILEN RISK: otomasyonla okumak X kosullarina aykiri; gunde tek
 * sayfa yuklemesi ama hesap askiya alinabilir — kullanici bilgilendirildi.
 */

const DEFAULT_TIMEOUT_MS = 45_000;
const SETTLE_MS = 5_000;
const SCROLL_ROUNDS = 5;
const MAX_LINKS_PER_PAGE = 80;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 200_000;
/** Bir turda en fazla kac YENI gonderi sayfasi acilir (her biri ~15 sn) */
const MAX_THREADS_PER_RUN = 15;
/** Gonderi sayfasinda kac kaydirma adimi — sanal liste ana gonderiyi dusurmeden once her adimda toplanir */
const THREAD_SCROLL_STEPS = 4;

/** Sayfada calisan cikarim — string olarak gonderilir, --fn ile evaluate edilir */
const EXTRACT_FN = `() => {
  const wall = /Continue with phone|Telefonla devam|Sign in to X|X'e giriş yap/i.test(document.body.innerText || '');
  const loggedIn = !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  const scope = document.querySelectorAll('article').length > 0 ? [...document.querySelectorAll('article')] : [document.body];
  const links = [];
  for (const el of scope) for (const a of el.querySelectorAll('a[href]')) links.push({ href: a.href, text: (a.innerText || '').slice(0, 160) });
  return { loggedIn, wall, url: location.href, count: links.length, links: links.slice(0, 600) };
}`;
/** "Yer Isaretleri" / "Bookmarks" sekmesine tikla (Gecmis sayfasi iki sekmeli) */
const CLICK_TAB_FN = `() => { const tab = [...document.querySelectorAll('a[role="tab"],[role="tab"]')].find((e) => /^(Yer İşaretleri|Bookmarks)$/i.test((e.innerText || '').trim())); if (tab) tab.click(); return { clicked: !!tab }; }`;
/** Adi verilen klasor cipine tikla — cip <a> degil, tiklanabilir DIV */
const clickFolderFn = (name: string) => `() => { const want = ${JSON.stringify(name)}.toLowerCase(); const el = [...document.querySelectorAll('span,div,button,a')].find((e) => (e.innerText || '').trim().toLowerCase() === want); if (!el) return { found: false }; let c = el; for (let i = 0; i < 6 && c && !(c.matches && c.matches('a,button,[role="button"],[role="link"],[tabindex]')); i++) c = c.parentElement; (c || el).click(); return { found: true }; }`;
/**
 * Gonderi sayfasi: her article'dan yazar, status URL, metin (kisaltilmis
 * "Daha fazla goster" once acilir), dis linkler. Sayfa sanal liste — ana
 * gonderi asagi kaydirinca DOM'dan dusuyor; cagiran her adimda biriktirir.
 */
const THREAD_EXTRACT_FN = `() => {
  for (const e of document.querySelectorAll('[data-testid="tweet-text-show-more-link"]')) { try { e.click(); } catch {} }
  const arts = [...document.querySelectorAll('article')];
  return arts.map((a) => {
    const u = a.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const st = [...a.querySelectorAll('a[href]')].map((x) => x.getAttribute('href')).find((h) => /^\\/[A-Za-z0-9_]+\\/status\\/[0-9]+$/.test(h || '')) || null;
    const txt = (a.querySelector('[data-testid="tweetText"]') || {}).innerText || '';
    const links = [...new Set([...a.querySelectorAll('a[href]')].map((x) => x.href).filter((h) => /t\\.co\\//.test(h) || /^https?:\\/\\/(?!(x|twitter)\\.com)/.test(h)))];
    return { user: u ? u.getAttribute('href') : null, st, text: txt, links };
  });
}`;
const SCROLL_STEP_FN = `() => { window.scrollBy(0, window.innerHeight * 1.5); return window.scrollY; }`;
/** Sanal liste: asagi kaydirdikca eski gonderiler gelir */
const SCROLL_DOWN_FN = `() => { window.scrollTo(0, document.body.scrollHeight); return document.body.scrollHeight; }`;

interface ExtractResult {
  loggedIn: boolean;
  wall: boolean;
  url: string;
  count: number;
  links: Array<{ href: string; text: string }>;
}

@Injectable()
export class XCurationService {
  private readonly log = new Logger(XCurationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** OPENCLAW_ENABLED'dan AYRI bayrak: LLM'li arama yolu kapaliyken kurasyon acik olabilsin */
  get enabled(): boolean {
    return process.env.OPENCLAW_X_CURATION_ENABLED === '1';
  }

  /**
   * target: virgulle ayrilmis sayfa URL'leri (varsayilan x.com/i/bookmarks;
   * Premium klasor: x.com/i/bookmarks/<klasorId>). Hata durumunda FIRLATIR —
   * collector kaynagin lastError alanina yazar, admin panelde gorunur.
   */
  async collect(target: string): Promise<RawItem[]> {
    if (!this.enabled) return [];
    const pages = target.split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
    // Not: hash (#folder=...) split'ten etkilenmez — virgul yalniz sayfa ayirici
    if (pages.length === 0) throw new Error('Kurasyon sayfasi yok (target bos veya URL degil)');

    const out: RawItem[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const links = await this.readPageLinks(page);
      const items = await this.linksToItems(links, page);
      for (const it of items) {
        const key = canonicalizeUrl(it.url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
    }
    this.log.log(`X kurasyonu: ${pages.length} sayfa → ${out.length} kayit`);
    return out;
  }

  // ── Tarayici ────────────────────────────────────────────────

  private async readPageLinks(target: string): Promise<Array<{ href: string; text: string }>> {
    const { url, folder } = parseCurationTarget(target);
    const opened = await this.browser<{ tabId?: string; targetId?: string }>(['open', url]);
    const tab = opened?.tabId ?? opened?.targetId;
    try {
      await sleep(SETTLE_MS);
      if (folder) {
        // Klasor URL'si soguk yuklemede hata veriyor — sekme + klasor adi tiklanir
        await this.browser(['evaluate', '--fn', CLICK_TAB_FN]);
        await sleep(3_000);
        const hit = await this.browser<{ result?: { found?: boolean } }>(['evaluate', '--fn', clickFolderFn(folder)]);
        if (!hit?.result?.found) {
          throw new Error(`Yer isareti klasoru bulunamadi: "${folder}" — X'te klasor adi degisti mi?`);
        }
        await sleep(6_000);
      }
      // Gecmisi yukle: liste sanal — asagi kaydirdikca eski gonderiler gelir
      for (let i = 0; i < SCROLL_ROUNDS; i++) {
        await this.browser(['evaluate', '--fn', SCROLL_DOWN_FN]);
        await sleep(1_500);
      }
      const res = await this.browser<{ result?: ExtractResult }>(['evaluate', '--fn', EXTRACT_FN]);
      const r = res?.result;
      if (!r) throw new Error('Sayfa okunamadi (evaluate bos dondu)');
      if (r.wall || !r.loggedIn) {
        throw new Error('X oturumu yok — sunucudaki profil giris duvarinda. Mac\'te: OPENCLAW_HOST=luvi108 node scripts/x-oturum-aktar.mjs');
      }
      return r.links;
    } finally {
      if (tab) await this.browser(['close', tab]).catch(() => undefined);
    }
  }

  /**
   * Gonderi sayfasini acip yazarin devam gonderilerini (1/ 2/ 3/) ve
   * one cikan yanitlari toplar — LLM yok. Basarisizlikta null (cagiran
   * fxtwitter'a duser).
   */
  private async readThread(statusUrl: string) {
    let tab: string | undefined;
    try {
      const opened = await this.browser<{ tabId?: string; targetId?: string }>(['open', statusUrl]);
      tab = opened?.tabId ?? opened?.targetId;
      await sleep(SETTLE_MS + 2_000);
      const rows: ThreadRow[] = [];
      for (let i = 0; i < THREAD_SCROLL_STEPS; i++) {
        const res = await this.browser<{ result?: ThreadRow[] }>(['evaluate', '--fn', THREAD_EXTRACT_FN]);
        if (Array.isArray(res?.result)) rows.push(...res.result);
        await this.browser(['evaluate', '--fn', SCROLL_STEP_FN]);
        await sleep(1_500);
      }
      const split = splitThread(rows, statusUrl);
      if (split.thread.length === 0) return null; // ana gonderi okunamadi (silinmis/gizli)
      return split;
    } catch (err: any) {
      this.log.warn(`Thread okunamadi (${statusUrl}): ${err.message}`);
      return null;
    } finally {
      if (tab) await this.browser(['close', tab]).catch(() => undefined);
    }
  }

  /** Bu gonderi daha once islendi mi (kendisi kayit ya da bir makalenin tweetUrl'i) */
  private async alreadyIngested(statusUrl: string): Promise<boolean> {
    const hit = await this.prisma.intelItem.findFirst({
      where: { OR: [{ url: statusUrl }, { meta: { path: '$.tweetUrl', equals: statusUrl } }] },
      select: { id: true },
    });
    return !!hit;
  }

  private browser<T = any>(args: string[]): Promise<T | null> {
    const bin = process.env.OPENCLAW_BIN ?? 'openclaw';
    const full = ['browser', ...args, '--json', '--timeout', String(DEFAULT_TIMEOUT_MS)];
    if (process.env.OPENCLAW_GATEWAY_URL) full.push('--url', process.env.OPENCLAW_GATEWAY_URL);
    if (process.env.OPENCLAW_TOKEN) full.push('--token', process.env.OPENCLAW_TOKEN);
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(bin, full, { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`openclaw browser ${args[0]} zaman asimi`)); }, DEFAULT_TIMEOUT_MS + 15_000);
      proc.stdout.on('data', (c: Buffer) => { if (stdout.length < 4_000_000) stdout += c.toString('utf8'); });
      proc.stderr.on('data', (c: Buffer) => { if (stderr.length < 8_000) stderr += c.toString('utf8'); });
      proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`openclaw calistirilamadi (${bin}): ${e.message}`)); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`openclaw browser ${args[0]} cikis ${code}: ${stderr.slice(0, 300)}`));
        const s = stdout.trim();
        if (!s) return resolve(null);
        const start = s.indexOf('{');
        try { resolve(JSON.parse(start >= 0 ? s.slice(start) : s)); } catch { resolve(null); }
      });
    });
  }

  // ── Link → kayit ────────────────────────────────────────────

  private async linksToItems(links: Array<{ href: string; text: string }>, page: string): Promise<RawItem[]> {
    const candidates: Array<{ url: string; context: string; tweetUrl?: string; publishedAt?: Date | null }> = [];
    const tweetIds = new Set<string>();
    const tcos = new Set<string>();
    const ctx = new Map<string, string>();

    for (const l of links.slice(0, MAX_LINKS_PER_PAGE * 3)) {
      const c = classifyHref(l.href);
      if (c.kind === 'tweet' && c.statusId) tweetIds.add(c.statusId);
      else if (c.kind === 'tco') { tcos.add(l.href); ctx.set(l.href, l.text); }
      else if (c.kind === 'external') candidates.push({ url: l.href, context: l.text });
    }

    // t.co → gercek URL (yonlendirme takibi, LLM yok)
    for (const t of tcos) {
      const resolved = await this.resolveRedirect(t);
      if (!resolved) continue;
      const c = classifyHref(resolved);
      if (c.kind === 'tweet' && c.statusId) tweetIds.add(c.statusId);
      else if (c.kind === 'external') candidates.push({ url: resolved, context: ctx.get(t) ?? '' });
    }

    // Gonderi → devam gonderileri + yanitlar (tarayici, LLM yok); tarayici
    // basarisizsa fxtwitter (anahtarsiz) tek gonderiyle yetinir.
    // Daha once islenen gonderi sayfasi yeniden acilmaz (her acilis ~15 sn).
    let opened = 0;
    for (const id of [...tweetIds].slice(0, MAX_LINKS_PER_PAGE)) {
      const statusUrl = [...links].map((l) => classifyHref(l.href)).find((c) => c.statusId === id)?.href
        ?? `https://x.com/i/status/${id}`;
      if (await this.alreadyIngested(statusUrl)) continue;

      let text = '';
      let tweetUrl = statusUrl;
      let publishedAt: Date | null = null;
      const rawLinks = new Set<string>();

      const split = opened < MAX_THREADS_PER_RUN ? await this.readThread(statusUrl) : null;
      if (split) {
        opened++;
        text = renderThread(split);
        tweetUrl = split.thread[0].url;
        for (const t of split.thread) for (const l of t.links) rawLinks.add(l);
        for (const u of urlsInText(split.thread.map((t) => t.text).join(' '))) rawLinks.add(u);
      } else {
        const tw = await this.fetchTweet(id);
        if (!tw) continue;
        text = tw.text; tweetUrl = tw.url; publishedAt = tw.createdAt;
        for (const u of urlsInText(tw.text)) rawLinks.add(u);
      }

      const found: string[] = [];
      for (const u of rawLinks) {
        const r = u.includes('//t.co/') ? await this.resolveRedirect(u) : u;
        if (r && classifyHref(r).kind === 'external') found.push(r);
      }
      if (found.length === 0) {
        // Link icermeyen gonderi: gonderinin kendisi kayit (dusuk agirlikli kova); thread + yanitlar fullText'te
        candidates.push({ url: tweetUrl, context: text, tweetUrl, publishedAt });
      } else {
        for (const f of found) candidates.push({ url: f, context: text, tweetUrl, publishedAt });
      }
    }

    const items: RawItem[] = [];
    const seen = new Set<string>();
    for (const c of candidates.slice(0, MAX_LINKS_PER_PAGE)) {
      const url = canonicalizeUrl(c.url);
      if (seen.has(url)) continue;
      seen.add(url);
      const isTweet = classifyHref(url).kind === 'tweet';
      const attributeTo = isTweet ? null : sourceKeyForUrl(url);
      const title = isTweet ? c.context.slice(0, 200) : (await this.fetchTitle(url)) ?? c.context.slice(0, 200) ?? url;
      items.push({
        url,
        title: (title || url).slice(0, 500),
        summary: c.context ? c.context.slice(0, 1000) : null,
        publishedAt: c.publishedAt ?? null,
        // Gonderi kaydinda tam metin (thread + yanitlar) analistin okudugu sey;
        // makale kaydinda makale yeniden cekilir, thread yalniz summary'de baglam.
        fullText: isTweet ? c.context : null,
        meta: { via: 'x-curation', page, tweetUrl: c.tweetUrl ?? null, attributeTo },
      });
    }
    return items;
  }

  private async resolveRedirect(url: string): Promise<string | null> {
    let cur = url;
    for (let hop = 0; hop < 5; hop++) {
      try {
        const res = await fetch(cur, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'RanksUpIntel/1.0' } });
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
        return cur;
      } catch {
        return hop === 0 ? null : cur;
      }
    }
    return cur;
  }

  private async fetchTweet(id: string): Promise<{ url: string; text: string; createdAt: Date | null } | null> {
    try {
      const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'RanksUpIntel/1.0' } });
      if (!res.ok) return null;
      const j: any = await res.json();
      const t = j?.tweet;
      if (!t) return null;
      const quoted = t.quote?.text ? `\n\nAlinti: ${t.quote.text}` : '';
      return {
        url: t.url ?? `https://x.com/i/status/${id}`,
        text: `${t.text ?? ''}${quoted}`.trim(),
        createdAt: t.created_at ? new Date(t.created_at) : null,
      };
    } catch {
      return null;
    }
  }

  private async fetchTitle(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanksUpIntel/1.0)' } });
      if (!res.ok) return null;
      const reader = res.body?.getReader();
      if (!reader) return null;
      let html = '';
      while (html.length < MAX_HTML_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        html += Buffer.from(value).toString('utf8');
        if (/<\/title>/i.test(html)) break;
      }
      reader.cancel().catch(() => undefined);
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
