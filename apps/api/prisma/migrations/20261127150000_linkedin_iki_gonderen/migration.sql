-- LinkedIn Claude gonderimi iki yonetici (27.11.2026): ajan anahtari, is ve gonderen kisi basina

CREATE TABLE `linkedin_claude_ajanlar` (
  `userId` VARCHAR(191) NOT NULL,
  `anahtarOzeti` VARCHAR(64) NOT NULL,
  `sonGorulme` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `linkedin_claude_ajanlar_anahtarOzeti_key`(`anahtarOzeti`),
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `linkedin_claude_isler` ADD COLUMN `sahipId` VARCHAR(191) NULL;
CREATE INDEX `linkedin_claude_isler_sahipId_durum_idx` ON `linkedin_claude_isler`(`sahipId`, `durum`);

ALTER TABLE `linkedin_prospects` ADD COLUMN `gonderenId` VARCHAR(191) NULL;
CREATE INDEX `linkedin_prospects_gonderenId_requestedAt_idx` ON `linkedin_prospects`(`gonderenId`, `requestedAt`);

-- Var olan isler: acan yoneticiye bagla (olusturan = e-posta)
UPDATE `linkedin_claude_isler` i
  JOIN `users` u ON u.`email` = i.`olusturan`
  SET i.`sahipId` = u.`id`;

-- Bugune kadar tek hesap (kurucu) vardi: en son Claude isini acan yonetici. Is yoksa (bos veritabani)
-- @kurucu NULL kalir ve asagidaki satirlar hicbir seye dokunmaz (null = her hesabin kotasindan sayilir).
SET @kurucu = (
  SELECT x.`sahipId` FROM `linkedin_claude_isler` x
  WHERE x.`sahipId` IS NOT NULL ORDER BY x.`createdAt` DESC LIMIT 1
);

-- Otomatik kabul kontrolu isleri (olusturan e-posta degil) de kurucunun: surmekte olan biri askida kalmasin
UPDATE `linkedin_claude_isler` SET `sahipId` = @kurucu WHERE `sahipId` IS NULL AND @kurucu IS NOT NULL;

-- Gonderilmis istekler kurucunun hesabindan gitti (eski bot da ayni hesap); elle kayitlar null kalir
UPDATE `linkedin_prospects` SET `gonderenId` = @kurucu
  WHERE `requestedAt` IS NOT NULL AND `elle` = false AND @kurucu IS NOT NULL;

-- Eski tek anahtar → kurucunun ajani (Mac'teki anahtar dosyasi degismeden calismaya devam eder)
INSERT INTO `linkedin_claude_ajanlar` (`userId`, `anahtarOzeti`, `sonGorulme`, `createdAt`, `updatedAt`)
  SELECT @kurucu, kv.`value`, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `kv_store` kv
  WHERE kv.`key` = 'linkedin-claude:anahtar-ozeti' AND CHAR_LENGTH(kv.`value`) = 64 AND @kurucu IS NOT NULL;
