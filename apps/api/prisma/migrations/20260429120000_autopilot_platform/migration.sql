-- Otopilot + platform auto-detect alanlari
ALTER TABLE `sites` ADD COLUMN `autopilot` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `sites` ADD COLUMN `platform` VARCHAR(50) NULL;
ALTER TABLE `sites` ADD COLUMN `platformConfidence` DOUBLE NULL;
ALTER TABLE `sites` ADD COLUMN `platformDetectedAt` DATETIME(3) NULL;
