-- Sosyal medya kanal + post + recurring slot

CREATE TABLE `social_channels` (
  `id` VARCHAR(191) NOT NULL,
  `siteId` VARCHAR(191) NOT NULL,
  `type` ENUM(
    'LINKEDIN_PERSONAL', 'LINKEDIN_COMPANY', 'X_TWITTER',
    'FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'TIKTOK', 'YOUTUBE',
    'THREADS', 'BLUESKY', 'PINTEREST', 'GMB', 'MASTODON'
  ) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `credentials` TEXT NOT NULL,
  `config` JSON NULL,
  `externalId` VARCHAR(191) NULL,
  `externalName` VARCHAR(191) NULL,
  `externalAvatar` VARCHAR(191) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `social_channels_siteId_type_externalId_key`(`siteId`, `type`, `externalId`),
  INDEX `social_channels_siteId_idx`(`siteId`),
  INDEX `social_channels_type_idx`(`type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_posts` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `articleId` VARCHAR(191) NULL,
  `text` TEXT NOT NULL,
  `mediaUrls` JSON NULL,
  `metadata` JSON NULL,
  `status` ENUM('DRAFT', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'DRAFT',
  `scheduledFor` DATETIME(3) NULL,
  `publishedAt` DATETIME(3) NULL,
  `externalId` VARCHAR(191) NULL,
  `externalUrl` VARCHAR(500) NULL,
  `errorMsg` TEXT NULL,
  `retryCount` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `social_posts_channelId_status_idx`(`channelId`, `status`),
  INDEX `social_posts_scheduledFor_idx`(`scheduledFor`),
  INDEX `social_posts_articleId_idx`(`articleId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_recurring_slots` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `dayOfWeek` INT NOT NULL,
  `hour` INT NOT NULL,
  `minute` INT NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul',
  `source` ENUM('QUEUE', 'AUTO') NOT NULL DEFAULT 'QUEUE',
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `social_recurring_slots_channelId_idx`(`channelId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `social_channels` ADD CONSTRAINT `social_channels_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `social_posts` ADD CONSTRAINT `social_posts_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `social_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `social_posts` ADD CONSTRAINT `social_posts_articleId_fkey`
  FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `social_recurring_slots` ADD CONSTRAINT `social_recurring_slots_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `social_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
