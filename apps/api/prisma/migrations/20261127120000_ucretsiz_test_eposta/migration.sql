-- Ucretsiz test: sonucu acmak icin e-posta (public-check-gate.ts)
ALTER TABLE `public_check_attempts`
  ADD COLUMN `email` VARCHAR(191) NULL,
  ADD COLUMN `emailAt` DATETIME(3) NULL,
  ADD COLUMN `pazarlamaIzni` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `anahtar` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `public_check_attempts_anahtar_key` ON `public_check_attempts`(`anahtar`);
