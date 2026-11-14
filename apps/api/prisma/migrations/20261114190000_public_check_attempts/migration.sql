-- Ucretsiz AI gorunurluk testinin HER denemesi (14.11.2026, sahip: "uye olmadan tarayan herkesi
-- kaydetmek istiyorum, kacirmak istemiyorum"). public_citation_checks yalniz taze olcumu tutar;
-- kayitli sonucu goren, haftalik sinira ya da gunluk tavana takilan, sitesine ulasilamayan
-- deneme iz birakmiyordu. Yeni kisisel veri yok: alan adi + IP ozeti (hash) + zaman.

-- CreateTable
CREATE TABLE `public_check_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `checkId` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `detail` VARCHAR(191) NULL,
    `notifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `public_check_attempts_createdAt_idx`(`createdAt`),
    INDEX `public_check_attempts_domain_createdAt_idx`(`domain`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
