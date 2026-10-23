/**
 * 'footage' video stilinin stok klipleri — indir + dogrula (IDEMPOTENT). Deploy adimi
 * (scripts/prepare-article-short.mjs) cagirir; elle: `node scripts/stock.mjs`.
 *
 * Lisans: Mixkit Stock Video Free License — ticari kullanim serbest, atif gerekmez, klipler tek basina
 * yeniden dagitilamaz. Bu yuzden dosyalar git'e girmez (apps/video/.gitignore public/stock/) ve her sunucu
 * kendi kopyasini Mixkit'in adresinden indirir. Liste, boyut ve sha256: src/styles/registry.mjs STOCK_CLIPS.
 *
 *   - dosya var, boyut + sha256 tutuyor  -> dokunulmaz
 *   - yok / bozuk                        -> <ad>.part'a indirilir, boyut + sha256 tutarsa yerine tasinir;
 *                                           tutmazsa silinir ve hata (yarim / degismis dosya kullanilmaz)
 * Ag istegi yalniz bu sabit adreslere (assets.mixkit.co); hesap / anahtar gerekmez.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STOCK_CLIPS, STOCK_DIR } from '../src/styles/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STOCK_PATH = join(ROOT, 'public', STOCK_DIR);
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

async function download(clip, dest, fetchImpl) {
  const part = `${dest}.part`;
  rmSync(part, { force: true });
  const res = await fetchImpl(clip.url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`${clip.url} -> HTTP ${res.status}`);
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    if (!(await verify(part, clip))) {
      const size = existsSync(part) ? statSync(part).size : 0;
      throw new Error(`${clip.file}: boyut / sha256 tutmadi (${size} bayt, beklenen ${clip.bytes}) — Mixkit dosyasi degismis olabilir; registry.mjs STOCK_CLIPS'i gozden gecir`);
    }
    renameSync(part, dest);
  } finally {
    rmSync(part, { force: true });
  }
}

/**
 * dir / clips yalniz testler icin (varsayilan public/stock + registry STOCK_CLIPS).
 * @returns {Promise<Array<{ file: string, status: 'ok' | 'downloaded' }>>}  hata: ilk basarisiz klipte atar
 */
export async function ensureStock({ fetchImpl = fetch, log = () => {}, dir = STOCK_PATH, clips = STOCK_CLIPS } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const clip of clips) {
    const dest = join(dir, clip.file);
    if (await verify(dest, clip)) {
      out.push({ file: clip.file, status: 'ok' });
      continue;
    }
    log(`  indiriliyor ${clip.file} (${(clip.bytes / 1048576).toFixed(1)} MB) <- ${clip.url}`);
    await download(clip, dest, fetchImpl);
    out.push({ file: clip.file, status: 'downloaded' });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ensureStock({ log: (m) => console.log(m) });
  for (const x of r) console.log(`✓ ${x.status === 'ok' ? 'yerinde   ' : 'indirildi '} ${x.file}`);
}
