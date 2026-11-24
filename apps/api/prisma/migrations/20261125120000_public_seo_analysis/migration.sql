-- Ucretsiz SEO analizi (ranksup.ai/seo-analizi): uye olmadan alan adi analizi, 24 saat onbellek
CREATE TABLE `public_seo_analyses` (
    `id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `ipHash` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `result` JSON NULL,
    `error` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `public_seo_analyses_domain_createdAt_idx`(`domain`, `createdAt`),
    INDEX `public_seo_analyses_ipHash_createdAt_idx`(`ipHash`, `createdAt`),
    INDEX `public_seo_analyses_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
