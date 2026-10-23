/**
 * 'footage' video stilinin stok klipleri — indir + dogrula (IDEMPOTENT). Deploy adimi
 * (scripts/prepare-article-short.mjs) cagirir; elle: `node scripts/stock.mjs`.
 *
 * Lisans: Mixkit Stock Video Free License — ticari kullanim serbest, atif gerekmez, klipler tek basina
 * yeniden dagitilamaz. Bu yuzden dosyalar git'e girmez (apps/video/.gitignore public/stock/) ve her sunucu
 * kendi kopyasini Mixkit'in adresinden indirir. Liste, boyut ve sha256: src/styles/registry.mjs STOCK_CLIPS.
 *
 *   - dosya var, boyut + sha256 tutuyor  -> dokunulmaz
 *   - yok / bozuk                        -> .stock-part/<ad>.part'a (public/ disi) indirilir; boyut + sha256
 *                                           tutarsa yerine tasinir, tutmazsa silinir ve hata
 * Guvenlik: yalniz https://assets.mixkit.co (yonlendirme sonrasi da); bildirilen boyut beklenenden buyukse
 * hic indirilmez, akan bayt beklenenden fazlaysa indirme kesilir. Hesap / anahtar gerekmez.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STOCK_CLIPS, STOCK_DIR } from '../src/styles/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STOCK_PATH = join(ROOT, 'public', STOCK_DIR);
/**
 * Yarim indirmeler public/ DISINDA (Remotion paketi public/'i kopyalar; yarim dosya pakete girmesin).
 * Ayni disk bolumunde: bitince renameSync ile yerine tasinir. .gitignore'da.
 */
export const PART_PATH = join(ROOT, '.stock-part');
/** Yonlendirmelerden sonra bile yalniz bu sunucudan indirilir */
export const STOCK_HOSTS = ['assets.mixkit.co'];
/** Tek klip indirmesinin ust siniri (45 MB'lik dosya yavas baglantida da biter) */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function sha256File(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function verify(file, clip) {
  if (!existsSync(file) || statSync(file).size !== clip.bytes) return false;
  return (await sha256File(file)) === clip.sha256;
}

const hostOk = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && STOCK_HOSTS.includes(x.hostname);
  } catch {
    return false;
  }
};

async function download(clip, dest, fetchImpl, partDir) {
  if (!hostOk(clip.url)) throw new Error(`${clip.file}: izinli olmayan adres ${String(clip.url).slice(0, 80)}`);
  mkdirSync(partDir, { recursive: true });
  const part = join(partDir, `${clip.file}.part`);
  rmSync(part, { force: true });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${clip.file}: indirme ${DOWNLOAD_TIMEOUT_MS / 60000} dk'da bitmedi`)), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchImpl(clip.url, { redirect: 'follow', signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`${clip.url} -> HTTP ${res.status}`);
    // Yonlendirmeden sonraki son adres de izinli sunucuda olmali (res.url bos ise istenen adres)
    if (res.url && !hostOk(res.url)) throw new Error(`${clip.file}: yonlendirme izinli olmayan sunucuya: ${String(res.url).slice(0, 80)}`);
    const declared = Number(res.headers?.get?.('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > clip.bytes) throw new Error(`${clip.file}: sunucu ${declared} bayt bildirdi, beklenen ${clip.bytes} — indirilmedi`);
    let seen = 0;
    const cap = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > clip.bytes) cb(new Error(`${clip.file}: ${clip.bytes} bayti asti — indirme kesildi`));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), cap, createWriteStream(part));
    if (!(await verify(part, clip))) {
      const size = existsSync(part) ? statSync(part).size : 0;
      throw new Error(`${clip.file}: boyut / sha256 tutmadi (${size} bayt, beklenen ${clip.bytes}) — Mixkit dosyasi degismis olabilir; registry.mjs STOCK_CLIPS'i gozden gecir`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(part, dest);
  } finally {
    clearTimeout(timer);
    ac.abort();
    rmSync(part, { force: true });
  }
}

/**
 * dir / clips / partDir yalniz testler icin (varsayilan public/stock + registry STOCK_CLIPS + .stock-part).
 * Eski surumun public/stock/ altinda biraktigi yarim (.part) dosyalar en basta silinir.
 * @returns {Promise<Array<{ file: string, status: 'ok' | 'downloaded' }>>}  hata: ilk basarisiz klipte atar
 */
export async function ensureStock({ fetchImpl = fetch, log = () => {}, dir = STOCK_PATH, clips = STOCK_CLIPS, partDir = PART_PATH } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.part')) rmSync(join(dir, f), { force: true });
  const out = [];
  for (const clip of clips) {
    const dest = join(dir, clip.file);
    if (await verify(dest, clip)) {
      out.push({ file: clip.file, status: 'ok' });
      continue;
    }
    log(`  indiriliyor ${clip.file} (${(clip.bytes / 1048576).toFixed(1)} MB) <- ${clip.url}`);
    await download(clip, dest, fetchImpl, partDir);
    out.push({ file: clip.file, status: 'downloaded' });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ensureStock({ log: (m) => console.log(m) });
  for (const x of r) console.log(`✓ ${x.status === 'ok' ? 'yerinde   ' : 'indirildi '} ${x.file}`);
}
