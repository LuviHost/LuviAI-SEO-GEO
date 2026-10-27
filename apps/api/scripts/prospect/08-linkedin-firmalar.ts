#!/usr/bin/env tsx
/**
 * 08-linkedin-firmalar — LinkedIn botunun kuyruga yazdigi kisilerin FIRMALARINI 07-kurumsal-adres'e girdi yapar.
 *
 * NEDEN (27.10.2026): LinkedIn'de kisi bulunur, kisiye LinkedIn'den yazilir; ayni firmanin KURUMSAL kutusuna da
 * e-posta gider (iki kanal). Kisinin kendisine e-posta ATILMAZ — LinkedIn'den alinan kisi verisi platform disina
 * tasinmaz (KVKK amac sinirlamasi + LinkedIn kosullari).
 *
 * KVKK: cikti YALNIZ firma adi + sektor; ad/soyad/unvan/profil URL'si yazilmaz, ekrana basilmaz.
 * DATABASE_URL gerekir → prod VPS'te kosulur (apps/api/.env), cikti Mac'e kopyalanir:
 *
 *   ssh luvi108 'cd /var/www/luviai/apps/api && set -a && . ./.env && set +a && npx tsx scripts/prospect/08-linkedin-firmalar.ts'
 *   scp luvi108:/var/www/luviai/reklam/pazarlama/prospect/data/linkedin-firmalar.csv reklam/pazarlama/prospect/data/
 *   cd apps/api && npx tsx scripts/prospect/07-kurumsal-adres.ts --ek ../../reklam/pazarlama/prospect/data/linkedin-firmalar.csv
 *
 * Sektor: ISBIRLIGI kampanyasi → 'ajans'; YATIRIMCI → yazilmaz (yatirimciya kurumsal tanitim gitmez);
 * MUSTERI → kayittaki sektor, yoksa 'diger' (genel sablon).
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DATA_DIR, translit, writeCsv } from '../../src/prospect/prospect-utils.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.linkedinProspect.findMany({ select: { firma: true, sektor: true, kampanya: true } });
    const tekil = new Map<string, { firma: string; sektor: string }>();
    let yatirimci = 0;
    for (const r of rows) {
      if (r.kampanya === 'YATIRIMCI') { yatirimci++; continue; }
      const firma = r.firma.trim();
      if (!firma) continue;
      const k = translit(firma).replace(/\s+/g, ' ');
      if (tekil.has(k)) continue;
      tekil.set(k, { firma, sektor: r.kampanya === 'ISBIRLIGI' ? 'ajans' : r.sektor?.trim() || 'diger' });
    }
    const out = path.join(DATA_DIR, 'linkedin-firmalar.csv');
    writeCsv(out, [...tekil.values()], ['firma', 'web', 'sektor']);
    console.log(`${rows.length} kayit → ${tekil.size} tekil firma (yatirimci kaydi atlandi: ${yatirimci}) → ${out}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
