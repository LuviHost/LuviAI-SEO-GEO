-- AlterTable
ALTER TABLE `articles` ADD COLUMN `qaCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `qaReport` JSON NULL,
    ADD COLUMN `qaStatus` ENUM('PASS', 'WARN', 'BLOCKED') NULL;

-- AlterTable
ALTER TABLE `geo_prompts` ADD COLUMN `trackedAppId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `agent_readiness_scans` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `overallScore` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `levels` JSON NOT NULL,
    `robotsAiStance` JSON NULL,
    `agentsAllowed` INTEGER NULL,
    `agentsTotal` INTEGER NULL,
    `nextUpToFix` JSON NULL,
    `ranAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `durationMs` INTEGER NULL,

    INDEX `agent_readiness_scans_siteId_ranAt_idx`(`siteId`, `ranAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `action_plan_items` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `sourceRef` VARCHAR(191) NULL,
    `impact` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `effort` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status` VARCHAR(191) NOT NULL DEFAULT 'todo',
    `dueAt` DATETIME(3) NULL,
    `doneAt` DATETIME(3) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `action_plan_items_siteId_status_idx`(`siteId`, `status`),
    INDEX `action_plan_items_siteId_source_idx`(`siteId`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_opportunities` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'prompt',
    `promptId` VARCHAR(191) NULL,
    `fanoutId` VARCHAR(191) NULL,
    `title` TEXT NOT NULL,
    `query` TEXT NOT NULL,
    `coverage` VARCHAR(191) NOT NULL DEFAULT 'LOST',
    `providersLost` JSON NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `articleId` VARCHAR(191) NULL,
    `remeasuredAt` DATETIME(3) NULL,
    `remeasureResult` JSON NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `content_opportunities_siteId_status_idx`(`siteId`, `status`),
    INDEX `content_opportunities_siteId_coverage_idx`(`siteId`, `coverage`),
    INDEX `content_opportunities_promptId_idx`(`promptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `chat_conversations_siteId_updatedAt_idx`(`siteId`, `updatedAt`),
    INDEX `chat_conversations_userId_updatedAt_idx`(`userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `toolCalls` JSON NULL,
    `skill` VARCHAR(191) NULL,
    `costUsd` DECIMAL(10, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_radar_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `query` TEXT NOT NULL,
    `products` JSON NOT NULL,
    `brandListed` BOOLEAN NOT NULL DEFAULT false,
    `brandRank` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_radar_snapshots_siteId_date_idx`(`siteId`, `date`),
    INDEX `product_radar_snapshots_siteId_provider_date_idx`(`siteId`, `provider`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_opportunities` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL DEFAULT 'reddit',
    `url` TEXT NOT NULL,
    `title` TEXT NOT NULL,
    `subreddit` VARCHAR(191) NULL,
    `snippet` TEXT NULL,
    `relevance` INTEGER NOT NULL DEFAULT 50,
    `draftReply` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `postedAt` DATETIME(3) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_opportunities_siteId_status_idx`(`siteId`, `status`),
    INDEX `community_opportunities_siteId_createdAt_idx`(`siteId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `geo_prompts_trackedAppId_idx` ON `geo_prompts`(`trackedAppId`);

-- AddForeignKey
ALTER TABLE `geo_prompts` ADD CONSTRAINT `geo_prompts_trackedAppId_fkey` FOREIGN KEY (`trackedAppId`) REFERENCES `tracked_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_readiness_scans` ADD CONSTRAINT `agent_readiness_scans_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_plan_items` ADD CONSTRAINT `action_plan_items_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_opportunities` ADD CONSTRAINT `content_opportunities_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_opportunities` ADD CONSTRAINT `content_opportunities_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_radar_snapshots` ADD CONSTRAINT `product_radar_snapshots_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_opportunities` ADD CONSTRAINT `community_opportunities_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

