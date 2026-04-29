-- AI Crawler Hits (sunucu log analitigi)
CREATE TABLE `ai_crawler_hits` (
  `id`          VARCHAR(191) NOT NULL,
  `siteId`      VARCHAR(191) NOT NULL,
  `date`        DATE NOT NULL,
  `bot`         VARCHAR(100) NOT NULL,
  `hits`        INT NOT NULL DEFAULT 0,
  `uniqueUrls`  INT NOT NULL DEFAULT 0,
  `topUrls`     JSON NOT NULL,
  `status2xx`   INT NOT NULL DEFAULT 0,
  `status4xx`   INT NOT NULL DEFAULT 0,
  `status5xx`   INT NOT NULL DEFAULT 0,
  `bytesServed` INT NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_crawler_hits_siteId_date_bot_key` (`siteId`, `date`, `bot`),
  INDEX `ai_crawler_hits_siteId_date_idx` (`siteId`, `date`),
  INDEX `ai_crawler_hits_siteId_bot_date_idx` (`siteId`, `bot`, `date`)
);
