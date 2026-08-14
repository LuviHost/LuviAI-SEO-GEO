import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { parseJsonFromLlm } from '../common/safe-json.js';
import type { RawItem } from './collector.service.js';

/**
 * OpenClaw destekli X (Twitter) toplayici — GERCEK tarayici ile.
 *
 * NEDEN GEREKTI: XSearchService xAI Live Search'e baglidir; anahtar yoksa
 * X kaynaklari komple sessiz kalir. Ayrica Live Search bize modelin
 * ozetini verir — postun ALTINDAKI linke, oradaki GitHub deposuna hicbir
 * zaman bakmaz. Oysa X'te degerli olan sey cogu zaman postun kendisi
 * degil, isaret ettigi depo/olcum/arac oluyor.
 *
 * NASIL CALISIR: sunucuda ayakta duran OpenClaw gateway'ine tek bir ajan
 * turu gonderiyoruz. Ajan `browser` araciyla X'in arama sayfasini aciyor,
 * gorunen postlari okuyor, icindeki GitHub linklerini takip edip depoyu
 * inceliyor ve bize tek bir JSON donduruyor.
 *
 * NEDEN CLI: gateway'in WS RPC'si daha zengin ama `openclaw agent --json`
 * kararli bir zarf (envelope) sozu veriyor ve tek process cagrisi. API
 * host uzerinde calistigi icin (docker-compose'da yalniz mysql+redis var)
 * shell-out en az hareketli parcaya sahip yol.
 *
 * OTURUM NEREDEN GELIYOR: sunucuda X'e login OLMUYORUZ — datacenter
 * IP'sinden giris neredeyse kesin dogrulama duvarina takilir. Bunun
 * yerine oturum cerezleri gelistirici makinesinden
 * `openclaw browser cookie-sync --domains x.com --into <profil>` ile
 * gateway'deki yonetilen profile itiliyor. Ayrintili kurulum:
 * docs/OPENCLAW-KURULUM.md
 *
 * KAPALIYSA: sessizce bos doner, collector xAI yoluna duser. Bu servis
 * hicbir zaman zorunlu bagimlilik degildir.
 */

/** Sorgu basina en fazla kac post — tur suresi ve gurultu freni */
const MAX_POSTS = 15;
/** Bir turda en fazla kac depo incelenir; her depo ekstra sayfa gezmesi demek */
const MAX_REPOS = 3;
/** Kac gun geriye bakilir — gunluk cekimde 2 gun guvenli ust sinir */
const LOOKBACK_DAYS = 2;
const DEFAULT_TIMEOUT_SEC = 420;
/** Ajan ciktisi JSON; buyumesi icin gercek bir sebep yok ama kesilmesin */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

interface OpenClawEnvelope {
  ok?: boolean;
  status?: 'ok' | 'error' | 'timeout';
  final?: string;
  error?: { message?: string; kind?: string };
}

interface AgentPost {
  url?: string;
  author?: string;
  title?: string;
  summary?: string;
  publishedAt?: string;
  engagement?: number;
  repoUrls?: string[];
}

interface AgentRepo {
  url?: string;
  name?: string;
  whatItDoes?: string;
  whyItMatters?: string;
  stars?: number;
  lastCommit?: string;
}

interface AgentPayload {
  posts?: AgentPost[];
  repos?: AgentRepo[];
}

@Injectable()
export class OpenClawService {
  private readonly log = new Logger(OpenClawService.name);
  private warnedDisabled = false;

  /**
   * Acik olmasi ICIN acikca istenmis olmasi gerekir. Sebep: bu yol bir
   * tarayici surecini ve canli bir X oturumunu varsayar; yanlislikla acik
   * kalirsa her tur 400 saniye bekleyip bos doner.
   */
  get enabled(): boolean {
    return process.env.OPENCLAW_ENABLED === '1';
  }

