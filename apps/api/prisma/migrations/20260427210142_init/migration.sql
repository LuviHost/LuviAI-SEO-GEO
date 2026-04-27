-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailVerified` DATETIME(3) NULL,
    `name` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `role` ENUM('USER', 'ADMIN', 'AGENCY_OWNER') NOT NULL DEFAULT 'USER',
    `locale` VARCHAR(191) NOT NULL DEFAULT 'tr',
    `plan` ENUM('TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE') NOT NULL DEFAULT 'TRIAL',
    `trialEndsAt` DATETIME(3) NULL,
    `subscriptionId` VARCHAR(191) NULL,
    `subscriptionStatus` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'TRIAL',
    `articlesUsedThisMonth` INTEGER NOT NULL DEFAULT 0,
    `articlesQuotaResetAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_subscriptionId_key`(`subscriptionId`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_plan_subscriptionStatus_idx`(`plan`, `subscriptionStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,
    `refresh_token` TEXT NULL,
    `access_token` TEXT NULL,
    `expires_at` INTEGER NULL,
    `token_type` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `id_token` TEXT NULL,
    `session_state` VARCHAR(191) NULL,

    UNIQUE INDEX `accounts_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `sessionToken` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sessions_sessionToken_key`(`sessionToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_tokens` (
    `identifier` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `verification_tokens_token_key`(`token`),
    UNIQUE INDEX `verification_tokens_identifier_token_key`(`identifier`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sites` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `niche` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'tr',
    `status` ENUM('ONBOARDING', 'AUDIT_PENDING', 'AUDIT_COMPLETE', 'ACTIVE', 'PAUSED', 'ERROR') NOT NULL DEFAULT 'ONBOARDING',
    `gscPropertyUrl` VARCHAR(191) NULL,
    `gscRefreshToken` TEXT NULL,
    `gscConnectedAt` DATETIME(3) NULL,
    `autoGenerationEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoGenerationCron` VARCHAR(191) NULL,
    `autoGenerationCount` INTEGER NOT NULL DEFAULT 5,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sites_userId_idx`(`userId`),
    INDEX `sites_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brains` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `brandVoice` JSON NOT NULL,
    `personas` JSON NOT NULL,
    `competitors` JSON NOT NULL,
    `seoStrategy` JSON NOT NULL,
    `glossary` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `generatedBy` VARCHAR(191) NOT NULL DEFAULT 'auto',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `brains_siteId_key`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publish_targets` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `type` ENUM('WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'FTP', 'SFTP', 'CPANEL_API', 'GITHUB', 'WEBFLOW', 'SANITY', 'CONTENTFUL', 'GHOST', 'STRAPI', 'WHMCS_KB', 'CUSTOM_PHP', 'MARKDOWN_ZIP') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `credentials` JSON NOT NULL,
    `config` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,

    INDEX `publish_targets_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audits` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `overallScore` INTEGER NOT NULL,
    `geoScore` INTEGER NULL,
    `checks` JSON NOT NULL,
    `issues` JSON NOT NULL,
    `autoFixApplied` BOOLEAN NOT NULL DEFAULT false,
    `fixesApplied` JSON NULL,
    `ranAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `durationMs` INTEGER NULL,

    INDEX `audits_siteId_ranAt_idx`(`siteId`, `ranAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topic_queues` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `planTopics` JSON NOT NULL,
    `gscOpportunities` JSON NOT NULL,
    `geoGaps` JSON NOT NULL,
    `competitorMoves` JSON NOT NULL,
    `tier1Topics` JSON NOT NULL,
    `tier2Topics` JSON NOT NULL,
    `tier3Topics` JSON NOT NULL,
    `improvements` JSON NOT NULL,
    `totalEvaluated` INTEGER NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `topic_queues_siteId_generatedAt_idx`(`siteId`, `generatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `articles` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `metaTitle` VARCHAR(191) NULL,
    `metaDescription` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'tr',
    `persona` VARCHAR(191) NULL,
    `pillar` VARCHAR(191) NULL,
    `bodyMd` LONGTEXT NULL,
    `bodyHtml` LONGTEXT NULL,
    `frontmatter` JSON NULL,
    `agentOutputs` JSON NULL,
    `heroImageUrl` VARCHAR(191) NULL,
    `inlineImages` JSON NULL,
    `schemaMarkup` JSON NULL,
    `faqs` JSON NULL,
    `internalLinks` JSON NULL,
    `wordCount` INTEGER NULL,
    `readingTime` INTEGER NULL,
    `editorScore` INTEGER NULL,
    `editorVerdict` ENUM('PASS', 'REVIZE', 'FAIL') NULL,
    `totalCost` DECIMAL(10, 4) NULL,
    `status` ENUM('DRAFT', 'GENERATING', 'EDITING', 'REVIZE_NEEDED', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `publishedTo` JSON NULL,
    `performanceCheckedAt` DATETIME(3) NULL,
    `performanceMetrics` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `articles_siteId_status_idx`(`siteId`, `status`),
    INDEX `articles_publishedAt_idx`(`publishedAt`),
    UNIQUE INDEX `articles_siteId_slug_key`(`siteId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NULL,
    `type` ENUM('SITE_AUDIT', 'AUTO_FIX', 'BRAIN_GENERATE', 'TOPIC_ENGINE', 'GENERATE_ARTICLE', 'PUBLISH_ARTICLE', 'GENERATE_IMAGE', 'IMPROVE_PAGE', 'WEEKLY_BATCH', 'PERFORMANCE_CHECK') NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'QUEUED',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `bullJobId` VARCHAR(191) NULL,

    UNIQUE INDEX `jobs_bullJobId_key`(`bullJobId`),
    INDEX `jobs_type_status_idx`(`type`, `status`),
    INDEX `jobs_userId_queuedAt_idx`(`userId`, `queuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `paytrTransactionId` VARCHAR(191) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TRY',
    `status` ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `description` VARCHAR(191) NULL,
    `invoiceUrl` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_paytrTransactionId_key`(`paytrTransactionId`),
    INDEX `invoices_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_events` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `siteId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `usage_events_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `usage_events_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `hashedKey` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `scopes` JSON NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `api_keys_hashedKey_key`(`hashedKey`),
    INDEX `api_keys_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sites` ADD CONSTRAINT `sites_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brains` ADD CONSTRAINT `brains_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_targets` ADD CONSTRAINT `publish_targets_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audits` ADD CONSTRAINT `audits_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topic_queues` ADD CONSTRAINT `topic_queues_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articles` ADD CONSTRAINT `articles_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
