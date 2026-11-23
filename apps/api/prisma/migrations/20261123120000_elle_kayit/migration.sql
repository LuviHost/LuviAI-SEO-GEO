-- Elle kayit: kurucunun kendi attigi LinkedIn / e-posta mesajlari takip listesine girer
ALTER TABLE `linkedin_prospects`
  ADD COLUMN `kanal` ENUM('LINKEDIN', 'EPOSTA') NOT NULL DEFAULT 'LINKEDIN',
  ADD COLUMN `eposta` VARCHAR(191) NULL,
  ADD COLUMN `elle` BOOLEAN NOT NULL DEFAULT false;
