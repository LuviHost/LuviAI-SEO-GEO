-- Faz 11.4: Generic KV store (AI cost counter, daily caps)
CREATE TABLE `kv_store` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `kv_store_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
