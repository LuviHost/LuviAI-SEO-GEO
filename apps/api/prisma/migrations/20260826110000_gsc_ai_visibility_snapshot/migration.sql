-- GSC "Generative AI" performans raporu (AI Overviews + AI Mode gorunumleri).
--
-- Google bu raporu yalniz GOSTERIM olarak ve AIO/AI Mode AYRIMSIZ verir; API
-- ve BigQuery yok, tek cikis UI'dan CSV export (support.google.com/webmasters/
-- answer/16984139). Urunun 7 saglayicisi Google'in AI yuzeylerini hic
-- kapsamiyordu — 2,5 milyar kullanicili yuzey kor noktaydi (defter analizi
-- 2026-08, >=2 bagimsiz kaynak). Kullanici export'u yukler, parser yanlis
-- dosyayi (tiklama dolu normal Performans raporu) reddeder, buraya gunluk yazilir.
--
-- surface bugun hep 'gen_ai'; Google ayrimi acarsa 'aio' | 'ai_mode'.
-- clicks/position ileriye donuk NULL — rapor bugun vermiyor.
CREATE TABLE `gsc_ai_visibility_snapshots` (
  `id`          VARCHAR(191) NOT NULL,
  `siteId`      VARCHAR(191) NOT NULL,
  `date`        DATE NOT NULL,
  `surface`     VARCHAR(191) NOT NULL DEFAULT 'gen_ai',
  `impressions` INT NOT NULL,
  `clicks`      INT NULL,
  `position`    DOUBLE NULL,
  `source`      VARCHAR(191) NOT NULL DEFAULT 'csv_upload',
  `meta`        JSON NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `gsc_ai_visibility_snapshots_siteId_date_surface_key` (`siteId`, `date`, `surface`),
  INDEX `gsc_ai_visibility_snapshots_siteId_date_idx` (`siteId`, `date`)
);
