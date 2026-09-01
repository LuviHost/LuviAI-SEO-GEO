/**
 * NEDEN src/cli altinda: Nest DI decorator metadata ister; tsx/esbuild uretmez
 * (createApplicationContext'te servisler bos kalir). `pnpm build` sonra
 * `set -a; . ../../.env; set +a; node dist/cli/prospect-karne.js ...` (apps/api icinde).
 *
 * Talep uzerine kurum karnesi — "evet" diyen kuruma 2 is gunu icinde.
 *
 * Kullanim (apps/api icinde):
 *   node dist/cli/prospect-karne.js --brand "Acme Bank" --host acmebank.com.tr --sektor finans
 *   node dist/cli/prospect-karne.js --brand "X" --host x.com.tr --sektor finans --altsektor banka \
 *       --rakipler a.com,b.com --pdf --yes
 *   node dist/cli/prospect-karne.js --help
 *
 * Bayraklar:
 *   --brand "X"            kurum adi (zorunlu; >= 4 karakter — kisa ad metinde rastgele eslesir)
 *   --host x.com.tr        kurum alan adi (zorunlu; www/sema kirpilir)
 *   --sektor <s>           finans | eticaret-perakende-teknoloji | turizm-havayolu-telekom-otomotiv
 *   --altsektor <a>        banka/odeme/sigorta/leasing/yatirim, eticaret/perakende/teknoloji,
 *                          havayolu/otel/telekom/otomotiv. ESLESMEZSE genel sorulara sessizce
 *                          dusulmez: sert uyari + --yes sarti (alan disi soru yanlis karne uretir).
 *   --rakipler a.com,b.com bilinen rakip alan adlari: runPublicProbes'a `competitors` olarak
 *                          gider, cevaplarda ARANIR ve rakip payina GIRER; raporda ★ ile isaretlenir.
 *                          Alan adi olmayan deger (orn. "Garanti") dusurulur ve UYARI basilir.
 *   --limit N              en fazla N soru (ucuz test icin)
 *   --only a,b             yalnizca bu saglayicilar (anthropic,gemini,openai,perplexity,xai,deepseek,meta)
 *   --dry-run              LLM cagrisi ve dosya yazma YOK: sorular + maliyet tahmini + cikti yollari
 *   --yes                  "devam? (y/N)" sorusunu atla
 *   --force                ayni gunun mevcut ciktisinin uzerine yaz
 *   --pdf                  Chrome headless ile PDF (bulunamazsa uyari, HTML kalir)
 *   --kaydet               karneyi DB'ye de yaz ve PAYLASILABILIR LINK bas (/karne/<token>).
 *                          NEDEN: "olur" diyen kuruma dosya degil link gonderilir; link acildiginda
 *                          gorulme sayaci artar (sicak sinyal, panelde gorunur).
 *
 * Ciktilar: reklam/pazarlama/prospect/data/karne/<host>-<yyyymmdd>.json | .html | .pdf (gitignore'da).
 * NEDEN tarihli ad: karnenin kendi metodolojisi ve iki-kaynak kurali "kesin hukum
 * icin >= 2 farkli gun" ister; 2. gunun kosumu 1. gunun kanitini ezmemeli.
 * Ayni gun tekrar kosum --force ister.
 *
 * NOT: --kaydet, asagida anlatilan --persist DEGILDIR. Ayri tabloya (prospect_karneler) yazar;
 * PublicCitationCheck'e ve abone retest deltasina dokunmaz, yalniz token bilen erisir.
 *
 * NEDEN --persist YOK: PublicCitationCheck kaydi @Public GET /citation-check/history?domain=
 * uzerinden herkese doner (getHistory source filtrelemez) ve compareWithPast abone
 * retest deltasini kirletir — gizli karne kamuya sizardi. Karne JSON+HTML dosyasidir;
 * kamuya yalniz toplu istatistik cikar (plan Faz 4).
 *
 * NEDEN Nest baglami DEGIL, elle kurulan servis: tsx (esbuild) emitDecoratorMetadata
 * uretmez; NestFactory constructor bagimliliklarini goremez (design:paramtypes
 * undefined — dogrulandi), servisi bos kurar ve ilk DB cagrisinda patlar. Ayrica
 * tam AppModule, ScheduleModule cron'larini (intel collect + saatlik kilit) ve
 * JobQueue Redis baglantisini script surecinde de baslatirdi. Bu yuzden
 * AiCitationService, gercek bagimliliklariyla (Prisma, Quota, Settings) elle
 * kurulur: ayni sinif, ayni anahtar havuzu, ayni maliyet defteri (addCost).
 * Servis modulleri --dry-run/--help'te hic import EDILMEZ.
 *
 * NEDEN tek kurum: tavan kontrolu yok (public akistaki IP limiti burada
 * gecerli degil); toplu kosum icin script bilerek tek --host alir.
 */
