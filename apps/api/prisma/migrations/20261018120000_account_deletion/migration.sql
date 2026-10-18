-- Hesap silme (Apple App Review 5.1.1(v) + KVKK, 2026-10)
--
-- 1) users.deletionRequestedAt: silme talebi ani. Dolu hesapla giris ve API
--    erisimi kapali; 30 gun sonra me/account-purge.cron.ts hesabi kalici siler.
-- 2) invoices / video_credit_purchases: kullanici silinince odeme kaydi
--    SILINMEZ, userId NULL olur. Eskiden ON DELETE CASCADE'di; hesap silmek
--    muhasebe kaydini da goturuyordu (VUK md. 253: 5 yil, TTK md. 82: 10 yil
--    saklama yukumlulugu).
--
-- SQL `prisma migrate diff` ile semadan uretildi (veritabanina dokunmadan).

-- DropForeignKey
ALTER TABLE `invoices` DROP FOREIGN KEY `invoices_userId_fkey`;

-- DropForeignKey
ALTER TABLE `video_credit_purchases` DROP FOREIGN KEY `video_credit_purchases_userId_fkey`;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `deletionRequestedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `invoices` MODIFY `userId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `video_credit_purchases` MODIFY `userId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `users_deletionRequestedAt_idx` ON `users`(`deletionRequestedAt`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_credit_purchases` ADD CONSTRAINT `video_credit_purchases_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
