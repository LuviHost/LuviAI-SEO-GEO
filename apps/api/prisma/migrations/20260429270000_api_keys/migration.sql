-- Sprint C: Public API keys
CREATE TABLE `api_keys` (
  `id`         VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `keyHash`    VARCHAR(191) NOT NULL,
  `prefix`     VARCHAR(20)  NOT NULL,
  `scopes`     JSON NOT NULL,
  `rateLimit`  INT NOT NULL DEFAULT 60,
  `lastUsedAt` DATETIME(3) NULL,
  `expiresAt`  DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt`  DATETIME(3) NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `api_keys_keyHash_key` (`keyHash`),
  INDEX `api_keys_userId_idx` (`userId`),
  INDEX `api_keys_keyHash_idx` (`keyHash`)
);