import 'dotenv/config';
import * as dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { parseArgs, normalizeDomain, DATA_DIR, SEKTORLER } from '../prospect/prospect-utils.js';
import { sorulariGetir, altsektorAnahtari, sektorDogrula, sektorAltAnahtarlari, ALT_SEKTOR_ANAHTARLARI } from '../prospect/karne-sorular.js';
import { karneOzeti, karneHtml } from '../prospect/karne-html.js';
import { containsBrand, MIN_BRAND_LEN } from '../audit/brand-in-query.js';
// Yalniz TIP — calisma zamaninda silinir; servis modulu dry-run'da yuklenmez.
import type { Provider } from '../audit/ai-citation.service.js';

// main.ts ile ayni: sunucuda IPv6 yokken happy-eyeballs zaman asimi veriyor.
dns.setDefaultResultOrder('ipv4first');

const SAGLAYICILAR: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];

/**
 * Havuz anahtari env adlari — ai-citation.service.ts POOL_ENV_KEY ile ayni
 * (o tablo export edilmiyor; export etmek servise dokunmak demek). NEDEN burada:
 * maliyet tahmini servis yuklenmeden yapilir ve --only, digerlerinin
 * anahtarini surec ortamindan silerek calisir.
 */
const ENV_ANAHTARI: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
  openai: 'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  meta: 'GROQ_API_KEY',
};

/**
 * Probe basina tavan maliyet (USD) — servisin private COST_PER_PROBE_USD
 * tablosunun kopyasi; yalnizca ON tahmin icin. Gercek defter servisin kendi
 * tablosuyla tutulur, kosum sonunda gercek toplam basilir. Sapma riski:
 * servis kurulunca tablo karsilastirilir ve farkliysa UYARI basilir
 * (bkz. tahminSapmasi) — sessiz yanlis tahmin olmaz.
 */
const TAHMINI_MALIYET_USD: Record<Provider, number> = {
  anthropic: 0.03,
  gemini: 0.00013,
  openai: 0.0004,
  perplexity: 0.0006,
  xai: 0.0003,
  deepseek: 0.0006,
  meta: 0.0002,
};

const KULLANIM = `Kurum karnesi — 7 AI asistanina 10 markasiz soru, tek dosya HTML (+JSON/PDF)

  node dist/cli/prospect-karne.js --brand "Acme Bank" --host acmebank.com.tr --sektor finans [secenekler]

Zorunlu:
  --brand "X"              kurum adi (en az ${MIN_BRAND_LEN} karakter)
  --host x.com.tr          kurum alan adi
  --sektor <s>             ${SEKTORLER.join(' | ')}
Secenekler:
  --altsektor <a>          ${ALT_SEKTOR_ANAHTARLARI.join(' | ')} (eslesmezse uyari + --yes sarti)
  --rakipler a.com,b.com   bilinen rakip alan adlari (cevapta aranir, rakip payina girer, ★ ile isaretlenir)
  --limit N                en fazla N soru (test)
  --only a,b               yalnizca bu saglayicilar: ${SAGLAYICILAR.join(',')}
  --dry-run                LLM cagrisi yok, dosya yazilmaz; sorular + maliyet tahmini
  --yes                    onay sorusunu atla
  --force                  ayni gunun mevcut ciktisinin uzerine yaz
  --pdf                    Chrome headless ile PDF uret
  --help                   bu metin

Ciktilar: ${path.join(DATA_DIR, 'karne')}/<host>-<yyyymmdd>.json | .html | .pdf
`;

