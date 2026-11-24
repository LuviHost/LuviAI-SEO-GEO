-- Ana sorunun Google organik sirasi + bilgi paneli; AI Bakisi cikmayan aramalar da (YOK satirlari GeoPromptRun'a yazilmaz)
CREATE TABLE `geo_prompt_google_organic` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `promptId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `rank` INTEGER NULL,
    `knowledgePanel` VARCHAR(120) NULL,
    `aiOverview` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `geo_prompt_google_organic_promptId_date_idx`(`promptId`, `date`),
    INDEX `geo_prompt_google_organic_siteId_date_idx`(`siteId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `geo_prompt_google_organic` ADD CONSTRAINT `geo_prompt_google_organic_promptId_fkey` FOREIGN KEY (`promptId`) REFERENCES `geo_prompts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
