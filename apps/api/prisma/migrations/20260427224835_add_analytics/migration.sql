-- CreateTable
CREATE TABLE `analytics_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `totalClicks` INTEGER NOT NULL,
    `totalImpressions` INTEGER NOT NULL,
    `avgCtr` DOUBLE NOT NULL,
    `avgPosition` DOUBLE NOT NULL,
    `pageDetails` JSON NOT NULL,
    `queryDetails` JSON NOT NULL,
    `trendingQueries` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `analytics_snapshots_siteId_date_idx`(`siteId`, `date`),
    UNIQUE INDEX `analytics_snapshots_siteId_date_key`(`siteId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `analytics_snapshots` ADD CONSTRAINT `analytics_snapshots_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
