-- GA4 OAuth fields (per-site, opsiyonel)
ALTER TABLE `sites`
  ADD COLUMN `gaPropertyId` VARCHAR(191) NULL,
  ADD COLUMN `gaRefreshToken` TEXT NULL,
  ADD COLUMN `gaConnectedAt` DATETIME(3) NULL;
