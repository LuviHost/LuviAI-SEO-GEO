-- Testimonial + App Store Connect (ASC) + Apple Search Ads (ASA) + Landing Analytics
-- Branch feat/premium-pricing-2026-05 icin yazilmis servislerin eksik tablolari.
-- Tum FK'ler yalnizca bu migration'in kendi tablolari arasinda (sites/users'a referans yok).

-- ─────────────────────────────────────────────────────────────
-- Testimonials
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `testimonials` (
  `id`         VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `siteId`     VARCHAR(191) NULL,
  `rating`     INT NOT NULL,
  `body`       TEXT NOT NULL,
  `role`       VARCHAR(191) NULL,
  `company`    VARCHAR(191) NULL,
  `metric`     VARCHAR(191) NULL,
  `approved`   BOOLEAN NOT NULL DEFAULT false,
  `rejected`   BOOLEAN NOT NULL DEFAULT false,
  `featured`   BOOLEAN NOT NULL DEFAULT false,
  `approvedAt` DATETIME(3) NULL,
  `approvedBy` VARCHAR(191) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL,

  INDEX `testimonials_approved_rejected_featured_idx` (`approved`, `rejected`, `featured`),
  INDEX `testimonials_userId_createdAt_idx` (`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- App Store Connect (ASC)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `asc_accounts` (
  `id`           VARCHAR(191) NOT NULL,
  `siteId`       VARCHAR(191) NOT NULL,
  `issuerId`     VARCHAR(191) NOT NULL,
  `keyId`        VARCHAR(191) NOT NULL,
  `encryptedKey` TEXT NOT NULL,
  `isActive`     BOOLEAN NOT NULL DEFAULT true,
  `lastSyncAt`   DATETIME(3) NULL,
  `lastError`    TEXT NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL,

  INDEX `asc_accounts_siteId_idx` (`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asc_apps` (
  `id`              VARCHAR(191) NOT NULL,
  `accountId`       VARCHAR(191) NOT NULL,
  `appleAppId`      VARCHAR(191) NOT NULL,
  `bundleId`        VARCHAR(191) NOT NULL,
  `name`            VARCHAR(191) NOT NULL,
  `primaryLocale`   VARCHAR(191) NULL,
  `latestVersion`   VARCHAR(191) NULL,
  `latestReleaseAt` DATETIME(3) NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL,

  UNIQUE INDEX `asc_apps_appleAppId_key` (`appleAppId`),
  INDEX `asc_apps_accountId_idx` (`accountId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asc_releases` (
  `id`             VARCHAR(191) NOT NULL,
  `appId`          VARCHAR(191) NOT NULL,
  `appleReleaseId` VARCHAR(191) NOT NULL,
  `versionString`  VARCHAR(191) NOT NULL,
  `releaseType`    VARCHAR(191) NULL,
  `state`          VARCHAR(191) NOT NULL,
  `releaseDate`    DATETIME(3) NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,

  UNIQUE INDEX `asc_releases_appleReleaseId_key` (`appleReleaseId`),
  INDEX `asc_releases_appId_idx` (`appId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asc_release_alerts` (
  `id`              VARCHAR(191) NOT NULL,
  `appId`           VARCHAR(191) NOT NULL,
  `severity`        VARCHAR(191) NOT NULL,
  `message`         TEXT NOT NULL,
  `daysSinceUpdate` INT NOT NULL,
  `acknowledgedAt`  DATETIME(3) NULL,
  `acknowledgedBy`  VARCHAR(191) NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `asc_release_alerts_appId_acknowledgedAt_idx` (`appId`, `acknowledgedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- Apple Search Ads (ASA)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `asa_accounts` (
  `id`                  VARCHAR(191) NOT NULL,
  `siteId`              VARCHAR(191) NOT NULL,
  `orgId`               VARCHAR(191) NOT NULL,
  `keyId`               VARCHAR(191) NOT NULL,
  `encryptedKey`        TEXT NOT NULL,
  `teamId`              VARCHAR(191) NULL,
  `isActive`            BOOLEAN NOT NULL DEFAULT true,
  `lastSyncAt`          DATETIME(3) NULL,
  `lastError`           TEXT NULL,
  `tokenCacheValue`     TEXT NULL,
  `tokenCacheExpAt`     DATETIME(3) NULL,
  `autoPilotEnabled`    BOOLEAN NOT NULL DEFAULT false,
  `autoPilotBudgetCap`  DOUBLE NULL,
  `autoPilotLastRunAt`  DATETIME(3) NULL,
  `autoPilotLastResult` TEXT NULL,
  `createdAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL,

  INDEX `asa_accounts_siteId_idx` (`siteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asa_campaigns` (
  `id`                 VARCHAR(191) NOT NULL,
  `accountId`          VARCHAR(191) NOT NULL,
  `asaCampaignId`      VARCHAR(191) NOT NULL,
  `name`               VARCHAR(191) NOT NULL,
  `budget`             DOUBLE NOT NULL,
  `totalBudget`        DOUBLE NULL,
  `status`             VARCHAR(191) NOT NULL,
  `countriesOrRegions` JSON NOT NULL,
  `supplySources`      JSON NOT NULL,
  `appAdamId`          VARCHAR(191) NULL,
  `createdAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`          DATETIME(3) NOT NULL,

  UNIQUE INDEX `asa_campaigns_asaCampaignId_key` (`asaCampaignId`),
  INDEX `asa_campaigns_accountId_idx` (`accountId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asa_ad_groups` (
  `id`               VARCHAR(191) NOT NULL,
  `campaignId`       VARCHAR(191) NOT NULL,
  `asaAdGroupId`     VARCHAR(191) NOT NULL,
  `name`             VARCHAR(191) NOT NULL,
  `defaultBidAmount` DOUBLE NOT NULL,
  `status`           VARCHAR(191) NOT NULL,
  `targetingType`    VARCHAR(191) NOT NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL,

  INDEX `asa_ad_groups_campaignId_idx` (`campaignId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asa_keyword_bids` (
  `id`              VARCHAR(191) NOT NULL,
  `adGroupId`       VARCHAR(191) NOT NULL,
  `asaKeywordId`    VARCHAR(191) NOT NULL,
  `keyword`         VARCHAR(191) NOT NULL,
  `bidAmount`       DOUBLE NOT NULL,
  `matchType`       VARCHAR(191) NOT NULL,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `lastOptimizedAt` DATETIME(3) NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL,

  INDEX `asa_keyword_bids_adGroupId_idx` (`adGroupId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asa_performance_daily` (
  `id`             VARCHAR(191) NOT NULL,
  `campaignId`     VARCHAR(191) NOT NULL,
  `date`           DATETIME(3) NOT NULL,
  `impressions`    INT NOT NULL DEFAULT 0,
  `taps`           INT NOT NULL DEFAULT 0,
  `installs`       INT NOT NULL DEFAULT 0,
  `reattributions` INT NOT NULL DEFAULT 0,
  `spendUsd`       DOUBLE NOT NULL DEFAULT 0,
  `avgCpt`         DOUBLE NULL,
  `avgCpa`         DOUBLE NULL,
  `ttr`            DOUBLE NULL,
  `conversionRate` DOUBLE NULL,

  UNIQUE INDEX `asa_performance_daily_campaignId_date_key` (`campaignId`, `date`),
  INDEX `asa_performance_daily_campaignId_date_idx` (`campaignId`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- Landing Analytics
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `landing_events` (
  `id`        VARCHAR(191) NOT NULL,
  `type`      VARCHAR(191) NOT NULL,
  `path`      TEXT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `meta`      JSON NULL,
  `referrer`  TEXT NULL,
  `ua`        TEXT NULL,
  `utm`       JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `landing_events_createdAt_idx` (`createdAt`),
  INDEX `landing_events_type_createdAt_idx` (`type`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- Foreign keys (yalnizca bu migration'in tablolari arasinda)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE `asc_apps`
  ADD CONSTRAINT `asc_apps_accountId_fkey`
  FOREIGN KEY (`accountId`) REFERENCES `asc_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asc_releases`
  ADD CONSTRAINT `asc_releases_appId_fkey`
  FOREIGN KEY (`appId`) REFERENCES `asc_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asc_release_alerts`
  ADD CONSTRAINT `asc_release_alerts_appId_fkey`
  FOREIGN KEY (`appId`) REFERENCES `asc_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asa_campaigns`
  ADD CONSTRAINT `asa_campaigns_accountId_fkey`
  FOREIGN KEY (`accountId`) REFERENCES `asa_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asa_ad_groups`
  ADD CONSTRAINT `asa_ad_groups_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `asa_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asa_keyword_bids`
  ADD CONSTRAINT `asa_keyword_bids_adGroupId_fkey`
  FOREIGN KEY (`adGroupId`) REFERENCES `asa_ad_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `asa_performance_daily`
  ADD CONSTRAINT `asa_performance_daily_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `asa_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
