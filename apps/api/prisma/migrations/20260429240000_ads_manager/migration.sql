-- Faz 11: Ads Manager (Google + Meta + GA4)

-- Site'a MCP endpoint + autopilot alanlari
ALTER TABLE `sites` ADD COLUMN `adsMcpEndpoint` VARCHAR(500) NULL;
ALTER TABLE `sites` ADD COLUMN `adsMcpToken` TEXT NULL;
ALTER TABLE `sites` ADD COLUMN `adsAutopilot` BOOLEAN NOT NULL DEFAULT false;

-- AdCampaign tablosu
CREATE TABLE `ad_campaigns` (
  `id`            VARCHAR(191) NOT NULL,
  `siteId`        VARCHAR(191) NOT NULL,
  `platform`      VARCHAR(50)  NOT NULL,
  `externalId`    VARCHAR(191) NULL,
  `name`          VARCHAR(255) NOT NULL,
  `objective`     VARCHAR(50)  NOT NULL,
  `status`        VARCHAR(50)  NOT NULL DEFAULT 'DRAFT',
  `audience`      JSON NULL,
  `locations`     JSON NULL,
  `languages`     JSON NULL,
  `headlines`     JSON NULL,
  `descriptions`  JSON NULL,
  `primaryTexts`  JSON NULL,
  `ctaButton`     VARCHAR(50) NULL,
  `creativeAssets` JSON NULL,
  `budgetType`    VARCHAR(20) NULL,
  `budgetAmount`  DECIMAL(10, 2) NULL,
  `budgetCurrency` VARCHAR(10) NOT NULL DEFAULT 'TRY',
  `startDate`     DATETIME(3) NULL,
  `endDate`       DATETIME(3) NULL,
  `impressions`   INT NOT NULL DEFAULT 0,
  `clicks`        INT NOT NULL DEFAULT 0,
  `spend`         DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `conversions`   INT NOT NULL DEFAULT 0,
  `ctr`           DOUBLE NOT NULL DEFAULT 0,
  `cpc`           DOUBLE NOT NULL DEFAULT 0,
  `roas`          DOUBLE NOT NULL DEFAULT 0,
  `performanceCheckedAt` DATETIME(3) NULL,
  `performanceMetrics` JSON NULL,
  `autopilotActions` JSON NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `ad_campaigns_siteId_platform_idx` (`siteId`, `platform`),
  INDEX `ad_campaigns_siteId_status_idx` (`siteId`, `status`),
  CONSTRAINT `ad_campaigns_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE
);