function yyyymmdd(d: Date): string {
  const aa = String(d.getMonth() + 1).padStart(2, '0');
  const gg = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${aa}${gg}`;
}

function chromeYolu(): string | null {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(mac) ? mac : null;
  }
  for (const aday of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const yol = execFileSync('which', [aday], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (yol) return yol;
    } catch { /* yok, sonrakini dene */ }
  }
  return null;
}

function pdfUret(htmlYolu: string, pdfYolu: string): boolean {
  const chrome = chromeYolu();
  if (!chrome) {
    console.warn('UYARI: Chrome/Chromium bulunamadı — PDF üretilmedi, HTML dosyası duruyor. CHROME_PATH ile yol verebilirsiniz.');
    return false;
  }
  try {
    execFileSync(chrome, [
      '--headless=new', '--no-pdf-header-footer', '--disable-gpu', '--no-sandbox',
      `--print-to-pdf=${pdfYolu}`, `file://${htmlYolu}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 });
    return fs.existsSync(pdfYolu);
  } catch (err: any) {
    console.warn(`UYARI: PDF üretilemedi (${err?.message?.slice(0, 200) ?? err}) — HTML dosyası duruyor.`);
    return false;
  }
}

async function onayAl(soru: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('Etkileşimli terminal yok; onay için --yes verin.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cevap = await new Promise<string>((res) => rl.question(soru, res));
  rl.close();
  return /^(y|e|yes|evet)$/i.test(cevap.trim());
}

/**
 * On tahmin tablosu servisin private tablosundan sapmis mi? Servis tablosunu
 * export etmek ai-citation.service.ts'e dokunmak demek; burada yalniz sapma
 * yakalanir ki model/max_tokens degisince tahmin sessizce yanlis kalmasin.
 */
function tahminSapmasi(svc: unknown, aktif: Provider[]): string[] {
  const tablo = (svc as { COST_PER_PROBE_USD?: Record<string, number> })?.COST_PER_PROBE_USD;
  if (!tablo || typeof tablo !== 'object') return [];
  return aktif
    .filter((p) => typeof tablo[p] === 'number' && tablo[p] !== TAHMINI_MALIYET_USD[p])
    .map((p) => `${p}: tahmin ${TAHMINI_MALIYET_USD[p]} ≠ servis ${tablo[p]}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.length <= 2) {
    console.log(KULLANIM);
    return;
  }

  // ── Girdi dogrulama ──
  const brand = String(args.brand ?? '').trim();
  const host = normalizeDomain(String(args.host ?? ''));
  const sektorArg = String(args.sektor ?? '');
  const hatalar: string[] = [];
  if (!brand) hatalar.push('--brand zorunlu');
  else if (brand.length < MIN_BRAND_LEN) hatalar.push(`--brand en az ${MIN_BRAND_LEN} karakter olmalı ("${brand}" cevapta ayırt edilemez)`);
  if (!host) hatalar.push('--host zorunlu ve geçerli bir alan adı olmalı');
  let sektor = '';
  try { sektor = sektorDogrula(sektorArg); } catch (e: any) { hatalar.push(e.message); }
  const altsektor = typeof args.altsektor === 'string' ? args.altsektor : null;
  const rakipHam = String(args.rakipler ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  const rakipler: string[] = [];
  const rakipDusen: string[] = [];
  for (const r of rakipHam) {
    const d = normalizeDomain(r);
    if (d) rakipler.push(d);
    else rakipDusen.push(r);
  }
  const only = typeof args.only === 'string'
    ? args.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;
  if (only) {
    const gecersiz = only.filter((p) => !(SAGLAYICILAR as string[]).includes(p));
    if (gecersiz.length) hatalar.push(`--only bilinmeyen sağlayıcı: ${gecersiz.join(',')} (geçerli: ${SAGLAYICILAR.join(',')})`);
  }
  if (args.persist) {
    hatalar.push('--persist kaldırıldı: PublicCitationCheck kaydı herkese açık /citation-check/history uçtan dönüyordu (gizli karne sızar). Karne JSON+HTML dosyasıdır.');
  }
  if (hatalar.length) {
    console.error('HATA:\n  - ' + hatalar.join('\n  - ') + '\n');
    console.error(KULLANIM);
    process.exit(1);
  }
  if (!host) return; // tip daraltma; yukarida yakalandi
  if (rakipDusen.length) {
    console.warn(`UYARI: --rakipler içinde alan adı olmayan ${rakipDusen.length} değer düşürüldü: ${rakipDusen.join(', ')} (alan adı verin, örn. garantibbva.com.tr)`);
  }

  // ── Sorular ──
  const altAnahtar = altsektorAnahtari(sektor, altsektor);
  const altEslesmedi = !!altsektor && !altAnahtar;
  if (altEslesmedi) {
    // NEDEN sert uyari: alan disi 10 genel soru (leasing sirketine "ogrenci
    // hesabi") yanlis "hic gorunmuyorsunuz" karnesi uretir; sessiz dusme yok.
    console.warn(`UYARI: --altsektor "${altsektor}" ${sektor} için hiçbir alt sektörle eşleşmedi; GENEL sorular kullanılacak.\n       Geçerli anahtarlar: ${sektorAltAnahtarlari(sektor).join(' | ')}. Alan dışı sorular yanlış "hiç görünmüyorsunuz" karnesi üretir.`);
  }
  let sorular = sorulariGetir(sektor, altsektor);
  // Guvenlik: marka adi bir soruya denk gelirse (ornek "Garanti") o soru
  // sorulmaz — skora girmeyecek bir cagri icin para harcanmaz.
  const markali = sorular.filter((q) => containsBrand(q, brand));
  if (markali.length) {
    console.warn(`UYARI: ${markali.length} soruda kurum adı geçiyor, sorulmayacak:\n  - ${markali.join('\n  - ')}`);
    sorular = sorular.filter((q) => !markali.includes(q));
  }
  const limit = typeof args.limit === 'string' ? Math.max(1, parseInt(args.limit, 10) || 0) : 0;
  if (limit && sorular.length > limit) sorular = sorular.slice(0, limit);
  if (sorular.length === 0) {
    console.error('HATA: sorulacak markasız soru kalmadı.');
    process.exit(1);
  }

  // ── Maliyet tahmini (servis yuklenmeden) ──
  const aktif = SAGLAYICILAR.filter((p) => !!process.env[ENV_ANAHTARI[p]] && (!only || only.includes(p)));
  const tahmin = aktif.reduce((n, p) => n + TAHMINI_MALIYET_USD[p] * sorular.length, 0);
  const cagri = aktif.length * sorular.length;
  const tarih = new Date();
  const cikti = path.join(DATA_DIR, 'karne');
  const ad = `${host}-${yyyymmdd(tarih)}`;
  const jsonYolu = path.join(cikti, `${ad}.json`);
  const htmlYolu = path.join(cikti, `${ad}.html`);
  const pdfYolu = path.join(cikti, `${ad}.pdf`);
  const mevcut = [jsonYolu, htmlYolu, ...(args.pdf ? [pdfYolu] : [])].filter((y) => fs.existsSync(y));

  console.log(`Kurum      : ${brand} (${host})`);
  console.log(`Sektör     : ${sektor}${altsektor ? ` · alt sektör: ${altsektor} → ${altAnahtar ?? 'EŞLEŞMEDİ (genel sorular)'}` : ''}`);
  if (rakipler.length) console.log(`Rakipler   : ${rakipler.join(', ')} (cevapta aranır, rakip payına girer)`);
  console.log(`Sorular    : ${sorular.length} markasız`);
  for (const [i, q] of sorular.entries()) console.log(`  ${String(i + 1).padStart(2)}. ${q}`);
  console.log(`Asistanlar : ${aktif.length}/${SAGLAYICILAR.length} anahtar var (${aktif.join(', ') || 'YOK'})${only ? ` · --only ${only.join(',')}` : ''}`);
  const anahtarsiz = SAGLAYICILAR.filter((p) => !process.env[ENV_ANAHTARI[p]]);
  if (anahtarsiz.length) console.log(`             anahtar yok: ${anahtarsiz.join(', ')} — karnede "ölçülemedi" görünür`);
  console.log(`MALİYET    : ~${cagri} çağrı, tavan ≈ $${tahmin.toFixed(3)} (probe başına tavan; ölçülen ortalama genelde daha düşük)`);
  console.log(`Çıktı      : ${jsonYolu}\n             ${htmlYolu}${args.pdf ? `\n             ${pdfYolu}` : ''}`);
  if (mevcut.length) console.log(`             MEVCUT (${args.force ? '--force: üzerine yazılacak' : 'üzerine yazmak için --force'}): ${mevcut.map((y) => path.basename(y)).join(', ')}`);

  if (args['dry-run']) {
    console.log('\n(kuru koşum — LLM çağrısı yapılmadı, dosya yazılmadı)');
    return;
  }
  if (aktif.length === 0) {
    console.error('HATA: hiçbir sağlayıcı anahtarı yok (.env) — ölçüm yapılamaz.');
    process.exit(1);
  }
  if (mevcut.length && !args.force) {
    console.error('HATA: bugünün çıktısı zaten var; önceki kanıt ezilmesin diye yazılmadı. Üzerine yazmak için --force.');
    process.exit(1);
  }
  if (altEslesmedi && !args.yes) {
    console.error('HATA: --altsektor eşleşmedi. Geçerli bir anahtar verin ya da genel sorularla devam için --yes ekleyin.');
    process.exit(1);
  }
  if (!args.yes && !(await onayAl('\ndevam? (y/N) '))) {
    console.log('Vazgeçildi.');
    return;
  }

  // ── Servisler (Nest DI yok — bkz. dosya basi) ──
  const { Logger } = await import('@nestjs/common');
  const { PrismaService } = await import('../prisma/prisma.service.js');
  const { QuotaService } = await import('../billing/quota.service.js');
  const { SettingsService } = await import('../settings/settings.service.js');
  const { AiCitationService } = await import('../audit/ai-citation.service.js');
  Logger.overrideLogger(['error', 'warn']);

  const prisma = new PrismaService();
  try {
    // NEDEN once baglan: runPublicProbes addCost hatasini yutar (.catch → 0);
    // DB yoksa maliyet defteri sessizce bos kalirdi. Para harcamadan durulur.
    await prisma.$connect();
  } catch (err: any) {
    console.error(`HATA: veritabanına bağlanılamadı (${String(err?.message ?? err).split('\n')[0]}) — maliyet defteri (addCost) yazılamayacağı için ölçüm başlatılmadı. DATABASE_URL kontrol edin.`);
    process.exit(1);
  }
  try {
    const svc = new AiCitationService(prisma, new QuotaService(prisma), new SettingsService(prisma));
    const sapma = tahminSapmasi(svc, aktif);
    if (sapma.length) console.warn(`UYARI: ön tahmin tablosu servisten sapmış — ${sapma.join('; ')} (TAHMINI_MALIYET_USD güncellenmeli).`);
    if (only) {
      // runPublicProbes anahtari cagri aninda process.env'den okur; disarida
      // birakilanlarin anahtari silinince o saglayici "NO_KEY" olur, cagri yapilmaz.
      for (const p of SAGLAYICILAR) if (!only.includes(p)) delete process.env[ENV_ANAHTARI[p]];
    }

    const basladi = Date.now();
    console.log(`\nÖlçüm başladı (${aktif.length} asistan × ${sorular.length} soru)...`);
    const sonuc = await svc.runPublicProbes({ brand, host, queries: sorular, competitors: rakipler });
    const sure = Math.round((Date.now() - basladi) / 1000);

    const ozet = karneOzeti({ brand, host, sektor, altsektor: altAnahtar ?? altsektor, sorular, saglayicilar: sonuc, rakipler, tarih });
    // Randevu linki ayardan (yoksa gorusme cumlesi rapordan duser)
    const randevuUrl = await prisma.appSetting
      .findUnique({ where: { key: 'SATIS_RANDEVU_URL' }, select: { value: true } })
      .then((r) => (r?.value ?? process.env.SATIS_RANDEVU_URL ?? '').trim() || null)
      .catch(() => null);
    const html = karneHtml(ozet, { randevuUrl });
    fs.mkdirSync(cikti, { recursive: true });
    fs.writeFileSync(jsonYolu, JSON.stringify(ozet, null, 2), 'utf8');
    fs.writeFileSync(htmlYolu, html, 'utf8');

    const t = ozet.toplam;
    console.log(`Bitti (${sure} sn) · ${ozet.cagriSayisi} çağrı · gerçek maliyet $${ozet.maliyetUsd.toFixed(4)}`);
    console.log(`Anıldı     : ${t.anilanSaglayici}/${t.saglayici} asistan · ${t.anilanCevap}/${t.olculenCevap} cevap`);
    console.log(`Atıf       : ${t.atifSaglayici}/${t.saglayici} asistan · ${t.atifCevap}/${t.olculenCevap} cevap`);
    console.log(`Boşluk     : ${ozet.bosluklar.length} soru`);
    if (t.hataliCevap) console.warn(`Hatalı     : ${t.hataliCevap} cevap sağlayıcı hatası/reddi (sayıma girmedi; ayrıntı JSON'da)`);
    const rakipUst = ozet.rakipPayi.filter((r) => !r.isBrand).slice(0, 5).map((r) => `${r.name} %${r.pct}`);
    if (rakipUst.length) console.log(`Rakipler   : ${rakipUst.join(' · ')}`);
    for (const s of sonuc.filter((x) => !x.available)) console.warn(`  ölçülemedi: ${s.label} — ${s.reason ?? '?'}`);
    console.log(`JSON       : ${jsonYolu}\nHTML       : ${htmlYolu}`);

    if (args.pdf) {
      if (pdfUret(htmlYolu, pdfYolu)) console.log(`PDF        : ${pdfYolu}`);
    }

    if (args.kaydet) {
      // NEDEN burada (servisi cagirmak yerine): CLI Nest DI kurmuyor (bkz. dosya basi) — ayni
      // karne zaten uretildi; yalniz kalici kayit + token gerekiyor.
      const { randomBytes } = await import('node:crypto');
      const token = randomBytes(24).toString('base64url');
      await prisma.prospectKarne.create({
        data: {
          token,
          brand,
          host,
          sektor,
          altsektor: altAnahtar ?? altsektor ?? null,
          ozet: ozet as unknown as object,
          html,
          cagriSayisi: ozet.cagriSayisi,
          maliyetUsd: ozet.maliyetUsd,
        },
      });
      const base = (process.env.WEB_BASE_URL ?? 'https://ranksup.ai').replace(/\/+$/, '');
      console.log(`Paylaşım   : ${base}/karne/${token}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message ?? err);
    process.exit(1);
  });
