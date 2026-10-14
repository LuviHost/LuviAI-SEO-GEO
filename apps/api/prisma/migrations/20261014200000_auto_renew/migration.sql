-- AlterTable
ALTER TABLE `users` ADD COLUMN `autoRenew` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `paytrUtoken` VARCHAR(255) NULL,
    ADD COLUMN `renewalFailCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `renewalLastAttemptAt` DATETIME(3) NULL,
    ADD COLUMN `renewalNoticeAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `isRenewal` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `storeCard` BOOLEAN NOT NULL DEFAULT false;

