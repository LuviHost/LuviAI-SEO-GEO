-- Prompt Lab + Fan-out.
--
-- NEDEN: Citation probe sorgulari bugune kadar brain'den otomatik turuyordu
-- (ai-citation.service.ts -> seo.aeoQueries / geoQueries / topQuestions).
-- Kullanici "beni su soruda takip et" diyemiyordu ve olculen yuzey modelin
-- gercek yuzeyi degildi: model bir soruyu cevaplarken arka planda
-- "X guvenilir mi", "X vs Y", "X fiyat" gibi alt sorgular uretir ve citation
-- cogu zaman o dallarda kazanilir. Bu uc tablo takip setini ve dal agacini
-- birinci sinif veri haline getirir.

CREATE TABLE `geo_prompts` (
  `id`             VARCHAR(191) NOT NULL,
  `siteId`         VARCHAR(191) NOT NULL,
  `text`           TEXT NOT NULL,
  `intent`         VARCHAR(191) NOT NULL DEFAULT 'informational',
  `locale`         VARCHAR(191) NOT NULL DEFAULT 'tr',
  `source`         VARCHAR(191) NOT NULL DEFAULT 'manual',
  `tags`           JSON NULL,
  `isActive`       BOOLEAN NOT NULL DEFAULT true,
  `lastRunAt`      DATETIME(3) NULL,
  `lastCitedCount` INTEGER NOT NULL DEFAULT 0,
  `lastTotalCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,

  INDEX `geo_prompts_siteId_isActive_idx`(`siteId`, `isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `geo_fanout_queries` (
  `id`          VARCHAR(191) NOT NULL,
  `promptId`    VARCHAR(191) NOT NULL,
  `siteId`      VARCHAR(191) NOT NULL,
  `text`        TEXT NOT NULL,
  `kind`        VARCHAR(191) NOT NULL DEFAULT 'reviews',
  `likelihood`  INTEGER NOT NULL DEFAULT 50,
  `rank`        INTEGER NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN NOT NULL DEFAULT true,
  `generatedBy` VARCHAR(191) NOT NULL DEFAULT 'ai',
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `geo_fanout_queries_siteId_idx`(`siteId`),
  INDEX `geo_fanout_queries_promptId_rank_idx`(`promptId`, `rank`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `geo_prompt_runs` (
  `id`             VARCHAR(191) NOT NULL,
  `siteId`         VARCHAR(191) NOT NULL,
  `promptId`       VARCHAR(191) NOT NULL,
  `fanoutId`       VARCHAR(191) NULL,
  `provider`       VARCHAR(191) NOT NULL,
  `date`           DATE NOT NULL,
  `cited`          BOOLEAN NOT NULL DEFAULT false,
  `brandMentioned` BOOLEAN NOT NULL DEFAULT false,
  `position`       INTEGER NULL,
  `sentiment`      VARCHAR(191) NULL,
  `excerpt`        TEXT NULL,
  `citedPages`     JSON NULL,
  `competitors`    JSON NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `geo_prompt_runs_siteId_date_idx`(`siteId`, `date`),
  INDEX `geo_prompt_runs_promptId_date_idx`(`promptId`, `date`),
  INDEX `geo_prompt_runs_fanoutId_date_idx`(`fanoutId`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `geo_prompts`
  ADD CONSTRAINT `geo_prompts_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `geo_fanout_queries`
  ADD CONSTRAINT `geo_fanout_queries_promptId_fkey`
  FOREIGN KEY (`promptId`) REFERENCES `geo_prompts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `geo_prompt_runs`
  ADD CONSTRAINT `geo_prompt_runs_promptId_fkey`
  FOREIGN KEY (`promptId`) REFERENCES `geo_prompts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `geo_prompt_runs`
  ADD CONSTRAINT `geo_prompt_runs_fanoutId_fkey`
  FOREIGN KEY (`fanoutId`) REFERENCES `geo_fanout_queries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
