-- Cevap sonrasi satis takibi (insan ekseni) — bot 'status' alanina dokunmaz
ALTER TABLE `linkedin_prospects`
  ADD COLUMN `satisAsamasi` ENUM('YOK','GORUSULDU','KARNE_GONDERILDI','TOPLANTI','TEKLIF','KAZANILDI','KAYBEDILDI') NOT NULL DEFAULT 'YOK',
  ADD COLUMN `satisNotu` TEXT NULL,
  ADD COLUMN `hatirlatmaAt` DATETIME(3) NULL;

CREATE INDEX `linkedin_prospects_satisAsamasi_idx` ON `linkedin_prospects`(`satisAsamasi`);
CREATE INDEX `linkedin_prospects_hatirlatmaAt_idx` ON `linkedin_prospects`(`hatirlatmaAt`);

-- Paylasilabilir ucretsiz karne
CREATE TABLE `prospect_karneler` (
  `id` VARCHAR(191) NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `brand` VARCHAR(160) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `sektor` VARCHAR(64) NOT NULL,
  `altsektor` VARCHAR(64) NULL,
  `ozet` JSON NOT NULL,
  `html` LONGTEXT NOT NULL,
  `prospectId` VARCHAR(191) NULL,
  `cagriSayisi` INTEGER NOT NULL DEFAULT 0,
  `maliyetUsd` DOUBLE NOT NULL DEFAULT 0,
  `gorulmeSayisi` INTEGER NOT NULL DEFAULT 0,
  `sonGorulmeAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `prospect_karneler_token_key`(`token`),
  INDEX `prospect_karneler_host_createdAt_idx`(`host`, `createdAt`),
  INDEX `prospect_karneler_prospectId_idx`(`prospectId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `prospect_karneler`
  ADD CONSTRAINT `prospect_karneler_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `linkedin_prospects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
