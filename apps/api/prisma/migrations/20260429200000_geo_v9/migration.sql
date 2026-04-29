-- AI Referrer Hits (ChatGPT/Perplexity'den gelen kullanici trafigi)
CREATE TABLE `ai_referrer_hits` (
  `id`          VARCHAR(191) NOT NULL,
  `siteId`      VARCHAR(191) NOT NULL,
  `date`        DATE NOT NULL,
  `referrer`    VARCHAR(50) NOT NULL,
  `hits`        INT NOT NULL DEFAULT 0,
  `uniqueUrls`  INT NOT NULL DEFAULT 0,
  `topUrls`     JSON NOT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_referrer_hits_siteId_date_referrer_key` (`siteId`, `date`, `referrer`),
  INDEX `ai_referrer_hits_siteId_date_idx` (`siteId`, `date`)
);
