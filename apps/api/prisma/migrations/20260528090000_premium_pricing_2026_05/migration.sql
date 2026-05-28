-- 2026-05 Premium Pricing Update
-- 1. users tablosuna grandfathering + legacy price field'lari
-- 2. video_credit_purchases tablosu (add-on satın alma)
-- 3. Mevcut tüm aktif/trial kullanıcılara 6 ay grandfathering at + eski plan fiyatını snapshot al

-- ─── 1. User grandfathering field'lari ────────────────────────────────
ALTER TABLE `users`
  ADD COLUMN `grandfatheredUntil` DATETIME(3) NULL,
  ADD COLUMN `legacyMonthlyPriceTry` INT NULL;

CREATE INDEX `users_grandfatheredUntil_idx` ON `users`(`grandfatheredUntil`);

-- ─── 2. VideoCreditPurchase tablosu ───────────────────────────────────
CREATE TABLE `video_credit_purchases` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `packSize` INT NOT NULL,
  `priceTry` INT NOT NULL,
  `status` ENUM('PENDING', 'PAID', 'CONSUMED', 'REFUNDED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  `merchantOid` VARCHAR(191) NULL,
  `paytrInvoiceId` VARCHAR(191) NULL,
  `creditsTotal` INT NOT NULL,
  `creditsUsed` INT NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3) NULL,
  `paidAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `video_credit_purchases_merchantOid_key`(`merchantOid`),
  INDEX `video_credit_purchases_userId_status_idx`(`userId`, `status`),
  INDEX `video_credit_purchases_merchantOid_idx`(`merchantOid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `video_credit_purchases`
  ADD CONSTRAINT `video_credit_purchases_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Grandfathering: tüm mevcut aktif/trial kullanıcılara 6 ay süre ──
-- Yeni fiyatlar bugünden itibaren geçerli; mevcut müşteriler 6 ay eski fiyatla devam.
-- legacyMonthlyPriceTry = eski plan fiyatının snapshot'ı (raporlama + email notif için).
UPDATE `users`
SET
  `grandfatheredUntil` = DATE_ADD(NOW(), INTERVAL 6 MONTH),
  `legacyMonthlyPriceTry` = CASE `plan`
    WHEN 'STARTER'    THEN 1199
    WHEN 'PRO'        THEN 3499
    WHEN 'AGENCY'     THEN 7999
    WHEN 'ENTERPRISE' THEN 19999
    ELSE NULL
  END
WHERE `plan` IN ('STARTER', 'PRO', 'AGENCY', 'ENTERPRISE')
  AND `subscriptionStatus` IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
  AND `grandfatheredUntil` IS NULL;
