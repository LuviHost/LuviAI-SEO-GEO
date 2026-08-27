-- AI gorunurluk testi kosumlari — append-only.
--
-- AiCitationSnapshot (siteId+date+provider unique) gunluk TEK satir tutar; ayni
-- gun ikinci "Yeniden Test" oncekinin uzerine yaziyordu — musteri onceki
-- sonucu kaybediyor, iki testi kiyaslayamiyordu (27.08.2026, ofsayt.com).
-- Snapshot grafik icin gunun son kosumunu tutmaya devam eder; her kosumun tam
-- sonucu (saglayici + probe) bu tabloda kalir; karsilastirma buradan.
CREATE TABLE `ai_citation_runs` (
  `id`             VARCHAR(191) NOT NULL,
  `siteId`         VARCHAR(191) NOT NULL,
  `runAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `trigger`        VARCHAR(191) NOT NULL DEFAULT 'user',
  `headlineScore`  INT NULL,
  `citedCount`     INT NOT NULL DEFAULT 0,
  `mentionedCount` INT NOT NULL DEFAULT 0,
  `poolSize`       INT NOT NULL DEFAULT 0,
  `providers`      JSON NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `ai_citation_runs_siteId_runAt_idx` (`siteId`, `runAt`)
);
