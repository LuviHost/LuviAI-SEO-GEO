import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PLANS, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, VIDEOS_PER_MONTH, findPlan, type BasePlan } from '../billing/plans.js';
import { MEASUREMENT_WINDOW_MS } from '../billing/measurement-allowance.js';
import { TRIAL_DAYS } from '../billing/trial-policy.js';
import { RANKSUP_BOT_UA } from '../common/safe-fetch.js';
import { McpToolsService } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { REFERRAL_LABEL_KEEP, REFERRAL_LABEL_MAX, referralLabel } from '../affiliate/referral-label.js';
import { publishTargetCatalog } from '../publish-targets/publish-target-catalog.js';
import { EXPORT_TARGET_TYPES } from '../articles/republish-policy.js';
import {
  AGENT_SETUP_URL,
  DEFAULT_API_ORIGIN,
  SERVER_CARD_CATALOG_ID,
  SERVER_CARD_MEDIA_TYPE,
  SERVER_CARD_NAME,
  buildProtectedResourceMetadata,
  mcpEndpointUrl,
  protectedResourceMetadataUrl,
  serverCardUrl,
} from './mcp-discovery.js';

/**
 * Herkese acik ajan belgeleri (apps/web/public) kodla AYNI kalmali.
 *
 * NEDEN VAR: llms.txt "Mayis 2026" fiyatlariyla (₺1.499 / $37 ...) aylarca
 * yayinda kaldi; plans.ts ise Agustos'ta USD bazina gecmisti. AI asistanlari
 * bu dosyayi okuyup musteriye YANLIS fiyat soyluyordu. Fiyat, plan kapisi,
 * MCP adresi ve bot kimligi degisince bu test kirilir; belge ayni committe
 * duzeltilir.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/src/mcp -> apps/web/public */
const WEB_PUBLIC = path.resolve(HERE, '../../../web/public');
const WEB_SRC = path.resolve(HERE, '../../../web/src');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const llms = read(path.join(WEB_PUBLIC, 'llms.txt'));
const llmsFull = read(path.join(WEB_PUBLIC, 'llms-full.txt'));
const setup = read(path.join(WEB_PUBLIC, 'agent-setup.txt'));

/** "1.490" -> 1490 (Turkce binlik ayirici) */
const sayi = (s: string) => Number(s.replace(/\./g, ''));

