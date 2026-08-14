import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

/**
 * X'in iki arama sekmesi ayri isler goruyor, ikisi de taranir:
 *
 *  - `live` ("En Son"): kronolojik. Platform degisikligi, yeni olcum,
 *    "su an su oluyor" tipi sinyal buradan gelir. Dar pencere yeterli.
 *  - `top`  ("Populer"): etkilesime gore. Duyurular, acik kaynak arac
 *    cikislari ve referans olmus threadler burada birikir — ve bunlar
 *    genellikle GUNLERCE degil AYLARCA degerli kalir. Sadece `live`
 *    taransaydi bu tur bulgular tamamen kacardi.
 */
const MODES = [
  { tab: 'live', label: 'En Son', days: 2 },
  // 180 gun: bu sekmedeki bir arac duyurusu aylarca referans olarak kalir.
  // Dar pencere (90 gun) denendi ve ISE YARAMADI — hedef ornek olarak alinan
  // "acik kaynak GEO-SEO araci" postu 124 gunlukdu ve eleniyordu.
  { tab: 'top', label: 'Populer', days: 180 },
] as const;

/**
 * Sekme basina en fazla kac post.
 *
 * 15 DENENDI VE FAZLA GELDI: her post ayrica acilip yanitlari okundugu icin
 * sekme suresi 600 saniyeyi asiyordu. Olcum (14 Agustos turu): 10 sekme
 * denemesinin 3'u zaman asimina ugradi, x-llms-txt iki sekmesini de
 * kaybedip 0 kayit dondu. Tavani yukseltmek yerine sekme basina isi
 * azaltiyoruz — tur da kisaliyor.
 */
const MAX_POSTS = 10;
/** Bir turda en fazla kac depo incelenir; her depo ekstra sayfa gezmesi demek */
const MAX_REPOS = 3;
/**
 * Post basina en fazla kac yanit alinir.
 *
 * NEDEN YANIT TOPLUYORUZ: kanit tartimi (evidence-grade.ts) destek ve
 * KARSIT kefeleri karsilastirarak hukum veriyor. Yalniz postlari okursak
 * tek yonlu destek yigini birikir; MYTH durumu hicbir zaman olusmaz.
 * "Bende calismadi", "su kosulda gecerli" ve yazarin kendi duzeltmesi
 * cogunlukla yanitlarda.
 */
const MAX_REPLIES = 8;
const DEFAULT_TIMEOUT_SEC = 420;
/** Ajan ciktisi JSON; buyumesi icin gercek bir sebep yok ama kesilmesin */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

/**
 * `openclaw agent --json` zarfi. DIKKAT: `openclaw agent exec` bambaska bir
 * zarf dondurur (duz `final` alani); bu servis gateway'e baglanan `agent`
 * yolunu kullanir, metin `result.payloads[].text` icindedir.
 */
interface OpenClawEnvelope {
  runId?: string;
  status?: 'ok' | 'error' | 'timeout';
  summary?: string;
  result?: {
    payloads?: Array<{ text?: string | null }>;
  };
  /** agent exec uyumlulugu — yol degisirse bos donmek yerine calissin */
  final?: string;
  error?: { message?: string; kind?: string };
}

interface AgentPost {
  url?: string;
  author?: string;
  title?: string;
  summary?: string;
  /** Postun kirpilmamis metni — analist bunu kullanir */
  text?: string;
  /** Kayda deger yanitlar; karsit kanit cogunlukla burada */
  replies?: Array<{ author?: string; text?: string }>;
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

