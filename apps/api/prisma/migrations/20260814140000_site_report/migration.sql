-- Kullanicinin calistirdigi raporun KALICI kaydi.
--
-- NEDEN: ReportsService.overview() her cagrida sifirdan hesapliyor ve
-- altindaki kaynaklarin bir kismi degisiyor/siliniyor (reklam metrikleri cron
-- ile uzerine yaziliyor, crawler kayitlari temizleniyor, aylik kotalar
-- sifirlaniyor). Ayni rapor iki hafta sonra acildiginda FARKLI sayi gosterir.
-- Musteriye gonderilen "Temmuz raporu"nun Eylul'de baska rakam gostermesi
-- kabul edilemez; bu yuzden rapor uretildigi anda dondurulur.
--
-- Liste kolonlari data Json'undan denormalize: gecmis listesi cizilirken satir
-- basina yuzlerce KB parse edilmesin. Skor kolonlari NULLABLE cunku
-- "olculemedi" ile "sifir" ayni sey degildir.
CREATE TABLE `site_reports` (
  `id`                VARCHAR(191) NOT NULL,
  `siteId`            VARCHAR(191) NOT NULL,
  `userId`            VARCHAR(191) NULL,
  `period`            VARCHAR(16)  NOT NULL,
  `periodStart`       DATETIME(3)  NOT NULL,
  `periodEnd`         DATETIME(3)  NOT NULL,
  `trigger`           VARCHAR(16)  NOT NULL DEFAULT 'manual',
  `data`              JSON         NOT NULL,
  `seoScore`          INT          NULL,
  `geoScore`          INT          NULL,
  `aiVisibility`      INT          NULL,
  `asoAvgRank`        DOUBLE       NULL,
  `clicks`            INT          NOT NULL DEFAULT 0,
  `impressions`       INT          NOT NULL DEFAULT 0,
  `articlesPublished` INT          NOT NULL DEFAULT 0,
  `costUsd`           DECIMAL(10,4) NOT NULL DEFAULT 0,
  `status`            VARCHAR(16)  NOT NULL DEFAULT 'READY',
  `error`             TEXT         NULL,
  `durationMs`        INT          NULL,
  `generatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `site_reports_siteId_generatedAt_idx` (`siteId`, `generatedAt`),
  INDEX `site_reports_siteId_period_periodStart_idx` (`siteId`, `period`, `periodStart`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `site_reports`
  ADD CONSTRAINT `site_reports_siteId_fkey`
  FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