  /**
   * Bir X arama sorgusunu tarayicidan gecirir.
   *
   * Donen dizi HEM postlari HEM de postlardan kesfedilen depolari icerir:
   * bir depo, hakkinda konusulan postan bagimsiz olarak kendi basina bir
   * bulgudur ve triage/analyst zincirinde ayrica degerlendirilmelidir.
   */
  async search(query: string): Promise<RawItem[]> {
    if (!this.enabled) {
      if (!this.warnedDisabled) {
        this.log.warn('OPENCLAW_ENABLED=1 degil — OpenClaw yolu atlaniyor');
        this.warnedDisabled = true;
      }
      return [];
    }

    const raw = await this.runAgent(buildPrompt(query));
    if (!raw) return [];

    let payload: AgentPayload;
    try {
      payload = parseJsonFromLlm<AgentPayload>(raw);
    } catch (err: any) {
      this.log.warn(`OpenClaw yaniti JSON'a cevrilemedi (${query}): ${err.message}`);
      return [];
    }

    const out: RawItem[] = [];
    const seen = new Set<string>();

    for (const p of payload?.posts ?? []) {
      const url = typeof p?.url === 'string' ? p.url.trim() : '';
      const title = typeof p?.title === 'string' ? p.title.trim() : '';
      if (!url || !title) continue;
      // Ajanin uydurdugu bir adres olmadigini kanitlayan tek ucuz kontrol:
      // gercek bir X status adresi mi? Tarayicidan geldigi icin bunun
      // disinda halusinasyon riski dusuk ama sifir degil.
      if (!statusIdOf(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({
        url,
        title,
        author: str(p?.author),
        publishedAt: p?.publishedAt ? safeDate(p.publishedAt) : null,
        summary: str(p?.summary),
        engagement: Number.isFinite(p?.engagement) ? Number(p!.engagement) : null,
        meta: {
          via: 'openclaw-browser',
          query,
          repoUrls: Array.isArray(p?.repoUrls) ? p!.repoUrls!.slice(0, MAX_REPOS) : [],
        },
      });
    }

    for (const r of payload?.repos ?? []) {
      const url = typeof r?.url === 'string' ? r.url.trim() : '';
      if (!url || !/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const name = str(r?.name) ?? url.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
      const what = str(r?.whatItDoes);
      if (!what) continue;

      out.push({
        url,
        title: `${name} — ${what}`,
        author: name.split('/')[0] ?? null,
        publishedAt: r?.lastCommit ? safeDate(r.lastCommit) : null,
        summary: [what, str(r?.whyItMatters)].filter(Boolean).join(' '),
        engagement: Number.isFinite(r?.stars) ? Number(r!.stars) : null,
        meta: { via: 'openclaw-browser', query, kind: 'repo' },
      });
    }

    this.log.log(
      `OpenClaw [${query}] → ${out.length} kayit (${payload?.posts?.length ?? 0} post, ${payload?.repos?.length ?? 0} depo)`,
    );
    return out;
  }

  // ────────────────────────────────────────────────────────────
  //  CLI cagrisi
  // ────────────────────────────────────────────────────────────

  /**
   * Tek ajan turu calistirir, zarfin `final` alanini dondurur.
   *
   * Hata durumunda FIRLATMAZ, null doner: collector'un kaynak-devre-disi
   * sayaci OpenClaw'in gecici tarayici hatalari yuzunden X kaynaklarini
   * kalici kapatmasin diye. Gercek arizayi loglar gosterir.
   */
  private async runAgent(prompt: string): Promise<string | null> {
    const bin = process.env.OPENCLAW_BIN ?? 'openclaw';
    const timeoutSec = Number(process.env.OPENCLAW_TIMEOUT_SEC ?? DEFAULT_TIMEOUT_SEC);

    const args = ['agent', '--message', prompt, '--json', '--timeout', String(timeoutSec)];
    if (process.env.OPENCLAW_AGENT) args.push('--agent', process.env.OPENCLAW_AGENT);
    if (process.env.OPENCLAW_GATEWAY_URL) args.push('--url', process.env.OPENCLAW_GATEWAY_URL);
    if (process.env.OPENCLAW_TOKEN) args.push('--token', process.env.OPENCLAW_TOKEN);

    const envelope = await new Promise<OpenClawEnvelope | null>((resolve) => {
      let stdout = '';
      let stderr = '';
      let done = false;

      const finish = (v: OpenClawEnvelope | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };

      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      // CLI kendi --timeout'unu uyguluyor; bu ondan genis olan disaridan
      // fren. Surec takilirsa toplayici turu sonsuza kadar beklemesin.
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        this.log.warn(`OpenClaw ajani ${timeoutSec + 60}s icinde bitmedi — olduruldu`);
        finish(null);
      }, (timeoutSec + 60) * 1000);

      proc.stdout.on('data', (c: Buffer) => {
        if (stdout.length < MAX_STDOUT_BYTES) stdout += c.toString('utf8');
      });
      proc.stderr.on('data', (c: Buffer) => {
        if (stderr.length < 8000) stderr += c.toString('utf8');
      });

      proc.on('error', (e: Error) => {
        this.log.warn(`OpenClaw calistirilamadi (${bin}): ${e.message}`);
        finish(null);
      });

      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          this.log.warn(`OpenClaw cikis kodu ${code}: ${stderr.slice(0, 300)}`);
        }
        if (!stdout.trim()) return finish(null);
        try {
          // --json stdout'u tek bir JSON belgesine ayirir; yine de
          // onsoz/sonsoz ihtimaline karsi ayiklayarak parse ediyoruz.
          finish(parseJsonFromLlm<OpenClawEnvelope>(stdout));
        } catch (e: any) {
          this.log.warn(`OpenClaw zarfi okunamadi: ${e.message}`);
          finish(null);
        }
      });
    });

    if (!envelope) return null;
    if (envelope.status && envelope.status !== 'ok') {
      this.log.warn(
        `OpenClaw turu basarisiz (${envelope.status}): ${envelope.error?.message ?? 'sebep yok'}`,
      );
      return null;
    }
    return envelope.final?.trim() || null;
  }
}

