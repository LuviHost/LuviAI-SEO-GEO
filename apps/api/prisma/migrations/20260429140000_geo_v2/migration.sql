-- GEO v2 — llms-full + AI citation tracking + sosyal profiller

-- Sites: llms-full.txt cache + sosyal profiller
ALTER TABLE `sites` ADD COLUMN `llmsFullTxt` LONGTEXT NULL;
ALTER TABLE `sites` ADD COLUMN `llmsFullTxtAt` DATETIME(3) NULL;
ALTER TABLE `sites` ADD COLUMN `socialProfiles` JSON NULL;

-- AI Citation Snapshot tablosu
CREATE TABLE `ai_citation_snapshots` (
  `id`             VARCHAR(191) NOT NULL,
  `siteId`         VARCHAR(191) NOT NULL,
  `date`           DATE NOT NULL,
  `provider`       VARCHAR(50)  NOT NULL,
  `available`      BOOLEAN      NOT NULL,
  `score`          INT NULL,
  `probes`         JSON NOT NULL,
  `citedCount`     INT NOT NULL DEFAULT 0,
  `mentionedCount` INT NOT NULL DEFAULT 0,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_citation_snapshots_siteId_date_provider_key` (`siteId`, `date`, `provider`),
  INDEX `ai_citation_snapshots_siteId_date_idx` (`siteId`, `date`),
  INDEX `ai_citation_snapshots_siteId_provider_date_idx` (`siteId`, `provider`, `date`)
);

-- JobType enum'a yeni tipler
ALTER TABLE `jobs` MODIFY COLUMN `type` ENUM(
  'SITE_AUDIT','AUTO_FIX','BRAIN_GENERATE','TOPIC_ENGINE','GENERATE_ARTICLE','PUBLISH_ARTICLE',
  'GENERATE_IMAGE','IMPROVE_PAGE','WEEKLY_BATCH','PERFORMANCE_CHECK','ONBOARDING_CHAIN',
  'SOCIAL_PUBLISH','PROCESS_SCHEDULED','LLMS_FULL_BUILD','AI_CITATION_DAILY'
) NOT NULL;
