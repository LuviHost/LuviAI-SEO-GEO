import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PLANS, FEATURE_MIN_PLAN, PLAN_FEATURE_LABELS, findPlan } from '../billing/plans.js';
import { RANKSUP_BOT_UA } from '../common/safe-fetch.js';
import { McpToolsService } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
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
  ad: string; aylik: number; yillik: number | null; makale: number; calistirma: number;
  site: number; uygulama: number; destek: string; satir: string;
}

const SATIR = /^- \*\*(.+?)\*\*[^:\n]*: \$([\d.]+)(?:\/ay, yıllık \$([\d.]+))? — ([\d.]+) AI makale(?:\/ay)?, ([\d.]+) görünürlük çalıştırması(?:\/ay)?, (\d+) site, (\d+) izlenen uygulama · destek: ([^·\n]+)/gm;

function fiyatSatirlari(bolum: string): FiyatSatiri[] {
  return [...bolum.matchAll(SATIR)].map((m) => ({
    ad: m[1], aylik: sayi(m[2]), yillik: m[3] ? sayi(m[3]) : null, makale: sayi(m[4]),
    calistirma: sayi(m[5]), site: Number(m[6]), uygulama: Number(m[7]), destek: m[8].trim(), satir: m[0],
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
    const names = new Set(new McpToolsService(prisma, n, new QuotaService(prisma), n, n, n, n, n, n, n, n, n).list().map((t) => t.name));
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
    expect(offenders([...webSources, ...mobileSources, ...docSources], re)).toEqual([]);
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
    expect(offenders([...webSources, ...mobileSources, ...docSources], list, (l) => LLAMA_CONDITIONAL.test(l))).toEqual([]);
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
    const extra: Source[] = ['faq/page.tsx', 'compare/page.tsx', 'about/page.tsx', 'use-cases/page.tsx']
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
    const cmp = m('compare/page.tsx');
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
    const cmp = m('compare/page.tsx');
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
    const pr = m('pricing/page.tsx');
    expect(pr).not.toContain('-20%');
    expect(pr).toContain('2 ay bedava');
    for (const p of BASE_PLANS.filter((x) => x.monthly_usd > 0)) expect(p.annual_usd).toBe(p.monthly_usd * 10);
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

  it('sözlük: editör skoru bugünkü ölçeği (pipeline EDITOR_MAX_SCORE) ve eski 60 ölçeğini söylüyor', () => {
    const pipeline = read(path.resolve(HERE, '../articles/pipeline.service.ts'));
    const max = pipeline.match(/EDITOR_MAX_SCORE = (\d+);/)![1];
    const g = stripComments(read(path.join(WEB_SRC, 'lib/glossary.ts')));
    const satir = g.split('\n').find((l) => l.includes('AI editörden aldığı kalite puanı'))!;
    expect(satir).toContain(`= ${max} üzerinden`);
    expect(satir).toContain('60 üzerinden');
  });
});