function fiyatBolumu(md: string): string {
  const start = md.indexOf('## Fiyatlandırma');
  if (start === -1) throw new Error('"## Fiyatlandırma" bolumu yok');
  const rest = md.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

interface FiyatSatiri {
  ad: string; aylik: number; yillik: number | null; makale: number; enFazla: boolean; calistirma: number;
  site: number; uygulama: number; destek: string; satir: string;
}

// Her satir haftalik olcum hakkini ("haftada 1 AI olcumu") tasimak ZORUNDA: eski
// satir yalniz "20 gorunurluk calistirmasi/ay" diyordu ve AI asistanlari bunu
// "ayda 20 olcum" diye aktariyordu (measurement-allowance.ts: 7 gunde 1).
const SATIR = /^- \*\*(.+?)\*\*[^:\n]*: \$([\d.]+)(?:\/ay, yıllık \$([\d.]+))? — ([\d.]+) AI makale(?:\/ay)?, haftada 1 AI ölçümü, (en fazla )?([\d.]+) görünürlük çalıştırması(?:\/ay)?, (\d+) site, (\d+) izlenen uygulama · destek: ([^·\n]+)/gm;

function fiyatSatirlari(bolum: string): FiyatSatiri[] {
  return [...bolum.matchAll(SATIR)].map((m) => ({
    ad: m[1], aylik: sayi(m[2]), yillik: m[3] ? sayi(m[3]) : null, makale: sayi(m[4]), enFazla: !!m[5],
    calistirma: sayi(m[6]), site: Number(m[7]), uygulama: Number(m[8]), destek: m[9].trim(), satir: m[0],
  }));
}

// llms-full.txt de ayni fiyat bolumunu tasir: "Mayis 2026" TL fiyatlariyla aylarca
// bayat kalmisti (Iyzico, video paketi, kaldirilmis moduller). Ikisi ayni testten gecer.
describe.each([
  ['llms.txt', llms],
  ['llms-full.txt', llmsFull],
])('%s fiyatlari = plans.ts', (_ad, doc) => {
  const bolum = fiyatBolumu(doc);
  const satirlar = fiyatSatirlari(bolum);

  it('her plan tam bir kez listelenmis, fazladan plan yok', () => {
    expect(satirlar.map((s) => s.ad).sort()).toEqual(BASE_PLANS.map((p) => p.name_tr).sort());
  });

  it('fiyat ve limitler plans.ts ile birebir ayni', () => {
    for (const p of BASE_PLANS) {
      const s = satirlar.find((x) => x.ad === p.name_tr)!;
      expect(s.aylik, `${p.id} aylik`).toBe(p.monthly_usd);
      expect(s.yillik, `${p.id} yillik`).toBe(p.monthly_usd === 0 ? null : p.annual_usd);
      expect(s.makale, `${p.id} makale`).toBe(p.articlesPerMonth);
      expect(s.calistirma, `${p.id} calistirma`).toBe(p.aiRunsPerMonth);
      // Ucretli planda sayi bir TAVAN (QuotaService citationTests); haftalik hak
      // ayrica gecerli oldugu icin "ayda 75 olcum" gibi okunmamali.
      expect(s.enFazla, `${p.id} "en fazla"`).toBe(p.id !== 'trial');
      expect(s.site, `${p.id} site`).toBe(p.sites);
      expect(s.uygulama, `${p.id} uygulama`).toBe(p.trackedApps);
      expect(s.destek, `${p.id} destek`).toBe(p.support_tr);
      if (p.popular) expect(s.satir).toContain('en çok tercih edilen');
      if (p.contactSales) expect(s.satir).toContain('satış ekibiyle');
    }
  });

  it('sabit TL fiyati yok — TL her gun TCMB kuruyla hesaplaniyor (FxService)', () => {
    expect(bolum).not.toMatch(/₺|\bTL\s*\d|\d\s*TL\b/);
    expect(bolum).toMatch(/TCMB/);
  });

  it('"10 ay fiyatina 12 ay" iddiasi plans.ts ile tutarli', () => {
    expect(doc).toContain('10 ay fiyatına 12 ay');
    for (const p of BASE_PLANS.filter((x) => x.monthly_usd > 0)) {
      expect(p.annual_usd, p.id).toBe(p.monthly_usd * 10);
    }
  });

  it('haftalik olcum kurali ve calistirma birimi fiyat bolumunde (hesap basina, siteler ortak)', () => {
    // Eski aciklama "Gorunurluk calistirmasi: AI atif testi ya da Prompt Lab
    // olcumu; ikisi ayni aylik haktan duser" idi: haftalik kural yoktu ve tek
    // Prompt Lab olcumunun soru basina calistirma harcadigi yazmiyordu.
    expect(MEASUREMENT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(bolum).toContain('hesap başına 7 günde 1');
    expect(bolum).toContain('tüm siteler bu hakkı paylaşır');
    expect(bolum).toContain("AI testi 1, Prompt Lab'de her soru ve her dal 1 çalıştırma");
    expect(bolum).toContain('sonuç vermeyen ölçüm hakkı yakmaz');
    expect(bolum).not.toContain('ikisi aynı aylık haktan düşer');
  });
});

describe('MCP belgeleri = kod', () => {
  const endpoint = mcpEndpointUrl(DEFAULT_API_ORIGIN);
  const mcpPlan = findPlan(FEATURE_MIN_PLAN.mcpAccess)!.name_tr;

  it('llms.txt, llms-full.txt ve agent-setup.txt dogru MCP adresini, kartı ve kurulum linkini veriyor', () => {
    for (const doc of [llms, llmsFull, setup]) {
      expect(doc).toContain(endpoint);
      expect(doc).toContain(serverCardUrl(DEFAULT_API_ORIGIN));
    }
    for (const doc of [llms, llmsFull]) {
      expect(doc).toContain(AGENT_SETUP_URL);
      expect(doc).toContain(RANKSUP_BOT_UA);
    }
  });

  it('MCP plani belgelerde kodla ayni (mcpAccess kapisi)', () => {
    // agent-setup.txt "MCP sunucusu ve API anahtari uretimi" diyor: iki kapi ayni planda olmali
    expect(findPlan(FEATURE_MIN_PLAN.apiAccess)!.name_tr, 'apiAccess plani mcpAccess ile ayrisirsa agent-setup.txt duzeltilmeli').toBe(mcpPlan);
    expect(llms).toContain(`MCP sunucusu ${mcpPlan} planda`);
    expect(llmsFull).toContain(`MCP sunucusu ${mcpPlan} planda`);
    expect(setup).toContain(`${mcpPlan} planda`);
    // Sorun giderme bolumu QuotaService'in gercek mesajini aliyor
    expect(setup).toContain(`${PLAN_FEATURE_LABELS.mcpAccess} ${mcpPlan} planına dahildir`);
  });

  it('agent-setup.txt\'te adi gecen her arac kayitta var', () => {
    const prisma = { user: { findUniqueOrThrow: async () => ({ plan: 'ENTERPRISE' }) } } as never;
    const n = null as never;
    const names = new Set(new McpToolsService(prisma, n, new QuotaService(prisma), n, n, n, n, n, n, n, n, n, n).list().map((t) => t.name));
    const anilan = [...setup.matchAll(/\b(?:list|get|run|create|add|update|derive|generate|suggest)_[a-z_]+\b/g)].map((m) => m[0]);
    expect(anilan.length).toBeGreaterThan(0);
    for (const a of anilan) expect(names, `agent-setup.txt bilinmeyen arac: ${a}`).toContain(a);
  });

  it('statik RFC 9728 kopyasi RFC konumunda ve kodun urettigiyle ayni', () => {
    const metadataPath = new URL(protectedResourceMetadataUrl(endpoint)).pathname;
    expect(metadataPath).toBe('/.well-known/oauth-protected-resource/api/mcp');
    const file = path.join(WEB_PUBLIC, metadataPath);
    expect(JSON.parse(read(file))).toEqual(buildProtectedResourceMetadata(DEFAULT_API_ORIGIN));
  });

  it('AI Catalog: tek MCP girdisi, kart adresi ve kimlik kartla tutarli', () => {
    const catalog = JSON.parse(read(path.join(WEB_PUBLIC, '.well-known/ai-catalog.json')));
    expect(catalog.specVersion).toBe('1.0');
    expect(Array.isArray(catalog.entries)).toBe(true);
    expect(catalog.host?.displayName).toBeTruthy();
    const mcp = catalog.entries.filter((e: any) => e.type === SERVER_CARD_MEDIA_TYPE);
    expect(mcp).toHaveLength(1);
    const [e] = mcp;
    expect(e.url).toBe(serverCardUrl(DEFAULT_API_ORIGIN));
    expect('data' in e).toBe(false); // url VEYA data — ikisi birden degil
    expect(e.identifier).toBe(SERVER_CARD_CATALOG_ID);
    // ext-server-card docs/discovery.md: com.example/weather -> urn:air:example.com:mcp:weather
    const [ns, ad] = SERVER_CARD_NAME.split('/');
    expect(e.identifier).toBe(`urn:air:${ns.split('.').reverse().join('.')}:mcp:${ad}`);
  });
});

describe('llms-full.txt bayat icerik tasimiyor', () => {
  it('kaldirilan moduller, eski odeme saglayicisi ve olmayan sayfalar yok', () => {
    // AI Studio / sosyal planlayici / video paketi API'de yok; /status uydurma uptime
    // gosteriyordu ve kaldirildi; /help/studio ve /help/social rotalari yok
    for (const bayat of ['Iyzico', 'AI Studio', 'Sosyal Medya Planlayıcı', 'Video Credit', 'ranksup.ai/status', '/help/studio', '/help/social', 'Uptime SLA']) {
      expect(llmsFull, `llms-full.txt bayat: ${bayat}`).not.toContain(bayat);
    }
  });

  it('sabit TL fiyati yok — TL her gun TCMB kuruyla hesaplaniyor', () => {
    expect(llmsFull).not.toMatch(/₺/);
  });
});

describe('fiyat karti maddeleri = kod', () => {
  const tr = BASE_PLANS.flatMap((p) => p.features_tr);
  const en = BASE_PLANS.flatMap((p) => p.features_en);

  it('MCP maddesi sabit arac sayisi yazmiyor (kayit degistikce bayatliyordu: "26 arac")', () => {
    for (const m of [...tr, ...en].filter((x) => /\bMCP\b/.test(x))) {
      expect(m, m).not.toMatch(/\d+\s*(araç|arac|tools?)\b/i);
    }
  });

  it('Llama kosulsuz vaat edilmiyor (Groq modeli kaldirdi; GROQ_LLAMA_MODEL olmadan olculmuyor)', () => {
    for (const m of [...tr, ...en]) expect(m, m).not.toMatch(/llama/i);
  });

  it('maddedeki asistan sayisi listelenen asistan adlariyla ayni', () => {
    for (const [maddeler, sayiRe] of [[tr, /(\d+) AI asistan/], [en, /(\d+) AI assistants/]] as const) {
      const sayiMaddesi = maddeler.find((m) => sayiRe.test(m));
      const liste = maddeler.find((m) => m.startsWith('ChatGPT · '));
      expect(sayiMaddesi, 'asistan sayisi maddesi').toBeDefined();
      expect(liste, 'asistan listesi maddesi').toBeDefined();
      expect(Number(sayiMaddesi!.match(sayiRe)![1])).toBe(liste!.split(' · ').length);
    }
  });
});

// ─── Kart maddeleri yalniz teslim edilen seyi yazar (30.10.2026) ────────────
//
// NEDEN: destek kademeleri (24 / 4 saat, Slack, hesap yoneticisi + SLA) ve
// bazi maddeler ("14 yayin hedefi", "harf notu", "LLM duygu analizi",
// "81 ilin tamamina") kodun verdiginden fazlasini satiyordu. Sahip karari:
// operasyonel destek taahhudu yazilmaz; kosula bagli ozellik kosuluyla yazilir.
describe('kart maddeleri = teslim edilen', () => {
  const tr = BASE_PLANS.flatMap((p) => p.features_tr);
  const en = BASE_PLANS.flatMap((p) => p.features_en);
  const madde = (liste: string[], bas: string) => {
    const m = liste.find((x) => x.startsWith(bas));
    expect(m, `"${bas}" maddesi`).toBeDefined();
    return m!;
  };
  const MARKETING_DIR = path.join(WEB_SRC, 'app/(marketing)');
  const i18nSrc = read(path.join(WEB_SRC, 'lib/i18n.ts'));

  // Yanit suresi, SLA, Slack ve hesap yoneticisi: kodda ve operasyonda karsiligi yok
  const DESTEK_VAADI = /\bSLA\b|Slack kanal|Slack channel|\+ Slack|hesap yöneticisi|account manager|öncelikli destek|priority support|e-posta \d+ saat|email \d+h|Yanıt süresi|Response time|sözleşmeli kurulum|contracted onboarding/i;

  it('destek alani yalniz kanal yazar; hicbir plan ve musteri metni destek taahhudu vermiyor', () => {
    for (const p of BASE_PLANS) {
      expect(p.support_tr, p.id).toBe('e-posta');
      expect(p.support_en, p.id).toBe('email');
    }
    const metinler: Array<[string, string]> = [
      ['plans.ts', [...tr, ...en].join('\n')],
      ['llms.txt', llms],
      ['llms-full.txt', llmsFull],
      ['i18n.ts', stripComments(i18nSrc)],
      ['ranksup-md.ts', stripComments(read(path.join(WEB_SRC, 'lib/ranksup-md.ts')))],
      ...['help/page.tsx', 'help/billing/page.tsx', 'use-cases/page.tsx', 'pricing/layout.tsx', 'pricing/pricing-view.tsx', 'faq/page.tsx']
        .map((f): [string, string] => [f, stripComments(read(path.join(MARKETING_DIR, f)))]),
    ];
    for (const [ad, metin] of metinler) expect(metin, ad).not.toMatch(DESTEK_VAADI);
  });

  it('yayin hedefi sayisi = musterinin ekleyip teslim alabildigi katalog hedefleri', () => {
    // KOBIPRATIK yalniz admin; Markdown ZIP sunucuya dosya yazar, indirme vermez
    const teslim = publishTargetCatalog().filter((e) => !e.adminOnly && !EXPORT_TARGET_TYPES.has(e.type));
    const n = teslim.length;
    expect(n).toBe(13);
    expect(madde(tr, `${n} yayın hedefi — `)).toBeTruthy();
    expect(madde(en, `${n} publishing targets — `)).toBeTruthy();
    const yerler: Array<[string, string, RegExp]> = [
      ['llms.txt', llms, /(\d+) yayın hedefi/g],
      ['llms-full.txt', llmsFull, /(\d+) yayın hedefi/g],
      ['i18n.ts', i18nSrc, /(\d+) (?:yayın hedef|publishing target)/g],
      ['layout.tsx', read(path.join(WEB_SRC, 'app/layout.tsx')), /(\d+) yayın hedef/g],
      ['pricing/layout.tsx', read(path.join(MARKETING_DIR, 'pricing/layout.tsx')), /(\d+) yayın hedef/g],
      ['compare-view.tsx', read(path.join(MARKETING_DIR, 'compare/compare-view.tsx')), /(\d+) (?:yayın hedefi|publish targets|hedef'|targets')/g],
    ];
    for (const [ad, metin, re] of yerler) {
      const sayilar = [...metin.matchAll(re)].map((m) => Number(m[1]));
      expect(sayilar.length, `${ad} yayin hedefi sayisi anmiyor`).toBeGreaterThan(0);
      for (const s of sayilar) expect(s, ad).toBe(n);
    }
    expect(llmsFull).not.toMatch(/yayın hedefi:[^\n]*Markdown ZIP/);
  });

  it('kosula bagli ozellikler kosuluyla yaziliyor (TR + EN)', () => {
    // Harf notu yalniz GEO skor kartinda (geo-score-card.service grade); denetim harf vermez
    expect(madde(tr, 'Site SEO/GEO denetimi')).toContain('GEO Lab');
    expect(madde(en, 'Site SEO/GEO audit')).toContain('GEO Lab');
    // Site keyword sirasi yalniz Search Console verisinden (analytics.service)
    expect(madde(tr, 'Google Search Console bağlıyken günlük')).toContain('keyword sıra takibi');
    expect(madde(en, 'Daily automated keyword rank tracking')).toContain('Google Search Console');
    // Metadata AI onerisi; Google Play'e yazma yok, App Store'a yazma Pro ASC ile
    expect(madde(tr, 'ASO:')).toContain('AI öneri');
    expect(madde(en, 'ASO:')).toContain('suggestions');
    for (const m of [madde(tr, 'ASO:'), madde(en, 'ASO:')]) expect(m).not.toMatch(/optimize et|AI-optimize/);
    // ASC yorumlarina duygu analizi yapilmiyor (asc.service fetchReviews); yanit taslagi var
    expect(madde(tr, 'App Store Connect')).toContain('yanıt taslağı');
    expect(madde(en, 'App Store Connect')).toContain('reply drafts');
    for (const m of [madde(tr, 'App Store Connect'), madde(en, 'App Store Connect')]) expect(m).not.toMatch(/duygu|sentiment/i);
    // Tespit Search Console ister; geri alma yalniz RanksUp'in yazisinda (STUCK_REVERT_EXTERNAL)
    expect(madde(tr, 'Takılmış sayfa')).toMatch(/Search Console[\s\S]*RanksUp’ın yayınladığı/);
    expect(madde(en, 'Stuck page')).toMatch(/Search Console[\s\S]*RanksUp published/);
    // Sehir sayisi kalan aylik makale hakkiyla sinirli (programmatic-seo.service actualMax)
    expect(madde(tr, 'Programmatic SEO')).toContain('makale kotan kadar');
    expect(madde(en, 'Programmatic SEO')).toContain('remaining monthly article quota');
    expect(madde(tr, 'Programmatic SEO')).not.toContain('tamamına');
  });
});

describe('/bot sayfasi = kod', () => {
  const page = read(path.join(WEB_SRC, 'app/(marketing)/bot/page.tsx'));

  it('ajan hazirligi taramasinin okudugu her yolu listeliyor (agent-readiness.service.ts)', () => {
    const src = read(path.resolve(HERE, '../audit/agent-readiness.service.ts'));
    const yollar = [...new Set([...src.matchAll(/\$\{origin\}(\/[A-Za-z0-9._/-]+)/g)].map((m) => m[1]))];
    expect(yollar.length).toBeGreaterThan(8);
    for (const y of yollar) {
      const ad = y.replace(/^\/\.well-known\//, '').replace(/^\//, '');
      expect(page, `/bot sayfasi ${y} yolunu anmiyor`).toContain(ad);
    }
    // Standart site haritasi konumlari (discoverSitemap)
    const sitemaps = [...src.matchAll(/'\/(sitemap[^']*\.xml)'/g)].map((m) => m[1]);
    expect(sitemaps.length).toBeGreaterThan(0);
    for (const sm of sitemaps) expect(page, `/bot sayfasi ${sm} anmiyor`).toContain(sm);
  });

  it('kullanici ajanini kodla birebir ayni yaziyor', () => {
    expect(page).toContain(RANKSUP_BOT_UA);
  });

  it('sunucu IP adresi yayimlamiyor (koken Cloudflare arkasinda)', () => {
    expect(page).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });
});

// ─── Musteriye gorunen metinler = kod (18.10.2026 durust metin dalgasi) ──────
//
// NEDEN: ayni yanlis iddialar (7 asistan, 6 ajan, Pro'da BYOK, gunluk otomatik
// olcum, kosulsuz iade, e-posta/sifre ile kayit) bir yuzeyde duzeltilip
// digerinde kaliyordu. Bu bloklar web, mobil ve herkese acik belgeleri tarar.

const MOBILE = path.resolve(HERE, '../../../../mobile');
const MARKETING = path.join(WEB_SRC, 'app/(marketing)');

/** Dizini ozyinelemeli tara (node_modules haric) */
function walk(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => ext.test(f) && !f.split(path.sep).includes('node_modules'))
    .map((f) => path.join(dir, f));
}

/**
 * Yorumlari at: musteriye gosterilmez ve "eskiden 7 asistan yaziyordu" gibi
 * aciklamalar yanlis alarm vermesin. Blok / JSX yorumlari ve tam satir //
 * yorumlari silinir.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

/**
 * Adi verilen klasorlere hic inmeden tarar. mobile/ kokunde node_modules var;
 * readdirSync({ recursive }) onu da gezip on binlerce dosya listelerdi.
 */
function walkSkipping(dir: string, name: RegExp, skip: ReadonlySet<string>): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkSkipping(p, name, skip));
    else if (name.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Mobilin TAMAMI: yalniz app/ ve src/ degil, kokteki README / magaza metni /
 * app.json da (App Store aciklamasi ya da yeni bir ekran klasoru eklenirse
 * "7 asistan" gibi bir iddia tarayicinin disinda kalmasin). Uretilen ve
 * ucuncu taraf klasorleri atlanir.
 */
const MOBILE_SKIP = new Set(['node_modules', '.expo', 'ios', 'android', 'dist', 'build', '.claude', '.git']);

interface Source { rel: string; text: string }
const webSources: Source[] = walk(WEB_SRC, /\.tsx?$/).map((f) => ({ rel: path.relative(WEB_SRC, f), text: stripComments(read(f)) }));
const mobileSources: Source[] = walkSkipping(MOBILE, /\.(tsx?|md|txt)$|^app\.json$/, MOBILE_SKIP)
  .map((f) => ({ rel: path.relative(MOBILE, f), text: stripComments(read(f)) }));
/** Landing'de oynatilan Remotion videolari (Explainer altyazisi "7 AI asistani" diyordu) */
const videoSources: Source[] = walk(path.resolve(HERE, '../../../video/src'), /\.tsx?$/)
  .map((f) => ({ rel: path.join('video/src', path.relative(path.resolve(HERE, '../../../video/src'), f)), text: stripComments(read(f)) }));
const docSources: Source[] = [
  { rel: 'public/llms.txt', text: llms },
  { rel: 'public/llms-full.txt', text: llmsFull },
  { rel: 'public/agent-setup.txt', text: setup },
];

function offenders(sources: Source[], re: RegExp, allow: (line: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const s of sources) {
    s.text.split('\n').forEach((line, i) => {
      if (re.test(line) && !allow(line)) out.push(`${s.rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  return out;
}

/** Sartli anma ("yalnızca ... tanımlıyken", "only when") Llama icin kabul edilir */
const LLAMA_CONDITIONAL = /yaln[ıi]z(ca)?|only (when|if)|GROQ_LLAMA_MODEL|tan[ıi]ml[ıi]yken|ölçülmüyor|olculmuyor/i;

describe('Musteriye gorunen metinler = kod', () => {
  it('web, mobil ve belgelerde bulunan dosya sayisi makul (tarayici bos donmuyor)', () => {
    expect(webSources.length).toBeGreaterThan(100);
    expect(mobileSources.length).toBeGreaterThan(5);
    // Kapsam: web lib/ (i18n, sozluk) ve mobilin kok metinleri de taraniyor
    expect(webSources.some((s) => s.rel === path.join('lib', 'i18n.ts'))).toBe(true);
    expect(webSources.some((s) => s.rel === path.join('lib', 'glossary.ts'))).toBe(true);
    expect(mobileSources.some((s) => s.rel === 'README.md')).toBe(true);
    expect(mobileSources.some((s) => s.rel.split(path.sep).includes('node_modules'))).toBe(false);
  });

  it('"7 AI asistanı / motoru" iddiası yok — ölçülen 6 asistan (Llama üretimde ölçülmüyor)', () => {
    const re = /\b(7|yedi|seven)\s*(farklı\s*|different\s*)?(AI|yapay|motor|asistan|assistant|engine)/i;
    expect(videoSources.some((s) => s.rel.endsWith('Explainer.tsx')), 'Explainer taraniyor').toBe(true);
    expect(offenders([...webSources, ...mobileSources, ...docSources, ...videoSources], re)).toEqual([]);
  });

  it('"X, Y, Z ve N asistan daha" toplamı ölçülen asistan sayısını aşmıyor', () => {
    // Landing'de "ChatGPT, Gemini, Claude ve dört asistanda" = 7 yaziyordu; sayi
    // regex'i (7 asistan) bunu yakalamiyordu. Ad listesi + "N asistan" toplanir.
    const liste = BASE_PLANS.flatMap((p) => p.features_tr).find((m) => m.startsWith('ChatGPT · '))!;
    const olculen = liste.split(' · ').length;
    const SAYI: Record<string, number> = {
      bir: 1, iki: 2, 'üç': 3, uc: 3, 'dört': 4, dort: 4, 'beş': 5, bes: 5, 'altı': 6, alti: 6, yedi: 7,
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    };
    const AD = '(?:ChatGPT|Claude|Gemini|Perplexity|Grok|DeepSeek|Copilot|Meta AI|Llama)';
    const re = new RegExp(
      `(${AD}(?:\\s*(?:,|·|/)\\s*${AD})*)\\s*,?\\s*(?:ve|and|\\+)\\s+(\\d+|${Object.keys(SAYI).join('|')})\\s+` +
        `(?:more\\s+|other\\s+|başka\\s+|diğer\\s+)?(?:AI\\s+)?(?:asistan|assistant|motor|engine)`,
      'giu',
    );
    const asan: string[] = [];
    for (const s of [...webSources, ...mobileSources, ...docSources]) {
      s.text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(re)) {
          const adlar = new Set(m[1].split(/\s*(?:,|·|\/)\s*/).filter(Boolean)).size;
          const ek = /^\d+$/.test(m[2]) ? Number(m[2]) : SAYI[m[2].toLowerCase()];
          if (adlar + ek > olculen) asan.push(`${s.rel}:${i + 1}: ${m[0]} (= ${adlar + ek})`);
        }
      });
    }
    expect(asan).toEqual([]);
  });

  it('sabit makale uzunluğu ("1800-2500 kelime") vaat edilmiyor', () => {
    // Yazar istemi uzunluk sabitlemiyor ("konuyu kapsayacak kadar, dolgu yok")
    const re = /1[.,]?800\s*[-–]\s*2[.,]?500/;
    // Istisna listesi bosaltildi: makale ilerleme adimlari (pipeline-progress.tsx)
    // artik "Yazar ajan · Tam makale taslağı (uzunluk konuya göre)" diyor.
    const sources = [...webSources, ...mobileSources, ...docSources];
    expect(offenders(sources, re)).toEqual([]);
  });

  it('Llama / Meta AI ölçülen asistanlar listesine koşulsuz eklenmiyor', () => {
    const list = /(ChatGPT|Claude|Gemini|Perplexity|Grok|DeepSeek)\s*([,·/+|&]|\bve\b|\band\b)\s*(Meta\s*AI\s*\(?\s*)?(Meta\s+)?(Llama|Meta\b)/i;
    expect(offenders([...webSources, ...mobileSources, ...docSources, ...videoSources], list, (l) => LLAMA_CONDITIONAL.test(l))).toEqual([]);
    // Videolarda asistanlar dizi olarak yazilir ('DeepSeek', 'Meta AI'): ayri kontrol
    expect(offenders(videoSources, /['"]Meta AI['"]|['"]Llama['"]/)).toEqual([]);
  });

  it('belgelerdeki her Llama anışı koşullu', () => {
    expect(offenders(docSources, /llama/i, (l) => LLAMA_CONDITIONAL.test(l))).toEqual([]);
  });

  it('üretim hattı 5 ajan (pipeline.service.ts): "6 ajan" iddiası yok', () => {
    const pipeline = read(path.resolve(HERE, '../articles/pipeline.service.ts'));
    const ajanlar = new Set([...pipeline.matchAll(/\bAGENT_0(\d)_[A-Z]+\b/g)].map((m) => m[1]));
    expect(ajanlar.size, 'pipeline.service.ts ajan sayisi degisti — metinleri guncelle').toBe(5);
    // Istisna listesi (eskiden lib/i18n.ts ve site-flow-stepper.tsx) bosaltildi:
    // ikisi de duzeltildi, tum web + mobil + belgeler taraniyor.
    const re = /\b(6|altı|alti|six)[\s-]*(ajan|agent)/i;
    const sources = [...webSources, ...mobileSources, ...docSources];
    expect(offenders(sources, re)).toEqual([]);
    expect(llms).toContain('5 ajanlı üretim hattı');
    expect(llmsFull).toContain('5 ajanlı üretim hattı');
    for (const p of BASE_PLANS) for (const m of p.features_tr) expect(m, m).not.toMatch(re);
  });

  it('llms.txt Ajan Hazırlığı satırı düzeltmenin önizlemeli olduğunu söylüyor', () => {
    const axo = llms.split('\n').find((l) => l.startsWith('- **Ajan Hazırlığı (AXO)**'));
    expect(axo, 'llms.txt AXO satiri').toBeDefined();
    expect(axo!).toContain('önizlemeli');
    expect(axo!).toContain('onaylanmadan yazılmaz');
  });

  it('BYOK rehberi bağlantısı BYOK diye etiketli (luvi_ API anahtarlarıyla karışmaz)', () => {
    for (const doc of [llms, llmsFull]) {
      expect(doc).toContain('[Kendi sağlayıcı anahtarın (BYOK) rehberi](https://ranksup.ai/help/api-keys)');
      expect(doc).not.toContain('[API anahtarları rehberi]');
    }
  });
});

describe('Yardım sayfaları = ürün', () => {
  const HELP_DIR = path.join(MARKETING, 'help');
  const helpPages: Source[] = walk(HELP_DIR, /page\.tsx$/).map((f) => ({ rel: path.relative(MARKETING, f), text: stripComments(read(f)) }));
  const page = (slug: string) => helpPages.find((s) => s.rel === path.join('help', slug, 'page.tsx'))!;
  const byokPlan = findPlan(FEATURE_MIN_PLAN.byok)!.name_tr;

  it('yardım sayfaları bulunuyor', () => {
    for (const slug of ['ai-visibility', 'auto-pilot', 'billing', 'getting-started', 'api-keys', 'asa-asc', 'aso']) {
      expect(page(slug), slug).toBeDefined();
    }
  });

  it(`BYOK anan her sayfa planı doğru yazıyor (${byokPlan}); "Pro ve üstü", deneme ve "sınırsız" vaadi yok`, () => {
    const pages = [...helpPages, { rel: 'help/page.tsx', text: stripComments(read(path.join(HELP_DIR, 'page.tsx'))) }];
    const anan = pages.filter((s) => /BYOK/.test(s.text));
    expect(anan.length).toBeGreaterThanOrEqual(3);
    for (const s of anan) {
      expect(s.text, s.rel).toContain(`${byokPlan} plan`);
      expect(s.text, s.rel).not.toMatch(/Pro plan (ve|\+) üstü|Pro\+ planlarda|Trial planda|sınırsız (test|kullanım)|Unlimited with BYOK/i);
    }
  });

  it('günlük otomatik ölçüm, koşulsuz iade ve eski buton adı vaat edilmiyor', () => {
    const extra: Source[] = ['faq/page.tsx', 'compare/compare-view.tsx', 'about/page.tsx', 'use-cases/page.tsx']
      .map((rel) => ({ rel, text: stripComments(read(path.join(MARKETING, rel))) }));
    // Landing metinleri (SSS JSON-LD'si dahil) i18n.ts'ten gelir
    extra.push({ rel: 'lib/i18n.ts', text: stripComments(read(path.join(WEB_SRC, 'lib/i18n.ts'))) });
    const re = /günlük (otomatik )?(snapshot|izleme)|her gece AI|Daily Snapshot|AI Citation günlük|koşulsuz (para )?iade|Test Çalıştır|daily (snapshot|automatic monitoring)|daily citation|no questions asked/i;
    expect(offenders([...helpPages, ...extra], re)).toEqual([]);
  });

  it('getting-started: web kaydı Google ile, e-posta / şifre formu vaadi yok', () => {
    const gs = page('getting-started').text;
    expect(gs).toContain('Google ile devam et');
    expect(gs).not.toMatch(/mail\s*\+\s*şifre|mail\/Google|e-posta\s*(ve|\/|\+)\s*şifre ile/i);
  });

  it('getting-started: HowTo adımlarında tek ölçüm eylemi (Yeniden Test ve AI önerisi al aynı haftalık hakkı kullanır)', () => {
    const block = page('getting-started').text.match(/steps=\{\[([\s\S]*?)\]\}/);
    expect(block, 'HowTo steps blogu').toBeTruthy();
    const steps = block![1].split(/\{\s*name:/).slice(1);
    const olcum = steps.filter((s) => /Yeniden Test|AI önerisi al/.test(s));
    expect(olcum).toHaveLength(1);
    expect(olcum[0]).toMatch(/haftada bir/);
  });
});

describe('Pazarlama sayfaları = ürün', () => {
  const m = (rel: string) => stripComments(read(path.join(MARKETING, rel)));

  it('FAQ: doğrulanmamış iddialar geri gelmiyor', () => {
    const faq = m('faq/page.tsx');
    for (const yasak of ['Auriti', '47 metrik', '47 metrics', 'Faz 3', 'Phase 3', 'Opus 4.7', 'Sonnet 4.6', 'PayTR transfer',
      'Ryze', '1800-2500', '6-ajan', '6-agent', '35-60k', 'koşulsuz', 'podcast']) {
      expect(faq, `FAQ: ${yasak}`).not.toContain(yasak);
    }
  });

  it('FAQ GEO Score yöntemi geo-score-card.service.ts ile aynı (asistanlar, ağırlık, hero görsel)', () => {
    const svc = read(path.resolve(HERE, '../audit/geo-score-card.service.ts'));
    const ids = [...svc.match(/const OLCULEN_ASISTANLAR = \[([^\]]+)\]/)![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    const AD: Record<string, string> = {
      anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT', perplexity: 'Perplexity', xai: 'Grok', deepseek: 'DeepSeek',
    };
    expect(ids.length).toBeGreaterThanOrEqual(6);
    // "Ilk uc basligin agirligi en yuksektir": sutun sirasi crawler, yapisal, AI citation
    const agirlik = [...svc.matchAll(/weight: (\d)/g)].map((x) => Number(x[1]));
    expect(agirlik).toHaveLength(6);
    expect(agirlik.slice(0, 3).every((w) => w === Math.max(...agirlik))).toBe(true);
    // Multi-Modal yalniz hero gorsel; TTS/podcast kontrolleri skorda yok
    expect(svc).not.toMatch(/id: 'tts-audio'|id: 'podcast-rss'/);

    const faq = m('faq/page.tsx');
    const cevap = (q: string) => {
      const i = faq.indexOf(q);
      expect(i, q).toBeGreaterThan(-1);
      const rest = faq.slice(i);
      return rest.slice(0, rest.indexOf('},'));
    };
    for (const c of [cevap("q: 'GEO Score nedir"), cevap("q: 'What is GEO Score")]) {
      for (const id of ids) expect(c, `${id} GEO Score cevabinda yok`).toContain(AD[id] ?? id);
      expect(c).not.toMatch(/podcast|\bses\b|audio/i);
      expect(c).toMatch(/7 gün|7 days/);
    }
  });

  it('landing karşılaştırması /compare ile aynı rakipleri gösteriyor; tasarruf yüzdesi ve sosyal araç yok', () => {
    const landing = stripComments(read(path.join(WEB_SRC, 'app/page.tsx')));
    const cmp = m('compare/compare-view.tsx');
    const rakipler = [...landing.matchAll(/\{ name: '([^']+)', price: '\$\d+' \}/g)].map((x) => x[1]);
    expect(rakipler).toHaveLength(4);
    for (const r of rakipler) expect(cmp, `${r} /compare tablosunda yok`).toContain(`>${r}</th>`);
    expect(landing).not.toMatch(/Hootsuite|SEMrush|AppTweak|ChatGPT Team/);
    // Her satir: rakip sayisi + RanksUp hucresi
    const tablo = landing.slice(landing.indexOf('const COMPARE'), landing.indexOf('];', landing.indexOf('const COMPARE')));
    const satirlar = [...tablo.matchAll(/^\s*\[([^\]]*)\],/gm)].map((x) => x[1].split(',').filter((v) => v.trim()).length);
    expect(satirlar).toHaveLength(8);
    for (const n of satirlar) expect(n).toBe(rakipler.length + 1);

    const i18n = read(path.join(WEB_SRC, 'lib/i18n.ts'));
    const anahtar = (k: string) => i18n.split('\n').filter((l) => l.includes(`'${k}':`));
    for (const l of [...anahtar('land.cmp.title'), ...anahtar('land.cmp.subtitle')]) {
      expect(l).not.toMatch(/%\s?\d+|\d+\s?%|SaaS yerine|instead of \d+ SaaS/);
    }
    const starter = findPlan('starter')!;
    const [tr, en] = anahtar('land.cmp.note');
    expect(tr).toContain(`RanksUp ${starter.name_tr}`);
    expect(en).toContain(`RanksUp ${starter.name_en}`);
    for (const r of rakipler) {
      expect(tr).toContain(r);
      expect(en).toContain(r);
    }
  });

  it('landing SSS iade cevabı Kullanım Şartları ile aynı (yıllıkta ilk 30 gün tam iade)', () => {
    const terms = read(path.join(MARKETING, 'terms/page.tsx'));
    expect(terms).toContain('Yıllık planda ilk 30 gün full iade');
    expect(terms).toContain('Yearly plans are fully refundable in the first 30 days');
    const [tr, en] = read(path.join(WEB_SRC, 'lib/i18n.ts')).split('\n').filter((l) => l.includes("'land.faq.a6':"));
    expect(tr).toContain('ilk 30 gün tam iade');
    expect(en).toContain('full refund in the first 30 days');
    for (const l of [tr, en]) expect(l).not.toMatch(/7 gün|7 days|koşulsuz|no questions asked/i);
  });

  it('sözlük (/help/glossary, herkese açık): kaldırılan ses/podcast ve white-label vaadi yok, deneme hakları plans.ts ile aynı', () => {
    const g = stripComments(read(path.join(WEB_SRC, 'lib/glossary.ts')));
    expect(g).not.toMatch(/podcast|MP3|Powered by RanksUp|Whitelabel|white-label|accordion görünür|Siri|Alexa/i);
    const trial = findPlan('trial')!;
    const satir = g.split('\n').find((l) => l.includes('Ücretsiz deneme planı'))!;
    expect(satir).toContain(`${trial.articlesPerMonth} makale`);
    expect(satir).toContain(`${trial.aiRunsPerMonth} AI görünürlük çalıştırması`);
    expect(satir).toContain(`${trial.sites} site`);
    // Quota: sabit plan sayisi yazilmaz ("Baslangic 10 ... Kurumsal 100" bayatlamisti)
    const quota = g.split('\n').find((l) => l.includes('Aylık makale üretim limitin'))!;
    expect(quota).not.toMatch(/\b\d{2,}\b/);
    // MCP / API anahtari plani kodla ayni
    const mcpPlan = findPlan(FEATURE_MIN_PLAN.mcpAccess)!.name_tr;
    expect(g.split('\n').find((l) => l.includes('Model Context Protocol'))).toContain(`${mcpPlan} plan`);
    expect(g.split('\n').find((l) => l.includes('programla erişim'))).toContain(findPlan(FEATURE_MIN_PLAN.apiAccess)!.name_tr);
  });

  it('compare: Hootsuite, sabit TL tutarı ve genel "geri alınabilir" iddiası yok', () => {
    const cmp = m('compare/compare-view.tsx');
    expect(cmp).not.toContain('Hootsuite');
    expect(cmp).not.toMatch(/₺\s?\d/);
    expect(cmp).not.toMatch(/Yedeklenir, geri alınabilir|Backed up and revertible/);
    expect(cmp).not.toMatch(/sadece GPT|GPT only|rakiplerde 0|0 in competitors/);
    // Geri alma yalniz mevcut dosyada: yeni olusturulan dosya sunucudan silinir
    expect(cmp).toContain('sunucudan silmek gerekir');
  });

  it('about / use-cases: kaldırılan sosyal modül ve "Faz 3" vaadi yok', () => {
    for (const rel of ['about/page.tsx', 'use-cases/page.tsx']) {
      expect(m(rel), rel).not.toMatch(/sosyal medya planla|White-label dashboard|Faz 3|Phase 3|KKB|ETBİS/i);
    }
  });

  it('privacy: yürürlük tarihi korunur; son güncelleme ve değişiklik notu TR + EN', () => {
    const pv = read(path.join(MARKETING, 'privacy/page.tsx'));
    expect(pv).toContain("effective: 'Yürürlük: 27 Nisan 2026'");
    expect(pv).toContain("effective: 'Effective: April 27, 2026'");
    expect(pv).toMatch(/updated: 'Son güncelleme: \d{1,2} \S+ 20\d\d'/);
    expect(pv).toMatch(/updated: 'Last updated: \S+ \d{1,2}, 20\d\d'/);
    expect((pv.match(/changeNote: '/g) ?? []).length).toBe(2);
  });

  // Gizlilik bolum 5 kaldirilmis sosyal medya modulunu (OAuth baglantilari, TikTok
  // yayini, "Sosyal Kanallar" ayari) hala varmis gibi anlatiyordu; bolum 6 HeyGen,
  // Runway, ElevenLabs sayiyordu. Uc 0db5a1c'de kaldirildi. Kod geri gelirse ya da
  // metnin silme iddialarinin dayandigi adimlar degisirse bu test kirilir.
  it('privacy: kaldırılan sosyal medya bağlantıları ve video/ses sağlayıcıları kullanılıyormuş gibi anlatılmıyor; silme iddiaları kodla aynı', () => {
    const apiSrc = path.resolve(HERE, '..');
    const workerSrc = path.resolve(HERE, '../../../worker/src');
    const kod: Source[] = [...walk(apiSrc, /\.ts$/), ...walk(workerSrc, /\.ts$/)]
      .filter((f) => !f.endsWith('.spec.ts'))
      .map((f) => ({ rel: path.relative(apiSrc, f), text: stripComments(read(f)) }));
    expect(fs.existsSync(path.join(apiSrc, 'social')), 'sosyal modul geri geldi: privacy bolum 5 metnini guncelle').toBe(false);
    expect(offenders(kod, /heygen|elevenlabs|runwayml|RUNWAY_API_KEY/i), 'video/ses saglayicisi geri geldi: privacy bolum 6 metnini guncelle').toEqual([]);
    // "Erisim bilgileri artik hicbir islemde kullanilmaz": sosyal kanal tablosuna yalniz silme yollari dokunuyor
    const kanalOkuyan = kod.filter((s) => /\.socialChannel\./.test(s.text)).map((s) => s.rel.split(path.sep).join('/')).sort();
    expect(kanalOkuyan, 'sosyal kanal kaydini okuyan yeni kod: privacy bolum 5 metnini guncelle').toEqual([
      'me/account-deletion.service.ts', 'me/account-purge.plan.ts', 'sites/sites.service.ts',
    ]);
    // Site silme kanallari siler; hesap silme erisim bilgisini, adi ve gorseli hemen bosaltir, satirlari purge siler
    expect(read(path.join(apiSrc, 'sites/sites.service.ts'))).toContain("{ model: 'SocialChannel', kind: 'delete'");
    expect(read(path.join(apiSrc, 'me/account-deletion.service.ts'))).toContain("data: { isActive: false, credentials: '', externalName: null, externalAvatar: null }");
    expect(read(path.join(apiSrc, 'me/account-purge.plan.ts'))).toContain("{ model: 'SocialChannel', kind: 'delete'");

    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    const bolumler = [...pv.matchAll(/\n\s*s5: [\s\S]*?\n\s*s7: /g)].map((x) => x[0]);
    expect(bolumler, 'TR + EN bolum 5-6').toHaveLength(2);
    for (const b of bolumler) {
      // Eski vaatler (OAuth ile baglanir, panelden baglanti kesilir, TikTok Login Kit / video yayini) ve kaldirilan saglayicilar
      expect(b).not.toMatch(/Login Kit|video\.(publish|upload)|OAuth 2\.0 protokolü ile bağlanır|connects to social platforms|Settings →|Sosyal Kanallar|Social Channels|bağlantıyı koparabilir|disconnect at any time|HeyGen|Runway|ElevenLabs/);
      // "Sosyal medya hesabina hic baglanmaz" da yanlis olurdu: Meta Ads Facebook Login ile Sayfa izni istiyor
      expect(b).not.toMatch(/hesaplarına bağlanmıyor|no longer connects to social media/);
    }
    expect(read(path.join(apiSrc, 'oauth/meta-permissions.ts')), 'Meta Ads Facebook Login kalktiysa bolum 5 reklam hesabi cumlesini guncelle').toContain("'pages_show_list'");
    expect(bolumler[0]).toContain('sosyal medya paylaşım özelliği');
    expect(bolumler[0]).toContain('kaldırıldı; RanksUp artık bu hesaplarda paylaşım yapmıyor');
    expect(bolumler[0]).toContain('ilgili siteyi sildiğinizde hemen silinir');
    expect(bolumler[0]).toContain('reklam hesabı bağlantıları ayrı bir özelliktir');
    expect(bolumler[1]).toContain('social media posting feature');
    expect(bolumler[1]).toContain('has been removed; RanksUp no longer posts to these accounts');
    expect(bolumler[1]).toContain('deleted immediately when you delete the related site');
    expect(bolumler[1]).toContain('ad account connections made for ad management are a separate feature');
  });

  // Kullanim Sartlari 7. madde ayni kaldirilmis modulu (9 platforma OAuth ile baglanir,
  // panelden baglanti koparilir, onaylanan icerik kullanici adina yayinlanir) hala varmis
  // gibi anlatiyordu; 9. madde "sosyal OAuth token'lari 30 gun icinde silinir" diyordu.
  // Madde SILINMEDI, yeniden yazildi: numaralar kaymasin (yardim sayfalari md. 4 ve md. 8'e
  // atif yapiyor).
  it('terms: 7. madde kaldırılan sosyal paylaşımı varmış gibi anlatmıyor; 9. madde silme iddiası kodla aynı; numaralar sıralı (TR + EN)', () => {
    const apiSrc = path.resolve(HERE, '..');
    const t = stripComments(read(path.join(MARKETING, 'terms/page.tsx')));
    for (const dil of ['tr', 'en'] as const) {
      const blok = dil === 'tr' ? t.split('\n  en: {')[0] : t.split('\n  en: {')[1];
      const basliklar = [...blok.matchAll(/h: '(\d+)\. /g)].map((m) => Number(m[1]));
      expect(basliklar, `${dil} madde numaralari`).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    expect(t).toContain("h: '7. Sosyal Medya Paylaşımı ve Yayın Hedefleri'");
    expect(t).toContain("h: '7. Social Media Posting and Publish Targets'");
    // Eski vaatler: OAuth ile baglanir, panelden baglanti koparilir, sosyal token'lar 30 gunde silinir
    expect(t).not.toMatch(/OAuth 2\.0 ile bağlanır|via OAuth 2\.0|bağlantıyı koparıp|disconnect and revoke access|Sosyal medya OAuth token|Social media OAuth tokens|Sosyal Medya Entegrasyonları|Social Media Integrations/);
    // "Sosyal medya hesabina hic baglanmaz" yanlis olurdu (Meta Ads Facebook Login, Sayfa izni)
    expect(t).not.toMatch(/hesaplarına bağlanmaz|hesaplarına bağlanmıyor|does not connect to social media|no longer connects to social media/);
    expect(t).toContain('kaldırıldı; RanksUp sizin adınıza sosyal medya hesaplarında paylaşım yapmaz');
    expect(t).toContain('has been removed; RanksUp does not post to social media accounts on your behalf');
    // Dayanak: sosyal modul ve yeni kanal baglama ucu yok (privacy testi sosyal kanal okuyanlari ayrica kilitler)
    expect(fs.existsSync(path.join(apiSrc, 'social'))).toBe(false);
    // Atif yapilan gizlilik bolumu gercekten 5. bolum
    const pv = read(path.join(MARKETING, 'privacy/page.tsx'));
    expect(t).toContain('Gizlilik Politikası’nın 5. bölümünde');
    expect(t).toContain('section 5 of the Privacy Policy');
    expect(pv).toContain("s5: '5. Sosyal Medya Bağlantıları'");
    expect(pv).toContain("s5: '5. Social Media Connections'");
    // "Yari otomatik varsayilan": yeni sitenin yayin modu onay bekler
    expect(read(path.resolve(HERE, '../../prisma/schema.prisma'))).toMatch(/publishApprovalMode\s+String\s+@default\("manual_approve"\)/);
    expect(t).toContain('Yarı otomatik modda (varsayılan) her yazı yayınlanmadan önce onayınızı bekler');
    // 9. madde: silme talebinde baglanti bilgileri hemen silinir (freezeAccountData)
    expect(t).toContain('30 günü beklemeden hemen silinir');
    expect(t).toContain('are deleted immediately, without waiting 30 days');
    const freeze = read(path.join(apiSrc, 'me/account-deletion.service.ts'));
    for (const adim of [
      'db.publishTarget.deleteMany', 'gscRefreshToken: null', 'gaRefreshToken: null', 'googleAdsRefreshToken: null',
      'metaAdsAccessToken: null', 'db.siteAiProviderKey.deleteMany', "credentials: ''",
    ]) expect(freeze, adim).toContain(adim);
    expect(freeze.match(/encryptedKey: ''/g)?.length, 'ASA + ASC anahtarlari').toBe(2);
    // Degisiklik notu (TR + EN) 7. ve 9. maddeyi aniyor
    expect(t).toMatch(/updated: 'Son güncelleme: [^']*21 Ekim 2026[^']*7\. madde[^']*9\. madde/);
    expect(t).toMatch(/updated: 'Last updated: [^']*October 21, 2026[^']*Section 7[^']*Section 9/);
  });

  // Bolum 2 (veri kullanimi) "pazarlama amacli paylasilmaz" diyordu; onay verende Google Ads
  // donusum olcumu + yeniden pazarlama etiketleri yukleniyor, metin bunu soyleyecek sekilde
  // duzeltildi. Sayfa duzeni her icerik degisikligini changeNote'ta yazar; onceki metnin tersini
  // soyleyen bir iddia degistigi icin not bunu da anmali (TR + EN).
  it('privacy: değişiklik notu bölüm 2 düzeltmesini (pazarlama paylaşımı yalnız onaylı Google reklam etiketleriyle) TR + EN anıyor', () => {
    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    const notlar = [...pv.matchAll(/changeNote: '([^']*)',/g)].map((x) => x[1]);
    expect(notlar, 'TR + EN changeNote').toHaveLength(2);
    const [tr, en] = notlar;
    // Notun andigi olgu bolum 2'de duruyor (ayrintisi web lib consent.spec.mts'te)
    const s2 = [...pv.matchAll(/\n\s*s2p: '([^']*)',/g)].map((x) => x[1]);
    expect(s2, 'TR + EN bolum 2').toHaveLength(2);
    expect(s2[0]).toContain('veri paylaşımı yalnız çerez bandında “Kabul et” derseniz yüklenen Google etiketleriyle olur');
    expect(s2[1]).toContain('shared for marketing and remarketing only through the Google tags that load if you click “Accept”');
    expect(tr).toContain('veri kullanımı bölümü (2)');
    expect(tr).toContain('pazarlama amaçlı veri paylaşımının yalnız onayınızla yüklenen Google reklam etiketleriyle (dönüşüm ölçümü ve yeniden pazarlama) yapıldığını');
    expect(en).toContain('data use section (2)');
    expect(en).toContain('data is shared for marketing only through the Google ad tags that load with your consent (conversion measurement and remarketing)');
  });

  // KVKK sayfasinin icerigi degisti (Aktarilan Taraflar: yalniz cerez onayiyla yuklenen Google ve
  // Microsoft araclari) ama sayfada yalniz yururluk tarihi vardi; okuyan metnin degistigini
  // goremiyordu. Gizlilik sayfasindaki duzen: yururluk tarihi korunur, son guncelleme ayrica yazilir.
  it('kvkk: yürürlük tarihi korunur; içerik değiştiği için son güncelleme tarihi ayrıca yazılı', () => {
    const kv = stripComments(read(path.join(MARKETING, 'kvkk/page.tsx')));
    expect(kv).toContain('>Yürürlük: 27 Nisan 2026</p>');
    expect(kv).toMatch(/>Son güncelleme: \d{1,2} \S+ 20\d\d<\/p>/);
    // Degisen icerik gercekten sayfada (tarih bos yere ilerletilmedi)
    expect(kv).toContain('Yalnız çerez bandında “Kabul et” derseniz: Google');
  });

  // Ortaklik paneli davetlinin kisisel verisini ortaga gosterir (round 20: yalniz kisaltilmis
  // etiket + davet olgulari). Gizlilik bolum 4 luvi_ref maddesi ve KVKK Aktarilan Taraflar bunu
  // soylemiyordu. Metin = getStats'in ortaga (revealContacts yok) dondurdugu acik alan listesi ve
  // referral-label.ts kurali; biri degisirse bu test kirilir, metin ayni committe guncellenir.
  it('privacy luvi_ref + KVKK: ortağın panelde gördüğü bilgiler getStats alanları ve etiket kuralıyla aynı (TR + EN)', () => {
    const svc = stripComments(read(path.resolve(HERE, '../affiliate/affiliate.service.ts')));
    const alanlar = (bas: string) => {
      const i = svc.indexOf(bas);
      expect(i, bas).toBeGreaterThan(-1);
      const govde = svc.slice(i + bas.length, svc.indexOf('}));', i));
      return [...govde.matchAll(/^\s*(\w+):/gm)].map((x) => x[1]).sort();
    };
    expect(alanlar('tier1Enriched = tier1.map((r) => ({'), 'ortaga giden 1. seviye alanlar degisti: privacy luvi_ref (TR + EN) ve KVKK metnini guncelle').toEqual(
      ['clickedAt', 'commissionUntil', 'firstPaidAt', 'id', 'referredLabel', 'signedUpAt', 'status', 'tier', 'totalCommissionEarned'],
    );
    expect(alanlar('tier2Enriched = tier2.map((r) => ({'), 'ortaga giden 2. seviye alanlar degisti: privacy luvi_ref (TR + EN) ve KVKK metnini guncelle').toEqual(
      ['clickedAt', 'firstPaidAt', 'id', 'parentReferralId', 'referredLabel', 'signedUpAt', 'status', 'tier'],
    );
    // Etiket kurali: ad; yoksa e-postanin @ oncesi; uzunsa kisaltilir; alan adi hic yok
    expect(referralLabel('Abcdefghijklmnopq', 'x@ornek.com')).toBe(`${'Abcdefghijklmnopq'.slice(0, REFERRAL_LABEL_KEEP)}…`);
    expect(referralLabel(null, 'ayse.yilmaz@ornek.com')).toBe('ayse.yilmaz');
    expect(referralLabel('  ', 'ayse@ornek.com')).not.toContain('ornek');

    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    const madde = pv.split('\n').map((l) => l.trim()).filter((l) => /^'(Ortaklık bağlantısı|Partner link): luvi_ref/.test(l));
    expect(madde, 'TR + EN luvi_ref maddesi').toHaveLength(2);
    const [tr, en] = madde;
    expect(tr).toContain(`adınızı (${REFERRAL_LABEL_MAX} karakterden uzunsa yalnız ilk ${REFERRAL_LABEL_KEEP} karakterini; adınız kayıtlı değilse e-posta adresinizin @ işaretinden önceki kısmını aynı kuralla)`);
    expect(tr).toContain('kayıt ve ilk ödeme tarihinizi, ödeme durumunuzu, komisyon süresinin bitiş tarihini ve ödemelerinizden kazandığı komisyon tutarını görür; e-posta adresinizi görmez');
    expect(tr).toContain('o ortak adınızı aynı kuralla, kayıt ve ilk ödeme tarihinizi ve ödeme durumunuzu görür; bu ikinci seviye davetten komisyon ödenmez');
    expect(en).toContain(`your name (only its first ${REFERRAL_LABEL_KEEP} characters if it is longer than ${REFERRAL_LABEL_MAX}; if no name is saved, the part of your e-mail address before the @ sign, under the same rule)`);
    expect(en).toContain('your sign-up and first payment dates, your payment status, the end date of their commission period and the commission they earned from your payments; they do not see your e-mail address');
    expect(en).toContain('that partner sees your name under the same rule, your sign-up and first payment dates and your payment status; no commission is paid on this second-level referral');
    const notlar = [...pv.matchAll(/changeNote: '([^']*)',/g)].map((x) => x[1]);
    expect(notlar, 'TR + EN changeNote').toHaveLength(2);
    expect(notlar[0]).toContain('ortaklık bağlantısı (luvi_ref) maddesine, sizi davet eden iş ortağının ortaklık panelinde hakkınızda neleri gördüğü eklendi');
    expect(notlar[1]).toContain('added to the partner link (luvi_ref) item in the cookie section what the partner who invited you sees about you in their partner dashboard');

    const kv = stripComments(read(path.join(MARKETING, 'kvkk/page.tsx'))).replace(/\s+/g, ' ');
    // Kural referral-label.ts ile ayni: yalniz 14 karakterden uzun ad kisaltilir;
    // 'kisaltilmis ad' demek cogu adin tam gorundugunu saklardi.
    expect(kv).toContain('sizi davet eden ortak, ortaklık panelinde adınızı (14 karakterden uzunsa yalnız ilk 12 karakterini; adınız kayıtlı değilse e-posta adresinizin @ işaretinden önceki kısmını aynı kuralla)');
    expect(kv).not.toContain('kısaltılmış');
    expect(kv).toContain('ödemelerinizden kazandığı komisyon tutarını görür; e-posta adresinizi görmez');
    expect(kv).toContain('bu ikinci seviyeden komisyon ödenmez');
    expect(kv).toContain('Değişiklik: Aktarılan Taraflar bölümüne yalnız çerez onayınızla yüklenen Google ve Microsoft araçları ile sizi davet eden iş ortağının ortaklık panelinde gördüğü bilgiler eklendi.');
  });

  // Iki sayfa ayni icerik dalgasinda yayinlaniyor; gosterilen son guncelleme tarihleri (gizlilik TR,
  // gizlilik EN, KVKK) birbirini tutmali, biri eski tarihte unutulmasin.
  it('privacy (TR + EN) ve KVKK son güncelleme tarihi aynı gün', () => {
    const AYLAR: Record<string, string> = {
      Ocak: 'January', Şubat: 'February', Mart: 'March', Nisan: 'April', Mayıs: 'May', Haziran: 'June',
      Temmuz: 'July', Ağustos: 'August', Eylül: 'September', Ekim: 'October', Kasım: 'November', Aralık: 'December',
    };
    const pv = read(path.join(MARKETING, 'privacy/page.tsx'));
    const kv = stripComments(read(path.join(MARKETING, 'kvkk/page.tsx')));
    const tr = pv.match(/updated: 'Son güncelleme: (\d{1,2}) (\S+) (20\d\d)'/);
    const en = pv.match(/updated: 'Last updated: (\S+) (\d{1,2}), (20\d\d)'/);
    const k = kv.match(/>Son güncelleme: (\d{1,2}) (\S+) (20\d\d)<\/p>/);
    expect(tr && en && k).toBeTruthy();
    expect(`${k![1]} ${k![2]} ${k![3]}`, 'KVKK = gizlilik').toBe(`${tr![1]} ${tr![2]} ${tr![3]}`);
    expect(`${en![1]} ${en![2]}, ${en![3]}`, 'EN = TR').toBe(`${AYLAR[tr![2]]} ${tr![1]}, ${tr![3]}`);
  });

  // Bolum 4 geri alma metni = lib/consent.ts + components/cookie-consent.tsx. Baska sekmede geri
  // alinan onay ('sync', storage olayi) etiketleri yuklemis bu sekmeyi de yeniler; bu sekmenin
  // sayfasinda bir form alanina yazildiysa yenileme bir sonraki sayfa gecisine kalir (kaydedilmemis
  // metin silinmesin). Metin yalniz tiklanan sayfanin yenilendigini soyluyordu. Kod bu davranistan
  // donerse test kirilir; metin ayni committe guncellenmeli.
  it('privacy bölüm 4: geri alma diğer açık sekmeleri de yeniler, forma yazılmış sekme bir sonraki sayfa geçişinde — kodla aynı (TR + EN)', () => {
    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    const metin = [...pv.matchAll(/\n\s*s4manageP: '([^']*)',/g)].map((x) => x[1]);
    expect(metin, 'TR + EN s4manageP').toHaveLength(2);
    const [tr, en] = metin;
    expect(tr).toContain('sayfa yenilenir ve bu araçlar bir daha yüklenmez');
    expect(tr).toContain('Aynı tarayıcıda bu araçların yüklendiği diğer açık sekmeler de yenilenir');
    expect(tr).toContain('bir form alanına yazdıysanız, yazdıklarınız kaybolmasın diye o sekme bir sonraki sayfa geçişinde yenilenir');
    expect(en).toContain('the page reloads and these tools are not loaded again');
    expect(en).toContain('Other open tabs in the same browser that loaded these tools also reload');
    expect(en).toContain('if you typed into a form field in such a tab, that tab reloads at its next page change');
    // "Her sekme hemen yenilenir" denmez: erteleme gercek
    for (const s of [tr, en]) expect(s).not.toMatch(/hemen yenilenir|reload immediately/i);

    // Kod: geri alinan onay ('choice' ya da 'sync') etiket yuklu sekmeyi yeniler; 'sync'te ve
    // yazilmissa yenileme sayfa gecisine ertelenir; bekleyen yenileme sayfa gecisinde yapilir
    const lib = stripComments(read(path.join(WEB_SRC, 'lib/consent.ts')));
    expect(lib).toContain('const revoke = !granted && trackersLoaded;');
    expect(lib).toContain("const defer = revoke && trigger === 'sync' && ctx.typedInput === true;");
    expect(lib).toContain('reload: revoke && !defer,');
    expect(lib).toContain('reloadOnNavigate: defer,');
    expect(lib).toMatch(/routeChanged\(\) \{\s*typed = false;\s*if \(!pending\) return;\s*pending = false;\s*env\.reload\(\);/);
    // Bilesen: baska sekmedeki karar 'sync' uygular; form yazimi ve sayfa gecisi denetleyiciye gider
    const cc = stripComments(read(path.join(WEB_SRC, 'components/cookie-consent.tsx')));
    expect(cc).toMatch(/apply\(readConsent\(browserConsentStorage, Date\.now\(\)\), 'sync'\);[\s\S]*?window\.addEventListener\('storage', onStorage\)/);
    expect(cc).toContain("document.addEventListener('input', onInput, true)");
    expect(cc).toContain('controller().routeChanged()');
  });

  // Sahip karari 21.10.2026: deneme 14 gun, kayitta baslar (ensureTrialStarted mobil kayit ve
  // welcome-hook'ta; web kaydi trialEndsAt'i kendisi yazar), sure dolunca hesap salt okunur
  // (yalniz satin alma acikken; billing/trial-expiry.guard.ts). Hesap kapanmaz, veri silinmez.
  // Kayit yollari ya da metin degisirse bu test kirilir.
  it('landing SSS "kart gerekiyor mu" cevabı: 14 gün, sonra salt okunur, hesap kapanmaz; deneme hakkı plans.ts ile aynı; deneme kayıtta başlar', () => {
    const apiSrc = path.resolve(HERE, '..');
    const workerSrc = path.resolve(HERE, '../../../worker/src');
    const cagiranlar = [...walk(apiSrc, /\.ts$/), ...walk(workerSrc, /\.ts$/)]
      .filter((f) => !f.endsWith('.spec.ts') && /\.ensureTrialStarted\(/.test(stripComments(read(f))))
      .map((f) => path.relative(apiSrc, f).split(path.sep).join('/'));
    expect(cagiranlar).toEqual(['auth/auth.controller.ts']);
    expect(stripComments(read(path.join(WEB_SRC, 'auth.ts')))).toContain('trialEndsAt: trialEndsAtFrom(new Date()),');

    const trial = findPlan('trial')!;
    const [tr, en] = read(path.join(WEB_SRC, 'lib/i18n.ts')).split('\n').filter((l) => l.includes("'land.faq.a2':"));
    expect(tr).not.toMatch(/pasif/i);
    expect(en).not.toMatch(/passive|deactivat|suspend/i);
    expect(tr).toContain('hesabın kapanmaz ve verilerin silinmez');
    expect(en).toContain('your account is not closed and your data is not deleted');
    expect(tr).toContain(`${trial.articlesPerMonth} makale`);
    expect(en).toContain(`${trial.articlesPerMonth} articles`);
    expect(tr).toContain('14 gün');
    expect(tr).toContain('salt okunur');
    expect(en).toContain('14 days');
    expect(en).toContain('read-only');
  });

  // trial-policy.ts kural 4: sure dolunca salt okunur YALNIZ satin alma acikken; satin alma
  // kapaliyken (PayTR test modu) kilit uygulanmaz. Ajan belgeleri ve /ranksup.md bunu
  // kosulsuz yaziyordu ("14 gün dolunca ... salt okunur olur"); SSS dogru yaziyordu.
  it('deneme sonu salt okunur kurali ajan belgelerinde ve /ranksup.md\'de koşullu (satın alma kapalıyken kilit yok)', () => {
    const policy = read(path.resolve(HERE, '../billing/trial-policy.ts'));
    expect(policy, 'trial-policy kural 4 degisti — belgeleri guncelle').toContain('readOnly: opts.checkoutOpen');
    const KOSUL = 'satın alma geçici olarak kapalıyken hesap kilitlenmez';
    expect(stripComments(read(path.join(MARKETING, 'faq/page.tsx')))).toContain(KOSUL);
    const kaynaklar: Source[] = [
      ...docSources,
      { rel: 'lib/ranksup-md.ts', text: stripComments(read(path.join(WEB_SRC, 'lib/ranksup-md.ts'))) },
    ];
    const kosulsuz = offenders(kaynaklar, /salt okunur olur/, (l) => l.includes(KOSUL));
    expect(kosulsuz).toEqual([]);
    expect(offenders(kaynaklar, /salt okunur olur/).length, 'kural belgelerde anilmiyor').toBeGreaterThanOrEqual(3);
  });

  it('kök layout: kaldırılan sosyal modül, Shopify ve bayat TL fiyat yok; fiyat aralığı plans.ts ile aynı', () => {
    // Yorumlar neyin neden kaldirildigini anlatir; yalniz kod taranir
    const lay = stripComments(read(path.join(WEB_SRC, 'app/layout.tsx')));
    expect(lay).not.toMatch(/sosyal medya planlay|otomatik post|Social Media Management|Shopify|1800-2500/i);
    expect(lay).toContain("priceCurrency: 'USD'");
    expect(lay).not.toContain("priceCurrency: 'TRY'");
    const ucretli = BASE_PLANS.filter((p) => p.monthly_usd > 0);
    expect(lay).toContain(`lowPrice: '${Math.min(...ucretli.map((p) => p.monthly_usd))}'`);
    expect(lay).toContain(`highPrice: '${Math.max(...ucretli.map((p) => p.monthly_usd))}'`);
  });

  it('fiyat sayfası yıllık indirimi doğru söylüyor (10 ay fiyatına 12 ay)', () => {
    const pr = m('pricing/pricing-view.tsx');
    expect(pr).not.toContain('-20%');
    expect(pr).toContain('2 ay bedava');
    for (const p of BASE_PLANS.filter((x) => x.monthly_usd > 0)) expect(p.annual_usd).toBe(p.monthly_usd * 10);
  });

  // /billing/failure (PayTR merchant_fail_url, herkese acik donus sayfasi) karanlik temada
  // okunmuyordu: kart bg-white, baslik govdeden text-foreground (karanlik temada acik renk)
  // aliyordu; "Ödeme Başarısız" beyaz zeminde kayboluyordu. Success sayfasiyla ayni tema
  // token'lari kullanilir; sabit acik renk geri gelirse test kirilir.
  it('/billing/failure karanlık temada okunur: sabit açık zemin ve gri ton yok, success sayfasıyla aynı tema token sınıfları', () => {
    const basarisiz = m('billing/failure/page.tsx');
    const basarili = m('billing/success/page.tsx');
    expect(basarisiz).toContain('Ödeme Başarısız');
    expect(basarisiz).not.toMatch(/\bbg-white\b|\b(?:text|bg|border)-(?:slate|gray)-\d+|\bfrom-red-50\b|\bto-brand-50\b/);
    for (const [ad, src] of [['failure', basarisiz], ['success', basarili]] as const) {
      expect(src, ad).toContain('bg-gradient-to-br from-muted/40 to-brand/5');
      expect(src, ad).toContain('text-center bg-card border');
      expect(src, ad).toContain('text-muted-foreground');
    }
  });
});

// ─── Panel metinleri = kod (18.10.2026) ───────────────────────────────────────
//
// NEDEN: panel bilesenlerinde kodla celisen metinler vardi: butce uyarisi "Yeni
// AI istekleri durduruldu" diyordu (yalniz iki is durur), AI anahtarlari paneli
// STARTER'a "Başlangıç" diyor ve BYOK'u her plana aciyordu, yardim altbilgisi
// hicbir plana dayanmayan "15 dakika ücretsiz ekran paylaşımı" vaat ediyordu.

describe('Panel metinleri = kod', () => {
  const comp = (rel: string) => stripComments(read(path.join(WEB_SRC, 'components', rel)));

  it('AI bütçe uyarısı yalnız bütçe kapısının durdurduğu işleri sayıyor', () => {
    const apiSrc = path.resolve(HERE, '..');
    const cagiranlar = walk(apiSrc, /\.ts$/)
      .filter((f) => !f.endsWith('.spec.ts') && path.basename(f) !== 'quota.service.ts')
      .filter((f) => /\.enforceAiCostBudget\(/.test(read(f)))
      .map((f) => path.basename(f))
      .sort();
    // Yeni bir cagiran eklenirse quota-monitor.tsx uyarisi da guncellenmeli
    expect(cagiranlar).toEqual(['asc-review-reply.service.ts', 'image-alt-suggest.service.ts']);
    const qm = comp('quota-monitor.tsx');
    expect(qm).toContain('Görsel alt metni önerisi');
    expect(qm).toContain('App Store yorum yanıtı taslağı');
    expect(qm).not.toContain('Yeni AI istekleri durduruldu');
  });

  it('AI anahtarları paneli: plan adları plans.ts ile, BYOK planı FEATURE_MIN_PLAN ile aynı; kredi iddiası yok', () => {
    const p = comp('ai-keys-panel.tsx');
    for (const plan of BASE_PLANS) expect(p, plan.id).toContain(`${plan.id.toUpperCase()}: '${plan.name_tr}'`);
    expect(p).toContain(`const BYOK_PLAN = '${FEATURE_MIN_PLAN.byok.toUpperCase()}'`);
    expect(p).not.toMatch(/\$\d+\s*\/\s*(ay|mo)|bedava|ücretsiz\)/i);
    expect(p).not.toMatch(/kotandan düşmez|Planına dahil değil/);
  });

  it('yardım altbilgisi ve Wikipedia sekmesi doğrulanmamış vaat taşımıyor', () => {
    expect(comp('help-article.tsx')).not.toMatch(/ekran paylaşım|15 dakika|totalTime/i);
    const geo = comp('geo-lab-panel.tsx');
    expect(geo).not.toMatch(/%30\+|bir sonraki eğitiminde|60\+ değilse/);
  });

  it('AI anahtarları paneli: anahtarsız sağlayıcı "Ölçülmüyor" der; silme onayı RanksUp anahtarının varlığına bakar', () => {
    // effectiveSource 'none' = ne BYOK ne RanksUp env anahtari: olcum motoru
    // (ai-citation resolveKey) o saglayiciyi olcmez. Eski rozet "Kendi anahtarın
    // bağlı değil", eski onay "havuza düşecek (plana dahilse)" diyordu; 6 asistan
    // her planda dahil, belirleyici olan anahtarin tanimli olmasi.
    const p = comp('ai-keys-panel.tsx');
    expect(p).toContain("'Ölçülmüyor — RanksUp anahtarı tanımlı değil'");
    expect(p).not.toMatch(/Kendi anahtarın bağlı değil|plana dahilse|havuzuna düşecek/);
    expect(p).toMatch(/poolKeyAvailable\s*\?\s*'Ölçüm RanksUp anahtarıyla sürer/);
    expect(p).toContain('RanksUp anahtarı tanımlı olmadığı için bu sağlayıcı artık ölçülmez.');
  });
});

// ─── Otomatik akış metinleri = zamanlayıcı (18.10.2026) ───────────────────────
//
// NEDEN: yardim sayfasi ve SSS "zamanlanan makaleler yayin saatinden 15 dakika
// once uretime girer" diyordu; 15 dk yalniz elle takvime eklenen / tasinan
// yazinin gecikmeli isinde dogru, ilk takvimi saatlik tarama aliyor. "Deneme
// hesabinda plan secilene kadar bekler" kodda yoktu, "8 konu" Tier 1 listesiyle
// sinirli, "30 gun sonra" yeniden yazim Search Console verisine bagli. Sayilar
// koddan okunur; kod degisince metin de degismeli.

describe('Otomatik akış metinleri = zamanlayıcı (article-scheduler, worker)', () => {
  const scheduler = read(path.resolve(HERE, '../articles/article-scheduler.service.ts'));
  const worker = read(path.resolve(HERE, '../../../worker/src/index.ts'));
  const autoPilot = stripComments(read(path.join(MARKETING, 'help/auto-pilot/page.tsx')));
  const faq = stripComments(read(path.join(MARKETING, 'faq/page.tsx')));

  const lead = scheduler.match(/LEAD_TIME_MS = (\d+) \* 60 \* 1000/);
  const ilk = worker.match(/count: autopilot \? (\d+) : (\d+)/);
  const tarama = worker.match(/'PROCESS_SCHEDULED',[\s\S]{0,200}?every: (\d+) \* 60 \* 1000/);

  it('kod sabitleri bulunuyor (takvim öncesi süre, ilk takvim sayısı, tarama aralığı)', () => {
    expect(lead, 'article-scheduler LEAD_TIME_MS').toBeTruthy();
    expect(ilk, 'worker ONBOARDING_CHAIN count').toBeTruthy();
    expect(tarama, 'worker PROCESS_SCHEDULED tekrar araligi').toBeTruthy();
  });

  it('ilk takvim "en fazla" N konu — sayılar worker ile aynı (Tier 1 listesi daha kısa olabilir)', () => {
    const [, acik, kapali] = ilk!;
    expect(autoPilot).toContain(`otomatik akış açıkken en fazla ${acik}, kapalıyken en fazla ${kapali}`);
    expect(faq).toMatch(new RegExp(`en fazla ${acik}\\\\?'i takvime yerleşir`));
    expect(faq).toContain(`up to ${acik} of the topic engine`);
    expect(faq).not.toMatch(/\(2\) \d+ konu takvime|\(2\) \d+ topics are scheduled/);
  });

  it('"N dakika önce" yalnız elle takvime eklenen / taşınan yazı için; ilk takvim saatlik taramayla', () => {
    const dk = lead![1];
    expect(Number(tarama![1]), 'metin "saatlik" diyor').toBe(60);
    // Metnin dayanagi: gecikmeli is yalniz scheduleTopic / rescheduleArticle'da.
    // Ilk takvim ya da programatik SEO gecikmeli is kurmaya baslarsa "saatlik
    // taramayla" cumlesi yanlis olur — bu test kirilir, metin guncellenir.
    const ilkTakvim = scheduler.slice(scheduler.indexOf('async scheduleInitialBatch('), scheduler.indexOf('async claimAndQueue('));
    expect(ilkTakvim.length).toBeGreaterThan(100);
    expect(ilkTakvim, 'ilk takvim gecikmeli is kuruyor: help/auto-pilot ve SSS (3) metnini guncelle').not.toContain('scheduleArticleJob');
    const programatik = read(path.resolve(HERE, '../articles/programmatic-seo.service.ts'));
    expect(programatik, 'programatik SEO gecikmeli is kuruyor: metni guncelle').not.toMatch(/scheduleArticleJob|jobQueue\.enqueue/);
    expect(scheduler.match(/this\.scheduleArticleJob\(/g)?.length, 'gecikmeli isi kuran yerler degisti').toBe(2);
    const tr = [...autoPilot.split('\n'), ...faq.split('\n')].filter((l) => l.includes(`${dk} dakika önce`));
    expect(tr.length).toBeGreaterThanOrEqual(2);
    for (const l of tr) {
      expect(l, l.trim().slice(0, 120)).toMatch(/kendin eklediğin/);
      expect(l, l.trim().slice(0, 120)).toMatch(/saatlik tarama/);
    }
    const en = faq.split('\n').filter((l) => l.includes(`${dk} minutes before`));
    expect(en).toHaveLength(1);
    expect(en[0]).toMatch(/add to the calendar or reschedule yourself/);
    expect(en[0]).toMatch(/hourly scan/);
  });

  it('kodda olmayan ya da koşulsuz eski iddialar geri gelmiyor', () => {
    for (const [ad, metin] of [['help/auto-pilot', autoPilot], ['faq', faq]] as const) {
      expect(metin, ad).not.toMatch(/plan seçilene kadar bekler|yayın saatinden \d+ dakika önce üretime girer|enter generation \d+ minutes before their publish time|yayından 30 gün sonra performansı düşük/);
    }
    // Yeniden yazim Search Console verisine bagli (content-pivot.service.ts)
    const pivot = autoPilot.split('\n').find((l) => l.includes('30 gün'));
    expect(pivot, 'auto-pilot yeniden yazim maddesi').toBeDefined();
    expect(pivot!).toMatch(/Search Console bağlıysa/);
    expect(pivot!).toMatch(/Yarı otomatikte yeni hali onayını bekler/);
  });

  it('takılı sayfa otopilotu maddesi planı, Search Console koşulunu ve site başına sınırı kodla aynı yazıyor', () => {
    const otopilot = read(path.resolve(HERE, '../audit/stuck-page-autopilot.ts'));
    const sinir = otopilot.match(/STUCK_AUTO_RECOVER_PER_SITE = (\d+)/)![1];
    const plan = findPlan(FEATURE_MIN_PLAN.stuckPages)!.name_tr;
    for (const metin of [autoPilot, faq]) {
      const l = metin.split('\n').find((x) => x.includes('takılı kalan RanksUp makaleleri'));
      expect(l, 'takili sayfa maddesi').toBeDefined();
      expect(l!).toContain(`${plan} ve üstü planlarda`);
      expect(l!).toContain('Search Console bağlı');
      expect(l!).toContain(`site başına en fazla ${sinir}`);
      expect(l!).toContain('Tam otomatik');
    }
  });

  it('llms.txt ve llms-full.txt "otomatik yayın"ı onay moduyla birlikte anlatıyor (varsayılan Yarı otomatik)', () => {
    const satirlar = [...llms.split('\n'), ...llmsFull.split('\n')].filter((l) => /otomatik yayın/i.test(l));
    expect(satirlar.length).toBeGreaterThan(0);
    for (const l of satirlar) expect(l, l.slice(0, 120)).toMatch(/Yarı otomatik/);
    const makale = llms.split('\n').find((l) => l.startsWith('- **AI makale**'))!;
    expect(makale).toContain('Yarı otomatik modda (varsayılan)');
    expect(makale).toContain('Tam otomatik modda');
  });

  // SSS "makale kotami asarsam" cevabi (sahip karari 20.10.2026): her yazi uretime alinirken
  // makale hakkindan bir kez duser — kullanicinin baslattigi uretim de, takvim yazisi da
  // (tarama, gecikmeli takvim isi, uretim isi). Hak dolunca hicbir yeni makale uretilmez;
  // deneme hesabi toplam 2 makale, onboarding'in ilki dahil, takvimin geri kalani panelde
  // kilitli ve plan yukseltilince uretilir. Dayandigi kod kapilari degisirse test kirilir.
  it('SSS "makale kotamı aşarsam": hak dolunca yeni makale üretilmez, her makale bir kez düşer, denemede takvimin geri kalanı kilitli (TR + EN)', () => {
    const cevap = (q: string) => {
      const i = faq.indexOf(q);
      expect(i, q).toBeGreaterThan(-1);
      const rest = faq.slice(i);
      return rest.slice(0, rest.indexOf('},'));
    };
    const tr = cevap("q: 'Aylık makale kotamı aşarsam ne olur?'");
    const en = cevap("q: 'What happens if I exceed my monthly article quota?'");
    expect(tr).toContain('Yeni makale üretilmez: kendi başlattığın üretimler durur, takvime yeni konu eklenemez ve plan yükseltmen önerilir; takvimde bekleyen makaleler de hakkın yenilenene ya da planını yükseltene kadar bekler.');
    expect(tr).toContain('Her makale, üretime alındığı anda hakkından bir kez düşer;');
    expect(tr).toContain('Ücretsiz denemedeki 2 makale hakkı sıfırlanmaz; denemede makaleleri sen başlatırsın, site eklenirken takvime yerleşen diğer konular panelde kilitli görünür ve planını yükselttiğinde yazılır.');
    expect(en).toContain('No new articles are generated: generations you start yourself stop, you cannot add new topics to the calendar and you are offered a plan upgrade; scheduled articles also wait until your allowance renews or you upgrade.');
    expect(en).toContain('Each article uses your allowance once, when it enters generation;');
    expect(en).toContain('the other topics scheduled when your site was added appear locked in the dashboard and are written when you upgrade your plan.');
    // Basarisiz uretimin hakki iade edilir (articles/allowance-refund.ts, sahip karari 20.10.2026)
    expect(tr).toContain('üretim makale çıkmadan başarısız olursa o hak geri verilir (yeniden denediğinde yeniden düşer)');
    expect(en).toContain('if the generation fails without producing an article, that allowance is given back (a retry uses it again)');
    expect(autoPilot).toContain('üretim makale çıkmadan başarısız olursa o hak geri verilir');
    // Eski iddialar geri gelmesin: takvim uretimi hakka sayilmaz / onboarding'in ilki herkese ucretsiz
    for (const metin of [faq, autoPilot]) expect(metin).not.toMatch(/makale hakkından düşmez|kendi başlattığın üretimler makale hakkını doldurduysa/);
    // Kod kapilari: elle uretim hak dolunca 403 (tek kosullu UPDATE); takvime ekleme 403;
    // takvim yazisi uretime alinirken duser (tarama, gecikmeli is, uretim isi)
    const quota = read(path.resolve(HERE, '../billing/quota.service.ts'));
    const consume = quota.slice(quota.indexOf('async consumeArticleAllowance('), quota.indexOf('async refundArticleAllowance('));
    expect(consume).toContain('where: { id: userId, articlesUsedThisMonth: { lt: limit } }');
    expect(consume).toContain('throw this.articleQuotaError(user.plan, limit);');
    const hata = quota.slice(quota.indexOf('private articleQuotaError('), quota.indexOf('async consumeArticleAllowance('));
    expect(hata).toMatch(/plan === 'TRIAL'[\s\S]*plan seç[\s\S]*Plan yükseltebilir/);
    const ekle = scheduler.slice(scheduler.indexOf('async scheduleTopic('), scheduler.indexOf('const slug =', scheduler.indexOf('async scheduleTopic(')));
    expect(ekle).toMatch(/if \(!allowed\) \{\s*[\s\S]*?throw new ForbiddenException/);
    const tarama = scheduler.slice(scheduler.indexOf('async processDueArticles('), scheduler.indexOf('private dueArticlesWhere('));
    expect(tarama).toContain('limit = await this.scanUserLimit(u.id, limitByUser);');
    expect(tarama).toMatch(/if \(limit === null\) \{\s*skippedQuota\+\+;/);
    const sahiplen = scheduler.slice(scheduler.indexOf('private async claimAndQueue('), scheduler.indexOf('private async chargeArticle('));
    expect(sahiplen).toContain("return { outcome: 'quota_exhausted' };");
    const ilk = scheduler.slice(scheduler.indexOf('async scheduleInitialBatch('), scheduler.indexOf('private async claimAndQueue('));
    // Sahip karari 21.10.2026: deneme hesabinda onboarding hic makale uretmez (yalniz konu basligi)
    expect(ilk, 'deneme hesabinda onboarding makale uretmez').toContain('const generateNow = i === 0 && autoGenerate;');
    expect(ilk).toContain('const autoGenerate = automaticGenerationAllowed(site.user.plan);');
    expect(tr).toContain('denemede makaleleri sen başlatırsın');
    expect(en).toContain('on the trial you start articles yourself');
  });

  it('sözlük: editör skoru bugünkü ölçeği (pipeline EDITOR_MAX_SCORE) ve eski 60 ölçeğini söylüyor', () => {
    const pipeline = read(path.resolve(HERE, '../articles/pipeline.service.ts'));
    const max = pipeline.match(/EDITOR_MAX_SCORE = (\d+);/)![1];
    const g = stripComments(read(path.join(WEB_SRC, 'lib/glossary.ts')));
    const satir = g.split('\n').find((l) => l.includes('AI editörden aldığı kalite puanı'))!;
    expect(satir).toContain(`= ${max} üzerinden`);
    expect(satir).toContain('60 üzerinden');
  });
});

// ─── Olcum hakki metinleri = measurement-allowance.ts (18.10.2026) ───────────
//
// NEDEN: 16.10.2026'dan beri ADMIN disindaki her hesap kayan 7 gunde 1 AI
// gorunurluk olcumu yapabiliyor; AI testi, yol haritasi, Prompt Lab, site
// taramasindaki AI testi, Urun Radari, GEO isi haritasi ve digerleri ayni hakki
// paylasiyor (billing/measurement-allowance.ts). Fiyat kartlari ise hala
// "20 / 75 / 300 / 1.000 AI gorunurluk calistirmasi / ay" diyordu: musteri bunu
// "ayda 20 olcum" diye okuyordu, oysa kural ayda en fazla 5 olcume izin verir.
// "Calistirma" ayri ve gercek bir birim: QuotaService citationTests aylik tavani;
// AI testi 1, Prompt Lab'de her soru ve her dal 1 sayilir (ai-citation.service
// runForSite / runQueries -> incrementCitationUsage). Bu yuzden tek haftalik
// olcum ("Tumunu calistir") birden cok calistirma harcar. Metinler iki kurali
// birlikte ve koddaki sayilarla soyler; kod degisirse bu blok kirilir.

describe('Olcum hakki metinleri = measurement-allowance.ts', () => {
  const allowanceSvc = read(path.resolve(HERE, '../billing/measurement-allowance.service.ts'));
  const worker = read(path.resolve(HERE, '../../../worker/src/index.ts'));
  const panel = read(path.join(WEB_SRC, 'components/prompt-lab-panel.tsx'));
  const i18n = read(path.join(WEB_SRC, 'lib/i18n.ts'));
  /** JSX ve tek tirnakli kaynak kacislarini duz metne cevirir (&apos;, \', &ldquo;) */
  const metin = (s: string) => s.replace(/&apos;/g, "'").replace(/\\'/g, "'").replace(/&[lr]dquo;/g, '"');
  const sayfa = (rel: string) => metin(stripComments(read(path.join(MARKETING, rel))));
  const fmtTr = (n: number) => n.toLocaleString('tr-TR');
  const fmtEn = (n: number) => n.toLocaleString('en-US');
  /** 31 gunluk ayda kayan 7 gunluk pencereyle en fazla kac olcum yapilabilir */
  const ayEnFazla = Math.ceil((31 * 24 * 60 * 60 * 1000) / MEASUREMENT_WINDOW_MS);
  /** Paneldeki "Tumunu calistir" tek olcumde en fazla kac soru calistirir */
  const tumuLimit = Number(panel.match(/(?:start)?[rR]unAllPrompts\(siteId, \{ withFanout: false, limit: (\d+) \}\)/)?.[1]);
  const trial = findPlan('trial')!;
  const ucretli = BASE_PLANS.filter((p) => p.id !== 'trial');
  /** Kartta gorunen maddeler: planin kendi maddeleri + "X'teki her sey, arti:" zinciri */
  const zincir = (p: BasePlan, dil: 'features_tr' | 'features_en'): string[] =>
    [...p[dil], ...(p.inheritsFrom ? zincir(findPlan(p.inheritsFrom)!, dil) : [])];
  const HAFTALIK_TR = 'Hesap başına haftada 1 AI görünürlük ölçümü';
  const HAFTALIK_EN = '1 AI visibility measurement per account per week';

  it('kod sabitleri: pencere 7 gun, hak hesap basina, paneldeki "Tümünü çalıştır" limiti bulunuyor', () => {
    expect(MEASUREMENT_WINDOW_MS, 'pencere degisti: "haftada 1" / "7 günde 1" metinlerini guncelle').toBe(7 * 24 * 60 * 60 * 1000);
    expect(allowanceSvc, 'hak anahtari artik kullanici basina degil: "hesap başına" metinlerini guncelle').toMatch(/return `ai-olcum:\$\{userId\}`;/);
    expect(ayEnFazla).toBe(5);
    expect(Number.isInteger(tumuLimit) && tumuLimit > 0, 'prompt-lab-panel runAllPrompts limiti bulunamadi').toBe(true);
  });

  it('çalıştırma birimi kodla aynı (AI testi 1, Prompt Lab sorusu / dalı 1, Ürün Radarı sorusu 1, ısı haritası sorusu 1, App Prompt Lab sorusu 1) ve llms-full.txt bunu yazıyor', () => {
    const citation = read(path.resolve(HERE, '../audit/ai-citation.service.ts'));
    const promptLab = read(path.resolve(HERE, '../audit/prompt-lab.service.ts'));
    const radar = read(path.resolve(HERE, '../audit/product-radar.service.ts'));
    const heatmap = read(path.resolve(HERE, '../audit/geo-heatmap.service.ts'));
    const appPromptLab = read(path.resolve(HERE, '../aso/aso-prompt-lab.service.ts'));
    // runForSite ve runQueries cagri basina en fazla 1 calistirma sayar; ucuncusu
    // consumeCitationRuns (heatmap ve App Prompt Lab'in olculen soru sayisi kadar)
    expect(citation.match(/this\.quota\.incrementCitationUsage\(/g)?.length, 'calistirma sayan yerler degisti: birim metinlerini guncelle').toBe(3);
    expect(promptLab).toContain('this.citation.runQueries(siteId, [prompt.text]');
    expect(promptLab).toContain('this.citation.runQueries(siteId, [branch.text]');
    expect(radar).toContain('this.citation.runQueries(siteId, [query]');
    // Haftalik otomatik radar taramasi sistem kosumu: hakka da tavana da sayilmaz
    expect(radar).toMatch(/this\.run\(s\.id, \{ trigger: 'system' \}\)/);
    // Isi haritasi haftalik hakki kullanir VE aylik tavana tabidir: olcum oncesi
    // soru sayisi kadar hak arar, olculen soru basina 1 duser. Eskiden hic
    // saymiyordu (20 soru x 4 saglayici kota disi kosuyordu).
    expect(heatmap).toContain('noteMeasured()');
    expect(heatmap).toContain('this.citation.assertCitationRuns(site.userId, probeQueries.length');
    expect(heatmap).toContain('this.citation.consumeCitationRuns(site.userId, measuredQueries)');
    // App Prompt Lab: sorulan soru basina 1
    expect(appPromptLab).toContain("this.citation.assertCitationRuns(site.userId, 1, ");
    expect(appPromptLab).toContain('this.citation.consumeCitationRuns(site.userId, 1)');
    // DIKKAT: llms-full.txt hala "GEO ısı haritası çalıştırma saymaz" diyor; metin
    // pazarlama/llms sahibinde. Metin guncellenince asagidaki on ek kontrolu
    // ısı haritası ve App Prompt Lab birimini de iceren tam cumleye genisletilmeli.
    expect(llmsFull).toContain("AI testi 1, Prompt Lab'de her soru ve her dal 1, Ürün Radarı'nda her kategori sorusu 1 çalıştırma sayılır");
    expect(llmsFull).toContain(`"Tümünü çalıştır" tek ölçümde en fazla ${tumuLimit} soruyu`);
    expect(llmsFull).toContain(`hesap başına 7 günde 1 ölçüm, yani ayda en fazla ${ayEnFazla}`);
    expect(llmsFull).toContain("Ürün Radarı'nın haftalık otomatik taraması bu hakka sayılmaz");
  });

  it('fiyat kartı: haftalık ölçüm her ücretli planda görünüyor (miras zinciriyle), denemede "haftada en fazla 1"', () => {
    for (const p of ucretli) {
      expect(zincir(p, 'features_tr').some((m) => m.startsWith(HAFTALIK_TR)), `${p.id} TR`).toBe(true);
      expect(zincir(p, 'features_en').some((m) => m.startsWith(HAFTALIK_EN)), `${p.id} EN`).toBe(true);
    }
    expect(trial.features_tr.join('\n')).toContain(`${trial.aiRunsPerMonth} görünürlük çalıştırması (haftada en fazla 1 ölçüm)`);
    expect(trial.features_en.join('\n')).toContain(`${trial.aiRunsPerMonth} visibility runs (at most 1 measurement per week)`);
  });

  it('fiyat kartı: çalıştırma sayısı plans.ts ile aynı ve tavan olarak yazılıyor; birim tanımlı', () => {
    for (const p of ucretli) {
      expect(p.features_tr.join('\n'), `${p.id} TR`).toContain(`ayda en fazla ${fmtTr(p.aiRunsPerMonth)} çalıştırma`);
      expect(p.features_en.join('\n'), `${p.id} EN`).toContain(`up to ${fmtEn(p.aiRunsPerMonth)} runs/mo`);
      // Ust plan alicisi yukseltmenin olcum sikligini artirdigini sanmasin
      if (p.inheritsFrom) {
        expect(p.features_tr.join('\n'), `${p.id} TR`).toContain('ölçüm yine haftada 1');
        expect(p.features_en.join('\n'), `${p.id} EN`).toContain('still 1 measurement a week');
      }
    }
    const tr = BASE_PLANS.flatMap((p) => p.features_tr);
    const en = BASE_PLANS.flatMap((p) => p.features_en);
    expect(tr.some((m) => m.includes('AI testi 1, Prompt Lab’de her soru ve her dal 1 çalıştırma'))).toBe(true);
    expect(en.some((m) => m.includes('an AI test is 1 run, each Prompt Lab question or branch is 1'))).toBe(true);
    for (const m of tr) expect(m, m).not.toMatch(/görünürlük çalıştırması\s*\/\s*ay|her çalıştırma \d+ AI/);
    for (const m of en) expect(m, m).not.toMatch(/visibility runs\/mo|every run queries/);
  });

  it('fiyat kartı: BYOK maddesi haftalık kuralı söylüyor (sınırsız ölçüm gibi okunmuyor)', () => {
    const byokTr = BASE_PLANS.flatMap((p) => p.features_tr).find((m) => m.startsWith('BYOK'))!;
    const byokEn = BASE_PLANS.flatMap((p) => p.features_en).find((m) => m.startsWith('BYOK'))!;
    expect(byokTr).toContain('haftada 1 ölçüm kuralı geçerli');
    expect(byokEn).toContain('the weekly measurement rule still applies');
    expect(byokTr).not.toMatch(/ölçüm durmaz/);
    expect(byokEn).not.toMatch(/measurement continues past pool quota$/);
  });

  it('sözlük (/help/glossary): deneme girişi haftalık sınırı söylüyor', () => {
    const g = stripComments(read(path.join(WEB_SRC, 'lib/glossary.ts')));
    const satir = g.split('\n').find((l) => l.includes('Ücretsiz deneme planı'))!;
    expect(satir).toContain(`${trial.aiRunsPerMonth} AI görünürlük çalıştırması (haftada en fazla 1 ölçüm)`);
  });

  it('llms.txt: AI görünürlük modülü haftalık kuralı söylüyor', () => {
    const geo = llms.split('\n').find((l) => l.startsWith('- **AI görünürlük (GEO)**'));
    expect(geo, 'llms.txt GEO satiri').toBeDefined();
    expect(geo!).toContain('hesap başına 7 günde 1');
  });

  it('SSS: deneme cevabı haftalık sınırı, "ayda kaç ölçüm" sorusu kuralı kodla aynı yazıyor', () => {
    const faq = sayfa('faq/page.tsx');
    const cevap = (q: string) => {
      const i = faq.indexOf(q);
      expect(i, q).toBeGreaterThan(-1);
      const rest = faq.slice(i);
      return rest.slice(0, rest.indexOf('},'));
    };
    expect(cevap("q: 'Ücretsiz olarak ne kadar kullanabilirim?'")).toContain(`${trial.aiRunsPerMonth} AI görünürlük çalıştırması (haftada en fazla 1 ölçüm)`);
    expect(cevap("q: 'How much can I use for free?'")).toContain(`${trial.aiRunsPerMonth} AI visibility runs (at most 1 measurement per week)`);
    const tr = cevap("q: 'Ayda kaç AI görünürlük ölçümü yapabilirim?'");
    const en = cevap("q: 'How many AI visibility measurements can I run per month?'");
    expect(tr).toContain('hesap başına 7 günde 1');
    expect(tr).toContain(`ayda en fazla ${ayEnFazla}`);
    expect(tr).toContain("AI testi 1, Prompt Lab'de her soru ve her dal 1 çalıştırma");
    expect(tr).toContain('sonuç vermeyen ölçüm hakkı yakmaz');
    expect(en).toContain('every 7 days per account');
    expect(en).toContain(`at most ${ayEnFazla} a month`);
    expect(en).toContain('an AI test counts as 1 run and each Prompt Lab question or branch as 1');
    // Plan sayilari SSS'de yazilmaz (bayatliyordu): cevap fiyat sayfasina yonlendirir
    for (const p of BASE_PLANS) {
      expect(tr, p.id).not.toContain(`${fmtTr(p.aiRunsPerMonth)} çalıştırma`);
      expect(en, p.id).not.toContain(`${fmtEn(p.aiRunsPerMonth)} runs`);
    }
  });

  it('kurulum taraması ve başlangıç ölçümü haftalık haktan düşmez (worker trigger system); metin bunu söylüyor', () => {
    expect(worker, 'kurulum taramasi kullanici tetikli oldu: getting-started ve SSS metnini guncelle').toMatch(/services\.audit\.runAudit\(siteId, \{ trigger: 'system' \}\)/);
    expect(worker, 'baslangic olcumu kullanici tetikli oldu: metni guncelle').toMatch(/citationTracker\.snapshotSite\(siteId, \{ trigger: 'system' \}\)/);
    const gs = sayfa('help/getting-started/page.tsx');
    expect(gs).not.toMatch(/ölçüm hakkını kullanmış olabilir/);
    expect(gs).toContain('haftalık hakkından düşmez');
    expect(gs).toContain(`${trial.aiRunsPerMonth} AI görünürlük çalıştırması (haftada en fazla 1 ölçüm)`);
    expect(sayfa('faq/page.tsx')).toContain('Site kurulumundaki ilk tarama ve otomatik akışın başlangıç ölçümü bu hakka sayılmaz');
  });

  it('yardım: plan listesi plans.ts ile aynı; haftalık kural ve "Tümünü çalıştır" örneği panelle aynı', () => {
    const bill = sayfa('help/billing/page.tsx');
    for (const p of BASE_PLANS) {
      const li = bill.split('\n').find((l) => l.includes(`<li><strong>${p.name_tr}</strong>`));
      expect(li, `${p.id} satiri`).toBeDefined();
      expect(li!).toContain(`${p.articlesPerMonth} makale`);
      expect(li!).toContain(`${p.sites} site`);
      expect(li!).toContain(p.id === 'trial'
        ? `${p.aiRunsPerMonth} AI görünürlük çalıştırması (haftada en fazla 1 ölçüm)`
        : `ayda en fazla ${fmtTr(p.aiRunsPerMonth)} çalıştırma`);
    }
    expect(bill).toContain('hesap başına 7 günde 1');
    expect(bill).toContain('tüm sitelerin');
    expect(bill).toContain(`tek ölçümde en fazla ${tumuLimit} soruyu`);
    const ai = sayfa('help/ai-visibility/page.tsx');
    expect(ai).toContain('tüm sitelerin');
    expect(ai).toContain('site taramasındaki AI testi');
    expect(ai).toContain("AI testi 1, Prompt Lab'de her soru ve her dal 1 çalıştırma");
  });

  it('landing fiyat dipnotu ve /compare haftalık kuralı söylüyor; EN metin ölçümü "run" diye anmıyor', () => {
    const satirlar = (k: string) => i18n.split('\n').filter((l) => l.includes(`'${k}':`));
    for (const k of ['land.pric.footer_note', 'land.pricing.footer_note']) {
      const [tr, en] = satirlar(k);
      expect(tr, k).toContain('haftada 1 AI görünürlük ölçümü');
      expect(en, k).toContain('1 AI visibility measurement per week');
    }
    const cmp = sayfa('compare/compare-view.tsx');
    expect(cmp).toContain('ölçümü sen başlatırsın, hesap başına 7 günde 1');
    expect(cmp).toContain('you start each measurement, once every 7 days per account');
    // EN kartlarda "run" aylik calistirma birimi; olcum eylemine "run" denmez
    expect(cmp).not.toMatch(/you start each run\b/);
    expect(sayfa('faq/page.tsx')).not.toMatch(/Every run is stored|any two runs can be compared/);
  });

  it('hiçbir müşteri metni aylık çalıştırmayı "en fazla"sız, ölçüm hakkı gibi satmıyor', () => {
    // (?<![\d.,]) "1.000" icindeki "000"den yeniden eslesmeyi engeller
    const tr = /(?<!en fazla )(?<![\d.,])\d[\d.]*\s+(?:AI\s+)?görünürlük çalıştırması\s*\/\s*ay\b/;
    const en = /(?<!up to )(?<![\d.,])\d[\d,]*\s+(?:AI\s+)?visibility runs?\s*(?:\/\s*mo|per month)\b/i;
    const kart: Source[] = [{ rel: 'plans.ts', text: BASE_PLANS.flatMap((p) => [...p.features_tr, ...p.features_en]).join('\n') }];
    const kaynaklar = [...webSources, ...docSources, ...kart];
    expect(offenders(kaynaklar, tr)).toEqual([]);
    expect(offenders(kaynaklar, en)).toEqual([]);
  });
});

// RanksUp Video (21.10.2026): belgeler, kullanim sartlari, gizlilik ve SSS koddaki plan kapisi
// (FEATURE_MIN_PLAN.articleVideo), aylik hak (VIDEOS_PER_MONTH) ve davranisla (metin koruyucusu,
// filigran, platformda yayin YOK) ayni kalmali. Sayi ya da kapi degisirse bu test kirilir; metin
// ayni committe guncellenir.
describe('RanksUp Video belgeleri = kod', () => {
  const minPlan = findPlan(FEATURE_MIN_PLAN.articleVideo)!.name_tr;
  const sayilar = `Profesyonel ${VIDEOS_PER_MONTH.pro}, Ajans ${VIDEOS_PER_MONTH.agency}, Kurumsal ${VIDEOS_PER_MONTH.enterprise} video`;
  const videoSrc = path.resolve(HERE, '../videos');

  it('plan kapisi Profesyonel; llms.txt ve llms-full.txt aylik haklari plans.ts ile ayni yaziyor', () => {
    expect(minPlan).toBe('Profesyonel');
    for (const [ad, doc] of [['llms.txt', llms], ['llms-full.txt', llmsFull]] as const) {
      expect(doc, ad).toContain(`aylık hak: ${sayilar}`.replace('aylık hak', ad === 'llms.txt' ? 'aylık hak' : 'Aylık hak'));
      expect(doc, ad).toContain('https://ranksup.ai/help/video');
      expect(doc, ad).toContain('RanksUp videoyu hiçbir platformda yayınlamaz');
    }
    expect(llms).toContain(`RanksUp Video (ayda ${VIDEOS_PER_MONTH.pro} video)`);
    expect(llmsFull).toContain(`### RanksUp Video — ${minPlan} ve üstü`);
  });

  it('kullanim sartlari 8. madde (TR + EN): marka izni, yayin sorumlulugu musteride, platformda yayin yok', () => {
    const t = read(path.join(MARKETING, 'terms/page.tsx'));
    expect(t).toContain("h: '8. RanksUp Video ve Marka Öğeleri'");
    expect(t).toContain("h: '8. RanksUp Video and Brand Assets'");
    expect(t).toContain('RanksUp’ın bunları bu amaçla işlemesine izin verdiğinizi kabul edersiniz');
    expect(t).toContain('yayınlanan videonun içeriği ile ilgili platformların kurallarına uyum sizin sorumluluğunuzdadır');
    expect(t).toContain('RanksUp videoları sizin adınıza hiçbir platformda yayınlamaz');
    expect(t).toContain('you allow RanksUp to process them for this purpose');
    expect(t).toContain('RanksUp does not publish videos on any platform on your behalf');
    // Madde numaralari kaymadi: iade hala 4. madde (yardim sayfasi md. 4'e atif yapiyor)
    expect(t).toContain("h: '4. İptal & İade'");
    expect(t).toMatch(/updated: 'Son güncelleme: [^']*21 Ekim 2026 — 8\. madde/);
  });

  it('gizlilik (TR + EN): marka okuma, herkese acik ama tahmin edilmesi guc baglanti, silinince dosya gider; yalniz makale metni Anthropic e', () => {
    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    expect(pv).toContain("'RanksUp Video: video istediğinizde sitenizin herkese açık sayfalarından okunan ad, logo ve tema rengi");
    expect(pv).toContain("'RanksUp Video: when you request a video, the name, logo and theme colour read from the public pages of your site");
    expect(pv).toContain('RanksUp Video’da yalnızca makalenizin metni, video metnini çıkarmak için Anthropic Claude’a gönderilir');
    expect(pv).toContain('For RanksUp Video only your article text is sent to Anthropic Claude');
    const notlar = [...pv.matchAll(/changeNote: '([^']*)',/g)].map((x) => x[1]);
    expect(notlar[0]).toContain('RanksUp Video için sitenizden okunan marka bilgileri');
    expect(notlar[1]).toContain('produced for RanksUp Video');
    // Iddialarin dayanagi: video ve site silme dosyalari da siler; LLM'e yalniz makale metni gider
    // Silme: mp4 + poster + yarim render dosyalari (<id>.mp4.part*) tek yardimciyla
    expect(read(path.join(videoSrc, 'videos.service.ts'))).toContain('await removeVideoFiles(siteId, row.id)');
    expect(read(path.join(videoSrc, 'article-video.config.ts'))).toMatch(/\[f\.mp4, f\.poster, \.\.\.parts\]/);
    expect(read(path.resolve(HERE, '../sites/sites.service.ts'))).toContain('await removeSiteVideoFiles(id)');
    expect(read(path.resolve(HERE, '../me/account-purge.service.ts'))).toContain('removeSiteVideoFiles(siteId)');
    const copy = stripComments(read(path.join(videoSrc, 'article-video-copy.ts')));
    expect(copy).not.toMatch(/images:|logoDataUri/);
  });

  it('SSS ve yardim sayfasi plan adini koddan; sayi yazmaz (fiyat sayfasina yonlendirir); filigran ve yayin iddiasi kodla ayni', () => {
    const faq = read(path.join(MARKETING, 'faq/page.tsx'));
    expect(faq).toContain(`${minPlan} ve üstü planlarda açıktır`);
    expect(faq).toContain('Professional and higher plans');
    const help = read(path.join(MARKETING, 'help/video/page.tsx'));
    expect(help).toContain(`<strong>${minPlan} ve üstü</strong> planlarda açıktır`);
    expect(help).toContain('RanksUp videoyu senin adına hiçbir platformda yayınlamaz');
    expect(help).toContain('ranksup.ai ile üretildi');
    // Filigran gercekten sablonda ve acik
    expect(read(path.resolve(HERE, '../../../video/src/article-short/ArticleShort.tsx'))).toContain('ranksup.ai ile üretildi');
    expect(read(path.join(videoSrc, 'article-video.config.ts'))).toContain('export const VIDEO_WATERMARK = true;');
    // "Hicbir platformda yayinlamaz": video modulunde platform yukleme kodu yok
    const kod = fs.readdirSync(videoSrc).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => stripComments(read(path.join(videoSrc, f)))).join('\n');
    expect(kod).not.toMatch(/tiktok|instagram|youtube|graph\.facebook|upload/i);
  });

  // Site ve urun tanitim videolari (21.10.2026): sartlar md.8, gizlilik, KVKK, SSS, yardim, llms ve
  // fiyat karti ayni davranisi soyler; dayanaklari kodda (alan adi kurali, iki kaynakli fiyat,
  // ortak hak, modele gorsel gitmez).
  it('site/urun tanitimi: belgeler ve kod ayni (kendi alan adi, dogrulanmis fiyat, gorsel haklari, ortak hak)', () => {
    const t = read(path.join(MARKETING, 'terms/page.tsx'));
    expect(t).toContain('ürün görselleri üzerinde gerekli haklara sahip olduğunuzu');
    expect(t).toContain('yalnızca sizin sitenizin kendi sayfalarından alınır; başka alan adlarındaki sayfalardan video üretilmez');
    expect(t).toContain('product images and that you allow RanksUp to process them for this purpose');
    expect(t).toContain('taken only from your own site’s pages; pages on other domains are not used');
    const pv = stripComments(read(path.join(MARKETING, 'privacy/page.tsx')));
    expect(pv).toContain('site ve ürün tanıtım videolarında bunun yerine sitenizin kendi sayfasının metni');
    expect(pv).toContain('for site and product promo videos the text of your own site’s page');
    expect(pv).toContain('Logonuz, ürün görselleriniz ve marka renginiz yapay zekâ sağlayıcısına gönderilmez');
    expect(read(path.join(MARKETING, 'kvkk/page.tsx'))).toContain('ana sayfanızın ya da belirttiğiniz ürün/hizmet sayfasının metni ve ürün görseli');
    const faq = read(path.join(MARKETING, 'faq/page.tsx'));
    expect(faq).toContain('Ürün videosu yalnız sitenin kendi alan adındaki sayfadan üretilir');
    expect(faq).toContain('Product videos are made only from pages on your own domain');
    const help = read(path.join(MARKETING, 'help/video/page.tsx'));
    expect(help).toContain('Sayfa yalnızca <strong>sitenin kendi alan adında</strong> olabilir');
    expect(help).toContain('Makale, site ve ürün videoları aynı aylık haktan düşer');
    expect(llms).toContain('sitenin kendi alan adındaki bir ürün/hizmet sayfasından ürün tanıtımı');
    expect(llmsFull).toContain('Makale, site ve ürün videoları aynı haktan düşer');
    const kart = BASE_PLANS.find((p) => p.id === 'pro')!;
    expect(kart.features_tr.join('\n')).toContain('RanksUp Video — makale, site ve ürün tanıtım videoları');
    expect(kart.features_en.join('\n')).toContain('RanksUp Video — article, site and product promo videos');
    // Dayanaklar: alan adi kurali (yonlendirme dahil), iki kaynakli fiyat, ortak hak, modele gorsel gitmez
    const src = stripComments(read(path.join(videoSrc, 'promo-video-source.ts')));
    expect(src).toContain('allowRedirect: (next) => sameSiteHost(next.hostname, siteUrl)');
    expect(src).toMatch(/if \(\/svg\|icon\/\.test\(t\)\) return null;/);
    const page = stripComments(read(path.resolve(HERE, '../../../video/scripts/article-short/page.mjs')));
    expect(page).toContain("if (!hit) return { verified: false, sources: structured.via, reason: 'yapisal fiyat sayfanin gorunur metninde yok — gosterilmez' };");
    const svc = stripComments(read(path.join(videoSrc, 'videos.service.ts')));
    expect(svc.match(/consumeVideoAllowance\(/g)).toHaveLength(1); // uc tur tek hak cagrisi
    const copy = stripComments(read(path.join(videoSrc, 'article-video-copy.ts')));
    expect(copy).toContain('promoUserContent(source)');
    expect(copy).not.toMatch(/image|logoDataUri/);
  });

  it('"makalede (birebir) gecmeyen sayi reddedilir" iddiasi (Sartlar md.8, SSS, /help/video, llms.txt) = tam uyelik koruyucusu', () => {
    expect(llms).toContain('makalede birebir geçmeyen sayıları reddeden bir denetimden geçer');
    expect(read(path.join(MARKETING, 'terms/page.tsx'))).toContain('makalede geçmeyen sayıları reddeden bir denetimden geçer');
    expect(read(path.join(MARKETING, 'help/video/page.tsx'))).toContain('makalede birebir geçmeyen bir sayı');
    expect(read(path.join(MARKETING, 'faq/page.tsx'))).toContain('makalede geçmeyen bir sayı');
    // Dayanak: alt-dize aramasi DEGIL ("2025" iceren makale uydurma "20"yi hakli cikarmasin)
    const copy = stripComments(read(path.resolve(HERE, '../../../video/scripts/article-short/copy.mjs')));
    expect(copy).toContain('if (!srcNums.has(n.key)) errors.push(');
    expect(copy).not.toMatch(/src\.includes\(n\)/);
  });

  // Tempo (21.10.2026): videolar artik sabit 15 sn degil. Belgelerdeki sure araliklari panelin sure
  // tablosundan (web lib/article-video.ts VIDEO_TEMPO_SECONDS; apps/video okunurluk denetimi o
  // tabloyu hesapla dogrular) okunur; "15 saniyelik" sabit iddiasi hicbir yerde kalmamali.
  it('tempo: belgeler sure araligini panel tablosuyla ayni soyler; sabit "15 saniyelik" iddiasi yok', () => {
    const lib = read(path.join(WEB_SRC, 'lib/article-video.ts'));
    const rows = [...lib.matchAll(/'[a-z]+\.[a-z]+': \{ fast: \[(\d+), (\d+)\], normal: \[(\d+), (\d+)\], slow: \[(\d+), (\d+)\] \}/g)].map((m) => m.slice(1).map(Number));
    expect(rows).toHaveLength(5);
    const normal = [Math.min(...rows.map((r) => r[2])), Math.max(...rows.map((r) => r[3]))];
    const slow = [Math.min(...rows.map((r) => r[4])), Math.max(...rows.map((r) => r[5]))];
    const help = read(path.join(MARKETING, 'help/video/page.tsx'));
    expect(help).toContain(`süre metnin uzunluğuna göre yaklaşık ${normal[0]}–${normal[1]} saniyedir`);
    expect(help).toContain(`(yaklaşık ${slow[0]}–${slow[1]} saniye)`);
    expect(help).toContain('Video hiçbir tempoda 60 saniyeyi geçmez; her tempo bir video hakkı kullanır.');
    expect(llmsFull).toContain(`Normal (varsayılan) yaklaşık ${normal[0]}–${normal[1]} sn ve Yavaş yaklaşık ${slow[0]}–${slow[1]} sn`);
    expect(llms).toContain(`Süre 15–${slow[1]} sn, tempo seçilebilir`);
    const faq = read(path.join(MARKETING, 'faq/page.tsx'));
    expect(faq).toContain(`Normal ve Yavaş’ta metnin uzunluğuna göre ${normal[0]}–${slow[1]} sn`);
    expect(faq).toContain(`Normal and Slow take ${normal[0]}–${slow[1]} s depending on how long the text is`);
    const panel = [lib, read(path.join(WEB_SRC, 'components/article-video.tsx')), read(path.join(WEB_SRC, 'app/(dashboard)/sites/[id]/videos/page.tsx'))];
    for (const [ad, doc] of [['help', help], ['faq', faq], ['llms', llms], ['llms-full', llmsFull], ['panel', panel.join('\n')]] as const) {
      expect(doc, ad).not.toMatch(/15 saniyelik|15-second|15 sn dikey|24 sn yatay|· 15 sn'|· 24 sn'/);
    }
    // Dayanaklar: 60 sn tavani, yeni istekte varsayilan 'normal', tempo kayitta ve render'a gider
    const tl = JSON.parse(read(path.resolve(HERE, '../../../video/src/marketing/timeline.json')));
    expect(tl.tempo.maxSeconds).toBe(60);
    expect(slow[1]).toBeLessThanOrEqual(tl.tempo.maxSeconds);
    expect(read(path.join(videoSrc, 'article-video.config.ts'))).toContain("export const DEFAULT_VIDEO_TEMPO: VideoTempo = 'normal';");
    expect(stripComments(read(path.join(videoSrc, 'videos.service.ts')))).toContain('tempo: input.tempo ?? DEFAULT_VIDEO_TEMPO');
    expect(stripComments(read(path.join(videoSrc, 'video-render.service.ts')))).toContain('const tempo = videoTempoOf(raw);');
  });
});

/**
 * /rehber (GEO icerik merkezi) urun iddialari kodla ayni. Makaleler web
 * content/rehber/*.ts veri modullerinde; genel yasak kaliplar (7 asistan, 6 ajan,
 * kosulsuz Llama...) zaten webSources taramasina giriyor. Burada fiyat, plan
 * kapisi, deneme ve olcum sikligi plans.ts / trial-policy / measurement-allowance
 * ile karsilastirilir. Yayin kapisinin geri kalani web lib/rehber.spec.mts'te.
 */
describe('Rehber (/rehber) = ürün', () => {
  const REHBER = path.join(WEB_SRC, 'content/rehber');
  const dosya = (slug: string) => stripComments(read(path.join(REHBER, `${slug}.ts`)));
  const tum = walk(REHBER, /\.ts$/).map((f) => ({ rel: path.relative(REHBER, f), text: stripComments(read(f)) }));
  const planAdi = (f: keyof typeof FEATURE_MIN_PLAN) => findPlan(FEATURE_MIN_PLAN[f])!.name_tr;

  it('rehber veri modulleri bulunuyor (7 makale + kayit + kaynaklar + tipler)', () => {
    expect(tum.length).toBe(10);
  });

  it('RanksUp plan fiyatlari plans.ts ile ayni; elle yazilmis bayat tutar yok', () => {
    let sayi = 0;
    for (const p of BASE_PLANS.filter((x) => x.monthly_usd > 0)) {
      const re = new RegExp(`${p.name_tr} \\$([\\d.,]+)\\/ay`, 'g');
      for (const s of tum) {
        for (const m of s.text.matchAll(re)) {
          sayi++;
          expect(Number(m[1].replace(/[.,]/g, '')), `${s.rel}: ${m[0]}`).toBe(p.monthly_usd);
        }
      }
    }
    expect(sayi, 'karsilastirma makalesi RanksUp baslangic fiyatini plans.ts adiyla yaziyor').toBeGreaterThan(0);
    expect(dosya('yapay-zeka-gorunurluk-araclari')).toContain(`${findPlan('starter')!.name_tr} $${findPlan('starter')!.monthly_usd}/ay`);
    // Fiyat notu Kullanim Sartlari ile ayni: "KDV dahil"
    expect(read(path.join(MARKETING, 'terms/page.tsx'))).toContain('Aylık veya yıllık ödeme. KDV dahil.');
    expect(dosya('yapay-zeka-gorunurluk-araclari')).toContain(`${findPlan('starter')!.name_tr} $${findPlan('starter')!.monthly_usd}/ay, KDV dahil`);
  });

  it('plan kapilari kodla ayni (App Prompt Lab, AXO, Canlı Tarayıcı, kapalı döngü)', () => {
    const mobil = dosya('mobil-uygulama-geo');
    expect(mobil).toContain(`${planAdi('appPromptLab')} ve üstü planlarda`);
    expect(mobil).toContain(`ASO metadata optimizasyonu ve günlük anahtar kelime sıra takibi ${findPlan('starter')!.name_tr} plan`);
    const botlar = dosya('yapay-zeka-botlari-robots-txt');
    expect(botlar).toContain(`(${planAdi('agentReadiness')} ve üstü)`);
    expect(botlar).toContain(`${planAdi('liveCrawler')} planındaki Canlı Tarayıcı`);
    expect(dosya('geo-nedir')).toContain(`${planAdi('contentOpportunities')} ve üstü planlarda kaybedilen sorudan`);
    expect(mobil).toContain(`${planAdi('ascEnabled')} ve üstü planlarındaki App Store Connect`);
  });

  it(`deneme ${TRIAL_DAYS} gün ve kart istemez; ölçüm hesap başına 7 günde 1 (measurement-allowance)`, () => {
    expect(MEASUREMENT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(findPlan('trial')!.features_tr.join(' ')).toContain('Kredi kartı istemez');
    const araclar = dosya('yapay-zeka-gorunurluk-araclari');
    expect(araclar).toContain(`RanksUp ${TRIAL_DAYS} gün ücretsiz deneme veriyor ve kart istemiyor`);
    expect(araclar).toContain('hesap başına 7 günde 1 ölçüm');
    expect(dosya('chatgpt-markam-gorunuyor-mu')).toContain('Hesap başına 7 günde bir ölçüm yapılır');
    const cta = read(path.join(WEB_SRC, 'components/rehber/rehber-article.tsx'));
    expect(cta).toContain(`${TRIAL_DAYS} gün ücretsiz dene · Kart gerekmez`);
  });

  it('ölçülen asistanlar plans.ts listesiyle ayni; web araması yalnız aramalı sağlayıcılarda', () => {
    const liste = BASE_PLANS.flatMap((p) => p.features_tr).find((m) => m.startsWith('ChatGPT · '))!.split(' · ');
    const metin = `${liste.slice(0, -1).join(', ')} ve ${liste.at(-1)}`;
    expect(dosya('chatgpt-markam-gorunuyor-mu')).toContain(metin);
    const citation = read(path.resolve(HERE, '../audit/ai-citation.service.ts'));
    // Aramali: Claude web_search araci, Gemini googleSearch, ChatGPT web_search, Perplexity sonar
    expect(citation).toContain("name: 'web_search'");
    expect(citation).toContain('googleSearch: {}');
    expect(citation).toContain("model: 'sonar'");
    expect(citation).toMatch(/aramasiz saglayicilar \(Grok, DeepSeek/);
    expect(dosya('chatgpt-markam-gorunuyor-mu')).toContain('Grok ve DeepSeek ölçümünde web araması yoktur');
  });
});
