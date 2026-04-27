-- AlterTable
ALTER TABLE `users` ADD COLUMN `referredByCode` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `affiliates` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `refCode` VARCHAR(191) NOT NULL,
    `commissionPct` DOUBLE NOT NULL DEFAULT 30,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `totalReferred` INTEGER NOT NULL DEFAULT 0,
    `totalRevenue` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalCommission` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalPaid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `payoutMethod` VARCHAR(191) NULL,
    `payoutDetails` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `affiliates_userId_key`(`userId`),
    UNIQUE INDEX `affiliates_refCode_key`(`refCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliate_referrals` (
    `id` VARCHAR(191) NOT NULL,
    `affiliateId` VARCHAR(191) NOT NULL,
    `referredUserId` VARCHAR(191) NOT NULL,
    `clickedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signedUpAt` DATETIME(3) NULL,
    `firstPaidAt` DATETIME(3) NULL,
    `commissionUntil` DATETIME(3) NULL,
    `totalCommissionEarned` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'clicked',

    INDEX `affiliate_referrals_referredUserId_idx`(`referredUserId`),
    INDEX `affiliate_referrals_affiliateId_status_idx`(`affiliateId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `to` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'sent',
    `resendId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_logs_resendId_key`(`resendId`),
    INDEX `email_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `email_logs_template_createdAt_idx`(`template`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `affiliate_referrals` ADD CONSTRAINT `affiliate_referrals_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
