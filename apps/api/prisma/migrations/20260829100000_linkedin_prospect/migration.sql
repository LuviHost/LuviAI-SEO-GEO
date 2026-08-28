-- LinkedIn outreach botu (Faz 8): kisi basina tek satir, profileUrl tekil.
-- Servis duraklatma KvStore'da ('linkedin-outreach:paused'), burada degil.
CREATE TABLE `linkedin_prospects` (
  `id`             VARCHAR(191) NOT NULL,
  `ad`             VARCHAR(80) NOT NULL,
  `soyad`          VARCHAR(80) NOT NULL,
  `firma`          VARCHAR(160) NOT NULL,
  `unvan`          VARCHAR(160) NULL,
  `sektor`         VARCHAR(64) NULL,
  `kademe`         INT NOT NULL DEFAULT 1,
  `profileUrl`     VARCHAR(255) NOT NULL,
  `status`         ENUM('QUEUED', 'REQUESTED', 'ACCEPTED', 'MESSAGED', 'REPLIED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `noteText`       TEXT NULL,
  `messageText`    TEXT NULL,
  `requestedAt`    DATETIME(3) NULL,
  `acceptedAt`     DATETIME(3) NULL,
  `messagedAt`     DATETIME(3) NULL,
  `repliedAt`      DATETIME(3) NULL,
  `lastError`      TEXT NULL,
  `screenshotPath` VARCHAR(255) NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `linkedin_prospects_profileUrl_key` (`profileUrl`),
  INDEX `linkedin_prospects_status_idx` (`status`),
  INDEX `linkedin_prospects_requestedAt_idx` (`requestedAt`)
);