// ────────────────────────────────────────────────────────────
//  Prompt
// ────────────────────────────────────────────────────────────

function buildPrompt(query: string): string {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  // `f=live` = "En Son" sekmesi. Varsayilan "Populer" sekmesi eski ama cok
  // etkilesim almis postlari one cikarir; biz TAZELIK istiyoruz.
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;

  return `X (Twitter) uzerinde arastirma yap ve YALNIZCA JSON dondur.

ADIMLAR
1. browser aracini kullanarak su adresi ac: ${searchUrl}
2. Sayfayi snapshot al. Gerekirse en fazla 3 kez asagi kaydirip tekrar snapshot al.
3. ${since} tarihinden yeni, en fazla ${MAX_POSTS} ilgili postu topla.
4. Postlarda GitHub deposu linki varsa en fazla ${MAX_REPOS} tanesini ayrica ac,
   README'sini ve son commit tarihini oku, ne yaptigini kendi cumlelerinle yaz.

NEYI AL
- Veri, olcum, test sonucu, platform degisikligi, somut deneyim iceren postlar.
- Yeni cikmis arac/depo duyurulari.

NEYI ALMA
- Reklam, is ilani, jenerik motivasyon, "thread yazdim linke tikla" tarzi tanitim.
- Sponsorlu/Promoted isaretli gonderiler.
- Tarihi ${since} oncesi olan postlar.

KURALLAR
- Yalnizca sayfada GERCEKTEN gordugun postlari yaz. Hicbir adres veya sayi uydurma.
- url alani tam post adresi olmali: https://x.com/<kullanici>/status/<id>
- Sayfa acilmazsa, giris ekrani cikarsa veya sonuc yoksa bos yapiyi dondur.

CIKTI (baska hicbir metin yazma)
{
  "posts": [
    {
      "url": "https://x.com/kullanici/status/123",
      "author": "@kullanici",
      "title": "postun ozunu veren tek cumle",
      "summary": "postun icerigi, 2-3 cumle",
      "publishedAt": "2026-08-13",
      "engagement": 250,
      "repoUrls": ["https://github.com/sahip/depo"]
    }
  ],
  "repos": [
    {
      "url": "https://github.com/sahip/depo",
      "name": "sahip/depo",
      "whatItDoes": "deponun ne yaptigi, tek cumle",
      "whyItMatters": "SEO/GEO/ASO tarafinda bizim icin neden onemli, tek cumle",
      "stars": 1200,
      "lastCommit": "2026-08-12"
    }
  ]
}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** x.com/u/status/123 → "123". Alan adi ve sorgu parametreleri degisken, id sabit. */
function statusIdOf(url: string): string | null {
  const m = /(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i.exec(url);
  return m ? m[1] : null;
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
