-- Stuck Pages — On-page.ai Recipe 1 esleyicisi.
-- Indekslenmis ama yeterince ranklamayan sayfalarin algilama + LLM duzeltme + audit trail.

-- ─────────────────────────────────────────────────────────────
-- 1) stuck_pages tablosu
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `stuck_pages` (
  `id`                  VARCHAR(191) NOT NULL,
  `siteId`              VARCHAR(191) NOT NULL,
  `articleId`           VARCHAR(191) NULL,
  `url`                 VARCHAR(191) NOT NULL,
  `title`               VARCHAR(191) NULL,
  `impressions`         INT NOT NULL,
  `clicks`              INT NOT NULL,
  `position`            DOUBLE NOT NULL,
  `ctr`                 DOUBLE NOT NULL,
  `stuckScore`          INT NOT NULL,
  `entityScoreBefore`   INT NULL,
  `topMissingEntities`  JSON NULL,
  `topQueries`          JSON NULL,
  `status`              ENUM('DETECTED','RECOVERING','RECOVERED','FAILED','REVERTED','IGNORED') NOT NULL DEFAULT 'DETECTED',
  `detectedAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL,

  INDEX `stuck_pages_siteId_status_idx` (`siteId`, `status`),
  INDEX `stuck_pages_siteId_detectedAt_idx` (`siteId`, `detectedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `stuck_pages`
  ADD CONSTRAINT `stuck_pages_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `stuck_pages`
  ADD CONSTRAINT `stuck_pages_articleId_fkey`
  FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 2) stuck_page_recoveries tablosu
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `stuck_page_recoveries` (
  `id`                VARCHAR(191) NOT NULL,
  `stuckPageId`       VARCHAR(191) NOT NULL,
  `bodyHtmlBefore`    LONGTEXT NULL,
  `bodyHtmlAfter`     LONGTEXT NULL,
  `bodyMdBefore`      LONGTEXT NULL,
  `bodyMdAfter`       LONGTEXT NULL,
  `edits`             JSON NOT NULL,
  `entitiesAdded`     JSON NOT NULL,
  `alttextsUpdated`   JSON NULL,
  `paragraphAdded`    TEXT NULL,
  `entityScoreAfter`  INT NOT NULL,
  `scorePassedComp`   BOOLEAN NOT NULL,
  `llmModel`          VARCHAR(191) NOT NULL,
  `totalCost`         DECIMAL(10, 4) NULL,
  `promptTokens`      INT NULL,
  `completionTokens`  INT NULL,
  `appliedAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedBy`         VARCHAR(191) NOT NULL,
  `revertedAt`        DATETIME(3) NULL,
  `revertedBy`        VARCHAR(191) NULL,

  INDEX `stuck_page_recoveries_stuckPageId_appliedAt_idx` (`stuckPageId`, `appliedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `stuck_page_recoveries`
  ADD CONSTRAINT `stuck_page_recoveries_stuckPageId_fkey`
  FOREIGN KEY (`stuckPageId`) REFERENCES `stuck_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 3) Job tablosu enum: yeni STUCK_PAGE_* tipler
-- ─────────────────────────────────────────────────────────────
ALTER TABLE `jobs` MODIFY COLUMN `type` ENUM(
  'SITE_AUDIT','AUTO_FIX','BRAIN_GENERATE','TOPIC_ENGINE','GENERATE_ARTICLE',
  'PUBLISH_ARTICLE','GENERATE_IMAGE','IMPROVE_PAGE','WEEKLY_BATCH',
  'PERFORMANCE_CHECK','ONBOARDING_CHAIN','SOCIAL_PUBLISH','PROCESS_SCHEDULED',
  'LLMS_FULL_BUILD','AI_CITATION_DAILY','CONTENT_PIVOT_CHECK','AI_MENTION_ALARM',
  'ADS_AUTOPILOT','VIDEO_GENERATE',
  'STUCK_PAGE_DETECT','STUCK_PAGE_DETECT_ALL','STUCK_PAGE_RECOVER'
) NOT NULL;
