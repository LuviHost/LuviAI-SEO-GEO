-- Gorsel alt metni envanteri (Dalga A, 2026-10): SiteImage + IMAGE_ALT_* job tipleri.
-- prisma migrate diff (HEAD semasi -> yeni sema) ile uretildi; izole MySQL 8.4
-- (utf8mb4_unicode_ci) uzerinde uygulanip "No difference detected" ile dogrulandi.
-- jobs.type ENUM: yeni degerler listenin SONUNA eklendi (mevcut degerlerin sirasi/depolamasi degismez).

-- AlterTable
ALTER TABLE `jobs` MODIFY `type` ENUM('SITE_AUDIT', 'AUTO_FIX', 'BRAIN_GENERATE', 'TOPIC_ENGINE', 'GENERATE_ARTICLE', 'PUBLISH_ARTICLE', 'GENERATE_IMAGE', 'IMPROVE_PAGE', 'WEEKLY_BATCH', 'PERFORMANCE_CHECK', 'ONBOARDING_CHAIN', 'SOCIAL_PUBLISH', 'PROCESS_SCHEDULED', 'LLMS_FULL_BUILD', 'AI_CITATION_DAILY', 'CONTENT_PIVOT_CHECK', 'AI_MENTION_ALARM', 'ADS_AUTOPILOT', 'VIDEO_GENERATE', 'STUCK_PAGE_DETECT', 'STUCK_PAGE_DETECT_ALL', 'STUCK_PAGE_RECOVER', 'STUCK_PAGE_PERFORMANCE_CHECK', 'STUCK_PAGE_EXTERNAL_RECOVER', 'IMAGE_ALT_SUGGEST', 'IMAGE_ALT_APPLY') NOT NULL;

-- CreateTable
CREATE TABLE `site_images` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `srcHash` CHAR(40) NOT NULL,
    `src` TEXT NOT NULL,
    `srcRaw` TEXT NOT NULL,
    `firstPageUrl` TEXT NOT NULL,
    `pageCount` INTEGER NOT NULL DEFAULT 1,
    `samplePages` JSON NULL,
    `altState` VARCHAR(8) NOT NULL,
    `currentAlt` TEXT NULL,
    `flags` JSON NULL,
    `linked` BOOLEAN NOT NULL DEFAULT false,
    `linkHref` TEXT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `wpAttachmentId` INTEGER NULL,
    `pageLang` VARCHAR(16) NULL,
    `context` JSON NULL,
    `suggestedAlt` TEXT NULL,
    `suggestedBy` VARCHAR(64) NULL,
    `suggestedAt` DATETIME(3) NULL,
    `suggestionNote` VARCHAR(255) NULL,
    `approvedAlt` TEXT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'NEW',
    `applyDetail` JSON NULL,
    `appliedAt` DATETIME(3) NULL,
    `lastSeenAuditId` VARCHAR(191) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `site_images_siteId_status_idx`(`siteId`, `status`),
    INDEX `site_images_siteId_altState_lastSeenAt_idx`(`siteId`, `altState`, `lastSeenAt`),
    UNIQUE INDEX `site_images_siteId_srcHash_key`(`siteId`, `srcHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `site_images` ADD CONSTRAINT `site_images_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

