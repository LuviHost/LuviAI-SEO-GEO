-- Google Isletme Profili (2026-10-27)
--
-- site_gbp: site basina tek kayit. placeId (Places API kimligi — Maps Platform kosullarinda kalici
-- saklanabilen tek alan; puan/yorum/saat SAKLANMAZ, denetim canli calisir) ve GBP API onayi sonrasi
-- kullanilacak OAuth alanlari (sifreli refresh token, hesap/konum). Yalniz yeni tablo; mevcut tablolara dokunmaz.
--
-- SQL `prisma migrate diff` ile semadan uretildi (veritabanina dokunmadan).

-- CreateTable
CREATE TABLE `site_gbp` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `placeId` VARCHAR(300) NULL,
    `placeAt` DATETIME(3) NULL,
    `refreshToken` TEXT NULL,
    `hesap` VARCHAR(100) NULL,
    `konum` VARCHAR(100) NULL,
    `konumAdi` VARCHAR(255) NULL,
    `oauthAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_gbp_siteId_key`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `site_gbp` ADD CONSTRAINT `site_gbp_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

