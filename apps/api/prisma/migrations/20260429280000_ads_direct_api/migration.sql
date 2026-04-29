-- Faz 11.2: Ryze AI MCP kaldirildi, dogrudan Google Ads + Meta Marketing API entegrasyonu

-- Eski MCP alanlarini sil
ALTER TABLE `sites` DROP COLUMN `adsMcpEndpoint`;
ALTER TABLE `sites` DROP COLUMN `adsMcpToken`;

-- Yeni resmi API alanlari
ALTER TABLE `sites` ADD COLUMN `googleAdsCustomerId` VARCHAR(50) NULL;
ALTER TABLE `sites` ADD COLUMN `googleAdsRefreshToken` TEXT NULL;
ALTER TABLE `sites` ADD COLUMN `googleAdsConnectedAt` DATETIME(3) NULL;
ALTER TABLE `sites` ADD COLUMN `metaAdsAccountId` VARCHAR(50) NULL;
ALTER TABLE `sites` ADD COLUMN `metaAdsAccessToken` TEXT NULL;
ALTER TABLE `sites` ADD COLUMN `metaAdsConnectedAt` DATETIME(3) NULL;
