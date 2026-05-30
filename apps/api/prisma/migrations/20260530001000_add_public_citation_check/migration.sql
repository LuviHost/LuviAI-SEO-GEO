-- CreateTable
CREATE TABLE `public_citation_checks` (
    `id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL,
    `niche` VARCHAR(191) NULL,
    `customNiche` VARCHAR(191) NULL,
    `result` JSON NOT NULL,
    `totalCalls` INTEGER NOT NULL DEFAULT 0,
    `costUsd` DOUBLE NOT NULL DEFAULT 0,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `public_citation_checks_domain_key`(`domain`),
    INDEX `public_citation_checks_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
