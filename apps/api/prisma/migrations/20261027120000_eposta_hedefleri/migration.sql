-- Kurumsal e-posta kampanyasi (2026-10-27)
--
-- eposta_hedefleri: firmanin kendi sitesinde yayimladigi kurumsal ROL kutusu (info@, pazarlama@ ...).
-- Kisi verisi tutulmaz. Admin paneli (/admin/eposta) bu tabloyu gosterir; worker EPOSTA_KAMPANYA_TICK
-- yalniz SIRADA (IYS'ye yuklendigi kullanici tarafindan onaylanan) satirlara gunluk kota icinde gonderir.
-- Mailjet olay akisi (/api/eposta/webhooks/mailjet) acilma/tiklama/geri donme/ret'i isler.
--
-- SQL semadan elle yazildi (yalniz yeni tablo; mevcut tablolara dokunmaz).

-- CreateTable
CREATE TABLE `eposta_hedefleri` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `firma` VARCHAR(255) NOT NULL,
    `marka` VARCHAR(120) NULL,
    `sektor` VARCHAR(64) NOT NULL,
    `web` VARCHAR(191) NULL,
    `kaynakSayfa` VARCHAR(500) NULL,
    `kaynak` VARCHAR(32) NULL,
    `varyant` VARCHAR(1) NOT NULL DEFAULT 'A',
    `durum` ENUM('YENI', 'IYS_DOSYADA', 'SIRADA', 'GONDERILDI', 'HATA', 'BOUNCE', 'RET', 'SPAM', 'HARIC') NOT NULL DEFAULT 'YENI',
    `iysParti` VARCHAR(40) NULL,
    `iysYuklendiAt` DATETIME(3) NULL,
    `kampanya` VARCHAR(80) NULL,
    `messageId` VARCHAR(40) NULL,
    `gonderildiAt` DATETIME(3) NULL,
    `acildiAt` DATETIME(3) NULL,
    `tiklandiAt` DATETIME(3) NULL,
    `sonOlay` VARCHAR(24) NULL,
    `sonOlayAt` DATETIME(3) NULL,
    `hata` TEXT NULL,
    `not` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `eposta_hedefleri_email_key`(`email`),
    INDEX `eposta_hedefleri_durum_idx`(`durum`),
    INDEX `eposta_hedefleri_gonderildiAt_idx`(`gonderildiAt`),
    INDEX `eposta_hedefleri_iysParti_idx`(`iysParti`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
