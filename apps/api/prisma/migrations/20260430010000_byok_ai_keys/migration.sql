-- Sprint BYOK: Site bazli kullanici AI provider keyleri + User kota alanlari

-- 1) User tablosuna citation kota alanlari
ALTER TABLE `users`
  ADD COLUMN `aiCitationTestsThisMonth` INT NOT NULL DEFAULT 0,
  ADD COLUMN `aiCitationQuotaResetAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- 2) Site bazli BYOK tablosu
CREATE TABLE `site_ai_provider_keys` (
  `id`         VARCHAR(191) NOT NULL,
  `siteId`     VARCHAR(191) NOT NULL,
  `provider`   VARCHAR(50)  NOT NULL,
  `enc`        TEXT         NOT NULL,
  `prefix`     VARCHAR(20)  NOT NULL,
  `verified`   BOOLEAN      NOT NULL DEFAULT false,
  `verifiedAt` DATETIME(3)  NULL,
  `lastError`  TEXT         NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `site_ai_provider_keys_siteId_provider_key` (`siteId`, `provider`),
  INDEX `site_ai_provider_keys_siteId_idx` (`siteId`),
  CONSTRAINT `site_ai_provider_keys_siteId_fkey`
    FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);
