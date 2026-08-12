-- CreateTable
CREATE TABLE `crawler_hit_events` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bot` VARCHAR(191) NOT NULL,
    `path` VARCHAR(1000) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 200,
    `isCiteFetch` BOOLEAN NOT NULL DEFAULT false,
    `source` VARCHAR(191) NOT NULL DEFAULT 'worker',
    `meta` JSON NULL,

    INDEX `crawler_hit_events_siteId_ts_idx`(`siteId`, `ts`),
    INDEX `crawler_hit_events_siteId_isCiteFetch_ts_idx`(`siteId`, `isCiteFetch`, `ts`),
    INDEX `crawler_hit_events_ts_idx`(`ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `crawler_hit_events` ADD CONSTRAINT `crawler_hit_events_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