    // SIRAYLA, paralel degil: tek bir Chrome ornegi var, es zamanli iki ajan
    // turu ayni sekmeleri birbirinin altindan cekerdi.
    const out: RawItem[] = [];
    const seen = new Set<string>();
    for (const mode of MODES) {
      const items = await this.searchMode(query, mode);
      for (const it of items) {
        // Ayni post iki sekmede de cikabilir; ilk goren kazanir
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        out.push(it);
      }
    }
    return out;
  }

  private async searchMode(
    query: string,
    mode: (typeof MODES)[number],
  ): Promise<RawItem[]> {
    const raw = await this.runAgent(buildPrompt(query, mode));
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

      const replies = Array.isArray(p?.replies) ? p!.replies!.slice(0, MAX_REPLIES) : [];

      out.push({
        url,
        title,
        author: str(p?.author),
        publishedAt: p?.publishedAt ? safeDate(p.publishedAt) : null,
        summary: str(p?.summary),
        engagement: Number.isFinite(p?.engagement) ? Number(p!.engagement) : null,
        // Analist bu alan doluysa URL'yi yeniden CEKMEZ. x.com oturumsuz
        // istege bos donduugu icin tek gecerli metin kaynagi burasi.
        fullText: composeFullText(str(p?.text) ?? str(p?.summary), replies),
        meta: {
          via: 'openclaw-browser',
          query,
          tab: mode.tab,
          replyCount: replies.length,
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
        meta: { via: 'openclaw-browser', query, tab: mode.tab, kind: 'repo' },
      });
    }

    this.log.log(
      `OpenClaw [${mode.label}] ${query} → ${out.length} kayit (${payload?.posts?.length ?? 0} post, ${payload?.repos?.length ?? 0} depo)`,
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

    // OTURUM SECICI ZORUNLU: seciciSIZ cagri "No target session selected" ile
    // aninda duser. OPENCLAW_AGENT verilmisse onu kullaniyoruz; verilmemisse
    // HER TUR ICIN YENI bir oturum anahtari uretiyoruz.
    //
    // Neden her tur yeni: sabit anahtar oturumu buyutur — ajan onceki
    // taramalarin tam metnini baglaminda tasir, maliyet her gun artar ve
    // eski sonuclari tekrar rapor etme egilimi dogar. Her tarama bagimsiz
    // olmali.
    if (process.env.OPENCLAW_AGENT) {
      args.push('--agent', process.env.OPENCLAW_AGENT);
    } else {
      args.push('--session-key', `ranksup-intel-${Date.now()}-${randomUUID().slice(0, 8)}`);
    }

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

    const text =
      (envelope.result?.payloads ?? [])
        .map((p) => p?.text ?? '')
        .join('')
        .trim() || envelope.final?.trim() || '';

    return text || null;
  }
}

// ────────────────────────────────────────────────────────────
//  Prompt
// ────────────────────────────────────────────────────────────

function buildPrompt(query: string, mode: (typeof MODES)[number]): string {
  const since = new Date(Date.now() - mode.days * 86_400_000).toISOString().slice(0, 10);
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=${mode.tab}`;

  return `X (Twitter) uzerinde arastirma yap ve YALNIZCA JSON dondur.

ADIMLAR
1. browser aracini kullanarak su adresi ac: ${searchUrl}
   (bu "${mode.label}" sekmesidir)
2. Sayfayi snapshot al. Gerekirse en fazla 3 kez asagi kaydirip tekrar snapshot al.
3. ${since} tarihinden yeni, en fazla ${MAX_POSTS} ilgili postu topla.
4. Her post icin postu ACIP tam metnini ve yanitlarini oku:
   - "text" alanina postun KIRPILMAMIS metnini yaz (thread ise devam
     postlarini da ekle). Ozet degil, oldugu gibi.
   - "replies" alanina en fazla ${MAX_REPLIES} KAYDA DEGER yaniti yaz.
     Kayda deger olan: itiraz, duzeltme, "bende calismadi", "su kosulda
     gecerli", ek veri, yazarin kendi ek aciklamasi.
     Kayda deger OLMAYAN: "harika", emoji, tesekkur, alakasiz sohbet.
     Kayda deger yanit yoksa bos dizi birak.
5. Postlarda GitHub deposu linki varsa en fazla ${MAX_REPOS} tanesini ayrica ac,
   README'sini ve son commit tarihini oku, ne yaptigini kendi cumlelerinle yaz.
   Post "acik kaynak yaptim / open sourced" diyor ama link gorunmuyorsa,
   yanitlara bak — depo linki cogu zaman orada olur.

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
      "text": "postun kirpilmamis tam metni",
      "replies": [
        { "author": "@baskasi", "text": "kayda deger yanitin tam metni" }
      ],
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

/**
 * Post metni + yanitlari analiste gidecek tek govdeye cevirir.
 *
 * Yanitlar ayri bir baslik altinda veriliyor ki analist bunlarin postun
 * kendi iddiasi degil, ona verilen TEPKILER oldugunu ayirt edebilsin —
 * kanit tutumunu (supports/refutes) dogru atamasi buna bagli.
 */
function composeFullText(
  text: string | null,
  replies: Array<{ author?: string; text?: string }>,
): string | null {
  if (!text) return null;
  const clean = replies
    .map((r) => {
      const t = str(r?.text);
      if (!t) return null;
      const who = str(r?.author);
      return who ? `${who}: ${t}` : t;
    })
    .filter((x): x is string => x !== null);

  if (clean.length === 0) return text;
  return `${text}\n\n--- YANITLAR ---\n${clean.join('\n')}`;
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
