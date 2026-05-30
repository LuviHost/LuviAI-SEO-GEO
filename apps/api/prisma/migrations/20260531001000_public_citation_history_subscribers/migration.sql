-- 1) Drop unique constraint on domain (allow multiple snapshots)
ALTER TABLE `public_citation_checks` DROP INDEX `public_citation_checks_domain_key`;

-- 2) Add source column to track origin (manual/retest_cron/signup_baseline)
ALTER TABLE `public_citation_checks` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'manual';

-- 3) Add composite index for fast (domain, createdAt) lookup
CREATE INDEX `public_citation_checks_domain_createdAt_idx` ON `public_citation_checks`(`domain`, `createdAt`);

-- 4) Create PublicCitationSubscriber table
CREATE TABLE `public_citation_subscribers` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL,
    `niche` VARCHAR(191) NULL,
    `customNiche` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_OPTIN',
    `consentAt` DATETIME(3) NULL,
    `confirmToken` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `unsubscribeToken` VARCHAR(191) NOT NULL,
    `nextRetestAt` DATETIME(3) NULL,
    `retestsSent` INTEGER NOT NULL DEFAULT 0,
    `signupUserId` VARCHAR(191) NULL,
    `signupAt` DATETIME(3) NULL,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'tr',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `public_citation_subscribers_confirmToken_key`(`confirmToken`),
    UNIQUE INDEX `public_citation_subscribers_unsubscribeToken_key`(`unsubscribeToken`),
    UNIQUE INDEX `public_citation_subscribers_email_domain_key`(`email`, `domain`),
    INDEX `public_citation_subscribers_nextRetestAt_status_idx`(`nextRetestAt`, `status`),
    INDEX `public_citation_subscribers_signupUserId_idx`(`signupUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5) Create PublicCitationEmailLog table
CREATE TABLE `public_citation_email_logs` (
    `id` VARCHAR(191) NOT NULL,
    `subscriberId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `citationCheckId` VARCHAR(191) NULL,
    `delta` JSON NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredAt` DATETIME(3) NULL,
    `openedAt` DATETIME(3) NULL,
    `clickedAt` DATETIME(3) NULL,
    `bouncedAt` DATETIME(3) NULL,
    `error` VARCHAR(191) NULL,

    INDEX `public_citation_email_logs_subscriberId_sentAt_idx`(`subscriberId`, `sentAt`),
    INDEX `public_citation_email_logs_type_sentAt_idx`(`type`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6) FK constraint
ALTER TABLE `public_citation_email_logs` ADD CONSTRAINT `public_citation_email_logs_subscriberId_fkey` FOREIGN KEY (`subscriberId`) REFERENCES `public_citation_subscribers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
