-- ENH#1: GEO rescan — Auriti GEO before/after gercek skoru
-- ENH#4: Performance feedback loop — 30 gun sonra GSC re-check
-- ENH#2: External page recovery — yeni JobType

-- ─────────────────────────────────────────────────────────────
-- 1) stuck_page_recoveries tablosuna yeni kolonlar
-- ─────────────────────────────────────────────────────────────
ALTER TABLE `stuck_page_recoveries`
  ADD COLUMN `geoScoreBefore`       INT NULL,
  ADD COLUMN `geoScoreAfter`        INT NULL,
  ADD COLUMN `effectivenessCheckAt` DATETIME(3) NULL,
  ADD COLUMN `positionBefore`       DOUBLE NULL,
  ADD COLUMN `positionAfter`        DOUBLE NULL,
  ADD COLUMN `positionImprovement`  DOUBLE NULL,
  ADD COLUMN `ctrBefore`            DOUBLE NULL,
  ADD COLUMN `ctrAfter`             DOUBLE NULL,
  ADD COLUMN `effectivenessScore`   INT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2) Job tipi enum: yeni 2 JobType
-- ─────────────────────────────────────────────────────────────
ALTER TABLE `jobs` MODIFY COLUMN `type` ENUM(
  'SITE_AUDIT','AUTO_FIX','BRAIN_GENERATE','TOPIC_ENGINE','GENERATE_ARTICLE',
  'PUBLISH_ARTICLE','GENERATE_IMAGE','IMPROVE_PAGE','WEEKLY_BATCH',
  'PERFORMANCE_CHECK','ONBOARDING_CHAIN','SOCIAL_PUBLISH','PROCESS_SCHEDULED',
  'LLMS_FULL_BUILD','AI_CITATION_DAILY','CONTENT_PIVOT_CHECK','AI_MENTION_ALARM',
  'ADS_AUTOPILOT','VIDEO_GENERATE',
  'STUCK_PAGE_DETECT','STUCK_PAGE_DETECT_ALL','STUCK_PAGE_RECOVER',
  'STUCK_PAGE_PERFORMANCE_CHECK','STUCK_PAGE_EXTERNAL_RECOVER'
) NOT NULL;
