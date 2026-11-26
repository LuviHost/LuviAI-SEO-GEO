-- Claude ile gonderim: panelde onaylanan LinkedIn baglanti istegi isleri (Mac ajani yurutur)
CREATE TABLE `linkedin_claude_isler` (
  `id` VARCHAR(191) NOT NULL,
  `durum` VARCHAR(16) NOT NULL DEFAULT 'BEKLIYOR',
  `kuru` BOOLEAN NOT NULL DEFAULT true,
  `kisiler` JSON NOT NULL,
  `sonuc` JSON NULL,
  `hata` TEXT NULL,
  `olusturan` VARCHAR(191) NOT NULL,
  `alindiAt` DATETIME(3) NULL,
  `bittiAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `linkedin_claude_isler_durum_createdAt_idx`(`durum`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
