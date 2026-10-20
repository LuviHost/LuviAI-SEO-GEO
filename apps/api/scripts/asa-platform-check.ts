/**
 * Apple Ads Platform API — SALT OKUNUR saglik denetimi.
 *
 * NEDEN: Campaign Management API v5 26.01.2027'de kapaniyor
 * (asa-client.factory.ts ASA_V5_SUNSET_DATE). Sunucu varsayilan olarak v5
 * kullaniyor; ASA_API_VERSION=platform'a gecmeden once gercek bir hesapla
 * Platform API'nin calistigi (token, hesap cozumu, kampanya listesi)
 * dogrulanmali. Bu betik ortam degiskenini degistirmez; istemciyi yalniz bu
 * calisma icin 'platform' surumuyle kurar.
 *
 * Hicbir sey YAZMAZ: kampanya/anahtar kelime olusturmaz, DB'ye ve kv'ye
 * yazmaz (cozulen reklam hesabi kaydedilmez). Sir yazdirmaz (anahtar, token).
 *
 * Kullanim (apps/api icinde):
 *   npx tsx scripts/asa-platform-check.ts                 # tum aktif hesaplar
 *   npx tsx scripts/asa-platform-check.ts --site https://kobipratik.com
 */
// dotenv once: @luviai/shared sifreleme anahtarini modul yuklenirken okur
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '@luviai/shared';
import { createAsaClient } from '../src/aso/asa/asa-client.factory.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const siteUrl = argValue('--site');
  const prisma = new PrismaClient();
  let failures = 0;
  try {
    const accounts = await prisma.asaAccount.findMany({
      where: { isActive: true, ...(siteUrl ? { site: { url: siteUrl } } : {}) },
      select: { id: true, orgId: true, keyId: true, encryptedKey: true, teamId: true, site: { select: { url: true } } },
    });
    if (accounts.length === 0) {
      console.log(siteUrl ? `${siteUrl} icin aktif ASA hesabi yok.` : 'Aktif ASA hesabi yok.');
      return;
    }
    for (const acc of accounts) {
      const label = acc.site?.url ?? acc.id;
      try {
        const client = createAsaClient(
          { orgId: acc.orgId, keyId: acc.keyId, privateKeyPem: decrypt(acc.encryptedKey), teamId: acc.teamId ?? undefined },
          { version: 'platform' },
        );
        await client.getAccessToken(true);
        const info = await client.getAccountInfo();
        const campaigns = await client.listCampaigns();
        console.log(
          `${label}: Platform API CALISIYOR — hesap: ${info.name ?? '(adsiz)'}, para birimi: ${info.currency ?? '?'}, kampanya: ${campaigns.length}`,
        );
      } catch (err) {
        failures += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.log(`${label}: Platform API HATA — ${message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  if (failures > 0) process.exitCode = 1;
}

void main();
