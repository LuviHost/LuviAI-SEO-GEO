/**
 * Faz 8 — LinkedIn aday listesi → DB (LinkedinProspect, profileUrl tekil upsert)
 *
 * Kullanim (apps/api icinde):
 *   npx tsx scripts/prospect/05-linkedin-import.ts                    # kisiler.csv (+firmalar.csv sektor) — yalniz SAYIM
 *   npx tsx scripts/prospect/05-linkedin-import.ts --apply            # DB'ye yaz
 *   npx tsx scripts/prospect/05-linkedin-import.ts --input x.csv      # ad,soyad,firma,unvan,sektor,kademe,profileUrl
 *   npx tsx scripts/prospect/05-linkedin-import.ts --sektor finans --kademe 1 --limit 300 --apply
 *
 * NEDEN: bot yalniz DB'deki QUEUED kayitlara dokunur; CSV'den yalnizca
 * profileUrl'i OLAN satirlar alinir (arastirma adimi / elle doldurulan
 * sutun). profileUrl normalize edilir (https://www.linkedin.com/in/<slug>/)
 * ve tekil anahtardir: ayni kisi ikinci kez eklenmez, alanlari guncellenir;
 * status'a DOKUNULMAZ (istek gonderilmis kisi yeniden kuyruga dusmez).
 *
 * kisiler.csv sutunlari (Faz 2): firma, ad, soyad, unvan, kademe, kaynakUrl,
 * kaynakTarihi, guven (+ istege bagli profileUrl | linkedin | linkedinUrl).
 * Sektor kisiler.csv'de yoksa firmalar.csv'den firma adiyla eslenir.
 *
 * KVKK: isimli veri; ekrana yalniz SAYIM basilir, isim/URL basilmaz.
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DATA_DIR, parseArgs, readCsv, translit } from '../../src/prospect/prospect-utils.js';
import { normalizeProfileUrl } from '../../src/intel/linkedin-outreach-rules.js';

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;
const INPUT = typeof args.input === 'string' ? path.resolve(args.input) : path.join(DATA_DIR, 'kisiler.csv');
const SEKTOR = typeof args.sektor === 'string' ? args.sektor.trim().toLowerCase() : null;
const KADEME = typeof args.kademe === 'string' ? Number(args.kademe) : null;
const LIMIT = typeof args.limit === 'string' ? Number(args.limit) : null;

/** Sutun adlari esnek: profileUrl | linkedin | linkedinUrl | url */
function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const hit = Object.keys(row).find((c) => c.trim().toLowerCase() === k.toLowerCase());
    if (hit && row[hit]?.trim()) return row[hit].trim();
  }
  return '';
}

async function main() {
  const rows = readCsv(INPUT);
  if (rows.length === 0) {
    console.error(`Girdi bos ya da yok: ${INPUT}`);
    process.exit(1);
  }

  // firmalar.csv → firma adi (translit) → sektor
  const sektorByFirma = new Map<string, string>();
  for (const f of readCsv(path.join(DATA_DIR, 'firmalar.csv'))) {
    const key = translit(f.firma ?? '');
    if (key && f.sektor) sektorByFirma.set(key, f.sektor.trim().toLowerCase());
  }

  const stats = { toplam: rows.length, urlYok: 0, urlGecersiz: 0, adYok: 0, filtreDisi: 0, aday: 0, bySektor: {} as Record<string, number> };
  const candidates: Array<{ ad: string; soyad: string; firma: string; unvan: string | null; sektor: string | null; kademe: number; profileUrl: string }> = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const raw = pick(r, 'profileUrl', 'linkedin', 'linkedinUrl', 'url');
    if (!raw) { stats.urlYok++; continue; }
    const profileUrl = normalizeProfileUrl(raw);
    if (!profileUrl) { stats.urlGecersiz++; continue; }
    const ad = pick(r, 'ad');
    const soyad = pick(r, 'soyad');
    const firma = pick(r, 'firma');
    if (!ad || !firma) { stats.adYok++; continue; }
    const sektor = (pick(r, 'sektor') || sektorByFirma.get(translit(firma)) || '').toLowerCase() || null;
    const kademe = Number(pick(r, 'kademe')) === 2 ? 2 : 1;
    if ((SEKTOR && sektor !== SEKTOR) || (KADEME && kademe !== KADEME)) { stats.filtreDisi++; continue; }
    if (seen.has(profileUrl)) continue;
    seen.add(profileUrl);
    candidates.push({ ad, soyad, firma, unvan: pick(r, 'unvan') || null, sektor, kademe, profileUrl });
    stats.bySektor[sektor ?? 'bilinmiyor'] = (stats.bySektor[sektor ?? 'bilinmiyor'] ?? 0) + 1;
    if (LIMIT && candidates.length >= LIMIT) break;
  }
  stats.aday = candidates.length;
  console.log(`Girdi: ${path.relative(process.cwd(), INPUT)}`);
  console.log(`Satir: ${stats.toplam} · URL yok: ${stats.urlYok} · URL gecersiz: ${stats.urlGecersiz} · ad/firma yok: ${stats.adYok} · filtre disi: ${stats.filtreDisi}`);
  console.log(`Aday (tekil profileUrl): ${stats.aday} — sektor: ${JSON.stringify(stats.bySektor)}`);

  if (!APPLY) {
    console.log('--apply verilmedi; DB\'ye yazilmadi.');
    return;
  }

  const prisma = new PrismaClient();
  let upserted = 0;
  try {
    for (const c of candidates) {
      const { profileUrl, ...data } = c;
      await prisma.linkedinProspect.upsert({ where: { profileUrl }, create: { ...data, profileUrl }, update: data });
      upserted++;
    }
    const queued = await prisma.linkedinProspect.count({ where: { status: 'QUEUED' } });
    console.log(`Yazildi: ${upserted} upsert · kuyrukta (QUEUED) toplam: ${queued}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
