-- Siteye GERCEKTEN uygulanan duzeltmelerin kalici kaydi.
--
-- NEDEN: uc servis siteye degisiklik yaziyordu ve hicbiri iz birakmiyordu —
-- snippet-applier (meta/OG/JSON-LD), static-html-fixer (statik HTML) ve
-- auto-fix (en son Audit satirinin fixesApplied alaninin UZERINE yaziyor,
-- ikinci kosum birincinin izini siliyor). Sonuc: "bu donemde kac duzeltme
-- uygulandi" sorusu cevaplanamiyordu ve rapora yazilacak her sayi uydurma
-- olurdu. Bu tablo o boslugu kapatir.
CREATE TABLE `applied_fixes` (
  `id`         VARCHAR(191) NOT NULL,
  `siteId`     VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NULL,
  `kind`       VARCHAR(24)  NOT NULL,
  `fixType`    VARCHAR(48)  NOT NULL,
  `target`     TEXT         NULL,
  `status`     VARCHAR(12)  NOT NULL DEFAULT 'APPLIED',
  `error`      TEXT         NULL,
  `detail`     JSON         NULL,
  `adapter`    VARCHAR(32)  NULL,
  `appliedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revertedAt` DATETIME(3)  NULL,

  INDEX `applied_fixes_siteId_appliedAt_idx` (`siteId`, `appliedAt`),
  INDEX `applied_fixes_siteId_status_appliedAt_idx` (`siteId`, `status`, `appliedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `applied_fixes`
  ADD CONSTRAINT `applied_fixes_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
